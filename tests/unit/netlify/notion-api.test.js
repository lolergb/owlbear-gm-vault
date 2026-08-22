import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { handler } from '../../../netlify/functions/notion-api.js';

const originalFetch = global.fetch;

const event = ({
  httpMethod = 'GET',
  headers = {},
  queryStringParameters = {}
} = {}) => ({
  httpMethod,
  headers,
  queryStringParameters
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('notion-api Netlify function', () => {
  it('exports an ESM handler and handles CORS preflight', async () => {
    const response = await handler(event({ httpMethod: 'OPTIONS' }));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
  });

  it('returns a client error when no Notion token is provided', async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: expect.stringContaining('No token provided')
    });
  });

  it('proxies workspace searches to Notion with the supplied token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] })
    });

    const response = await handler(event({
      queryStringParameters: {
        action: 'search',
        token: 'test-notion-token',
        filter: 'page'
      }
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ results: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.notion.com/v1/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-notion-token'
        })
      })
    );
  });
});
