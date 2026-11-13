import {
  PLAYER_DIRECTORY_STORAGE_PREFIX,
  PLAYER_PROFILE_METADATA_KEY
} from '../utils/constants.js';

const PROFILE_VERSION = 1;
const MAX_NAME_LENGTH = 80;

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

function fallbackName(playerId) {
  const suffix = String(playerId || '').slice(0, 6);
  return suffix ? `Player ${suffix}` : 'Player';
}

export async function publishCurrentPlayerProfile(OBR) {
  if (!OBR?.player?.getName || !OBR?.player?.setMetadata) return false;
  const name = normalizeName(await OBR.player.getName());
  if (!name) return false;

  const metadata = OBR.player.getMetadata
    ? await OBR.player.getMetadata().catch(() => ({}))
    : {};
  const existing = metadata?.[PLAYER_PROFILE_METADATA_KEY];
  if (existing?.version === PROFILE_VERSION && existing?.name === name) return true;

  await OBR.player.setMetadata({
    [PLAYER_PROFILE_METADATA_KEY]: { version: PROFILE_VERSION, name }
  });
  return true;
}

export function setupPlayerProfilePublishing(OBR) {
  let stopped = false;
  let publishing = null;

  const publish = () => {
    if (stopped || publishing) return publishing || Promise.resolve(false);
    publishing = publishCurrentPlayerProfile(OBR)
      .catch((error) => {
        console.warn('Could not publish the GM Vault player profile:', error);
        return false;
      })
      .finally(() => {
        publishing = null;
      });
    return publishing;
  };

  void publish();
  const unsubscribe = OBR?.player?.onChange?.(() => void publish());
  return () => {
    stopped = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    else unsubscribe?.unsubscribe?.();
  };
}

export class PlayerDirectoryService {
  constructor() {
    this.OBR = null;
    this.roomId = 'default';
    this.stopWatching = null;
  }

  setDependencies({ OBR, roomId } = {}) {
    if (OBR) this.OBR = OBR;
    if (roomId) this.roomId = roomId;
  }

  setRoomId(roomId) {
    this.roomId = roomId || 'default';
  }

  getStorageKey() {
    return `${PLAYER_DIRECTORY_STORAGE_PREFIX}${this.roomId || 'default'}`;
  }

  startWatching() {
    this.stopWatching?.();
    void this.listPlayers();
    const subscription = this.OBR?.party?.onChange?.(() => void this.listPlayers());
    this.stopWatching = () => {
      if (typeof subscription === 'function') subscription();
      else subscription?.unsubscribe?.();
      this.stopWatching = null;
    };
    return this.stopWatching;
  }

  _readKnownPlayers() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.getStorageKey()) || '{}');
      return Array.isArray(parsed.players) ? parsed.players : [];
    } catch (_error) {
      return [];
    }
  }

  _saveKnownPlayers(players) {
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify({
        version: PROFILE_VERSION,
        players: players.map(({ id, name, color, lastSeenAt }) => ({
          id,
          name,
          ...(color ? { color } : {}),
          lastSeenAt
        }))
      }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async listPlayers() {
    const known = new Map(
      this._readKnownPlayers()
        .filter(player => typeof player?.id === 'string' && player.id)
        .map(player => [player.id, { ...player, connected: false }])
    );
    let party = [];
    try {
      party = await this.OBR?.party?.getPlayers?.() || [];
    } catch (_error) {
      // History remains usable when Owlbear temporarily cannot return party.
    }

    const now = Date.now();
    for (const player of party) {
      if (player?.role !== 'PLAYER' || typeof player.id !== 'string' || !player.id) continue;
      const cached = known.get(player.id);
      const profileName = normalizeName(player.metadata?.[PLAYER_PROFILE_METADATA_KEY]?.name);
      known.set(player.id, {
        id: player.id,
        name: profileName || normalizeName(cached?.name) || fallbackName(player.id),
        color: typeof player.color === 'string' ? player.color : cached?.color || '',
        lastSeenAt: now,
        connected: true
      });
    }

    const players = [...known.values()]
      .filter(player => player?.id && player?.name)
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    this._saveKnownPlayers(players);
    return players;
  }
}

export default PlayerDirectoryService;
