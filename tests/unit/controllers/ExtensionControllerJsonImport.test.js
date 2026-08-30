import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';

const originalFetch = globalThis.fetch;

function createController() {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = { categories: [], pages: [] };
  controller.configParser = new ConfigParser();
  controller.analyticsService = {
    trackJSONImported: jest.fn(),
    trackVaultImportCompleted: jest.fn(),
    trackVaultImportFailed: jest.fn(),
    trackFirstUserContentCreated: jest.fn()
  };
  controller.uiRenderer = {
    showErrorToast: jest.fn(),
    showSuccessToast: jest.fn()
  };
  controller.broadcastService = {
    broadcastVisiblePages: jest.fn(),
    notifyFullVaultUpdated: jest.fn()
  };
  controller.saveConfig = jest.fn().mockResolvedValue(true);
  controller._goBackToList = jest.fn();
  controller.modalManager = {};
  return controller;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  globalThis.fetch = originalFetch;
});

describe('ExtensionController JSON import preflight', () => {
  it('acepta BOM, parsea una vez y devuelve el resumen validado', () => {
    const controller = createController();

    const result = controller._prepareJsonImportText(
      '\uFEFF{"categories":[],"pages":[{"name":"Home","url":"https://example.com"}]}',
      'file'
    );

    expect(result.importedConfig.pages[0].name).toBe('Home');
    expect(result.preflight.valid).toBe(true);
    expect(result.preflight.summary).toEqual({ categoryCount: 0, pageCount: 1 });
    expect(result.preflight.warnings).toEqual([]);
  });

  it('distingue sintaxis JSON de un esquema incompatible', () => {
    const controller = createController();

    expect(() => controller._prepareJsonImportText('{"categories":', 'file'))
      .toThrow(expect.objectContaining({ importStage: 'parse', userTitle: 'This file isn’t valid JSON' }));
    expect(() => controller._prepareJsonImportText('{"categories":{}}', 'file'))
      .toThrow(expect.objectContaining({ importStage: 'validate', userTitle: 'This backup can’t be imported' }));

    try {
      controller._prepareJsonImportText('{"categories":{}}', 'file');
    } catch (error) {
      expect(error.recovery).toBeUndefined();
      expect(error.message).toBe('GM Vault found one issue in this backup. Fix it in the JSON file, then try again.');
      expect(error.validationErrors).toEqual([
        'The folder list in this backup has an invalid format.'
      ]);
    }
  });

  it('bloquea un backup vacío con un mensaje específico', () => {
    const controller = createController();

    expect(() => controller._prepareJsonImportText('{"categories":[],"pages":[]}', 'file'))
      .toThrow(expect.objectContaining({
        name: 'EmptyVaultError',
        importStage: 'validate',
        userTitle: 'This backup is empty'
      }));
  });

  it('distingue red, HTTP y JSON inválido al importar desde URL', async () => {
    const controller = createController();

    globalThis.fetch = jest.fn().mockRejectedValueOnce(new TypeError('offline'));
    await expect(controller._fetchJsonImport('https://example.com/vault.json'))
      .rejects.toMatchObject({ importStage: 'fetch', name: 'TypeError' });

    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: jest.fn()
    });
    await expect(controller._fetchJsonImport('https://example.com/missing.json'))
      .rejects.toMatchObject({ importStage: 'http', userTitle: 'Could not download backup' });

    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('<html>Not JSON</html>')
    });
    await expect(controller._fetchJsonImport('https://example.com/not-json'))
      .rejects.toMatchObject({ importStage: 'parse', name: 'SyntaxError' });
  });

  it('separa el aviso de datos ignorados de las opciones de destino', async () => {
    const controller = createController();
    controller.config = {
      categories: [{ name: 'Existing', pages: [{ name: 'Old', url: 'https://example.com/old' }] }]
    };
    controller._setupSearchableSelect = jest.fn();
    const importedConfig = {
      categories: [{
        name: 'World',
        customFolderData: true,
        pages: [{
          name: 'Map',
          url: 'https://example.com/map',
          customPageData: true
        }]
      }],
      schemaVersion: 99
    };
    const preflight = controller.configParser.preflight(importedConfig);

    const flow = controller._showPreparedJsonImport(
      importedConfig,
      preflight,
      '<backup>.json',
      'file'
    );

    const warningModal = document.getElementById('json-import-warning-modal');
    expect(warningModal).not.toBeNull();
    expect(document.getElementById('json-import-modal')).toBeNull();
    expect(warningModal.textContent).toContain('Folders');
    expect(warningModal.textContent).toContain('Pages');
    expect(warningModal.textContent).toContain('3 extra details');
    expect(warningModal.textContent).not.toContain('categories[0]');
    expect(warningModal.textContent).toContain('What will be left out');
    expect(warningModal.querySelector('script, img, [onerror]')).toBeNull();
    expect(warningModal.textContent).toContain('<backup>.json');
    expect(controller.saveConfig).not.toHaveBeenCalled();

    document.getElementById('json-import-warning-next').click();
    await flow;

    expect(document.getElementById('json-import-warning-modal')).toBeNull();
    expect(document.getElementById('json-import-modal')).not.toBeNull();
    expect(document.querySelector('.import-preview')).toBeNull();
    expect(document.getElementById('json-import-title').textContent).toBe('Choose where to import');
    expect(controller.saveConfig).not.toHaveBeenCalled();
    document.getElementById('json-import-cancel').click();
  });

  it('lleva un backup válido directamente a las opciones de destino', async () => {
    const controller = createController();
    controller.config = {
      categories: [{ name: 'Existing', pages: [{ name: 'Old', url: 'https://example.com/old' }] }]
    };
    controller._setupSearchableSelect = jest.fn();
    const importedConfig = {
      categories: [{
        name: 'World',
        pages: [{ name: 'Map', url: 'https://example.com/map' }]
      }]
    };
    const preflight = controller.configParser.preflight(importedConfig);

    const modal = await controller._showPreparedJsonImport(
      importedConfig,
      preflight,
      'valid-vault.json',
      'file'
    );

    expect(document.getElementById('json-import-warning-modal')).toBeNull();
    expect(document.getElementById('json-import-modal')).not.toBeNull();
    expect(document.getElementById('json-import-title').textContent).toBe('Choose where to import');
    expect(modal.querySelector('.import-preview')).toBeNull();
    expect(modal.textContent).not.toContain('Before importing');
    expect(modal.textContent).toContain('How would you like to add it?');
    expect(modal.textContent).toContain('valid-vault.json');
    document.getElementById('json-import-cancel').click();
  });

  it('muestra un único botón de aceptación para errores bloqueantes', async () => {
    const controller = createController();
    let parseError;
    try {
      controller._prepareJsonImportText('{"categories":', 'file');
    } catch (error) {
      parseError = error;
    }

    const acknowledged = controller._handleJsonImportError(parseError, 'file', 'read');

    expect(document.getElementById('json-import-error-title').textContent).toBe('This file isn’t valid JSON');
    expect(document.querySelectorAll('#json-import-error-modal button')).toHaveLength(1);
    expect(document.getElementById('json-import-error-ok').textContent).toBe('Close');
    expect(document.getElementById('json-import-error-cancel')).toBeNull();
    expect(document.getElementById('json-import-error-continue')).toBeNull();
    document.getElementById('json-import-error-ok').click();

    await expect(acknowledged).resolves.toBeUndefined();
    expect(document.getElementById('json-import-error-modal')).toBeNull();
    expect(controller.analyticsService.trackVaultImportFailed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'file',
      stage: 'parse'
    }));
    expect(controller.saveConfig).not.toHaveBeenCalled();
  });

  it('explica los errores de estructura pero no permite continuar', async () => {
    const controller = createController();
    let validationError;
    try {
      controller._prepareJsonImportText(JSON.stringify({
        categories: [{
          name: 'World',
          pages: [
            { name: 'No content' },
            { name: 'Usable', url: 'https://example.com', visibleToPlayers: 'yes' }
          ]
        }]
      }), 'file');
    } catch (error) {
      validationError = error;
    }

    const acknowledged = controller._handleJsonImportError(validationError, 'file', 'read');

    const details = [...document.querySelectorAll('.import-error__details li')]
      .map(item => item.textContent);
    expect(details).toEqual([
      'Page “No content” needs a URL or saved page content.',
      'Page “Usable” must use true or false for player visibility.'
    ]);
    expect(document.querySelector('#json-import-error-modal .import-error-modal')).toBeNull();
    expect(document.querySelectorAll('#json-import-error-modal button')).toHaveLength(1);
    expect(document.getElementById('json-import-modal')).toBeNull();
    document.getElementById('json-import-error-ok').click();

    await expect(acknowledged).resolves.toBeUndefined();
    expect(validationError.recovery).toBeUndefined();
    expect(controller.saveConfig).not.toHaveBeenCalled();
  });

  it('no guarda ni emite broadcasts al cancelar, incluso con el vault vacío', async () => {
    const controller = createController();
    const importedConfig = {
      categories: [{ name: 'World', pages: [{ name: 'Map', url: 'https://example.com/map' }] }]
    };

    await controller._showLoadJsonOptionsModal(importedConfig, 0, 1, 'backup.json');

    expect(controller.saveConfig).not.toHaveBeenCalled();
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
    document.getElementById('json-import-cancel').click();

    expect(document.getElementById('json-import-modal')).toBeNull();
    expect(controller.saveConfig).not.toHaveBeenCalled();
    expect(controller.broadcastService.broadcastVisiblePages).not.toHaveBeenCalled();
  });

  it('no considera vacío un vault que todavía contiene carpetas', async () => {
    const controller = createController();
    controller.config = { categories: [{ name: 'Empty folder', pages: [], categories: [] }] };
    controller._setupSearchableSelect = jest.fn();
    const importedConfig = {
      categories: [{ name: 'World', pages: [{ name: 'Map', url: 'https://example.com/map' }] }]
    };

    await controller._showLoadJsonOptionsModal(importedConfig, 0, 1, 'backup.json');

    expect(document.querySelector('input[name="json-import-mode"][value="append"]')).not.toBeNull();
    expect(document.querySelector('.import-option__hint--warning').textContent)
      .toContain('1 folder');
    document.getElementById('json-import-cancel').click();
  });

  it('guarda únicamente después de confirmar las opciones de un vault vacío', async () => {
    const controller = createController();
    const importedConfig = {
      categories: [{ name: 'World', pages: [{ name: 'Map', url: 'https://example.com/map' }] }]
    };

    await controller._showLoadJsonOptionsModal(importedConfig, 0, 1, 'backup.json');
    expect(controller.saveConfig).not.toHaveBeenCalled();

    document.getElementById('json-import-confirm').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.saveConfig).toHaveBeenCalledTimes(1);
    expect(controller.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      categories: expect.any(Array),
      pages: expect.any(Array)
    }));
  });

  it('vuelve a validar justo antes de guardar y bloquea llamadas directas inválidas', async () => {
    const controller = createController();
    controller._showJsonImportErrorAlert = jest.fn().mockResolvedValue();

    await controller._applyJsonImport({ categories: {} }, 'replace', 0, 'root', 'file');

    expect(controller.saveConfig).not.toHaveBeenCalled();
    expect(controller.analyticsService.trackVaultImportFailed).toHaveBeenCalledWith(expect.objectContaining({
      source: 'file',
      stage: 'validate'
    }));
    expect(controller._showJsonImportErrorAlert).toHaveBeenCalledWith(expect.objectContaining({
      importStage: 'validate',
      userTitle: 'This backup can’t be imported'
    }));
  });
});
