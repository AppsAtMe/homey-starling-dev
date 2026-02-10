/**
 * Smoke/CO Detector Device
 *
 * Represents a Nest Protect or similar smoke/CO detector from Starling Hub.
 * All capabilities are read-only sensors/alarms.
 *
 * Features:
 * - Smoke detection alarm
 * - Carbon monoxide detection alarm
 * - Battery level monitoring
 *
 * Flow triggers fired:
 * - smoke_detected: When smokeDetected changes to true
 * - smoke_cleared: When smokeDetected changes to false
 * - co_detected: When coDetected changes to true
 * - co_cleared: When coDetected changes to false
 * - battery_low: When battery drops below threshold (20%)
 */

import { StarlingDevice, BATTERY_LOW_THRESHOLD } from '../../lib/drivers';
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
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const detector = device as SmokeCODevice;

    // Smoke and CO detection triggers (fire on both edges)
    this.triggerOnBothEdges('smokeDetected', detector.smokeDetected, 'smoke_detected', 'smoke_cleared');
    this.triggerOnBothEdges('coDetected', detector.coDetected, 'co_detected', 'co_cleared');

    // Battery low trigger (fire when crossing threshold downward)
    if (detector.batteryLevel !== undefined) {
      const oldLevel = this.checkStateChange('batteryLevel', detector.batteryLevel);
      if (oldLevel && oldLevel.oldValue !== undefined) {
        const wasAbove = oldLevel.oldValue > BATTERY_LOW_THRESHOLD;
        const isBelow = detector.batteryLevel <= BATTERY_LOW_THRESHOLD;
        if (wasAbove && isBelow) {
          void this.triggerFlow('smoke_co_battery_low');
        }
      }
      this.updatePreviousState('batteryLevel', detector.batteryLevel);
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

    // Battery level (0-100)
    if (detector.batteryLevel !== undefined && this.hasCapability('measure_battery')) {
      await this.safeSetCapabilityValue('measure_battery', detector.batteryLevel);
    }
  }

}

module.exports = SmokeCODeviceClass;
