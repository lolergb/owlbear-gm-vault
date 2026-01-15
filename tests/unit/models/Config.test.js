/**
 * @fileoverview Tests unitarios para el modelo Config
 */

import { describe, it, expect } from '@jest/globals';
import { Config } from '../../../js/models/Config.js';
import { Category } from '../../../js/models/Category.js';
import { Page } from '../../../js/models/Page.js';

describe('Config Model', () => {
  describe('constructor', () => {
    it('debe crear config vacía por defecto', () => {
      const config = new Config();
      expect(config.categories).toEqual([]);
    });

    it('debe aceptar categorías', () => {
      const cat = new Category('Test');
      const config = new Config({ categories: [cat] });
      expect(config.categories).toHaveLength(1);
    });
  });

  describe('addCategory / removeCategory', () => {
    it('debe añadir categorías', () => {
      const config = new Config();
      config.addCategory(new Category('Cat1'));
      config.addCategory(new Category('Cat2'));
      
      expect(config.categories).toHaveLength(2);
    });

    it('debe eliminar categorías por índice', () => {
      const config = new Config();
      config.addCategory(new Category('Cat1'));
      config.addCategory(new Category('Cat2'));
      
      config.removeCategory(0);
      
      expect(config.categories).toHaveLength(1);
      expect(config.categories[0].name).toBe('Cat2');
    });
  });

  describe('getTotalPageCount', () => {
    it('debe contar todas las páginas', () => {
      const config = new Config();
      
      const cat1 = new Category('Cat1');
      cat1.addPage(new Page('P1', 'https://example.com'));
      cat1.addPage(new Page('P2', 'https://example.com'));
      
      const cat2 = new Category('Cat2');
      cat2.addPage(new Page('P3', 'https://example.com'));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('P4', 'https://example.com'));
      cat2.addCategory(subcat);
      
      config.addCategory(cat1);
      config.addCategory(cat2);
      
      expect(config.getTotalPageCount()).toBe(4);
    });
  });

  describe('getTotalCategoryCount', () => {
    it('debe contar todas las categorías', () => {
      const config = new Config();
      
      const cat1 = new Category('Cat1');
      const cat2 = new Category('Cat2');
      const subcat = new Category('Sub');
      cat2.addCategory(subcat);
      
      config.addCategory(cat1);
      config.addCategory(cat2);
      
      expect(config.getTotalCategoryCount()).toBe(3);
    });
  });

  describe('getAllPages', () => {
    it('debe obtener todas las páginas', () => {
      const config = new Config();
      
      const cat1 = new Category('Cat1');
      cat1.addPage(new Page('P1', 'https://example.com'));
      
      const cat2 = new Category('Cat2');
      cat2.addPage(new Page('P2', 'https://example.com'));
      
      config.addCategory(cat1);
      config.addCategory(cat2);
      
      expect(config.getAllPages()).toHaveLength(2);
    });
  });

  describe('getVisiblePages', () => {
    it('debe obtener solo páginas visibles', () => {
      const config = new Config();
      
      const cat = new Category('Cat');
      cat.addPage(new Page('Visible', 'https://example.com', { visibleToPlayers: true }));
      cat.addPage(new Page('Hidden', 'https://example.com', { visibleToPlayers: false }));
      
      config.addCategory(cat);
      
      const visible = config.getVisiblePages();
      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe('Visible');
    });
  });

  describe('findPageByName', () => {
    it('debe encontrar página en cualquier categoría', () => {
      const config = new Config();
      
      const cat1 = new Category('Cat1');
      cat1.addPage(new Page('Page1', 'https://example.com'));
      
      const cat2 = new Category('Cat2');
      cat2.addPage(new Page('Target', 'https://example.com'));
      
      config.addCategory(cat1);
      config.addCategory(cat2);
      
      const found = config.findPageByName('Target');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Target');
    });
  });

  describe('findPageByUrl', () => {
    it('debe encontrar página por URL', () => {
      const config = new Config();
      
      const cat = new Category('Cat');
      cat.addPage(new Page('Page', 'https://target-url.com'));
      config.addCategory(cat);
      
      const found = config.findPageByUrl('https://target-url.com');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Page');
    });
  });

  describe('findCategoryByName', () => {
    it('debe encontrar categoría anidada', () => {
      const config = new Config();
      
      const cat = new Category('Main');
      const subcat = new Category('Target');
      cat.addCategory(subcat);
      config.addCategory(cat);
      
      const found = config.findCategoryByName('Target');
      expect(found).not.toBeNull();
      expect(found.name).toBe('Target');
    });
  });

  describe('isEmpty', () => {
    it('debe retornar true para config vacía', () => {
      expect(new Config().isEmpty()).toBe(true);
    });

    it('debe retornar false si tiene páginas', () => {
      const config = new Config();
      const cat = new Category('Cat');
      cat.addPage(new Page('Page', 'https://example.com'));
      config.addCategory(cat);
      
      expect(config.isEmpty()).toBe(false);
    });
  });

  describe('filterVisible', () => {
    it('debe retornar solo contenido visible', () => {
      const config = new Config();
      
      const cat = new Category('Cat');
      cat.addPage(new Page('Visible', 'https://example.com', { visibleToPlayers: true }));
      cat.addPage(new Page('Hidden', 'https://example.com'));
      
      const subcat = new Category('Sub');
      subcat.addPage(new Page('SubVisible', 'https://example.com', { visibleToPlayers: true }));
      cat.addCategory(subcat);
      
      config.addCategory(cat);
      
      const filtered = config.filterVisible();
      
      expect(filtered.categories).toHaveLength(1);
      expect(filtered.categories[0].pages).toHaveLength(1);
      expect(filtered.categories[0].pages[0].name).toBe('Visible');
      expect(filtered.categories[0].categories).toHaveLength(1);
    });
  });

  describe('toJSON / fromJSON', () => {
    it('debe serializar y deserializar correctamente', () => {
      const config = new Config();
      
      const cat = new Category('Cat', { collapsed: true });
      cat.addPage(new Page('Page', 'https://example.com', { visibleToPlayers: true }));
      config.addCategory(cat);
      
      const json = config.toJSON();
      const restored = Config.fromJSON(json);
      
      expect(restored.categories).toHaveLength(1);
      expect(restored.categories[0].name).toBe('Cat');
      expect(restored.categories[0].collapsed).toBe(true);
      expect(restored.categories[0].pages[0].name).toBe('Page');
      expect(restored.categories[0].pages[0].visibleToPlayers).toBe(true);
    });

    it('debe manejar null/undefined', () => {
      expect(Config.fromJSON(null).categories).toEqual([]);
      expect(Config.fromJSON(undefined).categories).toEqual([]);
    });
  });

  describe('createEmpty', () => {
    it('debe crear configuración con categorías por defecto', () => {
      const config = Config.createEmpty();
      
      expect(config.categories.length).toBeGreaterThan(0);
      expect(config.categories.some(c => c.name === 'Session Notes')).toBe(true);
    });
  });
});

