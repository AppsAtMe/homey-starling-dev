/**
 * Blinds/Shades Device
 *
 * Represents window coverings from Starling Hub.
 *
 * Features:
 * - Position control (windowcoverings_set: 0=closed, 1=open)
 * - State monitoring (open, closed, opening, closing)
 *
 * Note: Starling uses position 0-100 where 100 is fully open.
 * Homey uses windowcoverings_set 0-1 where 1 is fully open.
 *
 * Flow triggers fired:
 * - opened: When position reaches 100
 * - closed: When position reaches 0
 */

import { StarlingDevice } from '../../lib/drivers';
import { Device, OpenCloseDevice } from '../../lib/api/types';

class BlindsDeviceClass extends StarlingDevice {
  /**
   * Register capability listeners
   */
  protected registerCapabilityListeners(): void {
    // Position control
    this.registerCapabilityListener('windowcoverings_set', async (value: number) => {
      // Homey 0-1 → Starling 0-100
      const position = Math.round(value * 100);
      await this.setPropertyOptimistic('position', position, 'windowcoverings_set', value);
    });

    // Up (open fully)
    if (this.hasCapability('windowcoverings_state')) {
      this.registerCapabilityListener('windowcoverings_state', async (value: string) => {
        const position = value === 'up' ? 100 : 0;
        await this.setPropertyOptimistic('position', position, 'windowcoverings_state', value);
      });
    }
  }

  /**
   * Handle state changes and fire flow triggers
   */
  protected handleStateChanges(device: Device): void {
    const blinds = device as OpenCloseDevice;

    // Position triggers - fire when reaching fully open (100) or fully closed (0)
    if (blinds.position !== undefined) {
      const change = this.checkStateChange('position', blinds.position);
      if (change && change.oldValue !== undefined) {
        const oldPos = change.oldValue;
        // Fully opened trigger
        if (blinds.position === 100 && oldPos < 100) {
          void this.triggerFlow('opened');
        }
        // Fully closed trigger
        if (blinds.position === 0 && oldPos > 0) {
          void this.triggerFlow('closed');
        }
      }
      this.updatePreviousState('position', blinds.position);
    }
  }

  /**
   * Map Starling device state to Homey capabilities
   */
  protected async mapStateToCapabilities(device: Device): Promise<void> {
    const blinds = device as OpenCloseDevice;

    // Position
    if (blinds.position !== undefined) {
      // Starling 0-100 → Homey 0-1
      await this.safeSetCapabilityValue('windowcoverings_set', blinds.position / 100);
    }

    // State
    if (blinds.state !== undefined && this.hasCapability('windowcoverings_state')) {
      // Map state to Homey state (up, idle, down)
      let homeyState: string;
      switch (blinds.state) {
        case 'opening':
          homeyState = 'up';
          break;
        case 'closing':
          homeyState = 'down';
          break;
        default:
          homeyState = 'idle';
      }
      await this.safeSetCapabilityValue('windowcoverings_state', homeyState);
    }
  }

}

module.exports = BlindsDeviceClass;
