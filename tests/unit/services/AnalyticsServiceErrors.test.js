import { BUILD_VERSION } from '../../../js/utils/buildVersion.js';
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

  it('counts the same consenting GM across reloads and stages without exposing their account ID', async () => {
    service.OBR.player.id = 'owlbear-private-account';
    await service.trackPrivateBackupAdoption('settings_option_viewed');
    const otherVisit = Object.assign(new AnalyticsService(), {
      OBR: service.OBR, mixpanelEnabled: true, mixpanelToken: 'project-token'
    });
    await otherVisit.trackPrivateBackupAdoption('sign_in_clicked');
    await otherVisit.trackPrivateBackupAdoption('backup_saved');
    const ids = [0, 1, 2].map(n => eventAt(n).properties.distinct_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^backup_gm_[a-f0-9]{64}$/);
    expect(eventAt(0).properties).toMatchObject({ role: 'GM', operation: 'adoption', step: 'settings_option_viewed' });
    expect(JSON.stringify(eventAt(0))).not.toMatch(/owlbear-private-account|private-player-id|private-vault-id|attempt_id/);
    service.OBR.player.id = 'another-gm';
    await service.trackPrivateBackupAdoption('backup_saved');
    expect(eventAt(3).properties.distinct_id).not.toBe(ids[0]);
    await service.trackPrivateBackupAdoption('unknown');
    service.OBR.player.getRole = async () => 'PLAYER';
    await service.trackPrivateBackupAdoption('backup_saved');
    service.setConsent(false);
    service.OBR.player.getRole = async () => 'GM';
    await service.trackPrivateBackupAdoption('settings_option_viewed');
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('sends versioned backup stages with a fresh attempt ID and only controlled values', async () => {
    const report = service.privateBackupReporter('save');
    await report('review', 'entered', false);
    await report('private backup name', 'failed', true, 'https://private.test/?otp=123456');
    await service.privateBackupReporter('restore')('select', 'cancelled', true);
    const first = eventAt(), failed = eventAt(1), next = eventAt(2);
    expect(first.event).toBe('private_backup_flow');
    expect(first.properties).toMatchObject({ step: 'review', outcome: 'entered', operation: 'save', terminal: false,
      sequence: 1, app_version: BUILD_VERSION, build_ref: 'unknown', environment: 'beta', deploy_context: 'deploy-preview' });
    expect(first.properties).not.toHaveProperty('error_code');
    expect(failed.properties).toMatchObject({ step: 'unknown', outcome: 'failed', terminal: true, error_code: 'unknown',
      sequence: 2, attempt_id: first.properties.attempt_id, distinct_id: first.properties.distinct_id });
    expect(next.properties).toMatchObject({ step: 'select', outcome: 'cancelled', operation: 'restore', sequence: 1 });
    expect(next.properties.attempt_id).not.toBe(first.properties.attempt_id);
    expect(JSON.stringify([first, failed, next])).not.toMatch(/private-player-id|private-vault-id|private backup name|private\.test|123456/);
  });

  it('requires consent at start and delivery, and ignores unrelated settings actions', async () => {
    expect(service.privateBackupReporter('undo')).toBeUndefined();
    expect(service.privateBackupReporter('signout')).toBeUndefined();
    const report = service.privateBackupReporter('restore');
    let resolveRole;
    service.OBR.player.getRole = () => new Promise(resolve => { resolveRole = resolve; });
    const pendingEvent = report('review', 'entered', false);
    service.setConsent(false);
    resolveRole('GM');
    await pendingEvent;
    expect(service.privateBackupReporter('save')).toBeUndefined();
    await report('review', 'cancelled', true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

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
    expect(first.properties).toMatchObject({ operation: 'runtime', error_type: 'TypeError', error_code: 'unknown', error_source: 'global', error_fingerprint: 'runtime:TypeError:unknown', app_version: BUILD_VERSION, environment: 'beta', deploy_context: 'deploy-preview', role: 'GM', vault_state: 'configured' });
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
