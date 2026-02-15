/**
 * @fileoverview Tests unitarios para CacheService
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { CacheService } from '../../../js/services/CacheService.js';

describe('CacheService', () => {
  let cacheService;

  beforeEach(() => {
    cacheService = new CacheService();
    localStorage.clear();
  });

  describe('getCachedBlocks / setCachedBlocks', () => {
    it('debe retornar null cuando no hay caché', () => {
      const result = cacheService.getCachedBlocks('test-page-id');
      expect(result).toBeNull();
    });

    it('debe guardar y recuperar bloques', async () => {
      const blocks = [{ id: '1', type: 'paragraph' }];
      await cacheService.setCachedBlocks('test-page-id', blocks, false);
      
      const result = cacheService.getCachedBlocks('test-page-id');
      expect(result).toEqual(blocks);
    });

    it('debe manejar múltiples páginas', async () => {
      const blocks1 = [{ id: '1' }];
      const blocks2 = [{ id: '2' }];
      
      await cacheService.setCachedBlocks('page-1', blocks1, false);
      await cacheService.setCachedBlocks('page-2', blocks2, false);
      
      expect(cacheService.getCachedBlocks('page-1')).toEqual(blocks1);
      expect(cacheService.getCachedBlocks('page-2')).toEqual(blocks2);
    });
  });

  describe('removeCachedBlocks', () => {
    it('debe eliminar bloques del caché', async () => {
      const blocks = [{ id: '1' }];
      await cacheService.setCachedBlocks('test-id', blocks, false);
      
      expect(cacheService.getCachedBlocks('test-id')).toEqual(blocks);
      
      cacheService.removeCachedBlocks('test-id');
      
      expect(cacheService.getCachedBlocks('test-id')).toBeNull();
    });
  });

  describe('getCachedPageInfo / setCachedPageInfo', () => {
    it('debe guardar y recuperar page info', () => {
      const pageInfo = {
        lastEditedTime: '2024-01-01',
        icon: { type: 'emoji', emoji: '📄' }
      };
      
      cacheService.setCachedPageInfo('test-id', pageInfo);
      const result = cacheService.getCachedPageInfo('test-id');
      
      expect(result.lastEditedTime).toBe(pageInfo.lastEditedTime);
      expect(result.icon).toEqual(pageInfo.icon);
      expect(result.cachedAt).toBeDefined();
    });
  });

  describe('HTML Cache (memoria)', () => {
    it('debe guardar HTML en memoria', () => {
      const html = '<div>Test</div>';
      cacheService.saveHtmlToLocalCache('page-id', html);
      
      const result = cacheService.getHtmlFromLocalCache('page-id');
      expect(result).toBe(html);
    });

    it('debe retornar null si no hay HTML', () => {
      expect(cacheService.getHtmlFromLocalCache('not-exists')).toBeNull();
    });

    it('debe limitar a 20 entradas', () => {
      // Añadir 21 entradas
      for (let i = 0; i < 21; i++) {
        cacheService.saveHtmlToLocalCache(`page-${i}`, `<div>${i}</div>`);
      }
      
      // Solo debe haber 20 entradas
      expect(Object.keys(cacheService.localHtmlCache).length).toBe(20);
    });
  });

  describe('clearLocalCache', () => {
    it('debe limpiar el caché HTML en memoria', () => {
      cacheService.saveHtmlToLocalCache('page-1', '<div>test</div>');
      expect(cacheService.getHtmlFromLocalCache('page-1')).not.toBeNull();
      
      cacheService.clearLocalCache();
      
      expect(cacheService.getHtmlFromLocalCache('page-1')).toBeNull();
      expect(Object.keys(cacheService.localHtmlCache).length).toBe(0);
    });
  });

  describe('clearPageCache', () => {
    it('debe limpiar todos los cachés de una página', async () => {
      const pageId = 'test-page';
      const blocks = [{ id: '1', type: 'paragraph' }];
      const pageInfo = { lastEditedTime: '2024-01-01', icon: null };
      const html = '<div>Test content</div>';
      
      // Guardar en todos los cachés
      await cacheService.setCachedBlocks(pageId, blocks, false);
      cacheService.setCachedPageInfo(pageId, pageInfo);
      cacheService.saveHtmlToLocalCache(pageId, html);
      
      // Verificar que están guardados
      expect(cacheService.getCachedBlocks(pageId)).toEqual(blocks);
      expect(cacheService.getCachedPageInfo(pageId)).not.toBeNull();
      expect(cacheService.getHtmlFromLocalCache(pageId)).toBe(html);
      
      // Limpiar caché de la página
      cacheService.clearPageCache(pageId);
      
      // Verificar que todos fueron eliminados
      expect(cacheService.getCachedBlocks(pageId)).toBeNull();
      expect(cacheService.getCachedPageInfo(pageId)).toBeNull();
      expect(cacheService.getHtmlFromLocalCache(pageId)).toBeNull();
    });

    it('debe no afectar otras páginas al limpiar', async () => {
      const pageId1 = 'page-1';
      const pageId2 = 'page-2';
      const blocks1 = [{ id: '1' }];
      const blocks2 = [{ id: '2' }];
      
      await cacheService.setCachedBlocks(pageId1, blocks1, false);
      await cacheService.setCachedBlocks(pageId2, blocks2, false);
      
      cacheService.clearPageCache(pageId1);
      
      // page-1 debe estar limpia
      expect(cacheService.getCachedBlocks(pageId1)).toBeNull();
      // page-2 debe mantenerse
      expect(cacheService.getCachedBlocks(pageId2)).toEqual(blocks2);
    });
  });

  describe('lastEditedTime tracking', () => {
    it('debe guardar lastEditedTime en pageInfo', () => {
      const pageInfo = {
        lastEditedTime: '2024-01-15T10:30:00.000Z',
        icon: { type: 'emoji', emoji: '📝' },
        cover: null
      };
      
      cacheService.setCachedPageInfo('test-page', pageInfo);
      const cached = cacheService.getCachedPageInfo('test-page');
      
      expect(cached.lastEditedTime).toBe('2024-01-15T10:30:00.000Z');
    });

    it('debe permitir comparar lastEditedTime para invalidación', () => {
      const pageId = 'test-page';
      const oldTime = '2024-01-15T10:30:00.000Z';
      const newTime = '2024-01-15T12:00:00.000Z';
      
      // Guardar con tiempo antiguo
      cacheService.setCachedPageInfo(pageId, { lastEditedTime: oldTime });
      
      const cached = cacheService.getCachedPageInfo(pageId);
      
      // Simular verificación de invalidación
      const needsInvalidation = cached.lastEditedTime !== newTime;
      expect(needsInvalidation).toBe(true);
      
      // Si el tiempo es igual, no necesita invalidación
      const sameTime = cached.lastEditedTime !== oldTime;
      expect(sameTime).toBe(false);
    });
  });
});

