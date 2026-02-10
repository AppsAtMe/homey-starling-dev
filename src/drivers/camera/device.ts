/**
 * Camera Device
 *
 * Represents a camera (non-doorbell) from Starling Hub.
 * Extends BaseCameraDevice with camera-specific trigger prefix (no prefix).
 *
 * Features:
 * - Motion detection (alarm_motion)
 * - Person/animal/vehicle detection
 * - Doorbell button (if present on device)
 * - Quiet time toggle
 * - WebRTC live video streaming (2021+ cameras)
 * - Snapshot image for dashboard
 *
 * Flow triggers fired:
 * - person_detected, animal_detected, vehicle_detected
 * - doorbell_pressed, package_delivered, package_retrieved
 */

import { BaseCameraDevice } from '../../lib/drivers';
import { CameraDevice } from '../../lib/api/types';

class CameraDeviceClass extends BaseCameraDevice {
  /**
   * Camera flow triggers have no prefix
   */
  protected getTriggerPrefix(): string {
    return '';
  }

  /**
   * Add doorbell capability only if the camera has a doorbell button
   */
  protected async onInitCamera(device: CameraDevice): Promise<void> {
    if (device.doorbellPushed !== undefined) {
      await this.ensureCapability('alarm_generic');
    }
  }
}

module.exports = CameraDeviceClass;
