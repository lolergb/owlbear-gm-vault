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
    expect(first.properties).toMatchObject({ operation: 'runtime', error_type: 'TypeError', error_code: 'unknown', error_source: 'global', error_fingerprint: 'runtime:TypeError:unknown', app_version: '2.1.4', environment: 'beta', deploy_context: 'deploy-preview', role: 'GM', vault_state: 'configured' });
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
    expect(eventAt(1).properties).toMatchObject({ operation: 'import', error_source: 'handled', error_code: 'read', source: 'file' });
    expect(JSON.stringify(eventAt(0))).not.toContain('private token');
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
});
