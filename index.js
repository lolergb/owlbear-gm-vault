console.log('🚀 Iniciando carga de index.js...');

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

console.log('✅ OBR SDK importado');

// Importar configuración
// Si config.js no existe, copia config.example.js a config.js y completa los datos
import { 
  NOTION_API_BASE, 
  NOTION_PAGES 
} from "./config.js";

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

function getTokenStorageKey(roomId) {
  return TOKEN_STORAGE_PREFIX + (roomId || 'default');
}

// Funciones para gestionar el token del usuario (por room)
function getUserToken(roomId) {
  try {
    const tokenKey = getTokenStorageKey(roomId);
    const token = localStorage.getItem(tokenKey);
    if (token && token.trim() !== '') {
      return token.trim();
    }
  } catch (e) {
    console.error('Error al leer token del usuario:', e);
  }
  return null;
}

function saveUserToken(token, roomId) {
  try {
    const tokenKey = getTokenStorageKey(roomId);
    if (token && token.trim() !== '') {
      localStorage.setItem(tokenKey, token.trim());
      console.log('✅ Token del usuario guardado para room:', roomId);
      return true;
    } else {
      // Si el token está vacío, eliminarlo
      localStorage.removeItem(tokenKey);
      console.log('🗑️ Token del usuario eliminado para room:', roomId);
      return true;
    }
  } catch (e) {
    console.error('Error al guardar token del usuario:', e);
    return false;
  }
}

function hasUserToken(roomId) {
  return getUserToken(roomId) !== null;
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
    console.log('🔍 Buscando configuración con clave:', storageKey, 'para roomId:', roomId);
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      console.log('✅ Configuración encontrada para room:', roomId);
      return parsed;
    } else {
      console.log('⚠️ No se encontró configuración para room:', roomId);
    }
  } catch (e) {
    console.error('Error al leer JSON:', e);
  }
  return null;
}

function savePagesJSON(json, roomId) {
  try {
    const storageKey = getStorageKey(roomId);
    console.log('💾 Guardando configuración con clave:', storageKey, 'para roomId:', roomId);
    localStorage.setItem(storageKey, JSON.stringify(json, null, 2));
    console.log('✅ Configuración guardada exitosamente para room:', roomId);
    
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

function getDefaultJSON() {
  return {
    categories: [
      {
        name: "General",
        pages: NOTION_PAGES.filter(p => p.url && !p.url.includes('...') && p.url.startsWith('http'))
      }
    ]
  };
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
    // Formato: https://workspace.notion.site/Title-{32-char-id}?params
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('-');
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      // El ID tiene 32 caracteres hexadecimales
      if (lastPart && lastPart.length >= 32) {
        const pageId = lastPart.substring(0, 32);
        // Convertir a formato UUID con guiones
        return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
      }
    }
    return null;
  } catch (e) {
    console.error('Error al extraer ID de Notion:', e);
    return null;
  }
}

