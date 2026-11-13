import { describe, expect, it, jest } from '@jest/globals';
import { NotionService } from '../../../js/services/NotionService.js';

const PERSONAL_SECRET = 'ntn_personal_client_sentinel';
const DEMO_ROOT_ID = '2d8d4856c90e80f1b4e4ecff59e61dd5';

function successfulResponse(data = { results: [] }) {
  return {
    ok: true,
    status: 200,
    json: async () => data
  };
}

function serviceWithToken(token = PERSONAL_SECRET) {
  const service = new NotionService();
  service.storageService = {
    getUserToken: jest.fn(() => token)
  };
  service._fetchWithRetry = jest.fn().mockResolvedValue(successfulResponse());
  return service;
}

describe('NotionService credential transport', () => {
  it('checks only default availability and never requests a credential payload', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(successfulResponse({
      available: true,
      token: 'a_field_the_client_must_ignore'
    }));
    const service = new NotionService();

    try {
      await expect(service._hasDefaultAccess()).resolves.toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/.netlify/functions/get-default-token',
        { method: 'GET', cache: 'no-store' }
      );
      expect(service._defaultAccessAvailable).toBe(true);
      expect(service).not.toHaveProperty('_defaultToken');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('sends the personal token in X-Notion-Token and never in the URL', async () => {
    const service = serviceWithToken();

    await expect(service.fetchBlocks('page with spaces', false)).resolves.toEqual([]);

    expect(service._fetchWithRetry).toHaveBeenCalledTimes(1);
    const [url, options] = service._fetchWithRetry.mock.calls[0];
    const parsedUrl = new URL(url, 'https://gm-vault.test');
    expect(parsedUrl.searchParams.get('pageId')).toBe('page with spaces');
    expect(parsedUrl.searchParams.has('token')).toBe(false);
    expect(url).not.toContain(PERSONAL_SECRET);
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Notion-Token': PERSONAL_SECRET
    });
  });

  it('uses only the default-access selector when there is no personal token', async () => {
    const service = serviceWithToken(null);
    service._hasDefaultAccess = jest.fn().mockResolvedValue(true);
    service._fetchWithRetry.mockResolvedValue(successfulResponse({
      id: DEMO_ROOT_ID,
      properties: {}
    }));

    await service.fetchPageInfo(DEMO_ROOT_ID, false);

    expect(service._hasDefaultAccess).toHaveBeenCalledTimes(1);
    const [url, options] = service._fetchWithRetry.mock.calls[0];
    expect(new URL(url, 'https://gm-vault.test').searchParams.has('token')).toBe(false);
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-GM-Vault-Default': '1'
    });
  });

  it('keeps credentials out of every Notion proxy URL', async () => {
    const operations = [
      ['blocks', service => service.fetchBlocks('page-id', false)],
      ['page info', service => service.fetchPageInfo('page-id', false)],
      ['child blocks', service => service.fetchChildBlocks('block-id', false)],
      ['validation', service => service.validateToken()],
      ['workspace search', service => service.searchWorkspacePages('dragon')],
      ['structural children', service => service.fetchChildPages('page-id')],
      ['database rows', service => service.fetchDatabasePages('database-id')]
    ];

    for (const [, invoke] of operations) {
      const service = serviceWithToken();
      await invoke(service);

      expect(service._fetchWithRetry).toHaveBeenCalledTimes(1);
      const [url, options] = service._fetchWithRetry.mock.calls[0];
      expect(url).not.toContain(PERSONAL_SECRET);
      expect(new URL(url, 'https://gm-vault.test').searchParams.has('token')).toBe(false);
      expect(options.headers['X-Notion-Token']).toBe(PERSONAL_SECRET);
    }
  });

  it('does not fall back to default access for private workspace operations', async () => {
    const service = serviceWithToken(null);
    service._hasDefaultAccess = jest.fn().mockResolvedValue(true);

    await expect(service.searchWorkspacePages()).rejects.toThrow(/No Notion token configured/i);
    await expect(service.fetchChildPages('page-id')).rejects.toThrow(/No Notion token configured/i);
    await expect(service.validateToken()).resolves.toBe(false);

    expect(service._hasDefaultAccess).not.toHaveBeenCalled();
    expect(service._fetchWithRetry).not.toHaveBeenCalled();
  });
});
