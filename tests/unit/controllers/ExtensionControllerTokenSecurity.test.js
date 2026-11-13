import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

const SAVED_TOKEN = 'ntn_saved_token_must_not_enter_the_dom_7x9Q';

function createController(token = SAVED_TOKEN) {
  const controller = Object.create(ExtensionController.prototype);
  controller.storageService = {
    getUserToken: jest.fn(() => token),
    saveUserToken: jest.fn()
  };
  controller.analyticsService = {
    trackTokenConfigured: jest.fn(),
    trackTokenRemoved: jest.fn()
  };
  controller.uiRenderer = {
    showSuccessToast: jest.fn(),
    showInfoToast: jest.fn(),
    _showConfirmDialog: jest.fn().mockResolvedValue(true)
  };
  return controller;
}

function renderTokenSettings() {
  document.body.innerHTML = `
    <input id="token-input" type="password">
    <p id="token-masked"></p>
    <button id="save-token" class="btn--primary"></button>
    <button id="clear-token"></button>
    <button id="import-notion-btn"></button>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ExtensionController Notion token privacy', () => {
  it('never restores a saved token into the settings DOM', () => {
    renderTokenSettings();
    const controller = createController();

    controller._setupSettingsEventListeners();

    expect(document.getElementById('token-input').value).toBe('');
    expect(document.getElementById('token-input').placeholder).toMatch(/replace/i);
    expect(document.getElementById('token-masked').textContent).toBe(
      `Notion connected · ending in ${SAVED_TOKEN.slice(-4)}`
    );
    expect(document.body.innerHTML).not.toContain(SAVED_TOKEN);
  });

  it('clears a replacement token from the input immediately after saving', () => {
    renderTokenSettings();
    const controller = createController();
    const replacement = 'ntn_replacement_token_4Lm2';

    controller._setupSettingsEventListeners();
    const input = document.getElementById('token-input');
    input.value = replacement;
    document.getElementById('save-token').click();

    expect(controller.storageService.saveUserToken).toHaveBeenCalledWith(replacement);
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain(replacement);
  });
});
