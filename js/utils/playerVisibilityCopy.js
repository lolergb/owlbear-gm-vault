import { getPlayerAudienceMode, isPlayerAccessEnabled, normalizePlayerIds, PLAYER_ACCESS_MODE } from './playerAccess.js';

/** Action labels describe the next click, including the default audience. */
export function getVisibilityActionLabel(page, enabled = isPlayerAccessEnabled(page)) {
  if (getPlayerAudienceMode(page) !== PLAYER_ACCESS_MODE.SELECTED) {
    return enabled ? 'Hide from all players' : 'Show to all players';
  }
  const count = normalizePlayerIds(page.sharedWithPlayerIds).length;
  if (count === 1) return enabled ? 'Hide from 1 player' : 'Show to 1 player';
  return enabled ? `Hide from ${count} players` : `Show to ${count} players`;
}

/** Feedback describes the result, whether it came from the eye or the dialog. */
export function getVisibilityStatusLabel(page) {
  if (!isPlayerAccessEnabled(page)) return 'Hidden from players';
  if (getPlayerAudienceMode(page) === PLAYER_ACCESS_MODE.EVERYONE) {
    return 'Visible to all players';
  }
  const count = normalizePlayerIds(page.sharedWithPlayerIds).length;
  return count === 1 ? 'Visible to 1 player' : `Visible to ${count} players`;
}
