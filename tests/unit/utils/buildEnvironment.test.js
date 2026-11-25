import { describe, expect, it, jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';

describe('compiled public environment', () => {
  it.each([
    [{ debug: false, isBeta: false, context: 'production' }, false],
    [{ debug: true, isBeta: true, context: 'deploy-preview' }, true]
  ])('uses build metadata without debug or manifest requests: %j', async (environment, beta) => {
    jest.resetModules();
    jest.unstable_mockModule(fileURLToPath(new URL('../../../js/config/buildEnvironment.js', import.meta.url)),
      () => ({ BUILD_ENVIRONMENT: environment }));
    const { initDebugMode, isDebugMode } = await import('../../../js/utils/logger.js');
    const { isBetaApplication } = await import('../../../js/ui/BetaPromotionBanner.js');
    await initDebugMode();
    expect(isDebugMode()).toBe(environment.debug);
    expect(await isBetaApplication({ locationRef: { hostname: 'owlbear-gm-vault.netlify.app' } })).toBe(beta);
    expect(await isBetaApplication({ locationRef: { hostname: 'develop--owlbear-gm-vault.netlify.app' } })).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
