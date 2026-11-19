import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../js/controllers/ExtensionController.js';
import { Config } from '../../js/models/Config.js';
import { METADATA_KEY } from '../../js/utils/constants.js';
import { filterConfigForPlayer } from '../../js/utils/playerAccess.js';

const idKey = `${METADATA_KEY}/pageId`;
const urlKey = `${METADATA_KEY}/pageUrl`;
const visibleKey = `${METADATA_KEY}/pageVisible`;
const vault = {
  pages: [{ id: 'handout', name: 'Handout', url: 'https://example.org/handout', visibleToPlayers: true }],
  categories: [{ name: 'Atlas', pages: [
    { id: 'notes', name: 'Private notes', url: 'https://example.org/notes' },
    { id: 'chart', name: 'Chart', htmlContent: '<p>Chart</p>', sharedWithPlayerIds: ['recipient'] },
    { id: 'paused', name: 'Paused', visibleToPlayers: true, playerAccessEnabled: false }
  ] }]
};

function item(id, layer, metadata = {}) {
  return { id, layer, locked: true, metadata: { other: 42, ...metadata } };
}

function setup(items, { role = 'GM', playerId = 'recipient', coGM = false } = {}) {
  const menus = new Map();
  const controller = Object.create(ExtensionController.prototype);
  controller.isGM = role === 'GM';
  controller.isCoGM = coGM;
  controller.playerId = playerId;
  controller.config = Config.fromJSON(controller.isGM ? vault : filterConfigForPlayer(vault, playerId));
  const getItems = async ids => items.filter(item => !ids || ids.includes(item.id));
  controller.OBR = {
    player: { getRole: jest.fn(async () => role) },
    action: { open: jest.fn() },
    scene: { items: {
      getItems,
      updateItems: jest.fn(async (ids, update) => update(await getItems(ids)))
    } },
    contextMenu: { create: async menu => menus.set(menu.id, menu) }
  };
  controller._showModalForm = jest.fn();
  controller._showFeedback = jest.fn();
  controller.openPage = jest.fn();
  controller.analyticsService = { trackPageLinkedToToken: jest.fn(), trackPageViewedFromToken: jest.fn() };
  const menu = id => menus.get(`${METADATA_KEY}/${id}`);
  return { controller, menu };
}

// Apply the SDK's every/some selection rules to the icons actually registered.
function matches(item, filters) {
  if (!filters) return true;
  const values = filters.map(({ key, value, operator }) => {
    const actual = [key].flat().reduce((obj, part) => obj?.[part], item);
    return operator === '!=' ? actual !== value : actual === value;
  });
  return filters[0].coordinator === '||' ? values.some(Boolean) : values.every(Boolean);
}

function shown(menu, role, items) {
  return Boolean(menu?.icons.some(({ filter }) =>
    filter.roles.includes(role) && items.length >= (filter.min ?? 1) &&
    items.length <= (filter.max ?? Infinity) &&
    items.every(item => matches(item, filter.every)) &&
    (!filter.some || items.some(item => matches(item, filter.some)))
  ));
}

