/**
 * @fileoverview Tests unitarios para StorageService
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { StorageService } from '../../../js/services/StorageService.js';
import {
  FULL_CONFIG_KEY,
  ROOM_CONTENT_CACHE_KEY,
  ROOM_HTML_CACHE_KEY,
  ROOM_METADATA_KEY,
  VAULT_OWNER_KEY
} from '../../../js/utils/constants.js';

describe('StorageService', () => {
  let storageService;

  beforeEach(() => {
    storageService = new StorageService();
    localStorage.clear();
  });

  describe('Token de Usuario', () => {
    it('debe retornar null cuando no hay token', () => {
      expect(storageService.getUserToken()).toBeNull();
    });

    it('debe guardar y recuperar token', () => {
      storageService.saveUserToken('secret_token_123');
      expect(storageService.getUserToken()).toBe('secret_token_123');
    });

    it('debe trimear espacios del token', () => {
      storageService.saveUserToken('  secret_token  ');
      expect(storageService.getUserToken()).toBe('secret_token');
    });

    it('debe eliminar token con string vacía', () => {
      storageService.saveUserToken('token');
      storageService.saveUserToken('');
      expect(storageService.getUserToken()).toBeNull();
    });

    it('hasUserToken debe funcionar correctamente', () => {
      expect(storageService.hasUserToken()).toBe(false);
      storageService.saveUserToken('token');
      expect(storageService.hasUserToken()).toBe(true);
    });
  });

  describe('Configuración Local', () => {
    beforeEach(() => {
      storageService.setRoomId('test-room-123');
    });

    it('debe retornar null cuando no hay config', () => {
      expect(storageService.getLocalConfig()).toBeNull();
    });

    it('debe guardar y recuperar config', () => {
      const config = { categories: [{ name: 'Test' }] };
      storageService.saveLocalConfig(config);
      
      expect(storageService.getLocalConfig()).toEqual(config);
    });

    it('debe usar clave correcta con roomId', () => {
      expect(storageService.getStorageKey()).toBe('notion-pages-json-test-room-123');
    });

    it('debe usar "default" sin roomId', () => {
      storageService.setRoomId(null);
      expect(storageService.getStorageKey()).toBe('notion-pages-json-default');
    });

    it('debe sobrescribir config existente', () => {
      storageService.saveLocalConfig({ categories: [{ name: 'Old' }] });
      storageService.saveLocalConfig({ categories: [{ name: 'New' }] });
      
      expect(storageService.getLocalConfig().categories[0].name).toBe('New');
    });

    it('falla de forma segura ante JSON local corrupto', () => {
      localStorage.setItem(storageService.getStorageKey(), '{not-json');

      expect(storageService.getLocalConfig()).toBeNull();
    });

    it('avisa y conserva el resultado fallido cuando localStorage está lleno', () => {
      const onLimit = jest.fn();
      storageService.setStorageLimitCallback(onLimit);
      localStorage.setItem.mockImplementationOnce(() => {
        const error = new Error('Storage full');
        error.name = 'QuotaExceededError';
        throw error;
      });

      expect(storageService.saveLocalConfig({ categories: [] })).toBe(false);
      expect(onLimit).toHaveBeenCalledWith('saving configuration');
    });
  });

  describe('clearLocalConfig', () => {
    it('debe eliminar la configuración local', () => {
      storageService.setRoomId('test-room');
      storageService.saveLocalConfig({ categories: [] });
      
      expect(storageService.getLocalConfig()).not.toBeNull();
      
      storageService.clearLocalConfig();
      
      expect(storageService.getLocalConfig()).toBeNull();
    });
  });

  describe('Room metadata budget', () => {
    it('migra datos legacy y conserva solo la identidad y conexión del Master GM', async () => {
      const setMetadata = jest.fn().mockResolvedValue(undefined);
      storageService.setOBR({ room: { setMetadata } });

      await expect(storageService.setVaultOwner('master-gm-id', 'master-connection')).resolves.toBe(true);

      expect(setMetadata).toHaveBeenCalledWith({
        [VAULT_OWNER_KEY]: {
          id: 'master-gm-id',
          connectionId: 'master-connection'
        },
        [ROOM_METADATA_KEY]: null,
        [FULL_CONFIG_KEY]: null,
        [ROOM_CONTENT_CACHE_KEY]: null,
        [ROOM_HTML_CACHE_KEY]: null
      });
      const persistedMetadata = {
        [VAULT_OWNER_KEY]: {
          id: 'master-gm-id',
          connectionId: 'master-connection'
        }
      };
      expect(Buffer.byteLength(JSON.stringify(persistedMetadata), 'utf8')).toBeLessThan(256);
    });

    it('no expone operaciones para persistir config o contenido en la sala', () => {
      expect(storageService.saveRoomConfig).toBeUndefined();
      expect(storageService.getRoomConfig).toBeUndefined();
    });
  });

  describe('getAllStorageKeys', () => {
    it('debe listar claves de storage', () => {
      storageService.saveUserToken('token');
      storageService.setRoomId('room-1');
      storageService.saveLocalConfig({ categories: [] });
      storageService.setRoomId('room-2');
      storageService.saveLocalConfig({ categories: [] });
      
      const keys = storageService.getAllStorageKeys();
      
      expect(keys).toContain('notion-global-token');
      expect(keys).toContain('notion-pages-json-room-1');
      expect(keys).toContain('notion-pages-json-room-2');
    });
  });

  describe('clearAllLocalData', () => {
    it('elimina solo datos de GM Vault y conserva token y claves ajenas', () => {
      localStorage.setItem('notion-global-token', 'secret_keep');
      localStorage.setItem('notion-pages-json-room-1', '{"categories":[]}');
      localStorage.setItem('notion-blocks-cache-page-1', '{}');
      localStorage.setItem('category-collapsed-Test-level-0', 'true');
      localStorage.setItem('other-extension/data', 'keep');
      sessionStorage.setItem('notion_modal_cache', 'remove');
      sessionStorage.setItem('other-session-data', 'keep');

      expect(storageService.clearAllLocalData()).toBe(true);

      expect(localStorage.getItem('notion-global-token')).toBe('secret_keep');
      expect(localStorage.getItem('other-extension/data')).toBe('keep');
      expect(localStorage.getItem('notion-pages-json-room-1')).toBeNull();
      expect(localStorage.getItem('notion-blocks-cache-page-1')).toBeNull();
      expect(localStorage.getItem('category-collapsed-Test-level-0')).toBeNull();
      expect(sessionStorage.getItem('notion_modal_cache')).toBeNull();
      expect(sessionStorage.getItem('other-session-data')).toBe('keep');
    });
  });
});
