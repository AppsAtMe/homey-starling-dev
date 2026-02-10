/**
 * StarlingDriver - Base class for all Starling device drivers
 *
 * Provides shared functionality for:
 * - Device pairing flow
 * - Hub selection
 * - Device filtering by category
 * - Zone suggestions based on room names
 */

import Homey from 'homey';
import { HubManager, DeviceWithHub, HubStatus } from '../../lib/hub';
import { DeviceCategory, BaseDevice } from '../../lib/api/types';
import { DeviceStore } from './types';

/**
 * Homey Zone structure
 */
interface HomeyZone {
  id: string;
  name: string;
  parent: string | null;
}

/**
 * Hub info for pairing UI
 */
interface PairingHubInfo {
  id: string;
  name: string;
  host: string;
  isOnline: boolean;
  deviceCount: number;
}

/**
 * Pairing session interface (subset of Homey PairSession)
 */
interface PairSession {
  setHandler(event: string, handler: (...args: unknown[]) => unknown): void;
  showView(viewId: string): Promise<void>;
  nextView(): Promise<void>;
}

/**
 * Device data passed during pairing
 */
export interface StarlingPairingDevice {
  name: string;
  data: {
    id: string;
    hubId: string;
  };
  store: {
    starlingId: string;
    hubId: string;
    category: DeviceCategory;
    model: string;
    roomName: string;
    structureName: string;
  };
  settings: {
    model: string;
    room: string;
    structure: string;
  };
}

/**
 * Abstract base class for Starling drivers
 */
abstract class StarlingDriver extends Homey.Driver {
  /**
   * Get the Starling device category this driver handles
   */
  abstract getDeviceCategory(): DeviceCategory | DeviceCategory[];

  /**
   * Get the HubManager instance from the app
   */
  protected getHubManager(): HubManager {
    // Access app through homey.app and cast to get HubManager
    const app = this.homey.app as unknown as { getHubManager(): HubManager };
    return app.getHubManager();
  }

  /**
   * Selected hub ID during pairing session
   */
  private pairingHubId: string | null = null;

  /**
   * Called when the driver is initialized
   *
   * Override in derived classes to add driver-specific initialization.
   */
  async onInit(): Promise<void> {
    // Base implementation - override in derived classes
  }

  /**
   * Handle custom pairing flow
   *
   * This sets up handlers for communication with the custom pairing views.
   */
  async onPair(session: PairSession): Promise<void> {
    this.log('[Pairing] onPair called - setting up handlers');
    // Reset pairing state
    this.pairingHubId = null;

    // Handler: List devices for the built-in list_devices template
    session.setHandler('list_devices', async (): Promise<StarlingPairingDevice[]> => {
      return this.onPairListDevices();
    });

    // Handler: Get available hubs for selection
    session.setHandler('getHubs', async (): Promise<PairingHubInfo[]> => {
      this.log('[Pairing] getHubs handler called');
      try {
        const hubManager = this.getHubManager();
        const statuses = hubManager.getAllHubStatuses();
        this.log(`[Pairing] Found ${statuses.length} hub(s)`);
        const hubs = statuses.map((status: HubStatus) => ({
          id: status.config.id,
          name: status.config.name,
          host: status.config.host,
          isOnline: status.isOnline,
          deviceCount: status.deviceCount,
        }));
        return hubs;
      } catch (error) {
        this.error('[Pairing] getHubs error:', error);
        throw error;
      }
    });

    // Handler: User selected a hub
    session.setHandler('selectHub', (hubId: unknown): void => {
      if (typeof hubId !== 'string') {
        throw new Error('Invalid hub ID');
      }

      const hubManager = this.getHubManager();
      const hub = hubManager.getHub(hubId);

      if (!hub) {
        throw new Error(`Hub ${hubId} not found`);
      }

      this.pairingHubId = hubId;
      this.log(`Selected hub for pairing: ${hubId}`);
    });

    // Handler: Get devices for the selected hub
    session.setHandler('getDevices', (): StarlingPairingDevice[] => {
      if (!this.pairingHubId) {
        throw new Error('No hub selected');
      }

      const hubManager = this.getHubManager();
      const connection = hubManager.getHub(this.pairingHubId);

      if (!connection) {
        throw new Error('Selected hub not found');
      }

      const categories = this.getDeviceCategoryArray();
      const cachedDevices = connection.getCachedDevices();

      // Filter by category and map to pairing format
      const devices: StarlingPairingDevice[] = [];

      for (const device of cachedDevices) {
        if (!categories.includes(device.category)) {
          continue;
        }

        const pairingDevice = this.mapToPairingDevice({
          device,
          hubId: this.pairingHubId,
          compositeId: `${this.pairingHubId}:${device.id}`,
        });

        // Mark devices that are already paired
        const alreadyPaired = this.isDevicePaired(device.id, this.pairingHubId);
        (pairingDevice as StarlingPairingDevice & { alreadyPaired: boolean }).alreadyPaired = alreadyPaired;

        devices.push(pairingDevice);
      }

      return devices;
    });

    // Handler: Get available Homey zones for zone suggestions
    session.setHandler('getZones', async (): Promise<HomeyZone[]> => {
      // Access zones API via type assertion (not fully typed in @types/homey)
      const homeyWithZones = this.homey as unknown as {
        zones: { getZones(): Promise<Record<string, { name: string; parent: string | null }>> };
      };

      try {
        const zonesObj = await homeyWithZones.zones.getZones();
        const zones: HomeyZone[] = [];

        for (const [id, zone] of Object.entries(zonesObj)) {
          zones.push({
            id,
            name: zone.name,
            parent: zone.parent,
          });
        }

        return zones;
      } catch (error) {
        this.log('Failed to retrieve zones:', error instanceof Error ? error.message : String(error));
        return [];
      }
    });

    // Handler: Add multiple devices at once
    session.setHandler('addDevices', (devices: unknown): void => {
      if (!Array.isArray(devices)) {
        throw new Error('Invalid devices array');
      }

      this.log(`Adding ${devices.length} devices from pairing`);

      // The actual device creation happens via Homey.createDevice() in the view
      // This handler is for any backend processing needed before creation
    });
  }

