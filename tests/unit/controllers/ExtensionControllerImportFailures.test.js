import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import { ConfigParser } from '../../../js/parsers/ConfigParser.js';
import { StorageService } from '../../../js/services/StorageService.js';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';
import { setDebugMode, resetRoleCache } from '../../../js/utils/logger.js?v=20260722-4';

const secret = 'PRIVATE-CAMPAIGN-INPUT';
const url = `https://private.example/${secret}.json?token=${secret}`;
const valid = JSON.stringify({ categories: [{ name: secret, pages: [{ name: secret, url }] }] });
const originalFetch = globalThis.fetch;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const response = text => ({ ok: true, text: jest.fn().mockResolvedValue(text) });

function createController(consent = true) {
  const controller = Object.create(ExtensionController.prototype);
  controller.config = { categories: [], pages: [] };
  controller.configParser = new ConfigParser();
  controller.storageService = new StorageService();
  controller.analyticsService = new AnalyticsService();
  if (consent !== null) controller.analyticsService.setConsent(consent);
  controller.analyticsService.mixpanelEnabled = true;
  controller.analyticsService.mixpanelToken = 'test-token';
  controller.analyticsService.OBR = { player: { getRole: async () => 'GM' } };
  controller.uiRenderer = { showSuccessToast: jest.fn(), setConfig: jest.fn() };
  controller.render = jest.fn().mockResolvedValue();
  controller._goBackToList = jest.fn();
  controller.modalManager = {};
  return controller;
}

function diagnostics() {
  return globalThis.fetch.mock.calls.filter(([target]) => target === 'https://api-eu.mixpanel.com/track')
    .map(([, options]) => JSON.parse(atob(new URLSearchParams(options.body).get('data')))[0]);
}

function expectPrivateDiagnostics(events) {
  const logged = JSON.stringify([console.log.mock.calls, console.warn.mock.calls, console.error.mock.calls]);
  const recorded = JSON.stringify([events, localStorage.setItem.mock.calls]);
  for (const marker of [secret, 'private.example', 'secret-backup.json', 'RAW-EXCEPTION']) {
    expect(logged).not.toContain(marker);
    expect(recorded).not.toContain(marker);
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  resetRoleCache();
  setDebugMode(true); // Privacy must hold even when debug logging is enabled.
  globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 1 }) });
});

afterEach(() => {
  document.body.innerHTML = '';
  setDebugMode(false);
  resetRoleCache();
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

const failures = [
  ['malformed file JSON', 'file', 'parse', 'invalid_json', c => c._readJsonImportFile({ name: 'secret-backup.json', text: async () => `{"${secret}":` })],
  ['file read rejection', 'file', 'read', 'file_read_failed', c => c._readJsonImportFile({ name: 'secret-backup.json', text: async () => { throw new Error(`RAW-EXCEPTION ${url}`); } })],
  ['HTML file', 'file', 'parse', 'html_response', c => c._readJsonImportFile({ text: async () => `<!doctype html><html>${secret}</html>` })],
  ['invalid structure', 'file', 'validate', 'invalid_config', c => c._readJsonImportFile({ text: async () => JSON.stringify({ categories: [{ name: secret, pages: [{ name: secret }] }] }) })],
  ['malformed URL JSON', 'url', 'parse', 'invalid_json', c => { globalThis.fetch.mockResolvedValueOnce(response(`{"${secret}":`)); return c._fetchJsonImport(url); }],
  ['HTML URL response', 'url', 'parse', 'html_response', c => { globalThis.fetch.mockResolvedValueOnce(response(`<html><body>${secret}</body></html>`)); return c._fetchJsonImport(url); }],
  ['unreachable URL', 'url', 'fetch', 'fetch_failed', c => { globalThis.fetch.mockRejectedValueOnce(new TypeError(`RAW-EXCEPTION ${url}`)); return c._fetchJsonImport(url); }],
  ['HTTP error', 'url', 'http', 'http_error', c => { globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 503, text: () => { throw new Error('Must not read error body'); } }); return c._fetchJsonImport(url); }],
  ['response read rejection', 'url', 'read', 'response_read_failed', c => { globalThis.fetch.mockResolvedValueOnce({ ok: true, text: async () => { throw new Error(`RAW-EXCEPTION ${url}`); } }); return c._fetchJsonImport(url); }],
  ['missing URL', 'url', 'input', 'missing_url', c => c._fetchJsonImport('')],
  ['invalid URL', 'url', 'input', 'invalid_url', c => c._fetchJsonImport(secret)],
  ['unsupported scheme', 'url', 'input', 'invalid_url', c => c._fetchJsonImport(`file:///${secret}`)]
];

