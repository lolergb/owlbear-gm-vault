const STORAGE_KEY_PREFIX = 'gm_vault_beta_banner_2_1_';
const MAX_VIEWS = 3;

export const BETA_INFO_URL = 'https://app.notion.com/p/Quick-Start-Beta-3b8d4856c90e8092aa7fd83915f6e55e?source=copy_link';

function isBetaHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized.includes('deploy-preview') ||
    normalized.startsWith('develop--') ||
    normalized.includes('beta');
}

export async function isBetaApplication({
  locationRef = window.location,
  fetchFn = globalThis.fetch
} = {}) {
  if (isBetaHostname(locationRef?.hostname)) return true;

  try {
    const response = await fetchFn('/manifest.json', { cache: 'no-store' });
    if (!response?.ok) {
      return locationRef?.hostname !== 'owlbear-gm-vault.netlify.app';
    }

    const manifest = await response.json();
    return /beta/i.test(String(manifest?.name || '')) ||
      /beta/i.test(String(manifest?.version || ''));
  } catch (_error) {
    // The known production hostname is safe. Unknown hosts fail closed so a
    // beta or preview deployment never promotes itself if its manifest fails.
    return locationRef?.hostname !== 'owlbear-gm-vault.netlify.app';
  }
}

export class BetaPromotionBanner {
  constructor({ analyticsService, storage = localStorage, documentRef = document } = {}) {
    this.analyticsService = analyticsService;
    this.storage = storage;
    this.document = documentRef;
    this.element = null;
    this.storageKey = null;
    this.cookieBannerObserver = null;
    this.pendingShowOptions = null;
  }

  _getStorageKey(userId) {
    const normalizedUserId = String(userId || 'anonymous');
    return `${STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedUserId)}`;
  }

  _readState() {
    try {
      const parsed = JSON.parse(this.storage.getItem(this.storageKey) || '{}');
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

  async show({ isGM, userId, isBeta } = {}) {
    if (!isGM || this.element || this.document.getElementById('beta-promotion-banner')) {
      return false;
    }

    if (this.document.documentElement.classList.contains('modal-mode')) return false;

    // Reuse the cookie-banner placement without stacking two fixed notices.
    // If consent is still pending, show this message as soon as that banner is gone.
    if (this.document.getElementById('cookie-consent-banner')) {
      this._waitForCookieBanner({ isGM, userId, isBeta });
      return false;
    }

    const runningInBeta = typeof isBeta === 'boolean'
      ? isBeta
      : await isBetaApplication();
    if (runningInBeta) return false;

    this.storageKey = this._getStorageKey(userId);
    const state = this._readState();
    if (!state || state.dismissed || state.views >= MAX_VIEWS) return false;

    const nextState = { ...state, views: state.views + 1 };
    if (!this._writeState(nextState)) return false;

    const banner = this.document.createElement('aside');
    banner.id = 'beta-promotion-banner';
    banner.className = 'cookie-consent-banner beta-promotion-banner';
    banner.setAttribute('aria-labelledby', 'beta-promotion-title');
    banner.innerHTML = `
      <div class="cookie-consent-content">
        <p class="cookie-consent-text beta-promotion-banner__copy">
          <strong id="beta-promotion-title" class="beta-promotion-banner__title">Try the new GM Vault beta!</strong>
          <span class="beta-promotion-banner__description">Spend less time organizing and more time running the game: import your content and share images without breaking the flow.</span>
        </p>
        <div class="cookie-consent-actions beta-promotion-banner__actions">
          <a class="btn btn--primary btn--sm beta-promotion-banner__cta"
             href="${BETA_INFO_URL}"
             target="_blank"
             rel="noopener noreferrer">Explore the beta</a>
          <button type="button" class="btn btn--ghost btn--sm beta-promotion-banner__dismiss">Not now</button>
        </div>
      </div>
    `;

    banner.querySelector('.beta-promotion-banner__cta')?.addEventListener('click', () => {
      this.analyticsService?.trackBetaBannerClicked?.();
    });
    banner.querySelector('.beta-promotion-banner__dismiss')?.addEventListener('click', () => {
      this.dismiss();
    });

    this.document.body.appendChild(banner);

    this.element = banner;
    this.analyticsService?.trackBetaBannerViewed?.();
    return true;
  }

  _waitForCookieBanner(options) {
    this.pendingShowOptions = options;
    if (this.cookieBannerObserver || typeof MutationObserver === 'undefined') return;

    this.cookieBannerObserver = new MutationObserver(() => {
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
    if (!this.element || !this.storageKey) return false;

    const state = this._readState();
    if (state) this._writeState({ ...state, dismissed: true });
    this.analyticsService?.trackBetaBannerDismissed?.();
    this.remove();
    return true;
  }

  remove() {
    this.cookieBannerObserver?.disconnect();
    this.cookieBannerObserver = null;
    this.pendingShowOptions = null;
    this.element?.remove();
    this.element = null;
  }
}

export default BetaPromotionBanner;
