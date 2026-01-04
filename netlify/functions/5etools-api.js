/**
 * Netlify Function para hacer proxy de las llamadas a 5e.tools
 * Esto resuelve el problema de CORS al hacer fetch desde el servidor
 */

exports.handler = async (event, context) => {
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

  // Obtener la URL del JSON desde los query parameters
  const { url } = event.queryStringParameters || {};
  
  if (!url) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'url parameter is required' })
    };
  }

  // Validar que la URL sea de 5e.tools
  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes('5e.tools')) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'URL must be from 5e.tools' })
      };
    }
  } catch (e) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Invalid URL format' })
    };
  }

  try {
    // Hacer la petición a 5e.tools desde el servidor (sin CORS)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'GM-Vault/1.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: `Failed to fetch: ${response.status} ${response.statusText}`
        })
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=3600' // Cache por 1 hora
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error fetching from 5e.tools:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

