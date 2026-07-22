import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { handler as notionHandler } from '../../../netlify/functions/notion-api.js';
import { handler as defaultTokenHandler } from '../../../netlify/functions/get-default-token.js';
import { handler as debugModeHandler } from '../../../netlify/functions/get-debug-mode.js';
import { handler as mixpanelTokenHandler } from '../../../netlify/functions/get-mixpanel-token.js';

const event = (httpMethod, queryStringParameters = {}, headers = {}) => ({
  httpMethod,
  headers,
  queryStringParameters
});

const restoreEnv = (name, value) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

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
        pageId: 'root-page'
      }, {
        'X-Notion-Token': 'test-token'
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

describe('Notion proxy security contract', () => {
  const DEFAULT_SECRET = 'ntn_v2_server_only_sentinel';
  const PERSONAL_SECRET = 'ntn_personal_header_sentinel';
  const DEMO_ROOT_ID = '2d8d4856c90e80f1b4e4ecff59e61dd5';

  it('get-default-token only exposes availability and never the V2 credential', async () => {
    const originalV2 = process.env.GM_VAULT_DEFAULT_CONFIG_V2;
    const originalLegacy = process.env.GM_VAULT_DEFAULT_CONFIG;
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = DEFAULT_SECRET;
    process.env.GM_VAULT_DEFAULT_CONFIG = 'legacy_secret_must_be_ignored';

    try {
      const availableResponse = await defaultTokenHandler(event('GET'), {});

      expect(availableResponse.statusCode).toBe(200);
      expect(JSON.parse(availableResponse.body)).toEqual({ available: true });
      expect(JSON.stringify(availableResponse)).not.toContain(DEFAULT_SECRET);
      expect(JSON.stringify(availableResponse)).not.toContain('legacy_secret_must_be_ignored');
      expect(availableResponse.headers['Cache-Control']).toBe('no-store');

      delete process.env.GM_VAULT_DEFAULT_CONFIG_V2;
      const legacyOnlyResponse = await defaultTokenHandler(event('GET'), {});
      expect(JSON.parse(legacyOnlyResponse.body)).toEqual({ available: false });
    } finally {
      restoreEnv('GM_VAULT_DEFAULT_CONFIG_V2', originalV2);
      restoreEnv('GM_VAULT_DEFAULT_CONFIG', originalLegacy);
    }
  });

  it('rejects credentials in query parameters before calling Notion', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn();

    try {
      const response = await notionHandler(event('GET', {
        pageId: DEMO_ROOT_ID,
        token: PERSONAL_SECRET
      }, {
        'X-Notion-Token': PERSONAL_SECRET
      }), {});

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toMatch(/not accepted in query parameters/i);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(response)).not.toContain(PERSONAL_SECRET);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('forwards a personal header as Bearer without putting it in a URL', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] })
    });

    try {
      const response = await notionHandler(event('GET', {
        pageId: 'personal-page'
      }, {
        'x-notion-token': PERSONAL_SECRET
      }), {});

      expect(response.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).not.toContain(PERSONAL_SECRET);
      expect(options.headers.Authorization).toBe(`Bearer ${PERSONAL_SECRET}`);
      expect(JSON.stringify(response)).not.toContain(PERSONAL_SECRET);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('uses V2 only inside the server for an allowlisted demo root', async () => {
    const originalV2 = process.env.GM_VAULT_DEFAULT_CONFIG_V2;
    const originalFetch = global.fetch;
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = DEFAULT_SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: DEMO_ROOT_ID, object: 'page' })
    });

    try {
      const response = await notionHandler(event('GET', {
        pageId: DEMO_ROOT_ID,
        type: 'page'
      }, {
        'X-GM-Vault-Default': '1'
      }), {});

      expect(response.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`https://api.notion.com/v1/pages/${DEMO_ROOT_ID}`);
      expect(url).not.toContain(DEFAULT_SECRET);
      expect(options.headers.Authorization).toBe(`Bearer ${DEFAULT_SECRET}`);
      expect(JSON.stringify(response)).not.toContain(DEFAULT_SECRET);
    } finally {
      restoreEnv('GM_VAULT_DEFAULT_CONFIG_V2', originalV2);
      global.fetch = originalFetch;
    }
  });

  it('allows nested demo blocks only after verifying their ancestry', async () => {
    const originalV2 = process.env.GM_VAULT_DEFAULT_CONFIG_V2;
    const originalFetch = global.fetch;
    const childBlockId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = DEFAULT_SECRET;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: childBlockId,
          object: 'block',
          parent: { type: 'page_id', page_id: DEMO_ROOT_ID }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      });

    try {
      const response = await notionHandler(event('GET', {
        pageId: childBlockId
      }, {
        'X-GM-Vault-Default': '1'
      }), {});

      expect(response.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[0][0]).toBe(
        `https://api.notion.com/v1/blocks/${childBlockId}`
      );
      expect(global.fetch.mock.calls[1][0]).toBe(
        `https://api.notion.com/v1/blocks/${childBlockId}/children`
      );
      for (const [, options] of global.fetch.mock.calls) {
        expect(options.headers.Authorization).toBe(`Bearer ${DEFAULT_SECRET}`);
      }
      expect(JSON.stringify(response)).not.toContain(DEFAULT_SECRET);
    } finally {
      restoreEnv('GM_VAULT_DEFAULT_CONFIG_V2', originalV2);
      global.fetch = originalFetch;
    }
  });

  it('does not permit workspace search through default access', async () => {
    const originalV2 = process.env.GM_VAULT_DEFAULT_CONFIG_V2;
    const originalFetch = global.fetch;
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = DEFAULT_SECRET;
    global.fetch = jest.fn();

    try {
      const response = await notionHandler(event('GET', {
        action: 'search',
        query: 'private'
      }, {
        'X-GM-Vault-Default': '1'
      }), {});

      expect(response.statusCode).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(response)).not.toContain(DEFAULT_SECRET);
    } finally {
      restoreEnv('GM_VAULT_DEFAULT_CONFIG_V2', originalV2);
      global.fetch = originalFetch;
    }
  });

  it('rejects a non-demo resource after checking its ancestry server-side', async () => {
    const originalV2 = process.env.GM_VAULT_DEFAULT_CONFIG_V2;
    const originalFetch = global.fetch;
    const unrelatedPageId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.GM_VAULT_DEFAULT_CONFIG_V2 = DEFAULT_SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'object_not_found' })
    });

    try {
      const response = await notionHandler(event('GET', {
        pageId: unrelatedPageId,
        type: 'page'
      }, {
        'X-GM-Vault-Default': '1'
      }), {});

      expect(response.statusCode).toBe(403);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toBe(
        `https://api.notion.com/v1/pages/${unrelatedPageId}`
      );
      expect(JSON.stringify(response)).not.toContain(DEFAULT_SECRET);
    } finally {
      restoreEnv('GM_VAULT_DEFAULT_CONFIG_V2', originalV2);
      global.fetch = originalFetch;
    }
  });
});

