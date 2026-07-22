/**
 * @fileoverview Servicio de caché para bloques y páginas de Notion
 * 
 * Gestiona el caché local (localStorage) y el caché compartido (room metadata).
 */

import { CACHE_PREFIX, PAGE_INFO_CACHE_PREFIX, ROOM_CONTENT_CACHE_KEY } from '../utils/constants.js';
import { log, logError, logWarn, getUserRole } from '../utils/logger.js?v=20260722-3';
import { compressJson, validateTotalMetadataSize } from '../utils/helpers.js';

/**
 * Servicio para gestionar el caché de contenido
 */
export class CacheService {
  constructor() {
    // Caché en memoria para HTML renderizado
    this.localHtmlCache = {};
    // Referencia a OBR (se inyecta)
    this.OBR = null;
    // Callback para mostrar modal de límite
    this.onStorageLimitReached = null;
  }

  /**
   * Inyecta la referencia a OBR SDK
   * @param {Object} obr - Referencia al SDK
   */
  setOBR(obr) {
    this.OBR = obr;
  }

  /**
   * Establece callback para cuando se alcanza el límite de storage
   * @param {Function} callback
   */
  setStorageLimitCallback(callback) {
    this.onStorageLimitReached = callback;
  }

  // ============================================
  // CACHÉ DE BLOQUES (localStorage)
  // ============================================

