import { describe, expect, it, jest } from '@jest/globals';
import { ExtensionController } from '../../js/controllers/ExtensionController.js';
import { StorageService } from '../../js/services/StorageService.js';
import { BroadcastService } from '../../js/services/BroadcastService.js';
import { ConfigParser } from '../../js/parsers/ConfigParser.js';
import { setOBRReference } from '../../js/utils/logger.js?v=20260722-4';
import { ROOM_METADATA_KEY, FULL_CONFIG_KEY, ROOM_CONTENT_CACHE_KEY, ROOM_HTML_CACHE_KEY, VAULT_OWNER_KEY } from '../../js/utils/constants.js';

const publicId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const privateId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const vault = {
  categories: [{ id: 'campaign', name: 'Campaign', pages: [
    { id: 'private', name: 'GM notes', url: `https://notion.so/${privateId.replace(/-/g, '')}`, htmlContent: 'Private notes '.repeat(2000), visibleToPlayers: false },
    { id: 'public', name: 'Handout', url: `https://notion.so/${publicId.replace(/-/g, '')}`, visibleToPlayers: true }
  ], order: [{ type: 'page', index: 1 }, { type: 'page', index: 0 }] }]
};

// SDK-shaped clients with a shared metadata store and authenticated connection
// IDs. Use the real controller/storage/broadcast code on each side.
function room(initialMetadata) {
  let metadata = initialMetadata;
  const handlers = new Map();
  const members = [
    { id: 'gm', connectionId: 'gm-current', role: 'GM' },
    { id: 'player', connectionId: 'player-current', role: 'PLAYER' }
  ];
  const client = member => ({
    room: {
      id: 'campaign-room',
      getMetadata: jest.fn(async () => metadata),
      setMetadata: jest.fn(async patch => { metadata = { ...metadata, ...patch }; })
    },
    player: {
      getId: jest.fn(async () => member.id),
      getRole: jest.fn(async () => member.role),
      getConnectionId: jest.fn(async () => member.connectionId)
    },
    party: { getPlayers: jest.fn(async () => members) },
    broadcast: {
      onMessage: jest.fn((channel, handler) => {
        if (!handlers.has(channel)) handlers.set(channel, new Set());
        handlers.get(channel).add(handler);
        return () => handlers.get(channel).delete(handler);
      }),
      sendMessage: jest.fn(async (channel, data) => {
        if (new TextEncoder().encode(JSON.stringify(data)).length > 16 * 1024) throw new Error('Broadcast limit');
        for (const handler of [...(handlers.get(channel) || [])]) {
          setTimeout(() => handler({ data, connectionId: member.connectionId }), 0);
        }
      })
    }
  });
  return { gm: client(members[0]), player: client(members[1]), metadata: () => metadata };
}

function controller(OBR, isGM) {
  const c = Object.create(ExtensionController.prototype);
  Object.assign(c, { OBR, isGM, isCoGM: false, roomId: 'campaign-room',
    playerId: isGM ? 'gm' : 'player', connectionId: isGM ? 'gm-current' : 'player-current',
    storageService: new StorageService(), broadcastService: new BroadcastService(), configParser: new ConfigParser(),
    notionRenderer: { setDependencies: jest.fn() },
    cacheService: { getHtmlFromLocalCache: jest.fn(() => null), saveHtmlToLocalCache: jest.fn() },
    _setupSharedContentListeners: jest.fn()
  });
  c.storageService.setOBR(OBR);
  c.storageService.setRoomId(c.roomId);
  c.broadcastService.setDependencies({ OBR });
  return c;
}

describe('v1 data in 2.1 with the GM connected', () => {
  it.each(['v1', 'already-updated', 'reopened-after-rollback'])(
    'loads the original vault and serves shared content in a %s room without destructive migration', async state => {
      const legacy = {
        [ROOM_METADATA_KEY]: { categories: [{ name: 'Old shared list', pages: [] }] },
        [FULL_CONFIG_KEY]: { categories: [{ name: 'Old full copy', pages: [] }] },
        [ROOM_CONTENT_CACHE_KEY]: { legacy: 'blocks' },
        [ROOM_HTML_CACHE_KEY]: { legacy: '<p>Cached page</p>' }
      };
      const originalMetadata = {
        ...(state === 'v1' ? legacy : {}),
        [VAULT_OWNER_KEY]: state === 'already-updated'
          ? { id: 'gm', connectionId: 'gm-previous' }
          : { id: 'gm', name: 'GM', lastHeartbeat: 123 },
        'another-extension/state': { keep: true }
      };
      const env = room(originalMetadata);
      const gm = controller(env.gm, true);
      const player = controller(env.player, false);
      setOBRReference(env.gm);
      const raw = JSON.stringify(vault, null, 2);
      localStorage.setItem('notion-pages-json-campaign-room', raw);
      localStorage.setItem('notion-global-token', 'existing-notion-token');
      const originalLocal = { ...localStorage.store };

      await gm._loadConfig();
      await gm._establishVaultOwnership();
      gm._generateNotionHtmlWithHeader = jest.fn().mockResolvedValue({ html: '<p>Shared content</p>' });
      gm._setupGMBroadcast();
      await player._loadConfig();
      expect(gm.config.getTotalPageCount()).toBe(2);
      expect(gm.config.categories[0].order).toEqual(vault.categories[0].order);
      expect(player.config.getAllPages().map(page => page.name)).toEqual(['Handout']);
      expect(await player.broadcastService.requestContentFromGM(publicId)).toContain('Shared content');
      expect(gm._generateNotionHtmlWithHeader).toHaveBeenCalledWith(publicId, expect.any(Object));
      expect(gm.storageService.getUserToken()).toBe('existing-notion-token');
      expect(localStorage.store).toEqual(originalLocal);
      expect(env.metadata()).toEqual({ ...originalMetadata, [VAULT_OWNER_KEY]: { id: 'gm', connectionId: 'gm-current' } });
      expect(env.gm.room.setMetadata).toHaveBeenCalledTimes(1);
      expect(env.gm.room.setMetadata).toHaveBeenCalledWith({ [VAULT_OWNER_KEY]: { id: 'gm', connectionId: 'gm-current' } });
      const outbound = JSON.stringify(env.gm.broadcast.sendMessage.mock.calls);
      expect(outbound).not.toContain('GM notes');
      expect(outbound).not.toContain('existing-notion-token');
      gm.broadcastService.cleanup();
      player.broadcastService.cleanup();
    }
  );

  it('does not introduce an offline room-metadata fallback for Players', async () => {
    const env = room({ [ROOM_METADATA_KEY]: { categories: [{ name: 'Legacy list', pages: [] }] } });
    const player = controller(env.player, false);
    player._checkGMAvailability = jest.fn().mockResolvedValue({ isActive: false });
    await player._loadConfig();
    expect(player.config.getTotalPageCount()).toBe(0);
    expect(player.config.categories).toHaveLength(0);
    expect(env.player.broadcast.sendMessage).not.toHaveBeenCalled();
    expect(env.player.room.setMetadata).not.toHaveBeenCalled();
  });
});
