/**
 * Doorbell Device
 *
 * Represents a doorbell camera from Starling Hub.
 * Extends BaseCameraDevice with doorbell-specific trigger prefix ('doorbell_').
 *
 * Features:
 * - Motion detection (alarm_motion)
 * - Person/animal/vehicle detection
 * - Doorbell button press (alarm_generic) - always present
 * - Quiet time toggle
 * - WebRTC live video streaming
 * - Snapshot image for dashboard
 *
 * Flow triggers fired (all prefixed with 'doorbell_'):
 * - doorbell_person_detected, doorbell_animal_detected, doorbell_vehicle_detected
 * - doorbell_pressed, doorbell_package_delivered, doorbell_package_retrieved
 */

import { BaseCameraDevice } from '../../lib/drivers';
import { CameraDevice } from '../../lib/api/types';

class DoorbellDeviceClass extends BaseCameraDevice {
  /**
   * Doorbell flow triggers are prefixed with 'doorbell_'
   */
  protected getTriggerPrefix(): string {
    return 'doorbell_';
  }

  /**
   * Doorbells always have the doorbell button capability
   */
  protected async onInitCamera(_device: CameraDevice): Promise<void> {
    await this.ensureCapability('alarm_generic');
  }
}

module.exports = DoorbellDeviceClass;
