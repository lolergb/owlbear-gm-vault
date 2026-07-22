/**
 * @fileoverview Builder de configuración
 * 
 * Construye y modifica configuraciones del vault.
 */

import { Config } from '../models/Config.js?v=20260722-2';
import { Category } from '../models/Category.js';
import { Page } from '../models/Page.js';
import { log } from '../utils/logger.js';

/**
 * Builder para construir configuraciones del vault
 */
export class ConfigBuilder {
  constructor(config = null) {
    if (!config) {
      this.config = new Config();
    } else if (config instanceof Config) {
      this.config = config.clone();
    } else {
      // Es un objeto JSON plano, convertir a Config
      this.config = Config.fromJSON(config);
    }
  }

  /**
   * Crea un builder desde un JSON
   * @param {Object} json - JSON de configuración
   * @returns {ConfigBuilder}
   */
  static fromJSON(json) {
    return new ConfigBuilder(Config.fromJSON(json));
  }

  /**
   * Crea un builder con configuración vacía por defecto
   * @returns {ConfigBuilder}
   */
  static createDefault() {
    return new ConfigBuilder(Config.createEmpty());
  }

  /**
   * Añade una categoría raíz
   * @param {string} name - Nombre de la categoría
   * @param {Object} options - Opciones adicionales
   * @returns {ConfigBuilder}
   */
  addCategory(name, options = {}) {
    const category = new Category(name, options);
    this.config.addCategory(category);
    return this;
  }

  /**
   * Añade una página a una categoría
   * @param {Array} categoryPath - Ruta a la categoría (ej: ['NPCs', 'Villains'])
   * @param {string} name - Nombre de la página
   * @param {string} url - URL de la página
   * @param {Object} options - Opciones adicionales
   * @returns {ConfigBuilder}
   */
  addPage(categoryPath, name, url, options = {}) {
    const category = this._findCategoryByPath(categoryPath);
    if (category) {
      const page = new Page(name, url, options);
      category.addPage(page);
      log(`📄 Página añadida: ${name} en ${categoryPath.join(' > ')}`);
    }
    return this;
  }

  /**
   * Actualiza una página existente
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {number} pageIndex - Índice de la página
   * @param {Object} updates - Campos a actualizar
   * @returns {ConfigBuilder}
   */
  updatePage(categoryPath, pageIndex, updates) {
    const category = this._findCategoryByPath(categoryPath);
    if (category && category.pages[pageIndex]) {
      const page = category.pages[pageIndex];
      
      if (updates.name !== undefined) page.name = updates.name;
      if (updates.url !== undefined) page.url = updates.url;
      if (updates.visibleToPlayers !== undefined) page.visibleToPlayers = updates.visibleToPlayers;
      if (updates.blockTypes !== undefined) page.blockTypes = updates.blockTypes;
      if (updates.icon !== undefined) page.icon = updates.icon;
      if (updates.linkedTokenId !== undefined) page.linkedTokenId = updates.linkedTokenId;
      
      log(`📝 Página actualizada: ${page.name}`);
    }
    return this;
  }

  /**
   * Elimina una página
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {number} pageIndex - Índice de la página
   * @returns {ConfigBuilder}
   */
  removePage(categoryPath, pageIndex) {
    const category = this._findCategoryByPath(categoryPath);
    if (category && category.pages[pageIndex]) {
      const pageName = category.pages[pageIndex].name;
      category.removePage(pageIndex);
      log(`🗑️ Página eliminada: ${pageName}`);
    }
    return this;
  }

  /**
   * Mueve una página a otra categoría
   * @param {Array} fromPath - Categoría origen
   * @param {number} pageIndex - Índice de la página
   * @param {Array} toPath - Categoría destino
   * @returns {ConfigBuilder}
   */
  movePage(fromPath, pageIndex, toPath) {
    const fromCategory = this._findCategoryByPath(fromPath);
    const toCategory = this._findCategoryByPath(toPath);
    
    if (fromCategory && toCategory && fromCategory.pages[pageIndex]) {
      const page = fromCategory.pages[pageIndex];
      fromCategory.removePage(pageIndex);
      toCategory.addPage(page);
      log(`📦 Página movida: ${page.name} de ${fromPath.join(' > ')} a ${toPath.join(' > ')}`);
    }
    return this;
  }

