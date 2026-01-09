/**
 * @fileoverview Controlador principal de la extensión GM Vault
 * 
 * Orquesta todos los servicios, renderers y componentes de la aplicación.
 */

import { log, logError, setOBRReference, setGetTokenFunction, initDebugMode, getUserRole } from '../utils/logger.js';
import { filterVisiblePages } from '../utils/helpers.js';

// Models
import { Page } from '../models/Page.js';

// Services
import { CacheService } from '../services/CacheService.js';
import { StorageService } from '../services/StorageService.js';
import { NotionService } from '../services/NotionService.js';
import { BroadcastService } from '../services/BroadcastService.js';

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
    this.roomId = null;
    this.playerId = null;
    this.playerName = null;
    this.config = null;
    this.isInitialized = false;

    // Servicios
    this.cacheService = new CacheService();
    this.storageService = new StorageService();
    this.notionService = new NotionService();
    this.broadcastService = new BroadcastService();

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
    
    // Configurar broadcast (si es GM)
    if (this.isGM) {
      this._setupGMBroadcast();
      this._startHeartbeat();
    } else {
      this._setupPlayerBroadcast();
    }
    
    // Iniciar detección de cambio de rol
    this._startRoleChangeDetection();
    
    // Renderizar UI inicial
    await this.render();
    
    this.isInitialized = true;
    log('✅ ExtensionController inicializado correctamente');
  }

  /**
   * Renderiza la interfaz
   */
  async render() {
    if (!this.pagesContainer || !this.config) return;

    log('🎨 Renderizando interfaz...');
    
    this.uiRenderer.renderAllCategories(
      this.config,
      this.pagesContainer,
      this.roomId,
      this.isGM
    );
  }

  /**
   * Abre una página de contenido
   * @param {Object} page - Página a abrir
   */
  async openPage(pageData) {
    if (!this.contentContainer) return;

    // Convertir objeto plano a instancia Page si es necesario
    const page = pageData instanceof Page ? pageData : Page.fromJSON(pageData);

    log('📖 Abriendo página:', page.name);

    // Mostrar el contenedor de Notion y ocultar la lista
    const notionContainer = document.getElementById('notion-container');
    const pageList = document.getElementById('page-list');
    const backButton = document.getElementById('back-button');
    const pageTitle = document.getElementById('page-title');
    const buttonContainer = document.querySelector('.button-container');
    
    if (notionContainer) notionContainer.classList.remove('hidden');
    if (pageList) pageList.classList.add('hidden');
    if (backButton) backButton.classList.remove('hidden');
    if (pageTitle) pageTitle.textContent = page.name;
    if (buttonContainer) buttonContainer.classList.add('hidden');

    // Mostrar loading
    const notionContent = document.getElementById('notion-content');
    if (notionContent) {
      notionContent.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p>Loading ${page.name}...</p>
        </div>
      `;
    }

    try {
      const pageId = page.getNotionPageId();
      
      if (page.isNotionPage() && pageId) {
        await this._renderNotionPage(page, pageId);
      } else if (page.isImage()) {
        this._renderImagePage(page);
      } else if (page.isVideo()) {
        this._renderVideoPage(page);
      } else if (page.isGoogleDoc()) {
        this._renderGoogleDocPage(page);
      } else {
        this._renderExternalPage(page);
      }
    } catch (e) {
      logError('Error al abrir página:', e);
      if (notionContent) {
        notionContent.innerHTML = `
          <div class="error-container">
            <p class="error-message">Error loading page: ${e.message}</p>
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

    this.config = config;
    this.configBuilder = new ConfigBuilder(config);

    // Guardar en localStorage
    this.storageService.saveLocalConfig(config.toJSON ? config.toJSON() : config);

    // Si es GM, guardar en room metadata y broadcast
    if (this.isGM) {
      await this.storageService.saveRoomConfig(config.toJSON ? config.toJSON() : config);
      
      // Broadcast páginas visibles
      const visibleConfig = filterVisiblePages(config.toJSON ? config.toJSON() : config);
      this.broadcastService.broadcastVisiblePages(visibleConfig);
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

    // Navegar a la categoría correcta y actualizar la página
    let currentLevel = this.config;
    for (const catName of categoryPath) {
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) {
        currentLevel = cat;
      } else {
        logError('No se encontró la categoría:', catName);
        return;
      }
    }

    // Encontrar y actualizar la página
    const pages = currentLevel.pages || [];
    const pageToUpdate = pages.find(p => p.name === page.name);
    if (pageToUpdate) {
      pageToUpdate.visibleToPlayers = newVisibility;
      
      // Guardar y re-renderizar
      await this.saveConfig(this.config);
    } else {
      logError('No se encontró la página:', page.name);
    }
  }

  /**
   * Maneja cambio de visibilidad desde el UI
   * @private
   */
  async _handleVisibilityChange(page, categoryPath, pageIndex, visible) {
    await this._updatePageVisibility(page, categoryPath, pageIndex, visible);
  }

  /**
   * Maneja edición de página desde el UI
   * @private
   */
  async _handlePageEdit(page, categoryPath, pageIndex, newData) {
    if (!this.config || !this.isGM) return;

    log('✏️ Editando página:', page.name, '->', newData);

    // Navegar a la categoría correcta
    let currentLevel = this.config;
    for (const catName of categoryPath) {
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) {
        currentLevel = cat;
      } else {
        logError('No se encontró la categoría:', catName);
        return;
      }
    }

    // Encontrar y actualizar la página
    const pages = currentLevel.pages || [];
    const pageToUpdate = pages.find(p => p.name === page.name);
    if (pageToUpdate) {
      if (newData.name) pageToUpdate.name = newData.name;
      if (newData.url) pageToUpdate.url = newData.url;
      
      await this.saveConfig(this.config);
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

    log('🗑️ Eliminando página:', page.name);

    // Navegar a la categoría correcta
    let currentLevel = this.config;
    for (const catName of categoryPath) {
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) {
        currentLevel = cat;
      } else {
        logError('No se encontró la categoría:', catName);
        return;
      }
    }

    // Encontrar y eliminar la página
    const pages = currentLevel.pages || [];
    const pageIndexInArray = pages.findIndex(p => p.name === page.name);
    if (pageIndexInArray !== -1) {
      pages.splice(pageIndexInArray, 1);
      await this.saveConfig(this.config);
    } else {
      logError('No se encontró la página:', page.name);
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
    });

    // Storage Service
    this.storageService.setOBR(this.OBR);
    this.storageService.setStorageLimitCallback((action) => {
      this.modalManager.showAlert({
        title: 'Storage Limit',
        message: `Storage limit reached while ${action}.`,
        type: 'warning'
      });
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

    // Notion Renderer
    this.notionRenderer.setDependencies({
      notionService: this.notionService
    });

    // UI Renderer
    this.uiRenderer.setDependencies({
      storageService: this.storageService,
      notionService: this.notionService
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
      if (notionContent) {
        notionContent.innerHTML = '';
        notionContent.style.display = '';
      }
      // Limpiar iframe
      if (notionIframe) {
        notionIframe.src = 'about:blank';
        notionIframe.style.display = '';
      }
    }

    // Restaurar vista principal
    if (pageList) pageList.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
    if (pageTitle) pageTitle.textContent = 'GM vault';
    if (buttonContainer) buttonContainer.classList.remove('hidden');
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

    // Botón Add (solo para GM)
    if (this.isGM) {
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

    if (pageList) pageList.classList.add('hidden');
    if (notionContainer) notionContainer.classList.add('hidden');
    if (settingsContainer) settingsContainer.classList.remove('hidden');
    if (backButton) backButton.classList.remove('hidden');
    if (pageTitle) pageTitle.textContent = 'Settings';
    if (buttonContainer) buttonContainer.classList.add('hidden');

    // Configurar event listeners de settings (solo una vez)
    this._setupSettingsEventListeners();
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
    const downloadJsonBtn = document.getElementById('download-json-btn');
    const patreonBtn = document.getElementById('patreon-btn');
    const feedbackBtn = document.getElementById('feedback-btn');

    // Mostrar token actual enmascarado
    const currentToken = this.storageService.getUserToken() || '';
    const tokenMasked = document.getElementById('token-masked');
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
        alert('✅ Token saved successfully!');
        this._goBackToList();
      });
    }

    // Eliminar token
    if (clearBtn && !clearBtn.dataset.listenerAdded) {
      clearBtn.dataset.listenerAdded = 'true';
      clearBtn.addEventListener('click', () => {
        if (confirm('Delete token? You will go back to using the server token.')) {
          this.storageService.saveUserToken('');
          if (tokenInput) tokenInput.value = '';
          if (tokenMasked) tokenMasked.textContent = '';
          alert('Token deleted.');
          this._goBackToList();
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
            const config = JSON.parse(text);
            
            if (!config.categories) {
              throw new Error('Invalid config: missing categories');
            }
            
            await this.saveConfig(config);
            alert('✅ Vault loaded successfully!');
            this._goBackToList();
          } catch (err) {
            alert('❌ Error loading file: ' + err.message);
          }
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
      });
    }

    // Descargar JSON
    if (downloadJsonBtn && !downloadJsonBtn.dataset.listenerAdded) {
      downloadJsonBtn.dataset.listenerAdded = 'true';
      downloadJsonBtn.addEventListener('click', () => {
        try {
          const config = this.config || { categories: [] };
          const jsonStr = JSON.stringify(config, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = `gm-vault-${this.roomId || 'backup'}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          alert('❌ Error downloading: ' + err.message);
        }
      });
    }

    // Patreon
    if (patreonBtn && !patreonBtn.dataset.listenerAdded) {
      patreonBtn.dataset.listenerAdded = 'true';
      patreonBtn.addEventListener('click', () => {
        window.open('https://www.patreon.com/lsjroberts', '_blank');
      });
    }

    // Feedback
    if (feedbackBtn && !feedbackBtn.dataset.listenerAdded) {
      feedbackBtn.dataset.listenerAdded = 'true';
      feedbackBtn.addEventListener('click', () => {
        window.open('https://owlbear.rodeo/feedback', '_blank');
      });
    }
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
    
    // Crear menú contextual simple
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position: fixed; left: ${rect.right + 8}px; top: ${rect.bottom + 8}px; z-index: 1000;`;

    const items = [
      { icon: 'img/folder-close.svg', text: 'Add folder', action: () => this._addCategory() },
      { icon: 'img/icon-page.svg', text: 'Add page', action: () => this._addPage() }
    ];

    items.forEach(item => {
      const menuItem = document.createElement('button');
      menuItem.className = 'context-menu-item';
      menuItem.innerHTML = `<img src="${item.icon}" alt="" class="context-menu-icon"><span>${item.text}</span>`;
      menuItem.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);

    // Cerrar al hacer click fuera
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== button) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  /**
   * Añade una nueva categoría
   * @private
   */
  async _addCategory() {
    const name = prompt('Category name:');
    if (!name) return;

    if (!this.config.categories) this.config.categories = [];
    this.config.categories.push({ name, pages: [], categories: [] });
    await this.saveConfig(this.config);
  }

  /**
   * Añade una nueva página
   * @private
   */
  async _addPage() {
    // Mostrar modal para añadir página
    this.modalManager.showPrompt({
      title: 'Add Page',
      fields: [
        { name: 'name', label: 'Page name', type: 'text', required: true },
        { name: 'url', label: 'URL', type: 'text', required: true }
      ],
      onConfirm: async (values) => {
        if (!values.name || !values.url) return;
        
        // Añadir a la primera categoría o crear una
        if (!this.config.categories || this.config.categories.length === 0) {
          this.config.categories = [{ name: 'Pages', pages: [], categories: [] }];
        }
        
        this.config.categories[0].pages.push({
          name: values.name,
          url: values.url,
          visibleToPlayers: false
        });
        
        await this.saveConfig(this.config);
      }
    });
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
      onPageClick: (page, categoryPath, pageIndex) => {
        this.openPage(page);
      },
      onVisibilityChange: (page, categoryPath, pageIndex, visible) => {
        this._handleVisibilityChange(page, categoryPath, pageIndex, visible);
      },
      onPageEdit: (page, categoryPath, pageIndex, newData) => {
        this._handlePageEdit(page, categoryPath, pageIndex, newData);
      },
      onPageDelete: (page, categoryPath, pageIndex) => {
        this._handlePageDelete(page, categoryPath, pageIndex);
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
      
      this.storageService.setRoomId(this.roomId);
      
      log('👤 Info del jugador:', {
        roomId: this.roomId,
        playerId: this.playerId,
        playerName: this.playerName,
        isGM: this.isGM
      });
    } catch (e) {
      logError('Error obteniendo info del jugador:', e);
      this.roomId = 'default';
      this.isGM = true; // Asumir GM por defecto
    }
  }

  /**
   * Carga la configuración
   * @private
   */
  async _loadConfig() {
    log('📥 Cargando configuración...');

    // Intentar cargar de localStorage primero
    let config = this.storageService.getLocalConfig();

    // Si es GM, intentar cargar de room metadata
    if (this.isGM) {
      const roomConfig = await this.storageService.getRoomConfig();
      if (roomConfig) {
        config = roomConfig;
      }
    } else {
      // Si es jugador, solicitar al GM
      const visibleConfig = await this.broadcastService.requestVisiblePages();
      if (visibleConfig) {
        config = visibleConfig;
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
      this.config = ConfigBuilder.createDefault().build();
    }

    this.configBuilder = new ConfigBuilder(this.config);
    
    log('✅ Configuración cargada:', this.config.getTotalPageCount(), 'páginas');
  }

  // ============================================
  // MÉTODOS PRIVADOS - BROADCAST
  // ============================================

  /**
   * Configura broadcast para GM
   * @private
   */
  _setupGMBroadcast() {
    // Responder a solicitudes de contenido
    this.broadcastService.setupGMContentResponder(async (pageId) => {
      return this.cacheService.getHtmlFromLocalCache(pageId);
    });

    // Responder a solicitudes de páginas visibles
    this.broadcastService.setupGMVisiblePagesResponder(async () => {
      if (!this.config) return null;
      return filterVisiblePages(this.config.toJSON ? this.config.toJSON() : this.config);
    });
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
   * @private
   */
  _startRoleChangeDetection() {
    let lastRole = this.isGM ? 'GM' : 'PLAYER';

    this.roleCheckInterval = setInterval(async () => {
      try {
        const currentRole = await this.OBR.player.getRole();
        
        if (lastRole !== currentRole) {
          log(`🔄 Cambio de rol detectado: ${lastRole} → ${currentRole}`);
          window.location.reload();
        }
        
        lastRole = currentRole;
      } catch (e) {
        // Ignorar errores de conexión
      }
    }, 3000);
  }

  // ============================================
  // MÉTODOS PRIVADOS - RENDER
  // ============================================

  /**
   * Renderiza una página de Notion
   * @private
   */
  async _renderNotionPage(page, pageId) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    const blocks = await this.notionService.fetchBlocks(pageId);
    const html = await this.notionRenderer.renderBlocks(blocks, page.blockTypes);
    
    notionContent.innerHTML = `
      <h1 class="page-title">${page.name}</h1>
      ${html}
    `;

    // Guardar HTML en caché
    this.cacheService.saveHtmlToLocalCache(pageId, html);

    // Attach event handlers para imágenes
    this._attachImageHandlers(notionContent);
  }

  /**
   * Renderiza una página de imagen
   * @private
   */
  _renderImagePage(page) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    notionContent.innerHTML = `
      <h1 class="page-title">${page.name}</h1>
      <div class="image-container">
        <img src="${page.url}" alt="${page.name}" class="notion-image-clickable" data-image-url="${page.url}" />
      </div>
    `;
    
    this._attachImageHandlers(notionContent);
  }

  /**
   * Renderiza una página de video (YouTube, Vimeo)
   * @private
   */
  _renderVideoPage(page) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    let embedHtml = '';
    const url = page.url;

    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = this._extractYouTubeId(url);
      if (videoId) {
        embedHtml = `
          <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 8px;">
            <iframe 
              src="https://www.youtube.com/embed/${videoId}" 
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
              frameborder="0" 
              allowfullscreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
            </iframe>
          </div>
        `;
      }
    }
    // Vimeo
    else if (url.includes('vimeo.com')) {
      const vimeoId = url.match(/vimeo\.com\/(\d+)/)?.[1];
      if (vimeoId) {
        embedHtml = `
          <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; border-radius: 8px;">
            <iframe 
              src="https://player.vimeo.com/video/${vimeoId}" 
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
              frameborder="0" 
              allowfullscreen>
            </iframe>
          </div>
        `;
      }
    }

    if (embedHtml) {
      notionContent.innerHTML = `
        <h1 class="page-title">${page.name}</h1>
        ${embedHtml}
      `;
    } else {
      // Fallback a iframe genérico
      this._renderExternalPage(page);
    }
  }

  /**
   * Extrae el ID de YouTube de una URL
   * @private
   */
  _extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  /**
   * Renderiza una página de Google Docs/Sheets/Slides
   * @private
   */
  _renderGoogleDocPage(page) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;

    // Convertir URL de Google Docs a embed
    let embedUrl = page.url;
    
    // Google Slides
    if (embedUrl.includes('/presentation/')) {
      embedUrl = embedUrl.replace(/\/edit.*$/, '/embed?start=false&loop=false&delayms=3000');
    }
    // Google Sheets
    else if (embedUrl.includes('/spreadsheets/')) {
      embedUrl = embedUrl.replace(/\/edit.*$/, '/pubhtml?widget=true&amp;headers=false');
    }
    // Google Docs
    else if (embedUrl.includes('/document/')) {
      if (embedUrl.includes('/edit')) {
        embedUrl = embedUrl.replace('/edit', '/preview');
      } else if (!embedUrl.includes('/preview')) {
        embedUrl = embedUrl + '/preview';
      }
    }

    notionContent.innerHTML = `
      <h1 class="page-title">${page.name}</h1>
      <div style="width: 100%; height: calc(100vh - 150px); min-height: 500px; border-radius: 8px; overflow: hidden;">
        <iframe 
          src="${embedUrl}" 
          frameborder="0" 
          style="width: 100%; height: 100%;"
          allowfullscreen>
        </iframe>
      </div>
    `;
  }

  /**
   * Renderiza una página externa (iframe)
   * @private
   */
  _renderExternalPage(page) {
    const notionContent = document.getElementById('notion-content');
    if (!notionContent) return;
    
    notionContent.innerHTML = `
      <h1 class="page-title">${page.name}</h1>
      <div style="width: 100%; height: calc(100vh - 150px); min-height: 500px; border-radius: 8px; overflow: hidden;">
        <iframe 
          src="${page.url}" 
          frameborder="0" 
          style="width: 100%; height: 100%;"
          allowfullscreen>
        </iframe>
      </div>
    `;
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
  }

  /**
   * Muestra un modal con la imagen ampliada
   * @private
   */
  _showImageModal(url, caption) {
    // Crear modal
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      cursor: zoom-out;
    `;
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = caption || 'Image';
    img.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 8px;
    `;
    
    modal.appendChild(img);
    
    if (caption) {
      const captionDiv = document.createElement('div');
      captionDiv.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 0;
        right: 0;
        text-align: center;
        color: white;
        padding: 10px;
        background: rgba(0, 0, 0, 0.5);
      `;
      captionDiv.textContent = caption;
      modal.appendChild(captionDiv);
    }
    
    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
  }

  /**
   * Comparte una imagen con los jugadores via broadcast
   * @private
   */
  async _shareImageToPlayers(url, caption) {
    if (!this.isGM) {
      log('Solo el GM puede compartir imágenes');
      return;
    }

    try {
      await this.broadcastService.sendMessage('SHOW_IMAGE', {
        url: url,
        caption: caption || '',
        sharedBy: this.playerName || 'GM'
      });
      
      this._showFeedback('📸 Image shared with players!');
    } catch (e) {
      logError('Error compartiendo imagen:', e);
      this._showFeedback('❌ Error sharing image');
    }
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

