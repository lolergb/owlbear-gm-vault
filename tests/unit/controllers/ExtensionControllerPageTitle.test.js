import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Category } from '../../../js/models/Category.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';

const PAGE_ID = '12345678-1234-1234-1234-1234567890ab';
const PAGE_URL = `https://www.notion.so/Untitled-${PAGE_ID.replace(/-/g, '')}`;

function bareController() {
  return Object.create(ExtensionController.prototype);
}

describe('ExtensionController title repair', () => {
  it('extrae títulos formados por varios fragmentos', () => {
    const controller = bareController();
    const title = controller._extractNotionPageTitle({
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'Wave ' }, { plain_text: 'Echo Cave' }]
        }
      }
    });

    expect(title).toBe('Wave Echo Cave');
  });

  it('rechaza Untitled aunque venga con espacios o mayúsculas distintas', () => {
    const controller = bareController();
    const title = controller._extractNotionPageTitle({
      properties: {
        Name: { type: 'title', title: [{ plain_text: ' UNTITLED ' }] }
      }
    });

    expect(title).toBeNull();
  });

  it('actualiza mentions procedentes del HTML cacheado', () => {
    const controller = bareController();
    const page = { name: 'Untitled', url: PAGE_URL, visibleToPlayers: true };
    controller.config = {
      findPageByNotionId: () => page,
      findPageById: () => null,
      findPageByName: () => null
    };
    controller.isGM = true;
    controller._attachMentionHandlers = jest.fn();

    const container = document.createElement('div');
    container.innerHTML = `
      <span class="notion-mention notion-mention--plain"
            data-mention-page-id="${PAGE_ID}"
            data-mention-page-name="Cragmaw Hideout">Cragmaw Hideout</span>`;

    controller._updateMentionsInContent(container);

    const mention = container.querySelector('.notion-mention');
    expect(mention.classList.contains('notion-mention--link')).toBe(true);
    expect(mention.dataset.mentionPageName).toBe('Cragmaw Hideout');
    expect(mention.textContent).toBe('Cragmaw Hideout');
    expect(controller._attachMentionHandlers).toHaveBeenCalledWith(container);
  });

  it('abre el modal con el nombre de la mention si la página sigue como Untitled', async () => {
    const controller = bareController();
    const page = { name: 'Untitled', visibleToPlayers: true };
    controller.config = {
      findPageByNotionId: () => page,
      findPageById: () => null,
      findPageByName: () => null
    };
    controller.isGM = true;
    controller._showMentionPageModal = jest.fn().mockResolvedValue(undefined);

    await controller._openMentionedPage(PAGE_ID, 'Lost Mine', '', null);

    expect(controller._showMentionPageModal).toHaveBeenCalledWith(page, 'Lost Mine');
  });

  it('persiste la reparación localmente y la difunde para el Master GM', async () => {
    const page = new Page('Untitled', PAGE_URL, { id: 'page-title-test' });
    const config = new Config({
      categories: [new Category('Adventure', { pages: [page] })]
    });
    const controller = bareController();
    controller.config = config;
    controller.isGM = true;
    controller.isCoGM = false;
    controller.storageService = {
      saveLocalConfig: jest.fn()
    };
    controller.broadcastService = {
      broadcastVisiblePages: jest.fn(),
      notifyFullVaultUpdated: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    const title = await controller._repairStoredPageTitle(page, 'Phandalin');

    expect(title).toBe('Phandalin');
    expect(page.name).toBe('Phandalin');
    expect(controller.storageService.saveLocalConfig).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.broadcastVisiblePages).toHaveBeenCalledTimes(1);
    expect(controller.broadcastService.notifyFullVaultUpdated).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a guardar una página que ya tiene nombre válido', async () => {
    const page = new Page('Existing title', PAGE_URL, { id: 'page-title-test' });
    const config = new Config({
      categories: [new Category('Adventure', { pages: [page] })]
    });
    const controller = bareController();
    controller.config = config;
    controller.isGM = true;
    controller.isCoGM = false;
    controller.storageService = {
      saveLocalConfig: jest.fn(),
      saveRoomConfig: jest.fn()
    };
    controller.broadcastService = {
      broadcastVisiblePages: jest.fn(),
      sendMessage: jest.fn()
    };

    await controller._repairStoredPageTitle(page, 'New API title');

    expect(page.name).toBe('Existing title');
    expect(controller.storageService.saveLocalConfig).not.toHaveBeenCalled();
  });
});