  /**
   * Cambia la visibilidad de una página
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {number} pageIndex - Índice de la página
   * @param {boolean} visible - Nueva visibilidad
   * @returns {ConfigBuilder}
   */
  setPageVisibility(categoryPath, pageIndex, visible) {
    return this.updatePage(categoryPath, pageIndex, { visibleToPlayers: visible });
  }

  /**
   * Cambia la visibilidad de todas las páginas en una categoría
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {boolean} visible - Nueva visibilidad
   * @param {boolean} recursive - Si aplicar a subcategorías
   * @returns {ConfigBuilder}
   */
  setCategoryVisibility(categoryPath, visible, recursive = true) {
    const category = this._findCategoryByPath(categoryPath);
    if (category) {
      this._setVisibilityRecursive(category, visible, recursive);
    }
    return this;
  }

  /**
   * Añade una subcategoría
   * @param {Array} parentPath - Ruta a la categoría padre
   * @param {string} name - Nombre de la subcategoría
   * @param {Object} options - Opciones adicionales
   * @returns {ConfigBuilder}
   */
  addSubcategory(parentPath, name, options = {}) {
    const parent = this._findCategoryByPath(parentPath);
    if (parent) {
      const subcategory = new Category(name, options);
      parent.addCategory(subcategory);
      log(`📁 Subcategoría añadida: ${name} en ${parentPath.join(' > ')}`);
    }
    return this;
  }

  /**
   * Elimina una categoría
   * @param {Array} categoryPath - Ruta a la categoría
   * @returns {ConfigBuilder}
   */
  removeCategory(categoryPath) {
    if (categoryPath.length === 0) return this;

    if (categoryPath.length === 1) {
      // Categoría raíz
      const index = this.config.categories.findIndex(c => c.name === categoryPath[0]);
      if (index !== -1) {
        this.config.removeCategory(index);
        log(`🗑️ Categoría eliminada: ${categoryPath[0]}`);
      }
    } else {
      // Subcategoría
      const parentPath = categoryPath.slice(0, -1);
      const categoryName = categoryPath[categoryPath.length - 1];
      const parent = this._findCategoryByPath(parentPath);
      
      if (parent) {
        const index = parent.categories.findIndex(c => c.name === categoryName);
        if (index !== -1) {
          parent.removeCategory(index);
          log(`🗑️ Categoría eliminada: ${categoryName}`);
        }
      }
    }
    return this;
  }

  /**
   * Renombra una categoría
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {string} newName - Nuevo nombre
   * @returns {ConfigBuilder}
   */
  renameCategory(categoryPath, newName) {
    const category = this._findCategoryByPath(categoryPath);
    if (category) {
      const oldName = category.name;
      category.name = newName;
      log(`📝 Categoría renombrada: ${oldName} → ${newName}`);
    }
    return this;
  }

  /**
   * Reordena las páginas de una categoría
   * @param {Array} categoryPath - Ruta a la categoría
   * @param {number} fromIndex - Índice origen
   * @param {number} toIndex - Índice destino
   * @returns {ConfigBuilder}
   */
  reorderPage(categoryPath, fromIndex, toIndex) {
    const category = this._findCategoryByPath(categoryPath);
    if (category && category.pages[fromIndex]) {
      const [page] = category.pages.splice(fromIndex, 1);
      category.pages.splice(toIndex, 0, page);
      log(`↕️ Página reordenada: ${page.name}`);
    }
    return this;
  }

  /**
   * Construye y retorna la configuración
   * @returns {Config}
   */
  build() {
    return this.config.clone();
  }

  /**
   * Construye y retorna como JSON
   * @returns {Object}
   */
  toJSON() {
    return this.config.toJSON();
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

  /**
   * Encuentra una categoría por su ruta
   * @private
   */
  _findCategoryByPath(path) {
    if (!path || path.length === 0) return null;

    let current = this.config.categories.find(c => c.name === path[0]);
    
    for (let i = 1; i < path.length && current; i++) {
      current = current.categories?.find(c => c.name === path[i]);
    }
    
    return current;
  }

  /**
   * Establece visibilidad recursivamente
   * @private
   */
  _setVisibilityRecursive(category, visible, recursive) {
    // Actualizar páginas de esta categoría
    category.pages.forEach(page => {
      page.visibleToPlayers = visible;
    });

    // Si es recursivo, actualizar subcategorías
    if (recursive && category.categories) {
      category.categories.forEach(subcat => {
        this._setVisibilityRecursive(subcat, visible, true);
      });
    }
  }
}

export default ConfigBuilder;
