/**
 * Netlify Function to get Mixpanel token securely
 * The token is stored in Netlify environment variable MIXPANEL_TOKEN
 */

function getDeployMetadata() {
  const knownContexts = new Set(['production', 'deploy-preview', 'branch-deploy', 'dev']);
  const rawContext = String(process.env.CONTEXT || '').toLowerCase();
  const deployContext = knownContexts.has(rawContext) ? rawContext : 'unknown';
  const environment = deployContext === 'production'
    ? 'production'
    : deployContext === 'unknown' ? 'unknown' : 'beta';

  return {
    environment,
    deployContext,
    isBeta: environment === 'beta'
  };
}

export const handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow GET methods
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const token = process.env.MIXPANEL_TOKEN;
    const deployMetadata = getDeployMetadata();
    
    if (!token) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ token: null, enabled: false, ...deployMetadata })
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({ token, enabled: true, ...deployMetadata })
    };
  } catch (error) {
    console.error('Error getting Mixpanel token:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message || 'Internal server error', token: null, enabled: false })
    };
  }
};
