import { describe, it, expect, jest } from '@jest/globals';
import { installBetaMigrationBridge } from '../../js/services/BetaMigrationBridge.js';
import { BETA_ORIGIN, PRODUCTION_ORIGIN, MIGRATION_PROTOCOL, VAULT_PREFIX, TOKEN_KEY } from '../../js/config/betaMigration.js';

function setup() {
  const listeners = new Set();
  const parent = { postMessage: jest.fn() };
  const host = { location: { origin: BETA_ORIGIN }, parent, localStorage,
    addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const stop = installBetaMigrationBridge({ host });
  const data = { protocol: MIGRATION_PROTOCOL, type: 'read', nonce: 'a'.repeat(32), roomId: 'room-a', includeToken: true };
  const send = overrides => listeners.forEach(fn => fn({ origin: PRODUCTION_ORIGIN, source: parent, data, ...overrides }));
  return { host, parent, data, listeners, stop, send };
}

describe('read-only beta bridge', () => {
  it('reads only the requested room and optional token and never edits beta storage', () => {
    localStorage.setItem(VAULT_PREFIX + 'room-a', '{"categories":[]}');
    localStorage.setItem(VAULT_PREFIX + 'other-room', 'private');
    localStorage.setItem(TOKEN_KEY, 'beta-secret');
    const env = setup();
    localStorage.setItem.mockClear();
    env.send({});
    expect(localStorage.getItem.mock.calls.map(([key]) => key)).toEqual([VAULT_PREFIX + 'room-a', TOKEN_KEY]);
    expect(env.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', token: 'beta-secret', roomId: 'room-a' }), PRODUCTION_ORIGIN);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    env.stop();
    expect(env.listeners.size).toBe(0);
  });

  it('uses the legacy default only if the room entry is absent; an empty entry is not absent', () => {
    localStorage.setItem(VAULT_PREFIX + 'default', '{"categories":[]}');
    const env = setup();
    env.send({ data: { ...env.data, includeToken: false } });
    expect(env.parent.postMessage.mock.calls[0][0]).toMatchObject({ status: 'ok', sourceKind: 'default', token: null });
    expect(localStorage.getItem).not.toHaveBeenCalledWith(TOKEN_KEY);
    localStorage.setItem(VAULT_PREFIX + 'room-a', '');
    env.send({});
    expect(env.parent.postMessage.mock.calls[1][0]).toMatchObject({ status: 'ok', sourceKind: 'room', raw: '' });
  });

  it('rejects untrusted origins, sibling windows, malformed requests and unresolved rooms before reading', () => {
    const env = setup();
    env.send({ origin: 'https://evil.example' });
    env.send({ origin: 'https://owlbear-gm-vault.netlify.app.evil.example' });
    env.send({ source: {} });
    env.send({ data: { ...env.data, roomId: 'default' } });
    env.send({ data: { ...env.data, nonce: 'guess' } });
    env.send({ data: { ...env.data, includeToken: 'yes' } });
    env.send({ data: { ...env.data, protocol: 'other' } });
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(env.parent.postMessage).not.toHaveBeenCalled();
  });

  it('reports denied storage without returning exceptions or partial credentials', () => {
    const env = setup();
    localStorage.getItem.mockImplementationOnce(() => { throw Error('private-secret'); });
    env.send({});
    const reply = env.parent.postMessage.mock.calls[0][0];
    expect(reply.status).toBe('unavailable');
    expect(JSON.stringify(reply)).not.toContain('private-secret');
    expect(reply.raw).toBeUndefined();
  });

  it('does not enable the bridge on production, another preview, or top-level beta', () => {
    for (const origin of [PRODUCTION_ORIGIN, 'https://deploy-preview-11--owlbear-gm-vault.netlify.app']) {
      const host = { location: { origin }, addEventListener: jest.fn() };
      installBetaMigrationBridge({ host });
      expect(host.addEventListener).not.toHaveBeenCalled();
    }
    const host = { location: { origin: BETA_ORIGIN }, addEventListener: jest.fn() };
    host.parent = host;
    installBetaMigrationBridge({ host });
    expect(host.addEventListener).not.toHaveBeenCalled();
  });
});
