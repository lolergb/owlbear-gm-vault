/**
 * @fileoverview Servicio de broadcast para comunicación GM-Players
 * 
 * Gestiona la comunicación en tiempo real entre el GM y los jugadores.
 */

import { 
  BROADCAST_CHANNEL_REQUEST, 
  BROADCAST_CHANNEL_RESPONSE,
  BROADCAST_CHANNEL_VISIBLE_PAGES,
  BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES,
  BROADCAST_CHANNEL_SHOW_IMAGE,
  BROADCAST_CHANNEL_REQUEST_FULL_VAULT,
  BROADCAST_CHANNEL_RESPONSE_FULL_VAULT
} from '../utils/constants.js';
import { log, logWarn, getUserRole } from '../utils/logger.js?v=20260722-3';

/**
 * Servicio para gestionar la comunicación broadcast
 */
export class BroadcastService {
  constructor() {
    // Referencia a OBR
    this.OBR = null;
    // Subscripciones activas
    this.subscriptions = [];
    // Referencia al CacheService
    this.cacheService = null;
    // Callback para cuando se recibe contenido
    this.onContentReceived = null;
    // Callback para cuando se recibe lista de páginas visibles
    this.onVisiblePagesReceived = null;
    // Callback para cuando se excede el límite de tamaño (64 kB)
    this.onSizeLimitExceeded = null;
  }

  /**
   * Establece callback para cuando se excede el límite de tamaño del broadcast
   * @param {Function} callback - Función a ejecutar (recibe el canal y tamaño estimado)
   */
  setSizeLimitCallback(callback) {
    this.onSizeLimitExceeded = callback;
  }

  /**
   * Inyecta dependencias
   * @param {Object} deps - Dependencias
   */
  setDependencies({ OBR, cacheService }) {
    if (OBR) this.OBR = OBR;
    if (cacheService) this.cacheService = cacheService;
  }

  /**
   * Establece callback para contenido recibido
   * @param {Function} callback
   */
  setContentReceivedCallback(callback) {
    this.onContentReceived = callback;
  }

  /**
   * Establece callback para lista de páginas visibles
   * @param {Function} callback
   */
  setVisiblePagesCallback(callback) {
    this.onVisiblePagesReceived = callback;
  }

  // ============================================
  // MÉTODOS GENÉRICOS
  // ============================================

  /**
   * Envía un mensaje por broadcast
   * @param {string} channel - Canal de broadcast (puede ser el nombre del canal directamente o un alias)
   * @param {Object} data - Datos a enviar
   */
  async sendMessage(channel, data) {
    if (!this.OBR) {
      logWarn('OBR no disponible para enviar mensaje');
      return { success: false, error: 'OBR not available' };
    }

    // Mapeo de aliases a canales (opcional, para compatibilidad)
    const channelAliases = {
      'SHOW_IMAGE': BROADCAST_CHANNEL_SHOW_IMAGE,
      'REQUEST_FULL_VAULT': BROADCAST_CHANNEL_REQUEST_FULL_VAULT,
      'RESPONSE_FULL_VAULT': BROADCAST_CHANNEL_RESPONSE_FULL_VAULT,
    };

    // Usar el alias si existe, sino usar el canal directamente
    const targetChannel = channelAliases[channel] || channel;

    try {
      const messageData = {
        ...data,
        timestamp: Date.now()
      };
      
      await this.OBR.broadcast.sendMessage(targetChannel, messageData);
      log(`📤 Mensaje enviado [${targetChannel}]:`, Object.keys(data));
      return { success: true };
    } catch (e) {
      // Detectar error de límite de tamaño (64 kB)
      const isSizeLimitError = e?.error?.name === 'SizeLimitExceededError' || 
                               e?.message?.includes('size limit') ||
                               e?.error?.message?.includes('size limit');
      
      if (isSizeLimitError) {
        logWarn('⚠️ Mensaje excede el límite de 64 kB');
        // Estimar tamaño del mensaje
        const estimatedSize = JSON.stringify(data).length;
        const estimatedKB = Math.round(estimatedSize / 1024);
        
        if (this.onSizeLimitExceeded) {
          this.onSizeLimitExceeded(targetChannel, estimatedKB);
        }
        return { success: false, error: 'size_limit', estimatedKB };
      }
      
      logWarn('Error enviando mensaje:', e);
      return { success: false, error: e?.message || 'unknown' };
    }
  }

  /**
   * Escucha mensajes de un tipo específico
   * @param {string} type - Tipo de mensaje
   * @param {Function} callback - Callback a ejecutar
   * @returns {Function} - Función para desuscribirse
   */
  onMessage(type, callback) {
    if (!this.OBR) return () => {};

    const channels = {
      'SHOW_IMAGE': BROADCAST_CHANNEL_SHOW_IMAGE,
    };

    const channel = channels[type];
    if (!channel) return () => {};

    const unsubscribe = this.OBR.broadcast.onMessage(channel, (event) => {
      callback(event.data);
    });

    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ============================================
  // CONTENIDO (HTML/Bloques)
  // ============================================

  /**
   * Solicita HTML/contenido al GM (para players y Co-GMs)
   * @param {string} pageId - ID de la página
   * @param {boolean} forceRefresh - Si true, el GM debe refrescar el contenido desde Notion
   * @returns {Promise<string|null>}
   */
  async requestContentFromGM(pageId, forceRefresh = false) {
    if (!this.OBR) return null;

    return new Promise((resolve) => {
      log(`📡 Solicitando contenido al GM para: ${pageId}${forceRefresh ? ' (forceRefresh)' : ''}`);
      
      // Timeout de 5 segundos (10 si es forceRefresh porque puede tardar más)
      const timeoutMs = forceRefresh ? 10000 : 5000;
      const timeout = setTimeout(() => {
        log('⏰ Timeout esperando respuesta del GM');
        unsubscribe();
        resolve(null);
      }, timeoutMs);
      
      // Escuchar respuesta del GM
      const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE, (event) => {
        const data = event.data;
        if (data && data.pageId === pageId) {
          log('✅ Contenido recibido del GM para:', pageId);
          clearTimeout(timeout);
          unsubscribe();
          
          if (data.html) {
            resolve(data.html);
          } else if (data.blocks) {
            resolve(data.blocks);
          } else {
            resolve(null);
          }
        }
      });
      
      // Enviar solicitud con flag de forceRefresh
      this.OBR.broadcast.sendMessage(BROADCAST_CHANNEL_REQUEST, { 
        pageId,
        forceRefresh,
        requestId: Date.now() 
      });
    });
  }

