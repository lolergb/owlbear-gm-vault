import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';

const CAMPAIGN = {
  id: 'release-update',
  version: 1,
  audience: { roles: ['GM'] },
  title: 'A product update',
  message: 'A concise explanation.',
  maxViews: 3
};

function createController(getRole = jest.fn().mockResolvedValue('GM')) {
  const controller = Object.create(ExtensionController.prototype);
  controller.OBR = { player: { getRole } };
  controller.playerId = 'gm-1';
  controller.announcementCancelled = false;
  controller.announcementTask = null;
  controller.announcementBanner = {
    show: jest.fn().mockReturnValue(true),
    remove: jest.fn()
  };
  return controller;
}

describe('ExtensionController announcement scheduling', () => {
  it('does not inspect role or render when no campaign is active', async () => {
    const getRole = jest.fn();
    const controller = createController(getRole);

    await expect(controller._showConfiguredAnnouncement(null)).resolves.toBe(false);
    expect(getRole).not.toHaveBeenCalled();
    expect(controller.announcementBanner.show).not.toHaveBeenCalled();
  });

  it('runs an active campaign in the background', async () => {
    let resolveRole;
    const getRole = jest.fn(() => new Promise(resolve => {
      resolveRole = resolve;
    }));
    const controller = createController(getRole);

    expect(controller._scheduleAnnouncement()).toBeUndefined();
    await expect(controller.announcementTask).resolves.toBe(false);

    controller.announcementTask = controller._showConfiguredAnnouncement(CAMPAIGN);
    expect(controller.announcementBanner.show).not.toHaveBeenCalled();
    resolveRole('GM');

    await expect(controller.announcementTask).resolves.toBe(true);
    expect(controller.announcementBanner.show).toHaveBeenCalledWith({
      campaign: CAMPAIGN,
      role: 'GM',
      userId: 'gm-1'
    });
  });

  it('fails closed when Owlbear cannot verify the role', async () => {
    const controller = createController(
      jest.fn().mockRejectedValue(new Error('role unavailable'))
    );

    await expect(controller._showConfiguredAnnouncement(CAMPAIGN)).resolves.toBe(false);
    expect(controller.announcementBanner.show).not.toHaveBeenCalled();
  });

  it('does not render after cleanup cancellation', async () => {
    let resolveRole;
    const controller = createController(jest.fn(() => new Promise(resolve => {
      resolveRole = resolve;
    })));

    const task = controller._showConfiguredAnnouncement(CAMPAIGN);
    controller.announcementCancelled = true;
    resolveRole('GM');

    await expect(task).resolves.toBe(false);
    expect(controller.announcementBanner.show).not.toHaveBeenCalled();
  });
});

