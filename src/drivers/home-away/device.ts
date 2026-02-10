/**
 * Home/Away Device
 *
 * Represents the home/away state for a Nest structure.
 *
 * Features:
 * - Home/Away toggle (onoff: true = home, false = away)
 *
 * This is a virtual device that controls the Nest ecosystem's
 * home/away state, affecting all devices in the structure.
 */

import { StarlingDevice } from '../../lib/drivers';
import { StarlingApp } from '../../lib/drivers/types';
import { Device, HomeAwayDevice } from '../../lib/api/types';

class HomeAwayDeviceClass extends StarlingDevice {
  /**
   * Register capability listeners
   */
  protected registerCapabilityListeners(): void {
    // Home/Away toggle
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      const mode = value ? 'home' : 'away';
      await this.setPropertyOptimistic('mode', mode, 'onoff', value);
    });

    // Home/Away mode enum
    if (this.hasCapability('home_away_mode')) {
      this.registerCapabilityListener('home_away_mode', async (value: string) => {
        if (value !== 'home' && value !== 'away') {
          throw new Error(this.homey.__('errors.invalid_home_away_mode', { mode: value }));
        }
        await this.setPropertyOptimistic('mode', value, 'home_away_mode', value);
      });
    }
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const homeAway = device as HomeAwayDevice;

    // Mode to onoff (home = true, away = false)
    if (homeAway.mode !== undefined) {
      await this.safeSetCapabilityValue('onoff', homeAway.mode === 'home');
    }

    // Mode to enum capability (home/away)
    if (homeAway.mode !== undefined && this.hasCapability('home_away_mode')) {
      await this.safeSetCapabilityValue('home_away_mode', homeAway.mode);
    }
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const homeAway = device as HomeAwayDevice;

    // Check if mode has changed
    if (homeAway.mode !== undefined) {
      const change = this.checkStateChange('mode', homeAway.mode);
      if (change && change.oldValue !== undefined) {
        // Fire the home_away_changed trigger via the app
        const app = this.homey.app as unknown as StarlingApp;
        app.triggerHomeAwayChanged(homeAway.mode);
        this.log(`Home/Away mode changed: ${String(change.oldValue)} → ${change.newValue}`);

        // Fire device flow triggers
        if (homeAway.mode === 'home') {
          void this.triggerFlow('changed_to_home');
        } else if (homeAway.mode === 'away') {
          void this.triggerFlow('changed_to_away');
        }
      }
      this.updatePreviousState('mode', homeAway.mode);
    }
  }
}

module.exports = HomeAwayDeviceClass;
