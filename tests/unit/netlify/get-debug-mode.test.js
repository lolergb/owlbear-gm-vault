import { afterEach, describe, expect, it } from '@jest/globals';
import { handler } from '../../../netlify/functions/get-debug-mode.js';

const originalDebugMode = process.env.DEBUG_MODE;
const originalContext = process.env.CONTEXT;

const event = ({ httpMethod = 'GET', token } = {}) => ({
  httpMethod,
  queryStringParameters: token ? { token } : {}
});

afterEach(() => {
  if (originalDebugMode === undefined) delete process.env.DEBUG_MODE;
  else process.env.DEBUG_MODE = originalDebugMode;

  if (originalContext === undefined) delete process.env.CONTEXT;
  else process.env.CONTEXT = originalContext;
});

describe('get-debug-mode Netlify function', () => {
  it('exports an ESM handler and handles CORS preflight', async () => {
    const response = await handler(event({ httpMethod: 'OPTIONS' }));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('returns debug disabled by default', async () => {
    delete process.env.DEBUG_MODE;
    delete process.env.CONTEXT;

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ debug: false });
  });

  it('enables debug in beta regardless of a Notion token, but never in production', async () => {
    process.env.DEBUG_MODE = 'true';
    process.env.CONTEXT = 'deploy-preview';
    const beta = await handler(event({ token: 'arbitrary-token' }));

    process.env.CONTEXT = 'production';
    const production = await handler(event({ token: 'arbitrary-token' }));

    expect(JSON.parse(beta.body)).toEqual({ debug: true });
    expect(JSON.parse(production.body)).toEqual({ debug: false });
  });

  it('rejects unsupported methods', async () => {
    const response = await handler(event({ httpMethod: 'POST' }));

    expect(response.statusCode).toBe(405);
  });
});
