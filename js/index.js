// Los logs iniciales se ejecutan después de definir la función log()

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { buildPageAddedMetadata } from './utils/pageAnalytics.js?v=20260816-1';

// Sistema de logs controlado por variable de entorno de Netlify
let DEBUG_MODE = false;

// Función para inicializar el modo debug desde Netlify
async function initDebugMode() {
  try {
    // Intentar obtener la variable de entorno desde Netlify Function
    if (window.location.origin.includes('netlify.app') || window.location.origin.includes('netlify.com')) {
      const response = await fetch('/.netlify/functions/get-debug-mode', {
        cache: 'no-store'
      });
      if (response.ok) {
        const data = await response.json();
        DEBUG_MODE = data.debug === true;
        if (DEBUG_MODE) {
          log('🔍 Modo debug activado');
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

// Logs iniciales (ahora que log() está definida)
log('🚀 Iniciando carga de index.js...');
log('✅ OBR SDK importado');

// ============================================
// MIXPANEL ANALYTICS
// ============================================
let mixpanelToken = null;
let mixpanelEnabled = false;
let mixpanelDistinctId = null;

// Storage key for analytics consent
const ANALYTICS_CONSENT_KEY = 'analytics_consent';

/**
 * Check if user has given consent for analytics
 * @returns {boolean|null} - true if accepted, false if rejected, null if not set
 */
function getAnalyticsConsent() {
  try {
    const consent = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (consent === 'true') return true;
    if (consent === 'false') return false;
    return null; // Not set yet
  } catch (e) {
    return null;
  }
}

/**
 * Save analytics consent preference
 * @param {boolean} accepted - Whether user accepted analytics
 */
function setAnalyticsConsent(accepted) {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, accepted ? 'true' : 'false');
  } catch (e) {
    console.error('Error saving analytics consent:', e);
  }
}

/**
 * Show cookie consent banner (only if consent not set)
 */
function showCookieConsentBanner() {
  // Only show if consent hasn't been set
  if (getAnalyticsConsent() !== null) {
    return;
  }
  
  const banner = document.createElement('div');
  banner.id = 'cookie-consent-banner';
  banner.className = 'cookie-consent-banner';
  
  banner.innerHTML = `
    <div class="cookie-consent-content">
      <p class="cookie-consent-text">
        🍪 We use analytics to improve the extension. Do you want to help us by sharing anonymous usage data?
      </p>
      <div class="cookie-consent-actions">
        <button id="cookie-accept" class="btn btn--primary btn--small">Accept</button>
        <button id="cookie-reject" class="btn btn--ghost btn--small">Decline</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(banner);
  
  // Accept button
  const acceptBtn = banner.querySelector('#cookie-accept');
  acceptBtn.addEventListener('click', () => {
    setAnalyticsConsent(true);
    banner.remove();
    // Initialize Mixpanel after consent
    initMixpanel();
  });
  
  // Reject button
  const rejectBtn = banner.querySelector('#cookie-reject');
  rejectBtn.addEventListener('click', () => {
    setAnalyticsConsent(false);
    banner.remove();
  });
}

/**
 * Initialize Mixpanel tracking by fetching token from Netlify
 * Only initializes if user has given consent
 */
async function initMixpanel() {
  // Check consent first
  const consent = getAnalyticsConsent();
  if (consent === false) {
    log('📊 Mixpanel disabled (user declined)');
    return;
  }
  
  // If consent is null, show banner and wait
  if (consent === null) {
    showCookieConsentBanner();
    return;
  }
  
  try {
    // Only fetch token if we're on Netlify
    if (!window.location.origin.includes('netlify.app') && !window.location.origin.includes('netlify.com')) {
      log('🔍 Mixpanel disabled (not on Netlify)');
      return;
    }
    
    const response = await fetch('/.netlify/functions/get-mixpanel-token');
    if (response.ok) {
      const data = await response.json();
      if (data.enabled && data.token) {
        mixpanelToken = data.token;
        mixpanelEnabled = true;
        
        // Generate a distinct ID based on the user (use OBR player id if available)
        try {
          const playerId = await OBR.player.getId();
          mixpanelDistinctId = playerId;
        } catch (e) {
          // Fallback to a random ID stored in localStorage
          mixpanelDistinctId = localStorage.getItem('mixpanel_distinct_id');
          if (!mixpanelDistinctId) {
            mixpanelDistinctId = 'anon_' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('mixpanel_distinct_id', mixpanelDistinctId);
          }
        }
        
        log('📊 Mixpanel analytics enabled');
        log('📊 Token:', mixpanelToken ? mixpanelToken.substring(0, 10) + '...' : 'missing');
        log('📊 Token length:', mixpanelToken ? mixpanelToken.length : 0, '(should be ~32 chars for project token)');
        log('📊 Full token (first 20 chars):', mixpanelToken ? mixpanelToken.substring(0, 20) : 'missing');
        log('📊 Distinct ID:', mixpanelDistinctId);
        
        // Verify token format (should be alphanumeric, ~32 chars)
        if (mixpanelToken && mixpanelToken.length < 20) {
          console.warn('⚠️ Token seems too short - make sure you\'re using the PROJECT TOKEN, not the SECRET');
        }
        // Track extension opened after successful initialization
        trackExtensionOpened();
      } else {
        console.warn('📊 Mixpanel token not available:', data);
      }
    } else {
      console.warn('📊 Failed to fetch Mixpanel token:', response.status);
    }
  } catch (e) {
    log('📊 Mixpanel disabled (fetch error)');
    mixpanelEnabled = false;
  }
}

/**
 * Track an event to Mixpanel
 * @param {string} eventName - Name of the event
 * @param {Object} properties - Additional properties to track
 */
async function trackEvent(eventName, properties = {}) {
  if (!mixpanelEnabled || !mixpanelToken) {
    console.warn('📊 Track skipped - enabled:', mixpanelEnabled, 'token:', !!mixpanelToken);
    return;
  }
  
  try {
    // Get user role for context
    let userRole = 'unknown';
    try {
      const role = await OBR.player.getRole();
      userRole = role;
    } catch (e) {}
    
    // Build the event payload (Mixpanel format)
    const eventData = {
      event: eventName,
      properties: {
        token: mixpanelToken,
        distinct_id: mixpanelDistinctId,
        time: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
        $insert_id: Math.random().toString(36).substring(2, 15),
        role: userRole,
        ...properties
      }
    };
    
    // Convert to base64 with UTF-8 support (btoa doesn't handle Unicode)
    const jsonString = JSON.stringify([eventData]);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    // Convert bytes to binary string for btoa
    let binaryString = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i]);
    }
    const base64String = btoa(binaryString);
    
    // Debug: log the payload (first 100 chars only)
    log('📊 Tracking event:', eventName, '| Payload length:', base64String.length);
    
    // Send to Mixpanel via HTTP API using POST (more reliable than GET)
    // Use EU endpoint to match the SDK configuration
    const trackUrl = 'https://api-eu.mixpanel.com/track';
    
    // Try POST first (more reliable)
    try {
      const response = await fetch(trackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(base64String)}&verbose=1`
      });
      
      if (response.ok) {
        const result = await response.json();
        log(`📊 Mixpanel response:`, result);
        
        // Always log decoded payload for debugging
        try {
          const decoded = JSON.parse(atob(base64String));
          log(`📊 Decoded payload:`, decoded);
          log(`📊 Event name:`, decoded[0]?.event);
          log(`📊 Token in payload:`, decoded[0]?.properties?.token?.substring(0, 10) + '...');
          log(`📊 Token match:`, decoded[0]?.properties?.token === mixpanelToken ? '✅' : '❌');
          log(`📊 Distinct ID:`, decoded[0]?.properties?.distinct_id);
          log(`📊 Full properties:`, JSON.stringify(decoded[0]?.properties, null, 2));
        } catch (e) {
          console.warn(`📊 Could not decode payload:`, e);
        }
        
        if (result.status === 1) {
          log(`📊 Event tracked: ${eventName}`);
        } else {
          console.warn(`📊 Mixpanel error:`, result);
        }
      } else {
        const errorText = await response.text();
        console.warn(`📊 Mixpanel HTTP error: ${response.status}`, errorText);
        // Fallback to image pixel
        throw new Error('HTTP error, using fallback');
      }
    } catch (fetchError) {
      // Fallback: use image pixel tracking (most reliable, works even with CORS issues)
      log(`📊 Using image pixel fallback for: ${eventName}`);
      const img = new Image();
      img.onload = () => log(`📊 Image pixel sent for: ${eventName}`);
      img.onerror = () => console.warn(`📊 Image pixel failed for: ${eventName}`);
      img.src = `https://api-eu.mixpanel.com/track?data=${encodeURIComponent(base64String)}&img=1`;
    }
  } catch (e) {
    // Silently fail - analytics should never break the app
    console.warn('📊 Track error:', e);
  }
}

/**
 * Track page view event
 * @param {string} pageName - Name of the page
 * @param {string} pageType - Type of page (notion, image, video, iframe)
 */
function trackPageView(pageName, pageType = 'unknown') {
  trackEvent('page_view', {
    page_name: pageName,
    page_type: pageType
  });
}

/**
 * Track image share event
 * @param {string} imageUrl - URL of the shared image
 */
function trackImageShare(imageUrl) {
  trackEvent('image_shared', {
    image_url: imageUrl ? imageUrl.substring(0, 100) : 'unknown'
  });
}

/**
 * Track visibility toggle event
 * @param {string} pageName - Name of the page
 * @param {boolean} visible - New visibility state
 */
function trackVisibilityToggle(pageName, visible) {
  trackEvent('visibility_toggled', {
    page_name: pageName,
    visible: visible
  });
}

/**
 * Track storage limit reached event
 * @param {string} context - Context where the error occurred
 */
function trackStorageLimitReached(context) {
  trackEvent('storage_limit_reached', {
    context: context
  });
}

/**
 * Track cache cleared event
 */
function trackCacheCleared() {
  trackEvent('cache_cleared');
}

/**
 * Track GM not active event (when player can't access content)
 */
function trackGMNotActive() {
  trackEvent('gm_not_active');
}

/**
 * Track content too large event
 * @param {number} size - Size of the content in bytes
 * @param {string} pageName - Name of the page
 */
function trackContentTooLarge(size, pageName) {
  trackEvent('content_too_large', {
    size_kb: Math.round(size / 1024),
    page_name: pageName
  });
}

/**
 * Track extension opened event
 */
function trackExtensionOpened() {
  trackEvent('extension_opened');
}

/**
 * Track folder added event
 */
function trackFolderAdded(folderName) {
  trackEvent('folder_added', {
    folder_name: folderName
  });
}

/**
 * Track page added event
 */
function trackPageAdded(pageName, pageType = 'unknown', metadata = {}) {
  trackEvent('page_added', {
    page_name: pageName,
    page_type: pageType,
    ...buildPageAddedMetadata({
      url: metadata.url,
      pageType,
      creationMethod: metadata.creationMethod,
      isEmbedCode: metadata.isEmbedCode
    })
  });
}

/**
 * Track folder edited event
 */
function trackFolderEdited(oldName, newName) {
  trackEvent('folder_edited', {
    old_name: oldName,
    new_name: newName
  });
}

/**
 * Track page edited event
 */
function trackPageEdited(pageName) {
  trackEvent('page_edited', {
    page_name: pageName
  });
}

/**
 * Track folder deleted event
 */
function trackFolderDeleted(folderName) {
  trackEvent('folder_deleted', {
    folder_name: folderName
  });
}

/**
 * Track page deleted event
 */
function trackPageDeleted(pageName) {
  trackEvent('page_deleted', {
    page_name: pageName
  });
}

/**
 * Track page moved/reordered event
 */
function trackPageMoved(pageName, direction) {
  trackEvent('page_moved', {
    page_name: pageName,
    direction: direction // 'up' or 'down'
  });
}

/**
 * Track Notion token configured event
 */
function trackTokenConfigured() {
  trackEvent('token_configured');
}

/**
 * Track Notion token removed event
 */
function trackTokenRemoved() {
  trackEvent('token_removed');
}

/**
 * Track JSON imported event
 */
function trackJSONImported(itemCount) {
  trackEvent('json_imported', {
    item_count: itemCount
  });
}

/**
 * Track JSON exported event
 */
function trackJSONExported(itemCount) {
  trackEvent('json_exported', {
    item_count: itemCount
  });
}

/**
 * Track page linked to token event
 */
function trackPageLinkedToToken(pageName, tokenId) {
  trackEvent('page_linked_to_token', {
    page_name: pageName,
    token_id: tokenId ? tokenId.substring(0, 20) : 'unknown'
  });
}

/**
 * Track page viewed from token event
 */
function trackPageViewedFromToken(pageName) {
  trackEvent('page_viewed_from_token', {
    page_name: pageName
  });
}

/**
 * Track page reloaded event
 */
function trackPageReloaded(pageName) {
  trackEvent('page_reloaded', {
    page_name: pageName
  });
}

/**
 * Test Mixpanel connection - call this from console: testMixpanel()
 */
window.testMixpanel = async function() {
  log('🧪 Testing Mixpanel connection...');
  log('📊 Enabled:', mixpanelEnabled);
  log('📊 Token:', mixpanelToken ? mixpanelToken.substring(0, 10) + '...' : 'missing');
  log('📊 Full Token:', mixpanelToken);
  log('📊 Distinct ID:', mixpanelDistinctId);
  
  // Send a test event with unique identifier
  const testId = 'test_' + Date.now();
  await trackEvent('test_event', {
    test: true,
    test_id: testId,
    timestamp: new Date().toISOString(),
    user_agent: navigator.userAgent.substring(0, 50)
  });
  
  log('🧪 Test event sent with ID:', testId);
  log('🧪 Check Mixpanel Live View in 10-30 seconds:');
  log('   https://mixpanel.com/project/[YOUR_PROJECT]/live');
  log('🧪 Or search for event: test_event');
  log('🧪 Test ID to search:', testId);
};

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
      trackTokenConfigured();
      return true;
    } else {
      // Si el token está vacío, eliminarlo
      localStorage.removeItem(GLOBAL_TOKEN_KEY);
      log('🗑️ Token del usuario eliminado');
      trackTokenRemoved();
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

// Claves para sistema de ownership (Master GM / Co-GM)
const FULL_CONFIG_KEY = 'com.dmscreen/fullConfig';
const VAULT_OWNER_KEY = 'com.dmscreen/vaultOwner';
const OWNER_HEARTBEAT_INTERVAL = 120000; // 2 minutos
const OWNER_TIMEOUT = 900000; // 15 minutos

// Límite de tamaño para room metadata (16KB en bytes)
const ROOM_METADATA_SIZE_LIMIT = 16 * 1024; // 16384 bytes
const ROOM_METADATA_SAFE_LIMIT = ROOM_METADATA_SIZE_LIMIT - 1024; // Dejar 1KB de margen
const MAX_METADATA_SIZE = ROOM_METADATA_SIZE_LIMIT; // Alias

/**
 * Calcula el tamaño aproximado de un objeto en bytes cuando se serializa a JSON
 * @param {any} obj - Objeto a medir
 * @returns {number} - Tamaño en bytes
 */
function getJsonSize(obj) {
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
function compressJson(obj) {
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
function stringifyCompact(obj) {
  return JSON.stringify(obj);
}

/**
 * Valida si un objeto puede caber en room metadata
 * @param {any} obj - Objeto a validar
 * @param {boolean} compressed - Si true, valida el tamaño comprimido
 * @returns {{fits: boolean, size: number, limit: number}} - Resultado de la validación
 */
function validateMetadataSize(obj, compressed = true) {
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
 * @returns {object} - { fits, size, limit, percentage }
 */
function validateTotalMetadataSize(metadataKey, newValue, currentMetadata = {}) {
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

/**
 * Recalcula el orden después de filtrar elementos
 * Crea un mapa de índices antiguos a nuevos y ajusta el orden
 * @param {Array} originalOrder - Orden original con índices antiguos
 * @param {Array} originalItems - Array original de items (categories o pages)
 * @param {Array} filteredItems - Array filtrado de items
 * @param {string} type - Tipo de item: 'category' o 'page'
 * @returns {Array} Orden recalculado con nuevos índices
 */
function recalculateOrderAfterFilter(originalOrder, originalItems, filteredItems, type) {
  if (!originalOrder || !Array.isArray(originalOrder)) {
    // Si no hay orden original, crear uno por defecto
    return filteredItems.map((_, index) => ({ type, index }));
  }
  
  // Crear mapa de índices antiguos a nuevos usando IDs únicos
  // Para cada item filtrado, encontrar su índice original por ID
  const indexMap = new Map();
  filteredItems.forEach((filteredItem, newIndex) => {
    // Buscar el índice original del item filtrado usando ID
    const originalIndex = originalItems.findIndex(originalItem => {
      // Usar ID si está disponible, sino fallback a nombre (para compatibilidad con datos legacy)
      if (originalItem.id && filteredItem.id) {
        return originalItem.id === filteredItem.id;
      }
      // Fallback para datos sin ID (legacy)
      return originalItem.name === filteredItem.name;
    });
    if (originalIndex !== -1) {
      indexMap.set(originalIndex, newIndex);
    }
  });
  
  // Recalcular el orden usando el mapa
  const recalculatedOrder = [];
  originalOrder.forEach(item => {
    if (item.type === type && indexMap.has(item.index)) {
      recalculatedOrder.push({
        type: item.type,
        index: indexMap.get(item.index)
      });
    }
    // Mantener otros tipos de items (páginas si estamos filtrando categorías, etc.)
    if (item.type !== type) {
      recalculatedOrder.push(item);
    }
  });
  
  return recalculatedOrder;
}

/**
 * Filtra la configuración para incluir solo páginas visibles para players
 * Se usa para guardar en room metadata (optimiza espacio)
 * @param {object} config - Configuración completa del GM
 * @returns {object} - Configuración filtrada solo con páginas visibles
 */
function filterVisiblePagesForMetadata(config) {
  if (!config || !config.categories) {
    return { categories: [] };
  }
  
  const filterCategory = (category) => {
    // Filtrar páginas visibles
    const originalPages = category.pages || [];
    const visiblePages = originalPages.filter(page => 
      page.visibleToPlayers === true && 
      page.url && 
      !page.url.includes('...')
    ).map(page => ({
      id: page.id, // Preservar ID único para identificación correcta
      name: page.name,
      url: page.url,
      icon: page.icon,
      visibleToPlayers: true,
      // Solo incluir campos esenciales para reducir tamaño
      ...(page.selector ? { selector: page.selector } : {}),
      ...(page.blockTypes ? { blockTypes: page.blockTypes } : {})
    }));
    
    // Filtrar subcategorías recursivamente
    const originalSubcategories = category.categories || [];
    const filteredSubcategories = originalSubcategories
      .map(filterCategory)
      .filter(subCat => 
        subCat !== null && (
          (subCat.pages && subCat.pages.length > 0) || 
          (subCat.categories && subCat.categories.length > 0)
        )
      );
    
    // Solo incluir la categoría si tiene contenido visible
    if (visiblePages.length === 0 && filteredSubcategories.length === 0) {
      return null;
    }
    
    // Recalcular el orden después del filtrado
    let recalculatedOrder = null;
    if (category.order && Array.isArray(category.order)) {
      // Primero recalcular orden de páginas
      const pagesOrder = recalculateOrderAfterFilter(
        category.order,
        originalPages,
        visiblePages,
        'page'
      );
      
      // Luego recalcular orden de categorías
      // La función recalculateOrderAfterFilter mantiene automáticamente los items
      // de otros tipos (páginas) con sus índices ya ajustados
      recalculatedOrder = recalculateOrderAfterFilter(
        pagesOrder, // Usar el orden ya ajustado de páginas
        originalSubcategories,
        filteredSubcategories,
        'category'
      );
    }
    
    return {
      id: category.id, // Preservar ID único para identificación correcta
      name: category.name,
      ...(category.icon ? { icon: category.icon } : {}),
      ...(visiblePages.length > 0 ? { pages: visiblePages } : {}),
      ...(filteredSubcategories.length > 0 ? { categories: filteredSubcategories } : {}),
      ...(recalculatedOrder && recalculatedOrder.length > 0 ? { order: recalculatedOrder } : {})
    };
  };
  
  const originalCategories = config.categories || [];
  const filteredCategories = originalCategories
    .map(filterCategory)
    .filter(cat => cat !== null);
  
  // Recalcular el orden del nivel raíz
  let rootOrder = null;
  if (config.order && Array.isArray(config.order)) {
    rootOrder = recalculateOrderAfterFilter(
      config.order,
      originalCategories,
      filteredCategories,
      'category'
    );
  }
  
  // Inicializar orden si no existe en las categorías filtradas
  if (filteredCategories.length > 0) {
    filteredCategories.forEach(cat => {
      if (!cat.order || !Array.isArray(cat.order) || cat.order.length === 0) {
        initializeOrderRecursive(cat, cat.name || 'category');
      }
    });
  }
  
  return {
    categories: filteredCategories,
    ...(rootOrder && rootOrder.length > 0 ? { order: rootOrder } : {})
  };
}

// ============================================
// SISTEMA DE OWNERSHIP (Master GM / Co-GM)
// ============================================

// Variable para almacenar el intervalo del heartbeat
let ownerHeartbeatInterval = null;

// Variable global para indicar si el usuario es Co-GM (solo lectura)
let isCoGMGlobal = false;

// Variable global para el roomId (se establece una vez al inicio)
let currentRoomId = null;

// Variable para almacenar el último rol conocido
let lastKnownRole = null;

// Función para desuscribirse de cambios de rol (usa Player.onChange en vez de polling)
let roleChangeUnsubscribe = null;

/**
 * Verifica el estado de ownership del vault
 * @returns {Promise<{hasOwner: boolean, ownerInfo: object|null, isStale: boolean, isMe: boolean}>}
 */
async function checkVaultOwnership() {
  try {
    const metadata = await OBR.room.getMetadata();
    const ownerInfo = metadata ? metadata[VAULT_OWNER_KEY] : null;
    
    if (!ownerInfo) {
      return { hasOwner: false, ownerInfo: null, isStale: false, isMe: false };
    }
    
    const myId = await OBR.player.getId();
    const isMe = ownerInfo.playerId === myId;
    const timeSinceLastActivity = Date.now() - (ownerInfo.timestamp || 0);
    const isStale = timeSinceLastActivity > OWNER_TIMEOUT;
    
    return {
      hasOwner: true,
      ownerInfo,
      isStale,
      isMe,
      minutesInactive: Math.round(timeSinceLastActivity / 60000)
    };
  } catch (e) {
    console.error('Error checking vault ownership:', e);
    return { hasOwner: false, ownerInfo: null, isStale: false, isMe: false };
  }
}

/**
 * Establece el owner actual del vault
 * @param {string} roomId - ID de la room
 */
async function setVaultOwner(roomId) {
  try {
    const playerId = await OBR.player.getId();
    const playerName = await OBR.player.getName();
    const sessionId = Math.random().toString(36).substring(7);
    
    const ownerInfo = {
      playerId,
      playerName,
      timestamp: Date.now(),
      sessionId
    };
    
    await OBR.room.setMetadata({
      [VAULT_OWNER_KEY]: ownerInfo
    });
    
    // Guardar sessionId para verificación de heartbeat
    localStorage.setItem('com.dmscreen/ownerSession-' + roomId, sessionId);
    
    return ownerInfo;
  } catch (e) {
    console.error('Error setting vault owner:', e);
    return null;
  }
}

/**
 * Inicia el heartbeat del owner
 * @param {string} roomId - ID de la room
 */
function startOwnerHeartbeat(roomId) {
  // Cancelar heartbeat previo si existe
  stopOwnerHeartbeat();
  
  ownerHeartbeatInterval = setInterval(async () => {
    try {
      const metadata = await OBR.room.getMetadata();
      const ownerInfo = metadata ? metadata[VAULT_OWNER_KEY] : null;
      const myId = await OBR.player.getId();
      const mySession = localStorage.getItem('com.dmscreen/ownerSession-' + roomId);
      
      // Solo actualizar si sigo siendo el owner con la misma sesión
      if (ownerInfo && 
          ownerInfo.playerId === myId && 
          ownerInfo.sessionId === mySession) {
        
        await OBR.room.setMetadata({
          [VAULT_OWNER_KEY]: {
            ...ownerInfo,
            timestamp: Date.now()
          }
        });
        
        log('💓 Owner heartbeat sent');
      } else {
        // Ya no soy el owner, detener heartbeat
        console.log('⚠️ No longer owner, stopping heartbeat');
        stopOwnerHeartbeat();
      }
    } catch (e) {
      console.error('Error sending heartbeat:', e);
    }
  }, OWNER_HEARTBEAT_INTERVAL);
  
  console.log('💓 Owner heartbeat started');
}

/**
 * Detiene el heartbeat del owner
 */
function stopOwnerHeartbeat() {
  if (ownerHeartbeatInterval) {
    clearInterval(ownerHeartbeatInterval);
    ownerHeartbeatInterval = null;
    console.log('💓 Owner heartbeat stopped');
  }
}

/**
 * Detecta si el GM actual está en modo Co-GM (solo lectura)
 * @returns {Promise<boolean>}
 */
async function isCoGMMode() {
  try {
    const role = await OBR.player.getRole();
    if (role !== 'GM') return false;
    
    const ownership = await checkVaultOwnership();
    
    // Es Co-GM si hay un owner activo y no soy yo
    return ownership.hasOwner && !ownership.isMe && !ownership.isStale;
  } catch (e) {
    return false;
  }
}

/**
 * Cuenta el total de páginas en una configuración
 * @param {object} config - Configuración del vault
 * @returns {number}
 */
function countPages(config) {
  if (!config || !config.categories) return 0;
  let count = 0;
  
  const countRecursive = (categories) => {
    if (!Array.isArray(categories)) return;
    categories.forEach(cat => {
      if (cat.pages && Array.isArray(cat.pages)) {
        count += cat.pages.filter(p => p && p.url).length;
      }
      if (cat.categories) {
        countRecursive(cat.categories);
      }
    });
  };
  
  countRecursive(config.categories);
  return count;
}

/**
 * Cuenta el total de categorías en una configuración
 * @param {object} config - Configuración del vault
 * @returns {number}
 */
function countCategories(config) {
  if (!config || !config.categories) return 0;
  let count = config.categories.length;
  
  const countRecursive = (categories) => {
    if (!Array.isArray(categories)) return;
    categories.forEach(cat => {
      if (cat.categories && Array.isArray(cat.categories)) {
        count += cat.categories.length;
        countRecursive(cat.categories);
      }
    });
  };
  
  countRecursive(config.categories);
  return count;
}

/**
 * Calcula el tamaño en bytes de una configuración comprimida
 * @param {object} config - Configuración del vault
 * @returns {number}
 */
function getConfigSize(config) {
  try {
    const compressed = compressJson(config);
    return new Blob([JSON.stringify(compressed)]).size;
  } catch (e) {
    return 0;
  }
}

/**
 * Inicia la detección de cambios de rol usando Player.onChange
 * Detecta promoción/revocación de GM y recarga la vista automáticamente
 */
function startRoleChangeDetection() {
  // Cancelar suscripción previa si existe
  if (roleChangeUnsubscribe) {
    roleChangeUnsubscribe();
    roleChangeUnsubscribe = null;
  }
  
  // Usar OBR.player.onChange para detectar cambios de rol (event-driven, sin polling)
  roleChangeUnsubscribe = OBR.player.onChange((player) => {
    try {
      const currentRole = player.role;
      
      if (lastKnownRole !== null && currentRole !== lastKnownRole) {
        console.log(`🔄 Role change detected: ${lastKnownRole} → ${currentRole}`);
        
        // Recargar la extensión para aplicar los cambios
        window.location.reload();
      }
      
      lastKnownRole = currentRole;
    } catch (e) {
      // Ignorar errores
    }
  });
}

/**
 * Detiene la detección de cambios de rol
 */
function stopRoleChangeDetection() {
  if (roleChangeUnsubscribe) {
    roleChangeUnsubscribe();
    roleChangeUnsubscribe = null;
  }
}

// Detener heartbeat y detección de rol al cerrar la ventana
window.addEventListener('beforeunload', () => {
  stopOwnerHeartbeat();
  stopRoleChangeDetection();
});

// Canal de broadcast para sincronizar lista de páginas visibles
const BROADCAST_CHANNEL_VISIBLE_PAGES = 'com.dmscreen/visiblePages';
const BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES = 'com.dmscreen/requestVisiblePages';

/**
 * Envía la lista de páginas visibles a todos los players vía broadcast
 * @param {object} visibleConfig - Configuración filtrada con solo páginas visibles
 */
function broadcastVisiblePagesUpdate(visibleConfig) {
  try {
    OBR.broadcast.sendMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {
      config: visibleConfig,
      timestamp: Date.now()
    });
    log('📤 Lista de páginas visibles enviada vía broadcast');
  } catch (e) {
    console.warn('⚠️ No se pudo enviar lista de páginas visibles vía broadcast:', e);
  }
}

/**
 * Solicitar lista de páginas visibles al GM (para players)
 * @returns {Promise<object|null>} - Configuración de páginas visibles o null si no hay respuesta
 */
async function requestVisiblePagesFromGM() {
  return new Promise((resolve) => {
    log('📡 Solicitando lista de páginas visibles al GM...');
    
    // Timeout de 5 segundos
    const timeout = setTimeout(() => {
      log('⏰ Timeout esperando lista de páginas visibles del GM');
      unsubscribe();
      resolve(null);
    }, 5000);
    
    // Escuchar respuesta del GM
    const unsubscribe = OBR.broadcast.onMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, (event) => {
      const data = event.data;
      if (data && data.config) {
        log('✅ Lista de páginas visibles recibida del GM');
        clearTimeout(timeout);
        unsubscribe();
        resolve(data.config);
      }
    });
    
    // Enviar solicitud al GM
    OBR.broadcast.sendMessage(BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES, { 
      requestId: Date.now() 
    });
  });
}

/**
 * Configurar el GM para responder a solicitudes de lista de páginas visibles
 */
function setupGMVisiblePagesBroadcast() {
  OBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES, async (event) => {
    log('📨 Recibida solicitud de lista de páginas visibles');
    
    // Obtener la configuración actual y filtrar
    const currentConfig = pagesConfigCache || getPagesJSON(OBR.room.id);
    if (currentConfig) {
      const visibleConfig = filterVisiblePagesForMetadata(currentConfig);
      broadcastVisiblePagesUpdate(visibleConfig);
    }
  });
  log('🎧 GM escuchando solicitudes de lista de páginas visibles');
}

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
  
  // Fallback a localStorage
  return getPagesJSONFromLocalStorage(roomId);
}

// Función para obtener directamente de localStorage (ignora cache)
// Útil para el GM que siempre debe usar su localStorage
function getPagesJSONFromLocalStorage(roomId) {
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
    
    try {
      localStorage.setItem(storageKey, JSON.stringify(json, null, 2));
    } catch (storageError) {
      console.error('Error al guardar en localStorage:', storageError);
      if (storageError.name === 'QuotaExceededError') {
        console.warn('⚠️ localStorage lleno. Mostrando modal al usuario.');
        showStorageLimitModal('saving configuration');
        return false;
      }
      throw storageError;
    }
    
    // Filtrar solo páginas visibles para guardar en room metadata
    const visibleOnlyConfig = filterVisiblePagesForMetadata(json);
    
    // Obtener metadatos actuales para validar tamaño TOTAL
    let currentMetadata = {};
    try {
      currentMetadata = await OBR.room.getMetadata() || {};
    } catch (e) {
      console.warn('No se pudo obtener metadatos actuales:', e);
    }
    
    // ============================================
    // GUARDAR FULL_CONFIG_KEY PARA CO-GM
    // ============================================
    // Intentar guardar la configuración completa para que Co-GM pueda leerla
    try {
      const fullConfigCompressed = compressJson(json);
      const fullConfigSize = getConfigSize(fullConfigCompressed);
      const pageCountForSync = countPages(json);
      
      // Verificar si cabe en metadata (16KB limit)
      if (fullConfigSize < MAX_METADATA_SIZE) {
        // Limpiar caches primero para maximizar espacio disponible
        await OBR.room.setMetadata({
          [ROOM_CONTENT_CACHE_KEY]: null,
          [ROOM_HTML_CACHE_KEY]: null
        });
        
        // Guardar configuración completa
        await OBR.room.setMetadata({
          [FULL_CONFIG_KEY]: fullConfigCompressed
        });
        
        log(`✅ Config completa sincronizada para Co-GM (${(fullConfigSize / 1024).toFixed(1)}KB, ${pageCountForSync} páginas)`);
      } else {
        // Config demasiado grande, solo guardar para Players (visible)
        logWarn(`⚠️ Config completa demasiado grande para Co-GM sync (${(fullConfigSize / 1024).toFixed(1)}KB > 16KB)`);
        // Limpiar FULL_CONFIG_KEY ya que no podemos mantenerlo actualizado
        await OBR.room.setMetadata({
          [FULL_CONFIG_KEY]: null
        });
      }
    } catch (e) {
      console.warn('No se pudo guardar FULL_CONFIG_KEY para Co-GM:', e);
    }
    
    // Validar tamaño TOTAL considerando todos los metadatos (solo con páginas visibles)
    const validation = validateTotalMetadataSize(ROOM_METADATA_KEY, visibleOnlyConfig, currentMetadata);
    
    if (validation.fits) {
      // Guardar en OBR.room.metadata para compartir con todos los usuarios (solo páginas visibles)
      const compressed = compressJson(visibleOnlyConfig);
      try {
        await OBR.room.setMetadata({
          [ROOM_METADATA_KEY]: compressed
        });
        log(`✅ Configuración visible sincronizada con room metadata (${validation.percentage}% del límite total)`);
        
        // Enviar actualización vía broadcast a todos los players
        broadcastVisiblePagesUpdate(visibleOnlyConfig);
      } catch (e) {
        // Si falla, puede ser por tamaño o por otro error
        if (e.message && (e.message.includes('size') || e.message.includes('limit') || e.message.includes('16'))) {
          // Limpiar el caché de contenido para hacer espacio
          logWarn('⚠️ Room metadata lleno. Limpiando caché de contenido...');
          try {
            await OBR.room.setMetadata({
              [ROOM_CONTENT_CACHE_KEY]: {}
            });
            // Intentar guardar de nuevo
            await OBR.room.setMetadata({
              [ROOM_METADATA_KEY]: compressed
            });
            log('✅ Configuración guardada después de limpiar caché');
            broadcastVisiblePagesUpdate(visibleOnlyConfig);
          } catch (e2) {
            logWarn('⚠️ La configuración visible es demasiado grande para room metadata (>16KB). Usando solo broadcast.');
            // Enviar solo vía broadcast
            broadcastVisiblePagesUpdate(visibleOnlyConfig);
          }
        } else {
          console.warn('⚠️ No se pudo sincronizar con room metadata:', e);
        }
      }
    } else {
      // El tamaño excede el límite, intentar limpiar el caché de contenido
      logWarn('⚠️ Room metadata casi lleno. Limpiando caché de contenido...');
      try {
        await OBR.room.setMetadata({
          [ROOM_CONTENT_CACHE_KEY]: {}
        });
        // Intentar guardar después de limpiar
        const compressed = compressJson(visibleOnlyConfig);
        await OBR.room.setMetadata({
          [ROOM_METADATA_KEY]: compressed
        });
        log('✅ Configuración guardada después de limpiar caché');
        broadcastVisiblePagesUpdate(visibleOnlyConfig);
      } catch (e) {
        logWarn('⚠️ La configuración visible es demasiado grande para room metadata (>16KB). Usando solo broadcast.');
        logWarn(`   Tamaño total: ${(validation.size / 1024).toFixed(2)}KB / ${(ROOM_METADATA_SAFE_LIMIT / 1024).toFixed(2)}KB`);
        // Enviar solo vía broadcast
        broadcastVisiblePagesUpdate(visibleOnlyConfig);
      }
    }
    
    log('✅ Configuración guardada exitosamente para room:', roomId);
    return true;
  } catch (e) {
    console.error('Error al guardar JSON:', e);
    if (e.name === 'QuotaExceededError') {
      showStorageLimitModal('saving configuration');
    }
    return false;
  }
}

