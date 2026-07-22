import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
});

function createController(config, { roomSaved = true } = {}) {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = config;
  controller.isGM = true;
  controller.isCoGM = false;
  controller.configParser = new ConfigParser();
  controller.storageService = {
    saveLocalConfig: jest.fn(() => true),
    saveRoomConfig: jest.fn().mockResolvedValue(roomSaved)
  };
  controller.broadcastService = {
    broadcastVisiblePages: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue({ success: true })
  };
  controller.uiRenderer = {
    setConfig: jest.fn(),
    updatePageVisibility: jest.fn()
  };
  controller.analyticsService = { trackVisibilityToggle: jest.fn() };
  controller.render = jest.fn();
  controller.OBR = {
    scene: {
      items: {
        getItems: jest.fn().mockResolvedValue([])
      }
    }
  };
  return controller;
}

describe('page visibility updates', () => {
  it('persiste el cambio sin reconstruir toda la lista', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const config = new Config({ categories: [category] });
    const controller = createController(config);
    controller.currentPage = page;
    document.body.innerHTML = `
      <h1 id="page-title">Goblin</h1>
      <div id="notion-content"><h1 class="notion-page-title">Goblin</h1></div>
    `;

    const updated = await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      true
    );

    expect(updated).toBe(true);
    expect(page.visibleToPlayers).toBe(true);
    expect(controller.config.findPageById(page.id).visibleToPlayers).toBe(true);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.storageService.saveRoomConfig).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.broadcastVisiblePages).toHaveBeenCalledTimes(1);
    expect(controller.uiRenderer.setConfig).toHaveBeenCalledWith(controller.config);
    expect(controller.uiRenderer.updatePageVisibility).toHaveBeenCalledWith(page, true);
    expect(document.querySelectorAll('.visibility-indicator')).toHaveLength(2);
    expect(controller.render).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackVisibilityToggle).toHaveBeenCalledWith('Goblin', true);
  });

  it('no revierte un guardado válido si falla el broadcast auxiliar a Co-GMs', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const controller = createController(new Config({ categories: [category] }));
    controller.broadcastService.sendMessage.mockResolvedValue({
      success: false,
      error: 'size_limit'
    });

    const updated = await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      true
    );

    expect(updated).toBe(true);
    expect(page.visibleToPlayers).toBe(true);
    expect(controller.config.findPageById(page.id).visibleToPlayers).toBe(true);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.storageService.saveRoomConfig).toHaveBeenCalledTimes(1);
  });

  it('restaura el modelo y no actualiza la UI cuando falla la persistencia', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const controller = createController(
      new Config({ categories: [category] }),
      { roomSaved: false }
    );
    controller.storageService.saveRoomConfig
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const updated = await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      true
    );

    expect(updated).toBe(false);
    expect(page.visibleToPlayers).toBe(false);
    expect(controller.config.findPageById(page.id).visibleToPlayers).toBe(false);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(2);
    expect(controller.uiRenderer.updatePageVisibility).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackVisibilityToggle).not.toHaveBeenCalled();
    expect(controller.render).not.toHaveBeenCalled();
  });

  it('actualiza solo el botón y bloquea clics mientras sincroniza', async () => {
    const renderer = new UIRenderer();
    const page = new Page('Goblin', 'https://example.com/goblin');
    let finishUpdate;
    const pendingUpdate = new Promise(resolve => {
      finishUpdate = resolve;
    });
    renderer.onVisibilityChange = jest.fn(() => pendingUpdate);

    const pageButton = renderer._createPageButton(page, 'room-1', [], 0, true);
    document.body.appendChild(pageButton);
    const visibilityButton = pageButton.querySelector('.page-visibility-button');
    visibilityButton.click();

    expect(renderer.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(visibilityButton.disabled).toBe(true);
    expect(visibilityButton.getAttribute('aria-busy')).toBe('true');
    expect(visibilityButton.getAttribute('aria-pressed')).toBe('true');
    expect(visibilityButton.title).toBe('Visible to players');

    visibilityButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(renderer.onVisibilityChange).toHaveBeenCalledTimes(1);

    finishUpdate(true);
    await flushPromises();

    expect(page.visibleToPlayers).toBe(true);
    expect(visibilityButton.disabled).toBe(false);
    expect(visibilityButton.hasAttribute('aria-busy')).toBe(false);
    expect(document.body.contains(pageButton)).toBe(true);
    expect(pageButton.querySelector('.page-visibility-button')).toBe(visibilityButton);
  });

  it('revierte el botón cuando no se puede guardar', async () => {
    const renderer = new UIRenderer();
    const page = new Page('Goblin', 'https://example.com/goblin');
    renderer.onVisibilityChange = jest.fn().mockResolvedValue(false);

    const pageButton = renderer._createPageButton(page, 'room-1', [], 0, true);
    const visibilityButton = pageButton.querySelector('.page-visibility-button');
    visibilityButton.click();
    await flushPromises();

    expect(page.visibleToPlayers).toBe(false);
    expect(visibilityButton.getAttribute('aria-pressed')).toBe('false');
    expect(visibilityButton.title).toBe('Hidden from players');
    expect(visibilityButton.disabled).toBe(false);
  });
});
