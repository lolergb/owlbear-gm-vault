/**
 * Netlify Function para hacer proxy de las llamadas a la API de Notion
 * Esto mantiene el token seguro en el servidor
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Notion-Token, X-GM-Vault-Default',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer'
};

const PERSONAL_TOKEN_ONLY_ACTIONS = new Set(['search', 'children']);
const DEFAULT_ROOT_PAGE_IDS = new Set([
  '2d8d4856c90e80f1b4e4ecff59e61dd5', // Quick Start
  '2d8d4856c90e806eb8fffd6f055eaf3b', // Session Notes Template
  '2d8d4856c90e804185b4cf910d4817c1', // The Watched Crossroads
  '2d8d4856c90e8030b014dbbb7bf5306d'  // Maera
]);
const DEFAULT_ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ACCESS_CACHE_MAX_ENTRIES = 1000;
const defaultAccessCache = new Map();

function normalizeNotionId(value) {
  const normalized = String(value || '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : '';
}

function notionHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };
}

async function fetchNotionParent(id, kind, token) {
  const endpoints = kind === 'database'
    ? [`databases/${id}`]
    : kind === 'page'
      ? [`pages/${id}`]
      : [`blocks/${id}`, `pages/${id}`];

  for (const endpoint of endpoints) {
    const response = await fetch(`https://api.notion.com/v1/${endpoint}`, {
      method: 'GET',
      headers: notionHeaders(token)
    });
    if (response.ok) {
      const resource = await response.json();
      return resource?.parent || null;
    }
    if (response.status === 429 || response.status >= 500) {
      const error = new Error('Notion authorization check is temporarily unavailable.');
      error.statusCode = response.status;
      throw error;
    }
    if (response.status !== 404) return null;
  }

  return null;
}

/**
 * Follow Notion parent relationships until one of the four public demo roots
 * is reached. The client-provided default header is only a mode selector; this
 * server-side ancestry check is the authorization boundary.
 */
async function isDefaultResourceAllowed(rawId, initialKind, token) {
  let id = normalizeNotionId(rawId);
  if (!id) return false;
  if (DEFAULT_ROOT_PAGE_IDS.has(id)) return true;

  const cacheKey = `${initialKind}:${id}`;
  const cached = defaultAccessCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < DEFAULT_ACCESS_CACHE_TTL_MS) {
    return cached.allowed;
  }

  let kind = initialKind;
  const visited = new Set();
  let allowed = false;

  for (let depth = 0; depth < 32 && id && !visited.has(id); depth += 1) {
    if (DEFAULT_ROOT_PAGE_IDS.has(id)) {
      allowed = true;
      break;
    }
    visited.add(id);

    const parent = await fetchNotionParent(id, kind, token);
    if (!parent || parent.type === 'workspace') break;

    if (parent.type === 'page_id') {
      id = normalizeNotionId(parent.page_id);
      kind = 'page';
    } else if (parent.type === 'block_id') {
      id = normalizeNotionId(parent.block_id);
      kind = 'unknown';
    } else if (parent.type === 'database_id') {
      id = normalizeNotionId(parent.database_id);
      kind = 'database';
    } else {
      break;
    }
  }

  // Only cache positive ancestry. Random denied IDs must not let an attacker
  // grow process memory or turn a transient Notion error into a long denial.
  if (allowed) {
    if (defaultAccessCache.size >= DEFAULT_ACCESS_CACHE_MAX_ENTRIES) {
      defaultAccessCache.delete(defaultAccessCache.keys().next().value);
    }
    defaultAccessCache.set(cacheKey, { allowed: true, checkedAt: Date.now() });
  }
  return allowed;
}

async function isDefaultRequestAllowed(query, token) {
  const { action, databaseId, pageId, type } = query;
  if (action === 'search' || action === 'children' || query.validate === 'true') {
    return false;
  }

  if (action === 'database' || action === 'database-info') {
    return isDefaultResourceAllowed(databaseId, 'database', token);
  }

  return isDefaultResourceAllowed(pageId, type === 'page' ? 'page' : 'unknown', token);
}

function getHeader(headers, name) {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === expected
  );
  return entry?.[1] || '';
}

