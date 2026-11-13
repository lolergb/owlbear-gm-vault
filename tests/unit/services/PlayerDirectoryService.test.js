import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  PlayerDirectoryService,
  publishCurrentPlayerProfile
} from '../../../js/services/PlayerDirectoryService.js';
import {
  PLAYER_DIRECTORY_STORAGE_PREFIX,
  PLAYER_PROFILE_METADATA_KEY
} from '../../../js/utils/constants.js';

describe('PlayerDirectoryService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('publishes the current Owlbear display name without redundant writes', async () => {
    const setMetadata = jest.fn().mockResolvedValue(undefined);
    const OBR = {
      player: {
        getName: jest.fn().mockResolvedValue('  Lyra   Moon  '),
        getMetadata: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            [PLAYER_PROFILE_METADATA_KEY]: { version: 1, name: 'Lyra Moon' }
          }),
        setMetadata
      }
    };

    await publishCurrentPlayerProfile(OBR);
    await publishCurrentPlayerProfile(OBR);

    expect(setMetadata).toHaveBeenCalledTimes(1);
    expect(setMetadata).toHaveBeenCalledWith({
      [PLAYER_PROFILE_METADATA_KEY]: { version: 1, name: 'Lyra Moon' }
    });
  });

  it('merges connected players with room history and marks offline entries', async () => {
    localStorage.setItem(`${PLAYER_DIRECTORY_STORAGE_PREFIX}room-1`, JSON.stringify({
      version: 1,
      players: [
        { id: 'offline-1', name: 'Old Friend', lastSeenAt: 10 },
        { id: 'player-1', name: 'Old Name', lastSeenAt: 20 }
      ]
    }));
    const service = new PlayerDirectoryService();
    service.setDependencies({
      roomId: 'room-1',
      OBR: {
        party: {
          getPlayers: jest.fn().mockResolvedValue([
            {
              id: 'gm-1',
              role: 'GM',
              connectionId: 'conn-gm'
            },
            {
              id: 'player-1',
              role: 'PLAYER',
              connectionId: 'conn-player',
              color: '#ff00ff',
              metadata: {
                [PLAYER_PROFILE_METADATA_KEY]: { version: 1, name: 'Current Name' }
              }
            }
          ])
        }
      }
    });

    const players = await service.listPlayers();

    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      id: 'player-1',
      name: 'Current Name',
      color: '#ff00ff',
      connected: true
    });
    expect(players[1]).toMatchObject({
      id: 'offline-1',
      name: 'Old Friend',
      connected: false
    });
  });

  it('uses a stable fallback when a connected player has no published name', async () => {
    const service = new PlayerDirectoryService();
    service.setDependencies({
      roomId: 'room-2',
      OBR: {
        party: {
          getPlayers: jest.fn().mockResolvedValue([
            { id: 'abcdef123', role: 'PLAYER', metadata: {} }
          ])
        }
      }
    });

    await expect(service.listPlayers()).resolves.toEqual([
      expect.objectContaining({ id: 'abcdef123', name: 'Player abcdef', connected: true })
    ]);
  });

  it('records party changes so recently disconnected players remain available', async () => {
    let onPartyChange;
    let party = [{
      id: 'player-1',
      role: 'PLAYER',
      metadata: {
        [PLAYER_PROFILE_METADATA_KEY]: { version: 1, name: 'Lyra' }
      }
    }];
    const unsubscribe = jest.fn();
    const service = new PlayerDirectoryService();
    service.setDependencies({
      roomId: 'room-watch',
      OBR: {
        party: {
          getPlayers: jest.fn(async () => party),
          onChange: jest.fn((callback) => {
            onPartyChange = callback;
            return unsubscribe;
          })
        }
      }
    });

    const stop = service.startWatching();
    await new Promise(resolve => setTimeout(resolve, 0));
    party = [];
    onPartyChange();
    await new Promise(resolve => setTimeout(resolve, 0));

    await expect(service.listPlayers()).resolves.toEqual([
      expect.objectContaining({ id: 'player-1', name: 'Lyra', connected: false })
    ]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
