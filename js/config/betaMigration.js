// These origins are intentionally fixed. A new deploy-preview has different storage.
export const PRODUCTION_ORIGIN = 'https://owlbear-gm-vault.netlify.app';
export const BETA_ORIGIN = 'https://deploy-preview-10--owlbear-gm-vault.netlify.app';
export const BRIDGE_PATH = '/html/beta-migration-bridge.html';
export const MIGRATION_PROTOCOL = 'gm-vault-beta-recovery-v1';
export const VAULT_PREFIX = 'notion-pages-json-';
export const TOKEN_KEY = 'notion-global-token';
export const MIGRATION_PREFIX = 'gm-vault-beta-recovery-v1:';
export const MAX_VAULT_LENGTH = 4 * 1024 * 1024;
export const MAX_TOKEN_LENGTH = 8192;
export const validRoom = room => typeof room === 'string' && room !== 'default' && /^[a-zA-Z0-9_-]{1,200}$/.test(room);
export const validNonce = nonce => typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce);
