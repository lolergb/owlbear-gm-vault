import { describe, expect, it, jest } from '@jest/globals';
import { TextEncoder } from 'node:util';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';

global.TextEncoder = TextEncoder;

function decodeMixpanelRequest(request) {
  const body = new URLSearchParams(request.body);
  return JSON.parse(atob(body.get('data')))[0];
}

describe('AnalyticsService beta banner events', () => {
  it.each([
    ['trackBetaBannerViewed', 'beta_banner_viewed'],
    ['trackBetaBannerClicked', 'beta_banner_clicked'],
    ['trackBetaBannerDismissed', 'beta_banner_dismissed']
  ])('envía %s con el contexto habitual', async (method, eventName) => {
    const service = new AnalyticsService();
    service.setOBR({
      player: { getRole: jest.fn().mockResolvedValue('GM') }
    });
    service.mixpanelEnabled = true;
    service.mixpanelToken = 'test-token';
    service.mixpanelDistinctId = 'gm-1';
    service.environment = 'production';
    service.deployContext = 'production';
    service.isBeta = false;
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1 })
    });

    await service[method]();

    expect(fetch).toHaveBeenCalledTimes(1);
    const event = decodeMixpanelRequest(fetch.mock.calls[0][1]);
    expect(event.event).toBe(eventName);
    expect(event.properties).toEqual(expect.objectContaining({
      environment: 'production',
      deploy_context: 'production',
      role: 'GM',
      is_beta: false
    }));
  });
});
