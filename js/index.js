console.log('🚀 Iniciando carga de index.js...');

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

console.log('✅ OBR SDK importado');

// Sistema de logs controlado por variable de entorno de Netlify
let DEBUG_MODE = false;

// Función para inicializar el modo debug desde Netlify
async function initDebugMode() {
  try {
    // Intentar obtener la variable de entorno desde Netlify Function
    if (window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')) {
      const response = await fetch('/.netlify/functions/get-debug-mode');
      if (response.ok) {
        const data = await response.json();
        DEBUG_MODE = data.debug === true;
        if (DEBUG_MODE) {
          console.log('🔍 Modo debug activado');
        }
      }
    }
  } catch (e) {
    // Si falla, usar false por defecto (logs desactivados)
    DEBUG_MODE = false;
  }
}

// Función wrapper para logs (solo muestra si DEBUG_MODE está activado)
function log(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

function logError(...args) {
  // Los errores siempre se muestran
  console.error(...args);
}

function logWarn(...args) {
  // Las advertencias siempre se muestran
  console.warn(...args);
}

// Importar configuración
// Si config.js no existe, copia config.example.js a config.js y completa los datos
import { 
  NOTION_API_BASE, 
  NOTION_PAGES 
} from "../config/config.js";

// Variables de color CSS (deben coincidir con las del index.html)
const CSS_VARS = {
  bgPrimary: '#ffffff0d',
  borderPrimary: 'transparent',
  bgHover: '#ffffff1a',
  bgActive: '#bb99ff4d',
  borderActive: '#bb99ff4d'
};

// Sistema simple de gestión con JSON (por room)
const STORAGE_KEY_PREFIX = 'notion-pages-json-';
const TOKEN_STORAGE_PREFIX = 'notion-user-token-';

function getStorageKey(roomId) {
  return STORAGE_KEY_PREFIX + (roomId || 'default');
}

// Token global de la extensión (no por room)
const GLOBAL_TOKEN_KEY = 'notion-global-token';

// Funciones para gestionar el token del usuario (global para toda la extensión)
function getUserToken() {
  try {
    const token = localStorage.getItem(GLOBAL_TOKEN_KEY);
    if (token && token.trim() !== '') {
      return token.trim();
    }
  } catch (e) {
    console.error('Error al leer token del usuario:', e);
  }
  return null;
}

function saveUserToken(token) {
  try {
    if (token && token.trim() !== '') {
      localStorage.setItem(GLOBAL_TOKEN_KEY, token.trim());
      log('✅ Token del usuario guardado (global para toda la extensión)');
      return true;
    } else {
      // Si el token está vacío, eliminarlo
      localStorage.removeItem(GLOBAL_TOKEN_KEY);
      log('🗑️ Token del usuario eliminado');
      return true;
    }
  } catch (e) {
    console.error('Error al guardar token del usuario:', e);
    return false;
  }
}

function hasUserToken() {
  return getUserToken() !== null;
}

// Función para mostrar un ID de room más amigable (solo primeros caracteres)
function getFriendlyRoomId(roomId) {
  if (!roomId || roomId === 'default') {
    return 'default';
  }
  // Mostrar solo los primeros 8 caracteres + "..."
  if (roomId.length > 12) {
    return roomId.substring(0, 8) + '...';
  }
  return roomId;
}

function getPagesJSON(roomId) {
  try {
    const storageKey = getStorageKey(roomId);
    log('🔍 Buscando configuración con clave:', storageKey, 'para roomId:', roomId);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      log('✅ Configuración encontrada para room:', roomId);
      return parsed;
    } else {
      log('⚠️ No se encontró configuración para room:', roomId);
    }
  } catch (e) {
    console.error('Error al leer JSON:', e);
  }
  return null;
}

function savePagesJSON(json, roomId) {
  try {
    const storageKey = getStorageKey(roomId);
    log('💾 Guardando configuración con clave:', storageKey, 'para roomId:', roomId);
    localStorage.setItem(storageKey, JSON.stringify(json, null, 2));
    log('✅ Configuración guardada exitosamente para room:', roomId);
    
    // Verificar que se guardó correctamente
    const verify = localStorage.getItem(storageKey);
    if (verify) {
      console.log('✅ Verificación: configuración guardada correctamente');
    } else {
      console.error('❌ Error: no se pudo verificar la configuración guardada');
    }
    
    return true;
  } catch (e) {
    console.error('Error al guardar JSON:', e);
    return false;
  }
}

// Función para obtener la configuración por defecto (desde archivo público o fallback)
async function getDefaultJSON() {
  try {
    // Intentar cargar desde archivo público
    const response = await fetch('/default-config.json');
    if (response.ok) {
      const config = await response.json();
      log('✅ Configuración por defecto cargada desde default-config.json');
      return config;
    }
  } catch (e) {
    log('⚠️ No se pudo cargar default-config.json, usando fallback');
  }
  
  // Fallback: usar NOTION_PAGES del config.js si está disponible
  try {
    return {
      categories: [
        {
          name: "General",
          pages: NOTION_PAGES ? NOTION_PAGES.filter(p => p.url && !p.url.includes('...') && p.url.startsWith('http')) : []
        }
      ]
    };
  } catch (e) {
    // Último fallback: configuración vacía
    return {
      categories: [
        {
          name: "General",
          pages: []
        }
      ]
    };
  }
}

// Función para obtener todas las configuraciones de rooms (para debugging)
function getAllRoomConfigs() {
  const configs = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const roomId = key.replace(STORAGE_KEY_PREFIX, '');
        try {
          configs[roomId] = JSON.parse(localStorage.getItem(key));
        } catch (e) {
          console.error('Error al parsear configuración de room:', roomId, e);
        }
      }
    }
  } catch (e) {
    console.error('Error al obtener configuraciones:', e);
  }
  return configs;
}

// El token ya no se importa directamente - se usa Netlify Function como proxy en producción
// En desarrollo local, config.js puede tener el token, pero en producción no es necesario
// porque el token está seguro en el servidor (Netlify Function)

// Verificar que las páginas se cargaron correctamente
console.log('✅ Config.js cargado');
console.log('📄 Páginas importadas:', NOTION_PAGES?.length || 0);
if (NOTION_PAGES && NOTION_PAGES.length > 0) {
  console.log('📝 Nombres de páginas:', NOTION_PAGES.map(p => p.name));
  console.log('🔗 URLs:', NOTION_PAGES.map(p => p.url));
} else {
  console.warn('⚠️ No se encontraron páginas en config.js');
}

// Manejo de errores global para capturar problemas de carga
window.addEventListener('error', (event) => {
  console.error('Error global:', event.error);
  if (event.message && event.message.includes('fetch')) {
    console.error('Error de fetch detectado:', event.message);
  }
});

// Manejo de errores no capturados
window.addEventListener('unhandledrejection', (event) => {
  console.error('Promesa rechazada no manejada:', event.reason);
  if (event.reason && event.reason.message && event.reason.message.includes('fetch')) {
    console.error('Error de fetch en promesa rechazada:', event.reason);
  }
});

// Sistema de caché para bloques de Notion (persistente, sin expiración automática)
const CACHE_PREFIX = 'notion-blocks-cache-';

/**
 * Obtener bloques desde el caché (persistente, sin expiración)
 */
function getCachedBlocks(pageId) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      if (data.blocks) {
        console.log('✅ Bloques obtenidos del caché para:', pageId);
        return data.blocks;
      }
    }
  } catch (e) {
    console.error('Error al leer del caché:', e);
    // Si hay error al parsear, eliminar la entrada corrupta
    try {
      const cacheKey = CACHE_PREFIX + pageId;
      localStorage.removeItem(cacheKey);
    } catch (e2) {
      // Ignorar errores al limpiar
    }
  }
  return null;
}

/**
 * Guardar bloques en el caché (persistente, sin expiración)
 */
function setCachedBlocks(pageId, blocks) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const data = {
      blocks: blocks,
      savedAt: new Date().toISOString() // Solo para referencia, no para expiración
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    console.log('💾 Bloques guardados en caché para:', pageId);
  } catch (e) {
    console.error('Error al guardar en caché:', e);
    // Si el localStorage está lleno, informar al usuario
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ localStorage lleno. Considera limpiar el caché manualmente.');
    }
  }
}

/**
 * Limpiar todo el caché manualmente
 */
function clearAllCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('🗑️ Caché limpiado:', keysToRemove.length, 'entradas');
    return keysToRemove.length;
  } catch (e) {
    console.error('Error al limpiar caché:', e);
    return 0;
  }
}

// Función para extraer el ID de página desde una URL de Notion
function extractNotionPageId(url) {
  try {
    // Verificar si la URL es de Notion antes de procesarla
    if (!url || typeof url !== 'string') {
      return null;
    }
    
    // Verificar si es una URL de Notion
    const isNotionUrl = url.includes('notion.so') || url.includes('notion.site');
    if (!isNotionUrl) {
      // No es una URL de Notion, no generar warning
      return null;
    }
    
    // Formatos soportados:
    // 1. https://workspace.notion.site/Title-{32-char-id}?params
    // 2. https://www.notion.so/Title-{32-char-id}?params
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Buscar un ID de 32 caracteres hexadecimales en el pathname
    // Puede estar al final después de un guion, o ser el único elemento
    const idMatch = pathname.match(/-([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
    
    if (idMatch && idMatch[1]) {
      const pageId = idMatch[1];
      // Convertir a formato UUID con guiones: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
    }
    
    // Fallback: intentar extraer del último segmento después de dividir por guiones
    const pathParts = pathname.split('-');
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      // El ID tiene 32 caracteres hexadecimales
      if (lastPart && /^[a-f0-9]{32}$/i.test(lastPart)) {
        const pageId = lastPart.substring(0, 32);
        // Convertir a formato UUID con guiones
        return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
      }
    }
    
    // Solo loggear en modo debug si es una URL de Notion pero no se pudo extraer el ID
    log('⚠️ No se pudo extraer el ID de Notion de la URL:', url);
    return null;
  } catch (e) {
    // Solo loggear errores en modo debug
    log('Error al extraer ID de Notion:', e);
    return null;
  }
}

// Función para obtener la información de la página (last_edited_time e icono)
async function fetchPageInfo(pageId) {
  // Verificar que pageId sea válido antes de hacer la llamada
  if (!pageId || pageId === 'null' || pageId === 'undefined') {
    log('⚠️ fetchPageInfo: pageId inválido, saltando llamada a la API');
    return { lastEditedTime: null, icon: null };
  }
  
  try {
    // Obtener el roomId actual para usar el token del usuario
    let currentRoomId = null;
    try {
      currentRoomId = await OBR.room.getId();
    } catch (e) {
      currentRoomId = 'default';
    }
    
    const userToken = getUserToken();
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      // Usar proxy de Netlify Function para evitar CORS
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page&token=${encodeURIComponent(userToken)}`;
    } else {
      throw new Error('No hay token configurado. Configura tu token de Notion en la extensión (botón 🔑).');
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        lastEditedTime: data.last_edited_time || null,
        icon: data.icon || null
      };
    }
  } catch (e) {
    console.warn('No se pudo obtener información de la página:', e);
  }
  return { lastEditedTime: null, icon: null };
}

// Función para obtener la información de última edición de una página (compatibilidad)
async function fetchPageLastEditedTime(pageId) {
  const info = await fetchPageInfo(pageId);
  return info.lastEditedTime;
}

// Función para obtener el icono de una página
async function fetchPageIcon(pageId) {
  const info = await fetchPageInfo(pageId);
  return info.icon;
}

// Función para generar un color aleatorio basado en un string
function generateColorFromString(str) {
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

// Función para obtener la inicial de un texto
function getInitial(text) {
  if (!text || text.length === 0) return '?';
  // Obtener la primera letra (ignorar emojis y espacios)
  const match = text.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : text.charAt(0).toUpperCase();
}

// Función para renderizar el icono de una página
function renderPageIcon(icon, pageName, pageId) {
  if (icon) {
    if (icon.type === 'emoji') {
      // Icono emoji
      return `<span class="page-icon-emoji">${icon.emoji || '📄'}</span>`;
    } else if (icon.type === 'external' && icon.external) {
      // Icono externo (URL)
      return `<img src="${icon.external.url}" alt="${pageName}" class="page-icon-image" />`;
    } else if (icon.type === 'file' && icon.file) {
      // Icono de archivo
      return `<img src="${icon.file.url}" alt="${pageName}" class="page-icon-image" />`;
    }
  }
  
  // Fallback: círculo con color aleatorio e inicial
  const color = generateColorFromString(pageId || pageName);
  const initial = getInitial(pageName);
  return `<div class="page-icon-placeholder" style="background: ${color};">${initial}</div>`;
}

// Función para obtener bloques de una página de Notion (con caché persistente)
async function fetchNotionBlocks(pageId, useCache = true) {
  // Estado 2: Si tengo info en caché y se permite usar caché, devolverla sin pedir a la API
  if (useCache) {
    const cachedBlocks = getCachedBlocks(pageId);
    if (cachedBlocks && cachedBlocks.length > 0) {
      console.log('✅ Estado 2: Usando caché persistente para:', pageId, '-', cachedBlocks.length, 'bloques');
      return cachedBlocks;
    }
    console.log('⚠️ Estado 1: No hay caché para:', pageId, '- se pedirá a la API');
  } else {
    console.log('🔄 Estado 3: Recarga forzada - ignorando caché para:', pageId);
  }
  
  // Estado 1: No tengo info o recarga forzada → pedir a la API
  
  try {
    // Obtener el roomId actual para usar el token del usuario
    let currentRoomId = null;
    try {
      currentRoomId = await OBR.room.getId();
    } catch (e) {
      currentRoomId = 'default';
    }
    
    // Prioridad: 1) Token del usuario, 2) Token del servidor (Netlify Function), 3) Token local (dev)
    const userToken = getUserToken();
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      // Usuario tiene su propio token → usar proxy de Netlify Function para evitar CORS
      log('✅ Usando token del usuario para:', pageId);
      // Usar el proxy de Netlify Function y pasar el token como parámetro
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&token=${encodeURIComponent(userToken)}`;
    } else {
      // No hay token del usuario → mostrar error
      throw new Error('No hay token configurado. Ve a Configuración → Token de Notion (botón 🔑) para configurar tu token.');
    }
    
    log('🌐 Obteniendo bloques desde la API para:', pageId);
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 401) {
        throw new Error('Token inválido o sin permisos. Verifica que el token en config.js sea correcto y que la integración tenga acceso a esta página.');
      } else if (response.status === 404) {
        throw new Error('Página no encontrada. Verifica que la URL sea correcta y que la integración tenga acceso.');
      } else {
        throw new Error(`Error de API: ${response.status} - ${errorData.message || response.statusText}`);
      }
    }

    const data = await response.json();
    const blocks = data.results || [];
    
    // Log detallado de los bloques recibidos
    console.log('📦 Bloques recibidos de la API:', blocks.length);
    if (blocks.length > 0) {
      console.log('📋 Tipos de bloques encontrados:', blocks.map(b => b.type));
      // Log detallado de cada bloque
      blocks.forEach((block, index) => {
        console.log(`  [${index}] Tipo: ${block.type}`, {
          id: block.id,
          hasContent: !!block[block.type],
          content: block[block.type] ? Object.keys(block[block.type]) : []
        });
        // Si es una imagen, mostrar más detalles
        if (block.type === 'image') {
          console.log('    🖼️ Detalles de imagen:', {
            hasExternal: !!block.image?.external,
            hasFile: !!block.image?.file,
            externalUrl: block.image?.external?.url?.substring(0, 80),
            fileUrl: block.image?.file?.url?.substring(0, 80)
          });
        }
      });
    } else {
      console.warn('⚠️ No se obtuvieron bloques de la API para:', pageId);
    }
    
    // Estado 1: Guardar en caché persistente después de obtener exitosamente (sin expiración)
    if (blocks.length > 0) {
      setCachedBlocks(pageId, blocks);
      console.log('💾 Estado 1: Bloques guardados en caché persistente para:', pageId);
    }
    
    return blocks;
  } catch (error) {
    console.error('Error al obtener bloques de Notion:', error);
    throw error;
  }
}

// Función para renderizar texto con formato
function renderRichText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) return '';
  
  return richTextArray.map(text => {
    let content = text.plain_text || '';
    
    // Convertir saltos de línea a <br> antes de aplicar formatos
    // Esto asegura que los <br> queden dentro de los tags de formato
    content = content.replace(/\n/g, '<br>');
    
    if (text.annotations) {
      if (text.annotations.bold) content = `<strong class="notion-text-bold">${content}</strong>`;
      if (text.annotations.italic) content = `<em class="notion-text-italic">${content}</em>`;
      if (text.annotations.underline) content = `<u class="notion-text-underline">${content}</u>`;
      if (text.annotations.strikethrough) content = `<s class="notion-text-strikethrough">${content}</s>`;
      if (text.annotations.code) content = `<code class="notion-text-code">${content}</code>`;
      
      if (text.href) {
        content = `<a href="${text.href}" class="notion-text-link" target="_blank" rel="noopener noreferrer">${content}</a>`;
      }
    }
    
    return content;
  }).join('');
}

