/**
 * Netlify Function para obtener el token de Notion para default-config
 * Controlado por variable de entorno GM_VAULT_DEFAULT_CONFIG
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

exports.handler = async (event, context) => {
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
    // Obtener el token de Notion desde la variable de entorno
    const defaultToken = process.env.GM_VAULT_DEFAULT_CONFIG;
    
    // Si no hay token configurado, retornar null
    if (!defaultToken) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        },
        body: JSON.stringify({ token: null })
      };
    }
    
    // Retornar el token (solo se usará para páginas de Notion en default-config)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS
      },
      body: JSON.stringify({ token: defaultToken })
    };
  } catch (error) {
    console.error('Error getting default token:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        error: error.message || 'Internal server error',
        token: null
      })
    };
  }
};
