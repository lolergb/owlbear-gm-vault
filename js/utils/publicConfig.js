import { BUILD_REF } from './buildRef.js';

const TTL_MS = 5 * 60 * 1000;
const pending = new Map();

// Only these public configuration endpoints may use this cache. In particular,
// Notion content, auth headers and cloud backup responses must never enter it.
function sanitize(name, value) {
  if (name === 'get-default-token' && typeof value?.available === 'boolean') {
    return { available: value.available };
  }
  if (name === 'get-mixpanel-token' && typeof value?.enabled === 'boolean') {
    return {
      enabled: value.enabled,
      token: typeof value.token === 'string' ? value.token : null,
      environment: ['production', 'beta', 'unknown'].includes(value.environment) ? value.environment : 'unknown',
      deployContext: ['production', 'deploy-preview', 'branch-deploy', 'dev', 'unknown'].includes(value.deployContext) ? value.deployContext : 'unknown',
      isBeta: typeof value.isBeta === 'boolean' ? value.isBeta : null
    };
  }
  return null;
}

export async function fetchPublicConfig(name) {
  if (!['get-default-token', 'get-mixpanel-token'].includes(name)) {
    throw new Error('Not a public configuration endpoint');
  }
  const key = `gm-vault-public-config-v1:${location.origin}:${BUILD_REF}:${name}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    const age = Date.now() - cached?.savedAt;
    const data = sanitize(name, cached?.data);
    if (data && age >= 0 && age < TTL_MS) return data;
  } catch (_) { /* Storage may be unavailable inside an embedded browser. */ }

  if (!pending.has(key)) {
    const task = (async () => {
      const response = await fetch(`/.netlify/functions/${name}`, {
        method: 'GET', cache: 'no-store'
      });
      if (!response.ok) throw new Error('Public configuration unavailable');
      const data = sanitize(name, await response.json());
      if (!data) throw new Error('Invalid public configuration');
      try {
        sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
      } catch (_) { /* The response still works without persistent storage. */ }
      return data;
    })();
    pending.set(key, task);
  }
  try {
    return await pending.get(key);
  } finally {
    pending.delete(key);
  }
}
