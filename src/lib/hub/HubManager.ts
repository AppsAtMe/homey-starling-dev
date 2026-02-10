/**
 * HubManager - Central manager for all Starling Hub connections
 *
 * Singleton that orchestrates:
 * - Multiple hub connections
 * - Staggered initialization
 * - Device routing
 * - Settings persistence
 * - Event aggregation
 */

import { EventEmitter } from 'events';
import Homey from 'homey';
import { HubConnection } from './HubConnection';
import { Poller } from './Poller';
import { Device } from '../api/types';
import {
  HubConfig,
  HubStatus,
  HubManagerEvents,
  AppSettings,
  DEFAULT_SETTINGS,
  DeviceWithHub,
} from './types';
import { getLogger } from '../utils/Logger';

/**
 * Type-safe event emitter for HubManager
 */
declare interface HubManager {
  on<K extends keyof HubManagerEvents>(
    event: K,
    listener: HubManagerEvents[K]
  ): this;
  emit<K extends keyof HubManagerEvents>(
    event: K,
    ...args: Parameters<HubManagerEvents[K]>
  ): boolean;
}

/**
 * Central manager for all hub connections
 */
class HubManager extends EventEmitter {
  private static instance: HubManager | null = null;

  private readonly app: Homey.App;
  private readonly connections: Map<string, HubConnection> = new Map();
  private readonly pollers: Map<string, Poller> = new Map();
  private readonly deviceToHub: Map<string, string> = new Map();

  private settings: AppSettings = DEFAULT_SETTINGS;
  private initialized: boolean = false;
  private initializing: boolean = false;