// Función para renderizar un bloque individual
function renderBlock(block) {
  const type = block.type;
  
  switch (type) {
    case 'paragraph':
      const paragraphText = renderRichText(block.paragraph?.rich_text);
      return `<p class="notion-paragraph">${paragraphText || '<br>'}</p>`;
    
    case 'heading_1':
      // Los headings pueden tener hijos (contenido anidado debajo del heading)
      // Se manejan en renderBlocks de forma especial si tienen hijos
      return `<h1>${renderRichText(block.heading_1?.rich_text)}</h1>`;
    
    case 'heading_2':
      // Los headings pueden tener hijos (contenido anidado debajo del heading)
      // Se manejan en renderBlocks de forma especial si tienen hijos
      return `<h2>${renderRichText(block.heading_2?.rich_text)}</h2>`;
    
    case 'heading_3':
      // Los headings pueden tener hijos (contenido anidado debajo del heading)
      // Se manejan en renderBlocks de forma especial si tienen hijos
      return `<h3>${renderRichText(block.heading_3?.rich_text)}</h3>`;
    
    case 'bulleted_list_item':
      return `<li class="notion-bulleted-list-item">${renderRichText(block.bulleted_list_item?.rich_text)}</li>`;
    
    case 'numbered_list_item':
      return `<li class="notion-numbered-list-item">${renderRichText(block.numbered_list_item?.rich_text)}</li>`;
    
    case 'image':
      const image = block.image;
      let imageUrl = null;
      let imageType = null;
      
      // Prioridad: external.url (URLs externas) o file.url (archivos de Notion)
      if (image?.external?.url) {
        imageUrl = image.external.url;
        imageType = 'external';
      } else if (image?.file?.url) {
        imageUrl = image.file.url;
        imageType = 'file';
        // Las URLs de file pueden tener expiry_time, pero normalmente son accesibles directamente
        // Si la URL expira, Notion devuelve un error 403/404 y necesitamos refrescar
      }
      
      const caption = image?.caption ? renderRichText(image.caption) : '';
      
      if (imageUrl) {
        // Generar ID único para la imagen
        const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Log para debugging
        console.log('🖼️ Renderizando imagen:', {
          type: imageType,
          url: imageUrl.substring(0, 80) + (imageUrl.length > 80 ? '...' : ''),
          hasCaption: !!caption,
          expiryTime: image?.file?.expiry_time || null
        });
        
        // Las imágenes de Notion deberían ser accesibles directamente
        // Si fallan, mostrar un mensaje de error con opción de refrescar
        return `
          <div class="notion-image" data-block-id="${block.id}">
            <img 
              src="${imageUrl}" 
              alt="${caption || 'Imagen de Notion'}" 
              class="notion-image-clickable" 
              data-image-id="${imageId}" 
              data-image-url="${imageUrl}" 
              data-image-caption="${caption.replace(/"/g, '&quot;')}"
              data-block-id="${block.id}"
              loading="lazy"
            />
            ${caption ? `<div class="notion-image-caption">${caption}</div>` : ''}
          </div>
        `;
      } else {
        console.warn('⚠️ Bloque de imagen sin URL válida:', {
          blockId: block.id,
          hasExternal: !!image?.external,
          hasFile: !!image?.file,
          image: image
        });
        return '<div class="notion-image-unavailable">[Imagen no disponible]</div>';
      }
    
    case 'divider':
      return '<div class="notion-divider"></div>';
    
    case 'code':
      const codeText = renderRichText(block.code?.rich_text);
      const language = block.code?.language || '';
      return `<pre class="notion-code"><code>${codeText}</code></pre>`;
    
    case 'quote':
      return `<div class="notion-quote">${renderRichText(block.quote?.rich_text)}</div>`;
    
    case 'callout':
      const callout = block.callout;
      const icon = callout?.icon?.emoji || '💡';
      const calloutText = renderRichText(callout?.rich_text);
      return `
        <div class="notion-callout">
          <div class="notion-callout-icon">${icon}</div>
          <div class="notion-callout-content">${calloutText}</div>
        </div>
      `;
    
    case 'table':
      // Las tablas se renderizan de forma especial (ver renderBlocks)
      return '<div class="notion-table-container" data-table-id="' + block.id + '">Cargando tabla...</div>';
    
    case 'child_database':
      return '<div class="notion-database-placeholder">[Base de datos - Requiere implementación adicional]</div>';
    
    case 'column_list':
      // Columnas: se procesan en renderBlocks de forma especial
      // Este caso no debería ejecutarse nunca, pero lo dejamos por seguridad
      return '<div class="notion-column-list">[Columnas - Procesando...]</div>';
    
    case 'column':
      // Columnas individuales: se procesan en renderColumnList
      // Este caso no debería ejecutarse nunca, pero lo dejamos por seguridad
      return '<div class="notion-column">[Columna - Procesando...]</div>';
    
    case 'to_do':
      const todo = block.to_do;
      const todoText = renderRichText(todo?.rich_text);
      const checked = todo?.checked ? 'checked' : '';
      return `<div class="notion-todo"><input type="checkbox" ${checked} disabled> ${todoText}</div>`;
    
    case 'toggle':
      // Los toggles se renderizan de forma especial en renderBlocks (tienen hijos)
      // Este caso no debería ejecutarse nunca, pero lo dejamos por seguridad
      const toggle = block.toggle;
      const toggleText = renderRichText(toggle?.rich_text);
      return `<details class="notion-toggle"><summary>${toggleText}</summary><div class="notion-toggle-content" data-toggle-id="${block.id}">Cargando contenido...</div></details>`;
    
    default:
      console.warn('⚠️ Tipo de bloque no soportado:', type, {
        blockId: block.id,
        blockType: type,
        blockKeys: Object.keys(block)
      });
      return '';
  }
}

// Función para obtener bloques hijos de un bloque específico
async function fetchBlockChildren(blockId, useCache = true) {
  // Verificar caché primero
  if (useCache) {
    const cachedBlocks = getCachedBlocks(blockId);
    if (cachedBlocks && cachedBlocks.length > 0) {
      console.log('✅ Usando caché para hijos del bloque:', blockId);
      return cachedBlocks;
    }
  }
  
  try {
    // Obtener el roomId actual para usar el token del usuario
    let currentRoomId = null;
    try {
      currentRoomId = await OBR.room.getId();
    } catch (e) {
      currentRoomId = 'default';
    }
    
    const userToken = getUserToken();
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      // Usar proxy de Netlify Function para evitar CORS
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}&token=${encodeURIComponent(userToken)}`;
    } else {
      throw new Error('No hay token configurado. Configura tu token de Notion en la extensión (botón 🔑).');
    }
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });
    
    if (!response.ok) {
      throw new Error(`Error al obtener bloques hijos: ${response.status}`);
    }
    
    const data = await response.json();
    const children = data.results || [];
    
    // Guardar en caché
    if (children.length > 0) {
      setCachedBlocks(blockId, children);
    }
    
    return children;
  } catch (error) {
    console.error('Error al obtener bloques hijos:', error);
    return [];
  }
}

// Función para renderizar un toggle con su contenido
async function renderToggle(toggleBlock, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  const toggle = toggleBlock.toggle;
  const toggleText = renderRichText(toggle?.rich_text);
  
  console.log('🔽 Renderizando toggle:', toggleBlock.id, {
    hasChildren: toggleBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleBlock.has_children) {
    console.log('  📦 Obteniendo hijos del toggle...');
      const children = await fetchBlockChildren(toggleBlock.id, useCache);
    console.log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
      console.log(`  ✅ Contenido del toggle renderizado: ${toggleContent.length} caracteres`);
    } else {
      console.log(`  ⚠️ Toggle sin contenido`);
    }
  } else {
    console.log(`  ℹ️ Toggle sin hijos`);
  }
  
  // Si hay un filtro activo y el toggle no coincide con el tipo filtrado,
  // solo devolver el contenido de los hijos (sin el contenedor del toggle)
  if (blockTypes) {
    const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
    if (!typesArray.includes('toggle') && toggleContent.trim()) {
      // El toggle no coincide con el filtro, pero tiene contenido filtrado
      return toggleContent;
    }
  }
  
  return `
    <details class="notion-toggle">
      <summary class="notion-toggle-summary">${toggleText}</summary>
      <div class="notion-toggle-content">${toggleContent}</div>
    </details>
  `;
}

// Función para renderizar un toggle heading con su contenido
async function renderToggleHeading(toggleHeadingBlock, headingLevel, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  const toggleHeading = toggleHeadingBlock[`heading_${headingLevel}`] || toggleHeadingBlock.toggle;
  const headingText = renderRichText(toggleHeading?.rich_text);
  
  console.log(`🔽 Renderizando toggle_heading_${headingLevel}:`, toggleHeadingBlock.id, {
    hasChildren: toggleHeadingBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleHeadingBlock.has_children) {
    console.log(`  📦 Obteniendo hijos del toggle_heading_${headingLevel}...`);
      const children = await fetchBlockChildren(toggleHeadingBlock.id, useCache);
    console.log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      // Los hijos de un toggle heading deben tener un offset de nivel +1
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1, useCache);
      console.log(`  ✅ Contenido del toggle_heading_${headingLevel} renderizado: ${toggleContent.length} caracteres`);
    } else {
      console.log(`  ⚠️ Toggle heading sin contenido`);
    }
  } else {
    console.log(`  ℹ️ Toggle heading sin hijos`);
  }
  
  // Si hay un filtro activo y el toggle_heading no coincide con el tipo filtrado,
  // solo devolver el contenido de los hijos (sin el contenedor del toggle)
  if (blockTypes) {
    const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
    const toggleHeadingType = `toggle_heading_${headingLevel}`;
    if (!typesArray.includes(toggleHeadingType) && !typesArray.includes('heading_1') && !typesArray.includes('heading_2') && !typesArray.includes('heading_3') && toggleContent.trim()) {
      // El toggle heading no coincide con el filtro, pero tiene contenido filtrado
      return toggleContent;
    }
  }
  
  // Renderizar el heading dentro del summary (ajustar nivel con offset)
  const adjustedLevel = Math.min(headingLevel + headingLevelOffset, 6);
  const headingTag = `h${adjustedLevel}`;
  return `
    <details class="notion-toggle notion-toggle-heading">
      <summary class="notion-toggle-summary">
        <${headingTag} class="notion-toggle-heading-inline">${headingText}</${headingTag}>
      </summary>
      <div class="notion-toggle-content">${toggleContent}</div>
    </details>
  `;
}

// Función para renderizar todas las columnas de una column_list
async function renderColumnList(columnListBlock, allBlocks, currentIndex, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  console.log('📐 Renderizando column_list:', columnListBlock.id, {
    hasChildren: columnListBlock.has_children,
    currentIndex: currentIndex,
    totalBlocks: allBlocks.length
  });
  
  let columns = [];
  
  // Opción 1: Las columnas son hijos del column_list (más común)
  if (columnListBlock.has_children) {
    console.log('  📦 Obteniendo columnas como hijos del column_list...');
    const children = await fetchBlockChildren(columnListBlock.id, useCache);
    console.log(`  📦 Hijos obtenidos: ${children.length}`, children.map(c => c.type));
    columns = children.filter(block => block.type === 'column');
    console.log(`  📐 Columnas encontradas como hijos: ${columns.length}`);
  }
  
  // Opción 2: Las columnas son bloques hermanos que siguen al column_list
  if (columns.length === 0) {
    console.log('  🔍 Buscando columnas como bloques hermanos...');
    let index = currentIndex + 1;
    
    while (index < allBlocks.length) {
      const block = allBlocks[index];
      if (block.type === 'column') {
        columns.push(block);
        index++;
      } else {
        break;
      }
    }
    console.log(`  📐 Columnas encontradas como hermanos: ${columns.length}`);
  }
  
  if (columns.length === 0) {
    console.warn('  ⚠️ No se encontraron columnas para el column_list');
    return '<div class="notion-column-list">[Sin columnas]</div>';
  }
  
  console.log(`  ✅ Total de columnas encontradas: ${columns.length}`);
  
  // Renderizar cada columna con sus bloques hijos
  const columnHtmls = await Promise.all(columns.map(async (columnBlock, colIndex) => {
    let columnContent = '';
    
    console.log(`  📄 Procesando columna ${colIndex + 1}/${columns.length}:`, {
      id: columnBlock.id,
      hasChildren: columnBlock.has_children
    });
    
    if (columnBlock.has_children) {
      console.log(`    🔽 Obteniendo hijos de columna: ${columnBlock.id}`);
      const children = await fetchBlockChildren(columnBlock.id, useCache);
      console.log(`    🔽 Hijos obtenidos: ${children.length}`);
      if (children.length > 0) {
        columnContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
        console.log(`    ✅ Contenido de columna renderizado: ${columnContent.length} caracteres`);
      } else {
        console.log(`    ⚠️ Columna sin contenido`);
      }
    } else {
      console.log(`    ℹ️ Columna sin hijos`);
    }
    
    // Si hay un filtro activo y la columna no tiene contenido filtrado, no mostrar la columna
    if (blockTypes && !columnContent.trim()) {
      return '';
    }
    
    return `<div class="notion-column">${columnContent}</div>`;
  }));
  
  // Filtrar columnas vacías
  const validColumnHtmls = columnHtmls.filter(html => html.trim());
  
  // Si hay un filtro activo y no hay columnas con contenido, no mostrar el column_list
  if (blockTypes && validColumnHtmls.length === 0) {
    return '';
  }
  
  return `<div class="notion-column-list">${validColumnHtmls.join('')}</div>`;
}

// Función para renderizar todos los bloques
async function renderBlocks(blocks, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  let html = '';
  let inList = false;
  let listType = null;
  let listItems = [];
  
  console.log('🎨 Iniciando renderizado de', blocks.length, 'bloques', blockTypes ? `(filtro: ${Array.isArray(blockTypes) ? blockTypes.join(', ') : blockTypes})` : '');
  
  // Filtrar bloques por tipo si se especifica
  // IMPORTANTE: Si un bloque tiene hijos, NO lo filtramos aunque no coincida con el tipo,
  // porque sus hijos podrían ser del tipo filtrado
  let filteredBlocks = blocks;
  if (blockTypes) {
    const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
    // Mantener bloques que:
    // 1. Coinciden con el tipo filtrado, O
    // 2. Tienen hijos (para buscar recursivamente dentro de ellos)
    filteredBlocks = blocks.filter(block => {
      const matchesType = typesArray.includes(block.type);
      const hasChildren = block.has_children || false;
      return matchesType || hasChildren;
    });
    if (filteredBlocks.length !== blocks.length) {
      console.log(`  🔍 Filtrados: ${filteredBlocks.length} de ${blocks.length} bloques (manteniendo bloques con hijos para búsqueda recursiva)`);
    }
  }
  
  for (let index = 0; index < filteredBlocks.length; index++) {
    const block = filteredBlocks[index];
    const type = block.type;
    
    console.log(`  [${index}] Renderizando bloque:`, {
      type: type,
      id: block.id,
      hasChildren: block.has_children || false
    });
    
    // Manejar column_list de forma especial (debe procesarse antes que otros bloques)
    if (type === 'column_list') {
      try {
        const columnListHtml = await renderColumnList(block, filteredBlocks, index, blockTypes, headingLevelOffset, useCache);
        // Solo agregar al HTML si hay contenido (renderColumnList devuelve '' si no hay contenido filtrado)
        if (columnListHtml.trim()) {
          html += columnListHtml;
          // Saltar las columnas que ya procesamos
          let skipCount = 0;
          for (let j = index + 1; j < filteredBlocks.length; j++) {
            if (filteredBlocks[j].type === 'column') {
              skipCount++;
            } else {
              break;
            }
          }
          index += skipCount; // El for loop incrementará index después, así que esto está bien
          console.log(`    ✅ Column_list renderizado (${skipCount} columnas)`);
        } else {
          console.log(`    ⏭️ Column_list filtrado, sin contenido que mostrar`);
          // Saltar las columnas de todas formas
          let skipCount = 0;
          for (let j = index + 1; j < filteredBlocks.length; j++) {
            if (filteredBlocks[j].type === 'column') {
              skipCount++;
            } else {
              break;
            }
          }
          index += skipCount;
        }
        continue;
      } catch (error) {
        console.error('Error al renderizar column_list:', error);
        html += '<div class="notion-column-list">[Error al cargar columnas]</div>';
        continue;
      }
    }
    
    // Ignorar bloques column individuales (ya se procesaron en column_list)
    if (type === 'column') {
      console.log(`    ⏭️ Columna individual ignorada (ya procesada en column_list)`);
      continue;
    }
    
    // Manejar toggles de forma especial (tienen hijos que se cargan dinámicamente)
    if (type === 'toggle') {
      try {
        const toggleHtml = await renderToggle(block, blockTypes, headingLevelOffset, useCache);
        html += toggleHtml;
        console.log(`    ✅ Toggle renderizado`);
        continue;
      } catch (error) {
        console.error('Error al renderizar toggle:', error);
        // Fallback: renderizar sin contenido
        const toggle = block.toggle;
        const toggleText = renderRichText(toggle?.rich_text);
        html += `<details class="notion-toggle"><summary class="notion-toggle-summary">${toggleText}</summary><div class="notion-toggle-content">[Error al cargar contenido]</div></details>`;
        continue;
      }
    }
    
    // Manejar toggle headings de forma especial (tienen hijos que se cargan dinámicamente)
    if (type === 'toggle_heading_1' || type === 'toggle_heading_2' || type === 'toggle_heading_3') {
      try {
        const headingLevel = type === 'toggle_heading_1' ? 1 : type === 'toggle_heading_2' ? 2 : 3;
        const toggleHeadingHtml = await renderToggleHeading(block, headingLevel, blockTypes, headingLevelOffset, useCache);
        html += toggleHeadingHtml;
        console.log(`    ✅ Toggle heading ${headingLevel} renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar toggle_heading:`, error);
        // Fallback: renderizar sin contenido
        const headingLevel = type === 'toggle_heading_1' ? 1 : type === 'toggle_heading_2' ? 2 : 3;
        const adjustedLevel = Math.min(headingLevel + headingLevelOffset, 6);
        const headingTag = `h${adjustedLevel}`;
        const headingText = renderRichText(block[`heading_${headingLevel}`]?.rich_text || block.toggle?.rich_text);
        html += `<details class="notion-toggle"><summary class="notion-toggle-summary"><${headingTag} class="notion-toggle-heading-inline-error">${headingText}</${headingTag}></summary><div class="notion-toggle-content">[Error al cargar contenido]</div></details>`;
        continue;
      }
    }
    
    // Manejar headings normales que tienen hijos (contenido anidado)
    if ((type === 'heading_1' || type === 'heading_2' || type === 'heading_3') && block.has_children) {
      try {
        const baseHeadingLevel = type === 'heading_1' ? 1 : type === 'heading_2' ? 2 : 3;
        const headingLevel = Math.min(baseHeadingLevel + headingLevelOffset, 6); // Máximo h6
        const headingTag = `h${headingLevel}`;
        const headingText = renderRichText(block[`heading_${baseHeadingLevel}`]?.rich_text);
        
        console.log(`  📦 Obteniendo hijos del heading_${baseHeadingLevel} (renderizado como ${headingTag})...`);
        const children = await fetchBlockChildren(block.id, useCache);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          // Los hijos de un heading deben tener un offset de nivel +1
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1, useCache);
          console.log(`  ✅ Contenido del heading renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el heading debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const headingInFilter = typesArray.includes(type);
          
          if (!headingInFilter) {
            // El heading no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              console.log(`    ✅ Heading ${baseHeadingLevel} filtrado, solo mostrando hijos`);
            } else {
              console.log(`    ⏭️ Heading ${baseHeadingLevel} filtrado, sin contenido que mostrar`);
            }
            continue;
          } else {
            // El heading SÍ está en el filtro, pero si no tiene contenido filtrado, no mostrarlo
            if (!childrenContent.trim()) {
              console.log(`    ⏭️ Heading ${baseHeadingLevel} en filtro pero sin contenido filtrado en hijos`);
              continue;
            }
          }
        }
        
        html += `<${headingTag}>${headingText}</${headingTag}>${childrenContent}`;
        console.log(`    ✅ Heading ${baseHeadingLevel} (${headingTag}) con hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar heading con hijos:`, error);
        // Fallback: renderizar solo el heading sin hijos
        const headingLevel = type === 'heading_1' ? 1 : type === 'heading_2' ? 2 : 3;
        const headingTag = `h${headingLevel}`;
        const headingText = renderRichText(block[`heading_${headingLevel}`]?.rich_text);
        html += `<${headingTag}>${headingText}</${headingTag}>`;
        continue;
      }
    }
    
    // Manejar callouts que tienen hijos (contenido anidado)
    if (type === 'callout' && block.has_children) {
      try {
        const callout = block.callout;
        const icon = callout?.icon?.emoji || '💡';
        const calloutText = renderRichText(callout?.rich_text);
        
        console.log(`  📦 Obteniendo hijos del callout...`);
        const children = await fetchBlockChildren(block.id, useCache);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
          console.log(`  ✅ Contenido del callout renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el callout debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const calloutInFilter = typesArray.includes('callout');
          
          if (!calloutInFilter) {
            // El callout no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              console.log(`    ✅ Callout filtrado, solo mostrando hijos`);
            } else {
              console.log(`    ⏭️ Callout filtrado, sin contenido que mostrar`);
            }
            continue;
          } else {
            // El callout SÍ está en el filtro, pero si no tiene contenido filtrado en hijos, no mostrarlo
            if (!childrenContent.trim()) {
              console.log(`    ⏭️ Callout en filtro pero sin contenido filtrado en hijos`);
              continue;
            }
          }
        }
        
        // Renderizar el callout completo (solo llega aquí si pasa todas las verificaciones)
        html += `
          <div class="notion-callout">
            <div class="notion-callout-icon">${icon}</div>
            <div class="notion-callout-content">
              ${calloutText}
              ${childrenContent}
            </div>
          </div>
        `;
        console.log(`    ✅ Callout con hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar callout con hijos:`, error);
        // Fallback: renderizar solo el callout sin hijos, pero solo si está en el filtro
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes('callout')) {
            console.log(`    ⏭️ Callout filtrado (error en renderizado), no se muestra`);
            continue;
          }
        }
        const callout = block.callout;
        const icon = callout?.icon?.emoji || '💡';
        const calloutText = renderRichText(callout?.rich_text);
        html += `
          <div class="notion-callout">
            <div class="notion-callout-icon">${icon}</div>
            <div class="notion-callout-content">${calloutText}</div>
          </div>
        `;
        continue;
      }
    }
    
    // Manejar callouts sin hijos (deben ser filtrados si no coinciden con el filtro)
    if (type === 'callout' && !block.has_children) {
      if (blockTypes) {
        const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
        if (!typesArray.includes('callout')) {
          console.log(`    ⏭️ Callout sin hijos filtrado, no se muestra`);
          continue;
        }
      }
    }
    
    // Manejar quotes que tienen hijos (contenido anidado)
    if (type === 'quote' && block.has_children) {
      try {
        const quote = block.quote;
        const quoteText = renderRichText(quote?.rich_text);
        
        console.log(`  📦 Obteniendo hijos del quote...`);
        const children = await fetchBlockChildren(block.id, useCache);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
          console.log(`  ✅ Contenido del quote renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el quote debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const quoteInFilter = typesArray.includes('quote');
          
          if (!quoteInFilter) {
            // El quote no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              console.log(`    ✅ Quote filtrado, solo mostrando hijos`);
            } else {
              console.log(`    ⏭️ Quote filtrado, sin contenido válido en hijos`);
            }
            continue;
          } else {
            // El quote SÍ está en el filtro, pero si no tiene contenido, no mostrarlo
            if (!quoteText.trim() && !childrenContent.trim()) {
              console.log(`    ⏭️ Quote vacío filtrado, no se muestra`);
              continue;
            }
          }
        }
        
        html += `
          <div class="notion-quote">
            ${quoteText}
            ${childrenContent}
          </div>
        `;
        console.log(`    ✅ Quote con hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar quote con hijos:`, error);
        // Fallback: renderizar solo el quote sin hijos
        const quote = block.quote;
        const quoteText = renderRichText(quote?.rich_text);
        html += `<div class="notion-quote">${quoteText}</div>`;
        continue;
      }
    }
    
    // Manejar listas agrupadas
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      // Verificar si el bloque de lista coincide con el filtro
      if (blockTypes) {
        const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
        if (!typesArray.includes(type)) {
          console.log(`    ⏭️ Bloque de lista [${index}] de tipo ${type} filtrado, no se muestra`);
          continue;
        }
      }
      
      const currentListType = type === 'bulleted_list_item' ? 'ul' : 'ol';
      
      if (!inList || listType !== currentListType) {
        // Cerrar lista anterior si existe
        if (inList && listItems.length > 0) {
          html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
          listItems = [];
        }
        inList = true;
        listType = currentListType;
      }
      
      listItems.push(renderBlock(block));
    } else {
      // Cerrar lista si estábamos en una
      if (inList && listItems.length > 0) {
        html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
        listItems = [];
        inList = false;
        listType = null;
      }
      
      // Manejar tablas de forma especial
      if (block.type === 'table') {
        // Verificar si la tabla coincide con el filtro
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes('table')) {
            console.log(`    ⏭️ Tabla filtrada, no se muestra`);
            continue;
          }
        }
        try {
          const tableHtml = await renderTable(block);
          html += tableHtml;
          console.log(`    ✅ Tabla [${index}] renderizada`);
        } catch (error) {
          console.error('Error al renderizar tabla:', error);
          html += '<div class="notion-table-placeholder">[Error al cargar tabla]</div>';
        }
      } else {
        // Verificar si el bloque coincide con el filtro antes de renderizar
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes(type)) {
            console.log(`    ⏭️ Bloque [${index}] de tipo ${type} filtrado (filtro: ${typesArray.join(', ')}), no se muestra`);
            continue;
          }
        }
        try {
          const rendered = renderBlock(block);
          if (rendered) {
            html += rendered;
            console.log(`    ✅ Bloque [${index}] renderizado (${rendered.length} caracteres)`);
          } else {
            console.log(`    ⚠️ Bloque [${index}] no devolvió HTML`);
          }
        } catch (error) {
          console.error(`❌ Error al renderizar bloque [${index}] de tipo ${type}:`, error);
          // Continuar con el siguiente bloque en lugar de detenerse
          html += `<div class="error-message">⚠️ Error al renderizar bloque: ${type}</div>`;
        }
      }
    }
  }
  
  // Cerrar lista si queda abierta
  if (inList && listItems.length > 0) {
    html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
  }
  
  console.log('✅ Renderizado completo. HTML generado:', html.length, 'caracteres');
  return html;
}

