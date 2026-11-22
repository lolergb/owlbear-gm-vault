import { BACKUP_SCHEMA, BackupError, backupName } from '../utils/cloudBackup.js';

const TABLE = 'private_vault_backup_entries';
const METADATA = 'id,user_id,name,schema_version,revision,created_at,updated_at';
const FIELDS = `${METADATA},payload,last_write_id`;
const SDK_URL = 'https://esm.sh/@supabase/supabase-js@2.119.2?bundle';

function safeError(error, fallback = 'network') {
  if (error instanceof BackupError) return error;
  if (Number(error?.status) === 429 || error?.code === 'over_request_rate_limit' || error?.code === 'over_email_send_rate_limit') return new BackupError('rate');
  if (['PGRST301', 'PGRST302', 'bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(error?.code) || Number(error?.status) === 401) return new BackupError('auth');
  if (error?.code === '23505') return new BackupError('conflict');
  if (error?.code === '23514' && /backup_(entry_)?size/.test(error?.message || '')) return new BackupError('size');
  if (error?.code === '23514' && error?.message?.includes('backup_entry_name')) return new BackupError('name');
  if (['42P01', '42501', 'PGRST205'].includes(error?.code)) return new BackupError('database');
  return new BackupError(fallback);
}

export async function timeoutFetch(input, init = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}

export function sessionStorageAdapter(host = globalThis) {
  const memory = new Map();
  const adapter = {
    persistent: true,
    getItem(key) {
      if (!adapter.persistent) return memory.get(key) ?? null;
      try {
        const value = host.localStorage.getItem(key);
        if (value !== null) memory.set(key, value);
        return value;
      }
      catch { adapter.persistent = false; return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      memory.set(key, value);
      try { host.localStorage.setItem(key, value); }
      catch { adapter.persistent = false; }
    },
    removeItem(key) {
      memory.delete(key);
      try { host.localStorage.removeItem(key); }
      catch { adapter.persistent = false; }
    }
  };
  return adapter;
}

export class CloudBackupService {
  constructor(client, storage) { this.client = client; this.storage = storage; this.pendingWrite = null; }

  static async create() {
    let config;
    try {
      const response = await timeoutFetch('/.netlify/functions/get-cloud-config', { cache: 'no-store' });
      if (!response.ok) throw new BackupError('unavailable');
      config = await response.json();
      if (!config.enabled || !config.url || !config.key) throw new BackupError('unavailable');
    } catch (error) { throw safeError(error, 'unavailable'); }
    let sdk;
    let timer;
    try {
      sdk = await Promise.race([
        import(SDK_URL),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new BackupError('network')), 15000); })
      ]);
    } catch { throw new BackupError('network'); }
    finally { clearTimeout(timer); }
    const storage = sessionStorageAdapter();
    const client = sdk.createClient(config.url, config.key, {
      auth: {
        storage, storageKey: `gm-vault-cloud-auth-v1:${new URL(config.url).hostname}:${location.hostname}`,
        persistSession: true, autoRefreshToken: true, detectSessionInUrl: false
      },
      global: { fetch: timeoutFetch }
    });
    return new CloudBackupService(client, storage);
  }

  async session() {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      return data.session;
    } catch (error) { throw safeError(error, 'auth'); }
  }

  async assertUser(userId) {
    try {
      const { data, error } = await this.client.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new BackupError('auth');
      if (data.user.id !== userId) throw new BackupError('changed');
      return data.user;
    } catch (error) { throw safeError(error); }
  }

  async sendCode(email) {
    try {
      const { error } = await this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
    } catch (error) { throw safeError(error, 'send'); }
  }

  async verifyCode(email, token) {
    try {
      const { data, error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      if (!data.session) throw new BackupError('code');
      return data.session;
    } catch (error) { throw safeError(error, 'code'); }
  }

  async signOut() {
    this.pendingWrite = null;
    try {
      const { error } = await this.client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } catch (error) { throw safeError(error); }
  }

  async list(userId) {
    await this.assertUser(userId);
    try {
      const rows = [];
      const seen = new Set();
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await this.client.from(TABLE).select(METADATA).eq('user_id', userId)
          .order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + 99);
        if (error) throw error;
        if (!Array.isArray(data)) throw new BackupError('network');
        for (const row of data) {
          if (row.user_id !== userId) throw new BackupError('changed');
          if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
        }
        if (data.length < 100) break;
      }
      await this.assertUser(userId);
      return rows;
    } catch (error) { throw safeError(error); }
  }

  async read(userId, backupId) {
    if (!backupId) throw new BackupError('missing');
    await this.assertUser(userId);
    try {
      const { data, error } = await this.client.from(TABLE).select(FIELDS).eq('user_id', userId).eq('id', backupId).maybeSingle();
      if (error) throw error;
      await this.assertUser(userId);
      if (data && (data.user_id !== userId || data.id !== backupId)) throw new BackupError('changed');
      return data;
    } catch (error) { throw safeError(error); }
  }

  async checkWrite(userId) {
    if (this.pendingWrite?.userId !== userId) throw new BackupError('changed');
    const data = await this.read(userId, this.pendingWrite.backupId);
    const matched = data?.last_write_id === this.pendingWrite.writeId;
    if (matched) this.pendingWrite = null;
    return { matched, data };
  }

  async save(userId, payload, previous, authorize, { name } = {}) {
    if (this.pendingWrite) throw new BackupError('uncertain');
    name = backupName(name);
    if (previous && (!previous.id || previous.name !== name || previous.user_id !== userId)) throw new BackupError('changed');
    await this.assertUser(userId);
    if (authorize) await authorize();
    const writeId = crypto.randomUUID();
    const backupId = previous?.id || crypto.randomUUID();
    const record = { id: backupId, user_id: userId, name, schema_version: BACKUP_SCHEMA, payload, last_write_id: writeId };
    let data;
    try {
      const table = this.client.from(TABLE);
      const query = previous
        ? table.update({ schema_version: BACKUP_SCHEMA, payload, last_write_id: writeId }).eq('user_id', userId).eq('id', backupId).eq('revision', previous.revision)
        : table.insert(record);
      const result = await query.select(FIELDS).maybeSingle();
      if (result.error) throw result.error;
      data = result.data;
      if (!data) throw new BackupError('conflict');
      if (data.user_id !== userId || data.id !== backupId || data.last_write_id !== writeId) throw new BackupError('uncertain');
    } catch (error) {
      const safe = safeError(error);
      if (['network', 'uncertain'].includes(safe.code)) {
        this.pendingWrite = { userId, backupId, name, writeId };
        throw new BackupError('uncertain');
      }
      throw safe;
    }
    await this.assertUser(userId);
    return data;
  }
}
