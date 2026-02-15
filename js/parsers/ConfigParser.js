/**
 * @fileoverview Parser de configuración
 * 
 * Parsea y valida configuraciones JSON del vault.
 */

import { Config } from '../models/Config.js';
import { Category } from '../models/Category.js';
import { Page } from '../models/Page.js';
import { log, logWarn, logError } from '../utils/logger.js';

/**
 * Parser de configuración del vault
 * 
 * Soporta dos formatos:
 * - Legacy: { categories: [{ name, pages: [], categories: [], order: [] }] }
 * - Items:  { categories: [{ name, items: [{ type: 'page'|'category', ... }] }] }
 */
export class ConfigParser {
  /**
   * Detecta el formato del JSON
   * @param {Object} json - JSON de configuración
   * @returns {'legacy'|'items'} - Tipo de formato
   */
  detectFormat(json) {
    if (!json || !json.categories || json.categories.length === 0) {
      return 'legacy';
    }

    // Verificar si alguna categoría tiene 'items'
    const hasItems = json.categories.some(cat => cat && Array.isArray(cat.items));
    return hasItems ? 'items' : 'legacy';
  }

  /**
   * Parsea un objeto JSON a un modelo Config
   * @param {Object} json - JSON de configuración
   * @returns {Config}
   */
  parse(json) {
    if (!json) {
      log('ConfigParser: JSON vacío, retornando config vacía');
      return new Config();
    }

    try {
      const format = this.detectFormat(json);
      log(`ConfigParser: Detectado formato "${format}"`);

      const categories = this._parseCategories(json.categories || [], format);
      
      // Parsear páginas del root (si existen)
      const pages = this._parsePages(json.pages || []);
      
      return new Config({ 
        categories,
        pages,
        order: json.order || null
      });
    } catch (e) {
      logError('Error parseando configuración:', e);
      return new Config();
    }
  }

  /**
   * Parsea un array de categorías
   * @private
   */
  _parseCategories(categoriesJson, format = 'legacy') {
    if (!Array.isArray(categoriesJson)) {
      return [];
    }

    return categoriesJson
      .filter(cat => cat && cat.name)
      .map(cat => this._parseCategory(cat, format));
  }

  /**
   * Parsea una categoría individual
   * @private
   */
  _parseCategory(categoryJson, format = 'legacy') {
    // Si es formato items[], convertir a formato interno
    if (format === 'items' && Array.isArray(categoryJson.items)) {
      return this._parseCategoryFromItems(categoryJson);
    }

    // Formato legacy
    const pages = this._parsePages(categoryJson.pages || []);
    const subcategories = this._parseCategories(categoryJson.categories || [], format);

    return new Category(categoryJson.name, {
      id: categoryJson.id, // Preservar ID existente (si no hay, Category genera uno nuevo)
      pages,
      categories: subcategories,
      collapsed: categoryJson.collapsed || false,
      order: categoryJson.order || null
    });
  }

  /**
   * Parsea una categoría desde formato items[]
   * @private
   */
  _parseCategoryFromItems(categoryJson) {
    const pages = [];
    const categories = [];
    const order = [];

    let pageIndex = 0;
    let categoryIndex = 0;

    for (const item of categoryJson.items || []) {
      if (!item || !item.type) continue;

      if (item.type === 'page') {
        // Aceptar páginas con url O htmlContent (local-first)
        if (item.name && (item.url || item.htmlContent)) {
          pages.push(this._parsePage(item));
          order.push({ type: 'page', index: pageIndex++ });
        }
      } else if (item.type === 'category') {
        if (item.name) {
          // Recursivamente parsear subcategoría
          categories.push(this._parseCategoryFromItems(item));
          order.push({ type: 'category', index: categoryIndex++ });
        }
      }
    }

    return new Category(categoryJson.name, {
      id: categoryJson.id, // Preservar ID existente (si no hay, Category genera uno nuevo)
      pages,
      categories,
      collapsed: categoryJson.collapsed || false,
      order: order.length > 0 ? order : null
    });
  }

