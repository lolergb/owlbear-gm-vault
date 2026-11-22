// This endpoint exposes only public configuration. Never return a secret key.
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const handler = async event => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ enabled: false }) };
  const disabled = { statusCode: 200, headers, body: JSON.stringify({ enabled: false }) };
  if (process.env.GM_VAULT_CLOUD_ENABLED !== 'true') return disabled;
  try {
    const url = new URL(process.env.GM_VAULT_SUPABASE_URL);
    const key = process.env.GM_VAULT_SUPABASE_PUBLISHABLE_KEY || '';
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return disabled;
    let publicKey = /^sb_publishable_[a-zA-Z0-9_-]+$/.test(key);
    if (!publicKey && key.split('.').length === 3) {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      publicKey = claims.role === 'anon';
    }
    if (!publicKey) return disabled;
    return { statusCode: 200, headers, body: JSON.stringify({ enabled: true, url: url.origin, key }) };
  } catch { return disabled; }
};
