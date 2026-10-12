/** @jest-environment-options {"url":"https://deploy-preview-10--owlbear-gm-vault.netlify.app"} */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';
import { VaultEmptyState } from '../../../js/ui/VaultEmptyState.js';

let analytics;
let emptyState;
let resolveToken;
let events;
const flushEvents = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '<div id="page-list"></div>';
  document.documentElement.className = '';
  events = [];
  const tokenResponse = new Promise(resolve => { resolveToken = resolve; });
  global.fetch = jest.fn((url, options) => {
    if (url === '/.netlify/functions/get-mixpanel-token') return tokenResponse;
    const payload = new URLSearchParams(options.body).get('data');
    events.push(...JSON.parse(atob(payload)));
    return Promise.resolve({ ok: true, json: async () => ({ status: 1 }) });
  });
  analytics = new AnalyticsService();
  analytics.setOBR({ player: {
    getId: jest.fn().mockResolvedValue('gm-1'),
    getRole: jest.fn().mockResolvedValue('GM')
  } });
  analytics.setVaultContext({ roomId: 'room-1', vaultState: 'empty' });
  emptyState = new VaultEmptyState({ analyticsService: analytics });
});

afterEach(() => {
  emptyState.remove();
  document.body.innerHTML = '<div id="page-list"></div>';
});

async function showEmptyState() {
  await analytics.init();
  emptyState.show({ container: document.getElementById('page-list'), canShow: () => true, onLoadExamples: () => emptyState.remove() });
  expect(document.querySelector('.vault-empty-state')).not.toBeNull();
  expect(document.getElementById('cookie-consent-banner').parentElement).toBe(document.body);
  expect(global.fetch).not.toHaveBeenCalled();
}

async function showEmptyStateAfterConsent(choice = 'accept') {
  await showEmptyState();
  document.getElementById(`cookie-${choice}`).click();
  expect(document.querySelector('.vault-empty-state')).not.toBeNull();
  expect(document.getElementById('cookie-consent-banner')).toBeNull();
}

function enableMixpanel() {
  resolveToken({ ok: true, json: async () => ({
    enabled: true, token: 'test-token', environment: 'beta', deployContext: 'deploy-preview'
  }) });
}

describe('Empty-state analytics after first-time consent', () => {
  it('keeps the emptyState usable and sends its view and action after initialization', async () => {
    await showEmptyStateAfterConsent();
    document.querySelector('.vault-empty-state__example').click();
    expect(document.querySelector('.vault-empty-state')).toBeNull();
    expect(events).toEqual([]);

    enableMixpanel();
    await flushEvents();

    expect(events.map(event => event.event)).toEqual(expect.arrayContaining([
      'extension_opened', 'vault_empty_viewed', 'vault_empty_action'
    ]));
    expect(events).toHaveLength(3);
    expect(events.find(event => event.event === 'vault_empty_action').properties.action).toBe('load_examples');
    for (const event of events) {
      expect(event.properties).toMatchObject({
        distinct_id: 'gm-1', role: 'GM', environment: 'beta', vault_state: 'empty'
      });
    }
  });

  it('does not send anything when analytics is declined', async () => {
    await showEmptyStateAfterConsent('reject');
    document.querySelector('.vault-empty-state__add').click();
    await flushEvents();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(['.vault-empty-state__example'])(
    'never sends prior emptyState events when accepting after %s', async selector => {
      await showEmptyState();
      document.querySelector(selector).click();
      expect(document.querySelector('.vault-empty-state')).toBeNull();
      expect(document.getElementById('cookie-consent-banner').parentElement).toBe(document.body);
      expect(analytics.getConsent()).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();

      document.getElementById('cookie-accept').click();
      enableMixpanel();
      await flushEvents();
      expect(events.map(event => event.event)).toEqual(['extension_opened']);
    }
  );

  it('leaves the emptyState usable when the analytics endpoint is unavailable', async () => {
    await showEmptyStateAfterConsent();
    resolveToken({ ok: false });
    await flushEvents();
    expect(events).toEqual([]);
    document.querySelector('.vault-empty-state__add').click();
    expect(document.querySelector('.vault-empty-state')).not.toBeNull();
  });

  it('keeps the first-content milestone once if content is saved during initialization', async () => {
    await showEmptyStateAfterConsent();
    const metadata = { creationMethod: 'manual', pageType: 'image' };
    analytics.trackFirstUserContentCreated(metadata);
    analytics.trackFirstUserContentCreated(metadata);
    enableMixpanel();
    await flushEvents();

    const milestones = events.filter(event => event.event === 'first_user_content_created');
    expect(milestones).toHaveLength(1);
    expect(milestones[0].properties).toMatchObject({
      creation_method: 'manual', page_type: 'image', content_origin: 'user', vault_state: 'configured'
    });
  });
});