describe.each([true, false, null])('import failure privacy with consent=%s', consent => {
  it.each(failures)('%s', async (_label, source, stage, code, run) => {
    const controller = createController(consent);
    const configBefore = controller.config;
    const reporting = jest.spyOn(controller.analyticsService, 'trackVaultImportFailed');
    localStorage.setItem.mockClear();
    let failure;
    try { await run(controller); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ importStage: stage, importCode: code });
    expect(failure.cause).toBeUndefined();
    const acknowledged = controller._handleJsonImportError(failure, source, 'prepare');
    const message = document.getElementById('json-import-error-message').textContent;
    expect(message).not.toMatch(/CORS|Obsidian|RAW-EXCEPTION/);
    expect(message).toMatch(/try again|Choose|Use|Enter|Check|download|Fix/i);
    expect(document.getElementById('json-import-modal')).toBeNull();
    document.getElementById('json-import-error-ok').click();
    await acknowledged;
    await flush();
    expect(controller.config).toBe(configBefore);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    const events = diagnostics();
    expect(events).toHaveLength(consent === true ? 1 : 0);
    if (consent === true) expect(events[0]).toMatchObject({ event: 'vault_import_failed', properties: { source, stage, error_code: code } });
    expectPrivateDiagnostics(events);
    expect(JSON.stringify(reporting.mock.calls)).not.toContain(secret);
    expect(reporting.mock.calls[0][0]).not.toHaveProperty('error');
  });
});

