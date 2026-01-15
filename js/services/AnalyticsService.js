/**
 * Servicio de Analytics (Mixpanel)
 * Maneja el consent de cookies y el tracking de eventos
 * 
 * IMPORTANTE: Los nombres de eventos deben coincidir exactamente con el original
 * para no estropear las métricas históricas.
 */

import { log, logWarn } from '../utils/logger.js';

// Storage key para consent de analytics
const ANALYTICS_CONSENT_KEY = 'analytics_consent';

/**
 * Servicio de Analytics
 */
export class AnalyticsService {
  constructor() {
    this.OBR = null;
    this.mixpanelToken = null;
    this.mixpanelEnabled = false;
    this.mixpanelDistinctId = null;
    this.isBeta = false;
  }

  /**
   * Inyecta la referencia a OBR SDK
   * @param {Object} obr - Referencia al SDK
   */
  setOBR(obr) {
    this.OBR = obr;
  }

  /**
   * Detecta si estamos en un entorno beta (deploy-preview)
   * @returns {boolean}
   */
  _detectBeta() {
    const origin = window.location.origin;
    const hostname = window.location.hostname;
    
    // Es beta si:
    // - Es un deploy-preview de Netlify
    // - Es localhost
    // - No es el dominio de producción
    const isBeta = 
      origin.includes('deploy-preview') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.includes('.local');
    
    this.isBeta = isBeta;
    log(`📊 Entorno detectado: ${isBeta ? 'BETA (sin analytics)' : 'PRODUCCIÓN'}`);
    return isBeta;
  }

