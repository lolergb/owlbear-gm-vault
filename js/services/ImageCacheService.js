/**
 * @fileoverview Servicio de caché de imágenes usando IndexedDB
 * 
 * Cachea imágenes para mejorar tiempos de carga, especialmente para
 * iconos de páginas de Notion y otras imágenes frecuentes.
 */

import { log, logWarn, logError } from '../utils/logger.js';

const DB_NAME = 'gm-vault-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB máximo
const MAX_ENTRIES = 200;
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Servicio para cachear imágenes en IndexedDB
 */
export class ImageCacheService {
  constructor() {
    this.db = null;
    this.isSupported = typeof indexedDB !== 'undefined';
    this.pendingRequests = new Map(); // Evitar peticiones duplicadas
    this.memoryCache = new Map(); // Caché en memoria para acceso ultra-rápido
    this.maxMemoryCache = 30; // Máximo imágenes en memoria
  }

  /**
   * Inicializa la base de datos IndexedDB
   */
  async init() {
    if (!this.isSupported) {
      logWarn('IndexedDB no soportado, caché de imágenes deshabilitado');
      return false;
    }

    try {
      this.db = await this._openDB();
      log('🗄️ ImageCacheService inicializado');
      
      // Limpiar entradas antiguas al iniciar
      await this._cleanupOldEntries();
      
      return true;
    } catch (e) {
      logError('Error inicializando ImageCacheService:', e);
      return false;
    }
  }

