import Homey from 'homey';
import { Logger } from '../Logger';

describe('Logger', () => {
  it('redacts sensitive values from debug API logs', () => {
    const app = new Homey.App() as unknown as {
      log: jest.Mock;
      error: jest.Mock;
    };
    const logger = new Logger(app as unknown as Homey.App);

    logger.setDebugMode(true);
    app.log.mockClear();

    logger.logApiRequest('POST', 'https://hub.local/test?key=secret-key', {
      apiKey: 'abc123',
      nested: {
        authorization: 'Bearer token',
      },
      value: 'ok',
    });

    const messages = app.log.mock.calls.map((args) => String(args[0]));

    expect(messages.some((message) => message.includes('secret-key'))).toBe(false);
    expect(messages.some((message) => message.includes('abc123'))).toBe(false);
    expect(messages.some((message) => message.includes('Bearer token'))).toBe(false);
    expect(messages.some((message) => message.includes('[REDACTED]'))).toBe(true);
    expect(messages.some((message) => message.includes('"value":"ok"'))).toBe(true);
  });
});
