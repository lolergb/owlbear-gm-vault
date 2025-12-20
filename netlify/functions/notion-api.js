/**
 * Netlify Function para hacer proxy de las llamadas a la API de Notion
 * Esto mantiene el token seguro en el servidor
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

  // Obtener el token de las variables de entorno
  const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
  
  if (!NOTION_API_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'NOTION_API_TOKEN not configured' })
    };
  }

  // Obtener el pageId y type de los query parameters
  const { pageId, type } = event.queryStringParameters || {};
  
  if (!pageId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'pageId parameter is required' })
    };
  }

  try {
    // Si type es 'page', obtener información de la página (para last_edited_time)
    // Si no, obtener los bloques hijos
    const apiEndpoint = type === 'page' 
      ? `https://api.notion.com/v1/pages/${pageId}`
      : `https://api.notion.com/v1/blocks/${pageId}/children`;
    
    // Hacer la petición a la API de Notion
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_API_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error calling Notion API:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

