/**
 * @fileoverview Gestor de modales
 * 
 * Gestiona la creación, apertura y cierre de modales en la aplicación.
 */

import { log } from '../utils/logger.js?v=20260722-4';

import { ModalSelect } from './ModalSelect.js';
import { createModalShell } from './ModalShell.js';

let fieldId = 0;

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
    this.previouslyFocusedElement = null;
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
      form.className = 'form';

      // Crear campos
      fields.forEach(field => {
        const fieldElement = this._createField(field);
        form.appendChild(fieldElement);
      });

      // Botones
      const buttons = document.createElement('div');
      buttons.className = 'form__actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--ghost btn--flex';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => {
        this.close();
      });

      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.className = 'btn btn--primary btn--flex';
      submitBtn.textContent = submitText;

      buttons.appendChild(cancelBtn);
      buttons.appendChild(submitBtn);
      form.appendChild(buttons);

      // Submit handler
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = this._getFormData(form, fields);
        this.onClose = null;
        this.close();
        resolve(data);
        onSubmit?.(data);
      });

      modal.querySelector('.modal__body').appendChild(form);
      this._showModal(modal, () => { onCancel?.(); resolve(null); });
      for (const field of fields.filter(field => field.type === 'select')) {
        new ModalSelect(form.elements.namedItem(field.name), field);
      }

      // Focus primer campo
      const firstInput = form.querySelector('input:not([hidden]), textarea, .modal-select__trigger');
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
      const content = modal.querySelector('.modal__body');

      const messageEl = document.createElement('p');
      messageEl.className = 'modal__text';
      messageEl.textContent = message;
      content.appendChild(messageEl);

      const buttons = document.createElement('div');
      buttons.className = 'form__actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--ghost btn--flex';
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener('click', () => {
        this.close();
        resolve(false);
      });

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = `btn btn--flex ${danger ? 'btn--danger' : 'btn--primary'}`;
      confirmBtn.textContent = confirmText;
      confirmBtn.addEventListener('click', () => {
        resolve(true);
        this.close();
      });

      buttons.appendChild(cancelBtn);
      buttons.appendChild(confirmBtn);
      content.appendChild(buttons);

      this._showModal(modal, () => resolve(false));
      (danger ? cancelBtn : confirmBtn).focus();
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
      modal.querySelector('.modal__content').classList.add(`modal-${type}`);
      
      const content = modal.querySelector('.modal__body');

      const messageEl = document.createElement('p');
      messageEl.className = 'modal__text';
      messageEl.textContent = message;
      content.appendChild(messageEl);

      const buttons = document.createElement('div');
      buttons.className = 'form__actions';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn--primary btn--flex';
      okBtn.textContent = buttonText;
      okBtn.addEventListener('click', () => {
        this.close();
        resolve();
      });

      buttons.appendChild(okBtn);
      content.appendChild(buttons);

      this._showModal(modal, () => resolve());
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
      modal.querySelector('.modal__content').classList.add(className);
    }

    const contentEl = modal.querySelector('.modal__body');
    if (typeof content === 'string') {
      contentEl.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      contentEl.appendChild(content);
    }

    this._showModal(modal, onClose);
    
    if (onOpen) onOpen(modal);

    return modal;
  }

  /**
   * Cierra el modal activo
   */
  close() {
    if (!this.activeModal) return;
    const onClose = this.onClose;
    const previous = this.previouslyFocusedElement;
    this.activeModal.remove();
    this.activeModal = null;
    this.onClose = null;
    this.previouslyFocusedElement = null;
    if (previous?.isConnected) previous.focus();
    onClose?.();
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
    const { root: overlay, content: container, titleId } = createModalShell();
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented) this.close();
    });

    // Header
    const header = document.createElement('div');
    header.className = 'modal__header';

    const titleEl = document.createElement('h2');
    titleEl.className = 'modal__title';
    titleEl.id = titleId;
    titleEl.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close-button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Content
    const content = document.createElement('div');
    content.className = 'modal__body';

    container.appendChild(header);
    container.appendChild(content);

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
    wrapper.className = 'form__field';
    const id = `modal-field-${++fieldId}`;

    if (field.label) {
      const label = document.createElement('label');
      label.className = 'form__label';
      label.htmlFor = id;
      label.textContent = field.label;
      if (field.required) label.append(' *');
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
    input.id = id;
    input.className = { select: 'select', textarea: 'textarea', checkbox: 'checkbox' }[field.type] || 'input';
    
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
      hint.className = 'form__help';
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
  _showModal(modal, onClose = null) {
    // Cerrar modal anterior si existe
    if (this.activeModal) {
      this.close();
    }

    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.container.appendChild(modal);
    this.activeModal = modal;

    this.onClose = onClose;

    log('Modal abierto');
  }
}

export default ModalManager;
