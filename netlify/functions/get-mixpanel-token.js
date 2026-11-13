/**
 * Netlify Function to get Mixpanel token securely
 * The token is stored in Netlify environment variable MIXPANEL_TOKEN
 */

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store'
};
const PRODUCTION_HOSTNAME = 'owlbear-gm-vault.netlify.app';

function getDeployMetadata(event) {
  const knownContexts = new Set(['production', 'deploy-preview', 'branch-deploy', 'dev']);
  const rawContext = String(process.env.CONTEXT || '').toLowerCase();
  let deployContext = knownContexts.has(rawContext) ? rawContext : 'unknown';

  // CONTEXT is canonical. The hostname fallback keeps deployment analytics
  // usable if Netlify does not expose it in a particular function runtime.
  if (deployContext === 'unknown') {
    const hostname = String(
      event?.headers?.['x-forwarded-host'] || event?.headers?.host || ''
    ).split(':')[0].toLowerCase();

    if (hostname === PRODUCTION_HOSTNAME) {
      deployContext = 'production';
    } else if (hostname.includes('deploy-preview')) {
      deployContext = 'deploy-preview';
    } else if (hostname.endsWith('.netlify.app')) {
      deployContext = 'branch-deploy';
    }
  }

  const environment = deployContext === 'production'
    ? 'production'
    : deployContext === 'unknown' ? 'unknown' : 'beta';
  const isBeta = environment === 'unknown' ? null : environment === 'beta';

  return { environment, deployContext, isBeta };
}

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: ''
    };
  }

  // Only allow GET methods
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const token = process.env.MIXPANEL_TOKEN;
    const deployMetadata = getDeployMetadata(event);
    
    if (!token) {
      return {
        statusCode: 200,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({ token: null, enabled: false, ...deployMetadata })
      };
    }
    
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ token, enabled: true, ...deployMetadata })
    };
  } catch (error) {
    console.error('Error getting Mixpanel token:', error);
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: error.message || 'Internal server error', token: null, enabled: false })
    };
  }
};
