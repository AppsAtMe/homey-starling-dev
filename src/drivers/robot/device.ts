/**
 * Robot Vacuum Device
 *
 * Represents a robot vacuum from Starling Hub.
 *
 * Features:
 * - Start/Stop control (onoff)
 * - State monitoring (cleaning, docked, returning, paused, error)
 * - Battery level monitoring
 * - Charging status
 *
 * Flow triggers fired:
 * - started_cleaning: When isOn changes to true
 * - stopped_cleaning: When isOn changes to false
 * - docked: When state changes to 'docked'
 * - undocked: When state changes from 'docked' to something else
 * - battery_low: When battery drops below threshold (20%)
 * - error_occurred: When state changes to 'error'
 */

import { StarlingDevice, BATTERY_LOW_THRESHOLD } from '../../lib/drivers';
import { Device, RobotDevice } from '../../lib/api/types';

class RobotDeviceClass extends StarlingDevice {
  /**
   * Register capability listeners
   */
  protected registerCapabilityListeners(): void {
    // On/Off starts/stops cleaning
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.setPropertyOptimistic('isOn', value, 'onoff');
    });
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const robot = device as RobotDevice;

    // Cleaning state triggers (fire on both edges)
    this.triggerOnBothEdges('isOn', robot.isOn, 'started_cleaning', 'stopped_cleaning');

    // State-based triggers (docked, error)
    if (robot.state !== undefined) {
      const change = this.checkStateChange('state', robot.state);
      if (change && change.oldValue !== undefined) {
        const oldState = change.oldValue as string;
        // Dock triggers
        if (robot.state === 'docked' && oldState !== 'docked') {
          void this.triggerFlow('docked');
        } else if (oldState === 'docked' && robot.state !== 'docked') {
          void this.triggerFlow('undocked');
        }
        // Error trigger
        if (robot.state === 'error' && oldState !== 'error') {
          void this.triggerFlow('error_occurred');
        }
      }
      this.updatePreviousState('state', robot.state);
    }

    // Battery low trigger
    if (robot.batteryLevel !== undefined) {
      const oldLevel = this.checkStateChange('batteryLevel', robot.batteryLevel);
      if (oldLevel && oldLevel.oldValue !== undefined) {
        const wasAbove = oldLevel.oldValue > BATTERY_LOW_THRESHOLD;
        const isBelow = robot.batteryLevel <= BATTERY_LOW_THRESHOLD;
        if (wasAbove && isBelow) {
          void this.triggerFlow('robot_battery_low');
        }
      }
      this.updatePreviousState('batteryLevel', robot.batteryLevel);
    }
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const robot = device as RobotDevice;

    // On/Off state (is actively cleaning)
    await this.safeSetCapabilityValue('onoff', robot.isOn);

    // Battery level
    if (robot.batteryLevel !== undefined && this.hasCapability('measure_battery')) {
      await this.safeSetCapabilityValue('measure_battery', robot.batteryLevel);
    }

    // Vacuum state
    if (robot.state !== undefined && this.hasCapability('vacuum_state')) {
      await this.safeSetCapabilityValue('vacuum_state', robot.state);
    }
  }

  /**
   * Called when the device is initialized
   */
  async onInit(): Promise<void> {
    await this.ensureCapability('measure_battery');
    await super.onInit();
  }
}

module.exports = RobotDeviceClass;
