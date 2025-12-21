console.log('🚀 Iniciando carga de index.js...');

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

console.log('✅ OBR SDK importado');

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
    
    console.warn('⚠️ No se pudo extraer el ID de Notion de la URL:', url);
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
          const config = await import("../config/config.js");
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
          const config = await import("../config/config.js");
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
              class="notion-image-clickable"
              loading="lazy"
              onerror="this.style.display='none'; const errorDiv = document.createElement('div'); errorDiv.className='notion-image-error'; errorDiv.innerHTML = '⚠️ No se pudo cargar la imagen<br><small>La URL puede haber expirado</small><br><button onclick=\\"refreshImage(this)\\" class=\\"notion-image-error-button\\">🔄 Recargar página</button>'; this.parentElement.appendChild(errorDiv);"
              onload="console.log('✅ Imagen cargada correctamente:', this.src.substring(0, 80));"
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
    
    const userToken = getUserToken(currentRoomId);
    
    let apiUrl;
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (userToken) {
      apiUrl = `${NOTION_API_BASE}/blocks/${blockId}/children`;
      headers['Authorization'] = `Bearer ${userToken}`;
      headers['Notion-Version'] = '2022-06-28';
    } else {
      apiUrl = window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')
        ? `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}`
        : `${NOTION_API_BASE}/blocks/${blockId}/children`;
      
      if (!apiUrl.includes('/.netlify/functions/')) {
        try {
          const config = await import("../config/config.js");
          const localToken = config.NOTION_API_TOKEN;
          if (localToken && localToken !== 'tu_token_de_notion_aqui') {
            headers['Authorization'] = `Bearer ${localToken}`;
            headers['Notion-Version'] = '2022-06-28';
          }
        } catch (e) {
          // Sin token local
        }
      }
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
async function renderToggle(toggleBlock, blockTypes = null, headingLevelOffset = 0) {
  const toggle = toggleBlock.toggle;
  const toggleText = renderRichText(toggle?.rich_text);
  
  console.log('🔽 Renderizando toggle:', toggleBlock.id, {
    hasChildren: toggleBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleBlock.has_children) {
    console.log('  📦 Obteniendo hijos del toggle...');
    const children = await fetchBlockChildren(toggleBlock.id);
    console.log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset);
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
async function renderToggleHeading(toggleHeadingBlock, headingLevel, blockTypes = null, headingLevelOffset = 0) {
  const toggleHeading = toggleHeadingBlock[`heading_${headingLevel}`] || toggleHeadingBlock.toggle;
  const headingText = renderRichText(toggleHeading?.rich_text);
  
  console.log(`🔽 Renderizando toggle_heading_${headingLevel}:`, toggleHeadingBlock.id, {
    hasChildren: toggleHeadingBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleHeadingBlock.has_children) {
    console.log(`  📦 Obteniendo hijos del toggle_heading_${headingLevel}...`);
    const children = await fetchBlockChildren(toggleHeadingBlock.id);
    console.log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      // Los hijos de un toggle heading deben tener un offset de nivel +1
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1);
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
async function renderColumnList(columnListBlock, allBlocks, currentIndex, blockTypes = null, headingLevelOffset = 0) {
  console.log('📐 Renderizando column_list:', columnListBlock.id, {
    hasChildren: columnListBlock.has_children,
    currentIndex: currentIndex,
    totalBlocks: allBlocks.length
  });
  
  let columns = [];
  
  // Opción 1: Las columnas son hijos del column_list (más común)
  if (columnListBlock.has_children) {
    console.log('  📦 Obteniendo columnas como hijos del column_list...');
    const children = await fetchBlockChildren(columnListBlock.id);
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
      const children = await fetchBlockChildren(columnBlock.id);
      console.log(`    🔽 Hijos obtenidos: ${children.length}`);
      if (children.length > 0) {
        columnContent = await renderBlocks(children, blockTypes, headingLevelOffset);
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
async function renderBlocks(blocks, blockTypes = null, headingLevelOffset = 0) {
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
        const columnListHtml = await renderColumnList(block, filteredBlocks, index, blockTypes, headingLevelOffset);
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
        const toggleHtml = await renderToggle(block, blockTypes, headingLevelOffset);
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
        const toggleHeadingHtml = await renderToggleHeading(block, headingLevel, blockTypes, headingLevelOffset);
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
        const children = await fetchBlockChildren(block.id);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          // Los hijos de un heading deben tener un offset de nivel +1
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1);
          console.log(`  ✅ Contenido del heading renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo y el heading no coincide con el tipo filtrado,
        // solo mostrar el contenido de los hijos (sin el heading)
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes(type) && childrenContent.trim()) {
            // El heading no coincide con el filtro, pero tiene contenido filtrado
            html += childrenContent;
            console.log(`    ✅ Heading ${baseHeadingLevel} filtrado, solo mostrando hijos`);
            continue;
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
        const children = await fetchBlockChildren(block.id);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset);
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
        const children = await fetchBlockChildren(block.id);
        console.log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset);
          console.log(`  ✅ Contenido del quote renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo y el quote no coincide con el tipo filtrado,
        // solo mostrar el contenido de los hijos (sin el quote)
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes('quote') && childrenContent.trim()) {
            // El quote no coincide con el filtro, pero tiene contenido filtrado
            html += childrenContent;
            console.log(`    ✅ Quote filtrado, solo mostrando hijos`);
            continue;
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
    const html = await renderBlocks(blocks, blockTypes, 0);
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
      buttonContainer.className = "button-container";
      
      // Botón para limpiar caché
      const clearCacheButton = document.createElement("button");
      clearCacheButton.className = "icon-button";
      const deleteIcon = document.createElement("img");
      deleteIcon.src = "img/icon-delete.svg";
      deleteIcon.alt = "Limpiar caché";
      deleteIcon.className = "icon-button-icon";
      clearCacheButton.appendChild(deleteIcon);
      clearCacheButton.title = "Limpiar caché";
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
      // Botón para editar JSON
      const adminButton = document.createElement("button");
      adminButton.className = "icon-button admin-button";
      const jsonIcon = document.createElement("img");
      jsonIcon.src = "img/icon-json.svg";
      jsonIcon.alt = "Editar JSON";
      jsonIcon.className = "icon-button-icon";
      adminButton.appendChild(jsonIcon);
      adminButton.title = "Editar JSON";
      adminButton.addEventListener("click", () => showJSONEditor(pagesConfig, roomId));
      
      // Botón para configurar token de Notion
      const tokenButton = document.createElement("button");
      tokenButton.className = "icon-button";
      const keyIcon = document.createElement("img");
      keyIcon.src = "img/icon-key.svg";
      keyIcon.alt = "Configurar token";
      keyIcon.className = "icon-button-icon";
      tokenButton.appendChild(keyIcon);
      tokenButton.title = hasUserToken(roomId) ? "Token configurado - Clic para cambiar" : "Configurar token de Notion";
      tokenButton.addEventListener("click", () => showTokenConfig(roomId));
      
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

// Función recursiva para renderizar una categoría (puede tener subcategorías)
function renderCategory(category, parentElement, level = 0, roomId = null) {
  // Verificar si la categoría tiene contenido (páginas o subcategorías)
  const hasPages = category.pages && category.pages.length > 0;
  const hasSubcategories = category.categories && category.categories.length > 0;
  
  if (!hasPages && !hasSubcategories) return;
  
  // Filtrar páginas válidas (mantener el orden original)
  const categoryPages = hasPages ? category.pages
    .filter(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http')
    ) : [];
  
  // Si no tiene páginas válidas ni subcategorías, no renderizar
  if (categoryPages.length === 0 && !hasSubcategories) return;
  
  // Calcular indentación basada en el nivel
  const indent = level * 16; // 16px por nivel
  
  // Crear contenedor de categoría
  const categoryDiv = document.createElement('div');
  categoryDiv.className = `category-group category-level-${Math.min(level, 5)}`;
  categoryDiv.dataset.categoryName = category.name;
  categoryDiv.dataset.level = level;
  
  // Contenedor del título con botón de colapsar
  const titleContainer = document.createElement('div');
  titleContainer.className = 'category-title-container';
  
  // Botón de colapsar/expandir
  const collapseButton = document.createElement('button');
  collapseButton.className = 'category-collapse-button';
  
  // Icono de colapsar (inicialmente cerrado/expandido)
  const collapseIcon = document.createElement('img');
  collapseIcon.className = 'category-collapse-icon';
  
  // Verificar estado guardado en localStorage (usar nombre completo con nivel para evitar conflictos)
  const collapseStateKey = `category-collapsed-${category.name}-level-${level}`;
  const isCollapsed = localStorage.getItem(collapseStateKey) === 'true';
  
  collapseIcon.src = isCollapsed ? 'img/icon-closed.svg' : 'img/icon-open.svg';
  collapseIcon.alt = isCollapsed ? 'Expandir' : 'Colapsar';
  collapseButton.appendChild(collapseIcon);
  
  // Título de categoría (anidamiento de heading según el nivel)
  const headingLevel = Math.min(level + 2, 6); // nivel 0 = h2, nivel 1 = h3, ..., máximo h6
  const categoryTitle = document.createElement(`h${headingLevel}`);
  categoryTitle.className = 'category-title';
  categoryTitle.textContent = category.name;
  
  titleContainer.appendChild(collapseButton);
  titleContainer.appendChild(categoryTitle);
  categoryDiv.appendChild(titleContainer);
  
  // Contenedor de contenido (páginas y subcategorías)
  const contentContainer = document.createElement('div');
  contentContainer.className = 'category-content';
  contentContainer.style.display = isCollapsed ? 'none' : 'block';
  
  // Renderizar subcategorías primero (si existen)
  if (hasSubcategories) {
    category.categories.forEach(subcategory => {
      renderCategory(subcategory, contentContainer, level + 1, roomId);
    });
  }
  
  // Contenedor de páginas de la categoría
  if (categoryPages.length > 0) {
    const pagesContainer = document.createElement('div');
    pagesContainer.className = 'category-pages';
    
    const buttonsData = [];
    
    categoryPages.forEach((page, index) => {
      const pageId = extractNotionPageId(page.url);
      const isNotion = isNotionUrl(page.url);
      
      // Determinar icono de tipo de link
      let linkIconHtml = '';
      if (isNotion) {
        linkIconHtml = '<img src="img/icon-notion.svg" alt="Notion" class="page-link-icon">';
      } else {
        linkIconHtml = '<img src="img/icon-link.svg" alt="Link" class="page-link-icon">';
      }
      
      const button = document.createElement('button');
      button.className = 'page-button';
      button.dataset.url = page.url;
      button.dataset.selector = page.selector || '';
      button.style.cssText = `
        width: 100%;
        margin-bottom: 8px;
        background: ${CSS_VARS.bg};
        border: 1px solid ${CSS_VARS.border};
      `;
      
      // Placeholder para el icono (se cargará después)
      const placeholderColor = generateColorFromString(pageId || page.name);
      const placeholderInitial = (page.name || '?')[0].toUpperCase();
      button.innerHTML = `
        <div class="page-button-inner">
          <div class="page-icon-placeholder" style="background: ${placeholderColor};">${placeholderInitial}</div>
          <div class="page-name-text">${page.name}</div>
          ${linkIconHtml}
        </div>
      `;
      
      // Hover effect
      button.addEventListener('mouseenter', () => {
        button.style.background = CSS_VARS.hover;
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = CSS_VARS.bg;
      });
      
      // Click handler
      button.addEventListener('click', async () => {
        // Obtener blockTypes del objeto page si existe
        const blockTypes = page.blockTypes || null;
        await loadPageContent(page.url, page.name, page.selector || '', blockTypes);
      });
      
      pagesContainer.appendChild(button);
      
      buttonsData.push({ button, pageId, pageName: page.name, linkIconHtml });
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
    
    contentContainer.appendChild(pagesContainer);
  }
  
  // Manejar colapso/expansión
  titleContainer.addEventListener('click', () => {
    const newIsCollapsed = contentContainer.style.display === 'none';
    contentContainer.style.display = newIsCollapsed ? 'block' : 'none';
    collapseIcon.src = newIsCollapsed ? 'img/icon-open.svg' : 'img/icon-closed.svg';
    collapseIcon.alt = newIsCollapsed ? 'Colapsar' : 'Expandir';
    localStorage.setItem(collapseStateKey, (!newIsCollapsed).toString());
  });
  
  categoryDiv.appendChild(contentContainer);
  parentElement.appendChild(categoryDiv);
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
  
    // Mantener el orden original del JSON (sin ordenar)
    pagesConfig.categories.forEach(category => {
      renderCategory(category, pageList, 0, roomId);
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
        pageTitle.textContent = "Context";
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
        <label style="display: block; color: #fff; font-size: 14px; font-weight: 400; margin-bottom: 8px; font-family: Roboto, Helvetica, Arial, sans-serif;">
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
      
      <div style="display: flex; gap: 16px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid ${CSS_VARS.borderPrimary};">
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
  // SIEMPRE leer desde localStorage para obtener la versión más actualizada
  // El parámetro pagesConfig puede estar desactualizado
  const currentConfig = getPagesJSON(roomId) || pagesConfig || getDefaultJSON();
  console.log('📖 Abriendo editor JSON - Configuración cargada desde localStorage:', currentConfig);
  
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
    font-family: Roboto, Helvetica, Arial, sans-serif;
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
        <h1 style="font-family: Roboto, Helvetica, Arial, sans-serif; color: #fff; font-size: 18px; line-height: 24px; font-weight: 700; margin: 0;">📝 Editar Configuración</h1>
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
      <p style="color: #999; font-size: 14px; margin-bottom: 12px; font-family: Roboto, Helvetica, Arial, sans-serif; font-weight: 400;">
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
      ">${JSON.stringify(currentConfig, null, 2)}</textarea>
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
          font-weight: 400;
          font-family: Roboto, Helvetica, Arial, sans-serif;
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
          font-weight: 700;
          font-family: Roboto, Helvetica, Arial, sans-serif;
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
      
      // Obtener el JSON guardado desde localStorage para asegurar que coincida exactamente
      console.log('📖 Obteniendo JSON guardado desde localStorage...');
      // Leer inmediatamente desde localStorage (es síncrono, no necesita delay)
      const savedConfig = getPagesJSON(roomId);
      if (savedConfig) {
        // Actualizar el textarea con el JSON guardado (formateado) desde localStorage
        const formattedJSON = JSON.stringify(savedConfig, null, 2);
        textarea.value = formattedJSON;
        // Forzar actualización visual del textarea
        textarea.scrollTop = 0; // Resetear scroll
        console.log('✅ Textarea actualizado con el JSON guardado desde localStorage');
      } else {
        // Fallback: usar el parsed si no se puede obtener de localStorage
        const formattedJSON = JSON.stringify(parsed, null, 2);
        textarea.value = formattedJSON;
        textarea.scrollTop = 0;
        console.log('⚠️ Usando JSON parsed como fallback');
      }
      
      // Recargar la lista de páginas sin cerrar el editor
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

