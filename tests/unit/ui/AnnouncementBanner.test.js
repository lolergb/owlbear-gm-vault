import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AnnouncementBanner,
  normalizeAnnouncementCampaign
} from '../../../js/ui/AnnouncementBanner.js';

const CAMPAIGN = {
  id: 'release-update',
  version: 2,
  audience: { roles: ['GM'] },
  title: 'A product update',
  message: 'A concise explanation of the changes available now.',
  maxViews: 2,
  dismissLabel: 'Got it',
  actions: [{
    id: 'read-more',
    label: 'Read more',
    url: 'https://example.com/changelog',
    variant: 'primary'
  }]
};

function createBanner() {
  const analyticsService = {
    trackAnnouncementViewed: jest.fn(),
    trackAnnouncementAction: jest.fn(),
    trackAnnouncementDismissed: jest.fn()
  };
  return {
    analyticsService,
    banner: new AnnouncementBanner({ analyticsService })
  };
}

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.body.innerHTML = '<main id="page-list"></main>';
  });

  it('renders nothing when there is no active campaign', () => {
    const { banner, analyticsService } = createBanner();

    expect(banner.show({ campaign: null, role: 'GM', userId: 'gm-1' })).toBe(false);

    expect(document.getElementById('gm-vault-announcement-banner')).toBeNull();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(analyticsService.trackAnnouncementViewed).not.toHaveBeenCalled();
  });

  it('renders a valid campaign for its configured audience', () => {
    const { banner, analyticsService } = createBanner();

    expect(banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-1' })).toBe(true);

    const element = document.getElementById('gm-vault-announcement-banner');
    expect(element).not.toBeNull();
    expect(element.getAttribute('role')).toBe('status');
    expect(element.textContent).toContain(CAMPAIGN.title);
    expect(element.textContent).toContain(CAMPAIGN.message);
    expect(element.querySelector('.announcement-banner__action').href)
      .toBe('https://example.com/changelog');
    expect(element.querySelector('.announcement-banner__action').target).toBe('_blank');
    expect(analyticsService.trackAnnouncementViewed).toHaveBeenCalledWith({
      campaignId: 'release-update',
      campaignVersion: '2',
      role: 'GM'
    });
    expect(JSON.parse(localStorage.getItem(
      'gm_vault_announcement_release-update_v2_gm-1'
    ))).toEqual({ dismissed: false, views: 1 });
  });

  it('fails closed for unknown or excluded roles', () => {
    const unknown = createBanner();
    const player = createBanner();

    expect(unknown.banner.show({ campaign: CAMPAIGN, userId: 'unknown' })).toBe(false);
    expect(player.banner.show({ campaign: CAMPAIGN, role: 'PLAYER', userId: 'player' }))
      .toBe(false);
    expect(document.getElementById('gm-vault-announcement-banner')).toBeNull();
  });

  it('persists dismissal per campaign version and user', () => {
    const first = createBanner();
    first.banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-dismiss' });
    document.querySelector('.announcement-banner__dismiss').click();

    expect(first.analyticsService.trackAnnouncementDismissed).toHaveBeenCalledWith({
      campaignId: 'release-update',
      campaignVersion: '2',
      role: 'GM'
    });

    const second = createBanner();
    expect(second.banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-dismiss' }))
      .toBe(false);
  });

  it('honors the configured view limit', () => {
    for (let attempt = 0; attempt < CAMPAIGN.maxViews; attempt += 1) {
      const instance = createBanner();
      expect(instance.banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-limit' }))
        .toBe(true);
      instance.banner.remove();
    }

    const next = createBanner();
    expect(next.banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-limit' }))
      .toBe(false);
  });

  it('tracks optional actions without exposing their destination', () => {
    const { banner, analyticsService } = createBanner();
    banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-action' });

    document.querySelector('.announcement-banner__action')
      .dispatchEvent(new MouseEvent('click'));

    expect(analyticsService.trackAnnouncementAction).toHaveBeenCalledWith({
      campaignId: 'release-update',
      campaignVersion: '2',
      actionId: 'read-more',
      role: 'GM'
    });
  });

  it('waits for cookie consent and cleanup cancels the pending render', async () => {
    const cookieBanner = document.createElement('div');
    cookieBanner.id = 'cookie-consent-banner';
    document.body.appendChild(cookieBanner);
    const { banner } = createBanner();

    expect(banner.show({ campaign: CAMPAIGN, role: 'GM', userId: 'gm-cookie' }))
      .toBe(false);
    banner.remove();
    cookieBanner.remove();
    await Promise.resolve();

    expect(document.getElementById('gm-vault-announcement-banner')).toBeNull();
  });

  it('rejects incomplete campaigns and unsafe action URLs', () => {
    expect(normalizeAnnouncementCampaign({ ...CAMPAIGN, audience: { roles: [] } }))
      .toBeNull();

    const normalized = normalizeAnnouncementCampaign({
      ...CAMPAIGN,
      actions: [{ id: 'unsafe', label: 'Unsafe', url: 'javascript:alert(1)' }]
    });
    expect(normalized.actions).toEqual([]);
  });
});
