const HomeAwayDriver = require('../driver');

describe('HomeAwayDriver flow cards', () => {
  it('registers condition and action handlers and executes them', async () => {
    const driver = new HomeAwayDriver();

    const conditionHandlers: Record<string, (args: unknown) => unknown> = {};
    const actionHandlers: Record<string, (args: unknown) => Promise<void>> = {};

    const hubManager = {
      setDeviceProperty: jest.fn().mockResolvedValue(undefined),
    };

    driver.homey = {
      flow: {
        getConditionCard: jest.fn((id: string) => ({
          registerRunListener: (handler: (args: unknown) => unknown) => {
            conditionHandlers[id] = handler;
          },
        })),
        getActionCard: jest.fn((id: string) => ({
          registerRunListener: (handler: (args: unknown) => Promise<void>) => {
            actionHandlers[id] = handler;
          },
        })),
      },
      app: {
        getHubManager: () => hubManager,
      },
      __: (key: string) => key,
    };

    (driver as { getStarlingDeviceData: jest.Mock }).getStarlingDeviceData = jest.fn();

    await driver.onInit();

    expect(conditionHandlers.mode_is).toBeDefined();
    expect(actionHandlers.set_mode).toBeDefined();

    (driver as { getStarlingDeviceData: jest.Mock }).getStarlingDeviceData.mockReturnValue({ mode: 'home' });

    const isHome = conditionHandlers.mode_is({ device: {}, mode: 'home' });
    const isAway = conditionHandlers.mode_is({ device: {}, mode: 'away' });

    expect(isHome).toBe(true);
    expect(isAway).toBe(false);

    const device = {
      getStore: () => ({ starlingId: 'device-1', hubId: 'hub-1' }),
    };

    await actionHandlers.set_mode({ device, mode: 'away' });
    expect(hubManager.setDeviceProperty).toHaveBeenCalledWith('device-1', 'mode', 'away', 'hub-1');

    await expect(actionHandlers.set_mode({ device, mode: 'invalid' })).rejects.toThrow('errors.invalid_home_away_mode');
  });
});
