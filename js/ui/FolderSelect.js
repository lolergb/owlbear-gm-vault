import { createIcon } from '../utils/iconHelper.js';

const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

/** A searchable folder picker that preserves the native select's submitted value. */
export class FolderSelect {
  constructor(select, { options = [], label = 'Folder' } = {}) {
    this.select = select;
    this.document = select.ownerDocument;
    this.view = this.document.defaultView;
    this.options = options.map((option, index) => {
      const path = option.path || [];
      const name = String(option.label ?? 'Untitled folder');
      return {
        value: String(option.value ?? ''), name, path,
        depth: option.depth ?? Math.max(0, path.length - 1),
        display: path.length ? path.join(' / ') : name,
        search: normalize(option.searchText ?? (path.length ? path.join(' / ') : name)),
        id: `${select.id}-option-${index}`
      };
    });
    const originalValue = select.value;
    select.replaceChildren(...this.options.map(option => new this.view.Option(option.name, option.value)));
    if (this.options.some(option => option.value === originalValue)) select.value = originalValue;

    this.root = this.document.createElement('div');
    this.root.className = 'folder-select';
    this.trigger = this.document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.id = `${select.id}-trigger`;
    this.trigger.className = 'select folder-select__trigger';
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.value = this.document.createElement('span');
    this.value.className = 'folder-select__value';
    this.trigger.append(createIcon('img/folder-close.svg'), this.value);
    this.trigger.insertAdjacentHTML('beforeend', '<svg class="folder-select__chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>');
    this.root.append(this.trigger);
    select.after(this.root);
    this.label = Array.from(select.labels || [])[0];
    if (this.label) {
      this.label.id ||= `${select.id}-label`;
      this.label.htmlFor = this.trigger.id;
      this.trigger.setAttribute('aria-labelledby', this.label.id);
    } else this.trigger.setAttribute('aria-label', label);
    select.hidden = true;
    select.classList.add('folder-select__source');
    select.tabIndex = -1;

    this.popup = this.document.createElement('div');
    this.popup.id = `${select.id}-popup`;
    this.popup.className = 'folder-select__popup';
    this.popup.hidden = true;
    this.popup.setAttribute('role', 'dialog');
    this.popup.setAttribute('aria-label', `Choose ${label.toLocaleLowerCase()}`);
    this.trigger.setAttribute('aria-controls', this.popup.id);
    this.search = this.document.createElement('input');
    this.search.id = `${select.id}-search`;
    this.search.type = 'search';
    this.search.className = 'input folder-select__search';
    this.search.placeholder = 'Search folders...';
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.setAttribute('aria-label', 'Search folders');
    this.search.setAttribute('role', 'combobox');
    this.search.setAttribute('aria-autocomplete', 'list');
    this.search.setAttribute('aria-expanded', 'false');
    this.list = this.document.createElement('div');
    this.list.id = `${select.id}-listbox`;
    this.list.className = 'folder-select__list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Folders');
    this.search.setAttribute('aria-controls', this.list.id);
    this.status = this.document.createElement('p');
    this.status.id = `${select.id}-search-status`;
    this.status.className = 'folder-select__status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.search.setAttribute('aria-describedby', this.status.id);
    this.popup.append(this.search, this.list, this.status);
    // A sibling of the scrolling modal content avoids clipping, remains within
    // its accessible dialog, and stays below the consent banner's layer.
    (select.closest('.modal, .modal-overlay') || this.document.body).append(this.popup);

    this.trigger.addEventListener('click', () => this.opened ? this.close() : this.open());
    this.trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.open();
      }
    });
    this.search.addEventListener('input', () => { this.renderOptions(); this.position(); });
    this.search.addEventListener('keydown', event => this.onKeydown(event));
    this.list.addEventListener('click', event => {
      const row = event.target.closest('[role="option"]');
      if (row && this.list.contains(row)) this.choose(row.dataset.value);
    });
    this.onChange = () => this.refresh();
    select.addEventListener('change', this.onChange);
    this.observer = new this.view.MutationObserver(() => {
      if (!this.root.isConnected) this.destroy();
    });
    this.observer.observe(this.document.body, { childList: true, subtree: true });
    this.refresh();
  }

  refresh() {
    const selected = this.options.find(option => option.value === this.select.value);
    this.value.textContent = selected?.display || 'Choose a folder';
    this.trigger.title = this.value.textContent;
    this.trigger.disabled = this.select.disabled || !this.options.length;
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
    this.search.focus({ preventScroll: true });
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
    this.list.replaceChildren(...this.matches.map(option => {
      const row = this.document.createElement('div');
      row.id = option.id;
      row.className = 'folder-select__option';
      row.dataset.value = option.value;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === this.select.value));
      row.setAttribute('aria-label', option.display);
      row.style.setProperty('--folder-depth', query ? 0 : Math.min(option.depth, 5));
      row.title = option.display;
      const text = this.document.createElement('span');
      text.className = 'folder-select__option-text';
      const name = this.document.createElement('span');
      name.className = 'folder-select__option-name';
      name.textContent = option.name;
      text.append(name);
      if (query && option.path.length > 1) {
        const path = this.document.createElement('span');
        path.className = 'folder-select__path';
        path.textContent = option.path.slice(0, -1).join(' / ');
        text.append(path);
      }
      row.append(createIcon('img/folder-close.svg', { size: 'sm' }), text);
      if (option.value === this.select.value) {
        row.insertAdjacentHTML('beforeend', '<svg class="folder-select__check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
      }
      return row;
    }));
    this.status.textContent = this.matches.length
      ? `${this.matches.length} ${this.matches.length === 1 ? 'folder' : 'folders'}`
      : 'No folders found. Try another search.';
    const selectedIndex = this.matches.findIndex(option => option.value === this.select.value);
    this.setActive(selectedIndex >= 0 ? selectedIndex : (this.matches.length ? 0 : -1));
  }

  setActive(index) {
    this.activeIndex = index;
    Array.from(this.list.children).forEach((row, i) => row.dataset.active = String(i === index));
    const active = this.list.children[index];
    if (active) {
      this.search.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else this.search.removeAttribute('aria-activedescendant');
  }

  choose(value) {
    if (!this.options.some(option => option.value === value)) return;
    this.select.value = value;
    this.select.dispatchEvent(new this.view.Event('change', { bubbles: true }));
    this.close();
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
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.matches.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.setActive(Math.max(0, Math.min(this.matches.length - 1, this.activeIndex + delta)));
    }
  }

  position() {
    if (!this.opened) return;
    if (!this.trigger.getClientRects().length) { this.close(false); return; }
    const rect = this.trigger.getBoundingClientRect();
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
    this.observer?.disconnect();
    this.select.removeEventListener('change', this.onChange);
    this.popup.remove();
    this.root.remove();
    this.select.hidden = false;
    this.select.classList.remove('folder-select__source');
    this.select.removeAttribute('tabindex');
    if (this.label) this.label.htmlFor = this.select.id;
  }
}
