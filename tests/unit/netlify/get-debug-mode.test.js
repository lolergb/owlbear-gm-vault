import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-debug-mode.js';

const originalDebugMode = process.env.DEBUG_MODE;
const originalOwnerToken = process.env.OWNER_TOKEN;

const event = ({ httpMethod = 'GET', token } = {}) => ({
  httpMethod,
  queryStringParameters: token ? { token } : {}
});

afterEach(() => {
  if (originalDebugMode === undefined) delete process.env.DEBUG_MODE;
  else process.env.DEBUG_MODE = originalDebugMode;

  if (originalOwnerToken === undefined) delete process.env.OWNER_TOKEN;
  else process.env.OWNER_TOKEN = originalOwnerToken;
});

describe('get-debug-mode Netlify function', () => {
  it('exports an ESM handler and handles CORS preflight', async () => {
    const response = await handler(event({ httpMethod: 'OPTIONS' }));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('returns debug disabled by default', async () => {
    delete process.env.DEBUG_MODE;
    delete process.env.OWNER_TOKEN;

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ debug: false });
  });

  it('only enables owner-scoped debug for the matching token', async () => {
    process.env.DEBUG_MODE = 'true';
    process.env.OWNER_TOKEN = 'owner-token';

    const denied = await handler(event({ token: 'different-token' }));
    const allowed = await handler(event({ token: 'owner-token' }));

    expect(JSON.parse(denied.body)).toEqual({ debug: false });
    expect(JSON.parse(allowed.body)).toEqual({ debug: true });
  });

  it('rejects unsupported methods', async () => {
    const response = await handler(event({ httpMethod: 'POST' }));

    expect(response.statusCode).toBe(405);
  });
});
