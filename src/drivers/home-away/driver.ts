/**
 * Home/Away Control Driver
 *
 * Handles home/away status from Starling Hub with:
 * - Home/Away mode control
 * - Presence state for automations
 */

import Homey from 'homey';
import { StarlingDriver } from '../../lib/drivers';
import { DeviceCategory, HomeAwayDevice } from '../../lib/api/types';
import { DeviceStore } from '../../lib/drivers/types';

class HomeAwayDriver extends StarlingDriver {
  /**
   * Get the device category this driver handles
   */
  getDeviceCategory(): DeviceCategory {
    return 'home_away_control';
  }

  /**
   * Called when the driver is initialized
   */
  async onInit(): Promise<void> {
    await super.onInit();
    this.registerConditions();
    this.registerActions();
    this.log('Home/Away driver initialized');
  }

  /**
   * Register condition card handlers
   */
  private registerConditions(): void {
    this.homey.flow.getConditionCard('mode_is').registerRunListener(
      (args: { device: Homey.Device; mode: string }) => {
        const device = this.getStarlingDeviceData<HomeAwayDevice>(args.device);
        return device?.mode === args.mode;
      }
    );
  }

  /**
   * Register action card handlers
   */
  private registerActions(): void {
    this.homey.flow.getActionCard('set_mode').registerRunListener(
      async (args: { device: Homey.Device; mode: string }) => {
        if (args.mode !== 'home' && args.mode !== 'away') {
          throw new Error(this.homey.__('errors.invalid_home_away_mode', { mode: args.mode }));
        }
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        await hubManager.setDeviceProperty(store.starlingId, 'mode', args.mode, store.hubId);
      }
    );
  }
}

module.exports = HomeAwayDriver;
