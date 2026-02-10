/**
 * Shared types for Starling device drivers
 */

import { DeviceCategory } from '../api/types';

/**
 * Stored device data persisted in the Homey device store
 */
export interface DeviceStore {
  starlingId: string;
  hubId: string;
  category: DeviceCategory;
  model: string;
  roomName: string;
  structureName: string;
}

/**
 * App interface for accessing app-level trigger methods from device classes
 */
export interface StarlingApp {
  triggerCommandFailed(deviceName: string, command: string, error: string): void;
  triggerHomeAwayChanged(mode: string): void;
  triggerFaceDetected(personName: string, cameraId: string, cameraName: string): void;
}

/**
 * Battery low threshold for smoke/CO detectors and robot vacuums
 */
export const BATTERY_LOW_THRESHOLD = 20;
