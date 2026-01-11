/**
 * @fileoverview Gestor de modales
 * 
 * Gestiona la creación, apertura y cierre de modales en la aplicación.
 */

import { log } from '../utils/logger.js';

/**
 * Gestor de modales de la UI
 */
export class ModalManager {
  constructor() {
    // Modal activo actual
    this.activeModal = null;
    // Referencia al contenedor de modales
    this.container = null;
    // Callback para cuando se cierra un modal
    this.onClose = null;
  }

  /**
   * Inicializa el gestor con un contenedor
   * @param {HTMLElement|string} container - Contenedor o selector
   */
  init(container) {
    if (typeof container === 'string') {
      this.container = document.querySelector(container);
    } else {
      this.container = container;
    }

    if (!this.container) {
      this.container = document.body;
    }

    // Cerrar modal con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.close();
      }
    });
  }

  /**
   * Muestra un modal de formulario
   * @param {Object} options - Opciones del modal
   * @returns {Promise<Object|null>} - Datos del formulario o null si se cancela
   */
  showForm(options) {
    return new Promise((resolve) => {
      const {
        title = 'Form',
        fields = [],
        submitText = 'Save',
        cancelText = 'Cancel',
        onSubmit,
        onCancel
      } = options;

      const modal = this._createModalBase(title);
      const form = document.createElement('form');
      form.className = 'modal-form';

      // Crear campos
      fields.forEach(field => {
        const fieldElement = this._createField(field);
        form.appendChild(fieldElement);
      });

      // Botones
      const buttons = document.createElement('div');
      buttons.className = 'modal-buttons';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'modal-button modal-button-cancel';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => {
        if (onCancel) onCancel();
        this.close();
        resolve(null);
      });

      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.className = 'modal-button modal-button-submit';
      submitBtn.textContent = submitText;

      buttons.appendChild(cancelBtn);
      buttons.appendChild(submitBtn);
      form.appendChild(buttons);

      // Submit handler
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = this._getFormData(form, fields);
        if (onSubmit) onSubmit(data);
        this.close();
        resolve(data);
      });

      modal.querySelector('.modal-content').appendChild(form);
      this._showModal(modal);

      // Focus primer campo
      const firstInput = form.querySelector('input, textarea, select');
      if (firstInput) firstInput.focus();
    });
  }

  /**
   * Muestra un modal de confirmación
   * @param {Object} options - Opciones
   * @returns {Promise<boolean>}
   */
  showConfirm(options) {
    return new Promise((resolve) => {
      const {
        title = 'Confirm',
        message = 'Are you sure?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = false
      } = options;

      const modal = this._createModalBase(title);
      const content = modal.querySelector('.modal-content');

      const messageEl = document.createElement('p');
      messageEl.className = 'modal-message';
      messageEl.textContent = message;
      content.appendChild(messageEl);

      const buttons = document.createElement('div');
      buttons.className = 'modal-buttons';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'modal-button modal-button-cancel';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => {
        this.close();
        resolve(false);
      });

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = `modal-button modal-button-submit ${danger ? 'modal-button-danger' : ''}`;
      confirmBtn.textContent = confirmText;
      confirmBtn.addEventListener('click', () => {
        this.close();
        resolve(true);
      });

      buttons.appendChild(cancelBtn);
      buttons.appendChild(confirmBtn);
      content.appendChild(buttons);

      this._showModal(modal);
      confirmBtn.focus();
    });
  }

  /**
   * Muestra un modal de alerta
   * @param {Object} options - Opciones
   * @returns {Promise<void>}
   */
  showAlert(options) {
    return new Promise((resolve) => {
      const {
        title = 'Alert',
        message = '',
        buttonText = 'OK',
        type = 'info' // info, success, warning, error
      } = options;

      const modal = this._createModalBase(title);
      modal.querySelector('.modal-container').classList.add(`modal-${type}`);
      
      const content = modal.querySelector('.modal-content');

      const messageEl = document.createElement('p');
      messageEl.className = 'modal-message';
      messageEl.innerHTML = message;
      content.appendChild(messageEl);

      const buttons = document.createElement('div');
      buttons.className = 'modal-buttons';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'modal-button modal-button-submit';
      okBtn.textContent = buttonText;
      okBtn.addEventListener('click', () => {
        this.close();
        resolve();
      });

      buttons.appendChild(okBtn);
      content.appendChild(buttons);

      this._showModal(modal);
      okBtn.focus();
    });
  }

  /**
   * Muestra un modal personalizado
   * @param {Object} options - Opciones
   */
  showCustom(options) {
    const {
      title = '',
      content = '',
      className = '',
      onOpen,
      onClose
    } = options;

    const modal = this._createModalBase(title);
    if (className) {
      modal.querySelector('.modal-container').classList.add(className);
    }

    const contentEl = modal.querySelector('.modal-content');
    if (typeof content === 'string') {
      contentEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      contentEl.appendChild(content);
    }

    this.onClose = onClose;
    this._showModal(modal);
    
    if (onOpen) onOpen(modal);

    return modal;
  }

  /**
   * Cierra el modal activo
   */
  close() {
    if (this.activeModal) {
      this.activeModal.classList.remove('modal-visible');
      
      setTimeout(() => {
        if (this.activeModal && this.activeModal.parentNode) {
          this.activeModal.parentNode.removeChild(this.activeModal);
        }
        this.activeModal = null;
        
        if (this.onClose) {
          this.onClose();
          this.onClose = null;
        }
      }, 200);

      log('Modal cerrado');
    }
  }

  /**
   * Verifica si hay un modal activo
   * @returns {boolean}
   */
  isOpen() {
    return this.activeModal !== null;
  }

  // ============================================
  // MÉTODOS PRIVADOS
  // ============================================

  /**
   * Crea la estructura base de un modal
   * @private
   */
  _createModalBase(title) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const container = document.createElement('div');
    container.className = 'modal-container';

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';

    const titleEl = document.createElement('h3');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close-button';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Content
    const content = document.createElement('div');
    content.className = 'modal-content';

    container.appendChild(header);
    container.appendChild(content);
    overlay.appendChild(container);

    // Click en overlay cierra modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    return overlay;
  }

  /**
   * Crea un campo de formulario
   * @private
   */
  _createField(field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field';

    if (field.label) {
      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = field.label;
      if (field.required) {
        label.innerHTML += ' <span class="required">*</span>';
      }
      wrapper.appendChild(label);
    }

    let input;

    switch (field.type) {
      case 'textarea':
        input = document.createElement('textarea');
        input.rows = field.rows || 4;
        break;

      case 'select':
        input = document.createElement('select');
        (field.options || []).forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          input.appendChild(option);
        });
        break;

      case 'checkbox':
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = field.value || false;
        break;

      default:
        input = document.createElement('input');
        input.type = field.type || 'text';
    }

    input.name = field.name;
    input.className = 'form-input';
    
    if (field.value !== undefined && field.type !== 'checkbox') {
      input.value = field.value;
    }
    
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }
    
    if (field.required) {
      input.required = true;
    }

    wrapper.appendChild(input);

    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'form-hint';
      hint.textContent = field.hint;
      wrapper.appendChild(hint);
    }

    return wrapper;
  }

  /**
   * Obtiene los datos del formulario
   * @private
   */
  _getFormData(form, fields) {
    const data = {};
    
    fields.forEach(field => {
      const input = form.querySelector(`[name="${field.name}"]`);
      if (input) {
        if (field.type === 'checkbox') {
          data[field.name] = input.checked;
        } else {
          data[field.name] = input.value;
        }
      }
    });

    return data;
  }

  /**
   * Muestra el modal
   * @private
   */
  _showModal(modal) {
    // Cerrar modal anterior si existe
    if (this.activeModal) {
      this.close();
    }

    this.container.appendChild(modal);
    this.activeModal = modal;

    // Trigger animación
    requestAnimationFrame(() => {
      modal.classList.add('modal-visible');
    });

    log('Modal abierto');
  }
}

export default ModalManager;

