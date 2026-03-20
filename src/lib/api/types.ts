/**
 * Starling Developer Connect API v2 Types
 * Reference: https://sidewinder.starlinghome.io/sdc2/
 */

// API Status Response
export interface StatusResponse {
  status: 'OK' | 'Error';
  apiReady: boolean;
  apiVersion: string;
  connectedToGoogleHome: boolean;
  permissions: {
    read: boolean;
    write: boolean;
    camera: boolean;
  };
}

// Device Categories (all 23 types)
export type DeviceCategory =
  | 'cam'
  | 'diffuser'
  | 'fan'
  | 'garage'
  | 'heater_cooler'
  | 'home_away_control'
  | 'humidifier_dehumidifier'
  | 'kettle'
  | 'light'
  | 'lock'
  | 'open_close'
  | 'outlet'
  | 'purifier'
  | 'robot'
  | 'sensor'
  | 'smoke_co_detector'
  | 'switch'
  | 'thermostat'
  | 'valve';

// Base device properties (common to all devices)
export interface BaseDevice {
  id: string;
  name: string;
  model: string;
  category: DeviceCategory;
  roomName: string;
  structureName: string;
  isOnline: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
}

// Thermostat-specific properties
export interface ThermostatDevice extends BaseDevice {
  category: 'thermostat';
  currentTemperature: number;
  targetTemperature: number;
  hvacMode: 'off' | 'heat' | 'cool' | 'heatCool';
  hvacState: 'off' | 'heating' | 'cooling';
  humidityPercent?: number;
  targetHumidity?: number;
  canHeat: boolean;
  canCool: boolean;
  canHeatCool: boolean;
  ecoMode?: boolean;
  presets?: string[];
  presetsAvailable?: string;
  presetSelected?: string;
  temperatureSensors?: string[];
  activeTemperatureSensor?: string;
}

// Camera-specific properties
export interface CameraDevice extends BaseDevice {
  category: 'cam';
  // Detection states (may be undefined if not currently detecting)
  motionDetected?: boolean;
  personDetected?: boolean;
  animalDetected?: boolean;
  vehicleDetected?: boolean;
  doorbellPushed?: boolean;
  packageDelivered?: boolean;
  packageRetrieved?: boolean;
  faceDetected?: Record<string, boolean>; // faceDetected:PersonName
  quietTime?: boolean;
  cameraEnabled?: boolean;
  // Streaming capabilities
  supportsWebRtcStreaming?: boolean;
  rtspStreamingEnabled?: boolean;
  supportsTalkback?: boolean;
  // Legacy property name (for backwards compatibility)
  supportsStreaming?: boolean;
}

// Light-specific properties
export interface LightDevice extends BaseDevice {
  category: 'light';
  isOn: boolean;
  brightness?: number; // 0-100
  hue?: number; // 0-360
  saturation?: number; // 0-100
  colorTemperature?: number; // mired
  supportsColor: boolean;
  supportsColorTemperature: boolean;
}

// Lock-specific properties
export interface LockDevice extends BaseDevice {
  category: 'lock';
  targetLockState: 'locked' | 'unlocked';
  currentState: 'locked' | 'unlocked' | 'jammed';
}

// Garage-specific properties
export interface GarageDevice extends BaseDevice {
  category: 'garage';
  doorState: 'open' | 'closed' | 'opening' | 'closing';
  obstructionDetected: boolean;
}

// Smoke/CO detector properties
export interface SmokeCODevice extends BaseDevice {
  category: 'smoke_co_detector';
  smokeDetected: boolean;
  coDetected: boolean;
  batteryStatus: 'normal' | 'low' | 'very low' | 'unknown';
}

// Sensor properties (multi-type)
export interface SensorDevice extends BaseDevice {
  category: 'sensor';
  sensorType: 'temperature' | 'humidity' | 'motion' | 'water' | 'air_quality';
  temperature?: number;
  humidity?: number;
  motionDetected?: boolean;
  waterDetected?: boolean;
  co2Level?: number;
  pm25Level?: number;
}

