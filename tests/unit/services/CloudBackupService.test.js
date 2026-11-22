import { describe, expect, it, jest } from '@jest/globals';
import { CloudBackupService, sessionStorageAdapter } from '../../../js/services/CloudBackupService.js';

function clientWith(result = { data: null, error: null }) {
  const query = { select: jest.fn(), eq: jest.fn(), insert: jest.fn(), update: jest.fn(), order: jest.fn(), range: jest.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: jest.fn().mockResolvedValue(result) };
  for (const method of ['select', 'eq', 'insert', 'update', 'order']) query[method].mockReturnValue(query);
  const auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }),
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
    verifyOtp: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null })
  };
  const client = { auth, from: jest.fn().mockReturnValue(query), rpc: jest.fn().mockResolvedValue({ data: true }) };
  return { service: new CloudBackupService(client), client, auth, query };
}

describe('private cloud backup requests', () => {
  it('deletes the confirmed identity and revision only after account and room authorization', async () => {
    const { service, client } = clientWith();
    const row = { user_id: 'user-a', id: 'copy-1', name: 'Session one', revision: 4 };
    const authorize = jest.fn();
    await expect(service.deleteBackup('user-b', row, authorize)).rejects.toMatchObject({ code: 'changed' });
    authorize.mockRejectedValueOnce(new Error('Room changed'));
    await expect(service.deleteBackup('user-a', row, authorize)).rejects.toThrow('Room changed');
    expect(client.rpc).not.toHaveBeenCalled();
    await service.deleteBackup('user-a', row, authorize);
    expect(client.rpc).toHaveBeenCalledWith('delete_private_vault_backup', { p_id: row.id, p_revision: 4, p_name: row.name });
    client.rpc.mockResolvedValueOnce({ data: false });
    await expect(service.deleteBackup('user-a', row, authorize)).rejects.toMatchObject({ code: 'conflict' });
    client.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(service.deleteBackup('user-a', row, authorize)).rejects.toMatchObject({ code: 'delete_uncertain' });
  });
  it('sends OTP and verifies email code without passwords or redirects', async () => {
    const { service, auth } = clientWith();
    await service.sendCode('test@example.test');
    await service.verifyCode('test@example.test', '123456');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'test@example.test', options: { shouldCreateUser: true } });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'test@example.test', token: '123456', type: 'email' });
  });
  it('reads only the current user and distinguishes absence from failure', async () => {
    const { service, auth, query } = clientWith();
    expect(await service.read('user-a', 'backup-a')).toBeNull();
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(query.eq).toHaveBeenCalledWith('id', 'backup-a');
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    query.maybeSingle.mockResolvedValue({ error: { code: '42P01' } });
    await expect(service.read('user-a', 'backup-a')).rejects.toMatchObject({ code: 'database' });
  });
  it('uses insert for first save and compares revision for replacement', async () => {
    const { service, query } = clientWith();
    query.maybeSingle.mockImplementation(async () => {
      const write = query.insert.mock.calls.at(-1)?.[0] || query.update.mock.calls.at(-1)?.[0];
      return { data: { ...write, id: write.id || 'backup-a', user_id: 'user-a' }, error: null };
    });
    await service.save('user-a', { categories: [] }, null, undefined, { name: 'Campaign A' });
    expect(query.insert).toHaveBeenCalledTimes(1);
    expect(query.insert.mock.calls[0][0]).toMatchObject({ name: 'Campaign A', id: expect.any(String) });
    expect(query.update).not.toHaveBeenCalled();
    query.insert.mockClear();
    await service.save('user-a', { categories: [] }, { id: 'backup-a', user_id: 'user-a', name: 'Campaign A', revision: 7 }, undefined, { name: 'Campaign A' });
    expect(query.eq).toHaveBeenCalledWith('revision', 7);
    expect(query.eq).toHaveBeenCalledWith('id', 'backup-a');
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('revision');
  });
  it.each([{ data: null, error: null }, { error: { code: '23505' } }])('never silently overwrites an intervening save', async result => {
    const { service } = clientWith(result);
    await expect(service.save('user-a', { categories: [] }, { id: 'backup-a', user_id: 'user-a', name: 'Campaign A', revision: 1 }, undefined, { name: 'Campaign A' })).rejects.toMatchObject({ code: 'conflict' });
    expect(service.pendingWrite).toBeNull();
  });
  it('retains write identity after an uncertain response and only checks before writing again', async () => {
    const { service, query } = clientWith();
    query.maybeSingle.mockRejectedValueOnce(new Error('private body email token must not escape'));
    await expect(service.save('user-a', { categories: [] }, null, undefined, { name: 'Campaign A' })).rejects.toMatchObject({ code: 'uncertain' });
    const id = service.pendingWrite.writeId;
    const backupId = service.pendingWrite.backupId;
    await expect(service.save('user-a', { categories: [] }, null, undefined, { name: 'Campaign B' })).rejects.toMatchObject({ code: 'uncertain' });
    expect(query.insert).toHaveBeenCalledTimes(1);
    query.maybeSingle.mockResolvedValueOnce({ data: { id: backupId, user_id: 'user-a', last_write_id: id } });
    expect(await service.checkWrite('user-a')).toMatchObject({ matched: true });
    expect(service.pendingWrite).toBeNull();
    expect(query.eq).toHaveBeenCalledWith('id', backupId);
  });
  it('rejects account switches before a request or during a read', async () => {
    const { service, auth, client } = clientWith({ data: { user_id: 'user-a' } });
    await expect(service.read('user-b', 'backup-a')).rejects.toMatchObject({ code: 'changed' });
    expect(client.from).not.toHaveBeenCalled();
    auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } } }).mockResolvedValueOnce({ data: { user: { id: 'user-b' } } });
    await expect(service.read('user-a', 'backup-a')).rejects.toMatchObject({ code: 'changed' });
  });
  it('lists all pages of metadata without downloading vault payloads', async () => {
    const { service, query, client } = clientWith();
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `backup-${i}`, user_id: 'user-a', name: `Session ${i}` }));
    query.range.mockResolvedValueOnce({ data: firstPage }).mockResolvedValueOnce({ data: [{ id: 'oldest', user_id: 'user-a', name: 'Oldest' }] });
    expect(await service.list('user-a')).toHaveLength(101);
    expect(client.from).toHaveBeenCalledWith('private_vault_backup_entries');
    expect(query.select.mock.calls[0][0]).not.toContain('payload');
    expect(query.range.mock.calls).toEqual([[0, 99], [100, 199]]);
  });
  it('rejects mismatched identities and invalid names before writing', async () => {
    const { service, query } = clientWith();
    await expect(service.save('user-a', {}, null, undefined, { name: '   ' })).rejects.toMatchObject({ code: 'name' });
    await expect(service.save('user-a', {}, { id: 'other', name: 'A', user_id: 'user-b' }, undefined, { name: 'A' })).rejects.toMatchObject({ code: 'changed' });
    expect(query.insert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
    query.range.mockResolvedValueOnce({ data: [{ id: 'other', user_id: 'user-b' }] });
    await expect(service.list('user-a')).rejects.toMatchObject({ code: 'changed' });
  });
  it('does not expose raw provider errors and signs out only this device', async () => {
    const { service, auth } = clientWith();
    auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'email secret-token', status: 400 } });
    await expect(service.verifyCode('test', 'bad')).rejects.toThrow('incorrect, used, or expired');
    await service.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('uses in-memory session storage when browser persistence fails without returning stale tokens', () => {
    const values = new Map([['session', 'old']]);
    const host = { localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); }
    } };
    const adapter = sessionStorageAdapter(host);
    expect(adapter.getItem('session')).toBe('old');
    adapter.setItem('session', 'refreshed');
    expect(adapter.persistent).toBe(false);
    expect(adapter.getItem('session')).toBe('refreshed');
    adapter.removeItem('session');
    expect(adapter.getItem('session')).toBeNull();
  });
});