  /**
   * Obtener bloques desde el caché local
   * @param {string} pageId - ID de la página
   * @returns {Array|null} - Bloques o null
   */
  getCachedBlocks(pageId) {
    try {
      const cacheKey = CACHE_PREFIX + pageId;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const data = JSON.parse(cached);
        if (data.blocks) {
          log('✅ Bloques obtenidos del caché para:', pageId);
          return data.blocks;
        }
      }
    } catch (e) {
      logError('Error al leer del caché:', e);
      // Si hay error al parsear, eliminar la entrada corrupta
      try {
        localStorage.removeItem(CACHE_PREFIX + pageId);
      } catch (e2) {
        // Ignorar errores al limpiar
      }
    }
    return null;
  }

  /**
   * Guardar bloques en el caché local
   * @param {string} pageId - ID de la página
   * @param {Array} blocks - Bloques a guardar
   * @param {boolean} saveToShared - Si también guardar en caché compartido
   */
  async setCachedBlocks(pageId, blocks, saveToShared = true) {
    try {
      const cacheKey = CACHE_PREFIX + pageId;
      const data = {
        blocks: blocks,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      log('💾 Bloques guardados en caché para:', pageId);
      
      // Si es GM, también guardar en caché compartido para jugadores
      if (saveToShared) {
        await this.saveToSharedCache(pageId, blocks);
      }
    } catch (e) {
      logError('Error al guardar en caché:', e);
      if (e.name === 'QuotaExceededError') {
        logWarn('⚠️ localStorage lleno.');
        if (this.onStorageLimitReached) {
          this.onStorageLimitReached('caching page content');
        }
      }
    }
  }

  /**
   * Eliminar bloques del caché local
   * @param {string} pageId - ID de la página
   */
  removeCachedBlocks(pageId) {
    try {
      localStorage.removeItem(CACHE_PREFIX + pageId);
      log('🗑️ Bloques eliminados del caché para:', pageId);
    } catch (e) {
      logError('Error al eliminar del caché:', e);
    }
  }

  /**
   * Limpia todos los cachés relacionados con una página
   * @param {string} pageId - ID de la página
   */
  clearPageCache(pageId) {
    try {
      // Limpiar caché de bloques
      localStorage.removeItem(CACHE_PREFIX + pageId);
      // Limpiar caché de info de página
      localStorage.removeItem(PAGE_INFO_CACHE_PREFIX + pageId);
      // Limpiar caché de HTML en memoria
      if (this.localHtmlCache[pageId]) {
        delete this.localHtmlCache[pageId];
      }
      log('🗑️ Caché limpiado para página:', pageId);
    } catch (e) {
      logError('Error al limpiar caché de página:', e);
    }
  }

  // ============================================
  // CACHÉ DE INFO DE PÁGINA
  // ============================================

  /**
   * Obtener info de página desde el caché
   * @param {string} pageId - ID de la página
   * @returns {Object|null}
   */
  getCachedPageInfo(pageId) {
    try {
      const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
        const data = JSON.parse(cached);
        
        // Compatibilidad con formato antiguo: { pageInfo: {...}, savedAt }
        if (data.pageInfo) {
          return data.pageInfo;
        }
        
        // Formato nuevo: { cover, icon, ..., cachedAt }
        return data;
      }
    } catch (e) {
      try {
        localStorage.removeItem(PAGE_INFO_CACHE_PREFIX + pageId);
      } catch (e2) {}
    }
    return null;
  }

  /**
   * Guardar info de página en el caché
   * @param {string} pageId - ID de la página
   * @param {Object} pageInfo - Info a guardar
   */
  setCachedPageInfo(pageId, pageInfo) {
    try {
      const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
      const data = {
        ...pageInfo,
        cachedAt: new Date().toISOString()
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      logError('Error al guardar page info en caché:', e);
    }
  }

  // ============================================
  // CACHÉ COMPARTIDO (Room Metadata)
  // ============================================

  /**
   * Guardar en caché compartido (room metadata)
   * @param {string} pageId - ID de la página
   * @param {Array} blocks - Bloques a guardar
   */
  async saveToSharedCache(pageId, blocks) {
    if (!this.OBR) return;

    try {
      // Solo guardar si es GM
      const isGM = await getUserRole();
      if (!isGM) return;
      
      // Obtener todos los metadatos actuales
      const metadata = await this.OBR.room.getMetadata() || {};
      let sharedCache = (metadata[ROOM_CONTENT_CACHE_KEY]) || {};
      
      // Crear la nueva entrada
      const newEntry = {
        blocks: blocks,
        savedAt: new Date().toISOString()
      };
      
      // Probar si cabe
      const testCache = { ...sharedCache, [pageId]: newEntry };
      const validation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, testCache, metadata);
      
      // Si no cabe, limpiar entradas antiguas
      if (!validation.fits) {
        sharedCache = this._evictOldEntries(sharedCache, pageId, newEntry, metadata);
        
        // Verificar si ahora cabe
        const finalTestCache = { ...sharedCache, [pageId]: newEntry };
        const finalValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, finalTestCache, metadata);
        if (!finalValidation.fits) {
          log('ℹ️ No hay espacio en room metadata. El contenido se compartirá vía broadcast.');
          return;
        }
      }
      
      // Limitar número de entradas (máximo 10)
      const cacheKeys = Object.keys(sharedCache);
      if (cacheKeys.length >= 10 && !sharedCache[pageId]) {
        sharedCache = this._removeOldestEntries(sharedCache, 3);
      }
      
      // Guardar
      sharedCache[pageId] = newEntry;
      
      const finalValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, sharedCache, metadata);
      if (finalValidation.fits) {
        await this.OBR.room.setMetadata({
          [ROOM_CONTENT_CACHE_KEY]: compressJson(sharedCache)
        });
        log(`💾 Contenido guardado en caché compartido para: ${pageId} (${finalValidation.percentage}% del límite)`);
      }
    } catch (e) {
      if (e.message && (e.message.includes('size') || e.message.includes('limit'))) {
        log('ℹ️ El caché compartido está lleno. El contenido se compartirá vía broadcast.');
      } else {
        console.debug('No se pudo guardar en caché compartido:', e);
      }
    }
  }

  /**
   * Obtener del caché compartido
   * @param {string} pageId - ID de la página
   * @returns {Promise<Array|null>}
   */
  async getFromSharedCache(pageId) {
    if (!this.OBR) return null;

    try {
      const metadata = await this.OBR.room.getMetadata() || {};
      const sharedCache = metadata[ROOM_CONTENT_CACHE_KEY] || {};
      
      if (sharedCache[pageId] && sharedCache[pageId].blocks) {
        log('✅ Bloques obtenidos del caché compartido para:', pageId);
        return sharedCache[pageId].blocks;
      }
    } catch (e) {
      console.debug('Error al leer caché compartido:', e);
    }
    return null;
  }

  // ============================================
  // CACHÉ HTML EN MEMORIA
  // ============================================

  /**
   * Guardar HTML renderizado en caché local (memoria)
   * @param {string} pageId - ID de la página
   * @param {string} html - HTML renderizado
   */
  saveHtmlToLocalCache(pageId, html) {
    // Limitar el tamaño (máximo 20 páginas)
    const keys = Object.keys(this.localHtmlCache);
    if (keys.length >= 20) {
      let oldestKey = keys[0];
      let oldestTime = this.localHtmlCache[oldestKey].savedAt || 0;
      for (const key of keys) {
        const time = this.localHtmlCache[key].savedAt || 0;
        if (time < oldestTime) {
          oldestTime = time;
          oldestKey = key;
        }
      }
      delete this.localHtmlCache[oldestKey];
      log('🗑️ Eliminada entrada más antigua del caché HTML local:', oldestKey);
    }
    
    this.localHtmlCache[pageId] = {
      html: html,
      savedAt: Date.now()
    };
    log('💾 HTML guardado en caché local para:', pageId);
  }

  /**
   * Obtener HTML desde caché local (memoria)
   * @param {string} pageId - ID de la página
   * @returns {string|null}
   */
  getHtmlFromLocalCache(pageId) {
    if (this.localHtmlCache[pageId]) {
      return this.localHtmlCache[pageId].html;
    }
    return null;
  }

  // ============================================
  // UTILIDADES PRIVADAS
  // ============================================

  /**
   * Elimina entradas antiguas hasta que el nuevo contenido quepa
   * @private
   */
  _evictOldEntries(sharedCache, pageId, newEntry, metadata) {
    const cacheKeys = Object.keys(sharedCache);
    if (cacheKeys.length === 0) return sharedCache;
    
    // Ordenar por fecha (más antiguas primero)
    const sortedKeys = cacheKeys.sort((a, b) => {
      const dateA = sharedCache[a]?.savedAt ? new Date(sharedCache[a].savedAt) : new Date(0);
      const dateB = sharedCache[b]?.savedAt ? new Date(sharedCache[b].savedAt) : new Date(0);
      return dateA - dateB;
    });
    
    let reducedCache = { ...sharedCache };
    let entriesRemoved = 0;
    
    for (const key of sortedKeys) {
      delete reducedCache[key];
      entriesRemoved++;
      const testReduced = { ...reducedCache, [pageId]: newEntry };
      const reducedValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, testReduced, metadata);
      if (reducedValidation.fits) {
        log(`🗑️ Eliminadas ${entriesRemoved} entradas antiguas del caché`);
        return reducedCache;
      }
    }
    
    return reducedCache;
  }

  /**
   * Elimina las N entradas más antiguas
   * @private
   */
  _removeOldestEntries(cache, count) {
    const keys = Object.keys(cache);
    const sortedKeys = keys.sort((a, b) => {
      const dateA = cache[a]?.savedAt ? new Date(cache[a].savedAt) : new Date(0);
      const dateB = cache[b]?.savedAt ? new Date(cache[b].savedAt) : new Date(0);
      return dateA - dateB;
    });
    
    const result = { ...cache };
    for (let i = 0; i < count && i < sortedKeys.length; i++) {
      delete result[sortedKeys[i]];
    }
    return result;
  }

  /**
   * Limpia todo el caché local
   */
  clearLocalCache() {
    // Limpiar bloques
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX) || key.startsWith(PAGE_INFO_CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    // Limpiar HTML en memoria
    this.localHtmlCache = {};
    log('🗑️ Caché local limpiado');
  }
}

export default CacheService;
