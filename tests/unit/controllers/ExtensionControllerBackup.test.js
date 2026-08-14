import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';

function renderSettings() {
  document.body.innerHTML = `
    <input id="token-input">
    <p id="token-masked"></p>
    <button id="save-token"></button>
    <button id="clear-token"></button>
    <button id="load-json-btn"></button>
    <button id="load-url-btn"></button>
    <input id="vault-url-input">
    <button id="download-json-btn"></button>
    <button id="patreon-btn"></button>
    <button id="feedback-btn"></button>
    <button id="clear-local-data-btn"></button>
    <button id="view-json-btn"></button>
  `;
}

beforeEach(() => {
  jest.useFakeTimers();
  renderSettings();
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('ExtensionController vault backup', () => {
  it('keeps the blob alive until Dia has started the download', async () => {
    const controller = Object.create(ExtensionController.prototype);
    controller.roomId = 'room-1';
    controller.config = { categories: [] };
    controller.configParser = new ConfigParser();
    controller.storageService = {
      getUserToken: jest.fn(() => null),
      saveUserToken: jest.fn(),
      clearAllLocalData: jest.fn()
    };
    controller.analyticsService = {
      trackJSONExported: jest.fn(),
      trackTokenConfigured: jest.fn(),
      trackTokenRemoved: jest.fn()
    };
    controller.uiRenderer = {
      showSuccessToast: jest.fn(),
      showInfoToast: jest.fn(),
      showErrorToast: jest.fn(),
      _showConfirmDialog: jest.fn().mockResolvedValue(false)
    };

    const createObjectURL = jest.fn(() => 'blob:backup');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL
    });
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    controller._setupSettingsEventListeners();
    document.getElementById('download-json-btn').click();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"categories"'));
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(controller.uiRenderer.showSuccessToast).toHaveBeenCalledWith(
      'Backup copied',
      'The JSON is on your clipboard; a file download was also requested.'
    );

    await jest.advanceTimersByTimeAsync(1000);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
    anchorClick.mockRestore();
  });
});
