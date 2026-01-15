/**
 * @fileoverview Modelo de Categoría
 * 
 * Representa una categoría que puede contener páginas y subcategorías.
 * Este modelo es independiente del framework y puede ser serializado a JSON.
 */

import { Page } from './Page.js';

/**
 * Clase que representa una categoría de contenido
 */
export class Category {
  /**
   * @param {string} name - Nombre de la categoría
   * @param {Object} options - Opciones adicionales
   * @param {Page[]} [options.pages=[]] - Páginas en esta categoría
   * @param {Category[]} [options.categories=[]] - Subcategorías
   * @param {boolean} [options.collapsed=false] - Si está colapsada en la UI
   * @param {Array} [options.order=null] - Orden combinado de categorías y páginas
   */
  constructor(name, options = {}) {
    this.name = name;
    this.pages = options.pages || [];
    this.categories = options.categories || [];
    this.collapsed = options.collapsed || false;
    this.order = options.order || null;
  }

  /**
   * Añade una página a la categoría
   * @param {Page} page - Página a añadir
   */
  addPage(page) {
    this.pages.push(page);
  }

  /**
   * Elimina una página por índice
   * @param {number} index - Índice de la página
   */
  removePage(index) {
    if (index >= 0 && index < this.pages.length) {
      this.pages.splice(index, 1);
    }
  }

  /**
   * Añade una subcategoría
   * @param {Category} category - Subcategoría a añadir
   */
  addCategory(category) {
    this.categories.push(category);
  }

  /**
   * Elimina una subcategoría por índice
   * @param {number} index - Índice de la subcategoría
   */
  removeCategory(index) {
    if (index >= 0 && index < this.categories.length) {
      this.categories.splice(index, 1);
    }
  }

  /**
   * Cuenta el total de páginas (incluyendo subcategorías)
   * @returns {number}
   */
  getTotalPageCount() {
    let count = this.pages.length;
    for (const subcat of this.categories) {
      count += subcat.getTotalPageCount();
    }
    return count;
  }

  /**
   * Obtiene todas las páginas (incluyendo subcategorías)
   * @returns {Page[]}
   */
  getAllPages() {
    const allPages = [...this.pages];
    for (const subcat of this.categories) {
      allPages.push(...subcat.getAllPages());
    }
    return allPages;
  }

  /**
   * Busca una página por nombre
   * @param {string} name - Nombre a buscar
   * @returns {Page|null}
   */
  findPageByName(name) {
    const found = this.pages.find(p => p.name === name);
    if (found) return found;

    for (const subcat of this.categories) {
      const subFound = subcat.findPageByName(name);
      if (subFound) return subFound;
    }

    return null;
  }

  /**
   * Verifica si la categoría está vacía
   * @returns {boolean}
   */
  isEmpty() {
    return this.pages.length === 0 && this.categories.every(c => c.isEmpty());
  }

  /**
   * Crea una copia de la categoría
   * @returns {Category}
   */
  clone() {
    return new Category(this.name, {
      pages: this.pages.map(p => {
        // Si p tiene método clone, usarlo; sino, convertir a Page y clonar
        if (p && typeof p.clone === 'function') {
          return p.clone();
        }
        return Page.fromJSON(p).clone();
      }),
      categories: this.categories.map(c => {
        // Si c tiene método clone, usarlo; sino, convertir a Category y clonar
        if (c && typeof c.clone === 'function') {
          return c.clone();
        }
        return Category.fromJSON(c).clone();
      }),
      collapsed: this.collapsed,
      order: this.order ? JSON.parse(JSON.stringify(this.order)) : null
    });
  }

  /**
   * Serializa la categoría a un objeto JSON plano
   * @returns {Object}
   */
  toJSON() {
    const json = {
      name: this.name
    };

    if (this.pages.length > 0) {
      json.pages = this.pages.map(p => p.toJSON ? p.toJSON() : p);
    }

    if (this.categories.length > 0) {
      json.categories = this.categories.map(c => c.toJSON ? c.toJSON() : c);
    }

    if (this.collapsed) {
      json.collapsed = true;
    }

    if (this.order) {
      json.order = this.order;
    }

    return json;
  }

  /**
   * Crea una Category desde un objeto JSON plano
   * @param {Object} json - Objeto JSON
   * @returns {Category}
   */
  static fromJSON(json) {
    const pages = (json.pages || []).map(p => 
      p instanceof Page ? p : Page.fromJSON(p)
    );
    
    const categories = (json.categories || []).map(c => 
      c instanceof Category ? c : Category.fromJSON(c)
    );

    return new Category(json.name, {
      pages,
      categories,
      collapsed: json.collapsed,
      order: json.order || null
    });
  }
}

export default Category;

