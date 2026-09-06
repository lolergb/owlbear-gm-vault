import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { Config } from '../../../js/models/Config.js';
import { Page } from '../../../js/models/Page.js';

const indexHtml = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

afterEach(() => { document.body.innerHTML = ''; });

describe('Notion token settings navigation', () => {
  it('opens Settings from a missing-token page, focuses the token field and returns to the vault', async () => {
    document.body.innerHTML = new DOMParser().parseFromString(indexHtml, 'text/html').body.innerHTML;
    const controller = new ExtensionController();
    const page = new Page('Test notes', 'https://www.notion.so/123456781234123412341234567890ab');
    controller.config = new Config({ pages: [page] });
    controller.notionService._hasDefaultAccess = jest.fn().mockResolvedValue(false);
    controller._renderVaultStatusBox = jest.fn();
    controller._setupUI({ pagesContainer: '#page-list', contentContainer: '#notion-content' });

    await controller.openPage(page);

    // The CTA must work independently of the list's hidden Settings control.
    expect(document.getElementById('settings-button')).toBeNull();
    const openSettings = document.querySelector('#notion-content button');
    expect(openSettings.textContent.trim()).toBe('Open Settings');
    openSettings.click();

    expect(document.getElementById('settings-container').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notion-container').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('page-list').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('page-title').textContent).toBe('Settings');
    expect(document.activeElement).toBe(document.getElementById('token-input'));
    expect(document.getElementById('token-input').value).toBe('');
    for (const id of [
      'page-open-modal-button-header', 'page-share-button-header',
      'page-visibility-button-header', 'page-context-menu-button-header'
    ]) {
      expect(document.getElementById(id).classList.contains('hidden')).toBe(true);
    }

    document.getElementById('back-button').click();
    expect(document.getElementById('settings-container').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('page-list').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.button-container').classList.contains('hidden')).toBe(false);
    expect(controller.config.pages).toEqual([page]);
  });
});
