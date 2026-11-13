import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';
import { PLAYER_ACCESS_MODE, filterConfigForPlayer, getFolderPlayerAccess } from '../../../js/utils/playerAccess.js';

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
  controller.uiRenderer = { setConfig: jest.fn() };
  controller.render = jest.fn();
  controller._showFeedback = jest.fn();
  return controller;
}

describe('ExtensionController player access', () => {
  it('persists selected players without broadcasting their ACL in the legacy config', async () => {
    const page = new Page('Secret', 'https://example.com/secret', { id: 'secret' });
    const controller = createController(new Config({
      categories: [new Category('Secrets', { pages: [page] })]
    }));

    const saved = await controller._handlePlayerAccessChange(
      page,
      'page',
      PLAYER_ACCESS_MODE.SELECTED,
      ['player-1', 'player-2'],
      [{ id: controller.config.categories[0].id, name: 'Secrets' }]
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
      'page',
      PLAYER_ACCESS_MODE.SELECTED,
      ['player-1'],
      []
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
    await controller._showPlayerAccessModal(page, 'page');

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
      .toHaveBeenCalledWith(page, 'page', PLAYER_ACCESS_MODE.SELECTED, ['offline'], []);
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
    await controller._showPlayerAccessModal(page, 'page');

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
      .toHaveBeenCalledWith(page, 'page', PLAYER_ACCESS_MODE.EVERYONE, [], []);
  });

  it('allows Everyone even when no player has joined yet', async () => {
    const page = new Page('Secret', 'https://example.com/secret');
    const controller = createController(new Config({ pages: [page] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([]) };
    await controller._showPlayerAccessModal(page, 'page');

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

    await controller._showPlayerAccessModal(
      page,
      'page',
      [{ id: folder.id, name: folder.name }]
    );

    expect(document.querySelector('.player-access-inherited')).toBeNull();
    expect(document.querySelector('.player-access-audience legend .form__label').textContent)
      .toBe('Players');
    expect(document.querySelector('.player-access-player__name').textContent)
      .toBe('All players');
  });

  it('saves an empty folder audience without granting access to pages added later', async () => {
    const folder = new Category('Secrets', { sharedWithPlayerIds: ['player-1'] });
    const controller = createController(new Config({ categories: [folder] }));

    await expect(controller._handlePlayerAccessChange(
      folder,
      'category',
      PLAYER_ACCESS_MODE.EVERYONE,
      [],
      [{ id: folder.id, name: folder.name }]
    )).resolves.toBe(true);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.config.categories[0].visibleToPlayers).toBe(true);
    controller.config.categories[0].pages.push(new Page('New private page', 'https://example.com/new'));
    expect(JSON.stringify(filterConfigForPlayer(controller.config, 'player-1'))).not.toContain('New private page');
  });

  it('replaces all page and subfolder audiences, retains unrelated pages and restores counts through the eye', async () => {
    const publicPage = new Page('Public', 'https://example.com/public', { visibleToPlayers: true });
    const selectedPage = new Page('Selected', 'https://example.com/selected', { sharedWithPlayerIds: ['old-player'] });
    const privatePage = new Page('Private', 'https://example.com/private');
    const nested = new Category('Nested', { pages: [selectedPage, privatePage], visibleToPlayers: true });
    const folder = new Category('Folder', { pages: [publicPage], categories: [nested] });
    const outside = new Page('Outside', 'https://example.com/outside', { sharedWithPlayerIds: ['outside-player'] });
    const controller = createController(new Config({ categories: [folder], pages: [outside] }));
    controller._updateLinkedPagesVisibility = jest.fn();
    controller.currentPage = selectedPage;
    const path = [{ id: folder.id, name: folder.name }];

    expect(await controller._handlePlayerAccessChange(folder, 'category', PLAYER_ACCESS_MODE.SELECTED, ['new-player'], path)).toBe(true);
    const savedFolder = controller.config.categories[0];
    for (const target of [savedFolder, savedFolder.categories[0], ...savedFolder.getAllPages()]) {
      expect(target.visibleToPlayers).toBe(false);
      expect(target.sharedWithPlayerIds).toEqual(['new-player']);
      expect(target.playerAccessEnabled).toBe(true);
    }
    expect(controller.config.findPageById(outside.id).sharedWithPlayerIds).toEqual(['outside-player']);
    expect(controller.currentPage.sharedWithPlayerIds).toEqual(['new-player']);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.notifyPlayerVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.invalidatePage.mock.calls).toEqual([[publicPage.id], [selectedPage.id]]);
    expect(JSON.stringify(filterConfigForPlayer(controller.config, 'old-player'))).not.toContain('Selected');
    const authorized = JSON.stringify(filterConfigForPlayer(controller.config, 'new-player'));
    expect(authorized).toContain('Public');
    expect(authorized).toContain('Selected');
    expect(authorized).toContain('Private');

    await controller._handleCategoryVisibilityChange(folder, path, false);
    expect(getFolderPlayerAccess(controller.config.categories[0])).toMatchObject({ sharedWithPlayerIds: ['new-player'], playerAccessEnabled: false });
    expect(JSON.stringify(filterConfigForPlayer(controller.config, 'new-player'))).not.toContain('Selected');
    await controller._handleCategoryVisibilityChange(folder, path, true);
    expect(getFolderPlayerAccess(controller.config.categories[0])).toMatchObject({ sharedWithPlayerIds: ['new-player'], playerAccessEnabled: true });
    expect(controller.config.categories[0].getAllPages().every(page => page.sharedWithPlayerIds[0] === 'new-player')).toBe(true);

    await controller._handlePlayerAccessChange(folder, 'category', PLAYER_ACCESS_MODE.EVERYONE, [], path);
    expect(controller.config.categories[0].getAllPages().every(page => page.visibleToPlayers && !page.sharedWithPlayerIds.length)).toBe(true);
  });

  it('rolls back every folder and page audience if the replacement cannot be saved', async () => {
    const page = new Page('Secret', 'https://example.com/secret', { sharedWithPlayerIds: ['old'], playerAccessEnabled: false });
    const nested = new Category('Nested', { pages: [page], visibleToPlayers: true });
    const folder = new Category('Folder', { categories: [nested] });
    const controller = createController(new Config({ categories: [folder] }));
    controller.storageService.saveLocalConfig.mockReturnValue(false);
    const before = controller.config.toJSON();
    expect(await controller._handlePlayerAccessChange(folder, 'category', PLAYER_ACCESS_MODE.SELECTED, ['new'], [{ id: folder.id, name: folder.name }])).toBe(false);
    expect(controller.config.toJSON()).toEqual(before);
    expect(folder.toJSON()).toEqual(before.categories[0]);
    expect(controller.broadcastService.invalidatePage).not.toHaveBeenCalled();
    expect(controller.render).not.toHaveBeenCalled();
  });

  it('uses the same player checklist for folders and explains the replacement before saving', async () => {
    const folder = new Category('Folder', { pages: [new Page('Private', 'https://example.com')] });
    const controller = createController(new Config({ categories: [folder] }));
    controller.playerDirectoryService = { listPlayers: jest.fn().mockResolvedValue([
      { id: 'player-1', name: 'Lyra', connected: true, color: '' }
    ]) };
    controller._handlePlayerAccessChange = jest.fn().mockResolvedValue(true);
    const path = [{ id: folder.id, name: folder.name }];
    await controller._showPlayerAccessModal(folder, 'category', path);
    expect(document.querySelector('#player-access-modal-title').textContent).toBe('Choose players');
    expect(document.querySelector('.player-access-description').textContent).toContain('replaces the player settings for all pages and subfolders');
    expect(document.querySelector('button[type="submit"]').textContent).toBe('Show folder');
    document.querySelector('input[name="player-access-player"]').click();
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller._handlePlayerAccessChange).toHaveBeenCalledWith(folder, 'category', PLAYER_ACCESS_MODE.SELECTED, ['player-1'], path);
    expect(document.querySelector('#player-access-modal')).toBeNull();
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
