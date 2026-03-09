/**
 * StarlingDevice - Base class for all Starling device instances
 *
 * Provides shared functionality for:
 * - HubManager integration
 * - State synchronization
 * - Optimistic updates with rollback
 * - Capability registration
 * - Device availability management
 */

import Homey from 'homey';
import { HubManager, HubConnection, DeviceStateChange } from '../../lib/hub';
import { Device } from '../../lib/api/types';
import { DeviceStore, StarlingApp } from './types';

/**
 * Pending optimistic update
 */
interface PendingUpdate {
  capability: string;
  expectedPropertyValue: unknown;
  expectedCapabilityValue: unknown;
  previousValue: unknown;
  timestamp: number;
  timeoutId?: NodeJS.Timeout;
}

/**
 * State change info for flow triggers
 */
export interface StateChange<T = unknown> {
  property: string;
  oldValue: T | undefined;
  newValue: T;
}

/**
 * Flow trigger tokens
 */
export type FlowTokens = Record<string, string | number | boolean>;

/**
 * Abstract base class for Starling devices
 */
abstract class StarlingDevice extends Homey.Device {
  protected hubManager!: HubManager;
  protected hubConnection?: HubConnection;
  protected starlingId!: string;
  protected hubId!: string;

  // Track pending optimistic updates for rollback
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private readonly UPDATE_TIMEOUT_MS = 15000; // 15 seconds to verify update

  // Track previous device state for flow triggers
  private previousState: Map<string, unknown> = new Map();

  // Store event handler references for proper cleanup
  private boundOnDeviceStateChange = this.onDeviceStateChange.bind(this);
  private boundOnHubOffline = this.onHubOffline.bind(this);
  private boundOnHubOnline = this.onHubOnline.bind(this);

  /**
   * Called when the device is initialized
   */
  async onInit(): Promise<void> {
    // Get stored identifiers
    const store = this.getStore() as DeviceStore;
    this.starlingId = store.starlingId;
    this.hubId = store.hubId;

    // Get HubManager from app
    const app = this.homey.app as unknown as { getHubManager(): HubManager };
    this.hubManager = app.getHubManager();

    // Get hub connection
    this.hubConnection = this.hubManager.getHub(this.hubId);

    if (!this.hubConnection) {
      void this.setUnavailable(this.homey.__('errors.hub_not_found'));
      return;
    }

    // Subscribe to device state changes
    this.hubManager.on('deviceStateChange', this.boundOnDeviceStateChange);
    this.hubManager.on('hubOffline', this.boundOnHubOffline);
    this.hubManager.on('hubOnline', this.boundOnHubOnline);

    // Register capability listeners
    await this.registerCapabilityListeners();

    // Initial state sync
    await this.syncDeviceState();

    this.log(`${this.getName()} initialized`);
  }

  /**
   * Called when the device is deleted
   */
  onDeleted(): void {
    // Clean up event listeners
    this.hubManager.removeListener('deviceStateChange', this.boundOnDeviceStateChange);
    this.hubManager.removeListener('hubOffline', this.boundOnHubOffline);
    this.hubManager.removeListener('hubOnline', this.boundOnHubOnline);

    this.clearPendingUpdates();

    this.log(`${this.getName()} deleted`);
  }

  /**
   * Register capability listeners - override in subclasses
   */
  protected abstract registerCapabilityListeners(): void | Promise<void>;

  /**
   * Map Starling device state to Homey capabilities - override in subclasses
   */
  protected abstract mapStateToCapabilities(device: Device): Promise<void>;

  /**
   * Get the current Starling device data
   */
  protected getStarlingDevice(): Device | undefined {
    return this.hubConnection?.getCachedDevice(this.starlingId);
  }

  /**
   * Sync device state from Starling to Homey capabilities
   */
  protected async syncDeviceState(): Promise<void> {
    const device = this.getStarlingDevice();

    if (!device) {
      void this.setUnavailable(this.homey.__('errors.device_not_found'));
      return;
    }

    if (!device.isOnline) {
      void this.setUnavailable(this.homey.__('errors.device_offline'));
      return;
    }

    // Device is online
    if (!this.getAvailable()) {
      void this.setAvailable();
    }

    // Check for state changes and fire flow triggers
    this.handleStateChanges(device);

    // Map state to capabilities
    await this.mapStateToCapabilities(device);
  }

