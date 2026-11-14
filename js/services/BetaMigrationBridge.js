import {
  BETA_ORIGIN, PRODUCTION_ORIGIN, MIGRATION_PROTOCOL, VAULT_PREFIX,
  TOKEN_KEY, MAX_VAULT_LENGTH, MAX_TOKEN_LENGTH, validRoom, validNonce
} from '../config/betaMigration.js';

/** Read-only endpoint. Never enumerate, broadcast, log, or remove source data. */
export function installBetaMigrationBridge({ host = window, sourceOrigin = BETA_ORIGIN, targetOrigin = PRODUCTION_ORIGIN } = {}) {
  if (host.location.origin !== sourceOrigin || host.parent === host) return () => {};
  const listener = event => {
    const request = event.data;
    if (event.origin !== targetOrigin || event.source !== host.parent ||
        !request || request.protocol !== MIGRATION_PROTOCOL || request.type !== 'read' ||
        !validRoom(request.roomId) || !validNonce(request.nonce) || typeof request.includeToken !== 'boolean') return;
    const reply = { protocol: MIGRATION_PROTOCOL, type: 'result', nonce: request.nonce, roomId: request.roomId };
    try {
      const storage = host.localStorage;
      let raw = storage.getItem(VAULT_PREFIX + request.roomId);
      let sourceKind = 'room';
      if (raw === null) {
        raw = storage.getItem(VAULT_PREFIX + 'default');
        sourceKind = 'default';
      }
      if (raw === null) reply.status = 'missing';
      else if (raw.length > MAX_VAULT_LENGTH) reply.status = 'too-large';
      else {
        Object.assign(reply, { status: 'ok', raw, sourceKind });
        const token = request.includeToken ? storage.getItem(TOKEN_KEY) : null;
        // An oversized token must not prevent recovery of the vault itself.
        reply.token = typeof token === 'string' && token.length <= MAX_TOKEN_LENGTH ? token : null;
      }
    } catch {
      reply.status = 'unavailable';
      delete reply.raw;
      delete reply.token;
    }
    host.parent.postMessage(reply, targetOrigin);
  };
  host.addEventListener('message', listener);
  return () => host.removeEventListener('message', listener);
}
