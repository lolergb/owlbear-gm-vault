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
      // Obtener el token del usuario para verificar si es tu cuenta
      const userToken = getUserToken();
      // Construir URL con el token si existe
      let url = '/.netlify/functions/get-debug-mode';
      if (userToken) {
        url += `?token=${encodeURIComponent(userToken)}`;
      }
      
      const response = await fetch(url);
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
// Variable para cachear el rol del usuario
let cachedUserRole = null;
let roleCheckPromise = null;

// Función para obtener el rol del usuario (con caché)
async function getUserRole() {
  if (cachedUserRole !== null) {
    return cachedUserRole;
  }
  
  if (roleCheckPromise) {
    return roleCheckPromise;
  }
  
  roleCheckPromise = (async () => {
    try {
      if (typeof OBR !== 'undefined' && OBR.player && OBR.player.getRole) {
        const role = await OBR.player.getRole();
        cachedUserRole = role === 'GM';
        return cachedUserRole;
      }
    } catch (e) {
      // Si no se puede obtener el rol, asumir GM para no bloquear logs
      cachedUserRole = true;
      return cachedUserRole;
    }
    // Fallback: asumir GM
    cachedUserRole = true;
    return cachedUserRole;
  })();
  
  return roleCheckPromise;
}

function log(...args) {
  if (DEBUG_MODE) {
    // Si el rol ya está cacheado
    if (cachedUserRole === true) {
      // Es GM, mostrar log
      console.log(...args);
    } else if (cachedUserRole === false) {
      // Es jugador, no mostrar log
      return;
    } else {
      // Rol aún no verificado, verificar de forma asíncrona
      // Pero mostrar el log de todas formas si hay error (fallback para desarrollo)
      getUserRole().then(isGM => {
        if (isGM) {
          console.log(...args);
        }
      }).catch(() => {
        // Si hay error al verificar rol, no mostrar (más seguro)
      });
    }
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

// La aplicación funciona con localStorage y default-config.json
// config.js ya no es necesario - la configuración se gestiona desde la interfaz

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

// Clave para metadata de OBR.room
const ROOM_METADATA_KEY = 'com.dmscreen/pagesConfig';
const ROOM_CONTENT_CACHE_KEY = 'com.dmscreen/contentCache';
const ROOM_HTML_CACHE_KEY = 'com.dmscreen/htmlCache';
const BROADCAST_CHANNEL_REQUEST = 'com.dmscreen/requestContent';
const BROADCAST_CHANNEL_RESPONSE = 'com.dmscreen/responseContent';

// Caché local de HTML renderizado (solo en memoria del GM)
let localHtmlCache = {};

// Cache local para evitar lecturas repetidas (se sincroniza con room metadata)
let pagesConfigCache = null;

function getPagesJSON(roomId) {
  // Primero intentar desde el cache
  if (pagesConfigCache) {
    log('✅ Usando configuración desde cache');
    return pagesConfigCache;
  }
  
  // Fallback a localStorage (para compatibilidad y cuando OBR no está disponible)
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

async function savePagesJSON(json, roomId) {
  try {
    // Actualizar cache local
    pagesConfigCache = json;
    
    // Guardar en localStorage (para persistencia local)
    const storageKey = getStorageKey(roomId);
    log('💾 Guardando configuración con clave:', storageKey, 'para roomId:', roomId);
    localStorage.setItem(storageKey, JSON.stringify(json, null, 2));
    
    // Guardar en OBR.room.metadata para compartir con todos los usuarios
    try {
      await OBR.room.setMetadata({
        [ROOM_METADATA_KEY]: json
      });
      log('✅ Configuración sincronizada con room metadata');
    } catch (e) {
      console.warn('⚠️ No se pudo sincronizar con room metadata:', e);
    }
    
    log('✅ Configuración guardada exitosamente para room:', roomId);
    return true;
  } catch (e) {
    console.error('Error al guardar JSON:', e);
    return false;
  }
}

// Función para cargar configuración desde room metadata (compartida entre usuarios)
async function loadPagesFromRoomMetadata() {
  try {
    const metadata = await OBR.room.getMetadata();
    if (metadata && metadata[ROOM_METADATA_KEY]) {
      pagesConfigCache = metadata[ROOM_METADATA_KEY];
      log('✅ Configuración cargada desde room metadata');
      return pagesConfigCache;
    }
  } catch (e) {
    console.warn('⚠️ No se pudo cargar desde room metadata:', e);
  }
  return null;
}

// Listener para cambios en metadata de room (sincronización en tiempo real)
function setupRoomMetadataListener(roomId) {
  try {
    OBR.room.onMetadataChange(async (metadata) => {
      if (metadata && metadata[ROOM_METADATA_KEY]) {
        const newConfig = metadata[ROOM_METADATA_KEY];
        // Solo actualizar si es diferente
        if (JSON.stringify(newConfig) !== JSON.stringify(pagesConfigCache)) {
          log('🔄 Configuración actualizada desde room metadata');
          pagesConfigCache = newConfig;
          
          // Actualizar localStorage también
          const storageKey = getStorageKey(roomId);
          localStorage.setItem(storageKey, JSON.stringify(newConfig, null, 2));
          
          // Recargar la vista
          const pageList = document.getElementById("page-list");
          if (pageList) {
            await renderPagesByCategories(newConfig, pageList, roomId);
          }
        }
      }
    });
    log('✅ Listener de room metadata configurado');
  } catch (e) {
    console.warn('⚠️ No se pudo configurar listener de room metadata:', e);
  }
}

// Función para obtener la configuración por defecto (desde archivo público)
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
    log('⚠️ No se pudo cargar default-config.json');
  }
  
  // Fallback: configuración vacía (el usuario puede agregar páginas desde la interfaz)
  return {
    categories: [
      {
        name: "General",
        pages: []
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

// El token se gestiona desde la interfaz (botón 🔑) y se almacena en localStorage
// Se usa Netlify Function como proxy seguro en producción

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
const PAGE_INFO_CACHE_PREFIX = 'notion-page-info-cache-';

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
    
    // Si es GM, también guardar en caché compartido para jugadores
    saveToSharedCache(pageId, blocks);
  } catch (e) {
    console.error('Error al guardar en caché:', e);
    // Si el localStorage está lleno, informar al usuario
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ localStorage lleno. Considera limpiar el caché manualmente.');
    }
  }
}

// Guardar contenido en caché compartido (room metadata) para jugadores
async function saveToSharedCache(pageId, blocks) {
  try {
    // Solo guardar si es GM
    const isGM = await getUserRole();
    if (!isGM) return;
    
    // Obtener el caché compartido actual
    const metadata = await OBR.room.getMetadata();
    const sharedCache = (metadata && metadata[ROOM_CONTENT_CACHE_KEY]) || {};
    
    // Limitar el tamaño del caché compartido (máximo 50 entradas para páginas y bloques hijos)
    const cacheKeys = Object.keys(sharedCache);
    if (cacheKeys.length >= 50 && !sharedCache[pageId]) {
      // Eliminar las 10 entradas más antiguas para hacer espacio
      const sortedKeys = cacheKeys.sort((a, b) => 
        new Date(sharedCache[a].savedAt) - new Date(sharedCache[b].savedAt)
      );
      for (let i = 0; i < 10 && i < sortedKeys.length; i++) {
        delete sharedCache[sortedKeys[i]];
      }
    }
    
    // Guardar el contenido
    sharedCache[pageId] = {
      blocks: blocks,
      savedAt: new Date().toISOString()
    };
    
    await OBR.room.setMetadata({
      [ROOM_CONTENT_CACHE_KEY]: sharedCache
    });
    console.log('💾 Contenido guardado en caché compartido para:', pageId);
  } catch (e) {
    // Ignorar errores silenciosamente - el caché compartido es opcional
    console.debug('No se pudo guardar en caché compartido:', e);
  }
}

/**
 * Guardar HTML renderizado en el caché local (en memoria del GM)
 * @param {string} pageId - ID de la página de Notion
 * @param {string} html - HTML renderizado
 */
function saveHtmlToLocalCache(pageId, html) {
  // Limitar el tamaño del caché local (máximo 20 páginas)
  const keys = Object.keys(localHtmlCache);
  if (keys.length >= 20) {
    // Eliminar la entrada más antigua
    let oldestKey = keys[0];
    let oldestTime = localHtmlCache[oldestKey].savedAt || 0;
    for (const key of keys) {
      const time = localHtmlCache[key].savedAt || 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    delete localHtmlCache[oldestKey];
    console.log('🗑️ Eliminada entrada más antigua del caché HTML local:', oldestKey);
  }
  
  localHtmlCache[pageId] = {
    html: html,
    savedAt: Date.now()
  };
  console.log('💾 HTML guardado en caché local para:', pageId, '- tamaño:', html.length, 'caracteres');
}

/**
 * Solicitar HTML al GM via broadcast (para jugadores)
 * @param {string} pageId - ID de la página de Notion
 * @returns {Promise<string|null>} - HTML renderizado o null si no hay respuesta
 */
async function requestHtmlFromGM(pageId) {
  return new Promise((resolve) => {
    console.log('📡 Solicitando contenido al GM para:', pageId);
    
    // Timeout de 5 segundos
    const timeout = setTimeout(() => {
      console.log('⏰ Timeout esperando respuesta del GM');
      unsubscribe();
      resolve(null);
    }, 5000);
    
    // Escuchar respuesta del GM
    const unsubscribe = OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE, (event) => {
      const data = event.data;
      if (data && data.pageId === pageId && data.html) {
        console.log('✅ Recibido HTML del GM para:', pageId, '- tamaño:', data.html.length);
        clearTimeout(timeout);
        unsubscribe();
        resolve(data.html);
      }
    });
    
    // Enviar solicitud al GM
    OBR.broadcast.sendMessage(BROADCAST_CHANNEL_REQUEST, { pageId });
  });
}

/**
 * Configurar el GM para responder a solicitudes de contenido
 */
function setupGMContentBroadcast() {
  OBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST, async (event) => {
    const data = event.data;
    if (data && data.pageId) {
      console.log('📨 Recibida solicitud de contenido para:', data.pageId);
      
      // Buscar en caché local
      const cached = localHtmlCache[data.pageId];
      if (cached && cached.html) {
        console.log('📤 Enviando HTML cacheado para:', data.pageId);
        OBR.broadcast.sendMessage(BROADCAST_CHANNEL_RESPONSE, {
          pageId: data.pageId,
          html: cached.html
        });
      } else {
        console.log('⚠️ No hay HTML en caché local para:', data.pageId);
      }
    }
  });
  console.log('🎧 GM escuchando solicitudes de contenido');
}

/**
 * Limpiar todo el caché manualmente
 */
function clearAllCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith(PAGE_INFO_CACHE_PREFIX))) {
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
      throw new Error('No token configured. Configure your Notion token in the extension (🔑 button).');
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
/**
 * Obtener información de la página desde el caché
 */
function getCachedPageInfo(pageId) {
  try {
    const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      if (data.pageInfo) {
        console.log('✅ Información de página obtenida del caché para:', pageId);
        return data.pageInfo;
      }
    }
  } catch (e) {
    console.error('Error al leer información de página del caché:', e);
    try {
      const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
      localStorage.removeItem(cacheKey);
    } catch (e2) {
      // Ignorar errores al limpiar
    }
  }
  return null;
}

/**
 * Guardar información de la página en el caché
 */
