import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Page } from '../../../js/models/Page.js';

const ONEDRIVE_EMBED_URL = 'https://1drv.ms/w/c/8480b8199298dc6a/IQSJYPNDDhaHR6l68QswlHANAfzkMRJ6-BOy2ZMGhr-_BsM?em=2';
const ONEDRIVE_SHARE_URL = 'https://1drv.ms/w/c/8480b8199298dc6a/IQCJYPNDDhaHR6l68QswlHANAVALRHpMyZHEZNXc0y-nt6Q';

function createRenderController() {
  document.body.innerHTML = `
    <div id="notion-container" class="hidden show-content">
      <iframe id="notion-iframe" src="about:blank"></iframe>
      <div id="notion-content"></div>
    </div>
  `;
  return Object.create(ExtensionController.prototype);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ExtensionController OneDrive support', () => {
  it('renders a trusted OneDrive Embed URL in the document iframe', () => {
    const controller = createRenderController();
    const previousIframe = document.getElementById('notion-iframe');

    controller._renderOneDrivePage(new Page('Campaign notes', ONEDRIVE_EMBED_URL));

    const container = document.getElementById('notion-container');
    const iframe = document.getElementById('notion-iframe');
    expect(iframe).not.toBe(previousIframe);
    expect(container.classList.contains('hidden')).toBe(false);
    expect(container.classList.contains('show-content')).toBe(true);
    expect(document.getElementById('notion-content').textContent)
      .toContain('Loading OneDrive document');
    expect(iframe.src).toBe(ONEDRIVE_EMBED_URL);
    expect(iframe.title).toBe('Campaign notes');
    expect(iframe.allowFullscreen).toBe(true);

    // Un load tardío del antiguo about:blank no debe ocultar el loading.
    previousIframe.dispatchEvent(new Event('load'));
    expect(container.classList.contains('show-content')).toBe(true);

    iframe.dispatchEvent(new Event('load'));

    expect(container.classList.contains('show-content')).toBe(false);
    expect(document.getElementById('notion-content').innerHTML).toBe('');
  });

  it('offers retry if Microsoft takes too long to load', () => {
    jest.useFakeTimers();
    try {
      const controller = createRenderController();
      controller._renderOneDrivePage(new Page('Campaign notes', ONEDRIVE_EMBED_URL));

      jest.advanceTimersByTime(20000);

      const notionContent = document.getElementById('notion-content');
      expect(notionContent.textContent).toContain('OneDrive is taking longer than expected');
      const retryButton = notionContent.querySelector('[data-onedrive-retry]');
      expect(retryButton).not.toBeNull();

      retryButton.click();
      expect(notionContent.textContent).toContain('Loading OneDrive document');

      document.getElementById('notion-iframe').dispatchEvent(new Event('load'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('explains how to configure a normal OneDrive share link', () => {
    const controller = createRenderController();

    controller._renderOneDrivePage(new Page('Campaign notes', ONEDRIVE_SHARE_URL));

    expect(document.getElementById('notion-iframe').src).toBe('about:blank');
    expect(document.getElementById('notion-content').textContent)
      .toContain('OneDrive needs an Embed link');
    expect(document.getElementById('notion-content').textContent)
      .toContain('Embed → Generate');
  });

  it('normalizes a complete OneDrive iframe before saving a page', async () => {
    const controller = Object.create(ExtensionController.prototype);
    const target = { pages: [] };
    controller.uiRenderer = { showErrorToast: jest.fn() };
    controller.analyticsService = { trackPageAdded: jest.fn() };
    controller._navigateToCategory = jest.fn(() => target);
    controller.saveConfig = jest.fn().mockResolvedValue(true);
    controller._showModalForm = jest.fn((title, fields, onSubmit) => {
      onSubmit({
        name: 'Campaign notes',
        url: `<iframe src="${ONEDRIVE_EMBED_URL}" title="PowerPoint Viewer"></iframe>`,
        visibleToPlayers: true
      });
    });

    controller._handleAddPage([], 'room-qa');
    await Promise.resolve();
    await Promise.resolve();

    expect(target.pages).toHaveLength(1);
    expect(target.pages[0].url).toBe(ONEDRIVE_EMBED_URL);
    expect(target.pages[0].visibleToPlayers).toBe(true);
    expect(controller.saveConfig).toHaveBeenCalled();
    expect(controller.uiRenderer.showErrorToast).not.toHaveBeenCalled();
  });

  it('shares only trusted OneDrive Embed URLs with players', async () => {
    const controller = Object.create(ExtensionController.prototype);
    controller.isGM = true;
    controller.playerId = 'gm-1';
    controller.broadcastService = {
      sendMessage: jest.fn().mockResolvedValue({ success: true })
    };
    controller._showFeedback = jest.fn();

    await expect(controller._shareCurrentPageToPlayers(
      new Page('Campaign notes', ONEDRIVE_EMBED_URL)
    )).resolves.toBe(true);
    expect(controller.broadcastService.sendMessage).toHaveBeenCalledWith(
      'com.dmscreen/showContent',
      { url: ONEDRIVE_EMBED_URL, name: 'Campaign notes', senderId: 'gm-1' }
    );

    controller.broadcastService.sendMessage.mockClear();
    await expect(controller._shareCurrentPageToPlayers(
      new Page('Campaign notes', ONEDRIVE_SHARE_URL)
    )).resolves.toBe(false);
    expect(controller.broadcastService.sendMessage).not.toHaveBeenCalled();
    expect(controller._showFeedback).toHaveBeenLastCalledWith('❌ Use the OneDrive Embed link');
  });
});