  /**
   * Parsea un array de páginas
   * @private
   */
  _parsePages(pagesJson) {
    if (!Array.isArray(pagesJson)) {
      return [];
    }

    // Aceptar páginas con url O htmlContent (local-first)
    return pagesJson
      .filter(page => page && page.name && (page.url || page.htmlContent))
      .map(page => this._parsePage(page));
  }

  /**
   * Parsea una página individual
   * @private
   */
  _parsePage(pageJson) {
    return new Page(pageJson.name, pageJson.url || null, {
      id: pageJson.id, // Preservar ID existente (si no hay, Page genera uno nuevo)
      visibleToPlayers: pageJson.visibleToPlayers || false,
      blockTypes: pageJson.blockTypes || null,
      icon: pageJson.icon || null,
      linkedTokenId: pageJson.linkedTokenId || null,
      htmlContent: pageJson.htmlContent || null
    });
  }

  /**
   * Valida una configuración JSON
   * @param {Object} json - JSON a validar
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate(json) {
    const errors = [];

    if (!json) {
      errors.push('Configuración vacía');
      return { valid: false, errors };
    }

    if (!json.categories) {
      errors.push('Falta el campo "categories"');
      return { valid: false, errors };
    }

    if (!Array.isArray(json.categories)) {
      errors.push('"categories" debe ser un array');
      return { valid: false, errors };
    }

    const format = this.detectFormat(json);

    // Validar cada categoría
    json.categories.forEach((cat, index) => {
      const catErrors = this._validateCategory(cat, `categories[${index}]`, format);
      errors.push(...catErrors);
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida una categoría
   * @private
   */
  _validateCategory(category, path, format = 'legacy') {
    const errors = [];

    if (!category) {
      errors.push(`${path}: categoría vacía`);
      return errors;
    }

    if (!category.name || typeof category.name !== 'string') {
      errors.push(`${path}: falta nombre o no es string`);
    }

    // Validación para formato items[]
    if (format === 'items' && Array.isArray(category.items)) {
      category.items.forEach((item, index) => {
        const itemErrors = this._validateItem(item, `${path}.items[${index}]`);
        errors.push(...itemErrors);
      });
      return errors;
    }

    // Validación para formato legacy
    if (category.pages && !Array.isArray(category.pages)) {
      errors.push(`${path}.pages: debe ser un array`);
    } else if (category.pages) {
      category.pages.forEach((page, index) => {
        const pageErrors = this._validatePage(page, `${path}.pages[${index}]`);
        errors.push(...pageErrors);
      });
    }

    if (category.categories && !Array.isArray(category.categories)) {
      errors.push(`${path}.categories: debe ser un array`);
    } else if (category.categories) {
      category.categories.forEach((subcat, index) => {
        const subcatErrors = this._validateCategory(subcat, `${path}.categories[${index}]`, format);
        errors.push(...subcatErrors);
      });
    }

    return errors;
  }

  /**
   * Valida un item del formato items[]
   * @private
   */
  _validateItem(item, path) {
    const errors = [];

    if (!item) {
      errors.push(`${path}: item vacío`);
      return errors;
    }

    if (!item.type || (item.type !== 'page' && item.type !== 'category')) {
      errors.push(`${path}: falta type o no es 'page'|'category'`);
      return errors;
    }

    if (!item.name || typeof item.name !== 'string') {
      errors.push(`${path}: falta nombre o no es string`);
    }

    if (item.type === 'page') {
      // Aceptar url O htmlContent (local-first)
      const hasUrl = item.url && typeof item.url === 'string';
      const hasHtmlContent = item.htmlContent && typeof item.htmlContent === 'string';
      if (!hasUrl && !hasHtmlContent) {
        errors.push(`${path}: falta URL o htmlContent`);
      }
    }

    if (item.type === 'category' && item.items) {
      if (!Array.isArray(item.items)) {
        errors.push(`${path}.items: debe ser un array`);
      } else {
        item.items.forEach((subItem, index) => {
          const subErrors = this._validateItem(subItem, `${path}.items[${index}]`);
          errors.push(...subErrors);
        });
      }
    }

    return errors;
  }

