console.log('🚀 Iniciando carga de index.js...');

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

console.log('✅ OBR SDK importado');

// Importar configuración
// Si config.js no existe, copia config.example.js a config.js y completa los datos
import { 
  NOTION_API_BASE, 
  NOTION_PAGES 
} from "./config.js";

// Sistema simple de gestión con JSON (por room)
const STORAGE_KEY_PREFIX = 'notion-pages-json-';

function getStorageKey(roomId) {
  return STORAGE_KEY_PREFIX + (roomId || 'default');
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

// Sistema de caché para bloques de Notion
const CACHE_PREFIX = 'notion-blocks-cache-';
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hora en milisegundos

/**
 * Obtener bloques desde el caché
 */
function getCachedBlocks(pageId) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      const now = Date.now();
      
      // Verificar si el caché no ha expirado
      if (data.timestamp && (now - data.timestamp) < CACHE_EXPIRY) {
        console.log('✅ Bloques obtenidos del caché para:', pageId);
        return {
          blocks: data.blocks,
          lastEditedTime: data.lastEditedTime || null
        };
      } else {
        // Caché expirado, eliminarlo
        localStorage.removeItem(cacheKey);
        console.log('⏰ Caché expirado para:', pageId);
      }
    }
  } catch (e) {
    console.error('Error al leer del caché:', e);
  }
  return null;
}

/**
 * Guardar bloques en el caché
 */
function setCachedBlocks(pageId, blocks, lastEditedTime = null) {
  try {
    const cacheKey = CACHE_PREFIX + pageId;
    const data = {
      timestamp: Date.now(),
      blocks: blocks,
      lastEditedTime: lastEditedTime
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    console.log('💾 Bloques guardados en caché para:', pageId, 'con lastEditedTime:', lastEditedTime);
  } catch (e) {
    console.error('Error al guardar en caché:', e);
    // Si el localStorage está lleno, limpiar cachés antiguos
    if (e.name === 'QuotaExceededError') {
      clearOldCache();
    }
  }
}

/**
 * Limpiar cachés antiguos (más de 24 horas)
 */
function clearOldCache() {
  try {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data.timestamp && (now - data.timestamp) > oneDay) {
            localStorage.removeItem(key);
            console.log('🗑️ Caché antiguo eliminado:', key);
          }
        } catch (e) {
          // Si hay error al parsear, eliminar la entrada corrupta
          localStorage.removeItem(key);
        }
      }
    }
  } catch (e) {
    console.error('Error al limpiar caché:', e);
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
  } catch (e) {
    console.error('Error al limpiar caché:', e);
  }
}

// Limpiar cachés antiguos al cargar
clearOldCache();

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

// Función para obtener la información de última edición de una página
async function fetchPageLastEditedTime(pageId) {
  try {
    const apiUrl = window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')
      ? `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page`
      : `${NOTION_API_BASE}/pages/${pageId}`;
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
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
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });
    
    if (response.ok) {
      const data = await response.json();
      // La API de Notion devuelve last_edited_time en el objeto de la página
      return data.last_edited_time || null;
    }
  } catch (e) {
    console.warn('No se pudo obtener last_edited_time:', e);
  }
  return null;
}

