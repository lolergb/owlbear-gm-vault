import { describe, expect, it, jest } from '@jest/globals';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { StorageService } from '../../../js/services/StorageService.js';

function createController({ isGM, isCoGM, localConfig }) {
  const controller = Object.create(ExtensionController.prototype);
  controller.isGM = isGM;
  controller.isCoGM = isCoGM;
  controller.roomId = 'room-1';
  controller.storageService = {
    getLocalConfig: jest.fn(() => localConfig),
    getStorageKey: jest.fn(() => 'notion-pages-json-room-1'),
    saveLocalConfig: jest.fn()
  };
  controller.configParser = new ConfigParser();
  controller.notionRenderer = { setDependencies: jest.fn() };
  controller._fetchDefaultConfig = jest.fn().mockResolvedValue({
    categories: [{ name: 'Demo', pages: [] }]
  });
  controller._checkGMAvailability = jest.fn().mockResolvedValue({ isActive: false });
  controller._requestFullVaultForCoGM = jest.fn();
  return controller;
}

describe('ExtensionController config loading', () => {
  it('keeps a deliberately empty Master GM vault after reload', async () => {
    const controller = createController({
      isGM: true,
      isCoGM: false,
      localConfig: { categories: [] }
    });

    await controller._loadConfig();

    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
    expect(controller.config.getTotalPageCount()).toBe(0);
    expect(controller.config.categories).toHaveLength(0);
  });

  it('starts empty without fetching or saving a demo when no local vault exists', async () => {
    const controller = createController({
      isGM: true,
      isCoGM: false,
      localConfig: null
    });

    await controller._loadConfig();

    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
    expect(controller.config.categories).toHaveLength(0);
    expect(controller.config.getTotalPageCount()).toBe(0);
  });

  it('opens a v1 default vault and retains its token, order and visibility', async () => {
    localStorage.clear();
    const legacyVault = {
      categories: [{
        name: 'Campaign',
        items: [
          { type: 'page', name: 'Private notes', url: 'https://example.com/private' },
          { type: 'category', name: 'Handouts', items: [
            { type: 'page', name: 'Player map', url: 'https://example.com/map.png', visibleToPlayers: true }
          ] }
        ]
      }]
    };
    const original = JSON.stringify(legacyVault);
    localStorage.setItem('notion-pages-json-default', original);
    localStorage.setItem('notion-global-token', 'secret_v1');

    const controller = createController({ isGM: true, isCoGM: false, localConfig: null });
    const storageService = new StorageService();
    storageService.setRoomId('room-1');
    controller.storageService = storageService;

    await controller._loadConfig();

    expect(controller.config.getTotalPageCount()).toBe(2);
    expect(controller.config.categories[0].name).toBe('Campaign');
    expect(controller.config.categories[0].order).toEqual([
      { type: 'page', index: 0 },
      { type: 'category', index: 0 }
    ]);
    expect(controller.config.getVisiblePages().map(page => page.name)).toEqual(['Player map']);
    expect(storageService.getUserToken()).toBe('secret_v1');
    expect(localStorage.getItem('notion-pages-json-default')).toBe(original);
    expect(localStorage.getItem('notion-pages-json-room-1')).toBeNull();
  });

  it('prefers a v1 room vault over an older default vault', async () => {
    localStorage.clear();
    localStorage.setItem('notion-pages-json-default', JSON.stringify({
      categories: [{ name: 'Old default', pages: [] }]
    }));
    const roomVault = { categories: [{ name: 'My campaign', pages: [
      { name: 'Session 12', url: 'https://example.com/session-12', visibleToPlayers: false }
    ] }] };
    const original = JSON.stringify(roomVault);
    localStorage.setItem('notion-pages-json-room-1', original);

    const controller = createController({ isGM: true, isCoGM: false, localConfig: null });
    const storageService = new StorageService();
    storageService.setRoomId('room-1');
    controller.storageService = storageService;

    await controller._loadConfig();

    expect(controller.config.categories[0].name).toBe('My campaign');
    expect(controller.config.getTotalPageCount()).toBe(1);
    expect(localStorage.getItem('notion-pages-json-room-1')).toBe(original);
  });

  it('accepts an empty Co-GM fallback vault', async () => {
    const controller = createController({
      isGM: true,
      isCoGM: true,
      localConfig: { categories: [] }
    });

    await controller._loadConfig();

    expect(controller.config.categories).toHaveLength(0);
    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
  });

  it.each(['{broken', '', 'null', '{}', '{"categories":"invalid"}',
    '{"categories":[],"pages":[{"name":"Missing URL"}]}'])
  ('preserves an invalid room vault instead of falling back to a different default: %s', async raw => {
    localStorage.setItem('notion-pages-json-room-1', raw);
    localStorage.setItem('notion-pages-json-default', JSON.stringify({ categories: [{ name: 'Unrelated' }] }));
    localStorage.setItem('notion-global-token', 'keep-token');
    const original = { ...localStorage.store };
    const controller = createController({ isGM: true, isCoGM: false, localConfig: null });
    controller.storageService = new StorageService();
    controller.storageService.setRoomId('room-1');
    await expect(controller._loadConfig()).rejects.toThrow('original data has been preserved');
    expect(localStorage.store).toEqual(original);
    expect(controller.config).toBeUndefined();
    expect(controller._fetchDefaultConfig).not.toHaveBeenCalled();
  });

  it('preserves a malformed legacy default instead of opening an editable empty vault', async () => {
    localStorage.setItem('notion-pages-json-default', '{broken');
    const controller = createController({ isGM: true, isCoGM: false, localConfig: null });
    controller.storageService = new StorageService();
    controller.storageService.setRoomId('room-1');
    await expect(controller._loadConfig()).rejects.toThrow('original data has been preserved');
    expect(localStorage.getItem('notion-pages-json-default')).toBe('{broken');
    expect(localStorage.getItem('notion-pages-json-room-1')).toBeNull();
  });

  it('does not treat inaccessible browser storage as an empty vault', async () => {
    const controller = createController({ isGM: true, isCoGM: false, localConfig: null });
    controller.storageService = new StorageService();
    controller.storageService.setRoomId('room-1');
    localStorage.getItem.mockImplementationOnce(() => { throw new Error('Storage denied'); });
    await expect(controller._loadConfig()).rejects.toThrow('could not be read');
    expect(controller.config).toBeUndefined();
  });
});
