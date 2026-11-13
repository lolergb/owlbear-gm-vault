/**
 * @fileoverview Servicio de caché para bloques y páginas de Notion
 * 
 * Gestiona caché local en localStorage y memoria.
 */

import { CACHE_PREFIX, PAGE_INFO_CACHE_PREFIX } from '../utils/constants.js?v=20260812-1';
import { log, logError, logWarn } from '../utils/logger.js?v=20260722-4';

const HTML_CACHE_TTL_MS = 5 * 60 * 1000;
const NOTION_FILE_EXPIRY_SAFETY_MS = HTML_CACHE_TTL_MS + (5 * 60 * 1000);

/**
 * Notion-hosted file URLs are signed and temporary. Do not reuse cached API
 * objects when any embedded file URL is expired or close to expiring.
 * @param {*} value
 * @param {number} now
 * @param {Set<Object>} seen
 * @returns {boolean}
 */
function hasStaleNotionFile(value, now = Date.now(), seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (value.type === 'file' && value.file?.url) {
    const expiryTime = Date.parse(value.file.expiry_time || '');
    return !Number.isFinite(expiryTime) || expiryTime <= now + NOTION_FILE_EXPIRY_SAFETY_MS;
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  return children.some(child => hasStaleNotionFile(child, now, seen));
}

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
          if (hasStaleNotionFile(data.blocks)) {
            localStorage.removeItem(cacheKey);
            log('🔄 Caché de bloques invalidada por URLs de Notion caducadas:', pageId);
            return null;
          }
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
   */
  async setCachedBlocks(pageId, blocks) {
    try {
      const cacheKey = CACHE_PREFIX + pageId;
      const data = {
        blocks: blocks,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
      log('💾 Bloques guardados en caché para:', pageId);
      
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
          if (hasStaleNotionFile(data.pageInfo)) {
            localStorage.removeItem(cacheKey);
            return null;
          }
          return data.pageInfo;
        }

        if (hasStaleNotionFile(data)) {
          localStorage.removeItem(cacheKey);
          return null;
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
    const cached = this.localHtmlCache[pageId];
    if (!cached) return null;

    if (Date.now() - cached.savedAt >= HTML_CACHE_TTL_MS) {
      delete this.localHtmlCache[pageId];
      log('🔄 Caché HTML invalidada para renovar recursos de Notion:', pageId);
      return null;
    }

    return cached.html;
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
