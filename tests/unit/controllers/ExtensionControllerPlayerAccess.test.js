import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { PLAYER_ACCESS_MODE } from '../../../js/utils/playerAccess.js';

afterEach(() => {
  document.body.innerHTML = '';
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

  it('renders connected and historical players and requires a selection', async () => {
    const page = new Page('Secret', 'https://example.com/secret', { visibleToPlayers: true });
    const controller = createController(new Config({ categories: [] }));
    controller.playerDirectoryService = {
      listPlayers: jest.fn().mockResolvedValue([
        { id: 'online', name: 'Lyra', connected: true, color: '#123456' },
        { id: 'offline', name: 'Milo', connected: false, color: '' }
      ])
    };
    await controller._showPlayerAccessModal(page, 'page');

    expect(document.querySelector('.player-access-modal.modal__content')).not.toBeNull();
    expect(document.querySelector('#player-access-modal-title').textContent).toBe('Manage visibility');
    expect(document.querySelector(`input[value="${PLAYER_ACCESS_MODE.GM_ONLY}"]`)).toBeNull();
    expect([...document.querySelectorAll('.player-access-player__name')].map(node => node.textContent))
      .toEqual(['Lyra', 'Milo']);
    expect([...document.querySelectorAll('.player-access-player__status')].map(node => node.textContent))
      .toEqual(['Connected', 'Offline']);

    const selectedMode = document.querySelector(
      `input[name="player-access-mode"][value="${PLAYER_ACCESS_MODE.SELECTED}"]`
    );
    const playerSection = document.querySelector('.player-access-players');
    expect(playerSection.hidden).toBe(true);
    selectedMode.click();
    expect(playerSection.hidden).toBe(false);
    const save = document.querySelector('.player-access-actions .btn--primary');
    expect(save.disabled).toBe(true);
    expect(document.querySelector('.player-access-validation').textContent)
      .toBe('Choose at least one player.');

    document.querySelector('input[value="online"]').click();
    expect(save.disabled).toBe(false);
    expect(document.querySelector('.player-access-players__count').textContent).toBe('1 selected');
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
    expect(document.querySelector('.player-access-audience legend').textContent)
      .toBe('Who can see this?');
    expect(document.querySelector('.player-access-option strong').textContent)
      .toBe('Everyone');
  });

  it('rejects folder access changes', async () => {
    const folder = new Category('Secrets', { sharedWithPlayerIds: ['player-1'] });
    const controller = createController(new Config({ categories: [folder] }));

    await expect(controller._handlePlayerAccessChange(
      folder,
      'category',
      PLAYER_ACCESS_MODE.EVERYONE,
      [],
      [{ id: folder.id, name: folder.name }]
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
