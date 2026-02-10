/**
 * Valve Device
 *
 * Represents a water valve from Starling Hub.
 *
 * Features:
 * - Open/Close control (onoff: true = open, false = closed)
 *
 * Flow triggers fired:
 * - valve_opened: When isOn changes to true
 * - valve_closed: When isOn changes to false
 */

import { StarlingDevice } from '../../lib/drivers';
import { Device, ValveDevice } from '../../lib/api/types';

class ValveDeviceClass extends StarlingDevice {
  /**
   * Register capability listeners
   */
  protected registerCapabilityListeners(): void {
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      // When manually closing, cancel any pending auto-close timer
      if (!value) {
        const store = this.getStore() as { starlingId: string };
        const driver = this.driver as unknown as { clearAutoCloseTimer?(id: string): void };
        driver.clearAutoCloseTimer?.(store.starlingId);
      }
      await this.setPropertyOptimistic('isOn', value, 'onoff');
    });
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const valve = device as ValveDevice;
    this.triggerOnBothEdges('isOn', valve.isOn, 'valve_opened', 'valve_closed');
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const valve = device as ValveDevice;
    await this.safeSetCapabilityValue('onoff', valve.isOn);
  }
}

module.exports = ValveDeviceClass;