  /**
   * Handle device state change events from HubManager
   */
  private onDeviceStateChange(change: DeviceStateChange): void {
    // Only handle changes for this device
    if (change.device.id !== this.starlingId || change.hubId !== this.hubId) {
      return;
    }

    // Process state change asynchronously
    void this.processStateChange(change);
  }

  /**
   * Process device state changes
   */
  private async processStateChange(change: DeviceStateChange): Promise<void> {
    try {
      // Check for pending optimistic updates
      for (const propChange of change.changes) {
        const pending = this.pendingUpdates.get(propChange.property);
        if (pending) {
          // Use loose equality to handle string/number mismatches from API responses
          // eslint-disable-next-line eqeqeq
          if (propChange.newValue == pending.expectedPropertyValue) {
            // Update confirmed, clear pending
            if (pending.timeoutId) {
              clearTimeout(pending.timeoutId);
            }
            this.pendingUpdates.delete(propChange.property);
            this.log(`Update confirmed for ${propChange.property}`);
          }
        }
      }

      // Sync state
      await this.syncDeviceState();
    } catch (error) {
      this.error(`Failed to process state change for ${this.getName()}:`, error);
    }
  }

  /**
   * Handle hub going offline
   */
  private onHubOffline(hubId: string): void {
    if (hubId === this.hubId) {
      void this.setUnavailable(this.homey.__('errors.hub_offline'));
    }
  }

  /**
   * Handle hub coming back online
   */
  private onHubOnline(hubId: string): void {
    if (hubId === this.hubId) {
      void this.syncDeviceState();
    }
  }

