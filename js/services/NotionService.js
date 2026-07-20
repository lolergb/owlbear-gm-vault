/**
 * @fileoverview Servicio para interactuar con la API de Notion
 * 
 * Gestiona las llamadas a la API de Notion a través del proxy de Netlify.
 */

import { ROOM_CONTENT_CACHE_KEY } from '../utils/constants.js';
import { isNotionUrl } from '../utils/helpers.js';
import { log, logError, logWarn } from '../utils/logger.js';
import { resolvePageTitle } from '../utils/pageTitle.js';

/**
 * Servicio para interactuar con Notion
 */
export class NotionService {
  constructor() {
    // Referencia a OBR (se inyecta)
    this.OBR = null;
    // Referencia al CacheService
    this.cacheService = null;
    // Referencia al StorageService
    this.storageService = null;
    // Token de default cacheado
    this._defaultToken = null;
    this._defaultTokenFetched = false;
    
    // Configuración de rate limiting y reintentos
    this._maxRetries = 3;
    this._baseDelayMs = 1000; // 1 segundo base para backoff exponencial
    this._maxDelayMs = 30000; // Máximo 30 segundos de espera
    
    // Sistema de cola para throttling de peticiones simultáneas
    this._requestQueue = [];
    this._activeRequests = 0;
    this._maxConcurrentRequests = 3; // Máximo 3 peticiones simultáneas
    this._minDelayBetweenRequests = 100; // Mínimo 100ms entre peticiones
    this._lastRequestTime = 0;
  }

  /**
   * Procesa la cola de peticiones de forma controlada
   * Limita el número de peticiones simultáneas y el tiempo entre ellas
   * @private
   */
  async _processQueue() {
    // Procesar tantas peticiones como slots disponibles haya
    while (this._activeRequests < this._maxConcurrentRequests && this._requestQueue.length > 0) {
      // Obtener la siguiente petición de la cola
      const request = this._requestQueue.shift();
      
      // Asegurar un delay mínimo entre peticiones
      const timeSinceLastRequest = Date.now() - this._lastRequestTime;
      if (timeSinceLastRequest < this._minDelayBetweenRequests) {
        await new Promise(r => setTimeout(r, this._minDelayBetweenRequests - timeSinceLastRequest));
      }
      
      this._activeRequests++;
      this._lastRequestTime = Date.now();

      // Ejecutar la petición de forma asíncrona (no bloquear el while)
      this._executeRequest(request);
    }
  }

  /**
   * Ejecuta una petición individual y maneja el resultado
   * @private
   */
  async _executeRequest({ url, options, resolve, reject, attempt }) {
    try {
      const response = await this._fetchWithRetryInternal(url, options, attempt);
      resolve(response);
    } catch (error) {
      reject(error);
    } finally {
      this._activeRequests--;
      // Procesar la siguiente petición en la cola
      this._processQueue();
    }
  }

  /**
   * Añade una petición a la cola y la procesa cuando sea posible
   * @param {string} url - URL a consultar
   * @param {Object} options - Opciones de fetch
   * @param {number} attempt - Número de intento actual (0 = petición inicial)
   * @returns {Promise<Response>}
   * @private
   */
  async _fetchWithRetry(url, options = {}, attempt = 0) {
    // Si es un reintento (attempt > 0), no pasar por la cola para evitar esperas innecesarias
    // Solo las peticiones iniciales pasan por la cola para controlar el throttling
    if (attempt > 0) {
      return this._fetchWithRetryInternal(url, options, attempt);
    }
    
    // Petición inicial: añadir a la cola
    return new Promise((resolve, reject) => {
      this._requestQueue.push({ url, options, resolve, reject, attempt });
      this._processQueue();
    });
  }

  /**
   * Realiza una petición fetch con reintentos automáticos para errores 429 (rate limit)
   * Implementa backoff exponencial y respeta el header Retry-After
   * @param {string} url - URL a consultar
   * @param {Object} options - Opciones de fetch
   * @param {number} attempt - Número de intento actual (interno)
   * @returns {Promise<Response>}
   * @private
   */
  async _fetchWithRetryInternal(url, options = {}, attempt = 0) {
    try {
      const response = await fetch(url, options);
      
      // Si es un 429 (Too Many Requests), reintentar con backoff
      if (response.status === 429 && attempt < this._maxRetries) {
        // Intentar obtener el tiempo de espera del header Retry-After
        let delayMs = this._baseDelayMs * Math.pow(2, attempt); // Backoff exponencial
        
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          // Retry-After puede ser segundos o una fecha HTTP
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            delayMs = retryAfterSeconds * 1000;
          }
        }
        
        // Limitar el delay máximo
        delayMs = Math.min(delayMs, this._maxDelayMs);
        
        logWarn(`⏳ Rate limit (429) - Reintentando en ${delayMs / 1000}s (intento ${attempt + 1}/${this._maxRetries})`);
        
        // Esperar antes de reintentar
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        // Reintentar directamente (sin pasar por la cola)
        return this._fetchWithRetryInternal(url, options, attempt + 1);
      }
      
