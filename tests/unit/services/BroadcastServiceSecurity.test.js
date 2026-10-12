import { describe, expect, it, jest } from '@jest/globals';
import { BroadcastService } from '../../../js/services/BroadcastService.js';
import {
  BROADCAST_CHANNEL_REQUEST_FULL_VAULT,
  BROADCAST_CHANNEL_RESPONSE,
  BROADCAST_CHANNEL_RESPONSE_FULL_VAULT,
  BROADCAST_CHANNEL_VISIBLE_PAGES
} from '../../../js/utils/constants.js';

function createListenerOBR() {
  const handlers = new Map();
  const players = [
    { id: 'master', connectionId: 'conn-master', role: 'GM' },
    { id: 'player', connectionId: 'conn-player', role: 'PLAYER' }
  ];
  return {
    party: { getPlayers: jest.fn().mockResolvedValue(players) },
    broadcast: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      onMessage: jest.fn((channel, handler) => {
        handlers.set(channel, handler);
        return () => handlers.delete(channel);
      })
    },
    emit(channel, data, connectionId) {
      return handlers.get(channel)?.({ data, connectionId });
    }
  };
}

function createSecureBus() {
  const listeners = new Map();
  const sent = [];
  const players = [
    { id: 'master', name: 'Master', connectionId: 'conn-master', role: 'GM' },
    { id: 'co-gm', name: 'Co-GM', connectionId: 'conn-cogm', role: 'GM' }
  ];

  const makeOBR = (localPlayer) => ({
    party: { getPlayers: jest.fn().mockResolvedValue(players) },
    broadcast: {
      onMessage: jest.fn((channel, handler) => {
        const entries = listeners.get(channel) || [];
        const entry = { connectionId: localPlayer.connectionId, handler };
        entries.push(entry);
        listeners.set(channel, entries);
        return () => {
          const current = listeners.get(channel) || [];
          listeners.set(channel, current.filter(candidate => candidate !== entry));
        };
      }),
      sendMessage: jest.fn(async (channel, data) => {
        const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
        if (bytes > 16 * 1024) throw new Error('size limit');
        sent.push({ channel, data, bytes, sender: localPlayer.connectionId });
        const entries = listeners.get(channel) || [];
        await Promise.all(entries
          .filter(entry => entry.connectionId !== localPlayer.connectionId)
          .map(entry => entry.handler({ data, connectionId: localPlayer.connectionId })));
      })
    }
  });

  return {
    masterOBR: makeOBR(players[0]),
    coGmOBR: makeOBR(players[1]),
    players,
    sent
  };
}

describe('BroadcastService sender authentication', () => {
  it('ignores visible-page updates forged by a Player', async () => {
    const OBR = createListenerOBR();
    const service = new BroadcastService();
    service.setDependencies({ OBR });
    const callback = jest.fn();
    service.listenForVisiblePagesUpdates(callback);

    await OBR.emit(BROADCAST_CHANNEL_VISIBLE_PAGES, { config: { categories: ['forged'] } }, 'conn-player');
    expect(callback).not.toHaveBeenCalled();

    await OBR.emit(BROADCAST_CHANNEL_VISIBLE_PAGES, { config: { categories: ['trusted'] } }, 'conn-master');
    expect(callback).toHaveBeenCalledWith({ categories: ['trusted'] });
  });

  it('ignores a forged content response and accepts the GM response', async () => {
    const OBR = createListenerOBR();
    const service = new BroadcastService();
    service.setDependencies({ OBR });
    const request = service.requestContentFromGM('page-1');

    await OBR.emit(BROADCAST_CHANNEL_RESPONSE, { pageId: 'page-1', html: '<p>forged</p>' }, 'conn-player');
    await OBR.emit(BROADCAST_CHANNEL_RESPONSE, { pageId: 'page-1', html: '<p>trusted</p>' }, 'conn-master');

    await expect(request).resolves.toBe('<p>trusted</p>');
  });
});

describe('BroadcastService encrypted full-vault protocol', () => {
  it('transfers a vault larger than 16 kB in authenticated encrypted chunks', async () => {
    const { masterOBR, coGmOBR, players, sent } = createSecureBus();
    const master = new BroadcastService();
    const coGm = new BroadcastService();
    master.setDependencies({ OBR: masterOBR });
    coGm.setDependencies({ OBR: coGmOBR });
    const config = {
      categories: [{ name: 'Secret', pages: [{ name: 'Dragon', visibleToPlayers: false }] }],
      privateNotes: 'TOP-SECRET-DRAGON '.repeat(5000)
    };

    masterOBR.broadcast.onMessage(BROADCAST_CHANNEL_REQUEST_FULL_VAULT, async (event) => {
      const requester = players.find(player => player.connectionId === event.connectionId);
      if (requester?.role === 'GM' && requester.id === event.data.requesterId) {
        await master.sendEncryptedFullVaultResponse(event.data, config);
      }
    });

    await expect(coGm.requestEncryptedFullVault({
      requesterId: 'co-gm',
      requesterName: 'Co-GM',
      expectedSenderConnectionId: 'conn-master',
      timeoutMs: 1000
    })).resolves.toEqual(config);

    const request = sent.find(message => message.channel === BROADCAST_CHANNEL_REQUEST_FULL_VAULT);
    expect(request.data.targetConnectionId).toBe('conn-master');

    const responseChunks = sent.filter(message => message.channel === BROADCAST_CHANNEL_RESPONSE_FULL_VAULT);
    expect(responseChunks.length).toBeGreaterThan(1);
    expect(responseChunks.every(message => message.bytes <= 16 * 1024)).toBe(true);
    expect(JSON.stringify(responseChunks)).not.toContain('TOP-SECRET-DRAGON');
  });
});
