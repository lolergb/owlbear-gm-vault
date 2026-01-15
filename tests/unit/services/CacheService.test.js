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
});