// Función para obtener bloques de una página de Notion (con caché inteligente)
async function fetchNotionBlocks(pageId, useCache = true) {
  // Si hay caché, verificar si el contenido ha cambiado
  if (useCache) {
    const cachedData = getCachedBlocks(pageId);
    if (cachedData && cachedData.blocks) {
      // Intentar verificar si el contenido ha cambiado comparando last_edited_time
      try {
        // Obtener el last_edited_time más reciente de los bloques actuales
        const currentLastEdited = await fetchPageLastEditedTime(pageId);
        if (currentLastEdited && cachedData.lastEditedTime) {
          if (currentLastEdited === cachedData.lastEditedTime) {
            console.log('✅ Contenido sin cambios, usando caché');
            return cachedData.blocks;
          } else {
            console.log('🔄 Contenido modificado detectado, invalidando caché');
            console.log('   Caché:', cachedData.lastEditedTime);
            console.log('   Actual:', currentLastEdited);
            // Invalidar caché
            const cacheKey = CACHE_PREFIX + pageId;
            localStorage.removeItem(cacheKey);
          }
        } else {
          // Si no podemos verificar, usar el caché si no ha expirado
          console.log('⚠️ No se pudo verificar cambios, usando caché si no ha expirado');
          return cachedData.blocks;
        }
      } catch (e) {
        console.warn('Error al verificar cambios, usando caché:', e);
        return cachedData.blocks;
      }
    }
  }
  
  try {
    // Usar Netlify Function como proxy para mantener el token seguro
    // Netlify Functions se exponen en /.netlify/functions/nombre-funcion
    const apiUrl = window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')
      ? `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}`
      : `${NOTION_API_BASE}/blocks/${pageId}/children`;
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Solo agregar Authorization si no estamos usando el proxy (desarrollo local)
    // En producción, el token está en el servidor (Netlify Function)
    if (!apiUrl.includes('/.netlify/functions/')) {
      // Para desarrollo local, intentar obtener el token dinámicamente
      try {
        const config = await import("./config.js");
        const localToken = config.NOTION_API_TOKEN;
        if (!localToken || localToken === 'tu_token_de_notion_aqui') {
          throw new Error('El token de la API de Notion no está configurado. Edita config.js y agrega tu token para desarrollo local.');
        }
        headers['Authorization'] = `Bearer ${localToken}`;
        headers['Notion-Version'] = '2022-06-28';
      } catch (e) {
        throw new Error('No se pudo cargar el token. En desarrollo local, asegúrate de que config.js tenga NOTION_API_TOKEN configurado.');
      }
    } else {
      // En producción, el token está en el servidor (Netlify Function)
      console.log('✅ Usando Netlify Function como proxy (token seguro en servidor)');
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
    
    // Obtener last_edited_time del primer bloque o de la página
    let lastEditedTime = null;
    if (blocks.length > 0) {
      // Buscar el last_edited_time más reciente entre los bloques
      const editedTimes = blocks
        .map(b => b.last_edited_time)
        .filter(t => t)
        .sort()
        .reverse();
      if (editedTimes.length > 0) {
        lastEditedTime = editedTimes[0];
      }
    }
    
    // Si no encontramos en los bloques, intentar obtener de la página
    if (!lastEditedTime) {
      lastEditedTime = await fetchPageLastEditedTime(pageId);
    }
    
    // Guardar en caché después de obtener exitosamente
    if (blocks.length > 0) {
      setCachedBlocks(pageId, blocks, lastEditedTime);
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
  const iframe = container.querySelector('#notion-iframe');
  
  if (!contentDiv) {
    console.error('No se encontró el contenedor de contenido');
    return;
  }
  
  // Mostrar loading
  contentDiv.innerHTML = '<div class="notion-loading">Cargando contenido...</div>';
  container.classList.add('show-content');
  
  try {
    // Extraer ID de la página
    const pageId = extractNotionPageId(url);
    if (!pageId) {
      throw new Error('No se pudo extraer el ID de la página desde la URL');
    }
    
    console.log('Obteniendo bloques para página:', pageId, forceRefresh ? '(recarga forzada)' : '(con caché)');
    
    // Obtener bloques (usar caché a menos que se fuerce la recarga)
    const blocks = await fetchNotionBlocks(pageId, !forceRefresh);
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
      clearCacheButton.innerHTML = "🗑️";
      clearCacheButton.title = "Limpiar caché";
      clearCacheButton.style.cssText = `
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 6px;
        padding: 6px 12px;
        color: #e0e0e0;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
      `;
      clearCacheButton.addEventListener("click", () => {
        if (confirm('¿Limpiar todo el caché? Las páginas se recargarán desde la API la próxima vez.')) {
          clearAllCache();
          alert('Caché limpiado. Las páginas se recargarán desde la API la próxima vez que las abras.');
        }
      });
      clearCacheButton.addEventListener('mouseenter', () => {
        clearCacheButton.style.background = '#3d3d3d';
        clearCacheButton.style.borderColor = '#555';
      });
      clearCacheButton.addEventListener('mouseleave', () => {
        clearCacheButton.style.background = '#2d2d2d';
        clearCacheButton.style.borderColor = '#404040';
      });
      
      // Botón para editar JSON
      const adminButton = document.createElement("button");
      adminButton.className = "admin-button";
      adminButton.innerHTML = "⚙️";
      adminButton.title = "Editar JSON";
      adminButton.style.cssText = `
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 6px;
        padding: 6px 12px;
        color: #e0e0e0;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
      `;
      adminButton.addEventListener("click", () => showJSONEditor(pagesConfig, roomId));
      adminButton.addEventListener('mouseenter', () => {
        adminButton.style.background = '#3d3d3d';
        adminButton.style.borderColor = '#555';
      });
      adminButton.addEventListener('mouseleave', () => {
        adminButton.style.background = '#2d2d2d';
        adminButton.style.borderColor = '#404040';
      });
      
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
  
  pagesConfig.categories.forEach(category => {
    if (!category.pages || category.pages.length === 0) return;
    
    // Filtrar páginas válidas
    const categoryPages = category.pages.filter(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http')
    );
    
    if (categoryPages.length === 0) return;
    
    // Crear contenedor de categoría
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category-group';
    categoryDiv.style.cssText = 'margin-bottom: 24px;';
    
    // Título de categoría
    const categoryTitle = document.createElement('h2');
    categoryTitle.className = 'category-title';
    categoryTitle.textContent = category.name;
    categoryTitle.style.cssText = `
      font-size: 14px;
      font-weight: 600;
      color: #999;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    categoryDiv.appendChild(categoryTitle);
    
    // Contenedor de páginas de la categoría
    const pagesContainer = document.createElement('div');
    pagesContainer.className = 'category-pages';
    pagesContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
    
    // Crear botones para cada página
    categoryPages.forEach(page => {
      const button = document.createElement("button");
      button.className = "page-button";
      button.innerHTML = `
        <div class="page-name">${page.name}</div>
        <!--div class="page-url">${page.url}</div-->
      `;
      
      button.addEventListener("click", async () => {
        await loadPageContent(page.url, page.name);
      });
      
      pagesContainer.appendChild(button);
    });
    
    categoryDiv.appendChild(pagesContainer);
    pageList.appendChild(categoryDiv);
  });
}

// Función para cargar contenido de una página
async function loadPageContent(url, name) {
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  const backButton = document.getElementById("back-button");
  const pageTitle = document.getElementById("page-title");
  const notionContent = document.getElementById("notion-content");
  
  if (pageList && notionContainer && backButton && pageTitle && notionContent) {
    pageList.classList.add("hidden");
    notionContainer.classList.remove("hidden");
    backButton.classList.remove("hidden");
    pageTitle.textContent = name;
    
    await loadNotionContent(url, notionContainer);
    
    if (!backButton.dataset.listenerAdded) {
      backButton.addEventListener("click", () => {
        pageList.classList.remove("hidden");
        notionContainer.classList.add("hidden");
        backButton.classList.add("hidden");
        pageTitle.textContent = "📚 Páginas de Notion";
        notionContainer.classList.remove("show-content");
        if (notionContent) {
          notionContent.innerHTML = "";
        }
      });
      backButton.dataset.listenerAdded = "true";
    }
  }
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
    background: #1a1a1a;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  `;
  
  // Header estilo Notion
  const header = document.createElement('div');
  header.style.cssText = `
    background: #1a1a1a;
    border-bottom: 1px solid #404040;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="back-from-editor" style="
        background: #2d2d2d;
        border: 1px solid #404040;
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
        background: #2d2d2d;
        border: 1px solid #404040;
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
          background: #2d2d2d;
          border: 1px solid #404040;
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
    resetBtn.style.background = '#3d3d3d';
    resetBtn.style.borderColor = '#555';
  });
  resetBtn.addEventListener('mouseleave', () => {
    resetBtn.style.background = '#2d2d2d';
    resetBtn.style.borderColor = '#404040';
  });
  
  saveBtn.addEventListener('mouseenter', () => {
    saveBtn.style.background = '#5aaeff';
  });
  saveBtn.addEventListener('mouseleave', () => {
    saveBtn.style.background = '#4a9eff';
  });
  
  backBtn.addEventListener('mouseenter', () => {
    backBtn.style.background = '#3d3d3d';
    backBtn.style.borderColor = '#555';
  });
  backBtn.addEventListener('mouseleave', () => {
    backBtn.style.background = '#2d2d2d';
    backBtn.style.borderColor = '#404040';
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
      textarea.style.borderColor = '#404040';
      
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
      textarea.style.borderColor = '#404040';
    }
  });
  
  // Validar JSON en tiempo real
  textarea.addEventListener('input', () => {
    try {
      JSON.parse(textarea.value);
      errorDiv.style.display = 'none';
      textarea.style.borderColor = '#404040';
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