describe('import UI regression', () => {
  it.each(['file', 'url'])('prepares valid %s input and saves only after confirmation', async source => {
    const controller = createController();
    const save = jest.spyOn(controller, 'saveConfig');
    let prepared;
    if (source === 'file') prepared = await controller._readJsonImportFile({ name: 'secret-backup.json', text: async () => `\uFEFF${valid}` });
    else {
      globalThis.fetch.mockResolvedValueOnce(response(valid));
      prepared = await controller._fetchJsonImport(url);
    }
    localStorage.setItem.mockClear();
    await controller._showPreparedJsonImport(prepared.importedConfig, prepared.preflight, 'secret-backup.json', source);
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    document.getElementById('json-import-confirm').click();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.render).toHaveBeenCalled();
    expect(controller.uiRenderer.showSuccessToast).toHaveBeenCalled();
    expect(diagnostics().some(event => event.event === 'vault_import_completed')).toBe(true);
    // The vault is product data; it is saved only after explicit confirmation.
    expect(localStorage.setItem.mock.calls).toHaveLength(1);
    expect(localStorage.setItem.mock.calls[0][1]).toContain(secret);
    localStorage.setItem.mockClear();
    expectPrivateDiagnostics(diagnostics());
  });

  it('runs the URL button, restores loading state and keeps input out of logs/events', async () => {
    const controller = createController();
    document.body.innerHTML = '<input id="vault-url-input"><button id="load-url-btn">Load URL</button>';
    document.getElementById('vault-url-input').value = url;
    controller._setupSettingsEventListeners();
    globalThis.fetch.mockRejectedValueOnce(new TypeError(`RAW-EXCEPTION ${url}`));
    const button = document.getElementById('load-url-btn');
    localStorage.setItem.mockClear();
    button.click();
    expect(button.disabled).toBe(true);
    await flush();
    expect(document.getElementById('json-import-error-title').textContent).toBe('Could not reach URL');
    document.getElementById('json-import-error-ok').click();
    await flush();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Load URL');
    expect(diagnostics().find(event => event.event === 'load_from_url_clicked').properties).not.toHaveProperty('url_domain');
    expectPrivateDiagnostics(diagnostics());
  });

  it('runs the file picker and reports malformed JSON without retaining its name or content', async () => {
    const controller = createController();
    document.body.innerHTML = '<button id="load-json-btn">Load file</button>';
    controller._setupSettingsEventListeners();
    let picker;
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () { picker = this; });
    document.getElementById('load-json-btn').click();
    Object.defineProperty(picker, 'files', { value: [{ name: 'secret-backup.json', text: async () => `{"${secret}":` }] });
    localStorage.setItem.mockClear();
    picker.dispatchEvent(new Event('change'));
    await flush();
    expect(document.getElementById('json-import-error-title').textContent).toBe('This file isn’t valid JSON');
    document.getElementById('json-import-error-ok').click();
    await flush();
    expect(diagnostics()[0].properties).toMatchObject({ source: 'file', stage: 'parse', error_code: 'invalid_json' });
    expectPrivateDiagnostics(diagnostics());
  });

  it('keeps an HTML-looking string inside valid JSON as ordinary backup content', async () => {
    const controller = createController();
    const backup = { categories: [], pages: [{ name: '<html>Page title</html>', url }] };
    expect(controller._prepareJsonImportText(JSON.stringify(backup)).preflight.valid).toBe(true);
    expect(diagnostics()).toHaveLength(0);
  });

  it('does not show or report an unexpected exception message or spoofed metadata', async () => {
    const controller = createController();
    const error = new Error(`RAW-EXCEPTION ${url}`);
    error.userTitle = secret;
    error.importStage = 'fetch';
    error.importCode = secret;
    localStorage.setItem.mockClear();
    const acknowledged = controller._handleJsonImportError(error, 'url', 'prepare');
    expect(document.getElementById('json-import-error-modal').textContent).not.toContain(secret);
    document.getElementById('json-import-error-ok').click();
    await acknowledged;
    await flush();
    expect(diagnostics()[0].properties).toMatchObject({ stage: 'prepare', error_code: 'prepare_failed' });
    expectPrivateDiagnostics(diagnostics());
  });

  it.each(['append', 'merge', 'replace'])('keeps content out of debug logs when applying %s', async mode => {
    const controller = createController();
    controller.config = JSON.parse(valid);
    localStorage.setItem.mockClear();
    expect(await controller._applyJsonImport(JSON.parse(valid), mode, 1)).toBe(true);
    localStorage.setItem.mockClear();
    await flush();
    expectPrivateDiagnostics(diagnostics());
  });

  it('keeps a storage exception private and reports the save phase once', async () => {
    const controller = createController();
    jest.spyOn(controller.storageService, 'saveLocalConfig').mockImplementationOnce(() => {
      throw new Error(`RAW-EXCEPTION ${url}`);
    });
    localStorage.setItem.mockClear();
    const applying = controller._applyJsonImport(JSON.parse(valid), 'replace', 1);
    await flush();
    expect(document.getElementById('json-import-error-message').textContent).toContain('storage');
    document.getElementById('json-import-error-ok').click();
    expect(await applying).toBe(false);
    expect(diagnostics()).toHaveLength(1);
    expect(diagnostics()[0].properties).toMatchObject({ stage: 'save', error_code: 'storage_failed' });
    expectPrivateDiagnostics(diagnostics());
  });

  it('distinguishes a display failure after a successful save', async () => {
    const controller = createController();
    controller.render.mockRejectedValueOnce(new Error(`RAW-EXCEPTION ${url}`));
    const applying = controller._applyJsonImport(JSON.parse(valid), 'replace', 1);
    await flush();
    expect(localStorage.setItem.mock.calls.some(([, value]) => value.includes(secret))).toBe(true);
    localStorage.setItem.mockClear();
    expect(document.getElementById('json-import-error-message').textContent).toContain('backup was saved');
    document.getElementById('json-import-error-ok').click();
    expect(await applying).toBe(false);
    expect(diagnostics()[0].properties).toMatchObject({ stage: 'display', error_code: 'display_failed' });
    expectPrivateDiagnostics(diagnostics());
  });

  it('restores the previous vault and keeps native storage errors out of console', async () => {
    const controller = createController();
    const previous = controller.config;
    localStorage.setItem.mockClear();
    localStorage.setItem.mockImplementationOnce(() => { throw new Error(`RAW-EXCEPTION ${url}`); });
    const applying = controller._applyJsonImport(JSON.parse(valid), 'replace', 1);
    await flush();
    expect(controller.config).toBe(previous);
    expect(diagnostics()[0].properties).toMatchObject({ stage: 'save', error_code: 'storage_failed' });
    document.getElementById('json-import-error-ok').click();
    expect(await applying).toBe(false);
    // Ignore the attempted product-data write, which threw without saving.
    localStorage.setItem.mockClear();
    expectPrivateDiagnostics(diagnostics());
  });
});
