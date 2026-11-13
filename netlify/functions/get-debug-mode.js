/**
 * Netlify Function para obtener el modo debug
 * Controlado por DEBUG_MODE y desactivado siempre en production.
 */

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer'
};
const PRODUCTION_HOSTNAME = 'owlbear-gm-vault.netlify.app';

function getRequestHostname(event) {
  return String(
    event?.headers?.['x-forwarded-host'] || event?.headers?.host || ''
  ).split(',')[0].trim().split(':')[0].toLowerCase();
}

export const handler = async (event) => {
  // Manejar CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: ''
    };
  }

  // Solo permitir métodos GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Debug es una herramienta del entorno beta. Nunca usamos una credencial
    // de Notion como prueba de identidad ni lo activamos en producción.
    const DEBUG_MODE_ENV = process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === '1';
    const deployContext = String(process.env.CONTEXT || '').toLowerCase();
    const hostname = getRequestHostname(event);
    const isProduction = deployContext === 'production' || hostname === PRODUCTION_HOSTNAME;
    const isBetaContext = ['deploy-preview', 'branch-deploy', 'dev'].includes(deployContext);
    const isBetaHostname = /^(?:deploy-preview-\d+|[a-z0-9-]+)--owlbear-gm-vault\.netlify\.app$/.test(hostname);
    // Some Netlify Function runtimes omit CONTEXT. Unknown deployments must
    // fail closed, while a verified preview hostname may still use debug.
    const DEBUG_MODE = DEBUG_MODE_ENV && !isProduction && (isBetaContext || isBetaHostname);
    
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ debug: DEBUG_MODE })
    };
  } catch (error) {
    console.error('Error getting debug mode:', error);
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: error.message || 'Internal server error', debug: false })
    };
  }
};
