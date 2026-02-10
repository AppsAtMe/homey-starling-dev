import Homey from 'homey';
import { initLogger, Logger } from './lib/utils';
import { HubManager, DeviceStateChange, HubConfig } from './lib/hub';
import { HubDiscovery } from './lib/discovery';

/**
 * Starling Home Hub - Homey App
 *
 * Bridges Google Home/Nest devices via Starling Developer Connect API
 * to the Homey smart home platform.
 *
 * The app manages multiple Starling Hub connections and provides a unified
 * interface for device drivers to interact with Google Home/Nest devices.
 */
/**
 * Known face info for autocomplete
 */
interface KnownFace {
  name: string;
  cameraId: string;
  cameraName: string;
  hubId: string;
}

/**
 * Camera info for autocomplete
 */
interface CameraInfo {
  id: string;
  compositeId: string;
  name: string;
  hubId: string;
}

class StarlingHomeHubApp extends Homey.App {
  private logger!: Logger;
  private hubManager!: HubManager;
  private hubDiscovery!: HubDiscovery;

  // Track known faces for autocomplete
  private knownFaces: Map<string, KnownFace> = new Map(); // key: "personName:cameraId"
  private cameras: Map<string, CameraInfo> = new Map(); // key: compositeId

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    // Initialize logger first
    this.logger = initLogger(this);

    // Load debug mode from settings
    const debugMode = (this.homey.settings.get('debugMode') as boolean) ?? false;
    this.logger.setDebugMode(debugMode);

    this.logger.info('Starling Home Hub app is initializing...');

    // Listen for settings changes
    this.homey.settings.on('set', this.onSettingsChanged.bind(this));

    // Initialize Hub Manager
    this.hubManager = HubManager.getInstance(this);
    this.setupHubManagerEvents();

    // Initialize Hub Discovery
    this.hubDiscovery = new HubDiscovery(this.homey);

    // Initialize manager (loads saved hubs and connects with staggered timing)
    await this.hubManager.initialize();

    // Register app-level flow cards
    this.registerFlowCards();

