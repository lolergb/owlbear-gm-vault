import { createIcon } from '../utils/iconHelper.js';

const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

/** Searchable modal field backed by a native select for form submission. */
export class ModalSelect {
  constructor(select, {
    options = Array.from(select.options, opt => ({ value: opt.value, label: opt.textContent })),
    label = 'Option', resultLabel = 'option', icon, placeholder, searchLabel, searchPlaceholder,
    noResultsText, onSearch, searchable = true, trackSearchSelection = false, editableInput
  } = {}) {
    this.noun = resultLabel;
    this.placeholder = placeholder || `Choose ${label.toLowerCase()}`;
    this.icon = icon;
    this.noResultsText = noResultsText || `No ${resultLabel}s found. Try another search.`;
    this.onSearch = onSearch;
    this.liveSelection = trackSearchSelection;
    this.searchable = searchable;
    this.select = select;
    this.editableInput = editableInput;
    this.document = select.ownerDocument;
    this.view = this.document.defaultView;
    this.originalTabIndex = select.getAttribute('tabindex');
    this.options = options.map((option, index) => {
      const path = option.path || [];
      const name = String(option.label ?? '');
      return {
        value: String(option.value ?? ''), name, path, detail: option.detail,
        depth: option.depth ?? Math.max(0, path.length - 1),
        display: path.length ? path.join(' / ') : name,
        search: normalize(option.searchText ?? (path.length ? path.join(' / ') : name)),
        id: `${select.id}-option-${index}`
      };
    });
    const originalValue = select.value;
    select.replaceChildren(...this.options.map(option => new this.view.Option(option.name, option.value)));
    if (placeholder && !this.options.some(option => option.value === '')) {
      select.prepend(new this.view.Option(placeholder, ''));
    }
    if (Array.from(select.options).some(option => option.value === originalValue)) select.value = originalValue;

    this.root = this.document.createElement('div');
    this.root.className = 'modal-select';
    this.trigger = this.document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.id = `${select.id}-trigger`;
    this.trigger.className = 'select modal-select__trigger';
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.value = this.document.createElement('span');
    this.value.className = 'modal-select__value';
    if (icon) this.trigger.append(createIcon(icon));
    this.trigger.append(this.value);
    this.trigger.append(createIcon('img/icon-arrow.svg', { className: 'modal-select__chevron' }));
    this.root.append(this.trigger);
    select.after(this.root);
    if (editableInput) {
      this.root.classList.add('modal-select--editable');
      this.root.prepend(editableInput);
      this.value.hidden = true;
      this.onEdit = () => {
        this.select.value = editableInput.value;
        this.refresh();
      };
      this.onEditKeydown = event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.open();
        }
      };
      editableInput.addEventListener('input', this.onEdit);
      editableInput.addEventListener('keydown', this.onEditKeydown);
      this.onEdit();
    }
    this.label = Array.from(select.labels || [])[0];
    if (this.label) {
      this.label.id ||= `${select.id}-label`;
      this.label.htmlFor = this.trigger.id;
      this.trigger.setAttribute('aria-labelledby', this.label.id);
    } else this.trigger.setAttribute('aria-label', label);
    select.hidden = true;
    select.classList.add('modal-select__source');
    select.tabIndex = -1;

    this.popup = this.document.createElement('div');
    this.popup.id = `${select.id}-popup`;
    this.popup.className = 'modal-select__popup';
    this.popup.hidden = true;
    this.popup.setAttribute('role', 'dialog');
    this.popup.setAttribute('aria-label', `Choose ${label.toLocaleLowerCase()}`);
    this.trigger.setAttribute('aria-controls', this.popup.id);
    this.search = this.document.createElement('input');
    if (searchable) this.search.id = `${select.id}-search`;
    this.search.type = 'search';
    this.search.className = 'input modal-select__search';
    this.search.placeholder = searchPlaceholder || `Search ${resultLabel}s...`;
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.setAttribute('aria-label', searchLabel || `Search ${resultLabel}s`);
    this.search.hidden = !searchable;
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-autocomplete', 'list');
    this.search.setAttribute('aria-expanded', 'false');
    this.list = this.document.createElement('div');
    this.list.id = `${select.id}-listbox`;
    this.list.className = 'modal-select__list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.list.tabIndex = -1;
    this.search.setAttribute('aria-controls', this.list.id);
    this.status = this.document.createElement('p');
    this.status.id = `${select.id}-search-status`;
    this.status.className = 'modal-select__status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.search.setAttribute('aria-describedby', this.status.id);
    this.popup.append(this.search, this.list, this.status);
    // A sibling of the scrolling modal content avoids clipping, remains within
    // its accessible dialog, and stays below the consent banner's layer.
    (select.closest('dialog, [role="dialog"], .modal, .modal-overlay') || this.document.body).append(this.popup);

    this.trigger.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.open();
      }
    });
    this.search.addEventListener('input', () => {
      this.renderOptions();
      this.position();
      clearTimeout(this.searchTimer);
      const queryLength = this.search.value.trim().length;
      if (queryLength && this.onSearch) {
        const resultCount = this.matches.length;
        this.searchTimer = this.view.setTimeout(() => this.onSearch({ queryLength, resultCount, totalCount: this.options.length }), 500);
      }
    });
    this.search.addEventListener('keydown', event => this.onKeydown(event));
    this.list.addEventListener('keydown', event => this.onKeydown(event));
    this.list.addEventListener('click', event => {
      const row = event.target.closest('[role="option"]');
      if (row && this.list.contains(row)) this.choose(row.dataset.value);
    });
    this.onChange = () => this.refresh();
    select.addEventListener('change', this.onChange);
    this.onInvalid = event => {
      event.preventDefault();
      this.trigger.focus();
      this.open();
    };
    select.addEventListener('invalid', this.onInvalid);
    this.observer = new this.view.MutationObserver(() => {
      if (!this.root.isConnected) this.destroy();
    });
    this.observer.observe(this.document.body, { childList: true, subtree: true });
    this.refresh();
    if (this.liveSelection) this.renderOptions();
  }

  refresh() {
    const selected = this.options.find(option => option.value === this.select.value);
    this.value.textContent = selected?.display || this.placeholder;
    this.trigger.title = this.editableInput ? this.placeholder : this.value.textContent;
    this.trigger.disabled = !this.options.length || (!this.liveSelection && this.select.disabled);
    if (this.select.required) {
      this.trigger.setAttribute('aria-required', 'true');
      this.trigger.setAttribute('aria-invalid', String(!this.select.value));
    }
    if (this.opened) this.renderOptions();
  }

  open() {
    if (this.opened || this.trigger.disabled) return;
    this.opened = true;
    this.search.value = '';
    this.popup.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.search.setAttribute('aria-expanded', 'true');
    this.renderOptions();
    this.position();
    (this.searchable ? this.search : this.list).focus({ preventScroll: true });
    this.openListeners = [];
    const listen = (target, event, callback, options) => {
      target?.addEventListener(event, callback, options);
      this.openListeners.push(() => target?.removeEventListener(event, callback, options));
    };
    const outside = event => {
      if (!this.root.contains(event.target) && !this.popup.contains(event.target)) this.close(false);
    };
    listen(this.document, 'pointerdown', outside, true);
    listen(this.document, 'focusin', outside);
    listen(this.view, 'resize', () => this.position());
    listen(this.view, 'scroll', event => {
      if (!this.popup.contains(event.target)) this.position();
    }, true);
    listen(this.view.visualViewport, 'resize', () => this.position());
    listen(this.view.visualViewport, 'scroll', () => this.position());
  }

  close(restoreFocus = true) {
    if (!this.opened) return;
    this.opened = false;
    this.popup.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.search.setAttribute('aria-expanded', 'false');
    this.search.removeAttribute('aria-activedescendant');
    this.openListeners?.forEach(remove => remove());
    this.openListeners = [];
    if (restoreFocus && this.trigger.isConnected) this.trigger.focus({ preventScroll: true });
  }

  renderOptions() {
    const query = normalize(this.search.value.trim());
    this.matches = this.options.filter(option => option.search.includes(query));
    if (this.liveSelection) {
      const previous = this.select.value;
      this.select.replaceChildren(...this.matches.map(o => new this.view.Option(o.name, o.value)));
      if (this.matches.some(o => o.value === previous)) this.select.value = previous;
      this.select.disabled = !this.matches.length;
      this.list.setAttribute('aria-disabled', String(this.select.disabled));
    }
    this.list.replaceChildren(...this.matches.map(option => {
      const row = this.document.createElement('div');
      row.id = option.id;
      row.className = 'modal-select__option';
      row.dataset.value = option.value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === this.select.value));
      row.setAttribute('aria-label', [option.display, option.detail].filter(Boolean).join(', '));
      row.style.setProperty('--option-depth', query ? 0 : Math.min(option.depth, 5));
      row.title = option.display;
      const text = this.document.createElement('span');
      text.className = 'modal-select__option-text';
      const name = this.document.createElement('span');
      name.className = 'modal-select__option-name';
      name.textContent = option.name;
      text.append(name);
      const detail = option.detail || (query && option.path.length > 1 ? option.path.slice(0, -1).join(' / ') : '');
      if (detail) {
        const path = this.document.createElement('span');
        path.className = 'modal-select__path';
        path.textContent = detail;
        text.append(path);
      }
      if (this.icon) row.append(createIcon(this.icon, { size: 'sm' }));
      row.append(text);
      if (option.value === this.select.value) {
        row.insertAdjacentHTML('beforeend', '<svg class="modal-select__check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
      }
      return row;
    }));
    this.syncSelection();
    const selectedIndex = this.matches.findIndex(option => option.value === this.select.value);
    this.setActive(selectedIndex >= 0 ? selectedIndex : (this.matches.length ? 0 : -1));
  }

  syncSelection() {
    const invalid = this.select.required && !this.select.value;
    this.list.setAttribute('aria-invalid', String(invalid));
    this.trigger.setAttribute('aria-invalid', String(invalid));
    this.value.textContent = this.options.find(o => o.value === this.select.value)?.display || this.placeholder;
    this.trigger.title = this.editableInput ? this.placeholder : this.value.textContent;
    this.status.textContent = this.matches.length === 0 ? this.noResultsText
      : invalid && this.liveSelection ? 'Select an option'
      : `${this.matches.length} ${this.noun}${this.matches.length === 1 ? '' : 's'}`;
    if (this.liveSelection) this.select.form?.dispatchEvent(new this.view.Event('input', { bubbles: true }));
  }

  setActive(index) {
    this.activeIndex = index;
    Array.from(this.list.children).forEach((row, i) => row.dataset.active = String(i === index));
    const active = this.list.children[index];
    if (active) {
      this.list.setAttribute('aria-activedescendant', active.id);
      this.search.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.search.removeAttribute('aria-activedescendant');
      this.list.removeAttribute('aria-activedescendant');
    }
  }

  choose(value) {
    if (!this.options.some(option => option.value === value)) return;
    this.select.value = value;
    if (this.editableInput) {
      this.editableInput.value = value;
      this.editableInput.dispatchEvent(new this.view.Event('input', { bubbles: true }));
    }
    this.setActive(this.matches.findIndex(option => option.value === value));
    Array.from(this.list.children).forEach(row => row.setAttribute('aria-selected', String(row.dataset.value === value)));
    this.syncSelection();
    this.select.dispatchEvent(new this.view.Event('change', { bubbles: true }));
    this.close();
    this.editableInput?.focus({ preventScroll: true });
  }

  onKeydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Tab') {
      // Restore the trigger before the browser advances to the next form field.
      this.close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const option = this.matches[this.activeIndex];
      if (option) this.choose(option.value);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!this.matches.length) return;
      if (this.liveSelection && event.target === this.search && event.key === 'ArrowDown') {
        this.list.focus();
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const last = this.matches.length - 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : this.activeIndex + delta;
      this.setActive(Math.max(0, Math.min(last, next)));
      if (this.liveSelection) {
        this.select.value = this.matches[this.activeIndex].value;
        Array.from(this.list.children).forEach(row => row.setAttribute('aria-selected', String(row.dataset.value === this.select.value)));
        this.syncSelection();
      }
    }
  }

  position() {
    if (!this.opened) return;
    if (!this.trigger.getClientRects().length) { this.close(false); return; }
    const rect = this.root.getBoundingClientRect();
    const viewport = this.view.visualViewport;
    const top = (viewport?.offsetTop || 0) + 8;
    const left = (viewport?.offsetLeft || 0) + 8;
    const width = (viewport?.width || this.view.innerWidth) - 16;
    let bottom = top + (viewport?.height || this.view.innerHeight) - 16;
    const banner = this.document.getElementById('cookie-consent-banner');
    if (banner?.getClientRects().length) bottom = Math.min(bottom, banner.getBoundingClientRect().top - 8);
    const below = Math.max(0, bottom - Math.max(top, rect.bottom) - 4);
    const above = Math.max(0, Math.min(bottom, rect.top) - top - 4);
    const upward = below < 300 && above > below;
    const height = Math.min(360, upward ? above : below);
    this.popup.style.width = `${Math.min(width, Math.max(240, rect.width))}px`;
    this.popup.style.left = `${Math.max(left, Math.min(rect.left, left + width - Math.min(width, Math.max(240, rect.width))))}px`;
    this.popup.style.maxHeight = `${height}px`;
    const actualHeight = Math.min(height, this.popup.scrollHeight + 2);
    this.popup.style.top = `${upward ? Math.min(bottom, rect.top) - actualHeight - 4 : Math.max(top, rect.bottom + 4)}px`;
  }

  destroy() {
    this.close(false);
    this.view.clearTimeout(this.searchTimer);
    this.observer?.disconnect();
    this.select.removeEventListener('change', this.onChange);
    this.select.removeEventListener('invalid', this.onInvalid);
    if (this.editableInput) {
      this.editableInput.removeEventListener('input', this.onEdit);
      this.editableInput.removeEventListener('keydown', this.onEditKeydown);
      this.root.before(this.editableInput);
    }
    this.popup.remove();
    this.root.remove();
    this.select.hidden = false;
    this.select.classList.remove('modal-select__source');
    if (this.originalTabIndex === null) this.select.removeAttribute('tabindex');
    else this.select.setAttribute('tabindex', this.originalTabIndex);
    if (this.label) this.label.htmlFor = this.select.id;
  }
}
