import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';
import { filterConfigForPlayer, isPlayerAccessEnabled } from '../../../js/utils/playerAccess.js';
import { METADATA_KEY } from '../../../js/utils/constants.js';

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
    notifyPlayerVaultUpdated: jest.fn().mockResolvedValue(true),
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

describe('folder content visibility', () => {
  function setup(options) {
    const everyone = new Page('Everyone', 'https://example.com/everyone', {
      id: 'everyone', visibleToPlayers: true
    });
    const selected = new Page('Secret', 'https://example.com/secret', {
      id: 'secret', sharedWithPlayerIds: ['player-1']
    });
    const privatePage = new Page('Private', 'https://example.com/private', { id: 'private' });
    const nested = new Category('Nested', { pages: [selected, privatePage] });
    const folder = new Category('Folder', { pages: [everyone], categories: [nested] });
    const outside = new Page('Outside', 'https://example.com/outside', {
      id: 'outside', visibleToPlayers: true
    });
    const controller = createController(new Config({ categories: [folder], pages: [outside] }), options);
    const path = [{ id: folder.id, name: folder.name }];
    return { controller, folder, path, everyone, selected, privatePage, outside };
  }

  it('hides descendant pages in one save, invalidates content and preserves audiences and other folders', async () => {
    const { controller, folder, path, selected } = setup();
    controller.currentPage = selected;
    const token = (pageId) => ({ metadata: { [`${METADATA_KEY}/pageId`]: pageId, [`${METADATA_KEY}/pageVisible`]: true } });
    const tokens = [token('everyone'), token('secret'), token('outside')];
    controller.OBR.scene.items.getItems.mockResolvedValue(tokens);
    controller.OBR.scene.items.updateItems = jest.fn(async (items, update) => update(items));

    expect(await controller._handleCategoryVisibilityChange(folder, path, false)).toBe(true);

    for (const id of ['everyone', 'secret', 'private']) {
      expect(isPlayerAccessEnabled(controller.config.findPageById(id))).toBe(false);
    }
    expect(isPlayerAccessEnabled(controller.config.findPageById('outside'))).toBe(true);
    expect(controller.config.findPageById('everyone').visibleToPlayers).toBe(true);
    expect(controller.config.findPageById('secret').sharedWithPlayerIds).toEqual(['player-1']);
    expect(controller.currentPage.playerAccessEnabled).toBe(false);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.broadcastVisiblePages).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.notifyPlayerVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.invalidatePage.mock.calls).toEqual([['everyone'], ['secret']]);
    expect(controller.OBR.scene.items.getItems).toHaveBeenCalledTimes(1);
    expect(controller.OBR.scene.items.updateItems).toHaveBeenCalledTimes(1);
    expect(tokens.map(item => item.metadata[`${METADATA_KEY}/pageVisible`])).toEqual([false, false, true]);
    expect(controller.render).toHaveBeenCalledTimes(1);
    expect(controller._showFeedback).toHaveBeenCalledWith('Hidden from players');
  });

  it('shows all descendants, restoring selected audiences and defaulting unconfigured pages to all players', async () => {
    const { controller, folder, path } = setup();
    await controller._handleCategoryVisibilityChange(folder, path, false);
    controller.storageService.saveLocalConfig.mockClear();
    controller.broadcastService.invalidatePage.mockClear();

    // Use the original folder reference, as an open menu can outlive a save.
    expect(await controller._handleCategoryVisibilityChange(folder, path, true)).toBe(true);
    const secret = controller.config.findPageById('secret');
    expect(secret.visibleToPlayers).toBe(false);
    expect(secret.sharedWithPlayerIds).toEqual(['player-1']);
    expect(secret.playerAccessEnabled).toBe(true);
    expect(controller.config.findPageById('private').visibleToPlayers).toBe(true);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
    const allowed = JSON.stringify(filterConfigForPlayer(controller.config, 'player-1'));
    const other = JSON.stringify(filterConfigForPlayer(controller.config, 'player-2'));
    expect(allowed).toContain('Secret');
    expect(other).not.toContain('Secret');
    expect(other).toContain('Private');
    expect(other).toContain('Everyone');
    expect(controller._showFeedback).toHaveBeenLastCalledWith('Visible to players');
  });

  it.each([true, false])('rolls back the whole batch if saving fails (visible: %s)', async visible => {
    const { controller, folder, path } = setup({ localSaved: false });
    const before = controller.config.toJSON();
    expect(await controller._handleCategoryVisibilityChange(folder, path, visible)).toBe(false);
    expect(controller.config.toJSON()).toEqual(before);
    expect(folder.toJSON()).toEqual(before.categories[0]);
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
    expect(controller.OBR.scene.items.getItems).not.toHaveBeenCalled();
    expect(controller.render).not.toHaveBeenCalled();
    expect(controller._folderVisibilityUpdating).toBe(false);
  });

  it('rejects non-owner changes and ignores empty or missing folders', async () => {
    const { controller, folder, path } = setup();
    controller.isCoGM = true;
    expect(await controller._handleCategoryVisibilityChange(folder, path, false)).toBe(false);
    controller.isCoGM = false;
    controller.isGM = false;
    expect(await controller._handleCategoryVisibilityChange(folder, path, false)).toBe(false);
    controller.isGM = true;
    expect(await controller._handleCategoryVisibilityChange(folder, [], false)).toBe(false);
    expect(await controller._handleCategoryVisibilityChange({ id: 'removed' }, path, false)).toBe(false);
    folder.pages = [];
    folder.categories = [];
    expect(await controller._handleCategoryVisibilityChange(folder, path, false)).toBe(true);
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });

  it('ignores repeat bulk clicks while saving', async () => {
    const { controller, folder, path } = setup();
    let release;
    controller.broadcastService.broadcastVisiblePages.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = controller._handleCategoryVisibilityChange(folder, path, false);
    expect(await controller._handleCategoryVisibilityChange(folder, path, true)).toBe(false);
    release(true);
    expect(await pending).toBe(true);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller._folderVisibilityUpdating).toBe(false);
  });
});

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
    expect(controller._showFeedback).toHaveBeenCalledWith('Visible to all players');

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
    expect(controller._showFeedback).toHaveBeenCalledWith('Hidden from players');
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
    expect(controller._showFeedback).toHaveBeenCalledWith('Could not show this page. Try again.');
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
    expect(controller._showFeedback).toHaveBeenLastCalledWith('Visible to 1 player');
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
    expect(visibilityButton.title).toBe('Hide from all players');
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
    expect(visibilityButton.title).toBe('Show to all players');
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
