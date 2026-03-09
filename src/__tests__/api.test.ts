const api = require('../api') as {
  updateHub: (context: {
    homey: {
      app: {
        getHubManager: () => {
          getHub: jest.Mock;
          updateHub: jest.Mock;
        };
      };
    };
    params: { id: string };
    body: Record<string, unknown>;
  }) => Promise<unknown>;
};

describe('API hub updates', () => {
  it('preserves the stored API key when an edit submits a blank key', async () => {
    const existingConfig = {
      id: 'hub-1',
      name: 'Existing Hub',
      host: '192.168.1.10',
      port: 3080,
      useHttps: false,
      apiKey: 'existing-key',
    };
    const updatedStatus = { config: { ...existingConfig, name: 'Updated Hub', apiKey: '' } };
    const hubManager = {
      getHub: jest.fn().mockReturnValue({
        getConfig: jest.fn().mockReturnValue(existingConfig),
      }),
      updateHub: jest.fn().mockResolvedValue({
        getStatus: jest.fn().mockReturnValue(updatedStatus),
      }),
    };

    const result = await api.updateHub({
      homey: {
        app: {
          getHubManager: () => hubManager,
        },
      },
      params: { id: 'hub-1' },
      body: {
        name: '  Updated Hub  ',
        apiKey: '   ',
      },
    });

    expect(hubManager.updateHub).toHaveBeenCalledWith('hub-1', {
      name: 'Updated Hub',
    });
    expect(result).toEqual(updatedStatus);
  });
});
