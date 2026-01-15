/**
 * @fileoverview Servicio para interactuar con la API de Notion
 * 
 * Gestiona las llamadas a la API de Notion a través del proxy de Netlify.
 */

import { ROOM_CONTENT_CACHE_KEY } from '../utils/constants.js';
import { log, logError, logWarn } from '../utils/logger.js';

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
      log('🔄 Recarga forzada - ignorando caché para:', pageId);
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
      
      const response = await fetch(apiUrl, {
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
      
      const response = await fetch(apiUrl, {
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
      
      const response = await fetch(apiUrl, {
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
      const response = await fetch(`/.netlify/functions/notion-api?validate=true&token=${encodeURIComponent(userToken)}`);
      
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
      
      const response = await fetch(`/.netlify/functions/notion-api?${params.toString()}`);

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
      
      const response = await fetch(`/.netlify/functions/notion-api?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      const data = await response.json();
      const pageBlocks = data.results || [];
      
      log('📂 Bloques de página encontrados:', pageBlocks.length);
      
      // Procesar bloques en orden (child_page y link_to_page mezclados)
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
            // Las bases de datos no las soportamos por ahora
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
        }
      }

      return results;
    } catch (e) {
      logError('Error al obtener páginas hijas:', e);
      throw e;
    }
  }

  /**
   * Verifica si una página tiene contenido real (no solo títulos, links o vacía)
   * child_page y link_to_page NO cuentan como contenido propio (se procesan como hijas)
   * @param {string} pageId - ID de la página
   * @returns {Promise<boolean>} - true si tiene contenido real
   */
  async hasRealContent(pageId) {
    try {
      const blocks = await this.fetchBlocks(pageId, true);
      
      if (!blocks || blocks.length === 0) {
        return false;
      }

      // Tipos de bloques que consideramos "contenido real"
      // NO incluimos child_page ni link_to_page (esos son hijos, no contenido propio)
      const contentTypes = [
        'paragraph', 'bulleted_list_item', 'numbered_list_item',
        'image', 'video', 'embed', 'bookmark', 'code', 'quote',
        'callout', 'table', 'toggle', 'to_do', 'equation',
        'column_list', 'synced_block', 'template', 'link_preview',
        'file', 'pdf', 'audio', 'divider'
      ];

      let contentScore = 0;
      const MIN_CONTENT_SCORE = 1; // Mínimo para considerar que tiene contenido

      // Verificar si hay contenido real
      for (const block of blocks) {
        // Ignorar child_page y link_to_page (son hijas, no contenido propio)
        if (block.type === 'child_page' || block.type === 'link_to_page') {
          continue;
        }

        // Si es un tipo de contenido
        if (contentTypes.includes(block.type)) {
          // Para párrafos, verificar que no estén vacíos
          if (block.type === 'paragraph') {
            const text = block.paragraph?.rich_text;
            if (text && text.length > 0 && text.some(t => t.plain_text?.trim())) {
              contentScore += 1;
            }
          } else if (block.type === 'divider') {
            // Los dividers solos no cuentan mucho
            contentScore += 0.1;
          } else {
            // Imágenes, videos, tablas, etc. cuentan más
            contentScore += 2;
          }
        }
        
        // Headings con contenido toggle cuentan
        if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
          const headingData = block[block.type];
          // Si el heading tiene hijos (toggle), cuenta como contenido
          if (block.has_children) {
            contentScore += 2;
          } else {
            // Headings solos no cuentan mucho (son solo títulos)
            contentScore += 0.2;
          }
        }

        // Si ya tenemos suficiente contenido, no seguir contando
        if (contentScore >= MIN_CONTENT_SCORE) {
          return true;
        }
      }

      return contentScore >= MIN_CONTENT_SCORE;
    } catch (e) {
      logWarn('Error verificando contenido de página:', pageId, e);
      return true; // En caso de error, asumimos que tiene contenido
    }
  }

  /**
   * Extrae el título de la información de página
   * @private
   */
  _extractPageTitleFromInfo(pageInfo) {
    if (!pageInfo || !pageInfo.properties) return null;
    
    // Buscar propiedad "title" o "Name"
    const titleProp = pageInfo.properties.title || pageInfo.properties.Title || 
                      pageInfo.properties.Name || pageInfo.properties.name;
    if (titleProp && titleProp.title && titleProp.title[0]) {
      return titleProp.title[0].plain_text;
    }
    
    // Buscar cualquier propiedad tipo title
    for (const prop of Object.values(pageInfo.properties)) {
      if (prop.type === 'title' && prop.title && prop.title[0]) {
        return prop.title[0].plain_text;
      }
    }
    
    return null;
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
      pagesSkipped: 0,
      emptyPages: 0,
      unsupportedTypes: new Set()
    };

    /**
     * Procesa una página y devuelve un item (page o category con items[])
     */
    const processPage = async (id, title, depth = 0) => {
      if (depth >= maxDepth) {
        stats.pagesSkipped++;
        return null;
      }

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

        // Procesar cada página hija (en orden de Notion)
        for (const child of childPages) {
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
      // La raíz es una categoría, usarla directamente
      config = {
        categories: [{
          name: rootResult.name,
          items: rootResult.items
        }]
      };
    } else if (rootResult) {
      // La raíz es una página simple, crear categoría contenedora
      config = {
        categories: [{
          name: pageTitle,
          items: [rootResult]
        }]
      };
    } else {
      // No se pudo procesar
      config = { categories: [] };
    }

    return {
      config,
      stats: {
        pagesImported: stats.pagesImported,
        pagesSkipped: stats.pagesSkipped,
        emptyPages: stats.emptyPages,
        unsupportedTypes: Array.from(stats.unsupportedTypes)
      }
    };
  }

  /**
   * Extrae el título de una página de Notion
   * @private
   */
  _extractPageTitle(page) {
    // Intentar obtener título de las propiedades
    if (page.properties) {
      // Buscar propiedad "title" o "Name"
      const titleProp = page.properties.title || page.properties.Title || page.properties.Name || page.properties.name;
      if (titleProp && titleProp.title && titleProp.title[0]) {
        return titleProp.title[0].plain_text || 'Untitled';
      }
      
      // Buscar cualquier propiedad tipo title
      for (const prop of Object.values(page.properties)) {
        if (prop.type === 'title' && prop.title && prop.title[0]) {
          return prop.title[0].plain_text || 'Untitled';
        }
      }
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
    
    // Crear slug del título
    const slug = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Solo alfanuméricos, espacios y guiones
      .trim()
      .replace(/\s+/g, '-') // Espacios a guiones
      .replace(/-+/g, '-'); // Múltiples guiones a uno
    
    // Si hay slug, usarlo; si no, solo el ID
    if (slug && slug !== '-') {
      return `https://www.notion.so/${slug}-${cleanId}`;
    }
    return `https://www.notion.so/${cleanId}`;
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
}

export default NotionService;