function errorResponse(statusCode, error) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error })
  };
}

export const handler = async (event) => {
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

  const query = event.queryStringParameters || {};
  const { pageId, type, action, validate } = query;
  const queryToken = query.token;
  const personalToken = getHeader(event.headers, 'x-notion-token').trim();
  const useDefaultAccess = getHeader(event.headers, 'x-gm-vault-default') === '1';

  // Secrets in URLs can be retained by access logs and browser tooling. Reject
  // mixed and legacy clients instead of silently accepting an unsafe fallback.
  if (queryToken) {
    return errorResponse(400, 'Notion tokens are not accepted in query parameters. Reload GM Vault and try again.');
  }

  if (personalToken && useDefaultAccess) {
    return errorResponse(400, 'Choose either personal or default Notion access.');
  }

  if (useDefaultAccess && (validate === 'true' || PERSONAL_TOKEN_ONLY_ACTIONS.has(action))) {
    return errorResponse(403, 'This Notion operation requires a personal connection.');
  }

  const defaultToken = useDefaultAccess
    ? String(process.env.GM_VAULT_DEFAULT_CONFIG_V2 || '').trim()
    : '';
  const authToken = personalToken || defaultToken;

  if (!authToken) {
    return errorResponse(
      useDefaultAccess ? 503 : 400,
      useDefaultAccess
        ? 'Default Notion access is unavailable.'
        : 'No token provided. Configure your Notion token in the extension.'
    );
  }

  try {
    if (useDefaultAccess && !await isDefaultRequestAllowed(query, authToken)) {
      return errorResponse(403, 'This resource is not part of the GM Vault demo.');
    }

    if (validate === 'true') {
      const response = await fetch('https://api.notion.com/v1/users/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return errorResponse(
          response.status,
          errorData.message || 'Notion token validation failed'
        );
      }

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: true })
      };
    }

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
          'Authorization': `Bearer ${authToken}`,
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
            'Authorization': `Bearer ${authToken}`,
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

      // La jerarquía solo se deriva de contención real. `link_to_page` es una
      // referencia de navegación y se renderiza dentro del contenido, pero no
      // debe convertirse en una página hija del vault.
      const pageBlocks = allBlocks.filter(block => 
        block.type === 'child_page' || block.type === 'child_database'
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
    // ACCIÓN: Obtener info de una base de datos (título, etc.)
    // ============================================
    if (action === 'database-info') {
      const databaseId = event.queryStringParameters.databaseId;
      
      if (!databaseId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'databaseId parameter is required for database-info action' })
        };
      }

      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
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
    }

    // ============================================
    // ACCIÓN: Consultar páginas de una base de datos
    // ============================================
    if (action === 'database') {
      const databaseId = event.queryStringParameters.databaseId;
      
      if (!databaseId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'databaseId parameter is required for database action' })
        };
      }

      // Obtener esquema de la DB para ordenar por la columna título (mismo orden que en Notion)
      let sortByTitle = null;
      try {
        const dbResponse = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        });
        if (dbResponse.ok) {
          const dbData = await dbResponse.json();
          const properties = dbData.properties || {};
          for (const [propName, prop] of Object.entries(properties)) {
            if (prop && prop.type === 'title') {
              sortByTitle = propName;
              break;
            }
          }
        }
      } catch (_) {
        // Si falla, consultamos sin orden (comportamiento anterior)
      }

      // Consultar la base de datos con paginación (ordenada por título para coincidir con Notion)
      let allPages = [];
      let hasMore = true;
      let startCursor = null;

      while (hasMore) {
        const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
        
        const queryBody = {
          page_size: 100
        };
        
        if (sortByTitle) {
          queryBody.sorts = [{ property: sortByTitle, direction: 'ascending' }];
        }
        if (startCursor) {
          queryBody.start_cursor = startCursor;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(queryBody)
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
        allPages = allPages.concat(data.results || []);
        hasMore = data.has_more;
        startCursor = data.next_cursor;
      }
      
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          results: allPages,
          total: allPages.length
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
        'Authorization': `Bearer ${authToken}`,
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
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
