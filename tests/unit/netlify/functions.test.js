import { describe, expect, it, jest } from '@jest/globals';
import { handler as notionHandler } from '../../../netlify/functions/notion-api.js';
import { handler as defaultTokenHandler } from '../../../netlify/functions/get-default-token.js';
import { handler as debugModeHandler } from '../../../netlify/functions/get-debug-mode.js';
import { handler as mixpanelTokenHandler } from '../../../netlify/functions/get-mixpanel-token.js';

const event = (httpMethod, queryStringParameters = {}) => ({
  httpMethod,
  headers: {},
  queryStringParameters
});

describe('Netlify function ES module exports', () => {
  it.each([
    ['notion-api', notionHandler],
    ['get-default-token', defaultTokenHandler],
    ['get-debug-mode', debugModeHandler],
    ['get-mixpanel-token', mixpanelTokenHandler]
  ])('%s exports a callable handler', (_name, handler) => {
    expect(typeof handler).toBe('function');
  });

  it.each([
    ['notion-api', notionHandler],
    ['get-default-token', defaultTokenHandler],
    ['get-debug-mode', debugModeHandler],
    ['get-mixpanel-token', mixpanelTokenHandler]
  ])('%s handles CORS preflight without crashing', async (_name, handler) => {
    const response = await handler(event('OPTIONS'), {});
    expect(response.statusCode).toBe(200);
  });

  it('notion-api returns a controlled error when no token is provided', async () => {
    const response = await notionHandler(event('GET'), {});
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/No token provided/);
  });

  it('children devuelve contención real y excluye link_to_page', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: 'page', type: 'child_page' },
          { id: 'link', type: 'link_to_page' },
          { id: 'database', type: 'child_database' },
          { id: 'paragraph', type: 'paragraph' }
        ],
        has_more: false,
        next_cursor: null
      })
    });

    try {
      const response = await notionHandler(event('GET', {
        action: 'children',
        pageId: 'root-page',
        token: 'test-token'
      }), {});
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.results.map(block => block.type)).toEqual([
        'child_page',
        'child_database'
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    ['get-default-token', defaultTokenHandler],
    ['get-debug-mode', debugModeHandler],
    ['get-mixpanel-token', mixpanelTokenHandler]
  ])('%s rejects unsupported methods without crashing', async (_name, handler) => {
    const response = await handler(event('POST'), {});
    expect(response.statusCode).toBe(405);
  });
});
