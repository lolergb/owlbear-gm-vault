/**
 * Netlify Function para hacer proxy de las llamadas a la API de Notion
 * Esto mantiene el token seguro en el servidor
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Notion-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
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

  // Permitir métodos GET y POST
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Obtener el token del usuario desde los query parameters o headers
  // El token ahora es obligatorio y se configura desde la interfaz del plugin
  const { pageId, type, token, action } = event.queryStringParameters || {};
  const userToken = token || event.headers['x-notion-token'];
  
  if (!userToken) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'No token provided. Configure your Notion token in the extension (🔑 button).' })
    };
  }

  try {
    // ============================================
    // ACCIÓN: Buscar páginas en el workspace
    // ============================================
    if (action === 'search') {
      const searchQuery = event.queryStringParameters.query || '';
      const filter = event.queryStringParameters.filter || 'page'; // 'page' o 'database'
      
      const searchBody = {
        filter: { property: 'object', value: filter },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100
      };
      
      // Solo agregar query si no está vacío
      if (searchQuery.trim()) {
        searchBody.query = searchQuery;
      }
      
      const response = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          statusCode: response.status,
          headers: CORS_HEADERS,
          body: JSON.stringify({ 
            error: errorData.message || 'Notion API error',
            code: errorData.code
          })
        };
      }

      const data = await response.json();
      
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      };
    }

    // ============================================
    // ACCIÓN: Obtener páginas hijas (child_page blocks)
    // ============================================
    if (action === 'children') {
      if (!pageId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'pageId parameter is required for children action' })
        };
      }

      // Obtener todos los bloques hijos con paginación
      let allBlocks = [];
      let hasMore = true;
      let startCursor = null;

      while (hasMore) {
        const url = startCursor 
          ? `https://api.notion.com/v1/blocks/${pageId}/children?start_cursor=${startCursor}&page_size=100`
          : `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${userToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return {
            statusCode: response.status,
            headers: CORS_HEADERS,
            body: JSON.stringify({ 
              error: errorData.message || 'Notion API error',
              code: errorData.code
            })
          };
        }

        const data = await response.json();
        allBlocks = allBlocks.concat(data.results || []);
        hasMore = data.has_more;
        startCursor = data.next_cursor;
      }

      // Filtrar child_page y link_to_page blocks manteniendo el orden original
      const pageBlocks = allBlocks.filter(block => 
        block.type === 'child_page' || block.type === 'link_to_page'
      );
      
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          results: pageBlocks,
          total: allBlocks.length,
          pages_count: pageBlocks.length
        })
      };
    }

    // ============================================
    // ACCIONES EXISTENTES: page, blocks
    // ============================================
  if (!pageId) {
    return {
      statusCode: 400,
        headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'pageId parameter is required' })
    };
  }

    // Si type es 'page', obtener información de la página (para last_edited_time)
    // Si no, obtener los bloques hijos
    const apiEndpoint = type === 'page' 
      ? `https://api.notion.com/v1/pages/${pageId}`
      : `https://api.notion.com/v1/blocks/${pageId}/children`;
    
    // Hacer la petición a la API de Notion usando el token del usuario
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          error: errorData.message || 'Notion API error',
          code: errorData.code
        })
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error calling Notion API:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