// Función para cargar configuración desde room metadata (compartida entre usuarios)
// NOTA: Solo para Players - el GM usa localStorage directamente
async function loadPagesFromRoomMetadata() {
  try {
    const metadata = await OBR.room.getMetadata();
    if (metadata && metadata[ROOM_METADATA_KEY]) {
      // NO actualizar pagesConfigCache aquí - eso lo hace el flujo principal
      // para evitar que el GM sobrescriba su config completa con la filtrada
      const config = metadata[ROOM_METADATA_KEY];
      log('✅ Configuración cargada desde room metadata');
      return config;
    }
  } catch (e) {
    console.warn('⚠️ No se pudo cargar desde room metadata:', e);
  }
  return null;
}

// Listener para cambios en metadata de room (sincronización en tiempo real)
// IMPORTANTE: Solo para Players - el GM genera la configuración, no la recibe
function setupRoomMetadataListener(roomId) {
  try {
    OBR.room.onMetadataChange(async (metadata) => {
      // Verificar si es GM
      let isGM = false;
      try {
        const role = await OBR.player.getRole();
        isGM = role === 'GM';
      } catch (e) {
        // Si falla, asumir que no es GM para ser seguro
      }
      
      // Master GM: ignorar los cambios (él los genera)
      if (isGM && !isCoGMGlobal) {
        log('🔄 [Master GM] Ignorando cambio en room metadata (el GM genera la config)');
        return;
      }
      
      // Co-GM: actualizar desde FULL_CONFIG_KEY (vault completo)
      if (isCoGMGlobal) {
        if (metadata && metadata[FULL_CONFIG_KEY]) {
          const newConfig = metadata[FULL_CONFIG_KEY];
          // Solo actualizar si es diferente
          if (JSON.stringify(newConfig) !== JSON.stringify(pagesConfigCache)) {
            log('🔄 [Co-GM] Vault actualizado desde Master GM');
            pagesConfigCache = newConfig;
            
            // Recargar la vista
            const pageList = document.getElementById("page-list");
            if (pageList) {
              await renderPagesByCategories(newConfig, pageList, roomId);
            }
          }
        }
        
        // Verificar si el Master GM se desconectó
        if (metadata && metadata[VAULT_OWNER_KEY]) {
          const ownerInfo = metadata[VAULT_OWNER_KEY];
          const timeSinceLastActivity = Date.now() - (ownerInfo.timestamp || 0);
          
          if (timeSinceLastActivity > OWNER_TIMEOUT) {
            // Master GM inactivo, mostrar banner de warning
            showMasterGMDisconnectedBanner({
              ownerInfo,
              minutesInactive: Math.round(timeSinceLastActivity / 60000)
            });
          }
        }
        return;
      }
      
      // Player: actualizar desde ROOM_METADATA_KEY (solo páginas visibles)
      if (metadata && metadata[ROOM_METADATA_KEY]) {
        const newConfig = metadata[ROOM_METADATA_KEY];
        // Solo actualizar si es diferente
        if (JSON.stringify(newConfig) !== JSON.stringify(pagesConfigCache)) {
          log('🔄 [Player] Configuración actualizada desde room metadata');
          pagesConfigCache = newConfig;
          
          // NO actualizar localStorage para players (solo usan room metadata)
          
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
    // Intentar cargar desde URL pública de Netlify
    const response = await fetch('https://owlbear-gm-vault.netlify.app/public/default-config.json');
    if (response.ok) {
      const config = await response.json();
      log('✅ Configuración por defecto cargada desde default-config.json');
      return config;
    }
  } catch (e) {
    log('⚠️ No se pudo cargar default-config.json desde la URL pública:', e);
    // Intentar fallback a ruta relativa (para desarrollo local)
    try {
      const localResponse = await fetch('/default-config.json');
      if (localResponse.ok) {
        const config = await localResponse.json();
        log('✅ Configuración por defecto cargada desde ruta local');
        return config;
      }
    } catch (localError) {
      log('⚠️ No se pudo cargar default-config.json desde ruta local:', localError);
    }
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
        log('✅ Bloques obtenidos del caché para:', pageId);
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
    log('💾 Bloques guardados en caché para:', pageId);
    
    // Si es GM, también guardar en caché compartido para jugadores
    saveToSharedCache(pageId, blocks);
  } catch (e) {
    console.error('Error al guardar en caché:', e);
    // Si el localStorage está lleno, mostrar modal al usuario
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ localStorage lleno. Mostrando modal al usuario.');
      showStorageLimitModal('caching page content');
    }
  }
}

// Guardar contenido en caché compartido (room metadata) para jugadores
async function saveToSharedCache(pageId, blocks) {
  try {
    // Solo guardar si es GM
    const isGM = await getUserRole();
    if (!isGM) return;
    
    // Obtener todos los metadatos actuales
    const metadata = await OBR.room.getMetadata() || {};
    let sharedCache = (metadata[ROOM_CONTENT_CACHE_KEY]) || {};
    
    // Crear la nueva entrada
    const newEntry = {
      blocks: blocks,
      savedAt: new Date().toISOString()
    };
    
    // Probar si cabe considerando el tamaño TOTAL de todos los metadatos
    const testCache = { ...sharedCache, [pageId]: newEntry };
    const validation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, testCache, metadata);
    
    // Si no cabe, limpiar entradas antiguas hasta que quepa
    if (!validation.fits) {
      const cacheKeys = Object.keys(sharedCache);
      if (cacheKeys.length > 0) {
        // Ordenar por fecha (más antiguas primero)
        const sortedKeys = cacheKeys.sort((a, b) => {
          const dateA = sharedCache[a]?.savedAt ? new Date(sharedCache[a].savedAt) : new Date(0);
          const dateB = sharedCache[b]?.savedAt ? new Date(sharedCache[b].savedAt) : new Date(0);
          return dateA - dateB;
        });
        
        // Eliminar entradas antiguas hasta que quepa
        let reducedCache = { ...sharedCache };
        let entriesRemoved = 0;
        for (const key of sortedKeys) {
          delete reducedCache[key];
          entriesRemoved++;
          const testReduced = { ...reducedCache, [pageId]: newEntry };
          const reducedValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, testReduced, metadata);
          if (reducedValidation.fits) {
            sharedCache = reducedCache;
            log(`🗑️ Eliminadas ${entriesRemoved} entradas antiguas del caché para hacer espacio`);
            break;
          }
        }
      }
      
      // Verificar si ahora cabe después de limpiar
      const finalTestCache = { ...sharedCache, [pageId]: newEntry };
      const finalTestValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, finalTestCache, metadata);
      if (!finalTestValidation.fits) {
        // Si aún no cabe después de limpiar todo el caché, no guardar
        log('ℹ️ No hay espacio en room metadata. El contenido se compartirá vía broadcast.');
        return; // No guardar esta entrada, se usará broadcast
      }
    }
    
    // Limitar el número de entradas (máximo 10 para priorizar configuración)
    const cacheKeys = Object.keys(sharedCache);
    if (cacheKeys.length >= 10 && !sharedCache[pageId]) {
      // Eliminar las 3 entradas más antiguas para hacer espacio
      const sortedKeys = cacheKeys.sort((a, b) => {
        const dateA = sharedCache[a]?.savedAt ? new Date(sharedCache[a].savedAt) : new Date(0);
        const dateB = sharedCache[b]?.savedAt ? new Date(sharedCache[b].savedAt) : new Date(0);
        return dateA - dateB;
      });
      for (let i = 0; i < 3 && i < sortedKeys.length; i++) {
        delete sharedCache[sortedKeys[i]];
      }
    }
    
    // Guardar el contenido
    sharedCache[pageId] = newEntry;
    
    // Validar tamaño final antes de guardar
    const finalValidation = validateTotalMetadataSize(ROOM_CONTENT_CACHE_KEY, sharedCache, metadata);
    if (finalValidation.fits) {
      await OBR.room.setMetadata({
        [ROOM_CONTENT_CACHE_KEY]: compressJson(sharedCache)
      });
      log(`💾 Contenido guardado en caché compartido para: ${pageId} (${finalValidation.percentage}% del límite total)`);
    } else {
      log('ℹ️ No hay espacio en room metadata. El contenido se compartirá vía broadcast.');
    }
  } catch (e) {
    // Si el error es por tamaño, es esperado
    if (e.message && (e.message.includes('size') || e.message.includes('limit') || e.message.includes('16'))) {
      log('ℹ️ El caché compartido está lleno. El contenido se compartirá vía broadcast.');
    } else {
      // Ignorar otros errores silenciosamente - el caché compartido es opcional
      console.debug('No se pudo guardar en caché compartido:', e);
    }
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
    log('🗑️ Eliminada entrada más antigua del caché HTML local:', oldestKey);
  }
  
  localHtmlCache[pageId] = {
    html: html,
    savedAt: Date.now()
  };
  log('💾 HTML guardado en caché local para:', pageId, '- tamaño:', html.length, 'caracteres');
}

/**
 * Solicitar HTML al GM via broadcast (para jugadores)
 * @param {string} pageId - ID de la página de Notion
 * @returns {Promise<string|null>} - HTML renderizado o null si no hay respuesta
 */
