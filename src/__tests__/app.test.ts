import Homey from 'homey';

jest.mock('../lib/utils', () => ({
  Logger: class Logger {},
  initLogger: jest.fn(),
}));

jest.mock('../lib/hub', () => ({
  HubManager: {
    getInstance: jest.fn(),
  },
}));

jest.mock('../lib/discovery', () => ({
  HubDiscovery: jest.fn(),
}));

const StarlingHomeHubApp = require('../app');
const { initLogger } = require('../lib/utils') as {
  initLogger: jest.Mock;
};
const { HubManager } = require('../lib/hub') as {
  HubManager: {
    getInstance: jest.Mock;
  };
};

type FlowListener = (...args: any[]) => any;

interface FlowCardMock {
  trigger: jest.Mock<Promise<void>, any[]>;
  registerRunListener: jest.Mock<void, [FlowListener]>;
  registerArgumentAutocompleteListener: jest.Mock<void, [string, FlowListener]>;
  runListener?: FlowListener;
  autocompleteListeners: Record<string, FlowListener>;
}

interface MockHub {
  getConfig: jest.Mock<{ id: string; name: string }, []>;
  getCachedDevices: jest.Mock<any[], []>;
  setDeviceProperty: jest.Mock<Promise<void>, [string, string, unknown]>;
  isOnline: jest.Mock<boolean, []>;
}

interface MockHubManager {
  initialize: jest.Mock<Promise<void>, []>;
  on: jest.Mock<MockHubManager, [string, FlowListener]>;
  getAllHubs: jest.Mock<MockHub[], []>;
  getHub: jest.Mock<MockHub | undefined, [string]>;
  getSettings: jest.Mock<{ hubs: Array<{ id: string; name: string }> }, []>;
  refreshAll: jest.Mock<Promise<void>, []>;
  refreshHub: jest.Mock<Promise<void>, [string]>;
}

const createFlowCard = (): FlowCardMock => {
  const card: FlowCardMock = {
    trigger: jest.fn().mockResolvedValue(undefined),
    registerRunListener: jest.fn((listener: FlowListener) => {
      card.runListener = listener;
    }),
    registerArgumentAutocompleteListener: jest.fn((name: string, listener: FlowListener) => {
      card.autocompleteListeners[name] = listener;
    }),
    autocompleteListeners: {},
  };

  return card;
};

const createHub = (
  id: string,
  name: string,
  devices: any[],
  setDevicePropertyImpl?: (deviceId: string, property: string, value: unknown) => Promise<void>
): MockHub => ({
  getConfig: jest.fn(() => ({ id, name })),
  getCachedDevices: jest.fn(() => devices),
  setDeviceProperty: jest.fn(
    setDevicePropertyImpl ?? (async () => undefined)
  ),
  isOnline: jest.fn(() => true),
});

const createHubManager = (hubs: MockHub[], hubEventHandlers: Record<string, FlowListener>): MockHubManager => {
  const hubManager = {} as MockHubManager;

  hubManager.initialize = jest.fn().mockResolvedValue(undefined);
  hubManager.on = jest.fn((event: string, listener: FlowListener) => {
    hubEventHandlers[event] = listener;
    return hubManager;
  });
  hubManager.getAllHubs = jest.fn(() => hubs);
  hubManager.getHub = jest.fn((hubId: string) => hubs.find((hub) => hub.getConfig().id === hubId));
  hubManager.getSettings = jest.fn(() => ({
    hubs: hubs.map((hub) => {
      const config = hub.getConfig();
      return { id: config.id, name: config.name };
    }),
  }));
  hubManager.refreshAll = jest.fn().mockResolvedValue(undefined);
  hubManager.refreshHub = jest.fn().mockResolvedValue(undefined);

  return hubManager;
};

