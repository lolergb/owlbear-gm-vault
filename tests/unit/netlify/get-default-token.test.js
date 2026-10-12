import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-default-token.js';

const originalDefaultToken = process.env.GM_VAULT_DEFAULT_CONFIG_V2;

const event = (httpMethod = 'GET') => ({ httpMethod });

afterEach(() => {
  if (originalDefaultToken === undefined) delete process.env.GM_VAULT_DEFAULT_CONFIG_V2;
  else process.env.GM_VAULT_DEFAULT_CONFIG_V2 = originalDefaultToken;
});

describe('get-default-token Netlify function', () => {
  it('exports an ESM handler and handles CORS preflight', async () => {
    const response = await handler(event('OPTIONS'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('reports unavailable when no default is configured', async () => {
    delete process.env.GM_VAULT_DEFAULT_CONFIG_V2;

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ available: false });
  });

  it('reports availability without exposing the configured credential', async () => {
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = 'default-token';

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ available: true });
    expect(JSON.stringify(response)).not.toContain('default-token');
  });

  it('rejects unsupported methods', async () => {
    const response = await handler(event('POST'));

    expect(response.statusCode).toBe(405);
  });
});