async function requestHtmlFromGM(pageId) {
  return new Promise((resolve) => {
    log('📡 Solicitando contenido al GM para:', pageId);
    
    // Timeout de 5 segundos
    const timeout = setTimeout(() => {
      log('⏰ Timeout esperando respuesta del GM');
      unsubscribe();
      resolve(null);
    }, 5000);
    
    // Escuchar respuesta del GM
    const unsubscribe = OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE, (event) => {
      const data = event.data;
      if (data && data.pageId === pageId && data.html) {
        log('✅ Recibido HTML del GM para:', pageId, '- tamaño:', data.html.length);
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
      log('📨 Recibida solicitud de contenido para:', data.pageId);
      
      // Buscar en caché local
      const cached = localHtmlCache[data.pageId];
      if (cached && cached.html) {
        log('📤 Enviando HTML cacheado para:', data.pageId);
        OBR.broadcast.sendMessage(BROADCAST_CHANNEL_RESPONSE, {
          pageId: data.pageId,
          html: cached.html
        });
      } else {
        log('⚠️ No hay HTML en caché local para:', data.pageId);
      }
    }
  });
  log('🎧 GM escuchando solicitudes de contenido');
}

/**
 * Limpiar todo el caché manualmente (localStorage)
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
    log('🗑️ Caché limpiado:', keysToRemove.length, 'entradas');
    return keysToRemove.length;
  } catch (e) {
    console.error('Error al limpiar caché:', e);
    return 0;
  }
}

/**
 * Limpiar el caché de contenido compartido en room metadata
 * Esto libera espacio para la configuración de páginas
 */
async function clearSharedContentCache() {
  try {
    await OBR.room.setMetadata({
      [ROOM_CONTENT_CACHE_KEY]: {}
    });
    log('🗑️ Caché compartido (room metadata) limpiado');
    return true;
  } catch (e) {
    console.error('Error al limpiar caché compartido:', e);
    return false;
  }
}

/**
 * Limpiar TODOS los metadatos de la room (configuración y caché)
 * ⚠️ Esto reiniciará la extensión a su estado inicial
 */
async function clearAllRoomMetadata() {
  try {
    await OBR.room.setMetadata({
      [ROOM_METADATA_KEY]: null,
      [ROOM_CONTENT_CACHE_KEY]: null
    });
    log('🗑️ Todos los metadatos de room limpiados');
    return true;
  } catch (e) {
    console.error('Error al limpiar metadatos de room:', e);
    return false;
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
    const isNotionUrlCheck = isNotionUrl(url);
    if (!isNotionUrlCheck) {
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
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page`;
      headers['X-Notion-Token'] = userToken;
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
        log('✅ Información de página obtenida del caché para:', pageId);
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
    log('💾 Información de página guardada en caché para:', pageId);
  } catch (e) {
    console.error('Error al guardar información de página en caché:', e);
    // Si el localStorage está lleno, mostrar modal al usuario
    if (e.name === 'QuotaExceededError') {
      console.warn('⚠️ localStorage lleno. Mostrando modal al usuario.');
      showStorageLimitModal('caching page information');
    }
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
    
    const apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}&type=page`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Notion-Token': userToken
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
            <div class="image-loading">
              <div class="loading-spinner"></div>
            </div>
            <img src="${coverUrl}" alt="Page cover" class="notion-cover-image" data-image-url="${coverUrl}" 
                 onload="this.classList.add('loaded'); const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove();" />
            <button class="notion-image-share-button share-button" 
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
      log('✅ Estado 2: Usando caché persistente para:', pageId, '-', cachedBlocks.length, 'bloques');
      return cachedBlocks;
    }
    log('⚠️ Estado 1: No hay caché para:', pageId, '- se pedirá a la API');
  } else {
    log('🔄 Estado 3: Recarga forzada - ignorando caché para:', pageId);
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
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(pageId)}`;
      headers['X-Notion-Token'] = userToken;
    } else {
      // No hay token del usuario → intentar obtener del caché compartido (room metadata)
      try {
        const metadata = await OBR.room.getMetadata();
        const sharedCache = metadata && metadata[ROOM_CONTENT_CACHE_KEY];
        if (sharedCache && sharedCache[pageId] && sharedCache[pageId].blocks) {
          log('✅ Usando caché compartido (room metadata) para:', pageId);
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
        throw new Error('Page not found. Verify that the URL is correct and that the integration has access.');
      } else {
        throw new Error(`Error de API: ${response.status} - ${errorData.message || response.statusText}`);
      }
    }

    const data = await response.json();
    const blocks = data.results || [];
    
    // Log detallado de los bloques recibidos
    log('📦 Bloques recibidos de la API:', blocks.length);
    if (blocks.length > 0) {
      log('📋 Tipos de bloques encontrados:', blocks.map(b => b.type));
      // Log detallado de cada bloque
      blocks.forEach((block, index) => {
        log(`  [${index}] Tipo: ${block.type}`, {
          id: block.id,
          hasContent: !!block[block.type],
          content: block[block.type] ? Object.keys(block[block.type]) : []
        });
        // Si es una imagen, mostrar más detalles
        if (block.type === 'image') {
          log('    🖼️ Detalles de imagen:', {
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
      log('💾 Estado 1: Bloques guardados en caché persistente para:', pageId);
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

    case 'heading_4':
      return `<h4>${renderRichText(block.heading_4?.rich_text)}</h4>`;

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
        log('🖼️ Renderizando imagen:', {
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
              <div class="image-loading">
                <div class="loading-spinner"></div>
              </div>
              <img 
                src="${imageUrl}" 
                alt="${caption || 'Imagen de Notion'}" 
                class="notion-image-clickable" 
                data-image-id="${imageId}" 
                data-image-url="${imageUrl}" 
                data-image-caption="${caption.replace(/"/g, '&quot;')}"
                data-block-id="${block.id}"
                loading="eager"
                onload="this.classList.add('loaded'); const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove();"
                onerror="this.style.opacity='0.5';"
              />
              <button class="notion-image-share-button share-button" 
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
      return '<div class="notion-table-container" data-table-id="' + block.id + '">Loading table...</div>';
    
    case 'child_database':
      // Las bases de datos se manejan de forma especial en renderBlocks (similar a las tablas)
      // Este caso no debería ejecutarse nunca, pero lo dejamos por seguridad
      return '<div class="notion-database-placeholder" data-database-id="' + block.id + '">Loading database...</div>';
    
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
      return `<details class="notion-toggle"><summary>${toggleText}</summary><div class="notion-toggle-content" data-toggle-id="${block.id}">Loading content...</div></details>`;
    
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
      log('✅ Usando caché para hijos del bloque:', blockId);
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
      apiUrl = `/.netlify/functions/notion-api?pageId=${encodeURIComponent(blockId)}`;
      headers['X-Notion-Token'] = userToken;
    } else {
      // No hay token del usuario → intentar obtener del caché compartido (room metadata)
      try {
        const metadata = await OBR.room.getMetadata();
        const sharedCache = metadata && metadata[ROOM_CONTENT_CACHE_KEY];
        if (sharedCache && sharedCache[blockId] && sharedCache[blockId].blocks) {
          log('✅ Usando caché compartido para hijos del bloque:', blockId);
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
  
  log('🔽 Renderizando toggle:', toggleBlock.id, {
    hasChildren: toggleBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleBlock.has_children) {
    log('  📦 Obteniendo hijos del toggle...');
      const children = await fetchBlockChildren(toggleBlock.id, useCache);
    log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
      log(`  ✅ Contenido del toggle renderizado: ${toggleContent.length} caracteres`);
    } else {
      log(`  ⚠️ Toggle sin contenido`);
    }
  } else {
    log(`  ℹ️ Toggle sin hijos`);
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
  
  log(`🔽 Renderizando toggle_heading_${headingLevel}:`, toggleHeadingBlock.id, {
    hasChildren: toggleHeadingBlock.has_children
  });
  
  let toggleContent = '';
  
  if (toggleHeadingBlock.has_children) {
    log(`  📦 Obteniendo hijos del toggle_heading_${headingLevel}...`);
      const children = await fetchBlockChildren(toggleHeadingBlock.id, useCache);
    log(`  📦 Hijos obtenidos: ${children.length}`);
    if (children.length > 0) {
      // Los hijos de un toggle heading deben tener un offset de nivel +1
      toggleContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1, useCache);
      log(`  ✅ Contenido del toggle_heading_${headingLevel} renderizado: ${toggleContent.length} caracteres`);
    } else {
      log(`  ⚠️ Toggle heading sin contenido`);
    }
  } else {
    log(`  ℹ️ Toggle heading sin hijos`);
  }
  
  // Si hay un filtro activo y el toggle_heading no coincide con el tipo filtrado,
  // solo devolver el contenido de los hijos (sin el contenedor del toggle)
  if (blockTypes) {
    const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
    const toggleHeadingType = `toggle_heading_${headingLevel}`;
    if (!typesArray.includes(toggleHeadingType) && !typesArray.includes('heading_1') && !typesArray.includes('heading_2') && !typesArray.includes('heading_3') && !typesArray.includes('heading_4') && toggleContent.trim()) {
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
// Devuelve un objeto con { html, siblingColumnsCount }
async function renderColumnList(columnListBlock, allBlocks, currentIndex, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  log('📐 Renderizando column_list:', columnListBlock.id, {
    hasChildren: columnListBlock.has_children,
    currentIndex: currentIndex,
    totalBlocks: allBlocks.length
  });
  
  let columns = [];
  let columnsFoundAsSiblings = false;
  
  // Opción 1: Las columnas son hijos del column_list (más común)
  if (columnListBlock.has_children) {
    log('  📦 Obteniendo columnas como hijos del column_list...');
      const children = await fetchBlockChildren(columnListBlock.id, useCache);
    log(`  📦 Hijos obtenidos: ${children.length}`, children.map(c => c.type));
    columns = children.filter(block => block.type === 'column');
    log(`  📐 Columnas encontradas como hijos: ${columns.length}`);
  }
  
  // Opción 2: Las columnas son bloques hermanos que siguen al column_list
  if (columns.length === 0) {
    log('  🔍 Buscando columnas como bloques hermanos...');
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
    columnsFoundAsSiblings = true;
    log(`  📐 Columnas encontradas como hermanos: ${columns.length}`);
  }
  
  if (columns.length === 0) {
    console.warn('  ⚠️ No se encontraron columnas para el column_list');
    return { html: '<div class="notion-column-list">[Sin columnas]</div>', siblingColumnsCount: 0 };
  }
  
  log(`  ✅ Total de columnas encontradas: ${columns.length}`);
  
  // Renderizar cada columna con sus bloques hijos
  const columnHtmls = await Promise.all(columns.map(async (columnBlock, colIndex) => {
    let columnContent = '';
    
    log(`  📄 Procesando columna ${colIndex + 1}/${columns.length}:`, {
      id: columnBlock.id,
      hasChildren: columnBlock.has_children
    });
    
    if (columnBlock.has_children) {
      log(`    🔽 Obteniendo hijos de columna: ${columnBlock.id}`);
      const children = await fetchBlockChildren(columnBlock.id, useCache);
      log(`    🔽 Hijos obtenidos: ${children.length}`);
      if (children.length > 0) {
        columnContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
        log(`    ✅ Contenido de columna renderizado: ${columnContent.length} caracteres`);
      } else {
        log(`    ⚠️ Columna sin contenido`);
      }
    } else {
      log(`    ℹ️ Columna sin hijos`);
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
    return { html: '', siblingColumnsCount: columnsFoundAsSiblings ? columns.length : 0 };
  }
  
  return {
    html: `<div class="notion-column-list">${validColumnHtmls.join('')}</div>`,
    siblingColumnsCount: columnsFoundAsSiblings ? columns.length : 0
  };
}

// Función para renderizar todos los bloques
async function renderBlocks(blocks, blockTypes = null, headingLevelOffset = 0, useCache = true) {
  let html = '';
  let inList = false;
  let listType = null;
  let listItems = [];
  
  log('🎨 Iniciando renderizado de', blocks.length, 'bloques', blockTypes ? `(filtro: ${Array.isArray(blockTypes) ? blockTypes.join(', ') : blockTypes})` : '');
  
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
      log(`  🔍 Filtrados: ${filteredBlocks.length} de ${blocks.length} bloques (manteniendo bloques con hijos para búsqueda recursiva)`);
    }
  }
  
  for (let index = 0; index < filteredBlocks.length; index++) {
    const block = filteredBlocks[index];
    const type = block.type;
    
    log(`  [${index}] Renderizando bloque:`, {
      type: type,
      id: block.id,
      hasChildren: block.has_children || false,
      order: index
    });
    
    // Manejar column_list de forma especial (debe procesarse antes que otros bloques)
    if (type === 'column_list') {
      try {
        const result = await renderColumnList(block, filteredBlocks, index, blockTypes, headingLevelOffset, useCache);
        // Solo agregar al HTML si hay contenido
        if (result.html.trim()) {
          html += result.html;
          log(`    ✅ Column_list renderizado`);
        } else {
          log(`    ⏭️ Column_list filtrado, sin contenido que mostrar`);
        }
        
        // Saltar las columnas hermanas que ya procesamos (solo si fueron encontradas como hermanas)
        if (result.siblingColumnsCount > 0) {
          // Verificar que las columnas hermanas estén realmente en filteredBlocks
          let skipCount = 0;
          for (let j = index + 1; j < filteredBlocks.length && skipCount < result.siblingColumnsCount; j++) {
            if (filteredBlocks[j].type === 'column') {
              skipCount++;
            } else {
              break;
            }
          }
          if (skipCount > 0) {
            index += skipCount; // El for loop incrementará index después, así que esto está bien
            log(`    ⏭️ Saltadas ${skipCount} columnas hermanas`);
          }
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
      log(`    ⏭️ Columna individual ignorada (ya procesada en column_list)`);
      continue;
    }
    
    // Manejar toggles de forma especial (tienen hijos que se cargan dinámicamente)
    if (type === 'toggle') {
      try {
        const toggleHtml = await renderToggle(block, blockTypes, headingLevelOffset, useCache);
        html += toggleHtml;
        log(`    ✅ Toggle renderizado`);
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
    if (type === 'toggle_heading_1' || type === 'toggle_heading_2' || type === 'toggle_heading_3' || type === 'toggle_heading_4') {
      try {
        const headingLevel = type === 'toggle_heading_1' ? 1 : type === 'toggle_heading_2' ? 2 : type === 'toggle_heading_3' ? 3 : 4;
        const toggleHeadingHtml = await renderToggleHeading(block, headingLevel, blockTypes, headingLevelOffset, useCache);
        html += toggleHeadingHtml;
        log(`    ✅ Toggle heading ${headingLevel} renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar toggle_heading:`, error);
        // Fallback: renderizar sin contenido
        const headingLevel = type === 'toggle_heading_1' ? 1 : type === 'toggle_heading_2' ? 2 : type === 'toggle_heading_3' ? 3 : 4;
        const adjustedLevel = Math.min(headingLevel + headingLevelOffset, 6);
        const headingTag = `h${adjustedLevel}`;
        const headingText = renderRichText(block[`heading_${headingLevel}`]?.rich_text || block.toggle?.rich_text);
        html += `<details class="notion-toggle"><summary class="notion-toggle-summary"><${headingTag} class="notion-toggle-heading-inline-error">${headingText}</${headingTag}></summary><div class="notion-toggle-content">[Error loading content]</div></details>`;
        continue;
      }
    }
    
    // Manejar bases de datos de forma especial
    if (type === 'child_database') {
      try {
        const databaseId = block.id;
        const databaseTitle = block.child_database?.title || 'Database';
        
        // Intentar obtener información de la base de datos para verificar si es accesible
        // Si se puede obtener, significa que la base de datos se procesó correctamente
        // durante la importación, así que no mostramos nada
        try {
          // Obtener token del usuario
          const userToken = getUserToken();
          if (!userToken) {
            throw new Error('No hay token disponible');
          }
          
          // Intentar obtener páginas de la base de datos
          const params = new URLSearchParams({
            action: 'database',
            databaseId: databaseId
          });
          
          const response = await fetch(`/.netlify/functions/notion-api?${params.toString()}`, {
            headers: {
              'X-Notion-Token': userToken
            }
          });
          
          if (response.ok) {
            // Si se puede obtener información, la base de datos se procesó correctamente
            // No mostramos nada porque las páginas ya están en el vault
            log('✅ Base de datos procesada correctamente:', databaseTitle);
            continue; // No agregar nada al HTML
          } else {
            // Si hay un error, mostrar mensaje de error
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error || 'Error desconocido';
            throw new Error(errorMsg);
          }
        } catch (dbError) {
          // Si hay un error al obtener la base de datos, mostrar mensaje de error
          logWarn('Error al obtener información de base de datos:', dbError);
          html += `
            <div class="empty-state notion-database-placeholder">
              <div class="empty-state-icon">⚠️</div>
              <p class="empty-state-text">Error loading database</p>
              <p class="empty-state-hint">${dbError.message || 'The database may not be accessible or shared with your Notion integration'}</p>
            </div>
          `;
        }
        continue;
      } catch (error) {
        log('❌ Error al renderizar base de datos:', error);
        html += `
          <div class="empty-state notion-database-placeholder">
            <div class="empty-state-icon">⚠️</div>
            <p class="empty-state-text">Error loading database</p>
            <p class="empty-state-hint">${error.message || 'An error occurred'}</p>
          </div>
        `;
        continue;
      }
    }
    
    // Manejar headings normales que tienen hijos (contenido anidado)
    if ((type === 'heading_1' || type === 'heading_2' || type === 'heading_3' || type === 'heading_4') && block.has_children) {
      try {
        const baseHeadingLevel = type === 'heading_1' ? 1 : type === 'heading_2' ? 2 : type === 'heading_3' ? 3 : 4;
        const headingLevel = Math.min(baseHeadingLevel + headingLevelOffset, 6); // Máximo h6
        const headingTag = `h${headingLevel}`;
        const headingText = renderRichText(block[`heading_${baseHeadingLevel}`]?.rich_text);
        
        log(`  📦 Obteniendo hijos del heading_${baseHeadingLevel} (renderizado como ${headingTag})...`);
        const children = await fetchBlockChildren(block.id, useCache);
        log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          // Los hijos de un heading deben tener un offset de nivel +1
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset + 1, useCache);
          log(`  ✅ Contenido del heading renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el heading debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const headingInFilter = typesArray.includes(type);
          
          if (!headingInFilter) {
            // El heading no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              log(`    ✅ Heading ${baseHeadingLevel} filtrado, solo mostrando hijos`);
            } else {
              log(`    ⏭️ Heading ${baseHeadingLevel} filtrado, sin contenido que mostrar`);
            }
            continue;
          } else {
            // El heading SÍ está en el filtro, pero si no tiene contenido filtrado, no mostrarlo
            if (!childrenContent.trim()) {
              log(`    ⏭️ Heading ${baseHeadingLevel} en filtro pero sin contenido filtrado en hijos`);
              continue;
            }
          }
        }
        
        html += `<${headingTag}>${headingText}</${headingTag}>${childrenContent}`;
        log(`    ✅ Heading ${baseHeadingLevel} (${headingTag}) con hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar heading con hijos:`, error);
        // Fallback: renderizar solo el heading sin hijos
        const headingLevel = type === 'heading_1' ? 1 : type === 'heading_2' ? 2 : type === 'heading_3' ? 3 : 4;
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
        
        log(`  📦 Obteniendo hijos del callout...`);
        const children = await fetchBlockChildren(block.id, useCache);
        log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
          log(`  ✅ Contenido del callout renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el callout debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const calloutInFilter = typesArray.includes('callout');
          
          if (!calloutInFilter) {
            // El callout no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              log(`    ✅ Callout filtrado, solo mostrando hijos`);
            } else {
              log(`    ⏭️ Callout filtrado, sin contenido que mostrar`);
            }
            continue;
          } else {
            // El callout SÍ está en el filtro, pero si no tiene contenido filtrado en hijos, no mostrarlo
            if (!childrenContent.trim()) {
              log(`    ⏭️ Callout en filtro pero sin contenido filtrado en hijos`);
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
        log(`    ✅ Callout con hijos renderizado`);
        continue;
      } catch (error) {
        console.error(`Error al renderizar callout con hijos:`, error);
        // Fallback: renderizar solo el callout sin hijos, pero solo si está en el filtro
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          if (!typesArray.includes('callout')) {
            log(`    ⏭️ Callout filtrado (error en renderizado), no se muestra`);
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
          log(`    ⏭️ Callout sin hijos filtrado, no se muestra`);
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
        log(`    ✅ Callout sin hijos renderizado`);
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
        
        log(`  📦 Obteniendo hijos del quote...`);
        const children = await fetchBlockChildren(block.id, useCache);
        log(`  📦 Hijos obtenidos: ${children.length}`);
        
        let childrenContent = '';
        if (children.length > 0) {
          childrenContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
          log(`  ✅ Contenido del quote renderizado: ${childrenContent.length} caracteres`);
        }
        
        // Si hay un filtro activo, verificar si el quote debe mostrarse
        if (blockTypes) {
          const typesArray = Array.isArray(blockTypes) ? blockTypes : [blockTypes];
          const quoteInFilter = typesArray.includes('quote');
          
          if (!quoteInFilter) {
            // El quote no está en el filtro, solo mostrar hijos si tienen contenido filtrado
            if (childrenContent.trim()) {
              html += childrenContent;
              log(`    ✅ Quote filtrado, solo mostrando hijos`);
            } else {
              log(`    ⏭️ Quote filtrado, sin contenido válido en hijos`);
            }
            continue;
          } else {
            // El quote SÍ está en el filtro, pero si no tiene contenido, no mostrarlo
            if (!quoteText.trim() && !childrenContent.trim()) {
              log(`    ⏭️ Quote vacío filtrado, no se muestra`);
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
        log(`    ✅ Quote con hijos renderizado`);
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
          log(`    ⏭️ Bloque de lista [${index}] de tipo ${type} filtrado, no se muestra`);
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
          log(`  📦 Obteniendo hijos del elemento de lista [${index}]...`);
          const children = await fetchBlockChildren(block.id, useCache);
          log(`  📦 Hijos obtenidos: ${children.length}`);
          
          let nestedListContent = '';
          if (children.length > 0) {
            // Renderizar los hijos recursivamente (pueden ser más elementos de lista u otros bloques)
            nestedListContent = await renderBlocks(children, blockTypes, headingLevelOffset, useCache);
            log(`  ✅ Contenido anidado renderizado: ${nestedListContent.length} caracteres`);
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
            log(`    ⏭️ Tabla filtrada, no se muestra`);
            continue;
          }
        }
        try {
          const tableHtml = await renderTable(block);
          html += tableHtml;
          log(`    ✅ Tabla [${index}] renderizada`);
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
            log(`    ⏭️ Bloque [${index}] de tipo ${type} filtrado (filtro: ${typesArray.join(', ')}), no se muestra`);
            continue;
          }
        }
        try {
          const rendered = renderBlock(block);
          if (rendered) {
            html += rendered;
            log(`    ✅ Bloque [${index}] renderizado (${rendered.length} caracteres)`);
          } else {
            log(`    ⚠️ Bloque [${index}] no devolvió HTML`);
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
  
  log('✅ Renderizado completo. HTML generado:', html.length, 'caracteres');
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
// @param {boolean} showShareButton - Si true, muestra el botón de share (default: true)
//                                    Pasar false cuando la imagen es recibida por broadcast
// @param {boolean} fullSize - Si true, muestra la imagen a tamaño completo (sin limitar altura)
//                             Usar cuando el GM comparte para que todos vean tamaño completo
async function showImageModal(imageUrl, caption, showShareButton = true, fullSize = false) {
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
    // Pasar parámetro para mostrar/ocultar share button
    viewerUrl.searchParams.set('share', showShareButton ? 'true' : 'false');
    // Pasar parámetro fullSize para mostrar imagen a tamaño completo cuando el GM comparte
    if (fullSize) {
      viewerUrl.searchParams.set('fullSize', 'true');
    }
    
    log('🔍 Abriendo modal de imagen:', {
      imageUrl: absoluteImageUrl,
      viewerUrl: viewerUrl.toString(),
      baseUrl: baseUrl,
      currentLocation: window.location.href,
      showShareButton: showShareButton,
      fullSize: fullSize
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
window.refreshImage = async function(button) {
  // Proporcionar feedback visual inmediato
  if (button) {
    const originalHTML = button.innerHTML;
    button.innerHTML = '⏳ Cargando...';
    button.disabled = true;
    button.style.opacity = '0.6';
  }
  
  // Intentar obtener la información de la página actual para recargar el contenido
  const openModalButton = document.getElementById("page-open-modal-button-header");
  const pageTitle = document.getElementById("page-title");
  const notionContainer = document.getElementById("notion-container");
  
  // Obtener URL y nombre de la página actual
  let currentUrl = null;
  let currentName = null;
  let blockTypes = null;
  
  if (openModalButton && openModalButton.dataset.currentUrl) {
    currentUrl = openModalButton.dataset.currentUrl;
    currentName = openModalButton.dataset.currentName || (pageTitle ? pageTitle.textContent : null);
    if (openModalButton.dataset.blockTypes) {
      try {
        blockTypes = JSON.parse(openModalButton.dataset.blockTypes);
      } catch (e) {
        console.warn('Error parsing blockTypes:', e);
      }
    }
  } else if (pageTitle && notionContainer && !notionContainer.classList.contains('hidden')) {
    // Si estamos viendo una página, intentar obtener la URL desde el contexto
    // Buscar en la configuración actual
    try {
      const roomId = await OBR.room.getId();
      const config = getPagesJSON(roomId) || await getDefaultJSON();
      const pageName = pageTitle.textContent;
      
      // Buscar la página en la configuración
      const findPage = (categories) => {
        for (const cat of categories || []) {
          for (const page of cat.pages || []) {
            if (page.name === pageName) {
              return page;
            }
          }
          if (cat.categories) {
            const found = findPage(cat.categories);
            if (found) return found;
          }
        }
        return null;
      };
      
      const page = findPage(config.categories);
      if (page && isNotionUrl(page.url)) {
        currentUrl = page.url;
        currentName = page.name;
        blockTypes = page.blockTypes || null;
      }
    } catch (e) {
      console.warn('Error obteniendo información de la página:', e);
    }
  }
  
  // Si tenemos la URL y es una página de Notion, recargar el contenido
  if (currentUrl && isNotionUrl(currentUrl) && notionContainer) {
    const pageName = currentName || (pageTitle ? pageTitle.textContent : 'Page');
    trackPageReloaded(pageName);
    
    // Limpiar caché de esta página ANTES de recargar
    const pageId = extractNotionPageId(currentUrl);
    if (pageId) {
      const cacheKey = CACHE_PREFIX + pageId;
      localStorage.removeItem(cacheKey);
      log('🗑️ Caché limpiado para recarga:', pageId);
    }
    
    // Recargar el contenido
    await loadNotionContent(currentUrl, notionContainer, true, blockTypes);
  } else {
    // Fallback: intentar usar el botón de refresh si existe
    const refreshButton = document.getElementById("refresh-page-button");
    if (refreshButton) {
      refreshButton.click();
    } else {
      // Si no hay botón de refresh, recargar la página completa
      location.reload();
    }
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
    
    // Error handler para mostrar mensaje de error y refrescar automáticamente
    img.addEventListener('error', function() {
      // Si ya intentamos refrescar, mostrar mensaje de error
      if (this.dataset.refreshAttempted === 'true') {
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
      } else {
        // Primera vez: intentar refrescar automáticamente
        this.dataset.refreshAttempted = 'true';
        log('🔄 Imagen expirada detectada, refrescando automáticamente...');
        setTimeout(() => {
          if (window.refreshImage) {
            window.refreshImage();
          }
        }, 500); // Pequeño delay para evitar loops
      }
    });
    
    // Load handler para logging
    img.addEventListener('load', function() {
      log('✅ Imagen cargada correctamente:', this.src.substring(0, 80));
    });
    
    // Efecto hover para indicar que es clicable (solo si la imagen ya está cargada)
    img.style.transition = 'opacity 0.2s';
    img.addEventListener('mouseenter', () => {
      // Solo aplicar hover si la imagen ya tiene la clase loaded
      if (img.classList.contains('loaded')) {
        img.style.opacity = '0.9';
      }
    });
    img.addEventListener('mouseleave', () => {
      if (img.classList.contains('loaded')) {
        img.style.opacity = '1';
      }
    });
  });
  
  // Manejar botones de compartir imágenes (para todos: GMs, Co-GMs y Players)
  const isGM = await getUserRole();
  const shareButtons = document.querySelectorAll('.notion-image-share-button');
  log('🔍 Botones de compartir encontrados:', shareButtons.length, 'isGM:', isGM);
  shareButtons.forEach(button => {
    // Mostrar botón de share para todos (GMs, Co-GMs y Players pueden compartir)
    button.style.display = 'flex';
    // Hacer el botón más visible por defecto
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
      // Detectar si el sender es GM para mostrar tamaño completo
      const isGM = await getUserRole();
      try {
        await OBR.broadcast.sendMessage('com.dmscreen/showImage', {
          url: absoluteImageUrl,
          caption: caption,
          fullSize: isGM // Si el sender es GM, mostrar a tamaño completo
        });
        log('📤 Imagen compartida con jugadores:', absoluteImageUrl.substring(0, 80), 'fullSize:', isGM);
        trackImageShare(absoluteImageUrl);
        
        // Feedback visual
        const originalContent = button.innerHTML;
        button.innerHTML = '<img src="img/icon-players.svg" alt="Shared" />';
        button.style.opacity = '0.5';
        button.disabled = true;
        setTimeout(() => {
          button.innerHTML = originalContent;
          button.style.opacity = '';
          button.disabled = false;
        }, 1000);
        showShareFeedback('✓ Image shared with all players');
      } catch (error) {
        console.error('Error al compartir imagen:', error);
      }
    });
  });
}

/**
 * Gestiona la visibilidad entre notion-content y notion-iframe
 * Usa la clase CSS 'show-content' para controlar la visibilidad
 * @param {HTMLElement} container - El contenedor notion-container
 * @param {'content' | 'iframe'} mode - Qué elemento mostrar
 */
function setNotionDisplayMode(container, mode) {
  const contentDiv = container.querySelector('#notion-content');
  const iframe = container.querySelector('#notion-iframe');
  
  // Limpiar botones de compartir de Google Docs si existen
  const googleDocsShareButton = container.querySelector('.google-docs-share-button');
  if (googleDocsShareButton) {
    googleDocsShareButton.remove();
  }
  
  // Limpiar estilos inline que podrían interferir con CSS
  if (contentDiv) {
    contentDiv.style.removeProperty('display');
    contentDiv.style.removeProperty('visibility');
  }
  if (iframe) {
    iframe.style.removeProperty('display');
    iframe.style.removeProperty('visibility');
  }
  
  if (mode === 'content') {
    // Mostrar content, ocultar y limpiar iframe
    if (iframe) {
      iframe.src = 'about:blank'; // Limpiar contenido del iframe
    }
    container.classList.add('show-content');
  } else if (mode === 'iframe') {
    // Mostrar iframe, ocultar y limpiar content
    if (contentDiv) {
      // Limpiar completamente el contenido de Notion
      // Primero remover todos los hijos
      while (contentDiv.firstChild) {
        contentDiv.removeChild(contentDiv.firstChild);
      }
      // Luego limpiar el innerHTML por si acaso
      contentDiv.innerHTML = '';
    }
    // IMPORTANTE: Remover show-content ANTES de establecer el src del iframe
    container.classList.remove('show-content');
    // Nota: El src del iframe se establecerá por la función que llama a setNotionDisplayMode
    // No lo establecemos aquí para evitar conflictos
  }
}

// Función para cargar y renderizar contenido de Notion desde la API
async function loadNotionContent(url, container, forceRefresh = false, blockTypes = null) {
  const contentDiv = container.querySelector('#notion-content');
  
  if (!contentDiv) {
    console.error('No se encontró el contenedor de contenido');
    return;
  }
  
  // Usar la función centralizada para gestionar visibilidad
  setNotionDisplayMode(container, 'content');
  
  // Restaurar clases originales y remover centered-content si existe
  contentDiv.className = 'notion-container__content notion-content';
  contentDiv.classList.remove('centered-content');
  
  // Mostrar loading (setNotionDisplayMode ya gestionó la visibilidad)
  contentDiv.innerHTML = `
    <div class="empty-state notion-loading">
      <div class="empty-state-icon">⏳</div>
      <p class="empty-state-text">Loading content</p>
      <p class="empty-state-hint">Fetching data from Notion...</p>
    </div>
  `;
  // No usar estilos inline - la clase show-content ya está añadida por setNotionDisplayMode
  
  try {
    // Extraer ID de la página
    const pageId = extractNotionPageId(url);
    if (!pageId) {
      throw new Error('Could not extract page ID from URL');
    }
    
    const userToken = getUserToken();
    const isGM = await getUserRole();
    
    // Si el jugador no tiene token O es Co-GM (sin token propio), solicitar HTML al GM via broadcast
    // El Co-GM no tiene acceso al token del Master GM, así que usa el mismo flujo que los Players
    const shouldUseBroadcast = !userToken && (!isGM || isCoGMGlobal);
    
    if (shouldUseBroadcast) {
      const role = isCoGMGlobal ? 'Co-GM' : 'Player';
      log(`👤 ${role} sin token, solicitando HTML al GM para:`, pageId);
      const cachedHtml = await requestHtmlFromGM(pageId);
      if (cachedHtml) {
        log('✅ Usando HTML recibido del GM');
        contentDiv.innerHTML = cachedHtml;
        await attachImageClickHandlers();
        return;
      }
      log('⚠️ El GM no tiene el contenido disponible');
      
      // Mensaje diferente para Co-GM vs Player
      const waitingMessage = isCoGMGlobal
        ? `<div class="notion-waiting notion-waiting--gm-offline">
            <div class="notion-waiting-icon">👁️</div>
            <p class="notion-waiting-text">Content not available</p>
            <p class="notion-waiting-hint">The Master GM needs to load this page first</p>
            <p class="notion-waiting-subhint">Ask them to open this page so you can view it.</p>
            <button class="btn btn--sm btn--secondary notion-retry-button">🔄 Retry</button>
          </div>`
        : `<div class="notion-waiting notion-waiting--gm-offline">
            <div class="notion-waiting-icon">👋</div>
            <p class="notion-waiting-text">Your GM is not active right now</p>
            <p class="notion-waiting-hint">Wait for them to join the session or send them a greeting!</p>
            <p class="notion-waiting-subhint">The content you're trying to view requires your GM to be online.</p>
            <button class="btn btn--sm btn--secondary notion-retry-button">🔄 Retry</button>
          </div>`;
      
      contentDiv.innerHTML = waitingMessage;
      
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
    
    log('Obteniendo bloques para página:', pageId, forceRefresh ? '(recarga forzada)' : '(con caché)');
    
    // Usar caché a menos que se fuerce la recarga
    const useCache = !forceRefresh;
    
    // Obtener bloques y página info EN PARALELO para mejor rendimiento
    const isNotionLink = url.includes('notion.so') || url.includes('notion.site');
    const [blocks, pageInfo] = await Promise.all([
      fetchNotionBlocks(pageId, useCache),
      isNotionLink ? fetchNotionPageInfo(pageId, useCache) : Promise.resolve(null)
    ]);
    
    if (!blocks || blocks.length === 0) {
      contentDiv.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📄</div>
          <p class="empty-state-text">No content found</p>
          <p class="empty-state-hint">This page appears to be empty</p>
        </div>
      `;
      return;
    }
    
    // Extraer cover y título de pageInfo
    let pageCover = null;
    let pageTitle = null;
    if (pageInfo) {
      if (pageInfo.cover) {
        pageCover = pageInfo.cover;
      }
      pageTitle = extractPageTitle(pageInfo);
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
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p class="empty-state-text">Error loading content</p>
        <p class="empty-state-hint">${error.message}</p>
        <button onclick="window.open('${url}', '_blank')" class="btn btn--sm btn--primary" style="margin-top: var(--spacing-md);">Open in Notion</button>
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
    log('🎯 Configurando menús contextuales para tokens...');
    
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
        const items = context.items;
        if (!items || items.length === 0) return;
        
        // Obtener los IDs de todos los tokens seleccionados
        const itemIds = items.map(item => item.id);
        
        // Primero abrir el panel de la extensión
        await OBR.action.open();
        
        // Pequeña espera para que el panel se abra
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Mostrar selector de páginas (obtiene la configuración más reciente)
        await showPageSelectorForToken(itemIds, pagesConfig, roomId);
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
          trackPageViewedFromToken(pageName);
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
        
        log('🗑️ Página desvinculada del token:', item.name || item.id);
      }
    });
    
    log('✅ Menús contextuales para tokens configurados');
    
  } catch (error) {
    console.error('❌ Error al configurar menús contextuales:', error);
  }
}

