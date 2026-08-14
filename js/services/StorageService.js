/**
 * @fileoverview Servicio de almacenamiento para configuración y tokens
 * 
 * Gestiona el almacenamiento local (localStorage) y room metadata.
 */

import { 
  STORAGE_KEY_PREFIX, 
  GLOBAL_TOKEN_KEY, 
  ROOM_METADATA_KEY,
  FULL_CONFIG_KEY,
  VAULT_OWNER_KEY,
  ROOM_CONTENT_CACHE_KEY,
  ROOM_HTML_CACHE_KEY
} from '../utils/constants.js?v=20260812-1';
import { log, logError, getUserRole } from '../utils/logger.js?v=20260722-4';

/**
 * Servicio para gestionar el almacenamiento de configuración
 */
export class StorageService {
  constructor() {
    // Referencia a OBR (se inyecta)
    this.OBR = null;
    // Room ID actual
    this.roomId = null;
    // Callback para límite de storage
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
   * Establece el room ID actual
   * @param {string} roomId
   */
  setRoomId(roomId) {
    this.roomId = roomId;
  }

  /**
   * Establece callback para cuando se alcanza el límite
   * @param {Function} callback
   */
  setStorageLimitCallback(callback) {
    this.onStorageLimitReached = callback;
  }

  // ============================================
  // TOKEN DE USUARIO
  // ============================================

  /**
   * Obtiene el token de Notion del usuario
   * @returns {string|null}
   */
  getUserToken() {
    try {
      const token = localStorage.getItem(GLOBAL_TOKEN_KEY);
      if (token && token.trim() !== '') {
        return token.trim();
      }
    } catch (e) {
      logError('Error al leer token del usuario:', e);
    }
    return null;
  }

  /**
   * Guarda el token de Notion del usuario
   * @param {string} token - Token a guardar
   * @returns {boolean} - true si se guardó correctamente
   */
  saveUserToken(token) {
    try {
      if (token && token.trim() !== '') {
        localStorage.setItem(GLOBAL_TOKEN_KEY, token.trim());
      } else {
        localStorage.removeItem(GLOBAL_TOKEN_KEY);
      }
      return true;
    } catch (e) {
      logError('Error al guardar token del usuario:', e);
      return false;
    }
  }

  /**
   * Verifica si hay un token guardado
   * @returns {boolean}
   */
  hasUserToken() {
    return this.getUserToken() !== null;
  }

  // ============================================
  // CONFIGURACIÓN LOCAL (localStorage)
  // ============================================

  /**
   * Genera la clave de storage para el room actual
   * @returns {string}
   */
  getStorageKey() {
    return STORAGE_KEY_PREFIX + (this.roomId || 'default');
  }

  /**
   * Obtiene la configuración desde localStorage
   * @returns {Object|null}
   */
  getLocalConfig() {
    try {
      const storageKey = this.getStorageKey();
      log('🔍 Buscando en localStorage con clave:', storageKey);
      
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        const parsed = JSON.parse(stored);
        const catCount = parsed?.categories?.length || 0;
        log('✅ Encontrado en localStorage:', catCount, 'categorías');
        return parsed;
      } else {
        log('⚠️ No hay datos en localStorage para:', storageKey);
        
        // Listar todas las claves de localStorage para debug
        const allKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.includes('notion')) {
            allKeys.push(key);
          }
        }
        if (allKeys.length > 0) {
          log('📋 Claves de localStorage relacionadas:', allKeys.join(', '));
        }
      }
    } catch (e) {
      logError('Error al leer configuración local:', e);
    }
    return null;
  }

  /**
   * Guarda la configuración en localStorage
   * @param {Object} config - Configuración a guardar
   * @returns {boolean}
   */
  saveLocalConfig(config) {
    try {
      const storageKey = this.getStorageKey();
      localStorage.setItem(storageKey, JSON.stringify(config));
      log('💾 Configuración guardada en localStorage');
      return true;
    } catch (e) {
      logError('Error al guardar configuración local:', e);
      if (e.name === 'QuotaExceededError' && this.onStorageLimitReached) {
        this.onStorageLimitReached('saving configuration');
      }
      return false;
    }
  }

  // ============================================
  // ROOM METADATA
  // ============================================

  /**
   * Limpia todo el room metadata relacionado con el vault
   * @returns {Promise<boolean>}
   */
  async clearRoomMetadata() {
    if (!this.OBR) return false;

    try {
      const isGM = await getUserRole();
      if (!isGM) {
        log('⚠️ Solo el GM puede limpiar room metadata');
        return false;
      }

      log('🧹 Limpiando room metadata...');
      
      await this.OBR.room.setMetadata({
        [ROOM_METADATA_KEY]: null,
        [FULL_CONFIG_KEY]: null,
        [ROOM_CONTENT_CACHE_KEY]: null,
        [ROOM_HTML_CACHE_KEY]: null,
        [VAULT_OWNER_KEY]: null
      });

      log('✅ Room metadata limpiado correctamente');
      return true;
    } catch (e) {
      logError('Error al limpiar room metadata:', e);
      return false;
    }
  }

  // ============================================
  // VAULT OWNER
  // ============================================

  /**
   * Obtiene el dueño actual del vault
   * @returns {Promise<Object|null>}
   */
  async getVaultOwner() {
    if (!this.OBR) return null;

    try {
      const metadata = await this.OBR.room.getMetadata();
      return metadata[VAULT_OWNER_KEY] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Establece el dueño del vault
   * @param {string} playerId - ID del jugador
   * @param {string|null} connectionId - Conexión activa que actúa como Master GM
   * @returns {Promise<boolean>}
   */
  async setVaultOwner(playerId, connectionId = null) {
    if (!this.OBR) return false;

    try {
      const owner = connectionId ? { id: playerId, connectionId } : { id: playerId };
      await this.OBR.room.setMetadata({
        [VAULT_OWNER_KEY]: owner,
        // v2.1.0-beta.2 migration: content/configuration never belongs in
        // the room-wide 16 kB budget. Null removes legacy values.
        [ROOM_METADATA_KEY]: null,
        [FULL_CONFIG_KEY]: null,
        [ROOM_CONTENT_CACHE_KEY]: null,
        [ROOM_HTML_CACHE_KEY]: null
      });
      log('🧹 Room metadata migrado a ownership mínimo');
      return true;
    } catch (e) {
      logError('Error al establecer vault owner:', e);
      return false;
    }
  }

  /**
   * Limpia el vault owner
   * @returns {Promise<boolean>}
   */
  async clearVaultOwner() {
    if (!this.OBR) return false;

    try {
      await this.OBR.room.setMetadata({
        [VAULT_OWNER_KEY]: null
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // UTILIDADES
  // ============================================

  /**
   * Limpia toda la configuración local del room actual
   */
  clearLocalConfig() {
    try {
      const storageKey = this.getStorageKey();
      localStorage.removeItem(storageKey);
      log('🗑️ Configuración local eliminada');
    } catch (e) {
      logError('Error al limpiar configuración local:', e);
    }
  }

  /**
   * Obtiene todas las claves de storage usadas por la extensión
   * @returns {string[]}
   */
  getAllStorageKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(STORAGE_KEY_PREFIX) || key === GLOBAL_TOKEN_KEY)) {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * Limpia todos los datos locales excepto el token de usuario
   * Útil para resolver problemas con datos corruptos o desactualizados
   */
  clearAllLocalData() {
    try {
      const keysToRemove = [];
      
      // Recopilar todas las claves de GM Vault excepto el token
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key !== GLOBAL_TOKEN_KEY) {
          // Solo eliminar claves relacionadas con GM Vault
          if (key.startsWith(STORAGE_KEY_PREFIX) || 
              key.startsWith('notion_') || 
              key.startsWith('gm_vault_') ||
              key.startsWith('gmvault_') ||
              key.includes('collapse') ||
              key.includes('cache')) {
            keysToRemove.push(key);
          }
        }
      }
      
      // Eliminar las claves recopiladas
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
        log('🗑️ Eliminado:', key);
      }
      
      // También limpiar sessionStorage relacionado
      const sessionKeysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith('notion_') || key.startsWith('gm_vault_'))) {
          sessionKeysToRemove.push(key);
        }
      }
      
      for (const key of sessionKeysToRemove) {
        sessionStorage.removeItem(key);
      }
      
      log(`✅ Limpiados ${keysToRemove.length} items de localStorage y ${sessionKeysToRemove.length} de sessionStorage`);
      return true;
    } catch (e) {
      logError('Error al limpiar datos locales:', e);
      return false;
    }
  }
}

export default StorageService;
