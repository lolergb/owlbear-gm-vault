import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TextEncoder } from 'node:util';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';

describe('privacy-safe error analytics', () => {
  let service, fetchBefore, encoderBefore;
  beforeEach(() => {
    localStorage.clear();
    fetchBefore = global.fetch;
    encoderBefore = global.TextEncoder;
    global.TextEncoder = TextEncoder;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 1 }) });
    service = new AnalyticsService();
    service.setConsent(true);
    service.mixpanelEnabled = true;
    service.mixpanelToken = 'project-token';
    service.mixpanelDistinctId = 'private-player-id';
    service.vaultInstanceId = 'private-vault-id';
    service.vaultState = 'configured';
    service.environment = 'beta';
    service.deployContext = 'deploy-preview';
    service.OBR = { player: { getRole: async () => 'GM' } };
  });
  afterEach(() => { service.cleanup(); global.fetch = fetchBefore; global.TextEncoder = encoderBefore; });
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const eventAt = (index = 0) => JSON.parse(atob(new URLSearchParams(global.fetch.mock.calls[index][1].body).get('data')))[0];

  it('sends only controlled properties for global and promise errors', async () => {
    service._installErrorListeners();
    const error = new TypeError('https://private.test/secret?token=super-secret-token-value Room name');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message, filename: 'https://private.test/a' }));
    const promise = new Event('unhandledrejection');
    promise.reason = new RangeError('private player and page');
    window.dispatchEvent(promise);
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const first = eventAt();
    expect(first.event).toBe('client_error');
    expect(first.properties).toMatchObject({ operation: 'runtime', error_type: 'TypeError', error_code: 'unknown', error_source: 'global', error_fingerprint: 'runtime:TypeError:unknown', app_version: '2.1.5', environment: 'beta', deploy_context: 'deploy-preview', role: 'GM', vault_state: 'configured' });
    expect(eventAt(1).properties).toMatchObject({ error_source: 'promise', error_type: 'RangeError' });
    const sent = JSON.stringify([first, eventAt(1)]);
    for (const secret of ['private.test', 'super-secret-token-value', 'Room name', 'private-player-id', 'private-vault-id', 'private player']) expect(sent).not.toContain(secret);
  });

  it('deduplicates the same error and nearby equivalent reports, but allows later occurrences', async () => {
    jest.useFakeTimers();
    const error = new Error('secret');
    service.trackClientError({ operation: 'load_content', error });
    service.trackClientError({ operation: 'load_content', source: 'global', error });
    service.trackClientError({ operation: 'load_content', error: new Error('another secret') });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    service.trackClientError({ operation: 'load_content', error: new Error('later') });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('sends handled failures and enriches the existing import event', async () => {
    service.trackClientError({ operation: 'token_link', error: new TypeError('private token') });
    service.trackVaultImportFailed({ source: 'file', stage: 'read', errorType: 'Error', mode: 'replace', destinationType: 'root' });
    await flush();
    expect(eventAt(0).properties).toMatchObject({ operation: 'token_link', error_source: 'handled', error_type: 'TypeError' });
    expect(eventAt(1).event).toBe('vault_import_failed');
    expect(eventAt(1).properties).toMatchObject({ operation: 'import', error_source: 'handled', error_code: 'file_read_failed', source: 'file' });
    expect(JSON.stringify(eventAt(0))).not.toContain('private token');
  });

  it('records only allowlisted load location and stage and keeps distinct stages', async () => {
    service.trackClientError({ operation: 'load_content', location: 'open_page', stage: 'blocks', error: new Error('secret URL') });
    service.trackClientError({ operation: 'load_content', location: 'open_page', stage: 'render', error: new Error('secret page') });
    service.trackClientError({ operation: 'load_content', location: 'private location', stage: 'private stage', error: new Error('secret') });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(eventAt(0).properties).toMatchObject({ error_location: 'open_page', error_stage: 'blocks', error_fingerprint: 'load_content:Error:unknown', build_ref: 'unknown' });
    expect(eventAt(1).properties.error_stage).toBe('render');
    expect(eventAt(2).properties).toMatchObject({ error_location: 'unknown', error_stage: 'unknown' });
    expect(JSON.stringify([eventAt(0), eventAt(1), eventAt(2)])).not.toMatch(/secret|private location|private stage/);
  });

  it('requires consent and never recursively reports transport failures', async () => {
    service.setConsent(false);
    service.trackClientError({ operation: 'token_link', error: new Error('secret') });
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    service.setConsent(true);
    global.fetch.mockRejectedValue(new Error('transport'));
    service.trackClientError({ operation: 'token_link', error: new Error('secret') });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps file and URL failures distinct while deduplicating nearby repeats', async () => {
    service.trackVaultImportFailed({ source: 'file', stage: 'parse', errorCode: 'invalid_json' });
    service.trackVaultImportFailed({ source: 'url', stage: 'parse', errorCode: 'invalid_json' });
    service.trackVaultImportFailed({ source: 'url', stage: 'parse', errorCode: 'invalid_json' });
    await flush();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(eventAt(0).properties.error_fingerprint).not.toBe(eventAt(1).properties.error_fingerprint);
  });

  it('normalizes codes by phase and discards all extra diagnostic input', async () => {
    service.trackVaultImportFailed({
      source: 'url', stage: 'input', errorCode: 'invalid_json',
      errorType: 'private-name', error: new Error('private-raw-message'),
      url: 'https://private.test', fileName: 'private-backup.json',
      content: 'private-content', message: 'private-message'
    });
    await flush();
    expect(eventAt().properties).toMatchObject({ stage: 'input', error_code: 'invalid_url', error_type: 'unknown' });
    expect(JSON.stringify(eventAt())).not.toContain('private-');
    expect(localStorage.setItem.mock.calls).toEqual([['analytics_consent', 'true']]);
  });

  it('drops an import diagnostic if consent is revoked during role lookup', async () => {
    let resolveRole;
    service.OBR.player.getRole = () => new Promise(resolve => { resolveRole = resolve; });
    service.trackVaultImportFailed({ source: 'url', stage: 'fetch', errorCode: 'fetch_failed' });
    service.setConsent(false);
    resolveRole('GM');
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not queue an event without consent while initialization is pending', async () => {
    let finishInitialization;
    service.initializationTask = new Promise(resolve => { finishInitialization = resolve; });
    service.setConsent(false);
    const pending = service.trackEvent('load_from_url_clicked');
    service.setConsent(true);
    finishInitialization();
    await pending;
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not fall back to an image request after consent is revoked', async () => {
    let rejectRequest;
    const image = jest.spyOn(global, 'Image');
    global.fetch = jest.fn(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    service.trackVaultImportFailed({ source: 'url', stage: 'fetch' });
    await flush();
    service.setConsent(false);
    rejectRequest(new Error('private transport error'));
    await flush();
    expect(image).not.toHaveBeenCalled();
    image.mockRestore();
  });
});
