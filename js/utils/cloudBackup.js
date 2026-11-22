// The cloud contract contains a vault configuration, never application storage.
export const BACKUP_SCHEMA = 1;
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const RECOVERY_PREFIX = 'gm-vault-cloud-recovery-v1:';
export const MAX_BACKUP_NAME_LENGTH = 80;
export const CLOUD_AUTH_PREFIX = 'gm-vault-cloud-auth-v1:';

// Key presence only decides whether to ask the SDK about a previous session.
export function isCloudSessionKey(key, hostname) {
  return typeof key === 'string' && key.startsWith(CLOUD_AUTH_PREFIX) && key.endsWith(':' + hostname);
}

export function hasStoredCloudSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (isCloudSessionKey(localStorage.key(i), location.hostname)) return true;
    }
  } catch { /* A memory-only session lives in the active SDK client. */ }
  return false;
}

export function backupName(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!name || [...name].length > MAX_BACKUP_NAME_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new BackupError('name');
  return name;
}

const messages = {
  unavailable: 'Private backups are not configured for this deployment. You can keep using your local vault and JSON backups.',
  network: 'The backup service could not be reached. Check your connection and try again.',
  auth: 'Your session is no longer valid. Close this dialog and sign in again.',
  changed: 'The account, room, or local vault changed. Close this dialog and review the operation again.',
  conflict: 'The private backup changed on another device. Close this dialog and review the latest copy before replacing it.',
  name: 'Enter a backup name of 1 to 80 characters, without control characters.',
  missing: 'This backup is no longer available. Close this dialog and choose another saved copy.',
  uncertain: 'The request was sent, but saving could not be confirmed. Use Check backup before trying to save again.',
  invalid: 'This backup could not be validated. Both your local vault and private backup have been kept.',
  version: 'This backup needs a newer GM Vault version. Update the extension before restoring it.',
  empty: 'There are no folders or pages to back up. Add content before saving a private backup.',
  size: 'Private backups support up to 2 MiB. Use a JSON backup for this vault.',
  storage: 'The vault could not be saved and verified in this browser. Free browser storage and try again. Your previous vault has been kept for recovery.',
  recovery: 'A previous restore needs recovery. Use Undo restore in Settings before replacing this vault again.',
  view: 'The vault was saved locally, but the view could not refresh. Reopen the extension to load it. Your recovery copy has been kept.',
  permission: 'Only the active GM can save or restore a private backup in this room.',
  send: 'The code could not be sent. Check the email address or try again later.',
  code: 'The code is incorrect, used, or expired. Check it or request a new code.',
  rate: 'Too many attempts. Wait a minute before trying again.',
  database: 'The backup database is not ready. Check the Supabase migration and access policies, then try again.'
};

export function safeBackupErrorCode(code) {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? code : 'unknown';
}

export class BackupError extends Error {
  constructor(code) { super(messages[code] || messages.network); this.code = code; }
}

export function backupBytes(payload) {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function prepareBackup(value, parser, { restoring = false, schema = BACKUP_SCHEMA } = {}) {
  if (schema !== BACKUP_SCHEMA) throw new BackupError('version');
  let payload;
  let preflight;
  try {
    const json = value?.toJSON ? value.toJSON() : value;
    if (backupBytes(json) > MAX_BACKUP_BYTES) throw new BackupError('size');
    // Bound nesting before the existing recursive parser sees untrusted input.
    const stack = [[json, 0]];
    while (stack.length) {
      const [item, depth] = stack.pop();
      if (depth > 80) throw new BackupError('invalid');
      if (item && typeof item === 'object') {
        for (const child of Object.values(item)) if (child && typeof child === 'object') stack.push([child, depth + 1]);
      }
    }
    preflight = parser.preflight(json);
    if (!preflight.valid) throw new BackupError('invalid');
    if (!preflight.summary.pageCount && !preflight.summary.categoryCount) throw new BackupError(restoring ? 'invalid' : 'empty');
    // Model serialization is the allowlist: no tokens, sessions or storage keys.
    payload = JSON.parse(JSON.stringify(parser.parse(json).toJSON()));
    if (restoring) {
      const hide = node => {
        for (const page of node.pages || []) page.playerAccessEnabled = false;
        for (const category of node.categories || []) hide(category);
      };
      hide(payload);
    }
    if (backupBytes(payload) > MAX_BACKUP_BYTES) throw new BackupError('size');
  } catch (error) {
    throw error instanceof BackupError ? error : new BackupError('invalid');
  }
  return { payload, summary: preflight.summary, warnings: preflight.warnings, bytes: backupBytes(payload) };
}
