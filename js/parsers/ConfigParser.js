/**
 * @fileoverview Parser de configuración
 * 
 * Parsea y valida configuraciones JSON del vault.
 */

import { Config } from '../models/Config.js?v=20260722-4';
import { Category } from '../models/Category.js';
import { Page } from '../models/Page.js';
import { log, logWarn, logError } from '../utils/logger.js?v=20260722-4';

const isObjectRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

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
    if (!isObjectRecord(json) || !Array.isArray(json.categories) || json.categories.length === 0) {
      return 'legacy';
    }

    // Buscar items[] también en categorías anidadas para soportar archivos mixtos.
    const hasItems = this._categoriesUseItems(json.categories);
    return hasItems ? 'items' : 'legacy';
  }

  /**
   * Comprueba recursivamente si una configuración utiliza items[].
   * @private
   */
  _categoriesUseItems(categories) {
    if (!Array.isArray(categories)) return false;

    return categories.some(category => {
      if (!isObjectRecord(category)) return false;
      if (Array.isArray(category.items)) return true;
      return this._categoriesUseItems(category.categories);
    });
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
        order: Array.isArray(json.order) ? json.order : null
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
      .filter(cat => isObjectRecord(cat) && typeof cat.name === 'string' && cat.name.trim() !== '')
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
      collapsed: categoryJson.collapsed === true,
      order: Array.isArray(categoryJson.order) ? categoryJson.order : null
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

    const items = Array.isArray(categoryJson.items) ? categoryJson.items : [];
    for (const item of items) {
      if (!item || !item.type) continue;

      if (item.type === 'page') {
        // Aceptar páginas con url O htmlContent (local-first)
        if (this._isImportablePage(item)) {
          pages.push(this._parsePage(item));
          order.push({ type: 'page', index: pageIndex++ });
        }
      } else if (item.type === 'category') {
        if (typeof item.name === 'string' && item.name.trim() !== '') {
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
      collapsed: categoryJson.collapsed === true,
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
      .filter(page => this._isImportablePage(page))
      .map(page => this._parsePage(page));
  }

  /**
   * Comprueba si una página puede conservarse durante una recuperación tolerante.
   * @private
   */
  _isImportablePage(page) {
    if (!isObjectRecord(page) || typeof page.name !== 'string' || page.name.trim() === '') {
      return false;
    }
    const hasUrl = typeof page.url === 'string' && page.url.trim() !== '';
    const hasHtmlContent = typeof page.htmlContent === 'string' && page.htmlContent.trim() !== '';
    return hasUrl || hasHtmlContent;
  }

  /**
   * Parsea una página individual
   * @private
   */
  _parsePage(pageJson) {
    const blockTypes = Array.isArray(pageJson.blockTypes)
      ? pageJson.blockTypes.filter(type => typeof type === 'string')
      : null;
    return new Page(pageJson.name, pageJson.url || null, {
      id: pageJson.id, // Preservar ID existente (si no hay, Page genera uno nuevo)
      visibleToPlayers: pageJson.visibleToPlayers === true,
      blockTypes: blockTypes?.length ? blockTypes : null,
      icon: pageJson.icon || null,
      linkedTokenId: pageJson.linkedTokenId || null,
      htmlContent: typeof pageJson.htmlContent === 'string' ? pageJson.htmlContent : null,
      origin: pageJson.origin
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
      errors.push('This backup is empty.');
      return { valid: false, errors };
    }

    if (!isObjectRecord(json)) {
      errors.push('The backup must contain a JSON object.');
      return { valid: false, errors };
    }

    if (!hasOwn(json, 'categories')) {
      errors.push('This file is missing its folder list.');
      return { valid: false, errors };
    }

    if (!Array.isArray(json.categories)) {
      errors.push('The folder list in this backup has an invalid format.');
      return { valid: false, errors };
    }

    const format = this.detectFormat(json);

    // Validar cada categoría
    json.categories.forEach((cat, index) => {
      const catErrors = this._validateCategory(cat, `categories[${index}]`, format);
      errors.push(...catErrors);
    });

    if (hasOwn(json, 'pages')) {
      if (!Array.isArray(json.pages)) {
        errors.push('The root page list in this backup has an invalid format.');
      } else {
        json.pages.forEach((page, index) => {
          errors.push(...this._validatePage(page, `pages[${index}]`));
        });
      }
    }

    if (hasOwn(json, 'order')) {
      errors.push(...this._validateOrder(json.order, 'order'));
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Analiza una importación sin modificarla ni persistirla.
   * @param {Object} json - JSON de configuración
   * @returns {{valid: boolean, errors: string[], warnings: string[], format: string|null, summary: Object, ignoredFields: string[]}}
   */
  preflight(json) {
    const validation = this.validate(json);
    const format = validation.valid ? this.detectFormat(json) : null;
    const summary = this._summarizeConfig(json);
    const ignoredFields = isObjectRecord(json)
      ? this._findUnsupportedFields(json)
      : [];
    const warnings = [];

    if (ignoredFields.length > 0) {
      const count = ignoredFields.length;
      warnings.push(count === 1
        ? 'GM Vault will import the folders and pages, but it does not recognize one extra detail in this backup. That detail will be left out.'
        : `GM Vault will import the folders and pages, but it does not recognize ${count} extra details in this backup. Those details will be left out.`
      );
    }

    if (validation.valid && summary.categoryCount === 0 && summary.pageCount === 0) {
      warnings.push('This backup is empty. Replacing the vault with it will remove all current content.');
    }

    return {
      ...validation,
      warnings,
      format,
      summary,
      ignoredFields
    };
  }

  /**
   * Valida una categoría
   * @private
   */
  _validateCategory(category, path, format = 'legacy') {
    const errors = [];

    if (!isObjectRecord(category)) {
      errors.push('One folder in this backup is empty or invalid.');
      return errors;
    }

    if (typeof category.name !== 'string' || category.name.trim() === '') {
      errors.push('One folder in this backup is missing a name.');
    }

    const folderLabel = this._describeImportEntity('Folder', category);

    // Validación para formato items[]
    if (hasOwn(category, 'items')) {
      if (!Array.isArray(category.items)) {
        errors.push(`${folderLabel} has an invalid content list.`);
        return errors;
      }

      if (hasOwn(category, 'pages') || hasOwn(category, 'categories')) {
        errors.push(`${folderLabel} mixes two different backup formats.`);
      }

      category.items.forEach((item, index) => {
        const itemErrors = this._validateItem(item, `${path}.items[${index}]`);
        errors.push(...itemErrors);
      });
      return errors;
    }

    // Validación para formato legacy
    if (category.pages && !Array.isArray(category.pages)) {
      errors.push(`${folderLabel} has an invalid page list.`);
    } else if (category.pages) {
      category.pages.forEach((page, index) => {
        const pageErrors = this._validatePage(page, `${path}.pages[${index}]`);
        errors.push(...pageErrors);
      });
    }

    if (category.categories && !Array.isArray(category.categories)) {
      errors.push(`${folderLabel} has an invalid subfolder list.`);
    } else if (category.categories) {
      category.categories.forEach((subcat, index) => {
        const subcatErrors = this._validateCategory(subcat, `${path}.categories[${index}]`, format);
        errors.push(...subcatErrors);
      });
    }

    if (hasOwn(category, 'order')) {
      errors.push(...this._validateOrder(category.order, `${path}.order`));
    }

    return errors;
  }

  /**
   * Valida un item del formato items[]
   * @private
   */
  _validateItem(item, path) {
    const errors = [];

    if (!isObjectRecord(item)) {
      errors.push('One item in this backup is empty or invalid.');
      return errors;
    }

    if (!item.type || (item.type !== 'page' && item.type !== 'category')) {
      errors.push('One item has an unsupported type. It must be a page or a folder.');
      return errors;
    }

    if (item.type === 'page') {
      errors.push(...this._validatePage(item, path));
      return errors;
    }

    if (typeof item.name !== 'string' || item.name.trim() === '') {
      errors.push('One folder in this backup is missing a name.');
    }

    if (item.type === 'category') {
      const folderLabel = this._describeImportEntity('Folder', item);
      if (hasOwn(item, 'pages') || hasOwn(item, 'categories')) {
        errors.push(`${folderLabel} mixes two different backup formats.`);
      }

      if (hasOwn(item, 'items') && !Array.isArray(item.items)) {
        errors.push(`${folderLabel} has an invalid content list.`);
      } else if (Array.isArray(item.items)) {
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

    if (!isObjectRecord(page)) {
      errors.push('One page in this backup is empty or invalid.');
      return errors;
    }

    if (typeof page.name !== 'string' || page.name.trim() === '') {
      errors.push('One page in this backup is missing a name.');
    }

    const pageLabel = this._describeImportEntity('Page', page);

    // Aceptar url O htmlContent (local-first)
    const hasUrl = typeof page.url === 'string' && page.url.trim() !== '';
    const hasHtmlContent = typeof page.htmlContent === 'string' && page.htmlContent.trim() !== '';
    if (!hasUrl && !hasHtmlContent) {
      errors.push(`${pageLabel} needs a URL or saved page content.`);
    }

    if (page.blockTypes && !Array.isArray(page.blockTypes)) {
      errors.push(`${pageLabel} has invalid block type information.`);
    } else if (Array.isArray(page.blockTypes) && page.blockTypes.some(type => typeof type !== 'string')) {
      errors.push(`${pageLabel} has invalid block type information.`);
    }

    if (hasOwn(page, 'visibleToPlayers') && typeof page.visibleToPlayers !== 'boolean') {
      errors.push(`${pageLabel} must use true or false for player visibility.`);
    }

    return errors;
  }

  /**
   * Valida un array de orden combinado.
   * @private
   */
  _validateOrder(order, path) {
    if (order === null) return [];
    if (!Array.isArray(order)) return ['The content order in this backup has an invalid format.'];

    const errors = [];
    order.forEach((entry, index) => {
      if (
        !isObjectRecord(entry)
        || (entry.type !== 'page' && entry.type !== 'category')
        || !Number.isInteger(entry.index)
        || entry.index < 0
      ) {
        errors.push('One entry in the backup content order is invalid.');
      }
    });
    return errors;
  }

  /**
   * Crea una etiqueta comprensible para los errores de importación.
   * @private
   */
  _describeImportEntity(type, value) {
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    return name ? `${type} “${name}”` : `One ${type.toLowerCase()}`;
  }

  /**
   * Cuenta carpetas y páginas en ambos formatos soportados.
   * @private
   */
  _summarizeConfig(json) {
    let categoryCount = 0;
    let pageCount = Array.isArray(json?.pages) ? json.pages.length : 0;

    const visitCategory = (category) => {
      if (!isObjectRecord(category)) return;
      categoryCount++;

      if (Array.isArray(category.items)) {
        category.items.forEach(item => {
          if (!isObjectRecord(item)) return;
          if (item.type === 'page') pageCount++;
          if (item.type === 'category') visitCategory(item);
        });
        return;
      }

      if (Array.isArray(category.pages)) pageCount += category.pages.length;
      if (Array.isArray(category.categories)) category.categories.forEach(visitCategory);
    };

    if (Array.isArray(json?.categories)) json.categories.forEach(visitCategory);
    return { categoryCount, pageCount };
  }

  /**
   * Identifica campos que el modelo actual descartará al importar.
   * @private
   */
  _findUnsupportedFields(json) {
    const ignored = [];
    const collectUnknown = (value, allowed, path) => {
      if (!isObjectRecord(value)) return;
      Object.keys(value).forEach(key => {
        if (!allowed.has(key)) ignored.push(path ? `${path}.${key}` : key);
      });
    };

    const pageFields = new Set([
      'type', 'id', 'name', 'url', 'visibleToPlayers', 'blockTypes',
      'icon', 'linkedTokenId', 'htmlContent', 'origin'
    ]);
    const legacyCategoryFields = new Set([
      'id', 'name', 'pages', 'categories', 'collapsed', 'order'
    ]);
    const itemsCategoryFields = new Set([
      'type', 'id', 'name', 'items', 'collapsed'
    ]);

    const visitPage = (page, path) => collectUnknown(page, pageFields, path);
    const visitCategory = (category, path) => {
      if (!isObjectRecord(category)) return;

      if (Array.isArray(category.items)) {
        collectUnknown(category, itemsCategoryFields, path);
        category.items.forEach((item, index) => {
          const itemPath = `${path}.items[${index}]`;
          if (item?.type === 'category') visitCategory(item, itemPath);
          else visitPage(item, itemPath);
        });
        return;
      }

      collectUnknown(category, legacyCategoryFields, path);
      if (Array.isArray(category.pages)) {
        category.pages.forEach((page, index) => visitPage(page, `${path}.pages[${index}]`));
      }
      if (Array.isArray(category.categories)) {
        category.categories.forEach((child, index) => visitCategory(child, `${path}.categories[${index}]`));
      }
    };

    collectUnknown(json, new Set(['categories', 'pages', 'order']), '');
    if (Array.isArray(json.pages)) {
      json.pages.forEach((page, index) => visitPage(page, `pages[${index}]`));
    }
    if (Array.isArray(json.categories)) {
      json.categories.forEach((category, index) => visitCategory(category, `categories[${index}]`));
    }

    return ignored;
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
    if (page.origin) migrated.origin = page.origin;

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
    if (page.origin) item.origin = page.origin;

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
    if (item.origin) page.origin = item.origin;

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