describe('Owlbear scene item links', () => {
  it('links, opens, replaces and unlinks one locked map in a multi-map scene', async () => {
    const map = item('map1', 'MAP');
    const other = item('map2', 'MAP');
    const { controller, menu } = setup([map, other]);
    await controller._setupItemContextMenus();
    const link = menu('link-page');
    const view = menu('view-page-gm');
    const unlink = menu('unlink-page');
    expect(shown(link, 'GM', [map])).toBe(true);
    expect(shown(view, 'GM', [map])).toBe(false);
    expect(shown(unlink, 'GM', [map])).toBe(false);

    async function linkPage(name) {
      await link.onClick({ items: [map] });
      const [title, fields, submit] = controller._showModalForm.mock.lastCall;
      expect(title).toBe('Link page to map');
      await submit({ pageIndex: fields[0].options.find(option => option.label.endsWith(name)).value });
    }
    await linkPage('Private notes');
    expect(map.metadata).toEqual({ other: 42, [idKey]: 'notes' });
    expect(shown(view, 'GM', [map])).toBe(true);
    await view.onClick({ items: [map] });
    expect(controller.openPage).toHaveBeenLastCalledWith(controller.config.findPageById('notes'), ['Atlas'], 0);

    await linkPage('Chart');
    await view.onClick({ items: [map] });
    expect(controller.openPage).toHaveBeenLastCalledWith(controller.config.findPageById('chart'), ['Atlas'], 1);
    expect(shown(unlink, 'GM', [map])).toBe(true);
    await unlink.onClick({ items: [map] });
    expect(map).toEqual(item('map1', 'MAP'));
    expect(other).toEqual(item('map2', 'MAP'));
    expect(shown(view, 'GM', [map])).toBe(false);
    expect(controller.analyticsService.trackPageLinkedToToken).not.toHaveBeenCalled();
  });

  it('supports token and map multiselection and rejects other layers and a demoted GM', async () => {
    const map = item('1', 'MAP');
    const token = item('2', 'CHARACTER');
    const prop = item('3', 'PROP');
    const { controller, menu } = setup([map, token, prop]);
    await controller._setupItemContextMenus();
    const link = menu('link-page');
    expect(shown(link, 'GM', [])).toBe(false);
    expect(shown(link, 'GM', [map, prop])).toBe(false);
    expect(shown(link, 'PLAYER', [map])).toBe(false);
    expect(shown(link, 'GM', [map, token])).toBe(true);
    await link.onClick({ items: [prop, map] });
    expect(controller._showModalForm).not.toHaveBeenCalled();
    await link.onClick({ items: [map, token] });
    const [title, , submit] = controller._showModalForm.mock.lastCall;
    expect(title).toBe('Link page to 2 items');
    await submit({ pageIndex: '0' });
    expect(map.metadata[idKey]).toBe(token.metadata[idKey]);
    expect(token.metadata[idKey]).toBeTruthy();
    expect(controller.analyticsService.trackPageLinkedToToken).toHaveBeenCalledTimes(1);
    expect(shown(menu('view-page-gm'), 'GM', [map, token])).toBe(false);
    controller.OBR.player.getRole.mockResolvedValue('PLAYER');
    await submit({ pageIndex: '1' });
    await menu('unlink-page').onClick({ items: [map, token] });
    expect(controller.OBR.scene.items.updateItems).toHaveBeenCalledTimes(1);
    expect(prop.metadata).toEqual({ other: 42 });
  });

  it.each([
    ['handout', 'anyone', true], ['chart', 'recipient', true],
    ['chart', 'other', false], ['notes', 'recipient', false],
    ['paused', 'recipient', false], ['deleted', 'recipient', false]
  ])('checks player access for page %s and player %s', async (pageId, playerId, allowed) => {
    const map = item('map', 'MAP', { [idKey]: pageId });
    const { controller, menu } = setup([map], { role: 'PLAYER', playerId });
    await controller._setupItemContextMenus();
    const view = menu('view-page-player');
    expect(menu('link-page')).toBeUndefined();
    expect(menu('unlink-page')).toBeUndefined();
    expect(shown(view, 'PLAYER', [map])).toBe(allowed);
    await view.onClick({ items: [map] });
    if (allowed) expect(controller.openPage.mock.lastCall[0].id).toBe(pageId);
    else expect(controller.openPage).not.toHaveBeenCalled();
  });

  it('updates player menus on vault refresh and rejects clicks from a previously granted menu', async () => {
    const map = item('map', 'MAP', { [idKey]: 'chart' });
    const { controller, menu } = setup([map], { role: 'PLAYER' });
    await controller._setupItemContextMenus();
    const previous = menu('view-page-player');
    expect(shown(previous, 'PLAYER', [map])).toBe(true);
    controller.storageService = { getVaultOwner: async () => ({ connectionId: 'gm' }) };
    controller.broadcastService = { requestEncryptedPlayerVault: async () => ({ categories: [] }) };
    controller.configParser = { parse: Config.fromJSON };
    controller.cacheService = { clearPageCache: jest.fn() };
    controller.notionRenderer = { setDependencies: jest.fn() };
    await controller._refreshPlayerVault();
    expect(shown(menu('view-page-player'), 'PLAYER', [map])).toBe(false);
    await previous.onClick({ items: [map] });
    expect(controller.openPage).not.toHaveBeenCalled();
  });

  it('reads legacy URL-only token links and never substitutes a shared URL for a private page ID', async () => {
    const token = item('token', 'CHARACTER', { [urlKey]: vault.pages[0].url, [visibleKey]: true });
    const { controller, menu } = setup([token], { role: 'PLAYER' });
    await controller._setupItemContextMenus();
    const view = menu('view-page-player');
    expect(shown(view, 'PLAYER', [token])).toBe(true);
    await view.onClick({ items: [token] });
    expect(controller.openPage.mock.lastCall[0].id).toBe('handout');
    token.metadata[visibleKey] = false;
    expect(shown(view, 'PLAYER', [token])).toBe(false);
    token.metadata[visibleKey] = true;
    token.metadata[idKey] = 'notes';
    expect(shown(view, 'PLAYER', [token])).toBe(false);
    await view.onClick({ items: [token] });
    expect(controller.openPage).toHaveBeenCalledTimes(1);
  });

  it('gives a read-only Co-GM the private page view without item editing actions', async () => {
    const map = item('map', 'MAP', { [idKey]: 'notes' });
    const { controller, menu } = setup([map], { coGM: true });
    await controller._setupItemContextMenus();
    expect(menu('link-page')).toBeUndefined();
    expect(menu('unlink-page')).toBeUndefined();
    await menu('view-page-gm').onClick({ items: [map] });
    expect(controller.openPage.mock.lastCall[0].id).toBe('notes');
  });
});
