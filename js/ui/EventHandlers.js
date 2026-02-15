/**
 * @fileoverview Manejadores de eventos de la UI
 * 
 * Centraliza el manejo de eventos de la interfaz.
 */

import { log } from '../utils/logger.js';

/**
 * Clase para manejar eventos de la UI
 */
export class EventHandlers {
  constructor() {
    // Referencias a servicios
    this.storageService = null;
    this.cacheService = null;
    this.broadcastService = null;
    this.notionService = null;
    
    // Referencias a renderers
    this.uiRenderer = null;
    this.notionRenderer = null;
    
    // Referencias a otros componentes
    this.modalManager = null;
    this.configBuilder = null;
    
    // Estado
    this.currentConfig = null;
    this.isGM = true;
    this.roomId = null;
    
    // Callbacks externos
    this.onConfigChange = null;
    this.onPageOpen = null;
  }

  /**
   * Inyecta dependencias
   */
  setDependencies(deps) {
    Object.assign(this, deps);
  }

  /**
   * Establece callbacks
   */
  setCallbacks({ onConfigChange, onPageOpen }) {
    if (onConfigChange) this.onConfigChange = onConfigChange;
    if (onPageOpen) this.onPageOpen = onPageOpen;
  }

  /**
   * Establece el estado actual
   */
  setState({ config, isGM, roomId }) {
    if (config !== undefined) this.currentConfig = config;
    if (isGM !== undefined) this.isGM = isGM;
    if (roomId !== undefined) this.roomId = roomId;
  }

  // ============================================
  // HANDLERS DE PÁGINA
  // ============================================

  /**
   * Handler para clic en una página
   */
  async handlePageClick(page, categoryPath, pageIndex) {
    log('📄 Abriendo página:', page.name);
    
    if (this.onPageOpen) {
      this.onPageOpen(page, categoryPath, pageIndex);
    }
  }

  /**
   * Handler para cambio de visibilidad de página
   */
  async handleVisibilityChange(page, categoryPath, pageIndex, newVisibility) {
    log(`👁️ Cambiando visibilidad de ${page.name} a ${newVisibility}`);
    
    if (!this.configBuilder || !this.currentConfig) return;

    this.configBuilder.setPageVisibility(categoryPath, pageIndex, newVisibility);
    const newConfig = this.configBuilder.build();
    
    if (this.onConfigChange) {
      await this.onConfigChange(newConfig);
    }
  }