// Función para obtener la información de la página (last_edited_time e icono)
async function fetchPageInfo(pageId) {
  try {
    // Obtener el roomId actual para usar el token del usuario
    let currentRoomId = null;
    try {
      currentRoomId = await OBR.room.getId();
    } catch (e) {
      currentRoomId = 'default';
    }
    
    const userToken = getUserToken(currentRoomId);
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      // Usuario tiene su propio token → llamar directamente a la API
      apiUrl = `${NOTION_API_BASE}/pages/${pageId}`;
      headers['Authorization'] = `Bearer ${userToken}`;
      headers['Notion-Version'] = '2022-06-28';
    } else {
      // Usar proxy del servidor o token local
      apiUrl = window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')
        ? `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page`
        : `${NOTION_API_BASE}/pages/${pageId}`;
      
      if (!apiUrl.includes('/.netlify/functions/')) {
        try {
          const config = await import("./config.js");
          const localToken = config.NOTION_API_TOKEN;
          if (localToken && localToken !== 'tu_token_de_notion_aqui') {
            headers['Authorization'] = `Bearer ${localToken}`;
            headers['Notion-Version'] = '2022-06-28';
          }
        } catch (e) {
          // Ignorar errores de importación
        }
      }
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
      return `<span style="font-size: 24px; line-height: 24px; display: inline-block; width: 24px; height: 24px; text-align: center;">${icon.emoji || '📄'}</span>`;
    } else if (icon.type === 'external' && icon.external) {
      // Icono externo (URL)
      return `<img src="${icon.external.url}" alt="${pageName}" style="width: 24px; height: 24px; object-fit: cover; border-radius: 4px;" />`;
    } else if (icon.type === 'file' && icon.file) {
      // Icono de archivo
      return `<img src="${icon.file.url}" alt="${pageName}" style="width: 24px; height: 24px; object-fit: cover; border-radius: 4px;" />`;
    }
  }
  
  // Fallback: círculo con color aleatorio e inicial
  const color = generateColorFromString(pageId || pageName);
  const initial = getInitial(pageName);
  return `<div style="
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: ${color};
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  ">${initial}</div>`;
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
    const userToken = getUserToken(currentRoomId);
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      // Usuario tiene su propio token → llamar directamente a la API de Notion
      console.log('✅ Usando token del usuario para:', pageId);
      apiUrl = `${NOTION_API_BASE}/blocks/${pageId}/children`;
      headers['Authorization'] = `Bearer ${userToken}`;
      headers['Notion-Version'] = '2022-06-28';
    } else {
      // No hay token del usuario → usar proxy del servidor o token local
      apiUrl = window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')
        ? `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}`
        : `${NOTION_API_BASE}/blocks/${pageId}/children`;
      
      // Solo agregar Authorization si no estamos usando el proxy (desarrollo local)
      if (!apiUrl.includes('/.netlify/functions/')) {
        try {
          const config = await import("./config.js");
          const localToken = config.NOTION_API_TOKEN;
          if (localToken && localToken !== 'tu_token_de_notion_aqui') {
            headers['Authorization'] = `Bearer ${localToken}`;
            headers['Notion-Version'] = '2022-06-28';
            console.log('✅ Usando token local de desarrollo');
          } else {
            throw new Error('No hay token configurado. Configura tu token de Notion en la extensión (botón 🔑).');
          }
        } catch (e) {
          throw new Error('No hay token configurado. Ve a Configuración → Token de Notion (botón 🔑) para configurar tu token.');
        }
      } else {
        console.log('✅ Usando Netlify Function como proxy (token del servidor)');
      }
    }
    
    console.log('🌐 Obteniendo bloques desde la API para:', pageId);
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
    
    // Estado 1: Guardar en caché persistente después de obtener exitosamente (sin expiración)
    if (blocks.length > 0) {
      setCachedBlocks(pageId, blocks);
      console.log('💾 Estado 1: Bloques guardados en caché persistente para:', pageId);
    } else {
      console.warn('⚠️ No se obtuvieron bloques de la API para:', pageId);
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
      return `<h1>${renderRichText(block.heading_1?.rich_text)}</h1>`;
    
    case 'heading_2':
      return `<h2>${renderRichText(block.heading_2?.rich_text)}</h2>`;
    
    case 'heading_3':
      return `<h3>${renderRichText(block.heading_3?.rich_text)}</h3>`;
    
    case 'bulleted_list_item':
      return `<li class="notion-bulleted-list-item">${renderRichText(block.bulleted_list_item?.rich_text)}</li>`;
    
    case 'numbered_list_item':
      return `<li class="notion-numbered-list-item">${renderRichText(block.numbered_list_item?.rich_text)}</li>`;
    
    case 'image':
      const image = block.image;
      const imageUrl = image?.external?.url || image?.file?.url;
      const caption = image?.caption ? renderRichText(image.caption) : '';
      
      if (imageUrl) {
        // Generar ID único para la imagen
        const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return `
          <div class="notion-image">
            <img src="${imageUrl}" alt="${caption || ''}" class="notion-image-clickable" data-image-id="${imageId}" data-image-url="${imageUrl}" data-image-caption="${caption.replace(/"/g, '&quot;')}" style="cursor: pointer;" />
            ${caption ? `<div class="notion-image-caption">${caption}</div>` : ''}
          </div>
        `;
      }
      return '';
    
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
    
    default:
      console.log('Tipo de bloque no soportado:', type, block);
      return '';
  }
}

// Función para renderizar todos los bloques
async function renderBlocks(blocks) {
  let html = '';
  let inList = false;
  let listType = null;
  let listItems = [];
  
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const type = block.type;
    
    // Manejar listas agrupadas
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
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
        try {
          const tableHtml = await renderTable(block);
          html += tableHtml;
        } catch (error) {
          console.error('Error al renderizar tabla:', error);
          html += '<div class="notion-table-placeholder">[Error al cargar tabla]</div>';
        }
      } else {
        html += renderBlock(block);
      }
    }
  }
  
  // Cerrar lista si queda abierta
  if (inList && listItems.length > 0) {
    html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
  }
  
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
    const viewerUrl = new URL('image-viewer.html', window.location.origin);
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

