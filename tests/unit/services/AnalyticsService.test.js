import { describe, expect, it, jest } from '@jest/globals';
import { TextEncoder as NodeTextEncoder } from 'node:util';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';

function createService() {
  const service = new AnalyticsService();
  service.trackEvent = jest.fn();
  return service;
}

describe('AnalyticsService beta events', () => {
  it('adds deployment metadata to every Mixpanel payload', async () => {
    const originalFetch = global.fetch;
    const originalTextEncoder = global.TextEncoder;
    global.TextEncoder = NodeTextEncoder;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1 })
    });
    const service = new AnalyticsService();
    service.mixpanelEnabled = true;
    service.mixpanelToken = 'mixpanel-test-token';
    service.mixpanelDistinctId = 'player-1';
    service.environment = 'beta';
    service.deployContext = 'deploy-preview';
    service.OBR = {
      player: { getRole: jest.fn().mockResolvedValue('GM') }
    };

    try {
      await service.trackEvent('beta_test_event', { feature: 'imports' });

      const requestBody = global.fetch.mock.calls[0][1].body;
      const encodedPayload = new URLSearchParams(requestBody).get('data');
      const [event] = JSON.parse(atob(encodedPayload));
      expect(event.properties).toMatchObject({
        role: 'GM',
        feature: 'imports',
        environment: 'beta',
        deploy_context: 'deploy-preview'
      });
    } finally {
      global.fetch = originalFetch;
      if (originalTextEncoder) global.TextEncoder = originalTextEncoder;
      else delete global.TextEncoder;
    }
  });

  it('tracks completed imports with controlled properties only', () => {
    const service = createService();

    service.trackVaultImportCompleted({
      source: 'notion',
      mode: 'append',
      destinationType: 'folder',
      itemCount: 12.8,
      destinationName: 'Secret campaign'
    });

    expect(service.trackEvent).toHaveBeenCalledWith('vault_import_completed', {
      source: 'notion',
      mode: 'append',
      destination_type: 'folder',
      item_count: 12
    });
  });

  it('does not include the token-page query in search analytics', () => {
    const service = createService();

    service.trackTokenPageSearchUsed({
      queryLength: 7,
      resultCount: 2,
      totalCount: 18,
      query: 'Goblin'
    });

    expect(service.trackEvent).toHaveBeenCalledWith('token_page_search_used', {
      query_length: 7,
      result_count: 2,
      total_count: 18
    });
  });

  it('tracks the complete image delivery outcome', () => {
    const service = createService();

    service.trackImageShareResult({
      phase: 'complete',
      total: 4,
      loaded: 2,
      failed: 1,
      missing: 1,
      loading: 0,
      shareId: 'private-share-id'
    });

    expect(service.trackEvent).toHaveBeenCalledWith('image_share_completed', {
      phase: 'complete',
      recipient_count: 4,
      delivered_count: 2,
      failed_count: 1,
      unresolved_count: 1
    });
  });

  it('tracks safe page creation metadata without forwarding the full URL', () => {
    const service = createService();

    service.trackPageAdded('Campaign notes', 'onedrive', {
      url: 'https://1drv.ms/w/c/private-document-id?secret=do-not-send',
      creationMethod: 'manual',
      isEmbedCode: true
    });

    expect(service.trackEvent).toHaveBeenCalledWith('page_added', {
      page_name: 'Campaign notes',
      page_type: 'onedrive',
      url_domain: '1drv.ms',
      embed_provider: 'onedrive',
      creation_method: 'manual',
      is_embed_code: true
    });
    expect(JSON.stringify(service.trackEvent.mock.calls[0])).not.toContain('private-document-id');
    expect(JSON.stringify(service.trackEvent.mock.calls[0])).not.toContain('do-not-send');
  });

  it('normalizes unexpected values instead of forwarding arbitrary content', () => {
    const service = createService();

    service.trackVaultImportFailed({
      source: 'https://private.example/vault.json',
      stage: 'custom-stage',
      mode: 'custom-mode',
      destinationType: 'Secret campaign',
      errorType: 'TypeError'
    });

    expect(service.trackEvent).toHaveBeenCalledWith('vault_import_failed', {
      source: 'unknown',
      stage: 'unknown',
      mode: 'unknown',
      destination_type: 'unknown',
      error_type: 'TypeError'
    });
  });
});
