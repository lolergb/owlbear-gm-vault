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
  controller.analyticsService = {
    trackPageLinkedToToken: jest.fn(),
    trackTokenPageSearchUsed: jest.fn()
  };
  controller._showFeedback = jest.fn();
  return controller;
}

function typeSearch(searchInput, value) {
  searchInput.value = value;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('ExtensionController token page selector', () => {
  it('filtra por nombre o ruta sin distinguir mayúsculas ni acentos', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');

    const searchInput = document.querySelector('#field-pageIndex-search');
    const select = document.querySelector('#field-pageIndex');
    const listbox = document.querySelector('#field-pageIndex-listbox');
    const status = document.querySelector('#field-pageIndex-search-status');

    expect(searchInput).not.toBeNull();
    expect(searchInput.placeholder).toBe('Search by page or folder...');
    expect(Array.from(select.options, option => option.textContent)).toEqual([
      'Bestiary → Goblin Scout',
      'Bestiary → Ángel caído',
      'Frozen Keep → Throne Room',
      'Session Overview'
    ]);
    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(Array.from(listbox.children, option => option.textContent)).toEqual([
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
    expect(Array.from(listbox.children, option => option.textContent)).toEqual([
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

  it('registra métricas agregadas de búsqueda sin enviar la consulta', async () => {
    jest.useFakeTimers();
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');
    typeSearch(document.querySelector('#field-pageIndex-search'), 'angel');
    await jest.advanceTimersByTimeAsync(500);

    expect(controller.analyticsService.trackTokenPageSearchUsed).toHaveBeenCalledWith({
      queryLength: 5,
      resultCount: 1,
      totalCount: 4
    });
    expect(controller.analyticsService.trackTokenPageSearchUsed.mock.calls[0][0])
      .not.toHaveProperty('query');
  });

  it('oculta la única carpeta raíz común sin perderla en la búsqueda', async () => {
    const controller = createController();
    controller.config = new Config({
      categories: [
        new Category('Bajo el Hielo Carmesí', {
          pages: [
            new Page('Bajo el Hielo Carmesí', 'https://example.com/campaign')
          ],
          categories: [
            new Category('Capítulo I', {
              categories: [
                new Category('Monstruos y criaturas', {
                  pages: [
                    new Page('Necrichor', 'https://example.com/necrichor')
                  ]
                })
              ]
            })
          ],
          order: [
            { type: 'page', index: 0 },
            { type: 'category', index: 0 }
          ]
        })
      ]
    });

    await controller._showPageSelectorForToken('token-1');

    const searchInput = document.querySelector('#field-pageIndex-search');
    const listbox = document.querySelector('#field-pageIndex-listbox');
    expect(Array.from(listbox.children, option => option.textContent)).toEqual([
      'Bajo el Hielo Carmesí',
      'Capítulo I / Monstruos y criaturas → Necrichor'
    ]);

    typeSearch(searchInput, 'Bajo el Hielo Carmesí');
    expect(Array.from(listbox.children, option => option.textContent)).toEqual([
      'Bajo el Hielo Carmesí',
      'Capítulo I / Monstruos y criaturas → Necrichor'
    ]);

    typeSearch(searchInput, 'Necrichor');
    expect(document.querySelector('#field-pageIndex').value).toBe('1');
  });

  it('bloquea el envío sin resultados y restaura la lista al limpiar', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken(['token-1']);

    const searchInput = document.querySelector('#field-pageIndex-search');
    const select = document.querySelector('#field-pageIndex');
    const listbox = document.querySelector('#field-pageIndex-listbox');
    const submitButton = document.querySelector('#modal-submit');
    const status = document.querySelector('#field-pageIndex-search-status');

    typeSearch(searchInput, 'missing page');
    expect(select.options).toHaveLength(0);
    expect(listbox.children).toHaveLength(0);
    expect(listbox.getAttribute('aria-disabled')).toBe('true');
    expect(select.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
    expect(searchInput.hasAttribute('aria-invalid')).toBe(false);
    expect(status.textContent).toBe('No pages found');

    typeSearch(searchInput, '');
    expect(select.options).toHaveLength(4);
    expect(listbox.children).toHaveLength(4);
    expect(listbox.getAttribute('aria-disabled')).toBe('false');
    expect(select.disabled).toBe(false);
    expect(submitButton.disabled).toBe(false);
    expect(status.textContent).toBe('4 pages');
  });

  it('mueve el foco a los resultados con la flecha abajo', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');

    const searchInput = document.querySelector('#field-pageIndex-search');
    const listbox = document.querySelector('#field-pageIndex-listbox');
    searchInput.focus();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));

    expect(document.activeElement).toBe(listbox);
  });

  it('sincroniza click y teclado de la lista visible con el valor del formulario', async () => {
    const controller = createController();

    await controller._showPageSelectorForToken('token-1');

    const select = document.querySelector('#field-pageIndex');
    const listbox = document.querySelector('#field-pageIndex-listbox');
    const options = listbox.querySelectorAll('[role="option"]');

    options[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select.value).toBe('2');
    expect(options[2].getAttribute('aria-selected')).toBe('true');

    listbox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));
    expect(select.value).toBe('3');
    expect(options[3].getAttribute('aria-selected')).toBe('true');
  });

  it('mantiene visible la opción seleccionada al reconstruir los resultados', async () => {
    const controller = createController();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      await controller._showPageSelectorForToken('token-1');

      const searchInput = document.querySelector('#field-pageIndex-search');
      const listbox = document.querySelector('#field-pageIndex-listbox');
      listbox.children[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      typeSearch(searchInput, 'Session Overview');
      typeSearch(searchInput, '');

      expect(listbox.getAttribute('aria-activedescendant')).toBe('field-pageIndex-option-3');
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    } finally {
      if (originalScrollIntoView) {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });

  it('explica y bloquea una selección requerida con valor vacío', () => {
    const controller = createController();

    controller._showModalForm('Searchable select', [{
      name: 'item',
      label: 'Item',
      type: 'select',
      searchable: true,
      required: true,
      options: [
        { label: 'Choose an item', value: '' },
        { label: 'Lantern', value: 'lantern' }
      ]
    }], jest.fn());

    const select = document.querySelector('#field-item');
    const listbox = document.querySelector('#field-item-listbox');
    const status = document.querySelector('#field-item-search-status');
    const submitButton = document.querySelector('#modal-submit');

    expect(select.value).toBe('');
    expect(listbox.getAttribute('aria-invalid')).toBe('true');
    expect(status.textContent).toBe('Select an option');
    expect(submitButton.disabled).toBe(true);

    listbox.children[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select.value).toBe('lantern');
    expect(listbox.getAttribute('aria-invalid')).toBe('false');
    expect(status.textContent).toBe('2 options');
    expect(submitButton.disabled).toBe(false);
  });

  it('actualiza el estado accesible de todos los selectores requeridos', () => {
    const controller = createController();
    const searchableField = (name) => ({
      name,
      label: name,
      type: 'select',
      searchable: true,
      required: true,
      options: [
        { label: 'Choose', value: '' },
        { label: 'Selected', value: 'selected' }
      ]
    });

    controller._showModalForm('Searchable selects', [
      searchableField('first'),
      searchableField('second')
    ], jest.fn());

    const firstListbox = document.querySelector('#field-first-listbox');
    const secondListbox = document.querySelector('#field-second-listbox');
    secondListbox.children[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(firstListbox.getAttribute('aria-invalid')).toBe('true');
    expect(secondListbox.getAttribute('aria-invalid')).toBe('false');
    expect(document.querySelector('#modal-submit').disabled).toBe(true);
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