    this.logger.info('Starling Home Hub app initialized successfully');
  }

  /**
   * Register app-level flow cards (triggers, conditions, actions)
   */
  private registerFlowCards(): void {
    // ============================================================
    // Triggers - registered but triggered via events
    // ============================================================

    // Hub offline trigger is fired in setupHubManagerEvents
    // Hub online trigger is fired in setupHubManagerEvents
    // Command failed trigger is fired by devices
    // Home/Away changed trigger is fired by home-away driver

    // Face detected trigger with autocomplete
    const faceDetectedTrigger = this.homey.flow.getTriggerCard('face_detected');
    faceDetectedTrigger.registerRunListener(
      (args: { person: { name: string }; camera: { id: string } }, state: { person: string; camera: string }) => {
        // Match if person name matches (or "any" selected)
        const personMatch = args.person.name === 'any' || args.person.name === state.person;
        // Match if camera matches (or "any" selected)
        const cameraMatch = args.camera.id === 'any' || args.camera.id === state.camera;
        return personMatch && cameraMatch;
      }
    );

    // Person autocomplete
    faceDetectedTrigger.registerArgumentAutocompleteListener(
      'person',
      (query: string) => {
        const faces = this.getKnownFaces();
        const uniqueNames = new Set(faces.map((f) => f.name));
        const results = [
          { name: 'any', description: 'Any person' },
          ...Array.from(uniqueNames)
            .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
            .map((name) => ({ name, description: `Detected face: ${name}` })),
        ];
        return results;
      }
    );

    // Camera autocomplete
    faceDetectedTrigger.registerArgumentAutocompleteListener(
      'camera',
      (query: string) => {
        const cameras = this.getCameras();
        const results = [
          { id: 'any', name: 'Any camera', description: 'Any camera with face detection' },
          ...cameras
            .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
            .map((c) => ({ id: c.id, name: c.name, description: `Camera: ${c.name}` })),
        ];
        return results;
      }
    );

    // ============================================================
    // Conditions
    // ============================================================

    // Hub is online condition
    const hubIsOnlineCondition = this.homey.flow.getConditionCard('hub_is_online');
    hubIsOnlineCondition.registerRunListener((args: { hub: { id: string } }) => {
      const hub = this.hubManager.getHub(args.hub.id);
      if (!hub) {
        throw new Error(this.homey.__('errors.hub_not_found'));
      }
      return hub.isOnline();
    });
    hubIsOnlineCondition.registerArgumentAutocompleteListener('hub', (query: string) => {
      return this.getHubAutocompleteResults(query);
    });

    // Home/Away mode condition
    const homeAwayModeCondition = this.homey.flow.getConditionCard('home_away_mode_is');
    homeAwayModeCondition.registerRunListener((args: { mode: string }) => {
      const hubs = this.hubManager.getAllHubs();
      for (const hub of hubs) {
        const devices = hub.getCachedDevices();
        for (const device of devices) {
          if (device.category === 'home_away_control') {
            const homeAway = device as { mode?: string };
            return homeAway.mode === args.mode;
          }
        }
      }
      throw new Error(this.homey.__('errors.no_home_away_device'));
    });

    // ============================================================
    // Actions
    // ============================================================

    // Refresh all devices action
    const refreshAllAction = this.homey.flow.getActionCard('refresh_all_devices');
    refreshAllAction.registerRunListener(async () => {
      await this.hubManager.refreshAll();
    });

    // Refresh hub devices action
    const refreshHubAction = this.homey.flow.getActionCard('refresh_hub_devices');
    refreshHubAction.registerRunListener(async (args: { hub: { id: string } }) => {
      await this.hubManager.refreshHub(args.hub.id);
    });
    refreshHubAction.registerArgumentAutocompleteListener('hub', (query: string) => {
      return this.getHubAutocompleteResults(query);
    });

    // Set Home/Away mode action
    const setHomeAwayAction = this.homey.flow.getActionCard('set_home_away_mode');
    setHomeAwayAction.registerRunListener(async (args: { mode: string }) => {
      const errors: string[] = [];
      const hubs = this.hubManager.getAllHubs();

      for (const hub of hubs) {
        const devices = hub.getCachedDevices();
        for (const device of devices) {
          if (device.category === 'home_away_control') {
            try {
              await this.hubManager.setDeviceProperty(device.id, 'mode', args.mode);
            } catch (error) {
              const hubName = hub.getConfig().name;
              errors.push(hubName);
              this.logger.error(`Failed to set home/away on hub ${hubName}:`, error as Error);
            }
          }
        }
      }

      if (errors.length > 0) {
        throw new Error(`Failed to set home/away mode on: ${errors.join(', ')}`);
      }
    });

    this.logger.debug('Flow cards registered');
  }

  /**
   * Set up event listeners for hub manager events
   */
  private setupHubManagerEvents(): void {
    this.hubManager.on('hubOnline', (hubId: string) => {
      this.logger.info(`Hub online: ${hubId}`);

      // Get hub name for the trigger token
      const hub = this.hubManager.getHub(hubId);
      const hubName = hub?.getConfig().name ?? hubId;

      // Fire the hub_online trigger
      this.homey.flow
        .getTriggerCard('hub_online')
        .trigger({ hub_name: hubName })
        .catch((err: Error) => {
          this.logger.error('Failed to trigger hub_online flow:', err);
        });
    });

    this.hubManager.on('hubOffline', (hubId: string, error: string) => {
      this.logger.warn(`Hub offline: ${hubId} - ${error}`);

      // Get hub name for the trigger token
      const hub = this.hubManager.getHub(hubId);
      const hubName = hub?.getConfig().name ?? hubId;

      // Fire the hub_offline trigger
      this.homey.flow
        .getTriggerCard('hub_offline')
        .trigger({ hub_name: hubName })
        .catch((err: Error) => {
          this.logger.error('Failed to trigger hub_offline flow:', err);
        });
    });

    this.hubManager.on('hubAdded', (hubId: string, config: HubConfig) => {
      this.logger.info(`Hub added: ${config.name} (${hubId})`);
    });

    this.hubManager.on('hubRemoved', (hubId: string) => {
      this.logger.info(`Hub removed: ${hubId}`);
    });

    this.hubManager.on('deviceStateChange', (change: DeviceStateChange) => {
      this.logger.debug(
        `Device state change: ${change.device.id} - ${change.changes.length} properties changed`
      );
      // Device drivers will handle their own state changes via their connection events

      // Update known faces if this is a camera with face detection
      if (change.device.category === 'cam') {
        this.updateKnownFaces(change.hubId, change.device);
      }
    });

    this.hubManager.on('deviceAdded', (hubId: string, device) => {
      this.logger.debug(`Device added on hub ${hubId}: ${device.id} (${device.name})`);
    });

    this.hubManager.on('deviceRemoved', (hubId: string, deviceId: string) => {
      this.logger.debug(`Device removed from hub ${hubId}: ${deviceId}`);
    });
  }

  /**
   * Handle settings changes
   */
  private onSettingsChanged(key: string): void {
    if (key === 'debugMode') {
      const debugMode = (this.homey.settings.get('debugMode') as boolean) ?? false;
      this.logger.setDebugMode(debugMode);
      this.logger.info(`Debug mode ${debugMode ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * onUninit is called when the app is destroyed.
   */
  async onUninit(): Promise<void> {
    this.logger.info('Starling Home Hub app is shutting down...');

    // Shutdown Hub Manager (stops polling, disconnects all hubs)
    await this.hubManager.shutdown();

    this.logger.info('Starling Home Hub app shut down complete');
  }

  // ============================================================
  // Public API for Drivers
  // ============================================================

  /**
   * Get the Hub Manager instance
   *
   * Drivers can use this to access hub connections and devices.
   */
  getHubManager(): HubManager {
    return this.hubManager;
  }

  /**
   * Get the Hub Discovery instance
   *
   * Used by settings page to discover hubs on the network.
   */
  getHubDiscovery(): HubDiscovery {
    return this.hubDiscovery;
  }

  /**
   * Get the logger instance
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Trigger the command_failed flow card
   *
   * Called by devices when a command fails to execute.
   */
  triggerCommandFailed(deviceName: string, command: string, error: string): void {
    this.homey.flow
      .getTriggerCard('command_failed')
      .trigger({
        device_name: deviceName,
        command,
        error,
      })
      .catch((err: Error) => {
        this.logger.error('Failed to trigger command_failed flow:', err);
      });
  }

  /**
   * Trigger the home_away_changed flow card
   *
   * Called by the home-away device when the mode changes.
   */
  triggerHomeAwayChanged(mode: string): void {
    this.homey.flow
      .getTriggerCard('home_away_changed')
      .trigger({ mode })
      .catch((err: Error) => {
        this.logger.error('Failed to trigger home_away_changed flow:', err);
      });
  }

  /**
   * Trigger the face_detected flow card
   *
   * Called by camera devices when a recognized face is detected.
   */
  triggerFaceDetected(personName: string, cameraId: string, cameraName: string): void {
    const state = { person: personName, camera: cameraId };
    const tokens = { person_name: personName, camera_name: cameraName };

    this.homey.flow
      .getTriggerCard('face_detected')
      .trigger(tokens, state)
      .catch((err: Error) => {
        this.logger.error('Failed to trigger face_detected flow:', err);
      });

    this.logger.debug(`Face detected: ${personName} at ${cameraName}`);
  }

  /**
   * Update known faces from a camera device
   *
   * Called when a camera's state changes to discover new faces.
   */
  private updateKnownFaces(hubId: string, device: DeviceStateChange['device']): void {
    const camera = device as { faceDetected?: Record<string, boolean> };

    if (!camera.faceDetected) {
      return;
    }

    // Update camera registry
    const compositeId = `${hubId}:${device.id}`;
    if (!this.cameras.has(compositeId)) {
      this.cameras.set(compositeId, {
        id: device.id,
        compositeId,
        name: device.name,
        hubId,
      });
    }

    // Update known faces
    for (const personName of Object.keys(camera.faceDetected)) {
      const key = `${personName}:${device.id}`;
      if (!this.knownFaces.has(key)) {
        this.knownFaces.set(key, {
          name: personName,
          cameraId: device.id,
          cameraName: device.name,
          hubId,
        });
        this.logger.debug(`Discovered face: ${personName} at ${device.name}`);
      }
    }
  }

  /**
   * Hub autocomplete results for flow cards
   */
  private getHubAutocompleteResults(query: string): Array<{ id: string; name: string }> {
    const hubs = this.hubManager.getSettings().hubs;
    return hubs
      .filter((h: HubConfig) => h.name.toLowerCase().includes(query.toLowerCase()))
      .map((h: HubConfig) => ({ id: h.id, name: h.name }));
  }

  /**
   * Get all known faces for autocomplete
   */
  getKnownFaces(): KnownFace[] {
    return Array.from(this.knownFaces.values());
  }

  /**
   * Get all cameras for autocomplete
   */
  getCameras(): CameraInfo[] {
    return Array.from(this.cameras.values());
  }
}

module.exports = StarlingHomeHubApp;
