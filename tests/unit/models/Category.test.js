/**
 * @fileoverview Tests unitarios para el modelo Category
 */

import { describe, it, expect } from '@jest/globals';
import { Category } from '../../../js/models/Category.js';
import { Page } from '../../../js/models/Page.js';

describe('Category Model', () => {
  describe('constructor', () => {
    it('debe crear una categoría con nombre', () => {
      const cat = new Category('NPCs');
      expect(cat.name).toBe('NPCs');
      expect(cat.pages).toEqual([]);
      expect(cat.categories).toEqual([]);
      expect(cat.collapsed).toBe(false);
    });

    it('debe aceptar opciones', () => {
      const page = new Page('Test Page', 'https://notion.so/page');
      const subcat = new Category('Subcat');
      
      const cat = new Category('Main', {
        pages: [page],
        categories: [subcat],
        collapsed: true
      });
      
      expect(cat.pages).toHaveLength(1);
      expect(cat.categories).toHaveLength(1);
      expect(cat.collapsed).toBe(true);
    });
  });

  describe('addPage / removePage', () => {
    it('debe añadir páginas', () => {
      const cat = new Category('Test');
      const page = new Page('Page 1', 'https://example.com');
      
      cat.addPage(page);
      
      expect(cat.pages).toHaveLength(1);
      expect(cat.pages[0].name).toBe('Page 1');
    });

    it('debe eliminar páginas por índice', () => {
      const cat = new Category('Test');
      cat.addPage(new Page('Page 1', 'https://example.com'));
      cat.addPage(new Page('Page 2', 'https://example.com'));
      
      cat.removePage(0);
      
      expect(cat.pages).toHaveLength(1);
      expect(cat.pages[0].name).toBe('Page 2');
    });
  });

  describe('addCategory / removeCategory', () => {
    it('debe añadir subcategorías', () => {
      const cat = new Category('Main');
      const subcat = new Category('Sub');
      
      cat.addCategory(subcat);
      
      expect(cat.categories).toHaveLength(1);
      expect(cat.categories[0].name).toBe('Sub');
    });

    it('debe eliminar subcategorías por índice', () => {
      const cat = new Category('Main');
      cat.addCategory(new Category('Sub1'));
      cat.addCategory(new Category('Sub2'));
      
      cat.removeCategory(0);
      
      expect(cat.categories).toHaveLength(1);
      expect(cat.categories[0].name).toBe('Sub2');
    });
  });

  describe('getTotalPageCount', () => {
    it('debe contar páginas incluyendo subcategorías', () => {
      const cat = new Category('Main');
      cat.addPage(new Page('P1', 'https://example.com'));
      cat.addPage(new Page('P2', 'https://example.com'));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('P3', 'https://example.com'));
      cat.addCategory(subcat);
      
      expect(cat.getTotalPageCount()).toBe(3);
    });
  });

  describe('getAllPages', () => {
    it('debe obtener todas las páginas recursivamente', () => {
      const cat = new Category('Main');
      cat.addPage(new Page('P1', 'https://example.com'));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('P2', 'https://example.com'));
      cat.addCategory(subcat);
      
      const allPages = cat.getAllPages();
      
      expect(allPages).toHaveLength(2);
      expect(allPages.map(p => p.name)).toEqual(['P1', 'P2']);
    });
  });

  describe('findPageByName', () => {
    it('debe encontrar página por nombre', () => {
      const cat = new Category('Main');
      cat.addPage(new Page('Target', 'https://example.com'));
      cat.addPage(new Page('Other', 'https://example.com'));
      
      const found = cat.findPageByName('Target');
      
      expect(found).not.toBeNull();
      expect(found.name).toBe('Target');
    });

    it('debe buscar en subcategorías', () => {
      const cat = new Category('Main');
      const subcat = new Category('Sub');
      subcat.addPage(new Page('Nested', 'https://example.com'));
      cat.addCategory(subcat);
      
      const found = cat.findPageByName('Nested');
      
      expect(found).not.toBeNull();
      expect(found.name).toBe('Nested');
    });

    it('debe retornar null si no encuentra', () => {
      const cat = new Category('Main');
      cat.addPage(new Page('Page', 'https://example.com'));
      
      expect(cat.findPageByName('NotFound')).toBeNull();
    });
  });

  describe('isEmpty', () => {
    it('debe retornar true para categoría vacía', () => {
      const cat = new Category('Empty');
      expect(cat.isEmpty()).toBe(true);
    });

    it('debe retornar false si tiene páginas', () => {
      const cat = new Category('Test');
      cat.addPage(new Page('Page', 'https://example.com'));
      expect(cat.isEmpty()).toBe(false);
    });

    it('debe verificar subcategorías recursivamente', () => {
      const cat = new Category('Main');
      const subcat = new Category('Sub');
      cat.addCategory(subcat);
      
      expect(cat.isEmpty()).toBe(true);
      
      subcat.addPage(new Page('Page', 'https://example.com'));
      
      expect(cat.isEmpty()).toBe(false);
    });
  });

  describe('clone', () => {
    it('debe crear copia profunda', () => {
      const cat = new Category('Main');
      cat.addPage(new Page('Page', 'https://example.com'));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('SubPage', 'https://example.com'));
      cat.addCategory(subcat);
      
      const cloned = cat.clone();
      
      expect(cloned.name).toBe('Main');
      expect(cloned.pages).toHaveLength(1);
      expect(cloned.categories).toHaveLength(1);
      
      // Modificar clon no afecta original
      cloned.name = 'Modified';
      cloned.pages[0].name = 'ModifiedPage';
      
      expect(cat.name).toBe('Main');
      expect(cat.pages[0].name).toBe('Page');
    });
  });

  describe('toJSON / fromJSON', () => {
    it('debe serializar y deserializar correctamente', () => {
      const cat = new Category('Main', { collapsed: true });
      cat.addPage(new Page('Page', 'https://example.com', { visibleToPlayers: true }));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('SubPage', 'https://example.com'));
      cat.addCategory(subcat);
      
      const json = cat.toJSON();
      const restored = Category.fromJSON(json);
      
      expect(restored.name).toBe('Main');
      expect(restored.collapsed).toBe(true);
      expect(restored.pages).toHaveLength(1);
      expect(restored.pages[0].name).toBe('Page');
      expect(restored.pages[0].visibleToPlayers).toBe(true);
      expect(restored.categories).toHaveLength(1);
      expect(restored.categories[0].name).toBe('Sub');
    });
  });
});

