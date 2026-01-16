/**
 * Netlify Function para hacer proxy de las llamadas a la API de Notion
 * Esto mantiene el token seguro en el servidor
 */

exports.handler = async (event, context) => {
  // Headers CORS comunes
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Notion-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Manejar CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Permitir GET y POST
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Obtener el token del usuario desde los query parameters o headers
  const { pageId, type, token } = event.queryStringParameters || {};
  const userToken = token || event.headers['x-notion-token'];
  
  if (!userToken) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No token provided. Configure your Notion token in the extension (🔑 button).' })
    };
  }

  try {
    let apiEndpoint;
    let method = 'GET';
    let body = null;

    // Determinar el endpoint según el tipo
    if (type === 'search') {
      // Búsqueda de páginas disponibles para la integración
      apiEndpoint = 'https://api.notion.com/v1/search';
      method = 'POST';
      body = JSON.stringify({
        filter: {
          property: 'object',
          value: 'page'
        },
        sort: {
          direction: 'descending',
          timestamp: 'last_edited_time'
        },
        page_size: 100
      });
    } else if (type === 'page') {
      // Obtener información de la página
      if (!pageId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'pageId parameter is required for type=page' })
        };
      }
      apiEndpoint = `https://api.notion.com/v1/pages/${pageId}`;
    } else if (type === 'children') {
      // Obtener bloques hijos de una página
      if (!pageId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'pageId parameter is required for type=children' })
        };
      }
      apiEndpoint = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`;
    } else {
      // Comportamiento por defecto: obtener bloques hijos
      if (!pageId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'pageId parameter is required' })
        };
      }
      apiEndpoint = `https://api.notion.com/v1/blocks/${pageId}/children`;
    }
    
    // Hacer la petición a la API de Notion
    const fetchOptions = {
      method: method,
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      fetchOptions.body = body;
    }

    const response = await fetch(apiEndpoint, fetchOptions);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: errorData.message || 'Notion API error',
          code: errorData.code
        })
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error calling Notion API:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

