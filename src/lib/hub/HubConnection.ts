/**
 * HubConnection - Manages connection to a single Starling Hub
 *
 * Wraps StarlingClient with:
 * - Connection state management
 * - Grace period handling for offline detection
 * - Exponential backoff for retries
 * - Device state caching and change detection
 */

import { EventEmitter } from 'events';
import { StarlingClient } from '../api/StarlingClient';
import { StarlingError } from '../api/errors';
import { Device, StatusResponse } from '../api/types';
import {
  HubConfig,
  HubStatus,
  ConnectionState,
  DeviceStateChange,
  PropertyChange,
  HubConnectionEvents,
} from './types';

/**
 * Type-safe event emitter for HubConnection
 */
declare interface HubConnection {
  on<K extends keyof HubConnectionEvents>(
    event: K,
    listener: HubConnectionEvents[K]
  ): this;
  emit<K extends keyof HubConnectionEvents>(
    event: K,
    ...args: Parameters<HubConnectionEvents[K]>
  ): boolean;
}

/**
 * Manages connection to a single Starling Hub
 */
class HubConnection extends EventEmitter {
  private config: HubConfig;
  private readonly client: StarlingClient;
  private readonly gracePeriodMs: number;

  private state: ConnectionState = 'disconnected';
  private permissions: StatusResponse['permissions'] | null = null;
  private apiVersion: string | null = null;
  private lastPoll: Date | null = null;
  private lastError: string | null = null;
  private gracePeriodStarted: Date | null = null;

  private deviceCache: Map<string, Device> = new Map();
  private retryCount: number = 0;
  private retryTimeout: NodeJS.Timeout | null = null;

  // Backoff configuration
  private readonly minRetryDelayMs = 1000;
  private readonly maxRetryDelayMs = 30000;
  private readonly backoffMultiplier = 2;

  constructor(config: HubConfig, gracePeriodMs: number = 45000) {
    super();
    this.config = config;
    this.gracePeriodMs = gracePeriodMs;

    this.client = new StarlingClient({
      host: config.host,
      port: config.port,
      apiKey: config.apiKey,
      useHttps: config.useHttps,
      timeoutMs: 10000,
    });
  }

  /**
   * Get the hub configuration
   */
  getConfig(): HubConfig {
    return { ...this.config };
  }