  /**
   * Verifica si el usuario ha dado consentimiento para analytics
   * @returns {boolean|null} - true si aceptó, false si rechazó, null si no se ha establecido
   */
  getConsent() {
    try {
      const consent = localStorage.getItem(ANALYTICS_CONSENT_KEY);
      if (consent === 'true') return true;
      if (consent === 'false') return false;
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Guarda la preferencia de consentimiento
   * @param {boolean} accepted - Si el usuario aceptó
   */
  setConsent(accepted) {
    try {
      localStorage.setItem(ANALYTICS_CONSENT_KEY, accepted ? 'true' : 'false');
    } catch (e) {
      logWarn('Error guardando consent de analytics:', e);
    }
  }

  /**
   * Muestra el banner de consentimiento de cookies
   */
  showConsentBanner() {
    // Solo mostrar si no se ha establecido consent
    if (this.getConsent() !== null) {
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

    // Botón Accept
    const acceptBtn = banner.querySelector('#cookie-accept');
    acceptBtn.addEventListener('click', () => {
      this.setConsent(true);
      banner.remove();
      // Inicializar Mixpanel después del consent
      this.init();
    });

    // Botón Reject
    const rejectBtn = banner.querySelector('#cookie-reject');
    rejectBtn.addEventListener('click', () => {
      this.setConsent(false);
      banner.remove();
    });
  }

  /**
   * Inicializa el servicio de analytics
   */
  async init() {
    // Detectar si es beta
    const isBeta = this._detectBeta();
    
    // Verificar consent (mostrar banner si no hay consent, incluso en beta)
    const consent = this.getConsent();
    if (consent === null) {
      // Mostrar banner de cookies (también en beta para que el consent esté listo)
      this.showConsentBanner();
      return;
    }

    // Si el usuario rechazó, no hacer nada
    if (consent === false) {
      log('📊 Mixpanel deshabilitado (usuario rechazó)');
      return;
    }

    // Si es beta, no inicializar Mixpanel pero el consent ya está guardado
    if (isBeta) {
      log('📊 Mixpanel deshabilitado (entorno beta)');
      return;
    }

    try {
      // Solo fetch token si estamos en Netlify
      if (!window.location.origin.includes('netlify.app') && !window.location.origin.includes('netlify.com')) {
        log('📊 Mixpanel deshabilitado (no en Netlify)');
        return;
      }

      const response = await fetch('/.netlify/functions/get-mixpanel-token');
      if (response.ok) {
        const data = await response.json();
        if (data.enabled && data.token) {
          this.mixpanelToken = data.token;
          this.mixpanelEnabled = true;

          // Generar distinct ID
          try {
            if (this.OBR && this.OBR.player) {
              this.mixpanelDistinctId = await this.OBR.player.getId();
            }
          } catch (e) {
            // Fallback a ID random
            this.mixpanelDistinctId = localStorage.getItem('mixpanel_distinct_id');
            if (!this.mixpanelDistinctId) {
              this.mixpanelDistinctId = 'anon_' + Math.random().toString(36).substring(2, 15);
              localStorage.setItem('mixpanel_distinct_id', this.mixpanelDistinctId);
            }
          }

          log('📊 Mixpanel analytics habilitado');
          
          // Track extensión abierta
          this.trackExtensionOpened();
        }
      }
    } catch (e) {
      log('📊 Mixpanel deshabilitado (error de fetch)');
      this.mixpanelEnabled = false;
    }
  }

  /**
   * Trackea un evento a Mixpanel
   * @param {string} eventName - Nombre del evento
   * @param {Object} properties - Propiedades adicionales
   */
  async trackEvent(eventName, properties = {}) {
    if (!this.mixpanelEnabled || !this.mixpanelToken) {
      return;
    }

    try {
      // Obtener rol del usuario
      let userRole = 'unknown';
      try {
        if (this.OBR && this.OBR.player) {
          const role = await this.OBR.player.getRole();
          userRole = role;
        }
      } catch (e) {}

      // Construir payload del evento (formato Mixpanel)
      const eventData = {
        event: eventName,
        properties: {
          token: this.mixpanelToken,
          distinct_id: this.mixpanelDistinctId,
          time: Math.floor(Date.now() / 1000),
          $insert_id: Math.random().toString(36).substring(2, 15),
          role: userRole,
          ...properties
        }
      };

      // Convertir a base64
      const jsonString = JSON.stringify([eventData]);
      const utf8Bytes = new TextEncoder().encode(jsonString);
      let binaryString = '';
      for (let i = 0; i < utf8Bytes.length; i++) {
        binaryString += String.fromCharCode(utf8Bytes[i]);
      }
      const base64String = btoa(binaryString);

      // Enviar a Mixpanel (EU endpoint)
      const trackUrl = 'https://api-eu.mixpanel.com/track';
      
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
          if (result.status === 1) {
            log(`📊 Evento trackeado: ${eventName}`);
          }
        } else {
          throw new Error('HTTP error');
        }
      } catch (fetchError) {
        // Fallback: usar image pixel (más confiable con CORS)
        log(`📊 Using image pixel fallback for: ${eventName}`);
        const img = new Image();
        img.src = `https://api-eu.mixpanel.com/track?data=${encodeURIComponent(base64String)}&img=1`;
      }
    } catch (e) {
      // Silently fail - analytics nunca debe romper la app
    }
  }

  // ============================================
  // EVENTOS - Deben coincidir exactamente con el original
  // ============================================

  /**
   * Track extension opened
   */
  trackExtensionOpened() {
    this.trackEvent('extension_opened');
  }

  /**
   * Track page view
   * @param {string} pageName - Nombre de la página
   * @param {string} pageType - Tipo: notion, image, video, iframe
   */
  trackPageView(pageName, pageType = 'unknown') {
    this.trackEvent('page_view', {
      page_name: pageName,
      page_type: pageType
    });
  }

  /**
   * Track image shared
   * @param {string} imageUrl - URL de la imagen
   */
  trackImageShare(imageUrl) {
    this.trackEvent('image_shared', {
      image_url: imageUrl ? imageUrl.substring(0, 100) : 'unknown'
    });
  }

  /**
   * Track visibility toggled
   * @param {string} pageName - Nombre de la página
   * @param {boolean} visible - Nuevo estado de visibilidad
   */
  trackVisibilityToggle(pageName, visible) {
    this.trackEvent('visibility_toggled', {
      page_name: pageName,
      visible: visible
    });
  }

  /**
   * Track storage limit reached
   * @param {string} context - Contexto del error
   */
  trackStorageLimitReached(context) {
    this.trackEvent('storage_limit_reached', {
      context: context
    });
  }

  /**
   * Track content too large to share (>64KB broadcast limit)
   * @param {number} size - Tamaño estimado en bytes
   * @param {string} channel - Canal de broadcast
   */
  trackContentTooLarge(size, channel) {
    this.trackEvent('content_too_large', {
      estimated_size: size,
      estimated_kb: Math.round(size / 1024),
      channel: channel
    });
  }

  /**
   * Track cache cleared
   */
  trackCacheCleared() {
    this.trackEvent('cache_cleared');
  }

  /**
   * Track GM not active
   */
  trackGMNotActive() {
    this.trackEvent('gm_not_active');
  }

  /**
   * Track content too large
   * @param {number} size - Tamaño en bytes
   * @param {string} pageName - Nombre de la página
   */
  trackContentTooLarge(size, pageName) {
    this.trackEvent('content_too_large', {
      size_kb: Math.round(size / 1024),
      page_name: pageName
    });
  }

  /**
   * Track folder added
   * @param {string} folderName - Nombre de la carpeta
   */
  trackFolderAdded(folderName) {
    this.trackEvent('folder_added', {
      folder_name: folderName
    });
  }

  /**
   * Track page added
   * @param {string} pageName - Nombre de la página
   * @param {string} pageType - Tipo de página
   */
  trackPageAdded(pageName, pageType = 'unknown') {
    this.trackEvent('page_added', {
      page_name: pageName,
      page_type: pageType
    });
  }

  /**
   * Track folder edited
   * @param {string} oldName - Nombre anterior
   * @param {string} newName - Nombre nuevo
   */
  trackFolderEdited(oldName, newName) {
    this.trackEvent('folder_edited', {
      old_name: oldName,
      new_name: newName
    });
  }

  /**
   * Track page edited
   * @param {string} pageName - Nombre de la página
   */
  trackPageEdited(pageName) {
    this.trackEvent('page_edited', {
      page_name: pageName
    });
  }

  /**
   * Track folder deleted
   * @param {string} folderName - Nombre de la carpeta
   */
  trackFolderDeleted(folderName) {
    this.trackEvent('folder_deleted', {
      folder_name: folderName
    });
  }

  /**
   * Track page deleted
   * @param {string} pageName - Nombre de la página
   */
  trackPageDeleted(pageName) {
    this.trackEvent('page_deleted', {
      page_name: pageName
    });
  }

  /**
   * Track page moved/reordered
   * @param {string} pageName - Nombre de la página
   * @param {string} direction - 'up' o 'down'
   */
  trackPageMoved(pageName, direction) {
    this.trackEvent('page_moved', {
      page_name: pageName,
      direction: direction
    });
  }

  /**
   * Track Notion token configured
   */
  trackTokenConfigured() {
    this.trackEvent('token_configured');
  }

  /**
   * Track Notion token removed
   */
  trackTokenRemoved() {
    this.trackEvent('token_removed');
  }

  /**
   * Track JSON imported
   * @param {number} itemCount - Número de items
   */
  trackJSONImported(itemCount) {
    this.trackEvent('json_imported', {
      item_count: itemCount
    });
  }

  /**
   * Track JSON exported
   * @param {number} itemCount - Número de items
   */
  trackJSONExported(itemCount) {
    this.trackEvent('json_exported', {
      item_count: itemCount
    });
  }

  /**
   * Track page linked to token
   * @param {string} pageName - Nombre de la página
   * @param {string} tokenId - ID del token
   */
  trackPageLinkedToToken(pageName, tokenId) {
    this.trackEvent('page_linked_to_token', {
      page_name: pageName,
      token_id: tokenId ? tokenId.substring(0, 20) : 'unknown'
    });
  }

  /**
   * Track page viewed from token
   * @param {string} pageName - Nombre de la página
   */
  trackPageViewedFromToken(pageName) {
    this.trackEvent('page_viewed_from_token', {
      page_name: pageName
    });
  }

  /**
   * Track page reloaded
   * @param {string} pageName - Nombre de la página
   */
  trackPageReloaded(pageName) {
    this.trackEvent('page_reloaded', {
      page_name: pageName
    });
  }
}

export default AnalyticsService;
