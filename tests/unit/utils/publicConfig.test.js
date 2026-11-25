import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchPublicConfig } from '../../../js/utils/publicConfig.js';

const response = data => ({ ok: true, json: async () => data });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(response({ available: true }));
});
afterEach(() => jest.restoreAllMocks());

describe('public configuration request cache', () => {
  it('shares concurrent requests and reuses only sanitized data on subsequent calls', async () => {
    let resolve;
    fetch.mockReturnValue(new Promise(done => { resolve = done; }));
    const first = fetchPublicConfig('get-default-token');
    const second = fetchPublicConfig('get-default-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response({ available: true, token: 'private-demo-secret' }));
    expect(await first).toEqual({ available: true });
    expect(await second).toEqual({ available: true });
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessionStorage)).not.toContain('private-demo-secret');
    expect(fetch).toHaveBeenCalledWith('/.netlify/functions/get-default-token', { method: 'GET', cache: 'no-store' });
  });

  it('refreshes at five minutes, and does not accept future timestamps', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
    await fetchPublicConfig('get-default-token');
    now.mockReturnValue(1299999);
    await fetchPublicConfig('get-default-token');
    expect(fetch).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1300000);
    await fetchPublicConfig('get-default-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1200000);
    await fetchPublicConfig('get-default-token');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['HTTP failure', () => Promise.resolve({ ok: false })],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['invalid JSON', () => Promise.resolve({ ok: true, json: async () => { throw new Error('JSON'); } })],
    ['invalid payload', () => Promise.resolve(response({ token: 'secret' }))]
  ])('does not cache %s and allows retry', async (_name, failure) => {
    fetch.mockImplementationOnce(failure);
    await expect(fetchPublicConfig('get-default-token')).rejects.toThrow();
    expect(sessionStorage.length).toBe(0);
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still succeeds when embedded-browser storage is unavailable', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stores only public analytics fields and keeps the two endpoints separate', async () => {
    fetch.mockResolvedValueOnce(response({ enabled: true, token: 'public-project-token',
      environment: 'production', deployContext: 'production', isBeta: false, privateKey: 'secret' }));
    expect(await fetchPublicConfig('get-mixpanel-token')).toEqual({ enabled: true, token: 'public-project-token',
      environment: 'production', deployContext: 'production', isBeta: false });
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sessionStorage)).not.toContain('privateKey');
    expect(sessionStorage.length).toBe(2);
  });

  it('recovers from corrupt storage', async () => {
    await fetchPublicConfig('get-default-token');
    sessionStorage.setItem(sessionStorage.key(0), '{invalid');
    expect(await fetchPublicConfig('get-default-token')).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never fetches or caches content, authentication or backup endpoints', async () => {
    for (const name of ['notion', 'cloud-backup', '../get-default-token']) {
      await expect(fetchPublicConfig(name)).rejects.toThrow('Not a public configuration endpoint');
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});
