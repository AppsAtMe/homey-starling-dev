/**
 * Valve Driver
 *
 * Handles water valves from Starling Hub with:
 * - Open/Close control
 *
 * Flow cards:
 * - Triggers: valve_opened, valve_closed
 * - Actions: open_for_duration
 */

import Homey from 'homey';
import { StarlingDriver } from '../../lib/drivers';
import { DeviceCategory } from '../../lib/api/types';

class ValveDriver extends StarlingDriver {
  private readonly autoCloseTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Get the device category this driver handles
   */
  getDeviceCategory(): DeviceCategory {
    return 'valve';
  }

  /**
   * Called when the driver is initialized
   */
  async onInit(): Promise<void> {
    await super.onInit();

    // Register flow card handlers
    this.registerActions();

    this.log('Valve driver initialized');
  }

  async onUninit(): Promise<void> {
    for (const timer of this.autoCloseTimers.values()) {
      clearTimeout(timer);
    }
    this.autoCloseTimers.clear();
  }

  /**
   * Cancel any pending auto-close timer for a device
   */
  clearAutoCloseTimer(starlingId: string): void {
    const existing = this.autoCloseTimers.get(starlingId);
    if (existing) {
      clearTimeout(existing);
      this.autoCloseTimers.delete(starlingId);
    }
  }

  /**
   * Register action card handlers
   */
  private registerActions(): void {
    // Open for duration
    this.homey.flow.getActionCard('open_for_duration').registerRunListener(
      async (args: { device: Homey.Device; duration: number }) => {
        const store = args.device.getStore() as { starlingId: string };
        const hubManager = this.getHubManager();

        // Cancel any existing auto-close timer for this valve
        this.clearAutoCloseTimer(store.starlingId);

        // Open the valve
        await hubManager.setDeviceProperty(store.starlingId, 'isOn', true);

        // Schedule auto-close after duration (minutes to ms)
        const durationMs = args.duration * 60 * 1000;
        const timer = setTimeout(() => {
          this.autoCloseTimers.delete(store.starlingId);
          hubManager.setDeviceProperty(store.starlingId, 'isOn', false).catch((error: unknown) => {
            this.error('Failed to auto-close valve:', error);
          });
        }, durationMs);

        this.autoCloseTimers.set(store.starlingId, timer);
      }
    );
  }
}

module.exports = ValveDriver;
