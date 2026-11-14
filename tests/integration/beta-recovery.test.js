import { describe, it, expect, jest } from '@jest/globals';
import { ExtensionController } from '../../js/controllers/ExtensionController.js';
import { BetaVaultMigration } from '../../js/services/BetaVaultMigration.js';
import { PRODUCTION_ORIGIN, VAULT_PREFIX } from '../../js/config/betaMigration.js';
import { VAULT_OWNER_KEY } from '../../js/utils/constants.js';
import { StorageService } from '../../js/services/StorageService.js';
import { ConfigParser } from '../../js/parsers/ConfigParser.js';

function controller() {
  const c = Object.create(ExtensionController.prototype);
  Object.assign(c, { roomId: 'room-test', playerId: 'gm', connectionId: 'connection', isGM: true, isCoGM: false,
    storageService: new StorageService(), configParser: new ConfigParser(), notionRenderer: { setDependencies: jest.fn() },
    OBR: { room: { id: 'room-test', getMetadata: jest.fn(async () => ({})) },
      player: { getRole: jest.fn(async () => 'GM'), getId: jest.fn(async () => 'gm'), getConnectionId: jest.fn(async () => 'connection') },
      party: { getPlayers: jest.fn(async () => []) } }
  });
  c.storageService.setRoomId(c.roomId);
  return c;
}

describe('beta recovery with the actual controller role and storage rules', () => {
  it('awaits recovery before loading or announcing the vault to the room', async () => {
    const c = controller();
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const recoveryStarted = new Promise(resolve => { started = resolve; });
    const order = [];
    c._recoverBetaVault = jest.fn(async () => { order.push('recover'); started(); await gate; });
    c._loadConfig = jest.fn(async () => { order.push('load'); c.config = c.configParser.parse({ categories: [] }); });
    c._establishVaultOwnership = jest.fn(async () => order.push('owner'));
    c._setupGMBroadcast = jest.fn(() => order.push('broadcast'));
    for (const method of ['_setupServices', '_fetchPlayerInfo', '_setupUI', '_setupEventHandlers', '_startRoleChangeDetection',
      'render', '_scheduleAnnouncement', '_setupTokenContextMenus', '_setupGlobalRefreshImage']) c[method] = jest.fn();
    c._canShowVaultEmptyState = () => true;
    c.analyticsService = { setVaultContext: jest.fn(), init: jest.fn() };
    const pending = c.init(c.OBR);
    await recoveryStarted;
    expect(c._loadConfig).not.toHaveBeenCalled();
    expect(c._establishVaultOwnership).not.toHaveBeenCalled();
    release();
    await pending;
    expect(order).toEqual(['recover', 'load', 'owner', 'broadcast']);
  });

  it('loads exact copied beta data with private pages intact for the Master GM', async () => {
    const c = controller();
    const raw = JSON.stringify({ categories: [{ name: 'Beta campaign', pages: [
      { name: 'Private notes', url: 'https://example.com', visibleToPlayers: false },
      { name: 'Shared handout', url: 'https://example.com/handout', visibleToPlayers: true }
    ] }] });
    const service = new BetaVaultMigration({ host: { location: { origin: PRODUCTION_ORIGIN }, localStorage, crypto },
      verifyContext: room => c._canRecoverBetaVault(room), readSource: async () => ({ status: 'ok', raw, token: null, sourceKind: 'room' }) });
    expect((await service.recover(c.roomId)).status).toBe('imported');
    await c._loadConfig();
    expect(c.config.getTotalPageCount()).toBe(2);
    expect(c.config.getAllPages().map(page => page.visibleToPlayers)).toEqual([false, true]);
    expect(localStorage.getItem(VAULT_PREFIX + c.roomId)).toBe(raw);
  });

  it.each(['player', 'co-gm', 'different-room', 'unknown-room', 'sdk-role', 'connection', 'owner', 'sdk-failure'])('refuses migration for %s', async scenario => {
    const c = controller();
    if (scenario === 'player') c.isGM = false;
    if (scenario === 'co-gm') c.isCoGM = true;
    if (scenario === 'different-room') c.OBR.room.id = 'another-room';
    if (scenario === 'unknown-room') c.roomId = 'default';
    if (scenario === 'sdk-role') c.OBR.player.getRole.mockResolvedValue('PLAYER');
    if (scenario === 'connection') c.OBR.player.getConnectionId.mockResolvedValue('another-connection');
    if (scenario === 'sdk-failure') c.OBR.room.getMetadata.mockRejectedValue(Error('offline'));
    if (scenario === 'owner') {
      c.OBR.room.getMetadata.mockResolvedValue({ [VAULT_OWNER_KEY]: { id: 'other-gm', connectionId: 'other' } });
      c.OBR.party.getPlayers.mockResolvedValue([{ id: 'other-gm', connectionId: 'other', role: 'GM' }]);
    }
    const readSource = jest.fn();
    const service = new BetaVaultMigration({ host: { location: { origin: PRODUCTION_ORIGIN }, localStorage, crypto },
      verifyContext: room => c._canRecoverBetaVault(room), readSource });
    expect((await service.recover(c.roomId)).status).toBe('ineligible');
    expect(readSource).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('accepts the current owner and a replacement GM only when the old owner is disconnected', async () => {
    const c = controller();
    c.OBR.room.getMetadata.mockResolvedValue({ [VAULT_OWNER_KEY]: { id: 'gm', connectionId: 'connection' } });
    expect(await c._canRecoverBetaVault(c.roomId)).toBe(true);
    c.OBR.room.getMetadata.mockResolvedValue({ [VAULT_OWNER_KEY]: { id: 'disconnected-gm' } });
    expect(await c._canRecoverBetaVault(c.roomId)).toBe(true);
  });
});
