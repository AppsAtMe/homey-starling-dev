/**
 * Thermostat Driver
 *
 * Handles thermostats from Starling Hub with:
 * - Temperature control (target and current)
 * - HVAC mode control (off, heat, cool, auto)
 * - Humidity monitoring (optional)
 * - Eco mode (optional)
 *
 * Flow cards:
 * - Triggers: hvac_state_changed, hvac_mode_changed, eco_mode_changed
 * - Conditions: is_heating, is_cooling, eco_mode_is_enabled
 * - Actions: set_eco_mode
 */

import Homey from 'homey';
import { StarlingDriver } from '../../lib/drivers';
import { DeviceCategory, ThermostatDevice } from '../../lib/api/types';
import { DeviceStore } from '../../lib/drivers/types';

class ThermostatDriver extends StarlingDriver {
  /**
   * Get the device category this driver handles
   */
  getDeviceCategory(): DeviceCategory {
    return 'thermostat';
  }

  /**
   * Called when the driver is initialized
   */
  async onInit(): Promise<void> {
    await super.onInit();

    // Register flow card handlers
    this.registerConditions();
    this.registerActions();

    this.log('Thermostat driver initialized');
  }

  /**
   * Register condition card handlers
   */
  private registerConditions(): void {
    // Is heating condition
    this.homey.flow.getConditionCard('is_heating').registerRunListener(
      (args: { device: Homey.Device }) => {
        const thermostat = this.getStarlingDeviceData<ThermostatDevice>(args.device);
        return thermostat?.hvacState === 'heating';
      }
    );

    // Is cooling condition
    this.homey.flow.getConditionCard('is_cooling').registerRunListener(
      (args: { device: Homey.Device }) => {
        const thermostat = this.getStarlingDeviceData<ThermostatDevice>(args.device);
        return thermostat?.hvacState === 'cooling';
      }
    );

    // Eco mode enabled condition
    this.homey.flow.getConditionCard('eco_mode_is_enabled').registerRunListener(
      (args: { device: Homey.Device }) => {
        const thermostat = this.getStarlingDeviceData<ThermostatDevice>(args.device);
        return thermostat?.ecoMode ?? false;
      }
    );
  }

  /**
   * Register action card handlers
   */
  private registerActions(): void {
    // Set eco mode
    this.homey.flow.getActionCard('set_eco_mode').registerRunListener(
      async (args: { device: Homey.Device; enabled: string }) => {
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        const enabled = args.enabled === 'true';
        await hubManager.setDeviceProperty(store.starlingId, 'ecoMode', enabled, store.hubId);
      }
    );
  }
}

module.exports = ThermostatDriver;
