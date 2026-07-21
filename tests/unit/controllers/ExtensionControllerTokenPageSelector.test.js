import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';

function createController() {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = new Config({
    pages: [
      new Page('Session Overview', 'https://example.com/overview', { id: 'page-overview' })
    ],
    categories: [
      new Category('Bestiary', {
        pages: [
          new Page('Goblin Scout', 'https://example.com/goblin', { id: 'page-goblin' }),
          new Page('Ángel caído', 'https://example.com/angel', { id: 'page-angel' })
        ]
      }),
      new Category('Frozen Keep', {
        pages: [
          new Page('Throne Room', 'https://example.com/throne', { id: 'page-throne' })
        ]
      })
    ]
  });
  controller.analyticsService = { trackPageLinkedToToken: jest.fn() };
  controller._showFeedback = jest.fn();
  return controller;
}

function typeSearch(searchInput, value) {
  searchInput.value = value;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ExtensionController token page selector', () => {
  it('filtra por nombre o ruta sin distinguir mayúsculas ni acentos', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');

    const searchInput = document.querySelector('#field-pageIndex-search');
    const select = document.querySelector('#field-pageIndex');
    const status = document.querySelector('#field-pageIndex-search-status');

    expect(searchInput).not.toBeNull();
    expect(searchInput.placeholder).toBe('Search by page or folder...');
    expect(Array.from(select.options, option => option.textContent)).toEqual([
      'Bestiary → Goblin Scout',
      'Bestiary → Ángel caído',
      'Frozen Keep → Throne Room',
      'Session Overview'
    ]);
    expect(status.textContent).toBe('4 pages');

    typeSearch(searchInput, 'angel');
    expect(Array.from(select.options, option => option.textContent)).toEqual([
      'Bestiary → Ángel caído'
    ]);
    expect(select.value).toBe('1');
    expect(status.textContent).toBe('1 page');

    typeSearch(searchInput, 'FROZEN');
    expect(Array.from(select.options, option => option.textContent)).toEqual([
      'Frozen Keep → Throne Room'
    ]);
    expect(select.value).toBe('2');
  });

  it('bloquea el envío sin resultados y restaura la lista al limpiar', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken(['token-1']);

    const searchInput = document.querySelector('#field-pageIndex-search');
    const select = document.querySelector('#field-pageIndex');
    const submitButton = document.querySelector('#modal-submit');
    const status = document.querySelector('#field-pageIndex-search-status');

    typeSearch(searchInput, 'missing page');
    expect(select.options).toHaveLength(0);
    expect(select.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
    expect(searchInput.hasAttribute('aria-invalid')).toBe(false);
    expect(status.textContent).toBe('No pages found');

    typeSearch(searchInput, '');
    expect(select.options).toHaveLength(4);
    expect(select.disabled).toBe(false);
    expect(submitButton.disabled).toBe(false);
    expect(status.textContent).toBe('4 pages');
  });

  it('mueve el foco a los resultados con la flecha abajo', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');

    const searchInput = document.querySelector('#field-pageIndex-search');
    const select = document.querySelector('#field-pageIndex');
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));

    expect(document.activeElement).toBe(select);
  });

  it('mantiene intactos los selects que no habilitan búsqueda', () => {
    const controller = createController();

    controller._showModalForm('Regular select', [{
      name: 'folder',
      label: 'Folder',
      type: 'select',
      options: [{ label: 'Root', value: 'root' }],
      required: true
    }], jest.fn());

    const select = document.querySelector('#field-folder');
    expect(document.querySelector('#field-folder-search')).toBeNull();
    expect(select.classList.contains('select--searchable')).toBe(false);
    expect(select.hasAttribute('data-searchable-select')).toBe(false);
    expect(select.hasAttribute('size')).toBe(false);
  });
});