  /**
   * Abre/crea la base de datos
   * @private
   */
  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
    });
  }

  /**
   * Obtiene una imagen del caché o la descarga
   * @param {string} url - URL de la imagen
   * @param {Object} options - Opciones
   * @returns {Promise<string|null>} - URL del blob o null si falla
   */
  async getImage(url, options = {}) {
    if (!url || !this.isSupported) return null;

    const { ttl = DEFAULT_TTL, skipCache = false } = options;

    // Verificar si es una URL que no debería cachearse
    if (this._shouldSkipCache(url)) {
      return null;
    }

    // Primero buscar en memoria (más rápido)
    if (!skipCache && this.memoryCache.has(url)) {
      const cached = this.memoryCache.get(url);
      if (Date.now() - cached.cachedAt < ttl) {
        return cached.blobUrl;
      }
      // Expirado, eliminar de memoria
      this.memoryCache.delete(url);
    }

    // Si ya hay una petición pendiente para esta URL, esperar
    if (this.pendingRequests.has(url)) {
      return this.pendingRequests.get(url);
    }

    // Crear promesa para esta petición
    const promise = this._getImageInternal(url, ttl, skipCache);
    this.pendingRequests.set(url, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingRequests.delete(url);
    }
  }

  /**
   * Lógica interna de obtención de imagen
   * @private
   */
  async _getImageInternal(url, ttl, skipCache) {
    try {
      // Buscar en IndexedDB
      if (!skipCache && this.db) {
        const cached = await this._getFromDB(url);
        
        if (cached && Date.now() - cached.cachedAt < ttl) {
          // Actualizar lastAccessed
          await this._updateLastAccessed(url);
          
          // Crear blob URL y guardar en memoria
          const blobUrl = URL.createObjectURL(cached.blob);
          this._addToMemoryCache(url, blobUrl, cached.cachedAt);
          
          return blobUrl;
        }
      }

      // No está en caché o expiró, descargar
      const blob = await this._downloadImage(url);
      if (!blob) return null;

      // Guardar en IndexedDB
      if (this.db) {
        await this._saveToDB(url, blob);
      }

      // Crear blob URL y guardar en memoria
      const blobUrl = URL.createObjectURL(blob);
      this._addToMemoryCache(url, blobUrl, Date.now());

      return blobUrl;
    } catch (e) {
      logWarn('Error obteniendo imagen:', url.substring(0, 50), e.message);
      return null;
    }
  }

  /**
   * Determina si una URL no debería cachearse
   * @private
   */
  _shouldSkipCache(url) {
    // URLs de Notion con expiry_time corto
    if (url.includes('secure.notion-static.com')) {
      // Estas URLs expiran rápidamente, mejor no cachear
      return true;
    }
    
    // Data URLs ya están en memoria
    if (url.startsWith('data:')) {
      return true;
    }
    
    // Blob URLs ya son locales
    if (url.startsWith('blob:')) {
      return true;
    }
    
    return false;
  }

  /**
   * Descarga una imagen
   * @private
   */
  async _downloadImage(url) {
    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.blob();
    } catch (e) {
      // Intentar sin CORS si falla
      try {
        const response = await fetch(url);
        if (response.ok) {
          return await response.blob();
        }
      } catch (e2) {
        // Ignorar segundo error
      }
      return null;
    }
  }

  /**
   * Obtiene imagen de IndexedDB
   * @private
   */
  _getFromDB(url) {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      try {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(url);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Guarda imagen en IndexedDB
   * @private
   */
  async _saveToDB(url, blob) {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }

      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const data = {
          url,
          blob,
          size: blob.size,
          type: blob.type,
          cachedAt: Date.now(),
          lastAccessed: Date.now()
        };

        const request = store.put(data);
        request.onsuccess = () => {
          log('💾 Imagen cacheada:', url.substring(0, 50));
          resolve();
        };
        request.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  /**
   * Actualiza timestamp de último acceso
   * @private
   */
  async _updateLastAccessed(url) {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          data.lastAccessed = Date.now();
          store.put(data);
        }
      };
    } catch (e) {
      // Ignorar errores de actualización
    }
  }

  /**
   * Añade imagen al caché en memoria
   * @private
   */
  _addToMemoryCache(url, blobUrl, cachedAt) {
    // Limpiar si excede el límite
    if (this.memoryCache.size >= this.maxMemoryCache) {
      // Eliminar la entrada más antigua
      let oldestKey = null;
      let oldestTime = Infinity;
      
      for (const [key, value] of this.memoryCache) {
        if (value.cachedAt < oldestTime) {
          oldestTime = value.cachedAt;
          oldestKey = key;
        }
      }
      
      if (oldestKey) {
        const old = this.memoryCache.get(oldestKey);
        if (old?.blobUrl) {
          URL.revokeObjectURL(old.blobUrl);
        }
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(url, { blobUrl, cachedAt });
  }

  /**
   * Limpia entradas antiguas de IndexedDB
   * @private
   */
  async _cleanupOldEntries() {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('lastAccessed');
      
      // Obtener todas las entradas ordenadas por lastAccessed
      const request = index.openCursor();
      const entries = [];
      let totalSize = 0;

      await new Promise((resolve) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            entries.push({
              url: cursor.value.url,
              size: cursor.value.size || 0,
              lastAccessed: cursor.value.lastAccessed || 0
            });
            totalSize += cursor.value.size || 0;
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => resolve();
      });

      // Eliminar entradas si excede límites
      const entriesToDelete = [];
      
      // Si hay demasiadas entradas
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
        const excess = entries.length - MAX_ENTRIES;
        entriesToDelete.push(...entries.slice(0, excess).map(e => e.url));
      }

      // Si el tamaño total excede el límite
      if (totalSize > MAX_CACHE_SIZE) {
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
        let sizeToFree = totalSize - MAX_CACHE_SIZE * 0.8; // Liberar hasta 80%
        
        for (const entry of entries) {
          if (sizeToFree <= 0) break;
          if (!entriesToDelete.includes(entry.url)) {
            entriesToDelete.push(entry.url);
            sizeToFree -= entry.size;
          }
        }
      }

      // Eliminar entradas marcadas
      if (entriesToDelete.length > 0) {
        const deleteTransaction = this.db.transaction([STORE_NAME], 'readwrite');
        const deleteStore = deleteTransaction.objectStore(STORE_NAME);
        
        for (const url of entriesToDelete) {
          deleteStore.delete(url);
        }
        
        log(`🗑️ Eliminadas ${entriesToDelete.length} imágenes del caché`);
      }
    } catch (e) {
      logWarn('Error limpiando caché de imágenes:', e);
    }
  }

  /**
   * Precarga una lista de URLs de imágenes
   * @param {string[]} urls - URLs a precargar
   */
  async preloadImages(urls) {
    if (!urls || urls.length === 0) return;

    const validUrls = urls.filter(url => url && !this._shouldSkipCache(url));
    
    // Cargar en paralelo pero con límite
    const batchSize = 5;
    for (let i = 0; i < validUrls.length; i += batchSize) {
      const batch = validUrls.slice(i, i + batchSize);
      await Promise.all(batch.map(url => this.getImage(url)));
    }
    
    log(`📥 Precargadas ${validUrls.length} imágenes`);
  }

  /**
   * Limpia todo el caché
   */
  async clearAll() {
    // Limpiar memoria
    for (const [, value] of this.memoryCache) {
      if (value.blobUrl) {
        URL.revokeObjectURL(value.blobUrl);
      }
    }
    this.memoryCache.clear();

    // Limpiar IndexedDB
    if (this.db) {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        log('🗑️ Caché de imágenes limpiado');
      } catch (e) {
        logError('Error limpiando caché de imágenes:', e);
      }
    }
  }
}

// Singleton
let instance = null;

export function getImageCacheService() {
  if (!instance) {
    instance = new ImageCacheService();
  }
  return instance;
}

export default ImageCacheService;
