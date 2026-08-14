import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function createController(config) {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = config;
  controller.isGM = true;
  controller.isCoGM = false;
  controller.playerViewMode = false;
  controller.roomId = 'room-qa';
  controller.configParser = new ConfigParser();
  controller.configBuilder = null;
  controller.storageService = {
    saveLocalConfig: jest.fn(() => true)
  };
  controller.broadcastService = {
    broadcastVisiblePages: jest.fn().mockResolvedValue(true),
    notifyFullVaultUpdated: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue({ success: true })
  };
  controller.analyticsService = {
    trackPageMoved: jest.fn()
  };
  controller.uiRenderer = new UIRenderer();
  controller.pagesContainer = document.createElement('div');
  document.body.appendChild(controller.pagesContainer);
  return controller;
}

describe('ExtensionController CRUD ordering', () => {
  it('renders a duplicated page above the original after Move up', async () => {
    const original = new Page('QA page', 'https://example.com/qa', {
      id: 'page-original',
      visibleToPlayers: true
    });
    const category = new Category('QA', {
      id: 'category-qa',
      pages: [original]
    });
    const controller = createController(new Config({ categories: [category] }));
    const path = [{ id: category.id, name: category.name }];

    await controller._handlePageDuplicate(original, path, 0);
    const currentCategory = controller.config.categories[0];
    const copy = currentCategory.pages.find(page => page.name.endsWith('(copy)'));
    expect(copy).toBeDefined();

    await controller._handlePageMove(copy, path, 1, 'up');

    const names = [...controller.pagesContainer.querySelectorAll('.page-name-text')]
      .map(element => element.textContent);
    expect(names).toEqual(['QA page (copy)', 'QA page']);
    expect(controller.analyticsService.trackPageMoved)
      .toHaveBeenCalledWith('QA page (copy)', 'up');
  });

  it('preserves stored order indexes when invalid pages are omitted from rendering', () => {
    const invalid = new Page('Unsafe', 'javascript:alert(1)', { id: 'page-unsafe' });
    const first = new Page('First', 'https://example.com/first', { id: 'page-first' });
    const second = new Page('Second', 'https://example.com/second', { id: 'page-second' });
    const category = new Category('QA', {
      pages: [invalid, first, second],
      order: [
        { type: 'page', index: 0 },
        { type: 'page', index: 2 },
        { type: 'page', index: 1 }
      ]
    });
    const renderer = new UIRenderer();
    const container = document.createElement('div');

    renderer.renderAllCategories(new Config({ categories: [category] }), container, 'room-qa', true);

    const names = [...container.querySelectorAll('.page-name-text')]
      .map(element => element.textContent);
    expect(names).toEqual(['Second', 'First']);
  });

  it('preserves stored order indexes when hidden pages are omitted in Player view', () => {
    const hidden = new Page('Hidden', 'https://example.com/hidden', {
      id: 'page-hidden',
      visibleToPlayers: false
    });
    const first = new Page('Visible first', 'https://example.com/first', {
      id: 'page-first',
      visibleToPlayers: true
    });
    const second = new Page('Visible second', 'https://example.com/second', {
      id: 'page-second',
      visibleToPlayers: true
    });
    const category = new Category('QA', {
      pages: [hidden, first, second],
      order: [
        { type: 'page', index: 2 },
        { type: 'page', index: 0 },
        { type: 'page', index: 1 }
      ]
    });
    const renderer = new UIRenderer();
    const container = document.createElement('div');

    renderer.renderAllCategories(new Config({ categories: [category] }), container, 'room-qa', false);

    const names = [...container.querySelectorAll('.page-name-text')]
      .map(element => element.textContent);
    expect(names).toEqual(['Visible second', 'Visible first']);
  });

  it('rejects unsafe page URLs before persisting them', async () => {
    const category = new Category('QA', { id: 'category-qa' });
    const controller = createController(new Config({ categories: [category] }));
    controller.uiRenderer.showErrorToast = jest.fn();
    controller._showModalForm = jest.fn((title, fields, onSubmit) => {
      onSubmit({ name: 'Unsafe', url: 'javascript:alert(1)', visibleToPlayers: false });
    });

    controller._handleAddPage([{ id: category.id, name: category.name }], 'room-qa');
    await Promise.resolve();

    expect(controller.config.categories[0].pages).toHaveLength(0);
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
    expect(controller.uiRenderer.showErrorToast).toHaveBeenCalledWith(
      'Invalid URL',
      'Use a complete HTTP or HTTPS URL.'
    );
  });

  it('rejects an unsafe URL when editing an existing page', async () => {
    const page = new Page('Safe', 'https://example.com/safe', { id: 'page-safe' });
    const category = new Category('QA', { id: 'category-qa', pages: [page] });
    const controller = createController(new Config({ categories: [category] }));
    controller.uiRenderer.showErrorToast = jest.fn();

    const updated = await controller._handlePageEdit(
      page,
      [{ id: category.id, name: category.name }],
      0,
      { url: 'data:text/html,unsafe' }
    );

    expect(updated).toBe(false);
    expect(controller.config.categories[0].pages[0].url).toBe('https://example.com/safe');
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });

  it('hides the GM Add control while previewing Player view', async () => {
    const controller = createController(new Config({ categories: [] }));
    controller.render = jest.fn().mockResolvedValue(undefined);
    document.body.innerHTML = `
      <div class="player-view-toggle__switch" id="player-view-switch"></div>
      <span class="player-view-toggle__label"></span>
      <button id="add-button"></button>
    `;

    await controller._togglePlayerViewMode();

    expect(controller.playerViewMode).toBe(true);
    expect(document.getElementById('add-button').classList.contains('hidden')).toBe(true);
    expect(document.body.classList.contains('role-player')).toBe(true);

    await controller._togglePlayerViewMode();

    expect(controller.playerViewMode).toBe(false);
    expect(document.getElementById('add-button').classList.contains('hidden')).toBe(false);
    expect(document.body.classList.contains('role-player')).toBe(false);
  });
});
