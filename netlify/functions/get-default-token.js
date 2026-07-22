/**
 * Indica si el proxy dispone de acceso al contenido demo.
 * La credencial nunca se devuelve al navegador.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const RESPONSE_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer'
};

export const handler = async (event) => {
  // Manejar CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Solo permitir método GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const available = Boolean(
      String(process.env.GM_VAULT_DEFAULT_CONFIG_V2 || '').trim()
    );

    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ available })
    };
  } catch (error) {
    console.error('Error getting default token:', error);
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        available: false
      })
    };
  }
};
