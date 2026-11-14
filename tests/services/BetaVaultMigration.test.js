import { describe, it, expect, jest } from '@jest/globals';
import { BetaVaultMigration, readBetaVault } from '../../js/services/BetaVaultMigration.js';
import { BETA_ORIGIN, PRODUCTION_ORIGIN, MIGRATION_PROTOCOL, MIGRATION_PREFIX, VAULT_PREFIX, TOKEN_KEY } from '../../js/config/betaMigration.js';

const roomId = 'test-room';
const key = VAULT_PREFIX + roomId;
const marker = MIGRATION_PREFIX + roomId;
const beta = JSON.stringify({ categories: [{ id: 'a', name: 'Campaign', pages: [
  { id: 'secret', name: 'GM notes', url: 'https://example.com', visibleToPlayers: false }
], unknownField: 'preserve' }], order: [] }, null, 2);
const existing = '{"categories":[]}';
function memory(initial = {}) {
  const data = { ...initial };
  return { data, getItem: jest.fn(key => data[key] ?? null), setItem: jest.fn((key, value) => { data[key] = value; }) };
}
function setup(initial = {}, options = {}) {
  const storage = memory(initial);
  const host = { localStorage: storage, location: { origin: PRODUCTION_ORIGIN }, crypto, navigator: {} };
  const readSource = jest.fn(async () => ({ status: 'ok', raw: beta, token: 'beta-token', sourceKind: 'room' }));
  const choose = jest.fn(async () => 'import');
  const verifyContext = jest.fn(async () => true);
  const service = new BetaVaultMigration({ host, readSource, choose, verifyContext, ...options });
  return { storage, host, readSource, choose, verifyContext, service };
}

