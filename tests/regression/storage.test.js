/**
 * @fileoverview Tests de regresión para funciones de almacenamiento
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Constantes del código original
const GLOBAL_TOKEN_KEY = 'notion-global-token';
const STORAGE_KEY_PREFIX = 'notion-pages-json-';

// Funciones originales de storage (copiadas de index.js)
function getUserToken() {
  try {
    const token = localStorage.getItem(GLOBAL_TOKEN_KEY);
    if (token && token.trim() !== '') {
      return token.trim();
    }
  } catch (e) {
    console.error('Error al leer token del usuario:', e);
  }
  return null;
}

function saveUserToken(token) {
  try {
    if (token && token.trim() !== '') {
      localStorage.setItem(GLOBAL_TOKEN_KEY, token.trim());
      return true;
    } else {
      localStorage.removeItem(GLOBAL_TOKEN_KEY);
      return true;
    }
  } catch (e) {
    console.error('Error al guardar token del usuario:', e);
    return false;
  }
}

function hasUserToken() {
  return getUserToken() !== null;
}

function getStorageKey(roomId) {
  return STORAGE_KEY_PREFIX + (roomId || 'default');
}

function getPagesJSONFromLocalStorage(roomId) {
  try {
    const storageKey = getStorageKey(roomId);
    const stored = localStorage.getItem(storageKey);
    
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error al leer de localStorage:', e);
  }
  return null;
}

function savePagesJSONToLocalStorage(json, roomId) {
  try {
    const storageKey = getStorageKey(roomId);
    localStorage.setItem(storageKey, JSON.stringify(json));
    return true;
  } catch (e) {
    console.error('Error al guardar en localStorage:', e);
    return false;
  }
}

// ============================================
// TESTS DE REGRESIÓN
// ============================================

describe('Regresión: Funciones de Storage', () => {
  
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getUserToken / saveUserToken', () => {
    it('debe retornar null cuando no hay token', () => {
      const token = getUserToken();
      expect(token).toBeNull();
    });

    it('debe retornar token cuando está guardado', () => {
      const testToken = 'secret_test_token_123';
      saveUserToken(testToken);
      
      const token = getUserToken();
      expect(token).toBe(testToken);
    });

    it('debe trimear espacios del token', () => {
      const testToken = '  secret_test_token_123  ';
      saveUserToken(testToken);
      
      const token = getUserToken();
      expect(token).toBe('secret_test_token_123');
    });

    it('debe eliminar token si se guarda vacío', () => {
      saveUserToken('secret_token');
      expect(getUserToken()).not.toBeNull();
      
      saveUserToken('');
      expect(getUserToken()).toBeNull();
    });

    it('debe eliminar token si se guarda null', () => {
      saveUserToken('secret_token');
      saveUserToken(null);
      expect(getUserToken()).toBeNull();
    });

    it('debe retornar true al guardar', () => {
      expect(saveUserToken('token')).toBe(true);
      expect(saveUserToken('')).toBe(true);
    });
  });

  describe('hasUserToken', () => {
    it('debe retornar false cuando no hay token', () => {
      expect(hasUserToken()).toBe(false);
    });

    it('debe retornar true cuando hay token', () => {
      saveUserToken('secret_token');
      expect(hasUserToken()).toBe(true);
    });
  });

  describe('getStorageKey', () => {
    it('debe generar clave con roomId', () => {
      expect(getStorageKey('room123')).toBe('notion-pages-json-room123');
    });

    it('debe usar default si no hay roomId', () => {
      expect(getStorageKey(null)).toBe('notion-pages-json-default');
      expect(getStorageKey(undefined)).toBe('notion-pages-json-default');
      expect(getStorageKey('')).toBe('notion-pages-json-default');
    });
  });

  describe('getPagesJSONFromLocalStorage / savePagesJSONToLocalStorage', () => {
    it('debe retornar null cuando no hay datos', () => {
      const result = getPagesJSONFromLocalStorage('room-123');
      expect(result).toBeNull();
    });

    it('debe guardar y recuperar configuración', () => {
      const config = {
        categories: [
          { name: 'Test', pages: [{ name: 'Page1', url: 'https://...' }] }
        ]
      };
      
      savePagesJSONToLocalStorage(config, 'room-123');
      const result = getPagesJSONFromLocalStorage('room-123');
      
      expect(result).toEqual(config);
    });

    it('debe mantener independencia entre rooms', () => {
      const config1 = { categories: [{ name: 'Room1' }] };
      const config2 = { categories: [{ name: 'Room2' }] };
      
      savePagesJSONToLocalStorage(config1, 'room-1');
      savePagesJSONToLocalStorage(config2, 'room-2');
      
      expect(getPagesJSONFromLocalStorage('room-1')).toEqual(config1);
      expect(getPagesJSONFromLocalStorage('room-2')).toEqual(config2);
    });

    it('debe sobrescribir configuración existente', () => {
      const config1 = { categories: [{ name: 'Old' }] };
      const config2 = { categories: [{ name: 'New' }] };
      
      savePagesJSONToLocalStorage(config1, 'room');
      savePagesJSONToLocalStorage(config2, 'room');
      
      expect(getPagesJSONFromLocalStorage('room')).toEqual(config2);
    });

    it('debe usar "default" para roomId vacío', () => {
      const config = { categories: [] };
      
      savePagesJSONToLocalStorage(config, null);
      const result = getPagesJSONFromLocalStorage(null);
      
      expect(result).toEqual(config);
      expect(localStorage.getItem('notion-pages-json-default')).not.toBeNull();
    });
  });
});