  /**
   * Valida una página
   * @private
   */
  _validatePage(page, path) {
    const errors = [];

    if (!page) {
      errors.push(`${path}: página vacía`);
      return errors;
    }

    if (!page.name || typeof page.name !== 'string') {
      errors.push(`${path}: falta nombre o no es string`);
    }

    // Aceptar url O htmlContent (local-first)
    const hasUrl = page.url && typeof page.url === 'string';
    const hasHtmlContent = page.htmlContent && typeof page.htmlContent === 'string';
    if (!hasUrl && !hasHtmlContent) {
      errors.push(`${path}: falta URL o htmlContent`);
    }

    if (page.blockTypes && !Array.isArray(page.blockTypes)) {
      errors.push(`${path}.blockTypes: debe ser un array`);
    }

    return errors;
  }

  /**
   * Migra una configuración antigua al formato actual
   * @param {Object} json - JSON antiguo
   * @returns {Object} - JSON migrado
   */
  migrate(json) {
    if (!json) return { categories: [] };

    // Clonar para no modificar el original
    const migrated = JSON.parse(JSON.stringify(json));

    // Asegurar que tiene categories
    if (!migrated.categories) {
      migrated.categories = [];
    }

    // Migrar cada categoría
    migrated.categories = migrated.categories.map(cat => this._migrateCategory(cat));

    return migrated;
  }

  /**
   * Migra una categoría
   * @private
   */
  _migrateCategory(category) {
    if (!category) return null;

    // Asegurar campos requeridos
    const migrated = {
      name: category.name || 'Unnamed Category',
      pages: (category.pages || []).map(p => this._migratePage(p)).filter(p => p),
      categories: (category.categories || []).map(c => this._migrateCategory(c)).filter(c => c)
    };

    // Preservar collapsed si existe
    if (category.collapsed !== undefined) {
      migrated.collapsed = category.collapsed;
    }

    // Preservar order si existe
    if (category.order) {
      migrated.order = category.order;
    }

    return migrated;
  }

  /**
   * Migra una página
   * @private
   */
  _migratePage(page) {
    // Aceptar páginas con url O htmlContent (local-first)
    if (!page || (!page.url && !page.htmlContent)) return null;

    const migrated = {
      name: page.name || 'Unnamed Page',
      visibleToPlayers: page.visibleToPlayers || page.visible || false
    };

    if (page.url) migrated.url = page.url;
    if (page.htmlContent) migrated.htmlContent = page.htmlContent;
    if (page.blockTypes) migrated.blockTypes = page.blockTypes;
    if (page.icon) migrated.icon = page.icon;
    if (page.linkedTokenId) migrated.linkedTokenId = page.linkedTokenId;

    return migrated;
  }

  // ============================================
  // CONVERSIÓN ENTRE FORMATOS
  // ============================================

  /**
   * Convierte formato legacy a formato items[]
   * @param {Object} json - JSON en formato legacy
   * @returns {Object} - JSON en formato items[]
   */
  toItemsFormat(json) {
    if (!json || !json.categories) {
      return { categories: [] };
    }

    return {
      categories: json.categories.map(cat => this._categoryToItemsFormat(cat))
    };
  }