      return response;
    } catch (error) {
      // Para errores de red, también reintentar
      if (attempt < this._maxRetries && (error.name === 'TypeError' || error.message.includes('network'))) {
        const delayMs = this._baseDelayMs * Math.pow(2, attempt);
        logWarn(`⏳ Error de red - Reintentando en ${delayMs / 1000}s (intento ${attempt + 1}/${this._maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return this._fetchWithRetryInternal(url, options, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Normaliza un ID de Notion al formato UUID con guiones
   * @param {string} id - ID a normalizar
   * @returns {string} - ID normalizado con guiones
   */
  _normalizeId(id) {
    if (!id || id.includes('-') || id.length !== 32) return id;
    return `${id.substring(0, 8)}-${id.substring(8, 12)}-${id.substring(12, 16)}-${id.substring(16, 20)}-${id.substring(20, 32)}`;
  }

  /**
   * Extrae labels (tags) de las propiedades de una página de base de datos
   * Busca en propiedades de tipo: select, multi_select, status
   * @param {Object} page - Página de Notion con propiedades
   * @returns {Array<string>} - Array de labels encontrados
   */
  _extractLabelsFromPage(page) {
    const labels = [];
    
    if (!page?.properties) return labels;
    
    for (const [propName, propValue] of Object.entries(page.properties)) {
      // Select (un solo valor)
      if (propValue.type === 'select' && propValue.select?.name) {
        labels.push(propValue.select.name);
      }
      // Multi-select (múltiples valores)
      else if (propValue.type === 'multi_select' && propValue.multi_select) {
        for (const option of propValue.multi_select) {
          if (option.name) {
            labels.push(option.name);
          }
        }
      }
      // Status
      else if (propValue.type === 'status' && propValue.status?.name) {
        labels.push(propValue.status.name);
      }
    }
    
    return labels;
  }

  /**
   * Verifica si un label coincide con un nombre de categoría (matching flexible)
   * Ejemplos: "NPC" coincide con "NPCs de mi juego", "Villain" con "Villains"
   * @param {string} label - Label de la página
   * @param {string} categoryName - Nombre de la categoría
   * @returns {boolean} - true si hay coincidencia
   */
  _labelMatchesCategory(label, categoryName) {
    if (!label || !categoryName) return false;
    
    const normalizedLabel = label.toLowerCase().trim();
    const normalizedCategory = categoryName.toLowerCase().trim();
    
    // Match exacto
    if (normalizedLabel === normalizedCategory) return true;
    
    // El label está contenido en el nombre de la categoría
    // "npc" está en "npcs de mi juego"
    if (normalizedCategory.includes(normalizedLabel)) return true;
    
    // La categoría empieza con el label + variaciones plurales
    // "npc" coincide con "npcs"
    if (normalizedCategory.startsWith(normalizedLabel)) return true;
    
    // El label es plural y la categoría es singular o viceversa
    // "npcs" coincide con "npc", "villains" con "villain"
    const labelWithoutS = normalizedLabel.endsWith('s') ? normalizedLabel.slice(0, -1) : normalizedLabel;
    const categoryWithoutS = normalizedCategory.endsWith('s') ? normalizedCategory.slice(0, -1) : normalizedCategory;
    
    if (labelWithoutS === categoryWithoutS) return true;
    if (normalizedCategory.includes(labelWithoutS)) return true;
    if (normalizedCategory.startsWith(labelWithoutS)) return true;
    
    return false;
  }

  /**
   * Encuentra la mejor categoría para un label dado las categorías existentes
   * @param {string} label - Label a buscar
   * @param {Array<string>} categoryNames - Nombres de categorías existentes
   * @returns {string|null} - Nombre de la categoría coincidente o null
   */
  _findMatchingCategory(label, categoryNames) {
    for (const categoryName of categoryNames) {
      if (this._labelMatchesCategory(label, categoryName)) {
        return categoryName;
      }
    }
    return null;
  }

  /**
   * Inyecta dependencias
   * @param {Object} deps - Dependencias
   */
  setDependencies({ OBR, cacheService, storageService }) {
    if (OBR) this.OBR = OBR;
    if (cacheService) this.cacheService = cacheService;
    if (storageService) this.storageService = storageService;
  }

  /**
   * Obtiene el token de default desde Netlify (solo una vez)
   * @private
   * @returns {Promise<string|null>}
   */
  async _getDefaultToken() {
    if (this._defaultTokenFetched) {
      return this._defaultToken;
    }

    try {
      const response = await fetch('/.netlify/functions/get-default-token');
      if (response.ok) {
        const data = await response.json();
        this._defaultToken = data.token || null;
        this._defaultTokenFetched = true;
        if (this._defaultToken) {
          log('🔑 Token de default-config obtenido');
        }
        return this._defaultToken;
      }
    } catch (e) {
      logWarn('No se pudo obtener token de default:', e);
    }

    this._defaultTokenFetched = true;
    return null;
  }

  /**
   * Obtiene los bloques de una página de Notion
   * @param {string} pageId - ID de la página
   * @param {boolean} useCache - Si usar caché
   * @returns {Promise<Array>}
   */
  async fetchBlocks(pageId, useCache = true) {
    // Intentar obtener del caché local primero
    if (useCache && this.cacheService) {
      const cachedBlocks = this.cacheService.getCachedBlocks(pageId);
      if (cachedBlocks && cachedBlocks.length > 0) {
        log('✅ Usando caché persistente para:', pageId, '-', cachedBlocks.length, 'bloques');
        return cachedBlocks;
      }
      log('⚠️ No hay caché para:', pageId, '- se pedirá a la API');
    } else if (!useCache) {
      log('🔄 Recarga forzada - ignorando caché para:', pageId, '(se obtendrá de la API)');
    }

    try {
      // Obtener token del usuario
      let tokenToUse = this.storageService?.getUserToken();
      
      // Si no hay token de usuario, intentar usar el token de default
      if (!tokenToUse) {
        tokenToUse = await this._getDefaultToken();
      }
      
      if (!tokenToUse) {
        // Sin token, intentar obtener del caché compartido
        const sharedBlocks = await this._getFromSharedCache(pageId);
        if (sharedBlocks) {
          return sharedBlocks;
        }
        // Retornar null para que el controlador solicite al GM
        log('⚠️ No hay token, el contenido debe ser solicitado al GM');
        return null;
      }

      log('🌐 Obteniendo bloques desde la API para:', pageId);
      
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(tokenToUse)}`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 401) {
          throw new Error('Invalid token or no permissions. Verify that the configured token is correct.');
        } else if (response.status === 404) {
          throw new Error('Page not found. Verify that the URL is correct.');
        } else {
          throw new Error(`Error de API: ${response.status} - ${errorData.message || response.statusText}`);
        }
      }

      const data = await response.json();
      const blocks = data.results || [];
      
      log('📦 Bloques recibidos de la API:', blocks.length);

      // Guardar en caché
      if (this.cacheService && blocks.length > 0) {
        await this.cacheService.setCachedBlocks(pageId, blocks);
      }

      return blocks;
    } catch (e) {
      logError('Error al obtener bloques:', e);
      throw e;
    }
  }

  /**
   * Obtiene información de una página (icono, última edición)
   * @param {string} pageId - ID de la página
   * @param {boolean} useCache - Si usar caché (default: true)
   * @returns {Promise<Object>}
   */
  async fetchPageInfo(pageId, useCache = true) {
    if (!pageId || pageId === 'null' || pageId === 'undefined') {
      log('⚠️ fetchPageInfo: pageId inválido');
      return { lastEditedTime: null, icon: null };
    }

    // Intentar obtener del caché
    if (useCache && this.cacheService) {
      const cached = this.cacheService.getCachedPageInfo(pageId);
      if (cached) {
        log('📄 PageInfo del caché:', { 
          hasCover: !!cached.cover, 
          hasIcon: !!cached.icon,
          coverType: cached.cover?.type || 'none'
        });
        return cached;
      }
    } else if (!useCache) {
      log('🔄 Recarga forzada - ignorando caché de PageInfo para:', pageId);
    }

    try {
      // Obtener token del usuario o usar el de default
      let tokenToUse = this.storageService?.getUserToken();
      if (!tokenToUse) {
        tokenToUse = await this._getDefaultToken();
      }
      
      if (!tokenToUse) {
        return { lastEditedTime: null, icon: null };
      }

      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(tokenToUse)}&type=page`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        return { lastEditedTime: null, icon: null };
      }

      const data = await response.json();
      const pageInfo = {
        lastEditedTime: data.last_edited_time || null,
        icon: data.icon || null,
        cover: data.cover || null,
        properties: data.properties || null
      };

      log('📄 PageInfo obtenido de API:', { 
        hasCover: !!pageInfo.cover, 
        hasIcon: !!pageInfo.icon,
        hasProperties: !!pageInfo.properties,
        coverType: pageInfo.cover?.type || 'none',
        iconType: pageInfo.icon?.type || 'none'
      });

      // Guardar en caché
      if (this.cacheService) {
        this.cacheService.setCachedPageInfo(pageId, pageInfo);
      }

      return pageInfo;
    } catch (e) {
      logError('Error al obtener info de página:', e);
      return { lastEditedTime: null, icon: null };
    }
  }

  /**
   * Obtiene los bloques hijos de un bloque
   * @param {string} blockId - ID del bloque padre
   * @param {boolean} useCache - Si usar caché
   * @returns {Promise<Array>}
   */
  async fetchChildBlocks(blockId, useCache = true) {
    // Intentar obtener del caché primero
    if (useCache && this.cacheService) {
      const cachedBlocks = this.cacheService.getCachedBlocks(blockId);
      if (cachedBlocks && cachedBlocks.length > 0) {
        log('✅ Usando caché para hijos del bloque:', blockId);
        return cachedBlocks;
      }
    }

    try {
      // Obtener token del usuario o usar el de default
      let tokenToUse = this.storageService?.getUserToken();
      if (!tokenToUse) {
        tokenToUse = await this._getDefaultToken();
      }
      
      if (!tokenToUse) {
        return [];
      }

      // Usar el mismo endpoint que para páginas - la API de Notion usa el mismo endpoint
      // para obtener hijos de bloques, pasando el blockId como pageId
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}&token=${encodeURIComponent(tokenToUse)}`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        logWarn('Error al obtener hijos del bloque:', blockId, response.status);
        return [];
      }

      const data = await response.json();
      const blocks = data.results || [];
      
      // Guardar en caché
      if (this.cacheService && blocks.length > 0) {
        await this.cacheService.setCachedBlocks(blockId, blocks);
      }
      
      return blocks;
    } catch (e) {
      logError('Error al obtener bloques hijos:', e);
      return [];
    }
  }

  /**
   * Verifica si el token actual es válido
   * @returns {Promise<boolean>}
   */
  async validateToken() {
    try {
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        return false;
      }

      // Hacer una llamada simple para verificar el token
      const response = await this._fetchWithRetry(`/.netlify/functions/notion-api?validate=true&token=${encodeURIComponent(userToken)}`);
      
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Busca páginas en el workspace del usuario
   * @param {string} query - Término de búsqueda (opcional)
   * @returns {Promise<Array>} - Lista de páginas encontradas
   */
  async searchWorkspacePages(query = '') {
    try {
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        throw new Error('No Notion token configured. Please add your token in Settings.');
      }

      log('🔍 Buscando páginas en workspace...');
      
      const params = new URLSearchParams({
        action: 'search',
        token: userToken,
        filter: 'page'
      });
      
      if (query.trim()) {
        params.append('query', query);
      }
      
      const response = await this._fetchWithRetry(`/.netlify/functions/notion-api?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      const pages = data.results || [];
      
      log('📄 Páginas encontradas:', pages.length);
      
      // Mapear a formato simplificado
      return pages.map(page => {
        const title = this._extractPageTitle(page);
        return {
          id: page.id,
          title,
          icon: page.icon,
          cover: page.cover,
          url: this._buildNotionUrl(title, page.id),
          lastEdited: page.last_edited_time,
          parent: page.parent
        };
      });
    } catch (e) {
      logError('Error al buscar páginas:', e);
      throw e;
    }
  }

  /**
   * Obtiene las páginas hijas y enlaces de una página (en orden de Notion)
   * @param {string} pageId - ID de la página padre
   * @returns {Promise<Array>} - Lista de páginas hijas y enlazadas en orden
   */
  async fetchChildPages(pageId) {
    try {
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        throw new Error('No Notion token configured');
      }

      log('📂 Obteniendo páginas hijas de:', pageId);
      
      const params = new URLSearchParams({
        action: 'children',
        pageId: pageId,
        token: userToken
      });
      
      const response = await this._fetchWithRetry(`/.netlify/functions/notion-api?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      const pageBlocks = data.results || [];
      
      log('📂 Bloques de página encontrados:', pageBlocks.length);
      
      // Los enlaces de contenido son navegación, no relaciones padre-hijo.
      // No atravesar child_page aquí: hacerlo promovería referencias de una
      // página hija al nivel de su padre.
      const mentionsInContent = await this._extractMentionsFromBlocks(pageBlocks, false);
      const mentionedPageIds = new Set(mentionsInContent.map(m => {
        // Normalizar ID para comparación
        let id = m.pageId;
        if (!id.includes('-') && id.length === 32) {
          id = `${id.substring(0, 8)}-${id.substring(8, 12)}-${id.substring(12, 16)}-${id.substring(16, 20)}-${id.substring(20, 32)}`;
        }
        return id;
      }));
      
      if (mentionedPageIds.size > 0) {
        log(`🔍 Mentions encontrados en contenido: ${mentionedPageIds.size} (se usarán para filtrar bases de datos)`);
      }
      
      // Procesar bloques en orden (child_page, link_to_page y child_database mezclados)
      const results = [];
      
      for (const block of pageBlocks) {
        if (block.type === 'child_page') {
          const title = block.child_page?.title || 'Untitled';
          results.push({
            id: block.id,
            title,
            url: this._buildNotionUrl(title, block.id),
            type: 'child_page'
          });
        } else if (block.type === 'link_to_page') {
          const linkInfo = block.link_to_page;
          if (!linkInfo) continue;

          let linkedPageId = null;
          if (linkInfo.type === 'page_id') {
            linkedPageId = linkInfo.page_id;
          } else if (linkInfo.type === 'database_id') {
            // link_to_page a una base de datos - obtener páginas (filtradas por mentions si existen)
            const databaseId = linkInfo.database_id;
            try {
              const dbPages = await this.fetchDatabasePages(databaseId);
              
              // Escanear mentions dentro de las propiedades de las páginas de DB
              for (const dbPage of dbPages) {
                if (dbPage.properties) {
                  const propertyMentions = this._extractMentionsFromPageProperties(dbPage.properties, dbPage.title);
                  for (const mention of propertyMentions) {
                    const normalizedId = this._normalizeId(mention.pageId);
                    mentionedPageIds.add(normalizedId);
                  }
                }
              }
              
              if (mentionedPageIds.size > 0) {
                log(`🔍 Total mentions encontrados (incluyendo properties de DB): ${mentionedPageIds.size}`);
              }
              
              // Filtrar por mentions si hay alguno en el contenido
              let pagesToAdd = dbPages;
              if (mentionedPageIds.size > 0) {
                const filteredPages = dbPages.filter(dbPage => {
                  let pageId = dbPage.id;
                  if (!pageId.includes('-') && pageId.length === 32) {
                    pageId = `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
                  }
                  return mentionedPageIds.has(pageId) || mentionedPageIds.has(dbPage.id);
                });
                
                if (filteredPages.length > 0) {
                  pagesToAdd = filteredPages;
                  log(`🔍 Linked DB filtrado por mentions: ${filteredPages.length} de ${dbPages.length} páginas`);
                } else {
                  log('📊 Linked DB: no hay coincidencias con mentions, importando todas las páginas');
                }
              }
              
              for (const dbPage of pagesToAdd) {
                results.push({
                  id: dbPage.id,
                  title: dbPage.title,
                  url: dbPage.url,
                  type: 'database_page',
                  databaseId: databaseId,
                  labels: dbPage.labels || [] // Incluir labels para agrupación
                });
              }
            } catch (e) {
              logWarn('No se pudo obtener páginas de base de datos enlazada:', databaseId, e);
            }
            continue;
          }

          if (!linkedPageId) continue;

          try {
            const pageInfo = await this.fetchPageInfo(linkedPageId, false);
            const title = this._extractPageTitleFromInfo(pageInfo) || 'Linked Page';
            
            results.push({
              id: linkedPageId,
              title,
              url: this._buildNotionUrl(title, linkedPageId),
              type: 'link_to_page'
            });
          } catch (e) {
            logWarn('No se pudo obtener info de página enlazada:', linkedPageId, e);
          }
        } else if (block.type === 'child_database') {
          // Base de datos inline - obtener páginas (filtradas por mentions si existen)
          const databaseId = block.id;
          const databaseTitle = block.child_database?.title || 'Database';
          
          log('📊 Procesando base de datos:', databaseTitle, databaseId);
          
          try {
            const dbPages = await this.fetchDatabasePages(databaseId);
            log('📊 Páginas encontradas en DB:', dbPages.length);
            
            // Escanear mentions dentro de las propiedades de las páginas de DB
            for (const dbPage of dbPages) {
              if (dbPage.properties) {
                const propertyMentions = this._extractMentionsFromPageProperties(dbPage.properties, dbPage.title);
                for (const mention of propertyMentions) {
                  const normalizedId = this._normalizeId(mention.pageId);
                  mentionedPageIds.add(normalizedId);
                }
              }
            }
            
            if (mentionedPageIds.size > 0) {
              log(`🔍 Total mentions encontrados (incluyendo properties de DB): ${mentionedPageIds.size}`);
            }
            
            // Filtrar por mentions si hay alguno en el contenido
            let pagesToAdd = dbPages;
            if (mentionedPageIds.size > 0) {
              // Normalizar IDs de páginas de la DB para comparación
              const filteredPages = dbPages.filter(dbPage => {
                let pageId = dbPage.id;
                if (!pageId.includes('-') && pageId.length === 32) {
                  pageId = `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
                }
                return mentionedPageIds.has(pageId) || mentionedPageIds.has(dbPage.id);
              });
              
              if (filteredPages.length > 0) {
                pagesToAdd = filteredPages;
                log(`🔍 Filtrado por mentions: ${filteredPages.length} de ${dbPages.length} páginas`);
              } else {
                // Si no hay coincidencias, importar todas (comportamiento por defecto)
                log('📊 No hay coincidencias con mentions, importando todas las páginas');
              }
            }
            
            for (const dbPage of pagesToAdd) {
              results.push({
                id: dbPage.id,
                title: dbPage.title,
                url: dbPage.url,
                type: 'database_page',
                databaseId: databaseId,
                databaseTitle: databaseTitle,
                labels: dbPage.labels || [] // Incluir labels para agrupación
              });
            }
          } catch (e) {
            logWarn('No se pudo obtener páginas de base de datos:', databaseId, e);
          }
        }
      }

      return results;
    } catch (e) {
      logError('Error al obtener páginas hijas:', e);
      throw e;
    }
  }

  /**
   * Verifica si una página tiene contenido real
   * Patrón: (título/heading || párrafo con texto) & NO solo bases de datos
   * Una página con solo child_database NO cuenta como contenido propio
   * Una página con solo título + lista de mentions NO cuenta (es solo navegación)
   * @param {string} pageId - ID de la página
   * @returns {Promise<boolean>} - true si tiene contenido real
   */
  async hasRealContent(pageId) {
    try {
      const blocks = await this.fetchBlocks(pageId, true);
      
      if (!blocks || blocks.length === 0) {
        return false;
      }

      let hasTextContent = false;  // Tiene párrafo con texto real (no solo mentions)
      let hasRichContent = false;  // Tiene imágenes, videos, tablas, etc.
      let onlyHasDatabase = true;  // Solo tiene child_database (sin contenido real)
      let headingCount = 0;        // Cantidad de headings
      let listItemsWithOnlyMentions = 0;  // Lista items que solo tienen mentions
      let listItemsWithRealText = 0;      // Lista items con texto real (no solo mentions)

      for (const block of blocks) {
        // Ignorar child_page y link_to_page (son hijas, no contenido propio)
        if (block.type === 'child_page' || block.type === 'link_to_page') {
          continue;
        }

        // child_database no cuenta como contenido real por sí solo
        if (block.type === 'child_database') {
          continue;
        }

        // Párrafos con texto real (no solo mentions)
        if (block.type === 'paragraph') {
          const text = block.paragraph?.rich_text;
          if (text && text.length > 0) {
            const hasRealText = this._hasRealTextContent(text);
            if (hasRealText) {
              hasTextContent = true;
              onlyHasDatabase = false;
            }
          }
          continue;
        }

        // Headings con texto
        if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3' || block.type === 'heading_4') {
          const headingData = block[block.type];
          const text = headingData?.rich_text;
          if (text && text.length > 0 && text.some(t => t.plain_text?.trim())) {
            headingCount++;
            onlyHasDatabase = false;
          }
          // Headings con hijos (toggles) también cuentan como contenido real
          if (block.has_children) {
            hasRichContent = true;
            onlyHasDatabase = false;
          }
          continue;
        }

        // Listas - verificar si tienen texto real o solo mentions
        if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item' || block.type === 'to_do') {
          const listData = block[block.type];
          const text = listData?.rich_text;
          if (text && text.length > 0) {
            const hasRealText = this._hasRealTextContent(text);
            if (hasRealText) {
              listItemsWithRealText++;
              onlyHasDatabase = false;
            } else if (this._hasOnlyMentions(text)) {
              listItemsWithOnlyMentions++;
              onlyHasDatabase = false;
            }
          }
          continue;
        }

        // Contenido rico (imágenes, videos, tablas, etc.)
        const richContentTypes = [
          'image', 'video', 'embed', 'bookmark', 'code', 'quote',
          'callout', 'table', 'toggle', 'equation', 'column_list',
          'synced_block', 'template', 'link_preview', 'file', 'pdf', 'audio'
        ];
        
        if (richContentTypes.includes(block.type)) {
          hasRichContent = true;
          onlyHasDatabase = false;
        }

        // Dividers solos no cuentan
        if (block.type === 'divider') {
          continue;
        }
      }

      // Caso especial: si solo tiene título(s) + lista de mentions, NO es contenido real
      // Esto es típicamente una página de navegación/índice (ej: "NPCs" con lista de links)
      const isOnlyNavigationContent = 
        !hasTextContent && 
        !hasRichContent && 
        headingCount <= 1 && 
        listItemsWithRealText === 0 && 
        listItemsWithOnlyMentions > 0;

      if (isOnlyNavigationContent) {
        log(`⏭️ Página detectada como solo navegación: ${headingCount} heading(s), ${listItemsWithOnlyMentions} mention(s) en lista`);
        return false;
      }

      // Tiene contenido si tiene texto real, contenido rico, o listas con texto real
      const hasContent = hasTextContent || hasRichContent || listItemsWithRealText > 0;
      return hasContent && !onlyHasDatabase;
    } catch (e) {
      logWarn('Error verificando contenido de página:', pageId, e);
      return true; // En caso de error, asumimos que tiene contenido
    }
  }

  /**
   * Verifica si un rich_text tiene contenido de texto real (no solo mentions)
   * @private
   * @param {Array} richText - Array de rich_text de Notion
   * @returns {boolean} - true si tiene texto real además de mentions
   */
  _hasRealTextContent(richText) {
    if (!richText || richText.length === 0) return false;
    
    for (const item of richText) {
      // Ignorar mentions - no son contenido de texto "real"
      if (item.type === 'mention') {
        continue;
      }
      // Si hay texto que no es solo espacios en blanco
      if (item.type === 'text' && item.plain_text?.trim()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Verifica si un rich_text contiene solo mentions (links a páginas)
   * @private
   * @param {Array} richText - Array de rich_text de Notion
   * @returns {boolean} - true si solo tiene mentions
   */
  _hasOnlyMentions(richText) {
    if (!richText || richText.length === 0) return false;
    
    let hasMentions = false;
    for (const item of richText) {
      if (item.type === 'mention' && item.mention?.type === 'page') {
        hasMentions = true;
      } else if (item.type === 'text' && item.plain_text?.trim()) {
        // Tiene texto real además de mentions
        return false;
      }
    }
    return hasMentions;
  }

  /**
   * Extrae el título de la información de página
   * @private
   */
  _extractPageTitleFromInfo(pageInfo) {
    if (!pageInfo || !pageInfo.properties) return null;
    
    // Buscar propiedad "title" o "Name" (unir todos los fragmentos: emoji + texto)
    const titleProp = pageInfo.properties.title || pageInfo.properties.Title || 
                      pageInfo.properties.Name || pageInfo.properties.name;
    if (titleProp && titleProp.title && Array.isArray(titleProp.title)) {
      const full = (titleProp.title.map(t => t.plain_text || '')).join('').trim();
      if (full) return full;
    }
    
    // Buscar cualquier propiedad tipo title
    for (const prop of Object.values(pageInfo.properties)) {
      if (prop.type === 'title' && prop.title && Array.isArray(prop.title)) {
        const full = (prop.title.map(t => t.plain_text || '')).join('').trim();
        if (full) return full;
      }
    }
    
    return null;
  }

  /**
   * Extrae todos los mentions de tipo página de un array de bloques (recursivo)
   * @param {Array} blocks - Bloques de Notion
   * @param {boolean} recursive - Si true, escanea también bloques hijos (default: true)
   * @returns {Promise<Array>} - Array de {pageId, text} para cada mention encontrado
   */
  async _extractMentionsFromBlocks(blocks, recursive = true) {
    const mentions = [];
    
    const extractFromRichText = (richTextArray) => {
      if (!richTextArray) return;
      for (const item of richTextArray) {
        if (item.type === 'mention' && item.mention?.type === 'page') {
          mentions.push({
            pageId: item.mention.page.id,
            text: item.plain_text || 'Untitled'
          });
        }
      }
    };
    
    const processBlock = async (block) => {
      // Extraer de diferentes tipos de bloques que tienen rich_text
      const blockData = block[block.type];
      if (blockData?.rich_text) {
        extractFromRichText(blockData.rich_text);
      }
      if (blockData?.caption) {
        extractFromRichText(blockData.caption);
      }
      // Para callouts
      if (blockData?.text) {
        extractFromRichText(blockData.text);
      }
      
      // Escanear celdas de tablas (table_row)
      if (block.type === 'table_row' && blockData?.cells) {
        for (const cell of blockData.cells) {
          // Cada cell es un array de rich_text
          if (Array.isArray(cell)) {
            extractFromRichText(cell);
          }
        }
      }
      
      // Recursión: escanear bloques hijos (toggles, callouts, etc.)
      const crossesPageBoundary = block.type === 'child_page'
        || block.type === 'child_database'
        || block.type === 'link_to_page';
      if (recursive && block.has_children && !crossesPageBoundary) {
        try {
          const children = await this.fetchChildBlocks(block.id, true);
          if (children && children.length > 0) {
            const childMentions = await this._extractMentionsFromBlocks(children, true);
            for (const cm of childMentions) {
              mentions.push(cm);
            }
          }
        } catch (e) {
          // Si falla, continuar sin los hijos
        }
      }
    };
    
    for (const block of blocks) {
      await processBlock(block);
    }
    
    // Eliminar duplicados por pageId
    const uniqueMentions = [];
    const seenIds = new Set();
    for (const mention of mentions) {
      const normalizedId = this._normalizeId(mention.pageId);
      if (!seenIds.has(normalizedId)) {
        seenIds.add(normalizedId);
        uniqueMentions.push({ ...mention, pageId: normalizedId });
      }
    }
    
    return uniqueMentions;
  }

  /**
   * Extrae mentions de las propiedades de una página de base de datos
   * @param {Object} properties - Propiedades de la página de DB
   * @param {string} pageTitle - Título de la página que contiene estas propiedades (para logging)
   * @returns {Array} - Array de {pageId, text}
   * @private
   */
  _extractMentionsFromPageProperties(properties, pageTitle = '') {
    const mentions = [];
    
    if (!properties) return mentions;
    
    const extractFromRichText = (richTextArray) => {
      if (!richTextArray) return;
      for (const item of richTextArray) {
        if (item.type === 'mention' && item.mention?.type === 'page') {
          // El plain_text del mention suele contener el título de la página mencionada
          const mentionText = item.plain_text?.trim() || null;
          mentions.push({
            pageId: item.mention.page.id,
            text: mentionText
          });
          if (pageTitle) {
            log(`  🔗 Mention detectado en "${pageTitle}": ${mentionText || item.mention.page.id}`);
          }
        }
      }
    };
    
    // Iterar sobre todas las propiedades
    for (const [propName, property] of Object.entries(properties)) {
      // Propiedades con rich_text (text, title)
      if (property.type === 'rich_text' && property.rich_text) {
        extractFromRichText(property.rich_text);
      }
      if (property.type === 'title' && property.title) {
        extractFromRichText(property.title);
      }
      // Propiedades de relación pueden tener IDs de páginas
      if (property.type === 'relation' && property.relation) {
        for (const rel of property.relation) {
          if (rel.id) {
            mentions.push({
              pageId: rel.id,
              text: 'Related page'
            });
            if (pageTitle) {
              log(`  🔗 Relación detectada en "${pageTitle}": ${rel.id}`);
            }
          }
        }
      }
    }
    
    // Eliminar duplicados
    const uniqueMentions = [];
    const seenIds = new Set();
    for (const mention of mentions) {
      const normalizedId = this._normalizeId(mention.pageId);
      if (!seenIds.has(normalizedId)) {
        seenIds.add(normalizedId);
        uniqueMentions.push({ ...mention, pageId: normalizedId });
      }
    }
    
    return uniqueMentions;
  }

  /**
   * Obtiene información completa de una página mencionada
   * @param {string} pageId - ID de la página
   * @returns {Promise<Object|null>} - {id, title, url, parentDbId, parentDbTitle} o null
   */
  async _getMentionedPageInfo(pageId) {
    try {
      let tokenToUse = this.storageService?.getUserToken();
      if (!tokenToUse) {
        tokenToUse = await this._getDefaultToken();
      }
      
      if (!tokenToUse) return null;

      // Obtener info de la página
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(tokenToUse)}&type=page`;
      
      const response = await this._fetchWithRetry(apiUrl);
      if (!response.ok) {
        // 404 significa que la página no está compartida con la integración o no existe
        // No logear como error ya que es un caso esperado para mentions a páginas externas
        return null;
      }

      const pageData = await response.json();
      
      // Extraer título
      const title = this._extractPageTitle(pageData) || 'Untitled';
      
      // Debug: mostrar si se obtuvo título correctamente
      if (title === 'Untitled') {
        logWarn(`⚠️ No se pudo extraer título de página ${pageId}. properties:`, !!pageData.properties, 'url:', pageData.url);
      } else {
        log(`✅ Título obtenido para mention: "${title}"`);
      }
      
      // Verificar si el parent es una base de datos
      let parentDbId = null;
      let parentDbTitle = null;
      
      if (pageData.parent?.type === 'database_id') {
        parentDbId = pageData.parent.database_id;
        
        // Obtener nombre de la base de datos
        const dbInfo = await this._fetchDatabaseTitle(parentDbId, tokenToUse);
        parentDbTitle = dbInfo || 'Database';
      }
      
      return {
        id: pageId,
        title,
        url: this._buildNotionUrl(title, pageId),
        parentDbId,
        parentDbTitle
      };
    } catch (e) {
      logWarn('Error obteniendo info de página mencionada:', pageId, e);
      return null;
    }
  }

  /**
   * Obtiene el título de una base de datos
   * @private
   */
  async _fetchDatabaseTitle(databaseId, token) {
    try {
      const params = new URLSearchParams({
        action: 'database-info',
        databaseId: databaseId,
        token: token
      });
      
      const response = await this._fetchWithRetry(`/.netlify/functions/notion-api?${params.toString()}`);
      
      if (!response.ok) {
        logWarn('Error obteniendo info de DB:', response.status);
        return null;
      }
      
      const data = await response.json();
      if (data.title && Array.isArray(data.title)) {
        return data.title.map(t => t.plain_text || '').join('') || null;
      }
      return null;
    } catch (e) {
      logWarn('Error obteniendo título de DB:', databaseId, e);
      return null;
    }
  }

  /**
   * Genera la estructura de vault recursivamente desde una página
   * Usa el nuevo formato items[] para simplicidad y orden implícito
   * 
   * @param {string} pageId - ID de la página raíz
   * @param {string} pageTitle - Título de la página raíz
   * @param {number} maxDepth - Profundidad máxima (default: 10)
   * @param {Function} onProgress - Callback de progreso
   * @returns {Promise<Object>} - Estructura de vault en formato items[]
   */
  async generateVaultFromPage(pageId, pageTitle, maxDepth = 10, onProgress = null) {
    const stats = {
      pagesImported: 0,
      pagesSkipped: 0,      // Por profundidad máxima
      emptyPages: 0,        // Páginas vacías
      dbPagesFiltered: 0,   // Páginas de DB filtradas intencionalmente (no es error)
      unsupportedTypes: new Set()
    };
    const visitedPageIds = new Set();

    /**
     * Procesa una página y devuelve un item (page o category con items[])
     */
    const processPage = async (id, title, depth = 0) => {
      if (depth >= maxDepth) {
        stats.pagesSkipped++;
        return null;
      }

      const normalizedId = this._normalizeId(id);
      if (visitedPageIds.has(normalizedId)) {
        log(`↪️ Saltando página ya recorrida: ${title}`);
        return null;
      }
      visitedPageIds.add(normalizedId);

      try {
        // Reportar progreso
        if (onProgress) {
          onProgress({ 
            message: `Processing: ${title}...`, 
            depth,
            pagesImported: stats.pagesImported 
          });
        }

        // Obtener páginas hijas (ya vienen en orden de Notion)
        const childPages = await this.fetchChildPages(id);
        
        // Si no hay hijas, es una página simple
        if (childPages.length === 0) {
          const hasContent = await this.hasRealContent(id);
          
          if (!hasContent) {
            log(`⏭️ Saltando página vacía: ${title}`);
            stats.emptyPages++;
            stats.pagesSkipped++;
            return null;
          }
          
          stats.pagesImported++;
          return {
            type: 'page',
            name: title,
            url: this._buildNotionUrl(title, id)
          };
        }

        // Si hay hijas, crear una categoría con items[]
        const items = [];
        
        // Mapa de categorías por nombre para agrupar por labels
        const categoryMap = new Map(); // categoryName -> { type: 'category', name, items: [] }

        // Verificar si la página principal tiene contenido real
        const mainPageHasContent = await this.hasRealContent(id);
        if (mainPageHasContent) {
          items.push({
            type: 'page',
            name: title,
            url: this._buildNotionUrl(title, id)
          });
          stats.pagesImported++;
        }

        // PASO 1: Procesar páginas normales primero para obtener categorías existentes
        const dbPagesForLater = [];
        for (const child of childPages) {
          if (child.type === 'database_page' && child.databaseId) {
            // Guardar páginas de DB para procesarlas después
            dbPagesForLater.push(child);
          } else {
            // Página normal - procesar recursivamente
            const result = await processPage(child.id, child.title, depth + 1);
            if (result) {
              items.push(result);
              // Si es una categoría, registrarla para matching por labels
              if (result.type === 'category') {
                categoryMap.set(result.name, result);
              }
            }
          }
        }
        
        // PASO 2: Procesar páginas de DB
        // 
        // COMPORTAMIENTO ACTUAL: Los items de una tabla (database) se crean en una carpeta con el nombre de la tabla
        // 
        // Lógica de asignación:
        // 1. Si una página de DB tiene un label que coincide con una categoría existente → se añade a esa categoría
        // 2. Si el nombre de la DB coincide con el título de la página que la contiene → se añaden directamente (sin carpeta)
        // 3. Si no hay coincidencia por label ni por nombre → se crea una carpeta nueva con el nombre de la base de datos (databaseTitle)
        // 
        // Ejemplo:
        //   - Página "NPCs" contiene una base de datos "NPCs" con items: "Indithir", "Thava", "Gareth"
        //   - Resultado: Los items se añaden directamente a la página "NPCs" (sin crear carpeta "NPCs")
        // 
        //   - Página "Personajes" contiene una base de datos "NPCs" con items: "Indithir", "Thava", "Gareth"
        //   - Resultado: Carpeta "NPCs" con páginas "Indithir", "Thava", "Gareth"
        // 
        // NOTA: Si en el futuro se quiere cambiar este comportamiento (ej: añadir items directamente sin carpeta),
        // modificar la lógica en las líneas 1208-1240 y 1243-1253
        //
        const existingCategoryNames = Array.from(categoryMap.keys());
        const databaseFolders = new Map(); // databaseTitle -> pages[]
        let dbAssignedToCategory = 0;
        let dbInFolders = 0;
        let dbAddedDirectly = 0; // Items añadidos directamente porque DB tiene mismo nombre que página
        
        for (const child of dbPagesForLater) {
          const pageData = {
            type: 'page',
            name: child.title,
            url: child.url
          };
          
          let assignedToCategory = false;
          let addedDirectly = false;
          
          // Buscar si algún label coincide con una categoría existente
          if (child.labels && child.labels.length > 0) {
            for (const label of child.labels) {
              const matchingCategoryName = this._findMatchingCategory(label, existingCategoryNames);
              
              if (matchingCategoryName) {
                // Añadir a la categoría existente
                const category = categoryMap.get(matchingCategoryName);
                if (category && category.items) {
                  category.items.push(pageData);
                  assignedToCategory = true;
                  dbAssignedToCategory++;
                  log(`  ✅ "${child.title}" asignado a "${matchingCategoryName}" por label "${label}"`);
                  break;
                }
              }
            }
          }
          
          // Si no se asignó por label, verificar si la DB tiene el mismo nombre que la página actual
          if (!assignedToCategory) {
            const dbTitle = child.databaseTitle || '';
            const invalidTitles = ['Untitled', 'Database', ''];
            
            // Comparar nombre de DB con título de página (case-insensitive)
            const dbTitleNormalized = dbTitle.trim().toLowerCase();
            const pageTitleNormalized = title.trim().toLowerCase();
            
            if (dbTitleNormalized === pageTitleNormalized && dbTitle && !invalidTitles.includes(dbTitle)) {
              // La DB tiene el mismo nombre que la página → añadir directamente sin carpeta
              items.push(pageData);
              addedDirectly = true;
              dbAddedDirectly++;
              stats.pagesImported++;
              log(`  📄 "${child.title}" añadido directamente (DB "${dbTitle}" coincide con página "${title}")`);
            } else if (dbTitle && !invalidTitles.includes(dbTitle)) {
              // Crear carpeta con el título de la DB
              if (!databaseFolders.has(dbTitle)) {
                databaseFolders.set(dbTitle, []);
              }
              databaseFolders.get(dbTitle).push(pageData);
              dbInFolders++;
              stats.pagesImported++;
            } else {
              // DB sin título válido: no crear carpeta, mostrar warning
              stats.dbPagesFiltered++;
              log(`⚠️ "${child.title}" omitido: la DB "${dbTitle || 'sin título'}" no tiene un nombre válido para crear carpeta`);
            }
          } else {
            stats.pagesImported++;
          }
        }
        
        // Crear carpetas para páginas de DB que no coincidieron con categorías ni con el nombre de la página
        // AQUÍ SE CREAN LAS CARPETAS CON EL NOMBRE DE LA TABLA (databaseTitle)
        for (const [folderName, pages] of databaseFolders) {
          if (pages.length > 0) {
            items.push({
              type: 'category',
              name: folderName,
              items: pages
            });
            log(`📁 Carpeta de DB creada: "${folderName}" con ${pages.length} páginas`);
          }
        }
        
        // Log resumen de procesamiento de DB
        if (dbPagesForLater.length > 0) {
          const dbFiltered = stats.dbPagesFiltered;
          const parts = [];
          if (dbAssignedToCategory > 0) parts.push(`${dbAssignedToCategory} asignados por label`);
          if (dbAddedDirectly > 0) parts.push(`${dbAddedDirectly} añadidos directamente (mismo nombre)`);
          if (dbInFolders > 0) parts.push(`${dbInFolders} en carpetas de DB`);
          if (dbFiltered > 0) parts.push(`${dbFiltered} omitidos (DB sin nombre válido)`);
          log(`📊 DB: ${parts.join(', ')}`);
        }

        // ============================================
        // ESCANEAR MENTIONS EN EL CONTENIDO Y EN PROPIEDADES DE DB
        // ============================================
        if (onProgress) {
          onProgress({ 
            message: `Scanning mentions in: ${title}...`, 
            depth,
            pagesImported: stats.pagesImported 
          });
        }

        try {
          // Obtener bloques de la página para buscar mentions
          const blocks = await this.fetchBlocks(id, true);
          
          // Mentions de bloques de contenido
          let mentions = [];
          if (blocks && blocks.length > 0) {
            mentions = await this._extractMentionsFromBlocks(blocks);
          }
          
          // También escanear mentions en las propiedades de las páginas de DB
          // (wiki links dentro de celdas de tablas inline)
          const scannedDbIds = new Set();
          for (const child of childPages) {
            if (child.type === 'database_page' || child.type === 'child_database') {
              const dbId = child.databaseId || child.id;
              if (dbId && !scannedDbIds.has(dbId)) {
                scannedDbIds.add(dbId);
                try {
                  const dbPages = await this.fetchDatabasePages(dbId);
                  for (const dbPage of dbPages) {
                    if (dbPage.properties) {
                      const propMentions = this._extractMentionsFromPageProperties(dbPage.properties, dbPage.title);
                      for (const pm of propMentions) {
                        // Evitar duplicados con mentions ya encontrados
                        const exists = mentions.some(m => this._normalizeId(m.pageId) === this._normalizeId(pm.pageId));
                        if (!exists) {
                          mentions.push(pm);
                        }
                      }
                    }
                  }
                  log(`🔍 Escaneadas properties de DB "${child.databaseTitle || dbId}": ${mentions.length} mentions totales`);
                } catch (e) {
                  log(`⚠️ Error escaneando properties de DB ${dbId}:`, e.message);
                }
              }
            }
          }
          
          if (mentions.length > 0) {
              log(`🔗 Mentions encontrados en "${title}":`, mentions.length);
              
              // Recopilar todos los IDs ya importados
              const importedIds = new Set();
              
              // IDs de childPages
              for (const child of childPages) {
                importedIds.add(child.id);
              }
              
              // IDs de páginas ya en items (incluyendo las de DB ya procesadas)
              for (const item of items) {
                if (item.url) {
                  const urlMatch = item.url.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
                  if (urlMatch) {
                    importedIds.add(this._normalizeId(urlMatch[1]));
                  }
                }
                // También buscar en sub-items (carpetas de DB)
                if (item.items) {
                  for (const subItem of item.items) {
                    if (subItem.url) {
                      const subMatch = subItem.url.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
                      if (subMatch) {
                        importedIds.add(this._normalizeId(subMatch[1]));
                      }
                    }
                  }
                }
              }
              
              // IDs de páginas ya en categorías
              for (const [catName, category] of categoryMap) {
                if (category.items) {
                  for (const page of category.items) {
                    // Extraer ID de la URL
                    const urlMatch = page.url?.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
                    if (urlMatch) {
                      const extractedId = urlMatch[1];
                      const formattedId = this._normalizeId(extractedId);
                      importedIds.add(formattedId);
                    }
                  }
                }
              }
              
              // Agrupar mentions con parent DB para crear carpetas si estamos en root
              const mentionsByDb = new Map(); // parentDbTitle -> pages[]
              const mentionsWithoutDb = []; // Páginas sin parent DB
              
              // Procesar mentions que no estén ya importados
              for (const mention of mentions) {
                const mentionId = mention.pageId;
                
                // Normalizar ID para comparación
                let normalizedId = mentionId;
                if (!mentionId.includes('-') && mentionId.length === 32) {
                  normalizedId = `${mentionId.substring(0, 8)}-${mentionId.substring(8, 12)}-${mentionId.substring(12, 16)}-${mentionId.substring(16, 20)}-${mentionId.substring(20, 32)}`;
                }
                
                if (importedIds.has(normalizedId) || importedIds.has(mentionId)) {
                  log(`  ✅ Mention "${mention.text}" ya está importado`);
                  continue;
                }
                
                log(`  🔍 Procesando mention: "${mention.text}" (${mentionId})`);
                
                // Obtener info de la página mencionada
                const pageInfo = await this._getMentionedPageInfo(mentionId);
                
                if (!pageInfo) {
                  log(`  ⚠️ Mention "${mention.text}" omitido (la página no está compartida con tu integración de Notion)`);
                  continue;
                }
                
                // Prioridad: título real de la página > texto de la mention > fallback.
                // El resolvedor común descarta placeholders, espacios y variantes de mayúsculas.
                const finalTitle = resolvePageTitle(pageInfo.title, mention.text);
                
                // Crear la página
                const newPage = {
                  type: 'page',
                  name: finalTitle,
                  url: pageInfo.url
                };
                
                // Intentar asignar a una categoría existente por título de la DB padre
                let assignedToCategory = false;
                
                if (pageInfo.parentDbTitle) {
                  // Buscar si hay una categoría que coincida con el título de la DB
                  const matchingCategoryName = this._findMatchingCategory(pageInfo.parentDbTitle, existingCategoryNames);
                  
                  if (matchingCategoryName) {
                    const category = categoryMap.get(matchingCategoryName);
                    if (category && category.items) {
                      // Verificar que no esté ya
                      const exists = category.items.some(p => p.url === newPage.url || p.name === newPage.name);
                      if (!exists) {
                        category.items.push(newPage);
                        stats.pagesImported++;
                        assignedToCategory = true;
                        log(`  ✅ Mention "${pageInfo.title}" asignado a "${matchingCategoryName}"`);
                      }
                    }
                  }
                  
                  // Si no se asignó a categoría, agrupar por DB para crear carpeta
                  if (!assignedToCategory) {
                    if (!mentionsByDb.has(pageInfo.parentDbTitle)) {
                      mentionsByDb.set(pageInfo.parentDbTitle, []);
                    }
                    mentionsByDb.get(pageInfo.parentDbTitle).push(newPage);
                  }
                } else {
                  // Sin parent DB: añadir directamente a items
                  mentionsWithoutDb.push(newPage);
                }
                
                // Marcar como importado
                importedIds.add(normalizedId);
              }
              
              // Crear carpetas para mentions agrupados por DB
              if (mentionsByDb.size > 0) {
                for (const [dbTitle, dbPages] of mentionsByDb) {
                  if (dbPages.length > 0) {
                    items.push({
                      type: 'category',
                      name: dbTitle,
                      items: dbPages
                    });
                    stats.pagesImported += dbPages.length;
                    log(`📁 Carpeta creada para mentions de DB "${dbTitle}": ${dbPages.length} páginas`);
                  }
                }
              }
              
              // Añadir mentions sin parent DB directamente a items
              for (const page of mentionsWithoutDb) {
                items.push(page);
                stats.pagesImported++;
                log(`  ✅ Mention "${page.name}" añadido a items`);
              }
            }
        } catch (mentionError) {
          logWarn(`Error escaneando mentions en "${title}":`, mentionError);
          // Continuar sin fallar - los mentions son opcionales
        }

        // Solo devolver la categoría si tiene items
        if (items.length > 0) {
          return {
            type: 'category',
            name: title,
            items
          };
        }
        
        return null;
      } catch (e) {
        logWarn(`Error procesando página ${title}:`, e);
        stats.pagesSkipped++;
        return null;
      }
    };

    // Procesar desde la página raíz
    const rootResult = await processPage(pageId, pageTitle, 0);

    // Construir configuración final
    let config;
    if (rootResult && rootResult.type === 'category') {
      // La raíz es una categoría (tiene hijos), usarla directamente
      config = {
        categories: [{
          name: rootResult.name,
          items: rootResult.items
        }]
      };
    } else if (rootResult && rootResult.type === 'page') {
      // La raíz es una página simple sin hijos -> añadir al root directamente
      config = {
        categories: [],
        pages: [rootResult]
      };
    } else {
      // No se pudo procesar
      config = { categories: [], pages: [] };
    }

    return {
      config,
      stats: {
        pagesImported: stats.pagesImported,
        pagesSkipped: stats.pagesSkipped,
        emptyPages: stats.emptyPages,
        dbPagesFiltered: stats.dbPagesFiltered,
        unsupportedTypes: Array.from(stats.unsupportedTypes)
      }
    };
  }

  /**
   * Extrae el título de una página de Notion desde la URL (formato: notion.so/slug-{id})
   * @param {string} url - URL de la página
   * @returns {string|null} - Título/slug legible o null
   * @private
   */
  _extractTitleFromNotionUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const path = url.split('?')[0].replace(/^https?:\/\/[^/]+\//, '').trim();
      if (!path) return null;
      // El path es "slug-id" donde id son 32 hex (con o sin guiones UUID)
      const match = path.match(/^(.+)-([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})$/i)
        || path.match(/^(.+)-([a-f0-9]{32})$/i);
      if (!match) return null;
      const slug = match[1];
      if (!slug) return null;
      return decodeURIComponent(slug).replace(/-/g, ' ').trim() || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extrae el título de una página de Notion
   * @private
   */
  _extractPageTitle(page) {
    // Intentar obtener título de las propiedades (unir todos los fragmentos: emoji + texto)
    if (page.properties) {
      // Buscar propiedad "title" o "Name"
      const titleProp = page.properties.title || page.properties.Title || page.properties.Name || page.properties.name;
      if (titleProp && titleProp.title && Array.isArray(titleProp.title)) {
        const full = (titleProp.title.map(t => t.plain_text || '')).join('').trim();
        if (full) return full;
      }
      
      // Buscar cualquier propiedad tipo title
      for (const prop of Object.values(page.properties)) {
        if (prop.type === 'title' && prop.title && Array.isArray(prop.title)) {
          const full = (prop.title.map(t => t.plain_text || '')).join('').trim();
          if (full) return full;
        }
      }
    }
    
    // Fallback: extraer título desde page.url (la API a veces devuelve propiedades solo con ID)
    if (page.url && isNotionUrl(page.url)) {
      const titleFromUrl = this._extractTitleFromNotionUrl(page.url);
      if (titleFromUrl) return titleFromUrl;
    }
    
    return 'Untitled';
  }

  /**
   * Construye una URL de Notion con el formato correcto
   * Formato: https://www.notion.so/Title-Slug-pageIdSinGuiones
   * @param {string} title - Título de la página
   * @param {string} pageId - ID de la página (con o sin guiones)
   * @returns {string} URL de Notion
   * @private
   */
  _buildNotionUrl(title, pageId) {
    // Limpiar el ID (quitar guiones)
    const cleanId = pageId.replace(/-/g, '');
    
    // Usar título o fallback para que la URL siempre tenga formato nombre-id
    const safeTitle = (title && String(title).trim()) || 'Untitled';
    // Crear slug del título
    const slug = safeTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Solo alfanuméricos, espacios y guiones
      .trim()
      .replace(/\s+/g, '-') // Espacios a guiones
      .replace(/-+/g, '-'); // Múltiples guiones a uno
    
    // Siempre incluir slug (nunca solo ID) para formato notion.so/nombre-id
    const finalSlug = (slug && slug !== '-') ? slug : 'Untitled';
    return `https://www.notion.so/${finalSlug}-${cleanId}`;
  }

  /**
   * Intenta obtener del caché compartido
   * @private
   */
  async _getFromSharedCache(pageId) {
    if (!this.OBR) return null;

    try {
      const metadata = await this.OBR.room.getMetadata();
      const sharedCache = metadata && metadata[ROOM_CONTENT_CACHE_KEY];
      
      if (sharedCache && sharedCache[pageId] && sharedCache[pageId].blocks) {
        log('✅ Usando caché compartido (room metadata) para:', pageId);
        return sharedCache[pageId].blocks;
      }
    } catch (e) {
      logWarn('No se pudo obtener caché compartido:', e);
    }
    return null;
  }

  /**
   * Consulta las páginas de una base de datos de Notion
   * @param {string} databaseId - ID de la base de datos
   * @returns {Promise<Array>} - Lista de páginas con sus IDs y títulos
   */
  async fetchDatabasePages(databaseId) {
    try {
      // Obtener token del usuario o usar el de default
      let tokenToUse = this.storageService?.getUserToken();
      if (!tokenToUse) {
        tokenToUse = await this._getDefaultToken();
      }
      
      if (!tokenToUse) {
        logWarn('No hay token para consultar base de datos');
        return [];
      }

      log('📊 Consultando páginas de base de datos:', databaseId);
      
      const params = new URLSearchParams({
        action: 'database',
        databaseId: databaseId,
        token: tokenToUse
      });
      
      const response = await this._fetchWithRetry(`/.netlify/functions/notion-api?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || '';
        
        // Error específico de Notion cuando la DB no está compartida con la integración
        if (errorMsg.includes('does not contain any data sources accessible') || response.status === 400) {
          log(`📊 Base de datos omitida: no está compartida con tu integración de Notion`);
        } else {
          logWarn('Error al consultar base de datos:', errorMsg || response.status);
        }
        return [];
      }

      const data = await response.json();
      const pages = data.results || [];
      
      log('📊 Páginas encontradas en la base de datos:', pages.length);
      
      // Mapear a formato simplificado con ID, título, labels y properties
      return pages.map(page => {
        const title = this._extractPageTitle(page);
        const labels = this._extractLabelsFromPage(page);
        // Usar page.url de la API cuando exista y sea de Notion (formato correcto con slug)
        const url = (page.url && isNotionUrl(page.url))
          ? page.url
          : this._buildNotionUrl(title, page.id);
        
        return {
          id: this._normalizeId(page.id),
          title,
          url,
          labels, // Array de labels para agrupar por categoría
          properties: page.properties // Incluir properties para escanear mentions
        };
      });
    } catch (e) {
      logError('Error al consultar base de datos:', e);
      return [];
    }
  }
}

export default NotionService;
