import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { jest } from '@jest/globals';

const root = new URL('../../', import.meta.url);

// Keep URL identity intact, as browsers do. Jest's normal module loader hides
// stale imports by resolving every query string to the current file on disk.
async function loadControllerWithCache(staleModule) {
  const context = createContext({
    console, document, window, HTMLElement, localStorage,
    crypto, TextEncoder, TextDecoder, URL, URLSearchParams, setTimeout, clearTimeout
  });
  const modules = new Map();
  function getModule(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    let module;
    if (url.protocol === 'https:') {
      module = new SyntheticModule(['default'], function () {
        this.setExport('default', {});
      }, { context, identifier: url.href });
    } else {
      let source = readFileSync(url, 'utf8');
      if (staleModule === 'Page' && url.pathname.endsWith('/models/Page.js') && !url.search) {
        // The pre-sharing serializer did not include either access field.
        source += `
          const serialize = Page.prototype.toJSON;
          Page.prototype.toJSON = function () {
            const json = serialize.call(this);
            delete json.sharedWithPlayerIds;
            delete json.playerAccessEnabled;
            return json;
          };
        `;
      }
      if (staleModule === 'ConfigParser' && url.pathname.endsWith('/parsers/ConfigParser.js') &&
          url.search === '?v=20260722-4') {
        // These options were absent before selected-player sharing shipped.
        source = source.replace(/^\s*(sharedWithPlayerIds|playerAccessEnabled): pageJson\..*,\n/gm, '\n');
      }
      module = new SourceTextModule(source, { context, identifier: url.href });
    }
    modules.set(url.href, module);
    return module;
  }

  const main = readFileSync(new URL('js/main.js', root), 'utf8');
  const controllerImport = main.match(/from '(\.\/controllers\/ExtensionController\.js[^']*)'/)[1];
  const controllerModule = getModule(new URL(controllerImport, new URL('js/main.js', root)));
  await controllerModule.link((specifier, parent) => getModule(new URL(specifier, parent.identifier)));
  await controllerModule.evaluate();
  return new controllerModule.namespace.ExtensionController();
}

describe.each(['fresh', 'Page', 'ConfigParser'])('selected-player persistence with %s cache', staleModule => {
  it.each(['root', 'nested'])('saves a %s page from the chooser and keeps the selection after reloading', async location => {
    const controller = await loadControllerWithCache(staleModule);
    controller.isGM = true;
    controller.isCoGM = false;
    const page = { id: 'secret', name: 'Secret', url: 'https://example.com/secret', visibleToPlayers: true };
    controller.config = controller.configParser.parse(location === 'root'
      ? { categories: [], pages: [page] }
      : { categories: [{ name: 'Folder', categories: [{ name: 'Nested', pages: [page] }] }] });
    controller.storageService.setRoomId('sharing-regression');
    controller.broadcastService = {
      broadcastVisiblePages: jest.fn().mockResolvedValue(true),
      notifyPlayerVaultUpdated: jest.fn().mockResolvedValue(true),
      notifyFullVaultUpdated: jest.fn().mockResolvedValue(true),
      invalidatePage: jest.fn().mockResolvedValue(true)
    };
    controller.playerDirectoryService.listPlayers = jest.fn().mockResolvedValue([
      { id: 'player-1', name: 'Lyra', connected: true }
    ]);
    controller.OBR = { scene: { items: { getItems: jest.fn().mockResolvedValue([]) } } };
    controller.render = jest.fn();
    controller._showFeedback = jest.fn();

    await controller._showPlayerAccessModal(controller.config.findPageById('secret'));
    document.querySelector('input[value="player-1"]').click();
    document.querySelector('.player-access-actions .btn--primary').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#player-access-modal')).toBeNull();
    const saved = controller.storageService.getLocalConfig();
    const savedPage = location === 'root' ? saved.pages[0] : saved.categories[0].categories[0].pages[0];
    expect(savedPage.sharedWithPlayerIds).toEqual(['player-1']);
    expect(savedPage.visibleToPlayers).not.toBe(true);
    controller.config = controller.configParser.parse(saved);
    await controller._showPlayerAccessModal(controller.config.findPageById('secret'));
    expect(document.querySelector('input[value="player-1"]').checked).toBe(true);
    expect(document.querySelector('input[name="player-access-everyone"]').checked).toBe(false);
  });

  afterEach(() => { document.body.innerHTML = ''; });
});
