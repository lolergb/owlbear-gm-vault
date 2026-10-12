import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

function createController({ getRole, analyticsReady = Promise.resolve() }) {
  const controller = Object.create(ExtensionController.prototype);
  controller.OBR = { player: { getRole } };
  controller.playerId = 'gm-1';
  controller.analyticsInitPromise = analyticsReady;
  controller.betaPromotionCancelled = false;
  controller.betaPromotionTask = null;
  controller.betaPromotionBanner = {
    show: jest.fn().mockResolvedValue(true)
  };
  return controller;
}

describe('ExtensionController beta promotion scheduling', () => {
  it('fails closed when Owlbear cannot verify the GM role', async () => {
    const controller = createController({
      getRole: jest.fn().mockRejectedValue(new Error('role unavailable'))
    });

    await expect(controller._showBetaPromotion()).resolves.toBe(false);
    expect(controller.betaPromotionBanner.show).not.toHaveBeenCalled();
  });

  it('never shows the banner to a confirmed Player', async () => {
    const controller = createController({
      getRole: jest.fn().mockResolvedValue('PLAYER')
    });

    await expect(controller._showBetaPromotion()).resolves.toBe(false);
    expect(controller.betaPromotionBanner.show).not.toHaveBeenCalled();
  });

  it('waits for analytics in the background without blocking the caller', async () => {
    let resolveAnalytics;
    const analyticsReady = new Promise(resolve => {
      resolveAnalytics = resolve;
    });
    const controller = createController({
      getRole: jest.fn().mockResolvedValue('GM'),
      analyticsReady
    });

    expect(controller._scheduleBetaPromotion()).toBeUndefined();
    await Promise.resolve();
    expect(controller.betaPromotionBanner.show).not.toHaveBeenCalled();

    resolveAnalytics();
    await expect(controller.betaPromotionTask).resolves.toBe(true);
    expect(controller.betaPromotionBanner.show).toHaveBeenCalledWith({
      isGM: true,
      userId: 'gm-1'
    });
  });

  it('does not show a delayed banner after cleanup cancels it', async () => {
    let resolveAnalytics;
    const analyticsReady = new Promise(resolve => {
      resolveAnalytics = resolve;
    });
    const controller = createController({
      getRole: jest.fn().mockResolvedValue('GM'),
      analyticsReady
    });

    controller._scheduleBetaPromotion();
    await Promise.resolve();
    controller.betaPromotionCancelled = true;
    resolveAnalytics();

    await expect(controller.betaPromotionTask).resolves.toBe(false);
    expect(controller.betaPromotionBanner.show).not.toHaveBeenCalled();
  });
});