// Función para renderizar una tabla completa
async function renderTable(tableBlock) {
  try {
    // Obtener las filas de la tabla
    const rows = await fetchNotionBlocks(tableBlock.id);
    
    if (!rows || rows.length === 0) {
      return '<div class="notion-table-placeholder">[Tabla vacía]</div>';
    }
    
    // Obtener el número de columnas de la primera fila
    const firstRow = rows[0];
    const columnCount = firstRow?.table_row?.cells?.length || 0;
    
    if (columnCount === 0) {
      return '<div class="notion-table-placeholder">[Tabla sin columnas]</div>';
    }
    
    let tableHtml = '<table class="notion-table">';
    
    // Renderizar cada fila
    rows.forEach((rowBlock, rowIndex) => {
      if (rowBlock.type === 'table_row') {
        const cells = rowBlock.table_row?.cells || [];
        tableHtml += '<tr>';
        
        // Renderizar cada celda
        for (let i = 0; i < columnCount; i++) {
          const cell = cells[i] || [];
          const cellContent = renderRichText(cell);
          // La primera fila suele ser el encabezado
          const isHeader = rowIndex === 0;
          const tag = isHeader ? 'th' : 'td';
          tableHtml += `<${tag}>${cellContent || '&nbsp;'}</${tag}>`;
        }
        
        tableHtml += '</tr>';
      }
    });
    
    tableHtml += '</table>';
    return tableHtml;
  } catch (error) {
    console.error('Error al renderizar tabla:', error);
    return '<div class="notion-table-placeholder">[Error al cargar tabla: ' + error.message + ']</div>';
  }
}

// Función para mostrar imagen en modal usando Owlbear SDK
async function showImageModal(imageUrl, caption) {
  try {
    // Construir URL con parámetros
    const viewerUrl = new URL('html/image-viewer.html', window.location.origin);
    viewerUrl.searchParams.set('url', encodeURIComponent(imageUrl));
    if (caption) {
      viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
    }
    
    // Abrir modal usando Owlbear SDK (modal grande fuera del popup)
    await OBR.modal.open({
      id: 'notion-image-viewer',
      url: viewerUrl.toString(),
      height: 800,
      width: 1200
    });
  } catch (error) {
    console.error('Error al abrir modal de Owlbear:', error);
    // Fallback: abrir en nueva ventana
    window.open(imageUrl, '_blank', 'noopener,noreferrer');
  }
}

// Función global para refrescar la página cuando una imagen falla
window.refreshImage = function(button) {
  const refreshButton = document.getElementById("refresh-page-button");
  if (refreshButton) {
    refreshButton.click();
  } else {
    // Si no hay botón de refresh, recargar la página completa
    location.reload();
  }
};

// Agregar event listeners a las imágenes después de renderizar
function attachImageClickHandlers() {
  const images = document.querySelectorAll('.notion-image-clickable');
  images.forEach(img => {
    // Click handler para abrir modal
    img.addEventListener('click', () => {
      const imageUrl = img.getAttribute('data-image-url');
      const caption = img.getAttribute('data-image-caption') || '';
      showImageModal(imageUrl, caption);
    });
    
    // Error handler para mostrar mensaje de error
    img.addEventListener('error', function() {
      this.style.display = 'none';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'notion-image-error';
      errorDiv.innerHTML = '⚠️ No se pudo cargar la imagen<br><small>La URL puede haber expirado</small><br><button class="notion-image-error-button">🔄 Recargar página</button>';
      
      // Agregar event listener al botón de recargar
      const refreshButton = errorDiv.querySelector('button');
      if (refreshButton) {
        refreshButton.addEventListener('click', () => {
          refreshImage(refreshButton);
        });
      }
      
      this.parentElement.appendChild(errorDiv);
    });
    
    // Load handler para logging
    img.addEventListener('load', function() {
      console.log('✅ Imagen cargada correctamente:', this.src.substring(0, 80));
    });
    
    // Efecto hover para indicar que es clicable
    img.style.transition = 'opacity 0.2s';
    img.addEventListener('mouseenter', () => {
      img.style.opacity = '0.9';
    });
    img.addEventListener('mouseleave', () => {
      img.style.opacity = '1';
    });
  });
}

// Función para cargar y renderizar contenido de Notion desde la API
async function loadNotionContent(url, container, forceRefresh = false, blockTypes = null) {
  const contentDiv = container.querySelector('#notion-content');
  
  if (!contentDiv) {
    console.error('No se encontró el contenedor de contenido');
    return;
  }
  
  // Ocultar iframe y mostrar contenido de Notion
  const iframe = container.querySelector('#notion-iframe');
  if (iframe) {
    iframe.style.display = 'none';
  }
  
  // Mostrar loading
  contentDiv.innerHTML = '<div class="notion-loading">Cargando contenido...</div>';
  contentDiv.style.display = 'block';
  container.classList.add('show-content');
  
  try {
    // Extraer ID de la página
    const pageId = extractNotionPageId(url);
    if (!pageId) {
      throw new Error('No se pudo extraer el ID de la página desde la URL');
    }
    
    console.log('Obteniendo bloques para página:', pageId, forceRefresh ? '(recarga forzada - sin caché)' : '(con caché)');
    
    // Obtener bloques (usar caché a menos que se fuerce la recarga)
    // Si forceRefresh es true, pasamos useCache = false para ignorar el caché
    const useCache = !forceRefresh;
    console.log('📋 Parámetros fetchNotionBlocks - useCache:', useCache, 'forceRefresh:', forceRefresh);
    const blocks = await fetchNotionBlocks(pageId, useCache);
    console.log('Bloques obtenidos:', blocks.length);
    
    if (blocks.length === 0) {
      contentDiv.innerHTML = '<div class="notion-loading">No se encontró contenido en esta página.</div>';
      return;
    }
    
    // Renderizar bloques (ahora es async)
    // El filtrado por blockTypes se hace dentro de renderBlocks para mantener bloques con hijos
    // Si es recarga forzada, no usar caché para los hijos
    const useCacheForChildren = !forceRefresh;
    const html = await renderBlocks(blocks, blockTypes, 0, useCacheForChildren);
    contentDiv.innerHTML = html;
    
    // Agregar event listeners a las imágenes para abrirlas en modal
    attachImageClickHandlers();
    
  } catch (error) {
    console.error('Error al cargar contenido de Notion:', error);
    contentDiv.innerHTML = `
      <div class="notion-error">
        <strong>Error al cargar el contenido:</strong><br>
        ${error.message}<br><br>
        <button onclick="window.open('${url}', '_blank')" class="notion-blocked-button-small">Abrir en Notion</button>
      </div>
    `;
  }
}

