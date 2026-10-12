import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BETA_INFO_URL,
  BetaPromotionBanner,
  isBetaApplication
} from '../../../js/ui/BetaPromotionBanner.js';

function createBanner() {
  const analyticsService = {
    trackBetaBannerViewed: jest.fn(),
    trackBetaBannerClicked: jest.fn(),
    trackBetaBannerDismissed: jest.fn()
  };
  return {
    analyticsService,
    banner: new BetaPromotionBanner({ analyticsService })
  };
}

describe('BetaPromotionBanner', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.body.innerHTML = `
      <div class="container">
        <header id="header"></header>
        <div id="page-list"></div>
      </div>
    `;
  });

  it('muestra el aviso a un GM estable y registra la aparición', async () => {
    const { banner, analyticsService } = createBanner();

    await expect(banner.show({ isGM: true, userId: 'gm-1', isBeta: false }))
      .resolves.toBe(true);

    const element = document.getElementById('beta-promotion-banner');
    expect(element).not.toBeNull();
    expect(element.textContent).toContain('Try the new GM Vault beta!');
    expect(element.textContent).toContain(
      'Spend less time organizing and more time running the game: import your content and share images without breaking the flow.'
    );
    expect(element.textContent).toContain('Explore the beta');
    expect(element.classList.contains('cookie-consent-banner')).toBe(true);
    expect(document.body.lastElementChild).toBe(element);
    expect(analyticsService.trackBetaBannerViewed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('gm_vault_beta_banner_2_1_gm-1')))
      .toEqual({ dismissed: false, views: 1 });
  });

  it('no se muestra a Players, en beta ni en una vista modal', async () => {
    const player = createBanner();
    await expect(player.banner.show({ isGM: false, userId: 'player', isBeta: false }))
      .resolves.toBe(false);

    const beta = createBanner();
    await expect(beta.banner.show({ isGM: true, userId: 'gm-beta', isBeta: true }))
      .resolves.toBe(false);

    document.documentElement.classList.add('modal-mode');
    const modal = createBanner();
    await expect(modal.banner.show({ isGM: true, userId: 'gm-modal', isBeta: false }))
      .resolves.toBe(false);

    expect(document.getElementById('beta-promotion-banner')).toBeNull();
  });

  it('abre la página de novedades en otra pestaña y registra el clic', async () => {
    const { banner, analyticsService } = createBanner();
    await banner.show({ isGM: true, userId: 'gm-click', isBeta: false });

    const cta = document.querySelector('.beta-promotion-banner__cta');
    expect(cta.href).toBe(BETA_INFO_URL);
    expect(cta.target).toBe('_blank');
    expect(cta.rel).toContain('noopener');
    cta.dispatchEvent(new MouseEvent('click'));

    expect(analyticsService.trackBetaBannerClicked).toHaveBeenCalledTimes(1);
    expect(BETA_INFO_URL).toMatch(/^https:\/\/app\.notion\.com\//);
    expect(BETA_INFO_URL).not.toContain('deploy-preview');
  });

  it('espera a que se cierre el banner de cookies para no superponer avisos', async () => {
    const cookieBanner = document.createElement('div');
    cookieBanner.id = 'cookie-consent-banner';
    document.body.appendChild(cookieBanner);
    const { banner, analyticsService } = createBanner();

    await expect(banner.show({ isGM: true, userId: 'gm-consent', isBeta: false }))
      .resolves.toBe(false);
    expect(document.getElementById('beta-promotion-banner')).toBeNull();

    cookieBanner.remove();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('beta-promotion-banner')).not.toBeNull();
    expect(analyticsService.trackBetaBannerViewed).toHaveBeenCalledTimes(1);
  });

  it('stores Not now and does not show the notice to that user again', async () => {
    const first = createBanner();
    await first.banner.show({ isGM: true, userId: 'gm-dismiss', isBeta: false });
    document.querySelector('.beta-promotion-banner__dismiss').click();

    expect(first.analyticsService.trackBetaBannerDismissed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('gm_vault_beta_banner_2_1_gm-dismiss')))
      .toEqual({ dismissed: true, views: 1 });

    const second = createBanner();
    await expect(second.banner.show({ isGM: true, userId: 'gm-dismiss', isBeta: false }))
      .resolves.toBe(false);
  });

  it('limita a tres apariciones por usuario si se ignora el aviso', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const instance = createBanner();
      await expect(instance.banner.show({ isGM: true, userId: 'gm-limit', isBeta: false }))
        .resolves.toBe(true);
      instance.banner.remove();
    }

    const fourth = createBanner();
    await expect(fourth.banner.show({ isGM: true, userId: 'gm-limit', isBeta: false }))
      .resolves.toBe(false);
    expect(JSON.parse(localStorage.getItem('gm_vault_beta_banner_2_1_gm-limit')).views).toBe(3);
  });
});

describe('isBetaApplication', () => {
  it('reconoce el manifiesto beta aunque el hostname no lo indique', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'GM Vault Beta', version: '2.1.0-beta.2' })
    });

    await expect(isBetaApplication({
      locationRef: { hostname: 'example.netlify.app' },
      fetchFn
    })).resolves.toBe(true);
  });

  it('reconoce el manifiesto estable en producción', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'GM vault', version: '2.0.0' })
    });

    await expect(isBetaApplication({
      locationRef: { hostname: 'owlbear-gm-vault.netlify.app' },
      fetchFn
    })).resolves.toBe(false);
  });
});