  /**
   * Private constructor - use getInstance()
   */
  private constructor(app: Homey.App) {
    super();
    this.app = app;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(app?: Homey.App): HubManager {
    if (!HubManager.instance) {
      if (!app) {
        throw new Error('HubManager not initialized. Call getInstance(app) first.');
      }
      HubManager.instance = new HubManager(app);
    }
    return HubManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static async resetInstance(): Promise<void> {
    if (HubManager.instance) {
      await HubManager.instance.shutdown();
      HubManager.instance = null;
    }
  }

  /**
   * Initialize the hub manager
   *
   * Loads saved hub configurations and connects with staggered timing.
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.initializing) {
      return;
    }

    this.initializing = true;
    const logger = getLogger();

    try {
      logger.info('HubManager initializing...');

      // Load settings from Homey storage
      this.loadSettings();

      // Connect to each hub with staggered timing
      const hubs = this.settings.hubs;
      const staggerDelayMs = 2000; // 2 seconds between hubs
      const failedHubs: string[] = [];

      for (let i = 0; i < hubs.length; i++) {
        const hubConfig = hubs[i];
        logger.debug(`Connecting to hub ${i + 1}/${hubs.length}: ${hubConfig.name}`);

        try {
          await this.addHub(hubConfig, false); // Don't save - already in settings
        } catch (error) {
          logger.error(`Failed to connect to hub ${hubConfig.name}:`, error as Error);
          failedHubs.push(hubConfig.name);
          // Emit hubOffline so the existing notification infrastructure kicks in
          this.emit('hubOffline', hubConfig.id, (error as Error).message);
        }

        // Stagger next connection
        if (i < hubs.length - 1) {
          await this.sleep(staggerDelayMs);
        }
      }

      this.initialized = true;
      if (failedHubs.length > 0) {
        logger.info(
          `HubManager initialized with ${this.connections.size} hub(s), ` +
          `${failedHubs.length} failed: ${failedHubs.join(', ')}`
        );
      } else {
        logger.info(`HubManager initialized with ${this.connections.size} hub(s)`);
      }
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Shutdown the hub manager
   */
  async shutdown(): Promise<void> {
    const logger = getLogger();
    logger.info('HubManager shutting down...');

    // Stop all pollers
    for (const poller of this.pollers.values()) {
      poller.stop();
    }
    this.pollers.clear();

    // Disconnect all hubs
    for (const connection of this.connections.values()) {
      await connection.disconnect();
    }
    this.connections.clear();
    this.deviceToHub.clear();

    this.initialized = false;
    logger.info('HubManager shutdown complete');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================
  // Hub Management
  // ============================================================

  /**
   * Add a new hub
   */
  async addHub(config: HubConfig, save: boolean = true): Promise<HubConnection> {
    const logger = getLogger();

    // Check for duplicate
    if (this.connections.has(config.id)) {
      throw new Error(`Hub with ID ${config.id} already exists`);
    }

    logger.info(`Adding hub: ${config.name} (${config.host})`);

    // Create connection
    const connection = new HubConnection(config, this.settings.gracePeriodMs);

    // Set up event forwarding
    this.setupConnectionEvents(connection, config.id);

    // Store connection
    this.connections.set(config.id, connection);

    // Try to connect
    await connection.connect();

    // Create and start poller
    const pollInterval = config.pollIntervalMs ?? this.settings.defaultPollIntervalMs;
    const poller = new Poller(connection, { intervalMs: pollInterval });
    poller.on('error', (error: Error) => {
      getLogger().debug(`Poller error for hub ${config.id}: ${error.message}`);
    });
    this.pollers.set(config.id, poller);
    poller.start();

    // Update device routing
    this.updateDeviceRouting(config.id, connection.getCachedDevices());

    // Save to settings if requested
    if (save) {
      this.saveHubToSettings(config);
    }

    this.emit('hubAdded', config.id, config);
    return connection;
  }

  /**
   * Update a hub configuration
   */
  async updateHub(
    hubId: string,
    updates: Partial<Omit<HubConfig, 'id'>>
  ): Promise<HubConnection> {
    const connection = this.connections.get(hubId);
    if (!connection) {
      throw new Error(`Hub ${hubId} not found`);
    }

    const oldConfig = connection.getConfig();
    const newConfig: HubConfig = { ...oldConfig, ...updates };

    // If connection parameters changed, reconnect
    const connectionChanged =
      updates.host !== undefined ||
      updates.port !== undefined ||
      updates.apiKey !== undefined ||
      updates.useHttps !== undefined;

    if (connectionChanged) {
      // Remove old connection
      await this.removeHub(hubId, false);

      // Add with new config
      return this.addHub(newConfig, true);
    }

    // Update the running connection's config (e.g. name)
    connection.updateConfig(updates);

    // Persist settings
    this.saveHubToSettings(newConfig);

    // Update poll interval if changed
    if (updates.pollIntervalMs !== undefined) {
      const poller = this.pollers.get(hubId);
      if (poller) {
        poller.setInterval(updates.pollIntervalMs);
      }
    }

    return connection;
  }

  /**
   * Remove a hub
   */
  async removeHub(hubId: string, save: boolean = true): Promise<void> {
    const logger = getLogger();
    const connection = this.connections.get(hubId);

    if (!connection) {
      return;
    }

    logger.info(`Removing hub: ${hubId}`);

    // Stop poller
    const poller = this.pollers.get(hubId);
    if (poller) {
      poller.stop();
      this.pollers.delete(hubId);
    }

    // Disconnect
    await connection.disconnect();
    this.connections.delete(hubId);

    // Remove device routing
    for (const [deviceId, hId] of this.deviceToHub.entries()) {
      if (hId === hubId) {
        this.deviceToHub.delete(deviceId);
      }
    }

    // Update settings if requested
    if (save) {
      this.removeHubFromSettings(hubId);
    }

    this.emit('hubRemoved', hubId);
  }

  /**
   * Get a hub connection by ID
   */
  getHub(hubId: string): HubConnection | undefined {
    return this.connections.get(hubId);
  }

  /**
   * Get all hub connections
   */
  getAllHubs(): HubConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get hub status for all hubs
   */
  getAllHubStatuses(): HubStatus[] {
    return this.getAllHubs().map((h) => h.getStatus());
  }

  // ============================================================
  // Device Routing
  // ============================================================

  /**
   * Get the hub connection for a device
   */
  getHubForDevice(deviceId: string): HubConnection | undefined {
    const hubId = this.deviceToHub.get(deviceId);
    return hubId ? this.connections.get(hubId) : undefined;
  }

  /**
   * Get all devices from all hubs
   */
  getAllDevices(): DeviceWithHub[] {
    const devices: DeviceWithHub[] = [];

    for (const connection of this.connections.values()) {
      const hubId = connection.getConfig().id;
      for (const device of connection.getCachedDevices()) {
        devices.push({
          device,
          hubId,
          compositeId: `${hubId}:${device.id}`,
        });
      }
    }

    return devices;
  }

  /**
   * Get devices for a specific hub
   */
  getDevicesForHub(hubId: string): Device[] {
    const connection = this.connections.get(hubId);
    return connection ? connection.getCachedDevices() : [];
  }

  /**
   * Find a device by ID across all hubs
   */
  findDevice(deviceId: string): DeviceWithHub | undefined {
    const hubId = this.deviceToHub.get(deviceId);
    if (!hubId) return undefined;

    const connection = this.connections.get(hubId);
    if (!connection) return undefined;

    const device = connection.getCachedDevice(deviceId);
    if (!device) return undefined;

    return {
      device,
      hubId,
      compositeId: `${hubId}:${device.id}`,
    };
  }

  // ============================================================
  // Actions
  // ============================================================

  /**
   * Refresh all devices from all hubs
   */
  async refreshAll(): Promise<void> {
    const promises = Array.from(this.pollers.values()).map((p) => p.refresh());
    await Promise.allSettled(promises);
  }

  /**
   * Refresh devices from a specific hub
   */
  async refreshHub(hubId: string): Promise<void> {
    const poller = this.pollers.get(hubId);
    if (poller) {
      await poller.refresh();
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
    const connection = this.getHubForDevice(deviceId);
    if (!connection) {
      throw new Error(`Device ${deviceId} not found`);
    }

    await connection.setDeviceProperty(deviceId, property, value);
  }

  /**
   * Get a camera snapshot
   */
  async getSnapshot(deviceId: string): Promise<Buffer> {
    const connection = this.getHubForDevice(deviceId);
    if (!connection) {
      throw new Error(`Device ${deviceId} not found`);
    }

    return connection.getSnapshot(deviceId);
  }

  // ============================================================
  // Settings
  // ============================================================

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * Update global settings
   */
  async updateSettings(updates: Partial<Omit<AppSettings, 'hubs'>>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Set up event forwarding from a hub connection
   */
  private setupConnectionEvents(connection: HubConnection, hubId: string): void {
    connection.on('online', () => {
      this.emit('hubOnline', hubId);
    });

    connection.on('offline', (error) => {
      this.emit('hubOffline', hubId, error);
    });

    connection.on('deviceStateChange', (change) => {
      this.emit('deviceStateChange', change);
    });

    connection.on('deviceAdded', (device) => {
      this.deviceToHub.set(device.id, hubId);
      this.emit('deviceAdded', hubId, device);
    });

    connection.on('deviceRemoved', (deviceId) => {
      this.deviceToHub.delete(deviceId);
      this.emit('deviceRemoved', hubId, deviceId);
    });

    connection.on('devicesUpdated', (devices) => {
      this.updateDeviceRouting(hubId, devices);
    });
  }

  /**
   * Update device-to-hub routing
   */
  private updateDeviceRouting(hubId: string, devices: Device[]): void {
    for (const device of devices) {
      this.deviceToHub.set(device.id, hubId);
    }
  }

  /**
   * Load settings from Homey storage
   */
  private loadSettings(): void {
    const stored = this.app.homey.settings.get('starlingSettings') as AppSettings | null;
    if (stored) {
      this.settings = { ...DEFAULT_SETTINGS, ...stored };
    }
  }

  /**
   * Save settings to Homey storage
   */
  private saveSettings(): void {
    this.app.homey.settings.set('starlingSettings', this.settings);
  }

  /**
   * Add or update a hub in settings
   */
  private saveHubToSettings(config: HubConfig): void {
    const index = this.settings.hubs.findIndex((h) => h.id === config.id);
    if (index >= 0) {
      this.settings.hubs[index] = config;
    } else {
      this.settings.hubs.push(config);
    }
    this.saveSettings();
  }

  /**
   * Remove a hub from settings
   */
  private removeHubFromSettings(hubId: string): void {
    this.settings.hubs = this.settings.hubs.filter((h) => h.id !== hubId);
    this.saveSettings();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export { HubManager };
