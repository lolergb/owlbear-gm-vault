/**
 * @fileoverview Controlador principal de la extensión GM Vault
 * 
 * Orquesta todos los servicios, renderers y componentes de la aplicación.
 */

import { log, logError, logWarn, setOBRReference, setGetTokenFunction, initDebugMode, getUserRole, isDebugMode } from '../utils/logger.js';
import { filterVisiblePages } from '../utils/helpers.js';
import { BROADCAST_CHANNEL_REQUEST_FULL_VAULT, BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, OWNER_TIMEOUT, METADATA_KEY } from '../utils/constants.js';

// Models
import { Page } from '../models/Page.js';
import { Category } from '../models/Category.js';

// Services
import { CacheService } from '../services/CacheService.js';
import { StorageService } from '../services/StorageService.js';
import { NotionService } from '../services/NotionService.js';
import { BroadcastService } from '../services/BroadcastService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';
import { getImageCacheService } from '../services/ImageCacheService.js';

// Renderers
import { NotionRenderer } from '../renderers/NotionRenderer.js';
import { UIRenderer } from '../renderers/UIRenderer.js';

// Parsers & Builders
import { ConfigParser } from '../parsers/ConfigParser.js';
import { ConfigBuilder } from '../builders/ConfigBuilder.js';

// UI
import { ModalManager } from '../ui/ModalManager.js';
import { EventHandlers } from '../ui/EventHandlers.js';

/**
 * Controlador principal de la extensión
 */
export class ExtensionController {
  constructor() {
    // Referencia a OBR SDK
    this.OBR = null;
    
    // Estado de la aplicación
    this.isGM = true;
    this.isCoGM = false; // Co-GM (GM promovido, solo lectura)
    this.roomId = null;
    this.playerId = null;
    this.playerName = null;
    this.config = null;
    this.isInitialized = false;
    this.playerViewMode = false; // Toggle para vista de jugador (solo páginas visibles)

    // Servicios
    this.cacheService = new CacheService();
    this.storageService = new StorageService();
    this.notionService = new NotionService();
    this.broadcastService = new BroadcastService();
    this.analyticsService = new AnalyticsService();
    this.imageCacheService = getImageCacheService();

    // Renderers
    this.notionRenderer = new NotionRenderer();
    this.uiRenderer = new UIRenderer();

    // Parser & Builder
    this.configParser = new ConfigParser();
    this.configBuilder = null;

    // UI Components
    this.modalManager = new ModalManager();
    this.eventHandlers = new EventHandlers();

    // Elementos DOM
    this.pagesContainer = null;
    this.contentContainer = null;

    // Intervals
    this.heartbeatInterval = null;
    this.roleCheckInterval = null;
  }

  /**
   * Inicializa la extensión
   * @param {Object} OBR - Referencia al SDK de Owlbear Rodeo (ya debe estar listo)
   * @param {Object} options - Opciones de inicialización
   */
  async init(OBR, options = {}) {
    console.log('🚀 Inicializando ExtensionController...');
    
    this.OBR = OBR;
    
    // Debug: verificar estructura de OBR
    console.log('📦 OBR disponible:', !!OBR);
    console.log('📦 OBR.room:', OBR?.room);
    console.log('📦 OBR.player:', OBR?.player);
    console.log('📦 OBR keys:', OBR ? Object.keys(OBR) : 'N/A');
    
    // Configurar referencias
    setOBRReference(OBR);
    setGetTokenFunction(() => this.storageService.getUserToken());
    
    // Configurar servicios
    this._setupServices();
    
    // Inicializar modo debug
    await initDebugMode();

    // OBR ya está listo (main.js espera a onReady antes de llamar init)
    console.log('✅ Configurando extensión...');
    
    // Obtener información del jugador y room
    await this._fetchPlayerInfo();
    
    // Obtener configuración
    await this._loadConfig();
    
    // Configurar UI
    this._setupUI(options);
    
    // Configurar event handlers
    this._setupEventHandlers();
    
    // Configurar broadcast según rol
    if (this.isGM && !this.isCoGM) {
      // Master GM: establecer ownership e iniciar heartbeat
      await this._establishVaultOwnership();
      this._startHeartbeat();
      this._setupGMBroadcast();
    } else if (this.isCoGM) {
      // Co-GM: escuchar actualizaciones como player pero también responder a solicitudes de contenido
      this._setupCoGMBroadcast();
    } else {
      // Player: escuchar actualizaciones
      this._setupPlayerBroadcast();
      // Verificar si el GM está activo
      this._checkGMAvailability();
    }
    
    // Iniciar detección de cambio de rol
    this._startRoleChangeDetection();
    
    // Verificar si estamos en modo modal
    const urlParams = new URLSearchParams(window.location.search);
    const isModalMode = urlParams.get('modal') === 'true';
    const modalUrl = urlParams.get('url');
    const modalName = urlParams.get('name');
    const isHtmlContent = urlParams.get('htmlContent') === 'true';
    const contentKey = urlParams.get('contentKey');
    const blockTypesParam = urlParams.get('blockTypes');
    
    // Parsear blockTypes si viene en la URL
    let blockTypes = null;
    if (blockTypesParam) {
      try {
        blockTypes = JSON.parse(decodeURIComponent(blockTypesParam));
      } catch (e) {
        log('Error parseando blockTypes:', e);
      }
    }
    
    if (isModalMode && isHtmlContent && contentKey) {
      // Modo modal con HTML pre-renderizado (compartido por GM)
      await this._loadHtmlContent(
        contentKey,
        modalName ? decodeURIComponent(modalName) : 'Page'
      );
    } else if (isModalMode && modalUrl) {
      // Modo modal: cargar contenido directamente
      await this._loadModalContent(
        decodeURIComponent(modalUrl),
        modalName ? decodeURIComponent(modalName) : 'Page',
        blockTypes
      );
    } else {
      // Modo normal: renderizar lista de páginas
      await this.render();
    }
    
    // Configurar menús contextuales para tokens (para todos: GM, Co-GM y Players)
    await this._setupTokenContextMenus();
    
    // Exponer función global para refrescar imágenes
    this._setupGlobalRefreshImage();
    
    this.isInitialized = true;
    log('✅ ExtensionController inicializado correctamente');
  }

  /**
   * Configura la función global para refrescar imágenes/página
   * @private
   */
  _setupGlobalRefreshImage() {
    const controller = this;
    
    window.refreshImage = async function(button) {
      log('🔄 Refrescando página por error de imagen...');
      
      // Solo el Master GM puede refrescar contenido de Notion (tiene acceso a la API)
      // Para Co-GM y Players, no intentar refrescar automáticamente
      if (!controller.isGM || controller.isCoGM) {
        log('👤 Co-GM/Player: no se puede refrescar contenido automáticamente');
        // No hacer nada - el botón de retry ya está visible
        return;
      }
      
      // Verificar si el botón está dentro de un modal de mention
      let overlay = null;
      let content = null;
      
      if (button) {
        // Buscar el overlay del modal desde el botón
        overlay = button.closest('.mention-modal-overlay');
        if (overlay) {
          content = overlay.querySelector('.mention-modal__content');
        }
      } else {
        // Si no hay botón, buscar el modal activo
        overlay = document.querySelector('.mention-modal-overlay--visible');
        if (overlay) {
          content = overlay.querySelector('.mention-modal__content');
        }
      }
      
      // Si estamos en un modal, recargar el contenido del modal
      if (overlay && content) {
        log('🔄 Recargando contenido del modal...');
        await controller._reloadMentionModalContent(overlay, content);
        return;
      }
      
      // Intentar obtener la página actual del controller (solo Master GM)
      if (controller.currentPage && controller.currentPage.isNotionPage()) {
        const pageId = controller.currentPage.getNotionPageId();
        if (pageId) {
          // Limpiar caché de esta página
          controller.cacheService.clearPageCache(pageId);
          // Recargar
          await controller._renderNotionPage(controller.currentPage, pageId, true);
          return;
        }
      }
      
      // Fallback: recargar la página completa
      window.location.reload();
    };
  }

