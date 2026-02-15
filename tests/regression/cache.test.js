/**
 * @fileoverview Tests de regresión para funciones de caché
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Constantes del código original
const CACHE_PREFIX = 'notion-blocks-cache-';
const PAGE_INFO_CACHE_PREFIX = 'notion-page-info-cache-';

// Funciones originales de caché (copiadas de index.js)
function getCachedBlocks(pageId) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      if (data.blocks) {
        return data.blocks;
      }
    }
  } catch (e) {
    try {
      const cacheKey = CACHE_PREFIX + pageId;
      localStorage.removeItem(cacheKey);
    } catch (e2) {
      // Ignorar errores al limpiar
    }
  }
  return null;
}

function setCachedBlocks(pageId, blocks) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const data = {
      blocks: blocks,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

function getCachedPageInfo(pageId) {
  try {
    const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      return data;
    }
  } catch (e) {
    try {
      localStorage.removeItem(PAGE_INFO_CACHE_PREFIX + pageId);
    } catch (e2) {}
  }
  return null;
}

function setCachedPageInfo(pageId, pageInfo) {
  try {
    const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
    const data = {
      ...pageInfo,
      cachedAt: new Date().toISOString()
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================
// TESTS DE REGRESIÓN
// ============================================

describe('Regresión: Funciones de Caché', () => {
  
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getCachedBlocks / setCachedBlocks', () => {
    it('debe retornar null cuando no hay caché', () => {
      const result = getCachedBlocks('test-page-id');
      expect(result).toBeNull();
    });

    it('debe retornar bloques cuando están en caché', () => {
      const blocks = [{ id: '1', type: 'paragraph' }];
      setCachedBlocks('test-page-id', blocks);
      
      const result = getCachedBlocks('test-page-id');
      expect(result).toEqual(blocks);
    });

    it('debe manejar múltiples pageIds independientemente', () => {
      const blocks1 = [{ id: '1', type: 'paragraph' }];
      const blocks2 = [{ id: '2', type: 'heading_1' }];
      
      setCachedBlocks('page-1', blocks1);
      setCachedBlocks('page-2', blocks2);
      
      expect(getCachedBlocks('page-1')).toEqual(blocks1);
      expect(getCachedBlocks('page-2')).toEqual(blocks2);
    });

    it('debe usar el prefijo correcto', () => {
      const blocks = [{ id: '1' }];
      setCachedBlocks('test-id', blocks);
      
      // Verificar que usa el prefijo correcto
      const stored = localStorage.getItem(CACHE_PREFIX + 'test-id');
      expect(stored).not.toBeNull();
      
      const data = JSON.parse(stored);
      expect(data.blocks).toEqual(blocks);
    });

    it('debe incluir savedAt en los datos guardados', () => {
      const blocks = [{ id: '1' }];
      setCachedBlocks('test-id', blocks);
      
      const stored = localStorage.getItem(CACHE_PREFIX + 'test-id');
      const data = JSON.parse(stored);
      
      expect(data.savedAt).toBeDefined();
      expect(new Date(data.savedAt).getTime()).not.toBeNaN();
    });

    it('debe manejar bloques vacíos', () => {
      setCachedBlocks('empty-page', []);
      const result = getCachedBlocks('empty-page');
      expect(result).toEqual([]);
    });

    it('debe manejar bloques complejos', () => {
      const complexBlocks = [
        {
          id: '1',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: 'Hello' } }
            ]
          }
        },
        {
          id: '2',
          type: 'image',
          image: {
            type: 'external',
            external: { url: 'https://example.com/image.png' }
          }
        }
      ];
      
      setCachedBlocks('complex-page', complexBlocks);
      const result = getCachedBlocks('complex-page');
      expect(result).toEqual(complexBlocks);
    });
  });

  describe('getCachedPageInfo / setCachedPageInfo', () => {
    it('debe retornar null cuando no hay caché', () => {
      const result = getCachedPageInfo('test-page-id');
      expect(result).toBeNull();
    });

    it('debe retornar pageInfo cuando está en caché', () => {
      const pageInfo = {
        id: 'page-123',
        icon: { type: 'emoji', emoji: '📄' },
        cover: null
      };
      
      setCachedPageInfo('test-page-id', pageInfo);
      const result = getCachedPageInfo('test-page-id');
      
      expect(result.id).toBe(pageInfo.id);
      expect(result.icon).toEqual(pageInfo.icon);
    });

    it('debe incluir cachedAt', () => {
      const pageInfo = { id: 'page-123' };
      setCachedPageInfo('test-page-id', pageInfo);
      
      const result = getCachedPageInfo('test-page-id');
      expect(result.cachedAt).toBeDefined();
    });

    it('debe usar el prefijo correcto', () => {
      const pageInfo = { id: 'page-123' };
      setCachedPageInfo('test-id', pageInfo);
      
      const stored = localStorage.getItem(PAGE_INFO_CACHE_PREFIX + 'test-id');
      expect(stored).not.toBeNull();
    });
  });

  describe('Manejo de errores', () => {
    it('debe retornar null para JSON corrupto', () => {
      // Guardar JSON corrupto directamente
      localStorage.setItem(CACHE_PREFIX + 'corrupt', 'not-valid-json');
      
      const result = getCachedBlocks('corrupt');
      expect(result).toBeNull();
    });

    it('debe retornar null si blocks no existe en los datos', () => {
      localStorage.setItem(CACHE_PREFIX + 'no-blocks', JSON.stringify({ other: 'data' }));
      
      const result = getCachedBlocks('no-blocks');
      expect(result).toBeNull();
    });
  });
});

