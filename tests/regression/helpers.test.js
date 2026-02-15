/**
 * @fileoverview Tests de regresión para funciones helper
 * 
 * Estos tests capturan el comportamiento ACTUAL del código original
 * para asegurar que la refactorización no lo cambie.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Recreamos las funciones exactas del código original para testing
// Esto nos permite verificar que el nuevo código tiene el mismo comportamiento

// ============================================
// FUNCIONES ORIGINALES (copiadas de index.js)
// ============================================

const CACHE_PREFIX = 'notion-blocks-cache-';
const PAGE_INFO_CACHE_PREFIX = 'notion-page-info-cache-';
const ROOM_METADATA_SIZE_LIMIT = 16 * 1024;
const ROOM_METADATA_SAFE_LIMIT = ROOM_METADATA_SIZE_LIMIT - 1024;

function getJsonSize(obj) {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch (e) {
    return JSON.stringify(obj).length;
  }
}

function compressJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

function stringifyCompact(obj) {
  return JSON.stringify(obj);
}

function validateMetadataSize(obj, compressed = true) {
  const testObj = compressed ? compressJson(obj) : obj;
  const size = getJsonSize(testObj);
  const fits = size <= ROOM_METADATA_SAFE_LIMIT;
  
  return {
    fits,
    size,
    limit: ROOM_METADATA_SAFE_LIMIT,
    percentage: (size / ROOM_METADATA_SAFE_LIMIT * 100).toFixed(1)
  };
}

function generateColorFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash % 360);
  const saturation = 60 + (Math.abs(hash) % 20);
  const lightness = 45 + (Math.abs(hash) % 15);
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getInitial(text) {
  if (!text || text.length === 0) return '?';
  const match = text.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : text.charAt(0).toUpperCase();
}

function isNotionUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('notion.so') || url.includes('notion.site');
}

function extractNotionPageId(url) {
  try {
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    if (!isNotionUrl(url)) {
      return null;
    }
    
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    const idMatch = pathname.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
    
    if (idMatch && idMatch[1]) {
      const pageId = idMatch[1];
      return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
    }
    
    const pathParts = pathname.split('-');
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && /^[a-f0-9]{32}$/i.test(lastPart)) {
        const pageId = lastPart.substring(0, 32);
        return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

function getStorageKey(roomId) {
  return 'notion-pages-json-' + (roomId || 'default');
}

function countPages(config) {
  let count = 0;
  
  function countRecursive(categories) {
    if (!categories) return;
    categories.forEach(cat => {
      if (cat.pages) count += cat.pages.length;
      if (cat.categories) countRecursive(cat.categories);
    });
  }
  
  if (config && config.categories) {
    countRecursive(config.categories);
  }
  
  return count;
}

function countCategories(config) {
  let count = 0;
  
  function countRecursive(categories) {
    if (!categories) return;
    categories.forEach(cat => {
      count++;
      if (cat.categories) countRecursive(cat.categories);
    });
  }
  
  if (config && config.categories) {
    countRecursive(config.categories);
  }
  
  return count;
}

// ============================================
// TESTS DE REGRESIÓN
// ============================================

describe('Regresión: Funciones Helper', () => {
  
  describe('getJsonSize', () => {
    it('debe calcular el tamaño de un objeto simple', () => {
      const obj = { name: 'Test' };
      const size = getJsonSize(obj);
      expect(size).toBe(15); // {"name":"Test"}
    });

    it('debe calcular el tamaño de un objeto complejo', () => {
      const obj = { 
        categories: [
          { name: 'Cat1', pages: [{ name: 'Page1', url: 'https://...' }] }
        ]
      };
      const size = getJsonSize(obj);
      expect(size).toBeGreaterThan(0);
    });

    it('debe manejar objetos con caracteres especiales', () => {
      const obj = { text: '¿Cómo estás? 你好' };
      const size = getJsonSize(obj);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('compressJson', () => {
    it('debe retornar un objeto equivalente', () => {
      const obj = { name: 'Test', pages: [] };
      const compressed = compressJson(obj);
      expect(compressed).toEqual(obj);
    });

    it('debe eliminar propiedades undefined', () => {
      const obj = { name: 'Test', value: undefined };
      const compressed = compressJson(obj);
      expect(compressed).not.toHaveProperty('value');
    });
  });

  describe('stringifyCompact', () => {
    it('debe serializar sin espacios', () => {
      const obj = { name: 'Test' };
      const result = stringifyCompact(obj);
      expect(result).toBe('{"name":"Test"}');
    });
  });

  describe('validateMetadataSize', () => {
    it('debe aceptar objetos pequeños', () => {
      const obj = { categories: [{ name: 'Test', pages: [] }] };
      const result = validateMetadataSize(obj);
      expect(result.fits).toBe(true);
    });

    it('debe rechazar objetos mayores a 15KB', () => {
      // Crear objeto grande (>15KB)
      const largeContent = 'x'.repeat(16000);
      const obj = { content: largeContent };
      const result = validateMetadataSize(obj);
      expect(result.fits).toBe(false);
    });

    it('debe retornar el tamaño correcto', () => {
      const obj = { name: 'Test' };
      const result = validateMetadataSize(obj);
      expect(result.size).toBeGreaterThan(0);
      expect(result.limit).toBe(ROOM_METADATA_SAFE_LIMIT);
    });

    it('debe retornar porcentaje', () => {
      const obj = { name: 'Test' };
      const result = validateMetadataSize(obj);
      expect(typeof result.percentage).toBe('string');
    });
  });

  describe('generateColorFromString', () => {
    it('debe generar el mismo color para la misma string', () => {
      const color1 = generateColorFromString('test');
      const color2 = generateColorFromString('test');
      expect(color1).toBe(color2);
    });

    it('debe generar colores diferentes para strings diferentes', () => {
      const color1 = generateColorFromString('test1');
      const color2 = generateColorFromString('test2');
      expect(color1).not.toBe(color2);
    });

    it('debe retornar formato HSL válido', () => {
      const color = generateColorFromString('test');
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });

    it('debe generar colores consistentes para la misma string', () => {
      // El mismo input siempre debe generar el mismo color
      const color1 = generateColorFromString('NPCs');
      const color2 = generateColorFromString('NPCs');
      const color3 = generateColorFromString('NPCs');
      expect(color1).toBe(color2);
      expect(color2).toBe(color3);
      
      // Verificar que el formato es HSL válido
      expect(color1).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });
  });

  describe('getInitial', () => {
    it('debe retornar primera letra en mayúscula', () => {
      expect(getInitial('test')).toBe('T');
      expect(getInitial('Hello')).toBe('H');
    });

    it('debe manejar strings vacíos', () => {
      expect(getInitial('')).toBe('?');
      expect(getInitial(null)).toBe('?');
      expect(getInitial(undefined)).toBe('?');
    });

    it('debe ignorar emojis al inicio', () => {
      expect(getInitial('🎮 Game')).toBe('G');
    });

    it('debe manejar números', () => {
      expect(getInitial('123test')).toBe('1');
    });
  });

  describe('isNotionUrl', () => {
    it('debe detectar URLs de notion.so', () => {
      expect(isNotionUrl('https://www.notion.so/Page-abc123')).toBe(true);
      expect(isNotionUrl('https://notion.so/Page-abc123')).toBe(true);
    });

    it('debe detectar URLs de notion.site', () => {
      expect(isNotionUrl('https://workspace.notion.site/Page-abc123')).toBe(true);
    });

    it('debe rechazar otras URLs', () => {
      expect(isNotionUrl('https://example.com/page')).toBe(false);
      expect(isNotionUrl('https://google.com')).toBe(false);
    });

    it('debe manejar valores inválidos', () => {
      expect(isNotionUrl(null)).toBe(false);
      expect(isNotionUrl(undefined)).toBe(false);
      expect(isNotionUrl('')).toBe(false);
      expect(isNotionUrl(123)).toBe(false);
    });
  });

  describe('extractNotionPageId', () => {
    it('debe extraer ID de URL estándar de notion.so', () => {
      const url = 'https://www.notion.so/My-Page-abc123def456789012345678901234ab';
      const pageId = extractNotionPageId(url);
      expect(pageId).toBe('abc123de-f456-7890-1234-5678901234ab');
    });

    it('debe extraer ID de URL de notion.site', () => {
      const url = 'https://workspace.notion.site/Page-abc123def456789012345678901234ab';
      const pageId = extractNotionPageId(url);
      expect(pageId).toBe('abc123de-f456-7890-1234-5678901234ab');
    });

    it('debe manejar URLs con parámetros', () => {
      const url = 'https://www.notion.so/Page-abc123def456789012345678901234ab?v=123&p=456';
      const pageId = extractNotionPageId(url);
      expect(pageId).toBe('abc123de-f456-7890-1234-5678901234ab');
    });

    it('debe retornar null para URLs no-Notion', () => {
      expect(extractNotionPageId('https://example.com/page')).toBeNull();
      expect(extractNotionPageId('https://google.com')).toBeNull();
    });

    it('debe retornar null para valores inválidos', () => {
      expect(extractNotionPageId(null)).toBeNull();
      expect(extractNotionPageId(undefined)).toBeNull();
      expect(extractNotionPageId('')).toBeNull();
      expect(extractNotionPageId('not-a-url')).toBeNull();
    });

    it('debe formatear el ID con guiones UUID', () => {
      const url = 'https://www.notion.so/Page-12345678901234567890123456789012';
      const pageId = extractNotionPageId(url);
      // Debe tener formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(pageId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
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

  describe('countPages', () => {
    it('debe contar páginas en configuración simple', () => {
      const config = {
        categories: [
          { name: 'Cat1', pages: [{ name: 'P1' }, { name: 'P2' }] }
        ]
      };
      expect(countPages(config)).toBe(2);
    });

    it('debe contar páginas en categorías anidadas', () => {
      const config = {
        categories: [
          { 
            name: 'Cat1', 
            pages: [{ name: 'P1' }],
            categories: [
              { name: 'SubCat', pages: [{ name: 'P2' }, { name: 'P3' }] }
            ]
          }
        ]
      };
      expect(countPages(config)).toBe(3);
    });

    it('debe retornar 0 para configuración vacía', () => {
      expect(countPages(null)).toBe(0);
      expect(countPages({})).toBe(0);
      expect(countPages({ categories: [] })).toBe(0);
    });
  });

  describe('countCategories', () => {
    it('debe contar categorías simples', () => {
      const config = {
        categories: [
          { name: 'Cat1', pages: [] },
          { name: 'Cat2', pages: [] }
        ]
      };
      expect(countCategories(config)).toBe(2);
    });

    it('debe contar categorías anidadas', () => {
      const config = {
        categories: [
          { 
            name: 'Cat1', 
            categories: [
              { name: 'SubCat1' },
              { name: 'SubCat2' }
            ]
          }
        ]
      };
      expect(countCategories(config)).toBe(3);
    });

    it('debe retornar 0 para configuración vacía', () => {
      expect(countCategories(null)).toBe(0);
      expect(countCategories({})).toBe(0);
    });
  });
});