  /**
   * Update non-connection config fields (e.g. name, pollIntervalMs)
   */
  updateConfig(updates: Partial<HubConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get the current hub status
   */
  getStatus(): HubStatus {
    // Strip apiKey from status to avoid leaking to frontends
    const { apiKey: _, ...safeConfig } = this.getConfig();
    return {
      config: { ...safeConfig, apiKey: '' } as HubConfig,
      state: this.state,
      isOnline: this.state === 'connected',
      lastPoll: this.lastPoll,
      gracePeriodStarted: this.gracePeriodStarted,
      lastError: this.lastError,
      permissions: this.permissions,
      apiVersion: this.apiVersion,
      deviceCount: this.deviceCache.size,
    };
  }

  /**
   * Get the underlying StarlingClient
   */
  getClient(): StarlingClient {
    return this.client;
  }

  /**
   * Check if the hub is online
   */
  isOnline(): boolean {
    return this.state === 'connected';
  }

  /**
   * Check if the hub is in grace period
   */
  isInGracePeriod(): boolean {
    return this.gracePeriodStarted !== null;
  }

  /**
   * Get cached devices
   */
  getCachedDevices(): Device[] {
    return Array.from(this.deviceCache.values());
  }

  /**
   * Get a cached device by ID
   */
  getCachedDevice(deviceId: string): Device | undefined {
    return this.deviceCache.get(deviceId);
  }

  /**
   * Connect to the hub
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');
    this.clearRetryTimeout();

    try {
      const status = await this.client.testConnection();
      this.permissions = status.permissions;
      this.apiVersion = status.apiVersion;
      this.lastError = null;
      this.retryCount = 0;
      this.gracePeriodStarted = null;

      // Fetch initial devices
      const devices = await this.client.getDevices();
      this.updateDeviceCache(devices);

      this.setState('connected');
      this.emit('online');
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  /**
   * Disconnect from the hub
   */
  async disconnect(): Promise<void> {
    this.clearRetryTimeout();
    this.gracePeriodStarted = null;
    this.setState('disconnected');
  }

  /**
   * Refresh devices from the hub
   *
   * Returns the current devices and any detected state changes.
   */
  async refreshDevices(): Promise<{
    devices: Device[];
    changes: DeviceStateChange[];
  }> {
    if (this.state === 'disconnected' || this.state === 'offline') {
      throw new Error(`Cannot refresh: hub is ${this.state}`);
    }

    try {
      const devices = await this.client.getDevices();
      const changes = this.updateDeviceCache(devices);

      this.lastPoll = new Date();
      this.lastError = null;

      // If we were reconnecting, we're now connected
      if (this.state === 'reconnecting') {
        this.retryCount = 0;
        this.gracePeriodStarted = null;
        this.setState('connected');
        this.emit('online');
      }

      return { devices, changes };
    } catch (error) {
      this.handlePollError(error as Error);
      throw error;
    }
  }

  /**
   * Set a device property
   */
  async setDeviceProperty(
    deviceId: string,
    property: string,
    value: unknown
  ): Promise<void> {
    if (!this.isOnline()) {
      throw new Error('Hub is not online');
    }

    await this.client.setDeviceProperty(deviceId, property, value);
  }

  /**
   * Set multiple device properties
   */
  async setDeviceProperties(
    deviceId: string,
    properties: Record<string, unknown>
  ): Promise<void> {
    if (!this.isOnline()) {
      throw new Error('Hub is not online');
    }

    await this.client.setDeviceProperties(deviceId, properties);
  }

  /**
   * Get a camera snapshot
   */
  async getSnapshot(deviceId: string): Promise<Buffer> {
    if (!this.isOnline()) {
      throw new Error('Hub is not online');
    }

    if (!this.permissions?.camera) {
      throw new Error('Camera permission not granted');
    }

    return this.client.getSnapshot(deviceId);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Update device cache and detect changes
   */
  private updateDeviceCache(devices: Device[]): DeviceStateChange[] {
    const changes: DeviceStateChange[] = [];
    const newDeviceIds = new Set(devices.map((d) => d.id));
    const timestamp = new Date();
    let hasAdditions = false;
    let hasRemovals = false;

    // Check for new and changed devices
    for (const device of devices) {
      const cached = this.deviceCache.get(device.id);

      if (!cached) {
        // New device
        hasAdditions = true;
        this.deviceCache.set(device.id, device);
        this.emit('deviceAdded', device);
      } else {
        // Check for property changes
        const propertyChanges = this.detectPropertyChanges(cached, device);

        if (propertyChanges.length > 0) {
          const change: DeviceStateChange = {
            device,
            hubId: this.config.id,
            changes: propertyChanges,
            timestamp,
          };
          changes.push(change);
          this.emit('deviceStateChange', change);
        }

        this.deviceCache.set(device.id, device);
      }
    }

    // Check for removed devices
    for (const deviceId of this.deviceCache.keys()) {
      if (!newDeviceIds.has(deviceId)) {
        hasRemovals = true;
        this.deviceCache.delete(deviceId);
        this.emit('deviceRemoved', deviceId);
      }
    }

    if (changes.length > 0 || hasAdditions || hasRemovals) {
      this.emit('devicesUpdated', devices);
    }

    return changes;
  }

  /**
   * Detect property changes between two device states
   */
  private detectPropertyChanges(
    oldDevice: Device,
    newDevice: Device
  ): PropertyChange[] {
    const changes: PropertyChange[] = [];

    // Compare all properties
    const allKeys = new Set([
      ...Object.keys(oldDevice),
      ...Object.keys(newDevice),
    ]);

    for (const key of allKeys) {
      const oldValue = (oldDevice as unknown as Record<string, unknown>)[key];
      const newValue = (newDevice as unknown as Record<string, unknown>)[key];

      // Deep comparison for objects
      if (!this.deepEqual(oldValue, newValue)) {
        changes.push({
          property: key,
          oldValue,
          newValue,
        });
      }
    }

    return changes;
  }

  /**
   * Deep equality check (handles arrays, objects, and primitives)
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object' && typeof b === 'object') {
      const aIsArray = Array.isArray(a);
      const bIsArray = Array.isArray(b);
      if (aIsArray !== bIsArray) return false;

      if (aIsArray && bIsArray) {
        if (a.length !== b.length) return false;
        return a.every((val, i) => this.deepEqual(val, b[i]));
      }

      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const aKeys = Object.keys(aObj);
      const bKeys = Object.keys(bObj);

      if (aKeys.length !== bKeys.length) return false;

      return aKeys.every((key) => this.deepEqual(aObj[key], bObj[key]));
    }

    return false;
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: Error): void {
    this.lastError = error.message;

    if (this.state === 'connecting') {
      // First connection attempt failed
      this.setState('reconnecting');
      this.startGracePeriod();
    }

    this.emit('error', error);
    this.scheduleRetry();
  }

  /**
   * Handle poll error
   */
  private handlePollError(error: Error): void {
    this.lastError = error.message;

    if (this.state === 'connected') {
      // Start grace period on first poll failure
      this.setState('reconnecting');
      this.startGracePeriod();
    }

    this.emit('error', error);

    // Check if grace period has expired
    if (this.isGracePeriodExpired()) {
      this.goOffline();
    } else {
      this.scheduleRetry();
    }
  }

  /**
   * Start the grace period
   */
  private startGracePeriod(): void {
    if (!this.gracePeriodStarted) {
      this.gracePeriodStarted = new Date();
    }
  }

  /**
   * Check if grace period has expired
   */
  private isGracePeriodExpired(): boolean {
    if (!this.gracePeriodStarted) return false;

    const elapsed = Date.now() - this.gracePeriodStarted.getTime();
    return elapsed >= this.gracePeriodMs;
  }

  /**
   * Mark the hub as offline
   */
  private goOffline(): void {
    this.clearRetryTimeout();
    this.setState('offline');
    this.emit('offline', this.lastError || 'Unknown error');
  }

  /**
   * Schedule a retry attempt
   */
  private scheduleRetry(): void {
    this.clearRetryTimeout();

    const delay = Math.min(
      this.minRetryDelayMs * Math.pow(this.backoffMultiplier, this.retryCount),
      this.maxRetryDelayMs
    );

    this.retryTimeout = setTimeout(async () => {
      if (this.state !== 'reconnecting') return;

      this.retryCount++;

      try {
        await this.client.testConnection();
        if (this.state !== 'reconnecting') return;

        const devices = await this.client.getDevices();
        if (this.state !== 'reconnecting') return;

        this.updateDeviceCache(devices);

        this.retryCount = 0;
        this.gracePeriodStarted = null;
        this.lastError = null;
        this.lastPoll = new Date();

        this.setState('connected');
        this.emit('online');
      } catch (error) {
        if (this.state !== 'reconnecting') return;

        // Only treat network-level errors as retry candidates
        if (error instanceof StarlingError) {
          if (this.isGracePeriodExpired()) {
            this.goOffline();
          } else {
            this.emit('error', error);
            this.scheduleRetry();
          }
        } else {
          // Data processing errors (TypeError, etc.) — log but don't take hub offline
          this.emit('error', error as Error);
          this.scheduleRetry();
        }
      }
    }, delay);
  }

  /**
   * Clear retry timeout
   */
  private clearRetryTimeout(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Set connection state and emit event
   */
  private setState(newState: ConnectionState): void {
    const previousState = this.state;
    if (newState !== previousState) {
      this.state = newState;
      this.emit('stateChange', newState, previousState);
    }
  }
}

export { HubConnection };
