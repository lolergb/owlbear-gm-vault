import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../../js/controllers/ExtensionController.js';
import {
  BROADCAST_CHANNEL_REQUEST_FULL_VAULT
} from '../../../js/utils/constants.js';

function createController(players) {
  const handlers = new Map();
  const controller = Object.create(ExtensionController.prototype);
  const hiddenPage = { id: 'secret-page', visibleToPlayers: false };
  let contentResponder;

  controller.config = {
    findPageByNotionId: jest.fn(pageId => pageId === hiddenPage.id ? hiddenPage : null),
    toJSON: jest.fn(() => ({
      categories: [{
        name: 'Secrets',
        pages: [{ id: hiddenPage.id, name: 'Secret', visibleToPlayers: false }]
      }]
    }))
  };
  controller.cacheService = {
    getHtmlFromLocalCache: jest.fn(() => '<p>secret</p>'),
    clearPageCache: jest.fn(),
    saveHtmlToLocalCache: jest.fn()
  };
  controller.connectionId = 'conn-master';
  controller.storageService = {
    getVaultOwner: jest.fn().mockResolvedValue({
      id: 'master',
      connectionId: 'conn-master'
    })
  };
  controller.broadcastService = {
    setupGMContentResponder: jest.fn(callback => {
      contentResponder = callback;
    }),
    setupGMVisiblePagesResponder: jest.fn(),
    sendEncryptedFullVaultResponse: jest.fn().mockResolvedValue({ success: true, chunks: 2 }),
    sendMessage: jest.fn().mockResolvedValue({ success: true })
  };
  controller.OBR = {
    player: { getConnectionId: jest.fn().mockResolvedValue('conn-master') },
    party: { getPlayers: jest.fn().mockResolvedValue(players) },
    broadcast: {
      onMessage: jest.fn((channel, callback) => {
        handlers.set(channel, callback);
        return jest.fn();
      })
    }
  };
  controller._setupSharedContentListeners = jest.fn();
  controller._generateNotionHtmlWithHeader = jest.fn();

  controller._setupGMBroadcast();

  return {
    controller,
    getContentResponder: () => contentResponder,
    getHandler: channel => handlers.get(channel)
  };
}

describe('ExtensionController broadcast authorization', () => {
  it('does not serve a hidden page to a Player connection', async () => {
    const { controller, getContentResponder } = createController([
      { id: 'player-1', connectionId: 'conn-player', role: 'PLAYER' }
    ]);

    const result = await getContentResponder()('secret-page', false, {
      connectionId: 'conn-player'
    });

    expect(result).toBeNull();
    expect(controller.cacheService.getHtmlFromLocalCache).not.toHaveBeenCalled();
  });

  it('serves a hidden page to an authenticated GM connection', async () => {
    const { getContentResponder } = createController([
      { id: 'gm-2', connectionId: 'conn-gm', role: 'GM' }
    ]);

    await expect(getContentResponder()('secret-page', false, {
      connectionId: 'conn-gm'
    })).resolves.toContain('secret');
  });

  it('rejects a full-vault request from a Player even if the payload claims a GM id', async () => {
    const { controller, getHandler } = createController([
      { id: 'player-1', connectionId: 'conn-player', role: 'PLAYER' },
      { id: 'gm-2', connectionId: 'conn-gm', role: 'GM' }
    ]);

    await getHandler(BROADCAST_CHANNEL_REQUEST_FULL_VAULT)({
      connectionId: 'conn-player',
      data: { requesterId: 'gm-2', requesterName: 'Forged GM' }
    });

    expect(controller.broadcastService.sendEncryptedFullVaultResponse).not.toHaveBeenCalled();
  });

  it('returns the full vault only when connection, id and GM role agree', async () => {
    const { controller, getHandler } = createController([
      { id: 'gm-2', connectionId: 'conn-gm', role: 'GM' }
    ]);

    await getHandler(BROADCAST_CHANNEL_REQUEST_FULL_VAULT)({
      connectionId: 'conn-gm',
      data: {
        protocol: 'ecdh-p256-aes-gcm-v1',
        requestId: 'request-1',
        requesterId: 'gm-2',
        requesterName: 'Co-GM',
        publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }
      }
    });

    expect(controller.broadcastService.sendEncryptedFullVaultResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requesterId: 'gm-2', requestId: 'request-1' }),
      expect.objectContaining({ categories: expect.any(Array) })
    );
  });

  it('ignores a request targeted at another Master GM connection', async () => {
    const { controller, getHandler } = createController([
      { id: 'gm-2', connectionId: 'conn-gm', role: 'GM' }
    ]);

    await getHandler(BROADCAST_CHANNEL_REQUEST_FULL_VAULT)({
      connectionId: 'conn-gm',
      data: {
        protocol: 'ecdh-p256-aes-gcm-v1',
        requestId: 'request-2',
        requesterId: 'gm-2',
        targetConnectionId: 'conn-other-master',
        publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }
      }
    });

    expect(controller.broadcastService.sendEncryptedFullVaultResponse).not.toHaveBeenCalled();
  });
});

describe('ExtensionController Master GM connection ownership', () => {
  it('treats a second connection with the same player id as Co-GM', async () => {
    const controller = Object.create(ExtensionController.prototype);
    controller.playerId = 'master';
    controller.connectionId = 'conn-duplicate';
    controller.storageService = {
      getVaultOwner: jest.fn().mockResolvedValue({
        id: 'master',
        connectionId: 'conn-primary'
      })
    };
    controller.OBR = {
      party: {
        getPlayers: jest.fn().mockResolvedValue([
          { id: 'master', connectionId: 'conn-primary', role: 'GM' },
          { id: 'master', connectionId: 'conn-duplicate', role: 'GM' }
        ])
      }
    };

    await controller._detectCoGM();

    expect(controller.isCoGM).toBe(true);
  });

  it('does not steal ownership from a live connection with the same player id', async () => {
    const controller = Object.create(ExtensionController.prototype);
    controller.isGM = true;
    controller.playerId = 'master';
    controller.connectionId = 'conn-duplicate';
    controller.storageService = {
      getVaultOwner: jest.fn().mockResolvedValue({
        id: 'master',
        connectionId: 'conn-primary'
      }),
      setVaultOwner: jest.fn()
    };
    controller.OBR = {
      player: {
        getId: jest.fn().mockResolvedValue('master'),
        getConnectionId: jest.fn().mockResolvedValue('conn-duplicate')
      },
      party: {
        getPlayers: jest.fn().mockResolvedValue([
          { id: 'master', connectionId: 'conn-primary', role: 'GM' },
          { id: 'master', connectionId: 'conn-duplicate', role: 'GM' }
        ])
      }
    };

    await controller._establishVaultOwnership();

    expect(controller.storageService.setVaultOwner).not.toHaveBeenCalled();
  });
});
