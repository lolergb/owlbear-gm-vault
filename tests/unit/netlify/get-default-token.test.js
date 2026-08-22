import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-default-token.js';

const originalDefaultToken = process.env.GM_VAULT_DEFAULT_CONFIG;

const event = (httpMethod = 'GET') => ({ httpMethod });

afterEach(() => {
  if (originalDefaultToken === undefined) delete process.env.GM_VAULT_DEFAULT_CONFIG;
  else process.env.GM_VAULT_DEFAULT_CONFIG = originalDefaultToken;
});

describe('get-default-token Netlify function', () => {
  it('exports an ESM handler and handles CORS preflight', async () => {
    const response = await handler(event('OPTIONS'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('returns a null token when no default is configured', async () => {
    delete process.env.GM_VAULT_DEFAULT_CONFIG;

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ token: null });
  });

  it('returns the configured default token', async () => {
    process.env.GM_VAULT_DEFAULT_CONFIG = 'default-token';

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ token: 'default-token' });
  });

  it('rejects unsupported methods', async () => {
    const response = await handler(event('POST'));

    expect(response.statusCode).toBe(405);
  });
});
