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
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        // Sin token, intentar obtener del caché compartido
        const sharedBlocks = await this._getFromSharedCache(pageId);
        if (sharedBlocks) {
          return sharedBlocks;
        }
        throw new Error('No token configured. Go to Settings (⚙️ button) to configure your Notion token.');
      }

      log('🌐 Obteniendo bloques desde la API para:', pageId);
      
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(userToken)}`;
      
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
   * @returns {Promise<Object>}
   */
  async fetchPageInfo(pageId) {
    if (!pageId || pageId === 'null' || pageId === 'undefined') {
      log('⚠️ fetchPageInfo: pageId inválido');
      return { lastEditedTime: null, icon: null };
    }

    // Intentar obtener del caché
    if (this.cacheService) {
      const cached = this.cacheService.getCachedPageInfo(pageId);
      if (cached) {
        return cached;
      }
    }

    try {
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        return { lastEditedTime: null, icon: null };
      }

      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(userToken)}&info=true`;
      
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

      log('📄 PageInfo obtenido:', { 
        hasCover: !!pageInfo.cover, 
        hasIcon: !!pageInfo.icon,
        hasProperties: !!pageInfo.properties 
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
      const userToken = this.storageService?.getUserToken();
      
      if (!userToken) {
        return [];
      }

      // Usar el mismo endpoint que para páginas - la API de Notion usa el mismo endpoint
      // para obtener hijos de bloques, pasando el blockId como pageId
      const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}&token=${encodeURIComponent(userToken)}`;
      
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

