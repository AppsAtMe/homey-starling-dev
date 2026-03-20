/**
 * Smoke/CO Detector Device
 *
 * Represents a Nest Protect or similar smoke/CO detector from Starling Hub.
 * All capabilities are read-only sensors/alarms.
 *
 * Features:
 * - Smoke detection alarm
 * - Carbon monoxide detection alarm
 * - Battery status monitoring (normal/low/very low)
 *
 * Flow triggers fired:
 * - smoke_detected: When smokeDetected changes to true
 * - smoke_cleared: When smokeDetected changes to false
 * - co_detected: When coDetected changes to true
 * - co_cleared: When coDetected changes to false
 * - smoke_co_battery_low: When batteryStatus changes from normal to low/very low
 */

import { StarlingDevice } from '../../lib/drivers';
import { Device, SmokeCODevice } from '../../lib/api/types';

class SmokeCODeviceClass extends StarlingDevice {
  /**
   * Register capability listeners
   * Note: All capabilities are read-only for smoke/CO detectors
   */
  protected registerCapabilityListeners(): void {
    // No writable capabilities - all are read-only sensors
  }

  /**
   * Check if battery status indicates low battery
   */
  private isBatteryLow(status: string): boolean {
    return status === 'low' || status === 'very low';
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const detector = device as SmokeCODevice;

    // Smoke and CO detection triggers (fire on both edges)
    this.triggerOnBothEdges('smokeDetected', detector.smokeDetected, 'smoke_detected', 'smoke_cleared');
    this.triggerOnBothEdges('coDetected', detector.coDetected, 'co_detected', 'co_cleared');

    // Battery low trigger (fire when changing from normal to low)
    if (detector.batteryStatus !== undefined) {
      const oldStatus = this.checkStateChange('batteryStatus', detector.batteryStatus);
      if (oldStatus && oldStatus.oldValue !== undefined) {
        const wasNormal = oldStatus.oldValue === 'normal';
        const isLow = this.isBatteryLow(detector.batteryStatus);
        if (wasNormal && isLow) {
          void this.triggerFlow('smoke_co_battery_low');
        }
      }
      this.updatePreviousState('batteryStatus', detector.batteryStatus);
    }
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const detector = device as SmokeCODevice;

    // Smoke alarm
    if (detector.smokeDetected !== undefined) {
      await this.safeSetCapabilityValue('alarm_smoke', detector.smokeDetected);
    }

    // CO alarm
    if (detector.coDetected !== undefined) {
      await this.safeSetCapabilityValue('alarm_co', detector.coDetected);
    }

    // Battery alarm (true if low or very low)
    if (detector.batteryStatus !== undefined && this.hasCapability('alarm_battery')) {
      const isLow = this.isBatteryLow(detector.batteryStatus);
      await this.safeSetCapabilityValue('alarm_battery', isLow);
    }
  }

}

module.exports = SmokeCODeviceClass;