function setCachedPageInfo(pageId, pageInfo) {
  try {
    const cacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
    const data = {
      pageInfo: pageInfo,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
    console.log('💾 Información de página guardada en caché para:', pageId);
  } catch (e) {
    console.error('Error al guardar información de página en caché:', e);
  }
}

/**
 * Obtener información de la página de Notion (incluyendo cover) con caché
 */
async function fetchNotionPageInfo(pageId, useCache = true) {
  // Intentar obtener del caché primero
  if (useCache) {
    const cachedPageInfo = getCachedPageInfo(pageId);
    if (cachedPageInfo) {
      return cachedPageInfo;
    }
  }
  
  try {
    const userToken = getUserToken();
    if (!userToken) {
      return null;
    }
    
    const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page&token=${encodeURIComponent(userToken)}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn('No se pudo obtener información de la página:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    // Guardar en caché
    setCachedPageInfo(pageId, data);
    
    return data;
  } catch (error) {
    console.warn('Error al obtener información de la página:', error);
    return null;
  }
}

/**
 * Extraer el título de una página de Notion desde pageInfo
 */
function extractPageTitle(pageInfo) {
  if (!pageInfo || !pageInfo.properties) {
    return null;
  }
  
  // El título puede estar en diferentes propiedades, pero generalmente está en 'title'
  // Buscar la propiedad de tipo 'title'
  for (const key in pageInfo.properties) {
    const prop = pageInfo.properties[key];
    if (prop && prop.type === 'title' && prop.title && prop.title.length > 0) {
      return renderRichText(prop.title);
    }
  }
  
  return null;
}

/**
 * Renderizar el cover y título de una página de Notion
 */
function renderPageCoverAndTitle(cover, pageTitle) {
  let html = '';
  
  // Renderizar cover si existe
  if (cover) {
    let coverUrl = '';
    
    // El cover puede ser external (URL) o file (archivo de Notion)
    if (cover.type === 'external' && cover.external && cover.external.url) {
      coverUrl = cover.external.url;
    } else if (cover.type === 'file' && cover.file && cover.file.url) {
      coverUrl = cover.file.url;
    }
    
    if (coverUrl) {
      // Hacer la URL absoluta si es relativa
      if (coverUrl.startsWith('/')) {
        coverUrl = 'https://www.notion.so' + coverUrl;
      }
      
      html += `
        <div class="notion-page-cover">
          <div class="notion-image-container">
            <img src="${coverUrl}" alt="Page cover" class="notion-cover-image" data-image-url="${coverUrl}" />
            <button class="notion-image-share-button" 
                    data-image-url="${coverUrl}" 
                    data-image-caption=""
                    title="Show to players">
              <img src="img/icon-players.svg" alt="Share" />
            </button>
          </div>
        </div>
      `;
    }
  }
  
  // Renderizar título si existe
  if (pageTitle) {
    html += `<h1 class="notion-page-title">${pageTitle}</h1>`;
  }
  
  return html;
}

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
      // No hay token del usuario → intentar obtener del caché compartido (room metadata)
      try {
        const metadata = await OBR.room.getMetadata();
        const sharedCache = metadata && metadata[ROOM_CONTENT_CACHE_KEY];
        if (sharedCache && sharedCache[pageId] && sharedCache[pageId].blocks) {
          console.log('✅ Usando caché compartido (room metadata) para:', pageId);
          return sharedCache[pageId].blocks;
        }
      } catch (e) {
        console.warn('No se pudo obtener caché compartido:', e);
      }
      // Si no hay caché compartido, mostrar error
      throw new Error('No token configured. Go to Settings (⚙️ button) to configure your Notion token.');
    }
    
    log('🌐 Obteniendo bloques desde la API para:', pageId);
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 401) {
        throw new Error('Invalid token or no permissions. Verify that the configured token (🔑 button) is correct and that the integration has access to this page.');
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
      // Los elementos de lista pueden tener hijos (listas anidadas)
      // Se manejan en renderBlocks de forma especial si tienen hijos
      return `<li class="notion-bulleted-list-item">${renderRichText(block.bulleted_list_item?.rich_text)}</li>`;
    
    case 'numbered_list_item':
      // Los elementos de lista pueden tener hijos (listas anidadas)
      // Se manejan en renderBlocks de forma especial si tienen hijos
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
            <div class="notion-image-container">
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
              <button class="notion-image-share-button" 
                      data-image-url="${imageUrl}" 
                      data-image-caption="${caption.replace(/"/g, '&quot;')}"
                      title="Show to players">
                <img src="img/icon-players.svg" alt="Share" />
              </button>
            </div>
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
      // No hay token del usuario → intentar obtener del caché compartido (room metadata)
      try {
        const metadata = await OBR.room.getMetadata();
        const sharedCache = metadata && metadata[ROOM_CONTENT_CACHE_KEY];
        if (sharedCache && sharedCache[blockId] && sharedCache[blockId].blocks) {
          console.log('✅ Usando caché compartido para hijos del bloque:', blockId);
          return sharedCache[blockId].blocks;
        }
      } catch (e) {
        console.warn('No se pudo obtener caché compartido para hijos:', e);
      }
      throw new Error('No token configured. Configure your Notion token in the extension (🔑 button).');
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
      hasChildren: block.has_children || false,
      order: index
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
        html += '<div class="notion-column-list">[Error loading columns]</div>';
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
        html += `<details class="notion-toggle"><summary class="notion-toggle-summary">${toggleText}</summary><div class="notion-toggle-content">[Error loading content]</div></details>`;
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
        html += `<details class="notion-toggle"><summary class="notion-toggle-summary"><${headingTag} class="notion-toggle-heading-inline-error">${headingText}</${headingTag}></summary><div class="notion-toggle-content">[Error loading content]</div></details>`;
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
      // IMPORTANTE: Cerrar lista pendiente antes de renderizar el callout para mantener el orden correcto
      if (inList && listItems.length > 0) {
        html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
        listItems = [];
        inList = false;
        listType = null;
      }
      
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
              ${childrenContent ? `<div class="notion-callout-children">${childrenContent}</div>` : ''}
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
      // IMPORTANTE: Cerrar lista pendiente antes de renderizar el callout para mantener el orden correcto
      if (inList && listItems.length > 0) {
        html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
        listItems = [];
        inList = false;
        listType = null;
      }
      
      // Verificar si el bloque coincide con el filtro antes de renderizar
      if (blockTypes) {
        const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
        if (!typesArray.includes('callout')) {
          console.log(`    ⏭️ Callout sin hijos filtrado, no se muestra`);
          continue;
        }
      }
      // Renderizar el callout sin hijos inmediatamente para mantener el orden
      try {
        const callout = block.callout;
        const icon = callout?.icon?.emoji || '💡';
        const calloutText = renderRichText(callout?.rich_text);
        html += `
          <div class="notion-callout">
            <div class="notion-callout-icon">${icon}</div>
            <div class="notion-callout-content">${calloutText}</div>
          </div>
        `;
        console.log(`    ✅ Callout sin hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar callout sin hijos:`, error);
        // Continuar con el siguiente bloque
        continue;
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
      
      // Renderizar el elemento de lista con sus hijos si los tiene
      let listItemHtml = '';
      const listItemText = type === 'bulleted_list_item' 
        ? renderRichText(block.bulleted_list_item?.rich_text)
        : renderRichText(block.numbered_list_item?.rich_text);
      
      // Si tiene hijos, obtenerlos y renderizarlos como lista anidada
      if (block.has_children) {
        try {
          console.log(`  📦 Obteniendo hijos del elemento de lista [${index}]...`);
          const children = await fetchBlockChildren(block.id, useCache);
          console.log(`  📦 Hijos obtenidos: ${children.length}`);
          
          let nestedListContent = '';
          if (children.length > 0) {
            // Renderizar los hijos recursivamente (pueden ser más elementos de lista u otros bloques)
            nestedListContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
            console.log(`  ✅ Contenido anidado renderizado: ${nestedListContent.length} caracteres`);
          }
          
          // Construir el elemento de lista con el contenido anidado
          listItemHtml = `<li class="notion-${type === 'bulleted_list_item' ? 'bulleted' : 'numbered'}-list-item">${listItemText}${nestedListContent}</li>`;
        } catch (error) {
          console.error(`Error al renderizar elemento de lista con hijos:`, error);
          // Fallback: renderizar solo el elemento sin hijos
          listItemHtml = `<li class="notion-${type === 'bulleted_list_item' ? 'bulleted' : 'numbered'}-list-item">${listItemText}</li>`;
        }
      } else {
        // Sin hijos, renderizar normalmente
        listItemHtml = `<li class="notion-${type === 'bulleted_list_item' ? 'bulleted' : 'numbered'}-list-item">${listItemText}</li>`;
      }
      
      listItems.push(listItemHtml);
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
          html += `
            <div class="empty-state notion-table-placeholder">
              <div class="empty-state-icon">⚠️</div>
              <p class="empty-state-text">Error loading table</p>
            </div>
          `;
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
      return `
        <div class="empty-state notion-table-placeholder">
          <div class="empty-state-icon">📊</div>
          <p class="empty-state-text">Tabla vacía</p>
        </div>
      `;
    }
    
    // Obtener el número de columnas de la primera fila
    const firstRow = rows[0];
    const columnCount = firstRow?.table_row?.cells?.length || 0;
    
    if (columnCount === 0) {
      return `
        <div class="empty-state notion-table-placeholder">
          <div class="empty-state-icon">📊</div>
          <p class="empty-state-text">Tabla sin columnas</p>
        </div>
      `;
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
    return `
      <div class="empty-state notion-table-placeholder">
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">Error loading table</p>
        <p class="empty-state-hint">${error.message}</p>
      </div>
    `;
  }
}

