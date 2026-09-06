/** A persistent starting point until the GM creates or loads vault content. */
export class VaultEmptyState {
  constructor({ analyticsService } = {}) {
    this.analyticsService = analyticsService;
    this.element = null;
    this.viewTracked = false;
  }

  show({ container, canShow, onAddPage, onLoadExamples } = {}) {
    if (!container || !canShow?.() || document.documentElement.classList.contains('modal-mode')) return false;
    if (this.element?.isConnected) {
      this._trackView();
      return true;
    }
    this.remove();
    const section = document.createElement('section');
    section.className = 'vault-empty-state';
    section.setAttribute('aria-labelledby', 'vault-empty-title');
    section.innerHTML = `
      <div class="vault-empty-state__hint">
        <p class="vault-empty-state__hint-text">Add pages, folders, and more</p>
        <svg class="vault-empty-state__hint-arrow" viewBox="0 0 96 100" aria-hidden="true" focusable="false">
          <path d="M4 94C54 92 86 63 86 8M76 19L86 8L95 19"/>
        </svg>
      </div>
      <div class="vault-empty-state__content">
        <img class="vault-empty-state__image" src="/img/image-modal.png" width="643" height="360" alt="">
        <h2 id="vault-empty-title" class="vault-empty-state__title">Your next session starts here</h2>
        <p class="vault-empty-state__description">Add links to Notion pages, PDFs, images, and videos. <a class="vault-empty-state__guide" href="https://solid-jingle-6ee.notion.site/Quick-Start-Beta-3b8d4856c90e8092aa7fd83915f6e55e?source=copy_link" target="_blank" rel="noopener noreferrer" aria-label="Quick start guide (opens in a new tab)">Quick start guide</a></p>
        <div class="vault-empty-state__actions">
          <button type="button" class="vault-empty-state__button vault-empty-state__example">Load example vault</button>
          <button type="button" class="vault-empty-state__button vault-empty-state__add">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v16M4 12h16"/></svg>
            Add page
          </button>
        </div>
        <p class="vault-empty-state__error" role="alert" hidden></p>
      </div>
    `;
    this.element = section;
    this.container = container;
    container.replaceChildren(section);
    container.classList.add('page-list--empty');
    this._watchActionLayout();

    // Keep the original banner above the UI and reserve scrollable space for it.
    this.consentBanner = document.getElementById('cookie-consent-banner');
    if (this.consentBanner) {
      this.onConsentChanged = () => {
        this.consentResizeObserver?.disconnect();
        section.style.removeProperty('--empty-state-consent-height');
        this._trackView();
      };
      this.consentBanner.addEventListener('analytics-consent-changed', this.onConsentChanged);
      if (typeof ResizeObserver !== 'undefined') {
        this.consentResizeObserver = new ResizeObserver(() => this._reserveConsentSpace());
        this.consentResizeObserver.observe(this.consentBanner);
      }
      this._reserveConsentSpace();
    }

    const primary = section.querySelector('.vault-empty-state__add');
    const example = section.querySelector('.vault-empty-state__example');
    const error = section.querySelector('.vault-empty-state__error');
    primary.addEventListener('click', () => {
      if (!canShow()) return;
      this._trackAction('add_page');
      onAddPage?.();
    });
    example.addEventListener('click', async () => {
      if (!canShow() || example.disabled) return;
      this._trackAction('load_examples');
      primary.disabled = example.disabled = true;
      example.textContent = 'Loading example…';
      example.setAttribute('aria-busy', 'true');
      error.hidden = true;
      try {
        await onLoadExamples?.();
      } catch (cause) {
        error.textContent = cause?.message || 'The example vault could not be loaded. Try again.';
        error.hidden = false;
      } finally {
        primary.disabled = example.disabled = false;
        example.textContent = 'Load example vault';
        example.removeAttribute('aria-busy');
      }
    });
    this._trackView();
    return true;
  }

  _watchActionLayout() {
    if (!window.matchMedia) return;
    const actions = this.element.querySelector('.vault-empty-state__actions');
    const primary = actions.querySelector('.vault-empty-state__add');
    // Keep DOM/tab order aligned with the matching CSS breakpoint.
    this.actionLayout = window.matchMedia('(max-width: 380px)');
    this.onActionLayoutChanged = () => {
      const stacked = this.actionLayout.matches;
      if ((stacked ? actions.firstElementChild : actions.lastElementChild) === primary) return;
      const focused = document.activeElement;
      if (stacked) actions.prepend(primary);
      else actions.append(primary);
      if (focused === primary) primary.focus({ preventScroll: true });
    };
    this.actionLayout.addEventListener('change', this.onActionLayoutChanged);
    this.onActionLayoutChanged();
  }

  _trackView() {
    if (!this.element?.isConnected || this.container?.classList.contains('hidden') ||
        document.getElementById('modal-overlay') || this.viewTracked ||
        this.analyticsService?.getConsent?.() !== true) return;
    this.viewTracked = true;
    this.analyticsService.trackEvent?.('vault_empty_viewed');
  }

  _trackAction(action) {
    if (this.analyticsService?.getConsent?.() === true) {
      this.analyticsService.trackEvent?.('vault_empty_action', { action });
    }
  }

  _reserveConsentSpace() {
    if (!this.element || !this.consentBanner?.isConnected) return;
    this.element.style.setProperty('--empty-state-consent-height',
      `${Math.ceil(this.consentBanner.getBoundingClientRect().height)}px`);
  }

  focusPrimary() {
    this._trackView();
    this.element?.querySelector('.vault-empty-state__add')?.focus({ preventScroll: true });
  }

  remove() {
    this.actionLayout?.removeEventListener('change', this.onActionLayoutChanged);
    this.actionLayout = null;
    this.onActionLayoutChanged = null;
    this.consentResizeObserver?.disconnect();
    this.consentResizeObserver = null;
    this.consentBanner?.removeEventListener('analytics-consent-changed', this.onConsentChanged);
    this.consentBanner = null;
    this.onConsentChanged = null;
    this.element?.remove();
    this.container?.classList.remove('page-list--empty');
    this.element = null;
    this.container = null;
  }
}
