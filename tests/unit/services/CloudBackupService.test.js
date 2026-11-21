import { describe, expect, it, jest } from '@jest/globals';
import { CloudBackupService, sessionStorageAdapter } from '../../../js/services/CloudBackupService.js';

function clientWith(result = { data: null, error: null }) {
  const query = { select: jest.fn(), eq: jest.fn(), insert: jest.fn(), update: jest.fn(), maybeSingle: jest.fn().mockResolvedValue(result) };
  for (const method of ['select', 'eq', 'insert', 'update']) query[method].mockReturnValue(query);
  const auth = {
    getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null }),
    getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
    verifyOtp: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null })
  };
  const client = { auth, from: jest.fn().mockReturnValue(query) };
  return { service: new CloudBackupService(client), client, auth, query };
}

describe('private cloud backup requests', () => {
  it('sends OTP and verifies email code without passwords or redirects', async () => {
    const { service, auth } = clientWith();
    await service.sendCode('test@example.test');
    await service.verifyCode('test@example.test', '123456');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'test@example.test', options: { shouldCreateUser: true } });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'test@example.test', token: '123456', type: 'email' });
  });
  it('reads only the current user and distinguishes absence from failure', async () => {
    const { service, auth, query } = clientWith();
    expect(await service.read('user-a')).toBeNull();
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    query.maybeSingle.mockResolvedValue({ error: { code: '42P01' } });
    await expect(service.read('user-a')).rejects.toMatchObject({ code: 'database' });
  });
  it('uses insert for first save and compares revision for replacement', async () => {
    const { service, query } = clientWith();
    query.maybeSingle.mockImplementation(async () => {
      const write = query.insert.mock.calls.at(-1)?.[0] || query.update.mock.calls.at(-1)?.[0];
      return { data: { ...write, user_id: 'user-a' }, error: null };
    });
    await service.save('user-a', { categories: [] }, null);
    expect(query.insert).toHaveBeenCalledTimes(1);
    expect(query.update).not.toHaveBeenCalled();
    query.insert.mockClear();
    await service.save('user-a', { categories: [] }, { revision: 7 });
    expect(query.eq).toHaveBeenCalledWith('revision', 7);
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('revision');
  });
  it.each([{ data: null, error: null }, { error: { code: '23505' } }])('never silently overwrites an intervening save', async result => {
    const { service } = clientWith(result);
    await expect(service.save('user-a', { categories: [] }, { revision: 1 })).rejects.toMatchObject({ code: 'conflict' });
    expect(service.pendingWrite).toBeNull();
  });
  it('retains write identity after an uncertain response and only checks before writing again', async () => {
    const { service, query } = clientWith();
    query.maybeSingle.mockRejectedValueOnce(new Error('private body email token must not escape'));
    await expect(service.save('user-a', { categories: [] }, null)).rejects.toMatchObject({ code: 'uncertain' });
    const id = service.pendingWrite.writeId;
    await expect(service.save('user-a', { categories: [] }, null)).rejects.toMatchObject({ code: 'uncertain' });
    expect(query.insert).toHaveBeenCalledTimes(1);
    query.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'user-a', last_write_id: id } });
    expect(await service.checkWrite('user-a')).toMatchObject({ matched: true });
    expect(service.pendingWrite).toBeNull();
  });
  it('rejects account switches before a request or during a read', async () => {
    const { service, auth, client } = clientWith({ data: { user_id: 'user-a' } });
    await expect(service.read('user-b')).rejects.toMatchObject({ code: 'changed' });
    expect(client.from).not.toHaveBeenCalled();
    auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } } }).mockResolvedValueOnce({ data: { user: { id: 'user-b' } } });
    await expect(service.read('user-a')).rejects.toMatchObject({ code: 'changed' });
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
