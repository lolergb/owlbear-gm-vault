import { describe, expect, it, jest } from '@jest/globals';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

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

  it('uses the demo only when no local Master GM config exists', async () => {
    const controller = createController({
      isGM: true,
      isCoGM: false,
      localConfig: null
    });

    await controller._loadConfig();

    expect(controller._fetchDefaultConfig).toHaveBeenCalledTimes(1);
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.config.categories[0].name).toBe('Demo');
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
});