describe('Netlify static asset cache policy', () => {
  const readProjectFile = relativePath => readFileSync(
    new URL(`../../../${relativePath}`, import.meta.url),
    'utf8'
  );

  it('obliga a revalidar JavaScript, CSS y HTML sin versionar', () => {
    const netlifyConfig = readProjectFile('netlify.toml');

    expect(netlifyConfig).toMatch(
      /for = "\/js\/\*\.js"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/
    );
    expect(netlifyConfig).toMatch(
      /for = "\/css\/\*\.css"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/
    );
    expect(netlifyConfig).toMatch(
      /for = "\/html\/\*\.html"[\s\S]*?Cache-Control = "public, max-age=0, must-revalidate"/
    );
  });

  it('no construye URLs con credenciales de Notion en el cliente', () => {
    const clientSources = [
      readProjectFile('js/services/NotionService.js'),
      readProjectFile('js/utils/logger.js'),
      readProjectFile('js/index.js')
    ].join('\n');

    expect(clientSources).not.toMatch(/[?&]token=/);
  });

  it('fuerza una URL nueva para los módulos que tuvieron caché de siete días', () => {
    const buildTag = '20260722-3';
    const indexHtml = readProjectFile('index.html');
    const mainJs = readProjectFile('js/main.js');
    const controllerJs = readProjectFile('js/controllers/ExtensionController.js');
    const notionServiceJs = readProjectFile('js/services/NotionService.js');
    const storageServiceJs = readProjectFile('js/services/StorageService.js');
    const parserJs = readProjectFile('js/parsers/ConfigParser.js');
    const builderJs = readProjectFile('js/builders/ConfigBuilder.js');

    expect(indexHtml).toContain(`href="css/app.css?v=${buildTag}"`);
    expect(indexHtml).toContain(`href="css/notion-markdown.css?v=${buildTag}"`);
    expect(indexHtml).toContain(`src="js/main.js?v=${buildTag}"`);
    expect(mainJs).toContain(`./controllers/ExtensionController.js?v=${buildTag}`);
    expect(mainJs).toContain(`2.1.0-beta.${buildTag}`);
    expect(controllerJs).toContain(`../services/NotionService.js?v=${buildTag}`);
    expect(controllerJs).toContain(`../services/StorageService.js?v=${buildTag}`);
    expect(controllerJs).toContain(`../utils/logger.js?v=${buildTag}`);
    expect(controllerJs).toContain(`../renderers/NotionRenderer.js?v=${buildTag}`);
    expect(controllerJs).toContain(`../utils/helpers.js?v=${buildTag}`);
    expect(storageServiceJs).toContain(`../utils/helpers.js?v=${buildTag}`);
    expect(notionServiceJs).toContain(`../utils/logger.js?v=${buildTag}`);
    expect(parserJs).toContain(`../models/Config.js?v=${buildTag}`);
    expect(builderJs).toContain(`../models/Config.js?v=${buildTag}`);
  });
});