// Agregar event listeners a las imágenes después de renderizar
function attachImageClickHandlers() {
  const images = document.querySelectorAll('.notion-image-clickable');
  images.forEach(img => {
    img.addEventListener('click', () => {
      const imageUrl = img.getAttribute('data-image-url');
      const caption = img.getAttribute('data-image-caption') || '';
      showImageModal(imageUrl, caption);
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
async function loadNotionContent(url, container, forceRefresh = false) {
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
    const html = await renderBlocks(blocks);
    contentDiv.innerHTML = html;
    
    // Agregar event listeners a las imágenes para abrirlas en modal
    attachImageClickHandlers();
    
  } catch (error) {
    console.error('Error al cargar contenido de Notion:', error);
    contentDiv.innerHTML = `
      <div class="notion-error">
        <strong>Error al cargar el contenido:</strong><br>
        ${error.message}<br><br>
        <button onclick="window.open('${url}', '_blank')" style="
          background: #4a9eff;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          color: #fff;
          cursor: pointer;
        ">Abrir en Notion</button>
      </div>
    `;
  }
}

// Función para mostrar mensaje cuando Notion bloquea el iframe
function showNotionBlockedMessage(container, url) {
  container.innerHTML = `
    <div style="padding: 40px 20px; text-align: center; color: #e0e0e0;">
      <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
      <h2 style="color: #fff; margin-bottom: 12px; font-size: 18px;">Notion bloquea el embedding</h2>
      <p style="color: #999; margin-bottom: 20px; font-size: 14px; line-height: 1.5;">
        Notion no permite que sus páginas se carguen en iframes por razones de seguridad.<br>
        Puedes abrir la página en una nueva ventana para verla.
      </p>
      <button id="open-notion-window" style="
        background: #4a9eff;
        border: none;
        border-radius: 8px;
        padding: 12px 24px;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      ">Abrir en nueva ventana</button>
    </div>
  `;
  
  const openButton = container.querySelector('#open-notion-window');
  if (openButton) {
    openButton.addEventListener('click', () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    openButton.addEventListener('mouseenter', () => {
      openButton.style.background = '#5aaeff';
    });
    openButton.addEventListener('mouseleave', () => {
      openButton.style.background = '#4a9eff';
    });
  }
}

// Intentar inicializar Owlbear con manejo de errores
console.log('🔄 Intentando inicializar Owlbear SDK...');

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
      console.log('🔍 Intentando cargar configuración para room:', roomId);
      let pagesConfig = getPagesJSON(roomId);
      if (!pagesConfig) {
        console.log('📝 No se encontró configuración, creando una nueva para room:', roomId);
        pagesConfig = getDefaultJSON();
        savePagesJSON(pagesConfig, roomId);
        console.log('✅ Configuración por defecto creada para room:', roomId);
      } else {
        console.log('✅ Configuración encontrada para room:', roomId);
      }

      console.log('📊 Configuración cargada para room:', roomId);
      console.log('📊 Número de categorías:', pagesConfig?.categories?.length || 0);
      
      const pageList = document.getElementById("page-list");
      const header = document.getElementById("header");

      if (!pageList || !header) {
        console.error('❌ No se encontraron los elementos necesarios');
        return;
      }

      // Agregar botones de administración
      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText = "display: flex; gap: 8px; margin-left: auto;";
      
      // Botón para limpiar caché
      const clearCacheButton = document.createElement("button");
      const deleteIcon = document.createElement("img");
      deleteIcon.src = "img/icon-delete.svg";
      deleteIcon.alt = "Limpiar caché";
      deleteIcon.style.cssText = "width: 20px; height: 20px; display: block;";
      clearCacheButton.appendChild(deleteIcon);
      clearCacheButton.title = "Limpiar caché";
      clearCacheButton.style.cssText = `
        background: transparent;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      `;
      clearCacheButton.addEventListener("click", () => {
        if (confirm('¿Limpiar todo el caché? Las páginas se recargarán desde la API la próxima vez.')) {
          try {
            clearAllCache();
            alert('Caché limpiado. Las páginas se recargarán desde la API la próxima vez que las abras.');
          } catch (e) {
            console.error('Error al limpiar caché:', e);
            alert('Error al limpiar el caché. Revisa la consola para más detalles.');
          }
        }
      });
      clearCacheButton.addEventListener('mouseenter', () => {
        clearCacheButton.style.background = CSS_VARS.bgHover;
        clearCacheButton.style.borderRadius = '50%';
      });
      clearCacheButton.addEventListener('mouseleave', () => {
        clearCacheButton.style.background = 'transparent';
      });
      clearCacheButton.addEventListener('mousedown', () => {
        clearCacheButton.style.background = CSS_VARS.bgActive;
      });
      clearCacheButton.addEventListener('mouseup', () => {
        clearCacheButton.style.background = CSS_VARS.bgHover;
      });
      
      // Botón para editar JSON
      const adminButton = document.createElement("button");
      adminButton.className = "admin-button";
      const jsonIcon = document.createElement("img");
      jsonIcon.src = "img/icon-json.svg";
      jsonIcon.alt = "Editar JSON";
      jsonIcon.style.cssText = "width: 20px; height: 20px; display: block;";
      adminButton.appendChild(jsonIcon);
      adminButton.title = "Editar JSON";
      adminButton.style.cssText = `
        background: transparent;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      `;
      adminButton.addEventListener("click", () => showJSONEditor(pagesConfig, roomId));
      adminButton.addEventListener('mouseenter', () => {
        adminButton.style.background = CSS_VARS.bgHover;
        adminButton.style.borderRadius = '50%';
      });
      adminButton.addEventListener('mouseleave', () => {
        adminButton.style.background = 'transparent';
      });
      adminButton.addEventListener('mousedown', () => {
        adminButton.style.background = CSS_VARS.bgActive;
      });
      adminButton.addEventListener('mouseup', () => {
        adminButton.style.background = CSS_VARS.bgHover;
      });
      
      // Botón para configurar token de Notion
      const tokenButton = document.createElement("button");
      const keyIcon = document.createElement("img");
      keyIcon.src = "img/icon-key.svg";
      keyIcon.alt = "Configurar token";
      keyIcon.style.cssText = "width: 20px; height: 20px; display: block;";
      tokenButton.appendChild(keyIcon);
      tokenButton.title = hasUserToken(roomId) ? "Token configurado - Clic para cambiar" : "Configurar token de Notion";
      tokenButton.style.cssText = `
        background: transparent;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      `;
      tokenButton.addEventListener("click", () => showTokenConfig(roomId));
      tokenButton.addEventListener('mouseenter', () => {
        tokenButton.style.background = CSS_VARS.bgHover;
        tokenButton.style.borderRadius = '50%';
      });
      tokenButton.addEventListener('mouseleave', () => {
        tokenButton.style.background = 'transparent';
      });
      tokenButton.addEventListener('mousedown', () => {
        tokenButton.style.background = CSS_VARS.bgActive;
      });
      tokenButton.addEventListener('mouseup', () => {
        tokenButton.style.background = CSS_VARS.bgHover;
      });
      
      buttonContainer.appendChild(tokenButton);
      buttonContainer.appendChild(clearCacheButton);
      buttonContainer.appendChild(adminButton);
      header.appendChild(buttonContainer);

      // Renderizar páginas agrupadas por categorías
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
            <p style="font-size: 11px; margin-top: 8px; color: #888;">${error.message || 'Error desconocido'}</p>
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

// Función para renderizar páginas agrupadas por categorías
function renderPagesByCategories(pagesConfig, pageList, roomId = null) {
  // Mostrar loading
  pageList.innerHTML = '<div class="loading-state" style="text-align: center; padding: 40px; color: #999;"><div style="font-size: 24px; margin-bottom: 12px;">⏳</div><div>Cargando páginas...</div></div>';
  
  // Usar setTimeout para permitir que el DOM se actualice con el loading
  setTimeout(() => {
    pageList.innerHTML = '';
    
    if (!pagesConfig || !pagesConfig.categories || pagesConfig.categories.length === 0) {
      pageList.innerHTML = `
        <div class="empty-state">
          <p>No hay páginas configuradas</p>
          <p>Clic en ⚙️ para editar el JSON</p>
        </div>
      `;
      return;
    }
  
  // Ordenar categorías alfabéticamente
  const sortedCategories = [...pagesConfig.categories].sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
  
  sortedCategories.forEach(category => {
    if (!category.pages || category.pages.length === 0) return;
    
    // Filtrar y ordenar páginas válidas alfabéticamente
    const categoryPages = category.pages
      .filter(page => 
        page.url && 
        !page.url.includes('...') && 
        page.url.startsWith('http')
      )
      .sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    
    if (categoryPages.length === 0) return;
    
    // Crear contenedor de categoría
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category-group';
    categoryDiv.dataset.categoryName = category.name;
    categoryDiv.style.cssText = 'margin-bottom: 24px;';
    
    // Contenedor del título con botón de colapsar
    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      cursor: pointer;
    `;
    
    // Botón de colapsar/expandir
    const collapseButton = document.createElement('button');
    collapseButton.className = 'category-collapse-button';
    collapseButton.style.cssText = `
      background: transparent;
      border: none;
      padding: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      transition: transform 0.2s;
    `;
    
    // Icono de colapsar (inicialmente cerrado/expandido)
    const collapseIcon = document.createElement('img');
    collapseIcon.style.cssText = 'width: 16px; height: 16px; display: block;';
    
    // Verificar estado guardado en localStorage
    const collapseStateKey = `category-collapsed-${category.name}`;
    const isCollapsed = localStorage.getItem(collapseStateKey) === 'true';
    
    collapseIcon.src = isCollapsed ? 'img/icon-closed.svg' : 'img/icon-open.svg';
    collapseIcon.alt = isCollapsed ? 'Expandir' : 'Colapsar';
    collapseButton.appendChild(collapseIcon);
    
    // Título de categoría
    const categoryTitle = document.createElement('h2');
    categoryTitle.className = 'category-title';
    categoryTitle.textContent = category.name;
    categoryTitle.style.cssText = `
      font-size: 14px;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0;
      flex: 1;
    `;
    
    titleContainer.appendChild(collapseButton);
    titleContainer.appendChild(categoryTitle);
    categoryDiv.appendChild(titleContainer);
    
    // Contenedor de páginas de la categoría
    const pagesContainer = document.createElement('div');
    pagesContainer.className = 'category-pages';
    pagesContainer.style.cssText = `
      display: ${isCollapsed ? 'none' : 'flex'};
      flex-direction: column;
      gap: 8px;
      transition: opacity 0.2s;
    `;
    
    // Funcionalidad de colapsar/expandir
    const toggleCollapse = () => {
      const currentState = pagesContainer.style.display === 'none';
      pagesContainer.style.display = currentState ? 'flex' : 'none';
      collapseIcon.src = currentState ? 'img/icon-open.svg' : 'img/icon-closed.svg';
      collapseIcon.alt = currentState ? 'Colapsar' : 'Expandir';
      
      // Guardar estado en localStorage
      localStorage.setItem(collapseStateKey, currentState ? 'false' : 'true');
    };
    
    collapseButton.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse();
    });
    
    titleContainer.addEventListener('click', (e) => {
      // Si se hace clic en el título (no en el botón), también colapsar
      if (e.target === categoryTitle || e.target === titleContainer) {
        toggleCollapse();
      }
    });
    
    // Crear botones para cada página (renderizar primero, luego cargar iconos en paralelo)
    const buttonsData = [];
    
    categoryPages.forEach((page) => {
      const button = document.createElement("button");
      button.className = "page-button";
      
      // Obtener el icono de la página
      const pageId = extractNotionPageId(page.url);
      let iconHtml = renderPageIcon(null, page.name, pageId);
      
      // Obtener el tipo de link y su icono
      const linkType = getLinkType(page.url);
      const linkIconHtml = `<img src="img/${linkType.icon}" alt="${linkType.type}" style="width: 16px; height: 16px; opacity: 0.5; flex-shrink: 0;" />`;
      
      // Mostrar placeholder mientras se carga el icono
      button.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
          ${iconHtml}
          <div class="page-name" style="flex: 1; text-align: left;">${page.name}</div>
          ${linkIconHtml}
        </div>
      `;
      
      button.addEventListener("click", async () => {
        await loadPageContent(page.url, page.name);
      });
      
      pagesContainer.appendChild(button);
      
      // Guardar datos para cargar iconos después en paralelo
      if (pageId) {
        buttonsData.push({ button, pageId, pageName: page.name, linkIconHtml });
      }
    });
    
    // Cargar iconos en paralelo después de renderizar todos los botones
    if (buttonsData.length > 0) {
      Promise.all(buttonsData.map(async ({ button, pageId, pageName, linkIconHtml }) => {
        try {
          const icon = await fetchPageIcon(pageId);
          const iconHtml = renderPageIcon(icon, pageName, pageId);
          button.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
              ${iconHtml}
              <div class="page-name" style="flex: 1; text-align: left;">${pageName}</div>
              ${linkIconHtml}
            </div>
          `;
        } catch (e) {
          console.warn('No se pudo obtener el icono para:', pageName, e);
        }
      })).catch(e => {
        console.error('Error al cargar iconos:', e);
      });
    }
    
    categoryDiv.appendChild(pagesContainer);
    pageList.appendChild(categoryDiv);
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
    
    // Aquí se pueden añadir más tipos en el futuro:
    // if (hostname.includes('dndbeyond.com')) {
    //   return { type: 'dndbeyond', icon: 'icon-dndbeyond.svg' };
    // }
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
function loadIframeContent(url, container) {
  const iframe = container.querySelector('#notion-iframe');
  const contentDiv = container.querySelector('#notion-content');
  
  if (!iframe) {
    console.error('No se encontró el iframe');
    return;
  }
  
  // Ocultar el contenido de Notion y mostrar el iframe
  if (contentDiv) {
    contentDiv.style.display = 'none';
  }
  // Quitar la clase que oculta el iframe
  container.classList.remove('show-content');
  // Asegurarse de que el iframe se muestre
  iframe.style.display = 'block';
  iframe.style.visibility = 'visible';
  iframe.src = url;
  
  console.log('📄 Cargando URL en iframe:', url);
}

// Función para cargar contenido de una página
async function loadPageContent(url, name) {
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  const backButton = document.getElementById("back-button");
  const pageTitle = document.getElementById("page-title");
  const notionContent = document.getElementById("notion-content");
  const header = document.getElementById("header");
  
  if (pageList && notionContainer && backButton && pageTitle && notionContent && header) {
    pageList.classList.add("hidden");
    notionContainer.classList.remove("hidden");
    backButton.classList.remove("hidden");
    pageTitle.textContent = name;
    
    // Detectar si es una URL de Notion o una URL genérica
    if (isNotionUrl(url)) {
      // Es una URL de Notion → usar la API
      console.log('📝 URL de Notion detectada, usando API');
      
      // Agregar o actualizar botón de recargar (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
    if (!refreshButton) {
      refreshButton = document.createElement("button");
      refreshButton.id = "refresh-page-button";
      header.appendChild(refreshButton);
    }
    
    // Guardar la URL actual en el botón
    refreshButton.dataset.pageUrl = url;
    
    // Limpiar contenido anterior
    refreshButton.innerHTML = "";
    const reloadIcon = document.createElement("img");
    reloadIcon.src = "img/icon-reload.svg";
    reloadIcon.alt = "Recargar contenido";
    reloadIcon.style.cssText = "width: 20px; height: 20px; display: block;";
    refreshButton.appendChild(reloadIcon);
    refreshButton.title = "Recargar contenido";
    refreshButton.style.cssText = `
      background: transparent;
      border: none;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      margin-left: 8px;
    `;
    
    // Remover listeners anteriores si existen
    const newRefreshButton = refreshButton.cloneNode(true);
    refreshButton.parentNode.replaceChild(newRefreshButton, refreshButton);
    refreshButton = newRefreshButton;
    refreshButton.id = "refresh-page-button";
    refreshButton.dataset.pageUrl = url;
    
      refreshButton.addEventListener('mouseenter', () => {
        refreshButton.style.background = CSS_VARS.bgHover;
        refreshButton.style.borderRadius = '50%';
      });
      refreshButton.addEventListener('mouseleave', () => {
        refreshButton.style.background = 'transparent';
      });
      refreshButton.addEventListener('mousedown', () => {
        refreshButton.style.background = CSS_VARS.bgActive;
      });
      refreshButton.addEventListener('mouseup', () => {
        refreshButton.style.background = CSS_VARS.bgHover;
      });
    
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
        await loadNotionContent(currentUrl, notionContainer, true);
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
      
      await loadNotionContent(url, notionContainer);
    } else {
      // No es una URL de Notion → cargar en iframe
      console.log('🌐 URL genérica detectada, usando iframe');
      
      // Ocultar botón de recargar si existe (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      // Cargar en iframe
      loadIframeContent(url, notionContainer);
    }
    
    if (!backButton.dataset.listenerAdded) {
      backButton.addEventListener("click", () => {
        pageList.classList.remove("hidden");
        notionContainer.classList.add("hidden");
        backButton.classList.add("hidden");
        pageTitle.textContent = "📚 Context";
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
      });
      backButton.dataset.listenerAdded = "true";
    }
  }
}

// Función para mostrar configuración de token
function showTokenConfig(roomId = null) {
  const mainContainer = document.querySelector('.container');
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  
  if (mainContainer) mainContainer.classList.add('hidden');
  if (pageList) pageList.classList.add('hidden');
  if (notionContainer) notionContainer.classList.add('hidden');
  
  const currentToken = getUserToken(roomId) || '';
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
        <h1 style="color: #fff; font-size: 18px; font-weight: 600; margin: 0;">🔑 Configurar Token de Notion</h1>
        ${roomId ? `<p style="color: #999; font-size: 11px; margin: 2px 0 0 0;">Room: ${getFriendlyRoomId(roomId)}</p>` : ''}
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
        Configura tu token de Notion para usar tus propias páginas. Cada room tiene su propio token.
      </p>
      
      <div style="background: ${CSS_VARS.bgPrimary}; border: 1px solid ${CSS_VARS.borderPrimary}; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <h3 style="color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;">📝 Cómo obtener tu token:</h3>
        <ol style="color: #ccc; font-size: 13px; line-height: 1.8; margin-left: 20px; padding-left: 0;">
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
              <li>Clic en <strong>"Mostrar"</strong> y copia el token (empieza con <code style="background: ${CSS_VARS.bgPrimary}; padding: 2px 4px; border-radius: 3px;">secret_</code>)</li>
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
        <label style="display: block; color: #fff; font-size: 14px; font-weight: 500; margin-bottom: 8px;">
          Token de Notion:
        </label>
        <input 
          type="password" 
          id="token-input" 
          placeholder="secret_..." 
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
        ${currentToken ? `<p style="color: #888; font-size: 12px; margin-top: 8px;">Token actual: ${maskedToken}</p>` : ''}
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
      
      <div style="display: flex; gap: 16px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid ${CSS_VARS.borderPrimary};">
        <button id="clear-token" style="
          background: ${CSS_VARS.bgPrimary};
          border: 1px solid ${CSS_VARS.borderPrimary};
          border-radius: 6px;
          padding: 10px 20px;
          color: #e0e0e0;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
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
          font-weight: 600;
          transition: all 0.2s;
          flex: 1;
        ">Guardar Token</button>
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
    
    if (!token.startsWith('secret_')) {
      errorDiv.textContent = 'El token de Notion debe comenzar con "secret_"';
      errorDiv.style.display = 'block';
      return;
    }
    
    if (saveUserToken(token, roomId)) {
      errorDiv.style.display = 'none';
      alert('✅ Token guardado exitosamente. Ahora puedes usar tus propias páginas de Notion.');
      closeTokenConfig();
      // Recargar la página para aplicar el nuevo token
      window.location.reload();
    } else {
      errorDiv.textContent = 'Error al guardar el token. Revisa la consola para más detalles.';
      errorDiv.style.display = 'block';
    }
  });
  
  // Eliminar token
  clearBtn.addEventListener('click', () => {
    if (confirm('¿Eliminar el token? Volverás a usar el token del servidor (si está configurado).')) {
      if (saveUserToken('', roomId)) {
        alert('Token eliminado. Se usará el token del servidor.');
        closeTokenConfig();
        window.location.reload();
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
}

// Función para mostrar el editor de JSON
function showJSONEditor(pagesConfig, roomId = null) {
  // Ocultar el contenedor principal y mostrar el editor
  const mainContainer = document.querySelector('.container');
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  
  if (mainContainer) mainContainer.classList.add('hidden');
  if (pageList) pageList.classList.add('hidden');
  if (notionContainer) notionContainer.classList.add('hidden');
  
  // Crear contenedor del editor (estilo Notion)
  const editorContainer = document.createElement('div');
  editorContainer.id = 'json-editor-container';
  editorContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${CSS_VARS.bgPrimary};
    z-index: 1000;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  `;
  
  // Header estilo Notion
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
      <button id="back-from-editor" style="
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
        <h1 style="color: #fff; font-size: 18px; font-weight: 600; margin: 0;">📝 Editar Configuración</h1>
        ${roomId ? `<p style="color: #999; font-size: 11px; margin: 2px 0 0 0;">Room: ${getFriendlyRoomId(roomId)}</p>` : ''}
      </div>
    </div>
  `;
  
  // Área de contenido
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 24px;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    overflow: hidden;
  `;
  
  contentArea.innerHTML = `
    <div style="margin-bottom: 16px;">
      <p style="color: #999; font-size: 14px; margin-bottom: 12px;">
        Edita el JSON para gestionar tus categorías y páginas. La estructura debe tener un array "categories" con objetos que contengan "name" y "pages".
      </p>
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; gap: 12px; min-height: 0;">
      <textarea id="json-textarea" style="
        background: ${CSS_VARS.bgPrimary};
        border: 1px solid ${CSS_VARS.borderPrimary};
        border-radius: 8px;
        padding: 20px;
        color: #e0e0e0;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.6;
        flex: 1;
        resize: none;
        white-space: pre;
        overflow-wrap: normal;
        overflow-x: auto;
        overflow-y: auto;
        transition: border-color 0.2s;
      ">${JSON.stringify(pagesConfig, null, 2)}</textarea>
      <div id="json-error" style="
        color: #ff6b6b;
        font-size: 13px;
        display: none;
        padding: 12px 16px;
        background: rgba(255, 107, 107, 0.1);
        border: 1px solid rgba(255, 107, 107, 0.3);
        border-radius: 6px;
      "></div>
      <div style="display: flex; gap: 16px; justify-content: flex-end; padding-top: 16px;">
        <button id="reset-json" style="
          background: ${CSS_VARS.bgPrimary};
          border: 1px solid ${CSS_VARS.borderPrimary};
          border-radius: 6px;
          padding: 10px 20px;
          color: #e0e0e0;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          flex:1;
        ">Resetear</button>
        <button id="save-json" style="
          background: #4a9eff;
          border: none;
          border-radius: 6px;
          padding: 10px 24px;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
          flex:1;
        ">Guardar</button>
      </div>
    </div>
  `;
  
  editorContainer.appendChild(header);
  editorContainer.appendChild(contentArea);
  document.body.appendChild(editorContainer);
  
  const textarea = contentArea.querySelector('#json-textarea');
  const errorDiv = contentArea.querySelector('#json-error');
  
  // Estilos hover para botones
  const resetBtn = contentArea.querySelector('#reset-json');
  const saveBtn = contentArea.querySelector('#save-json');
  const backBtn = header.querySelector('#back-from-editor');
  
  resetBtn.addEventListener('mouseenter', () => {
    resetBtn.style.background = CSS_VARS.bgHover;
    resetBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  resetBtn.addEventListener('mouseleave', () => {
    resetBtn.style.background = CSS_VARS.bgPrimary;
    resetBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  resetBtn.addEventListener('mousedown', () => {
    resetBtn.style.background = CSS_VARS.bgActive;
    resetBtn.style.borderColor = CSS_VARS.borderActive;
  });
  resetBtn.addEventListener('mouseup', () => {
    resetBtn.style.background = CSS_VARS.bgHover;
    resetBtn.style.borderColor = CSS_VARS.borderPrimary;
  });
  
  saveBtn.addEventListener('mouseenter', () => {
    saveBtn.style.background = '#5aaeff';
  });
  saveBtn.addEventListener('mouseleave', () => {
    saveBtn.style.background = '#4a9eff';
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
  
  // Función para cerrar el editor
  const closeEditor = () => {
    document.body.removeChild(editorContainer);
    if (mainContainer) mainContainer.classList.remove('hidden');
    if (pageList) pageList.classList.remove('hidden');
  };
  
  // Guardar JSON
  saveBtn.addEventListener('click', () => {
    try {
      console.log('💾 Guardando JSON para roomId:', roomId);
      const jsonText = textarea.value.trim();
      const parsed = JSON.parse(jsonText);
      
      // Validar estructura básica
      if (!parsed.categories || !Array.isArray(parsed.categories)) {
        throw new Error('El JSON debe tener un array "categories"');
      }
      
      // Verificar que roomId esté disponible
      if (!roomId) {
        console.error('❌ ERROR: roomId es null/undefined al guardar');
        throw new Error('No se pudo identificar la room. Recarga la extensión.');
      }
      
      // Guardar (con roomId)
      console.log('💾 Llamando a savePagesJSON con roomId:', roomId);
      savePagesJSON(parsed, roomId);
      errorDiv.style.display = 'none';
      textarea.style.borderColor = CSS_VARS.borderPrimary;
      
      // Cerrar y recargar
      closeEditor();
      console.log('🔄 Recargando configuración para roomId:', roomId);
      const newConfig = getPagesJSON(roomId) || getDefaultJSON();
      const pageListEl = document.getElementById("page-list");
      if (pageListEl) {
        renderPagesByCategories(newConfig, pageListEl, roomId);
      }
    } catch (e) {
      console.error('❌ Error al guardar:', e);
      errorDiv.textContent = `Error: ${e.message}`;
      errorDiv.style.display = 'block';
      textarea.style.borderColor = '#ff6b6b';
    }
  });
  
  // Resetear JSON
  resetBtn.addEventListener('click', () => {
    if (confirm('¿Resetear al JSON por defecto? Se perderán todos los cambios para esta room.')) {
      const defaultConfig = getDefaultJSON();
      textarea.value = JSON.stringify(defaultConfig, null, 2);
      errorDiv.style.display = 'none';
      textarea.style.borderColor = CSS_VARS.borderPrimary;
    }
  });
  
  // Validar JSON en tiempo real
  textarea.addEventListener('input', () => {
    try {
      JSON.parse(textarea.value);
      errorDiv.style.display = 'none';
      textarea.style.borderColor = CSS_VARS.borderPrimary;
    } catch (e) {
      textarea.style.borderColor = '#ff6b6b';
    }
  });
  
  // Volver
  backBtn.addEventListener('click', closeEditor);
  
  // Auto-focus
  textarea.focus();
  // Scroll al inicio
  textarea.scrollTop = 0;
}

// Log adicional para verificar que el script se ejecutó completamente
console.log('✅ index.js cargado completamente');