  /**
   * Handler para editar página
   */
  async handlePageEdit(page, categoryPath, pageIndex) {
    if (!this.modalManager) return;

    log('✏️ Editando página:', page.name);

    const result = await this.modalManager.showForm({
      title: 'Edit Page',
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          value: page.name,
          required: true
        },
        {
          name: 'url',
          label: 'URL',
          type: 'url',
          value: page.url,
          required: true,
          placeholder: 'https://notion.so/...'
        },
        {
          name: 'blockTypes',
          label: 'Filter Blocks (optional)',
          type: 'text',
          value: page.blockTypes ? page.blockTypes.join(', ') : '',
          placeholder: 'quote, callout, image',
          hint: 'Comma-separated list of block types to show'
        }
      ],
      submitText: 'Save'
    });

    if (result) {
      const updates = {
        name: result.name,
        url: result.url
      };

      if (result.blockTypes && result.blockTypes.trim()) {
        updates.blockTypes = result.blockTypes.split(',').map(t => t.trim()).filter(t => t);
      } else {
        updates.blockTypes = null;
      }

      this.configBuilder.updatePage(categoryPath, pageIndex, updates);
      const newConfig = this.configBuilder.build();

      if (this.onConfigChange) {
        await this.onConfigChange(newConfig);
      }
    }
  }

  /**
   * Handler para eliminar página
   */
  async handlePageDelete(page, categoryPath, pageIndex) {
    if (!this.modalManager) return;

    log('🗑️ Eliminando página:', page.name);

    const confirmed = await this.modalManager.showConfirm({
      title: 'Delete Page',
      message: `Are you sure you want to delete "${page.name}"?`,
      confirmText: 'Delete',
      danger: true
    });

    if (confirmed) {
      this.configBuilder.removePage(categoryPath, pageIndex);
      const newConfig = this.configBuilder.build();

      if (this.onConfigChange) {
        await this.onConfigChange(newConfig);
      }
    }
  }

  /**
   * Handler para añadir página
   */
  async handleAddPage(categoryPath) {
    if (!this.modalManager) return;

    log('➕ Añadiendo página a:', categoryPath.join(' > '));

    const result = await this.modalManager.showForm({
      title: 'Add Page',
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Page name'
        },
        {
          name: 'url',
          label: 'URL',
          type: 'url',
          required: true,
          placeholder: 'https://notion.so/...'
        },
        {
          name: 'visibleToPlayers',
          label: 'Visible to players',
          type: 'checkbox',
          value: false
        }
      ],
      submitText: 'Add'
    });

    if (result) {
      this.configBuilder.addPage(categoryPath, result.name, result.url, {
        visibleToPlayers: result.visibleToPlayers
      });
      const newConfig = this.configBuilder.build();

      if (this.onConfigChange) {
        await this.onConfigChange(newConfig);
      }
    }
  }

  // ============================================
  // HANDLERS DE CATEGORÍA
  // ============================================

  /**
   * Handler para añadir categoría
   */
  async handleAddCategory(parentPath = []) {
    if (!this.modalManager) return;

    const result = await this.modalManager.showForm({
      title: parentPath.length > 0 ? 'Add Subcategory' : 'Add Category',
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'Category name'
        }
      ],
      submitText: 'Add'
    });

    if (result) {
      if (parentPath.length > 0) {
        this.configBuilder.addSubcategory(parentPath, result.name);
      } else {
        this.configBuilder.addCategory(result.name);
      }
      
      const newConfig = this.configBuilder.build();

      if (this.onConfigChange) {
        await this.onConfigChange(newConfig);
      }
    }
  }

  /**
   * Handler para eliminar categoría
   */
  async handleDeleteCategory(categoryPath) {
    if (!this.modalManager || categoryPath.length === 0) return;

    const categoryName = categoryPath[categoryPath.length - 1];

    const confirmed = await this.modalManager.showConfirm({
      title: 'Delete Category',
      message: `Are you sure you want to delete "${categoryName}" and all its contents?`,
      confirmText: 'Delete',
      danger: true
    });

    if (confirmed) {
      this.configBuilder.removeCategory(categoryPath);
      const newConfig = this.configBuilder.build();

      if (this.onConfigChange) {
        await this.onConfigChange(newConfig);
      }
    }
  }

  /**
   * Handler para cambiar visibilidad de toda la categoría
   */
  async handleCategoryVisibilityChange(categoryPath, visible) {
    this.configBuilder.setCategoryVisibility(categoryPath, visible, true);
    const newConfig = this.configBuilder.build();

    if (this.onConfigChange) {
      await this.onConfigChange(newConfig);
    }
  }

  // ============================================
  // HANDLERS DE CONFIGURACIÓN
  // ============================================

  /**
   * Handler para importar configuración
   */
  async handleImportConfig() {
    if (!this.modalManager) return;

    const result = await this.modalManager.showForm({
      title: 'Import Configuration',
      fields: [
        {
          name: 'json',
          label: 'JSON Configuration',
          type: 'textarea',
          rows: 10,
          required: true,
          placeholder: '{ "categories": [...] }'
        }
      ],
      submitText: 'Import'
    });

    if (result && result.json) {
      try {
        const parsed = JSON.parse(result.json);
        
        if (this.onConfigChange) {
          await this.onConfigChange(parsed);
        }

        await this.modalManager.showAlert({
          title: 'Success',
          message: 'Configuration imported successfully!',
          type: 'success'
        });
      } catch (e) {
        await this.modalManager.showAlert({
          title: 'Error',
          message: 'Invalid JSON format',
          type: 'error'
        });
      }
    }
  }

  /**
   * Handler para exportar configuración
   */
  async handleExportConfig() {
    if (!this.modalManager || !this.currentConfig) return;

    const json = JSON.stringify(this.currentConfig.toJSON ? this.currentConfig.toJSON() : this.currentConfig, null, 2);

    await this.modalManager.showCustom({
      title: 'Export Configuration',
      content: `
        <div class="export-container">
          <textarea readonly class="export-textarea">${json}</textarea>
          <button class="copy-button" onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">
            Copy to Clipboard
          </button>
        </div>
      `
    });
  }

  /**
   * Handler para limpiar caché
   */
  async handleClearCache() {
    if (!this.modalManager) return;

    const confirmed = await this.modalManager.showConfirm({
      title: 'Clear Cache',
      message: 'This will clear all cached Notion content. Continue?',
      confirmText: 'Clear'
    });

    if (confirmed && this.cacheService) {
      this.cacheService.clearLocalCache();
      
      await this.modalManager.showAlert({
        title: 'Success',
        message: 'Cache cleared successfully!',
        type: 'success'
      });
    }
  }

  // ============================================
  // HANDLERS DE IMÁGENES
  // ============================================

  /**
   * Handler para compartir imagen con jugadores
   */
  async handleShareImage(imageUrl, caption = '') {
    log('🖼️ Compartiendo imagen:', imageUrl);
    
    // Implementación depende de OBR SDK
    // Esta es una estructura base
    if (this.broadcastService) {
      // TODO: Implementar compartir imagen via OBR
    }
  }

  /**
   * Handler para abrir imagen en modal
   */
  handleOpenImageModal(imageUrl, caption = '') {
    if (!this.modalManager) return;

    this.modalManager.showCustom({
      title: caption || 'Image',
      className: 'image-modal',
      content: `
        <div class="image-modal-content">
          <img src="${imageUrl}" alt="${caption}" />
        </div>
      `
    });
  }
}

export default EventHandlers;

