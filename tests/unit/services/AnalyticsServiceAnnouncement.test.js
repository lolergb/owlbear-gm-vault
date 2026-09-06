import { describe, expect, it, jest } from '@jest/globals';
import { AnalyticsService } from '../../../js/services/AnalyticsService.js';

describe('AnalyticsService announcement events', () => {
  it('tracks campaign lifecycle using controlled metadata', () => {
    const service = new AnalyticsService();
    service.trackEvent = jest.fn();

    service.trackAnnouncementViewed({
      campaignId: 'release-update',
      campaignVersion: 2,
      role: 'GM'
    });
    service.trackAnnouncementAction({
      campaignId: 'release-update',
      campaignVersion: 2,
      actionId: 'read-more',
      role: 'GM'
    });
    service.trackAnnouncementDismissed({
      campaignId: 'release-update',
      campaignVersion: 2,
      role: 'GM'
    });

    expect(service.trackEvent).toHaveBeenNthCalledWith(1, 'announcement_viewed', {
      campaign_id: 'release-update',
      campaign_version: '2',
      role: 'GM'
    });
    expect(service.trackEvent).toHaveBeenNthCalledWith(2, 'announcement_action_clicked', {
      campaign_id: 'release-update',
      campaign_version: '2',
      action_id: 'read-more',
      role: 'GM'
    });
    expect(service.trackEvent).toHaveBeenNthCalledWith(3, 'announcement_dismissed', {
      campaign_id: 'release-update',
      campaign_version: '2',
      role: 'GM'
    });
  });
});
