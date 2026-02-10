/**
 * Unit tests for HubManager
 *
 * Tests singleton pattern and basic lifecycle.
 */

import Homey from 'homey';
import { HubManager } from '../lib/hub/HubManager';
import { HubConnection } from '../lib/hub/HubConnection';
import { Poller } from '../lib/hub/Poller';
import { HubConfig, DEFAULT_SETTINGS } from '../lib/hub/types';

// Mock dependencies
jest.mock('../lib/hub/HubConnection');
jest.mock('../lib/hub/Poller');

jest.mock('../lib/utils/Logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('HubManager', () => {
  let mockApp: Homey.App;
  let mockHomey: {
    settings: {
      get: jest.Mock;
      set: jest.Mock;
    };
  };

  const testHubConfig: HubConfig = {
    id: 'hub-1',
    name: 'Test Hub',
    host: '192.168.1.100',
    port: 3080,
    useHttps: false,
    apiKey: 'test-api-key',
    pollIntervalMs: 12000,
  };

  // Helper to create a fresh mock connection
  const createMockConnection = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getConfig: jest.fn().mockReturnValue(testHubConfig),
    getStatus: jest.fn().mockReturnValue({
      config: testHubConfig,
      state: 'connected',
      isOnline: true,
      lastPoll: new Date(),
      gracePeriodStarted: null,
      lastError: null,
      permissions: { read: true, write: true, camera: false },
      apiVersion: '2.0',
      deviceCount: 0,
    }),
    getCachedDevices: jest.fn().mockReturnValue([]),
    getCachedDevice: jest.fn().mockReturnValue(undefined),
    on: jest.fn(),
    setDeviceProperty: jest.fn().mockResolvedValue(undefined),
    getSnapshot: jest.fn().mockResolvedValue(Buffer.from('test')),
  });

  // Helper to create a fresh mock poller
  const createMockPoller = () => ({
    start: jest.fn(),
    stop: jest.fn(),
    refresh: jest.fn().mockResolvedValue({ success: true, changes: [] }),
    setInterval: jest.fn(),
  });

  beforeEach(() => {
    // IMPORTANT: Reset singleton before each test
    HubManager.resetInstance();

    // Reset all mocks
    jest.clearAllMocks();

    // Create fresh mocks
    mockHomey = {
      settings: {
        get: jest.fn().mockReturnValue(null),
        set: jest.fn(),
      },
    };

    mockApp = {
      homey: mockHomey,
    } as unknown as Homey.App;

    // Setup constructor mocks to return fresh instances
    jest.mocked(HubConnection).mockImplementation(
      () => createMockConnection() as unknown as HubConnection
    );
    jest.mocked(Poller).mockImplementation(
      () => createMockPoller() as unknown as Poller
    );
  });

  afterEach(async () => {
    // Clean up singleton after each test
    await HubManager.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should create singleton instance with app', () => {
      const manager = HubManager.getInstance(mockApp);
      expect(manager).toBeInstanceOf(HubManager);
    });

    it('should return same instance on subsequent calls', () => {
      const manager1 = HubManager.getInstance(mockApp);
      const manager2 = HubManager.getInstance();
      expect(manager1).toBe(manager2);
    });

    it('should throw if called without app before initialization', () => {
      expect(() => HubManager.getInstance()).toThrow(
        'HubManager not initialized'
      );
    });

    it('should allow re-initialization after reset', async () => {
      HubManager.getInstance(mockApp);
      await HubManager.resetInstance();

      // Should throw because instance was reset
      expect(() => HubManager.getInstance()).toThrow();

      // Can re-initialize with app
      const manager = HubManager.getInstance(mockApp);
      expect(manager).toBeInstanceOf(HubManager);
    });
  });

  describe('Initialization', () => {
    it('should initialize without saved hubs', async () => {
      mockHomey.settings.get.mockReturnValue(null);

      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      expect(manager.isInitialized()).toBe(true);
      expect(manager.getAllHubs()).toEqual([]);
    });

    it('should not reinitialize if already initialized', async () => {
      const manager = HubManager.getInstance(mockApp);

      await manager.initialize();
      expect(manager.isInitialized()).toBe(true);

      // Second call should be no-op
      await manager.initialize();
      expect(manager.isInitialized()).toBe(true);
    });

    it('should load saved hubs from settings', async () => {
      mockHomey.settings.get.mockReturnValue({
        ...DEFAULT_SETTINGS,
        hubs: [testHubConfig],
      });

      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      expect(HubConnection).toHaveBeenCalledTimes(1);
      expect(Poller).toHaveBeenCalledTimes(1);
    });
  });

  describe('Shutdown', () => {
    it('should mark as not initialized after shutdown', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      expect(manager.isInitialized()).toBe(true);

      await manager.shutdown();

      expect(manager.isInitialized()).toBe(false);
    });
  });

  describe('Settings', () => {
    it('should return default settings', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      const settings = manager.getSettings();

      expect(settings).toEqual(
        expect.objectContaining({
          hubs: expect.any(Array),
          defaultPollIntervalMs: expect.any(Number),
          debugMode: expect.any(Boolean),
          gracePeriodMs: expect.any(Number),
        })
      );
    });

    it('should persist settings updates', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      await manager.updateSettings({ debugMode: true });

      expect(mockHomey.settings.set).toHaveBeenCalledWith(
        'starlingSettings',
        expect.objectContaining({
          debugMode: true,
        })
      );
    });
  });

  describe('Hub Management', () => {
    it('should return undefined for unknown hub', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      const hub = manager.getHub('unknown');
      expect(hub).toBeUndefined();
    });

    it('should return empty array when no hubs', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      expect(manager.getAllHubs()).toEqual([]);
    });

    it('should handle removing non-existent hub gracefully', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      // Should not throw
      await expect(manager.removeHub('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('Device Management', () => {
    it('should return empty devices array when no hubs', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      expect(manager.getAllDevices()).toEqual([]);
    });

    it('should throw when setting property on unknown device', async () => {
      const manager = HubManager.getInstance(mockApp);
      await manager.initialize();

      await expect(
        manager.setDeviceProperty('unknown', 'prop', 'value')
      ).rejects.toThrow('not found');
    });
  });
});
