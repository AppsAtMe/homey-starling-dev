/**
 * Rate Limiter for API calls
 *
 * Implements client-side rate limiting for:
 * - Camera snapshots: max 1 per 10 seconds per device
 * - Property writes: max 1 per second per device
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class RateLimiter {
  private timestamps: Map<string, number[]> = new Map();
  private queues: Map<string, QueuedRequest<unknown>[]> = new Map();
  private processing: Set<string> = new Set();

  constructor(private config: RateLimitConfig) {}

  /**
   * Execute a rate-limited operation
   * @param key Unique key for rate limiting (e.g., deviceId + operation)
   * @param operation The async operation to execute
   */
  async execute<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(key) || [];
      queue.push({ execute: operation, resolve: resolve as (v: unknown) => void, reject });
      this.queues.set(key, queue);
      this.processQueue(key);
    });
  }

  private async processQueue(key: string): Promise<void> {
    if (this.processing.has(key)) {
      return;
    }

    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) {
      return;
    }

    this.processing.add(key);

    try {
      while (queue.length > 0) {
        const waitTime = this.getWaitTime(key);

        if (waitTime > 0) {
          await this.sleep(waitTime);
        }

        const request = queue.shift();
        if (!request) break;

        this.recordRequest(key);

        try {
          const result = await request.execute();
          request.resolve(result);
        } catch (error) {
          request.reject(error as Error);
        }
      }
    } finally {
      this.processing.delete(key);
    }
  }

  private getWaitTime(key: string): number {
    const now = Date.now();
    const timestamps = this.timestamps.get(key) || [];

    // Clean old timestamps
    const validTimestamps = timestamps.filter(t => now - t < this.config.windowMs);
    this.timestamps.set(key, validTimestamps);

    if (validTimestamps.length < this.config.maxRequests) {
      return 0;
    }

    // Calculate wait time until oldest request expires
    const oldestTimestamp = validTimestamps[0];
    return oldestTimestamp + this.config.windowMs - now;
  }

  private recordRequest(key: string): void {
    const timestamps = this.timestamps.get(key) || [];
    timestamps.push(Date.now());
    this.timestamps.set(key, timestamps);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear rate limit history for a key, rejecting any queued requests
   */
  clear(key: string): void {
    this.timestamps.delete(key);
    const queue = this.queues.get(key);
    if (queue) {
      for (const request of queue) {
        request.reject(new Error('Rate limiter cleared'));
      }
      this.queues.delete(key);
    }
  }

  /**
   * Clear all rate limit history, rejecting any queued requests
   */
  clearAll(): void {
    this.timestamps.clear();
    for (const queue of this.queues.values()) {
      for (const request of queue) {
        request.reject(new Error('Rate limiter cleared'));
      }
    }
    this.queues.clear();
  }
}

// Pre-configured rate limiters for Starling API
export const snapshotRateLimiter = new RateLimiter({
  maxRequests: 1,
  windowMs: 10000, // 1 per 10 seconds
});

export const writeRateLimiter = new RateLimiter({
  maxRequests: 1,
  windowMs: 1000, // 1 per second
});