// Robot vacuum properties
export interface RobotDevice extends BaseDevice {
  category: 'robot';
  isOn: boolean;
  state: 'cleaning' | 'docked' | 'returning' | 'paused' | 'error';
  batteryLevel: number;
  isCharging: boolean;
}

// Simple on/off devices
export interface SwitchDevice extends BaseDevice {
  category: 'switch';
  isOn: boolean;
}

export interface OutletDevice extends BaseDevice {
  category: 'outlet';
  isOn: boolean;
  power?: number;
}

export interface FanDevice extends BaseDevice {
  category: 'fan';
  isOn: boolean;
  speed?: number; // 0-100
}

export interface DiffuserDevice extends BaseDevice {
  category: 'diffuser';
  isOn: boolean;
  intensity?: number; // 0-100
}

export interface ValveDevice extends BaseDevice {
  category: 'valve';
  isOn: boolean;
  supportsDuration: boolean;
}

export interface KettleDevice extends BaseDevice {
  category: 'kettle';
  isOn: boolean;
  currentTemperature?: number;
  targetTemperature?: number;
}

export interface HeaterCoolerDevice extends BaseDevice {
  category: 'heater_cooler';
  isOn: boolean;
  currentTemperature?: number;
  targetTemperature?: number;
  mode?: 'heat' | 'cool' | 'auto';
}

export interface HumidifierDehumidifierDevice extends BaseDevice {
  category: 'humidifier_dehumidifier';
  isOn: boolean;
  currentHumidity?: number;
  targetHumidity?: number;
  intensity?: number;
}

export interface PurifierDevice extends BaseDevice {
  category: 'purifier';
  isOn: boolean;
  speed?: number;
  pm25Level?: number;
}

export interface OpenCloseDevice extends BaseDevice {
  category: 'open_close';
  position: number; // 0-100
  state: 'open' | 'closed' | 'opening' | 'closing';
}

export interface HomeAwayDevice extends BaseDevice {
  category: 'home_away_control';
  mode: 'home' | 'away';
}

// Union type for all devices
export type Device =
  | ThermostatDevice
  | CameraDevice
  | LightDevice
  | LockDevice
  | GarageDevice
  | SmokeCODevice
  | SensorDevice
  | RobotDevice
  | SwitchDevice
  | OutletDevice
  | FanDevice
  | DiffuserDevice
  | ValveDevice
  | KettleDevice
  | HeaterCoolerDevice
  | HumidifierDehumidifierDevice
  | PurifierDevice
  | OpenCloseDevice
  | HomeAwayDevice;

// API Error Response
export interface ApiErrorResponse {
  status: 'Error';
  code: string;
  message: string;
}

// Known error codes
export type ApiErrorCode =
  | 'INVALID_API_KEY'
  | 'DEVICE_NOT_FOUND'
  | 'PROPERTY_NOT_FOUND'
  | 'READ_ONLY_PROPERTY'
  | 'INVALID_VALUE'
  | 'SET_ERROR'
  | 'NO_SNAPSHOT_AVAILABLE'
  | 'STREAM_REQUEST_REFUSED'
  | 'STREAM_NOT_SUPPORTED';

// ============================================================
// WebRTC Streaming Types
// ============================================================

/**
 * Request to start a WebRTC stream
 */
export interface StreamStartRequest {
  /** Raw SDP offer string (SDC V2 API does NOT use base64 encoding) */
  offer: string;
}

/**
 * Response from starting a WebRTC stream
 */
export interface StreamStartResponse {
  /** Raw SDP answer string (SDC V2 API does NOT use base64 encoding) */
  answer: string;
  /** Stream ID for managing the stream (extend/stop) */
  streamId: string;
}

/**
 * Response from extending a stream
 */
export interface StreamExtendResponse {
  /** Whether the extension was successful */
  success: boolean;
}

/**
 * Response from stopping a stream
 */
export interface StreamStopResponse {
  /** Whether the stop was successful */
  success: boolean;
}

// Note: HubConfig and HubStatus are defined in lib/hub/types.ts
// to avoid duplication and include connection state management