describe('beta vault recovery persistence', () => {
  it('copies exact bytes and a missing token, verifies writes, and is idempotent after subsequent edits', async () => {
    const env = setup();
    expect(await env.service.recover(roomId)).toMatchObject({ status: 'imported', tokenStatus: 'copied', marked: true });
    expect(env.storage.data[key]).toBe(beta);
    expect(env.storage.data[TOKEN_KEY]).toBe('beta-token');
    expect(env.choose).not.toHaveBeenCalled();
    env.storage.data[key] = existing;
    expect(await env.service.recover(roomId)).toEqual({ status: 'done' });
    expect(env.storage.data[key]).toBe(existing);
    expect(env.readSource).toHaveBeenCalledTimes(1);
    expect(env.storage.data[marker]).not.toContain('beta-token');
    expect(env.storage.data[marker]).not.toContain('GM notes');
  });

  it.each([key, VAULT_PREFIX + 'default'])('protects even an intentionally empty vault at %s and backs up its exact bytes', async existingKey => {
    const env = setup({ [existingKey]: existing, [TOKEN_KEY]: 'current-token' });
    const result = await env.service.recover(roomId);
    expect(result.status).toBe('imported');
    expect(env.choose).toHaveBeenCalledTimes(1);
    expect(env.storage.data[result.backupKey]).toBe(existing);
    expect(env.storage.data[key]).toBe(beta);
    expect(env.storage.data[TOKEN_KEY]).toBe('current-token');
    expect(env.readSource).toHaveBeenCalledWith({ roomId, includeToken: false });
    const writes = env.storage.setItem.mock.calls.map(call => call[0]);
    expect(writes.indexOf(result.backupKey)).toBeLessThan(writes.indexOf(key));
    if (existingKey !== key) expect(env.storage.data[existingKey]).toBe(existing);
  });

  it.each(['keep', 'later'])('never writes vault or token when choosing %s', async choice => {
    const env = setup({ [key]: existing });
    env.choose.mockResolvedValue(choice);
    expect((await env.service.recover(roomId)).status).toBe(choice === 'keep' ? 'kept' : 'deferred');
    expect(env.storage.data[key]).toBe(existing);
    expect(env.storage.data[TOKEN_KEY]).toBeUndefined();
    expect(Boolean(env.storage.data[marker])).toBe(choice === 'keep');
  });

  it('recognizes the same JSON despite formatting/object-key order and only copies the missing token', async () => {
    const raw = JSON.stringify(JSON.parse(beta));
    const env = setup({ [key]: raw });
    expect((await env.service.recover(roomId)).status).toBe('identical');
    expect(env.storage.data[key]).toBe(raw);
    expect(env.storage.setItem.mock.calls.some(([k]) => k === key)).toBe(false);
    expect(env.choose).not.toHaveBeenCalled();
    expect(env.storage.data[TOKEN_KEY]).toBe('beta-token');
  });

  it('allows an explicit retry after keeping production and preserves its current version', async () => {
    const env = setup({ [key]: existing, [marker]: 'settled' });
    expect((await env.service.recover(roomId, { manual: true })).status).toBe('imported');
    expect(env.choose).toHaveBeenCalled();
  });

  it.each(['missing', 'unavailable', 'too-large'])('makes no writes for source status %s', async status => {
    const env = setup();
    env.readSource.mockResolvedValue({ status });
    expect(await env.service.recover(roomId)).toEqual({ status });
    expect(env.storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['{broken', '{}', '{"categories":[{"name":"x","pages":"bad"}]}'])('rejects invalid source %s', async raw => {
    const env = setup();
    env.readSource.mockResolvedValue({ status: 'ok', raw });
    expect(await env.service.recover(roomId)).toEqual({ status: 'invalid' });
    expect(env.storage.setItem).not.toHaveBeenCalled();
  });

  it('backs up an unreadable production vault instead of treating it as empty', async () => {
    const env = setup({ [key]: '{bad' });
    const result = await env.service.recover(roomId);
    expect(env.choose).toHaveBeenCalled();
    expect(env.storage.data[result.backupKey]).toBe('{bad');
  });

  it.each(['throw', 'mismatch'])('does not replace production when the backup cannot be verified (%s)', async failure => {
    const env = setup({ [key]: existing });
    env.storage.setItem.mockImplementation((k, value) => {
      if (k.includes('backup:')) { if (failure === 'throw') throw Error('quota'); return; }
      env.storage.data[k] = value;
    });
    expect((await env.service.recover(roomId)).status).toBe('write-failed');
    expect(env.storage.data[key]).toBe(existing);
    expect(env.storage.data[marker]).toBeUndefined();
  });

  it('does not mark completion or copy token if the vault write fails', async () => {
    const env = setup();
    env.storage.setItem.mockImplementation(() => { throw Error('quota'); });
    expect((await env.service.recover(roomId)).status).toBe('write-failed');
    expect(env.storage.data).toEqual({});
  });

  it('does not mark completion on readback mismatch', async () => {
    const env = setup();
    env.storage.setItem.mockImplementation(() => {});
    expect((await env.service.recover(roomId)).status).toBe('write-failed');
    expect(env.storage.data[marker]).toBeUndefined();
  });

  it('reports successful vault recovery separately from a token quota failure and allows retry', async () => {
    const env = setup();
    env.storage.setItem.mockImplementation((k, v) => { if (k === TOKEN_KEY) throw Error('quota'); env.storage.data[k] = v; });
    expect(await env.service.recover(roomId)).toMatchObject({ status: 'imported', tokenStatus: 'failed', marked: false });
    expect(env.storage.data[key]).toBe(beta);
    expect(env.storage.data[marker]).toBeUndefined();
  });

  it('reports a verified vault as imported even if only the marker write fails', async () => {
    const env = setup();
    env.storage.setItem.mockImplementation((k, v) => { if (k === marker) throw Error('quota'); env.storage.data[k] = v; });
    expect(await env.service.recover(roomId)).toMatchObject({ status: 'imported', marked: false });
    expect((await env.service.recover(roomId)).status).toBe('identical');
  });

  it.each(['vault', 'default', 'role', 'abort', 'token'])('rechecks %s after the choice', async change => {
    const abort = new AbortController();
    const env = setup({ [key]: existing }, { signal: abort.signal });
    env.choose.mockImplementation(async () => {
      if (change === 'vault') env.storage.data[key] = '{"categories":[],"pages":[]}';
      if (change === 'default') env.storage.data[VAULT_PREFIX + 'default'] = existing;
      if (change === 'role') env.verifyContext.mockResolvedValue(false);
      if (change === 'abort') abort.abort();
      if (change === 'token') env.storage.data[TOKEN_KEY] = 'new-production-token';
      return 'import';
    });
    const result = await env.service.recover(roomId);
    if (change === 'token') {
      expect(result.status).toBe('imported');
      expect(env.storage.data[TOKEN_KEY]).toBe('new-production-token');
    } else {
      expect(['changed', 'ineligible']).toContain(result.status);
      expect(env.storage.setItem).not.toHaveBeenCalled();
    }
  });

  it('serializes commits with a per-room browser lock when available', async () => {
    const env = setup();
    env.host.navigator.locks = { request: jest.fn(async (_name, commit) => commit()) };
    expect((await env.service.recover(roomId)).status).toBe('imported');
    expect(env.host.navigator.locks.request).toHaveBeenCalledWith(marker, expect.any(Function));
  });

  it('does not commit when the controller closes during the final asynchronous role check', async () => {
    const abort = new AbortController();
    const env = setup({}, { signal: abort.signal });
    env.verifyContext.mockResolvedValueOnce(true).mockImplementationOnce(async () => { abort.abort(); return true; });
    expect((await env.service.recover(roomId)).status).toBe('ineligible');
    expect(env.storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['default', '', '../another-room'])('refuses unresolved or invalid room %s before reading source', async id => {
    const env = setup();
    expect((await env.service.recover(id)).status).toBe('ineligible');
    expect(env.readSource).not.toHaveBeenCalled();
  });

  it('never starts from a preview or for an unverified player', async () => {
    const env = setup();
    env.host.location.origin = BETA_ORIGIN;
    expect((await env.service.recover(roomId)).status).toBe('ineligible');
    env.host.location.origin = PRODUCTION_ORIGIN;
    env.verifyContext.mockResolvedValue(false);
    expect((await env.service.recover(roomId)).status).toBe('ineligible');
    expect(env.readSource).not.toHaveBeenCalled();
  });
});

describe('receiver frame isolation', () => {
  function transport() {
    const listeners = new Set();
    const child = { postMessage: jest.fn() };
    const frame = { contentWindow: child, remove: jest.fn() };
    const host = { crypto, document: { createElement: () => frame, body: { append: jest.fn(() => frame.onload()) } },
      addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn),
      setTimeout, clearTimeout };
    const pending = readBetaVault({ roomId, includeToken: true, host, timeout: 20 });
    const request = child.postMessage.mock.calls[0][0];
    const reply = { ...request, type: 'result', status: 'ok', raw: beta, sourceKind: 'room', token: 'secret' };
    const send = overrides => listeners.forEach(fn => fn({ origin: BETA_ORIGIN, source: child, data: reply, ...overrides }));
    return { pending, frame, listeners, reply, send, child };
  }

  it('ignores wrong origin, frame, nonce, room and payload; accepts only the matching reply then cleans up', async () => {
    const env = transport();
    env.send({ origin: 'https://evil.example' });
    env.send({ source: {} });
    env.send({ data: { ...env.reply, nonce: 'bad' } });
    env.send({ data: { ...env.reply, roomId: 'another-room' } });
    env.send({ data: { ...env.reply, token: {} } });
    expect(env.frame.remove).not.toHaveBeenCalled();
    env.send({});
    expect(await env.pending).toMatchObject({ status: 'ok', raw: beta });
    expect(env.frame.remove).toHaveBeenCalledTimes(1);
    expect(env.listeners.size).toBe(0);
    expect(env.child.postMessage.mock.calls[0][1]).toBe(BETA_ORIGIN);
    expect(env.child.postMessage.mock.calls[0][0].protocol).toBe(MIGRATION_PROTOCOL);
  });

  it('times out and removes the frame/listener without changing storage', async () => {
    const env = transport();
    expect(await env.pending).toEqual({ status: 'unavailable' });
    expect(env.frame.remove).toHaveBeenCalledTimes(1);
    expect(env.listeners.size).toBe(0);
  });
});