// Función para mostrar mensaje cuando Notion bloquea el iframe
function showNotionBlockedMessage(container, url) {
  container.innerHTML = `
    <div class="notion-blocked-message">
      <div class="notion-blocked-icon">🔒</div>
      <h2 class="notion-blocked-title">Notion bloquea el embedding</h2>
      <p class="notion-blocked-text">
        Notion no permite que sus páginas se carguen en iframes por razones de seguridad.<br>
        Puedes abrir la página en una nueva ventana para verla.
      </p>
      <button id="open-notion-window" class="notion-blocked-button">Abrir en nueva ventana</button>
    </div>
  `;
  
  const openButton = container.querySelector('#open-notion-window');
  if (openButton) {
    openButton.addEventListener('click', () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
}

// Intentar inicializar Owlbear con manejo de errores
console.log('🔄 Intentando inicializar Owlbear SDK...');

// Inicializar modo debug al cargar
initDebugMode();

try {
  OBR.onReady(async () => {
    try {
      console.log('✅ Owlbear SDK listo');
      console.log('🌐 URL actual:', window.location.href);
      console.log('🔗 Origen:', window.location.origin);
      
      // Obtener ID de la room actual
      let roomId = null;
      try {
        // Intentar obtener el ID de la room usando la propiedad directa
        roomId = OBR.room.id;
        console.log('🏠 Room ID obtenido (OBR.room.id):', roomId);
        console.log('🏠 Tipo de roomId:', typeof roomId);
        console.log('🏠 Longitud de roomId:', roomId ? roomId.length : 0);
        
        // Si no funciona, intentar con el método async
        if (!roomId) {
          console.log('🔄 Intentando con OBR.room.getId()...');
          roomId = await OBR.room.getId();
          console.log('🏠 Room ID obtenido (OBR.room.getId()):', roomId);
        }
      } catch (e) {
        console.warn('⚠️ No se pudo obtener el ID de la room:', e);
        // Intentar obtener desde el contexto o la URL
        try {
          const context = await OBR.context.getId();
          console.log('🏠 Context ID obtenido:', context);
          roomId = context;
        } catch (e2) {
          console.warn('⚠️ No se pudo obtener Context ID:', e2);
          // Intentar extraer de la URL
          const urlParams = new URLSearchParams(window.location.search);
          const obrref = urlParams.get('obrref');
          if (obrref) {
            console.log('🏠 Usando obrref de URL:', obrref);
            roomId = obrref;
          } else {
            console.warn('⚠️ No se encontró obrref en URL, usando "default"');
            roomId = 'default';
          }
        }
      }
      
      // Verificar que roomId no sea null o undefined
      if (!roomId) {
        console.warn('⚠️ roomId es null/undefined, usando "default"');
        roomId = 'default';
      }
      
      console.log('✅ Room ID final que se usará:', roomId);
      
      // Cargar configuración desde JSON (específica para esta room)
      log('🔍 Intentando cargar configuración para room:', roomId);
      
      // Declarar pagesConfig al inicio para que esté disponible en todo el scope
      let pagesConfig = null;
      
      // PRIORIDAD 1: Intentar cargar la configuración del roomId actual
      const currentRoomConfig = getPagesJSON(roomId);
      if (currentRoomConfig && currentRoomConfig.categories) {
        log('✅ Configuración encontrada para room:', roomId);
        pagesConfig = currentRoomConfig;
      }
      
      // PRIORIDAD 2: Si no hay configuración, crear una nueva por defecto
      if (!pagesConfig) {
        log('📝 No se encontró configuración para room:', roomId, ', creando una nueva por defecto');
        pagesConfig = await getDefaultJSON();
        savePagesJSON(pagesConfig, roomId);
        log('✅ Configuración por defecto creada para room:', roomId);
      }

      console.log('📊 Configuración cargada para room:', roomId);
      console.log('📊 Número de carpetas:', pagesConfig?.categories?.length || 0);
      
      const pageList = document.getElementById("page-list");
      const header = document.getElementById("header");

      if (!pageList || !header) {
        console.error('❌ No se encontraron los elementos necesarios');
        return;
      }

      // Agregar botones de administración
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      
      // Botón para configurar token de Notion
      const tokenButton = document.createElement("button");
      tokenButton.className = "icon-button";
      const keyIcon = document.createElement("img");
      keyIcon.src = "img/icon-json.svg";
      keyIcon.alt = "Configurar token";
      keyIcon.className = "icon-button-icon";
      tokenButton.appendChild(keyIcon);
      tokenButton.title = hasUserToken() ? "Token configurado - Clic para cambiar" : "Configurar token de Notion";
      tokenButton.addEventListener("click", () => showTokenConfig());
      
      // Botón para agregar (carpeta o página)
      const addButton = document.createElement("button");
      addButton.className = "icon-button";
      const addIcon = document.createElement("img");
      addIcon.src = "img/icon-add.svg";
      addIcon.alt = "Agregar";
      addIcon.className = "icon-button-icon";
      addButton.appendChild(addIcon);
      addButton.title = "Agregar carpeta o página";
      addButton.addEventListener("click", async (e) => {
        const rect = addButton.getBoundingClientRect();
        const menuItems = [
          { 
            icon: 'img/folder-close.svg', 
            text: 'Agregar carpeta', 
            action: async () => {
              await addCategoryToPageList([], roomId);
            }
          },
          { 
            icon: 'img/icon-page.svg', 
            text: 'Agregar página', 
            action: async () => {
              await addPageToPageListWithCategorySelector([], roomId);
            }
          }
        ];
        // Ajustar posición para mostrar el botón seleccionado (32px altura + 16px padding = 48px)
    createContextMenu(menuItems, { x: rect.right, y: rect.top + 48 });
      });
      
      buttonContainer.appendChild(tokenButton);
      buttonContainer.appendChild(addButton);
      header.appendChild(buttonContainer);

      // Renderizar páginas agrupadas por carpetas
      renderPagesByCategories(pagesConfig, pageList, roomId);
    } catch (error) {
      console.error('❌ Error dentro de OBR.onReady:', error);
      console.error('Stack:', error.stack);
      const pageList = document.getElementById("page-list");
      if (pageList) {
        pageList.innerHTML = `
          <div class="empty-state">
            <p>Error al cargar la extensión</p>
            <p>Verifica la consola para más detalles</p>
            <p class="error-text">${error.message || 'Error desconocido'}</p>
          </div>
        `;
      }
    }
  });
} catch (error) {
  console.error('❌ Error crítico al cargar el SDK de Owlbear:', error);
  console.error('Stack:', error.stack);
  const pageList = document.getElementById("page-list");
  if (pageList) {
    pageList.innerHTML = `
      <div class="empty-state">
        <p>Error crítico al cargar la extensión</p>
        <p>Verifica la consola para más detalles</p>
        <p style="font-size: 11px; margin-top: 8px; color: #888;">${error.message || 'Error desconocido'}</p>
      </div>
    `;
  }
}

// Función recursiva para renderizar una carpeta (puede tener subcarpetas)
function renderCategory(category, parentElement, level = 0, roomId = null, categoryPath = []) {
  // Verificar si la carpeta tiene contenido (páginas o subcarpetas)
  const hasPages = category.pages && category.pages.length > 0;
  const hasSubcategories = category.categories && category.categories.length > 0;
  
  // Filtrar páginas válidas (mantener el orden original)
  const categoryPages = hasPages ? category.pages
    .filter(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http')
    ) : [];
  
  // Renderizar la carpeta incluso si está vacía (para poder agregar contenido)
  // Solo no renderizar si no tiene nombre
  if (!category.name) return;
  
  // Calcular indentación basada en el nivel
  const indent = level * 16; // 16px por nivel
  
  // Crear contenedor de carpeta
  const categoryDiv = document.createElement('div');
  categoryDiv.className = 'category-group';
  categoryDiv.dataset.categoryName = category.name;
  categoryDiv.dataset.level = Math.min(level, 5);
  categoryDiv.dataset.categoryPath = JSON.stringify(categoryPath);
  
  // Contenedor del título con botón de colapsar
  const titleContainer = document.createElement('div');
  titleContainer.className = 'category-title-container';
  titleContainer.dataset.categoryPath = JSON.stringify(categoryPath);
  
  // Botón de colapsar/expandir
  const collapseButton = document.createElement('button');
  collapseButton.className = 'category-collapse-button';
  
  // Icono de colapsar (inicialmente cerrado/expandido)
  const collapseIcon = document.createElement('img');
  collapseIcon.className = 'category-collapse-icon';
  
  // Verificar estado guardado en localStorage (usar nombre completo con nivel para evitar conflictos)
  const collapseStateKey = `category-collapsed-${category.name}-level-${level}`;
  const isCollapsed = localStorage.getItem(collapseStateKey) === 'true';
  
  collapseIcon.src = isCollapsed ? 'img/folder-close.svg' : 'img/folder-open.svg';
  collapseIcon.alt = isCollapsed ? 'Expandir' : 'Colapsar';
  collapseButton.appendChild(collapseIcon);
  
  // Título de carpeta (anidamiento de heading según el nivel)
  const headingLevel = Math.min(level + 2, 6); // nivel 0 = h2, nivel 1 = h3, ..., máximo h6
  const categoryTitle = document.createElement(`h${headingLevel}`);
  categoryTitle.className = 'category-title';
  categoryTitle.textContent = category.name;
  
  // Botón de menú contextual para carpetas
  const contextMenuButton = document.createElement('button');
  contextMenuButton.className = 'category-context-menu-button icon-button';
  // Estilos movidos a CSS - solo opacity se controla dinámicamente
  const contextMenuIcon = document.createElement('img');
  contextMenuIcon.src = 'img/icon-contextualmenu.svg';
  contextMenuIcon.className = 'icon-button-icon';
  contextMenuButton.appendChild(contextMenuIcon);
  contextMenuButton.title = 'Menú';
  
  // Mostrar menú contextual al hover
  titleContainer.addEventListener('mouseenter', () => {
    contextMenuButton.style.opacity = '1';
  });
  titleContainer.addEventListener('mouseleave', (e) => {
    // No ocultar si el mouse está sobre el menú contextual o el menú está abierto
    if (!e.relatedTarget || (!e.relatedTarget.closest('.category-context-menu-button') && !e.relatedTarget.closest('#context-menu'))) {
      contextMenuButton.style.opacity = '0';
    }
  });
  
  // Menú contextual para carpetas
  contextMenuButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const rect = contextMenuButton.getBoundingClientRect();
    
    // Obtener información para determinar si se puede mover arriba/abajo
    const config = getPagesJSON(roomId) || await getDefaultJSON();
    const parentPath = categoryPath.slice(0, -2);
    const parent = navigateConfigPath(config, parentPath);
    const index = categoryPath[categoryPath.length - 1];
    const canMoveUp = index > 0;
    const canMoveDown = parent && parent.categories && index < parent.categories.length - 1;
    
    const menuItems = [
      { 
        icon: 'img/folder-close.svg', 
        text: 'Agregar carpeta', 
        action: async () => {
          await addCategoryToPageList(categoryPath, roomId);
        }
      },
      { 
        icon: 'img/icon-page.svg', 
        text: 'Agregar página', 
        action: async () => {
          // Pasar categoryPath para que se autocomplete en el modal
          await addPageToPageListWithCategorySelector(categoryPath, roomId);
        }
      },
      { separator: true },
      { 
        icon: 'img/icon-edit.svg', 
        text: 'Editar', 
        action: async () => {
          await editCategoryFromPageList(category, categoryPath, roomId);
        }
      },
      { separator: true },
    ];
    
    // Agregar opciones de mover si es posible
    if (canMoveUp || canMoveDown) {
      if (canMoveUp) {
        menuItems.push({
          icon: 'img/icon-arrow.svg',
          text: 'Mover arriba',
          action: async () => {
            await moveCategoryUp(category, categoryPath, roomId);
          }
        });
      }
      if (canMoveDown) {
        menuItems.push({
          icon: 'img/icon-arrow.svg',
          text: 'Mover abajo',
          action: async () => {
            await moveCategoryDown(category, categoryPath, roomId);
          }
        });
      }
      menuItems.push({ separator: true });
    }
    
    menuItems.push({
      icon: 'img/icon-trash.svg', 
      text: 'Eliminar', 
      action: async () => {
        await deleteCategoryFromPageList(category, categoryPath, roomId);
      }
    });
    
    // Ajustar posición para mostrar el botón seleccionado (32px altura + 16px padding = 48px)
    createContextMenu(menuItems, { x: rect.right, y: rect.top + 48 });
  });
  
  titleContainer.appendChild(collapseButton);
  titleContainer.appendChild(categoryTitle);
  titleContainer.appendChild(contextMenuButton);
  categoryDiv.appendChild(titleContainer);
  
  // Contenedor de contenido (páginas y subcarpetas)
  const contentContainer = document.createElement('div');
  contentContainer.className = 'category-content';
  // Mostrar el contenido si no está colapsado Y si tiene contenido o si está vacía (para poder agregar)
  const hasContent = hasSubcategories || categoryPages.length > 0;
  contentContainer.style.display = isCollapsed ? 'none' : 'block';
  
  // Renderizar subcarpetas primero (si existen)
  if (hasSubcategories) {
    category.categories.forEach((subcategory, index) => {
      const subcategoryPath = [...categoryPath, 'categories', index];
      renderCategory(subcategory, contentContainer, level + 1, roomId, subcategoryPath);
    });
  }
  
  // Contenedor de páginas de la carpeta
  // Siempre crear el contenedor si hay páginas válidas
  // O si la carpeta está completamente vacía (sin páginas ni subcarpetas)
  // Esto asegura que las carpetas vacías anidadas se muestren correctamente
  // PERO no crear el contenedor si solo tiene subcarpetas (sin páginas)
  if (categoryPages.length > 0 || (!hasPages && !hasSubcategories)) {
    const pagesContainer = document.createElement('div');
    pagesContainer.className = 'category-pages';
    
    const buttonsData = [];
    
    categoryPages.forEach((page, index) => {
      const pageId = extractNotionPageId(page.url);
      const isNotion = isNotionUrl(page.url);
      const isDndbeyondUrl = isDndbeyond(page.url);
      
      // Determinar icono de tipo de link
      let linkIconHtml = '';
      if (isNotion) {
        linkIconHtml = '<img src="img/icon-notion.svg" alt="Notion" class="page-link-icon">';
      } else if (isDndbeyondUrl) {
        linkIconHtml = '<img src="img/icon-dnd.svg" alt="D&D Beyond" class="page-link-icon">';
      } else {
        linkIconHtml = '<img src="img/icon-link.svg" alt="Link" class="page-link-icon">';
      }
      
      const button = document.createElement('button');
      button.className = 'page-button';
      button.dataset.url = page.url;
      button.dataset.selector = page.selector || '';
      button.dataset.pageIndex = index;
      button.dataset.categoryPath = JSON.stringify(categoryPath);
      button.className = 'page-button';
      // background y border son dinámicos (CSS_VARS) - se mantienen inline
      button.style.background = CSS_VARS.bg;
      button.style.border = `1px solid ${CSS_VARS.border}`;
      button.style.position = 'relative';
      
      // Placeholder para el icono (se cargará después)
      const placeholderColor = generateColorFromString(pageId || page.name);
      const placeholderInitial = (page.name || '?')[0].toUpperCase();
      
      // Botón de menú contextual para páginas
      const pageContextMenuButton = document.createElement('button');
      pageContextMenuButton.className = 'page-context-menu-button icon-button';
      // Estilos movidos a CSS - solo opacity se controla dinámicamente
      const pageContextMenuIcon = document.createElement('img');
      pageContextMenuIcon.src = 'img/icon-contextualmenu.svg';
      pageContextMenuIcon.className = 'icon-button-icon';
      pageContextMenuButton.appendChild(pageContextMenuIcon);
      pageContextMenuButton.title = 'Menú';
      
      // Mostrar menú contextual al hover
      button.addEventListener('mouseenter', () => {
        pageContextMenuButton.style.opacity = '1';
      });
      button.addEventListener('mouseleave', (e) => {
        // No ocultar si el mouse está sobre el menú contextual o el menú está abierto
        if (!e.relatedTarget || (!e.relatedTarget.closest('.page-context-menu-button') && !e.relatedTarget.closest('#context-menu'))) {
          pageContextMenuButton.style.opacity = '0';
        }
      });
      
      // Menú contextual para páginas
      pageContextMenuButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rect = pageContextMenuButton.getBoundingClientRect();
        const config = getPagesJSON(roomId) || await getDefaultJSON();
        // Obtener el path de la carpeta padre para agregar páginas en la misma carpeta
        const pageCategoryPath = categoryPath; // categoryPath viene del scope de renderCategory
        
        // Obtener información para determinar si se puede mover arriba/abajo
        const parent = navigateConfigPath(config, pageCategoryPath);
        const pageIndex = parent && parent.pages ? parent.pages.findIndex(p => p.name === page.name && p.url === page.url) : -1;
        const canMoveUp = pageIndex > 0;
        const canMoveDown = pageIndex !== -1 && parent && parent.pages && pageIndex < parent.pages.length - 1;
        
        const menuItems = [
          { 
            icon: 'img/icon-edit.svg', 
            text: 'Editar', 
            action: async () => {
              await editPageFromPageList(page, pageCategoryPath, roomId);
            }
          },
          { separator: true },
        ];
        
        // Agregar opciones de mover si es posible
        if (canMoveUp || canMoveDown) {
          if (canMoveUp) {
            menuItems.push({
              icon: 'img/icon-arrow.svg',
              text: 'Mover arriba',
              action: async () => {
                await movePageUp(page, pageCategoryPath, roomId);
              }
            });
          }
          if (canMoveDown) {
            menuItems.push({
              icon: 'img/icon-arrow.svg',
              text: 'Mover abajo',
              action: async () => {
                await movePageDown(page, pageCategoryPath, roomId);
              }
            });
          }
          menuItems.push({ separator: true });
        }
        
        menuItems.push({
          icon: 'img/icon-trash.svg', 
          text: 'Eliminar', 
          action: async () => {
            await deletePageFromPageList(page, pageCategoryPath, roomId);
          }
        });
        
        // Ajustar posición para mostrar el botón seleccionado (32px altura + 16px padding = 48px)
    createContextMenu(menuItems, { x: rect.right, y: rect.top + 48 });
      });
      
      button.innerHTML = `
        <div class="page-button-inner">
          <div class="page-icon-placeholder" style="background: ${placeholderColor};">${placeholderInitial}</div>
          <div class="page-name-text">${page.name}</div>
          ${linkIconHtml}
        </div>
      `;
      button.appendChild(pageContextMenuButton);
      
      // Hover effect
      button.addEventListener('mouseenter', () => {
        button.style.background = CSS_VARS.hover;
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = CSS_VARS.bg;
      });
      
      // Click handler (no ejecutar si se hace click en el menú contextual)
      button.addEventListener('click', async (e) => {
        // No abrir la página si se hace click en el menú contextual
        if (e.target.closest('.page-context-menu-button')) {
          return;
        }
        // Obtener blockTypes del objeto page si existe
        const blockTypes = page.blockTypes || null;
        await loadPageContent(page.url, page.name, page.selector || '', blockTypes);
      });
      
      pagesContainer.appendChild(button);
      
      buttonsData.push({ button, pageId, pageName: page.name, linkIconHtml, pageContextMenuButton });
    });
    
      // Cargar iconos en paralelo después de renderizar todos los botones
      if (buttonsData.length > 0) {
        Promise.all(buttonsData.map(async ({ button, pageId, pageName, linkIconHtml, pageContextMenuButton }) => {
          // Solo intentar cargar el icono si tenemos un pageId válido
          if (!pageId || pageId === 'null') {
            return; // Saltar si no hay pageId válido
          }
          try {
            const icon = await fetchPageIcon(pageId);
            const iconHtml = renderPageIcon(icon, pageName, pageId);
            // Guardar referencia al botón de menú contextual antes de actualizar HTML
            const menuButtonParent = pageContextMenuButton ? pageContextMenuButton.parentNode : null;
            
            button.innerHTML = `
              <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                ${iconHtml}
                <div class="page-name" style="flex: 1; text-align: left;">${pageName}</div>
                ${linkIconHtml}
              </div>
            `;
            
            // Re-agregar el botón de menú contextual después de actualizar el HTML
            // Asegurarse de que el botón se mantiene visible
            if (pageContextMenuButton && menuButtonParent === button) {
              button.appendChild(pageContextMenuButton);
              // Asegurar que el botón sea visible si el mouse está sobre el botón
              if (button.matches(':hover')) {
                pageContextMenuButton.style.opacity = '1';
              }
            }
          } catch (e) {
            console.warn('No se pudo obtener el icono para:', pageName, e);
          }
        })).catch(e => {
          console.error('Error al cargar iconos:', e);
        });
      }
    
      contentContainer.appendChild(pagesContainer);
  }
  
  // Manejar colapso/expansión
  // Solo permitir colapsar si tiene contenido
  // hasContent ya está declarado arriba
  if (hasContent) {
    titleContainer.addEventListener('click', (e) => {
      // No colapsar si se hace click en el menú contextual
      if (e.target.closest('.category-context-menu-button')) {
        return;
      }
      const newIsCollapsed = contentContainer.style.display === 'none';
      
      // Aplicar animación suave
      if (newIsCollapsed) {
        // Abrir
        contentContainer.style.display = 'block';
        contentContainer.style.maxHeight = '0';
        contentContainer.style.overflow = 'hidden';
        contentContainer.style.transition = 'max-height 0.3s ease-out, opacity 0.3s ease-out';
        contentContainer.style.opacity = '0';
        
        // Forzar reflow
        void contentContainer.offsetHeight;
        
        // Animar
        const scrollHeight = contentContainer.scrollHeight;
        contentContainer.style.maxHeight = scrollHeight + 'px';
        contentContainer.style.opacity = '1';
        
        collapseIcon.src = 'img/folder-open.svg';
        collapseIcon.alt = 'Colapsar';
        
        // Limpiar estilos después de la animación
        setTimeout(() => {
          contentContainer.style.maxHeight = '';
          contentContainer.style.overflow = '';
          contentContainer.style.transition = '';
          contentContainer.style.opacity = '';
        }, 300);
      } else {
        // Cerrar
        const scrollHeight = contentContainer.scrollHeight;
        contentContainer.style.maxHeight = scrollHeight + 'px';
        contentContainer.style.overflow = 'hidden';
        contentContainer.style.transition = 'max-height 0.3s ease-in, opacity 0.3s ease-in';
        contentContainer.style.opacity = '1';
        
        // Forzar reflow
        void contentContainer.offsetHeight;
        
        // Animar
        contentContainer.style.maxHeight = '0';
        contentContainer.style.opacity = '0';
        
        collapseIcon.src = 'img/folder-close.svg';
        collapseIcon.alt = 'Expandir';
        
        // Ocultar después de la animación
        setTimeout(() => {
          contentContainer.style.display = 'none';
          contentContainer.style.maxHeight = '';
          contentContainer.style.overflow = '';
          contentContainer.style.transition = '';
          contentContainer.style.opacity = '';
        }, 300);
      }
      
      localStorage.setItem(collapseStateKey, (!newIsCollapsed).toString());
    });
  } else {
    // Si no tiene contenido, mostrar la carpeta como abierta (sin funcionalidad de colapsar)
    collapseIcon.src = 'img/folder-open.svg';
    collapseIcon.alt = 'Carpeta vacía';
  }
  
  categoryDiv.appendChild(contentContainer);
  parentElement.appendChild(categoryDiv);
}

