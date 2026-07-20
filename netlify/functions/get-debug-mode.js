/**
 * Netlify Function para obtener el modo debug
 * Controlado por variable de entorno DEBUG_MODE (solo tú puedes configurarla)
 */

export const handler = async (event, context) => {
  // Manejar CORS preflight
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

  // Solo permitir métodos GET
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
    // Obtener la variable de entorno DEBUG_MODE
    // Solo tú puedes configurarla en Netlify (Site settings → Environment variables)
    const DEBUG_MODE_ENV = process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === '1';
    
    // Obtener el token del usuario desde los query parameters
    const userToken = event.queryStringParameters?.token;
    
    // Si hay OWNER_TOKEN configurado, solo activar DEBUG_MODE para el dueño
    const OWNER_TOKEN = process.env.OWNER_TOKEN;
    let DEBUG_MODE = false;
    
    if (OWNER_TOKEN) {
      // Si hay OWNER_TOKEN, DEBUG_MODE solo funciona para el dueño
      // Verificar que el token del usuario coincida con el token del dueño
      DEBUG_MODE = DEBUG_MODE_ENV && userToken === OWNER_TOKEN;
    } else {
      // Si no hay OWNER_TOKEN, usar el comportamiento anterior (solo DEBUG_MODE_ENV)
      DEBUG_MODE = DEBUG_MODE_ENV;
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({ debug: DEBUG_MODE })
    };
  } catch (error) {
    console.error('Error getting debug mode:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message || 'Internal server error', debug: false })
    };
  }
};
