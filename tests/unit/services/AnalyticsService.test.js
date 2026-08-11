import { describe, expect, it, jest } from '@jest/globals';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';

function createService() {
  const service = new AnalyticsService();
  service.trackEvent = jest.fn();
  return service;
}

describe('AnalyticsService beta events', () => {
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