// Función para mover carpeta arriba
async function moveCategoryUp(category, categoryPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parentPath = categoryPath.slice(0, -2);
  const parent = navigateConfigPath(config, parentPath);
  
  if (!parent || !parent.categories) return;
  
  const index = categoryPath[categoryPath.length - 1];
  if (index === 0) return; // Ya está en la primera posición
  
  // Intercambiar con el anterior
  const temp = parent.categories[index];
  parent.categories[index] = parent.categories[index - 1];
  parent.categories[index - 1] = temp;
  
  savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    renderPagesByCategories(config, pageList, roomId);
  }
}

// Función para mover carpeta abajo
async function moveCategoryDown(category, categoryPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parentPath = categoryPath.slice(0, -2);
  const parent = navigateConfigPath(config, parentPath);
  
  if (!parent || !parent.categories) return;
  
  const index = categoryPath[categoryPath.length - 1];
  if (index >= parent.categories.length - 1) return; // Ya está en la última posición
  
  // Intercambiar con el siguiente
  const temp = parent.categories[index];
  parent.categories[index] = parent.categories[index + 1];
  parent.categories[index + 1] = temp;
  
  savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    renderPagesByCategories(config, pageList, roomId);
  }
}

// Función para mover página arriba
async function movePageUp(page, pageCategoryPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parent = navigateConfigPath(config, pageCategoryPath);
  
  if (!parent || !parent.pages) return;
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1 || pageIndex === 0) return; // No encontrada o ya está en la primera posición
  
  // Intercambiar con el anterior
  const temp = parent.pages[pageIndex];
  parent.pages[pageIndex] = parent.pages[pageIndex - 1];
  parent.pages[pageIndex - 1] = temp;
  
  savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    renderPagesByCategories(config, pageList, roomId);
  }
}

// Función para mover página abajo
async function movePageDown(page, pageCategoryPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parent = navigateConfigPath(config, pageCategoryPath);
  
  if (!parent || !parent.pages) return;
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1 || pageIndex >= parent.pages.length - 1) return; // No encontrada o ya está en la última posición
  
  // Intercambiar con el siguiente
  const temp = parent.pages[pageIndex];
  parent.pages[pageIndex] = parent.pages[pageIndex + 1];
  parent.pages[pageIndex + 1] = temp;
  
  savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    renderPagesByCategories(config, pageList, roomId);
  }
}

// Función auxiliar para navegar por el path en la configuración
function navigateConfigPath(config, path) {
  let target = config;
  for (let i = 0; i < path.length; i += 2) {
    const key = path[i];
    const index = path[i + 1];
    if (target[key] && target[key][index]) {
      target = target[key][index];
    } else {
      return null;
    }
  }
  return target;
}

// Función para agregar carpeta desde la vista de page-list
async function addCategoryToPageList(categoryPath, roomId) {
  const currentConfig = getPagesJSON(roomId) || await getDefaultJSON();
  
  showModalForm(
    'Agregar Carpeta',
    [
      { name: 'name', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre de la carpeta' }
    ],
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      const newCategory = { name: data.name, pages: [], categories: [] };
      
      if (categoryPath.length === 0) {
        // Agregar al nivel raíz
        if (!config.categories) config.categories = [];
        config.categories.push(newCategory); // Agregar al final
      } else {
        // Agregar dentro de una categoría
        const parent = navigateConfigPath(config, categoryPath);
        if (parent) {
          if (!parent.categories) parent.categories = [];
          parent.categories.push(newCategory); // Agregar al final
        }
      }
      
      savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para editar carpeta desde la vista de page-list
async function editCategoryFromPageList(category, categoryPath, roomId) {
  const currentConfig = getPagesJSON(roomId) || await getDefaultJSON();
  const categoryOptions = getCategoryOptions(currentConfig);
  
  // Obtener el path del padre (si existe)
  const parentPath = categoryPath.slice(0, -2);
  
  // Buscar el valor correcto del parentPath en las opciones disponibles
  let parentPathValue = '';
  if (parentPath.length > 0) {
    // Buscar en las opciones el path que coincida con el parentPath
    const matchingOption = categoryOptions.find(opt => {
      const optPath = JSON.parse(opt.value);
      return JSON.stringify(optPath) === JSON.stringify(parentPath);
    });
    if (matchingOption) {
      parentPathValue = matchingOption.value;
    } else {
      // Si no se encuentra, usar el parentPath directamente
      parentPathValue = JSON.stringify(parentPath);
    }
  }
  
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', required: true, value: category.name, placeholder: 'Nombre de la carpeta' }
  ];
  
  // Agregar selector de carpeta padre si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    fields.push({
      name: 'parentCategory',
      label: 'Carpeta padre',
      type: 'select',
      required: false,
      options: [
        { value: '', label: 'Raíz (sin carpeta padre)' },
        ...categoryOptions.filter(opt => {
          // Excluir la carpeta actual y sus hijos
          const optPath = JSON.parse(opt.value);
          // No permitir seleccionar la carpeta actual como padre
          if (JSON.stringify(optPath) === JSON.stringify(categoryPath)) {
            return false;
          }
          // No permitir seleccionar una carpeta que contiene a esta como padre
          // (evitar crear ciclos)
          if (categoryPath.length > 0 && optPath.length < categoryPath.length) {
            // Verificar si optPath es un prefijo de categoryPath
            const isPrefix = optPath.every((val, idx) => val === categoryPath[idx]);
            if (isPrefix) {
              return false;
            }
          }
          return true;
        })
      ],
      value: parentPathValue
    });
  }
  
  showModalForm(
    'Editar Carpeta',
    fields,
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      
      // Obtener la carpeta actual
      const key = categoryPath[categoryPath.length - 2];
      const index = categoryPath[categoryPath.length - 1];
      const parent = navigateConfigPath(config, parentPath);
      const currentCategory = parent && parent[key] ? parent[key][index] : null;
      
      if (!currentCategory) {
        alert('Error: No se pudo encontrar la carpeta a editar');
        return;
      }
      
      // Actualizar nombre
      currentCategory.name = data.name;
      
      // Si se cambió la carpeta padre, mover la carpeta
      if (data.parentCategory !== undefined) {
        if (data.parentCategory && data.parentCategory.trim() && data.parentCategory !== 'undefined') {
          try {
            const newParentPath = JSON.parse(data.parentCategory);
            
            // Verificar que el path es válido
            if (Array.isArray(newParentPath) && newParentPath.length > 0) {
              const newParent = navigateConfigPath(config, newParentPath);
              
              if (newParent && JSON.stringify(newParentPath) !== JSON.stringify(parentPath)) {
                // Remover de la ubicación actual
                parent[key].splice(index, 1);
                
                // Agregar a la nueva ubicación
                if (!newParent.categories) newParent.categories = [];
                newParent.categories.push(currentCategory);
              }
            }
          } catch (e) {
            console.error('Error al mover carpeta:', e);
            console.error('Valor de parentCategory:', data.parentCategory);
            alert('Error al cambiar la carpeta padre. La carpeta se actualizó pero permanece en su ubicación actual.');
          }
        } else if (data.parentCategory === '' && parentPath.length > 0) {
          // Mover a raíz
          parent[key].splice(index, 1);
          if (!config.categories) config.categories = [];
          config.categories.push(currentCategory);
        }
      }
      
      savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para editar página desde la vista de page-list
async function editPageFromPageList(page, pageCategoryPath, roomId) {
  const currentConfig = getPagesJSON(roomId) || await getDefaultJSON();
  const categoryOptions = getCategoryOptions(currentConfig);
  
  const pageCategoryPathValue = pageCategoryPath.length > 0 ? JSON.stringify(pageCategoryPath) : '';
  
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', required: true, value: page.name, placeholder: 'Nombre de la página' },
    { name: 'url', label: 'URL', type: 'url', required: true, value: page.url, placeholder: 'https://...' }
  ];
  
  // Agregar selector de carpeta si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    const defaultValue = pageCategoryPathValue || categoryOptions[0].value;
    fields.push({
      name: 'category',
      label: 'Carpeta',
      type: 'select',
      required: true,
      options: categoryOptions,
      value: defaultValue
    });
  }
  
  fields.push(
    { name: 'selector', label: 'Selector (opcional)', type: 'text', value: page.selector || '', placeholder: '#main-content', help: 'Solo para URLs externas' },
    { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' }
  );
  
  showModalForm(
    'Editar Página',
    fields,
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      
      // Encontrar la página actual
      const parent = navigateConfigPath(config, pageCategoryPath);
      if (!parent || !parent.pages) {
        alert('Error: No se pudo encontrar la página a editar');
        return;
      }
      
      const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
      if (pageIndex === -1) {
        alert('Error: No se pudo encontrar la página a editar');
        return;
      }
      
      const currentPage = parent.pages[pageIndex];
      
      // Actualizar datos
      currentPage.name = data.name;
      currentPage.url = data.url;
      if (data.selector) {
        currentPage.selector = data.selector;
      } else {
        delete currentPage.selector;
      }
      if (data.blockTypes) {
        currentPage.blockTypes = data.blockTypes.includes(',') 
          ? data.blockTypes.split(',').map(s => s.trim())
          : data.blockTypes.trim();
      } else {
        delete currentPage.blockTypes;
      }
      
      // Si se cambió la carpeta, mover la página
      if (data.category && data.category.trim() && data.category !== 'undefined') {
        try {
          const newCategoryPath = JSON.parse(data.category);
          
          // Verificar que el path es válido
          if (Array.isArray(newCategoryPath) && newCategoryPath.length > 0) {
            const newParent = navigateConfigPath(config, newCategoryPath);
            
            if (newParent && JSON.stringify(newCategoryPath) !== JSON.stringify(pageCategoryPath)) {
              // Remover de la ubicación actual
              parent.pages.splice(pageIndex, 1);
              
              // Agregar a la nueva ubicación
              if (!newParent.pages) newParent.pages = [];
              newParent.pages.push(currentPage);
            }
          }
        } catch (e) {
          console.error('Error al mover página:', e);
          console.error('Valor de category:', data.category);
          alert('Error al cambiar la carpeta. La página se actualizó pero permanece en su carpeta actual.');
        }
      }
      
      savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para eliminar carpeta desde la vista de page-list
async function deleteCategoryFromPageList(category, categoryPath, roomId) {
  try {
    // Asegurarse de que categoryPath sea un array
    let path = categoryPath;
    if (typeof categoryPath === 'string') {
      try {
        path = JSON.parse(categoryPath);
      } catch (e) {
        console.error('Error al parsear categoryPath:', e);
        alert('Error: Path de carpeta inválido');
        return false;
      }
    }
    if (!Array.isArray(path)) {
      console.error('categoryPath no es un array:', path);
      alert('Error: Path de carpeta inválido');
      return false;
    }
    
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    if (path.length === 0) {
      // Si el path está vacío (no debería pasar, pero por si acaso)
      const index = config.categories.findIndex(cat => cat.name === category.name);
      if (index !== -1) {
        config.categories.splice(index, 1);
      } else {
        console.error('No se encontró la carpeta en el nivel raíz');
        alert('Error: No se pudo encontrar la carpeta a eliminar');
        return false;
      }
    } else if (path.length === 2) {
      // Eliminar del nivel raíz (path es ['categories', index])
      const key = path[0];
      const index = parseInt(path[1]);
      if (config[key] && config[key][index] !== undefined) {
        config[key].splice(index, 1);
      } else {
        console.error('No se encontró la carpeta en el nivel raíz:', key, index);
        alert('Error: No se pudo encontrar la carpeta a eliminar');
        return false;
      }
    } else {
      // Eliminar de una carpeta padre (path tiene más de 2 elementos)
      const key = path[path.length - 2];
      const index = parseInt(path[path.length - 1]);
      const parentPath = path.slice(0, -2);
      const parent = navigateConfigPath(config, parentPath);
      if (parent && parent[key] && parent[key][index] !== undefined) {
        parent[key].splice(index, 1);
      } else {
        console.error('No se encontró la carpeta en el path:', path);
        alert('Error: No se pudo encontrar la carpeta a eliminar');
        return false;
      }
    }
    
    savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al eliminar carpeta:', error);
    alert('Error al eliminar la carpeta: ' + error.message);
    return false;
  }
}

// Función para eliminar página desde la vista de page-list
async function deletePageFromPageList(page, pageCategoryPath, roomId) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    // Encontrar la página actual
    const parent = navigateConfigPath(config, pageCategoryPath);
    if (!parent || !parent.pages) {
      console.error('No se encontró el parent o pages en:', pageCategoryPath);
      alert('Error: No se pudo encontrar la página a eliminar');
      return false;
    }
    
    const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
    if (pageIndex === -1) {
      console.error('No se encontró la página:', page.name, page.url);
      alert('Error: No se pudo encontrar la página a eliminar');
      return false;
    }
    
    parent.pages.splice(pageIndex, 1);
    
    savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al eliminar página:', error);
    alert('Error al eliminar la página: ' + error.message);
    return false;
  }
}

