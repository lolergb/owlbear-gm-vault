import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';
import { METADATA_KEY } from '../../../js/utils/constants.js';
import { PLAYER_ACCESS_MODE } from '../../../js/utils/playerAccess.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.classList.remove('role-player');
});

function createController(config) {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = config;
  controller.isGM = true;
  controller.isCoGM = false;
  controller.configParser = new ConfigParser();
  controller.storageService = { saveLocalConfig: jest.fn(() => true) };
  controller.broadcastService = {
    broadcastVisiblePages: jest.fn().mockResolvedValue(true),
    notifyPlayerVaultUpdated: jest.fn().mockResolvedValue(true),
    notifyFullVaultUpdated: jest.fn().mockResolvedValue(true),
    invalidatePage: jest.fn().mockResolvedValue(true)
  };
  controller.uiRenderer = { setConfig: jest.fn(), updatePageVisibility: jest.fn() };
  controller.OBR = { scene: { items: { getItems: jest.fn().mockResolvedValue([]) } } };
  controller.render = jest.fn();
  controller._showFeedback = jest.fn();
  return controller;
}

describe('ExtensionController player access', () => {
  it.each([
    [PLAYER_ACCESS_MODE.EVERYONE, []],
    [PLAYER_ACCESS_MODE.SELECTED, ['player-1']]
  ])('shows linked tokens from the %s chooser and preserves recipients through eye toggles', async (mode, playerIds) => {
    const page = new Page('Linked', 'https://example.com/linked', { id: 'linked' });
    const controller = createController(new Config({ pages: [page] }));
    controller.analyticsService = { trackVisibilityToggle: jest.fn() };
    controller.currentPage = page.clone(true);
    const renderer = new UIRenderer();
    controller.uiRenderer = renderer;
    document.body.innerHTML = '<button id="page-visibility-button-header"></button>';
    const header = document.getElementById('page-visibility-button-header');
    document.body.appendChild(renderer._createPageButton(page, 'room-1', [], 0, true));
    const token = { metadata: {
      [`${METADATA_KEY}/pageId`]: page.id,
      [`${METADATA_KEY}/pageVisible`]: false
    } };
    const items = controller.OBR.scene.items;
    items.getItems.mockResolvedValue([token]);
    items.updateItems = jest.fn(async (tokens, update) => update(tokens));

    expect(await controller._handlePlayerAccessChange(page, mode, playerIds)).toBe(true);
    expect(token.metadata[`${METADATA_KEY}/pageVisible`]).toBe(true);
    expect(header.getAttribute('aria-pressed')).toBe('true');
    expect(header.querySelector('.page-visibility-button__label').textContent)
      .toBe(playerIds.length ? '1' : '');
    expect(controller.currentPage.sharedWithPlayerIds).toEqual(playerIds);
    expect(controller.broadcastService.notifyPlayerVaultUpdated).toHaveBeenCalledTimes(1);

    expect(await controller._handleVisibilityChange(page, [], 0, false)).toBe(true);
    expect(token.metadata[`${METADATA_KEY}/pageVisible`]).toBe(false);
    expect(header.getAttribute('aria-pressed')).toBe('false');
    expect(controller.config.findPageById(page.id).sharedWithPlayerIds).toEqual(playerIds);
    expect(await controller._handleVisibilityChange(page, [], 0, true)).toBe(true);
    expect(token.metadata[`${METADATA_KEY}/pageVisible`]).toBe(true);
    expect(controller.config.findPageById(page.id).sharedWithPlayerIds).toEqual(playerIds);
    expect(controller.currentPage.sharedWithPlayerIds).toEqual(playerIds);
  });

  it('restores paused recipients without changing tokens or UI when chooser persistence fails', async () => {
    const page = new Page('Paused', 'https://example.com/paused', {
      id: 'paused', sharedWithPlayerIds: ['player-1'], playerAccessEnabled: false
    });
    const controller = createController(new Config({ pages: [page] }));
    controller.currentPage = page.clone(true);
    const previous = page.toJSON();
    controller.storageService.saveLocalConfig.mockReturnValue(false);

    expect(await controller._handlePlayerAccessChange(page, PLAYER_ACCESS_MODE.EVERYONE)).toBe(false);

    expect(page.toJSON()).toEqual(previous);
    expect(controller.currentPage.toJSON()).toEqual(previous);
    expect(controller.config.findPageById(page.id).toJSON()).toEqual(previous);
    expect(controller.OBR.scene.items.getItems).not.toHaveBeenCalled();
    expect(controller.uiRenderer.updatePageVisibility).not.toHaveBeenCalled();
    expect(controller.render).not.toHaveBeenCalled();
    expect(controller.broadcastService.notifyPlayerVaultUpdated).not.toHaveBeenCalled();
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
  });

  it('keeps the chooser usable after a failed save and allows retrying', async () => {
    const page = new Page('Secret', 'https://example.com/secret');
    const controller = createController(new Config({ pages: [page] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([]) };
    controller.storageService.saveLocalConfig.mockReturnValue(false);
    await controller._showPlayerAccessModal(page);
    document.querySelector('input[name="player-access-everyone"]').click();
    const save = document.querySelector('.player-access-actions .btn--primary');
    save.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(save.disabled).toBe(false);
    expect(document.querySelector('.player-access-error').textContent).toContain('Could not show this page');
    controller.storageService.saveLocalConfig.mockReturnValue(true);
    save.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelector('#player-access-modal')).toBeNull();
    expect(controller.config.findPageById(page.id).playerAccessEnabled).toBe(true);
  });

  it('does not revoke cached content when expanding selected access to everyone', async () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      sharedWithPlayerIds: ['player-1']
    });
    const controller = createController(new Config({ pages: [page] }));

    expect(await controller._handlePlayerAccessChange(page, PLAYER_ACCESS_MODE.EVERYONE)).toBe(true);
    expect(controller.config.findPageById(page.id).sharedWithPlayerIds).toEqual([]);
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
  });

  it('persists selected players without broadcasting their ACL in the legacy config', async () => {
    const page = new Page('Secret', 'https://example.com/secret', { id: 'secret' });
    const controller = createController(new Config({
      categories: [new Category('Secrets', { pages: [page] })]
    }));

    const saved = await controller._handlePlayerAccessChange(
      page,
      PLAYER_ACCESS_MODE.SELECTED,
      ['player-1', 'player-2']
    );

    expect(saved).toBe(true);
    expect(controller.config.findPageById('secret').sharedWithPlayerIds)
      .toEqual(['player-1', 'player-2']);
    const legacyBroadcast = controller.broadcastService.broadcastVisiblePages.mock.calls[0][0];
    expect(JSON.stringify(legacyBroadcast)).not.toContain('player-1');
    expect(controller.broadcastService.notifyPlayerVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
  });

  it('invalidates a page when its selected audience becomes more restrictive', async () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      id: 'secret',
      sharedWithPlayerIds: ['player-1', 'player-2']
    });
    const controller = createController(new Config({ pages: [page] }));

    const saved = await controller._handlePlayerAccessChange(
      page,
      PLAYER_ACCESS_MODE.SELECTED,
      ['player-1']
    );

    expect(saved).toBe(true);
    expect(controller.broadcastService.invalidatePage).toHaveBeenCalledWith('secret');
  });

  it('lets the GM select players directly from the Everyone audience and saves that selection', async () => {
    const page = new Page('Secret', 'https://example.com/secret', { visibleToPlayers: true });
    const controller = createController(new Config({ categories: [] }));
    controller.playerDirectoryService = {
      listPlayers: jest.fn().mockResolvedValue([
        { id: 'online', name: 'Lyra', connected: true, color: '#123456' },
        { id: 'offline', name: 'Milo', connected: false, color: '' }
      ])
    };
    controller._handlePlayerAccessChange = jest.fn().mockResolvedValue(true);
    await controller._showPlayerAccessModal(page);

    expect(document.querySelector('.player-access-modal.modal__content')).not.toBeNull();
    expect(document.querySelector('#player-access-modal-title').textContent).toBe('Choose players');
    expect(document.querySelector(`input[value="${PLAYER_ACCESS_MODE.GM_ONLY}"]`)).toBeNull();
    expect([...document.querySelectorAll('.player-access-player__name')].map(node => node.textContent))
      .toEqual(['All players', 'Lyra', 'Milo']);
    expect([...document.querySelectorAll('.player-access-player__status')].map(node => node.textContent))
      .toEqual(['Connected', 'Offline']);

    expect(document.querySelector('input[type="radio"]')).toBeNull();
    const everyone = document.querySelector('input[name="player-access-everyone"]');
    const online = document.querySelector('input[value="online"]');
    expect(everyone.checked).toBe(true);
    expect(online.disabled).toBe(false);
    expect(online.closest('[hidden]')).toBeNull();
    const save = document.querySelector('.player-access-actions .btn--primary');
    expect(save.textContent).toBe('Save changes');
    online.click();
    expect(everyone.checked).toBe(false);
    expect(save.disabled).toBe(false);
    expect(document.querySelector('.player-access-players__count').textContent).toBe('1 selected');

    online.click();
    expect(save.disabled).toBe(true);
    expect(document.querySelector('.player-access-validation').textContent)
      .toBe('Choose All players or at least one player.');

    document.querySelector('input[value="offline"]').click();
    save.click();
    await Promise.resolve();
    expect(controller._handlePlayerAccessChange)
      .toHaveBeenCalledWith(page, PLAYER_ACCESS_MODE.SELECTED, ['offline']);
    expect(document.querySelector('#player-access-modal')).toBeNull();
  });

  it('keeps a paused selection checked and clears it when saving Everyone', async () => {
    const page = new Page('Secret', 'https://example.com/secret', {
      sharedWithPlayerIds: ['offline'],
      playerAccessEnabled: false
    });
    const controller = createController(new Config({ pages: [page] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([]) };
    controller._handlePlayerAccessChange = jest.fn().mockResolvedValue(true);
    await controller._showPlayerAccessModal(page);

    const everyone = document.querySelector('input[name="player-access-everyone"]');
    const offline = document.querySelector('input[value="offline"]');
    expect(everyone.checked).toBe(false);
    expect(offline.checked).toBe(true);
    expect(document.querySelector('.player-access-actions .btn--primary').textContent).toBe('Show page');
    everyone.click();
    expect(offline.checked).toBe(false);
    expect(offline.disabled).toBe(false);
    document.querySelector('.player-access-actions .btn--primary').click();
    await Promise.resolve();
    expect(controller._handlePlayerAccessChange)
      .toHaveBeenCalledWith(page, PLAYER_ACCESS_MODE.EVERYONE, []);
  });

  it('allows Everyone even when no player has joined yet', async () => {
    const page = new Page('Secret', 'https://example.com/secret');
    const controller = createController(new Config({ pages: [page] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([]) };
    await controller._showPlayerAccessModal(page);

    const save = document.querySelector('.player-access-actions .btn--primary');
    expect(save.disabled).toBe(true);
    expect(save.textContent).toBe('Show page');
    expect(document.querySelector('.player-access-empty')).not.toBeNull();
    document.querySelector('input[name="player-access-everyone"]').click();
    expect(save.disabled).toBe(false);
  });

  it('ignores legacy folder access when managing a page', async () => {
    const page = new Page('Child', 'https://example.com/child');
    const folder = new Category('Shared folder', {
      id: 'shared-folder',
      pages: [page],
      sharedWithPlayerIds: ['player-1']
    });
    const controller = createController(new Config({ categories: [folder] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([]) };

    await controller._showPlayerAccessModal(page);

    expect(document.querySelector('.player-access-inherited')).toBeNull();
    expect(document.querySelector('.player-access-audience legend .form__label').textContent)
      .toBe('Players');
    expect(document.querySelector('.player-access-player__name').textContent)
      .toBe('All players');
  });

  it('rejects folder access changes', async () => {
    const folder = new Category('Secrets', { sharedWithPlayerIds: ['player-1'] });
    const controller = createController(new Config({ categories: [folder] }));

    await expect(controller._handlePlayerAccessChange(
      folder,
      PLAYER_ACCESS_MODE.EVERYONE,
      []
    )).resolves.toBe(false);
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });

  it('clears cached content for every page removed by an access refresh', async () => {
    const kept = new Page('Kept', 'https://example.com/kept', { id: 'kept' });
    const revoked = new Page('Revoked', 'https://example.com/revoked', { id: 'revoked' });
    const controller = createController(new Config({ pages: [kept, revoked] }));
    controller.playerId = 'player-1';
    controller.playerName = 'Lyra';
    controller.currentPage = null;
    controller.storageService.getVaultOwner = jest.fn().mockResolvedValue({ connectionId: 'conn-master' });
    controller.broadcastService.requestEncryptedPlayerVault = jest.fn().mockResolvedValue(
      new Config({ pages: [kept] }).toJSON()
    );
    controller.cacheService = { clearPageCache: jest.fn() };
    controller.notionRenderer = { setDependencies: jest.fn() };

    await controller._refreshPlayerVault();

    expect(controller.cacheService.clearPageCache).toHaveBeenCalledWith('revoked');
    expect(controller.cacheService.clearPageCache).not.toHaveBeenCalledWith('kept');
  });
});

describe('GM Player view preview', () => {
  function createPreviewController(config) {
    const controller = createController(config);
    controller.render = ExtensionController.prototype.render;
    controller.playerViewMode = false;
    controller.roomId = 'room-1';
    controller.uiRenderer = new UIRenderer();
    controller.pagesContainer = document.createElement('div');
    document.body.appendChild(controller.pagesContainer);
    return controller;
  }

  const renderedNames = controller => [...controller.pagesContainer.querySelectorAll('.page-name-text')]
    .map(node => node.textContent).sort();

  it('includes active selected audiences at root and in nested folders when toggled on', async () => {
    const privatePage = new Page('Private', 'https://example.com/private');
    const selected = new Page('Selected', 'https://example.com/selected', {
      sharedWithPlayerIds: ['player-1']
    });
    const everyone = new Page('Everyone', 'https://example.com/everyone', { visibleToPlayers: true });
    const paused = new Page('Paused', 'https://example.com/paused', {
      sharedWithPlayerIds: ['player-2'], playerAccessEnabled: false
    });
    const pausedEveryone = new Page('Paused everyone', 'https://example.com/paused-all', {
      visibleToPlayers: true, playerAccessEnabled: false
    });
    const nested = new Page('Nested selected', null, {
      htmlContent: '<p>Selected content</p>', sharedWithPlayerIds: ['player-2']
    });
    const controller = createPreviewController(new Config({
      pages: [privatePage, selected, everyone, paused, pausedEveryone],
      categories: [new Category('Parent', { categories: [new Category('Child', { pages: [nested] })] })]
    }));
    const savedConfig = JSON.stringify(controller.config.toJSON());

    await controller._togglePlayerViewMode();

    expect(renderedNames(controller)).toEqual(['Everyone', 'Nested selected', 'Selected']);
    expect([...controller.pagesContainer.querySelectorAll('.category-title')].map(node => node.textContent))
      .toEqual(['Parent', 'Child']);
    expect(controller.pagesContainer.querySelector('.page-context-menu-button')).toBeNull();
    expect(controller.pagesContainer.querySelector('[data-page-name="Selected"]').dataset.pageIndex).toBe('1');
    expect(JSON.stringify(controller.config.toJSON())).toBe(savedConfig);

    await controller._togglePlayerViewMode();
    expect(renderedNames(controller))
      .toEqual(['Everyone', 'Nested selected', 'Paused', 'Paused everyone', 'Private', 'Selected']);
  });

  it('renders a vault containing only selected-player content instead of the empty state', async () => {
    const page = new Page('Selected', 'https://example.com/selected', { sharedWithPlayerIds: ['player-1'] });
    const controller = createPreviewController(new Config({ pages: [page] }));

    await controller._togglePlayerViewMode();
    expect(renderedNames(controller)).toEqual(['Selected']);
    expect(controller.pagesContainer.querySelector('.empty-state')).toBeNull();

    page.playerAccessEnabled = false;
    await controller.render();
    expect(renderedNames(controller)).toEqual([]);
    expect(controller.pagesContainer.querySelector('.empty-state')).not.toBeNull();
  });

  it('resets the aggregate preview when rendering as an actual player', async () => {
    const controller = createPreviewController(new Config({ pages: [
      new Page('Selected', 'https://example.com/selected', { sharedWithPlayerIds: ['other-player'] }),
      new Page('Everyone', 'https://example.com/all', { visibleToPlayers: true })
    ] }));
    await controller._togglePlayerViewMode();
    expect(renderedNames(controller)).toEqual(['Everyone', 'Selected']);

    controller.isGM = false;
    await controller.render();
    expect(renderedNames(controller)).toEqual(['Everyone']);
  });
});