  /**
   * Handle device pairing - list available devices
   *
   * This is called by the Homey pairing wizard when listing devices.
   */
  async onPairListDevices(): Promise<StarlingPairingDevice[]> {
    this.log('[Pairing] onPairListDevices called');

    try {
      const hubManager = this.getHubManager();

      if (!hubManager.isInitialized()) {
        this.log('[Pairing] HubManager not initialized');
        throw new Error('Hub manager is not ready. Please wait a moment and try again.');
      }

      // Check if any hubs are configured
      const hubStatuses = hubManager.getAllHubStatuses();
      if (hubStatuses.length === 0) {
        this.log('[Pairing] No hubs configured');
        throw new Error('No Starling Hub configured. Please go to App Settings to add your hub first.');
      }

      // Check if any hubs are online
      const onlineHubs = hubStatuses.filter(h => h.isOnline);
      if (onlineHubs.length === 0) {
        this.log('[Pairing] No hubs online');
        const hubNames = hubStatuses.map(h => h.config.name).join(', ');
        throw new Error(`No Starling Hub is online. Check that your hub (${hubNames}) is powered on and connected to the network.`);
      }

      const allDevices = hubManager.getAllDevices();
      const categories = this.getDeviceCategoryArray();

      this.log(`[Pairing] Looking for categories: ${JSON.stringify(categories)}`);
      this.log(`[Pairing] Total devices from all hubs: ${allDevices?.length ?? 0}`);

      // Filter devices by category
      const matchingDevices = (allDevices || []).filter((d) =>
        categories.includes(d.device.category)
      );

      this.log(`[Pairing] Matching devices: ${matchingDevices.length}`);

      // Map to pairing device format
      const pairingDevices = matchingDevices.map((d) => this.mapToPairingDevice(d));

      this.log(`[Pairing] Returning devices: ${JSON.stringify(pairingDevices.map(d => ({ name: d.name, id: d.data.id })))}`);

      return pairingDevices;
    } catch (error) {
      this.error('[Pairing] onPairListDevices error:', error);
      // Re-throw to show the error message to the user
      throw error;
    }
  }

  /**
   * Get device categories as array (for drivers that support multiple categories)
   */
  protected getDeviceCategoryArray(): DeviceCategory[] {
    const category = this.getDeviceCategory();
    return Array.isArray(category) ? category : [category];
  }

  /**
   * Map a Starling device to the pairing device format
   */
  protected mapToPairingDevice(deviceWithHub: DeviceWithHub): StarlingPairingDevice {
    const { device, hubId, compositeId } = deviceWithHub;

    return {
      name: device.name,
      data: {
        id: compositeId, // Use composite ID for uniqueness across hubs
        hubId: hubId,
      },
      store: {
        starlingId: device.id,
        hubId: hubId,
        category: device.category,
        model: device.model,
        roomName: device.roomName,
        structureName: device.structureName,
      },
      settings: {
        model: device.model,
        room: device.roomName,
        structure: device.structureName,
      },
    };
  }

  /**
   * Check if a device is already paired
   */
  protected isDevicePaired(starlingId: string, hubId: string): boolean {
    const devices = this.getDevices();
    return devices.some((device) => {
      const store = device.getStore() as DeviceStore;
      return store.starlingId === starlingId && store.hubId === hubId;
    });
  }

  /**
   * Get all Starling devices that haven't been paired yet
   */
  protected getUnpairedDevices(): DeviceWithHub[] {
    const hubManager = this.getHubManager();
    const allDevices = hubManager.getAllDevices();
    const categories = this.getDeviceCategoryArray();

    return allDevices.filter((d) => {
      if (!categories.includes(d.device.category)) {
        return false;
      }
      return !this.isDevicePaired(d.device.id, d.hubId);
    });
  }

  /**
   * Find a Starling device by its ID
   */
  protected findStarlingDevice(
    starlingId: string,
    hubId: string
  ): DeviceWithHub | undefined {
    const hubManager = this.getHubManager();
    const connection = hubManager.getHub(hubId);

    if (!connection) {
      return undefined;
    }

    const device = connection.getCachedDevice(starlingId);
    if (!device) {
      return undefined;
    }

    return {
      device,
      hubId,
      compositeId: `${hubId}:${starlingId}`,
    };
  }

  /**
   * Get Starling device data for a Homey device
   *
   * Use in flow card handlers to get the current device state:
   * ```
   * const device = this.getStarlingDeviceData<LockDevice>(args.device);
   * return device?.currentState === 'locked';
   * ```
   */
  protected getStarlingDeviceData<T extends BaseDevice>(
    homeyDevice: Homey.Device
  ): T | undefined {
    const store = homeyDevice.getStore() as DeviceStore;
    const hubManager = this.getHubManager();
    const connection = hubManager.getHub(store.hubId);
    return connection?.getCachedDevice(store.starlingId) as T | undefined;
  }
}

export { StarlingDriver };
