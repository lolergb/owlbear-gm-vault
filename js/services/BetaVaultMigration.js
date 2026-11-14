import { ConfigParser } from '../parsers/ConfigParser.js?v=20260722-4';
import {
  BETA_ORIGIN, PRODUCTION_ORIGIN, BRIDGE_PATH, MIGRATION_PROTOCOL,
  VAULT_PREFIX, TOKEN_KEY, MIGRATION_PREFIX, MAX_VAULT_LENGTH, MAX_TOKEN_LENGTH, validRoom
} from '../config/betaMigration.js';

const canonical = value => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  }
  return item;
});
const nonce = host => Array.from(host.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');

/** One request, one frame, one exact origin; discard late, forged and replayed replies. */
export function readBetaVault({ roomId, includeToken, host = window, sourceOrigin = BETA_ORIGIN, timeout = 3000, signal }) {
  return new Promise(resolve => {
    if (!validRoom(roomId) || signal?.aborted) return resolve({ status: 'unavailable' });
    const requestId = nonce(host);
    const frame = host.document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Recover beta vault';
    frame.referrerPolicy = 'no-referrer';
    frame.src = sourceOrigin + BRIDGE_PATH;
    let finished = false;
    let timer;
    const finish = result => {
      if (finished) return;
      finished = true;
      host.clearTimeout(timer);
      host.removeEventListener('message', listener);
      signal?.removeEventListener('abort', abort);
      frame.remove();
      resolve(result);
    };
    const abort = () => finish({ status: 'unavailable' });
    const listener = event => {
      const data = event.data;
      if (event.origin !== sourceOrigin || event.source !== frame.contentWindow ||
          !data || data.protocol !== MIGRATION_PROTOCOL || data.type !== 'result' ||
          data.nonce !== requestId || data.roomId !== roomId) return;
      if (['missing', 'unavailable', 'too-large'].includes(data.status)) return finish({ status: data.status });
      if (data.status !== 'ok' || typeof data.raw !== 'string' || data.raw.length > MAX_VAULT_LENGTH ||
          !['room', 'default'].includes(data.sourceKind) ||
          (data.token !== null && (typeof data.token !== 'string' || data.token.length > MAX_TOKEN_LENGTH))) return;
      finish({ status: 'ok', raw: data.raw, sourceKind: data.sourceKind, token: includeToken ? data.token : null });
    };
    frame.onload = () => {
      if (!finished) frame.contentWindow.postMessage({ protocol: MIGRATION_PROTOCOL, type: 'read',
        nonce: requestId, roomId, includeToken }, sourceOrigin);
    };
    frame.onerror = abort;
    host.addEventListener('message', listener);
    signal?.addEventListener('abort', abort, { once: true });
    timer = host.setTimeout(() => finish({ status: 'unavailable' }), timeout);
    try { host.document.body.append(frame); } catch { abort(); }
  });
}

/** All mutations are synchronous after the final context check, under a per-room Web Lock when supported. */
export class BetaVaultMigration {
  constructor({ host = window, targetOrigin = PRODUCTION_ORIGIN, readSource, choose, verifyContext, signal } = {}) {
    Object.assign(this, { host, targetOrigin, choose, verifyContext, signal });
    this.readSource = readSource || (options => readBetaVault({ ...options, host, signal }));
    this.parser = new ConfigParser();
  }

  async recover(roomId, { manual = false } = {}) {
    if (this.host.location.origin !== this.targetOrigin || !validRoom(roomId)) return { status: 'ineligible' };
    try {
      if (!await this.verifyContext(roomId) || this.signal?.aborted) return { status: 'ineligible' };
      const storage = this.host.localStorage;
      const markerKey = MIGRATION_PREFIX + roomId;
      if (!manual && storage.getItem(markerKey)) return { status: 'done' };
      const key = VAULT_PREFIX + roomId;
      const initial = storage.getItem(key);
      const fallback = storage.getItem(VAULT_PREFIX + 'default');
      const current = initial ?? fallback;
      const includeToken = !storage.getItem(TOKEN_KEY);
      const source = await this.readSource({ roomId, includeToken });
      if (source.status !== 'ok') return { status: source.status };
      let sourceObject;
      try {
        if (typeof source.raw !== 'string' || source.raw.length > MAX_VAULT_LENGTH) return { status: 'invalid' };
        sourceObject = JSON.parse(source.raw);
        if (!this.parser.validate(sourceObject).valid) return { status: 'invalid' };
      } catch { return { status: 'invalid' }; }
      let identical = false;
      try { identical = current !== null && canonical(JSON.parse(current)) === canonical(sourceObject); } catch { /* corrupt destination still requires a choice and backup */ }
      const choice = current !== null && !identical
        ? await this.choose({ sourceKind: source.sourceKind }) : 'import';
      if (!['import', 'keep'].includes(choice)) return { status: 'deferred' };

      const commit = async () => {
        if (!await this.verifyContext(roomId) || this.signal?.aborted) return { status: 'ineligible' };
        if (storage.getItem(key) !== initial || storage.getItem(VAULT_PREFIX + 'default') !== fallback ||
            (!manual && storage.getItem(markerKey))) return { status: 'changed' };
        if (choice === 'keep') {
          storage.setItem(markerKey, JSON.stringify({ outcome: 'kept', source: BETA_ORIGIN, at: Date.now() }));
          return { status: 'kept' };
        }
        let backupKey = null;
        if (!identical) {
          if (current !== null) {
            backupKey = MIGRATION_PREFIX + 'backup:' + roomId + ':' + Date.now() + ':' + nonce(this.host);
            // Store the exact original bytes, including fields this version does not understand.
            storage.setItem(backupKey, current);
            if (storage.getItem(backupKey) !== current) return { status: 'write-failed' };
          }
          storage.setItem(key, source.raw);
          if (storage.getItem(key) !== source.raw) return { status: 'write-failed', backupKey };
        }
        let tokenStatus = 'unchanged';
        if (includeToken && !storage.getItem(TOKEN_KEY) && typeof source.token === 'string' &&
            source.token.length > 0 && source.token.length <= MAX_TOKEN_LENGTH) {
          try {
            storage.setItem(TOKEN_KEY, source.token);
            tokenStatus = storage.getItem(TOKEN_KEY) === source.token ? 'copied' : 'failed';
          } catch { tokenStatus = 'failed'; }
        }
        let marked = false;
        // A marker failure does not undo a successfully verified vault copy.
        // Leave token failures retryable (the next attempt will find identical vaults).
        if (tokenStatus !== 'failed') {
          try {
            storage.setItem(markerKey, JSON.stringify({ outcome: 'imported', source: BETA_ORIGIN, at: Date.now() }));
            marked = !!storage.getItem(markerKey);
          } catch { /* idempotent retry */ }
        }
        return { status: identical ? 'identical' : 'imported', tokenStatus, marked, backupKey };
      };
      if (this.host.navigator?.locks?.request) {
        return await this.host.navigator.locks.request(markerKey, commit);
      }
      return await commit();
    } catch {
      // Never include caught storage errors: some engines echo the stored value.
      return { status: 'write-failed' };
    }
  }
}