// Función para mostrar selector de páginas para vincular a uno o varios tokens
async function showPageSelectorForToken(itemIds, pagesConfig, roomId) {
  // Asegurar que itemIds sea un array
  const tokenIds = Array.isArray(itemIds) ? itemIds : [itemIds];
  // Obtener la configuración más reciente cada vez que se llama
  // Usar cache primero (más rápido), luego localStorage, luego default
  const currentConfig = getPagesJSON(roomId) || getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
  
  // Verificar que la configuración sea válida
  if (!currentConfig || !currentConfig.categories) {
    alert('No pages configured. Add pages from the main panel.');
    return;
  }
  
  // Recopilar todas las páginas de la configuración respetando el orden del vault
  const allPages = [];
  
  // Función recursiva que respeta el orden combinado (como en renderCategory)
  function collectPagesOrdered(category, path = [], level = 0) {
    if (!category) return;
    
    const currentPath = [...path, category.name];
    
    // Usar el mismo orden que el vault (getCombinedOrder)
    const combinedOrder = getCombinedOrder(category);
    
    combinedOrder.forEach(item => {
      if (item.type === 'category' && category.categories && category.categories[item.index]) {
        // Recursivamente procesar subcategorías
        const subcategory = category.categories[item.index];
        collectPagesOrdered(subcategory, currentPath, level + 1);
      } else if (item.type === 'page' && category.pages && category.pages[item.index]) {
        // Agregar página con su información
        const page = category.pages[item.index];
        if (page.url) {
          const displayPath = currentPath.join(' / ');
          
          allPages.push({
            name: page.name,
            url: page.url,
            path: currentPath,
            displayPath: displayPath,
            level: level,
            icon: page.icon || null
          });
        }
      }
    });
  }
  
  // Procesar todas las categorías raíz usando el orden combinado
  const rootOrder = getCombinedOrder(currentConfig);
  rootOrder.forEach(item => {
    if (item.type === 'category' && currentConfig.categories && currentConfig.categories[item.index]) {
      collectPagesOrdered(currentConfig.categories[item.index], [], 0);
    }
  });
  
  if (allPages.length === 0) {
    alert('No pages configured. Add pages from the main panel.');
    return;
  }
  
  // Crear opciones para el select
  const pageOptions = allPages.map((page, index) => {
    // Formato: path → nombre (sin indentación)
    const label = `${page.displayPath} → ${page.name}`;
    
    return {
      label: label,
      value: index.toString()
    };
  });
  
  // Determinar el título del modal según la cantidad de tokens
  const modalTitle = tokenIds.length === 1 
    ? 'Link page to token' 
    : `Link page to ${tokenIds.length} tokens`;
  
  // Mostrar modal de selección
  showModalForm(
    modalTitle,
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
        // Obtener todos los items seleccionados
        const items = await OBR.scene.items.getItems(tokenIds);
        if (items.length === 0) {
          alert('Error: tokens not found');
          return;
        }
        
        // Actualizar metadatos de todos los tokens
        await OBR.scene.items.updateItems(items, (updateItems) => {
          updateItems.forEach(item => {
            item.metadata[`${METADATA_KEY}/pageUrl`] = selectedPage.url;
            item.metadata[`${METADATA_KEY}/pageName`] = selectedPage.name;
            item.metadata[`${METADATA_KEY}/pageIcon`] = selectedPage.icon;
          });
        });
        
        // Registrar y mostrar mensaje de confirmación
        const tokenCount = items.length;
        log(`✅ Página "${selectedPage.name}" vinculada a ${tokenCount} token(s)`);
        
        // Trackear para cada token
        tokenIds.forEach(itemId => {
          trackPageLinkedToToken(selectedPage.name, itemId);
        });
        
        const successMessage = tokenCount === 1
          ? `✅ Page "${selectedPage.name}" linked to token`
          : `✅ Page "${selectedPage.name}" linked to ${tokenCount} tokens`;
        alert(successMessage);
        
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
log('🔄 Intentando inicializar Owlbear SDK...');

// Inicializar modo debug al cargar
initDebugMode();

try {
  OBR.onReady(async () => {
    try {
      // Configurar el panel para usar 100% de altura responsive
      // Esto ajusta el panel al tamaño del viewport disponible
      if (OBR.panel && typeof OBR.panel.setHeight === 'function') {
        try {
          // Obtener la altura del viewport y configurar el panel
          const viewportHeight = window.innerHeight;
          await OBR.panel.setHeight(viewportHeight);
        } catch (e) {
          console.warn('No se pudo ajustar la altura del panel dinámicamente:', e);
        }
      }
      
      // Inicializar analytics y verificar rol EN PARALELO
      const [, isGM] = await Promise.all([
        initMixpanel(),
        getUserRole()
      ]);
      
      if (isGM) {
        log('✅ Owlbear SDK listo');
        log('🌐 URL actual:', window.location.href);
        log('🔗 Origen:', window.location.origin);
        
        // Configurar el GM para responder a solicitudes de contenido de jugadores
        setupGMContentBroadcast();
        
        // Configurar el GM para responder a solicitudes de lista de páginas visibles
        setupGMVisiblePagesBroadcast();
      }
      
      // Obtener ID de la room actual
      let roomId = null;
      try {
        // Intentar obtener el ID de la room usando la propiedad directa
        roomId = OBR.room.id;
        if (isGM) {
          log('🏠 Room ID obtenido (OBR.room.id):', roomId);
          log('🏠 Tipo de roomId:', typeof roomId);
          log('🏠 Longitud de roomId:', roomId ? roomId.length : 0);
        }
        
        // Si no funciona, intentar con el método async
        if (!roomId) {
          if (isGM) {
            log('🔄 Intentando con OBR.room.getId()...');
          }
          roomId = await OBR.room.getId();
          if (isGM) {
            log('🏠 Room ID obtenido (OBR.room.getId()):', roomId);
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
            log('🏠 Context ID obtenido:', context);
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
              log('🏠 Usando obrref de URL:', obrref);
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
        log('✅ Room ID final que se usará:', roomId);
      }
      
      // Guardar roomId en variable global para uso en otras funciones (ej: showSettings)
      currentRoomId = roomId;
      
      // ============================================
      // DETECCIÓN DE CO-GM (GM promovido)
      // ============================================
      let isCoGM = false;
      let ownershipInfo = null;
      
      if (isGM) {
        ownershipInfo = await checkVaultOwnership();
        isCoGM = ownershipInfo.hasOwner && !ownershipInfo.isMe && !ownershipInfo.isStale;
        
        // Actualizar variable global para que otras funciones puedan verificar
        isCoGMGlobal = isCoGM;
        
        if (isCoGM) {
          log('👁️ [Co-GM] Modo solo lectura - Master GM:', ownershipInfo.ownerInfo?.playerName);
        } else if (!ownershipInfo.hasOwner || ownershipInfo.isStale) {
          // No hay owner o está inactivo → establecer como Master GM
          await setVaultOwner(roomId);
          startOwnerHeartbeat(roomId);
          log('👑 [Master GM] Establecido como owner del vault');
        } else if (ownershipInfo.isMe) {
          // Ya soy el owner, solo reiniciar heartbeat
          startOwnerHeartbeat(roomId);
          log('👑 [Master GM] Reconectado, heartbeat reiniciado');
        }
      }
      
      // Verificar si estamos en modo modal (abierto desde el botón de abrir en modal)
      const urlParams = new URLSearchParams(window.location.search);
      const isModalMode = urlParams.get('modal') === 'true';
      const modalUrl = urlParams.get('url');
      const modalName = urlParams.get('name');
      const modalBlockTypes = urlParams.get('blockTypes');
      const modalSelector = urlParams.get('selector');
      
      if (isModalMode && modalUrl) {
        // Estamos en modo modal, cargar el contenido directamente
        // Los estilos se aplican automáticamente por CSS (html.modal-mode)
        try {
          const decodedUrl = decodeURIComponent(modalUrl);
          const decodedName = modalName ? decodeURIComponent(modalName) : 'Page';
          const decodedSelector = modalSelector ? decodeURIComponent(modalSelector) : null;
          let blockTypes = null;
          if (modalBlockTypes) {
            try {
              blockTypes = JSON.parse(decodeURIComponent(modalBlockTypes));
            } catch (e) {
              console.warn('Error parsing blockTypes:', e);
            }
          }
          
          // El notion-container ya está visible por CSS (html.modal-mode)
          // Limpiar contenido anterior antes de cargar nuevo contenido
          const notionContainer = document.getElementById("notion-container");
          if (notionContainer) {
            // Limpiar notion-content
            const notionContent = notionContainer.querySelector('#notion-content');
            if (notionContent) {
              notionContent.innerHTML = '';
            }
            
            // Limpiar iframe
            const notionIframe = notionContainer.querySelector('#notion-iframe');
            if (notionIframe) {
              notionIframe.src = 'about:blank';
            }
            
            // Estado inicial limpio
            notionContainer.classList.remove('show-content');
          }
          
          // Cargar el contenido de la página
          // loadPageContent se encargará de establecer el modo correcto (content o iframe)
          await loadPageContent(decodedUrl, decodedName, decodedSelector, blockTypes);
          
          // No continuar con la carga normal de la configuración
          return;
        } catch (error) {
          console.error('Error al cargar contenido en modal:', error);
          // Continuar con la carga normal si hay error
        }
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
                (p.url.startsWith('http') || p.url.startsWith('/'))
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
      
      // Obtener configuraciones de localStorage directamente (sin usar cache)
      // El cache puede estar contaminado con configuración filtrada
      const currentRoomConfig = getPagesJSONFromLocalStorage(roomId);
      let defaultConfig = getPagesJSONFromLocalStorage('default');
      
      // Cargar room metadata para players y como fallback para Co-GMs
      let roomMetadataConfig = null;
      if (!isGM || isCoGM) {
        roomMetadataConfig = await loadPagesFromRoomMetadata();
      }
      
      // Si no hay configuración 'default' en localStorage Y no hay configuración para el roomId,
      // cargar desde la URL y guardarla. Solo el GM necesita cargar/guardar la configuración default.
      // Si ya hay configuración para el roomId, NO cargar el default (el usuario ya tiene su vault)
      if (!defaultConfig && !currentRoomConfig && isGM) {
        log('📥 [GM] No hay configuración, cargando "default" desde URL pública...');
        defaultConfig = await getDefaultJSON();
        if (defaultConfig && defaultConfig.categories && defaultConfig.categories.length > 0) {
          await savePagesJSON(defaultConfig, 'default');
          log('💾 [GM] Configuración "default" cargada y guardada desde URL pública');
        }
      }
      
      // Contar contenido de cada una
      const roomMetadataCount = countContent(roomMetadataConfig);
      const currentRoomCount = countContent(currentRoomConfig);
      const defaultCount = countContent(defaultConfig);
      
      // Solo mostrar logs de debug si es GM
      if (isGM) {
        log('🔍 Configuración room metadata - elementos:', roomMetadataCount);
        log('🔍 Configuración localStorage roomId:', roomId, '- elementos:', currentRoomCount);
        log('🔍 Configuración default - elementos:', defaultCount);
      }
      
      // Prioridad diferenciada por rol:
      // - Master GM: localStorage > default (él genera la configuración completa)
      // - Co-GM: metadata[FULL_CONFIG_KEY] (lee vault completo del Master GM, solo lectura)
      // - Player: room metadata > broadcast (recibe configuración filtrada del GM)
      if (isCoGM) {
        // Co-GM lee desde metadata (solo lectura)
        log('👁️ [Co-GM] Cargando vault desde metadata (solo lectura)...');
        try {
          const metadata = await OBR.room.getMetadata();
          const fullConfig = metadata ? metadata[FULL_CONFIG_KEY] : null;
          
          console.log('📥 [Co-GM] Metadata recibida:');
          console.log('  - FULL_CONFIG_KEY exists:', !!fullConfig);
          console.log('  - Categories:', fullConfig?.categories?.length || 0);
          console.log('  - Pages total:', countPages(fullConfig || { categories: [] }));
          
          if (fullConfig && fullConfig.categories && fullConfig.categories.length > 0) {
            pagesConfig = fullConfig;
            const pageCount = countPages(fullConfig);
            log('✅ [Co-GM] Vault cargado desde metadata:', pageCount, 'páginas');
          } else {
            // No hay vault completo, usar lo que haya disponible
            log('⚠️ [Co-GM] No hay vault completo en metadata');
            pagesConfig = roomMetadataConfig || { categories: [] };
          }
        } catch (e) {
          console.error('Error cargando vault para Co-GM:', e);
          pagesConfig = { categories: [] };
        }
      } else if (isGM) {
        // Master GM usa su localStorage (configuración completa)
        // Prioridad: roomId específico > default
        if (currentRoomConfig) {
          // Si hay configuración para este roomId, usarla
          log('✅ [Master GM] Usando configuración del localStorage para roomId:', roomId, 'con', currentRoomCount, 'elementos');
          pagesConfig = currentRoomConfig;
          // Sincronizar con room metadata para que los players la vean
          await savePagesJSON(pagesConfig, roomId);
        } else if (defaultCount > 0) {
          // Solo usar default si NO hay configuración para este roomId
          // NO copiar al roomId - usar directamente hasta que el GM cargue su propio vault
          log('✅ [Master GM] No hay configuración para este roomId, usando "default" con', defaultCount, 'elementos');
          pagesConfig = defaultConfig;
          // Sincronizar con room metadata usando savePagesJSON para asegurar consistencia
          pagesConfigCache = pagesConfig;
          await savePagesJSON(pagesConfig, roomId);
          log('✅ Default sincronizado con room metadata para players');
        }
      } else {
        // Player usa room metadata (configuración filtrada por el GM)
        if (roomMetadataCount > 0) {
          log('✅ [Player] Usando configuración desde room metadata con', roomMetadataCount, 'elementos');
          pagesConfig = roomMetadataConfig;
        } else {
          // Fallback: solicitar al GM vía broadcast
          log('⚠️ [Player] No hay configuración en room metadata, solicitando al GM...');
          const visibleConfig = await requestVisiblePagesFromGM();
          if (visibleConfig) {
            pagesConfig = visibleConfig;
            log('✅ [Player] Configuración recibida del GM vía broadcast');
          } else {
            // Player sin páginas compartidas - mostrar estado vacío
            log('ℹ️ [Player] No hay páginas compartidas por el GM');
            pagesConfig = { categories: [] };
          }
        }
      }
      
      // Si no hay ninguna configuración (solo para Master GM), crear una nueva por defecto
      if (!pagesConfig && isGM && !isCoGM) {
        log('📝 [Master GM] No se encontró ninguna configuración, creando una nueva por defecto');
        pagesConfig = await getDefaultJSON();
        await savePagesJSON(pagesConfig, roomId);
        log('✅ [Master GM] Configuración por defecto creada para room:', roomId);
      } else if (!pagesConfig) {
        // Player o Co-GM sin configuración
        pagesConfig = { categories: [] };
      }
      
      // Configurar listener para sincronización en tiempo real
      setupRoomMetadataListener(roomId);
      
      // Iniciar detección de cambios de rol (promoción/revocación)
      lastKnownRole = isGM ? 'GM' : 'PLAYER';
      startRoleChangeDetection();

      // Solo mostrar logs de debug si es GM
      if (isGM) {
        log('📊 Configuración cargada para room:', roomId);
        log('📊 Número de carpetas:', pagesConfig?.categories?.length || 0);
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
      
      // Añadir botones según el rol
      // Settings y collapse para todos (GM y players)
      buttonContainer.appendChild(settingsButton);
      buttonContainer.appendChild(collapseAllButton);
      
      // Solo añadir botón de agregar para Master GM (no para Co-GM ni Players)
      if (isGM && !isCoGM) {
        buttonContainer.appendChild(addButton);
      }
      
      // Mostrar button-container para todos
      header.appendChild(buttonContainer);
      
      // Mostrar banner para Co-GM
      if (isCoGM) {
        showCoGMBanner(ownershipInfo);
      }

      // Renderizar páginas agrupadas por carpetas
      await renderPagesByCategories(pagesConfig, pageList, roomId);
      
      // Registrar menús contextuales para tokens
      await setupTokenContextMenus(pagesConfig, roomId);
      
      // Listener para recibir imágenes compartidas por el GM
      OBR.broadcast.onMessage('com.dmscreen/showImage', async (event) => {
        const { url, caption, fullSize } = event.data;
        if (url) {
          // Abrir la imagen en modal para este jugador (sin botón de share porque es recibido por broadcast)
          // Si fullSize es true (GM compartió), mostrar a tamaño completo
          await showImageModal(url, caption, false, fullSize);
        }
      });
      
      // Listener para recibir videos compartidos por el GM
      OBR.broadcast.onMessage('com.dmscreen/showVideo', async (event) => {
        const { url, caption, type } = event.data;
        if (url) {
          // Abrir el video en modal para este jugador
          await showVideoModal(url, caption, type || 'youtube');
        }
      });
      
      // Listener para recibir Google Docs compartidos por el GM
      OBR.broadcast.onMessage('com.dmscreen/showGoogleDoc', async (event) => {
        const { url, name } = event.data;
        if (url) {
          // Abrir el Google Doc en modal para este jugador
          await showGoogleDocModal(url, name);
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
            <p class="empty-state-hint">Check the console for more details</p>
            <p class="empty-state-hint">${error.message || 'Unknown error'}</p>
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
        <p class="empty-state-text">Critical error loading extension</p>
        <p class="empty-state-hint">Check the console for more details</p>
        <p class="empty-state-hint">${error.message || 'Unknown error'}</p>
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
      (page.url.startsWith('http') || page.url.startsWith('/')) &&
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
  // Aceptar URLs absolutas (http/https) y URLs relativas (que empiezan con /)
  let categoryPages = hasPages ? category.pages
    .filter(page => 
      page.url && 
      !page.url.includes('...') && 
      (page.url.startsWith('http') || page.url.startsWith('/'))
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
  // Mostrar botón contextual en hover (solo para Master GM, no para Co-GM)
  if (isGM && !isCoGMGlobal) {
    let hoverTimeout = null;
    
    titleContainer.addEventListener('mouseenter', () => {
      // Limpiar cualquier timeout pendiente
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
      
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
      
      // Verificar si el mouse está sobre los botones o el menú contextual
      const isOverButton = e.relatedTarget && (
        e.relatedTarget.closest('.category-context-menu-button') ||
        e.relatedTarget.closest('.category-visibility-button') ||
        e.relatedTarget.closest('#context-menu')
      );
      
      if (!isOverButton) {
        // Usar timeout para asegurar que el efecto se limpie incluso si hay problemas con relatedTarget
        hoverTimeout = setTimeout(() => {
          if (!contextMenuButton.classList.contains('context-menu-active')) {
            contextMenuButton.style.opacity = '0';
          }
          hoverTimeout = null;
        }, 100); // Pequeño delay para permitir transiciones suaves
      }
    });
    
    // Limpiar estado hover cuando el mouse sale completamente del área de la carpeta
    categoryDiv.addEventListener('mouseleave', (e) => {
      // Solo limpiar si el mouse no está sobre ningún elemento hijo
      if (!e.relatedTarget || !categoryDiv.contains(e.relatedTarget)) {
        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        if (!contextMenuButton.classList.contains('context-menu-active')) {
          contextMenuButton.style.opacity = '0';
        }
      }
    });
  }
  
  // Menú contextual para carpetas (solo para Master GM, no para Co-GM)
  console.log('🟢 Verificando permisos para menú contextual:', { isGM, isCoGMGlobal, categoryName: category.name });
  if (isGM && !isCoGMGlobal) {
  console.log('🟢 Registrando listener para menú contextual de:', category.name);
  contextMenuButton.addEventListener('click', async (e) => {
    console.log('🔵 CLICK en menú contextual de carpeta:', category.name);
    e.stopPropagation();
    const rect = contextMenuButton.getBoundingClientRect();
    
    // Obtener información para determinar si se puede mover arriba/abajo (usando orden combinado)
    // Usar getPagesJSONFromLocalStorage para asegurar datos frescos
    const config = getPagesJSONFromLocalStorage(roomId) || getPagesJSON(roomId) || await getDefaultJSON();
    console.log('🔵 Config cargado:', { hasCategories: !!config?.categories, count: config?.categories?.length });
    
    // Inicializar orden si no existe
    initializeOrderRecursive(config);
    
    const parentPath = categoryPath.slice(0, -2);
    const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
    const index = categoryPath[categoryPath.length - 1];
    
    // Debug para niveles anidados
    console.log('📂 Menú carpeta:', { 
      categoryName: category.name, 
      categoryPath, 
      parentPath, 
      index, 
      parentExists: !!parent,
      level 
    });
    
    // Calcular si se puede mover de forma robusta (validar que parent existe)
    let canMoveUp = false;
    let canMoveDown = false;
    if (parent) {
      const combinedOrder = getCombinedOrder(parent);
      const currentPos = combinedOrder.findIndex(o => o.type === 'category' && o.index === index);
      canMoveUp = currentPos > 0;
      canMoveDown = currentPos !== -1 && currentPos < combinedOrder.length - 1;
      console.log('📂 DEBUG Menú carpeta:', { 
        categoryName: category.name,
        categoryPath,
        parentPath,
        index,
        parentCategories: parent.categories?.length || 0,
        parentPages: parent.pages?.length || 0,
        parentOrder: parent.order,
        combinedOrder, 
        currentPos, 
        canMoveUp, 
        canMoveDown 
      });
    } else {
      console.log('⚠️ Parent no encontrado para carpeta:', category.name, { categoryPath, parentPath });
    }
    
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
  // Solo mostrar botones de administración para Master GM (no para Co-GM)
  if (isGM && !isCoGMGlobal) {
    // Botón de visibilidad de carpetas deshabilitado (solo lectura para Co-GM)
    // titleContainer.appendChild(categoryVisibilityButton);
    titleContainer.appendChild(contextMenuButton);
  }
  categoryDiv.appendChild(titleContainer);
  
  // Contenedor de contenido (páginas y subcarpetas)
  const contentContainer = document.createElement('div');
  contentContainer.className = 'category-content';
  // Mostrar el contenido si no está colapsado Y si tiene contenido o si está vacía (para poder agregar)
  // Para jugadores, verificar si hay subcategorías CON contenido visible, no solo si existen
  let hasVisibleSubcategories = hasSubcategories;
  if (!isGM && hasSubcategories) {
    hasVisibleSubcategories = category.categories.some(subCat => hasVisibleContentForPlayers(subCat));
  }
  const hasContent = hasVisibleSubcategories || categoryPages.length > 0;
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
      const isDemoHtml = isDemoHtmlFile(page.url);
      const isDndbeyondUrl = isDndbeyond(page.url);
      
      // Determinar icono de tipo de link usando getLinkType para detectar PDFs y otros tipos
      let linkIconHtml = '';
      if (isNotion || isDemoHtml) {
        // Archivos HTML de demo también muestran el icono de Notion
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
      
      // Mostrar botones al hover (solo para Master GM, no para Co-GM)
      if (isGM && !isCoGMGlobal) {
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
      
      // Menú contextual para páginas (solo para Master GM, no Co-GM)
      if (isGM && !isCoGMGlobal) {
      pageContextMenuButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rect = pageContextMenuButton.getBoundingClientRect();
        // Usar getPagesJSONFromLocalStorage para asegurar datos frescos
        const config = getPagesJSONFromLocalStorage(roomId) || getPagesJSON(roomId) || await getDefaultJSON();
        
        // Inicializar orden si no existe
        initializeOrderRecursive(config);
        
        // Obtener el path de la carpeta padre para agregar páginas en la misma carpeta
        const pageCategoryPath = categoryPath; // categoryPath viene del scope de renderCategory
        
        // Obtener información para determinar si se puede mover arriba/abajo (usando orden combinado)
        const parent = navigateConfigPath(config, pageCategoryPath);
        const pageIndex = parent && parent.pages ? parent.pages.findIndex(p => p.name === page.name && p.url === page.url) : -1;
        
        // Debug para niveles anidados
        log('📄 Menú página:', { 
          pageName: page.name, 
          pageCategoryPath, 
          pageIndex, 
          parentExists: !!parent,
          level 
        });
        
        // Calcular si se puede mover de forma robusta (validar que parent existe)
        let canMoveUp = false;
        let canMoveDown = false;
        if (parent && pageIndex !== -1) {
          const combinedOrder = getCombinedOrder(parent);
          const currentPos = combinedOrder.findIndex(o => o.type === 'page' && o.index === pageIndex);
          canMoveUp = currentPos > 0;
          canMoveDown = currentPos !== -1 && currentPos < combinedOrder.length - 1;
          log('📄 Orden combinado:', { combinedOrder, currentPos, canMoveUp, canMoveDown });
        } else {
          log('⚠️ Parent no encontrado o página no encontrada:', { parent: !!parent, pageIndex });
        }
        
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
        ];
        
        // Agregar opción de recargar si es Notion
        const isNotionPage = isNotionUrl(page.url);
        if (isNotionPage) {
          menuItems.push({
            icon: 'img/icon-reload.svg',
            text: 'Reload content',
            action: async () => {
              // Obtener blockTypes si existen
              const blockTypes = page.blockTypes || null;
              trackPageReloaded(page.name);
              
              // Limpiar caché de esta página ANTES de recargar
              const pageId = extractNotionPageId(page.url);
              if (pageId) {
                const cacheKey = CACHE_PREFIX + pageId;
                localStorage.removeItem(cacheKey);
                log('🗑️ Caché limpiado para recarga:', pageId);
              }
              
              // Recargar el contenido si estamos viendo esta página
              const notionContainer = document.getElementById("notion-container");
              const pageTitle = document.getElementById("page-title");
              if (notionContainer && !notionContainer.classList.contains('hidden') && pageTitle && pageTitle.textContent === page.name) {
                await loadNotionContent(page.url, notionContainer, true, blockTypes);
              } else {
                // Si no estamos viendo la página, solo recargar la lista
                const pageList = document.getElementById("page-list");
                if (pageList) {
                  await renderPagesByCategories(config, pageList, roomId);
                }
              }
            }
          });
        }
        
        menuItems.push({ separator: true });
        
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
      // Mostrar botón de visibilidad (share) solo para Master GM
      // Co-GM no puede cambiar visibilidad (solo lectura)
      // Mostrar menú contextual solo para Master GM
      if (isGM && !isCoGMGlobal) {
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
            <div style="display: flex; align-items: center; gap: var(--spacing-md); width: 100%;">
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
      
      // Nielsen: User control - Guardar posición del título antes de animar
      const titleRect = titleContainer.getBoundingClientRect();
      const titleTopBeforeAnimation = titleRect.top;
      
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
          
          // Nielsen: Visibility - Asegurar que el título de la carpeta abierta sea visible
          // Si el contenido es muy largo, hacer scroll para que el título quede visible en la parte superior
          const newTitleRect = titleContainer.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          
          // Si el título quedó fuera de la vista superior, hacer scroll suave
          if (newTitleRect.top < 0) {
            titleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          // Si el contenido de la carpeta no cabe y el título está muy arriba, ajustar
          else if (newTitleRect.top < 60 && contentContainer.scrollHeight > viewportHeight * 0.5) {
            titleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 320);
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
          
          // Nielsen: User control - Mantener el contexto del usuario
          // Al cerrar, asegurar que el título de la carpeta siga visible
          const newTitleRect = titleContainer.getBoundingClientRect();
          
          // Si el título quedó fuera de la vista, hacer scroll para que sea visible
          if (newTitleRect.top < 0 || newTitleRect.bottom > window.innerHeight) {
            titleContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 320);
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

// Función para inicializar el orden en toda la configuración si no existe
// Esto asegura que siempre haya un order válido para mover elementos
function initializeOrderRecursive(node, nodeName = 'root') {
  if (!node) return;
  
  // Si no hay order, inicializarlo con el orden por defecto
  if (!node.order || !Array.isArray(node.order)) {
    const order = [];
    const categories = node.categories || [];
    const pages = node.pages || [];
    
    categories.forEach((cat, index) => {
      order.push({ type: 'category', index });
    });
    
    pages.forEach((page, index) => {
      order.push({ type: 'page', index });
    });
    
    if (order.length > 0) {
      node.order = order;
      console.log('✅ initializeOrderRecursive: Orden inicializado para', nodeName, order);
    }
  }
  
  // Recursivamente inicializar subcarpetas
  if (node.categories && Array.isArray(node.categories)) {
    node.categories.forEach((cat, idx) => initializeOrderRecursive(cat, cat.name || `category-${idx}`));
  }
}

// Función auxiliar para obtener el orden combinado de elementos en un nivel
// El orden se guarda en parent.order como array de {type: 'category'|'page', index: number}
function getCombinedOrder(parent) {
  if (!parent) {
    console.log('⚠️ getCombinedOrder: parent es null/undefined');
    return [];
  }
  
  console.log('🔍 getCombinedOrder llamado con:', {
    hasOrder: !!parent.order,
    orderLength: parent.order?.length,
    categoriesCount: parent.categories?.length || 0,
    pagesCount: parent.pages?.length || 0
  });
  
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
  // Obtener config fresca
  const freshConfig = getPagesJSON(roomId) || await getDefaultJSON();
  const config = JSON.parse(JSON.stringify(freshConfig));
  const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
  
  if (!parent) {
    log('⚠️ moveItemUp: parent no encontrado para path:', parentPath);
    return;
  }
  
  const order = getCombinedOrder(parent);
  const currentPos = order.findIndex(o => o.type === itemType && o.index === itemIndex);
  
  if (currentPos <= 0) {
    log('⚠️ moveItemUp: elemento ya en primera posición o no encontrado');
    return;
  }
  
  // Intercambiar con el anterior
  const temp = order[currentPos];
  order[currentPos] = order[currentPos - 1];
  order[currentPos - 1] = temp;
  
  saveCombinedOrder(parent, order);
  
  log(`🔄 Orden actualizado para ${itemType} en posición ${itemIndex}. Sincronizando con jugadores...`);
  await savePagesJSON(config, roomId);
  
  // Track page move
  if (itemType === 'page' && parent.pages && parent.pages[itemIndex]) {
    trackPageMoved(parent.pages[itemIndex].name, 'up');
  }
  
  // Recargar vista
  const pageList = document.getElementById("page-list");
  if (pageList) {
    await renderPagesByCategories(config, pageList, roomId);
  }
}

// Función para mover un elemento abajo en el orden combinado
async function moveItemDown(itemType, itemIndex, parentPath, roomId) {
  // Obtener config fresca
  const freshConfig = getPagesJSON(roomId) || await getDefaultJSON();
  const config = JSON.parse(JSON.stringify(freshConfig));
  const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
  
  if (!parent) {
    log('⚠️ moveItemDown: parent no encontrado para path:', parentPath);
    return;
  }
  
  const order = getCombinedOrder(parent);
  const currentPos = order.findIndex(o => o.type === itemType && o.index === itemIndex);
  
  if (currentPos === -1 || currentPos >= order.length - 1) {
    log('⚠️ moveItemDown: elemento ya en última posición o no encontrado');
    return;
  }
  
  // Intercambiar con el siguiente
  const temp = order[currentPos];
  order[currentPos] = order[currentPos + 1];
  order[currentPos + 1] = temp;
  
  saveCombinedOrder(parent, order);
  
  log(`🔄 Orden actualizado para ${itemType} en posición ${itemIndex}. Sincronizando con jugadores...`);
  await savePagesJSON(config, roomId);
  
  // Track page move
  if (itemType === 'page' && parent.pages && parent.pages[itemIndex]) {
    trackPageMoved(parent.pages[itemIndex].name, 'down');
  }
  
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
  log('📦 moveCategoryUp:', { category: category.name, categoryPath, parentPath, index });
  await moveItemUp('category', index, parentPath, roomId);
}

async function moveCategoryDown(category, categoryPath, roomId) {
  const index = categoryPath[categoryPath.length - 1];
  const parentPath = categoryPath.slice(0, -2);
  log('📦 moveCategoryDown:', { category: category.name, categoryPath, parentPath, index });
  await moveItemDown('category', index, parentPath, roomId);
}

async function movePageUp(page, pageCategoryPath, roomId) {
  // Obtener config fresca para asegurar consistencia
  const config = getPagesJSON(roomId) || await getDefaultJSON();
  const parent = navigateConfigPath(config, pageCategoryPath);
  if (!parent || !parent.pages) {
    log('⚠️ movePageUp: parent o pages no encontrado para path:', pageCategoryPath);
    return;
  }
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1) {
    log('⚠️ movePageUp: página no encontrada:', page.name);
    return;
  }
  
  await moveItemUp('page', pageIndex, pageCategoryPath, roomId);
}

async function movePageDown(page, pageCategoryPath, roomId) {
  // Obtener config fresca para asegurar consistencia
  const config = getPagesJSON(roomId) || await getDefaultJSON();
  const parent = navigateConfigPath(config, pageCategoryPath);
  if (!parent || !parent.pages) {
    log('⚠️ movePageDown: parent o pages no encontrado para path:', pageCategoryPath);
    return;
  }
  
  const pageIndex = parent.pages.findIndex(p => p.name === page.name && p.url === page.url);
  if (pageIndex === -1) {
    log('⚠️ movePageDown: página no encontrada:', page.name);
    return;
  }
  
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
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
  
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
        const newIndex = config.categories.length;
        config.categories.push(newCategory);
        
        // Actualizar el orden combinado para incluir la nueva carpeta al final
        if (!config.order) config.order = [];
        config.order.push({ type: 'category', index: newIndex });
      } else {
        // Agregar dentro de una categoría
        const parent = navigateConfigPath(config, categoryPath);
        if (parent) {
          if (!parent.categories) parent.categories = [];
          const newIndex = parent.categories.length;
          parent.categories.push(newCategory);
          
          // Actualizar el orden combinado del parent
          if (!parent.order) parent.order = [];
          parent.order.push({ type: 'category', index: newIndex });
        }
      }
      
      await savePagesJSON(config, roomId);
      trackFolderAdded(data.name);
      
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
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
  const categoryOptions = getCategoryOptions(currentConfig);
  
  // Obtener el path del padre (si existe)
  const parentPath = categoryPath.slice(0, -2);
  
  // Buscar el valor correcto del parentPath en las opciones disponibles
  let parentPathValue = '';
  if (parentPath.length > 0) {
    const parentPathStr = JSON.stringify(parentPath);
    // Buscar la opción que coincida exactamente con el parentPath
    const matchingOption = categoryOptions.find(opt => opt.value === parentPathStr);
    if (matchingOption) {
      parentPathValue = matchingOption.value;
    } else {
      // Si no se encuentra, usar el parentPath directamente
      parentPathValue = parentPathStr;
    }
  } else {
    // Si no hay parentPath, significa que está en root, usar cadena vacía
    parentPathValue = '';
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
                // Remover del order del parent original
                if (parent.order) {
                  parent.order = parent.order.filter(o => !(o.type === 'category' && o.index === index));
                  // Reajustar índices en el order del parent original
                  parent.order = parent.order.map(o => {
                    if (o.type === 'category' && o.index > index) {
                      return { ...o, index: o.index - 1 };
                    }
                    return o;
                  });
                }
                
                // Remover de la ubicación actual
                parent[key].splice(index, 1);
                
                // Agregar a la nueva ubicación
                if (!newParent.categories) newParent.categories = [];
                const newIndex = newParent.categories.length;
                newParent.categories.push(currentCategory);
                
                // Actualizar order del nuevo parent
                if (!newParent.order) newParent.order = [];
                newParent.order.push({ type: 'category', index: newIndex });
              }
            }
          } catch (e) {
            console.error('Error al mover carpeta:', e);
            console.error('Valor de parentCategory:', data.parentCategory);
            alert('Error changing parent folder. The folder was updated but remains in its current location.');
          }
        } else if (data.parentCategory === '' && parentPath.length > 0) {
          // Remover del order del parent original
          if (parent.order) {
            parent.order = parent.order.filter(o => !(o.type === 'category' && o.index === index));
            parent.order = parent.order.map(o => {
              if (o.type === 'category' && o.index > index) {
                return { ...o, index: o.index - 1 };
              }
              return o;
            });
          }
          
          // Mover a raíz
          parent[key].splice(index, 1);
          if (!config.categories) config.categories = [];
          const newIndex = config.categories.length;
          config.categories.push(currentCategory);
          
          // Actualizar order del config (raíz)
          if (!config.order) config.order = [];
          config.order.push({ type: 'category', index: newIndex });
        }
      }
      
      const oldName = currentCategory.name;
      await savePagesJSON(config, roomId);
      trackFolderEdited(oldName, data.name);
      
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
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
  const categoryOptions = getCategoryOptions(currentConfig);
  
  // Buscar la opción que coincida exactamente con el path actual de la página
  let defaultValue = '';
  if (pageCategoryPath.length > 0) {
    const pageCategoryPathStr = JSON.stringify(pageCategoryPath);
    // Buscar la opción que coincida exactamente
    const matchingOption = categoryOptions.find(opt => opt.value === pageCategoryPathStr);
    if (matchingOption) {
      defaultValue = matchingOption.value;
    } else {
      // Si no se encuentra, usar el valor stringificado directamente
      defaultValue = pageCategoryPathStr;
    }
  } else if (categoryOptions.length > 0) {
    // Si no hay path, usar la primera opción (root)
    defaultValue = categoryOptions[0].value;
  }
  
  const fields = [
    { name: 'name', label: 'Name', type: 'text', required: true, value: page.name, placeholder: 'Page name' },
    { name: 'url', label: 'URL', type: 'url', required: true, value: page.url, placeholder: 'https://...' }
  ];
  
  // Agregar selector de carpeta si hay carpetas disponibles
  if (categoryOptions.length > 0) {
    fields.push({
      name: 'category',
      label: 'Folder',
      type: 'select',
      required: true,
      options: categoryOptions,
      value: defaultValue
    });
  }
  
  // Agregar campo Block types solo si la URL es de Notion
  if (isNotionUrl(page.url)) {
    fields.push(
      { name: 'blockTypes', label: 'Block types (optional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), placeholder: 'quote, callout', help: 'Only for Notion URLs. E.g: "quote" or "quote,callout"' }
    );
  }
  
  fields.push(
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
              // Remover del order del parent original
              if (parent.order) {
                parent.order = parent.order.filter(o => !(o.type === 'page' && o.index === pageIndex));
                parent.order = parent.order.map(o => {
                  if (o.type === 'page' && o.index > pageIndex) {
                    return { ...o, index: o.index - 1 };
                  }
                  return o;
                });
              }
              
              // Remover de la ubicación actual
              parent.pages.splice(pageIndex, 1);
              
              // Agregar a la nueva ubicación
              if (!newParent.pages) newParent.pages = [];
              const newPageIndex = newParent.pages.length;
              newParent.pages.push(currentPage);
              
              // Actualizar order del nuevo parent
              if (!newParent.order) newParent.order = [];
              newParent.order.push({ type: 'page', index: newPageIndex });
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

// Función para editar página desde el header (actualiza título y visibilidad inmediatamente)
async function editPageFromHeader(page, pageCategoryPath, roomId, currentUrl, currentName) {
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
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
  
  // Agregar campo Block types solo si la URL es de Notion
  if (isNotionUrl(page.url)) {
    fields.push(
      { name: 'blockTypes', label: 'Block types (optional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), placeholder: 'quote, callout', help: 'Only for Notion URLs. E.g: "quote" or "quote,callout"' }
    );
  }
  
  fields.push(
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
      const oldName = currentPage.name;
      const oldUrl = currentPage.url;
      const oldVisibility = currentPage.visibleToPlayers === true;
      
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
              // Remover del order del parent original
              if (parent.order) {
                parent.order = parent.order.filter(o => !(o.type === 'page' && o.index === pageIndex));
                parent.order = parent.order.map(o => {
                  if (o.type === 'page' && o.index > pageIndex) {
                    return { ...o, index: o.index - 1 };
                  }
                  return o;
                });
              }
              
              // Remover de la ubicación actual
              parent.pages.splice(pageIndex, 1);
              
              // Agregar a la nueva ubicación
              if (!newParent.pages) newParent.pages = [];
              const newPageIndex = newParent.pages.length;
              newParent.pages.push(currentPage);
              
              // Actualizar order del nuevo parent
              if (!newParent.order) newParent.order = [];
              newParent.order.push({ type: 'page', index: newPageIndex });
            }
          }
        } catch (e) {
          console.error('Error al mover página:', e);
          console.error('Valor de category:', data.category);
          alert('Error changing folder. The page was updated but remains in its current folder.');
        }
      }
      
      await savePagesJSON(config, roomId);
      trackPageEdited(data.name);
      
      // Si cambió la URL o el nombre, recargar el contenido de la página actual
      const notionContainer = document.getElementById("notion-container");
      const pageList = document.getElementById("page-list");
      const urlChanged = oldUrl !== data.url;
      const nameChanged = oldName !== data.name;
      
      // Actualizar el dataset del botón de menú contextual si existe
      const contextMenuBtn = document.getElementById("page-context-menu-button-header");
      if (contextMenuBtn) {
        contextMenuBtn.dataset.currentUrl = data.url;
        contextMenuBtn.dataset.currentName = data.name;
      }
      
      if (urlChanged && notionContainer && !notionContainer.classList.contains('hidden')) {
        // La URL cambió y estamos viendo la página, recargar contenido
        await loadPageContent(data.url, data.name, currentPage.selector || null, Array.isArray(currentPage.blockTypes) ? currentPage.blockTypes : (currentPage.blockTypes || null));
      } else {
        // Solo actualizar el título si cambió
        if (nameChanged) {
          const pageTitle = document.getElementById("page-title");
          if (pageTitle) {
            pageTitle.textContent = data.name;
          }
        }
        
        // Actualizar el botón de visibilidad inmediatamente si cambió
        const newVisibility = data.visibleToPlayers === true;
        if (oldVisibility !== newVisibility) {
          const visibilityButton = document.getElementById("page-visibility-button-header");
          if (visibilityButton) {
            const icon = visibilityButton.querySelector('img');
            if (icon) {
              icon.src = newVisibility ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
            }
            visibilityButton.title = newVisibility ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
          }
        }
      }
      
      // Recargar la vista de page-list
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
        alert('Error: Invalid folder path');
      return false;
    }
    
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    // Función helper para actualizar el orden después de eliminar
    const updateOrderAfterDelete = (parent, deletedType, deletedIndex) => {
      if (parent && parent.order) {
        // Eliminar el item del order
        parent.order = parent.order.filter(o => !(o.type === deletedType && o.index === deletedIndex));
        // Reajustar índices de elementos del mismo tipo que venían después
        parent.order = parent.order.map(o => {
          if (o.type === deletedType && o.index > deletedIndex) {
            return { ...o, index: o.index - 1 };
          }
          return o;
        });
      }
    };
    
    if (path.length === 0) {
      // Si el path está vacío (no debería pasar, pero por si acaso)
      const index = config.categories.findIndex(cat => cat.name === category.name);
      if (index !== -1) {
        config.categories.splice(index, 1);
        updateOrderAfterDelete(config, 'category', index);
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
        updateOrderAfterDelete(config, 'category', index);
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
        updateOrderAfterDelete(parent, 'category', index);
      } else {
        console.error('No se encontró la carpeta en el path:', path);
        alert('Error: Could not find folder to delete');
        return false;
      }
    }
    
    await savePagesJSON(config, roomId);
    trackFolderDeleted(category.name);
    
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
    
    // Actualizar el orden después de eliminar
    if (parent.order) {
      parent.order = parent.order.filter(o => !(o.type === 'page' && o.index === pageIndex));
      parent.order = parent.order.map(o => {
        if (o.type === 'page' && o.index > pageIndex) {
          return { ...o, index: o.index - 1 };
        }
        return o;
      });
    }
    
    await savePagesJSON(config, roomId);
    trackPageDeleted(page.name);
    
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
 * Hace scroll suave a un elemento y lo resalta temporalmente
 * Aplica principios de Nielsen: Visibility of system status
 * @param {HTMLElement} element - Elemento al que hacer scroll
 * @param {Object} options - Opciones de scroll y highlight
 */
function scrollToAndHighlight(element, options = {}) {
  const {
    behavior = 'smooth',
    block = 'center',
    highlightDuration = 1500,
    highlightClass = 'highlight-new-item'
  } = options;
  
  if (!element) return;
  
  // Hacer scroll al elemento
  element.scrollIntoView({ behavior, block });
  
  // Agregar clase de highlight para feedback visual
  element.classList.add(highlightClass);
  
  // Remover highlight después de un tiempo
  setTimeout(() => {
    element.classList.remove(highlightClass);
  }, highlightDuration);
}

/**
 * Duplicar una carpeta completa (incluyendo páginas y subcarpetas)
 */
async function duplicateCategoryFromPageList(category, categoryPath, roomId) {
  try {
    const config = JSON.parse(JSON.stringify(getPagesJSON(roomId) || await getDefaultJSON()));
    
    // Encontrar la carpeta en la configuración
    const parentPath = categoryPath.slice(0, -2);
    const parent = parentPath.length === 0 ? config : navigateConfigPath(config, parentPath);
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
    
    // El nuevo índice será el siguiente al final del array
    const newCategoryIndex = parent.categories.length;
    
    // Insertar la carpeta duplicada al final del array
    parent.categories.push(duplicatedCategory);
    
    // Actualizar el orden combinado para insertar justo después de la original
    const order = getCombinedOrder(parent);
    const originalPosInOrder = order.findIndex(o => o.type === 'category' && o.index === categoryIndex);
    
    // Insertar el nuevo item en el orden justo después del original
    if (originalPosInOrder !== -1) {
      order.splice(originalPosInOrder + 1, 0, { type: 'category', index: newCategoryIndex });
    } else {
      // Si no se encontró en el orden, agregarlo al final
      order.push({ type: 'category', index: newCategoryIndex });
    }
    
    // Guardar el orden actualizado
    parent.order = order;
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
      
      // Nielsen: Visibility of system status - scroll al elemento duplicado y resaltarlo
      // Buscar el elemento duplicado por su nombre
      requestAnimationFrame(() => {
        const duplicatedElement = pageList.querySelector(`[data-category-name="${newName}"]`);
        if (duplicatedElement) {
          scrollToAndHighlight(duplicatedElement, { block: 'center' });
        }
      });
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
    
    // El nuevo índice será el siguiente al final del array
    const newPageIndex = parent.pages.length;
    
    // Insertar la página duplicada al final del array
    parent.pages.push(duplicatedPage);
    
    // Actualizar el orden combinado para insertar justo después de la original
    const order = getCombinedOrder(parent);
    const originalPosInOrder = order.findIndex(o => o.type === 'page' && o.index === pageIndex);
    
    // Insertar el nuevo item en el orden justo después del original
    if (originalPosInOrder !== -1) {
      order.splice(originalPosInOrder + 1, 0, { type: 'page', index: newPageIndex });
    } else {
      // Si no se encontró en el orden, agregarlo al final
      order.push({ type: 'page', index: newPageIndex });
    }
    
    // Guardar el orden actualizado
    parent.order = order;
    
    await savePagesJSON(config, roomId);
    
    // Recargar la vista
    const pageList = document.getElementById("page-list");
    if (pageList) {
      await renderPagesByCategories(config, pageList, roomId);
      
      // Nielsen: Visibility of system status - scroll al elemento duplicado y resaltarlo
      // Buscar el botón de página por su nombre (usando el texto del .page-name)
      requestAnimationFrame(() => {
        const allPageButtons = pageList.querySelectorAll('.page-button');
        for (const btn of allPageButtons) {
          const nameEl = btn.querySelector('.page-name');
          if (nameEl && nameEl.textContent === newName) {
            scrollToAndHighlight(btn, { block: 'center' });
            break;
          }
        }
      });
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
    const newVisibility = currentPage.visibleToPlayers !== true;
    if (currentPage.visibleToPlayers === true) {
      delete currentPage.visibleToPlayers;
    } else {
      currentPage.visibleToPlayers = true;
    }
    
    trackVisibilityToggle(currentPage.name, newVisibility);
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
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
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
  
  // Agregar campo Block types (se mostrará/ocultará dinámicamente según la URL)
  fields.push(
    { name: 'blockTypes', label: 'Block types (optional)', type: 'text', placeholder: 'quote, callout', help: 'Only for Notion URLs. E.g: "quote" or "quote,callout"', conditional: true }
  );
  
  fields.push(
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
          // Actualizar order del config para incluir la nueva categoría
          if (!config.order) config.order = [];
          config.order.push({ type: 'category', index: 0 });
        }
        if (!config.categories[0].pages) config.categories[0].pages = [];
        const newPageIndex = config.categories[0].pages.length;
        config.categories[0].pages.push(newPage);
        
        // Actualizar el orden de la primera categoría
        if (!config.categories[0].order) config.categories[0].order = [];
        config.categories[0].order.push({ type: 'page', index: newPageIndex });
      } else {
        // Agregar dentro de la carpeta seleccionada
        const parent = navigateConfigPath(config, targetCategoryPath);
        if (parent) {
          if (!parent.pages) parent.pages = [];
          const newPageIndex = parent.pages.length;
          parent.pages.push(newPage);
          
          // Actualizar el orden del parent
          if (!parent.order) parent.order = [];
          parent.order.push({ type: 'page', index: newPageIndex });
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
  // Usar getPagesJSONFromLocalStorage para obtener la configuración más reciente
  const currentConfig = getPagesJSONFromLocalStorage(roomId) || await getDefaultJSON();
  
  showModalForm(
    'Add Page',
    [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
      { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
      // { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' }, // Temporalmente oculto
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
          // Actualizar order del config
          if (!config.order) config.order = [];
          config.order.push({ type: 'category', index: 0 });
        }
        if (!config.categories[0].pages) config.categories[0].pages = [];
        const newPageIndex = config.categories[0].pages.length;
        config.categories[0].pages.push(newPage);
        
        // Actualizar order de la categoría
        if (!config.categories[0].order) config.categories[0].order = [];
        config.categories[0].order.push({ type: 'page', index: newPageIndex });
      } else {
        // Agregar dentro de una categoría
        const parent = navigateConfigPath(config, categoryPath);
        if (parent) {
          if (!parent.pages) parent.pages = [];
          const newPageIndex = parent.pages.length;
          parent.pages.push(newPage);
          
          // Actualizar order del parent
          if (!parent.order) parent.order = [];
          parent.order.push({ type: 'page', index: newPageIndex });
        }
      }
      
      await savePagesJSON(config, roomId);
      
      // Determine page type
      let pageType = 'generic';
      if (data.url) {
        if (isNotionUrl(data.url)) pageType = 'notion';
        else if (isDemoHtmlFile(data.url)) pageType = 'demo';
        else {
          const linkType = getLinkType(data.url);
          pageType = linkType.type;
        }
      }
      trackPageAdded(data.name, pageType, {
        url: data.url,
        creationMethod: 'manual',
        isEmbedCode: /^<iframe\b/i.test(String(data.url).trim())
      });
      
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
  // Inicializar orden si no existe (para datos importados o existentes sin order)
  initializeOrderRecursive(pagesConfig);
  
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
      
      if (isGM && !isCoGMGlobal) {
        // Master GM: mostrar opción de agregar carpeta
        emptyState.innerHTML = `
          <div class="empty-state-icon">🫥</div>
          <p class="empty-state-text">No pages configured</p>
          <p class="empty-state-hint">Add your first folder to get started</p>
          <button id="add-first-category" class="btn btn--sm btn--ghost">➕ Add first folder</button>
        `;
        pageList.appendChild(emptyState);
        
        // Botón para agregar primera carpeta
        const addFirstCategoryBtn = emptyState.querySelector('#add-first-category');
        if (addFirstCategoryBtn) {
          addFirstCategoryBtn.addEventListener('click', async () => {
            await addCategoryToPageList([], roomId);
          });
        }
      } else if (isCoGMGlobal) {
        // Co-GM: esperando vault del Master GM
        emptyState.innerHTML = `
          <div class="empty-state-icon">👁️</div>
          <p class="empty-state-text">No vault available</p>
          <p class="empty-state-hint">The Master GM's vault is empty or not yet configured</p>
        `;
        pageList.appendChild(emptyState);
      } else {
        // Player: mostrar mensaje de espera
        emptyState.innerHTML = `
          <div class="empty-state-icon">📄</div>
          <p class="empty-state-text">No shared pages</p>
          <p class="empty-state-hint">The GM hasn't shared any pages with you yet</p>
        `;
        pageList.appendChild(emptyState);
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
          <p class="empty-state-hint">The GM hasn't shared any pages with you yet</p>
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
    
    log('🗑️ Caché limpiado para página:', pageId);
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
    // SERVICIOS EXTERNOS
    // Google Drive y Google Docs/Sheets/Slides activados
    // Ver rama feature/multi-service para más servicios
    // ============================================================
    
    // Google Drive - Activado solo para PDFs
    if (hostname.includes('drive.google.com')) {
      // Detectar si es un PDF en Google Drive
      if (pathname.includes('/file/d/')) {
        return { type: 'pdf', icon: 'icon-pdf.svg' };
      }
    }
    
    // Google Docs/Sheets/Slides
    if (hostname.includes('docs.google.com')) {
      if (pathname.includes('/document/')) {
        return { type: 'google-docs', icon: 'icon-google-docs.svg' };
      }
      if (pathname.includes('/spreadsheets/')) {
        return { type: 'google-sheets', icon: 'icon-google-sheets.svg' };
      }
      if (pathname.includes('/presentation/')) {
        return { type: 'google-slides', icon: 'icon-google-slides.svg' };
      }
    }
    
    // YouTube
    if (hostname.includes('youtube.com') || hostname === 'youtu.be') {
      return { type: 'youtube', icon: 'icon-youtube.svg' };
    }
    
    // Vimeo
    if (hostname.includes('vimeo.com')) {
      return { type: 'vimeo', icon: 'icon-vimeo.svg' };
    }
    
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
    // SERVICIOS EXTERNOS - Google Drive (PDFs) y Google Docs/Sheets/Slides activados
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

    // Google Docs
    if (hostname.includes('docs.google.com') && pathname.includes('/document/d/')) {
      const match = pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const docId = match[1];
        return {
          url: `https://docs.google.com/document/d/${docId}/preview`,
          converted: true,
          service: 'Google Docs'
        };
      }
    }

    // Google Sheets
    if (hostname.includes('docs.google.com') && pathname.includes('/spreadsheets/d/')) {
      const match = pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const sheetId = match[1];
        return {
          url: `https://docs.google.com/spreadsheets/d/${sheetId}/preview`,
          converted: true,
          service: 'Google Sheets'
        };
      }
    }

    // Google Slides
    if (hostname.includes('docs.google.com') && pathname.includes('/presentation/d/')) {
      const match = pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const slideId = match[1];
        return {
          url: `https://docs.google.com/presentation/d/${slideId}/embed`,
          converted: true,
          service: 'Google Slides'
        };
      }
    }

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
  
  // Usar la función centralizada para gestionar visibilidad
  setNotionDisplayMode(container, 'content');
  
  // Mostrar contenido
  if (contentDiv) {
    
    // Convertir URL si es de Google Drive
    let imageUrl = url;
    if (url.includes('drive.google.com') && url.includes('/file/d/')) {
      const match = url.match(/\/file\/d\/([^/]+)/);
      if (match) {
        // Usar formato de thumbnail grande para mejor calidad
        imageUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w2000`;
      }
    }
    
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
    
    const caption = name || '';
    const escapedCaption = caption.replace(/"/g, '&quot;');
    
    // Agregar clase centered-content sin perder las clases originales
    contentDiv.classList.add('centered-content');
    contentDiv.innerHTML = `
      <div class="image-viewer-container" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: var(--spacing-lg);
        margin-top: var(--spacing-xl);
        gap: var(--spacing-lg);
        position: relative;
      ">
        <div style="position: relative; display: inline-block;">
          <img 
            src="${absoluteImageUrl}" 
            alt="${caption || 'Imagen'}"
            class="notion-image-clickable"
            data-image-url="${absoluteImageUrl}"
            data-image-caption="${escapedCaption}"
            style="
            max-width: 100%;
            max-height: calc(100vh - 150px);
            object-fit: contain;
            border-radius: var(--radius-lg);
            cursor: pointer;
            transition: transform var(--transition-normal);
            "
          />
          <button class="notion-image-share-button share-button" 
                  data-image-url="${absoluteImageUrl}" 
                  data-image-caption="${escapedCaption}"
                  title="Show to players">
            <img src="img/icon-players.svg" alt="Share" />
          </button>
        </div>
        <p style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">Click on the image to view it full size</p>
      </div>
    `;
    
    // Añadir handler para abrir en modal al hacer click
    const img = contentDiv.querySelector('img');
    if (img) {
      img.addEventListener('click', () => {
        showImageModal(absoluteImageUrl, caption);
      });
    }
    
    // Añadir event listeners para el botón de compartir
    await attachImageClickHandlers();
  }
}

// Función para extraer ID de video de YouTube o Vimeo
function extractVideoId(url, videoType) {
  try {
    const urlObj = new URL(url);
    
    if (videoType === 'youtube') {
      // YouTube: youtube.com/watch?v=ID o youtu.be/ID
      if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.substring(1);
      } else if (urlObj.hostname.includes('youtube.com')) {
        return urlObj.searchParams.get('v') || urlObj.pathname.split('/').pop();
      }
    } else if (videoType === 'vimeo') {
      // Vimeo: vimeo.com/ID
      const match = urlObj.pathname.match(/\/(\d+)/);
      return match ? match[1] : null;
    }
  } catch (e) {
    console.error('Error extrayendo video ID:', e);
  }
  return null;
}

// Función para obtener thumbnail de video
function getVideoThumbnail(url, videoType) {
  const videoId = extractVideoId(url, videoType);
  if (!videoId) return null;
  
  if (videoType === 'youtube') {
    // YouTube: usar maxresdefault (mejor calidad), con fallback a hqdefault
    // El navegador intentará cargar maxresdefault y si falla, podemos usar hqdefault
    return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  } else if (videoType === 'vimeo') {
    // Vimeo: usar servicio externo vumbnail.com para obtener thumbnail
    // Alternativa: usar la API de Vimeo (requiere token)
    return `https://vumbnail.com/${videoId}.jpg`;
  }
  return null;
}

// Función para manejar error de carga de thumbnail (fallback)
// Hacerla global para que funcione desde onerror inline
window.handleThumbnailError = function(img, videoType, videoId) {
  if (videoType === 'youtube') {
    // Si maxresdefault falla, usar hqdefault
    img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  // Para Vimeo, si vumbnail falla, no hay fallback fácil sin API
};

// Función para obtener URL embed de video
function getVideoEmbedUrl(url, videoType) {
  const videoId = extractVideoId(url, videoType);
  if (!videoId) return url;
  
  if (videoType === 'youtube') {
    return `https://www.youtube.com/embed/${videoId}`;
  } else if (videoType === 'vimeo') {
    return `https://player.vimeo.com/video/${videoId}`;
  }
  return url;
}

// Función para cargar video como thumbnail (similar a imagen)
async function loadVideoThumbnailContent(url, container, name, videoType) {
  const contentDiv = container.querySelector('#notion-content');
  
  // Usar la función centralizada para gestionar visibilidad
  setNotionDisplayMode(container, 'content');
  
  if (!contentDiv) return;
  
  const videoId = extractVideoId(url, videoType);
  if (!videoId) {
    contentDiv.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <p class="empty-state-text">Could not extract video ID</p>
        <p class="empty-state-hint">The video URL format is not supported</p>
      </div>
    `;
    return;
  }
  
  const thumbnailUrl = getVideoThumbnail(url, videoType);
  const embedUrl = getVideoEmbedUrl(url, videoType);
  const caption = name || '';
  const escapedCaption = caption.replace(/"/g, '&quot;');
  
  // Agregar clase centered-content sin perder las clases originales
  contentDiv.classList.add('centered-content');
  contentDiv.innerHTML = `
    <div class="video-thumbnail-container" style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: var(--spacing-lg);
      gap: var(--spacing-lg);
      position: relative;
    ">
      <div style="position: relative; display: inline-block; cursor: pointer;">
        <img 
          src="${thumbnailUrl}" 
          alt="${caption || 'Video'}"
          class="video-thumbnail-clickable"
          data-video-url="${embedUrl}"
          data-video-caption="${escapedCaption}"
          data-video-type="${videoType}"
          data-video-id="${videoId}"
          onerror="handleThumbnailError(this, '${videoType}', '${videoId}')"
          style="
            max-width: 100%;
            max-height: calc(100vh - 150px);
            object-fit: contain;
            border-radius: var(--radius-lg);
            transition: transform var(--transition-normal);
          "
        />
        <div class="video-play-overlay" style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 80px;
          height: 80px;
          background: rgba(0, 0, 0, 0.8);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          transition: transform var(--transition-normal), background var(--transition-normal);
        ">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white" style="margin-left: 4px;">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
        <button class="video-share-button share-button" 
                data-video-url="${embedUrl}" 
                data-video-caption="${escapedCaption}"
                data-video-type="${videoType}"
                title="Show to players">
          <img src="img/icon-players.svg" alt="Share" />
        </button>
      </div>
      <p style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">Click on the video to play it</p>
    </div>
  `;
  
  // Añadir handler para reproducir video directamente (cambiar a modo iframe)
  const thumbnail = contentDiv.querySelector('.video-thumbnail-clickable');
  if (thumbnail) {
    thumbnail.addEventListener('click', () => {
      // Cambiar a modo iframe y reproducir el video
      loadVideoContent(url, container, videoType);
    });
    
    // Efecto hover en el overlay de play
    const thumbnailContainer = thumbnail.closest('div');
    const overlay = thumbnailContainer.querySelector('.video-play-overlay');
    thumbnailContainer.addEventListener('mouseenter', () => {
      overlay.style.transform = 'translate(-50%, -50%) scale(1.1)';
      overlay.style.background = 'rgba(255, 0, 0, 0.9)';
    });
    thumbnailContainer.addEventListener('mouseleave', () => {
      overlay.style.transform = 'translate(-50%, -50%) scale(1)';
      overlay.style.background = 'rgba(0, 0, 0, 0.8)';
    });
  }
  
  // Añadir handler para compartir video
  const shareButton = contentDiv.querySelector('.video-share-button');
  if (shareButton) {
    shareButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const videoUrl = shareButton.dataset.videoUrl;
      const videoCaption = shareButton.dataset.videoCaption;
      const videoType = shareButton.dataset.videoType;
      await shareVideoToPlayers(videoUrl, videoCaption, videoType, shareButton);
    });
  }
}

// Función común para mostrar feedback de share
function showShareFeedback(message = '✓ Shared with all players') {
  // Remover feedback anterior si existe
  const existingFeedback = document.querySelector('.share-feedback');
  if (existingFeedback) {
    existingFeedback.remove();
  }
  
  // Crear nuevo feedback
  const feedback = document.createElement('div');
  feedback.className = 'share-feedback';
  feedback.textContent = message;
  document.body.appendChild(feedback);
  
  // Mostrar feedback
  setTimeout(() => {
    feedback.classList.add('visible');
  }, 10);
  
  // Ocultar después de 2 segundos
  setTimeout(() => {
    feedback.classList.remove('visible');
    setTimeout(() => {
      feedback.remove();
    }, 300);
  }, 2000);
}

// Función para compartir video con jugadores
async function shareVideoToPlayers(videoUrl, caption, videoType, shareButton) {
  try {
    await OBR.broadcast.sendMessage('com.dmscreen/showVideo', {
      url: videoUrl,
      caption: caption,
      type: videoType
    });
    log('📤 Video compartido con jugadores:', videoUrl.substring(0, 80));
    
    // Feedback visual
    if (shareButton) {
      const originalContent = shareButton.innerHTML;
      shareButton.innerHTML = '<img src="img/icon-players.svg" alt="Shared" />';
      shareButton.style.opacity = '0.5';
      shareButton.disabled = true;
      setTimeout(() => {
        shareButton.innerHTML = originalContent;
        shareButton.style.opacity = '';
        shareButton.disabled = false;
      }, 1000);
    }
    showShareFeedback('✓ Video shared with all players');
  } catch (error) {
    console.error('Error al compartir video:', error);
  }
}

// Función para mostrar video en modal (similar a showImageModal)
async function showVideoModal(videoUrl, caption, videoType) {
  try {
    const baseDir = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    const baseUrl = window.location.origin + baseDir;
    
    const viewerUrl = new URL('html/video-viewer.html', baseUrl);
    viewerUrl.searchParams.set('url', encodeURIComponent(videoUrl));
    viewerUrl.searchParams.set('type', videoType);
    if (caption) {
      viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
    }
    
    // Abrir modal usando Owlbear SDK
    await OBR.modal.open({
      id: 'notion-video-viewer',
      url: viewerUrl.toString(),
      height: 800,
      width: 1200
    });
  } catch (error) {
    console.error('Error al abrir modal de video:', error);
    // Fallback: abrir en nueva ventana
    window.open(videoUrl, '_blank', 'noopener,noreferrer');
  }
}

// Función para mostrar Google Doc en modal
async function showGoogleDocModal(iframeUrl, name) {
  try {
    const baseDir = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    const baseUrl = window.location.origin + baseDir;
    
    const viewerUrl = new URL('html/google-doc-viewer.html', baseUrl);
    viewerUrl.searchParams.set('url', encodeURIComponent(iframeUrl));
    if (name) {
      viewerUrl.searchParams.set('name', encodeURIComponent(name));
    }
    
    // Abrir modal usando Owlbear SDK
    await OBR.modal.open({
      id: 'notion-google-doc-viewer',
      url: viewerUrl.toString(),
      height: 800,
      width: 1200
    });
  } catch (error) {
    console.error('Error al abrir modal de Google Doc:', error);
    // Fallback: abrir en nueva ventana
    window.open(iframeUrl, '_blank', 'noopener,noreferrer');
  }
}

// Función para cargar video en player dedicado (mantener para compatibilidad)
function loadVideoContent(url, container, videoType) {
  const iframe = container.querySelector('#notion-iframe');
  if (!iframe) return;
  
  // Cambiar a modo iframe
  setNotionDisplayMode(container, 'iframe');
  
  // Convertir URL a formato embed y cargar
  const embedUrl = getVideoEmbedUrl(url, videoType);
  
  // Añadir loading overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  loadingOverlay.innerHTML = '<div class="loading-spinner"></div>';
  container.style.position = 'relative';
  container.appendChild(loadingOverlay);
  
  // Configurar iframe para video (100% ancho)
  iframe.src = embedUrl;
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:var(--radius-lg)';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  
  // Remover loading cuando el iframe cargue
  iframe.addEventListener('load', () => {
    if (loadingOverlay && loadingOverlay.parentNode) {
      loadingOverlay.remove();
    }
  });
}

// Función para cargar contenido en iframe (para URLs no-Notion)
// Si se proporciona un selector, carga solo ese elemento
async function loadIframeContent(url, container, selector = null) {
  const iframe = container.querySelector('#notion-iframe');
  
  if (!iframe) {
    console.error('No se encontró el iframe');
    return;
  }
  
  // PRIMERO: Limpiar notion-content y cambiar modo
  // Esto asegura que el contenido de Notion se elimine completamente
  setNotionDisplayMode(container, 'iframe');
  
  // Añadir loading overlay
  const existingLoading = container.querySelector('.loading-overlay');
  if (existingLoading) {
    existingLoading.remove();
  }
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  loadingOverlay.innerHTML = '<div class="loading-spinner"></div>';
  container.style.position = 'relative';
  container.appendChild(loadingOverlay);
  
  // Limpiar iframe si tiene contenido previo
  if (iframe.src && iframe.src !== 'about:blank') {
    iframe.src = 'about:blank';
  }
  
  // Asegurar modo iframe
  container.classList.remove('show-content');
  
  // Si hay un selector, intentar cargar solo ese elemento
  if (selector) {
    try {
      log('📄 Cargando elemento específico:', selector, 'de:', url);
      
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
              padding: var(--spacing-lg);
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
      // No usar estilos inline - CSS se encarga de la visibilidad
      
      // Remover loading cuando el iframe cargue
      iframe.addEventListener('load', () => {
        if (loadingOverlay && loadingOverlay.parentNode) {
          loadingOverlay.remove();
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }, { once: true });
      
    } catch (error) {
      console.warn('⚠️ No se pudo cargar elemento específico (posible CORS):', error.message);
      log('📄 Cargando URL completa como fallback:', url);
      // Fallback: cargar la URL completa con conversión
      const embedResult = convertToEmbedUrl(url);
      if (embedResult.converted) {
        log(`🔄 URL convertida para ${embedResult.service}: ${embedResult.url}`);
      }
      iframe.src = embedResult.url;
      // No usar estilos inline - CSS se encarga de la visibilidad
    }
  } else {
    // Sin selector: cargar la URL completa
    // Convertir URL si es de un servicio soportado
    const embedResult = convertToEmbedUrl(url);
    if (embedResult.converted) {
      log(`🔄 URL convertida para ${embedResult.service}: ${embedResult.url}`);
    } else if (embedResult.service) {
      log(`📄 URL de ${embedResult.service} (sin conversión necesaria)`);
    }
    log('📄 Cargando URL en iframe:', embedResult.url);
    // Verificar que estamos en modo iframe antes de establecer src
    if (container.classList.contains('show-content')) {
      container.classList.remove('show-content');
    }
    iframe.src = embedResult.url;
    // No usar estilos inline - CSS se encarga de la visibilidad
    
    // Remover loading cuando el iframe cargue
    iframe.addEventListener('load', () => {
      if (loadingOverlay && loadingOverlay.parentNode) {
        loadingOverlay.remove();
      }
    }, { once: true });
    
    // Añadir botón de compartir si es Google Docs/Sheets/Slides
    const isGoogleDocs = url.includes('docs.google.com');
    if (isGoogleDocs) {
      // Limpiar botón anterior si existe
      const existingButton = container.querySelector('.google-docs-share-button');
      if (existingButton) {
        existingButton.remove();
      }
      
      // Crear botón de compartir
      const shareButton = document.createElement('button');
      shareButton.className = 'google-docs-share-button';
      shareButton.title = 'Show to players';
      shareButton.dataset.iframeUrl = embedResult.url;
      shareButton.dataset.iframeName = name || 'Google Doc';
      // Los estilos se aplican mediante CSS, no inline
      const shareIcon = document.createElement('img');
      shareIcon.src = 'img/icon-players.svg';
      shareIcon.alt = 'Share';
      shareButton.appendChild(shareIcon);
      
      // Event listener para compartir
      shareButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const iframeUrl = shareButton.dataset.iframeUrl;
        const iframeName = shareButton.dataset.iframeName;
        await shareGoogleDocToPlayers(iframeUrl, iframeName, shareButton);
      });
      
      // Añadir botón al contenedor
      container.style.position = 'relative';
      container.appendChild(shareButton);
    }
  }
}

// Función para compartir Google Docs con jugadores
async function shareGoogleDocToPlayers(iframeUrl, name, shareButton) {
  try {
    await OBR.broadcast.sendMessage('com.dmscreen/showGoogleDoc', {
      url: iframeUrl,
      name: name
    });
    log('📤 Google Doc compartido con jugadores:', iframeUrl.substring(0, 80));
    
    // Feedback visual
    if (shareButton) {
      const originalContent = shareButton.innerHTML;
      shareButton.innerHTML = '<img src="img/icon-players.svg" alt="Shared" />';
      shareButton.style.opacity = '0.5';
      shareButton.disabled = true;
      setTimeout(() => {
        shareButton.innerHTML = originalContent;
        shareButton.style.opacity = '';
        shareButton.disabled = false;
      }, 1000);
    }
    showShareFeedback('✓ Document shared with all players');
  } catch (error) {
    console.error('Error al compartir Google Doc:', error);
  }
}

// Función para detectar si es un archivo HTML de demo local
function isDemoHtmlFile(url) {
  if (!url || typeof url !== 'string') return false;
  // Detectar archivos HTML en content-demo
  return url.includes('/content-demo/') && url.endsWith('.html');
}

// Función para obtener la URL base de la app (para resolver URLs relativas correctamente)
function getAppBaseUrl() {
  // Usar el origen de la ventana actual, o la URL de Netlify como fallback
  const currentOrigin = window.location.origin;
  // Si estamos en localhost, usar el origen actual
  if (currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1')) {
    return currentOrigin;
  }
  // Si estamos en Netlify o cualquier otro dominio de la app
  if (currentOrigin.includes('owlbear-gm-vault.netlify.app')) {
    return currentOrigin;
  }
  // Si estamos en un iframe (como dentro de Owlbear), usar la URL de Netlify
  return 'https://owlbear-gm-vault.netlify.app';
}

// Función para resolver una URL relativa a una URL absoluta de la app
function resolveAppUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Si ya es una URL absoluta, retornarla tal cual
  if (url.match(/^https?:\/\//i)) return url;
  // Si es una URL relativa, resolverla con la base de la app
  const baseUrl = getAppBaseUrl();
  return new URL(url, baseUrl).toString();
}

// Función para cargar contenido HTML de demo directamente en el contenedor de Notion
async function loadDemoHtmlContent(url, container) {
  const contentDiv = container.querySelector('#notion-content');
  
  if (!contentDiv) {
    console.error('No se encontró el contenedor de contenido');
    return;
  }
  
  // Usar la función centralizada para gestionar visibilidad
  setNotionDisplayMode(container, 'content');
  
  // Mostrar loading
  contentDiv.innerHTML = `
    <div class="empty-state notion-loading">
      <div class="empty-state-icon">⏳</div>
      <p class="empty-state-text">Loading content</p>
      <p class="empty-state-hint">Fetching demo content...</p>
    </div>
  `;
  // No usar estilos inline - la clase show-content ya está añadida por setNotionDisplayMode
  
  try {
    // Resolver la URL relativa a absoluta
    const absoluteUrl = resolveAppUrl(url);
    log('📄 Cargando demo HTML desde:', absoluteUrl);
    
    // Obtener el HTML del archivo
    const response = await fetch(absoluteUrl);
    if (!response.ok) {
      throw new Error(`Error loading demo HTML: ${response.status}`);
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extraer solo el contenido del div #notion-content
    const demoContent = doc.querySelector('#notion-content');
    
    if (demoContent) {
      // Copiar el contenido HTML directamente
      contentDiv.innerHTML = demoContent.innerHTML;
      
      // Copiar estilos si existen
      const styles = doc.querySelectorAll('style');
      styles.forEach(style => {
        const styleElement = document.createElement('style');
        styleElement.textContent = style.textContent;
        document.head.appendChild(styleElement);
      });
      
      // Agregar event listeners a las imágenes para abrirlas en modal
      await attachImageClickHandlers();
    } else {
      throw new Error('No se encontró #notion-content en el archivo HTML de demo');
    }
  } catch (error) {
    console.error('Error al cargar contenido HTML de demo:', error);
    contentDiv.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <p class="empty-state-text">Error loading demo content</p>
        <p class="empty-state-hint">${error.message}</p>
      </div>
    `;
  }
}

// Función centralizada para ocultar todos los botones de página del header
function hidePageHeaderButtons() {
  const refreshButton = document.getElementById("refresh-page-button");
  if (refreshButton) {
    refreshButton.classList.add("hidden");
  }
  const openModalButton = document.getElementById("page-open-modal-button-header");
  if (openModalButton) {
    openModalButton.classList.add("hidden");
  }
  const contextMenuButton = document.getElementById("page-context-menu-button-header");
  if (contextMenuButton) {
    contextMenuButton.classList.add("hidden");
  }
  const visibilityButton = document.getElementById("page-visibility-button-header");
  if (visibilityButton) {
    visibilityButton.classList.add("hidden");
  }
}

// Función para cargar contenido de una página
async function loadPageContent(url, name, selector = null, blockTypes = null) {
  // Track page view - determine type
  let pageType = 'unknown';
  if (isDemoHtmlFile(url)) {
    pageType = 'demo';
  } else if (isNotionUrl(url)) {
    pageType = 'notion';
  } else {
    const linkType = getLinkType(url);
    pageType = linkType.type;
  }
  trackPageView(name, pageType);
  
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
    
    // Detectar si es un archivo HTML de demo local
    log('🔍 Verificando URL:', url, '| isDemoHtmlFile:', isDemoHtmlFile(url), '| isNotionUrl:', isNotionUrl(url));
    if (isDemoHtmlFile(url)) {
      // Es un archivo HTML de demo → cargar directamente
      log('📄 Archivo HTML de demo detectado, cargando contenido local');
      
      // Ocultar botón de recargar si existe (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      await loadDemoHtmlContent(url, notionContainer);
    } else if (isNotionUrl(url)) {
      // Es una URL de Notion → usar la API
      log('📝 URL de Notion detectada, usando API');
      if (blockTypes) {
        log('🔍 Filtro de tipos de bloques activado:', blockTypes);
      }
      
      // Ocultar botón de recargar del header (ahora está en el menú contextual)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      await loadNotionContent(url, notionContainer, false, blockTypes);
    } else {
      // No es una URL de Notion → detectar tipo de contenido
      const linkType = getLinkType(url);
      log('🌐 URL detectada:', linkType.type);
      
      // Ocultar botón de recargar si existe (solo para Notion)
      let refreshButton = document.getElementById("refresh-page-button");
      if (refreshButton) {
        refreshButton.classList.add("hidden");
      }
      
      // Manejar según el tipo de contenido
      if (linkType.type === 'image') {
        // Es una imagen → abrir en image viewer
        log('🖼️ Imagen detectada, abriendo en viewer');
        await loadImageContent(url, notionContainer, name);
        // Ocultar botón de abrir en modal para imágenes
        const openModalButton = document.getElementById("page-open-modal-button-header");
        if (openModalButton) {
          openModalButton.classList.add("hidden");
        }
      } else if (linkType.type === 'youtube' || linkType.type === 'vimeo') {
        // Es un video → mostrar thumbnail (similar a imagen)
        log('🎬 Video detectado, mostrando thumbnail');
        await loadVideoThumbnailContent(url, notionContainer, name, linkType.type);
      } else {
        // Cargar en iframe (con selector opcional)
        await loadIframeContent(url, notionContainer, selector);
      }
    }
    
    // Agregar botón para abrir el contenido en un modal de OBR
    // Solo mostrarlo si NO estamos ya en modo modal (evitar recursión)
    const currentUrlParams = new URLSearchParams(window.location.search);
    const isAlreadyInModalMode = currentUrlParams.get('modal') === 'true';
    
    if (!isAlreadyInModalMode) {
      let openModalButton = document.getElementById("page-open-modal-button-header");
      if (!openModalButton) {
        openModalButton = document.createElement("button");
        openModalButton.id = "page-open-modal-button-header";
        openModalButton.className = "icon-button";
        header.appendChild(openModalButton);
      }
      
      // Limpiar contenido anterior y configurar icono
      openModalButton.innerHTML = "";
      const openModalIcon = document.createElement("img");
      openModalIcon.src = 'img/open-modal.svg';
      openModalIcon.className = 'icon-button-icon';
      openModalButton.appendChild(openModalIcon);
      openModalButton.title = 'Open in modal';
      
      // IMPORTANTE: Guardar la URL actual en el botón mismo
      // Esto asegura que siempre tengamos la URL correcta, sin importar el tipo de contenido
      openModalButton.dataset.currentUrl = url;
      openModalButton.dataset.currentName = name || 'Page';
      if (blockTypes) {
        openModalButton.dataset.blockTypes = JSON.stringify(blockTypes);
      } else {
        delete openModalButton.dataset.blockTypes;
      }
      if (selector) {
        openModalButton.dataset.selector = selector;
      } else {
        delete openModalButton.dataset.selector;
      }
      
      // Remover listeners anteriores
      const newOpenModalButton = openModalButton.cloneNode(true);
      // Copiar los datos al nuevo botón
      newOpenModalButton.dataset.currentUrl = openModalButton.dataset.currentUrl;
      newOpenModalButton.dataset.currentName = openModalButton.dataset.currentName;
      if (openModalButton.dataset.blockTypes) {
        newOpenModalButton.dataset.blockTypes = openModalButton.dataset.blockTypes;
      }
      if (openModalButton.dataset.selector) {
        newOpenModalButton.dataset.selector = openModalButton.dataset.selector;
      }
      openModalButton.parentNode.replaceChild(newOpenModalButton, openModalButton);
      openModalButton = newOpenModalButton;
      openModalButton.id = "page-open-modal-button-header";
      openModalButton.className = "icon-button";
      
      // Asegurar que el botón esté visible (remover clase hidden si existe)
      openModalButton.classList.remove("hidden");
      
      // Actualizar icono después de clonar
      const openModalIconAfter = openModalButton.querySelector('img');
      if (openModalIconAfter) {
        openModalIconAfter.src = 'img/open-modal.svg';
      }
      openModalButton.title = 'Open in modal';
      
      // Agregar listener para abrir en modal
      openModalButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        try {
          // Obtener la URL y el nombre desde los datos del botón (siempre actualizados)
          // Esto es más confiable que buscar en refreshButton que solo existe para Notion
          let currentUrl = openModalButton.dataset.currentUrl || url;
          let currentPageName = openModalButton.dataset.currentName || name || 'Page';
          
          // Si no hay datos en el botón, intentar obtener del contexto
          if (!currentUrl) {
            const refreshButton = document.getElementById("refresh-page-button");
            if (refreshButton && refreshButton.dataset.pageUrl) {
              currentUrl = refreshButton.dataset.pageUrl;
            } else {
              // Fallback: obtener del título de la página
              const pageTitle = document.getElementById("page-title");
              currentPageName = pageTitle ? pageTitle.textContent : name || 'Page';
            }
          }
          
          log('🔍 URL actual obtenida para modal:', currentUrl);
          log('🔍 Nombre actual obtenido para modal:', currentPageName);
          
          // Obtener blockTypes y selector desde los datos del botón
          let currentBlockTypes = null;
          if (openModalButton.dataset.blockTypes) {
            try {
              currentBlockTypes = JSON.parse(openModalButton.dataset.blockTypes);
            } catch (e) {
              console.warn('Error parsing blockTypes from button:', e);
            }
          }
          const currentSelector = openModalButton.dataset.selector || selector;
          
          // Crear una URL para el modal que cargue index.html directamente en modo modal
          // Esto evita usar un viewer intermedio y carga el contenido con la misma lógica
          const currentPath = window.location.pathname;
          const baseUrl = window.location.origin + currentPath;
          
          // Abrir directamente index.html con parámetros de modal
          const modalUrl = new URL(baseUrl);
          modalUrl.searchParams.set('modal', 'true');
          modalUrl.searchParams.set('url', encodeURIComponent(currentUrl));
          modalUrl.searchParams.set('name', encodeURIComponent(currentPageName));
          if (currentBlockTypes) {
            modalUrl.searchParams.set('blockTypes', JSON.stringify(currentBlockTypes));
          }
          if (currentSelector) {
            modalUrl.searchParams.set('selector', encodeURIComponent(currentSelector));
          }
          // Agregar timestamp y un ID único para evitar caché del navegador
          const timestamp = Date.now();
          const uniqueId = Math.random().toString(36).substring(2, 15);
          modalUrl.searchParams.set('_t', timestamp.toString());
          modalUrl.searchParams.set('_id', uniqueId);
          
          // Cerrar modal anterior si existe (usar ID fijo para simplicidad)
          const modalId = 'notion-content-modal';
          try {
            await OBR.modal.close(modalId);
          } catch (e) {
            // Modal no existía, continuar
          }
          
          // Debug (solo en desarrollo)
          if (window.DEBUG_MODE) {
            log('🔍 Modal URL:', modalUrl.toString());
          }
          
          // Abrir modal - la URL tiene timestamp para evitar caché
          await OBR.modal.open({
            id: modalId,
            url: modalUrl.toString(),
            height: 800,
            width: 1200
          });
        } catch (error) {
          console.error('Error al abrir modal de OBR:', error);
        }
      });
    }
    
    // Agregar botón de menú contextual para GMs (solo si la página está en la configuración)
    // Esto debe ejecutarse tanto para URLs de Notion como para otras URLs
    let contextMenuButton = document.getElementById("page-context-menu-button-header");
    let isGMForHeader = false;
    try {
      const role = await OBR.player.getRole();
      isGMForHeader = role === 'GM';
    } catch (e) {
      isGMForHeader = false;
    }
    
    if (isGMForHeader) {
      let roomId = null;
      try {
        roomId = OBR.room.id || await OBR.room.getId();
      } catch (e) {}
      
      const config = getPagesJSON(roomId) || await getDefaultJSON();
      const pageInfo = findPageInConfig(config, url, name);
      
      if (pageInfo) {
        if (!contextMenuButton) {
          contextMenuButton = document.createElement("button");
          contextMenuButton.id = "page-context-menu-button-header";
          contextMenuButton.className = "icon-button hidden";
          header.appendChild(contextMenuButton);
        }
        
        contextMenuButton.innerHTML = "";
        const contextMenuIcon = document.createElement("img");
        contextMenuIcon.src = "img/icon-contextualmenu.svg";
        contextMenuIcon.className = "icon-button-icon";
        contextMenuButton.appendChild(contextMenuIcon);
        contextMenuButton.title = "Menu";
        
        // Remover listeners anteriores (mantener clase hidden hasta que se quite explícitamente)
        const newContextMenuButton = contextMenuButton.cloneNode(true);
        contextMenuButton.parentNode.replaceChild(newContextMenuButton, contextMenuButton);
        contextMenuButton = newContextMenuButton;
        contextMenuButton.id = "page-context-menu-button-header";
        contextMenuButton.className = "icon-button hidden";
        
        // Guardar referencia a URL y nombre actuales (se actualizará si se edita)
        contextMenuButton.dataset.currentUrl = url;
        contextMenuButton.dataset.currentName = name;
        
        // Configurar menú contextual - obtiene datos frescos en cada click
        contextMenuButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rect = contextMenuButton.getBoundingClientRect();
          
          // Obtener datos actualizados del título (puede haber cambiado)
          const pageTitleEl = document.getElementById("page-title");
          const currentName = pageTitleEl ? pageTitleEl.textContent : contextMenuButton.dataset.currentName;
          const currentUrl = contextMenuButton.dataset.currentUrl;
          
          // Obtener configuración fresca
          let freshRoomId = null;
          try {
            freshRoomId = OBR.room.id || await OBR.room.getId();
          } catch (e) {}
          
          const freshConfig = getPagesJSON(freshRoomId) || await getDefaultJSON();
          const freshPageInfo = findPageInConfig(freshConfig, currentUrl, currentName);
          
          if (!freshPageInfo) {
            console.warn('Page not found in config for context menu');
            return;
          }
          
          const pageCategoryPath = freshPageInfo.pageCategoryPath;
          
          // Verificar si es una página de Notion para mostrar opción de recargar
          const isNotionPage = isNotionUrl(currentUrl);
          
          // Menú contextual simplificado para header (sin move up/down ni duplicate)
          const menuItems = [
            { 
              icon: 'img/icon-edit.svg', 
              text: 'Edit', 
              action: async () => {
                await editPageFromHeader(freshPageInfo.page, pageCategoryPath, freshRoomId, currentUrl, currentName);
              }
            },
          ];
          
          // Agregar opción de recargar si es Notion
          if (isNotionPage) {
            menuItems.push({ separator: true });
            menuItems.push({
              icon: 'img/icon-reload.svg',
              text: 'Reload content',
              action: async () => {
                // Obtener blockTypes si existen
                const blockTypes = freshPageInfo.page.blockTypes || null;
                const pageName = currentName;
                trackPageReloaded(pageName);
                
                // Limpiar caché de esta página ANTES de recargar
                const pageId = extractNotionPageId(currentUrl);
                if (pageId) {
                  const cacheKey = CACHE_PREFIX + pageId;
                  localStorage.removeItem(cacheKey);
                  log('🗑️ Caché limpiado para recarga:', pageId);
                }
                
                // Recargar el contenido
                const notionContainer = document.getElementById("notion-container");
                if (notionContainer) {
                  await loadNotionContent(currentUrl, notionContainer, true, blockTypes);
                }
              }
            });
          }
          
          menuItems.push({ separator: true });
          menuItems.push({
            icon: 'img/icon-trash.svg',
            text: 'Delete',
            action: async () => {
              if (confirm(`Delete page "${pageInfo.page.name}"?`)) {
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
                // Ocultar todos los botones de página
                hidePageHeaderButtons();
                // Mostrar el button-container cuando se vuelve a la vista principal
                const buttonContainer = document.querySelector('.button-container');
                if (buttonContainer) {
                  buttonContainer.classList.remove("hidden");
                }
                // Ocultar el botón de volver
                const backButton = document.getElementById("back-button");
                if (backButton) {
                  backButton.classList.add("hidden");
                }
                // Restaurar el título
                const pageTitle = document.getElementById("page-title");
                if (pageTitle) {
                  pageTitle.textContent = "GM vault";
                }
              }
            }
          });
          
          createContextMenu(menuItems, { x: rect.right + 8, y: rect.bottom + 4 }, () => {
            contextMenuButton.classList.remove('context-menu-active');
          });
          
          contextMenuButton.classList.add('context-menu-active');
        });
        
        contextMenuButton.classList.remove("hidden");
      } else {
        if (contextMenuButton) {
          contextMenuButton.classList.add("hidden");
        }
      }
    } else {
      if (contextMenuButton) {
        contextMenuButton.classList.add("hidden");
      }
    }
    
    // Agregar botón de visibilidad para GMs (después del refresh, antes del menú contextual)
    // Esto debe ejecutarse tanto para URLs de Notion como para otras URLs
    let visibilityButton = document.getElementById("page-visibility-button-header");
    let isGMForVisibility = false;
    try {
      const role = await OBR.player.getRole();
      isGMForVisibility = role === 'GM';
    } catch (e) {
      isGMForVisibility = false;
    }
    
    if (isGMForVisibility) {
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
          visibilityButton.className = "icon-button hidden";
          header.appendChild(visibilityButton);
        }
        
        const isPageVisible = pageInfo.page.visibleToPlayers === true;
        visibilityButton.innerHTML = "";
        const visibilityIcon = document.createElement("img");
        visibilityIcon.src = isPageVisible ? 'img/icon-eye-open.svg' : 'img/icon-eye-close.svg';
        visibilityIcon.className = 'icon-button-icon';
        visibilityButton.appendChild(visibilityIcon);
        visibilityButton.title = isPageVisible ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
        
        // Remover listeners anteriores (mantener clase hidden hasta que se quite explícitamente)
        const newVisibilityButton = visibilityButton.cloneNode(true);
        visibilityButton.parentNode.replaceChild(newVisibilityButton, visibilityButton);
        visibilityButton = newVisibilityButton;
        visibilityButton.id = "page-visibility-button-header";
        visibilityButton.className = "icon-button hidden";
        
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
          notionContent.style.removeProperty('display');
          notionContent.style.removeProperty('visibility');
        }
        // Limpiar iframe
        const iframe = notionContainer.querySelector('#notion-iframe');
        if (iframe) {
          iframe.src = 'about:blank';
          iframe.style.removeProperty('display');
          iframe.style.removeProperty('visibility');
        }
        // Ocultar todos los botones de página
        hidePageHeaderButtons();
        }
        
        // Restaurar vista principal
        pageList.classList.remove("hidden");
        backButton.classList.add("hidden");
        pageTitle.textContent = "GM vault";
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

// ============================================
// TOAST PARA CO-GM
// ============================================

// Variable para el timeout del toast
let coGMToastTimeout = null;

/**
 * Muestra un toast de Co-GM (estilo flotante)
 * @param {object} ownershipInfo - Información del ownership
 */
function showCoGMBanner(ownershipInfo) {
  // Eliminar toast existente si hay
  const existingToast = document.getElementById('cogm-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Cancelar timeout anterior
  if (coGMToastTimeout) {
    clearTimeout(coGMToastTimeout);
  }
  
  const toast = document.createElement('div');
  toast.id = 'cogm-toast';
  toast.className = 'cogm-toast';
  
  const ownerName = ownershipInfo?.ownerInfo?.playerName || 'Master GM';
  
  toast.innerHTML = `
    <div class="cogm-toast-content">
      <span class="cogm-toast-icon">👁️</span>
      <div class="cogm-toast-text">
        <strong>Viewing ${ownerName}'s vault</strong>
        <span class="cogm-toast-hint">Read-only mode</span>
      </div>
      <button class="cogm-toast-close" onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Animación de entrada
  requestAnimationFrame(() => {
    toast.classList.add('cogm-toast--visible');
  });
  
  // Auto-ocultar después de 10 segundos
  coGMToastTimeout = setTimeout(() => {
    hideCoGMToast();
  }, 10000);
}

/**
 * Oculta el toast del Co-GM
 */
function hideCoGMToast() {
  const toast = document.getElementById('cogm-toast');
  if (toast) {
    toast.classList.remove('cogm-toast--visible');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }
}

/**
 * Muestra el toast de Master GM desconectado
 * @param {object} ownershipInfo - Información del ownership
 */
function showMasterGMDisconnectedBanner(ownershipInfo) {
  // Eliminar toast existente si hay
  const existingToast = document.getElementById('cogm-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.id = 'cogm-toast';
  toast.className = 'cogm-toast cogm-toast--warning';
  
  const ownerName = ownershipInfo?.ownerInfo?.playerName || 'Master GM';
  const minutesInactive = ownershipInfo?.minutesInactive || 0;
  
  toast.innerHTML = `
    <div class="cogm-toast-content">
      <span class="cogm-toast-icon">⚠️</span>
      <div class="cogm-toast-text">
        <strong>${ownerName} disconnected</strong>
        <span class="cogm-toast-hint">Inactive ${minutesInactive}m • Export vault if needed</span>
      </div>
      <button class="cogm-toast-close" onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Animación de entrada (no auto-ocultar este)
  requestAnimationFrame(() => {
    toast.classList.add('cogm-toast--visible');
  });
}

// Función para mostrar configuración de token
async function showSettings() {
  // Obtener roomId de forma segura (usar variable global si está disponible)
  let roomId = currentRoomId;
  
  // Si no hay roomId en la variable global, intentar obtenerlo
  if (!roomId) {
    try {
      if (typeof OBR !== 'undefined' && OBR.room) {
        roomId = OBR.room.id || await OBR.room.getId();
        // Actualizar variable global
        if (roomId) {
          currentRoomId = roomId;
        }
      }
    } catch (e) {
      console.warn('No se pudo obtener roomId:', e);
    }
  }
  
  // Fallback a 'default' si sigue siendo null
  if (!roomId) {
    roomId = 'default';
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
        // Ocultar botones de página que podrían haber quedado visibles
        hidePageHeaderButtons();
      } else if (isNotionContainerVisible) {
        // Volver a la vista principal desde notion-container
        notionContainer.classList.add("hidden");
        notionContainer.classList.remove("show-content");
        if (notionContent) {
          notionContent.innerHTML = "";
          notionContent.style.removeProperty('display');
          notionContent.style.removeProperty('visibility');
        }
        // Limpiar iframe
        const iframe = notionContainer.querySelector('#notion-iframe');
        if (iframe) {
          iframe.src = 'about:blank';
          iframe.style.removeProperty('display');
          iframe.style.removeProperty('visibility');
        }
        // Ocultar todos los botones de página
        hidePageHeaderButtons();
      }
      
      // Restaurar vista principal
      if (pageList) pageList.classList.remove("hidden");
      if (backButton) backButton.classList.add("hidden");
      if (pageTitle) pageTitle.textContent = "GM vault";
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
  
  // Ocultar botones de página que podrían haber quedado visibles
  hidePageHeaderButtons();
  
  // Detectar si es GM o player
  const isGM = await getUserRole();
  
  // ============================================
  // CONFIGURAR SETTINGS SEGÚN ROL
  // ============================================
  
  // Obtener info del vault según rol
  let vaultConfig = null;
  let pageCount = 0;
  let categoryCount = 0;
  let configSize = 0;
  let canSync = false;
  let ownershipInfo = null;
  
  if (isGM) {
    ownershipInfo = await checkVaultOwnership();
    
    if (isCoGMGlobal) {
      // Co-GM: obtener config desde metadata
      try {
        const metadata = await OBR.room.getMetadata();
        vaultConfig = metadata ? metadata[FULL_CONFIG_KEY] : null;
      } catch (e) {
        console.warn('Error getting metadata for Co-GM:', e);
      }
    } else {
      // Master GM: obtener config desde localStorage
      vaultConfig = getPagesJSONFromLocalStorage(roomId);
    }
    
    pageCount = countPages(vaultConfig || { categories: [] });
    categoryCount = countCategories(vaultConfig || { categories: [] });
    configSize = getConfigSize(vaultConfig || { categories: [] });
    canSync = configSize < MAX_METADATA_SIZE;
  }
  
  // Ocultar/mostrar secciones según rol
  const allForms = document.querySelectorAll('#settings-container .form');
  const notionTokenForm = allForms[0]; // Primera sección: Notion Token
  const exportVaultForm = allForms[1]; // Segunda sección: Export vault
  const feedbackForm = allForms[2]; // Tercera sección: Feedback
  
  if (!isGM) {
    // Player: solo mostrar feedback
    if (notionTokenForm) notionTokenForm.style.display = 'none';
    if (exportVaultForm) exportVaultForm.style.display = 'none';
    if (feedbackForm) feedbackForm.style.display = '';
    if (settingsContainer) settingsContainer.classList.add('settings--player');
  } else if (isCoGMGlobal) {
    // Co-GM: ocultar Notion Token, mostrar Export vault (con vault status) y Feedback
    if (notionTokenForm) notionTokenForm.style.display = 'none';
    if (exportVaultForm) exportVaultForm.style.display = '';
    if (feedbackForm) feedbackForm.style.display = '';
    if (settingsContainer) settingsContainer.classList.remove('settings--player');
  } else {
    // Master GM: mostrar todas las secciones
    allForms.forEach(form => {
      form.style.display = '';
    });
    if (settingsContainer) settingsContainer.classList.remove('settings--player');
  }
  
  // ============================================
  // VAULT STATUS (integrado en Export vault section)
  // ============================================
  // Eliminar vault status anterior si existe
  const existingVaultStatus = document.getElementById('vault-status-box');
  if (existingVaultStatus) {
    existingVaultStatus.remove();
  }
  
  if (isGM && exportVaultForm) {
    const vaultStatusBox = document.createElement('div');
    vaultStatusBox.id = 'vault-status-box';
    
    if (isCoGMGlobal) {
      // Co-GM: modo solo lectura
      const masterGMName = ownershipInfo?.ownerInfo?.playerName || 'Master GM';
      vaultStatusBox.innerHTML = `
        <div class="vault-status vault-status--cogm">
          <div class="vault-status__icon">👁️</div>
          <div class="vault-status__info">
            <span class="vault-status__title">Read-only mode</span>
            <span class="vault-status__detail">Viewing ${masterGMName}'s vault</span>
            <span class="vault-status__detail">${pageCount} pages in ${categoryCount} folders</span>
          </div>
        </div>
      `;
    } else {
      // Master GM: mostrar info completa con recomendación de backup
      const syncMessage = canSync 
        ? `<span class="vault-status__sync vault-status__sync--ok">✅ Can sync to Co-GM</span>`
        : `<span class="vault-status__sync vault-status__sync--warn">⚠️ Too large to sync (>16KB)</span>`;
      
      vaultStatusBox.innerHTML = `
        <div class="vault-status vault-status--master">
          <div class="vault-status__icon">👑</div>
          <div class="vault-status__info">
            <span class="vault-status__title">Master GM</span>
            <span class="vault-status__detail">${(configSize / 1024).toFixed(1)} KB • ${pageCount} pages • ${categoryCount} folders</span>
            ${syncMessage}
          </div>
        </div>
      `;
    }
    
    // Inyectar vault status como primer hijo de .settings__content
    const settingsContent = document.querySelector('#settings-container .settings__content');
    if (settingsContent) {
      settingsContent.insertBefore(vaultStatusBox, settingsContent.firstChild);
    }
    // Actualizar descripción del export según rol
    const exportDescription = exportVaultForm.querySelector('.settings__description');
    if (exportDescription) {
      if (isCoGMGlobal) {
        exportDescription.textContent = 'You can download a copy of the vault. Share content with players using the eye button on pages.';
      } else {
        exportDescription.textContent = canSync
          ? 'Save and reuse your GM Vault. It\'s recommended to make regular backups. Your vault syncs automatically to Co-GMs.'
          : 'Save and reuse your GM Vault. Your vault is too large (>16KB) to sync with Co-GMs. Make regular backups.';
      }
    }
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
  
  // Ocultar botón "Load vault" para Co-GM (solo lectura)
  if (loadJsonBtn && isCoGMGlobal) {
    loadJsonBtn.style.display = 'none';
  }
  
  // Mostrar botón "Ver JSON" solo si es tu cuenta (DEBUG_MODE activado)
  // Esto se controla desde Netlify Environment Variables (DEBUG_MODE=true)
  const viewJsonContainer = viewJsonBtn ? viewJsonBtn.parentElement : null;
  if (viewJsonBtn && DEBUG_MODE) {
    viewJsonBtn.classList.remove('hidden');
    if (viewJsonContainer) {
      viewJsonContainer.style.display = '';
    }
  } else if (viewJsonContainer) {
    // Ocultar el contenedor completo para que no ocupe espacio
    viewJsonContainer.style.display = 'none';
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
    if (pageTitle) pageTitle.textContent = 'GM vault';
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
        const viewJsonContainer = viewJsonBtn ? viewJsonBtn.parentElement : null;
        if (viewJsonBtn) {
          if (DEBUG_MODE) {
            viewJsonBtn.classList.remove('hidden');
            if (viewJsonContainer) {
              viewJsonContainer.style.display = '';
            }
          } else {
            viewJsonBtn.classList.add('hidden');
            if (viewJsonContainer) {
              viewJsonContainer.style.display = 'none';
            }
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
          const viewJsonContainer = viewJsonBtn ? viewJsonBtn.parentElement : null;
          if (viewJsonBtn) {
            viewJsonBtn.classList.add('hidden');
            if (viewJsonContainer) {
              viewJsonContainer.style.display = 'none';
            }
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
          padding: var(--spacing-xl);
        `;
        
        const jsonContent = document.createElement('div');
        jsonContent.style.cssText = `
          background: #1a1a1a;
          border: 1px solid ${CSS_VARS.borderPrimary};
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          max-width: 90%;
          max-height: 90vh;
          overflow: auto;
          position: relative;
        `;
        
        jsonContent.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 style="color: var(--color-text-primary); font-size: var(--font-size-md); font-weight: var(--font-weight-bold); margin: 0; font-family: var(--font-family-base);">Configuration JSON</h2>
            <button id="close-json-modal" style="
        background: ${CSS_VARS.bgPrimary};
        border: 1px solid ${CSS_VARS.borderPrimary};
        border-radius: 6px;
        padding: var(--spacing-xs) var(--spacing-md);
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--font-size-sm);
              font-family: Roboto, Helvetica, Arial, sans-serif;
            ">Cerrar</button>
      </div>
          <pre id="json-display" style="
            background: ${CSS_VARS.bgPrimary};
            border: 1px solid ${CSS_VARS.borderPrimary};
            border-radius: 6px;
            padding: var(--spacing-lg);
          color: var(--color-text-secondary);
            font-family: var(--font-family-mono);
            font-size: var(--font-size-xs);
            line-height: var(--font-line-base);
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
    
            // Obtener roomId - SIEMPRE intentar obtenerlo de OBR primero
            let currentRoomId = null;
            try {
              if (typeof OBR !== 'undefined' && OBR.room && OBR.room.id) {
                // Primero intentar con la propiedad directa (más confiable)
                currentRoomId = OBR.room.id;
                log('🔍 roomId obtenido de OBR.room.id:', currentRoomId);
              }
              if (!currentRoomId && typeof OBR !== 'undefined' && OBR.room && OBR.room.getId) {
                // Fallback al método async
                currentRoomId = await OBR.room.getId();
                log('🔍 roomId obtenido de OBR.room.getId():', currentRoomId);
              }
            } catch (e) {
              console.warn('No se pudo obtener roomId de OBR:', e);
            }
            
            // Fallback: usar el roomId del scope si lo tenemos
            if (!currentRoomId && roomId) {
              currentRoomId = roomId;
              log('🔍 roomId obtenido del scope:', currentRoomId);
            }
            
            // Limpiar el cache antes de guardar para evitar conflictos
            pagesConfigCache = null;
            
            // Asegurarnos de tener un roomId válido
            log('🔍 currentRoomId antes de guardar:', currentRoomId);
            
            // Solo borrar default si tenemos un roomId válido (no queremos guardar en default)
            if (currentRoomId) {
              const defaultStorageKey = 'notion-pages-json-default';
              log('🔍 Verificando si existe default:', localStorage.getItem(defaultStorageKey) ? 'SÍ' : 'NO');
              try {
                localStorage.removeItem(defaultStorageKey);
                log('🗑️ Default eliminado del localStorage (nuevo vault cargado para roomId:', currentRoomId, ')');
              } catch (e) {
                console.error('❌ Error al borrar default:', e);
              }
            } else {
              console.warn('⚠️ No hay roomId, el vault se guardará como default');
            }
            
            // Guardar la nueva configuración
            const saveSuccess = await savePagesJSON(parsed, currentRoomId);
            if (saveSuccess) {
              // Count items for tracking
              const countItems = (config) => {
                let count = 0;
                const countRecursive = (cats) => {
                  if (!cats) return;
                  cats.forEach(cat => {
                    if (cat.pages) count += cat.pages.length;
                    if (cat.categories) countRecursive(cat.categories);
                  });
                };
                if (config.categories) countRecursive(config.categories);
                return count;
              };
              trackJSONImported(countItems(parsed));
              
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
        alert('❌ Error loading JSON: ' + e.message);
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
        
        // Para Co-GM, obtener config desde metadata; para Master GM, desde localStorage
        let config;
        if (isCoGMGlobal) {
          try {
            const metadata = await OBR.room.getMetadata();
            config = metadata ? metadata[FULL_CONFIG_KEY] : null;
            if (!config) {
              throw new Error('No vault available in metadata');
            }
          } catch (e) {
            console.error('Error obteniendo vault para Co-GM:', e);
            alert('❌ Error: Could not retrieve vault from Master GM');
            return;
          }
        } else {
          config = getPagesJSON(currentRoomId) || await getDefaultJSON();
        }
        
        const jsonStr = JSON.stringify(config, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Crear nombre de archivo user-friendly
        let fileName;
        if (currentRoomId && currentRoomId !== 'default') {
          // Intentar obtener nombre de la room (si está disponible en OBR)
          let roomName = null;
          try {
            // OBR no tiene método directo para obtener nombre, usar fecha + roomId abreviado
            const date = new Date();
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            const shortRoomId = currentRoomId.substring(0, 8); // Primeros 8 caracteres
            fileName = `gm-vault-${dateStr}-${shortRoomId}.json`;
          } catch (e) {
            // Fallback: usar solo fecha
            const date = new Date();
            const dateStr = date.toISOString().split('T')[0];
            fileName = `gm-vault-${dateStr}.json`;
          }
        } else {
          const date = new Date();
          const dateStr = date.toISOString().split('T')[0];
          fileName = `gm-vault-default-${dateStr}.json`;
        }
        
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Count items for tracking
        const countItems = (config) => {
          let count = 0;
          const countRecursive = (cats) => {
            if (!cats) return;
            cats.forEach(cat => {
              if (cat.pages) count += cat.pages.length;
              if (cat.categories) countRecursive(cat.categories);
            });
          };
          if (config.categories) countRecursive(config.categories);
          return count;
        };
        trackJSONExported(countItems(config));
        
        alert('✅ JSON downloaded successfully');
      } catch (e) {
        console.error('Error al descargar JSON:', e);
        alert('❌ Error downloading JSON: ' + e.message);
      }
    });
  }

  // Patreon button - evitar múltiples listeners
  const patreonBtn = document.getElementById('patreon-btn');
  if (patreonBtn && !patreonBtn.dataset.listenerAdded) {
    patreonBtn.dataset.listenerAdded = 'true';
    patreonBtn.addEventListener('click', () => {
      const patreonUrl = 'https://patreon.com/usegmvault';
      window.open(patreonUrl, '_blank', 'noopener,noreferrer');
      trackEvent('patreon_opened', {
        source: 'settings'
      });
    });
  }

  // Feedback button - evitar múltiples listeners
  const feedbackBtn = document.getElementById('feedback-btn');
  if (feedbackBtn && !feedbackBtn.dataset.listenerAdded) {
    feedbackBtn.dataset.listenerAdded = 'true';
    feedbackBtn.addEventListener('click', () => {
      const feedbackUrl = 'https://www.notion.so/DM-Panel-Roadmap-2d8d4856c90e8088825df40c3be24393?source=copy_link';
      window.open(feedbackUrl, '_blank', 'noopener,noreferrer');
      trackEvent('feedback_opened', {
        source: 'settings'
      });
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
      // Detectar si es icono de reloj/recarga para añadir animación pulse
      const isClockIcon = item.icon.includes('icon-reload') || item.icon.includes('icon-clock') || item.icon.includes('clock');
      const pulseClass = isClockIcon ? 'icon-loading' : '';
      iconHtml = `<img src="${item.icon}" alt="" class="${pulseClass}" style="width: 24px; height: 24px; display: block; ${rotation}" />`;
    } else {
      iconHtml = `<span style="font-size: var(--font-size-base); width: var(--icon-size-md); text-align: center;">${item.icon || ''}</span>`;
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
        <div class="form__field" ${field.conditional ? 'style="display: none;"' : ''} data-field-name="${field.name}">
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
        // Para campos condicionales, solo incluir si están visibles
        if (field.conditional) {
          const fieldContainer = modal.querySelector(`[data-field-name="${field.name}"]`);
          if (fieldContainer && fieldContainer.style.display === 'none') {
            return; // No incluir campos condicionales ocultos
          }
        }
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
    log('📝 Datos del formulario:', formData); // Debug
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

  // Agregar listener para mostrar/ocultar campos condicionales basados en la URL
  const urlInput = modal.querySelector('#field-url');
  if (urlInput) {
    const blockTypesField = modal.querySelector('[data-field-name="blockTypes"]');
    if (blockTypesField) {
      // Función para actualizar la visibilidad del campo blockTypes
      const updateBlockTypesVisibility = () => {
        const urlValue = urlInput.value.trim();
        if (isNotionUrl(urlValue)) {
          blockTypesField.style.display = '';
        } else {
          blockTypesField.style.display = 'none';
          // Limpiar el valor si no es una URL de Notion
          const blockTypesInput = modal.querySelector('#field-blockTypes');
          if (blockTypesInput) {
            blockTypesInput.value = '';
          }
        }
      };

      // Verificar la URL inicial
      updateBlockTypesVisibility();

      // Agregar listener para cambios en la URL
      urlInput.addEventListener('input', updateBlockTypesVisibility);
      urlInput.addEventListener('change', updateBlockTypesVisibility);
    }
  }
}

// Variable para evitar mostrar múltiples modales de storage limit
let storageLimitModalShown = false;

/**
 * Muestra un modal cuando el localStorage está lleno (QuotaExceededError)
 * @param {string} context - Contexto donde ocurrió el error (ej: 'saving configuration', 'caching page')
 */
function showStorageLimitModal(context = 'saving data') {
  // Track storage limit event
  trackStorageLimitReached(context);
  
  // Evitar mostrar múltiples modales
  if (storageLimitModalShown) {
    log('⚠️ Storage limit modal already shown, skipping');
    return;
  }
  storageLimitModalShown = true;

  const overlay = document.createElement('div');
  overlay.id = 'storage-limit-modal';
  overlay.className = 'modal';

  const modal = document.createElement('div');
  modal.className = 'modal__content modal__content--warning';

  modal.innerHTML = `
    <div class="modal__icon">⚠️</div>
    <h2 class="modal__title">Storage Limit Reached</h2>
    <div class="modal__body">
      <p class="modal__text">
        Your browser's local storage is full and we couldn't save your data while <strong>${context}</strong>.
      </p>
      <p class="modal__text">
        This can happen when you have many pages cached. You can:
      </p>
      <ul class="modal__list">
        <li>Clear the cache to free up space</li>
        <li>Remove some pages from your configuration</li>
        <li>Check our roadmap for premium storage options</li>
      </ul>
    </div>
    <div class="form__actions form__actions--stacked">
      <button id="storage-clear-cache" class="btn btn--primary btn--flex">
        🗑️ Clear Cache
      </button>
      <a href="https://www.notion.so/DM-Panel-Roadmap-2d8d4856c90e8088825df40c3be24393" 
         target="_blank" 
         rel="noopener noreferrer"
         class="btn btn--ghost btn--flex">
        📋 View Roadmap
      </a>
      <button id="storage-dismiss" class="btn btn--ghost btn--flex">
        Dismiss
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    storageLimitModalShown = false;
  };

  // Clear Cache button
  const clearCacheBtn = modal.querySelector('#storage-clear-cache');
  clearCacheBtn.addEventListener('click', async () => {
    const clearedCount = clearAllCache();
    trackCacheCleared();
    clearCacheBtn.textContent = `✅ Cleared ${clearedCount} items`;
    clearCacheBtn.disabled = true;
    setTimeout(() => {
      close();
    }, 1500);
  });

  // Dismiss button
  const dismissBtn = modal.querySelector('#storage-dismiss');
  dismissBtn.addEventListener('click', close);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/**
 * Muestra un modal cuando el GM no está activo (para players)
 */
function showGMNotActiveModal() {
  trackGMNotActive();
  
  const overlay = document.createElement('div');
  overlay.id = 'gm-not-active-modal';
  overlay.className = 'modal';

  const modal = document.createElement('div');
  modal.className = 'modal__content modal__content--info';

  modal.innerHTML = `
    <div class="modal__icon">👋</div>
    <h2 class="modal__title">Your GM is not active right now</h2>
    <div class="modal__body">
      <p class="modal__text">
        The content you're trying to view requires your GM to be online.
      </p>
      <p class="modal__text">
        Wait for them to join the session or send them a greeting! 
      </p>
    </div>
    <div class="form__actions">
      <button id="gm-retry" class="btn btn--primary btn--flex">
        🔄 Retry
      </button>
      <button id="gm-dismiss" class="btn btn--ghost btn--flex">
        Dismiss
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
  };

  // Retry button - just closes, caller handles retry
  const retryBtn = modal.querySelector('#gm-retry');
  retryBtn.addEventListener('click', () => {
    close();
    // Trigger a custom event that callers can listen to
    window.dispatchEvent(new CustomEvent('gm-retry-requested'));
  });

  // Dismiss button
  const dismissBtn = modal.querySelector('#gm-dismiss');
  dismissBtn.addEventListener('click', close);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/**
 * Muestra un modal cuando el contenido es demasiado grande para compartir
 * @param {number} size - Tamaño del contenido en bytes
 * @param {string} pageName - Nombre de la página
 */
function showContentTooLargeModal(size, pageName) {
  trackContentTooLarge(size, pageName);
  
  const overlay = document.createElement('div');
  overlay.id = 'content-too-large-modal';
  overlay.className = 'modal';

  const modal = document.createElement('div');
  modal.className = 'modal__content modal__content--warning';

  const sizeKB = (size / 1024).toFixed(1);

  modal.innerHTML = `
    <div class="modal__icon">📦</div>
    <h2 class="modal__title">Content Too Large to Share</h2>
    <div class="modal__body">
      <p class="modal__text">
        The page "<strong>${pageName}</strong>" is too large to share with players (${sizeKB} KB).
      </p>
      <p class="modal__text">
        Consider splitting the content into smaller pages or removing some elements.
      </p>
    </div>
    <div class="form__actions">
      <a href="https://www.notion.so/DM-Panel-Roadmap-2d8d4856c90e8088825df40c3be24393" 
         target="_blank" 
         rel="noopener noreferrer"
         class="btn btn--ghost btn--flex">
        📋 View Roadmap
      </a>
      <button id="large-content-dismiss" class="btn btn--primary btn--flex">
        Got it
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
  };

  // Dismiss button
  const dismissBtn = modal.querySelector('#large-content-dismiss');
  dismissBtn.addEventListener('click', close);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// Función para mostrar el editor de JSON

// Función para mostrar el editor visual tipo Notion
async function showVisualEditor(pagesConfig, roomId = null) {
  const currentConfig = getPagesJSON(roomId) || pagesConfig || await getDefaultJSON();
  log('📖 Abriendo editor visual - Configuración cargada:', currentConfig);

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
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      border-radius: var(--radius-sm);
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
        color: var(--color-text-muted);
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
        color: var(--color-text-primary);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-xs);
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
          color: var(--color-text-primary);
          font-weight: var(--font-weight-bold);
          font-size: var(--font-size-xs);
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
          color: var(--color-text-muted);
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-normal);
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
        // { name: 'selector', label: 'Selector (opcional)', type: 'text', placeholder: '#main-content', help: 'Solo para URLs externas' }, // Temporalmente oculto
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
    const fields = [
      { name: 'name', label: 'Nombre', type: 'text', required: true, value: page.name },
      { name: 'url', label: 'URL', type: 'url', required: true, value: page.url }
    ];

    // Agregar campo Block types solo si la URL es de Notion
    if (isNotionUrl(page.url)) {
      fields.push(
        { name: 'blockTypes', label: 'Block types (optional)', type: 'text', value: Array.isArray(page.blockTypes) ? page.blockTypes.join(', ') : (page.blockTypes || ''), help: 'Only for Notion URLs' }
      );
    }

    fields.push(
      { name: 'visibleToPlayers', label: 'Visible to all players', type: 'checkbox', value: page.visibleToPlayers === true, help: 'Allow all players to see this page' }
    );

    showModalForm(
      'Edit Page',
      fields,
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
        padding: var(--spacing-xl);
        color: var(--color-text-muted);
      `;
      emptyState.innerHTML = `
        <p style="margin-bottom: 12px;">No folders</p>
        <p style="font-size: var(--font-size-xs); color: var(--color-text-muted);">Click the + button to add a folder</p>
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
      log('Filtros - funcionalidad pendiente');
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
log('✅ index.js cargado completamente');