  /**
   * Configura el GM para responder a solicitudes de contenido
   * @param {Function} getHtmlForPage - Función que retorna HTML para un pageId (acepta pageId y forceRefresh)
   */
  setupGMContentResponder(getHtmlForPage) {
    if (!this.OBR) return;

    const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST, async (event) => {
      const isGM = await getUserRole();
      if (!isGM) return;

      const data = event.data;
      if (!data || !data.pageId) return;

      const forceRefresh = data.forceRefresh || false;
      log(`📡 Solicitud de contenido recibida para: ${data.pageId}${forceRefresh ? ' (forceRefresh)' : ''}`);

      try {
        let html = null;
        
        // Si es forceRefresh, NO usar caché local
        if (!forceRefresh && this.cacheService) {
          html = this.cacheService.getHtmlFromLocalCache(data.pageId);
          if (html) {
            log('📦 Usando HTML del caché local del GM');
          }
        } else if (forceRefresh && this.cacheService) {
          // Limpiar caché local del GM para forzar regeneración
          log('🔄 Limpiando caché del GM para forceRefresh');
          this.cacheService.clearPageCache(data.pageId);
        }

        // Si no hay en caché o es forceRefresh, generar nuevo contenido
        if (!html && getHtmlForPage) {
          html = await getHtmlForPage(data.pageId, forceRefresh);
        }

        if (html) {
          this.OBR.broadcast.sendMessage(BROADCAST_CHANNEL_RESPONSE, {
            pageId: data.pageId,
            html: html,
            timestamp: Date.now()
          });
          log('📤 Contenido enviado para:', data.pageId);
        } else {
          log('⚠️ No hay contenido disponible para:', data.pageId);
        }
      } catch (e) {
        logWarn('Error al responder solicitud de contenido:', e);
      }
    });

    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ============================================
  // PÁGINAS VISIBLES
  // ============================================

  /**
   * Envía la lista de páginas visibles a todos los players
   * @param {Object} visibleConfig - Configuración filtrada
   * @returns {Promise<boolean>} Si el mensaje se pudo enviar
   */
  async broadcastVisiblePages(visibleConfig) {
    if (!this.OBR) return false;

    try {
      await this.OBR.broadcast.sendMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, {
        config: visibleConfig,
        timestamp: Date.now()
      });
      log('📤 Lista de páginas visibles enviada');
      return true;
    } catch (e) {
      logWarn('No se pudo enviar lista de páginas visibles:', e);
      return false;
    }
  }

  /**
   * Solicita la lista de páginas visibles al GM (para players)
   * @returns {Promise<Object|null>}
   */
  async requestVisiblePages() {
    if (!this.OBR) return null;

    return new Promise((resolve) => {
      log('📡 Solicitando lista de páginas visibles al GM...');
      
      const timeout = setTimeout(() => {
        log('⏰ Timeout esperando lista de páginas visibles');
        unsubscribe();
        resolve(null);
      }, 5000);
      
      const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, (event) => {
        const data = event.data;
        if (data && data.config) {
          log('✅ Lista de páginas visibles recibida');
          clearTimeout(timeout);
          unsubscribe();
          resolve(data.config);
        }
      });
      
      this.OBR.broadcast.sendMessage(BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES, { 
        requestId: Date.now() 
      });
    });
  }

  /**
   * Configura el GM para responder a solicitudes de páginas visibles
   * @param {Function} getVisibleConfig - Función que retorna la config visible
   */
  setupGMVisiblePagesResponder(getVisibleConfig) {
    if (!this.OBR) return;

    const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES, async (event) => {
      const isGM = await getUserRole();
      if (!isGM) return;

      log('📡 Solicitud de lista de páginas visibles recibida');

      try {
        const visibleConfig = await getVisibleConfig();
        if (visibleConfig) {
          this.broadcastVisiblePages(visibleConfig);
        }
      } catch (e) {
        logWarn('Error al responder solicitud de páginas visibles:', e);
      }
    });

    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Escucha actualizaciones de páginas visibles (para players)
   * @param {Function} callback - Callback cuando se reciben actualizaciones
   */
  listenForVisiblePagesUpdates(callback) {
    if (!this.OBR) return;

    const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, (event) => {
      const data = event.data;
      if (data && data.config) {
        log('📥 Actualización de páginas visibles recibida');
        if (callback) {
          callback(data.config);
        }
      }
    });

    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ============================================
  // UTILIDADES
  // ============================================

  /**
   * Limpia todas las subscripciones
   */
  cleanup() {
    for (const unsubscribe of this.subscriptions) {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    }
    this.subscriptions = [];
    log('🧹 Subscripciones de broadcast limpiadas');
  }
}

export default BroadcastService;