describe('StarlingHomeHubApp', () => {
  const mockLogger = {
    setDebugMode: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let app: Homey.App & {
    onInit: () => Promise<void>;
    triggerFaceDetected: (personName: string, cameraId: string, cameraName: string, hubId: string) => void;
  };
  let triggerCards: Record<string, FlowCardMock>;
  let actionCards: Record<string, FlowCardMock>;
  let conditionCards: Record<string, FlowCardMock>;
  let hubEventHandlers: Record<string, FlowListener>;

  beforeEach(() => {
    jest.clearAllMocks();
    initLogger.mockReturnValue(mockLogger);

    triggerCards = {};
    actionCards = {};
    conditionCards = {};
    hubEventHandlers = {};

    app = new StarlingHomeHubApp();
    app.log = jest.fn();
    app.error = jest.fn();

    app.homey = {
      settings: {
        get: jest.fn((key: string) => (key === 'debugMode' ? false : undefined)),
        on: jest.fn(),
      },
      flow: {
        getTriggerCard: jest.fn((id: string) => {
          triggerCards[id] ||= createFlowCard();
          return triggerCards[id];
        }),
        getConditionCard: jest.fn((id: string) => {
          conditionCards[id] ||= createFlowCard();
          return conditionCards[id];
        }),
        getActionCard: jest.fn((id: string) => {
          actionCards[id] ||= createFlowCard();
          return actionCards[id];
        }),
      },
      __: jest.fn((key: string) => key),
    } as unknown as Homey.App['homey'];
  });

  it('seeds face autocomplete from connected hubs and uses composite camera ids in triggers', async () => {
    const devices = [
      {
        id: 'camera-1',
        name: 'Front Door',
        category: 'cam',
        faceDetected: { Alice: false, Bob: false },
      },
    ];
    const hub = createHub('hub-1', 'Main Hub', devices);
    const hubManager = createHubManager([hub], hubEventHandlers);
    HubManager.getInstance.mockReturnValue(hubManager);

    await app.onInit();

    const faceDetectedCard = triggerCards.face_detected;
    const personResults = await faceDetectedCard.autocompleteListeners.person('ali');
    const cameraResults = await faceDetectedCard.autocompleteListeners.camera('front');

    expect(personResults).toEqual(
      expect.arrayContaining([
        { name: 'any', description: 'Any person' },
        { name: 'Alice', description: 'Detected face: Alice' },
      ])
    );
    expect(cameraResults).toEqual(
      expect.arrayContaining([
        { id: 'hub-1:camera-1', name: 'Front Door', description: 'Camera: Front Door' },
      ])
    );
    expect(
      faceDetectedCard.runListener?.(
        { person: { name: 'Alice' }, camera: { id: 'hub-1:camera-1' } },
        { person: 'Alice', camera: 'hub-1:camera-1' }
      )
    ).toBe(true);

    app.triggerFaceDetected('Alice', 'camera-1', 'Front Door', 'hub-1');
    expect(faceDetectedCard.trigger).toHaveBeenCalledWith(
      { person_name: 'Alice', camera_name: 'Front Door' },
      { person: 'Alice', camera: 'hub-1:camera-1' }
    );

    devices.length = 0;
    hubEventHandlers.deviceRemoved?.('hub-1', 'camera-1');

    const refreshedCameraResults = await faceDetectedCard.autocompleteListeners.camera('front');
    expect(refreshedCameraResults).toEqual([
      { id: 'any', name: 'Any camera', description: 'Any camera with face detection' },
    ]);
  });

  it('routes the Home/Away action through each hub connection and reports failures by hub name', async () => {
    const primaryHub = createHub('hub-1', 'Primary Hub', [
      { id: 'home-1', name: 'Home', category: 'home_away_control', mode: 'home' },
    ]);
    const backupHub = createHub(
      'hub-2',
      'Backup Hub',
      [{ id: 'home-2', name: 'Home', category: 'home_away_control', mode: 'home' }],
      async () => {
        throw new Error('write failed');
      }
    );
    const hubManager = createHubManager([primaryHub, backupHub], hubEventHandlers);
    HubManager.getInstance.mockReturnValue(hubManager);

    await app.onInit();

    await expect(actionCards.set_home_away_mode.runListener?.({ mode: 'away' })).rejects.toThrow(
      'Failed to set home/away mode on: Backup Hub'
    );

    expect(primaryHub.setDeviceProperty).toHaveBeenCalledWith('home-1', 'mode', 'away');
    expect(backupHub.setDeviceProperty).toHaveBeenCalledWith('home-2', 'mode', 'away');
  });

  it('requires all Home/Away devices to match for the global condition', async () => {
    const primaryHub = createHub('hub-1', 'Primary Hub', [
      { id: 'home-1', name: 'Home', category: 'home_away_control', mode: 'home' },
    ]);
    const backupHub = createHub('hub-2', 'Backup Hub', [
      { id: 'home-2', name: 'Home', category: 'home_away_control', mode: 'away' },
    ]);
    const hubManager = createHubManager([primaryHub, backupHub], hubEventHandlers);
    HubManager.getInstance.mockReturnValue(hubManager);

    await app.onInit();

    expect(conditionCards.home_away_mode_is.runListener?.({ mode: 'home' })).toBe(false);
    expect(conditionCards.home_away_mode_is.runListener?.({ mode: 'away' })).toBe(false);
  });

  it('fails the Home/Away action and condition when no Home/Away device exists', async () => {
    const hub = createHub('hub-1', 'Primary Hub', [
      { id: 'light-1', name: 'Light', category: 'light', isOnline: true },
    ]);
    const hubManager = createHubManager([hub], hubEventHandlers);
    HubManager.getInstance.mockReturnValue(hubManager);

    await app.onInit();

    expect(() => conditionCards.home_away_mode_is.runListener?.({ mode: 'home' })).toThrow(
      'errors.no_home_away_device'
    );
    await expect(actionCards.set_home_away_mode.runListener?.({ mode: 'away' })).rejects.toThrow(
      'errors.no_home_away_device'
    );
  });
});
