/**
 * Doorbell Driver
 *
 * Handles doorbell cameras from Starling Hub.
 * Filters to only show devices with doorbell capability (doorbellPushed property).
 *
 * Uses Homey's native 'doorbell' class for doorbell-specific UI treatment.
 *
 * Flow cards:
 * - Triggers: person_detected, animal_detected, vehicle_detected, doorbell_pressed, package_delivered, package_retrieved
 * - Conditions: is_motion_detected, is_person_detected, quiet_time_is_enabled
 * - Actions: enable_quiet_time, disable_quiet_time
 */

import Homey from 'homey';
import { StarlingDriver, StarlingPairingDevice } from '../../lib/drivers';
import { DeviceCategory, CameraDevice } from '../../lib/api/types';
import { DeviceStore } from '../../lib/drivers/types';

class DoorbellDriver extends StarlingDriver {
  /**
   * Get the device category this driver handles
   */
  getDeviceCategory(): DeviceCategory {
    return 'cam';
  }

  /**
   * Override pairing to filter for doorbells only
   *
   * Doorbells are identified by having the doorbellPushed property defined
   * (even if false, it means the device has a doorbell button).
   */
  async onPairListDevices(): Promise<StarlingPairingDevice[]> {
    // Get all cameras from base class
    const allCameras = await super.onPairListDevices();

    // Get hub manager to access device data
    const hubManager = this.getHubManager();

    // Filter to only doorbells
    // Note: Starling API doesn't have a persistent "isDoorbell" property.
    // doorbellPushed only appears during press events, not as a static property.
    // We detect doorbells by checking if the model name contains "doorbell".
    const doorbells = allCameras.filter((pairingDevice) => {
      const connection = hubManager.getHub(pairingDevice.store.hubId);
      if (!connection) return false;

      const device = connection.getCachedDevice(pairingDevice.store.starlingId) as CameraDevice | undefined;
      if (!device) return false;

      // Check if model contains "doorbell" (case-insensitive)
      const isDoorbell = device.model?.toLowerCase().includes('doorbell') ?? false;

      this.log(`[Pairing] Device "${device.name}" (${device.model}): isDoorbell=${isDoorbell}`);

      return isDoorbell;
    });

    this.log(`[Pairing] Found ${doorbells.length} doorbells out of ${allCameras.length} cameras`);

    return doorbells;
  }

  /**
   * Called when the driver is initialized
   */
  async onInit(): Promise<void> {
    await super.onInit();

    // Register flow card handlers (shared with camera driver)
    this.registerConditions();
    this.registerActions();

    this.log('Doorbell driver initialized');
  }

  /**
   * Register condition card handlers
   */
  private registerConditions(): void {
    // Motion detected condition
    this.homey.flow.getConditionCard('doorbell_is_motion_detected').registerRunListener(
      (args: { device: Homey.Device }) => {
        const camera = this.getStarlingDeviceData<CameraDevice>(args.device);
        return camera?.motionDetected ?? false;
      }
    );

    // Person detected condition
    this.homey.flow.getConditionCard('doorbell_is_person_detected').registerRunListener(
      (args: { device: Homey.Device }) => {
        const camera = this.getStarlingDeviceData<CameraDevice>(args.device);
        return camera?.personDetected ?? false;
      }
    );

    // Quiet time enabled condition
    this.homey.flow.getConditionCard('doorbell_quiet_time_is_enabled').registerRunListener(
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
    this.homey.flow.getActionCard('doorbell_enable_quiet_time').registerRunListener(
      async (args: { device: Homey.Device }) => {
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        await hubManager.setDeviceProperty(store.starlingId, 'quietTime', true, store.hubId);
      }
    );

    // Disable quiet time
    this.homey.flow.getActionCard('doorbell_disable_quiet_time').registerRunListener(
      async (args: { device: Homey.Device }) => {
        const store = args.device.getStore() as Pick<DeviceStore, 'starlingId' | 'hubId'>;
        const hubManager = this.getHubManager();
        await hubManager.setDeviceProperty(store.starlingId, 'quietTime', false, store.hubId);
      }
    );
  }
}

module.exports = DoorbellDriver;