  /**
   * Set a property on the Starling device with optimistic update
   *
   * @param property - Starling property name
   * @param value - New value
   * @param capability - Homey capability to update
   * @param expectedValue - Expected capability value after update
   */
  protected async setPropertyOptimistic(
    property: string,
    value: unknown,
    capability: string,
    expectedValue?: unknown
  ): Promise<void> {
    if (!this.hubConnection) {
      throw new Error(this.homey.__('errors.hub_not_connected'));
    }

    const existing = this.pendingUpdates.get(property);
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId);
    }

    const previousValue: unknown = this.getCapabilityValue(capability);
    const targetValue: unknown = expectedValue !== undefined ? expectedValue : value;

    const timeoutId = setTimeout(() => {
      const pending = this.pendingUpdates.get(property);
      if (!pending) return;

      this.pendingUpdates.delete(property);
      this.log(`Update timed out for ${property}, refreshing state`);
      void this.syncDeviceState();
    }, this.UPDATE_TIMEOUT_MS);

    // Store pending update
    this.pendingUpdates.set(property, {
      capability,
      expectedPropertyValue: value,
      expectedCapabilityValue: targetValue,
      previousValue,
      timestamp: Date.now(),
      timeoutId,
    });

    // Optimistically update UI
    await this.setCapabilityValue(capability, targetValue);

    try {
      // Send to Starling
      await this.hubManager.setDeviceProperty(this.starlingId, property, value, this.hubId);
      this.log(`Set ${property} = ${String(value)}`);
    } catch (error) {
      // Rollback on error
      const pending = this.pendingUpdates.get(property);
      if (pending?.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      this.pendingUpdates.delete(property);
      await this.rollbackCapability(capability, previousValue);

      // Fire the command_failed flow trigger
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const app = this.homey.app as unknown as StarlingApp;
      app.triggerCommandFailed(this.getName(), property, errorMessage);

      throw error;
    }
  }

  /**
   * Rollback a capability to a previous value
   */
  private async rollbackCapability(
    capability: string,
    value: unknown
  ): Promise<void> {
    try {
      await this.setCapabilityValue(capability, value);
      this.homey.notifications
        .createNotification({
          excerpt: this.homey.__('errors.command_failed', { device: this.getName() }),
        })
        .catch((notifError: Error) => {
          this.error('Failed to notify user about command rollback:', notifError);
        });
    } catch (error) {
      this.error(`Failed to rollback ${capability}:`, error);
    }
  }

  /**
   * Safe capability value setter with type checking
   */
  protected async safeSetCapabilityValue(
    capability: string,
    value: unknown
  ): Promise<void> {
    if (this.hasCapability(capability)) {
      const currentValue: unknown = this.getCapabilityValue(capability);
      if (currentValue !== value) {
        await this.setCapabilityValue(capability, value);
      }
    }
  }

  /**
   * Add capabilities dynamically if not already present
   */
  protected async ensureCapability(capability: string): Promise<void> {
    if (!this.hasCapability(capability)) {
      await this.addCapability(capability);
    }
  }

  /**
   * Remove capabilities dynamically if present
   */
  protected async removeCapabilityIfPresent(capability: string): Promise<void> {
    if (this.hasCapability(capability)) {
      await this.removeCapability(capability);
    }
  }

  // ============================================================
  // Flow Trigger Helpers
  // ============================================================

  /**
   * Fire a device flow trigger
   *
   * @param triggerId - The flow trigger ID (from driver.flow.compose.json)
   * @param tokens - Token values to pass to the flow
   */
  protected async triggerFlow(
    triggerId: string,
    tokens: FlowTokens = {}
  ): Promise<void> {
    try {
      const triggerCard = this.homey.flow.getDeviceTriggerCard(triggerId);
      await triggerCard.trigger(this, tokens);
      this.log(`Flow triggered: ${triggerId}`, tokens);
    } catch (error) {
      this.error(`Failed to trigger flow ${triggerId}:`, error);
    }
  }

  /**
   * Check if a property value has changed from previous state
   *
   * @param property - Property name to check
   * @param newValue - New property value
   * @returns StateChange object if changed, undefined if not
   */
  protected checkStateChange<T>(
    property: string,
    newValue: T
  ): StateChange<T> | undefined {
    const oldValue = this.previousState.get(property) as T | undefined;

    if (oldValue !== newValue) {
      return { property, oldValue, newValue };
    }

    return undefined;
  }

  /**
   * Update previous state tracking for a property
   *
   * @param property - Property name
   * @param value - Current value
   */
  protected updatePreviousState(property: string, value: unknown): void {
    this.previousState.set(property, value);
  }

  /**
   * Trigger a flow on rising edge (false -> true) of a boolean property
   *
   * @param property - Property name to check
   * @param value - Current boolean value (undefined values are ignored)
   * @param triggerId - Flow trigger ID to fire on rising edge
   * @param tokens - Optional tokens to pass to the flow
   */
  protected triggerOnRisingEdge(
    property: string,
    value: boolean | undefined,
    triggerId: string,
    tokens: FlowTokens = {}
  ): void {
    if (value === undefined) return;
    const change = this.checkStateChange(property, value);
    if (change && change.newValue === true) {
      void this.triggerFlow(triggerId, tokens);
    }
    this.updatePreviousState(property, value);
  }

  /**
   * Trigger flows on both edges of a boolean property
   *
   * @param property - Property name to check
   * @param value - Current boolean value (undefined values are ignored)
   * @param triggerIdTrue - Flow trigger ID when value becomes true
   * @param triggerIdFalse - Flow trigger ID when value becomes false
   * @param tokens - Optional tokens to pass to the flow
   */
  protected triggerOnBothEdges(
    property: string,
    value: boolean | undefined,
    triggerIdTrue: string,
    triggerIdFalse: string,
    tokens: FlowTokens = {}
  ): void {
    if (value === undefined) return;
    const change = this.checkStateChange(property, value);
    if (change) {
      void this.triggerFlow(value ? triggerIdTrue : triggerIdFalse, tokens);
    }
    this.updatePreviousState(property, value);
  }

  /**
   * Handle state changes and fire appropriate flow triggers.
   * Override in subclasses to implement device-specific flow trigger logic.
   * Use triggerOnRisingEdge, triggerOnBothEdges, and updatePreviousState
   * to track individual properties.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleStateChanges(_device: Device): void {
    // No-op: subclasses override to fire specific triggers
  }

  /**
   * Clear all pending optimistic updates and timers
   */
  private clearPendingUpdates(): void {
    for (const pending of this.pendingUpdates.values()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
    }
    this.pendingUpdates.clear();
  }
}

export { StarlingDevice };
