/**
 * @fileoverview Modelo de Configuración
 * 
 * Representa la configuración completa del vault con todas las categorías y páginas.
 * Este modelo es independiente del framework y puede ser serializado a JSON.
 */

import { Category } from './Category.js';
import { Page } from './Page.js';

/**
 * Clase que representa la configuración completa del vault
 */
export class Config {
  /**
   * @param {Object} options - Opciones de configuración
   * @param {Category[]} [options.categories=[]] - Categorías raíz
   */
  constructor(options = {}) {
    this.categories = options.categories || [];
  }

  /**
   * Añade una categoría raíz
   * @param {Category} category - Categoría a añadir
   */
  addCategory(category) {
    this.categories.push(category);
  }

  /**
   * Elimina una categoría raíz por índice
   * @param {number} index - Índice de la categoría
   */
  removeCategory(index) {
    if (index >= 0 && index < this.categories.length) {
      this.categories.splice(index, 1);
    }
  }

  /**
   * Cuenta el total de páginas en toda la configuración
   * @returns {number}
   */
  getTotalPageCount() {
    let count = 0;
    for (const cat of this.categories) {
      count += cat.getTotalPageCount();
    }
    return count;
  }

  /**
   * Cuenta el total de categorías (incluyendo subcategorías)
   * @returns {number}
   */
  getTotalCategoryCount() {
    let count = 0;
    
    const countRecursive = (categories) => {
      for (const cat of categories) {
        count++;
        if (cat.categories) {
          countRecursive(cat.categories);
        }
      }
    };
    
    countRecursive(this.categories);
    return count;
  }

  /**
   * Obtiene todas las páginas de la configuración
   * @returns {Page[]}
   */
  getAllPages() {
    const allPages = [];
    for (const cat of this.categories) {
      allPages.push(...cat.getAllPages());
    }
    return allPages;
  }

  /**
   * Obtiene todas las páginas visibles para jugadores
   * @returns {Page[]}
   */
  getVisiblePages() {
    return this.getAllPages().filter(p => p.visibleToPlayers);
  }

  /**
   * Busca una página por nombre en toda la configuración
   * @param {string} name - Nombre a buscar
   * @returns {Page|null}
   */
  findPageByName(name) {
    for (const cat of this.categories) {
      const found = cat.findPageByName(name);
      if (found) return found;
    }
    return null;
  }

  /**
   * Busca una página por URL
   * @param {string} url - URL a buscar
   * @returns {Page|null}
   */
  findPageByUrl(url) {
    const allPages = this.getAllPages();
    return allPages.find(p => p.url === url) || null;
  }

  /**
   * Busca una categoría por nombre
   * @param {string} name - Nombre a buscar
   * @returns {Category|null}
   */
  findCategoryByName(name) {
    const searchRecursive = (categories) => {
      for (const cat of categories) {
        if (cat.name === name) return cat;
        if (cat.categories) {
          const found = searchRecursive(cat.categories);
          if (found) return found;
        }
      }
      return null;
    };
    
    return searchRecursive(this.categories);
  }

  /**
   * Verifica si la configuración está vacía
   * @returns {boolean}
   */
  isEmpty() {
    return this.categories.length === 0 || this.categories.every(c => c.isEmpty());
  }

  /**
   * Crea una copia profunda de la configuración
   * @returns {Config}
   */
  clone() {
    return new Config({
      categories: this.categories.map(c => c.clone())
    });
  }

  /**
   * Filtra la configuración para incluir solo páginas visibles
   * @returns {Config}
   */
  filterVisible() {
    const filterCategory = (category) => {
      const filteredPages = category.pages.filter(p => p.visibleToPlayers);
      const filteredCategories = category.categories
        .map(filterCategory)
        .filter(c => c.pages.length > 0 || c.categories.length > 0);
      
      return new Category(category.name, {
        pages: filteredPages,
        categories: filteredCategories,
        collapsed: category.collapsed
      });
    };

    const filteredCategories = this.categories
      .map(filterCategory)
      .filter(c => c.pages.length > 0 || c.categories.length > 0);

    return new Config({ categories: filteredCategories });
  }

  /**
   * Serializa la configuración a un objeto JSON plano
   * @returns {Object}
   */
  toJSON() {
    return {
      categories: this.categories.map(c => c.toJSON ? c.toJSON() : c)
    };
  }

  /**
   * Crea una Config desde un objeto JSON plano
   * @param {Object} json - Objeto JSON
   * @returns {Config}
   */
  static fromJSON(json) {
    if (!json) return new Config();
    
    const categories = (json.categories || []).map(c => 
      c instanceof Category ? c : Category.fromJSON(c)
    );

    return new Config({ categories });
  }

  /**
   * Crea una configuración vacía por defecto
   * @returns {Config}
   */
  static createEmpty() {
    return new Config({
      categories: [
        new Category('Session Notes', { pages: [] }),
        new Category('NPCs', { pages: [] }),
        new Category('Locations', { pages: [] })
      ]
    });
  }
}

export default Config;