// Función para mostrar imagen en modal usando Owlbear SDK
async function showImageModal(imageUrl, caption) {
  try {
    // Asegurarse de que imageUrl sea una URL absoluta
    let absoluteImageUrl = imageUrl;
    if (imageUrl && !imageUrl.match(/^https?:\/\//i)) {
      // Si no es una URL absoluta, intentar construirla
      try {
        absoluteImageUrl = new URL(imageUrl, window.location.origin).toString();
      } catch (e) {
        console.warn('No se pudo construir URL absoluta, usando original:', imageUrl);
        absoluteImageUrl = imageUrl;
      }
    }
    
    // Construir URL del viewer con parámetros
    // Owlbear resuelve rutas relativas desde la raíz de la extensión
    // Usar window.location.origin y construir la ruta correctamente
    const currentPath = window.location.pathname;
    // Obtener el directorio base (sin el archivo actual)
    const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    const baseUrl = window.location.origin + baseDir;
    
    const viewerUrl = new URL('html/image-viewer.html', baseUrl);
    viewerUrl.searchParams.set('url', encodeURIComponent(absoluteImageUrl));
    if (caption) {
      viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
    }
    
    console.log('🔍 Abriendo modal de imagen:', {
      imageUrl: absoluteImageUrl,
      viewerUrl: viewerUrl.toString(),
      baseUrl: baseUrl,
      currentLocation: window.location.href
    });
    
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
async function attachImageClickHandlers() {
  // Manejar imágenes normales y cover
  const images = document.querySelectorAll('.notion-image-clickable, .notion-cover-image');
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
      errorDiv.className = 'empty-state notion-image-error';
      errorDiv.innerHTML = `
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">Could not load image</p>
        <p class="empty-state-hint">The URL may have expired</p>
        <button class="btn btn--sm btn--ghost">🔄 Reload page</button></div>
      `;
      
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
  
  // Manejar botones de compartir imágenes (solo para GMs)
  const isGM = await getUserRole();
  const shareButtons = document.querySelectorAll('.notion-image-share-button');
  console.log('🔍 Botones de compartir encontrados:', shareButtons.length, 'isGM:', isGM);
  shareButtons.forEach(button => {
    // Ocultar botón para jugadores
    if (!isGM) {
      button.style.display = 'none';
      return;
    }
    
    // Asegurarse de que el botón sea visible para GMs
    button.style.display = 'flex';
    // Hacer el botón más visible por defecto para GMs
    button.style.opacity = '0.7';
    
    // Click handler para compartir imagen
    button.addEventListener('click', async (e) => {
      e.stopPropagation(); // Evitar que se abra el modal
      const imageUrl = button.getAttribute('data-image-url');
      const caption = button.getAttribute('data-image-caption') || '';
      
      // Asegurarse de que la URL sea absoluta
      let absoluteImageUrl = imageUrl;
      if (imageUrl && !imageUrl.match(/^https?:\/\//i)) {
        try {
          absoluteImageUrl = new URL(imageUrl, window.location.origin).toString();
        } catch (e) {
          console.warn('No se pudo construir URL absoluta, usando original:', imageUrl);
          absoluteImageUrl = imageUrl;
        }
      }
      
      // Compartir con todos los jugadores via broadcast
      try {
        await OBR.broadcast.sendMessage('com.dmscreen/showImage', {
          url: absoluteImageUrl,
          caption: caption
        });
        console.log('📤 Imagen compartida con jugadores:', absoluteImageUrl.substring(0, 80));
        
        // Feedback visual
        const originalContent = button.innerHTML;
        button.innerHTML = '<img src="img/icon-users.svg" alt="Shared" style="opacity: 0.5;" />';
        button.disabled = true;
        setTimeout(() => {
          button.innerHTML = originalContent;
          button.disabled = false;
        }, 1000);
      } catch (error) {
        console.error('Error al compartir imagen:', error);
      }
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
  contentDiv.innerHTML = `
    <div class="empty-state notion-loading">
      <div class="empty-state-icon">⏳</div>
      <p class="empty-state-text">Cargando contenido...</p>
    </div>
  `;
  contentDiv.style.display = 'block';
  container.classList.add('show-content');
  
  try {
    // Extraer ID de la página
    const pageId = extractNotionPageId(url);
    if (!pageId) {
      throw new Error('No se pudo extraer el ID de la página desde la URL');
    }
    
    const userToken = getUserToken();
    const isGM = await getUserRole();
    
    // Si el jugador no tiene token, solicitar HTML al GM via broadcast
    if (!userToken && !isGM) {
      console.log('👤 Jugador sin token, solicitando HTML al GM para:', pageId);
      const cachedHtml = await requestHtmlFromGM(pageId);
      if (cachedHtml) {
        console.log('✅ Usando HTML recibido del GM');
        contentDiv.innerHTML = cachedHtml;
        await attachImageClickHandlers();
        return;
      }
      console.log('⚠️ El GM no tiene el contenido disponible');
      // Sin HTML disponible, mostrar mensaje de espera con botón de reintentar
      contentDiv.innerHTML = `
        <div class="notion-waiting">
          <div class="notion-waiting-icon">⏳</div>
          <p class="notion-waiting-text">Waiting for the GM to load this content...</p>
          <p class="notion-waiting-hint">The GM needs to view this page first to make it available.</p>
          <button class="btn btn--sm btn--secondary notion-retry-button">Retry</button>
        </div>
      `;
      
      // Agregar event listener al botón de reintentar
      const retryButton = contentDiv.querySelector('.notion-retry-button');
      if (retryButton) {
        retryButton.addEventListener('click', async () => {
          retryButton.disabled = true;
          retryButton.textContent = 'Requesting...';
          // Reintentar carga
          await loadNotionContent(url, container, false, blockTypes);
        });
      }
      
      return;
    }
    
    console.log('Obteniendo bloques para página:', pageId, forceRefresh ? '(recarga forzada - sin caché)' : '(con caché)');
    
    // Obtener bloques (usar caché a menos que se fuerce la recarga)
    // Si forceRefresh es true, pasamos useCache = false para ignorar el caché
    const useCache = !forceRefresh;
    console.log('📋 Parámetros fetchNotionBlocks - useCache:', useCache, 'forceRefresh:', forceRefresh);
    const blocks = await fetchNotionBlocks(pageId, useCache);
    console.log('Bloques obtenidos:', blocks.length);
    
    if (blocks.length === 0) {
      contentDiv.innerHTML = `
        <div class="empty-state notion-loading">
          <div class="empty-state-icon">📄</div>
          <p class="empty-state-text">No content found on this page.</p>
        </div>
      `;
      return;
    }
    
    // Obtener información de la página (incluyendo cover y título) si es una URL de Notion
    // Usar caché a menos que se fuerce la recarga
    let pageCover = null;
    let pageTitle = null;
    if (url.includes('notion.so') || url.includes('notion.site')) {
      const pageInfo = await fetchNotionPageInfo(pageId, useCache);
      if (pageInfo) {
        if (pageInfo.cover) {
          pageCover = pageInfo.cover;
        }
        // Extraer el título de la página
        pageTitle = extractPageTitle(pageInfo);
      }
    }
    
    // Renderizar bloques (ahora es async)
    // El filtrado por blockTypes se hace dentro de renderBlocks para mantener bloques con hijos
    // Si es recarga forzada, no usar caché para los hijos
    const useCacheForChildren = !forceRefresh;
    const blocksHtml = await renderBlocks(blocks, blockTypes, 0, useCacheForChildren);
    
    // Agregar el cover y título al inicio si existen
    const coverAndTitleHtml = renderPageCoverAndTitle(pageCover, pageTitle);
    const html = coverAndTitleHtml + blocksHtml;
    
    contentDiv.innerHTML = html;
    
    // Si es GM, guardar el HTML renderizado en caché local para responder a jugadores
    if (isGM) {
      saveHtmlToLocalCache(pageId, html);
    }
    
    // Agregar event listeners a las imágenes para abrirlas en modal
    await attachImageClickHandlers();
    
  } catch (error) {
    console.error('Error al cargar contenido de Notion:', error);
    contentDiv.innerHTML = `
      <div class="notion-error">
        <strong>Error loading content:</strong><br>
        ${error.message}<br><br>
        <button onclick="window.open('${url}', '_blank')" class="btn btn--sm btn--primary">Open in Notion</button>
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
      <button id="open-notion-window" class="btn btn--primary">Open in new window</button>
    </div>
  `;
  
  const openButton = container.querySelector('#open-notion-window');
  if (openButton) {
    openButton.addEventListener('click', () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
}

// ============================================
// MENÚ CONTEXTUAL PARA TOKENS
// ============================================

// Namespace para metadatos
const METADATA_KEY = "com.dmscreen";

// Función para configurar menús contextuales en tokens
async function setupTokenContextMenus(pagesConfig, roomId) {
  try {
    console.log('🎯 Configurando menús contextuales para tokens...');
    
    // Obtener la URL base para los iconos (debe ser absoluta)
    const baseUrl = window.location.origin;
    
    // Menú: Vincular página (solo GM)
    await OBR.contextMenu.create({
      id: `${METADATA_KEY}/link-page`,
      icons: [
        {
          icon: `${baseUrl}/img/icon-page.svg`,
          label: "Link page",
          filter: {
            every: [{ key: "layer", value: "CHARACTER" }],
            roles: ["GM"]
          }
        }
      ],
      onClick: async (context) => {
        const item = context.items[0];
        if (!item) return;
        
        // Primero abrir el panel de la extensión
        await OBR.action.open();
        
        // Pequeña espera para que el panel se abra
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Mostrar selector de páginas
        showPageSelectorForToken(item.id, pagesConfig, roomId);
      }
    });
    
    // Menú: Ver página vinculada (todos, si tiene página)
    await OBR.contextMenu.create({
      id: `${METADATA_KEY}/view-page`,
      icons: [
        {
          icon: `${baseUrl}/img/icon-view-page.svg`,
          label: "View linked page",
          filter: {
            every: [
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", `${METADATA_KEY}/pageUrl`], value: undefined, operator: "!=" }
            ]
          }
        }
      ],
      onClick: async (context) => {
        const item = context.items[0];
        if (!item) return;
        
        const pageUrl = item.metadata[`${METADATA_KEY}/pageUrl`];
        const pageName = item.metadata[`${METADATA_KEY}/pageName`] || "Linked page";
        
        if (pageUrl) {
          // Primero abrir el panel de la extensión
          await OBR.action.open();
          
          // Pequeña espera para que el panel se abra
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Abrir la página usando la función existente
          await loadPageContent(pageUrl, pageName);
        }
      }
    });
    
    // Menú: Desvincular página (solo GM)
    await OBR.contextMenu.create({
      id: `${METADATA_KEY}/unlink-page`,
      icons: [
        {
          icon: `${baseUrl}/img/icon-trash.svg`,
          label: "Unlink page",
          filter: {
            every: [
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", `${METADATA_KEY}/pageUrl`], value: undefined, operator: "!=" }
            ],
            roles: ["GM"]
          }
        }
      ],
      onClick: async (context) => {
        const item = context.items[0];
        if (!item) return;
        
        // Eliminar metadatos de página
        await OBR.scene.items.updateItems([item], (items) => {
          delete items[0].metadata[`${METADATA_KEY}/pageUrl`];
          delete items[0].metadata[`${METADATA_KEY}/pageName`];
          delete items[0].metadata[`${METADATA_KEY}/pageIcon`];
        });
        
        console.log('🗑️ Página desvinculada del token:', item.name || item.id);
      }
    });
    
    console.log('✅ Menús contextuales para tokens configurados');
    
  } catch (error) {
    console.error('❌ Error al configurar menús contextuales:', error);
  }
}

// Función para mostrar selector de páginas para vincular a un token
function showPageSelectorForToken(itemId, pagesConfig, roomId) {
  // Recopilar todas las páginas de la configuración
  const allPages = [];
  
  function collectPages(categories, path = []) {
    if (!categories) return;
    
    for (const category of categories) {
      const currentPath = [...path, category.name];
      
      if (category.pages) {
        for (const page of category.pages) {
          if (page.url) {
            allPages.push({
              name: page.name,
              url: page.url,
              path: currentPath.join(' / '),
              icon: page.icon || null
            });
          }
        }
      }
      
      if (category.categories) {
        collectPages(category.categories, currentPath);
      }
    }
  }
  
  collectPages(pagesConfig.categories);
  
  if (allPages.length === 0) {
    alert('No pages configured. Add pages from the main panel.');
    return;
  }
  
  // Crear opciones para el select
  const pageOptions = allPages.map((page, index) => ({
    label: `${page.path} → ${page.name}`,
    value: index.toString()
  }));
  
  // Mostrar modal de selección
  showModalForm(
    'Link page to token',
    [
      {
        name: 'pageIndex',
        label: 'Select a page',
        type: 'select',
        options: pageOptions,
        required: true
      }
    ],
    async (data) => {
      const selectedPage = allPages[parseInt(data.pageIndex)];
      
      if (!selectedPage) {
        alert('Error: page not found');
        return;
      }
      
      try {
        // Obtener el item y actualizar sus metadatos
        const items = await OBR.scene.items.getItems([itemId]);
        if (items.length === 0) {
          alert('Error: token not found');
          return;
        }
        
        await OBR.scene.items.updateItems([items[0]], (updateItems) => {
          updateItems[0].metadata[`${METADATA_KEY}/pageUrl`] = selectedPage.url;
          updateItems[0].metadata[`${METADATA_KEY}/pageName`] = selectedPage.name;
          updateItems[0].metadata[`${METADATA_KEY}/pageIcon`] = selectedPage.icon;
        });
        
        console.log('✅ Página vinculada al token:', selectedPage.name);
        alert(`✅ Page "${selectedPage.name}" linked to token`);
        
      } catch (error) {
        console.error('Error al vincular página:', error);
        alert('Error linking page: ' + error.message);
      }
    },
    () => {
      // Cancelar - no hacer nada
    }
  );
}

// Intentar inicializar Owlbear con manejo de errores
console.log('🔄 Intentando inicializar Owlbear SDK...');

// Inicializar modo debug al cargar
initDebugMode();

try {
  OBR.onReady(async () => {
    try {
      // Verificar rol primero para filtrar logs
      const isGM = await getUserRole();
      
      if (isGM) {
        console.log('✅ Owlbear SDK listo');
        console.log('🌐 URL actual:', window.location.href);
        console.log('🔗 Origen:', window.location.origin);
        
        // Configurar el GM para responder a solicitudes de contenido de jugadores
        setupGMContentBroadcast();
      }
      
      // Obtener ID de la room actual
      let roomId = null;
      try {
        // Intentar obtener el ID de la room usando la propiedad directa
        roomId = OBR.room.id;
        if (isGM) {
          console.log('🏠 Room ID obtenido (OBR.room.id):', roomId);
          console.log('🏠 Tipo de roomId:', typeof roomId);
          console.log('🏠 Longitud de roomId:', roomId ? roomId.length : 0);
        }
        
        // Si no funciona, intentar con el método async
        if (!roomId) {
          if (isGM) {
            console.log('🔄 Intentando con OBR.room.getId()...');
          }
          roomId = await OBR.room.getId();
          if (isGM) {
            console.log('🏠 Room ID obtenido (OBR.room.getId()):', roomId);
          }
        }
      } catch (e) {
        if (isGM) {
          console.warn('⚠️ No se pudo obtener el ID de la room:', e);
        }
        // Intentar obtener desde el contexto o la URL
        try {
          const context = await OBR.context.getId();
          if (isGM) {
            console.log('🏠 Context ID obtenido:', context);
          }
          roomId = context;
        } catch (e2) {
          if (isGM) {
            console.warn('⚠️ No se pudo obtener Context ID:', e2);
          }
          // Intentar extraer de la URL
          const urlParams = new URLSearchParams(window.location.search);
          const obrref = urlParams.get('obrref');
          if (obrref) {
            if (isGM) {
              console.log('🏠 Usando obrref de URL:', obrref);
            }
            roomId = obrref;
          } else {
            if (isGM) {
              console.warn('⚠️ No se encontró obrref en URL, usando "default"');
            }
            roomId = 'default';
          }
        }
      }
      
      // Verificar que roomId no sea null o undefined
      if (!roomId) {
        if (isGM) {
          console.warn('⚠️ roomId es null/undefined, usando "default"');
        }
        roomId = 'default';
      }
      
      if (isGM) {
        console.log('✅ Room ID final que se usará:', roomId);
      }
      
      // Cargar configuración desde JSON (específica para esta room)
      log('🔍 Intentando cargar configuración para room:', roomId);
      
      // Declarar pagesConfig al inicio para que esté disponible en todo el scope
      let pagesConfig = null;
      
      // Función auxiliar para contar contenido (páginas y carpetas anidadas)
      const countContent = (config) => {
        if (!config || !config.categories || !Array.isArray(config.categories)) return 0;
        let count = 0;
        const countRecursive = (cats) => {
          if (!cats || !Array.isArray(cats)) return;
          cats.forEach(cat => {
            // Contar páginas válidas (con URL válida)
            if (cat.pages && Array.isArray(cat.pages)) {
              const validPages = cat.pages.filter(p => 
                p && p.url && 
                !p.url.includes('...') && 
                p.url.startsWith('http')
              );
              count += validPages.length;
            }
            // Contar carpetas (solo si tienen nombre)
            if (cat.categories && Array.isArray(cat.categories)) {
              const validCategories = cat.categories.filter(c => c && c.name);
              count += validCategories.length;
              countRecursive(validCategories);
            }
          });
        };
        countRecursive(config.categories);
        return count;
      };
      
      // PRIORIDAD: 1) Room metadata (compartida), 2) localStorage, 3) default
      // Primero intentar cargar desde room metadata (configuración compartida entre usuarios)
      const roomMetadataConfig = await loadPagesFromRoomMetadata();
      
      // Obtener configuraciones de localStorage como fallback
      const currentRoomConfig = getPagesJSON(roomId);
      const defaultConfig = getPagesJSON('default');
      
      // Contar contenido de cada una
      const roomMetadataCount = countContent(roomMetadataConfig);
      const currentRoomCount = countContent(currentRoomConfig);
      const defaultCount = countContent(defaultConfig);
      
      // Solo mostrar logs de debug si es GM
      if (isGM) {
        console.log('🔍 Configuración room metadata - elementos:', roomMetadataCount);
        console.log('🔍 Configuración localStorage roomId:', roomId, '- elementos:', currentRoomCount);
        console.log('🔍 Configuración default - elementos:', defaultCount);
      }
      
      // Prioridad: room metadata > localStorage > default
      if (roomMetadataCount > 0) {
        log('✅ Usando configuración desde room metadata (compartida) con', roomMetadataCount, 'elementos');
        pagesConfig = roomMetadataConfig;
      } else if (currentRoomCount >= defaultCount && currentRoomCount > 0) {
        log('✅ Usando configuración del localStorage roomId:', roomId, 'con', currentRoomCount, 'elementos');
        pagesConfig = currentRoomConfig;
        // Sincronizar con room metadata para que otros usuarios la vean
        await savePagesJSON(pagesConfig, roomId);
      } else if (defaultCount > 0) {
        log('✅ Usando configuración "default" con', defaultCount, 'elementos (tiene más contenido)');
        pagesConfig = defaultConfig;
        // Copiar la configuración default al roomId actual para futuras ediciones
        await savePagesJSON(defaultConfig, roomId);
        log('💾 Configuración "default" copiada a roomId:', roomId);
      } else if (currentRoomConfig) {
        log('⚠️ Ambas configuraciones vacías, usando la del roomId');
        pagesConfig = currentRoomConfig;
      }
      
      // Si no hay ninguna configuración, crear una nueva por defecto
      if (!pagesConfig) {
        log('📝 No se encontró ninguna configuración, creando una nueva por defecto');
        pagesConfig = await getDefaultJSON();
        await savePagesJSON(pagesConfig, roomId);
        log('✅ Configuración por defecto creada para room:', roomId);
      }
      
      // Configurar listener para sincronización en tiempo real
      setupRoomMetadataListener(roomId);

      // Solo mostrar logs de debug si es GM
      if (isGM) {
        console.log('📊 Configuración cargada para room:', roomId);
        console.log('📊 Número de carpetas:', pagesConfig?.categories?.length || 0);
      }
      
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
      const settingsButton = document.createElement("button");
      settingsButton.className = "icon-button";
      const keyIcon = document.createElement("img");
      keyIcon.src = "img/icon-json.svg";
      keyIcon.alt = "Settings";
      keyIcon.className = "icon-button-icon";
      settingsButton.appendChild(keyIcon);
      settingsButton.title = hasUserToken() ? "Settings (Token configured)" : "Settings";
      settingsButton.addEventListener("click", () => showSettings());
      
      // Botón para agregar (carpeta o página)
      const addButton = document.createElement("button");
      addButton.className = "icon-button";
      const addIcon = document.createElement("img");
      addIcon.src = "img/icon-add.svg";
      addIcon.alt = "Add";
      addIcon.className = "icon-button-icon";
      addButton.appendChild(addIcon);
      addButton.title = "Add folder or page";
      addButton.addEventListener("click", async (e) => {
        const rect = addButton.getBoundingClientRect();
        const menuItems = [
          { 
            icon: 'img/folder-close.svg', 
            text: 'Add folder', 
            action: async () => {
              await addCategoryToPageList([], roomId);
            }
          },
          { 
            icon: 'img/icon-page.svg', 
            text: 'Add page', 
            action: async () => {
              await addPageToPageListWithCategorySelector([], roomId);
            }
          }
        ];
        
        // Marcar como activo mientras el menú está abierto
        addButton.classList.add('context-menu-active');
        
        // Posicionar el menú a 8px del botón
        createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 8 }, () => {
          // Callback cuando se cierra el menú
          addButton.classList.remove('context-menu-active');
        });
      });
      
      // Botón para colapsar/expandir todas las carpetas
      const collapseAllButton = document.createElement("button");
      collapseAllButton.className = "icon-button";
      collapseAllButton.id = "collapse-all-button";
      const collapseIcon = document.createElement("img");
      collapseIcon.src = "img/icon-collapse-false.svg"; // false = expandidas
      collapseIcon.alt = "Collapse all";
      collapseIcon.className = "icon-button-icon";
      collapseAllButton.appendChild(collapseIcon);
      collapseAllButton.title = "Collapse all folders";
      collapseAllButton.dataset.collapsed = "false";
      
      collapseAllButton.addEventListener("click", () => {
        const isCollapsed = collapseAllButton.dataset.collapsed === "true";
        const newState = !isCollapsed;
        
        // Actualizar icono y estado
        collapseIcon.src = newState ? "img/icon-collapse-false.svg" : "img/icon-collapse-true.svg";
        collapseAllButton.dataset.collapsed = newState.toString();
        collapseAllButton.title = newState ? "Expand all folders" : "Collapse all folders";
        
        // Colapsar o expandir todas las carpetas
        const categories = document.querySelectorAll('.category-group');
        categories.forEach(categoryDiv => {
          const contentContainer = categoryDiv.querySelector('.category-content');
          const collapseBtn = categoryDiv.querySelector('.category-collapse-button img');
          const categoryName = categoryDiv.dataset.categoryName;
          const level = categoryDiv.dataset.level;
          
          if (contentContainer && collapseBtn && categoryName) {
            if (newState) {
              // Colapsar
              contentContainer.style.display = 'none';
              collapseBtn.src = 'img/folder-close.svg';
            } else {
              // Expandir
              contentContainer.style.display = 'block';
              collapseBtn.src = 'img/folder-open.svg';
            }
            
            // Guardar estado en localStorage (usar la misma clave que renderCategory)
            const collapseStateKey = `category-collapsed-${categoryName}-level-${level}`;
            localStorage.setItem(collapseStateKey, newState.toString());
          }
        });
      });
      
      // Solo mostrar botones de administración para GMs
      if (isGM) {
        buttonContainer.appendChild(settingsButton);
        buttonContainer.appendChild(collapseAllButton);
        buttonContainer.appendChild(addButton);
        header.appendChild(buttonContainer);
      }

      // Renderizar páginas agrupadas por carpetas
      await renderPagesByCategories(pagesConfig, pageList, roomId);
      
      // Registrar menús contextuales para tokens
      await setupTokenContextMenus(pagesConfig, roomId);
      
      // Listener para recibir imágenes compartidas por el GM
      OBR.broadcast.onMessage('com.dmscreen/showImage', async (event) => {
        const { url, caption } = event.data;
        if (url) {
          // Abrir la imagen en modal para este jugador
          await showImageModal(url, caption);
        }
      });
      
    } catch (error) {
      console.error('❌ Error dentro de OBR.onReady:', error);
      console.error('Stack:', error.stack);
      const pageList = document.getElementById("page-list");
      if (pageList) {
        pageList.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🚨</div>
            <p class="empty-state-text">Error loading extension</p>
            <p class="empty-state-hint">Verifica la consola para más detalles</p>
            <p class="empty-state-hint">${error.message || 'Error desconocido'}</p>
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
        <div class="empty-state-icon">🚨</div>
        <p class="empty-state-text">Error crítico al cargar la extensión</p>
        <p class="empty-state-hint">Verifica la consola para más detalles</p>
        <p class="empty-state-hint">${error.message || 'Error desconocido'}</p>
      </div>
    `;
  }
}

// Función para verificar recursivamente si una categoría tiene contenido visible para jugadores
function hasVisibleContentForPlayers(category) {
  // Verificar si tiene páginas visibles
  if (category.pages && category.pages.length > 0) {
    const hasVisiblePages = category.pages.some(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http') &&
      page.visibleToPlayers === true
    );
    if (hasVisiblePages) return true;
  }
  
  // Verificar recursivamente en subcategorías
  if (category.categories && category.categories.length > 0) {
    return category.categories.some(subCat => hasVisibleContentForPlayers(subCat));
  }
  
  return false;
}

// Función recursiva para renderizar una carpeta (puede tener subcarpetas)
function renderCategory(category, parentElement, level = 0, roomId = null, categoryPath = [], isGM = true) {
  // Si el usuario es jugador, verificar si la carpeta tiene contenido visible antes de renderizarla
  if (!isGM && !hasVisibleContentForPlayers(category)) {
    return; // No renderizar carpetas vacías o sin contenido visible para jugadores
  }
  
  // Verificar si la carpeta tiene contenido (páginas o subcarpetas)
  const hasPages = category.pages && category.pages.length > 0;
  const hasSubcategories = category.categories && category.categories.length > 0;
  
  // Filtrar páginas válidas (mantener el orden original)
  // Si el usuario es jugador (no GM), solo mostrar páginas marcadas como visibleToPlayers
  let categoryPages = hasPages ? category.pages
    .filter(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http')
    ) : [];
  
  // Si el usuario es jugador, filtrar solo las páginas visibles para jugadores
  if (!isGM) {
    categoryPages = categoryPages.filter(page => page.visibleToPlayers === true);
  }
  
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
  collapseIcon.alt = isCollapsed ? 'Expand' : 'Collapse';
  collapseButton.appendChild(collapseIcon);
  
  // Título de carpeta (anidamiento de heading según el nivel)
  const headingLevel = Math.min(level + 2, 6); // nivel 0 = h2, nivel 1 = h3, ..., máximo h6
  const categoryTitle = document.createElement(`h${headingLevel}`);
  categoryTitle.className = 'category-title';
  categoryTitle.textContent = category.name;
  
  // Verificar si la carpeta tiene contenido visible para jugadores
  const isCategoryVisible = hasVisibleContentForPlayers(category);
  
  // Botón de toggle de visibilidad para carpetas (mostrar/ocultar todas las páginas)
  const categoryVisibilityButton = document.createElement('button');
  categoryVisibilityButton.className = 'category-visibility-button icon-button';
  const categoryVisibilityIcon = document.createElement('img');
  categoryVisibilityIcon.src = isCategoryVisible ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
  categoryVisibilityIcon.className = 'icon-button-icon';
  categoryVisibilityButton.appendChild(categoryVisibilityIcon);
  categoryVisibilityButton.title = isCategoryVisible ? 'Has visible pages (click to hide all)' : 'No visible pages (click to show all)';
  // El botón de visibilidad siempre es visible si la categoría tiene contenido visible
  categoryVisibilityButton.style.opacity = isCategoryVisible ? '1' : '0';
  
  // Click handler para toggle de visibilidad de carpeta
  categoryVisibilityButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Toggle: si tiene contenido visible, ocultar todo; si no, mostrar todo
    await toggleCategoryVisibility(category, categoryPath, roomId, !isCategoryVisible);
  });
  
  // Botón de menú contextual para carpetas
  const contextMenuButton = document.createElement('button');
  contextMenuButton.className = 'category-context-menu-button icon-button';
  // Estilos movidos a CSS - solo opacity se controla dinámicamente
  const contextMenuIcon = document.createElement('img');
  contextMenuIcon.src = 'img/icon-contextualmenu.svg';
  contextMenuIcon.className = 'icon-button-icon';
  contextMenuButton.appendChild(contextMenuIcon);
  contextMenuButton.title = 'Menú';
  
  // Mostrar botones al hover (solo para GMs)
  if (isGM) {
    titleContainer.addEventListener('mouseenter', () => {
      if (!contextMenuButton.classList.contains('context-menu-active')) {
        contextMenuButton.style.opacity = '1';
        // categoryVisibilityButton.style.opacity = '1'; // Temporalmente oculto
      }
    });
    titleContainer.addEventListener('mouseleave', (e) => {
      // No ocultar si el menú contextual está activo
      if (contextMenuButton.classList.contains('context-menu-active')) {
        return;
      }
      // No ocultar si el mouse está sobre los botones
      if (!e.relatedTarget || (!e.relatedTarget.closest('.category-context-menu-button') && !e.relatedTarget.closest('.category-visibility-button') && !e.relatedTarget.closest('#context-menu'))) {
        contextMenuButton.style.opacity = '0';
        // Solo ocultar el botón de visibilidad si la categoría no tiene contenido visible
        // Temporalmente oculto
        // if (!isCategoryVisible) {
        //   categoryVisibilityButton.style.opacity = '0';
        // }
      }
    });
  }
  
  // Menú contextual para carpetas (solo para GMs)
  if (isGM) {
  contextMenuButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const rect = contextMenuButton.getBoundingClientRect();
    
    // Obtener información para determinar si se puede mover arriba/abajo (usando orden combinado)
    const config = getPagesJSON(roomId) || await getDefaultJSON();
    const parentPath = categoryPath.slice(0, -2);
    const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
    const index = categoryPath[categoryPath.length - 1];
    const combinedOrder = getCombinedOrder(parent);
    const currentPos = combinedOrder.findIndex(o => o.type === 'category' && o.index === index);
    const canMoveUp = currentPos > 0;
    const canMoveDown = currentPos !== -1 && currentPos < combinedOrder.length - 1;
    
    const menuItems = [
      { 
        icon: 'img/folder-close.svg', 
        text: 'Add folder', 
        action: async () => {
          await addCategoryToPageList(categoryPath, roomId);
        }
      },
      { 
        icon: 'img/icon-page.svg', 
        text: 'Add page', 
        action: async () => {
          // Pasar categoryPath para que se autocomplete en el modal
          await addPageToPageListWithCategorySelector(categoryPath, roomId);
        }
      },
      { separator: true },
      { 
        icon: 'img/icon-edit.svg', 
        text: 'Edit', 
        action: async () => {
          await editCategoryFromPageList(category, categoryPath, roomId);
        }
      },
      { 
        icon: 'img/icon-clone.svg', 
        text: 'Duplicate', 
        action: async () => {
          await duplicateCategoryFromPageList(category, categoryPath, roomId);
        }
      },
      { separator: true },
    ];
    
    // Agregar opciones de mover si es posible
    if (canMoveUp || canMoveDown) {
      if (canMoveUp) {
        menuItems.push({
          icon: 'img/icon-arrow.svg',
          text: 'Move up',
          action: async () => {
            await moveCategoryUp(category, categoryPath, roomId);
          }
        });
      }
      if (canMoveDown) {
        menuItems.push({
          icon: 'img/icon-arrow.svg',
          text: 'Move down',
          action: async () => {
            await moveCategoryDown(category, categoryPath, roomId);
          }
        });
      }
      menuItems.push({ separator: true });
    }
    
    menuItems.push({
      icon: 'img/icon-trash.svg', 
      text: 'Delete', 
      action: async () => {
        await deleteCategoryFromPageList(category, categoryPath, roomId);
      }
    });
    
    // Marcar como activo mientras el menú está abierto
    contextMenuButton.classList.add('context-menu-active');
    titleContainer.classList.add('context-menu-open');
    
    // Posicionar el menú a 8px del botón
    createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 4 }, () => {
      // Callback cuando se cierra el menú
      contextMenuButton.classList.remove('context-menu-active');
      titleContainer.classList.remove('context-menu-open');
      contextMenuButton.style.opacity = '0';
    });
  });
  } // fin de if (isGM) para menú contextual de carpetas
  
  titleContainer.appendChild(collapseButton);
  titleContainer.appendChild(categoryTitle);
  // Solo mostrar botones de administración para GMs
  if (isGM) {
    // Botón de visibilidad temporalmente oculto
    // titleContainer.appendChild(categoryVisibilityButton);
    titleContainer.appendChild(contextMenuButton);
  }
  categoryDiv.appendChild(titleContainer);
  
  // Contenedor de contenido (páginas y subcarpetas)
  const contentContainer = document.createElement('div');
  contentContainer.className = 'category-content';
  // Mostrar el contenido si no está colapsado Y si tiene contenido o si está vacía (para poder agregar)
  const hasContent = hasSubcategories || categoryPages.length > 0;
  contentContainer.style.display = isCollapsed ? 'none' : 'block';
  
  // Obtener el orden combinado de elementos (carpetas y páginas mezcladas)
  const combinedOrder = getCombinedOrder(category);
    const buttonsData = [];
    
  // Renderizar elementos según el orden combinado
  combinedOrder.forEach(item => {
    if (item.type === 'category' && category.categories && category.categories[item.index]) {
      const subcategory = category.categories[item.index];
      const subcategoryPath = [...categoryPath, 'categories', item.index];
      renderCategory(subcategory, contentContainer, level + 1, roomId, subcategoryPath, isGM);
    } else if (item.type === 'page' && category.pages && category.pages[item.index]) {
      // Si el usuario es jugador, verificar si la página es visible antes de renderizarla
      const page = category.pages[item.index];
      if (!isGM && page.visibleToPlayers !== true) {
        return; // Saltar esta página si el usuario es jugador y la página no es visible
      }
      const index = item.index;
      const pageId = extractNotionPageId(page.url);
      const isNotion = isNotionUrl(page.url);
      const isDndbeyondUrl = isDndbeyond(page.url);
      
      // Determinar icono de tipo de link usando getLinkType para detectar PDFs y otros tipos
      let linkIconHtml = '';
      if (isNotion) {
        linkIconHtml = '<img src="img/icon-notion.svg" alt="Notion" class="page-link-icon">';
      } else if (isDndbeyondUrl) {
        linkIconHtml = '<img src="img/icon-dnd.svg" alt="D&D Beyond" class="page-link-icon">';
      } else {
        // Usar getLinkType para detectar PDFs, imágenes, etc.
        const linkTypeInfo = getLinkType(page.url);
        linkIconHtml = `<img src="img/${linkTypeInfo.icon}" alt="${linkTypeInfo.type}" class="page-link-icon">`;
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
      
      // Botón de toggle de visibilidad para jugadores
      const pageVisibilityButton = document.createElement('button');
      pageVisibilityButton.className = 'page-visibility-button icon-button';
      const pageVisibilityIcon = document.createElement('img');
      const isPageVisible = page.visibleToPlayers === true;
      pageVisibilityIcon.src = isPageVisible ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
      pageVisibilityIcon.className = 'icon-button-icon';
      pageVisibilityButton.appendChild(pageVisibilityIcon);
      pageVisibilityButton.title = isPageVisible ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
      // El botón de visibilidad siempre es visible si la página está compartida
      pageVisibilityButton.style.opacity = isPageVisible ? '1' : '0';
      
      // Click handler para toggle de visibilidad
      pageVisibilityButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        await togglePageVisibility(page, categoryPath, roomId);
      });
      
      // Botón de menú contextual para páginas
      const pageContextMenuButton = document.createElement('button');
      pageContextMenuButton.className = 'page-context-menu-button icon-button';
      // Estilos movidos a CSS - solo opacity se controla dinámicamente
      const pageContextMenuIcon = document.createElement('img');
      pageContextMenuIcon.src = 'img/icon-contextualmenu.svg';
      pageContextMenuIcon.className = 'icon-button-icon';
      pageContextMenuButton.appendChild(pageContextMenuIcon);
      pageContextMenuButton.title = 'Menú';
      
      // Mostrar botones al hover (solo para GMs)
      if (isGM) {
        button.addEventListener('mouseenter', () => {
          if (!pageContextMenuButton.classList.contains('context-menu-active')) {
            pageContextMenuButton.style.opacity = '1';
            pageVisibilityButton.style.opacity = '1';
          }
        });
        button.addEventListener('mouseleave', (e) => {
          // No ocultar si el menú contextual está activo
          if (pageContextMenuButton.classList.contains('context-menu-active')) {
            return;
          }
          // No ocultar si el mouse está sobre los botones
          if (!e.relatedTarget || (!e.relatedTarget.closest('.page-context-menu-button') && !e.relatedTarget.closest('.page-visibility-button') && !e.relatedTarget.closest('#context-menu'))) {
            pageContextMenuButton.style.opacity = '0';
            // Solo ocultar el botón de visibilidad si la página no está visible para jugadores
            if (!isPageVisible) {
              pageVisibilityButton.style.opacity = '0';
            }
          }
        });
      }
      
      // Menú contextual para páginas (solo para GMs)
      if (isGM) {
      pageContextMenuButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rect = pageContextMenuButton.getBoundingClientRect();
        const config = getPagesJSON(roomId) || await getDefaultJSON();
        // Obtener el path de la carpeta padre para agregar páginas en la misma carpeta
        const pageCategoryPath = categoryPath; // categoryPath viene del scope de renderCategory
        
        // Obtener información para determinar si se puede mover arriba/abajo (usando orden combinado)
        const parent = navigateConfigPath(config, pageCategoryPath);
        const pageIndex = parent && parent.pages ? parent.pages.findIndex(p => p.name === page.name && p.url === page.url) : -1;
        const combinedOrder = getCombinedOrder(parent);
        const currentPos = combinedOrder.findIndex(o => o.type === 'page' && o.index === pageIndex);
        const canMoveUp = currentPos > 0;
        const canMoveDown = currentPos !== -1 && currentPos < combinedOrder.length - 1;
        
        const menuItems = [
          { 
            icon: 'img/icon-edit.svg', 
            text: 'Edit', 
            action: async () => {
              await editPageFromPageList(page, pageCategoryPath, roomId);
            }
          },
          { 
            icon: 'img/icon-clone.svg', 
            text: 'Duplicate', 
            action: async () => {
              await duplicatePageFromPageList(page, pageCategoryPath, roomId);
            }
          },
          { separator: true },
        ];
        
        // Agregar opciones de mover si es posible
        if (canMoveUp || canMoveDown) {
          if (canMoveUp) {
            menuItems.push({
              icon: 'img/icon-arrow.svg',
              text: 'Move up',
              action: async () => {
                await movePageUp(page, pageCategoryPath, roomId);
              }
            });
          }
          if (canMoveDown) {
            menuItems.push({
              icon: 'img/icon-arrow.svg',
              text: 'Move down',
              action: async () => {
                await movePageDown(page, pageCategoryPath, roomId);
              }
            });
          }
          menuItems.push({ separator: true });
        }
        
        menuItems.push({
          icon: 'img/icon-trash.svg', 
          text: 'Delete', 
          action: async () => {
            await deletePageFromPageList(page, pageCategoryPath, roomId);
          }
        });
        
        // Marcar como activo mientras el menú está abierto
        pageContextMenuButton.classList.add('context-menu-active');
        button.classList.add('context-menu-open');
        
        // Posicionar el menú a 8px del botón
        createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 4 }, () => {
          // Callback cuando se cierra el menú
          pageContextMenuButton.classList.remove('context-menu-active');
          button.classList.remove('context-menu-open');
          pageContextMenuButton.style.opacity = '0';
        });
      });
      } // fin de if (isGM) para menú contextual de páginas
      
      button.innerHTML = `
        <div class="page-button-inner">
          <div class="page-icon-placeholder" style="background: ${placeholderColor};">${placeholderInitial}</div>
          <div class="page-name-text">${page.name}</div>
          ${linkIconHtml}
        </div>
      `;
      // Solo mostrar botones de administración para GMs
      if (isGM) {
        button.appendChild(pageVisibilityButton);
        button.appendChild(pageContextMenuButton);
      }
      
      // Hover effect
      button.addEventListener('mouseenter', () => {
        button.style.background = CSS_VARS.hover;
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = CSS_VARS.bg;
      });
      
      // Click handler (no ejecutar si se hace click en los botones o el menú está abierto)
      button.addEventListener('click', async (e) => {
        // No abrir la página si se hace click en el menú contextual o botón de visibilidad
        if (e.target.closest('.page-context-menu-button') || e.target.closest('.page-visibility-button')) {
          return;
        }
        // No abrir la página si el menú contextual está abierto
        if (button.classList.contains('context-menu-open')) {
          return;
        }
        // Obtener blockTypes del objeto page si existe
        const blockTypes = page.blockTypes || null;
        await loadPageContent(page.url, page.name, page.selector || '', blockTypes);
      });
      
      // Agregar la página directamente al contentContainer para mantener el orden combinado
      contentContainer.appendChild(button);
      
      buttonsData.push({ button, pageId, pageName: page.name, linkIconHtml, pageContextMenuButton, pageVisibilityButton, isGM });
    }
    });
    
    // Cargar iconos en paralelo después de renderizar todos los botones
    if (buttonsData.length > 0) {
    Promise.all(buttonsData.map(async ({ button, pageId, pageName, linkIconHtml, pageContextMenuButton, pageVisibilityButton, isGM }) => {
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
        
        // Re-agregar los botones después de actualizar el HTML (solo para GMs)
        if (isGM && menuButtonParent === button) {
          if (pageVisibilityButton) {
            button.appendChild(pageVisibilityButton);
            if (button.matches(':hover')) {
              pageVisibilityButton.style.opacity = '1';
            }
          }
          if (pageContextMenuButton) {
            button.appendChild(pageContextMenuButton);
            if (button.matches(':hover')) {
              pageContextMenuButton.style.opacity = '1';
            }
          }
        }
        } catch (e) {
          console.warn('No se pudo obtener el icono para:', pageName, e);
        }
      })).catch(e => {
        console.error('Error al cargar iconos:', e);
      });
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
      // No colapsar si el menú contextual está abierto
      if (titleContainer.classList.contains('context-menu-open')) {
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
        collapseIcon.alt = 'Collapse';
        
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
        collapseIcon.alt = 'Expand';
        
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

// Función auxiliar para obtener el orden combinado de elementos en un nivel
// El orden se guarda en parent.order como array de {type: 'category'|'page', index: number}
function getCombinedOrder(parent) {
  if (!parent) return [];
  
  // Si existe un orden guardado, usarlo
  if (parent.order && Array.isArray(parent.order)) {
    // Validar que todos los elementos del orden existen
    const validOrder = parent.order.filter(item => {
      if (item.type === 'category') {
        return parent.categories && parent.categories[item.index];
      } else if (item.type === 'page') {
        return parent.pages && parent.pages[item.index];
      }
      return false;
    });
    
    // Agregar elementos nuevos que no estén en el orden
    const categories = parent.categories || [];
    const pages = parent.pages || [];
    
    categories.forEach((cat, index) => {
      if (!validOrder.some(o => o.type === 'category' && o.index === index)) {
        validOrder.push({ type: 'category', index });
      }
    });
    
    pages.forEach((page, index) => {
      if (!validOrder.some(o => o.type === 'page' && o.index === index)) {
        validOrder.push({ type: 'page', index });
      }
    });
    
    return validOrder;
  }
  
  // Si no hay orden guardado, generar uno por defecto (carpetas primero, luego páginas)
  const order = [];
  const categories = parent.categories || [];
  const pages = parent.pages || [];
  
  categories.forEach((cat, index) => {
    order.push({ type: 'category', index });
  });
  
  pages.forEach((page, index) => {
    order.push({ type: 'page', index });
  });
  
  return order;
}

// Función para guardar el orden combinado
function saveCombinedOrder(parent, order) {
  parent.order = order;
}

// Función para mover un elemento arriba en el orden combinado
async function moveItemUp(itemType, itemIndex, parentPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
  
  if (!parent) return;
  
  const order = getCombinedOrder(parent);
  const currentPos = order.findIndex(o => o.type === itemType && o.index === itemIndex);
  
  if (currentPos <= 0) return; // Ya está en la primera posición
  
  // Intercambiar con el anterior
  const temp = order[currentPos];
  order[currentPos] = order[currentPos - 1];
  order[currentPos - 1] = temp;
  
  saveCombinedOrder(parent, order);
  await savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    await renderPagesByCategories(config, pageList, roomId);
  }
}

// Función para mover un elemento abajo en el orden combinado
async function moveItemDown(itemType, itemIndex, parentPath, roomId) {
  const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
  const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
  
  if (!parent) return;
  
  const order = getCombinedOrder(parent);
  const currentPos = order.findIndex(o => o.type === itemType && o.index === itemIndex);
  
  if (currentPos === -1 || currentPos >= order.length - 1) return; // Ya está en la última posición
  
  // Intercambiar con el siguiente
  const temp = order[currentPos];
  order[currentPos] = order[currentPos + 1];
  order[currentPos + 1] = temp;
  
  saveCombinedOrder(parent, order);
  await savePagesJSON(config, roomId);
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    await renderPagesByCategories(config, pageList, roomId);
  }
}

// Funciones de compatibilidad (usan las nuevas funciones de orden combinado)
async function moveCategoryUp(category, categoryPath, roomId) {
  const index = categoryPath[categoryPath.length - 1];
  const parentPath = categoryPath.slice(0, -2);
  await moveItemUp('category', index, parentPath, roomId);
}

async function moveCategoryDown(category, categoryPath, roomId) {
  const index = categoryPath[categoryPath.length - 1];
  const parentPath = categoryPath.slice(0, -2);
  await moveItemDown('category', index, parentPath, roomId);
}

async function movePageUp(page, pageCategoryPath, roomId) {
  const config = getPagesJSON(roomId) || await getDefaultJSON();
  const parent = navigateConfigPath(config, pageCategoryPath);
  if (!parent || !parent.pages) return;
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1) return;
  
  await moveItemUp('page', pageIndex, pageCategoryPath, roomId);
}

async function movePageDown(page, pageCategoryPath, roomId) {
  const config = getPagesJSON(roomId) || await getDefaultJSON();
  const parent = navigateConfigPath(config, pageCategoryPath);
  if (!parent || !parent.pages) return;
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1) return;
  
  await moveItemDown('page', pageIndex, pageCategoryPath, roomId);
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
    'Add Folder',
    [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Folder name' }
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
      
      await savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        await renderPagesByCategories(config, pageList, roomId);
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
    { name: 'name', label: 'Name', type: 'text', required: true, value: category.name, placeholder: 'Folder name' }
  ];
  
  // Agregar selector de carpeta padre si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    fields.push({
      name: 'parentCategory',
      label: 'Parent folder',
      type: 'select',
      required: false,
      options: [
        { value: '', label: 'Root (no parent folder)' },
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
    'Edit Folder',
    fields,
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      
      // Obtener la carpeta actual
      const key = categoryPath[categoryPath.length - 2];
      const index = categoryPath[categoryPath.length - 1];
      const parent = navigateConfigPath(config, parentPath);
      const currentCategory = parent && parent[key] ? parent[key][index] : null;
      
      if (!currentCategory) {
        alert('Error: Could not find folder to edit');
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
            alert('Error changing parent folder. The folder was updated but remains in its current location.');
          }
        } else if (data.parentCategory === '' && parentPath.length > 0) {
          // Mover a raíz
          parent[key].splice(index, 1);
          if (!config.categories) config.categories = [];
          config.categories.push(currentCategory);
        }
      }
      
      await savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        await renderPagesByCategories(config, pageList, roomId);
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
    { name: 'name', label: 'Name', type: 'text', required: true, value: page.name, placeholder: 'Page name' },
    { name: 'url', label: 'URL', type: 'url', required: true, value: page.url, placeholder: 'https://...' }
  ];
  
  // Agregar selector de carpeta si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    const defaultValue = pageCategoryPathValue || categoryOptions[0].value;
    fields.push({
      name: 'category',
      label: 'Folder',
      type: 'select',
      required: true,
      options: categoryOptions,
      value: defaultValue
    });
  }
  
  fields.push(
    { name: 'selector', label: 'Selector (optional)', type: 'text', value: page.selector || '', placeholder: '#main-content', help: 'Only for external URLs' },
    { name: 'blockTypes', label: 'Block types (optional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), placeholder: 'quote, callout', help: 'Only for Notion URLs. E.g: "quote" or "quote,callout"' },
    { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: page.visibleToPlayers === true, help: 'Allow all players to see this page' }
  );
  
  showModalForm(
    'Edit Page',
    fields,
    async (data) => {
      const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
      
      // Encontrar la página actual
      const parent = navigateConfigPath(config, pageCategoryPath);
      if (!parent || !parent.pages) {
        alert('Error: Could not find page to edit');
        return;
      }
      
      const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
      if (pageIndex === -1) {
        alert('Error: Could not find page to edit');
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
      // Actualizar visibilidad para jugadores
      if (data.visibleToPlayers === true) {
        currentPage.visibleToPlayers = true;
      } else {
        delete currentPage.visibleToPlayers;
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
          alert('Error changing folder. The page was updated but remains in its current folder.');
        }
      }
      
      await savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        await renderPagesByCategories(config, pageList, roomId);
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
        alert('Error: Invalid folder path');
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
        alert('Error: Could not find folder to delete');
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
        alert('Error: Could not find folder to delete');
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
        alert('Error: Could not find folder to delete');
        return false;
      }
    }
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al eliminar carpeta:', error);
    alert('Error deleting folder: ' + error.message);
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
      alert('Error: Could not find page to delete');
      return false;
    }
    
    const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
    if (pageIndex === -1) {
      console.error('No se encontró la página:', page.name, page.url);
      alert('Error: Could not find page to delete');
      return false;
    }
    
    parent.pages.splice(pageIndex, 1);
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al eliminar página:', error);
    alert('Error deleting page: ' + error.message);
    return false;
  }
}

/**
 * Duplicar una carpeta completa (incluyendo páginas y subcarpetas)
 */
async function duplicateCategoryFromPageList(category, categoryPath, roomId) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    // Encontrar la carpeta en la configuración
    const parent = navigateConfigPath(config, categoryPath.slice(0, -2));
    const categoryIndex = categoryPath[categoryPath.length - 1];
    
    if (!parent || !parent.categories || !parent.categories[categoryIndex]) {
      console.error('No se encontró la carpeta para duplicar');
      alert('Error: Could not find folder to duplicate');
      return false;
    }
    
    const originalCategory = parent.categories[categoryIndex];
    
    // Crear una copia profunda de la carpeta
    const duplicatedCategory = JSON.parse(JSON.stringify(originalCategory));
    
    // Modificar el nombre agregando " (Copy)" o " (Copy 2)", etc.
    let newName = duplicatedCategory.name + ' (Copy)';
    let counter = 1;
    while (parent.categories.some(cat => cat.name === newName)) {
      counter++;
      newName = duplicatedCategory.name + ` (Copy ${counter})`;
    }
    duplicatedCategory.name = newName;
    
    // Insertar la carpeta duplicada justo después de la original
    parent.categories.splice(categoryIndex + 1, 0, duplicatedCategory);
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al duplicar carpeta:', error);
    alert('Error duplicating folder: ' + error.message);
    return false;
  }
}

/**
 * Duplicar una página
 */
async function duplicatePageFromPageList(page, pageCategoryPath, roomId) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    // Encontrar la página en la configuración
    const parent = navigateConfigPath(config, pageCategoryPath);
    if (!parent || !parent.pages) {
      console.error('No se encontró el parent o pages en:', pageCategoryPath);
      alert('Error: Could not find page to duplicate');
      return false;
    }
    
    const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
    if (pageIndex === -1) {
      console.error('No se encontró la página:', page.name, page.url);
      alert('Error: Could not find page to duplicate');
      return false;
    }
    
    const originalPage = parent.pages[pageIndex];
    
    // Crear una copia de la página
    const duplicatedPage = JSON.parse(JSON.stringify(originalPage));
    
    // Modificar el nombre agregando " (Copy)" o " (Copy 2)", etc.
    let newName = duplicatedPage.name + ' (Copy)';
    let counter = 1;
    while (parent.pages.some(p => p.name === newName)) {
      counter++;
      newName = duplicatedPage.name + ` (Copy ${counter})`;
    }
    duplicatedPage.name = newName;
    
    // Insertar la página duplicada justo después de la original
    parent.pages.splice(pageIndex + 1, 0, duplicatedPage);
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
    
    return true;
  } catch (error) {
    console.error('Error al duplicar página:', error);
    alert('Error duplicating page: ' + error.message);
    return false;
  }
}

// Función para encontrar una página en la configuración y devolver su path
function findPageInConfig(config, pageUrl, pageName) {
  function searchRecursive(categories, currentPath = []) {
    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      const categoryPath = [...currentPath, 'categories', i];
      
      // Buscar en las páginas de esta categoría
      if (category.pages && Array.isArray(category.pages)) {
        for (let j = 0; j < category.pages.length; j++) {
          const page = category.pages[j];
          if (page.url === pageUrl && page.name === pageName) {
            return { page, pageCategoryPath: categoryPath };
          }
        }
      }
      
      // Buscar recursivamente en subcategorías
      if (category.categories && Array.isArray(category.categories)) {
        const result = searchRecursive(category.categories, categoryPath);
        if (result) return result;
      }
    }
    return null;
  }
  
  if (config && config.categories && Array.isArray(config.categories)) {
    return searchRecursive(config.categories);
  }
  return null;
}

// Función para alternar la visibilidad de una página para jugadores
async function togglePageVisibility(page, pageCategoryPath, roomId) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    const parent = navigateConfigPath(config, pageCategoryPath);
    
    if (!parent || !parent.pages) {
      alert('Error: Could not find page to update');
      return;
    }
    
    const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
    if (pageIndex === -1) {
      alert('Error: Could not find page to update');
      return;
    }
    
    const currentPage = parent.pages[pageIndex];
    // Alternar visibilidad
    if (currentPage.visibleToPlayers === true) {
      delete currentPage.visibleToPlayers;
    } else {
      currentPage.visibleToPlayers = true;
    }
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
  } catch (error) {
    console.error('Error al alternar visibilidad de página:', error);
    alert('Error toggling page visibility: ' + error.message);
  }
}

// Función para alternar la visibilidad de todas las páginas en una carpeta (recursivamente)
async function toggleCategoryVisibility(category, categoryPath, roomId, makeVisible) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    const targetCategory = navigateConfigPath(config, categoryPath);
    
    if (!targetCategory) {
      alert('Error: Could not find category to update');
      return;
    }
    
    // Función recursiva para actualizar todas las páginas
    function updatePagesRecursive(cat) {
      if (cat.pages && Array.isArray(cat.pages)) {
        cat.pages.forEach(page => {
          if (makeVisible) {
            page.visibleToPlayers = true;
          } else {
            delete page.visibleToPlayers;
          }
        });
      }
      
      if (cat.categories && Array.isArray(cat.categories)) {
        cat.categories.forEach(subCat => {
          updatePagesRecursive(subCat);
        });
      }
    }
    
    updatePagesRecursive(targetCategory);
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
    }
  } catch (error) {
    console.error('Error al alternar visibilidad de carpeta:', error);
    alert('Error toggling category visibility: ' + error.message);
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
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
    { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' }
  ];
  
  // Agregar selector de carpeta si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    const defaultCategoryValue = defaultCategoryPath.length > 0 ? JSON.stringify(defaultCategoryPath) : categoryOptions[0].value;
    fields.push({
      name: 'category',
      label: 'Folder',
      type: 'select',
      required: true,
      options: categoryOptions,
      value: defaultCategoryValue
    });
  }
  
  fields.push(
    { name: 'selector', label: 'Selector (optional)', type: 'text', placeholder: '#main-content', help: 'Only for external URLs' },
    { name: 'blockTypes', label: 'Block types (optional)', type: 'text', placeholder: 'quote, callout', help: 'Only for Notion URLs. E.g: "quote" or "quote,callout"' },
    { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: false, help: 'Allow all players to see this page' }
  );
  
  showModalForm(
    'Add Page',
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
      // Agregar visibilidad para jugadores
      if (data.visibleToPlayers === true) {
        newPage.visibleToPlayers = true;
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
      
      await savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        await renderPagesByCategories(config, pageList, roomId);
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
    'Add Page',
    [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
      { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
      { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' },
      { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' },
      { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: false, help: 'Allow all players to see this page' }
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
      // Agregar visibilidad para jugadores
      if (data.visibleToPlayers === true) {
        newPage.visibleToPlayers = true;
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
      
      await savePagesJSON(config, roomId);
      
      // Recargar la vista
      const pageList = document.getElementById("page-list");
      if (pageList) {
        await renderPagesByCategories(config, pageList, roomId);
      }
    }
  );
}

// Función para renderizar páginas agrupadas por carpetas
async function renderPagesByCategories(pagesConfig, pageList, roomId = null) {
  // Mostrar loading
  pageList.innerHTML = `
    <div class="notion-waiting">
      <div class="notion-waiting-icon">⏳</div>
      <p class="notion-waiting-text">Waiting for the load content...</p>
    </div>`
  ;
  
  // Verificar el rol del usuario
  let isGM = true; // Por defecto asumir GM (para compatibilidad)
  try {
    const role = await OBR.player.getRole();
    isGM = role === 'GM';
  } catch (e) {
    console.warn('⚠️ No se pudo verificar el rol del usuario, asumiendo GM:', e);
    isGM = true; // Por defecto asumir GM si hay error
  }
  
  // Usar setTimeout para permitir que el DOM se actualice con el loading
  setTimeout(() => {
    pageList.innerHTML = '';
    
    if (!pagesConfig || !pagesConfig.categories || pagesConfig.categories.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <div class="empty-state-icon">🫥</div>
        <p class="empty-state-text">No pages configured</p>
        <p class="empty-state-hint">Verifica la consola para más detalles</p>
        <button class="btn btn--sm btn--ghost">➕ Add first folder</button>
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
  
    // Usar el orden combinado para el nivel raíz
    const rootOrder = getCombinedOrder(pagesConfig);
    rootOrder.forEach(item => {
      if (item.type === 'category' && pagesConfig.categories && pagesConfig.categories[item.index]) {
        const categoryPath = ['categories', item.index];
        renderCategory(pagesConfig.categories[item.index], pageList, 0, roomId, categoryPath, isGM);
      }
      // En el nivel raíz normalmente solo hay categorías, pero esto permite páginas sueltas en el futuro
    });
    
    // Si es jugador y no hay contenido visible, mostrar empty state
    if (!isGM) {
      // Verificar si hay alguna categoría con contenido visible
      const hasAnyVisibleContent = pagesConfig.categories && pagesConfig.categories.some(cat => 
        hasVisibleContentForPlayers(cat)
      );
      
      // Verificar si el pageList tiene contenido renderizado (categorías o páginas)
      const hasRenderedContent = pageList.children.length > 0;
      
      if (!hasAnyVisibleContent || !hasRenderedContent) {
        pageList.innerHTML = '';
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
          <div class="empty-state-icon">📄</div>
          <p class="empty-state-text">No shared pages</p>
          <p class="empty-state-hint">The DM hasn't shared any pages with you yet</p>
        `;
        pageList.appendChild(emptyState);
      }
    }
  }, 0); // Permitir que el DOM se actualice
}

// Función para limpiar el caché de una página específica
function clearPageCache(url) {
  const pageId = extractNotionPageId(url);
  if (pageId) {
    // Limpiar caché de bloques
    const cacheKey = CACHE_PREFIX + pageId;
    localStorage.removeItem(cacheKey);
    
    // Limpiar caché de información de página (incluyendo cover)
    const pageInfoCacheKey = PAGE_INFO_CACHE_PREFIX + pageId;
    localStorage.removeItem(pageInfoCacheKey);
    
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
    const pathname = urlObj.pathname.toLowerCase();
    
    // Detectar tipos de links
    if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
      return { type: 'notion', icon: 'icon-notion.svg' };
    }
    
    if (hostname.includes('dndbeyond.com')) {
      return { type: 'dndbeyond', icon: 'icon-dnd.svg' };
    }
    
    // ============================================================
    // SERVICIOS EXTERNOS - DESHABILITADOS PARA SOFT LAUNCH
    // Ver rama feature/multi-service para código completo
    // ============================================================
    
    // Google Drive - Activado solo para PDFs
    if (hostname.includes('drive.google.com')) {
      // Detectar si es un PDF en Google Drive
      if (pathname.includes('/file/d/')) {
        return { type: 'pdf', icon: 'icon-pdf.svg' };
      }
    }
    
    // Google Docs/Sheets/Slides - PRÓXIMAMENTE
    // if (hostname.includes('docs.google.com')) {
    //   if (pathname.includes('/document/')) {
    //     return { type: 'google-docs', icon: 'icon-google-docs.svg' };
    //   }
    //   if (pathname.includes('/spreadsheets/')) {
    //     return { type: 'google-sheets', icon: 'icon-google-sheets.svg' };
    //   }
    //   if (pathname.includes('/presentation/')) {
    //     return { type: 'google-slides', icon: 'icon-google-slides.svg' };
    //   }
    // }
    
    // YouTube - PRÓXIMAMENTE
    // if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
    //   return { type: 'youtube', icon: 'icon-youtube.svg' };
    // }
    
    // Vimeo - PRÓXIMAMENTE
    // if (hostname.includes('vimeo.com')) {
    //   return { type: 'vimeo', icon: 'icon-vimeo.svg' };
    // }
    
    // Figma - PRÓXIMAMENTE
    // if (hostname.includes('figma.com')) {
    //   return { type: 'figma', icon: 'icon-figma.svg' };
    // }
    
    // Dropbox - PRÓXIMAMENTE
    // if (hostname.includes('dropbox.com')) {
    //   return { type: 'dropbox', icon: 'icon-dropbox.svg' };
    // }
    
    // OneDrive - PRÓXIMAMENTE
    // if (hostname.includes('onedrive.live.com') || hostname.includes('1drv.ms')) {
    //   return { type: 'onedrive', icon: 'icon-onedrive.svg' };
    // }
    
    // ============================================================
    
    // CodePen - COMENTADO
    // if (hostname.includes('codepen.io')) {
    //   return { type: 'codepen', icon: 'icon-codepen.svg' };
    // }
    
    // JSFiddle - COMENTADO
    // if (hostname.includes('jsfiddle.net')) {
    //   return { type: 'jsfiddle', icon: 'icon-jsfiddle.svg' };
    // }
    
    // GitHub - COMENTADO
    // if (hostname.includes('github.com') || hostname.includes('gist.github.com')) {
    //   return { type: 'github', icon: 'icon-github.svg' };
    // }
    
    // PDF
    if (pathname.endsWith('.pdf')) {
      return { type: 'pdf', icon: 'icon-pdf.svg' };
    }
    
    // Imágenes
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const lowercasePath = pathname.toLowerCase();
    if (imageExtensions.some(ext => lowercasePath.endsWith(ext))) {
      return { type: 'image', icon: 'icon-image.svg' };
    }
    
    // Por defecto, link genérico
    return { type: 'generic', icon: 'icon-link.svg' };
  } catch (e) {
    return { type: 'generic', icon: 'icon-link.svg' };
  }
}

// Función para convertir URLs de servicios externos a formato embed
// PDFs directos y PDFs de Google Drive soportados. Ver rama feature/multi-service para más servicios.
function convertToEmbedUrl(url) {
  if (!url || typeof url !== 'string') {
    return { url, converted: false, service: null };
  }

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;

    // ============================================================
    // SERVICIOS EXTERNOS - Google Drive activado solo para PDFs
    // Ver rama feature/multi-service para más servicios
    // ============================================================

    // Google Drive - Activado solo para PDFs
    if (hostname.includes('drive.google.com') && pathname.includes('/file/d/')) {
      const match = pathname.match(/\/file\/d\/([^/]+)/);
      if (match) {
        const fileId = match[1];
        // Convertir a formato preview para PDFs
        return {
          url: `https://drive.google.com/file/d/${fileId}/preview`,
          converted: true,
          service: 'Google Drive'
        };
      }
    }

    // Google Docs - PRÓXIMAMENTE
    // if (hostname.includes('docs.google.com') && pathname.includes('/document/d/')) {
    //   const match = pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    //   if (match) {
    //     const docId = match[1];
    //     return {
    //       url: `https://docs.google.com/document/d/${docId}/preview`,
    //       converted: true,
    //       service: 'Google Docs'
    //     };
    //   }
    // }

    // Google Sheets - PRÓXIMAMENTE
    // if (hostname.includes('docs.google.com') && pathname.includes('/spreadsheets/d/')) {
    //   const match = pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    //   if (match) {
    //     const sheetId = match[1];
    //     return {
    //       url: `https://docs.google.com/spreadsheets/d/${sheetId}/preview`,
    //       converted: true,
    //       service: 'Google Sheets'
    //     };
    //   }
    // }

    // Google Slides - PRÓXIMAMENTE
    // if (hostname.includes('docs.google.com') && pathname.includes('/presentation/d/')) {
    //   const match = pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
    //   if (match) {
    //     const slideId = match[1];
    //     return {
    //       url: `https://docs.google.com/presentation/d/${slideId}/embed`,
    //       converted: true,
    //       service: 'Google Slides'
    //     };
    //   }
    // }

    // Dropbox - PRÓXIMAMENTE
    // if (hostname.includes('dropbox.com')) {
    //   const newUrl = url.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1');
    //   if (newUrl !== url) {
    //     return {
    //       url: newUrl,
    //       converted: true,
    //       service: 'Dropbox'
    //     };
    //   }
    // }

    // OneDrive - PRÓXIMAMENTE
    // if (hostname.includes('onedrive.live.com') && url.includes('resid=')) {
    //   if (!url.includes('/embed')) {
    //     const resid = urlObj.searchParams.get('resid');
    //     if (resid) {
    //       return {
    //         url: `https://onedrive.live.com/embed?resid=${resid}`,
    //         converted: true,
    //         service: 'OneDrive'
    //       };
    //     }
    //   }
    // }

    // YouTube - PRÓXIMAMENTE
    // if (hostname.includes('youtube.com') && pathname.includes('/watch')) {
    //   const videoId = urlObj.searchParams.get('v');
    //   if (videoId) {
    //     return {
    //       url: `https://www.youtube.com/embed/${videoId}`,
    //       converted: true,
    //       service: 'YouTube'
    //     };
    //   }
    // }

    // YouTube corto (youtu.be) - PRÓXIMAMENTE
    // if (hostname === 'youtu.be') {
    //   const videoId = pathname.substring(1);
    //   if (videoId) {
    //     return {
    //       url: `https://www.youtube.com/embed/${videoId}`,
    //       converted: true,
    //       service: 'YouTube'
    //     };
    //   }
    // }

    // Vimeo - PRÓXIMAMENTE
    // if (hostname.includes('vimeo.com') && !pathname.includes('/video/')) {
    //   const videoId = pathname.match(/\/(\d+)/);
    //   if (videoId) {
    //     return {
    //       url: `https://player.vimeo.com/video/${videoId[1]}`,
    //       converted: true,
    //       service: 'Vimeo'
    //     };
    //   }
    // }

    // Figma - PRÓXIMAMENTE
    // if (hostname.includes('figma.com') && (pathname.includes('/file/') || pathname.includes('/design/'))) {
    //   return {
    //     url: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`,
    //     converted: true,
    //     service: 'Figma'
    //   };
    // }

    // ============================================================

    // CodePen - COMENTADO
    // if (hostname.includes('codepen.io') && pathname.includes('/pen/')) {
    //   const parts = pathname.split('/');
    //   const userIndex = parts.indexOf('pen') - 1;
    //   const penIndex = parts.indexOf('pen') + 1;
    //   if (userIndex >= 0 && penIndex < parts.length) {
    //     const user = parts[userIndex];
    //     const penId = parts[penIndex];
    //     return {
    //       url: `https://codepen.io/${user}/embed/${penId}?default-tab=result`,
    //       converted: true,
    //       service: 'CodePen'
    //     };
    //   }
    // }

    // JSFiddle - COMENTADO
    // if (hostname.includes('jsfiddle.net') && !pathname.includes('/embedded/')) {
    //   const cleanPath = pathname.replace(/\/$/, '');
    //   return {
    //     url: `https://jsfiddle.net${cleanPath}/embedded/result/`,
    //     converted: true,
    //     service: 'JSFiddle'
    //   };
    // }

    // PDF directo - no necesita conversión pero lo marcamos
    if (pathname.endsWith('.pdf')) {
      return {
        url: url,
        converted: false,
        service: 'PDF'
      };
    }

    // No se necesita conversión
    return { url, converted: false, service: null };

  } catch (e) {
    console.warn('Error al convertir URL:', e);
    return { url, converted: false, service: null };
  }
}

// Función para cargar imagen en viewer dedicado
async function loadImageContent(url, container, name) {
  const contentDiv = container.querySelector('#notion-content');
  const iframe = container.querySelector('#notion-iframe');
  
  // Ocultar iframe
  if (iframe) {
    iframe.style.display = 'none';
  }
  
  // Mostrar contenido
  if (contentDiv) {
    contentDiv.style.display = 'block';
    container.classList.add('show-content');
    
    // Convertir URL si es de Google Drive
    let imageUrl = url;
    if (url.includes('drive.google.com') && url.includes('/file/d/')) {
      const match = url.match(/\/file\/d\/([^/]+)/);
      if (match) {
        // Usar formato de thumbnail grande para mejor calidad
        imageUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w2000`;
      }
    }
    
    contentDiv.innerHTML = `
      <div class="image-viewer-container" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 16px;
        gap: 16px;
      ">
        <img 
          src="${imageUrl}" 
          alt="${name || 'Imagen'}"
          class="notion-image-clickable"
          style="
            max-width: 100%;
            max-height: calc(100vh - 150px);
            object-fit: contain;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.2s ease;
          "
        />
        <p style="color: var(--color-text-secondary); font-size: 14px;">Haz clic en la imagen para verla a tamaño completo</p>
      </div>
    `;
    
    // Añadir handler para abrir en modal al hacer click
    const img = contentDiv.querySelector('img');
    if (img) {
      img.addEventListener('click', () => {
        showImageModal(imageUrl, name);
      });
    }
  }
}

// Función para cargar video en player dedicado
async function loadVideoContent(url, container, videoType) {
  const contentDiv = container.querySelector('#notion-content');
  const iframe = container.querySelector('#notion-iframe');
  
  // Ocultar contenido de Notion
  if (contentDiv) {
    contentDiv.style.display = 'none';
  }
  
  // Convertir URL a formato embed
  const embedResult = convertToEmbedUrl(url);
  const embedUrl = embedResult.url;
  
  // Mostrar video en iframe con estilo mejorado
  if (iframe) {
    // Configurar el iframe para video
    iframe.src = embedUrl;
    iframe.style.display = 'block';
    iframe.style.visibility = 'visible';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
  }
  
  container.classList.remove('show-content');
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
        throw new Error(`Error loading: ${response.status}`);
      }
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Buscar el elemento por selector (id o clase)
      const element = doc.querySelector(selector);
      
      if (!element) {
        throw new Error(`Element with selector not found: ${selector}`);
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
      // Fallback: cargar la URL completa con conversión
      const embedResult = convertToEmbedUrl(url);
      if (embedResult.converted) {
        console.log(`🔄 URL convertida para ${embedResult.service}: ${embedResult.url}`);
      }
      iframe.src = embedResult.url;
      iframe.style.display = 'block';
      iframe.style.visibility = 'visible';
    }
  } else {
    // Sin selector: cargar la URL completa
    // Convertir URL si es de un servicio soportado
    const embedResult = convertToEmbedUrl(url);
    if (embedResult.converted) {
      console.log(`🔄 URL convertida para ${embedResult.service}: ${embedResult.url}`);
    } else if (embedResult.service) {
      console.log(`📄 URL de ${embedResult.service} (sin conversión necesaria)`);
    }
    console.log('📄 Cargando URL en iframe:', embedResult.url);
    iframe.src = embedResult.url;
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
      
      // Agregar o actualizar botón de menú contextual (solo para Notion, solo para GMs)
      let contextMenuButton = document.getElementById("page-context-menu-button-header");
      let isGMForHeader = false;
      try {
        const role = await OBR.player.getRole();
        isGMForHeader = role === 'GM';
      } catch (e) {
        isGMForHeader = false;
      }
      
      if (isGMForHeader) {
        if (!contextMenuButton) {
          contextMenuButton = document.createElement("button");
          contextMenuButton.id = "page-context-menu-button-header";
          contextMenuButton.className = "icon-button";
          header.appendChild(contextMenuButton);
        }
        
        contextMenuButton.innerHTML = "";
        const contextMenuIcon = document.createElement("img");
        contextMenuIcon.src = "img/icon-contextualmenu.svg";
        contextMenuIcon.className = "icon-button-icon";
        contextMenuButton.appendChild(contextMenuIcon);
        contextMenuButton.title = "Menú";
        
        // Remover listeners anteriores
        const newContextMenuButton = contextMenuButton.cloneNode(true);
        contextMenuButton.parentNode.replaceChild(newContextMenuButton, contextMenuButton);
        contextMenuButton = newContextMenuButton;
        contextMenuButton.id = "page-context-menu-button-header";
        contextMenuButton.className = "icon-button";
        
        // Configurar menú contextual
        contextMenuButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rect = contextMenuButton.getBoundingClientRect();
          let roomId = null;
          try {
            roomId = OBR.room.id || await OBR.room.getId();
          } catch (e) {}
          
          const config = getPagesJSON(roomId) || await getDefaultJSON();
          const pageInfo = findPageInConfig(config, url, name);
          
          if (pageInfo) {
            const pageCategoryPath = pageInfo.pageCategoryPath;
            const parent = navigateConfigPath(config, pageCategoryPath);
            const pageIndex = parent && parent.pages ? parent.pages.findIndex(p => p.name === pageInfo.page.name && p.url === pageInfo.page.url) : -1;
            const combinedOrder = getCombinedOrder(parent);
            const currentPos = combinedOrder.findIndex(o => o.type === 'page' && o.index === pageIndex);
            const canMoveUp = currentPos > 0;
            const canMoveDown = currentPos !== -1 && currentPos < combinedOrder.length - 1;
            
            const menuItems = [
              { 
                icon: 'img/icon-edit.svg', 
                text: 'Edit', 
                action: async () => {
                  await editPageFromPageList(pageInfo.page, pageCategoryPath, roomId);
                }
              },
              { 
                icon: 'img/icon-clone.svg', 
                text: 'Duplicate', 
                action: async () => {
                  await duplicatePageFromPageList(pageInfo.page, pageCategoryPath, roomId);
                }
              },
              { separator: true },
            ];
            
            // Agregar opciones de mover si es posible
            if (canMoveUp || canMoveDown) {
              if (canMoveUp) {
                menuItems.push({
                  icon: 'img/icon-arrow.svg',
                  text: 'Move up',
                  action: async () => {
                    await movePageInList(pageInfo.page, pageCategoryPath, roomId, 'up');
                  }
                });
              }
              if (canMoveDown) {
                menuItems.push({
                  icon: 'img/icon-arrow.svg',
                  text: 'Move down',
                  action: async () => {
                    await movePageInList(pageInfo.page, pageCategoryPath, roomId, 'down');
                  }
                });
              }
              menuItems.push({ separator: true });
            }
            
            menuItems.push({
              icon: 'img/icon-trash.svg',
              text: 'Delete',
              action: async () => {
                if (confirm(`¿Eliminar la página "${pageInfo.page.name}"?`)) {
                  await deletePageFromPageList(pageInfo.page, pageCategoryPath, roomId);
                  // Volver a la vista principal después de eliminar
                  const notionContainer = document.getElementById("notion-container");
                  if (notionContainer) {
                    notionContainer.classList.add("hidden");
                  }
                  const pageList = document.getElementById("page-list");
                  if (pageList) {
                    pageList.classList.remove("hidden");
                  }
                }
              }
            });
            
            createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 4 }, () => {
              contextMenuButton.classList.remove('context-menu-active');
            });
            
            contextMenuButton.classList.add('context-menu-active');
          }
        });
        
        contextMenuButton.classList.remove("hidden");
      } else {
        if (contextMenuButton) {
          contextMenuButton.classList.add("hidden");
        }
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
      // No es una URL de Notion → detectar tipo de contenido
      const linkType = getLinkType(url);
      console.log('🌐 URL detectada:', linkType.type);
      
      // Ocultar botón de recargar si existe (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      // Manejar según el tipo de contenido
      if (linkType.type === 'image') {
        // Es una imagen → abrir en image viewer
        console.log('🖼️ Imagen detectada, abriendo en viewer');
        await loadImageContent(url, notionContainer, name);
      } else if (linkType.type === 'youtube' || linkType.type === 'vimeo') {
        // Es un video → abrir en video player
        console.log('🎬 Video detectado, abriendo en player');
        await loadVideoContent(url, notionContainer, linkType.type);
      } else {
        // Cargar en iframe (con selector opcional)
        await loadIframeContent(url, notionContainer, selector);
      }
    }
    
    if (!backButton.dataset.listenerAdded) {
      backButton.addEventListener("click", () => {
        const settingsContainer = document.getElementById("settings-container");
        const isSettingsVisible = settingsContainer && !settingsContainer.classList.contains('hidden');
        
        if (isSettingsVisible) {
          // Cerrar token config
          settingsContainer.classList.add("hidden");
        } else {
          // Volver a la vista principal desde notion-container
        notionContainer.classList.add("hidden");
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
        // Ocultar botón de menú contextual
        const contextMenuButton = document.getElementById("page-context-menu-button-header");
        if (contextMenuButton) {
          contextMenuButton.classList.add("hidden");
        }
        // Ocultar botón de recargar
        const refreshButton = document.getElementById("refresh-page-button");
        if (refreshButton) {
          refreshButton.classList.add("hidden");
          }
        // Ocultar botón de visibilidad
        const visibilityButton = document.getElementById("page-visibility-button-header");
        if (visibilityButton) {
          visibilityButton.classList.add("hidden");
        }
        }
        
        // Restaurar vista principal
        pageList.classList.remove("hidden");
        backButton.classList.add("hidden");
        pageTitle.textContent = "DM screen";
        // Mostrar el button-container cuando se vuelve a la vista principal
        const buttonContainer = document.querySelector('.button-container');
        if (buttonContainer) {
          buttonContainer.classList.remove("hidden");
        }
      });
      backButton.dataset.listenerAdded = "true";
    }
    
    // Agregar botón de visibilidad para GMs (después del refresh, antes del menú contextual)
    let visibilityButton = document.getElementById("page-visibility-button-header");
    if (!isGMForHeader) {
      try {
        const role = await OBR.player.getRole();
        isGMForHeader = role === 'GM';
      } catch (e) {
        isGMForHeader = false;
      }
    }
    
    if (isGMForHeader) {
      let roomId = null;
      try {
        roomId = OBR.room.id || await OBR.room.getId();
      } catch (e) {}
      
      const config = getPagesJSON(roomId) || await getDefaultJSON();
      const pageInfo = findPageInConfig(config, url, name);
      
      if (pageInfo) {
        if (!visibilityButton) {
          visibilityButton = document.createElement("button");
          visibilityButton.id = "page-visibility-button-header";
          visibilityButton.className = "icon-button";
          header.appendChild(visibilityButton);
        }
        
        const isPageVisible = pageInfo.page.visibleToPlayers === true;
        visibilityButton.innerHTML = "";
        const visibilityIcon = document.createElement("img");
        visibilityIcon.src = isPageVisible ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
        visibilityIcon.className = 'icon-button-icon';
        visibilityButton.appendChild(visibilityIcon);
        visibilityButton.title = isPageVisible ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
        
        // Remover listeners anteriores
        const newVisibilityButton = visibilityButton.cloneNode(true);
        visibilityButton.parentNode.replaceChild(newVisibilityButton, visibilityButton);
        visibilityButton = newVisibilityButton;
        visibilityButton.id = "page-visibility-button-header";
        visibilityButton.className = "icon-button";
        
        visibilityButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          await togglePageVisibility(pageInfo.page, pageInfo.pageCategoryPath, roomId);
          
          const updatedConfig = getPagesJSON(roomId) || await getDefaultJSON();
          const updatedPageInfo = findPageInConfig(updatedConfig, url, name);
          if (updatedPageInfo) {
            const isNowVisible = updatedPageInfo.page.visibleToPlayers === true;
            const icon = visibilityButton.querySelector('img');
            if (icon) {
              icon.src = isNowVisible ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
            }
            visibilityButton.title = isNowVisible ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
          }
        });
        
        visibilityButton.classList.remove("hidden");
      } else {
        if (visibilityButton) {
          visibilityButton.classList.add("hidden");
        }
      }
    } else {
      if (visibilityButton) {
        visibilityButton.classList.add("hidden");
      }
    }
  }
}

// Función para mostrar configuración de token
async function showSettings() {
  // Obtener roomId de forma segura
  let roomId = null;
  try {
    if (typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
      roomId = await OBR.room.getId();
    }
  } catch (e) {
    console.warn('No se pudo obtener roomId:', e);
  }
  const pageList = document.getElementById("page-list");
  const notionContainer = document.getElementById("notion-container");
  const settingsContainer = document.getElementById("settings-container");
  const backButton = document.getElementById("back-button");
  const pageTitle = document.getElementById("page-title");
  const header = document.getElementById("header");
  
  // Ocultar otros contenedores pero mantener el container visible
  if (pageList) pageList.classList.add('hidden');
  if (notionContainer) notionContainer.classList.add('hidden');
  if (settingsContainer) settingsContainer.classList.remove('hidden');
  
  // Actualizar header como en loadPageContent
  if (backButton) {
    backButton.classList.remove('hidden');
  }
  if (pageTitle) {
    pageTitle.textContent = 'Settings';
  }
  
  // Asegurar que el listener esté configurado (se agrega en loadPageContent o aquí si es necesario)
  if (backButton && !backButton.dataset.listenerAdded) {
    backButton.addEventListener("click", () => {
      const settingsContainer = document.getElementById("settings-container");
      const notionContainer = document.getElementById("notion-container");
      const pageList = document.getElementById("page-list");
      const pageTitle = document.getElementById("page-title");
      const notionContent = document.getElementById("notion-content");
      
      const isSettingsVisible = settingsContainer && !settingsContainer.classList.contains('hidden');
      const isNotionContainerVisible = notionContainer && !notionContainer.classList.contains('hidden');
      
      if (isSettingsVisible) {
        // Cerrar token config
        settingsContainer.classList.add("hidden");
      } else if (isNotionContainerVisible) {
        // Volver a la vista principal desde notion-container
        notionContainer.classList.add("hidden");
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
      }
      
      // Restaurar vista principal
      if (pageList) pageList.classList.remove("hidden");
      if (backButton) backButton.classList.add("hidden");
      if (pageTitle) pageTitle.textContent = "DM screen";
      // Mostrar el button-container cuando se vuelve a la vista principal
      const buttonContainer = document.querySelector('.button-container');
      if (buttonContainer) {
        buttonContainer.classList.remove("hidden");
      }
    });
    backButton.dataset.listenerAdded = "true";
  }
  
  // Ocultar el button-container cuando se está en la vista de token config
  const buttonContainer = document.querySelector('.button-container');
  if (buttonContainer) {
    buttonContainer.classList.add('hidden');
  }
  
  const currentToken = getUserToken() || '';
  const maskedToken = currentToken ? currentToken.substring(0, 8) + '...' + currentToken.substring(currentToken.length - 4) : '';
  
  // Llenar el contenido dinámicamente
  const tokenInput = document.getElementById('token-input');
  const tokenMasked = document.getElementById('token-masked');
  const errorDiv = document.getElementById('token-error');
  const saveBtn = document.getElementById('save-token');
  const clearBtn = document.getElementById('clear-token');
  const viewJsonBtn = document.getElementById('view-json-btn');
  const loadJsonBtn = document.getElementById('load-json-btn');
  const downloadJsonBtn = document.getElementById('download-json-btn');
  
  // Mostrar botón "Ver JSON" solo si es tu cuenta (DEBUG_MODE activado)
  // Esto se controla desde Netlify Environment Variables (DEBUG_MODE=true)
  if (viewJsonBtn && DEBUG_MODE) {
    viewJsonBtn.classList.remove('hidden');
  }
  
  if (tokenInput) {
    tokenInput.value = currentToken;
  }
  
  if (tokenMasked) {
    if (currentToken) {
      tokenMasked.textContent = `Token actual: ${maskedToken}`;
    } else {
      tokenMasked.textContent = '';
    }
  }
  
  if (errorDiv) {
    errorDiv.classList.remove('form__error--visible');
    errorDiv.textContent = '';
  }
  
  // Cerrar
  const closeSettings = () => {
    if (settingsContainer) settingsContainer.classList.add('hidden');
    if (pageList) pageList.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
    if (pageTitle) pageTitle.textContent = 'DM screen';
    // Mostrar el button-container cuando se vuelve a la vista principal
    const buttonContainer = document.querySelector('.button-container');
    if (buttonContainer) {
      buttonContainer.classList.remove('hidden');
    }
  };
  
  // Guardar token - evitar múltiples listeners
  if (saveBtn && !saveBtn.dataset.listenerAdded) {
    saveBtn.dataset.listenerAdded = 'true';
    saveBtn.addEventListener('click', async () => {
      const token = tokenInput ? tokenInput.value.trim() : '';
      
      if (!token) {
        if (errorDiv) {
          errorDiv.textContent = 'Por favor, ingresa un token de Notion';
          errorDiv.classList.add('form__error--visible');
        }
        return;
      }
      
      if (saveUserToken(token)) {
        if (errorDiv) errorDiv.classList.remove('form__error--visible');
        alert('✅ Token saved successfully. You can now use your own Notion pages.');
        // Actualizar el modo debug con el nuevo token
        await initDebugMode();
        // Actualizar visibilidad del botón "Ver JSON" si es necesario
        if (viewJsonBtn) {
          if (DEBUG_MODE) {
            viewJsonBtn.classList.remove('hidden');
          } else {
            viewJsonBtn.classList.add('hidden');
          }
        }
        closeSettings();
        // Actualizar el título del botón de token sin recargar la página
        const settingsButton = document.querySelector('.icon-button[title*="Token"]');
        if (settingsButton) {
            settingsButton.title = "Settings (Token configured)";
        }
        // No recargar la página para preservar la configuración actual
      } else {
        if (errorDiv) {
          errorDiv.textContent = 'Error al guardar el token. Revisa la consola para más detalles.';
          errorDiv.classList.add('form__error--visible');
        }
      }
    });
  }
  
  // Eliminar token - evitar múltiples listeners
  if (clearBtn && !clearBtn.dataset.listenerAdded) {
    clearBtn.dataset.listenerAdded = 'true';
    clearBtn.addEventListener('click', async () => {
      if (confirm('Delete token? You will go back to using the server token (if configured).')) {
        if (saveUserToken('')) {
          // Actualizar el modo debug después de eliminar el token
          await initDebugMode();
          // Ocultar el botón "Ver JSON" si ya no es tu cuenta
          if (viewJsonBtn) {
            viewJsonBtn.classList.add('hidden');
          }
          alert('Token deleted. Server token will be used.');
          closeSettings();
          // Actualizar el título del botón de token sin recargar la página
          const settingsButton = document.querySelector('.icon-button[title*="Token"]');
          if (settingsButton) {
            settingsButton.title = "Settings";
          }
          // No recargar la página para preservar la configuración actual
        }
      }
    });
  }
  
  // El back-button ya tiene un listener que maneja el cierre de settings-container
  // No necesitamos agregar otro listener aquí
  
  // Ver JSON - evitar múltiples listeners
  if (viewJsonBtn && !viewJsonBtn.dataset.listenerAdded) {
    viewJsonBtn.dataset.listenerAdded = 'true';
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
            <h2 style="color: #fff; font-size: 18px; font-weight: 700; margin: 0; font-family: Roboto, Helvetica, Arial, sans-serif;">Configuration JSON</h2>
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
        alert('❌ Error displaying JSON: ' + e.message);
      }
    });
  }
  
  // Cargar JSON - evitar múltiples listeners
  if (loadJsonBtn && !loadJsonBtn.dataset.listenerAdded) {
    loadJsonBtn.dataset.listenerAdded = 'true';
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
              alert('❌ JSON must have a "categories" array');
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
            const saveSuccess = await savePagesJSON(parsed, currentRoomId);
            if (saveSuccess) {
              alert('✅ JSON loaded successfully. Configuration has been updated.');
              closeSettings();
              
              // Actualizar la vista principal directamente sin recargar la página
              const pageList = document.getElementById("page-list");
              if (pageList) {
                await renderPagesByCategories(parsed, pageList, currentRoomId);
              } else {
                // Si no se encuentra el pageList, recargar la página como fallback
      window.location.reload();
              }
    } else {
              alert('❌ Error saving JSON. Check the console for details.');
            }
          } catch (e) {
            console.error('Error al cargar JSON:', e);
            alert('❌ Error loading JSON: ' + e.message);
          }
          
          // Limpiar el input
          document.body.removeChild(fileInput);
        }, { once: true }); // El listener del change solo se ejecuta una vez
        
        document.body.appendChild(fileInput);
        fileInput.click();
      } catch (e) {
        console.error('Error al cargar JSON:', e);
        alert('❌ Error al cargar JSON: ' + e.message);
      }
    });
  }
  
  // Descargar JSON - evitar múltiples listeners
  if (downloadJsonBtn && !downloadJsonBtn.dataset.listenerAdded) {
    downloadJsonBtn.dataset.listenerAdded = 'true';
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
        alert('✅ JSON downloaded successfully');
      } catch (e) {
        console.error('Error al descargar JSON:', e);
        alert('❌ Error downloading JSON: ' + e.message);
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
      if (item.text === 'Move up') {
        rotation = 'transform: rotate(90deg);';
      } else if (item.text === 'Move down') {
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
  overlay.className = 'modal';

  const modal = document.createElement('div');
  modal.className = 'modal__content';

  modal.innerHTML = `
    <h2 class="modal__title">${title}</h2>
    <form id="modal-form" class="form">
      ${fields.map(field => `
        <div class="form__field">
          <label class="form__label">
            ${field.label}${field.required ? ' *' : ''}
          </label>
          ${field.type === 'textarea' ? `
            <textarea 
              id="field-${field.name}" 
              name="${field.name}"
              class="textarea"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
            >${field.value || ''}</textarea>
          ` : field.type === 'select' ? `
            <select 
              id="field-${field.name}" 
              name="${field.name}"
              class="select"
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
          ` : field.type === 'checkbox' ? `
            <label class="form__checkbox-label">
              <input 
                type="checkbox" 
                id="field-${field.name}" 
                name="${field.name}"
                class="checkbox"
                ${field.value ? 'checked' : ''}
              />
              <span>${field.help || ''}</span>
            </label>
          ` : `
            <input 
              type="${field.type || 'text'}" 
              id="field-${field.name}" 
              name="${field.name}"
              class="input"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
              value="${field.value || ''}"
            />
          `}
          ${field.help ? `<div class="form__help">${field.help}</div>` : ''}
        </div>
      `).join('')}
      <div class="form__actions">
        <button type="button" id="modal-cancel" class="btn btn--ghost btn--flex">Cancelar</button>
        <button type="submit" id="modal-submit" class="btn btn--primary btn--flex">Save</button>
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
        } else if (field.type === 'checkbox') {
          formData[field.name] = input.checked;
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
    <h1>Configuration Editor</h1>
    <div class="visual-editor-header-buttons">
      <button id="editor-filter-btn" class="icon-button" title="Filtros">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6H20M7 12H17M10 18H14" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <button id="editor-add-btn" class="icon-button" title="Add">
        <img src="img/icon-add.svg" alt="Add" class="icon-button-icon" />
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
          { icon: 'img/icon-clone.svg', text: 'Duplicar', action: () => duplicateCategory(path) },
          { icon: '🗑️', text: 'Eliminar', action: () => deleteCategory(path) }
        );
      } else {
        menuItems.push(
          { icon: '✏️', text: 'Edit', action: () => editPage(item, path) },
          { icon: 'img/icon-clone.svg', text: 'Duplicate', action: () => duplicatePage(path) },
          { icon: '🗑️', text: 'Delete', action: () => deletePage(path) }
        );
      }

      // Posicionar el menú a 8px del botón
      createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 4 });
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
      'Add Folder',
      [
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Folder name' }
      ],
      async (data) => {
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
        
        await savePagesJSON(config, roomId);
        refreshEditor();
      }
    );
  };

  const addPage = (parentPath = []) => {
    showModalForm(
      'Add Page',
      [
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
        { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
        { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' },
        { name: 'blockTypes', label: 'Tipos de bloques (opcional)', type: 'text', placeholder: 'quote, callout', help: 'Solo para URLs de Notion. Ej: "quote" o "quote,callout"' },
        { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: false, help: 'Allow all players to see this page' }
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
        // Agregar visibilidad para jugadores
        if (data.visibleToPlayers === true) {
          newPage.visibleToPlayers = true;
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
        
        await savePagesJSON(config, roomId);
        refreshEditor();
      }
    );
  };

  const editCategory = (category, path) => {
    showModalForm(
      'Edit Folder',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, value: category.name }
      ],
      async (data) => {
        const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
        const target = navigatePath(config, path);
        if (target) {
          target.name = data.name;
          await savePagesJSON(config, roomId);
          refreshEditor();
        }
      }
    );
  };

  const editPage = (page, path) => {
    showModalForm(
      'Edit Page',
      [
        { name: 'name', label: 'Nombre', type: 'text', required: true, value: page.name },
        { name: 'url', label: 'URL', type: 'url', required: true, value: page.url },
        { name: 'selector', label: 'Selector (optional)', type: 'text', value: page.selector || '', help: 'Only for external URLs' },
        { name: 'blockTypes', label: 'Block types (optional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), help: 'Only for Notion URLs' },
        { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: page.visibleToPlayers === true, help: 'Allow all players to see this page' }
      ],
      async (data) => {
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
          // Actualizar visibilidad para jugadores
          if (data.visibleToPlayers === true) {
            target.visibleToPlayers = true;
          } else {
            delete target.visibleToPlayers;
          }
          await savePagesJSON(config, roomId);
          refreshEditor();
        }
      }
    );
  };

  const deleteCategory = async (path) => {
    if (!confirm('Delete this folder and all its content?')) return;
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key]) {
      parent[key].splice(index, 1);
      await savePagesJSON(config, roomId);
      refreshEditor();
    }
  };

  const deletePage = async (path) => {
    if (!confirm('Delete this page?')) return;
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key]) {
      parent[key].splice(index, 1);
      await savePagesJSON(config, roomId);
      refreshEditor();
    }
  };

  const duplicateCategory = async (path) => {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key] && parent[key][index]) {
      const originalCategory = parent[key][index];
      const duplicatedCategory = JSON.parse(JSON.stringify(originalCategory));
      
      // Modificar el nombre agregando " (Copy)" o " (Copy 2)", etc.
      let newName = duplicatedCategory.name + ' (Copy)';
      let counter = 1;
      while (parent[key].some(cat => cat.name === newName)) {
        counter++;
        newName = duplicatedCategory.name + ` (Copy ${counter})`;
      }
      duplicatedCategory.name = newName;
      
      // Insertar la carpeta duplicada justo después de la original
      parent[key].splice(index + 1, 0, duplicatedCategory);
      await savePagesJSON(config, roomId);
      refreshEditor();
    }
  };

  const duplicatePage = async (path) => {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || currentConfig));
    const key = path[path.length - 2];
    const index = path[path.length - 1];
    const parent = navigatePath(config, path.slice(0, -2));
    if (parent && parent[key] && parent[key][index]) {
      const originalPage = parent[key][index];
      const duplicatedPage = JSON.parse(JSON.stringify(originalPage));
      
      // Modificar el nombre agregando " (Copy)" o " (Copy 2)", etc.
      let newName = duplicatedPage.name + ' (Copy)';
      let counter = 1;
      while (parent[key].some(p => p.name === newName)) {
        counter++;
        newName = duplicatedPage.name + ` (Copy ${counter})`;
      }
      duplicatedPage.name = newName;
      
      // Insertar la página duplicada justo después de la original
      parent[key].splice(index + 1, 0, duplicatedPage);
      await savePagesJSON(config, roomId);
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
        <p style="margin-bottom: 12px;">No folders</p>
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

