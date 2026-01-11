/**
 * @fileoverview Funciones auxiliares reutilizables
 * 
 * Este módulo contiene funciones puras sin dependencias externas
 * que pueden ser usadas en cualquier parte de la aplicación.
 */

import { ROOM_METADATA_SAFE_LIMIT } from './constants.js';

// ============================================
// FUNCIONES DE JSON Y TAMAÑO
// ============================================

/**
 * Obtiene el tamaño en bytes de un objeto JSON
 * @param {any} obj - Objeto a medir
 * @returns {number} - Tamaño en bytes
 */
export function getJsonSize(obj) {
  try {
    const jsonString = JSON.stringify(obj);
    // Usar TextEncoder para obtener el tamaño real en bytes (UTF-8)
    return new TextEncoder().encode(jsonString).length;
  } catch (e) {
    // Fallback: estimación basada en string length
    return JSON.stringify(obj).length;
  }
}

/**
 * Comprime un objeto JSON eliminando espacios innecesarios
 * @param {any} obj - Objeto a comprimir
 * @returns {any} - Objeto comprimido (mismo objeto, JSON sin espacios)
 */
export function compressJson(obj) {
  try {
    // Serializar sin espacios y volver a parsear
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

/**
 * Serializa JSON de forma compacta (sin espacios)
 * @param {any} obj - Objeto a serializar
 * @returns {string} - JSON string compacto
 */
export function stringifyCompact(obj) {
  return JSON.stringify(obj);
}

/**
 * Valida si un objeto puede caber en room metadata
 * @param {any} obj - Objeto a validar
 * @param {boolean} compressed - Si true, valida el tamaño comprimido
 * @returns {{fits: boolean, size: number, limit: number, percentage: string}}
 */
export function validateMetadataSize(obj, compressed = true) {
  const testObj = compressed ? compressJson(obj) : obj;
  const size = getJsonSize(testObj);
  const fits = size <= ROOM_METADATA_SAFE_LIMIT;
  
  return {
    fits,
    size,
    limit: ROOM_METADATA_SAFE_LIMIT,
    percentage: (size / ROOM_METADATA_SAFE_LIMIT * 100).toFixed(1)
  };
}

/**
 * Valida si un nuevo objeto cabe en room metadata considerando TODOS los metadatos existentes
 * @param {string} metadataKey - La clave del metadata a actualizar
 * @param {any} newValue - El nuevo valor a guardar
 * @param {object} currentMetadata - Los metadatos actuales de la room
 * @returns {{fits: boolean, size: number, limit: number, percentage: string}}
 */
export function validateTotalMetadataSize(metadataKey, newValue, currentMetadata = {}) {
  // Crear una copia de los metadatos con el nuevo valor
  const testMetadata = { ...currentMetadata };
  testMetadata[metadataKey] = compressJson(newValue);
  
  // Calcular el tamaño total
  const totalSize = getJsonSize(testMetadata);
  const fits = totalSize <= ROOM_METADATA_SAFE_LIMIT;
  
  return {
    fits,
    size: totalSize,
    limit: ROOM_METADATA_SAFE_LIMIT,
    percentage: (totalSize / ROOM_METADATA_SAFE_LIMIT * 100).toFixed(1)
  };
}

// ============================================
// FUNCIONES DE NOTION
// ============================================

/**
 * Verifica si una URL es de Notion
 * @param {string} url - URL a verificar
 * @returns {boolean}
 */
export function isNotionUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('notion.so') || url.includes('notion.site');
}

/**
 * Verifica si la URL es un archivo HTML de demo local (content-demo)
 * @param {string} url - URL a verificar
 * @returns {boolean}
 */
export function isDemoHtmlFile(url) {
  if (!url || typeof url !== 'string') return false;
  // Detectar archivos HTML en content-demo
  return url.includes('/content-demo/') && url.endsWith('.html');
}

/**
 * Extrae el ID de página de una URL de Notion
 * @param {string} url - URL de Notion
 * @returns {string|null} - ID formateado como UUID o null
 */
export function extractNotionPageId(url) {
  try {
    // Verificar si la URL es de Notion antes de procesarla
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    // Verificar si es una URL de Notion
    if (!isNotionUrl(url)) {
      return null;
    }
    
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Buscar un ID de 32 caracteres hexadecimales en el pathname
    const idMatch = pathname.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
    
    if (idMatch && idMatch[1]) {
      const pageId = idMatch[1];
      // Convertir a formato UUID con guiones: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      return formatAsUUID(pageId);
    }
    
    // Fallback: intentar extraer del último segmento después de dividir por guiones
    const pathParts = pathname.split('-');
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && /^[a-f0-9]{32}$/i.test(lastPart)) {
        return formatAsUUID(lastPart);
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Formatea un ID de 32 caracteres como UUID
 * @param {string} id - ID de 32 caracteres
 * @returns {string} - UUID formateado
 */
export function formatAsUUID(id) {
  return `${id.substring(0, 8)}-${id.substring(8, 12)}-${id.substring(12, 16)}-${id.substring(16, 20)}-${id.substring(20, 32)}`;
}

// ============================================
// FUNCIONES DE UI
// ============================================

/**
 * Genera un color HSL consistente basado en un string
 * @param {string} str - String de entrada
 * @returns {string} - Color en formato HSL
 */
export function generateColorFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generar colores vibrantes pero no demasiado claros
  const hue = Math.abs(hash % 360);
  const saturation = 60 + (Math.abs(hash) % 20); // 60-80%
  const lightness = 45 + (Math.abs(hash) % 15); // 45-60%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Obtiene la inicial de un texto (ignorando emojis)
 * @param {string} text - Texto de entrada
 * @returns {string} - Primera letra o '?'
 */
export function getInitial(text) {
  if (!text || text.length === 0) return '?';
  // Obtener la primera letra (ignorar emojis y espacios)
  const match = text.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : text.charAt(0).toUpperCase();
}

// ============================================
// FUNCIONES DE STORAGE KEY
// ============================================

/**
 * Genera la clave de storage para un room
 * @param {string} roomId - ID del room
 * @returns {string} - Clave de storage
 */
export function getStorageKey(roomId) {
  return 'notion-pages-json-' + (roomId || 'default');
}

// ============================================
// FUNCIONES DE CONTEO
// ============================================

/**
 * Cuenta el total de páginas en una configuración
 * @param {Object} config - Configuración con categorías
 * @returns {number} - Número total de páginas
 */
export function countPages(config) {
  let count = 0;
  
  function countRecursive(categories) {
    if (!categories) return;
    categories.forEach(cat => {
      if (cat.pages) count += cat.pages.length;
      if (cat.categories) countRecursive(cat.categories);
    });
  }
  
  if (config && config.categories) {
    countRecursive(config.categories);
  }
  
  return count;
}

/**
 * Cuenta el total de categorías en una configuración
 * @param {Object} config - Configuración con categorías
 * @returns {number} - Número total de categorías
 */
export function countCategories(config) {
  let count = 0;
  
  function countRecursive(categories) {
    if (!categories) return;
    categories.forEach(cat => {
      count++;
      if (cat.categories) countRecursive(cat.categories);
    });
  }
  
  if (config && config.categories) {
    countRecursive(config.categories);
  }
  
  return count;
}

/**
 * Filtra la configuración para incluir solo páginas visibles para players
 * @param {Object} config - Configuración completa
 * @returns {Object} - Configuración filtrada
 */
export function filterVisiblePages(config) {
  if (!config || !config.categories) {
    return { categories: [] };
  }
  
  function filterCategory(category) {
    const filteredPages = (category.pages || []).filter(p => p.visibleToPlayers === true);
    const filteredCategories = (category.categories || [])
      .map(filterCategory)
      .filter(c => (c.pages && c.pages.length > 0) || (c.categories && c.categories.length > 0));
    
    return {
      ...category,
      pages: filteredPages,
      categories: filteredCategories.length > 0 ? filteredCategories : undefined
    };
  }
  
  const filtered = config.categories
    .map(filterCategory)
    .filter(c => (c.pages && c.pages.length > 0) || (c.categories && c.categories.length > 0));
  
  return { categories: filtered };
}

/**
 * Debounce - Retrasa la ejecución de una función
 * @param {Function} func - Función a ejecutar
 * @param {number} wait - Tiempo de espera en ms
 * @returns {Function} - Función con debounce
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle - Limita la frecuencia de ejecución de una función
 * @param {Function} func - Función a ejecutar
 * @param {number} limit - Tiempo mínimo entre ejecuciones en ms
 * @returns {Function} - Función con throttle
 */
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

