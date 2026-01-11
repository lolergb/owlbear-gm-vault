/**
 * @fileoverview Tests unitarios para StorageService
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { StorageService } from '../../../js/services/StorageService.js';

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
});

