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

function createController(config, { localSaved = true } = {}) {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = config;
  controller.isGM = true;
  controller.isCoGM = false;
  controller.configParser = new ConfigParser();
  controller.storageService = {
    saveLocalConfig: jest.fn(() => localSaved)
  };
  controller.broadcastService = {
    broadcastVisiblePages: jest.fn().mockResolvedValue(true),
    notifyFullVaultUpdated: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
    invalidatePage: jest.fn().mockResolvedValue(true)
  };
  controller.uiRenderer = {
    setConfig: jest.fn(),
    updatePageVisibility: jest.fn()
  };
  controller.analyticsService = { trackVisibilityToggle: jest.fn() };
  controller._showFeedback = jest.fn();
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
    expect(controller.broadcastService.broadcastVisiblePages).toHaveBeenCalledTimes(1);
    expect(controller.uiRenderer.setConfig).toHaveBeenCalledWith(controller.config);
    expect(controller.uiRenderer.updatePageVisibility).toHaveBeenCalledWith(page, true);
    expect(controller.render).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackVisibilityToggle).toHaveBeenCalledWith('Goblin', true);
    expect(controller._showFeedback).toHaveBeenCalledWith('Page is visible to everyone');

    controller._showFeedback.mockClear();
    const hidden = await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      false
    );
    expect(hidden).toBe(true);
    expect(page.visibleToPlayers).toBe(true);
    expect(page.playerAccessEnabled).toBe(false);
    expect(controller.broadcastService.invalidatePage).toHaveBeenCalledWith(page.id);
    expect(controller._showFeedback).toHaveBeenCalledWith('Page is hidden from players');
    const hiddenBroadcast = controller.broadcastService.broadcastVisiblePages.mock.calls.at(-1)[0];
    expect(JSON.stringify(hiddenBroadcast)).not.toContain('Goblin');
  });

  it('no revierte un guardado válido si falla el broadcast auxiliar a Co-GMs', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const controller = createController(new Config({ categories: [category] }));
    controller.broadcastService.notifyFullVaultUpdated.mockResolvedValue(false);

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
  });

  it('restaura el modelo y no actualiza la UI cuando falla la persistencia local', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const controller = createController(
      new Config({ categories: [category] }),
      { localSaved: false }
    );

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
    expect(controller._showFeedback).toHaveBeenCalledWith('❌ Could not update page visibility');
    expect(controller.render).not.toHaveBeenCalled();
  });

  it('mantiene el estado local si falla la sincronización auxiliar a Co-GMs', async () => {
    const page = new Page('Goblin', 'https://example.com/goblin', {
      id: 'page-goblin'
    });
    const category = new Category('Bestiary', { pages: [page] });
    const controller = createController(new Config({ categories: [category] }));
    controller.broadcastService.notifyFullVaultUpdated.mockResolvedValue(false);

    const updated = await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      true
    );

    expect(updated).toBe(true);
    expect(page.visibleToPlayers).toBe(true);
    expect(controller.config.findPageById(page.id).visibleToPlayers).toBe(true);
    expect(controller.uiRenderer.updatePageVisibility).toHaveBeenCalledWith(page, true);
  });

  it('preserva la audiencia seleccionada al ocultar y volver a mostrar', async () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      id: 'page-secret',
      sharedWithPlayerIds: ['player-1']
    });
    const category = new Category('Secrets', { pages: [page] });
    const controller = createController(new Config({ categories: [category] }));

    expect(await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      false
    )).toBe(true);
    expect(page.playerAccessEnabled).toBe(false);
    expect(page.visibleToPlayers).toBe(false);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);
    expect(controller.config.findPageById(page.id).sharedWithPlayerIds).toEqual(['player-1']);

    expect(await controller._handleVisibilityChange(
      page,
      [{ id: category.id, name: category.name }],
      0,
      true
    )).toBe(true);
    expect(page.playerAccessEnabled).toBe(true);
    expect(page.visibleToPlayers).toBe(false);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);
    expect(controller._showFeedback).toHaveBeenLastCalledWith('Page is visible to 1 selected player');
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
    const visibilityIcon = visibilityButton.querySelector('.icon');
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.classList.contains('page-visibility-button--no-access')).toBe(true);
    visibilityButton.click();

    expect(renderer.onVisibilityChange).toHaveBeenCalledTimes(1);
    expect(visibilityButton.disabled).toBe(true);
    expect(visibilityButton.getAttribute('aria-busy')).toBe('true');
    expect(visibilityButton.getAttribute('aria-pressed')).toBe('true');
    expect(visibilityButton.title).toBe('Visible to everyone');
    expect(visibilityButton.querySelector('.icon').style.maskImage).toContain('icon-eye-open.svg');
    expect(visibilityButton.querySelector('.icon')).toBe(visibilityIcon);
    expect(visibilityButton.classList.contains('page-visibility-button--visible')).toBe(true);

    visibilityButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(renderer.onVisibilityChange).toHaveBeenCalledTimes(1);

    finishUpdate(true);
    await flushPromises();

    expect(page.visibleToPlayers).toBe(true);
    expect(visibilityButton.querySelector('.icon').style.maskImage).toContain('icon-eye-open.svg');
    expect(visibilityButton.querySelector('.icon')).toBe(visibilityIcon);
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
    expect(visibilityButton.title).toBe('Make visible to everyone');
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.classList.contains('page-visibility-button--no-access')).toBe(true);
    expect(visibilityButton.disabled).toBe(false);
  });

  it('keeps the selected audience when the list eye is toggled', async () => {
    const renderer = new UIRenderer();
    const page = new Page('Secret', 'https://example.com/secret', {
      sharedWithPlayerIds: ['player-1']
    });
    renderer.onVisibilityChange = jest.fn().mockResolvedValue(true);

    const pageButton = renderer._createPageButton(page, 'room-1', [], 0, true);
    const visibilityButton = pageButton.querySelector('.page-visibility-button');

    visibilityButton.click();
    await flushPromises();
    expect(page.playerAccessEnabled).toBe(false);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);
    expect(visibilityButton.getAttribute('aria-pressed')).toBe('false');
    expect(visibilityButton.querySelector('.page-visibility-button__label').textContent).toBe('1');
    expect(visibilityButton.querySelector('.icon').style.maskImage).toContain('icon-eye-close.svg');
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.classList.contains('page-visibility-button--selected')).toBe(true);
    expect(visibilityButton.classList.contains('page-visibility-button--no-access')).toBe(false);

    visibilityButton.click();
    await flushPromises();
    expect(page.playerAccessEnabled).toBe(true);
    expect(page.sharedWithPlayerIds).toEqual(['player-1']);
    expect(visibilityButton.getAttribute('aria-pressed')).toBe('true');
    expect(visibilityButton.querySelector('.page-visibility-button__label').textContent).toBe('1');
    expect(visibilityButton.querySelector('.icon').style.maskImage).toContain('icon-eye-open.svg');
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.classList.contains('page-visibility-button--no-access')).toBe(false);
  });

  it('uses the list visibility indicator for the detail header', () => {
    const controller = Object.create(ExtensionController.prototype);
    controller.isGM = true;
    controller.isCoGM = false;
    controller.uiRenderer = new UIRenderer();
    controller._openPageInModal = jest.fn();
    document.body.innerHTML = '<header id="header"></header>';

    controller._createPageDetailButtons(new Page('Selected', 'https://example.com/selected', {
      sharedWithPlayerIds: ['player-1', 'player-2']
    }));
    let visibilityButton = document.getElementById('page-visibility-button-header');
    expect(visibilityButton.classList.contains('page-visibility-button')).toBe(true);
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.querySelector('.page-visibility-button__label').textContent).toBe('2');

    controller._createPageDetailButtons(new Page('Everyone', 'https://example.com/everyone', {
      visibleToPlayers: true
    }));
    visibilityButton = document.getElementById('page-visibility-button-header');
    expect(visibilityButton.classList.contains('hidden')).toBe(false);
    expect(visibilityButton.querySelector('.page-visibility-button__label').hidden).toBe(true);

    controller._createPageDetailButtons(new Page('GM only', 'https://example.com/gm-only'));
    visibilityButton = document.getElementById('page-visibility-button-header');
    expect(visibilityButton.classList.contains('hidden')).toBe(true);
  });
});
