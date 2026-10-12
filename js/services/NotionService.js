/**
 * @fileoverview Servicio para interactuar con la API de Notion
 * 
 * Gestiona las llamadas a la API de Notion a través del proxy de Netlify.
 */

import { isNotionUrl } from '../utils/helpers.js';
import { log, logError, logWarn } from '../utils/logger.js?v=20260722-4';

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
    // El cliente solo conoce si existe acceso demo. La credencial permanece
    // dentro de la Netlify Function y nunca se descarga en el navegador.
    this._defaultAccessAvailable = false;
    this._defaultAccessChecked = false;
    
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
   * Inyecta dependencias
   * @param {Object} deps - Dependencias
   */
  setDependencies({ OBR, cacheService, storageService }) {
    if (OBR) this.OBR = OBR;
    if (cacheService) this.cacheService = cacheService;
    if (storageService) this.storageService = storageService;
  }

  /**
   * Comprueba si el proxy tiene acceso demo sin descargar ninguna credencial.
   * @private
   * @returns {Promise<boolean>}
   */
  async _hasDefaultAccess() {
    if (this._defaultAccessChecked) {
      return this._defaultAccessAvailable;
    }

    try {
      const response = await fetch('/.netlify/functions/get-default-token', {
        method: 'GET',
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        this._defaultAccessAvailable = data.available === true;
      }
    } catch (e) {
      logWarn('No se pudo comprobar el acceso demo de Notion:', e);
    }

    this._defaultAccessChecked = true;
    return this._defaultAccessAvailable;
  }

  /**
   * Construye la autenticación para el proxy sin incluir secretos en la URL.
   * Los flujos de importación pueden desactivar el acceso demo porque siempre
   * deben operar con la conexión personal del usuario.
   * @private
   * @param {Object} [options]
   * @param {boolean} [options.allowDefault=true]
   * @returns {Promise<Object|null>}
   */
  async _getNotionAuthHeaders({ allowDefault = true } = {}) {
    const userToken = this.storageService?.getUserToken();
    if (userToken) {
      return {
        'Content-Type': 'application/json',
        'X-Notion-Token': userToken
      };
    }

    if (allowDefault && await this._hasDefaultAccess()) {
      return {
        'Content-Type': 'application/json',
        'X-GM-Vault-Default': '1'
      };
    }

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
      const authHeaders = await this._getNotionAuthHeaders();

      if (!authHeaders) {
        // El contenido compartido es efímero: el controlador se lo solicita al GM.
        log('⚠️ No hay token, el contenido debe ser solicitado al GM');
        return null;
      }

      log('🌐 Obteniendo bloques desde la API para:', pageId);
      
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: authHeaders
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
      const authHeaders = await this._getNotionAuthHeaders();

      if (!authHeaders) {
        return { lastEditedTime: null, icon: null };
      }

      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: authHeaders
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
      const authHeaders = await this._getNotionAuthHeaders();

      if (!authHeaders) {
        return [];
      }

      // Usar el mismo endpoint que para páginas - la API de Notion usa el mismo endpoint
      // para obtener hijos de bloques, pasando el blockId como pageId
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}`;
      
      const response = await this._fetchWithRetry(apiUrl, {
        method: 'GET',
        headers: authHeaders
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
      const authHeaders = await this._getNotionAuthHeaders({ allowDefault: false });

      if (!authHeaders) {
        return false;
      }

      // Hacer una llamada simple para verificar el token
      const response = await this._fetchWithRetry(
        '/.netlify/functions/notion-api?validate=true',
        { method: 'GET', headers: authHeaders }
      );
      
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
      const authHeaders = await this._getNotionAuthHeaders({ allowDefault: false });

      if (!authHeaders) {
        throw new Error('No Notion token configured. Please add your token in Settings.');
      }

      log('🔍 Buscando páginas en workspace...');
      
      const params = new URLSearchParams({
        action: 'search',
        filter: 'page'
      });
      
      if (query.trim()) {
        params.append('query', query);
      }
      
      const response = await this._fetchWithRetry(
        `/.netlify/functions/notion-api?${params.toString()}`,
        { method: 'GET', headers: authHeaders }
      );

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
   * Obtiene la contención estructural de una página (en orden de Notion)
   * @param {string} pageId - ID de la página padre
   * @returns {Promise<Array>} - Lista de páginas hijas y bases de datos
   */
  async fetchChildPages(pageId) {
    try {
      const authHeaders = await this._getNotionAuthHeaders({ allowDefault: false });

      if (!authHeaders) {
        throw new Error('No Notion token configured');
      }

      log('📂 Obteniendo páginas hijas de:', pageId);
      
      const params = new URLSearchParams({
        action: 'children',
        pageId: pageId
      });
      
      const response = await this._fetchWithRetry(
        `/.netlify/functions/notion-api?${params.toString()}`,
        { method: 'GET', headers: authHeaders }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      const pageBlocks = data.results || [];
      
      log('📂 Bloques de página encontrados:', pageBlocks.length);
      
      // Procesar solo contención real. Los link_to_page se resuelven al
      // renderizar el contenido y nunca alteran la jerarquía del vault.
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
        } else if (block.type === 'child_database') {
          // Base de datos inline: todas sus páginas pertenecen estructuralmente
          // a la base. Mentions y relations no filtran ni reubican filas.
          const databaseId = block.id;
          const databaseTitle = block.child_database?.title || 'Database';
          
          log('📊 Procesando base de datos:', databaseTitle, databaseId);
          
          try {
            const dbPages = await this.fetchDatabasePages(databaseId);
            log('📊 Páginas encontradas en DB:', dbPages.length);

            results.push({
              id: databaseId,
              title: databaseTitle,
              type: 'child_database',
              pages: dbPages.map(dbPage => ({
                id: dbPage.id,
                title: dbPage.title,
                url: dbPage.url,
                type: 'database_page',
                databaseId: databaseId,
                databaseTitle: databaseTitle
              }))
            });
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
   * Las páginas de índice con mentions o link_to_page sí cuentan: los enlaces
   * se resuelven al renderizar, pero la página contenedora debe seguir visible.
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
      let hasNavigationContent = false; // Mentions o link_to_page visibles
      let onlyHasDatabase = true;  // Solo tiene child_database (sin contenido real)
      let listItemsWithOnlyMentions = 0;  // Lista items que solo tienen mentions
      let listItemsWithRealText = 0;      // Lista items con texto real (no solo mentions)

      for (const block of blocks) {
        // child_page define jerarquía, no contenido propio.
        if (block.type === 'child_page') {
          continue;
        }

        // link_to_page es navegación visible dentro de esta página.
        if (block.type === 'link_to_page') {
          hasNavigationContent = true;
          onlyHasDatabase = false;
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
            } else if (this._hasOnlyMentions(text)) {
              hasNavigationContent = true;
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
            if (this._hasOnlyMentions(text)) {
              hasNavigationContent = true;
            }
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
              hasNavigationContent = true;
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

      // La navegación también es contenido visible; no debe generar hijos, pero
      // sí mantiene la página de índice dentro del vault.
      const hasContent = hasTextContent
        || hasRichContent
        || hasNavigationContent
        || listItemsWithRealText > 0
        || listItemsWithOnlyMentions > 0;
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

        // Procesar cada contenedor en el mismo orden en que aparece en Notion.
        for (const child of childPages) {
          if (child.type === 'child_database') {
            const databaseItems = (child.pages || []).map(page => ({
              type: 'page',
              name: page.title,
              url: page.url
            }));

            if (databaseItems.length > 0) {
              items.push({
                type: 'category',
                name: child.title?.trim() || 'Database',
                items: databaseItems
              });
              stats.pagesImported += databaseItems.length;
              log(`📁 Base de datos conservada: "${child.title}" con ${databaseItems.length} páginas`);
            }
            continue;
          }

          const result = await processPage(child.id, child.title, depth + 1);
          if (result) {
            items.push(result);
          }
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
   * Consulta las páginas de una base de datos de Notion
   * @param {string} databaseId - ID de la base de datos
   * @returns {Promise<Array>} - Lista de páginas con sus IDs y títulos
   */
  async fetchDatabasePages(databaseId) {
    try {
      const authHeaders = await this._getNotionAuthHeaders();

      if (!authHeaders) {
        logWarn('No hay token para consultar base de datos');
        return [];
      }

      log('📊 Consultando páginas de base de datos:', databaseId);
      
      const params = new URLSearchParams({
        action: 'database',
        databaseId: databaseId
      });
      
      const response = await this._fetchWithRetry(
        `/.netlify/functions/notion-api?${params.toString()}`,
        { method: 'GET', headers: authHeaders }
      );

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
