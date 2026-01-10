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
    
    // Pasar la config al UIRenderer para calcular posiciones
    this.uiRenderer.setConfig(this.config);
    
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
  async openPage(pageData, categoryPath = [], pageIndex = 0) {
    if (!this.contentContainer) return;

    // Convertir objeto plano a instancia Page si es necesario
    const page = pageData instanceof Page ? pageData : Page.fromJSON(pageData);

    log('📖 Abriendo página:', page.name);

    // Guardar referencia a la página actual
    this.currentPage = page;
    this.currentCategoryPath = categoryPath;
    this.currentPageIndex = pageIndex;

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

    // Crear botones del header para la página de detalle
    this._createPageDetailButtons(page);

    // Mostrar loading
    const notionContent = document.getElementById('notion-content');
    if (notionContent) {
      notionContent.innerHTML = `
        <div class="empty-state notion-loading">
          <div class="empty-state-icon">⏳</div>
          <p class="empty-state-text">Loading content...</p>
        </div>
      `;
    }

    try {
      const pageId = page.getNotionPageId();
      
      if (page.isNotionPage() && pageId) {
        await this._renderNotionPage(page, pageId);
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
   * Maneja el movimiento de una página
   * @param {Object} page - Página a mover
   * @param {Array} categoryPath - Ruta de categorías
   * @param {number} pageIndex - Índice de la página
   * @param {string} direction - 'up' o 'down'
   * @private
   */
  async _handlePageMove(page, categoryPath, pageIndex, direction) {
    if (!this.config || !this.isGM) return;

    log(`↕️ Moviendo página ${direction}:`, page.name);

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

    const pages = currentLevel.pages || [];
    const currentIndex = pages.findIndex(p => p.name === page.name);
    
    if (currentIndex === -1) {
      logError('No se encontró la página:', page.name);
      return;
    }

    // Calcular nuevo índice
    let newIndex;
    if (direction === 'up') {
      newIndex = currentIndex - 1;
    } else {
      newIndex = currentIndex + 1;
    }

    // Verificar límites
    if (newIndex < 0 || newIndex >= pages.length) {
      log('No se puede mover más en esa dirección');
      return;
    }

    // Intercambiar posiciones
    [pages[currentIndex], pages[newIndex]] = [pages[newIndex], pages[currentIndex]];
    
    await this.saveConfig(this.config);
  }

  /**
   * Maneja duplicar una página
   * @private
   */
  async _handlePageDuplicate(page, categoryPath, pageIndex) {
    if (!this.config || !this.isGM) return;

    log('📋 Duplicando página:', page.name);

    let currentLevel = this.config;
    for (const catName of categoryPath) {
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) currentLevel = cat;
      else return;
    }

    const pages = currentLevel.pages || [];
    const duplicatedPage = JSON.parse(JSON.stringify(page));
    duplicatedPage.name = `${page.name} (copy)`;
    
    // Insertar después de la página original
    pages.splice(pageIndex + 1, 0, duplicatedPage);
    await this.saveConfig(this.config);
  }

  /**
   * Maneja editar una categoría
   * @private
   */
  _handleCategoryEdit(category, categoryPath) {
    this._showModalForm('Edit Folder', [
      { name: 'name', label: 'Name', type: 'text', value: category.name, required: true }
    ], async (data) => {
      if (!data.name || data.name === category.name) return;
      
      let currentLevel = this.config;
      for (let i = 0; i < categoryPath.length - 1; i++) {
        const catName = categoryPath[i];
        const cat = (currentLevel.categories || []).find(c => c.name === catName);
        if (cat) currentLevel = cat;
        else return;
      }

      const catIndex = (currentLevel.categories || []).findIndex(c => c.name === category.name);
      if (catIndex !== -1) {
        currentLevel.categories[catIndex].name = data.name;
        await this.saveConfig(this.config);
      }
    });
  }

  /**
   * Maneja eliminar una categoría
   * @private
   */
  async _handleCategoryDelete(category, categoryPath) {
    if (!this.config || !this.isGM) return;

    log('🗑️ Eliminando carpeta:', category.name);

    let currentLevel = this.config;
    for (let i = 0; i < categoryPath.length - 1; i++) {
      const catName = categoryPath[i];
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) currentLevel = cat;
      else return;
    }

    const categories = currentLevel.categories || [];
    const catIndex = categories.findIndex(c => c.name === category.name);
    if (catIndex !== -1) {
      categories.splice(catIndex, 1);
      await this.saveConfig(this.config);
    }
  }

  /**
   * Maneja mover una categoría
   * @private
   */
  async _handleCategoryMove(category, categoryPath, direction) {
    if (!this.config || !this.isGM) return;

    log(`↕️ Moviendo carpeta ${direction}:`, category.name);

    let currentLevel = this.config;
    for (let i = 0; i < categoryPath.length - 1; i++) {
      const catName = categoryPath[i];
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) currentLevel = cat;
      else return;
    }

    const categories = currentLevel.categories || [];
    const currentIndex = categories.findIndex(c => c.name === category.name);
    
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= categories.length) return;

    [categories[currentIndex], categories[newIndex]] = [categories[newIndex], categories[currentIndex]];
    await this.saveConfig(this.config);
  }

  /**
   * Maneja duplicar una categoría
   * @private
   */
  async _handleCategoryDuplicate(category, categoryPath) {
    if (!this.config || !this.isGM) return;

    log('📋 Duplicando carpeta:', category.name);

    let currentLevel = this.config;
    for (let i = 0; i < categoryPath.length - 1; i++) {
      const catName = categoryPath[i];
      const cat = (currentLevel.categories || []).find(c => c.name === catName);
      if (cat) currentLevel = cat;
      else return;
    }

    const categories = currentLevel.categories || [];
    const catIndex = categories.findIndex(c => c.name === category.name);
    
    if (catIndex !== -1) {
      const duplicated = JSON.parse(JSON.stringify(category));
      duplicated.name = `${category.name} (copy)`;
      categories.splice(catIndex + 1, 0, duplicated);
      await this.saveConfig(this.config);
    }
  }

  /**
   * Maneja agregar una página
   * @private
   */
  _handleAddPage(categoryPath, roomId) {
    this._showModalForm('Add Page', [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Page name' },
      { name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: false }
    ], async (data) => {
      if (!data.name || !data.url) return;

      let currentLevel = this.config;
      for (const catName of categoryPath) {
        const cat = (currentLevel.categories || []).find(c => c.name === catName);
        if (cat) currentLevel = cat;
        else return;
      }

      if (!currentLevel.pages) currentLevel.pages = [];
      currentLevel.pages.push({
        name: data.name,
        url: data.url,
        visibleToPlayers: data.visibleToPlayers || false
      });
      
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

      let currentLevel = this.config;
      for (const catName of categoryPath) {
        const cat = (currentLevel.categories || []).find(c => c.name === catName);
        if (cat) currentLevel = cat;
        else return;
      }

      if (!currentLevel.categories) currentLevel.categories = [];
      currentLevel.categories.push({
        name: data.name,
        pages: [],
        categories: []
      });
      
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
    openModalBtn.dataset.currentUrl = page.url;
    openModalBtn.dataset.currentName = page.name;
    
    // Remover listener anterior y agregar nuevo
    const newOpenModalBtn = openModalBtn.cloneNode(true);
    openModalBtn.parentNode.replaceChild(newOpenModalBtn, openModalBtn);
    newOpenModalBtn.addEventListener('click', () => this._openPageInModal(page));

    // Solo para GM: Botón de Visibilidad
    if (this.isGM) {
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

      // Botón Menú Contextual (solo GM)
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

    // Botón Refresh (solo para Notion)
    if (page.isNotionPage()) {
      let refreshBtn = document.getElementById('refresh-page-button');
      if (!refreshBtn) {
        refreshBtn = document.createElement('button');
        refreshBtn.id = 'refresh-page-button';
        refreshBtn.className = 'icon-button';
        refreshBtn.innerHTML = '<img src="img/icon-reload.svg" class="icon-button-icon" alt="Refresh" />';
        refreshBtn.title = 'Refresh content';
        header.appendChild(refreshBtn);
      }
      refreshBtn.classList.remove('hidden');
      
      // Remover listener anterior y agregar nuevo
      const newRefreshBtn = refreshBtn.cloneNode(true);
      refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
      newRefreshBtn.addEventListener('click', async () => {
        const pageId = page.getNotionPageId();
        if (pageId) {
          // Forzar recarga sin caché
          await this._renderNotionPage(page, pageId, true);
        }
      });
    }
  }

  /**
   * Oculta los botones de la página de detalle
   * @private
   */
  _hidePageDetailButtons() {
    const buttonIds = [
      'page-open-modal-button-header',
      'page-visibility-button-header',
      'page-context-menu-button-header',
      'refresh-page-button'
    ];
    buttonIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.add('hidden');
    });
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
    
    const menuItems = [
      { 
        icon: 'img/icon-edit.svg', 
        text: 'Edit page',
        action: () => this._showEditPageModal(page)
      },
      { separator: true },
      { 
        icon: 'img/icon-delete.svg', 
        text: 'Delete page',
        action: () => {
          if (confirm(`Delete "${page.name}"?`)) {
            this._handlePageDelete(page, this.currentCategoryPath, this.currentPageIndex);
            this._goBackToList();
          }
        }
      }
    ];

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
    if (!this.OBR || !this.OBR.modal) {
      window.open(page.url, '_blank');
      return;
    }

    try {
      const currentPath = window.location.pathname;
      const baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
      const baseUrl = window.location.origin + baseDir;

      const modalUrl = new URL('index.html', baseUrl);
      modalUrl.searchParams.set('modal', 'true');
      modalUrl.searchParams.set('url', encodeURIComponent(page.url));
      modalUrl.searchParams.set('name', encodeURIComponent(page.name));

      await this.OBR.modal.open({
        id: 'gm-vault-page-modal',
        url: modalUrl.toString(),
        height: 800,
        width: 1200
      });
    } catch (e) {
      logError('Error abriendo modal:', e);
      window.open(page.url, '_blank');
    }
  }

  /**
   * Muestra modal para editar página desde la vista de detalle
   * @private
   */
  _showEditPageModal(page) {
    this._showModalForm('Edit Page', [
      { name: 'name', label: 'Name', type: 'text', value: page.name, required: true },
      { name: 'url', label: 'URL', type: 'url', value: page.url, required: true },
      { name: 'visibleToPlayers', label: 'Visible to players', type: 'checkbox', value: page.visibleToPlayers }
    ], async (data) => {
      await this._handlePageEdit(page, this.currentCategoryPath, this.currentPageIndex, data);
      // Actualizar título si cambió
      const pageTitle = document.getElementById('page-title');
      if (pageTitle && data.name) {
        pageTitle.textContent = data.name;
      }
    });
  }

  /**
   * Crea un menú contextual genérico
   * @private
   */
  _createContextMenu(items, position, onClose) {
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        if (onClose) onClose();
      }
    };

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
        menu.remove();
        document.removeEventListener('click', closeMenu);
        if (onClose) onClose();
        if (item.action) await item.action();
      });

      menu.appendChild(menuItem);
    });

    setTimeout(() => document.addEventListener('click', closeMenu), 0);
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
      // Páginas
      onPageClick: (page, categoryPath, pageIndex) => {
        this.openPage(page, categoryPath, pageIndex);
      },
      onVisibilityChange: (page, categoryPath, pageIndex, visible) => {
        this._handleVisibilityChange(page, categoryPath, pageIndex, visible);
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
        this._showModalForm(options.title, options.fields, options.onSubmit);
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
      }
      notionContainer.classList.add('show-content');
    } else if (mode === 'iframe') {
      // Mostrar iframe, ocultar y limpiar content
      if (notionContent) {
        notionContent.innerHTML = '';
      }
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

    // Obtener info de la página (cover, título, icono)
    const pageInfo = await this.notionService.fetchPageInfo(pageId);
    
    // Obtener bloques
    const blocks = await this.notionService.fetchBlocks(pageId, !forceRefresh);
    const blocksHtml = await this.notionRenderer.renderBlocks(blocks, page.blockTypes);
    
    // Construir HTML con header (cover + título)
    let headerHtml = '';
    
    // Cover image
    if (pageInfo?.cover) {
      const coverUrl = pageInfo.cover.external?.url || pageInfo.cover.file?.url;
      if (coverUrl) {
        headerHtml += `
          <div class="notion-cover">
            <div class="notion-image-container">
              <div class="image-loading">
                <div class="loading-spinner"></div>
              </div>
              <img src="${coverUrl}" alt="Page cover" class="notion-cover-image" 
                   data-image-url="${coverUrl}"
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
    
    // Título con icono
    const pageTitle = pageInfo?.properties?.title?.title?.[0]?.plain_text || page.name;
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
    
    headerHtml += `<h1 class="notion-page-title">${iconHtml}${pageTitle}</h1>`;
    
    notionContent.innerHTML = headerHtml + blocksHtml;

    // Guardar HTML en caché
    this.cacheService.saveHtmlToLocalCache(pageId, headerHtml + blocksHtml);

    // Attach event handlers para imágenes
    this._attachImageHandlers(notionContent);
  }

  /**
   * Renderiza una página de imagen (abre directamente en modal OBR)
   * @private
   */
  async _renderImagePage(page) {
    // Mostrar imagen en content con opción de ampliar y compartir
    this._setNotionDisplayMode('notion');
    
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
          ${this.isGM ? `
            <button class="notion-image-share-button share-button" 
                    data-image-url="${absoluteImageUrl}" 
                    data-image-caption="${escapedCaption}"
                    title="Show to players">
              <img src="img/icon-players.svg" alt="Share" />
            </button>
          ` : ''}
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
    this._setNotionDisplayMode('notion');
    
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
          ${this.isGM ? `
            <button class="video-share-button share-button" 
                    data-video-url="${url}" 
                    data-video-type="${videoType}"
                    data-video-caption="${escapedCaption}"
                    title="Show to players"
                    style="
                      position: absolute;
                      top: 10px;
                      right: 10px;
                      background: rgba(0,0,0,0.7);
                      border: none;
                      border-radius: 50%;
                      width: 40px;
                      height: 40px;
                      cursor: pointer;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                    ">
              <img src="img/icon-players.svg" alt="Share" style="width: 24px; height: 24px;" />
            </button>
          ` : ''}
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

    // Handler para compartir video
    const shareBtn = notionContent.querySelector('.video-share-button');
    if (shareBtn) {
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._shareVideoToPlayers(url, caption, videoType);
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
      await this.OBR.broadcast.sendMessage('com.dmscreen/showVideo', {
        url: url,
        caption: caption || '',
        type: videoType
      });
      log('📤 Video compartido con jugadores');
      this._showFeedback('🎬 Video shared with players!');
    } catch (e) {
      logError('Error compartiendo video:', e);
    }
  }

  _renderGoogleDocPage(page) {
    // Cambiar a modo iframe
    this._setNotionDisplayMode('iframe');
    
    const notionIframe = document.getElementById('notion-iframe');
    if (!notionIframe) return;

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

    notionIframe.src = embedUrl;
    notionIframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:var(--radius-lg)';
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
      // Mostrar botón de compartir solo si es GM
      if (showShareButton && this.isGM) {
        viewerUrl.searchParams.set('showShareButton', 'true');
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
      await this.OBR.broadcast.sendMessage('com.dmscreen/showImage', {
        url: absoluteImageUrl,
        caption: caption || ''
      });
      
      log('📤 Imagen compartida con jugadores:', absoluteImageUrl.substring(0, 80));
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

