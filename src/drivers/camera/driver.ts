/**
 * Camera Driver
 *
 * Handles cameras (non-doorbell) from Starling Hub with:
 * - Motion detection alarm
 * - Person/animal/vehicle detection
 * - Quiet time toggle
 *
 * Note: Doorbell cameras are handled by the separate Doorbell driver.
 * This driver filters out devices with doorbell capability.
 *
 * Flow cards:
 * - Triggers: person_detected, animal_detected, vehicle_detected, package_delivered, package_retrieved
 * - Conditions: is_motion_detected, is_person_detected, quiet_time_is_enabled
 * - Actions: enable_quiet_time, disable_quiet_time
 */

import Homey from 'homey';
import { StarlingDriver, StarlingPairingDevice } from '../../lib/drivers';
import { DeviceCategory, CameraDevice } from '../../lib/api/types';
import { DeviceStore } from '../../lib/drivers/types';

class CameraDriver extends StarlingDriver {
  /**
   * Get the device category this driver handles
   */
  getDeviceCategory(): DeviceCategory {
    return 'cam';
  }

  /**
   * Override pairing to filter out doorbells
   *
   * Doorbells are identified by model name containing "doorbell".
   * This driver only shows cameras without doorbell in the model name.
   */
  async onPairListDevices(): Promise<StarlingPairingDevice[]> {
    // Get all cameras from base class
    const allCameras = await super.onPairListDevices();

    // Get hub manager to access device data
    const hubManager = this.getHubManager();

    // Filter to only non-doorbell cameras
    const cameras = allCameras.filter((pairingDevice) => {
      const connection = hubManager.getHub(pairingDevice.store.hubId);
      if (!connection) return false;

      const device = connection.getCachedDevice(pairingDevice.store.starlingId) as CameraDevice | undefined;
      if (!device) return false;

      // A camera does NOT have "doorbell" in its model name
      const isDoorbell = device.model?.toLowerCase().includes('doorbell') ?? false;
      return !isDoorbell;
    });

    this.log(`[Pairing] Found ${cameras.length} cameras (excluded ${allCameras.length - cameras.length} doorbells)`);

    return cameras;
  }

  /**
   * Called when the driver is initialized
   */
  async onInit(): Promise<void> {
    await super.onInit();

    // Register flow card handlers
    this.registerConditions();
    this.registerActions();

    this.log('Camera driver initialized');
  }

  /**
   * Register condition card handlers
   */
  private registerConditions(): void {
    // Motion detected condition
    this.homey.flow.getConditionCard('is_motion_detected').registerRunListener(
      (args: { device: Homey.Device }) => {
        const camera = this.getStarlingDeviceData<CameraDevice>(args.device);
        return camera?.motionDetected ?? false;
      }
    );

    // Person detected condition
    this.homey.flow.getConditionCard('is_person_detected').registerRunListener(
      (args: { device: Homey.Device }) => {
        const camera = this.getStarlingDeviceData<CameraDevice>(args.device);
        return camera?.personDetected ?? false;
      }
    );

    // Quiet time enabled condition
    this.homey.flow.getConditionCard('quiet_time_is_enabled').registerRunListener(
      (args: { device: Homey.Device }) => {
        const camera = this.getStarlingDeviceData<CameraDevice>(args.device);
        return camera?.quietTime ?? false;
      }
    );
  }

  /**
   * Register action card handlers
   */
  private registerActions(): void {
    // Enable quiet time
    this.homey.flow.getActionCard('enable_quiet_time').registerRunListener(
      async (args: { device: Homey.Device }) => {
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        await hubManager.setDeviceProperty(store.starlingId, 'quietTime', true, store.hubId);
      }
    );

    // Disable quiet time
    this.homey.flow.getActionCard('disable_quiet_time').registerRunListener(
      async (args: { device: Homey.Device }) => {
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        await hubManager.setDeviceProperty(store.starlingId, 'quietTime', false, store.hubId);
      }
    );
  }
}

module.exports = CameraDriver;