  /**
   * Carga HTML pre-renderizado en modo modal (no requiere token)
   * @private
   */
  async _loadHtmlContent(contentKey, name) {
    log('🪟 Modo HTML modal detectado, cargando desde sessionStorage:', contentKey);
    
    // Ocultar lista y mostrar contenedor de contenido
    const pageList = document.getElementById('page-list');
    const notionContainer = document.getElementById('notion-container');
    const header = document.getElementById('header');
    const backButton = document.getElementById('back-button');
    const pageTitle = document.getElementById('page-title');
    
    if (pageList) pageList.classList.add('hidden');
    if (notionContainer) notionContainer.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
    if (header) header.classList.add('hidden');
    if (pageTitle) pageTitle.textContent = name;
    
    this._setNotionDisplayMode('content');
    const notionContent = document.getElementById('notion-content');
    
    // Recuperar el HTML de sessionStorage
    const html = sessionStorage.getItem(contentKey);
    
    if (html && notionContent) {
      notionContent.innerHTML = html;
      
      // Remover botones de compartir (el player no debe verlos)
      notionContent.querySelectorAll('.share-button, .notion-image-share-button, .video-share-button').forEach(el => el.remove());
      
      // Limpiar el sessionStorage después de usar
      sessionStorage.removeItem(contentKey);
      log('✅ Contenido HTML cargado correctamente (botones de share removidos)');
    } else if (notionContent) {
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Content not found</p>
          <p class="empty-state-hint">The shared content may have expired</p>
        </div>
      `;
    }
  }

  /**
   * Carga contenido en modo modal
   * @private
   */
  async _loadModalContent(url, name, blockTypes = null) {
    log('🪟 Modo modal detectado, cargando:', url, blockTypes ? `con filtro: ${blockTypes}` : '');
    
    // Ocultar lista y mostrar contenedor de contenido
    const pageList = document.getElementById('page-list');
    const notionContainer = document.getElementById('notion-container');
    const header = document.getElementById('header');
    const backButton = document.getElementById('back-button');
    const pageTitle = document.getElementById('page-title');
    
    if (pageList) pageList.classList.add('hidden');
    if (notionContainer) notionContainer.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
    if (header) header.classList.add('hidden');
    if (pageTitle) pageTitle.textContent = name;
    
    // Crear un objeto Page temporal con blockTypes
    const page = new Page(name, url, { blockTypes });
    
    log('📄 Modal page info:', {
      url: page.url,
      name: page.name,
      isNotionPage: page.isNotionPage(),
      isDemoHtmlFile: page.isDemoHtmlFile(),
      pageId: page.getNotionPageId()
    });
    
    // Mostrar loading
    this._setNotionDisplayMode('content');
    const notionContent = document.getElementById('notion-content');
    if (notionContent) {
      notionContent.innerHTML = `
        <div class="empty-state notion-loading">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Loading content</p>
          <p class="empty-state-hint">Fetching data from Notion...</p>
        </div>
      `;
    }
    
    try {
      const pageId = page.getNotionPageId();
      
      if (page.isNotionPage() && pageId) {
        await this._renderNotionPage(page, pageId);
      } else if (page.isDemoHtmlFile()) {
        // Content-demo: cargar HTML estático con estilo Notion
        await this._renderDemoHtmlPage(page);
      } else if (page.isImage()) {
        await this._renderImagePage(page);
      } else if (page.isVideo()) {
        await this._renderVideoPage(page);
      } else if (page.isGoogleDoc()) {
        this._renderGoogleDocPage(page);
      } else {
        this._renderExternalPage(page);
      }
      
      this._attachImageHandlers();
    } catch (e) {
      logError('Error cargando contenido en modal:', e);
      if (notionContent) {
        notionContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <p class="empty-state-text">Error loading content</p>
            <p class="empty-state-hint">${e.message}</p>
          </div>
        `;
      }
    }
  }

  /**
   * Renderiza la interfaz
   */
  async render() {
    if (!this.pagesContainer || !this.config) return;

    log('🎨 Renderizando interfaz...');
    
    // Pasar la config al UIRenderer para calcular posiciones
    this.uiRenderer.setConfig(this.config);
    
    // Si playerViewMode está activo, simular vista de jugador (isGM: false)
    const viewOptions = this.playerViewMode 
      ? { isGM: false, isCoGM: false }
      : { isGM: this.isGM, isCoGM: this.isCoGM };
    
    this.uiRenderer.renderAllCategories(
      this.config,
      this.pagesContainer,
      this.roomId,
      viewOptions
    );

    // Actualizar clase del container
    this._updateContainerClass();
  }

  /**
   * Abre una página de contenido
   * @param {Object} page - Página a abrir
   */
  async openPage(pageData, categoryPath = [], pageIndex = 0) {
    if (!this.contentContainer) return;

    // Convertir objeto plano a instancia Page si es necesario
    const page = pageData instanceof Page ? pageData : Page.fromJSON(pageData);

    log('📖 Abriendo página:', page.name);
    log('📋 blockTypes de la página:', page.blockTypes);

    // Guardar referencia a la página actual
    this.currentPage = page;
    this.currentCategoryPath = categoryPath;
    this.currentPageIndex = pageIndex;

    // Track page view
    const pageType = page.hasEmbeddedHtml() ? 'embedded_html' :
                     page.isNotionPage() ? 'notion' : 
                     page.isImage() ? 'image' : 
                     page.isVideo() ? 'video' : 
                     page.isGoogleDoc() ? 'google_doc' : 'iframe';
    this.analyticsService.trackPageView(page.name, pageType);

    // Mostrar el contenedor de Notion y ocultar la lista
    const notionContainer = document.getElementById('notion-container');
    const pageList = document.getElementById('page-list');
    const backButton = document.getElementById('back-button');
    const pageTitle = document.getElementById('page-title');
    const buttonContainer = document.querySelector('.button-container');
    const playerViewToggle = document.querySelector('.player-view-toggle');
    
    if (notionContainer) notionContainer.classList.remove('hidden');
    if (pageList) pageList.classList.add('hidden');
    if (backButton) backButton.classList.remove('hidden');
    if (pageTitle) {
      // Añadir indicador de visibilidad si está compartida con players
      const visibilityIndicator = page.visibleToPlayers ? this._getVisibilityIndicator() : '';
      pageTitle.innerHTML = page.name + visibilityIndicator;
    }
    if (buttonContainer) buttonContainer.classList.add('hidden');
    if (playerViewToggle) playerViewToggle.classList.add('hidden');

    // Actualizar clase del container
    this._updateContainerClass();

    // Crear botones del header para la página de detalle
    this._createPageDetailButtons(page);

    // Mostrar loading - asegurar que notion-content sea visible
    this._setNotionDisplayMode('content');
    
    const notionContent = document.getElementById('notion-content');
    if (notionContent) {
      notionContent.className = 'notion-container__content notion-content';
      notionContent.innerHTML = `
        <div class="empty-state notion-loading">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Loading content</p>
          <p class="empty-state-hint">Fetching data from Notion...</p>
        </div>
      `;
    }

    try {
      const pageId = page.getNotionPageId();
      
      // Prioridad: htmlContent embebido (local-first) antes de cualquier URL
      if (page.hasEmbeddedHtml()) {
        await this._renderEmbeddedHtmlPage(page);
      } else if (page.isNotionPage() && pageId) {
        await this._renderNotionPage(page, pageId);
      } else if (page.isDemoHtmlFile()) {
        // Content-demo: cargar HTML estático con estilo Notion
        await this._renderDemoHtmlPage(page);
      } else if (page.isImage()) {
        await this._renderImagePage(page);
      } else if (page.isVideo()) {
        await this._renderVideoPage(page);
      } else if (page.isGoogleDoc()) {
        this._renderGoogleDocPage(page);
      } else {
        this._renderExternalPage(page);
      }

      // Después de renderizar, adjuntar handlers de imágenes
      this._attachImageHandlers();
    } catch (e) {
      logError('Error al abrir página:', e);
      if (notionContent) {
        notionContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <p class="empty-state-text">Error loading page</p>
            <p class="empty-state-hint">${e.message}</p>
          </div>
        `;
      }
    }
  }

  /**
   * Guarda la configuración actual
   * @param {Object} config - Configuración a guardar
   */
  async saveConfig(config) {
    log('💾 Guardando configuración...');

    // Parsear el config para convertir formato items[] a formato interno si es necesario
    const configJson = config.toJSON ? config.toJSON() : config;
    this.config = this.configParser.parse(configJson);
    this.configBuilder = new ConfigBuilder(this.config);

    // Guardar en localStorage (guardamos el JSON parseado con formato legacy + order)
    this.storageService.saveLocalConfig(this.config.toJSON ? this.config.toJSON() : this.config);

    // Si es Master GM, guardar en room metadata y broadcast
    if (this.isGM && !this.isCoGM) {
      const configToSave = this.config.toJSON ? this.config.toJSON() : this.config;
      await this.storageService.saveRoomConfig(configToSave);
      
      // Broadcast páginas visibles para Players
      const visibleConfig = filterVisiblePages(configToSave);
      this.broadcastService.broadcastVisiblePages(visibleConfig);
      
      // Broadcast vault completo para Co-GMs
      await this.broadcastService.sendMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, {
        config: configToSave
      });
      log('📤 Vault completo enviado a Co-GMs');
    }

    // Re-renderizar
    await this.render();
  }

  /**
   * Obtiene la configuración actual
   * @returns {Object}
   */
  getConfig() {
    return this.config;
  }

  /**
   * Limpia todo el room metadata relacionado con el vault
   * Útil para limpiar datos antiguos o cuando se migra a la nueva arquitectura
   * @returns {Promise<boolean>}
   */
  async clearRoomMetadata() {
    if (!this.isGM) {
      log('⚠️ Solo el GM puede limpiar room metadata');
      return false;
    }
    
    if (confirm('¿Limpiar todo el room metadata del vault? Esto eliminará:\n' +
                '- Configuración visible para players\n' +
                '- Configuración completa (si existe)\n' +
                '- Caché de contenido compartido\n\n' +
                'Tu configuración local (localStorage) NO se afectará.')) {
      const result = await this.storageService.clearRoomMetadata();
      if (result) {
        alert('✅ Room metadata limpiado correctamente');
        log('✅ Room metadata limpiado. La configuración sigue en localStorage.');
        this.analyticsService.trackCacheCleared();
      } else {
        alert('❌ Error al limpiar room metadata');
      }
      return result;
    }
    return false;
  }

  /**
   * Navega a una categoría siguiendo el path
   * Soporta tanto paths de strings (legacy) como objetos {id, name}
   * @param {Array} categoryPath - Ruta de categorías
   * @returns {Object|null} - Categoría encontrada o null
   * @private
   */
  _navigateToCategory(categoryPath) {
    let currentLevel = this.config;
    
    for (const pathItem of categoryPath) {
      // pathItem puede ser string (nombre) o objeto {id, name}
      const catId = typeof pathItem === 'object' ? pathItem.id : null;
      const catName = typeof pathItem === 'string' ? pathItem : pathItem.name;
      
      let cat = null;
      
      // Buscar por ID primero si está disponible
      if (catId) {
        cat = (currentLevel.categories || []).find(c => c.id === catId);
      }
      
      // Si no encontró por ID, buscar por nombre
      if (!cat) {
        cat = (currentLevel.categories || []).find(c => c.name === catName);
      }
      
      if (cat) {
        currentLevel = cat;
      } else {
        console.log('⚠️ _navigateToCategory: No encontrado -', { catId, catName });
        console.log('⚠️ Categorías disponibles:', (currentLevel.categories || []).map(c => ({ id: c.id, name: c.name })));
        return null;
      }
    }
    
    return currentLevel;
  }

  /**
   * Actualiza la visibilidad de una página
   * @param {Object} page - Página a actualizar
   * @param {Array} categoryPath - Ruta de categorías
   * @param {number} pageIndex - Índice de la página
   * @param {boolean} newVisibility - Nueva visibilidad
   * @private
   */
  async _updatePageVisibility(page, categoryPath, pageIndex, newVisibility) {
    if (!this.config || !this.isGM) return;

    log('👁️ Actualizando visibilidad de página:', page.name, '->', newVisibility);

    // Navegar a la categoría correcta
    const currentLevel = this._navigateToCategory(categoryPath);
    if (!currentLevel) return;

    // Encontrar y actualizar la página (por ID primero, luego por nombre)
    const pages = currentLevel.pages || [];
    let pageToUpdate = null;
    if (page.id) {
      pageToUpdate = pages.find(p => p.id === page.id);
    }
    if (!pageToUpdate) {
      pageToUpdate = pages.find(p => p.name === page.name);
    }
    
    if (pageToUpdate) {
      pageToUpdate.visibleToPlayers = newVisibility;
      await this.saveConfig(this.config);
      
      // Actualizar tokens vinculados a esta página
      await this._updateLinkedTokensVisibility(page.id, page.url, newVisibility);
    } else {
      logError('No se encontró la página:', page.name);
    }
  }
  
  /**
   * Actualiza la visibilidad en los tokens vinculados a una página
   * @private
   */
  async _updateLinkedTokensVisibility(pageId, pageUrl, newVisibility) {
    try {
      // Obtener todos los items de la escena
      const allItems = await this.OBR.scene.items.getItems();
      
      // Filtrar tokens que tienen esta página vinculada
      const linkedTokens = allItems.filter(item => {
        const tokenPageId = item.metadata?.[`${METADATA_KEY}/pageId`];
        const tokenPageUrl = item.metadata?.[`${METADATA_KEY}/pageUrl`];
        return (pageId && tokenPageId === pageId) || (pageUrl && tokenPageUrl === pageUrl);
      });
      
      if (linkedTokens.length > 0) {
        // Actualizar el metadata de visibilidad en todos los tokens vinculados
        await this.OBR.scene.items.updateItems(linkedTokens, (updateItems) => {
          updateItems.forEach(item => {
            item.metadata[`${METADATA_KEY}/pageVisible`] = newVisibility;
          });
        });
        log(`👁️ Actualizada visibilidad en ${linkedTokens.length} token(s) vinculados`);
      }
    } catch (error) {
      logError('Error actualizando tokens vinculados:', error);
    }
  }

  /**
   * Maneja cambio de visibilidad desde el UI
   * @private
   */
  async _handleVisibilityChange(page, categoryPath, pageIndex, visible) {
    await this._updatePageVisibility(page, categoryPath, pageIndex, visible);
    this.analyticsService.trackVisibilityToggle(page.name, visible);
  }

  /**
   * Maneja edición de página desde el UI
   * @private
   */
  async _handlePageEdit(page, categoryPath, pageIndex, newData) {
    if (!this.config || !this.isGM) return;

    log('✏️ Editando página:', page.name, '->', newData);

    // Navegar a la categoría correcta
    const currentLevel = this._navigateToCategory(categoryPath);
    if (!currentLevel) return;

    // Encontrar y actualizar la página (por ID primero, luego por nombre)
    const pages = currentLevel.pages || [];
    let pageToUpdate = null;
    if (page.id) {
      pageToUpdate = pages.find(p => p.id === page.id);
    }
    if (!pageToUpdate) {
      pageToUpdate = pages.find(p => p.name === page.name);
    }
    
    if (pageToUpdate) {
      // Actualizar todos los campos
      if (newData.name !== undefined) pageToUpdate.name = newData.name;
      if (newData.url !== undefined) pageToUpdate.url = newData.url;
      if (newData.blockTypes !== undefined) pageToUpdate.blockTypes = newData.blockTypes;
      if (newData.visibleToPlayers !== undefined) pageToUpdate.visibleToPlayers = newData.visibleToPlayers;
      if (newData.icon !== undefined) pageToUpdate.icon = newData.icon;
      if (newData.linkedTokenId !== undefined) pageToUpdate.linkedTokenId = newData.linkedTokenId;
      
      log('📝 Página actualizada con blockTypes:', pageToUpdate.blockTypes);
      
      await this.saveConfig(this.config);
      this.analyticsService.trackPageEdited(newData.name || page.name);
    } else {
      logError('No se encontró la página:', page.name);
    }
  }

  /**
   * Maneja eliminación de página desde el UI
   * @private
   */
  async _handlePageDelete(page, categoryPath, pageIndex) {
    if (!this.config || !this.isGM) return;

    console.log('🗑️ DELETE PAGE - Page:', page.name, 'ID:', page.id);
    console.log('🗑️ DELETE PAGE - Path:', categoryPath);

    // Navegar a la categoría correcta
    const currentLevel = this._navigateToCategory(categoryPath);
    if (!currentLevel) {
      console.log('🗑️ DELETE PAGE - No se pudo navegar al path');
      return;
    }

    // Encontrar y eliminar la página
    const pages = currentLevel.pages || [];
    
    // Buscar por ID primero, luego por nombre
    let pageIndexInArray = -1;
    if (page.id) {
      pageIndexInArray = pages.findIndex(p => p.id === page.id);
      console.log('🗑️ DELETE PAGE - Buscando por ID:', page.id, '-> índice:', pageIndexInArray);
    }
    if (pageIndexInArray < 0) {
      pageIndexInArray = pages.findIndex(p => p.name === page.name);
      console.log('🗑️ DELETE PAGE - Buscando por nombre:', page.name, '-> índice:', pageIndexInArray);
    }
    
    console.log('🗑️ DELETE PAGE - Todas las páginas:', pages.map(p => ({ id: p.id, name: p.name })));
    
    if (pageIndexInArray !== -1) {
      console.log('🗑️ DELETE PAGE - Eliminando índice:', pageIndexInArray);
      pages.splice(pageIndexInArray, 1);
      
      // Actualizar el order para eliminar la referencia y reajustar índices
      if (currentLevel.order) {
        currentLevel.order = currentLevel.order.filter(o => !(o.type === 'page' && o.index === pageIndexInArray));
        currentLevel.order = currentLevel.order.map(o => {
          if (o.type === 'page' && o.index > pageIndexInArray) {
            return { ...o, index: o.index - 1 };
          }
          return o;
        });
      }
      
      await this.saveConfig(this.config);
      this.analyticsService.trackPageDeleted(page.name);
    } else {
      console.log('🗑️ DELETE PAGE - NO ENCONTRADO!');
    }
  }

  /**
   * Obtiene el orden combinado de elementos en un nivel
   * @param {Object} parent - El nivel (config o categoría)
   * @returns {Array} Array de {type: 'category'|'page', index: number}
   * @private
   */
  _getCombinedOrder(parent) {
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
      
      pages.forEach((p, index) => {
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
    
    pages.forEach((p, index) => {
      order.push({ type: 'page', index });
    });
    
    return order;
  }

  /**
   * Maneja el movimiento de una página usando orden combinado
   * @param {Object} page - Página a mover
   * @param {Array} categoryPath - Ruta de categorías
   * @param {number} pageIndex - Índice de la página
   * @param {string} direction - 'up' o 'down'
   * @private
   */
  async _handlePageMove(page, categoryPath, pageIndex, direction) {
    if (!this.config || !this.isGM) return;

    log(`↕️ Moviendo página ${direction}:`, page.name, 'categoryPath:', categoryPath);

    // Navegar a la categoría correcta
    const currentLevel = this._navigateToCategory(categoryPath);
    if (!currentLevel) return;

    const pages = currentLevel.pages || [];
    const categories = currentLevel.categories || [];
    
    // Buscar por ID primero, luego por nombre
    let actualPageIndex = -1;
    if (page.id) {
      actualPageIndex = pages.findIndex(p => p.id === page.id);
    }
    if (actualPageIndex < 0) {
      actualPageIndex = pages.findIndex(p => p.name === page.name);
    }
    
    log('📊 Estado actual:');
    log('  - Páginas:', pages.map(p => p.name));
    log('  - Categorías:', categories.map(c => c.name));
    log('  - Orden existente:', currentLevel.order);
    log('  - Página a mover:', page.name, 'índice:', actualPageIndex);
    
    if (actualPageIndex === -1) {
      logError('No se encontró la página:', page.name);
      return;
    }

    // Obtener orden combinado
    const combinedOrder = this._getCombinedOrder(currentLevel);
    log('  - Orden combinado antes:', JSON.stringify(combinedOrder));
    
    const currentPos = combinedOrder.findIndex(o => o.type === 'page' && o.index === actualPageIndex);
    
    if (currentPos === -1) {
      logError('No se encontró la página en el orden combinado');
      log('  - Buscando: type=page, index=', actualPageIndex);
      return;
    }

    // Calcular nueva posición
    const newPos = direction === 'up' ? currentPos - 1 : currentPos + 1;
    log('  - Posición actual:', currentPos, '-> Nueva posición:', newPos);

    // Verificar límites
    if (newPos < 0 || newPos >= combinedOrder.length) {
      log('No se puede mover más en esa dirección');
      return;
    }

    // Intercambiar posiciones en el orden combinado
    const temp = combinedOrder[currentPos];
    combinedOrder[currentPos] = combinedOrder[newPos];
    combinedOrder[newPos] = temp;
    
    log('  - Orden combinado después:', JSON.stringify(combinedOrder));

    // Guardar el nuevo orden
    currentLevel.order = combinedOrder;
    
    await this.saveConfig(this.config);
    this.analyticsService.trackPageMoved(page.name, direction);
    log('✅ Orden guardado');
  }

  /**
   * Maneja duplicar una página
   * @private
   */
  async _handlePageDuplicate(page, categoryPath, pageIndex) {
    if (!this.config || !this.isGM) return;

    log('📋 Duplicando página:', page.name);

    const currentLevel = this._navigateToCategory(categoryPath);
    if (!currentLevel) return;

    const pages = currentLevel.pages || [];
    
    // Encontrar el índice real de la página (por ID primero)
    let actualIndex = pageIndex;
    if (page.id) {
      const foundIndex = pages.findIndex(p => p.id === page.id);
      if (foundIndex >= 0) actualIndex = foundIndex;
    }
    
    // Crear una copia usando Page.clone() o Page.fromJSON() (genera nuevo ID)
    let duplicatedPage;
    if (page.clone && typeof page.clone === 'function') {
      duplicatedPage = page.clone(false); // false = generar nuevo ID
    } else {
      duplicatedPage = Page.fromJSON(page);
    }
    duplicatedPage.name = `${page.name} (copy)`;
    
    // El nuevo índice será al final del array
    const newIndex = pages.length;
    
    // Agregar al final del array
    pages.push(duplicatedPage);
    
    // Actualizar el order para insertar justo después del original
    if (!currentLevel.order) {
      // Generar order por defecto si no existe
      currentLevel.order = [];
      (currentLevel.categories || []).forEach((_, idx) => {
        currentLevel.order.push({ type: 'category', index: idx });
      });
      pages.forEach((_, idx) => {
        if (idx !== newIndex) { // No agregar el nuevo aún
          currentLevel.order.push({ type: 'page', index: idx });
        }
      });
    }
    
    // Encontrar posición del original en el order e insertar después
    const posInOrder = currentLevel.order.findIndex(o => o.type === 'page' && o.index === actualIndex);
    if (posInOrder !== -1) {
      currentLevel.order.splice(posInOrder + 1, 0, { type: 'page', index: newIndex });
    } else {
      currentLevel.order.push({ type: 'page', index: newIndex });
    }
    
    await this.saveConfig(this.config);
  }

  /**
   * Obtiene las opciones de carpetas para el selector
   * @param {string[]} excludePath - Path a excluir (para evitar mover a sí mismo o subcarpetas)
   * @returns {Array<{value: string, label: string}>}
   * @private
   */
  _getFolderOptions(excludePath = []) {
    const options = [{ value: '', label: '/ (Root)' }];
    const excludePathStr = excludePath.join('/');

    const addFolders = (categories, path = []) => {
      if (!categories) return;
      
      for (const cat of categories) {
        const currentPath = [...path, cat.name];
        const currentPathStr = currentPath.join('/');
        
        // Excluir la carpeta actual y sus subcarpetas
        if (excludePathStr && (currentPathStr === excludePathStr || currentPathStr.startsWith(excludePathStr + '/'))) {
          continue;
        }
        
        // Usar non-breaking spaces (\u00A0) para indentación visible en <select>
        const indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(path.length);
        const prefix = path.length > 0 ? '└─ ' : '';
        options.push({
          value: currentPath.join('/'),
          label: `${indent}${prefix}📁 ${cat.name}`
        });
        
        // Recursivamente agregar subcarpetas
        if (cat.categories && cat.categories.length > 0) {
          addFolders(cat.categories, currentPath);
        }
      }
    };

    if (this.config && this.config.categories) {
      addFolders(this.config.categories);
    }

    return options;
  }

  /**
   * Mueve un elemento (página o categoría) a una nueva carpeta
   * @param {Object} item - El elemento a mover
   * @param {string[]} fromPath - Path actual del elemento
   * @param {string} toPathStr - Nuevo path como string (e.g., "Folder1/Subfolder")
   * @param {string} type - 'page' o 'category'
   * @private
   */
  async _moveItemToFolder(item, fromPath, toPathStr, type) {
    const toPath = toPathStr ? toPathStr.split('/') : [];
    
    // Obtener el nivel de origen (padre actual)
    // Para fromPath, usar _navigateToCategory que soporta IDs
    const pathLength = type === 'category' ? fromPath.length - 1 : fromPath.length;
    const fromPathSlice = fromPath.slice(0, pathLength);
    const fromLevel = fromPathSlice.length > 0 
      ? this._navigateToCategory(fromPathSlice) 
      : this.config;
    
    if (!fromLevel) {
      console.log('⚠️ _moveItemToFolder: No se encontró nivel origen');
      return false;
    }

    // Obtener el nivel de destino (toPath es un array de nombres string)
    let toLevel = this.config;
    for (const catName of toPath) {
      const cat = (toLevel.categories || []).find(c => c.name === catName);
      if (cat) toLevel = cat;
      else return false;
    }

    // Remover del origen (buscar por ID primero)
    if (type === 'page') {
      const pages = fromLevel.pages || [];
      let pageIndex = -1;
      if (item.id) {
        pageIndex = pages.findIndex(p => p.id === item.id);
      }
      if (pageIndex < 0) {
        pageIndex = pages.findIndex(p => p.name === item.name && p.url === item.url);
      }
      if (pageIndex === -1) return false;
      pages.splice(pageIndex, 1);
    } else {
      const categories = fromLevel.categories || [];
      let catIndex = -1;
      if (item.id) {
        catIndex = categories.findIndex(c => c.id === item.id);
      }
      if (catIndex < 0) {
        catIndex = categories.findIndex(c => c.name === item.name);
      }
      if (catIndex === -1) return false;
      categories.splice(catIndex, 1);
    }

    // Agregar al destino
    if (type === 'page') {
      if (!toLevel.pages) toLevel.pages = [];
      toLevel.pages.push(item);
    } else {
      if (!toLevel.categories) toLevel.categories = [];
      toLevel.categories.push(item);
    }

    await this.saveConfig(this.config);
    return true;
  }

  /**
   * Maneja editar una categoría
   * @private
   */
  _handleCategoryEdit(category, categoryPath) {
    // Calcular el path actual de la carpeta (sin incluirse a sí misma)
    const currentFolderPath = categoryPath.slice(0, -1);
    const currentFolderPathStr = currentFolderPath.join('/');
    
    // Obtener opciones de carpetas, excluyendo esta carpeta y sus subcarpetas
    const folderOptions = this._getFolderOptions(categoryPath);
    
    // Asegurarse de que el valor coincida exactamente con una opción disponible
    let folderValue = currentFolderPathStr;
    const matchingOption = folderOptions.find(opt => opt.value === currentFolderPathStr);
    if (!matchingOption && folderOptions.length > 0) {
      // Si no se encuentra, usar la primera opción (root) como fallback
      folderValue = folderOptions[0].value;
    }

    this._showModalForm('Edit Folder', [
      { name: 'name', label: 'Name', type: 'text', value: category.name, required: true },
      { name: 'folder', label: 'Parent Folder', type: 'select', value: folderValue, options: folderOptions }
    ], async (data) => {
      const nameChanged = data.name && data.name !== category.name;
      const folderChanged = data.folder !== currentFolderPathStr;
      
      if (!nameChanged && !folderChanged) return;
      
      // Primero mover si cambió la carpeta
      if (folderChanged) {
        // Actualizar nombre antes de mover si cambió
        if (nameChanged) {
          category.name = data.name;
        }
        await this._moveItemToFolder(category, categoryPath, data.folder, 'category');
      } else if (nameChanged) {
        // Solo cambió el nombre
        const parentPath = categoryPath.slice(0, -1);
        const currentLevel = parentPath.length > 0 
          ? this._navigateToCategory(parentPath) 
          : this.config;
        
        if (!currentLevel) return;

        // Buscar por ID primero
        let catIndex = -1;
        if (category.id) {
          catIndex = (currentLevel.categories || []).findIndex(c => c.id === category.id);
        }
        if (catIndex < 0) {
          catIndex = (currentLevel.categories || []).findIndex(c => c.name === category.name);
        }
        
        if (catIndex !== -1) {
          currentLevel.categories[catIndex].name = data.name;
          await this.saveConfig(this.config);
          this.analyticsService.trackFolderEdited(category.name, data.name);
        }
      }
    });
  }

  /**
   * Maneja eliminar una categoría
   * @private
   */
  async _handleCategoryDelete(category, categoryPath) {
    if (!this.config || !this.isGM) return;

    console.log('🗑️ DELETE - Category:', category.name, 'ID:', category.id);
    console.log('🗑️ DELETE - Path:', categoryPath);

    // Navegar al nivel padre (path sin el último elemento)
    const parentPath = categoryPath.slice(0, -1);
    const currentLevel = parentPath.length > 0 
      ? this._navigateToCategory(parentPath) 
      : this.config;
    
    if (!currentLevel) {
      console.log('🗑️ DELETE - No se pudo navegar al path padre');
      return;
    }

    const categories = currentLevel.categories || [];
    
    // Buscar por ID primero, luego por nombre
    let catIndex = -1;
    if (category.id) {
      catIndex = categories.findIndex(c => c.id === category.id);
      console.log('🗑️ DELETE - Buscando por ID:', category.id, '-> índice:', catIndex);
    }
    if (catIndex < 0) {
      catIndex = categories.findIndex(c => c.name === category.name);
      console.log('🗑️ DELETE - Buscando por nombre:', category.name, '-> índice:', catIndex);
    }
    
    console.log('🗑️ DELETE - Todas las categorías:', categories.map(c => ({ id: c.id, name: c.name })));
    
    if (catIndex !== -1) {
      console.log('🗑️ DELETE - Eliminando índice:', catIndex);
      categories.splice(catIndex, 1);
      
      // Actualizar el order para eliminar la referencia y reajustar índices
      if (currentLevel.order) {
        currentLevel.order = currentLevel.order.filter(o => !(o.type === 'category' && o.index === catIndex));
        currentLevel.order = currentLevel.order.map(o => {
          if (o.type === 'category' && o.index > catIndex) {
            return { ...o, index: o.index - 1 };
          }
          return o;
        });
      }
      
      await this.saveConfig(this.config);
      this.analyticsService.trackFolderDeleted(category.name);
    } else {
      console.log('🗑️ DELETE - NO ENCONTRADO!');
    }
  }

  /**
   * Maneja mover una categoría usando orden combinado
   * @private
   */
  async _handleCategoryMove(category, categoryPath, direction) {
    if (!this.config || !this.isGM) return;

    log(`↕️ Moviendo carpeta ${direction}:`, category.name, 'categoryPath:', categoryPath);

    // Navegar al nivel padre (path sin el último elemento)
    const parentPath = categoryPath.slice(0, -1);
    const currentLevel = parentPath.length > 0 
      ? this._navigateToCategory(parentPath) 
      : this.config;
    
    if (!currentLevel) {
      logError('No se encontró el nivel padre');
      return;
    }

    const categories = currentLevel.categories || [];
    const pages = currentLevel.pages || [];
    const actualCategoryIndex = categories.findIndex(c => c.name === category.name);
    
    log('📊 Estado actual:');
    log('  - Categorías:', categories.map(c => c.name));
    log('  - Páginas:', pages.map(p => p.name));
    log('  - Orden existente:', currentLevel.order);
    log('  - Carpeta a mover:', category.name, 'índice:', actualCategoryIndex);
    
    if (actualCategoryIndex === -1) {
      logError('No se encontró la categoría:', category.name);
      return;
    }

    // Obtener orden combinado
    const combinedOrder = this._getCombinedOrder(currentLevel);
    log('  - Orden combinado antes:', JSON.stringify(combinedOrder));
    
    const currentPos = combinedOrder.findIndex(o => o.type === 'category' && o.index === actualCategoryIndex);
    
    if (currentPos === -1) {
      logError('No se encontró la categoría en el orden combinado');
      log('  - Buscando: type=category, index=', actualCategoryIndex);
      return;
    }

    // Calcular nueva posición
    const newPos = direction === 'up' ? currentPos - 1 : currentPos + 1;
    log('  - Posición actual:', currentPos, '-> Nueva posición:', newPos);

    // Verificar límites
    if (newPos < 0 || newPos >= combinedOrder.length) {
      log('No se puede mover más en esa dirección');
      return;
    }

    // Intercambiar posiciones en el orden combinado
    const temp = combinedOrder[currentPos];
    combinedOrder[currentPos] = combinedOrder[newPos];
    combinedOrder[newPos] = temp;
    
    log('  - Orden combinado después:', JSON.stringify(combinedOrder));

    // Guardar el nuevo orden
    currentLevel.order = combinedOrder;

    await this.saveConfig(this.config);
    log('✅ Orden guardado');
  }

  /**
   * Maneja duplicar una categoría
   * @private
   */
  async _handleCategoryDuplicate(category, categoryPath) {
    if (!this.config || !this.isGM) return;

    log('📋 Duplicando carpeta:', category.name);

    // Navegar al nivel padre (path sin el último elemento)
    const parentPath = categoryPath.slice(0, -1);
    const currentLevel = parentPath.length > 0 
      ? this._navigateToCategory(parentPath) 
      : this.config;
    
    if (!currentLevel) return;

    const categories = currentLevel.categories || [];
    
    // Buscar por ID primero
    let catIndex = -1;
    if (category.id) {
      catIndex = categories.findIndex(c => c.id === category.id);
    }
    if (catIndex < 0) {
      catIndex = categories.findIndex(c => c.name === category.name);
    }
    
    if (catIndex !== -1) {
      // Crear una copia usando Category.clone() o Category.fromJSON()
      let duplicated;
      if (category.clone && typeof category.clone === 'function') {
        duplicated = category.clone();
      } else {
        duplicated = Category.fromJSON(category);
      }
      duplicated.name = `${category.name} (copy)`;
      
      // El nuevo índice será al final del array
      const newIndex = categories.length;
      
      // Agregar al final del array
      categories.push(duplicated);
      
      // Actualizar el order para insertar justo después del original
      if (!currentLevel.order) {
        // Generar order por defecto si no existe
        currentLevel.order = [];
        categories.forEach((_, idx) => {
          if (idx !== newIndex) { // No agregar el nuevo aún
            currentLevel.order.push({ type: 'category', index: idx });
          }
        });
        (currentLevel.pages || []).forEach((_, idx) => {
          currentLevel.order.push({ type: 'page', index: idx });
        });
      }
      
      // Encontrar posición del original en el order e insertar después
      const posInOrder = currentLevel.order.findIndex(o => o.type === 'category' && o.index === catIndex);
      if (posInOrder !== -1) {
        currentLevel.order.splice(posInOrder + 1, 0, { type: 'category', index: newIndex });
      } else {
        currentLevel.order.push({ type: 'category', index: newIndex });
      }
      
      await this.saveConfig(this.config);
    }
  }

  /**
   * Maneja agregar una página
   * @private
   */
  _handleAddPage(categoryPath, roomId) {
    console.log('📄 ADD PAGE - categoryPath:', categoryPath);
    
    this._showModalForm('Add Page', [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
      { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: false }
    ], async (data) => {
      if (!data.name || !data.url) return;

      const currentLevel = this._navigateToCategory(categoryPath);
      if (!currentLevel) {
        console.log('📄 ADD PAGE - No se pudo navegar al path');
        return;
      }

      if (!currentLevel.pages) currentLevel.pages = [];
      
      console.log('📄 ADD PAGE - Nivel destino:', currentLevel.name, 'ID:', currentLevel.id);
      
      // Crear instancia de Page con todos los campos (genera ID automático)
      const newPage = new Page(data.name, data.url, {
        visibleToPlayers: data.visibleToPlayers || false,
        blockTypes: null,
        icon: null,
        linkedTokenId: null
      });
      
      console.log('📄 ADD PAGE - Nueva página:', newPage.name, 'ID:', newPage.id);
      
      // Obtener el nuevo índice antes de agregar
      const newIndex = currentLevel.pages.length;
      currentLevel.pages.push(newPage);
      
      // Actualizar el order para incluir la nueva página al final
      if (!currentLevel.order) {
        currentLevel.order = [];
        (currentLevel.categories || []).forEach((_, idx) => {
          currentLevel.order.push({ type: 'category', index: idx });
        });
      }
      currentLevel.order.push({ type: 'page', index: newIndex });
      
      await this.saveConfig(this.config);
    });
  }

  /**
   * Maneja agregar una categoría
   * @private
   */
  _handleAddCategory(categoryPath, roomId) {
    this._showModalForm('Add Folder', [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Folder name' }
    ], async (data) => {
      if (!data.name) return;

      const currentLevel = this._navigateToCategory(categoryPath);
      if (!currentLevel) return;

      if (!currentLevel.categories) currentLevel.categories = [];
      
      // Crear instancia de Category (genera ID automático)
      const newCategory = new Category(data.name, {
        pages: [],
        categories: [],
        collapsed: false
      });
      
      console.log('📁 ADD CATEGORY - Nueva carpeta:', newCategory.name, 'ID:', newCategory.id);
      
      // Obtener el nuevo índice antes de agregar
      const newIndex = currentLevel.categories.length;
      currentLevel.categories.push(newCategory);
      
      // Actualizar el order para incluir la nueva carpeta al final
      if (!currentLevel.order) {
        currentLevel.order = [];
        // Primero agregar las categorías existentes (sin la nueva)
        for (let i = 0; i < newIndex; i++) {
          currentLevel.order.push({ type: 'category', index: i });
        }
        // Luego las páginas
        (currentLevel.pages || []).forEach((_, idx) => {
          currentLevel.order.push({ type: 'page', index: idx });
        });
      }
      currentLevel.order.push({ type: 'category', index: newIndex });
      
      await this.saveConfig(this.config);
    });
  }

  /**
   * Muestra un formulario modal
   * @param {string} title - Título del modal
   * @param {Array} fields - Campos del formulario
   * @param {Function} onSubmit - Callback al enviar
   * @private
   */
  _showModalForm(title, fields, onSubmit, onCancel = null) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal';

    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'modal__content';

    // Generar HTML del formulario
    const fieldsHtml = fields.map(field => {
      if (field.type === 'checkbox') {
        return `
          <div class="form__field" data-field-name="${field.name}">
            <label class="form__checkbox-label">
              <input 
                type="checkbox" 
                id="field-${field.name}" 
                name="${field.name}"
                class="checkbox"
                ${field.value ? 'checked' : ''}
              />
              <span>${field.label}</span>
            </label>
          </div>
        `;
      } else if (field.type === 'select') {
        return `
          <div class="form__field" data-field-name="${field.name}">
            <label class="form__label">${field.label}${field.required ? ' *' : ''}</label>
            <select 
              id="field-${field.name}" 
              name="${field.name}"
              class="select"
              ${field.required ? 'required' : ''}
            >
              ${(field.options || []).map(opt => 
                `<option value="${opt.value}" ${field.value === opt.value ? 'selected' : ''}>${opt.label}</option>`
              ).join('')}
            </select>
          </div>
        `;
      } else if (field.type === 'textarea') {
        return `
          <div class="form__field" data-field-name="${field.name}">
            <label class="form__label">${field.label}${field.required ? ' *' : ''}</label>
            <textarea 
              id="field-${field.name}" 
              name="${field.name}"
              class="textarea"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
            >${field.value || ''}</textarea>
          </div>
        `;
      } else {
        return `
          <div class="form__field" data-field-name="${field.name}">
            <label class="form__label">${field.label}${field.required ? ' *' : ''}</label>
            <input 
              type="${field.type || 'text'}" 
              id="field-${field.name}" 
              name="${field.name}"
              class="input"
              ${field.required ? 'required' : ''}
              placeholder="${field.placeholder || ''}"
              value="${field.value || ''}"
            />
          </div>
        `;
      }
    }).join('');

    modal.innerHTML = `
      <h2 class="modal__title">${title}</h2>
      <form id="modal-form" class="form">
        ${fieldsHtml}
        <div class="form__actions">
          <button type="button" id="modal-cancel" class="btn btn--ghost btn--flex">Cancel</button>
          <button type="submit" id="modal-submit" class="btn btn--primary btn--flex">Save</button>
        </div>
      </form>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const form = modal.querySelector('#modal-form');
    const cancelBtn = modal.querySelector('#modal-cancel');

    const close = () => {
      overlay.remove();
      if (onCancel) onCancel();
    };

    // Cerrar al hacer click fuera
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    cancelBtn.addEventListener('click', close);

    // Manejar submit
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = {};
      fields.forEach(field => {
        const input = modal.querySelector(`#field-${field.name}`);
        if (input) {
          if (field.type === 'checkbox') {
            formData[field.name] = input.checked;
          } else {
            formData[field.name] = input.value.trim();
          }
        }
      });
      
      overlay.remove();
      if (onSubmit) onSubmit(formData);
    });

    // Focus en primer campo
    const firstInput = modal.querySelector('input[type="text"], input[type="url"], textarea');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  /**
   * Actualiza la clase del container según el contenedor visible
   * @private
   */
  _updateContainerClass() {
    const container = document.querySelector('.container');
    if (!container) return;

    // Remover clases previas
    container.classList.remove('page-list', 'notion-container', 'settings-container');

    // Determinar qué contenedor está visible
    const pageList = document.getElementById('page-list');
    const notionContainer = document.getElementById('notion-container');
    const settingsContainer = document.getElementById('settings-container');

    if (settingsContainer && !settingsContainer.classList.contains('hidden')) {
      container.classList.add('settings-container');
    } else if (notionContainer && !notionContainer.classList.contains('hidden')) {
      container.classList.add('notion-container');
    } else if (pageList && !pageList.classList.contains('hidden')) {
      container.classList.add('page-list');
    }
  }

  /**
   * Limpia recursos al cerrar
   */
  cleanup() {
    log('🧹 Limpiando recursos...');
    
    // Detener intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.roleCheckInterval) {
      clearInterval(this.roleCheckInterval);
      this.roleCheckInterval = null;
    }
    
    // Limpiar broadcast
    this.broadcastService.cleanup();
    
    log('✅ Recursos limpiados');
  }

  // ============================================
  // MÉTODOS PRIVADOS - SETUP
  // ============================================

  /**
   * Configura los servicios
   * @private
   */
  _setupServices() {
    // Cache Service
    this.cacheService.setOBR(this.OBR);
    this.cacheService.setStorageLimitCallback((action) => {
      this.modalManager.showAlert({
        title: 'Storage Limit',
        message: `Storage limit reached while ${action}. Some data may not be saved.`,
        type: 'warning'
      });
      this.analyticsService.trackStorageLimitReached('cache: ' + action);
    });

    // Storage Service
    this.storageService.setOBR(this.OBR);
    this.storageService.setStorageLimitCallback((action) => {
      this.modalManager.showAlert({
        title: 'Storage Limit',
        message: `Storage limit reached while ${action}.`,
        type: 'warning'
      });
      this.analyticsService.trackStorageLimitReached('storage: ' + action);
    });

    // Notion Service
    this.notionService.setDependencies({
      OBR: this.OBR,
      cacheService: this.cacheService,
      storageService: this.storageService
    });

    // Broadcast Service
    this.broadcastService.setDependencies({
      OBR: this.OBR,
      cacheService: this.cacheService
    });
    this.broadcastService.setSizeLimitCallback((channel, estimatedKB) => {
      this._showFeedback(`❌ Content too large to share (${estimatedKB} KB > 64 KB limit)`);
      this.analyticsService.trackContentTooLarge(estimatedKB * 1024, channel);
    });

    // Analytics Service
    this.analyticsService.setOBR(this.OBR);
    // Iniciar analytics (mostrará banner de cookies si es necesario)
    this.analyticsService.init();

    // Notion Renderer - config se actualizará después de cargarlo
    this.notionRenderer.setDependencies({
      notionService: this.notionService,
      isGM: this.isGM,
      isCoGM: this.isCoGM,
      isPageVisibleCallback: (page) => page?.visibleToPlayers === true
    });

    // UI Renderer
    this.uiRenderer.setDependencies({
      storageService: this.storageService,
      notionService: this.notionService
    });


    // Image Cache Service - inicializar en background
    this.imageCacheService.init().then(() => {
      // Precargar iconos de la app
      const appIcons = [
        'img/icon-add.svg',
        'img/icon-arrow.svg',
        'img/icon-edit.svg',
        'img/icon-delete.svg',
        'img/icon-eye-open.svg',
        'img/icon-eye-close.svg',
        'img/icon-collapse-true.svg',
        'img/icon-collapse-false.svg',
        'img/folder-open.svg',
        'img/folder-close.svg',
        'img/icon-notion.svg',
        'img/icon-page.svg',
        'img/icon-image.svg',
        'img/icon-pdf.svg',
        'img/icon-youtube.svg',
        'img/icon-link.svg'
      ].map(icon => new URL(icon, window.location.origin).href);
      
      this.imageCacheService.preloadImages(appIcons);
    });
  }

  /**
   * Configura la UI
   * @private
   */
  _setupUI(options) {
    // Contenedores DOM
    this.pagesContainer = options.pagesContainer 
      ? (typeof options.pagesContainer === 'string' 
        ? document.querySelector(options.pagesContainer) 
        : options.pagesContainer)
      : document.getElementById('page-list');
    
    this.contentContainer = options.contentContainer
      ? (typeof options.contentContainer === 'string'
        ? document.querySelector(options.contentContainer)
        : options.contentContainer)
      : document.getElementById('content-area');

    // Modal Manager
    this.modalManager.init(document.body);

    // Configurar botón back
    this._setupBackButton();
    
    // Crear botones del header
    this._createHeaderButtons();
  }

  /**
   * Configura el botón de volver
   * @private
   */
  _setupBackButton() {
    const backButton = document.getElementById('back-button');
    if (!backButton || backButton.dataset.listenerAdded) return;

    backButton.addEventListener('click', () => {
      this._goBackToList();
    });
    backButton.dataset.listenerAdded = 'true';
  }

  /**
   * Vuelve a la lista de páginas
   * @private
   */
  _goBackToList() {
    const settingsContainer = document.getElementById('settings-container');
    const notionContainer = document.getElementById('notion-container');
    const pageList = document.getElementById('page-list');
    const pageTitle = document.getElementById('page-title');
    const backButton = document.getElementById('back-button');
    const notionContent = document.getElementById('notion-content');
    const notionIframe = document.getElementById('notion-iframe');
    const buttonContainer = document.querySelector('.button-container');

    const isSettingsVisible = settingsContainer && !settingsContainer.classList.contains('hidden');
    const isNotionContainerVisible = notionContainer && !notionContainer.classList.contains('hidden');

    if (isSettingsVisible) {
      // Cerrar settings
      settingsContainer.classList.add('hidden');
    } else if (isNotionContainerVisible) {
      // Volver a la lista desde notion-container
      notionContainer.classList.add('hidden');
      notionContainer.classList.remove('show-content');
      
      if (notionContent) {
        notionContent.innerHTML = '';
        notionContent.style.removeProperty('display');
        notionContent.style.removeProperty('visibility');
      }
      // Limpiar iframe
      if (notionIframe) {
        notionIframe.src = 'about:blank';
        notionIframe.style.removeProperty('display');
        notionIframe.style.removeProperty('visibility');
      }
    }

    // Restaurar vista principal
    if (pageList) pageList.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
    if (pageTitle) pageTitle.textContent = 'GM vault';
    if (buttonContainer) buttonContainer.classList.remove('hidden');
    
    // Mostrar toggle de player view (solo si es GM)
    const playerViewToggle = document.querySelector('.player-view-toggle');
    if (playerViewToggle && this.isGM) playerViewToggle.classList.remove('hidden');

    // Actualizar clase del container
    this._updateContainerClass();

    // Ocultar botones de página de detalle
    this._hidePageDetailButtons();

    // Limpiar referencia a página actual
    this.currentPage = null;
  }

  /**
   * Crea los botones del header para la página de detalle
   * @param {Page} page - La página actual
   * @private
   */
  _createPageDetailButtons(page) {
    const header = document.getElementById('header');
    if (!header) return;

    // Ocultar botones anteriores primero
    this._hidePageDetailButtons();

    // Solo crear botones si no estamos en modo modal
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('modal') === 'true') return;

    // Asegurar que tenemos una instancia de Page
    const pageInstance = page instanceof Page ? page : Page.fromJSON(page);
    
    // Guardar referencia a la página actual para share
    this.currentPageForShare = pageInstance;

    // Botón Open Modal (para todos)
    let openModalBtn = document.getElementById('page-open-modal-button-header');
    if (!openModalBtn) {
      openModalBtn = document.createElement('button');
      openModalBtn.id = 'page-open-modal-button-header';
      openModalBtn.className = 'icon-button';
      openModalBtn.innerHTML = '<img src="img/open-modal.svg" class="icon-button-icon" alt="Open modal" />';
      openModalBtn.title = 'Open in modal';
      header.appendChild(openModalBtn);
    }
    openModalBtn.classList.remove('hidden');
    openModalBtn.dataset.currentUrl = pageInstance.url || '';
    openModalBtn.dataset.currentName = pageInstance.name;
    
    // Remover listener anterior y agregar nuevo
    const newOpenModalBtn = openModalBtn.cloneNode(true);
    openModalBtn.parentNode.replaceChild(newOpenModalBtn, openModalBtn);
    newOpenModalBtn.addEventListener('click', () => this._openPageInModal(pageInstance));

    // Botón de Share (para todos: GM, coGM y Player) - NO para imágenes
    if (!pageInstance.isImage()) {
      let shareBtn = document.getElementById('page-share-button-header');
      if (!shareBtn) {
        shareBtn = document.createElement('button');
        shareBtn.id = 'page-share-button-header';
        shareBtn.className = 'icon-button';
        shareBtn.innerHTML = '<img src="img/icon-players.svg" class="icon-button-icon" alt="Share" />';
        shareBtn.title = 'Share with players';
        header.appendChild(shareBtn);
      }
      shareBtn.classList.remove('hidden');
      
      // Remover listener anterior y agregar nuevo
      const newShareBtn = shareBtn.cloneNode(true);
      shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
      newShareBtn.addEventListener('click', () => this._shareCurrentPageToPlayers(pageInstance));
    }

    // Botones solo para Master GM (no Co-GM)
    if (this.isGM && !this.isCoGM) {
      // Botón de Visibilidad
      let visibilityBtn = document.getElementById('page-visibility-button-header');
      if (!visibilityBtn) {
        visibilityBtn = document.createElement('button');
        visibilityBtn.id = 'page-visibility-button-header';
        visibilityBtn.className = 'icon-button';
        header.appendChild(visibilityBtn);
      }
      visibilityBtn.classList.remove('hidden');
      const isVisible = page.visibleToPlayers === true;
      visibilityBtn.innerHTML = `<img src="img/${isVisible ? 'icon-eye-open' : 'icon-eye-close'}.svg" class="icon-button-icon" alt="Visibility" />`;
      visibilityBtn.title = isVisible ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
      
      // Remover listener anterior y agregar nuevo
      const newVisibilityBtn = visibilityBtn.cloneNode(true);
      visibilityBtn.parentNode.replaceChild(newVisibilityBtn, visibilityBtn);
      newVisibilityBtn.addEventListener('click', async () => {
        const newVisibility = !page.visibleToPlayers;
        await this._handleVisibilityChange(page, this.currentCategoryPath, this.currentPageIndex, newVisibility);
        // Actualizar icono
        newVisibilityBtn.innerHTML = `<img src="img/${newVisibility ? 'icon-eye-open' : 'icon-eye-close'}.svg" class="icon-button-icon" alt="Visibility" />`;
        newVisibilityBtn.title = newVisibility ? 'Visible to players (click to hide)' : 'Hidden from players (click to show)';
        page.visibleToPlayers = newVisibility;
      });
    }

    // Botón Menú Contextual (para GM y Co-GM)
    if (this.isGM) {
      let contextMenuBtn = document.getElementById('page-context-menu-button-header');
      if (!contextMenuBtn) {
        contextMenuBtn = document.createElement('button');
        contextMenuBtn.id = 'page-context-menu-button-header';
        contextMenuBtn.className = 'icon-button';
        contextMenuBtn.innerHTML = '<img src="img/icon-contextualmenu.svg" class="icon-button-icon" alt="Menu" />';
        contextMenuBtn.title = 'Page options';
        header.appendChild(contextMenuBtn);
      }
      contextMenuBtn.classList.remove('hidden');
      
      // Remover listener anterior y agregar nuevo
      const newContextMenuBtn = contextMenuBtn.cloneNode(true);
      contextMenuBtn.parentNode.replaceChild(newContextMenuBtn, contextMenuBtn);
      newContextMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showPageDetailContextMenu(newContextMenuBtn, page);
      });
    }

    // Refresh está en el menú contextual, no como botón separado
  }

  /**
   * Oculta los botones de la página de detalle
   * @private
   */
  _hidePageDetailButtons() {
    const buttonIds = [
      'page-open-modal-button-header',
      'page-share-button-header',
      'page-visibility-button-header',
      'page-context-menu-button-header'
    ];
    buttonIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.add('hidden');
    });
  }

  /**
   * Comparte la página actual con los jugadores según su tipo
   * @param {Page|Object} page - La página a compartir
   * @private
   */
  async _shareCurrentPageToPlayers(pageData) {
    if (!pageData) return;

    log('🔗 Compartiendo página:', pageData.name);

    // Asegurar que tenemos una instancia de Page con los métodos necesarios
    // Si ya es instancia de Page, usarla; sino convertir desde JSON preservando todas las propiedades
    const page = pageData instanceof Page ? pageData : Page.fromJSON(pageData);

    if (page.isVideo()) {
      // Para videos, construir la URL de embed
      const url = page.url;
      const videoInfo = this._extractVideoId(url);
      if (videoInfo) {
        const embedUrl = videoInfo.type === 'youtube'
          ? `https://www.youtube.com/embed/${videoInfo.id}?autoplay=1`
          : `https://player.vimeo.com/video/${videoInfo.id}?autoplay=1`;
        await this._shareVideoToPlayers(embedUrl, page.name, videoInfo.type);
      }
    } else if (page.isGoogleDoc()) {
      // Para Google Docs, compartir la URL de embed
      const embedUrl = this._getGoogleDocEmbedUrl(page.url);
      await this._shareGoogleDocToPlayers(embedUrl, page.name);
    } else if (page.hasEmbeddedHtml() && page.htmlContent) {
      // Para páginas con htmlContent embebido (local-first, ej: Obsidian)
      // Funciona igual que Notion: enviar el HTML directamente
      try {
        // Verificar si ya tenemos el contenido cargado en la vista actual
        let notionContent = document.getElementById('notion-content');
        let htmlContent = '';
        
        // Si el contenido no está cargado (compartiendo desde lista), usar el htmlContent directamente
        if (!notionContent || !notionContent.innerHTML.trim()) {
          log('📄 Usando htmlContent embebido para compartir...');
          htmlContent = page.htmlContent;
        } else {
          // Clonar el contenido visible y remover botones de compartir
          const clone = notionContent.cloneNode(true);
          clone.querySelectorAll('.share-button, .notion-image-share-button, .video-share-button').forEach(el => el.remove());
          htmlContent = clone.innerHTML;
        }
        
        if (!htmlContent.trim()) {
          this._showFeedback('⚠️ No content to share');
          return;
        }
        
        // Generar un pageId único para esta página embebida (para caché)
        const pageId = `embedded-${page.name.toLowerCase().replace(/\s+/g, '-')}`;
        
        // Guardar en localStorage para caché persistente (igual que Notion)
        if (this.isGM && !this.isCoGM) {
          this.cacheService.saveHtmlToLocalCache(pageId, htmlContent);
        }
        
        // Enviar el HTML renderizado directamente (incluir senderId para filtrar)
        // Usar el mismo canal que Notion ya que _showNotionHtmlModal maneja HTML genérico
        const result = await this.broadcastService.sendMessage('com.dmscreen/showNotionContent', {
          name: page.name,
          html: htmlContent,
          pageId: pageId,
          senderId: this.playerId
        });
        
        // El callback onSizeLimitExceeded ya muestra feedback si hay error de tamaño
        if (result?.success) {
          this._showFeedback('📄 Page shared!');
        } else if (result?.error !== 'size_limit') {
          this._showFeedback('❌ Error sharing page');
        }
      } catch (e) {
        logError('Error compartiendo página con htmlContent:', e);
        this._showFeedback('❌ Error sharing page');
      }
    } else if (page.isNotionPage()) {
      // Para Notion, obtener el HTML renderizado y enviarlo directamente
      // Esto evita que el player necesite un token de Notion
      const pageId = page.getNotionPageId();
      if (pageId) {
        try {
          // Verificar si ya tenemos el contenido cargado en la vista actual
          let notionContent = document.getElementById('notion-content');
          let htmlContent = '';
          
          // Si el contenido no está cargado (compartiendo desde lista), renderizarlo primero
          if (!notionContent || !notionContent.innerHTML.trim()) {
            log('📄 Contenido no cargado, renderizando para compartir...');
            this._showFeedback('⏳ Loading content...');
            
            // Usar función centralizada que incluye header completo (cover, título, icono)
            const result = await this._generateNotionHtmlWithHeader(pageId, {
              includeShareButtons: false, // No incluir botones de share en contenido compartido
              fallbackTitle: page.name,
              useCache: true
            });
            
            if (result?.html) {
              htmlContent = result.html;
            }
          } else {
            // Clonar el contenido visible y remover botones de compartir
            const clone = notionContent.cloneNode(true);
            clone.querySelectorAll('.share-button, .notion-image-share-button, .video-share-button').forEach(el => el.remove());
            htmlContent = clone.innerHTML;
          }
          
          if (!htmlContent.trim()) {
            this._showFeedback('⚠️ No content to share');
            return;
          }
          
          // Enviar el HTML renderizado directamente (incluir senderId para filtrar)
          const result = await this.broadcastService.sendMessage('com.dmscreen/showNotionContent', {
            name: page.name,
            html: htmlContent,
            pageId: pageId,
            senderId: this.playerId
          });
          
          // El callback onSizeLimitExceeded ya muestra feedback si hay error de tamaño
          if (result?.success) {
            this._showFeedback('📄 Page shared!');
          } else if (result?.error !== 'size_limit') {
            this._showFeedback('❌ Error sharing page');
          }
        } catch (e) {
          logError('Error compartiendo página Notion:', e);
          this._showFeedback('❌ Error sharing page');
        }
      }
    } else {
      // Para otros tipos, intentar compartir URL genérica
      const result = await this.broadcastService.sendMessage('com.dmscreen/showContent', {
        url: page.url,
        name: page.name,
        senderId: this.playerId
      });
      
      if (result?.success) {
        this._showFeedback('🔗 Content shared!');
      } else if (result?.error !== 'size_limit') {
        this._showFeedback('❌ Error sharing content');
      }
    }
  }

  /**
   * Extrae el ID del video de una URL de YouTube o Vimeo
   * @param {string} url - URL del video
   * @returns {{ id: string, type: string } | null}
   * @private
   */
  _extractVideoId(url) {
    try {
      const urlObj = new URL(url);
      
      // YouTube
      if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
        let videoId = null;
        if (urlObj.hostname.includes('youtu.be')) {
          videoId = urlObj.pathname.slice(1);
        } else if (urlObj.pathname.includes('/embed/')) {
          videoId = urlObj.pathname.split('/embed/')[1];
        } else {
          videoId = urlObj.searchParams.get('v');
        }
        if (videoId) {
          return { id: videoId.split('?')[0].split('&')[0], type: 'youtube' };
        }
      }
      
      // Vimeo
      if (urlObj.hostname.includes('vimeo.com')) {
        const match = urlObj.pathname.match(/\/(\d+)/);
        if (match) {
          return { id: match[1], type: 'vimeo' };
        }
      }
    } catch (e) {
      logError('Error extrayendo video ID:', e);
    }
    return null;
  }

  /**
   * Obtiene la URL de embed para Google Docs
   * @param {string} url - URL original
   * @returns {string} URL de embed
   * @private
   */
  _getGoogleDocEmbedUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      if (pathname.includes('/presentation/d/')) {
        const match = pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
        if (match) return `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=false&delayms=3000`;
      } else if (pathname.includes('/spreadsheets/d/')) {
        const match = pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (match) return `https://docs.google.com/spreadsheets/d/${match[1]}/preview`;
      } else if (pathname.includes('/document/d/')) {
        const match = pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        if (match) return `https://docs.google.com/document/d/${match[1]}/preview`;
      } else if (urlObj.hostname.includes('drive.google.com') && pathname.includes('/file/d/')) {
        const match = pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
      }
    } catch (e) {
      logError('Error parsing Google Doc URL:', e);
    }
    return url;
  }

  /**
   * Muestra el menú contextual de la página de detalle
   * @private
   */
  _showPageDetailContextMenu(button, page) {
    // Cerrar menú existente
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const rect = button.getBoundingClientRect();
    
    const menuItems = [];

    // Solo Master GM puede editar y eliminar
    if (this.isGM && !this.isCoGM) {
      menuItems.push({ 
        icon: 'img/icon-edit.svg', 
        text: 'Edit page',
        action: () => this._showEditPageModal(page)
      });
    }

    // Agregar Refresh para páginas de Notion (disponible para TODOS los roles)
    // - Master GM: hace refresh directo desde la API de Notion
    // - Co-GM y Players: solicitan refresh al GM con forceRefresh=true
    if (page.isNotionPage()) {
      menuItems.push({
        icon: 'img/icon-reload.svg',
        text: 'Refresh content',
        action: async () => {
          const pageId = page.getNotionPageId();
          if (pageId) {
            await this._renderNotionPage(page, pageId, true);
            this.analyticsService.trackPageReloaded(page.name);
          }
        }
      });
    }

    // Solo Master GM puede eliminar
    if (this.isGM && !this.isCoGM) {
      menuItems.push(
        { separator: true },
        { 
          icon: 'img/icon-trash.svg', 
          text: 'Delete page',
          action: () => {
            if (confirm(`Delete "${page.name}"?`)) {
              this._handlePageDelete(page, this.currentCategoryPath, this.currentPageIndex);
              this._goBackToList();
            }
          }
        }
      );
    }

    // Si no hay items, no mostrar el menú
    if (menuItems.length === 0) {
      return;
    }

    const menu = this._createContextMenu(menuItems, { x: rect.left, y: rect.bottom + 4 }, () => {
      button.classList.remove('context-menu-active');
    });
    button.classList.add('context-menu-active');
  }

  /**
   * Abre la página actual en un modal de OBR
   * @private
   */
  async _openPageInModal(page) {
    // Validar que page exista
    if (!page) {
      logError('Error: página no definida para abrir modal');
      return;
    }
    
    // Asegurar que tenemos una instancia de Page
    const pageInstance = page instanceof Page ? page : Page.fromJSON(page);
    
    // Manejar páginas con htmlContent embebido (local-first, ej: Obsidian)
    // Funcionan igual que Notion: guardar en sessionStorage (temporal) y localStorage (caché)
    if (pageInstance.hasEmbeddedHtml() && pageInstance.htmlContent) {
      if (!this.OBR || !this.OBR.modal) {
        log('OBR modal no disponible, mostrando contenido embebido localmente');
        return;
      }

      try {
        // Generar un contentKey único para esta sesión (sessionStorage - temporal)
        const contentKey = `htmlContent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Guardar el HTML en sessionStorage para el modal (temporal, se limpia después de usar)
        sessionStorage.setItem(contentKey, pageInstance.htmlContent);
        
        // Guardar en localStorage para caché persistente (igual que Notion)
        // Generar un pageId único para esta página embebida
        const pageId = `embedded-${pageInstance.name.toLowerCase().replace(/\s+/g, '-')}`;
        if (this.isGM && !this.isCoGM) {
          this.cacheService.saveHtmlToLocalCache(pageId, pageInstance.htmlContent);
        }
        
        const currentPath = window.location.pathname;
        const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
        const baseUrl = window.location.origin + baseDir;

        const modalUrl = new URL('index.html', baseUrl);
        modalUrl.searchParams.set('modal', 'true');
        modalUrl.searchParams.set('htmlContent', 'true');
        modalUrl.searchParams.set('contentKey', contentKey);
        modalUrl.searchParams.set('name', encodeURIComponent(pageInstance.name || 'Page'));

        await this.OBR.modal.open({
          id: 'gm-vault-page-modal',
          url: modalUrl.toString(),
          height: 800,
          width: 1200
        });
        
        log('✅ Modal abierto con htmlContent embebido');
        return;
      } catch (e) {
        logError('Error abriendo modal con htmlContent:', e);
        return;
      }
    }
    
    // Validar que tenga URL para abrir en modal
    if (!pageInstance.url) {
      logError('Error: página sin URL para abrir modal');
      return;
    }

    if (!this.OBR || !this.OBR.modal) {
      window.open(pageInstance.url, '_blank');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;

      const modalUrl = new URL('index.html', baseUrl);
      modalUrl.searchParams.set('modal', 'true');
      modalUrl.searchParams.set('url', encodeURIComponent(pageInstance.url || ''));
      modalUrl.searchParams.set('name', encodeURIComponent(pageInstance.name || 'Page'));

      // Añadir blockTypes si existe
      if (pageInstance.blockTypes && Array.isArray(pageInstance.blockTypes) && pageInstance.blockTypes.length > 0) {
        modalUrl.searchParams.set('blockTypes', encodeURIComponent(JSON.stringify(pageInstance.blockTypes)));
      }

      await this.OBR.modal.open({
        id: 'gm-vault-page-modal',
        url: modalUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (e) {
      logError('Error abriendo modal:', e);
      if (page.url) {
        window.open(page.url, '_blank');
      }
    }
  }

  /**
   * Muestra modal para editar página desde la vista de detalle
   * @private
   */
  _showEditPageModal(page) {
    // Determinar blockTypes disponibles para filtro
    const blockTypeOptions = [
      { value: '', label: 'All blocks (no filter)' },
      { value: 'paragraph', label: 'Paragraphs' },
      { value: 'heading_1', label: 'Heading 1' },
      { value: 'heading_2', label: 'Heading 2' },
      { value: 'heading_3', label: 'Heading 3' },
      { value: 'bulleted_list_item', label: 'Bulleted lists' },
      { value: 'numbered_list_item', label: 'Numbered lists' },
      { value: 'to_do', label: 'To-do items' },
      { value: 'toggle', label: 'Toggles' },
      { value: 'quote', label: 'Quotes' },
      { value: 'callout', label: 'Callouts' },
      { value: 'code', label: 'Code blocks' },
      { value: 'image', label: 'Images' },
      { value: 'table', label: 'Tables' },
      { value: 'divider', label: 'Dividers' }
    ];

    const currentBlockTypes = page.blockTypes 
      ? (Array.isArray(page.blockTypes) ? page.blockTypes.join(',') : page.blockTypes) 
      : '';

    // Obtener opciones de carpetas
    const folderOptions = this._getFolderOptions();
    const currentFolderPathStr = this.currentCategoryPath.join('/');
    
    // Asegurarse de que el valor coincida exactamente con una opción disponible
    let folderValue = currentFolderPathStr;
    const matchingOption = folderOptions.find(opt => opt.value === currentFolderPathStr);
    if (!matchingOption && folderOptions.length > 0) {
      // Si no se encuentra, usar la primera opción (root) como fallback
      folderValue = folderOptions[0].value;
    }

    this._showModalForm('Edit Page', [
      { name: 'name', label: 'Name', type: 'text', value: page.name, required: true },
      { name: 'url', label: 'URL', type: 'url', value: page.url, required: true },
      { name: 'folder', label: 'Folder', type: 'select', value: folderValue, options: folderOptions },
      { name: 'blockTypes', label: 'Block filter (comma-separated)', type: 'text', value: currentBlockTypes, placeholder: 'e.g., paragraph,heading_1,image' },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: page.visibleToPlayers }
    ], async (data) => {
      // Convertir blockTypes de string a array
      if (data.blockTypes && typeof data.blockTypes === 'string') {
        data.blockTypes = data.blockTypes.split(',').map(s => s.trim()).filter(s => s);
        if (data.blockTypes.length === 0) data.blockTypes = null;
      }
      
      // Verificar si cambió la carpeta
      const folderChanged = data.folder !== currentFolderPathStr;
      
      if (folderChanged) {
        // Actualizar datos de la página antes de mover
        if (data.name !== undefined) page.name = data.name;
        if (data.url !== undefined) page.url = data.url;
        if (data.blockTypes !== undefined) page.blockTypes = data.blockTypes;
        if (data.visibleToPlayers !== undefined) page.visibleToPlayers = data.visibleToPlayers;
        
        // Mover a la nueva carpeta
        await this._moveItemToFolder(page, this.currentCategoryPath, data.folder, 'page');
        
        // Volver a la lista ya que la página se movió
        this._handleBack();
      } else {
        // Solo editar sin mover
        await this._handlePageEdit(page, this.currentCategoryPath, this.currentPageIndex, data);
        // Actualizar título si cambió
        const pageTitle = document.getElementById('page-title');
        if (pageTitle && data.name) {
          pageTitle.textContent = data.name;
        }
      }
    });
  }

  /**
   * Muestra modal para editar página desde la lista (con selector de carpeta)
   * @private
   */
  _showEditPageModalFromList(page, categoryPath, pageIndex) {
    // Obtener opciones de carpetas
    const folderOptions = this._getFolderOptions();
    const currentFolderPathStr = categoryPath.join('/');
    
    // Asegurarse de que el valor coincida exactamente con una opción disponible
    let folderValue = currentFolderPathStr;
    const matchingOption = folderOptions.find(opt => opt.value === currentFolderPathStr);
    if (!matchingOption && folderOptions.length > 0) {
      // Si no se encuentra, usar la primera opción (root) como fallback
      folderValue = folderOptions[0].value;
    }

    const currentBlockTypes = page.blockTypes 
      ? (Array.isArray(page.blockTypes) ? page.blockTypes.join(',') : page.blockTypes) 
      : '';

    this._showModalForm('Edit Page', [
      { name: 'name', label: 'Name', type: 'text', value: page.name, required: true },
      { name: 'url', label: 'URL', type: 'url', value: page.url, required: true },
      { name: 'folder', label: 'Folder', type: 'select', value: folderValue, options: folderOptions },
      { name: 'blockTypes', label: 'Block filter (comma-separated)', type: 'text', value: currentBlockTypes, placeholder: 'e.g., paragraph,heading_1,image' },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: page.visibleToPlayers }
    ], async (data) => {
      // Convertir blockTypes de string a array
      if (data.blockTypes && typeof data.blockTypes === 'string') {
        data.blockTypes = data.blockTypes.split(',').map(s => s.trim()).filter(s => s);
        if (data.blockTypes.length === 0) data.blockTypes = null;
      }
      
      // Verificar si cambió la carpeta
      const folderChanged = data.folder !== currentFolderPathStr;
      
      if (folderChanged) {
        // Actualizar datos de la página antes de mover
        if (data.name !== undefined) page.name = data.name;
        if (data.url !== undefined) page.url = data.url;
        if (data.blockTypes !== undefined) page.blockTypes = data.blockTypes;
        if (data.visibleToPlayers !== undefined) page.visibleToPlayers = data.visibleToPlayers;
        
        // Mover a la nueva carpeta
        await this._moveItemToFolder(page, categoryPath, data.folder, 'page');
      } else {
        // Solo editar sin mover
        await this._handlePageEdit(page, categoryPath, pageIndex, data);
      }
    });
  }

  /**
   * Crea un menú contextual genérico
   * @private
   */
  _createContextMenu(items, position, onClose) {
    // Cerrar menú existente y overlay
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();
    const existingOverlay = document.getElementById('context-menu-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Crear overlay invisible que captura clicks
    const overlay = document.createElement('div');
    overlay.id = 'context-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 9999;
      background: transparent;
    `;

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
    menu.style.zIndex = '10000'; // Por encima del overlay

    const closeMenu = () => {
      menu.remove();
      overlay.remove();
      if (onClose) onClose();
    };

    // Click en overlay cierra el menú (y NO propaga a otros elementos)
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    });

    items.forEach(item => {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.className = 'context-menu__separator';
        menu.appendChild(separator);
        return;
      }

      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu__item';
      
      let iconHtml = '';
      if (item.icon && item.icon.startsWith('img/')) {
        const rotation = item.rotation ? `transform: ${item.rotation};` : '';
        iconHtml = `<img src="${item.icon}" alt="" class="context-menu__icon" style="${rotation}" />`;
      }
      menuItem.innerHTML = `${iconHtml}<span>${item.text}</span>`;

      menuItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeMenu();
        if (item.action) await item.action();
      });

      menu.appendChild(menuItem);
    });

    // Agregar overlay y menú al body
    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    // Ajustar posición si se sale de pantalla
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${position.y - rect.height}px`;
    }

    return menu;
  }

  /**
   * Crea los botones del header (settings, add, collapse)
   * @private
   */
  _createHeaderButtons() {
    const header = document.getElementById('header');
    if (!header) return;

    // Verificar si ya existen
    if (document.querySelector('.button-container')) return;

    // Toggle Player View (solo para GMs - Master o Co-GM)
    if (this.isGM) {
      this._createPlayerViewToggle(header);
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';

    // Botón Settings
    const settingsButton = document.createElement('button');
    settingsButton.className = 'icon-button';
    settingsButton.title = 'Settings';
    settingsButton.innerHTML = '<img src="img/icon-json.svg" alt="Settings" class="icon-button-icon">';
    settingsButton.addEventListener('click', () => this._showSettings());

    // Botón Collapse All
    const collapseAllButton = document.createElement('button');
    collapseAllButton.className = 'icon-button';
    collapseAllButton.id = 'collapse-all-button';
    collapseAllButton.title = 'Collapse all folders';
    collapseAllButton.dataset.collapsed = 'false';
    collapseAllButton.innerHTML = '<img src="img/icon-collapse-false.svg" alt="Collapse all" class="icon-button-icon">';
    collapseAllButton.addEventListener('click', () => this._toggleCollapseAll(collapseAllButton));

    // Agregar botones base
    buttonContainer.appendChild(settingsButton);
    buttonContainer.appendChild(collapseAllButton);

    // Botón Add (solo para Master GM, no Co-GM)
    if (this.isGM && !this.isCoGM) {
      const addButton = document.createElement('button');
      addButton.className = 'icon-button';
      addButton.title = 'Add folder or page';
      addButton.innerHTML = '<img src="img/icon-add.svg" alt="Add" class="icon-button-icon">';
      addButton.addEventListener('click', (e) => this._showAddMenu(addButton));
      buttonContainer.appendChild(addButton);
    }

    header.appendChild(buttonContainer);
  }

  /**
   * Crea el toggle de Player View en el header
   * @private
   * @param {HTMLElement} header - Elemento header
   */
  _createPlayerViewToggle(header) {
    // Verificar si ya existe
    if (document.querySelector('.player-view-toggle')) return;

    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'player-view-toggle';

    const label = document.createElement('span');
    label.className = 'player-view-toggle__label';
    label.textContent = 'Player view';

    const toggleSwitch = document.createElement('div');
    toggleSwitch.className = 'player-view-toggle__switch';
    toggleSwitch.id = 'player-view-switch';
    toggleSwitch.title = 'Toggle between GM view (all pages) and Player view (only visible pages)';

    // Click handler
    toggleSwitch.addEventListener('click', () => this._togglePlayerViewMode());

    toggleContainer.appendChild(label);
    toggleContainer.appendChild(toggleSwitch);

    // Insertar después del título
    const pageTitle = header.querySelector('#page-title');
    if (pageTitle && pageTitle.nextSibling) {
      header.insertBefore(toggleContainer, pageTitle.nextSibling);
    } else {
      header.appendChild(toggleContainer);
    }
  }

  /**
   * Alterna el modo de vista de jugador
   * @private
   */
  async _togglePlayerViewMode() {
    this.playerViewMode = !this.playerViewMode;
    
    log(`🔄 Player View Mode: ${this.playerViewMode ? 'ON' : 'OFF'}`);
    
    // Actualizar UI del toggle
    const toggleSwitch = document.getElementById('player-view-switch');
    const toggleLabel = document.querySelector('.player-view-toggle__label');
    
    if (toggleSwitch) {
      toggleSwitch.classList.toggle('player-view-toggle__switch--active', this.playerViewMode);
    }
    if (toggleLabel) {
      toggleLabel.classList.toggle('player-view-toggle__label--active', this.playerViewMode);
    }
    
    // Re-renderizar la lista de páginas
    await this.render();
  }

  /**
   * Muestra el panel de settings
   * @private
   */
  _showSettings() {
    const settingsContainer = document.getElementById('settings-container');
    const pageList = document.getElementById('page-list');
    const notionContainer = document.getElementById('notion-container');
    const backButton = document.getElementById('back-button');
    const pageTitle = document.getElementById('page-title');
    const buttonContainer = document.querySelector('.button-container');
    const playerViewToggle = document.querySelector('.player-view-toggle');

    if (pageList) pageList.classList.add('hidden');
    if (notionContainer) notionContainer.classList.add('hidden');
    if (settingsContainer) settingsContainer.classList.remove('hidden');
    if (backButton) backButton.classList.remove('hidden');
    if (pageTitle) pageTitle.textContent = 'Settings';
    if (buttonContainer) buttonContainer.classList.add('hidden');
    if (playerViewToggle) playerViewToggle.classList.add('hidden');

    // Actualizar clase del container
    this._updateContainerClass();

    // Ocultar/mostrar secciones según rol
    const allForms = settingsContainer ? settingsContainer.querySelectorAll('.form') : [];
    const notionTokenForm = allForms[0]; // Primera sección: Notion Token (incluye Import from Notion)
    const exportVaultForm = allForms[1]; // Segunda sección: Export vault
    const feedbackForm = allForms[2]; // Tercera sección: Feedback
    const loadJsonBtn = document.getElementById('load-json-btn');
    const loadUrlBtn = document.getElementById('load-url-btn');
    const vaultUrlInput = document.getElementById('vault-url-input');

    log('⚙️ Settings - isGM:', this.isGM, '| isCoGM:', this.isCoGM);

    if (!this.isGM) {
      // Player: solo mostrar feedback/patreon (última sección)
      log('⚙️ Mostrando settings para Player (solo feedback)');
      if (notionTokenForm) notionTokenForm.style.display = 'none';
      if (exportVaultForm) exportVaultForm.style.display = 'none';
      if (feedbackForm) feedbackForm.style.display = '';
    } else if (this.isCoGM) {
      // Co-GM: ocultar Notion Token, mostrar Export vault (con vault status) y Feedback
      log('⚙️ Mostrando settings para Co-GM (export + feedback)');
      if (notionTokenForm) notionTokenForm.style.display = 'none';
      if (exportVaultForm) exportVaultForm.style.display = '';
      if (feedbackForm) feedbackForm.style.display = '';
      // Ocultar botones de carga para Co-GM (solo lectura)
      if (loadJsonBtn) loadJsonBtn.style.display = 'none';
      if (loadUrlBtn) loadUrlBtn.style.display = 'none';
      if (vaultUrlInput) {
        const urlField = vaultUrlInput.closest('.form__field');
        if (urlField) urlField.style.display = 'none';
      }
    } else {
      // Master GM: mostrar todas las secciones
      log('⚙️ Mostrando settings para Master GM (todas las secciones)');
      allForms.forEach(form => {
        form.style.display = '';
      });
      // Asegurar que botones de carga estén visibles para Master GM
      if (loadJsonBtn) loadJsonBtn.style.display = '';
      if (loadUrlBtn) loadUrlBtn.style.display = '';
      if (vaultUrlInput) {
        const urlField = vaultUrlInput.closest('.form__field');
        if (urlField) urlField.style.display = '';
      }
      
      // Mostrar botón Import from Notion solo si hay token guardado
      const importNotionBtn = document.getElementById('import-notion-btn');
      const saveTokenBtn = document.getElementById('save-token');
      if (importNotionBtn) {
        const hasToken = !!this.storageService.getUserToken();
        importNotionBtn.style.display = hasToken ? '' : 'none';
        log('⚙️ Import Notion button:', hasToken ? 'visible' : 'hidden (no token)');
        
        // Si el botón Import está visible, cambiar Save Token a btn--ghost
        if (saveTokenBtn) {
          if (hasToken) {
            saveTokenBtn.classList.remove('btn--primary');
            saveTokenBtn.classList.add('btn--ghost');
          } else {
            saveTokenBtn.classList.remove('btn--ghost');
            saveTokenBtn.classList.add('btn--primary');
          }
        }
      }
    }

    // Renderizar vault status box (para GM y Co-GM)
    this._renderVaultStatusBox();

    // Configurar event listeners de settings (solo una vez)
    this._setupSettingsEventListeners();
  }

  /**
   * Renderiza el vault status box en settings
   * @private
   */
  async _renderVaultStatusBox() {
    // Eliminar vault status anterior si existe
    const existing = document.getElementById('vault-status-box');
    if (existing) existing.remove();

    // Solo para GM (Master o Co-GM)
    if (!this.isGM) return;

    const exportVaultForm = document.querySelector('.form--separated');
    if (!exportVaultForm) return;

    // Calcular stats del vault
    const config = this.config || { categories: [] };
    const configJson = JSON.stringify(config);
    const configSize = new TextEncoder().encode(configJson).length;
    const canSync = configSize < 16 * 1024; // 16KB límite

    let pageCount = 0;
    let categoryCount = 0;
    const countItems = (categories) => {
      for (const cat of categories || []) {
        categoryCount++;
        pageCount += (cat.pages || []).length;
        if (cat.categories) countItems(cat.categories);
      }
    };
    countItems(config.categories);

    const vaultStatusBox = document.createElement('div');
    vaultStatusBox.id = 'vault-status-box';

    if (this.isCoGM) {
      // Co-GM: modo solo lectura
      const owner = await this.storageService.getVaultOwner();
      const masterGMName = owner?.name || 'Master GM';
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
      
      // Actualizar descripción para Co-GM
      const exportDescription = exportVaultForm.querySelector('.settings__description');
      if (exportDescription) {
        exportDescription.textContent = 'You can download a copy of the vault. Share content with players using the share button on pages.';
      }
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
      
      // Actualizar descripción para Master GM
      const exportDescription = exportVaultForm.querySelector('.settings__description');
      if (exportDescription) {
        exportDescription.textContent = canSync
          ? "Save and reuse your GM Vault. It's recommended to make regular backups. Your vault syncs automatically to Co-GMs."
          : "Save and reuse your GM Vault. Your vault is too large (>16KB) to sync with Co-GMs. Make regular backups.";
      }
    }

    // Insertar vault status antes de la descripción
    const exportDescription = exportVaultForm.querySelector('.settings__description');
    if (exportDescription) {
      exportDescription.insertAdjacentElement('beforebegin', vaultStatusBox);
    } else {
      exportVaultForm.insertBefore(vaultStatusBox, exportVaultForm.firstChild);
    }
  }

  /**
   * Configura los event listeners de los botones de settings
   * @private
   */
  _setupSettingsEventListeners() {
    const tokenInput = document.getElementById('token-input');
    const saveBtn = document.getElementById('save-token');
    const clearBtn = document.getElementById('clear-token');
    const loadJsonBtn = document.getElementById('load-json-btn');
    const loadUrlBtn = document.getElementById('load-url-btn');
    const vaultUrlInput = document.getElementById('vault-url-input');
    const downloadJsonBtn = document.getElementById('download-json-btn');
    const patreonBtn = document.getElementById('patreon-btn');
    const feedbackBtn = document.getElementById('feedback-btn');
    const clearLocalDataBtn = document.getElementById('clear-local-data-btn');

    log('⚙️ Setup settings listeners - loadUrlBtn:', !!loadUrlBtn, 'vaultUrlInput:', !!vaultUrlInput);

    // Mostrar token actual en el input y enmascarado
    const currentToken = this.storageService.getUserToken() || '';
    const tokenMasked = document.getElementById('token-masked');
    
    // Rellenar el input con el token actual
    if (tokenInput) {
      tokenInput.value = currentToken;
    }
    
    // Mostrar versión enmascarada
    if (tokenMasked && currentToken) {
      tokenMasked.textContent = `Current: ${currentToken.substring(0, 8)}...${currentToken.slice(-4)}`;
    }

    // Guardar token
    if (saveBtn && !saveBtn.dataset.listenerAdded) {
      saveBtn.dataset.listenerAdded = 'true';
      saveBtn.addEventListener('click', async () => {
        const token = tokenInput ? tokenInput.value.trim() : '';
        if (!token) {
          alert('Please enter a Notion token');
          return;
        }
        
        this.storageService.saveUserToken(token);
        this.analyticsService.trackTokenConfigured();
        
        // Mostrar botón Import from Notion ahora que hay token
        const importNotionBtn = document.getElementById('import-notion-btn');
        const saveTokenBtn = document.getElementById('save-token');
        if (importNotionBtn) {
          importNotionBtn.style.display = '';
        }
        // Cambiar Save Token a btn--ghost cuando Import está visible
        if (saveTokenBtn) {
          saveTokenBtn.classList.remove('btn--primary');
          saveTokenBtn.classList.add('btn--ghost');
        }
        
        // Actualizar texto del token enmascarado
        const tokenMasked = document.getElementById('token-masked');
        if (tokenMasked) {
          tokenMasked.textContent = token.length > 10 
            ? token.substring(0, 6) + '...' + token.substring(token.length - 4)
            : '••••••••';
        }
        
        // Mostrar toast de éxito (quedarse en settings)
        this.uiRenderer.showSuccessToast('Token saved', 'Your Notion token has been configured successfully.');
      });
    }

    // Eliminar token
    if (clearBtn && !clearBtn.dataset.listenerAdded) {
      clearBtn.dataset.listenerAdded = 'true';
      clearBtn.addEventListener('click', () => {
        if (confirm('Delete token? You will go back to using the server token.')) {
          this.storageService.saveUserToken('');
          this.analyticsService.trackTokenRemoved();
          if (tokenInput) tokenInput.value = '';
          if (tokenMasked) tokenMasked.textContent = '';
          
          // Ocultar botón Import from Notion cuando se borra el token
          const importNotionBtn = document.getElementById('import-notion-btn');
          const saveTokenBtn = document.getElementById('save-token');
          if (importNotionBtn) {
            importNotionBtn.style.display = 'none';
          }
          // Cambiar Save Token de vuelta a btn--primary cuando Import está oculto
          if (saveTokenBtn) {
            saveTokenBtn.classList.remove('btn--ghost');
            saveTokenBtn.classList.add('btn--primary');
          }
          
          // Mostrar toast (quedarse en settings)
          this.uiRenderer.showInfoToast('Token deleted', 'You will use the default server token.');
        }
      });
    }

    // Cargar JSON
    if (loadJsonBtn && !loadJsonBtn.dataset.listenerAdded) {
      loadJsonBtn.dataset.listenerAdded = 'true';
      loadJsonBtn.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          
          try {
            const text = await file.text();
            const importedConfig = JSON.parse(text);
            
            if (!importedConfig.categories) {
              throw new Error('Invalid config: missing categories');
            }
            
            // Contar páginas actuales e importadas
            const currentConfig = this.config || { categories: [] };
            const configForCount = currentConfig.toJSON ? currentConfig.toJSON() : currentConfig;
            const currentPagesCount = this._countPagesInConfig(configForCount);
            const importedPagesCount = this._countPagesInConfig(importedConfig);
            
            log(`Load JSON: currentPages=${currentPagesCount}, importedPages=${importedPagesCount}`);
            
            // Mostrar modal con opciones de importación
            await this._showLoadJsonOptionsModal(importedConfig, currentPagesCount, importedPagesCount, file.name);
            
          } catch (err) {
            alert('❌ Error loading file: ' + err.message);
          }
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
      });
    }

    // Cargar desde URL
    if (loadUrlBtn && !loadUrlBtn.dataset.listenerAdded) {
      loadUrlBtn.dataset.listenerAdded = 'true';
      loadUrlBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        log('Load from URL button clicked');
        
        const url = vaultUrlInput ? vaultUrlInput.value.trim() : '';
        log('URL value:', url);
        if (!url) {
          alert('Please enter a URL');
          return;
        }

        // Validar que sea una URL válida
        try {
          new URL(url);
        } catch (e) {
          alert('Please enter a valid URL');
          return;
        }

        // Mostrar indicador de carga
        loadUrlBtn.disabled = true;
        const originalText = loadUrlBtn.textContent;
        loadUrlBtn.textContent = 'Loading...';

        try {
          log('Loading vault from URL:', url);
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const importedConfig = await response.json();
          
          if (!importedConfig.categories) {
            throw new Error('Invalid config: missing categories');
          }
          
          // Contar páginas actuales e importadas
          const currentConfig = this.config || { categories: [] };
          const configForCount = currentConfig.toJSON ? currentConfig.toJSON() : currentConfig;
          const currentPagesCount = this._countPagesInConfig(configForCount);
          const importedPagesCount = this._countPagesInConfig(importedConfig);
          
          log(`Load from URL: currentPages=${currentPagesCount}, importedPages=${importedPagesCount}`);
          
          // Extraer nombre del vault de la URL para mostrar en el modal
          const urlObj = new URL(url);
          const vaultName = urlObj.pathname.split('/').pop() || 'vault';
          
          // Mostrar modal con opciones de importación
          await this._showLoadJsonOptionsModal(importedConfig, currentPagesCount, importedPagesCount, vaultName);
          
        } catch (err) {
          console.error('Error loading from URL:', err);
          alert('❌ Error loading from URL: ' + err.message);
        } finally {
          loadUrlBtn.disabled = false;
          loadUrlBtn.textContent = originalText;
        }
      });
    }

    // Permitir cargar con Enter en el input
    if (vaultUrlInput && !vaultUrlInput.dataset.listenerAdded) {
      vaultUrlInput.dataset.listenerAdded = 'true';
      vaultUrlInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && loadUrlBtn && !loadUrlBtn.disabled) {
          // Simular click en el botón
          loadUrlBtn.click();
        }
      });
    }

    // Descargar JSON
    if (downloadJsonBtn && !downloadJsonBtn.dataset.listenerAdded) {
      downloadJsonBtn.dataset.listenerAdded = 'true';
      downloadJsonBtn.addEventListener('click', () => {
        try {
          const config = this.config || { categories: [] };
          
          // Convertir a formato items[] (nuevo formato)
          const configJson = config.toJSON ? config.toJSON() : config;
          const itemsFormatConfig = this.configParser.toItemsFormat(configJson);
          
          const jsonStr = JSON.stringify(itemsFormatConfig, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = `gm-vault-${this.roomId || 'backup'}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          // Contar items para analytics
          let itemCount = 0;
          const countExportItems = (cats) => {
            for (const cat of cats || []) {
              if (cat.items) {
                // Formato items[]
                itemCount += cat.items.filter(item => item.type === 'page').length;
                cat.items.filter(item => item.type === 'category').forEach(subcat => {
                  if (subcat.items) {
                    const subcatConfig = { categories: [{ ...subcat }] };
                    countExportItems(subcatConfig.categories);
                  }
                });
              } else {
                // Formato legacy (fallback)
              itemCount += (cat.pages || []).length;
              if (cat.categories) countExportItems(cat.categories);
              }
            }
          };
          countExportItems(itemsFormatConfig.categories);
          this.analyticsService.trackJSONExported(itemCount);
        } catch (err) {
          alert('❌ Error downloading: ' + err.message);
        }
      });
    }

    // View JSON (solo en debug mode)
    const viewJsonBtn = document.getElementById('view-json-btn');
    if (viewJsonBtn) {
      // Verificar si DEBUG_MODE está activo (configurable via Netlify)
      if (isDebugMode()) {
        viewJsonBtn.classList.remove('hidden');
        if (!viewJsonBtn.dataset.listenerAdded) {
          viewJsonBtn.dataset.listenerAdded = 'true';
          viewJsonBtn.addEventListener('click', () => {
            const config = this.config || { categories: [] };
            const jsonStr = JSON.stringify(config, null, 2);
            // Mostrar en modal o nueva ventana
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.document.write(`<pre style="background:#1e1e1e;color:#d4d4d4;padding:20px;font-family:monospace;">${jsonStr.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`);
              newWindow.document.title = 'GM Vault JSON';
            }
          });
        }
      } else {
        viewJsonBtn.classList.add('hidden');
      }
    }

    // Patreon
    if (patreonBtn && !patreonBtn.dataset.listenerAdded) {
      patreonBtn.dataset.listenerAdded = 'true';
      patreonBtn.addEventListener('click', () => {
        window.open('https://patreon.com/usegmvault', '_blank', 'noopener,noreferrer');
      });
    }

    // Feedback - Roadmap de Notion
    if (feedbackBtn && !feedbackBtn.dataset.listenerAdded) {
      feedbackBtn.dataset.listenerAdded = 'true';
      feedbackBtn.addEventListener('click', () => {
        window.open('https://www.notion.so/DM-Panel-Roadmap-2d8d4856c90e8088825df40c3be24393?source=copy_link', '_blank', 'noopener,noreferrer');
      });
    }

    // Clear Local Data
    if (clearLocalDataBtn && !clearLocalDataBtn.dataset.listenerAdded) {
      clearLocalDataBtn.dataset.listenerAdded = 'true';
      clearLocalDataBtn.addEventListener('click', async () => {
        const confirmed = confirm(
          '⚠️ Clear all local data?\n\n' +
          'This will remove:\n' +
          '• Cached vault configuration\n' +
          '• Cached page content\n' +
          '• UI preferences (collapsed folders, etc.)\n\n' +
          'Your Notion token will NOT be removed.\n\n' +
          'The page will reload after clearing.'
        );
        
        if (confirmed) {
          try {
            // Clear localStorage (except token)
            this.storageService.clearAllLocalData();
            
            // Clear cache services
            if (this.cacheService) {
              this.cacheService.clearLocalCache();
            }
            
            this.uiRenderer.showSuccessToast('Local data cleared', 'Reloading page...');
            
            // Reload page after a brief delay
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          } catch (error) {
            logError('Error clearing local data:', error);
            this.uiRenderer.showErrorToast('Error', 'Could not clear local data. Please try again.');
          }
        }
      });
    }

    // Import from Notion
    const importNotionBtn = document.getElementById('import-notion-btn');
    if (importNotionBtn && !importNotionBtn.dataset.listenerAdded) {
      importNotionBtn.dataset.listenerAdded = 'true';
      importNotionBtn.addEventListener('click', () => {
        this._showNotionPagesSelector();
      });
    }

  }



  /**
   * Muestra el selector de páginas de Notion
   * @private
   */
  async _showNotionPagesSelector() {
    // Verificar que hay token
    const token = this.storageService.getUserToken();
    if (!token) {
      this.uiRenderer.showErrorToast(
        'No token configured',
        'Please add your Notion token first in the settings above.'
      );
      return;
    }

    // Crear overlay (mismo estilo que _showModalForm)
    const overlay = document.createElement('div');
    overlay.id = 'notion-pages-modal';
    overlay.className = 'modal';

    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'modal__content notion-pages-modal';

    modal.innerHTML = `
      <h2 class="modal__title">Import from Notion</h2>
      <div class="form">
        <div class="form__field">
          <label class="form__label">Search pages</label>
          <input type="text" placeholder="Search..." id="notion-search-input" class="input" />
        </div>
        <div class="form__field">
          <label class="form__label">Select pages <span id="notion-selection-count" class="notion-selection-count"></span></label>
          <div class="notion-pages-list" id="notion-pages-list">
            <div class="notion-pages-loading">Loading pages...</div>
          </div>
        </div>
        <p class="notion-pages-hint">
          💡 Select one or more pages. Child pages will become folders/pages in your vault.
        </p>
        <div id="import-progress" class="import-progress" style="display: none;">
          <div class="import-progress__status" id="import-status">Preparing...</div>
          <div class="import-progress__bar">
            <div class="import-progress__fill" id="import-fill"></div>
          </div>
        </div>
        <div class="form__actions">
          <button type="button" id="notion-cancel-btn" class="btn btn--ghost btn--flex">Cancel</button>
          <button type="button" id="notion-import-btn" class="btn btn--primary btn--flex" disabled>Import</button>
        </div>
      </div>
    `;

    overlay.appendChild(modal);

    // Eventos
    const closeModal = () => {
      overlay.remove();
    };

    modal.querySelector('#notion-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.body.appendChild(overlay);

    // Variables de estado
    let selectedPages = new Map(); // Map<pageId, {id, title}>
    let pages = [];
    let searchTimeout = null;

    // Actualizar contador de selección
    const updateSelectionCount = () => {
      const countEl = document.getElementById('notion-selection-count');
      const importBtn = document.getElementById('notion-import-btn');
      if (countEl) {
        countEl.textContent = selectedPages.size > 0 ? `(${selectedPages.size} selected)` : '';
      }
      if (importBtn) {
        importBtn.disabled = selectedPages.size === 0;
      }
    };

    // Cargar páginas
    const loadPages = async (query = '') => {
      const listEl = document.getElementById('notion-pages-list');
      listEl.innerHTML = '<div class="notion-pages-loading">Loading pages...</div>';

      try {
        pages = await this.notionService.searchWorkspacePages(query);
        this._renderNotionPagesList(pages, listEl, (page, isSelected) => {
          if (isSelected) {
            selectedPages.set(page.id, page);
          } else {
            selectedPages.delete(page.id);
          }
          updateSelectionCount();
        }, selectedPages);
      } catch (e) {
        listEl.innerHTML = `<div class="notion-pages-empty">❌ ${e.message}</div>`;
      }
    };

    // Búsqueda
    const searchInput = document.getElementById('notion-search-input');
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        loadPages(e.target.value);
      }, 300);
    });

    // Importar - Mostrar opciones de integración
    document.getElementById('notion-import-btn').addEventListener('click', async () => {
      if (selectedPages.size === 0) return;

      const form = modal.querySelector('.form');
      const formFields = form.querySelectorAll('.form__field');
      const hint = form.querySelector('.notion-pages-hint');
      const formActions = form.querySelector('.form__actions');
      const progressEl = document.getElementById('import-progress');

      // Contar páginas actuales en el vault (convertir a JSON si es instancia)
      const currentConfig = this.config || { categories: [] };
      const configForCount = currentConfig.toJSON ? currentConfig.toJSON() : currentConfig;
      const currentPagesCount = this._countPagesInConfig(configForCount);

      // Ocultar elementos del formulario de selección
      formFields.forEach(field => field.style.display = 'none');
      if (hint) hint.style.display = 'none';
      if (formActions) formActions.style.display = 'none';

      // Mostrar opciones de integración
      const optionsHtml = `
        <div id="import-options" class="import-options">
          <p class="import-options__question">How would you like to add this?</p>
          
          <label class="import-option">
            <input type="radio" name="import-mode" value="append" checked />
            <div class="import-option__content">
              <span class="import-option__title">Add to the end</span>
              <span class="import-option__hint">Your current vault stays untouched</span>
            </div>
          </label>
          
          <label class="import-option">
            <input type="radio" name="import-mode" value="merge" />
            <div class="import-option__content">
              <span class="import-option__title">Combine with existing</span>
              <span class="import-option__hint">New pages will be added, duplicates updated</span>
            </div>
          </label>
          
          <label class="import-option">
            <input type="radio" name="import-mode" value="replace" />
            <div class="import-option__content">
              <span class="import-option__title">Replace everything</span>
              ${currentPagesCount > 0 
                ? `<span class="import-option__hint import-option__hint--warning">⚠️ You'll lose your current ${currentPagesCount} page${currentPagesCount !== 1 ? 's' : ''}</span>`
                : `<span class="import-option__hint">Start fresh with imported content</span>`
              }
            </div>
          </label>

          <div class="form__actions" style="margin-top: var(--spacing-lg);">
            <button type="button" id="import-options-back" class="btn btn--ghost btn--flex">Back</button>
            <button type="button" id="import-options-confirm" class="btn btn--primary btn--flex">Confirm import</button>
          </div>
        </div>
      `;
      
      // Insertar antes del progress
      progressEl.insertAdjacentHTML('beforebegin', optionsHtml);

      // Botón "Back" - volver a la selección de páginas
      document.getElementById('import-options-back').addEventListener('click', () => {
        document.getElementById('import-options').remove();
        formFields.forEach(field => field.style.display = '');
        if (hint) hint.style.display = '';
        if (formActions) formActions.style.display = '';
      });

      // Botón "Confirm import" - ejecutar la importación
      document.getElementById('import-options-confirm').addEventListener('click', async () => {
        const importMode = document.querySelector('input[name="import-mode"]:checked').value;
        const optionsEl = document.getElementById('import-options');
        const statusEl = document.getElementById('import-status');
        const fillEl = document.getElementById('import-fill');

        // Ocultar opciones, mostrar progreso
        optionsEl.style.display = 'none';
        progressEl.style.display = 'block';

        try {
          const pagesToImport = Array.from(selectedPages.values());
          const totalStats = { pagesImported: 0, pagesSkipped: 0, emptyPages: 0, dbPagesFiltered: 0 };
          const importedCategories = [];
          const importedRootPages = []; // Páginas sin hijos van al root

          // Procesar cada página seleccionada
          let totalPagesProcessed = 0;
          for (let i = 0; i < pagesToImport.length; i++) {
            const page = pagesToImport[i];
            
            statusEl.textContent = `Processing ${i + 1}/${pagesToImport.length}: ${page.title}...`;

            const result = await this.notionService.generateVaultFromPage(
              page.id,
              page.title,
              10, // maxDepth
              (progress) => {
                statusEl.textContent = `(${i + 1}/${pagesToImport.length}) ${progress.message}`;
                const currentTotal = totalPagesProcessed + progress.pagesImported;
                fillEl.style.width = `${Math.min(currentTotal * 10, 90)}%`;
              }
            );
            
            totalPagesProcessed += result.stats.pagesImported;
            fillEl.style.width = `${Math.min(totalPagesProcessed * 10, 90)}%`;

            // Acumular estadísticas
            totalStats.pagesImported += result.stats.pagesImported;
            totalStats.pagesSkipped += result.stats.pagesSkipped;
            totalStats.emptyPages += result.stats.emptyPages;
            totalStats.dbPagesFiltered += result.stats.dbPagesFiltered || 0;

            // Acumular categorías (páginas con hijos)
            if (result.config.categories && result.config.categories.length > 0) {
              importedCategories.push(...result.config.categories);
            }
            
            // Acumular páginas del root (páginas sin hijos)
            if (result.config.pages && result.config.pages.length > 0) {
              importedRootPages.push(...result.config.pages);
            }
          }

          fillEl.style.width = '100%';
          statusEl.textContent = 'Saving vault...';

          // Aplicar según el modo seleccionado
          if (importedCategories.length > 0 || importedRootPages.length > 0) {
            let finalCategories;
            let finalPages;
            
            // Obtener config ACTUAL y convertir a JSON plano, luego a formato items[]
            const currentConfigNow = this.config || { categories: [], pages: [] };
            // Convertir de instancia Config a JSON plano si es necesario
            const configJson = currentConfigNow.toJSON ? currentConfigNow.toJSON() : currentConfigNow;
            const existingInItemsFormat = this.configParser.toItemsFormat(configJson);
            const existingCategories = existingInItemsFormat.categories || [];
            const existingPages = configJson.pages || [];

            switch (importMode) {
              case 'append':
                // Añadir al final
                finalCategories = [...existingCategories, ...importedCategories];
                finalPages = [...existingPages, ...importedRootPages];
                break;
              
              case 'merge':
                // Combinar: añadir nuevas, actualizar duplicadas por nombre
                // Preserva páginas añadidas manualmente por el usuario
                finalCategories = this._mergeCategories(existingCategories, importedCategories);
                finalPages = this._mergeRootPages(existingPages, importedRootPages);
                break;
              
              case 'replace':
                // Reemplazar todo
                finalCategories = importedCategories;
                finalPages = importedRootPages;
                break;
              
              default:
                finalCategories = importedCategories;
                finalPages = importedRootPages;
            }

            await this.saveConfig({ categories: finalCategories, pages: finalPages });
            
            closeModal();
            
            // Mostrar resultado
            const { pagesImported, pagesSkipped, emptyPages, dbPagesFiltered } = totalStats;
            const modeText = importMode === 'append' ? 'added' : importMode === 'merge' ? 'merged' : 'updated';
            
            // Solo mostrar warning si hay páginas saltadas por profundidad (no por filtrado intencional de DB)
            const realSkipped = pagesSkipped - emptyPages; // Solo las saltadas por profundidad
            
            if (realSkipped > 0 || emptyPages > 0 || dbPagesFiltered > 0) {
              // Construir mensaje más claro y descriptivo
              const skippedInfo = [];
              if (emptyPages > 0) {
                skippedInfo.push(`${emptyPages} empty page${emptyPages > 1 ? 's' : ''}`);
              }
              if (realSkipped > 0) {
                skippedInfo.push(`${realSkipped} page${realSkipped > 1 ? 's' : ''} beyond depth limit`);
              }
              if (dbPagesFiltered > 0) {
                skippedInfo.push(`${dbPagesFiltered} page${dbPagesFiltered > 1 ? 's' : ''} from databases without names`);
              }
              
              const skippedText = skippedInfo.length > 0 
                ? ` ${skippedInfo.length === 1 ? skippedInfo[0] : skippedInfo.join(', ')} ${skippedInfo.length === 1 ? 'was' : 'were'} skipped.`
                : '';
              
              this.uiRenderer.showWarningToast(
                'Vault updated',
                `${pagesImported} page${pagesImported !== 1 ? 's' : ''} ${modeText} in your vault.${skippedText}`,
                8000
              );
            } else {
              const pageText = pagesToImport.length === 1 ? pagesToImport[0].title : `${pagesToImport.length} sources`;
              this.uiRenderer.showSuccessToast(
                'Vault updated',
                `${pagesImported} page${pagesImported !== 1 ? 's' : ''} ${modeText} from ${pageText}.`
              );
            }

            // Track analytics
            this.analyticsService.trackJSONImported(pagesImported);

            // Volver a la lista
            this._goBackToList();
          } else {
            this.uiRenderer.showWarningToast(
              'No pages found',
              'The selected pages have no content to import.'
            );
            optionsEl.style.display = '';
            progressEl.style.display = 'none';
          }
        } catch (e) {
          logError('Error importing from Notion:', e);
          this.uiRenderer.showErrorToast(
            'Import failed',
            e.message || 'An error occurred while importing.'
          );
          optionsEl.style.display = '';
          progressEl.style.display = 'none';
        }
      });
    });

    // Cargar páginas iniciales
    await loadPages();
    searchInput.focus();
  }

  /**
   * Muestra el modal con opciones para cargar un archivo JSON
   * @param {Object} importedConfig - Configuración importada del archivo
   * @param {number} currentPagesCount - Número de páginas en el vault actual
   * @param {number} importedPagesCount - Número de páginas en el archivo importado
   * @param {string} fileName - Nombre del archivo importado
   * @private
   */
  async _showLoadJsonOptionsModal(importedConfig, currentPagesCount, importedPagesCount, fileName) {
    log(`_showLoadJsonOptionsModal: currentPages=${currentPagesCount}, importedPages=${importedPagesCount}, file=${fileName}`);
    
    // Si el vault actual está vacío, hacer replace directamente sin mostrar opciones
    if (currentPagesCount === 0) {
      log('Vault is empty, applying direct replace');
      await this._applyJsonImport(importedConfig, 'replace', importedPagesCount);
      return;
    }

    // Crear el contenido del modal
    const modalContent = `
      <div class="import-options">
        <p class="import-options__question">
          Loading <strong>${fileName}</strong> (${importedPagesCount} page${importedPagesCount !== 1 ? 's' : ''})
        </p>
        <p class="import-options__question">How would you like to add this?</p>
        
        <label class="import-option">
          <input type="radio" name="json-import-mode" value="append" checked />
          <div class="import-option__content">
            <span class="import-option__title">Add to the end</span>
            <span class="import-option__hint">Your current ${currentPagesCount} page${currentPagesCount !== 1 ? 's' : ''} stay untouched</span>
          </div>
        </label>
        
        <label class="import-option">
          <input type="radio" name="json-import-mode" value="merge" />
          <div class="import-option__content">
            <span class="import-option__title">Combine with existing</span>
            <span class="import-option__hint">New pages will be added, duplicates updated</span>
          </div>
        </label>
        
        <label class="import-option">
          <input type="radio" name="json-import-mode" value="replace" />
          <div class="import-option__content">
            <span class="import-option__title">Replace everything</span>
            <span class="import-option__hint import-option__hint--warning">⚠️ You'll lose your current ${currentPagesCount} page${currentPagesCount !== 1 ? 's' : ''}</span>
          </div>
        </label>

        <div class="form__actions" style="margin-top: var(--spacing-lg);">
          <button type="button" id="json-import-cancel" class="btn btn--ghost btn--flex">Cancel</button>
          <button type="button" id="json-import-confirm" class="btn btn--primary btn--flex">Import</button>
        </div>
      </div>
    `;

    // Mostrar modal usando modalManager
    log('Showing import options modal');
    const modal = this.modalManager.showCustom({
      title: 'Load Vault',
      content: modalContent,
      className: 'modal--import-json'
    });
    log('Modal created:', modal);

    // Handlers de botones
    const cancelBtn = modal.querySelector('#json-import-cancel');
    const confirmBtn = modal.querySelector('#json-import-confirm');
    log('Cancel button:', cancelBtn, 'Confirm button:', confirmBtn);

    cancelBtn.addEventListener('click', () => {
      this.modalManager.close();
    });

    confirmBtn.addEventListener('click', async () => {
      const importMode = modal.querySelector('input[name="json-import-mode"]:checked').value;
      this.modalManager.close();
      await this._applyJsonImport(importedConfig, importMode, importedPagesCount);
    });
  }

  /**
   * Aplica la importación de JSON según el modo seleccionado
   * @param {Object} importedConfig - Configuración importada
   * @param {string} importMode - Modo de importación (append, merge, replace)
   * @param {number} importedPagesCount - Número de páginas importadas
   * @private
   */
  async _applyJsonImport(importedConfig, importMode, importedPagesCount) {
    try {
      // Detectar formato del JSON importado
      const format = this.configParser.detectFormat(importedConfig);
      log(`_applyJsonImport: detected format="${format}", mode="${importMode}"`);
      
      // Si ya está en formato items[], usarlo directamente; si es legacy, convertir
      let importedCategories;
      if (format === 'items') {
        // Ya está en formato items[], usar directamente
        importedCategories = importedConfig.categories || [];
        log(`Using items format directly: ${importedCategories.length} categories`);
      } else {
        // Formato legacy, convertir a items[]
        const importedInItemsFormat = this.configParser.toItemsFormat(importedConfig);
        importedCategories = importedInItemsFormat.categories || [];
        log(`Converted from legacy format: ${importedCategories.length} categories`);
      }
      const importedPages = importedConfig.pages || [];
      log(`Imported categories:`, JSON.stringify(importedCategories.map(c => ({ name: c.name, items: c.items?.length || 0 }))));

      // Obtener config actual y convertir a formato items[]
      const currentConfig = this.config || { categories: [], pages: [] };
      const configJson = currentConfig.toJSON ? currentConfig.toJSON() : currentConfig;
      log(`Current config JSON:`, JSON.stringify(configJson).substring(0, 500));
      
      // Detectar formato de la config actual
      const currentFormat = this.configParser.detectFormat(configJson);
      log(`Current config format: ${currentFormat}`);
      
      let existingCategories;
      if (currentFormat === 'items') {
        // Ya está en formato items[], usar directamente
        existingCategories = configJson.categories || [];
      } else {
        // Formato legacy, convertir a items[]
        const existingInItemsFormat = this.configParser.toItemsFormat(configJson);
        existingCategories = existingInItemsFormat.categories || [];
      }
      const existingPages = configJson.pages || [];
      log(`Existing: ${existingCategories.length} categories, ${existingPages.length} pages`);

      let finalCategories;
      let finalPages;

      log(`Import mode selected: "${importMode}"`);
      
      switch (importMode) {
        case 'append':
          // Añadir al final
          finalCategories = [...existingCategories, ...importedCategories];
          finalPages = [...existingPages, ...importedPages];
          break;
        
        case 'merge':
          // Combinar: añadir nuevas, actualizar duplicadas por nombre
          log(`Merge: existing=${existingCategories.length} categories, imported=${importedCategories.length} categories`);
          log(`Existing categories:`, JSON.stringify(existingCategories.map(c => ({ name: c.name, items: c.items?.length || 0 }))));
          finalCategories = this._mergeCategories(existingCategories, importedCategories);
          finalPages = this._mergeRootPages(existingPages, importedPages);
          log(`Merged result: ${finalCategories.length} categories`);
          log(`Merged categories:`, JSON.stringify(finalCategories.map(c => ({ name: c.name, items: c.items?.length || 0 }))));
          break;
        
        case 'replace':
          // Reemplazar todo
          finalCategories = importedCategories;
          finalPages = importedPages;
          break;
        
        default:
          finalCategories = importedCategories;
          finalPages = importedPages;
      }

      log(`Saving config with ${finalCategories.length} categories, ${finalPages.length} pages`);
      await this.saveConfig({ categories: finalCategories, pages: finalPages });
      log('Config saved successfully');
      
      // Track analytics
      this.analyticsService.trackJSONImported(importedPagesCount);

      // Mostrar resultado
      const modeText = importMode === 'append' ? 'added' : importMode === 'merge' ? 'merged' : 'loaded';
      this.uiRenderer.showSuccessToast(
        'Vault updated',
        `${importedPagesCount} page${importedPagesCount !== 1 ? 's' : ''} ${modeText} successfully.`
      );

      // Volver a la lista
      this._goBackToList();
    } catch (err) {
      logError('Error applying JSON import:', err);
      this.uiRenderer.showErrorToast(
        'Import failed',
        err.message || 'An error occurred while importing.'
      );
    }
  }

  /**
   * Cuenta el número total de páginas en una configuración
   * Soporta tanto formato legacy (pages/categories) como nuevo (items)
   * @private
   */
  _countPagesInConfig(config) {
    let count = 0;
    
    const countInCategory = (cat) => {
      if (!cat) return;
      
      // Formato items[] (nuevo)
      if (cat.items) {
        for (const item of cat.items) {
          if (item.type === 'page' || item.url) {
            count++;
          }
          if (item.type === 'category') {
            countInCategory(item);
          }
        }
      }
      
      // Formato legacy (pages/categories)
      if (cat.pages) {
        count += cat.pages.length;
      }
      if (cat.categories) {
        for (const subcat of cat.categories) {
          countInCategory(subcat);
        }
      }
    };
    
    if (config.categories) {
      for (const cat of config.categories) {
        countInCategory(cat);
      }
    }
    
    return count;
  }

  /**
   * Combina categorías existentes con nuevas (merge)
   * Trabaja con formato items[] 
   * - Preserva páginas/subcategorías añadidas manualmente por el usuario
   * - Busca primero por ID, luego por nombre/URL
   * - Añade las nuevas que no existen
   * @private
   */
  _mergeCategories(existingCategories, newCategories) {
    // Deep clone para no mutar el original
    const result = JSON.parse(JSON.stringify(existingCategories || []));
    
    for (const newCat of newCategories) {
      // Buscar por ID primero, luego por nombre
      let existingIndex = -1;
      if (newCat.id) {
        existingIndex = result.findIndex(c => c.id === newCat.id);
      }
      if (existingIndex < 0) {
        existingIndex = result.findIndex(c => c.name === newCat.name);
      }
      
      if (existingIndex >= 0) {
        // Merge: combinar items preservando los existentes
        const existingCat = result[existingIndex];
        
        if (newCat.items) {
          if (!existingCat.items) existingCat.items = [];
          
          for (const newItem of newCat.items) {
            if (newItem.type === 'category') {
              // Subcategoría: buscar por ID primero, luego por nombre
              let existingSubcatIndex = -1;
              if (newItem.id) {
                existingSubcatIndex = existingCat.items.findIndex(i => 
                  i.type === 'category' && i.id === newItem.id
                );
              }
              if (existingSubcatIndex < 0) {
                existingSubcatIndex = existingCat.items.findIndex(i => 
                  i.type === 'category' && i.name === newItem.name
                );
              }
              
              if (existingSubcatIndex >= 0) {
                // Merge recursivo de subcategoría
                const mergedSubcat = this._mergeCategories(
                  [existingCat.items[existingSubcatIndex]], 
                  [newItem]
                )[0];
                existingCat.items[existingSubcatIndex] = mergedSubcat;
              } else {
                // Añadir nueva subcategoría
                existingCat.items.push(JSON.parse(JSON.stringify(newItem)));
              }
            } else {
              // Página: buscar por ID primero, luego por nombre/URL
              let existingItemIndex = -1;
              if (newItem.id) {
                existingItemIndex = existingCat.items.findIndex(i => 
                  i.type === 'page' && i.id === newItem.id
                );
              }
              if (existingItemIndex < 0) {
                existingItemIndex = existingCat.items.findIndex(i => {
                  if (i.type !== 'page') return false;
                  // Comparar por nombre
                  if (i.name === newItem.name) return true;
                  // Comparar por URL solo si AMBAS tienen URL (evita undefined === undefined)
                  if (i.url && newItem.url && i.url === newItem.url) return true;
                  return false;
                });
              }
              
              if (existingItemIndex >= 0) {
                // Actualizar página existente (preservar propiedades del usuario)
                existingCat.items[existingItemIndex] = { 
                  ...existingCat.items[existingItemIndex], 
                  ...newItem,
                  // Preservar ID existente y visibility
                  id: existingCat.items[existingItemIndex].id,
                  visibility: existingCat.items[existingItemIndex].visibility,
                  visibleToPlayers: existingCat.items[existingItemIndex].visibleToPlayers
                };
              } else {
                // Añadir nueva página
                existingCat.items.push(JSON.parse(JSON.stringify(newItem)));
              }
            }
          }
        }
      } else {
        // Añadir nueva categoría
        result.push(JSON.parse(JSON.stringify(newCat)));
      }
    }
    
    return result;
  }

  /**
   * Combina páginas del root existentes con nuevas
   * @param {Array} existingPages - Páginas existentes
   * @param {Array} newPages - Nuevas páginas a añadir
   * @returns {Array} - Páginas combinadas
   * @private
   */
  _mergeRootPages(existingPages, newPages) {
    // Deep clone para no mutar el original
    const result = JSON.parse(JSON.stringify(existingPages || []));
    
    for (const newPage of newPages) {
      // Buscar por ID primero, luego por nombre/URL
      let existingIndex = -1;
      if (newPage.id) {
        existingIndex = result.findIndex(p => p.id === newPage.id);
      }
      if (existingIndex < 0) {
        existingIndex = result.findIndex(p => {
          // Comparar por nombre
          if (p.name === newPage.name) return true;
          // Comparar por URL solo si AMBAS tienen URL (evita undefined === undefined)
          if (p.url && newPage.url && p.url === newPage.url) return true;
          return false;
        });
      }
      
      if (existingIndex >= 0) {
        // Actualizar página existente (preservar propiedades del usuario)
        result[existingIndex] = {
          ...result[existingIndex],
          ...newPage,
          // Preservar ID existente y visibility del usuario
          id: result[existingIndex].id,
          visibleToPlayers: result[existingIndex].visibleToPlayers
        };
      } else {
        // Añadir nueva página
        result.push(JSON.parse(JSON.stringify(newPage)));
      }
    }
    
    return result;
  }

  /**
   * Renderiza la lista de páginas de Notion
   * @private
   */
  _renderNotionPagesList(pages, container, onSelect, selectedPages = new Map()) {
    if (pages.length === 0) {
      container.innerHTML = '<div class="notion-pages-empty">No pages found. Try a different search.</div>';
      return;
    }

    container.innerHTML = '';
    
    pages.forEach(page => {
      const item = document.createElement('div');
      const isSelected = selectedPages.has(page.id);
      item.className = `notion-page-item${isSelected ? ' notion-page-item--selected' : ''}`;
      item.dataset.pageId = page.id;

      // Icono
      let iconHtml = '📄';
      if (page.icon) {
        if (page.icon.type === 'emoji') {
          iconHtml = page.icon.emoji;
        } else if (page.icon.type === 'external' && page.icon.external?.url) {
          iconHtml = `<img src="${page.icon.external.url}" alt="" />`;
        } else if (page.icon.type === 'file' && page.icon.file?.url) {
          iconHtml = `<img src="${page.icon.file.url}" alt="" />`;
        }
      }

      // Fecha
      const lastEdited = page.lastEdited 
        ? new Date(page.lastEdited).toLocaleDateString()
        : '';

      item.innerHTML = `
        <div class="notion-page-item__checkbox">
          <input type="checkbox" ${isSelected ? 'checked' : ''} />
        </div>
        <div class="notion-page-item__icon">${iconHtml}</div>
        <div class="notion-page-item__info">
          <div class="notion-page-item__title">${page.title}</div>
          ${lastEdited ? `<div class="notion-page-item__meta">Edited: ${lastEdited}</div>` : ''}
        </div>
      `;

      // Toggle selección al hacer click en el item (pero no en el checkbox)
      item.addEventListener('click', (e) => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        // Si el click fue en el checkbox, no hacer nada (el change event lo maneja)
        if (e.target.type === 'checkbox') return;
        
        const newState = !checkbox.checked;
        checkbox.checked = newState;
        item.classList.toggle('notion-page-item--selected', newState);
        onSelect(page, newState);
      });

      // Manejar click directo en el checkbox
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', (e) => {
        const newState = e.target.checked;
        item.classList.toggle('notion-page-item--selected', newState);
        onSelect(page, newState);
      });
      
      container.appendChild(item);
    });
  }

  /**
   * Toggle collapse/expand all folders
   * @private
   */
  _toggleCollapseAll(button) {
    const isCollapsed = button.dataset.collapsed === 'true';
    const newState = !isCollapsed;
    
    const icon = button.querySelector('img');
    if (icon) {
      icon.src = newState ? 'img/icon-collapse-false.svg' : 'img/icon-collapse-true.svg';
    }
    button.dataset.collapsed = newState.toString();
    button.title = newState ? 'Expand all folders' : 'Collapse all folders';

    // Colapsar/expandir todas las carpetas
    const categories = document.querySelectorAll('.category-group');
    categories.forEach(categoryDiv => {
      const contentContainer = categoryDiv.querySelector('.category-content');
      const collapseBtn = categoryDiv.querySelector('.category-collapse-button img');
      const categoryName = categoryDiv.dataset.categoryName;
      const level = categoryDiv.dataset.level;

      if (contentContainer && collapseBtn) {
        if (newState) {
          contentContainer.style.display = 'none';
          collapseBtn.src = 'img/folder-close.svg';
        } else {
          contentContainer.style.display = 'block';
          collapseBtn.src = 'img/folder-open.svg';
        }

        if (categoryName) {
          const collapseStateKey = `category-collapsed-${categoryName}-level-${level}`;
          localStorage.setItem(collapseStateKey, newState.toString());
        }
      }
    });
  }

  /**
   * Muestra el menú de añadir
   * @private
   */
  _showAddMenu(button) {
    const rect = button.getBoundingClientRect();
    
    // Remover menú y overlay existentes
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();
    const existingOverlay = document.getElementById('context-menu-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Marcar botón como activo
    button.classList.add('context-menu-active');

    // Crear overlay
    const overlay = document.createElement('div');
    overlay.id = 'context-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 9999;
      background: transparent;
    `;

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const closeMenu = () => {
      menu.remove();
      overlay.remove();
      button.classList.remove('context-menu-active');
    };

    // Click en overlay cierra el menú
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    });

    const items = [
      { icon: 'img/folder-close.svg', text: 'Add folder', action: () => this._addCategory() },
      { icon: 'img/icon-page.svg', text: 'Add page', action: () => this._addPage() }
    ];

    items.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu__item';
      menuItem.innerHTML = `<img src="${item.icon}" alt="" class="context-menu__icon"><span class="context-menu__text">${item.text}</span>`;
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
      menu.appendChild(menuItem);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    // Posicionar menú debajo del botón, hacia la izquierda
    const menuRect = menu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (top + menuRect.height > window.innerHeight) {
      top = rect.top - menuRect.height - 8;
    }

    menu.style.cssText = `position: fixed; left: ${left}px; top: ${top}px; z-index: 10000;`;
  }

  /**
   * Añade una nueva categoría
   * @private
   */
  async _addCategory() {
    // Obtener lista de carpetas para selector de padre
    const folderOptions = this._getCategoryOptions();
    
    this._showModalForm('Add Folder', [
      { name: 'name', label: 'Folder name', type: 'text', required: true, placeholder: 'Enter folder name' },
      { 
        name: 'parentFolder', 
        label: 'Parent folder', 
        type: 'select', 
        options: [{ value: '', label: '— Root level —' }, ...folderOptions],
        required: false 
      }
    ], async (data) => {
      if (!data.name) return;
      
      const newCategory = { name: data.name, pages: [], categories: [] };
      
      if (!this.config.categories) this.config.categories = [];
      
      if (data.parentFolder) {
        // Añadir dentro de una carpeta padre
        const parent = this._findCategoryByPath(data.parentFolder.split('/'));
        if (parent) {
          if (!parent.categories) parent.categories = [];
          parent.categories.push(newCategory);
        } else {
          this.config.categories.push(newCategory);
        }
      } else {
        // Añadir a nivel raíz
        this.config.categories.push(newCategory);
      }
      
      await this.saveConfig(this.config);
      this.analyticsService.trackFolderAdded(data.name);
    });
  }

  /**
   * Añade una nueva página
   * @private
   */
  async _addPage() {
    // Obtener lista de carpetas para selector
    const folderOptions = this._getCategoryOptions();
    
    // Siempre incluir opción de root level
    const allOptions = [
      { value: '', label: '— Root level —' },
      ...folderOptions
    ];
    
    this._showModalForm('Add Page', [
      { name: 'name', label: 'Page name', type: 'text', required: true, placeholder: 'Enter page name' },
      { name: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://...' },
      { 
        name: 'parentFolder', 
        label: 'Folder', 
        type: 'select', 
        options: allOptions,
        required: false 
      },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: false }
    ], async (data) => {
      if (!data.name || !data.url) return;
      
      // Crear instancia de Page
      const newPage = new Page(data.name, data.url, {
        visibleToPlayers: data.visibleToPlayers || false,
        blockTypes: null,
        icon: null,
        linkedTokenId: null
      });
      
      if (!data.parentFolder || data.parentFolder === '') {
        // Agregar al root
        if (!this.config.pages) this.config.pages = [];
        this.config.pages.push(newPage);
      } else {
        // Agregar a la carpeta seleccionada
      const parent = this._findCategoryByPath(data.parentFolder.split('/'));
      if (parent) {
        if (!parent.pages) parent.pages = [];
          parent.pages.push(newPage);
        } else {
          logError('Carpeta no encontrada:', data.parentFolder);
          return;
        }
      }
      
        await this.saveConfig(this.config);
        this.analyticsService.trackPageAdded(data.name, this._detectPageType(data.url));
    });
  }

  /**
   * Detecta el tipo de página basándose en la URL
   * @private
   */
  _detectPageType(url) {
    if (!url) return 'unknown';
    if (url.includes('notion.so') || url.includes('notion.site')) return 'notion';
    if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)) return 'image';
    if (/\.(mp4|webm|mov)$/i.test(url) || url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com')) return 'video';
    if (url.includes('docs.google.com')) return 'google_doc';
    return 'iframe';
  }

  /**
   * Obtiene opciones de carpetas para selectores
   * @private
   */
  _getCategoryOptions(categories = null, path = '') {
    const options = [];
    const cats = categories || (this.config?.categories || []);
    
    for (const cat of cats) {
      const fullPath = path ? `${path}/${cat.name}` : cat.name;
      options.push({ value: fullPath, label: path ? `${path} / ${cat.name}` : cat.name });
      
      if (cat.categories && cat.categories.length > 0) {
        options.push(...this._getCategoryOptions(cat.categories, fullPath));
      }
    }
    
    return options;
  }

  /**
   * Encuentra una categoría por su path
   * @private
   */
  _findCategoryByPath(pathParts) {
    let current = { categories: this.config.categories };
    
    for (const part of pathParts) {
      if (!current.categories) return null;
      
      // part puede ser string (nombre) o objeto {id, name}
      const catId = typeof part === 'object' ? part.id : null;
      const catName = typeof part === 'string' ? part : part.name;
      
      let found = null;
      if (catId) {
        found = current.categories.find(c => c.id === catId);
      }
      if (!found) {
        found = current.categories.find(c => c.name === catName);
      }
      
      if (!found) return null;
      current = found;
    }
    
    return current;
  }

  /**
   * Configura event handlers
   * @private
   */
  _setupEventHandlers() {
    // Inyectar dependencias
    this.eventHandlers.setDependencies({
      storageService: this.storageService,
      cacheService: this.cacheService,
      broadcastService: this.broadcastService,
      notionService: this.notionService,
      uiRenderer: this.uiRenderer,
      notionRenderer: this.notionRenderer,
      modalManager: this.modalManager,
      configBuilder: this.configBuilder
    });

    // Configurar estado
    this.eventHandlers.setState({
      config: this.config,
      isGM: this.isGM,
      roomId: this.roomId
    });

    // Configurar callbacks
    this.eventHandlers.setCallbacks({
      onConfigChange: async (newConfig) => {
        await this.saveConfig(newConfig);
      },
      onPageOpen: (page) => {
        this.openPage(page);
      }
    });

    // Conectar UI Renderer con Event Handlers
    this.uiRenderer.setCallbacks({
      // Páginas
      onPageClick: (page, categoryPath, pageIndex) => {
        this.openPage(page, categoryPath, pageIndex);
      },
      onVisibilityChange: (page, categoryPath, pageIndex, visible) => {
        this._handleVisibilityChange(page, categoryPath, pageIndex, visible);
      },
      onPageShare: (page, categoryPath, pageIndex) => {
        this._shareCurrentPageToPlayers(page);
      },
      onPageOpenModal: (page, categoryPath, pageIndex) => {
        this._openPageInModal(page);
      },
      onPageEdit: (page, categoryPath, pageIndex, newData) => {
        this._handlePageEdit(page, categoryPath, pageIndex, newData);
      },
      onPageDelete: (page, categoryPath, pageIndex) => {
        this._handlePageDelete(page, categoryPath, pageIndex);
      },
      onPageMove: (page, categoryPath, pageIndex, direction) => {
        this._handlePageMove(page, categoryPath, pageIndex, direction);
      },
      onPageDuplicate: (page, categoryPath, pageIndex) => {
        this._handlePageDuplicate(page, categoryPath, pageIndex);
      },
      // Categorías
      onCategoryEdit: (category, categoryPath) => {
        this._handleCategoryEdit(category, categoryPath);
      },
      onCategoryDelete: (category, categoryPath) => {
        this._handleCategoryDelete(category, categoryPath);
      },
      onCategoryMove: (category, categoryPath, direction) => {
        this._handleCategoryMove(category, categoryPath, direction);
      },
      onCategoryDuplicate: (category, categoryPath) => {
        this._handleCategoryDuplicate(category, categoryPath);
      },
      onAddPage: (categoryPath, roomId) => {
        this._handleAddPage(categoryPath, roomId);
      },
      onAddCategory: (categoryPath, roomId) => {
        this._handleAddCategory(categoryPath, roomId);
      },
      onShowModal: (type, options) => {
        if (type === 'edit-page' && options.page && options.categoryPath !== undefined) {
          // Usar el modal de edición completo con selector de carpeta
          this._showEditPageModalFromList(options.page, options.categoryPath, options.pageIndex);
        } else {
          this._showModalForm(options.title, options.fields, options.onSubmit);
        }
      }
    });

    // Escuchar mensajes postMessage de páginas cargadas en iframes (páginas de Obsidian)
    window.addEventListener('message', async (event) => {
      // Log para debug de todos los mensajes recibidos
      if (event.data && typeof event.data === 'object' && event.data.type) {
        log('📬 Mensaje postMessage recibido:', event.data.type, event.data);
      }
      
      // Validar origen (opcional, pero recomendado para seguridad)
      // Por ahora aceptamos cualquier origen ya que las URLs pueden variar
      
      // Responder a consulta de rol de usuario desde iframes de Obsidian Tunnel
      if (event.data && event.data.type === 'queryUserRole') {
        const isPlayer = !this.isGM;
        log('📨 Consulta de rol recibida, respondiendo:', { isPlayer, isGM: this.isGM, isCoGM: this.isCoGM });
        
        // Responder al iframe que preguntó
        if (event.source) {
          try {
            event.source.postMessage({
              type: 'setUserRole',
              isPlayer: isPlayer,
              isGM: this.isGM,
              isCoGM: this.isCoGM
            }, '*');
            log('✅ Rol enviado al iframe');
          } catch (error) {
            logError('❌ Error enviando rol al iframe:', error);
          }
        }
        return;
      }
      
      // Mostrar imagen en modal desde iframe de Obsidian Tunnel
      if (event.data && event.data.type === 'showImageModal') {
        const { imageUrl, caption } = event.data;
        log('🔍 Solicitud de mostrar imagen en modal OBR:', { imageUrl, caption });
        log('🔍 OBR disponible:', !!this.OBR);
        log('🔍 OBR.modal disponible:', !!(this.OBR && this.OBR.modal));
        
        if (imageUrl) {
          try {
            // Usar directamente OBR.modal.open para asegurar que se abre en ventana de OBR
            if (this.OBR && this.OBR.modal) {
              const currentPath = window.location.pathname;
              const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
              const baseUrl = window.location.origin + baseDir;
              
              const viewerUrl = new URL('html/image-viewer.html', baseUrl);
              viewerUrl.searchParams.set('url', encodeURIComponent(imageUrl));
              if (caption) {
                viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
              }
              
              log('🔍 Abriendo OBR.modal con URL:', viewerUrl.toString());
              await this.OBR.modal.open({
                id: 'notion-image-viewer',
                url: viewerUrl.toString(),
                height: 800,
                width: 1200
              });
              log('✅ Modal OBR abierto correctamente');
            } else {
              logError('❌ OBR.modal no disponible, abriendo en nueva ventana');
              window.open(imageUrl, '_blank', 'noopener,noreferrer');
            }
          } catch (error) {
            logError('❌ Error al abrir modal de imagen:', error);
            window.open(imageUrl, '_blank', 'noopener,noreferrer');
          }
        }
        return;
      }
      
      // Compartir imagen desde iframe de Obsidian Tunnel
      if (event.data && event.data.type === 'shareImage') {
        const { imageUrl, caption } = event.data;
        log('🖼️ Solicitud de compartir imagen recibida:', { imageUrl, caption });
        
        // Permitir compartir a todos (GM, coGM y Players)
        if (imageUrl) {
          try {
            await this._shareImageToPlayers(imageUrl, caption || '');
            log('✅ Imagen compartida con éxito');
          } catch (error) {
            logError('❌ Error al compartir imagen:', error);
          }
        }
        return;
      }
      
      if (event.data && event.data.type === 'openMentionModal') {
        const { pageId, pageName, pageUrl } = event.data;
        
        log('📨 Mensaje recibido para abrir modal:', { pageId, pageName, pageUrl });
        
        try {
          // Buscar la página en el vault
          let page = null;
          
          // Buscar por URL primero (más confiable para páginas de Obsidian)
          if (pageUrl && this.config) {
            page = this.config.findPageByUrl(pageUrl);
          }
          
          // Si no se encuentra por URL, intentar por ID
          if (!page && pageId && this.config) {
            page = this.config.findPageByNotionId(pageId) || this.config.findPageById(pageId);
          }
          
          if (page) {
            // Verificar acceso: Solo players tienen restricciones
            // GM Master y Co-GM pueden ver todas las páginas
            if (!this.isGM) {
              if (!page.visibleToPlayers) {
                log('🚫 Acceso denegado a página no visible para players:', pageId);
                this._showFeedback('🔒 This page is not available');
                return;
              }
            }
            
            log('✅ Página encontrada, abriendo modal:', page);
            await this._showMentionPageModal(page, pageName || page.name);
          } else {
            logWarn('⚠️ Página no encontrada en vault para mention:', { pageId, pageUrl });
          }
        } catch (error) {
          logError('❌ Error al abrir modal desde postMessage:', error);
        }
      }
    });
  }

  // ============================================
  // MÉTODOS PRIVADOS - DATOS
  // ============================================

  /**
   * Obtiene información del jugador
   * @private
   */
  async _fetchPlayerInfo() {
    try {
      // Verificar que OBR está disponible
      if (!this.OBR || !this.OBR.room || !this.OBR.player) {
        throw new Error('OBR SDK no disponible');
      }

      // Intentar obtener roomId (puede ser propiedad o método)
      if (this.OBR.room.id) {
        this.roomId = this.OBR.room.id;
      } else if (typeof this.OBR.room.getId === 'function') {
        this.roomId = await this.OBR.room.getId();
      } else {
        this.roomId = 'default';
      }

      // Obtener info del jugador
      if (typeof this.OBR.player.getId === 'function') {
        this.playerId = await this.OBR.player.getId();
      }
      if (typeof this.OBR.player.getName === 'function') {
        this.playerName = await this.OBR.player.getName();
      }
      
      this.isGM = await getUserRole();
      
      // Detectar si es Co-GM (GM promovido, solo lectura)
      if (this.isGM) {
        await this._detectCoGM();
      } else {
        this.isCoGM = false;
      }
      
      this.storageService.setRoomId(this.roomId);
      
      log('👤 Info del jugador:', {
        roomId: this.roomId,
        playerId: this.playerId,
        playerName: this.playerName,
        isGM: this.isGM,
        isCoGM: this.isCoGM
      });
    } catch (e) {
      logError('Error obteniendo info del jugador:', e);
      this.roomId = 'default';
      this.isGM = true; // Asumir GM por defecto
      this.isCoGM = false; // No es coGM por defecto
    }
  }

  /**
   * Detecta si el GM actual es Co-GM (solo lectura)
   * @private
   */
  async _detectCoGM() {
    try {
      const owner = await this.storageService.getVaultOwner();
      
      log('🔍 Verificando vault owner:', owner);
      
      // Si no hay owner o el owner no tiene datos válidos, no es coGM
      if (!owner || !owner.id) {
        log('👑 [Master GM] No hay vault owner válido');
        this.isCoGM = false;
        return;
      }
      
      // Verificar si soy el owner
      const isMe = owner.id === this.playerId;
      log('🔍 ¿Soy el owner?', isMe, '| Mi ID:', this.playerId, '| Owner ID:', owner.id);
      
      // Verificar si el owner está inactivo (más de 15 minutos sin heartbeat)
      const timeSinceLastActivity = Date.now() - (owner.lastHeartbeat || 0);
      const isStale = timeSinceLastActivity > OWNER_TIMEOUT;
      const minutesInactive = Math.round(timeSinceLastActivity / 60000);
      log('🔍 Owner inactivo?', isStale, '| Minutos inactivo:', minutesInactive);
      
      // Es Co-GM si hay owner válido, no soy yo, y no está inactivo
      this.isCoGM = !isMe && !isStale;
      
      if (this.isCoGM) {
        log('👁️ [Co-GM] Modo solo lectura - Master GM:', owner.name || 'Desconocido');
      } else if (isMe) {
        log('👑 [Master GM] Soy el vault owner');
      } else if (isStale) {
        log('👑 [Master GM] El vault owner anterior está inactivo (', minutesInactive, 'min)');
      }
    } catch (e) {
      logError('Error detectando Co-GM:', e);
      this.isCoGM = false;
    }
  }

  /**
   * Carga la configuración
   * @private
   */
  async _loadConfig() {
    log('📥 Cargando configuración...');
    log('🔑 Room ID:', this.roomId);
    log('🔑 Storage Key:', this.storageService.getStorageKey());

    let config = null;
    let configSource = 'none';

    // Para el Master GM: SOLO localStorage (según arquitectura, todo está en localStorage)
    // Para Co-GM: solicitar vault COMPLETO del Master GM (ve todo, pero no puede editar)
    // Para Players: room metadata (estructura visible) + broadcast para contenido
    if (this.isGM && !this.isCoGM) {
      // Master GM: cargar de localStorage
      // 1. Intentar cargar de localStorage (configuración completa del GM)
      const localConfig = this.storageService.getLocalConfig();
      if (localConfig && localConfig.categories && localConfig.categories.length > 0) {
        config = localConfig;
        configSource = 'localStorage';
        log('📦 Config de localStorage:', JSON.stringify(localConfig).substring(0, 200));
      }
      
      // 2. Si no hay en localStorage, cargar default desde URL
      // NO usar room metadata para GM (según arquitectura)
      if (!config) {
        try {
          const defaultConfig = await this._fetchDefaultConfig();
          if (defaultConfig && defaultConfig.categories && defaultConfig.categories.length > 0) {
            config = defaultConfig;
            configSource = 'defaultURL';
            // Guardar en localStorage para próximas veces
            this.storageService.saveLocalConfig(config);
            log('📦 Config default cargada desde URL');
          }
        } catch (e) {
          log('⚠️ No se pudo cargar config default:', e.message);
        }
      }
    } else if (this.isCoGM) {
      // Co-GM: solicitar vault COMPLETO del Master GM (ve todo el vault, no solo páginas visibles)
      log('👁️ Co-GM: solicitando vault completo del Master GM...');
      const gmAvailable = await this._checkGMAvailability();
      
      if (gmAvailable.isActive) {
        // Master GM activo: solicitar vault completo
        const fullConfig = await this._requestFullVaultForCoGM();
        if (fullConfig && fullConfig.categories) {
          config = fullConfig;
          configSource = 'fullVault_broadcast';
          log('✅ Co-GM: vault completo recibido');
        }
      }
      
      // Si no se pudo obtener del Master GM, intentar localStorage (sesión anterior)
      if (!config) {
        const localConfig = this.storageService.getLocalConfig();
        if (localConfig && localConfig.categories && localConfig.categories.length > 0) {
          config = localConfig;
          configSource = 'localStorage_fallback';
          log('📦 Co-GM: usando config de localStorage como fallback');
        }
      }
    } else {
      // Players: solicitar solo páginas visibles
      const gmAvailable = await this._checkGMAvailability();
      
      if (gmAvailable.isActive) {
        // GM activo: solicitar páginas visibles
        const visibleConfig = await this.broadcastService.requestVisiblePages();
        if (visibleConfig && visibleConfig.categories) {
          config = visibleConfig;
          configSource = 'broadcast';
        }
      } else {
        // GM inactivo: usar room metadata si existe
        const roomConfig = await this.storageService.getRoomConfig();
        if (roomConfig && roomConfig.categories) {
          config = roomConfig;
          configSource = 'roomMetadata';
          log('⚠️ GM inactivo, usando configuración de room metadata');
        }
      }
    }

    // Parsear y validar
    if (config) {
      const validation = this.configParser.validate(config);
      if (!validation.valid) {
        log('⚠️ Configuración inválida, migrando...');
        config = this.configParser.migrate(config);
      }
      this.config = this.configParser.parse(config);
    } else {
      // Crear configuración vacía
      log('⚠️ No se encontró configuración, creando vacía');
      this.config = ConfigBuilder.createDefault().build();
      configSource = 'empty';
    }

    this.configBuilder = new ConfigBuilder(this.config);
    
    // Actualizar config en el NotionRenderer para soporte de mentions
    this.notionRenderer.setDependencies({ config: this.config });
    
    log(`✅ Configuración cargada desde [${configSource}]:`, this.config.getTotalPageCount(), 'páginas');
  }

  /**
   * Carga la configuración por defecto desde URL
   * @private
   */
  async _fetchDefaultConfig() {
    // Primero intentar ruta relativa (funciona en producción y deploy previews)
    try {
      const response = await fetch('/public/default-config.json');
      if (response.ok) {
        const config = await response.json();
        log('✅ Configuración por defecto cargada desde ruta local');
        return config;
      }
    } catch (e) {
      log('⚠️ No se pudo cargar default-config.json desde ruta local:', e);
    }
    
    // Fallback a URL absoluta (solo si ruta local falla, ej: en Owlbear iframe)
    try {
      const response = await fetch('https://owlbear-gm-vault.netlify.app/public/default-config.json');
      if (response.ok) {
        const config = await response.json();
        log('✅ Configuración por defecto cargada desde URL absoluta (fallback)');
        return config;
      }
    } catch (e) {
      log('⚠️ No se pudo cargar desde URL absoluta');
    }
    
    return null;
  }

  // ============================================
  // MÉTODOS PRIVADOS - BROADCAST
  // ============================================

  /**
   * Configura broadcast para GM
   * @private
   */
  _setupGMBroadcast() {
    // Responder a solicitudes de contenido (acepta forceRefresh de Players/Co-GMs)
    this.broadcastService.setupGMContentResponder(async (pageId, forceRefresh = false) => {
      let html = null;
      
      // Si NO es forceRefresh, intentar obtener del caché local
      if (!forceRefresh) {
        html = this.cacheService.getHtmlFromLocalCache(pageId);
        if (html) {
          log('📦 Contenido del caché local para:', pageId);
          return html;
        }
      } else {
        // Si es forceRefresh, limpiar caché para forzar regeneración
        log('🔄 forceRefresh solicitado - limpiando caché para:', pageId);
        this.cacheService.clearPageCache(pageId);
      }
      
      // Generar contenido bajo demanda CON header (cover, título, icono)
      log(`📡 Generando contenido bajo demanda para: ${pageId}${forceRefresh ? ' (forceRefresh)' : ''}`);
      try {
        // Usar función centralizada que incluye header completo
        // useCache: false si es forceRefresh para obtener datos frescos de Notion
        const result = await this._generateNotionHtmlWithHeader(pageId, {
          includeShareButtons: false, // Players/coGM no deben ver botones de share
          useCache: !forceRefresh
        });
        
        if (result?.html) {
          html = result.html;
          // Cachear para futuras solicitudes (header + bloques)
          this.cacheService.saveHtmlToLocalCache(pageId, html);
          log('✅ Contenido con header generado y cacheado para:', pageId);
        }
      } catch (e) {
        log('⚠️ Error generando contenido bajo demanda:', e.message);
      }
      
      return html;
    });

    // Responder a solicitudes de páginas visibles
    this.broadcastService.setupGMVisiblePagesResponder(async () => {
      if (!this.config) return null;
      return filterVisiblePages(this.config.toJSON ? this.config.toJSON() : this.config);
    });

    // Responder a solicitudes de vault completo (cuando un player se promociona a GM)
    this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, async (event) => {
      const { requesterId, requesterName } = event.data;
      if (!requesterId || !this.config) return;

      log(`📤 Solicitud de vault completo de ${requesterName} (${requesterId})`);
      
      // Enviar configuración completa (solo lectura)
      const configJson = this.config.toJSON ? this.config.toJSON() : this.config;
      await this.broadcastService.sendMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, {
        requesterId,
        config: configJson
      });
      
      log('✅ Vault completo enviado');
    });

    // Configurar listeners para contenido compartido (común para todos)
    // El GM también debe recibir contenido compartido por otros (players, co-GMs)
    this._setupSharedContentListeners();
  }

  /**
   * Configura broadcast para Co-GM (modo lectura)
   * El Co-GM escucha actualizaciones del vault completo desde el Master GM
   * @private
   */
  _setupCoGMBroadcast() {
    log('👁️ Configurando broadcast para Co-GM (modo lectura)');
    
    // Escuchar actualizaciones del vault completo (no solo páginas visibles)
    // El Co-GM debe ver TODO el vault, igual que el Master GM
    this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, async (event) => {
      const { config } = event.data;
      if (config) {
        log('📥 [Co-GM] Vault completo actualizado desde Master GM');
        this.config = this.configParser.parse(config);
        await this.render();
      }
    });

    // NOTA: NO escuchamos listenForVisiblePagesUpdates para el Co-GM
    // porque el Co-GM debe ver el vault completo, no solo las páginas visibles
    // Si escucháramos ese canal, sobrescribiríamos el vault completo con solo las páginas visibles

    // Configurar listeners para contenido compartido (común para todos)
    this._setupSharedContentListeners();
  }

  /**
   * Configura broadcast para jugador
   * @private
   */
  _setupPlayerBroadcast() {
    // Escuchar actualizaciones de páginas visibles
    this.broadcastService.listenForVisiblePagesUpdates(async (config) => {
      this.config = this.configParser.parse(config);
      await this.render();
    });

    // Configurar listeners para contenido compartido (común para todos)
    this._setupSharedContentListeners();
    
    // Nota: El listener para vault completo está en _requestFullVaultOnPromotion()
    // ya que necesita esperar la respuesta antes de recargar
  }

  /**
   * Configura listeners para recibir contenido compartido
   * Estos listeners son comunes para GM, Co-GM y Player
   * @private
   */
  _setupSharedContentListeners() {
    // Listener para recibir imágenes compartidas
    this.OBR.broadcast.onMessage('com.dmscreen/showImage', async (event) => {
      const { url, caption, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (url) {
        log('🖼️ Imagen recibida:', url.substring(0, 50));
        await this._showImageModal(url, caption, false);
      }
    });

    // Listener para recibir videos compartidos
    this.OBR.broadcast.onMessage('com.dmscreen/showVideo', async (event) => {
      const { url, caption, type, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (url) {
        log('🎬 Video recibido:', url.substring(0, 50));
        await this._showVideoModal(url, caption, type || 'youtube');
      }
    });

    // Listener para recibir Google Docs compartidos
    this.OBR.broadcast.onMessage('com.dmscreen/showGoogleDoc', async (event) => {
      const { url, name, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (url) {
        log('📄 Google Doc recibido:', url.substring(0, 50));
        await this._showGoogleDocModal(url, name);
      }
    });

    // Listener para recibir contenido Notion renderizado (sin necesidad de token)
    this.OBR.broadcast.onMessage('com.dmscreen/showNotionContent', async (event) => {
      const { name, html, pageId, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (html) {
        log('📝 Contenido Notion HTML recibido');
        await this._showNotionHtmlModal(name, html);
      }
    });

    // Listener legacy para recibir páginas de Notion compartidas (requiere token)
    this.OBR.broadcast.onMessage('com.dmscreen/showNotionPage', async (event) => {
      const { url, name, pageId, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (url) {
        log('📝 Página Notion recibida:', url.substring(0, 50));
        await this._showNotionPageModal(url, name, pageId);
      }
    });

    // Listener para recibir contenido genérico compartido
    this.OBR.broadcast.onMessage('com.dmscreen/showContent', async (event) => {
      const { url, name, senderId } = event.data;
      // Ignorar si soy quien lo envió
      if (senderId === this.playerId) return;
      if (url) {
        log('🔗 Contenido recibido:', url.substring(0, 50));
        await this._showContentModal(url, name);
      }
    });
  }

  /**
   * Establece el vault ownership cuando el GM se conecta
   * @private
   */
  async _establishVaultOwnership() {
    if (!this.isGM || !this.OBR) return;

    try {
      const owner = await this.storageService.getVaultOwner();
      const myId = await this.OBR.player.getId();
      
      // Si no hay owner o el owner está inactivo, establecer como owner
      const isOwnerStale = owner && (Date.now() - (owner.lastHeartbeat || 0)) > OWNER_TIMEOUT;
      
      if (!owner || isOwnerStale || owner.id === myId) {
        // Establecer como vault owner
        await this.storageService.setVaultOwner(this.playerId, this.playerName);
        log('👑 Establecido como vault owner');
      } else {
        log('👁️ Otro GM es el vault owner:', owner.name);
      }
    } catch (e) {
      logError('Error estableciendo vault ownership:', e);
    }
  }

  /**
   * Verifica si el GM está activo (para players)
   * @returns {Promise<{isActive: boolean, owner: Object|null, minutesInactive: number}>}
   * @private
   */
  async _checkGMAvailability() {
    if (this.isGM) {
      return { isActive: true, owner: null, minutesInactive: 0 };
    }

    try {
      const owner = await this.storageService.getVaultOwner();
      
      if (!owner) {
        log('⚠️ No hay GM activo en el vault');
        return { isActive: false, owner: null, minutesInactive: 0 };
      }
      
      const timeSinceLastActivity = Date.now() - (owner.lastHeartbeat || 0);
      const isActive = timeSinceLastActivity < OWNER_TIMEOUT;
      const minutesInactive = Math.round(timeSinceLastActivity / 60000);
      
      if (!isActive) {
        log('⚠️ GM inactivo:', minutesInactive, 'minutos sin actividad');
      }
      
      return { isActive, owner, minutesInactive };
    } catch (e) {
      logError('Error verificando disponibilidad del GM:', e);
      return { isActive: false, owner: null, minutesInactive: 0 };
    }
  }

  /**
   * Muestra un mensaje cuando el GM no está activo
   * @param {string} context - Contexto de la solicitud (ej: "cargar contenido")
   * @private
   */
  async _showGMNotActiveMessage(context = '') {
    const availability = await this._checkGMAvailability();
    
    if (availability.isActive) return true;
    
    // Trackear evento de GM no activo
    this.analyticsService.trackGMNotActive();
    
    const notionContent = document.getElementById('notion-content');
    if (notionContent) {
      const minutesText = availability.minutesInactive > 0 
        ? `${availability.minutesInactive} minutos` 
        : 'un momento';
      
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👋</div>
          <p class="empty-state-text">Your GM is not active right now</p>
          <p class="empty-state-hint">Wait for them to join the session or send them a greeting!</p>
          <p class="empty-state-subhint">The content you're trying to view requires your GM to be online.</p>
          <p class="empty-state-subhint" style="opacity: 0.6; font-size: 0.9em;">
            GM inactive for ${minutesText}
          </p>
          <button class="btn btn--sm btn--secondary" onclick="window.location.reload()">
            🔄 Retry
          </button>
        </div>
      `;
    }
    
    return false;
  }

  /**
   * Inicia heartbeat del vault owner
   * @private
   */
  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.storageService.updateOwnerHeartbeat();
    }, 120000); // 2 minutos
  }

  /**
   * Inicia detección de cambio de rol
   * Cuando un player se promociona a GM, solicita todo el vault del GM anterior
   * @private
   */
  _startRoleChangeDetection() {
    let lastRole = this.isGM ? 'GM' : 'PLAYER';

    this.roleCheckInterval = setInterval(async () => {
      try {
        const currentRole = await this.OBR.player.getRole();
        
        if (lastRole !== currentRole) {
          log(`🔄 Cambio de rol detectado: ${lastRole} → ${currentRole}`);
          
          // Si un player se promociona a GM, solicitar todo el vault antes de recargar
          if (lastRole === 'PLAYER' && currentRole === 'GM') {
            log('📥 Player promocionado a GM, solicitando vault completo...');
            const received = await this._requestFullVaultOnPromotion();
            log(received ? '✅ Vault recibido, recargando...' : '⚠️ No se recibió vault, recargando...');
          }
          
          // Recargar para aplicar cambios
          window.location.reload();
        }
        
        lastRole = currentRole;
      } catch (e) {
        // Ignorar errores de conexión
      }
    }, 15000); // 15 segundos (antes 3s) para comprobar rol / co-GM
  }

  /**
   * Solicita el vault completo cuando un player se promociona a GM
   * @returns {Promise<boolean>} - true si se recibió el vault
   * @private
   */
  async _requestFullVaultOnPromotion() {
    try {
      log('📤 Solicitando vault completo al GM...');
      
      return new Promise((resolve) => {
        // Timeout de 5 segundos
        const timeout = setTimeout(() => {
          log('⏰ Timeout esperando vault completo');
          unsubscribe();
          resolve(false);
        }, 5000);
        
        // Escuchar respuesta del GM
        const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, (event) => {
          const { requesterId, config } = event.data;
          
          // Solo procesar si la respuesta es para este player
          if (requesterId === this.playerId && config) {
            clearTimeout(timeout);
            unsubscribe();
            
            log('✅ Vault completo recibido, guardando en localStorage...');
            
            // Guardar en localStorage antes de recargar
            this.storageService.saveLocalConfig(config);
            
            resolve(true);
          }
        });
        
        // Enviar solicitud
        this.broadcastService.sendMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, {
          requesterId: this.playerId,
          requesterName: this.playerName
        });
      });
    } catch (e) {
      logError('Error solicitando vault completo:', e);
      return false;
    }
  }

  /**
   * Solicita el vault completo para Co-GM (retorna config, no guarda ni recarga)
   * @returns {Promise<Object|null>} - Configuración completa o null
   * @private
   */
  async _requestFullVaultForCoGM() {
    try {
      log('📤 Co-GM: solicitando vault completo al Master GM...');
      
      return new Promise((resolve) => {
        // Timeout de 5 segundos
        const timeout = setTimeout(() => {
          log('⏰ Timeout esperando vault completo para Co-GM');
          unsubscribe();
          resolve(null);
        }, 5000);
        
        // Escuchar respuesta del Master GM
        const unsubscribe = this.OBR.broadcast.onMessage(BROADCAST_CHANNEL_RESPONSE_FULL_VAULT, (event) => {
          const { requesterId, config } = event.data;
          
          // Solo procesar si la respuesta es para este Co-GM
          if (requesterId === this.playerId && config) {
            clearTimeout(timeout);
            unsubscribe();
            
            log('✅ Co-GM: vault completo recibido del Master GM');
            
            // Retornar config directamente (no guardar en localStorage para evitar conflictos)
            resolve(config);
          }
        });
        
        // Enviar solicitud
        this.broadcastService.sendMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, {
          requesterId: this.playerId,
          requesterName: this.playerName
        });
      });
    } catch (e) {
      logError('Error solicitando vault completo para Co-GM:', e);
      return null;
    }
  }

  // ============================================
  // MÉTODOS PRIVADOS - RENDER
  // ============================================

  /**
   * Gestiona la visibilidad entre notion-content y notion-iframe
   * @param {'content' | 'iframe'} mode - Qué elemento mostrar
   * @private
   */
  _setNotionDisplayMode(mode) {
    const notionContainer = document.getElementById('notion-container');
    const notionContent = document.getElementById('notion-content');
    const notionIframe = document.getElementById('notion-iframe');
    
    if (!notionContainer) return;
    
    // Limpiar estilos inline
    if (notionContent) {
      notionContent.style.removeProperty('display');
      notionContent.style.removeProperty('visibility');
    }
    if (notionIframe) {
      notionIframe.style.removeProperty('display');
      notionIframe.style.removeProperty('visibility');
    }
    
    if (mode === 'content') {
      // Mostrar content, ocultar y limpiar iframe
      if (notionIframe) {
        notionIframe.src = 'about:blank';
        notionIframe.style.cssText = 'display: none !important; visibility: hidden !important;';
      }
      notionContainer.classList.remove('hidden');
      notionContainer.classList.add('show-content');
    } else if (mode === 'iframe') {
      // Mostrar iframe, ocultar y limpiar content
      if (notionIframe) {
        notionIframe.style.cssText = 'width: 100%; height: 100%; display: block; visibility: visible;';
      }
      if (notionContent) {
        notionContent.innerHTML = '';
      }
      notionContainer.classList.remove('hidden');
      notionContainer.classList.remove('show-content');
    }
  }

  /**
   * Renderiza una página de Notion
   * @private
   */
  async _renderNotionPage(page, pageId, forceRefresh = false) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    // Cambiar a modo content
    this._setNotionDisplayMode('content');

    // Restaurar clases originales
    notionContent.className = 'notion-container__content notion-content';

    // DEBUG: Log para verificar rol y tipo de página
    console.log('🔍 _renderNotionPage DEBUG:', {
      isGM: this.isGM,
      isCoGM: this.isCoGM,
      pageId,
      pageName: page?.name,
      pageUrl: page?.url,
      isNotionPage: page?.isNotionPage?.(),
      hasEmbeddedHtml: page?.hasEmbeddedHtml?.()
    });

    const hasUserToken = this.storageService.hasUserToken();
    
    // Verificar si hay token de default disponible (para páginas del default-config)
    const hasDefaultToken = await this.notionService._getDefaultToken();
    const hasAnyToken = hasUserToken || hasDefaultToken;
    
    // Caso 1: Co-GM o Player - SIEMPRE solicitar contenido del GM master
    // No importa si hay token default, porque ese token es para demos, no para el vault del usuario
    if (!this.isGM || this.isCoGM) {
      console.log(`👤 ${this.isCoGM ? 'Co-GM' : 'Player'} - usando broadcast, NO API de Notion`);
      await this._requestNotionContentFromGM(page, pageId, notionContent, forceRefresh);
      return;
    }
    
    console.log('👑 Master GM - usando API de Notion directamente');
    
    // Caso 2: Master GM sin ningún token - debe configurar su token
    if (!hasAnyToken) {
      log('⚠️ Master GM sin token de Notion');
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔑</div>
          <p class="empty-state-text">Notion token required</p>
          <p class="empty-state-hint">Configure your Notion token in Settings to load this content.</p>
          <button class="btn btn--sm btn--primary" onclick="document.getElementById('settings-button')?.click()">
            Open Settings
          </button>
        </div>
      `;
      return;
    }

    // Caso 3: Master GM con token (propio o default) - renderizar normalmente
    await this._renderNotionPageWithToken(page, pageId, notionContent, forceRefresh);
  }

  /**
   * Renderiza una página de Notion usando el token del usuario
   * @private
   */
  async _renderNotionPageWithToken(page, pageId, notionContent, forceRefresh = false) {
    // Asegurar que el config del NotionRenderer esté actualizado (para mentions)
    this.notionRenderer.setDependencies({ config: this.config });
    
    // Configurar useCache para bloques anidados (tablas, toggles, etc.)
    this.notionRenderer.setRenderingOptions({ useCache: !forceRefresh });
    
    // Obtener info de la página (cover, título, icono) y bloques
    // Si forceRefresh, no usar caché para ninguno
    const pageInfo = await this.notionService.fetchPageInfo(pageId, !forceRefresh);
    const blocks = await this.notionService.fetchBlocks(pageId, !forceRefresh);
    const blocksHtml = await this.notionRenderer.renderBlocks(blocks, page.blockTypes);
    
    // Construir HTML con header (cover + título)
    let headerHtml = '';
    
    // Cover image - clickeable para abrir en modal
    if (pageInfo?.cover) {
      const coverUrl = pageInfo.cover.external?.url || pageInfo.cover.file?.url;
      if (coverUrl) {
        headerHtml += `
          <div class="notion-page-cover">
            <div class="notion-image-container">
              <div class="image-loading">
                <div class="loading-spinner"></div>
              </div>
              <img src="${coverUrl}" alt="Page cover" 
                   class="notion-cover-image notion-image-clickable loaded" 
                   style="opacity: 1 !important; display: block !important;"
                   data-image-url="${coverUrl}"
                   data-image-caption=""
                   data-block-id="cover-${pageId}"
                   onload="const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove();"
                   onerror="this.style.display='none'; const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove(); if(!this.parentElement.querySelector('.notion-image-error')) { const errorDiv = document.createElement('div'); errorDiv.className='empty-state notion-image-error'; errorDiv.innerHTML='<div class=\\'empty-state-icon\\'>⚠️</div><p class=\\'empty-state-text\\'>Cover image expired</p><button class=\\'btn btn--sm btn--ghost\\' onclick=\\'window.refreshImage && window.refreshImage(this)\\'>🔄 Reload page</button>'; this.parentElement.appendChild(errorDiv); }" />
              <button class="notion-image-share-button share-button" 
                      data-image-url="${coverUrl}" 
                      data-image-caption=""
                      title="Share with room">
                <img src="img/icon-players.svg" alt="Share" />
              </button>
            </div>
          </div>
        `;
      }
    }
    
    // Extraer título de Notion (solo usar datos de Notion, no del vault)
    const notionTitle = this._extractNotionPageTitle(pageInfo);
    
    // Icono de Notion
    let iconHtml = '';
    if (pageInfo?.icon) {
      if (pageInfo.icon.type === 'emoji') {
        iconHtml = `<span class="notion-page-icon">${pageInfo.icon.emoji}</span>`;
      } else if (pageInfo.icon.external?.url) {
        iconHtml = `<img src="${pageInfo.icon.external.url}" alt="" class="notion-page-icon-img" />`;
      } else if (pageInfo.icon.file?.url) {
        iconHtml = `<img src="${pageInfo.icon.file.url}" alt="" class="notion-page-icon-img" />`;
      }
    }
    
    // Indicador de visibilidad para players - fácil de personalizar
    const visibilityIndicator = page.visibleToPlayers ? this._getVisibilityIndicator() : '';
    
    // Usar título de Notion para el contenido interno, o "Untitled" si no existe
    const notionPageTitle = notionTitle || 'Untitled';
    headerHtml += `<h1 class="notion-page-title">${iconHtml}${notionPageTitle}${visibilityIndicator}</h1>`;
    
    // Renderizar propiedades de base de datos (si las hay)
    const propertiesHtml = this.notionRenderer.renderPageProperties(pageInfo?.properties);
    
    notionContent.innerHTML = headerHtml + propertiesHtml + blocksHtml;

    // Guardar HTML en caché
    this.cacheService.saveHtmlToLocalCache(pageId, headerHtml + blocksHtml);

    // Actualizar mentions y adjuntar handlers
    this._updateMentionsInContent(notionContent);
    // Attach event handlers para imágenes (incluyendo cover)
    this._attachImageHandlers(notionContent);
  }

  /**
   * Extrae el título de una página de Notion desde pageInfo
   * @param {Object} pageInfo - Info de la página de Notion
   * @returns {string|null} - Título o null
   * @private
   */
  _extractNotionPageTitle(pageInfo) {
    if (!pageInfo || !pageInfo.properties) {
      return null;
    }
    
    // Buscar la propiedad de tipo 'title'
    for (const key in pageInfo.properties) {
      const prop = pageInfo.properties[key];
      if (prop && prop.type === 'title' && prop.title && prop.title.length > 0) {
        // Renderizar rich text del título
        return prop.title.map(t => t.plain_text || '').join('');
      }
    }
    
    return null;
  }

  /**
   * Genera el HTML completo de una página de Notion con header (cover, título, icono) + bloques
   * Esta función centraliza la lógica de generación para mantener consistencia
   * @param {string} pageId - ID de la página de Notion
   * @param {Object} options - Opciones de generación
   * @param {boolean} options.includeShareButtons - Si incluir botones de compartir (solo para GM)
   * @param {string} options.fallbackTitle - Título a usar si no se obtiene de Notion
   * @param {Array} options.blockTypes - Tipos de bloques a incluir (filtro opcional)
   * @param {boolean} options.useCache - Si usar caché (default: true)
   * @returns {Promise<{html: string, headerHtml: string, blocksHtml: string}|null>}
   * @private
   */
  async _generateNotionHtmlWithHeader(pageId, options = {}) {
    const {
      includeShareButtons = false,
      fallbackTitle = 'Untitled',
      blockTypes = null,
      useCache = true
    } = options;

    try {
      // Configurar useCache para bloques anidados (tablas, toggles, etc.)
      this.notionRenderer.setRenderingOptions({ useCache });
      
      // Obtener info de la página (cover, título, icono) y bloques
      const pageInfo = await this.notionService.fetchPageInfo(pageId, useCache);
      const blocks = await this.notionService.fetchBlocks(pageId, useCache);
      const blocksHtml = await this.notionRenderer.renderBlocks(blocks, blockTypes);
      
      // Construir HTML del header (cover + título)
      let headerHtml = '';
      
      // Cover image
      if (pageInfo?.cover) {
        const coverUrl = pageInfo.cover.external?.url || pageInfo.cover.file?.url;
        if (coverUrl) {
          const shareButtonHtml = includeShareButtons ? `
              <button class="notion-image-share-button share-button" 
                      data-image-url="${coverUrl}" 
                      data-image-caption=""
                      title="Share with room">
                <img src="img/icon-players.svg" alt="Share" />
              </button>` : '';
          
          headerHtml += `
          <div class="notion-page-cover">
            <div class="notion-image-container">
              <div class="image-loading">
                <div class="loading-spinner"></div>
              </div>
              <img src="${coverUrl}" alt="Page cover" 
                   class="notion-cover-image notion-image-clickable loaded" 
                   style="opacity: 1 !important; display: block !important;"
                   data-image-url="${coverUrl}"
                   data-image-caption=""
                   data-block-id="cover-${pageId}"
                   onload="const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove();"
                   onerror="this.style.display='none'; const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove(); if(!this.parentElement.querySelector('.notion-image-error')) { const errorDiv = document.createElement('div'); errorDiv.className='empty-state notion-image-error'; errorDiv.innerHTML='<div class=\\'empty-state-icon\\'>⚠️</div><p class=\\'empty-state-text\\'>Cover image expired</p><button class=\\'btn btn--sm btn--ghost\\' onclick=\\'window.refreshImage && window.refreshImage(this)\\'>🔄 Reload page</button>'; this.parentElement.appendChild(errorDiv); }" />${shareButtonHtml}
            </div>
          </div>
        `;
        }
      }
      
      // Extraer título de Notion
      const notionTitle = this._extractNotionPageTitle(pageInfo);
      
      // Icono de Notion
      let iconHtml = '';
      if (pageInfo?.icon) {
        if (pageInfo.icon.type === 'emoji') {
          iconHtml = `<span class="notion-page-icon">${pageInfo.icon.emoji}</span>`;
        } else if (pageInfo.icon.external?.url) {
          iconHtml = `<img src="${pageInfo.icon.external.url}" alt="" class="notion-page-icon-img" />`;
        } else if (pageInfo.icon.file?.url) {
          iconHtml = `<img src="${pageInfo.icon.file.url}" alt="" class="notion-page-icon-img" />`;
        }
      }
      
      // Título (usar de Notion o fallback)
      const pageTitle = notionTitle || fallbackTitle;
      headerHtml += `<h1 class="notion-page-title">${iconHtml}${pageTitle}</h1>`;
      
      // Renderizar propiedades de base de datos (si las hay)
      const propertiesHtml = this.notionRenderer.renderPageProperties(pageInfo?.properties);
      
      // HTML completo
      const html = headerHtml + propertiesHtml + blocksHtml;
      
      return {
        html,
        headerHtml,
        blocksHtml,
        propertiesHtml,
        pageInfo
      };
    } catch (e) {
      logError('Error generando HTML de Notion con header:', e);
      return null;
    }
  }

  /**
   * Solicita contenido de Notion al GM (para players sin token)
   * @private
   */
  async _requestNotionContentFromGM(page, pageId, notionContent, forceRefresh = false) {
    // Mostrar loading
    notionContent.innerHTML = `
      <div class="empty-state">
        <div class="loading-spinner"></div>
        <p class="empty-state-text">${forceRefresh ? 'Refreshing content...' : 'Loading content...'}</p>
        <p class="empty-state-hint">Requesting from GM...</p>
      </div>
    `;

    // Verificar si el GM está activo
    const gmAvailable = await this._checkGMAvailability();
    
    if (!gmAvailable.isActive) {
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👋</div>
          <p class="empty-state-text">Your GM is not active right now</p>
          <p class="empty-state-hint">Wait for them to join the session or send them a greeting!</p>
          <p class="empty-state-subhint">The content you're trying to view requires your GM to be online.</p>
          <button class="btn btn--sm btn--secondary" onclick="window.location.reload()">
            🔄 Retry
          </button>
        </div>
      `;
      return;
    }

    // Si NO es forceRefresh, intentar obtener del caché local primero
    if (!forceRefresh) {
      const cachedHtml = this.cacheService.getHtmlFromLocalCache(pageId);
      if (cachedHtml) {
        log('📦 Usando HTML del caché local');
        notionContent.innerHTML = cachedHtml;
        // Re-procesar mentions para asegurar que estén actualizados con el config actual
        this._updateMentionsInContent(notionContent);
        this._attachImageHandlers(notionContent);
        return;
      }
    } else {
      // Si es forceRefresh, limpiar caché local para esta página
      log('🔄 Refresh solicitado - limpiando caché local');
      this.cacheService.clearPageCache(pageId);
    }

    // Solicitar contenido al GM vía broadcast (con flag de forceRefresh)
    log(`📡 Solicitando contenido Notion al GM...${forceRefresh ? ' (forceRefresh)' : ''}`);
    const html = await this.broadcastService.requestContentFromGM(pageId, forceRefresh);
    
    if (html) {
      log('✅ Contenido recibido del GM');
      notionContent.innerHTML = html;
      // Guardar en caché local para próximas visitas
      this.cacheService.saveHtmlToLocalCache(pageId, html);
      // Actualizar mentions y adjuntar handlers
      this._updateMentionsInContent(notionContent);
      this._attachImageHandlers(notionContent);
    } else {
      // No se recibió respuesta del GM
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Content not available</p>
          <p class="empty-state-hint">The GM needs to open this page first to cache it.</p>
          <p class="empty-state-subhint">Ask your GM to view this page so you can access it.</p>
          <button class="btn btn--sm btn--secondary" onclick="window.location.reload()">
            🔄 Retry
          </button>
        </div>
      `;
    }
  }

  /**
   * Renderiza una página de imagen (abre directamente en modal OBR)
   * @private
   */
  async _renderImagePage(page) {
    // Mostrar imagen en content con opción de ampliar y compartir
    this._setNotionDisplayMode('content');
    
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    // Convertir URL si es de Google Drive
    let imageUrl = page.url;
    if (page.url.includes('drive.google.com') && page.url.includes('/file/d/')) {
      const match = page.url.match(/\/file\/d\/([^/]+)/);
      if (match) {
        imageUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w2000`;
      }
    }

    // Asegurar URL absoluta
    let absoluteImageUrl = imageUrl;
    if (imageUrl && !imageUrl.match(/^https?:\/\//i)) {
      try {
        absoluteImageUrl = new URL(imageUrl, window.location.origin).toString();
      } catch (e) {
        absoluteImageUrl = imageUrl;
      }
    }

    const caption = page.name || '';
    const escapedCaption = caption.replace(/"/g, '&quot;');

    // Agregar clase centered-content
    notionContent.classList.add('centered-content');
    
    // HTML similar al original
    notionContent.innerHTML = `
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
                  title="Share with room">
            <img src="img/icon-players.svg" alt="Share" />
          </button>
        </div>
        <p style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">Click on the image to view it full size</p>
      </div>
    `;
    
    // Handler para abrir en modal al hacer click
    const img = notionContent.querySelector('img.notion-image-clickable');
    if (img) {
      img.addEventListener('click', () => {
        this._showImageModal(absoluteImageUrl, caption);
      });
    }

    // Handler para botón de share
    const shareBtn = notionContent.querySelector('.notion-image-share-button');
    if (shareBtn) {
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._shareImageToPlayers(absoluteImageUrl, caption);
      });
    }
  }

  /**
   * Renderiza una página de Google Docs
   * @private
   */
  /**
   * Renderiza una página de video (YouTube, Vimeo)
   * @private
   */
  async _renderVideoPage(page) {
    // Mostrar contenido en notion-content (no iframe)
    this._setNotionDisplayMode('content');
    
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    const url = page.url;
    const videoType = url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'vimeo';
    
    // Extraer ID del video
    let videoId = null;
    if (videoType === 'youtube') {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
      videoId = match ? match[1] : null;
    } else if (videoType === 'vimeo') {
      const match = url.match(/vimeo\.com\/(\d+)/);
      videoId = match ? match[1] : null;
    }

    if (!videoId) {
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <p class="empty-state-text">Could not extract video ID</p>
        </div>
      `;
      return;
    }

    // Obtener thumbnail y embed URL
    const thumbnailUrl = videoType === 'youtube'
      ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      : `https://vumbnail.com/${videoId}.jpg`;
    
    const embedUrl = videoType === 'youtube'
      ? `https://www.youtube.com/embed/${videoId}?autoplay=1`
      : `https://player.vimeo.com/video/${videoId}?autoplay=1`;

    const caption = page.name || '';
    const escapedCaption = caption.replace(/"/g, '&quot;');

    notionContent.classList.add('centered-content');
    notionContent.innerHTML = `
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
            data-video-type="${videoType}"
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
            background: rgba(0, 0, 0, 0.7);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
          ">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
        <p style="color: var(--color-text-secondary); font-size: var(--font-size-sm);">Click to play video</p>
      </div>
    `;

    // Handler para abrir video en modal
    const thumbnail = notionContent.querySelector('.video-thumbnail-clickable');
    if (thumbnail) {
      thumbnail.addEventListener('click', () => {
        this._openVideoModal(embedUrl, caption, videoType);
      });
    }
  }

  /**
   * Abre un video en modal de OBR
   * @private
   */
  async _openVideoModal(embedUrl, caption, videoType) {
    if (!this.OBR || !this.OBR.modal) {
      window.open(embedUrl, '_blank');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;

      const viewerUrl = new URL('html/video-viewer.html', baseUrl);
      viewerUrl.searchParams.set('url', encodeURIComponent(embedUrl));
      viewerUrl.searchParams.set('type', videoType);
      if (caption) {
        viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
      }

      await this.OBR.modal.open({
        id: 'gm-vault-video-modal',
        url: viewerUrl.toString(),
        height: 600,
        width: 1000
      });
    } catch (e) {
      logError('Error abriendo video modal:', e);
      window.open(embedUrl, '_blank');
    }
  }

  /**
   * Comparte un video con los jugadores
   * @private
   */
  async _shareVideoToPlayers(url, caption, videoType) {
    if (!this.OBR || !this.OBR.broadcast) return;

    try {
      const result = await this.broadcastService.sendMessage('com.dmscreen/showVideo', {
        url: url,
        caption: caption || '',
        type: videoType,
        senderId: this.playerId
      });
      
      if (result?.success) {
        log('📤 Video compartido');
        this._showFeedback('🎬 Video shared!');
      } else if (result?.error !== 'size_limit') {
        this._showFeedback('❌ Error sharing video');
      }
    } catch (e) {
      logError('Error compartiendo video:', e);
      this._showFeedback('❌ Error sharing video');
    }
  }

  _renderGoogleDocPage(page) {
    // Cambiar a modo iframe
    this._setNotionDisplayMode('iframe');
    
    const notionIframe = document.getElementById('notion-iframe');
    const notionContainer = document.getElementById('notion-container');
    if (!notionIframe || !notionContainer) return;

    // Convertir URL de Google Docs a embed - extraer ID y construir URL limpia
    let embedUrl = page.url;
    
    try {
      const urlObj = new URL(page.url);
      const pathname = urlObj.pathname;
      
      // Google Slides - extraer ID y usar /embed
      if (pathname.includes('/presentation/d/')) {
        const match = pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          embedUrl = `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=false&delayms=3000`;
        }
      }
      // Google Sheets - extraer ID y usar /preview
      else if (pathname.includes('/spreadsheets/d/')) {
        const match = pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          embedUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/preview`;
        }
      }
      // Google Docs - extraer ID y usar /preview
      else if (pathname.includes('/document/d/')) {
        const match = pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          embedUrl = `https://docs.google.com/document/d/${match[1]}/preview`;
        }
      }
      // Google Drive PDF - extraer ID y usar /preview
      else if (urlObj.hostname.includes('drive.google.com') && pathname.includes('/file/d/')) {
        const match = pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
          embedUrl = `https://drive.google.com/file/d/${match[1]}/preview`;
        }
      }
    } catch (e) {
      log('Error parsing Google URL, using original:', e);
    }

    log('📄 Loading Google Doc:', embedUrl);
    notionIframe.src = embedUrl;
    notionIframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:var(--radius-lg)';
    
    // El botón de share está ahora en el header
  }

  /**
   * Comparte un Google Doc con los jugadores
   * @private
   */
  async _shareGoogleDocToPlayers(url, name) {
    if (!this.OBR || !this.OBR.broadcast) return;

    try {
      const result = await this.broadcastService.sendMessage('com.dmscreen/showGoogleDoc', {
        url: url,
        name: name || '',
        senderId: this.playerId
      });
      
      if (result?.success) {
        log('📤 Google Doc compartido');
        this._showFeedback('📄 Document shared!');
      } else if (result?.error !== 'size_limit') {
        this._showFeedback('❌ Error sharing document');
      }
    } catch (e) {
      logError('Error compartiendo documento:', e);
      this._showFeedback('❌ Error sharing document');
    }
  }

  /**
   * Renderiza una página HTML de demo (content-demo) con estilo Notion
   * @private
   */
  /**
   * Renderiza una página con HTML embebido (local-first, desde Obsidian)
   * @private
   */
  async _renderEmbeddedHtmlPage(page) {
    this._setNotionDisplayMode('content');
    
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    try {
      // El htmlContent ya viene pre-renderizado con estilos de Notion
      notionContent.innerHTML = page.htmlContent;
      
      // Guardar en caché para players
      if (this.isGM && !this.isCoGM) {
        // Generar un ID único para la página (basado en nombre)
        const pageId = `embedded-${page.name.toLowerCase().replace(/\s+/g, '-')}`;
        this.cacheService.saveHtmlToLocalCache(pageId, page.htmlContent);
      }
      
      log('✅ Renderizado HTML embebido para:', page.name);
    } catch (e) {
      logError('Error renderizando HTML embebido:', e);
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Error loading embedded content</p>
          <p class="empty-state-hint">${e.message}</p>
        </div>
      `;
    }
  }

  async _renderDemoHtmlPage(page) {
    this._setNotionDisplayMode('content');
    
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    // Mostrar loading
    notionContent.innerHTML = `
      <div class="empty-state notion-loading">
        <div class="empty-state-icon">⏳</div>
        <p class="empty-state-text">Loading content</p>
        <p class="empty-state-hint">Fetching demo content...</p>
      </div>
    `;

    try {
      // Extraer solo la ruta del archivo, ignorando cualquier dominio
      // Esto evita problemas de CORS cuando la URL apunta a otro dominio (ej: producción vs preview)
      let fetchUrl = page.url;
      
      // Si la URL contiene un dominio, extraer solo la ruta relativa
      if (fetchUrl.startsWith('http')) {
        try {
          const urlObj = new URL(fetchUrl);
          // Usar solo pathname para evitar CORS entre dominios
          fetchUrl = urlObj.pathname;
        } catch {
          // Si falla el parsing, usar la URL original
        }
      }
      
      // Asegurar que comienza con /
      if (!fetchUrl.startsWith('/')) {
        fetchUrl = '/' + fetchUrl;
      }
      
      log('📄 Cargando demo HTML desde:', fetchUrl);
      
      // Fetch del archivo HTML (usando ruta relativa al origen actual)
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Error loading demo HTML: ${response.status}`);
      }
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extraer solo el contenido del div #notion-content si existe
      const demoContent = doc.querySelector('#notion-content');
      
      if (demoContent) {
        // Copiar el contenido HTML directamente
        notionContent.innerHTML = demoContent.innerHTML;
        
        // Copiar estilos si existen
        const styles = doc.querySelectorAll('style');
        styles.forEach(style => {
          const styleElement = document.createElement('style');
          styleElement.textContent = style.textContent;
          document.head.appendChild(styleElement);
        });
      } else {
        // Si no hay #notion-content, usar todo el body
        const bodyContent = doc.body;
        if (bodyContent) {
          notionContent.innerHTML = bodyContent.innerHTML;
        }
      }
      
      // Agregar título con indicador de visibilidad si aplica
      const visibilityIndicator = page.visibleToPlayers ? this._getVisibilityIndicator() : '';
      const pageName = page.name || 'Untitled';
      const titleHtml = `<h1 class="notion-page-title">${pageName}${visibilityIndicator}</h1>`;
      notionContent.insertAdjacentHTML('afterbegin', titleHtml);
      
      log('✅ Demo HTML cargado correctamente');
      
    } catch (e) {
      logError('Error cargando demo HTML:', e);
      notionContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Error loading content</p>
          <p class="empty-state-hint">${e.message}</p>
        </div>
      `;
    }
  }

  /**
   * Renderiza una página externa (iframe)
   * @private
   */
  _renderExternalPage(page) {
    // Cambiar a modo iframe
    this._setNotionDisplayMode('iframe');
    
    const notionIframe = document.getElementById('notion-iframe');
    if (!notionIframe) return;

    // Validar URL
    if (!page.url) {
      log('⚠️ _renderExternalPage: URL is undefined');
      this._setNotionDisplayMode('content');
      const notionContent = document.getElementById('notion-content');
      if (notionContent) {
        notionContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <p class="empty-state-text">Error loading page</p>
            <p class="empty-state-hint">No URL was provided</p>
          </div>
        `;
      }
      return;
    }

    notionIframe.src = page.url;
    notionIframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:var(--radius-lg)';
    notionIframe.allowFullscreen = true;
  }

  /**
   * Attach event handlers para imágenes
   * @private
   */
  _attachImageHandlers(container = null) {
    const targetContainer = container || document.getElementById('notion-content');
    if (!targetContainer) return;

    const images = targetContainer.querySelectorAll('.notion-image-clickable');
    
    images.forEach(img => {
      if (img.dataset.listenerAdded) return;
      img.dataset.listenerAdded = 'true';
      
      img.addEventListener('click', () => {
        const url = img.dataset.imageUrl;
        const caption = img.dataset.imageCaption;
        this._showImageModal(url, caption);
      });
    });

    const shareButtons = targetContainer.querySelectorAll('.notion-image-share-button');
    
    shareButtons.forEach(btn => {
      if (btn.dataset.listenerAdded) return;
      btn.dataset.listenerAdded = 'true';
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.imageUrl;
        const caption = btn.dataset.imageCaption;
        this._shareImageToPlayers(url, caption);
      });
    });
    
    // También adjuntar handlers para mentions
    this._attachMentionHandlers(targetContainer);
  }

  /**
   * Actualiza los mentions en el contenido cacheado para hacerlos clickeables si están en el vault
   * @private
   */
  _updateMentionsInContent(container = null) {
    const targetContainer = container || document.getElementById('notion-content');
    if (!targetContainer || !this.config) return;

    // Buscar todos los mentions que están como texto plano (notion-mention--plain)
    // Ahora todos los mentions tienen data-mention-page-id gracias al renderer actualizado
    const plainMentions = targetContainer.querySelectorAll('.notion-mention--plain[data-mention-page-id]');
    
    let updatedCount = 0;
    plainMentions.forEach(mention => {
      const mentionedPageId = mention.dataset.mentionPageId;
      if (!mentionedPageId) return;

      // Verificar si la página ahora está en el vault
      const pageInVault = this.config.findPageByNotionId(mentionedPageId);
      if (!pageInVault) return;

      // Verificar visibilidad solo para players (GM Master y Co-GM pueden ver todo)
      if (!this.isGM && pageInVault.visibleToPlayers !== true) {
        return; // No hacer clickeable si no es visible para players
      }

      // Convertir a mention clickeable
      // Priorizar nombre del vault sobre el textContent ya que la API a veces devuelve "Untitled"
      const apiDisplayName = mention.textContent || mention.dataset.mentionPageName || 'Page';
      const displayName = pageInVault.name || apiDisplayName;
      const pageUrl = pageInVault.url || '';
      
      mention.className = 'notion-mention notion-mention--link';
      mention.setAttribute('data-mention-page-id', mentionedPageId);
      mention.setAttribute('data-mention-page-name', displayName);
      mention.setAttribute('data-mention-page-url', pageUrl);
      mention.setAttribute('role', 'button');
      mention.setAttribute('tabindex', '0');
      
      // Actualizar el texto visible si el nombre del vault es diferente al de la API
      // (la API a veces devuelve "Untitled" aunque la página tenga título)
      if (displayName !== apiDisplayName) {
        mention.textContent = displayName;
      }
      
      updatedCount++;
    });
    
    if (updatedCount > 0) {
      log(`🔗 ${updatedCount} mention(s) actualizado(s) a clickeable(s) desde caché`);
      // Re-adjuntar handlers para los nuevos mentions clickeables
      this._attachMentionHandlers(targetContainer);
    }
  }

  /**
   * Attach event handlers para mentions de página (@Page)
   * @private
   */
  _attachMentionHandlers(container = null) {
    const targetContainer = container || document.getElementById('notion-content');
    if (!targetContainer) return;

    const mentions = targetContainer.querySelectorAll('.notion-mention--link');
    
    mentions.forEach(mention => {
      if (mention.dataset.listenerAdded) return;
      mention.dataset.listenerAdded = 'true';
      
      // Click handler
      mention.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const pageId = mention.dataset.mentionPageId;
        const pageName = mention.dataset.mentionPageName;
        const pageUrl = mention.dataset.mentionPageUrl;
        
        // Solo necesitamos pageId para abrir la página (pageUrl puede estar vacío)
        if (pageId) {
          await this._openMentionedPage(pageId, pageName, pageUrl, mention);
        }
      });
      
      // Keyboard handler (Enter/Space for accessibility)
      mention.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          
          const pageId = mention.dataset.mentionPageId;
          const pageName = mention.dataset.mentionPageName;
          const pageUrl = mention.dataset.mentionPageUrl;
          
          // Solo necesitamos pageId para abrir la página (pageUrl puede estar vacío)
          if (pageId) {
            await this._openMentionedPage(pageId, pageName, pageUrl, mention);
          }
        }
      });
    });
  }

  /**
   * Abre una página mencionada en un modal
   * @private
   */
  async _openMentionedPage(pageId, pageName, pageUrl, mentionElement) {
    // Mostrar estado loading en el mention (si existe el elemento)
    if (mentionElement) {
      mentionElement.classList.add('notion-mention--loading');
    }
    
    try {
      // Buscar la página en el vault
      // 1. Por NotionId (para páginas de Notion)
      // 2. Por id interno (para páginas locales/Obsidian)
      // 3. Por nombre (fallback para mentions de Obsidian)
      let page = this.config?.findPageByNotionId(pageId);
      if (!page) {
        page = this.config?.findPageById(pageId);
      }
      if (!page && pageName) {
        // Buscar por nombre (útil para mentions de Obsidian que usan el nombre de la página)
        page = this.config?.findPageByName(pageName);
      }
      
      if (!page) {
        log('⚠️ Página no encontrada en vault:', { pageId, pageName });
        if (mentionElement) {
          mentionElement.classList.remove('notion-mention--loading');
        }
        this._showFeedback('⚠️ Page not found in vault');
        return;
      }
      
      // Verificar acceso: Solo players tienen restricciones
      // GM Master y Co-GM pueden ver todas las páginas
      if (!this.isGM) {
        if (!page.visibleToPlayers) {
          log('🚫 Acceso denegado a página no visible para players:', pageId);
          this._showFeedback('🔒 This page is not available');
          if (mentionElement) {
            mentionElement.classList.remove('notion-mention--loading');
          }
          return;
        }
      }
      
      // Abrir el modal con la página
      await this._showMentionPageModal(page, pageName);
      
    } catch (error) {
      logError('Error al abrir página mencionada:', error);
    } finally {
      if (mentionElement) {
        mentionElement.classList.remove('notion-mention--loading');
      }
    }
  }

  /**
   * Recarga el contenido de un modal de mention existente
   * @param {HTMLElement} overlay - El overlay del modal
   * @param {HTMLElement} content - El contenedor de contenido
   * @private
   */
  async _reloadMentionModalContent(overlay, content) {
    const notionPageId = overlay.dataset.notionPageId;
    const displayName = overlay.dataset.displayName;
    const page = overlay._mentionModalPage;
    
    if (!notionPageId || !page) {
      log('⚠️ No se puede recargar modal: datos faltantes');
      return;
    }
    
    // Mostrar loading
    content.innerHTML = `
      <div class="empty-state mention-modal__loading">
        <div class="empty-state-icon">⏳</div>
        <p class="empty-state-text">Reloading page...</p>
        <p class="empty-state-hint">Please wait while we reload the content</p>
      </div>
    `;
    
    try {
      // Limpiar caché de esta página
      this.cacheService.clearPageCache(notionPageId);
      
      // Configurar renderer para modo modal (mentions no clickeables)
      this.notionRenderer.setRenderingOptions({ isInModal: true });
      
      let htmlContent = null;
      
      // Master GM: usar API de Notion directamente
      if (this.isGM && !this.isCoGM) {
        const result = await this._generateNotionHtmlWithHeader(notionPageId, {
          includeShareButtons: true,
          fallbackTitle: displayName,
          useCache: false // Forzar recarga sin caché
        });
        htmlContent = result?.html;
      } else {
        // CoGM y Players: solicitar contenido al GM
        const gmAvailable = await this._checkGMAvailability();
        
        if (!gmAvailable.isActive) {
          content.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">👋</div>
              <p class="empty-state-text">The GM is not active</p>
              <p class="empty-state-hint">Wait for the GM to join the session to view this page</p>
            </div>
          `;
          return;
        }
        
        // Solicitar contenido al GM vía broadcast (sin caché)
        htmlContent = await this.broadcastService.requestContentFromGM(notionPageId);
        
        if (htmlContent) {
          // Guardar en caché local
          this.cacheService.saveHtmlToLocalCache(notionPageId, htmlContent);
        }
      }
      
      if (!htmlContent) {
        content.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⏳</div>
            <p class="empty-state-text">Content not available</p>
            <p class="empty-state-hint">The GM needs to open this page first to cache it.</p>
          </div>
        `;
        return;
      }
      
      // Mostrar contenido
      content.innerHTML = `<div class="notion-content mention-modal__notion-content">${htmlContent}</div>`;
      
      // Adjuntar handlers de imágenes
      const images = content.querySelectorAll('.notion-image-clickable');
      images.forEach(img => {
        if (img.dataset.listenerAdded) return;
        img.dataset.listenerAdded = 'true';
        img.addEventListener('click', () => {
          const url = img.dataset.imageUrl;
          const caption = img.dataset.imageCaption;
          this._showImageModal(url, caption);
        });
      });
      
    } catch (error) {
      logError('Error recargando contenido del modal:', error);
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Error reloading page</p>
          <p class="empty-state-hint">${error.message || 'Unknown error'}</p>
        </div>
      `;
    } finally {
      this.notionRenderer.setRenderingOptions({ isInModal: false });
    }
  }

  /**
   * Muestra un modal con el contenido de una página mencionada
   * @private
   */
  async _showMentionPageModal(page, displayName) {
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.className = 'mention-modal-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', `Page: ${displayName}`);
    
    // Guardar referencia a page y displayName para poder recargar el modal
    const notionPageId = page.getNotionPageId();
    if (notionPageId) {
      overlay.dataset.notionPageId = notionPageId;
      overlay.dataset.displayName = displayName;
      // Guardar referencia al page object (serializado)
      overlay._mentionModalPage = page;
    }
    
    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'mention-modal';
    
    // Header del modal
    const header = document.createElement('div');
    header.className = 'mention-modal__header';
    
    const title = document.createElement('h2');
    title.className = 'mention-modal__title';
    title.textContent = displayName;
    
    // Botón de compartir (solo para GM y coGM)
    // TODO: Temporalmente oculto - descomentar cuando se necesite
    // let shareBtn = null;
    // if (this.isGM) {
    //   shareBtn = document.createElement('button');
    //   shareBtn.className = 'mention-modal__share icon-button';
    //   shareBtn.innerHTML = '<img src="img/icon-players.svg" class="icon-button-icon" alt="Share" />';
    //   shareBtn.setAttribute('aria-label', 'Share with players');
    //   shareBtn.title = 'Share with players';
    // }
    let shareBtn = null;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mention-modal__close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close modal');
    closeBtn.title = 'Close (Escape)';
    
    header.appendChild(title);
    // if (shareBtn) header.appendChild(shareBtn);
    header.appendChild(closeBtn);
    
    // Contenido del modal - inicialmente con loading state
    const content = document.createElement('div');
    content.className = 'mention-modal__content';
    content.innerHTML = `
      <div class="empty-state mention-modal__loading">
        <div class="empty-state-icon">⏳</div>
        <p class="empty-state-text">Loading page...</p>
        <p class="empty-state-hint">Please wait while we load the content</p>
      </div>
    `;
    
    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Funciones de cierre
    const closeModal = () => {
      overlay.classList.add('mention-modal-overlay--closing');
      modal.classList.add('mention-modal--closing');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    };
    
    // Event listeners para cerrar
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    
    // Escape para cerrar
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Focus trap
    closeBtn.focus();
    
    // Animación de entrada
    requestAnimationFrame(() => {
      overlay.classList.add('mention-modal-overlay--visible');
      modal.classList.add('mention-modal--visible');
    });
    
    try {
      // Configurar renderer para modo modal (mentions no clickeables)
      this.notionRenderer.setRenderingOptions({ isInModal: true });
      
      let htmlContent = null;
      
      // Caso 1: Página con HTML embebido (local-first, Obsidian)
      if (page.hasEmbeddedHtml()) {
        log('📄 Mention: página con HTML embebido (local-first)');
        // Usar el HTML embebido directamente
        htmlContent = page.htmlContent;
      }
      // Caso 2: Página con URL externa (Obsidian Tunnel) - cargar en iframe
      else if (page.url && !page.getNotionPageId()) {
        log('🔗 Mention: página con URL externa, cargando en iframe:', page.url);
        const iframe = document.createElement('iframe');
        // Añadir parámetro inModal=true para que el iframe sepa que está en modal desde el inicio
        const modalUrl = new URL(page.url, window.location.origin);
        modalUrl.searchParams.set('inModal', 'true');
        iframe.src = modalUrl.toString();
        iframe.className = 'mention-modal__iframe';
        iframe.style.cssText = 'width: 100%; height: 100%; border: none; min-height: 500px;';
        iframe.title = displayName;
        
        // Cuando el iframe cargue, enviar información sobre el rol del usuario
        iframe.onload = () => {
          // Pequeño delay para asegurar que el script del iframe esté listo
          setTimeout(() => {
            try {
              // Enviar mensaje al iframe indicando si es Player (no GM)
              // También indicar que está en un modal (para deshabilitar navegación)
              const isPlayer = !this.isGM;
              log('📤 Enviando rol de usuario al iframe (modal):', { isPlayer, isGM: this.isGM, isCoGM: this.isCoGM, isInModal: true });
              iframe.contentWindow.postMessage({
                type: 'setUserRole',
                isPlayer: isPlayer,
                isGM: this.isGM,
                isCoGM: this.isCoGM,
                isInModal: true // Indica que está en un modal, deshabilitar navegación
              }, '*');
              log('✅ Mensaje enviado al iframe');
            } catch (error) {
              logError('❌ Error enviando rol al iframe:', error);
            }
          }, 100);
        };
        
        content.innerHTML = '';
        content.appendChild(iframe);
        return;
      }
      // Caso 3: Página de Notion (necesita API o broadcast)
      else {
        const notionPageId = page.getNotionPageId();
        
        if (!notionPageId) {
          content.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">⚠️</div>
              <p class="empty-state-text">Cannot load page</p>
              <p class="empty-state-hint">Invalid page ID</p>
            </div>
          `;
          return;
        }
        
        // Master GM: usar API de Notion directamente
        // CoGM y Players: solicitar contenido vía broadcast
        if (this.isGM && !this.isCoGM) {
          // Master GM: generar contenido con header completo
          const result = await this._generateNotionHtmlWithHeader(notionPageId, {
            includeShareButtons: true,
            fallbackTitle: displayName,
            useCache: true
          });
          htmlContent = result?.html;
        } else {
          // CoGM y Players: solicitar contenido al GM
          log('👤 Co-GM/Player: solicitando contenido de mention al GM...');
          
          // Verificar si el GM está activo
          const gmAvailable = await this._checkGMAvailability();
          
          if (!gmAvailable.isActive) {
            content.innerHTML = `
              <div class="empty-state">
                <div class="empty-state-icon">👋</div>
                <p class="empty-state-text">The GM is not active</p>
                <p class="empty-state-hint">Wait for the GM to join the session to view this page</p>
                <button class="btn btn--sm btn--secondary mention-modal__retry-btn">
                  🔄 Retry
                </button>
              </div>
            `;
            // Añadir handler para retry
            const retryBtn = content.querySelector('.mention-modal__retry-btn');
            if (retryBtn) {
              retryBtn.addEventListener('click', () => {
                closeModal();
                this._openMentionedPage(notionPageId, displayName, null, null);
              });
            }
            return;
          }
          
          // Intentar obtener del caché local primero
          const cachedHtml = this.cacheService.getHtmlFromLocalCache(notionPageId);
          if (cachedHtml) {
            log('📦 Mention: usando HTML del caché local');
            htmlContent = cachedHtml;
          } else {
            // Solicitar contenido al GM vía broadcast
            log('📡 Mention: solicitando contenido al GM...');
            htmlContent = await this.broadcastService.requestContentFromGM(notionPageId);
            
            if (htmlContent) {
              log('✅ Mention: contenido recibido del GM');
              // Guardar en caché local para próximas visitas
              this.cacheService.saveHtmlToLocalCache(notionPageId, htmlContent);
            }
          }
          
          // Si no hay contenido disponible
          if (!htmlContent) {
            content.innerHTML = `
              <div class="empty-state">
                <div class="empty-state-icon">⏳</div>
                <p class="empty-state-text">Content not available</p>
                <p class="empty-state-hint">The GM needs to open this page first to cache it.</p>
                <p class="empty-state-subhint">Ask your GM to view this page so you can access it.</p>
                <button class="btn btn--sm btn--secondary mention-modal__retry-btn">
                  🔄 Retry
                </button>
              </div>
            `;
            // Añadir handler para retry
            const retryBtn = content.querySelector('.mention-modal__retry-btn');
            if (retryBtn) {
              retryBtn.addEventListener('click', () => {
                closeModal();
                this._openMentionedPage(notionPageId, displayName, null, null);
              });
            }
            return;
          }
        }
      }
      
      if (!htmlContent) {
        content.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📄</div>
            <p class="empty-state-text">Empty page</p>
            <p class="empty-state-hint">This page has no content</p>
          </div>
        `;
        return;
      }
      
      // Mostrar contenido con header completo (cover, título, icono, propiedades, bloques)
      content.innerHTML = `<div class="notion-content mention-modal__notion-content">${htmlContent}</div>`;
      
      // Adjuntar handlers de imágenes PERO NO de mentions (evita navegación infinita)
      const images = content.querySelectorAll('.notion-image-clickable');
      images.forEach(img => {
        if (img.dataset.listenerAdded) return;
        img.dataset.listenerAdded = 'true';
        img.addEventListener('click', () => {
          const url = img.dataset.imageUrl;
          const caption = img.dataset.imageCaption;
          this._showImageModal(url, caption);
        });
      });
      
      // Handler para compartir (si existe el botón)
      // TODO: Temporalmente oculto - descomentar cuando se necesite
      // if (shareBtn) {
      //   shareBtn.addEventListener('click', async () => {
      //     try {
      //       // Clonar el contenido y remover botones de compartir
      //       const clone = content.cloneNode(true);
      //       clone.querySelectorAll('.share-button, .notion-image-share-button, .video-share-button').forEach(el => el.remove());
      //       const htmlContent = clone.innerHTML;
      //       
      //       if (!htmlContent.trim()) {
      //         this._showFeedback('⚠️ No content to share');
      //         return;
      //       }
      //       
      //       // Enviar el HTML renderizado
      //       const result = await this.broadcastService.sendMessage('com.dmscreen/showNotionContent', {
      //         name: displayName,
      //         html: htmlContent,
      //         pageId: notionPageId,
      //         senderId: this.playerId
      //       });
      //       
      //       if (result?.success) {
      //         this._showFeedback('📄 Page shared!');
      //         // Feedback visual temporal en el botón
      //         shareBtn.classList.add('shared');
      //         shareBtn.title = 'Shared!';
      //         setTimeout(() => {
      //           shareBtn.classList.remove('shared');
      //           shareBtn.title = 'Share with players';
      //         }, 2000);
      //       } else if (result?.error !== 'size_limit') {
      //         this._showFeedback('❌ Error sharing page');
      //       }
      //     } catch (e) {
      //       logError('Error compartiendo página desde modal:', e);
      //       this._showFeedback('❌ Error sharing page');
      //     }
      //   });
      // }
      
    } catch (error) {
      logError('Error cargando página en modal:', error);
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Error loading page</p>
          <p class="empty-state-hint">${error.message || 'Unknown error'}</p>
        </div>
      `;
    } finally {
      // Restaurar modo normal del renderer
      this.notionRenderer.setRenderingOptions({ isInModal: false });
    }
  }

  /**
   * Muestra un modal con la imagen ampliada usando OBR.modal
   * @param {string} imageUrl - URL de la imagen
   * @param {string} caption - Texto del caption (opcional)
   * @param {boolean} showShareButton - Mostrar botón de compartir (default: true para GM)
   * @private
   */
  async _showImageModal(imageUrl, caption, showShareButton = true) {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      // Fallback: abrir en nueva ventana
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      // Asegurarse de que imageUrl sea una URL absoluta
      let absoluteImageUrl = imageUrl;
      if (imageUrl && !imageUrl.match(/^https?:\/\//i)) {
        try {
          absoluteImageUrl = new URL(imageUrl, window.location.origin).toString();
        } catch (e) {
          log('No se pudo construir URL absoluta, usando original:', imageUrl);
          absoluteImageUrl = imageUrl;
        }
      }
      
      // Construir URL del viewer
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      const viewerUrl = new URL('html/image-viewer.html', baseUrl);
      viewerUrl.searchParams.set('url', encodeURIComponent(absoluteImageUrl));
      if (caption) {
        viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
      }
      // Mostrar botón de compartir solo si es GM y showShareButton es true
      // El viewer usa el parámetro 'share' (default true si no se especifica)
      if (!(showShareButton && this.isGM)) {
        viewerUrl.searchParams.set('share', 'false');
      }
      
      // Abrir modal usando Owlbear SDK
      await this.OBR.modal.open({
        id: 'notion-image-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de Owlbear:', error);
      // Fallback: abrir en nueva ventana
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Comparte una imagen con los jugadores via broadcast
   * @private
   */
  async _shareImageToPlayers(url, caption) {
    if (!this.OBR || !this.OBR.broadcast) {
      logError('OBR.broadcast no disponible');
      return;
    }

    try {
      // Asegurarse de que la URL sea absoluta
      let absoluteImageUrl = url;
      if (url && !url.match(/^https?:\/\//i)) {
        try {
          absoluteImageUrl = new URL(url, window.location.origin).toString();
        } catch (e) {
          absoluteImageUrl = url;
        }
      }

      // Usar el canal correcto como en el original
      const result = await this.broadcastService.sendMessage('com.dmscreen/showImage', {
        url: absoluteImageUrl,
        caption: caption || '',
        senderId: this.playerId
      });
      
      if (result?.success) {
        log('📤 Imagen compartida:', absoluteImageUrl.substring(0, 80));
        this._showFeedback('📸 Image shared!');
        this.analyticsService.trackImageShare(absoluteImageUrl);
      } else if (result?.error !== 'size_limit') {
        this._showFeedback('❌ Error sharing image');
      }
    } catch (e) {
      logError('Error compartiendo imagen:', e);
      this._showFeedback('❌ Error sharing image');
    }
  }

  /**
   * Muestra un modal con video usando OBR.modal
   * @param {string} videoUrl - URL del video
   * @param {string} caption - Caption opcional
   * @param {string} videoType - 'youtube' o 'vimeo'
   * @private
   */
  async _showVideoModal(videoUrl, caption, videoType = 'youtube') {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      window.open(videoUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      const viewerUrl = new URL('html/video-viewer.html', baseUrl);
      viewerUrl.searchParams.set('url', encodeURIComponent(videoUrl));
      viewerUrl.searchParams.set('type', videoType);
      if (caption) {
        viewerUrl.searchParams.set('caption', encodeURIComponent(caption));
      }
      
      await this.OBR.modal.open({
        id: 'notion-video-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de video:', error);
      window.open(videoUrl, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Muestra un modal con Google Doc usando OBR.modal
   * @param {string} docUrl - URL del documento
   * @param {string} name - Nombre del documento
   * @private
   */
  async _showGoogleDocModal(docUrl, name) {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      window.open(docUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      const viewerUrl = new URL('html/google-doc-viewer.html', baseUrl);
      viewerUrl.searchParams.set('url', encodeURIComponent(docUrl));
      if (name) {
        viewerUrl.searchParams.set('name', encodeURIComponent(name));
      }
      
      await this.OBR.modal.open({
        id: 'notion-google-doc-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de Google Doc:', error);
      window.open(docUrl, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Muestra un modal con página de Notion usando OBR.modal
   * @param {string} url - URL de la página
   * @param {string} name - Nombre de la página
   * @param {string} pageId - ID de la página de Notion
   * @private
   */
  async _showNotionPageModal(url, name, pageId) {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      const viewerUrl = new URL('index.html', baseUrl);
      viewerUrl.searchParams.set('modal', 'true');
      viewerUrl.searchParams.set('url', encodeURIComponent(url));
      if (name) {
        viewerUrl.searchParams.set('name', encodeURIComponent(name));
      }
      
      await this.OBR.modal.open({
        id: 'gm-vault-notion-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de Notion:', error);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Muestra un modal con HTML de Notion pre-renderizado (no requiere token)
   * @param {string} name - Nombre del contenido
   * @param {string} html - HTML renderizado
   * @private
   */
  async _showNotionHtmlModal(name, html) {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      // Crear URL con el HTML codificado
      const viewerUrl = new URL('index.html', baseUrl);
      viewerUrl.searchParams.set('modal', 'true');
      viewerUrl.searchParams.set('htmlContent', 'true');
      if (name) {
        viewerUrl.searchParams.set('name', encodeURIComponent(name));
      }
      
      // Guardar el HTML en sessionStorage para recuperarlo en la modal
      // Esto evita problemas con URLs muy largas
      const contentKey = 'gm-vault-shared-content-' + Date.now();
      sessionStorage.setItem(contentKey, html);
      viewerUrl.searchParams.set('contentKey', contentKey);
      
      await this.OBR.modal.open({
        id: 'gm-vault-html-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de HTML:', error);
    }
  }

  /**
   * Muestra un modal con contenido genérico usando OBR.modal
   * @param {string} url - URL del contenido
   * @param {string} name - Nombre del contenido
   * @private
   */
  async _showContentModal(url, name) {
    if (!this.OBR || !this.OBR.modal) {
      logError('OBR.modal no disponible');
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;
      
      const viewerUrl = new URL('index.html', baseUrl);
      viewerUrl.searchParams.set('modal', 'true');
      viewerUrl.searchParams.set('url', encodeURIComponent(url));
      if (name) {
        viewerUrl.searchParams.set('name', encodeURIComponent(name));
      }
      
      await this.OBR.modal.open({
        id: 'gm-vault-content-viewer',
        url: viewerUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (error) {
      logError('Error al abrir modal de contenido:', error);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // ============================================
  // Token Context Menus - Vincular páginas a tokens
  // ============================================

  /**
   * Configura los menús contextuales para tokens de OBR
   * @private
   */
  async _setupTokenContextMenus() {
    try {
      log('🎯 Configurando menús contextuales para tokens...');
      
      // Obtener la URL base para los iconos
      const baseUrl = window.location.origin;
      
      // Menú: Vincular página (solo GM)
      await this.OBR.contextMenu.create({
        id: `${METADATA_KEY}/link-page`,
        icons: [
          {
            icon: `${baseUrl}/img/icon-page.svg`,
            label: 'Link page',
            filter: {
              every: [{ key: 'layer', value: 'CHARACTER' }],
              roles: ['GM']
            }
          }
        ],
        onClick: async (context) => {
          const items = context.items;
          if (!items || items.length === 0) return;
          
          // Obtener los IDs de todos los tokens seleccionados
          const itemIds = items.map(item => item.id);
          
          // Abrir el panel de la extensión
          await this.OBR.action.open();
          
          // Pequeña espera para que el panel se abra
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Mostrar selector de páginas
          await this._showPageSelectorForToken(itemIds);
        }
      });
      
      // Menú: Ver página vinculada (GM - ve todas las páginas vinculadas)
      await this.OBR.contextMenu.create({
        id: `${METADATA_KEY}/view-page-gm`,
        icons: [
          {
            icon: `${baseUrl}/img/icon-view-page.svg`,
            label: 'View linked page',
            filter: {
              every: [
                { key: 'layer', value: 'CHARACTER' },
                { key: ['metadata', `${METADATA_KEY}/pageUrl`], value: undefined, operator: '!=' }
              ],
              roles: ['GM']
            }
          }
        ],
        onClick: async (context) => {
          const item = context.items[0];
          if (!item) return;
          
          const pageUrl = item.metadata[`${METADATA_KEY}/pageUrl`];
          const pageName = item.metadata[`${METADATA_KEY}/pageName`] || 'Linked page';
          const pageId = item.metadata[`${METADATA_KEY}/pageId`];
          
          if (pageUrl || pageId) {
            await this.OBR.action.open();
            await new Promise(resolve => setTimeout(resolve, 100));
            this.analyticsService.trackPageViewedFromToken(pageName);
            await this._openLinkedPage(pageUrl, pageName, pageId);
          }
        }
      });
      
      // Menú: Ver página vinculada (Players - solo si página es visible)
      await this.OBR.contextMenu.create({
        id: `${METADATA_KEY}/view-page-player`,
        icons: [
          {
            icon: `${baseUrl}/img/icon-view-page.svg`,
            label: 'View linked page',
            filter: {
              every: [
                { key: 'layer', value: 'CHARACTER' },
                { key: ['metadata', `${METADATA_KEY}/pageUrl`], value: undefined, operator: '!=' },
                { key: ['metadata', `${METADATA_KEY}/pageVisible`], value: true }
              ],
              roles: ['PLAYER']
            }
          }
        ],
        onClick: async (context) => {
          const item = context.items[0];
          if (!item) return;
          
          const pageUrl = item.metadata[`${METADATA_KEY}/pageUrl`];
          const pageName = item.metadata[`${METADATA_KEY}/pageName`] || 'Linked page';
          const pageId = item.metadata[`${METADATA_KEY}/pageId`];
          
          if (pageUrl || pageId) {
            await this.OBR.action.open();
            await new Promise(resolve => setTimeout(resolve, 100));
            this.analyticsService.trackPageViewedFromToken(pageName);
            await this._openLinkedPage(pageUrl, pageName, pageId);
          }
        }
      });
      
      // Menú: Desvincular página (solo GM)
      await this.OBR.contextMenu.create({
        id: `${METADATA_KEY}/unlink-page`,
        icons: [
          {
            icon: `${baseUrl}/img/icon-trash.svg`,
            label: 'Unlink page',
            filter: {
              every: [
                { key: 'layer', value: 'CHARACTER' },
                { key: ['metadata', `${METADATA_KEY}/pageUrl`], value: undefined, operator: '!=' }
              ],
              roles: ['GM']
            }
          }
        ],
        onClick: async (context) => {
          const items = context.items;
          if (!items || items.length === 0) return;
          
          // Desvincular todos los tokens seleccionados
          await this.OBR.scene.items.updateItems(items, (updateItems) => {
            updateItems.forEach(item => {
              delete item.metadata[`${METADATA_KEY}/pageUrl`];
              delete item.metadata[`${METADATA_KEY}/pageName`];
              delete item.metadata[`${METADATA_KEY}/pageIcon`];
              delete item.metadata[`${METADATA_KEY}/pageId`];
              delete item.metadata[`${METADATA_KEY}/pageVisible`];
            });
          });
          
          const count = items.length;
          log(`🗑️ Página desvinculada de ${count} token(s)`);
          this._showFeedback(count === 1 ? '🔗 Page unlinked' : `🔗 Page unlinked from ${count} tokens`);
        }
      });
      
      log('✅ Menús contextuales para tokens configurados');
      
    } catch (error) {
      logError('❌ Error al configurar menús contextuales:', error);
    }
  }

  /**
   * Muestra el selector de páginas para vincular a tokens
   * @param {string[]} itemIds - IDs de los tokens seleccionados
   * @private
   */
  async _showPageSelectorForToken(itemIds) {
    const tokenIds = Array.isArray(itemIds) ? itemIds : [itemIds];
    
    // Verificar que tengamos configuración
    if (!this.config || !this.config.categories) {
      alert('No pages configured. Add pages from the main panel.');
      return;
    }
    
    // Recopilar todas las páginas respetando el orden del vault
    const allPages = [];
    
    const collectPagesOrdered = (category, path = [], level = 0) => {
      if (!category) return;
      
      const currentPath = [...path, category.name];
      const combinedOrder = this._getCombinedOrder(category);
      
      combinedOrder.forEach(item => {
        if (item.type === 'category' && category.categories && category.categories[item.index]) {
          const subcategory = category.categories[item.index];
          collectPagesOrdered(subcategory, currentPath, level + 1);
        } else if (item.type === 'page' && category.pages && category.pages[item.index]) {
          const pageData = category.pages[item.index];
          // Asegurar que es una instancia de Page para tener acceso al id
          const page = pageData instanceof Page ? pageData : Page.fromJSON(pageData);
          allPages.push({
            id: page.id,
            name: page.name,
            url: page.url,
            icon: page.icon,
            displayPath: currentPath.join(' / '),
            categoryPath: currentPath,
            pageIndex: item.index
          });
        }
      });
    };
    
    // Procesar categorías raíz
    const rootOrder = this._getCombinedOrder(this.config);
    rootOrder.forEach(item => {
      if (item.type === 'category' && this.config.categories && this.config.categories[item.index]) {
        collectPagesOrdered(this.config.categories[item.index], [], 0);
      }
    });
    
    if (allPages.length === 0) {
      alert('No pages configured. Add pages from the main panel.');
      return;
    }
    
    // Crear opciones para el select con indentación
    const pageOptions = allPages.map((page, index) => ({
      label: `${page.displayPath} → ${page.name}`,
      value: index.toString()
    }));
    
    // Determinar el título del modal
    const modalTitle = tokenIds.length === 1 
      ? 'Link page to token' 
      : `Link page to ${tokenIds.length} tokens`;
    
    // Mostrar modal de selección
    this._showModalForm(modalTitle, [
      {
        name: 'pageIndex',
        label: 'Select a page',
        type: 'select',
        options: pageOptions,
        required: true
      }
    ], async (data) => {
      const selectedPage = allPages[parseInt(data.pageIndex)];
      
      if (!selectedPage) {
        alert('Error: page not found');
        return;
      }
      
      try {
        // Obtener todos los items seleccionados
        const items = await this.OBR.scene.items.getItems(tokenIds);
        if (items.length === 0) {
          alert('Error: tokens not found');
          return;
        }
        
        // Actualizar metadatos de todos los tokens
        log(`🔗 Vinculando página a token - ID: ${selectedPage.id}, Name: ${selectedPage.name}`);
        
        // Buscar la página completa para obtener visibleToPlayers
        const fullPage = this.config?.findPageById(selectedPage.id);
        const isVisible = fullPage?.visibleToPlayers || false;
        
        await this.OBR.scene.items.updateItems(items, (updateItems) => {
          updateItems.forEach(item => {
            item.metadata[`${METADATA_KEY}/pageUrl`] = selectedPage.url;
            item.metadata[`${METADATA_KEY}/pageName`] = selectedPage.name;
            item.metadata[`${METADATA_KEY}/pageIcon`] = selectedPage.icon;
            item.metadata[`${METADATA_KEY}/pageVisible`] = isVisible;
            if (selectedPage.id) {
              item.metadata[`${METADATA_KEY}/pageId`] = selectedPage.id;
              log(`✅ pageId guardado en token: ${selectedPage.id}, visible: ${isVisible}`);
            } else {
              log(`⚠️ selectedPage no tiene id:`, selectedPage);
            }
          });
        });
        
        // Registrar y mostrar mensaje de confirmación
        const tokenCount = items.length;
        log(`✅ Página "${selectedPage.name}" vinculada a ${tokenCount} token(s)`);
        
        // Trackear para cada token
        tokenIds.forEach(itemId => {
          this.analyticsService.trackPageLinkedToToken(selectedPage.name, itemId);
        });
        
        const successMessage = tokenCount === 1
          ? `✅ Page "${selectedPage.name}" linked to token`
          : `✅ Page "${selectedPage.name}" linked to ${tokenCount} tokens`;
        this._showFeedback(successMessage);
        
      } catch (error) {
        logError('Error al vincular página:', error);
        alert('Error linking page: ' + error.message);
      }
    });
  }

  /**
   * Abre una página vinculada desde un token
   * @param {string} url - URL de la página (puede ser null para páginas de Obsidian)
   * @param {string} name - Nombre de la página
   * @param {string} pageId - ID de la página (prioritario para búsqueda)
   * @private
   */
  async _openLinkedPage(url, name, pageId = null) {
    // Buscar la página en la configuración para obtener todos sus datos
    let foundPage = null;
    
    // Si tenemos pageId, buscar directamente por ID (más confiable)
    if (pageId && this.config) {
      foundPage = this.config.findPageById(pageId);
      log(`🔍 Buscando página por ID: ${pageId} - ${foundPage ? '✅ Encontrada' : '❌ No encontrada'}`);
    }
    
    // Si no encontramos por ID, buscar por URL o nombre
    if (!foundPage) {
      const findPage = (category) => {
        if (!category || foundPage) return;
        
        // Buscar en páginas de esta categoría
        const pages = category.pages || [];
        for (const page of pages) {
          // Convertir a instancia de Page si es necesario
          const pageInstance = page instanceof Page ? page : Page.fromJSON(page);
          
          // Buscar por URL si hay URL
          if (url && pageInstance.url === url) {
            foundPage = pageInstance;
            return;
          }
          // O buscar por nombre si no hay URL (páginas de Obsidian)
          if (!url && pageInstance.name === name) {
            foundPage = pageInstance;
            return;
          }
        }
        
        // Buscar en subcategorías
        const subcategories = category.categories || [];
        for (const subcat of subcategories) {
          findPage(subcat);
        }
      };
      
      // Buscar en todas las categorías raíz
      if (this.config && this.config.categories) {
        for (const cat of this.config.categories) {
          findPage(cat);
          if (foundPage) break;
        }
      }
    }
    
    // Si encontramos la página, usarla; sino crear una básica
    if (foundPage) {
      log(`📖 Abriendo página encontrada: ${foundPage.name} (ID: ${foundPage.id})`);
      // Convertir a instancia de Page si es necesario
      const pageInstance = foundPage instanceof Page ? foundPage : Page.fromJSON(foundPage);
      await this.openPage(pageInstance, [], 0);
    } else {
      log(`⚠️ Página no encontrada, creando básica: ${name}`);
      const page = new Page(name, url || null, { visibleToPlayers: false, blockTypes: null });
      await this.openPage(page, [], 0);
    }
  }

  /**
   * Obtiene el indicador de visibilidad para páginas compartidas con players
   * Fácil de personalizar: puede ser texto, emoji o imagen
   * @returns {string} HTML del indicador
   * @private
   */
  _getVisibilityIndicator() {
    // Opciones de personalización:
    // Texto: return ' <span class="visibility-indicator">(Player)</span>';
    // Emoji: return ' <span class="visibility-indicator">👁️</span>';
    // Icono: return ' <img src="img/icon-players.svg" class="visibility-indicator-icon" alt="Visible to players" title="Visible to players" />';
    
    return ' <span class="visibility-indicator" title="Visible to players">(Player)</span>';
  }

  /**
   * Muestra un mensaje de feedback temporal
   * @private
   */
  _showFeedback(message) {
    // Remover feedback anterior
    const existing = document.querySelector('.share-feedback');
    if (existing) existing.remove();
    
    const feedback = document.createElement('div');
    feedback.className = 'share-feedback';
    feedback.textContent = message;
    feedback.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-bg-secondary, #333);
      color: var(--color-text-primary, #fff);
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 10001;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeInOut 2s ease forwards;
    `;
    
    // Agregar keyframes si no existen
    if (!document.querySelector('#share-feedback-styles')) {
      const style = document.createElement('style');
      style.id = 'share-feedback-styles';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          85% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(feedback);
    setTimeout(() => feedback.remove(), 2000);
  }
}

export default ExtensionController;

