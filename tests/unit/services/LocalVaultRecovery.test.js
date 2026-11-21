import { describe, expect, it, jest } from '@jest/globals';
import { LocalVaultRecovery } from '../../../js/services/LocalVaultRecovery.js';

const old = '{ "categories": [], "pages": [{"name":"Old","url":"https://old.test"}] }';
const next = { categories: [], pages: [{ name: 'New', url: 'https://new.test' }] };
const local = () => new LocalVaultRecovery(localStorage, 'test-room');

describe('verified local restore journal', () => {
  it('preserves original bytes and token and restores them on undo', () => {
    const recovery = local();
    localStorage.setItem(recovery.key, old);
    localStorage.setItem('notion-global-token', 'local-only');
    recovery.replace(next, recovery.capture());
    expect(JSON.parse(localStorage.getItem(recovery.key))).toEqual(next);
    expect(recovery.journal()).toMatchObject({ state: 'applied', beforeRaw: old });
    recovery.undo(recovery.capture());
    expect(localStorage.getItem(recovery.key)).toBe(old);
    expect(localStorage.getItem('notion-global-token')).toBe('local-only');
    expect(recovery.journal()).toBeNull();
  });
  it.each([null, '{"categories":[]}'])('distinguishes absent and deliberately empty destinations: %s', raw => {
    const recovery = local();
    localStorage.setItem('notion-pages-json-default', old);
    if (raw !== null) localStorage.setItem(recovery.key, raw);
    recovery.replace(next, recovery.capture());
    recovery.undo(recovery.capture());
    expect(localStorage.getItem(recovery.key)).toBe(raw);
    expect(localStorage.getItem('notion-pages-json-default')).toBe(old);
  });
  it('does not replace after another tab edits room or legacy storage', () => {
    const recovery = local();
    const captured = recovery.capture();
    localStorage.setItem('notion-pages-json-default', old);
    expect(() => recovery.replace(next, captured)).toThrow('changed');
    expect(localStorage.getItem(recovery.key)).toBeNull();
  });
  it('aborts before replacement when keeping the previous copy fails', () => {
    const recovery = local();
    localStorage.setItem(recovery.key, old);
    localStorage.setItem.mockImplementationOnce(() => { throw new Error('quota private-data'); });
    expect(() => recovery.replace(next, recovery.capture())).toThrow('could not be saved');
    expect(localStorage.getItem(recovery.key)).toBe(old);
  });
  it('retains a pending journal and original bytes after a destination write fails', () => {
    const recovery = local();
    localStorage.setItem(recovery.key, old);
    const implementation = localStorage.setItem.getMockImplementation();
    localStorage.setItem.mockImplementationOnce(implementation).mockImplementationOnce(() => { throw new Error('quota'); });
    expect(() => recovery.replace(next, recovery.capture())).toThrow('could not be saved');
    expect(localStorage.getItem(recovery.key)).toBe(old);
    expect(recovery.journal()).toMatchObject({ state: 'pending', beforeRaw: old });
    expect(() => recovery.replace(next, recovery.capture())).toThrow('needs recovery');
    recovery.undo(recovery.capture(), { interrupted: true });
    expect(recovery.journal()).toBeNull();
  });
  it('refuses undo if the user edited after restoring', () => {
    const recovery = local();
    recovery.replace(next, recovery.capture());
    localStorage.setItem(recovery.key, old);
    expect(() => recovery.undo(recovery.capture())).toThrow('changed');
    expect(localStorage.getItem(recovery.key)).toBe(old);
    expect(recovery.journal()).not.toBeNull();
  });
  it('protects an absent room that used a legacy vault if that legacy vault changed after restoring', () => {
    const recovery = local();
    localStorage.setItem('notion-pages-json-default', old);
    recovery.replace(next, recovery.capture());
    localStorage.setItem('notion-pages-json-default', JSON.stringify(next));
    expect(() => recovery.undo(recovery.capture())).toThrow('changed');
    expect(recovery.journal().beforeLegacy).toBe(old);
    expect(JSON.parse(localStorage.getItem(recovery.key))).toEqual(next);
  });
  it('allows keeping a checked destination after an interrupted operation', () => {
    const recovery = local();
    recovery.replace(next, recovery.capture());
    recovery.keepCurrent(recovery.capture());
    expect(recovery.journal()).toBeNull();
    expect(JSON.parse(localStorage.getItem(recovery.key))).toEqual(next);
  });
  it('rolls back when readback does not confirm the destination write', () => {
    const recovery = local();
    localStorage.setItem(recovery.key, old);
    const expected = recovery.capture();
    const read = localStorage.getItem.getMockImplementation();
    let destinationReads = 0;
    localStorage.getItem.mockImplementation(key => {
      // capture, final preflight, then destination verification.
      if (key === recovery.key && ++destinationReads === 3) return 'unconfirmed';
      return read(key);
    });
    expect(() => recovery.replace(next, expected)).toThrow('could not be saved');
    localStorage.getItem.mockImplementation(read);
    expect(localStorage.getItem(recovery.key)).toBe(old);
    expect(recovery.journal()).toMatchObject({ beforeRaw: old, state: 'pending' });
  });
  it('clearing local data removes recovery payloads but keeps the independent auth session', async () => {
    const { StorageService } = await import('../../../js/services/StorageService.js');
    const recovery = local();
    recovery.replace(next, recovery.capture());
    localStorage.setItem('gm-vault-cloud-auth-v1:project:preview', 'local-session');
    new StorageService().clearAllLocalData();
    expect(localStorage.getItem(recovery.key)).toBeNull();
    expect(localStorage.getItem(recovery.recoveryKey)).toBeNull();
    expect(localStorage.getItem('gm-vault-cloud-auth-v1:project:preview')).toBe('local-session');
  });
  it('fails closed on a corrupt journal or denied storage', () => {
    const recovery = local();
    localStorage.setItem(recovery.recoveryKey, '{}');
    expect(() => recovery.replace(next, recovery.capture())).toThrow('could not be saved');
    localStorage.getItem.mockImplementationOnce(() => { throw new Error('denied'); });
    expect(() => recovery.capture()).toThrow('could not be saved');
  });
});
