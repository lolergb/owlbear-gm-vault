/**
 * @fileoverview Modelo de Configuración
 * 
 * Representa la configuración completa del vault con todas las categorías y páginas.
 * Este modelo es independiente del framework y puede ser serializado a JSON.
 */

import { Category } from './Category.js';
import { Page } from './Page.js';
import { formatAsUUID } from '../utils/helpers.js';

/**
 * Clase que representa la configuración completa del vault
 */
export class Config {
  /**
   * @param {Object} options - Opciones de configuración
   * @param {Category[]} [options.categories=[]] - Categorías raíz
   * @param {Page[]} [options.pages=[]] - Páginas a nivel raíz
   * @param {Array} [options.order=null] - Orden combinado de categorías y páginas
   */
  constructor(options = {}) {
    this.categories = options.categories || [];
    this.pages = options.pages || [];
    this.order = options.order || null;
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
   * Busca una página por su Notion Page ID
   * Normaliza los IDs para comparar correctamente (con o sin guiones)
   * @param {string} notionPageId - ID de Notion (con o sin guiones)
   * @returns {Page|null}
   */
  findPageByNotionId(notionPageId) {
    if (!notionPageId) return null;
    
    // Normalizar el ID de búsqueda (eliminar guiones y convertir a minúsculas)
    const normalizedSearchId = this._normalizeNotionId(notionPageId);
    if (!normalizedSearchId) return null;
    
    const allPages = this.getAllPages();
    return allPages.find(p => {
      const pageNotionId = p.getNotionPageId();
      if (!pageNotionId) return false;
      return this._normalizeNotionId(pageNotionId) === normalizedSearchId;
    }) || null;
  }

  /**
   * Normaliza un ID de Notion para comparación
   * @private
   * @param {string} id - ID de Notion
   * @returns {string|null} - ID normalizado (32 caracteres, minúsculas, sin guiones)
   */
  _normalizeNotionId(id) {
    if (!id || typeof id !== 'string') return null;
    // Eliminar guiones y convertir a minúsculas
    const normalized = id.replace(/-/g, '').toLowerCase();
    // Verificar que sea un ID válido de 32 caracteres
    if (normalized.length === 32 && /^[a-f0-9]+$/.test(normalized)) {
      return normalized;
    }
    return null;
  }

  /**
   * Busca una página por su ID interno
   * @param {string} pageId - ID interno de la página (ej: "page_abc123")
   * @returns {Page|null}
   */
  findPageById(pageId) {
    if (!pageId) return null;
    const allPages = this.getAllPages();
    return allPages.find(p => p.id === pageId) || null;
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
      categories: this.categories.map(c => {
        // Si c tiene método clone, usarlo; sino, convertir a Category y clonar
        if (c && typeof c.clone === 'function') {
          return c.clone();
        }
        // Convertir objeto plano a Category y luego clonar
        return Category.fromJSON(c).clone();
      }),
      pages: this.pages.map(p => {
        if (p && typeof p.clone === 'function') {
          return p.clone();
        }
        return Page.fromJSON(p).clone();
      }),
      order: this.order ? JSON.parse(JSON.stringify(this.order)) : null
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
    const json = {
      categories: this.categories.map(c => c.toJSON ? c.toJSON() : c)
    };
    
    if (this.pages && this.pages.length > 0) {
      json.pages = this.pages.map(p => p.toJSON ? p.toJSON() : p);
    }
    
    if (this.order) {
      json.order = this.order;
    }
    
    return json;
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
    
    const pages = (json.pages || []).map(p => 
      p instanceof Page ? p : Page.fromJSON(p)
    );

    return new Config({ 
      categories,
      pages,
      order: json.order || null
    });
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

