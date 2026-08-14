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
  BROADCAST_CHANNEL_RESPONSE_FULL_VAULT,
  BROADCAST_CHANNEL_FULL_VAULT_UPDATED,
  BROADCAST_CHANNEL_INVALIDATE_PAGE,
  BROADCAST_MESSAGE_SIZE_LIMIT,
  BROADCAST_CONTENT_CHUNK_SIZE
} from '../utils/constants.js?v=20260815-1';
import { log, logWarn, getUserRole } from '../utils/logger.js?v=20260722-4';
import { sanitizeNotionHtml } from '../utils/htmlSecurity.js?v=20260722-4';
import {
  SECURE_VAULT_PROTOCOL,
  createVaultTransferRequest,
  decryptVaultFromGM,
  encryptVaultForRequester
} from '../utils/secureVaultTransfer.js?v=20260815-1';

function getUtf8Size(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Split a string without breaking Unicode code points or the broadcast budget. */
export function splitUtf8String(value, maxBytes = BROADCAST_CONTENT_CHUNK_SIZE) {
  if (typeof value !== 'string' || value.length === 0) return [''];

  const chunks = [];
  let chunk = '';
  let chunkBytes = 0;

  for (const character of value) {
    const characterBytes = getUtf8Size(character);
    if (chunk && chunkBytes + characterBytes > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

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
    // Callback para cuando se excede el límite de tamaño (16 kB)
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

      const messageBytes = getUtf8Size(JSON.stringify(messageData));
      if (messageBytes > BROADCAST_MESSAGE_SIZE_LIMIT) {
        const estimatedKB = Math.ceil(messageBytes / 1024);
        logWarn('⚠️ Mensaje excede el límite de 16 kB');
        this.onSizeLimitExceeded?.(targetChannel, estimatedKB);
        return { success: false, error: 'size_limit', estimatedKB };
      }
      
      await this.OBR.broadcast.sendMessage(targetChannel, messageData);
      log(`📤 Mensaje enviado [${targetChannel}]:`, Object.keys(data));
      return { success: true };
    } catch (e) {
      // Detectar error de límite de tamaño (16 kB)
      const isSizeLimitError = e?.error?.name === 'SizeLimitExceededError' || 
                               e?.message?.includes('size limit') ||
                               e?.error?.message?.includes('size limit');
      
      if (isSizeLimitError) {
        logWarn('⚠️ Mensaje excede el límite de 16 kB');
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

    const unsubscribe = this.OBR.broadcast.onMessage(channel, async (event) => {
      if (!await this.isEventFromGM(event)) return;
      callback(event.data, event);
    });

    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /** Resolve a broadcast sender from Owlbear's non-forgeable connection id. */
  async getEventSender(event) {
    if (!event?.connectionId || !this.OBR?.party?.getPlayers) return null;
    try {
      const players = await this.OBR.party.getPlayers();
      return (Array.isArray(players) ? players : []).find(
        player => player?.connectionId === event.connectionId
      ) || null;
    } catch (error) {
      logWarn('No se pudo validar el emisor del broadcast:', error);
      return null;
    }
  }

  async isEventFromGM(event) {
    const sender = await this.getEventSender(event);
    return sender?.role === 'GM';
  }

  /** Listen only to messages authenticated as coming from a connected GM. */
  listenForTrustedGMMessage(channel, callback) {
    if (!this.OBR) return () => {};
    const unsubscribe = this.OBR.broadcast.onMessage(channel, async (event) => {
      if (!await this.isEventFromGM(event)) {
        logWarn('⛔ Broadcast ignorado: el emisor no es GM', channel);
        return;
      }
      await callback?.(event.data, event);
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
      const requestId = (Date.now() * 1000) + Math.floor(Math.random() * 1000);
      const chunks = [];
      let receivedChunks = 0;
      let expectedTotal = null;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(value);
      };
      
      // Timeout de 5 segundos (10 si es forceRefresh porque puede tardar más)
      const timeoutMs = forceRefresh ? 10000 : 5000;
      const timeout = setTimeout(() => {
        log('⏰ Timeout esperando respuesta del GM');
        finish(null);
      }, timeoutMs);
      
      // Escuchar respuesta del GM
      const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE, async (event) => {
        if (!await this.isEventFromGM(event)) return;
        const data = event.data;
        if (!data || data.pageId !== pageId) return;
        // Accept legacy uncorrelated responses during rolling beta upgrades.
        if (data.requestId && data.requestId !== requestId) return;

        if (data.kind === 'content-chunk') {
          // Chunked responses were introduced together with request
          // correlation. Uncorrelated chunks can belong to another request.
          if (data.requestId !== requestId) return;
          if (!Number.isInteger(data.index) || !Number.isInteger(data.total)) return;
          if (data.index < 0 || data.index >= data.total || data.total > 1000) return;
          if (typeof data.chunk !== 'string') return;
          if (expectedTotal === null) expectedTotal = data.total;
          if (data.total !== expectedTotal) return;
          if (chunks[data.index] === undefined) receivedChunks++;
          chunks[data.index] = data.chunk;
          if (receivedChunks === expectedTotal) {
            log(`✅ Contenido recibido del GM en ${expectedTotal} fragmentos:`, pageId);
            finish(chunks.join(''));
          }
          return;
        }

        log('✅ Contenido recibido del GM para:', pageId);
        if (typeof data.html === 'string') finish(data.html);
        else if (data.blocks) finish(data.blocks);
        else finish(null);
      });
      
      // Enviar solicitud con flag de forceRefresh
      this.OBR.broadcast.sendMessage(BROADCAST_CHANNEL_REQUEST, { 
        pageId,
        forceRefresh,
        requestId
      });
    });
  }

  /**
   * Sends HTML directly when it fits, otherwise as correlated UTF-8 chunks.
   */
  async sendContentResponse(pageId, requestId, html) {
    const chunks = splitUtf8String(html);
    if (chunks.length === 1) {
      return this.sendMessage(BROADCAST_CHANNEL_RESPONSE, { pageId, requestId, html });
    }

    for (let index = 0; index < chunks.length; index++) {
      const result = await this.sendMessage(BROADCAST_CHANNEL_RESPONSE, {
        kind: 'content-chunk',
        pageId,
        requestId,
        index,
        total: chunks.length,
        chunk: chunks[index]
      });
      if (!result.success) return result;
    }
    return { success: true, chunks: chunks.length };
  }

  /**
   * Request a full vault using an ephemeral ECDH key. Broadcast observers only
   * receive AES-GCM ciphertext and cannot decrypt another GM's transfer.
   */
  async requestEncryptedFullVault({
    requesterId,
    requesterName = '',
    expectedSenderConnectionId = null,
    timeoutMs = 15000
  } = {}) {
    if (!this.OBR || !requesterId) return null;

    let transfer;
    try {
      transfer = await createVaultTransferRequest(requesterId, requesterName);
    } catch (error) {
      logWarn('No se pudo crear la solicitud cifrada del vault:', error);
      return null;
    }

    const { privateKey, request } = transfer;
    if (expectedSenderConnectionId) {
      request.targetConnectionId = expectedSenderConnectionId;
    }
    return new Promise((resolve) => {
      const chunks = [];
      let receivedChunks = 0;
      let expectedTotal = null;
      let senderConnectionId = null;
      let senderPublicKey = null;
      let iv = null;
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(value);
      };

      const timeout = setTimeout(() => {
        log('⏰ Timeout esperando vault cifrado');
        finish(null);
      }, timeoutMs);

      const unsubscribe = this.OBR.broadcast.onMessage(
        BROADCAST_CHANNEL_RESPONSE_FULL_VAULT,
        async (event) => {
          const data = event?.data;
          if (
            !data ||
            data.kind !== 'encrypted-full-vault-chunk' ||
            data.protocol !== SECURE_VAULT_PROTOCOL ||
            data.requesterId !== requesterId ||
            data.requestId !== request.requestId ||
            !Number.isInteger(data.index) ||
            !Number.isInteger(data.total) ||
            data.index < 0 ||
            data.index >= data.total ||
            data.total > 4096 ||
            typeof data.chunk !== 'string'
          ) return;

          if (
            expectedSenderConnectionId &&
            event.connectionId !== expectedSenderConnectionId
          ) return;
          if (!await this.isEventFromGM(event)) return;
          if (senderConnectionId === null) senderConnectionId = event.connectionId;
          if (event.connectionId !== senderConnectionId) return;

          if (expectedTotal === null) {
            expectedTotal = data.total;
            senderPublicKey = data.senderPublicKey;
            iv = data.iv;
          }
          if (
            data.total !== expectedTotal ||
            JSON.stringify(data.senderPublicKey) !== JSON.stringify(senderPublicKey) ||
            data.iv !== iv
          ) return;

          if (chunks[data.index] === undefined) receivedChunks++;
          chunks[data.index] = data.chunk;
          if (receivedChunks !== expectedTotal) return;

          try {
            const config = await decryptVaultFromGM({
              protocol: data.protocol,
              senderPublicKey,
              iv,
              ciphertext: chunks.join('')
            }, privateKey);
            log(`✅ Vault cifrado recibido en ${expectedTotal} fragmentos`);
            finish(config);
          } catch (error) {
            logWarn('⛔ No se pudo autenticar o descifrar el vault:', error);
            finish(null);
          }
        }
      );

      this.sendMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, request).then((result) => {
        if (!result.success) finish(null);
      });
    });
  }

  async sendEncryptedFullVaultResponse(request, config) {
    if (
      !request ||
      request.protocol !== SECURE_VAULT_PROTOCOL ||
      !request.requestId ||
      !request.requesterId ||
      !request.publicKey
    ) return { success: false, error: 'invalid_secure_request' };

    let envelope;
    try {
      envelope = await encryptVaultForRequester(config, request.publicKey);
    } catch (error) {
      logWarn('No se pudo cifrar el vault para Co-GM:', error);
      return { success: false, error: 'encryption_failed' };
    }

    const chunks = splitUtf8String(envelope.ciphertext);
    for (let index = 0; index < chunks.length; index++) {
      const result = await this.sendMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, {
        kind: 'encrypted-full-vault-chunk',
        protocol: envelope.protocol,
        requesterId: request.requesterId,
        requestId: request.requestId,
        index,
        total: chunks.length,
        senderPublicKey: envelope.senderPublicKey,
        iv: envelope.iv,
        chunk: chunks[index]
      });
      if (!result.success) return result;
    }
    return { success: true, chunks: chunks.length };
  }

  async notifyFullVaultUpdated() {
    const result = await this.sendMessage(BROADCAST_CHANNEL_FULL_VAULT_UPDATED, {
      revision: Date.now()
    });
    return result.success;
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
      const requestId = data.requestId;
      log(`📡 Solicitud de contenido recibida para: ${data.pageId}${forceRefresh ? ' (forceRefresh)' : ''}`);

      try {
        // Authorization and caching live together in the controller so a
        // cached hidden page can never bypass the visibility check.
        const html = getHtmlForPage
          ? await getHtmlForPage(data.pageId, forceRefresh, {
            connectionId: event.connectionId
          })
          : null;

        if (html) {
          // La caché interna puede contener HTML generado por una versión
          // anterior. Sanear en el último límite antes del broadcast protege
          // también a clientes que todavía no saneen al recibir.
          const safeHtml = sanitizeNotionHtml(html);
          await this.sendContentResponse(data.pageId, requestId, safeHtml);
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
      
      const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, async (event) => {
        if (!await this.isEventFromGM(event)) return;
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

    const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_VISIBLE_PAGES, async (event) => {
      if (!await this.isEventFromGM(event)) return;
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

  /** Tell every player to discard content that is no longer visible. */
  async invalidatePage(pageId) {
    if (!this.OBR || !pageId) return false;
    const result = await this.sendMessage(BROADCAST_CHANNEL_INVALIDATE_PAGE, { pageId });
    return result.success;
  }

  listenForPageInvalidation(callback) {
    if (!this.OBR) return () => {};
    const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_INVALIDATE_PAGE, async (event) => {
      if (!await this.isEventFromGM(event)) return;
      const pageId = event.data?.pageId;
      if (pageId && callback) callback(pageId);
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
