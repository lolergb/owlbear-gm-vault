const STORAGE_KEY_PREFIX = 'gm_vault_announcement_';
const BANNER_ID = 'gm-vault-announcement-banner';
const VALID_ROLES = new Set(['GM', 'PLAYER']);
const VALID_VARIANTS = new Set(['primary', 'ghost']);

function normalizeText(value, maxLength) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

export function normalizeAnnouncementCampaign(campaign) {
  if (!campaign || typeof campaign !== 'object') return null;

  const id = normalizeText(campaign.id, 80);
  const version = normalizeText(campaign.version, 40);
  const title = normalizeText(campaign.title, 160);
  const message = normalizeText(campaign.message, 600);
  const roles = Array.isArray(campaign.audience?.roles)
    ? [...new Set(campaign.audience.roles.filter(role => VALID_ROLES.has(role)))]
    : [];
  const maxViews = Number.isInteger(campaign.maxViews) && campaign.maxViews > 0
    ? Math.min(campaign.maxViews, 20)
    : null;

  if (!id || !version || !title || !message || roles.length === 0 || !maxViews) {
    return null;
  }

  const actions = Array.isArray(campaign.actions)
    ? campaign.actions.slice(0, 3).map(action => {
      const actionId = normalizeText(action?.id, 80);
      const label = normalizeText(action?.label, 100);
      const url = normalizeUrl(action?.url);
      if (!actionId || !label || !url) return null;
      return {
        id: actionId,
        label,
        url,
        variant: VALID_VARIANTS.has(action.variant) ? action.variant : 'ghost'
      };
    }).filter(Boolean)
    : [];

  return {
    id,
    version,
    audience: { roles },
    title,
    message,
    maxViews,
    dismissLabel: normalizeText(campaign.dismissLabel, 100) || 'Dismiss',
    actions
  };
}

export class AnnouncementBanner {
  constructor({
    analyticsService,
    storage = localStorage,
    documentRef = document,
    mutationObserverClass = globalThis.MutationObserver
  } = {}) {
    this.analyticsService = analyticsService;
    this.storage = storage;
    this.document = documentRef;
    this.MutationObserverClass = mutationObserverClass;
    this.element = null;
    this.storageKey = null;
    this.campaign = null;
    this.role = null;
    this.cookieBannerObserver = null;
    this.pendingShowOptions = null;
  }

  _getStorageKey(campaign, userId) {
    return [
      STORAGE_KEY_PREFIX,
      encodeURIComponent(campaign.id),
      '_v',
      encodeURIComponent(campaign.version),
      '_',
      encodeURIComponent(userId)
    ].join('');
  }

  _readState() {
    try {
      const stored = this.storage.getItem(this.storageKey);
      if (!stored) return { dismissed: false, views: 0 };
      const parsed = JSON.parse(stored);
      return {
        dismissed: parsed.dismissed === true,
        views: Number.isInteger(parsed.views) && parsed.views >= 0 ? parsed.views : 0
      };
    } catch (_error) {
      return null;
    }
  }

  _writeState(state) {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state));
      return true;
    } catch (_error) {
      return false;
    }
  }

  show({ campaign, role, userId } = {}) {
    const normalizedCampaign = normalizeAnnouncementCampaign(campaign);
    const normalizedUserId = normalizeText(userId, 200);

    if (!normalizedCampaign || !normalizedUserId || !VALID_ROLES.has(role)) return false;
    if (!normalizedCampaign.audience.roles.includes(role)) return false;
    if (this.element || this.document.getElementById(BANNER_ID)) return false;
    if (this.document.documentElement.classList.contains('modal-mode')) return false;

    if (this.document.getElementById('cookie-consent-banner')) {
      this._waitForCookieBanner({ campaign, role, userId });
      return false;
    }

    this.campaign = normalizedCampaign;
    this.role = role;
    this.storageKey = this._getStorageKey(normalizedCampaign, normalizedUserId);
    const state = this._readState();
    if (!state || state.dismissed || state.views >= normalizedCampaign.maxViews) return false;

    if (!this._writeState({ ...state, views: state.views + 1 })) return false;

    const banner = this._createElement(normalizedCampaign);
    this.document.body.appendChild(banner);
    this.element = banner;
    this.analyticsService?.trackAnnouncementViewed?.({
      campaignId: normalizedCampaign.id,
      campaignVersion: normalizedCampaign.version,
      role
    });
    return true;
  }

  _createElement(campaign) {
    const banner = this.document.createElement('aside');
    banner.id = BANNER_ID;
    banner.className = 'cookie-consent-banner announcement-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-labelledby', `${BANNER_ID}-title`);

    const content = this.document.createElement('div');
    content.className = 'cookie-consent-content';

    const copy = this.document.createElement('div');
    copy.className = 'cookie-consent-text announcement-banner__copy';

    const title = this.document.createElement('strong');
    title.id = `${BANNER_ID}-title`;
    title.className = 'announcement-banner__title';
    title.textContent = campaign.title;

    const message = this.document.createElement('p');
    message.className = 'announcement-banner__message';
    message.textContent = campaign.message;

    copy.append(title, message);

    const actions = this.document.createElement('div');
    actions.className = 'cookie-consent-actions announcement-banner__actions';

    const dismissButton = this.document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'btn btn--ghost announcement-banner__dismiss';
    dismissButton.textContent = campaign.dismissLabel;
    dismissButton.addEventListener('click', () => this.dismiss());
    actions.appendChild(dismissButton);

    // Keep secondary actions first and the primary action on the right.
    const orderedActions = [...campaign.actions].sort((a, b) =>
      Number(a.variant === 'primary') - Number(b.variant === 'primary'));
    orderedActions.forEach(action => {
      const link = this.document.createElement('a');
      link.className = `btn btn--${action.variant} announcement-banner__action`;
      link.href = action.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = action.label;
      link.addEventListener('click', () => {
        this.analyticsService?.trackAnnouncementAction?.({
          campaignId: campaign.id,
          campaignVersion: campaign.version,
          actionId: action.id,
          role: this.role
        });
      });
      actions.appendChild(link);
    });

    content.append(copy, actions);
    banner.appendChild(content);
    return banner;
  }

  _waitForCookieBanner(options) {
    this.pendingShowOptions = options;
    if (this.cookieBannerObserver || !this.MutationObserverClass) return;

    this.cookieBannerObserver = new this.MutationObserverClass(() => {
      if (this.document.getElementById('cookie-consent-banner')) return;

      const pendingOptions = this.pendingShowOptions;
      this.cookieBannerObserver.disconnect();
      this.cookieBannerObserver = null;
      this.pendingShowOptions = null;
      if (pendingOptions) this.show(pendingOptions);
    });
    this.cookieBannerObserver.observe(this.document.body, { childList: true });
  }

  dismiss() {
    if (!this.element || !this.storageKey || !this.campaign) return false;

    const state = this._readState();
    if (state) this._writeState({ ...state, dismissed: true });
    this.analyticsService?.trackAnnouncementDismissed?.({
      campaignId: this.campaign.id,
      campaignVersion: this.campaign.version,
      role: this.role
    });
    this.remove();
    return true;
  }

  remove() {
    this.cookieBannerObserver?.disconnect();
    this.cookieBannerObserver = null;
    this.pendingShowOptions = null;
    this.element?.remove();
    this.element = null;
    this.storageKey = null;
    this.campaign = null;
    this.role = null;
  }
}

export default AnnouncementBanner;