  /**
   * Convierte una categoría legacy a formato items[]
   * @private
   */
  _categoryToItemsFormat(category) {
    if (!category) return null;

    const items = [];
    const pages = category.pages || [];
    const categories = category.categories || [];
    const order = category.order || null;

    // Track qué índices ya fueron procesados
    const processedPageIndices = new Set();
    const processedCategoryIndices = new Set();

    // Si hay orden definido, usarlo primero
    if (order && Array.isArray(order)) {
      for (const orderItem of order) {
        if (orderItem.type === 'page' && pages[orderItem.index]) {
          items.push(this._pageToItemFormat(pages[orderItem.index]));
          processedPageIndices.add(orderItem.index);
        } else if (orderItem.type === 'category' && categories[orderItem.index]) {
          items.push(this._categoryToItemFormat(categories[orderItem.index]));
          processedCategoryIndices.add(orderItem.index);
        }
      }
      
      // Añadir items que no estaban en el order (añadidos después)
      categories.forEach((subcat, index) => {
        if (!processedCategoryIndices.has(index)) {
          items.push(this._categoryToItemFormat(subcat));
        }
      });
      pages.forEach((page, index) => {
        if (!processedPageIndices.has(index)) {
          items.push(this._pageToItemFormat(page));
        }
      });
    } else {
      // Sin orden definido: categorías primero, luego páginas
      for (const subcat of categories) {
        items.push(this._categoryToItemFormat(subcat));
      }
      for (const page of pages) {
        items.push(this._pageToItemFormat(page));
      }
    }

    const result = {
      name: category.name,
      items
    };

    if (category.id) {
      result.id = category.id;
    }

    if (category.collapsed) {
      result.collapsed = true;
    }

    return result;
  }

  /**
   * Convierte una página a formato item
   * @private
   */
  _pageToItemFormat(page) {
    const item = {
      type: 'page',
      name: page.name
    };

    if (page.id) item.id = page.id;
    if (page.url) item.url = page.url;
    if (page.htmlContent) item.htmlContent = page.htmlContent;
    if (page.visibleToPlayers) item.visibleToPlayers = true;
    if (page.blockTypes) item.blockTypes = page.blockTypes;
    if (page.icon) item.icon = page.icon;
    if (page.linkedTokenId) item.linkedTokenId = page.linkedTokenId;

    return item;
  }

  /**
   * Convierte una subcategoría a formato item
   * @private
   */
  _categoryToItemFormat(category) {
    const converted = this._categoryToItemsFormat(category);
    return {
      type: 'category',
      ...converted
    };
  }

  /**
   * Convierte formato items[] a formato legacy
   * @param {Object} json - JSON en formato items[]
   * @returns {Object} - JSON en formato legacy
   */
  toLegacyFormat(json) {
    if (!json || !json.categories) {
      return { categories: [] };
    }

    return {
      categories: json.categories.map(cat => this._categoryToLegacyFormat(cat))
    };
  }

  /**
   * Convierte una categoría items[] a formato legacy
   * @private
   */
  _categoryToLegacyFormat(category) {
    if (!category) return null;

    const pages = [];
    const categories = [];
    const order = [];

    let pageIndex = 0;
    let categoryIndex = 0;

    for (const item of category.items || []) {
      if (!item || !item.type) continue;

      if (item.type === 'page') {
        pages.push(this._itemToPageFormat(item));
        order.push({ type: 'page', index: pageIndex++ });
      } else if (item.type === 'category') {
        categories.push(this._itemToCategoryFormat(item));
        order.push({ type: 'category', index: categoryIndex++ });
      }
    }

    const result = {
      name: category.name,
      pages,
      categories,
      order
    };

    // Preservar ID si existe
    if (category.id) {
      result.id = category.id;
    }

    if (category.collapsed) {
      result.collapsed = true;
    }

    return result;
  }

  /**
   * Convierte un item página a formato legacy
   * @private
   */
  _itemToPageFormat(item) {
    const page = {
      name: item.name
    };

    // Preservar ID si existe
    if (item.id) page.id = item.id;
    if (item.url) page.url = item.url;
    if (item.htmlContent) page.htmlContent = item.htmlContent;
    if (item.visibleToPlayers) page.visibleToPlayers = true;
    if (item.blockTypes) page.blockTypes = item.blockTypes;
    if (item.icon) page.icon = item.icon;
    if (item.linkedTokenId) page.linkedTokenId = item.linkedTokenId;

    return page;
  }

  /**
   * Convierte un item categoría a formato legacy
   * @private
   */
  _itemToCategoryFormat(item) {
    // Crear una copia sin 'type' para recursión
    const categoryData = { ...item };
    delete categoryData.type;
    return this._categoryToLegacyFormat(categoryData);
  }
}

export default ConfigParser;

