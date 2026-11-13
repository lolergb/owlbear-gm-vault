import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { UIRenderer } from '../../../js/renderers/UIRenderer.js';
import { filterConfigForPlayer } from '../../../js/utils/playerAccess.js';

const PAGE_URL = 'https://www.notion.so/123456781234123412341234567890ab';
const ICON = { type: 'emoji', emoji: '⚖️' };

function createController(config) {
  const controller = Object.create(ExtensionController.prototype);
  Object.assign(controller, {
    config,
    isGM: true,
    isCoGM: false,
    configParser: new ConfigParser(),
    storageService: { saveLocalConfig: jest.fn(() => true) },
    broadcastService: {
      broadcastVisiblePages: jest.fn().mockResolvedValue(true),
      notifyPlayerVaultUpdated: jest.fn().mockResolvedValue(true),
      notifyFullVaultUpdated: jest.fn().mockResolvedValue(true)
    },
    uiRenderer: new UIRenderer(),
    render: jest.fn()
  });
  controller.uiRenderer.setCallbacks({
    onPageIconLoaded: (page, icon) => controller._handlePageIconLoaded(page, icon)
  });
  return controller;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('page icons shared from the GM vault', () => {
  it('persists fetched icons in one batch and renders them for authorized players without Notion', async () => {
    const everyone = new Page('Public page', PAGE_URL, { id: 'public', visibleToPlayers: true });
    const selected = new Page('Magistrada Daria Radan', PAGE_URL, {
      id: 'selected', sharedWithPlayerIds: ['player-1']
    });
    const privatePage = new Page('Private page', PAGE_URL, { id: 'private' });
    const controller = createController(new Config({
      pages: [everyone],
      categories: [new Category('PNJ', { pages: [selected, privatePage] })]
    }));
    controller.uiRenderer.setDependencies({ notionService: {
      fetchPageInfo: jest.fn().mockResolvedValue({ icon: ICON })
    } });
    const gm = document.createElement('div');
    controller.uiRenderer.renderAllCategories(controller.config, gm, 'room', true);
    await jest.advanceTimersByTimeAsync(250);

    expect(gm.querySelectorAll('.page-icon-emoji')).toHaveLength(3);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    const saved = controller.configParser.parse(controller.storageService.saveLocalConfig.mock.calls[0][0]);
    expect(saved.findPageById('selected').icon).toEqual(ICON);
    expect(controller.broadcastService.notifyPlayerVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.notifyFullVaultUpdated).toHaveBeenCalledTimes(1);
    expect(controller.render).not.toHaveBeenCalled();

    const legacy = controller.broadcastService.broadcastVisiblePages.mock.calls[0][0];
    expect(legacy.pages[0].icon).toEqual(ICON);
    expect(legacy.categories).toHaveLength(0);

    const player = new UIRenderer();
    const fetchPageInfo = jest.fn();
    player.setDependencies({ notionService: { fetchPageInfo } });
    const playerConfig = controller.configParser.parse(filterConfigForPlayer(saved, 'player-1'));
    const playerList = document.createElement('div');
    player.renderAllCategories(playerConfig, playerList, 'room', false);

    expect(playerList.querySelectorAll('.page-icon-emoji')).toHaveLength(2);
    expect(playerList.querySelectorAll('.page-icon-placeholder')).toHaveLength(0);
    expect(playerList.textContent).toContain('⚖️');
    expect(playerList.textContent).not.toContain('Private page');
    expect(fetchPageInfo).not.toHaveBeenCalled();
    const otherPlayer = controller.configParser.parse(filterConfigForPlayer(saved, 'player-2'));
    expect(otherPlayer.findPageById('selected')).toBeNull();
  });

  it('does not repeatedly save an unchanged icon', async () => {
    const page = new Page('Page', PAGE_URL, { icon: ICON });
    const controller = createController(new Config({ pages: [page] }));
    controller._handlePageIconLoaded(page, { ...ICON });
    await jest.advanceTimersByTimeAsync(250);
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });

  it('ignores a fetch for a deleted page or a replaced URL', async () => {
    const page = new Page('Page', PAGE_URL);
    const controller = createController(new Config());
    controller._handlePageIconLoaded(page, ICON);
    const replacement = new Page('Replacement', 'https://example.com', { id: page.id });
    controller.config.addPage(replacement);
    controller._handlePageIconLoaded(page, ICON);
    await jest.advanceTimersByTimeAsync(250);
    expect(replacement.icon).toBeNull();
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });

  it.each([{ isGM: false, isCoGM: false }, { isGM: true, isCoGM: true }])(
    'does not save metadata from a read-only role: %j', async (role) => {
      const page = new Page('Page', PAGE_URL);
      const controller = createController(new Config({ pages: [page] }));
      Object.assign(controller, role);
      controller._handlePageIconLoaded(page, ICON);
      await jest.advanceTimersByTimeAsync(250);
      expect(page.icon).toBeNull();
      expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
    }
  );
});