// Función auxiliar para obtener todas las carpetas como opciones
function getCategoryOptions(config, currentPath = [], level = 0) {
  const options = [];
  if (!config.categories) return options;
  
  config.categories.forEach((category, index) => {
    const categoryPath = ['categories', index];
    const fullPath = [...currentPath, ...categoryPath];
    const indent = '  '.repeat(level);
    options.push({
      value: JSON.stringify(fullPath),
      label: `${indent}${category.name}`
    });
    
    // Agregar subcarpetas recursivamente
    if (category.categories && category.categories.length > 0) {
      const subOptions = getCategoryOptions({ categories: category.categories }, fullPath, level + 1);
      options.push(...subOptions);
    }
  });
  
  return options;
}

// Función para agregar página desde la vista de page-list con selector de carpeta
async function addPageToPageListWithCategorySelector(defaultCategoryPath, roomId) {
  const currentConfig = getPagesJSON(roomId) || await getDefaultJSON();
  const categoryOptions = getCategoryOptions(currentConfig);
  
  // Preparar campos del formulario
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre de la página' },
    { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' }
  ];
  
  // Agregar selector de carpeta si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    const defaultCategoryValue = defaultCategoryPath.length > 0 ? JSON.stringify(defaultCategoryPath) : categoryOptions[0].value;
    fields.push({
      name: 'category',
      label: 'Carpeta',
      type: 'select',
      required: true,
      options: categoryOptions,
      value: defaultCategoryValue
    });
  }
  
  fields.push(
    { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' },
    { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' }
  );
  
  showModalForm(
    'Agregar Página',
    fields,
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      const newPage = {
        name: data.name,
        url: data.url
      };
      if (data.selector) newPage.selector = data.selector;
      if (data.blockTypes) {
        newPage.blockTypes = data.blockTypes.includes(',') 
          ? data.blockTypes.split(',').map(s => s.trim())
          : data.blockTypes.trim();
      }
      
      // Determinar el path de la carpeta
      let targetCategoryPath = defaultCategoryPath;
      if (data.category && data.category.trim()) {
        try {
          targetCategoryPath = JSON.parse(data.category);
        } catch (e) {
          console.error('Error al parsear carpeta:', e);
          console.error('Valor recibido:', data.category);
        }
      }
      
      if (targetCategoryPath.length === 0) {
        // Si no hay carpetas, crear una
        if (!config.categories || config.categories.length === 0) {
          config.categories = [{ name: 'General', pages: [], categories: [] }];
        }
        if (!config.categories[0].pages) config.categories[0].pages = [];
        config.categories[0].pages.unshift(newPage); // Agregar al final
      } else {
        // Agregar dentro de la carpeta seleccionada
        const parent = navigateConfigPath(config, targetCategoryPath);
        if (parent) {
          if (!parent.pages) parent.pages = [];
          parent.pages.push(newPage); // Agregar al final
        }
      }
      
      savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para agregar página desde la vista de page-list
async function addPageToPageList(categoryPath, roomId) {
  // Si categoryPath está definido, usar la versión simple (sin selector)
  // Si no, usar la versión con selector
  if (categoryPath && categoryPath.length > 0) {
    await addPageToPageListSimple(categoryPath, roomId);
  } else {
    await addPageToPageListWithCategorySelector(categoryPath, roomId);
  }
}

// Función simple para agregar página en una carpeta específica (sin selector)
async function addPageToPageListSimple(categoryPath, roomId) {
  const currentConfig = getPagesJSON(roomId) || await getDefaultJSON();
  
  showModalForm(
    'Agregar Página',
    [
      { name: 'name', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre de la página' },
      { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
      { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' },
      { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' }
    ],
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      const newPage = {
        name: data.name,
        url: data.url
      };
      if (data.selector) newPage.selector = data.selector;
      if (data.blockTypes) {
        newPage.blockTypes = data.blockTypes.includes(',') 
          ? data.blockTypes.split(',').map(s => s.trim())
          : data.blockTypes.trim();
      }
      
      if (categoryPath.length === 0) {
        // Si no hay carpetas, crear una
        if (!config.categories || config.categories.length === 0) {
          config.categories = [{ name: 'General', pages: [], categories: [] }];
        }
        if (!config.categories[0].pages) config.categories[0].pages = [];
        config.categories[0].pages.unshift(newPage); // Agregar al final
      } else {
        // Agregar dentro de una categoría
        const parent = navigateConfigPath(config, categoryPath);
        if (parent) {
          if (!parent.pages) parent.pages = [];
          parent.pages.push(newPage); // Agregar al final
        }
      }
      
      savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para renderizar páginas agrupadas por carpetas
function renderPagesByCategories(pagesConfig, pageList, roomId = null) {
  // Mostrar loading
  pageList.innerHTML = '<div class="loading-state"><div class="loading-state-icon">⏳</div><div>Cargando páginas...</div></div>';
  
  // Usar setTimeout para permitir que el DOM se actualice con el loading
  setTimeout(() => {
    pageList.innerHTML = '';
    
    if (!pagesConfig || !pagesConfig.categories || pagesConfig.categories.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <p>No hay páginas configuradas</p>
        <button id="add-first-category" class="add-first-category-button">➕ Agregar primera carpeta</button>
      `;
      pageList.appendChild(emptyState);
      
      // Botón para agregar primera carpeta
      const addFirstCategoryBtn = emptyState.querySelector('#add-first-category');
      if (addFirstCategoryBtn) {
        addFirstCategoryBtn.addEventListener('click', async () => {
          await addCategoryToPageList([], roomId);
        });
        // Hover styles movidos a CSS con :hover
      }
      return;
    }
  
    // Mantener el orden original del JSON (sin ordenar)
    pagesConfig.categories.forEach((category, index) => {
      const categoryPath = ['categories', index];
      renderCategory(category, pageList, 0, roomId, categoryPath);
    });
  }, 0); // Permitir que el DOM se actualice
}

// Función para limpiar el caché de una página específica
function clearPageCache(url) {
  const pageId = extractNotionPageId(url);
  if (pageId) {
    const cacheKey = CACHE_PREFIX + pageId;
    localStorage.removeItem(cacheKey);
    console.log('🗑️ Caché limpiado para página:', pageId);
    return true;
  }
  return false;
}

// Función para detectar si una URL es de Notion
function isNotionUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const urlObj = new URL(url);
    // Verificar si es una URL de Notion
    const isNotion = urlObj.hostname.includes('notion.so') || urlObj.hostname.includes('notion.site');
    return isNotion;
  } catch (e) {
    // Si no es una URL válida, no es Notion
    return false;
  }
}

// Función para detectar si una URL es de D&D Beyond
function isDndbeyond(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const urlObj = new URL(url);
    // Verificar si es una URL de D&D Beyond
    const isDndbeyond = urlObj.hostname.includes('dndbeyond.com');
    return isDndbeyond;
  } catch (e) {
    // Si no es una URL válida, no es D&D Beyond
    return false;
  }
}

// Función para obtener el tipo de link y su icono correspondiente
// Preparado para añadir más tipos en el futuro
function getLinkType(url) {
  if (!url || typeof url !== 'string') {
    return { type: 'generic', icon: 'icon-link.svg' };
  }
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Detectar tipos de links
    if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
      return { type: 'notion', icon: 'icon-notion.svg' };
    }
    
    if (hostname.includes('dndbeyond.com')) {
      return { type: 'dndbeyond', icon: 'icon-dnd.svg' };
    }
    // if (hostname.includes('roll20.net')) {
    //   return { type: 'roll20', icon: 'icon-roll20.svg' };
    // }
    
    // Por defecto, link genérico
    return { type: 'generic', icon: 'icon-link.svg' };
  } catch (e) {
    return { type: 'generic', icon: 'icon-link.svg' };
  }
}

// Función para cargar contenido en iframe (para URLs no-Notion)
// Si se proporciona un selector, carga solo ese elemento
async function loadIframeContent(url, container, selector = null) {
  const iframe = container.querySelector('#notion-iframe');
  const contentDiv = container.querySelector('#notion-content');
  
  if (!iframe) {
    console.error('No se encontró el iframe');
    return;
  }
  
  // Ocultar el contenido de Notion
  if (contentDiv) {
    contentDiv.style.display = 'none';
  }
  container.classList.remove('show-content');
  
  // Si hay un selector, intentar cargar solo ese elemento
  if (selector) {
    try {
      console.log('📄 Cargando elemento específico:', selector, 'de:', url);
      
      // Obtener el HTML de la página (puede fallar por CORS)
      const response = await fetch(url, { 
        mode: 'cors',
        credentials: 'omit'
      });
      
      if (!response.ok) {
        throw new Error(`Error al cargar: ${response.status}`);
      }
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Buscar el elemento por selector (id o clase)
      const element = doc.querySelector(selector);
      
      if (!element) {
        throw new Error(`No se encontró el elemento con selector: ${selector}`);
      }
      
      // Obtener todos los estilos de la página original
      const styles = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
      const styleLinks = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
        .map(link => {
          const href = link.href;
          // Convertir URLs relativas a absolutas
          try {
            return new URL(href, url).href;
          } catch {
            return href;
          }
        })
        .map(href => `<link rel="stylesheet" href="${href}">`)
        .join('\n');
      
      // Crear un HTML completo con solo ese elemento y sus estilos
      const isolatedHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              padding: 16px;
              background: transparent;
            }
            ${styles}
          </style>
          ${styleLinks}
        </head>
        <body>
          ${element.outerHTML}
        </body>
        </html>
      `;
      
      // Crear un blob URL para el contenido aislado
      const blob = new Blob([isolatedHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      
      iframe.src = blobUrl;
      iframe.style.display = 'block';
      iframe.style.visibility = 'visible';
      
      // Limpiar el blob URL cuando el iframe se descargue
      iframe.addEventListener('load', () => {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }, { once: true });
      
    } catch (error) {
      console.warn('⚠️ No se pudo cargar elemento específico (posible CORS):', error.message);
      console.log('📄 Cargando URL completa como fallback:', url);
      // Fallback: cargar la URL completa
      iframe.src = url;
      iframe.style.display = 'block';
      iframe.style.visibility = 'visible';
    }
  } else {
    // Sin selector: cargar la URL completa
    console.log('📄 Cargando URL completa en iframe:', url);
    iframe.src = url;
    iframe.style.display = 'block';
    iframe.style.visibility = 'visible';
  }
}

// Función para cargar contenido de una página
async function loadPageContent(url, name, selector = null, blockTypes = null) {
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  const backButton = document.getElementById("back-button");
  const pageTitle = document.getElementById("page-title");
  const notionContent = document.getElementById("notion-content");
  const header = document.getElementById("header");
  
    if (pageList && notionContainer && backButton && pageTitle && notionContent && header) {
      pageList.classList.add("hidden");
      notionContainer.classList.remove("hidden");
      
      // Ocultar el button-container cuando se está en la vista de detalle
      const buttonContainer = document.querySelector('.button-container');
      if (buttonContainer) {
        buttonContainer.classList.add("hidden");
      }
    backButton.classList.remove("hidden");
    pageTitle.textContent = name;
    
    // Detectar si es una URL de Notion o una URL genérica
    if (isNotionUrl(url)) {
      // Es una URL de Notion → usar la API
      console.log('📝 URL de Notion detectada, usando API');
      if (blockTypes) {
        console.log('🔍 Filtro de tipos de bloques activado:', blockTypes);
      }
      
      // Agregar o actualizar botón de recargar (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
    if (!refreshButton) {
      refreshButton = document.createElement("button");
      refreshButton.id = "refresh-page-button";
      header.appendChild(refreshButton);
    }
    
    // Guardar la URL actual y blockTypes en el botón
    refreshButton.dataset.pageUrl = url;
    if (blockTypes) {
      refreshButton.dataset.blockTypes = JSON.stringify(blockTypes);
    } else {
      delete refreshButton.dataset.blockTypes;
    }
    
    // Limpiar contenido anterior
    refreshButton.innerHTML = "";
    const reloadIcon = document.createElement("img");
    reloadIcon.src = "img/icon-reload.svg";
    reloadIcon.alt = "Recargar contenido";
    reloadIcon.className = "icon-button-icon";
    refreshButton.appendChild(reloadIcon);
    refreshButton.title = "Recargar contenido";
    // Estilos movidos a CSS - solo background se controla dinámicamente en hover
    
    // Remover listeners anteriores si existen
    const newRefreshButton = refreshButton.cloneNode(true);
    refreshButton.parentNode.replaceChild(newRefreshButton, refreshButton);
    refreshButton = newRefreshButton;
    refreshButton.id = "refresh-page-button";
    refreshButton.dataset.pageUrl = url;
    if (blockTypes) {
      refreshButton.dataset.blockTypes = JSON.stringify(blockTypes);
    } else {
      delete refreshButton.dataset.blockTypes;
    }
    
      // Hover styles movidos a CSS con :hover y :active
      // Solo se mantiene el background dinámico si es necesario, pero CSS ya lo maneja
    
    refreshButton.addEventListener('click', async () => {
      // Obtener la URL actual del botón
      const currentUrl = refreshButton.dataset.pageUrl;
      if (!currentUrl) {
        console.error('No se encontró URL en el botón de recargar');
        return;
      }
      
      // Limpiar caché de esta página ANTES de recargar
      const pageId = extractNotionPageId(currentUrl);
      if (pageId) {
        const cacheKey = CACHE_PREFIX + pageId;
        localStorage.removeItem(cacheKey);
        console.log('🗑️ Caché limpiado para recarga:', pageId, 'clave:', cacheKey);
        // Verificar que se limpió correctamente
        const verifyCache = localStorage.getItem(cacheKey);
        if (verifyCache) {
          console.warn('⚠️ El caché todavía existe después de limpiarlo');
        } else {
          console.log('✅ Caché confirmado como limpiado');
        }
      } else {
        console.warn('No se pudo extraer pageId de la URL:', currentUrl);
      }
      
      refreshButton.disabled = true;
      // Reemplazar icono por el de reloj (loading)
      refreshButton.innerHTML = "";
      const clockIcon = document.createElement("img");
      clockIcon.src = "img/icon-clock.svg";
      clockIcon.alt = "Cargando...";
      clockIcon.style.cssText = "width: 20px; height: 20px; display: block;";
      refreshButton.appendChild(clockIcon);
      try {
        console.log('🔄 Llamando a loadNotionContent con forceRefresh = true');
        // Obtener blockTypes del botón si está disponible
        const blockTypes = refreshButton.dataset.blockTypes ? JSON.parse(refreshButton.dataset.blockTypes) : null;
        await loadNotionContent(currentUrl, notionContainer, true, blockTypes);
      } catch (e) {
        console.error('Error al recargar:', e);
      } finally {
        refreshButton.disabled = false;
        // Restaurar icono de reload
        refreshButton.innerHTML = "";
        const reloadIconRestore = document.createElement("img");
        reloadIconRestore.src = "img/icon-reload.svg";
        reloadIconRestore.alt = "Recargar contenido";
        reloadIconRestore.style.cssText = "width: 20px; height: 20px; display: block;";
        refreshButton.appendChild(reloadIconRestore);
      }
    });
    
      refreshButton.classList.remove("hidden");
      
      await loadNotionContent(url, notionContainer, false, blockTypes);
    } else {
      // No es una URL de Notion → cargar en iframe
      console.log('🌐 URL genérica detectada, usando iframe');
      
      // Ocultar botón de recargar si existe (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      // Cargar en iframe (con selector opcional)
      await loadIframeContent(url, notionContainer, selector);
    }
    
    if (!backButton.dataset.listenerAdded) {
      backButton.addEventListener("click", () => {
        pageList.classList.remove("hidden");
        notionContainer.classList.add("hidden");
        backButton.classList.add("hidden");
        pageTitle.textContent = "DM screen";
        notionContainer.classList.remove("show-content");
        if (notionContent) {
          notionContent.innerHTML = "";
        }
        // Limpiar iframe
        const iframe = notionContainer.querySelector('#notion-iframe');
        if (iframe) {
          iframe.src = '';
          iframe.style.display = 'none';
        }
        // Ocultar botón de recargar
        const refreshButton = document.getElementById("refresh-page-button");
        if (refreshButton) {
          refreshButton.classList.add("hidden");
        }
        // Mostrar el button-container cuando se vuelve a la vista principal
        const buttonContainer = document.querySelector('.button-container');
        if (buttonContainer) {
          buttonContainer.classList.remove("hidden");
        }
      });
      backButton.dataset.listenerAdded = "true";
    }
  }
}

// Función para mostrar configuración de token
async function showTokenConfig() {
  // Obtener roomId de forma segura
  let roomId = null;
  try {
    if (typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
      roomId = await OBR.room.getId();
    }
  } catch (e) {
    console.warn('No se pudo obtener roomId:', e);
  }
  const mainContainer = document.querySelector('.container');
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  
  if (mainContainer) mainContainer.classList.add('hidden');
  if (pageList) pageList.classList.add('hidden');
  if (notionContainer) notionContainer.classList.add('hidden');
  
  const currentToken = getUserToken() || '';
  const maskedToken = currentToken ? currentToken.substring(0, 8) + '...' + currentToken.substring(currentToken.length - 4) : '';
  
  const tokenContainer = document.createElement('div');
  tokenContainer.id = 'token-config-container';
  tokenContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${CSS_VARS.bgPrimary};
    z-index: 1000;
    display: flex;
    flex-direction: column;
    font-family: Roboto, Helvetica, Arial, sans-serif;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = `
    background: ${CSS_VARS.bgPrimary};
    border-bottom: 1px solid ${CSS_VARS.borderPrimary};
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="back-from-token" style="
        background: ${CSS_VARS.bgPrimary};
        border: 1px solid ${CSS_VARS.borderPrimary};
        border-radius: 6px;
        padding: 6px 12px;
        color: #e0e0e0;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      ">← Volver</button>
      <div>
        <h1 style="font-family: Roboto, Helvetica, Arial, sans-serif; color: #fff; font-size: 18px; line-height: 24px; font-weight: 700; margin: 0;">🔑 Configurar Token de Notion</h1>
      </div>
    </div>
  `;
  
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1;
    padding: 24px;
    overflow-y: auto;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
  `;
  
  contentArea.innerHTML = `
    <div style="margin-bottom: 24px;">
      <p style="color: #999; font-size: 14px; margin-bottom: 16px; line-height: 1.6;">
        Configura tu token de Notion para usar tus propias páginas. Este token es global para toda la extensión (todas las rooms).
      </p>
      
      <div style="background: ${CSS_VARS.bgPrimary}; border: 1px solid ${CSS_VARS.borderPrimary}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <h3 style="color: #fff; font-size: 14px; font-weight: 700; margin-bottom: 12px; font-family: Roboto, Helvetica, Arial, sans-serif;">📝 Cómo obtener tu token:</h3>
        <ol style="color: #ccc; font-size: 13px; line-height: 1.8; margin-left: 20px; padding-left: 0; font-family: Roboto, Helvetica, Arial, sans-serif; font-weight: 400;">
          <li>Ve a <a href="https://www.notion.so/my-integrations" target="_blank" style="color: #4a9eff; text-decoration: none;">notion.so/my-integrations</a></li>
          <li><strong>Crea una nueva integración:</strong>
            <ul style="margin-top: 8px; margin-left: 20px; padding-left: 0;">
              <li>Clic en <strong>"+ Nueva integración"</strong></li>
              <li>Dale un nombre (ej: "Owlbear Notion")</li>
              <li>Selecciona el workspace donde están tus páginas</li>
              <li>Clic en <strong>"Enviar"</strong></li>
            </ul>
          </li>
          <li><strong>Copia el token:</strong>
            <ul style="margin-top: 8px; margin-left: 20px; padding-left: 0;">
              <li>En la página de la integración, busca <strong>"Internal Integration Token"</strong></li>
              <li>Clic en <strong>"Mostrar"</strong> y copia el token completo</li>
            </ul>
          </li>
          <li><strong>Comparte tus páginas:</strong>
            <ul style="margin-top: 8px; margin-left: 20px; padding-left: 0;">
              <li>En Notion, abre cada página que quieres usar</li>
              <li>Clic en <strong>"Compartir"</strong> (arriba a la derecha)</li>
              <li>Busca el nombre de tu integración y dale acceso</li>
            </ul>
          </li>
          <li>Pega el token en el campo de abajo y guarda</li>
        </ol>
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display: block; color: #fff; font-size: 14px; font-weight: 400; margin-bottom: 8px; font-family: Roboto, Helvetica, Arial, sans-serif;">
          Token de Notion:
        </label>
        <input 
          type="password" 
          id="token-input" 
          placeholder="ntn_... o secret_..." 
          value="${currentToken}"
          style="
            width: 100%;
            padding: 12px;
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            color: #fff;
            font-size: 14px;
            font-family: monospace;
            box-sizing: border-box;
          "
        />
        ${currentToken ? `<p style="color: #888; font-size: 12px; margin-top: 8px; font-family: Roboto, Helvetica, Arial, sans-serif; font-weight: 400;">Token actual: ${maskedToken}</p>` : ''}
      </div>
      
      <div id="token-error" style="
        display: none;
        background: #4a2d2d;
        border: 1px solid #6a4040;
        border-radius: 6px;
        padding: 12px;
        color: #ff6b6b;
        font-size: 13px;
        margin-bottom: 16px;
      "></div>
      
      <div style="display: flex; flex-direction: column; gap: 12px; padding-top: 16px; border-top: 1px solid ${CSS_VARS.borderPrimary};">
        <div style="display: flex; gap: 12px;">
          <button id="view-json-btn" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: 10px 20px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
            font-weight: 400;
            font-family: Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.2s;
            flex: 1;
          ">Ver JSON</button>
          <button id="load-json-btn" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: 10px 20px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
            font-weight: 400;
            font-family: Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.2s;
            flex: 1;
          ">Cargar JSON</button>
          <button id="download-json-btn" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: 10px 20px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
            font-weight: 400;
            font-family: Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.2s;
            flex: 1;
          ">Descargar JSON</button>
        </div>
        <div style="display: flex; gap: 16px; justify-content: flex-end;">
          <button id="clear-token" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: 10px 20px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
            font-weight: 400;
            font-family: Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.2s;
            flex: 1;
          ">Eliminar Token</button>
          <button id="save-token" style="
            background: #4a9eff;
            border: none;
            border-radius: 6px;
            padding: 10px 20px;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            font-weight: 700;
            font-family: Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.2s;
            flex: 1;
          ">Guardar Token</button>
        </div>
      </div>
    </div>
  `;
  
  tokenContainer.appendChild(header);
  tokenContainer.appendChild(contentArea);
  document.body.appendChild(tokenContainer);
  
  const tokenInput = contentArea.querySelector('#token-input');
  const errorDiv = contentArea.querySelector('#token-error');
  const saveBtn = contentArea.querySelector('#save-token');
  const clearBtn = contentArea.querySelector('#clear-token');
  const viewJsonBtn = contentArea.querySelector('#view-json-btn');
  const loadJsonBtn = contentArea.querySelector('#load-json-btn');
  const downloadJsonBtn = contentArea.querySelector('#download-json-btn');
  const backBtn = header.querySelector('#back-from-token');
  
  // Estilos hover
  saveBtn.addEventListener('mouseenter', () => {
    saveBtn.style.background = '#5aaeff';
  });
  saveBtn.addEventListener('mouseleave', () => {
    saveBtn.style.background = '#4a9eff';
  });
  
  clearBtn.addEventListener('mouseenter', () => {
    clearBtn.style.background = CSS_VARS.bgHover;
    clearBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  clearBtn.addEventListener('mouseleave', () => {
    clearBtn.style.background = CSS_VARS.bgPrimary;
    clearBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  clearBtn.addEventListener('mousedown', () => {
    clearBtn.style.background = CSS_VARS.bgActive;
    clearBtn.style.borderColor = CSS_VARS.borderActive;
  });
  clearBtn.addEventListener('mouseup', () => {
    clearBtn.style.background = CSS_VARS.bgHover;
    clearBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  
  backBtn.addEventListener('mouseenter', () => {
    backBtn.style.background = CSS_VARS.bgHover;
    backBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  backBtn.addEventListener('mouseleave', () => {
    backBtn.style.background = CSS_VARS.bgPrimary;
    backBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  backBtn.addEventListener('mousedown', () => {
    backBtn.style.background = CSS_VARS.bgActive;
    backBtn.style.borderColor = CSS_VARS.borderActive;
  });
  backBtn.addEventListener('mouseup', () => {
    backBtn.style.background = CSS_VARS.bgHover;
    backBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  
  // Guardar token
  saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    
    if (!token) {
      errorDiv.textContent = 'Por favor, ingresa un token de Notion';
      errorDiv.style.display = 'block';
      return;
    }
    
    if (saveUserToken(token)) {
      errorDiv.style.display = 'none';
      alert('✅ Token guardado exitosamente. Ahora puedes usar tus propias páginas de Notion.');
      closeTokenConfig();
      // Actualizar el título del botón de token sin recargar la página
      const tokenButton = document.querySelector('.icon-button[title*="Token"]');
      if (tokenButton) {
        tokenButton.title = "Token configurado - Clic para cambiar";
      }
      // No recargar la página para preservar la configuración actual
    } else {
      errorDiv.textContent = 'Error al guardar el token. Revisa la consola para más detalles.';
      errorDiv.style.display = 'block';
    }
  });
  
  // Eliminar token
  clearBtn.addEventListener('click', () => {
    if (confirm('¿Eliminar el token? Volverás a usar el token del servidor (si está configurado).')) {
      if (saveUserToken('')) {
        alert('Token eliminado. Se usará el token del servidor.');
        closeTokenConfig();
        // Actualizar el título del botón de token sin recargar la página
        const tokenButton = document.querySelector('.icon-button[title*="Token"]');
        if (tokenButton) {
          tokenButton.title = "Configurar token de Notion";
        }
        // No recargar la página para preservar la configuración actual
      }
    }
  });
  
  // Cerrar
  const closeTokenConfig = () => {
    document.body.removeChild(tokenContainer);
    if (mainContainer) mainContainer.classList.remove('hidden');
    if (pageList) pageList.classList.remove('hidden');
  };
  
  backBtn.addEventListener('click', closeTokenConfig);
  
  // Ver JSON
  if (viewJsonBtn) {
    viewJsonBtn.addEventListener('mouseenter', () => {
      viewJsonBtn.style.background = CSS_VARS.bgHover;
      viewJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    viewJsonBtn.addEventListener('mouseleave', () => {
      viewJsonBtn.style.background = CSS_VARS.bgPrimary;
      viewJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    viewJsonBtn.addEventListener('mousedown', () => {
      viewJsonBtn.style.background = CSS_VARS.bgActive;
      viewJsonBtn.style.borderColor = CSS_VARS.borderActive;
    });
    viewJsonBtn.addEventListener('mouseup', () => {
      viewJsonBtn.style.background = CSS_VARS.bgHover;
      viewJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    viewJsonBtn.addEventListener('click', async () => {
      try {
        // Usar el roomId obtenido al inicio de la función, o intentar obtenerlo de nuevo
        let currentRoomId = roomId;
        if (!currentRoomId) {
          try {
            if (typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
              currentRoomId = await OBR.room.getId();
            }
          } catch (e) {
            console.warn('No se pudo obtener roomId:', e);
          }
        }
        const config = getPagesJSON(currentRoomId) || await getDefaultJSON();
        const jsonStr = JSON.stringify(config, null, 2);
        
        // Crear un modal para mostrar el JSON
        const jsonModal = document.createElement('div');
        jsonModal.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        `;
        
        const jsonContent = document.createElement('div');
        jsonContent.style.cssText = `
          background: #1a1a1a;
          border: 1px solid ${CSS_VARS.borderPrimary};
          border-radius: 8px;
          padding: 24px;
          max-width: 90%;
          max-height: 90vh;
          overflow: auto;
          position: relative;
        `;
        
        jsonContent.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 style="color: #fff; font-size: 18px; font-weight: 700; margin: 0; font-family: Roboto, Helvetica, Arial, sans-serif;">JSON de Configuración</h2>
            <button id="close-json-modal" style="
              background: ${CSS_VARS.bgPrimary};
              border: 1px solid ${CSS_VARS.borderPrimary};
              border-radius: 6px;
              padding: 6px 12px;
              color: #e0e0e0;
              cursor: pointer;
              font-size: 14px;
              font-family: Roboto, Helvetica, Arial, sans-serif;
            ">Cerrar</button>
          </div>
          <pre id="json-display" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: 16px;
            color: #e0e0e0;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.6;
            overflow-x: auto;
            white-space: pre;
            margin: 0;
          ">${jsonStr}</pre>
        `;
        
        jsonModal.appendChild(jsonContent);
        document.body.appendChild(jsonModal);
        
        const closeBtn = jsonContent.querySelector('#close-json-modal');
        const closeModal = () => {
          document.body.removeChild(jsonModal);
        };
        
        closeBtn.addEventListener('click', closeModal);
        jsonModal.addEventListener('click', (e) => {
          if (e.target === jsonModal) {
            closeModal();
          }
        });
      } catch (e) {
        console.error('Error al mostrar JSON:', e);
        alert('❌ Error al mostrar JSON: ' + e.message);
      }
    });
  }
  
  // Cargar JSON
  if (loadJsonBtn) {
    loadJsonBtn.addEventListener('mouseenter', () => {
      loadJsonBtn.style.background = CSS_VARS.bgHover;
      loadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    loadJsonBtn.addEventListener('mouseleave', () => {
      loadJsonBtn.style.background = CSS_VARS.bgPrimary;
      loadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    loadJsonBtn.addEventListener('mousedown', () => {
      loadJsonBtn.style.background = CSS_VARS.bgActive;
      loadJsonBtn.style.borderColor = CSS_VARS.borderActive;
    });
    loadJsonBtn.addEventListener('mouseup', () => {
      loadJsonBtn.style.background = CSS_VARS.bgHover;
      loadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    loadJsonBtn.addEventListener('click', async () => {
      try {
        // Crear input de archivo oculto
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          
          try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            
            // Validar estructura básica
            if (!parsed.categories || !Array.isArray(parsed.categories)) {
              alert('❌ El JSON debe tener un array "categories"');
              return;
            }
            
            // Usar el roomId obtenido al inicio de la función, o intentar obtenerlo de nuevo
            let currentRoomId = roomId;
            if (!currentRoomId) {
              try {
                if (typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
                  currentRoomId = await OBR.room.getId();
                }
              } catch (e) {
                console.warn('No se pudo obtener roomId:', e);
              }
            }
            
            // Guardar la nueva configuración
            if (savePagesJSON(parsed, currentRoomId)) {
              alert('✅ JSON cargado exitosamente. La configuración ha sido actualizada.');
              closeTokenConfig();
              
              // Actualizar la vista principal directamente sin recargar la página
              const pageList = document.getElementById("page-list");
              if (pageList) {
                renderPagesByCategories(parsed, pageList, currentRoomId);
              } else {
                // Si no se encuentra el pageList, recargar la página como fallback
                window.location.reload();
              }
            } else {
              alert('❌ Error al guardar el JSON. Revisa la consola para más detalles.');
            }
          } catch (e) {
            console.error('Error al cargar JSON:', e);
            alert('❌ Error al cargar JSON: ' + e.message);
          }
          
          // Limpiar el input
          document.body.removeChild(fileInput);
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
      } catch (e) {
        console.error('Error al cargar JSON:', e);
        alert('❌ Error al cargar JSON: ' + e.message);
      }
    });
  }
  
  // Descargar JSON
  if (downloadJsonBtn) {
    downloadJsonBtn.addEventListener('mouseenter', () => {
      downloadJsonBtn.style.background = CSS_VARS.bgHover;
      downloadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    downloadJsonBtn.addEventListener('mouseleave', () => {
      downloadJsonBtn.style.background = CSS_VARS.bgPrimary;
      downloadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    downloadJsonBtn.addEventListener('mousedown', () => {
      downloadJsonBtn.style.background = CSS_VARS.bgActive;
      downloadJsonBtn.style.borderColor = CSS_VARS.borderActive;
    });
    downloadJsonBtn.addEventListener('mouseup', () => {
      downloadJsonBtn.style.background = CSS_VARS.bgHover;
      downloadJsonBtn.style.borderColor = CSS_VARS.borderPrimary;
    });
    downloadJsonBtn.addEventListener('click', async () => {
      try {
        // Usar el roomId obtenido al inicio de la función, o intentar obtenerlo de nuevo
        let currentRoomId = roomId;
        if (!currentRoomId) {
          try {
            if (typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
              currentRoomId = await OBR.room.getId();
            }
          } catch (e) {
            console.warn('No se pudo obtener roomId:', e);
          }
        }
        const config = getPagesJSON(currentRoomId) || await getDefaultJSON();
        const jsonStr = JSON.stringify(config, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notion-pages-config-${currentRoomId ? getFriendlyRoomId(currentRoomId) : 'default'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('✅ JSON descargado exitosamente');
      } catch (e) {
        console.error('Error al descargar JSON:', e);
        alert('❌ Error al descargar JSON: ' + e.message);
      }
    });
  }
}

// ============================================
// EDITOR VISUAL TIPO NOTION
// ============================================

// Función para crear menú contextual estilo Owlbear
function createContextMenu(items, position, onClose) {
  // Remover menú existente si hay uno
  const existingMenu = document.getElementById('context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const menu = document.createElement('div');
  menu.id = 'context-menu';
  // left y top son dinámicos (position.x, position.y) - se mantienen inline
  menu.style.left = `${position.x}px`;
  menu.style.top = `${position.y}px`;

  // Cerrar al hacer click fuera
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      if (onClose) onClose();
    }
  };

  items.forEach((item, index) => {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      menu.appendChild(separator);
      return;
    }

    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    // Estilos movidos a CSS

    // Si el icon es una ruta de imagen, usar img, sino usar emoji/texto
    let iconHtml = '';
    if (item.icon && (item.icon.startsWith('img/') || item.icon.startsWith('/img/'))) {
      // Detectar si necesita rotación (para flechas arriba/abajo)
      let rotation = '';
      if (item.text === 'Mover arriba') {
        rotation = 'transform: rotate(90deg);';
      } else if (item.text === 'Mover abajo') {
        rotation = 'transform: rotate(-90deg);';
      }
      iconHtml = `<img src="${item.icon}" alt="" style="width: 16px; height: 16px; display: block; ${rotation}" />`;
    } else {
      iconHtml = `<span style="font-size: 16px; width: 20px; text-align: center;">${item.icon || ''}</span>`;
    }
    
    menuItem.innerHTML = `
      ${iconHtml}
      <span>${item.text}</span>
    `;

    // Hover styles movidos a CSS con :hover

    menuItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Cerrar el menú primero
      menu.remove();
      document.removeEventListener('click', closeMenu);
      if (onClose) onClose();
      // Ejecutar la acción después de cerrar el menú
      if (item.action) {
        try {
          await item.action();
        } catch (error) {
          console.error('Error ejecutando acción del menú:', error);
        }
      }
    });

    menu.appendChild(menuItem);
  });

  // Usar setTimeout para evitar que el click que abrió el menú lo cierre inmediatamente
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);

  document.body.appendChild(menu);

  // Ajustar posición si se sale de la pantalla
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${position.x - rect.width}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${position.y - rect.height}px`;
  }

  return menu;
}

// Función para mostrar formulario modal
function showModalForm(title, fields, onSubmit, onCancel) {
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: Roboto, Helvetica, Arial, sans-serif;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: rgba(30, 30, 30, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 24px;
    min-width: 400px;
    max-width: 500px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  `;

  modal.innerHTML = `
    <h2 class="modal-title">${title}</h2>
    <form id="modal-form" class="modal-form">
      ${fields.map(field => `
        <div class="modal-field">
          <label class="modal-label">
            ${field.label}${field.required ? ' *' : ''}
          </label>
          ${field.type === 'textarea' ? `
            <textarea 
              id="field-${field.name}" 
              name="${field.name}"
              class="modal-textarea"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
            >${field.value || ''}</textarea>
          ` : field.type === 'select' ? `
            <select 
              id="field-${field.name}" 
              name="${field.name}"
              class="modal-select"
              ${field.required ? 'required' : ''}
            >
              ${(field.options || []).map(opt => {
                // Escapar el valor para HTML (especialmente importante para JSON con corchetes y comillas)
                // Usar HTML entities para todos los caracteres especiales
                const optValue = String(opt.value)
                  .replace(/&/g, '&amp;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
                const fieldValue = String(field.value || '');
                const isSelected = fieldValue === String(opt.value);
                return `<option value="${optValue}" ${isSelected ? 'selected' : ''}>${opt.label}</option>`;
              }).join('')}
            </select>
          ` : `
            <input 
              type="${field.type || 'text'}" 
              id="field-${field.name}" 
              name="${field.name}"
              class="modal-input"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
              value="${field.value || ''}"
            />
          `}
          ${field.help ? `<div class="modal-help">${field.help}</div>` : ''}
        </div>
      `).join('')}
      <div class="modal-buttons">
        <button type="button" id="modal-cancel" class="modal-button modal-button-cancel">Cancelar</button>
        <button type="submit" id="modal-submit" class="modal-button modal-button-submit">Guardar</button>
      </div>
    </form>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const form = modal.querySelector('#modal-form');
  const cancelBtn = modal.querySelector('#modal-cancel');
  const submitBtn = modal.querySelector('#modal-submit');

  const close = () => {
    overlay.remove();
    // Asegurarse de que todos los menús contextuales estén cerrados
    const existingMenus = document.querySelectorAll('#context-menu');
    existingMenus.forEach(menu => menu.remove());
    // Restaurar opacidad de todos los botones de menú contextual
    document.querySelectorAll('.category-context-menu-button, .page-context-menu-button').forEach(btn => {
      btn.style.opacity = '0';
    });
    if (onCancel) onCancel();
  };

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = {};
    fields.forEach(field => {
      const input = modal.querySelector(`#field-${field.name}`);
      if (input) {
        // Para selects, obtener el valor directamente sin trim
        if (field.type === 'select') {
          const selectedIndex = input.selectedIndex;
          if (selectedIndex >= 0 && input.options[selectedIndex]) {
            // Obtener el valor del option seleccionado
            const selectedOption = input.options[selectedIndex];
            formData[field.name] = selectedOption.getAttribute('value') || selectedOption.value || '';
          } else {
            formData[field.name] = '';
          }
        } else {
          formData[field.name] = input.value.trim();
        }
      }
    });
    console.log('📝 Datos del formulario:', formData); // Debug
    if (onSubmit) onSubmit(formData);
    close();
  });

  // Focus en el primer campo (con manejo de errores para evitar conflictos con extensiones)
  const firstInput = modal.querySelector('input[type="text"], input[type="url"], textarea');
  if (firstInput) {
    setTimeout(() => {
      try {
        firstInput.focus();
      } catch (e) {
        // Ignorar errores de focus (pueden ser causados por extensiones del navegador)
        console.debug('No se pudo hacer focus en el campo:', e);
      }
    }, 100);
  }
}

// Función para mostrar el editor de JSON

// Función para mostrar el editor visual tipo Notion
async function showVisualEditor(pagesConfig, roomId = null) {
  const currentConfig = getPagesJSON(roomId) || pagesConfig || await getDefaultJSON();
  console.log('📖 Abriendo editor visual - Configuración cargada:', currentConfig);

  // Ocultar el contenedor principal
  const mainContainer = document.querySelector('.container');
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");

  if (mainContainer) mainContainer.classList.add('hidden');
  if (pageList) pageList.classList.add('hidden');
  if (notionContainer) notionContainer.classList.add('hidden');

  // Crear contenedor del editor
  const editorContainer = document.createElement('div');
  editorContainer.id = 'visual-editor-container';
  // Estilos movidos a CSS

  // Header
  const header = document.createElement('div');
  header.className = 'visual-editor-header';

  header.innerHTML = `
    <h1>Editor de Configuración</h1>
    <div class="visual-editor-header-buttons">
      <button id="editor-filter-btn" class="icon-button" title="Filtros">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6H20M7 12H17M10 18H14" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <button id="editor-add-btn" class="icon-button" title="Agregar">
        <img src="img/icon-add.svg" alt="Agregar" class="icon-button-icon" />
      </button>
    </div>
  `;

  // Área de contenido (sidebar tipo Notion)
  const contentArea = document.createElement('div');
  contentArea.id = 'visual-editor-content';
  // Estilos movidos a CSS

  // Función para renderizar items recursivamente
  const renderEditorItem = (item, parentElement, level = 0, path = [], isExpanded = false) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'editor-item';
    itemDiv.dataset.level = level;
    itemDiv.dataset.path = JSON.stringify(path);

    const indent = level * 20;
    const isCategory = item.pages !== undefined || item.categories !== undefined;
    const hasChildren = (item.pages && item.pages.length > 0) || (item.categories && item.categories.length > 0);

    itemDiv.className = 'editor-item';
    // margin-left se calcula dinámicamente según el nivel - NO se puede mover a CSS
    itemDiv.style.marginLeft = `${indent}px`;

    const itemRow = document.createElement('div');
    itemRow.className = 'editor-item-row';
    itemRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
      background: rgba(255, 255, 255, 0.02);
      margin-bottom: 2px;
    `;

    // Toggle para carpetas con hijos
    if (isCategory && hasChildren) {
      const toggle = document.createElement('button');
      toggle.className = 'editor-toggle';
      toggle.style.cssText = `
        background: transparent;
        border: none;
        color: #999;
        cursor: pointer;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s;
      `;
      const toggleIcon = document.createElement('img');
      toggleIcon.src = isExpanded ? 'img/folder-open.svg' : 'img/folder-close.svg';
      toggleIcon.style.width = '16px';
      toggleIcon.style.height = '16px';
      toggle.appendChild(toggleIcon);
      itemRow.appendChild(toggle);
    } else {
      const spacer = document.createElement('div');
      spacer.style.width = '16px';
      itemRow.appendChild(spacer);
    }

    // Icono - carpeta o círculo con inicial
    if (isCategory) {
      const folderIcon = document.createElement('img');
      folderIcon.src = (isExpanded && hasChildren) ? 'img/folder-open.svg' : 'img/folder-close.svg';
      folderIcon.style.width = '20px';
      folderIcon.style.height = '20px';
      itemRow.appendChild(folderIcon);
    } else {
      // Icono circular con inicial
      const circleIcon = document.createElement('div');
      const initial = item.name ? item.name.charAt(0).toUpperCase() : '?';
      circleIcon.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #4a4a4a;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 700;
        font-size: 12px;
        flex-shrink: 0;
      `;
      circleIcon.textContent = initial;
      itemRow.appendChild(circleIcon);
    }

    // Nombre
    const name = document.createElement('span');
    name.textContent = item.name;
    name.className = 'editor-item-name';
    // Estilos movidos a CSS
    itemRow.appendChild(name);

    // Icono a la derecha (Notion o ampersand)
    if (!isCategory) {
      const rightIcon = document.createElement('div');
      // Detectar si es URL de Notion
      const isNotionUrl = item.url && (item.url.includes('notion.so') || item.url.includes('notion.site'));
      if (isNotionUrl) {
        const notionIcon = document.createElement('div');
        notionIcon.style.cssText = `
          width: 20px;
          height: 20px;
          border-radius: 4px;
          background: #4a4a4a;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 700;
          font-size: 11px;
          flex-shrink: 0;
        `;
        notionIcon.textContent = 'N';
        rightIcon.appendChild(notionIcon);
      } else {
        const ampersandIcon = document.createElement('div');
        ampersandIcon.style.cssText = `
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          font-size: 16px;
          font-weight: 400;
          flex-shrink: 0;
        `;
        ampersandIcon.textContent = '&';
        rightIcon.appendChild(ampersandIcon);
      }
      itemRow.appendChild(rightIcon);
    }

    // Botón de menú contextual
    const menuBtn = document.createElement('button');
    menuBtn.className = 'editor-menu-btn';
    // Estilos movidos a CSS - solo opacity se controla dinámicamente en hover
    const menuIcon = document.createElement('img');
    menuIcon.src = 'img/icon-contextualmenu.svg';
    menuIcon.style.width = '16px';
    menuIcon.style.height = '16px';
    menuBtn.appendChild(menuIcon);

    // Hover styles movidos a CSS con :hover
    // Solo se mantiene el control dinámico de opacity si es necesario

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      const menuItems = [];

      if (isCategory) {
        menuItems.push(
          { icon: '➕', text: 'Agregar carpeta', action: () => addCategory(path) },
          { icon: '➕', text: 'Agregar página', action: () => addPage(path) },
          { separator: true },
          { icon: '✏️', text: 'Editar', action: () => editCategory(item, path) },
          { icon: '🗑️', text: 'Eliminar', action: () => deleteCategory(path) }
        );
      } else {
        menuItems.push(
          { icon: '✏️', text: 'Editar', action: () => editPage(item, path) },
          { icon: '🗑️', text: 'Eliminar', action: () => deletePage(path) }
        );
      }

      // Ajustar posición para mostrar el botón seleccionado (32px altura + 16px padding = 48px)
    createContextMenu(menuItems, { x: rect.right, y: rect.top + 48 });
    });

    itemRow.appendChild(menuBtn);
    itemDiv.appendChild(itemRow);

    // Contenedor de hijos (colapsable)
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'editor-children';
    childrenContainer.style.cssText = `
      display: ${isExpanded && hasChildren ? 'block' : 'none'};
      margin-left: 20px;
      margin-top: 2px;
    `;

    if (isCategory && hasChildren) {
      // Renderizar subcarpetas primero
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach((subcat, index) => {
          const newPath = path.length > 0 ? [...path, 'categories', index] : ['categories', index];
          renderEditorItem(subcat, childrenContainer, level + 1, newPath, false);
        });
      }

      // Renderizar páginas después
      if (item.pages && item.pages.length > 0) {
        item.pages.forEach((page, index) => {
          const newPath = path.length > 0 ? [...path, 'pages', index] : ['pages', index];
          renderEditorItem(page, childrenContainer, level + 1, newPath, false);
        });
      }

      // Toggle para colapsar/expandir
      const toggle = itemRow.querySelector('.editor-toggle');
      if (toggle) {
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentlyExpanded = childrenContainer.style.display === 'block';
          childrenContainer.style.display = currentlyExpanded ? 'none' : 'block';
          // Actualizar icono de carpeta
          const folderIcon = itemRow.querySelector('img[src*="folder"]');
          if (folderIcon) {
            folderIcon.src = currentlyExpanded ? 'img/folder-close.svg' : 'img/folder-open.svg';
          }
          // Actualizar icono del toggle
          const toggleIcon = toggle.querySelector('img');
          if (toggleIcon) {
            toggleIcon.src = currentlyExpanded ? 'img/folder-close.svg' : 'img/folder-open.svg';
          }
        });
      }
    }

    itemDiv.appendChild(childrenContainer);
    parentElement.appendChild(itemDiv);
  };

  // Función auxiliar para navegar por el path
  const navigatePath = (config, path) => {
    let target = config;
    for (let i = 0; i < path.length; i += 2) {
      const key = path[i];
      const index = path[i + 1];
      if (target[key] && target[key][index]) {
        target = target[key][index];
      } else {
        return null;
      }
    }
    return target;
  };

  // Funciones CRUD
  const addCategory = (parentPath = []) => {
    showModalForm(
      'Agregar Carpeta',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre de la carpeta' }
      ],
      (data) => {
        const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
        const newCategory = { name: data.name, pages: [], categories: [] };
        
        if (parentPath.length === 0) {
          // Agregar al nivel raíz
          if (!config.categories) config.categories = [];
          config.categories.push(newCategory);
        } else {
          // Agregar dentro de una carpeta
          const parent = navigatePath(config, parentPath);
          if (parent) {
            if (!parent.categories) parent.categories = [];
            parent.categories.push(newCategory);
          }
        }
        
        savePagesJSON(config, roomId);
        refreshEditor();
      }
    );
  };

  const addPage = (parentPath = []) => {
    showModalForm(
      'Agregar Página',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre de la página' },
        { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
        { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' },
        { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' }
      ],
      (data) => {
        const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
        const newPage = {
          name: data.name,
          url: data.url
        };
        if (data.selector) newPage.selector = data.selector;
        if (data.blockTypes) {
          newPage.blockTypes = data.blockTypes.includes(',') 
            ? data.blockTypes.split(',').map(s => s.trim())
            : data.blockTypes.trim();
        }
        
        if (parentPath.length === 0) {
          // Si no hay carpetas, crear una
          if (!config.categories || config.categories.length === 0) {
            config.categories = [{ name: 'General', pages: [], categories: [] }];
          }
          if (!config.categories[0].pages) config.categories[0].pages = [];
          config.categories[0].pages.push(newPage);
        } else {
          // Agregar dentro de una carpeta
          const parent = navigatePath(config, parentPath);
          if (parent) {
            if (!parent.pages) parent.pages = [];
            parent.pages.push(newPage);
          }
        }
        
        savePagesJSON(config, roomId);
        refreshEditor();
      }
    );
  };

  const editCategory = (category, path) => {
    showModalForm(
      'Editar Carpeta',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, value: category.name }
      ],
      (data) => {
        const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
        const target = navigatePath(config, path);
        if (target) {
          target.name = data.name;
          savePagesJSON(config, roomId);
          refreshEditor();
        }
      }
    );
  };

  const editPage = (page, path) => {
    showModalForm(
      'Editar Página',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, value: page.name },
        { name: 'url', label: 'URL', type: 'url', required: true, value: page.url },
        { name: 'selector', label: 'Selector (opcional)', type: 'text', value: page.selector || '', help: 'Solo para URLs externas' },
        { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), help: 'Solo para URLs de Notion' }
      ],
      (data) => {
        const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
        const target = navigatePath(config, path);
        if (target) {
          target.name = data.name;
          target.url = data.url;
          if (data.selector) {
            target.selector = data.selector;
          } else {
            delete target.selector;
          }
          if (data.blockTypes) {
            target.blockTypes = data.blockTypes.includes(',') 
              ? data.blockTypes.split(',').map(s => s.trim())
              : data.blockTypes.trim();
          } else {
            delete target.blockTypes;
          }
          savePagesJSON(config, roomId);
          refreshEditor();
        }
      }
    );
  };

  const deleteCategory = (path) => {
    if (!confirm('¿Eliminar esta carpeta y todo su contenido?')) return;
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key]) {
      parent[key].splice(index, 1);
      savePagesJSON(config, roomId);
      refreshEditor();
    }
  };

  const deletePage = (path) => {
    if (!confirm('¿Eliminar esta página?')) return;
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key]) {
      parent[key].splice(index, 1);
      savePagesJSON(config, roomId);
      refreshEditor();
    }
  };

  // Función para refrescar el editor
  const refreshEditor = () => {
    const config = getPagesJSON(roomId) || currentConfig;
    contentArea.innerHTML = '';

    // Renderizar carpetas
    if (config.categories && config.categories.length > 0) {
      config.categories.forEach((category, index) => {
        renderEditorItem(category, contentArea, 0, ['categories', index], false);
      });
    } else {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = `
        text-align: center;
        padding: 40px;
        color: #666;
      `;
      emptyState.innerHTML = `
        <p style="margin-bottom: 12px;">No hay carpetas</p>
        <p style="font-size: 12px; color: #555;">Haz clic en el botón + para agregar una carpeta</p>
      `;
      contentArea.appendChild(emptyState);
    }
  };

  editorContainer.appendChild(header);
  editorContainer.appendChild(contentArea);
  document.body.appendChild(editorContainer);

  // Event listeners para botones del header
  const filterBtn = header.querySelector('#editor-filter-btn');
  if (filterBtn) {
    filterBtn.addEventListener('mouseenter', () => {
      filterBtn.style.background = CSS_VARS.bgHover;
    });
    filterBtn.addEventListener('mouseleave', () => {
      filterBtn.style.background = 'transparent';
    });
    filterBtn.addEventListener('click', () => {
      // TODO: Implementar funcionalidad de filtros
      console.log('Filtros - funcionalidad pendiente');
    });
  }

  const addBtn = header.querySelector('#editor-add-btn');
  if (addBtn) {
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = CSS_VARS.bgHover;
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'transparent';
    });
    addBtn.addEventListener('click', () => {
      addCategory();
    });
  }

  // Inicializar editor
  refreshEditor();
}

// Log adicional para verificar que el script se ejecutó completamente
console.log('✅ index.js cargado completamente');

