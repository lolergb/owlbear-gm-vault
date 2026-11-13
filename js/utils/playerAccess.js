/**
 * Player access helpers.
 *
 * `visibleToPlayers` remains the backwards-compatible "everyone" audience.
 * `sharedWithPlayerIds` stores the selected-player audience.
 * `playerAccessEnabled` toggles that configured audience without destroying it.
 * Access is granted at page level only. Legacy folder ACL fields are ignored.
 */

const MAX_PLAYER_IDS = 128;
const MAX_PLAYER_ID_LENGTH = 160;

export const PLAYER_ACCESS_MODE = Object.freeze({
  GM_ONLY: 'gm-only',
  EVERYONE: 'everyone',
  SELECTED: 'selected'
});

export function normalizePlayerIds(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  const seen = new Set();
  for (const rawId of value) {
    if (typeof rawId !== 'string') continue;
    const id = rawId.trim();
    if (!id || id.length > MAX_PLAYER_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
    if (normalized.length >= MAX_PLAYER_IDS) break;
  }
  return normalized;
}

export function getPlayerAudienceMode(target) {
  if (target?.visibleToPlayers === true) return PLAYER_ACCESS_MODE.EVERYONE;
  if (normalizePlayerIds(target?.sharedWithPlayerIds).length > 0) {
    return PLAYER_ACCESS_MODE.SELECTED;
  }
  return PLAYER_ACCESS_MODE.GM_ONLY;
}

export function isPlayerAccessEnabled(target) {
  const audienceMode = getPlayerAudienceMode(target);
  if (audienceMode === PLAYER_ACCESS_MODE.GM_ONLY) return false;
  return target?.playerAccessEnabled !== false;
}

export function getPlayerAccessMode(target) {
  return isPlayerAccessEnabled(target)
    ? getPlayerAudienceMode(target)
    : PLAYER_ACCESS_MODE.GM_ONLY;
}

export function hasDirectPlayerAccess(target, playerId) {
  if (!isPlayerAccessEnabled(target)) return false;
  if (target?.visibleToPlayers === true) return true;
  if (!playerId) return false;
  return normalizePlayerIds(target?.sharedWithPlayerIds).includes(playerId);
}

export function hasAnyPlayerAccess(target) {
  return getPlayerAccessMode(target) !== PLAYER_ACCESS_MODE.GM_ONLY;
}

export function applyPlayerAccess(target, mode, playerIds = []) {
  if (!target) return target;

  if (mode === PLAYER_ACCESS_MODE.EVERYONE) {
    target.visibleToPlayers = true;
    target.sharedWithPlayerIds = [];
    target.playerAccessEnabled = true;
  } else if (mode === PLAYER_ACCESS_MODE.SELECTED) {
    target.visibleToPlayers = false;
    target.sharedWithPlayerIds = normalizePlayerIds(playerIds);
    target.playerAccessEnabled = target.sharedWithPlayerIds.length > 0;
  } else {
    target.visibleToPlayers = false;
    target.sharedWithPlayerIds = [];
    target.playerAccessEnabled = false;
  }
  return target;
}

export function setPlayerAccessEnabled(target, enabled) {
  if (!target) return target;

  if (enabled && getPlayerAudienceMode(target) === PLAYER_ACCESS_MODE.GM_ONLY) {
    target.visibleToPlayers = true;
    target.sharedWithPlayerIds = [];
  }
  target.playerAccessEnabled = enabled &&
    getPlayerAudienceMode(target) !== PLAYER_ACCESS_MODE.GM_ONLY;
  return target;
}

/** Collect existing pages recursively; folders do not grant or inherit access. */
export function getPagesInFolder(folder) {
  return [
    ...(folder?.pages || []),
    ...(folder?.categories || []).flatMap(getPagesInFolder)
  ];
}

function recalculateOrder(order, pageIndexes, categoryIndexes) {
  if (!Array.isArray(order)) return null;

  const pageMap = new Map(pageIndexes.map((originalIndex, index) => [originalIndex, index]));
  const categoryMap = new Map(categoryIndexes.map((originalIndex, index) => [originalIndex, index]));
  const nextOrder = [];

  for (const entry of order) {
    if (entry?.type === 'page' && pageMap.has(entry.index)) {
      nextOrder.push({ type: 'page', index: pageMap.get(entry.index) });
    } else if (entry?.type === 'category' && categoryMap.has(entry.index)) {
      nextOrder.push({ type: 'category', index: categoryMap.get(entry.index) });
    }
  }
  return nextOrder.length > 0 ? nextOrder : null;
}

function sanitizeAuthorizedPage(page) {
  const sanitized = {
    ...page,
    // The returned vault is already scoped to one authenticated player. Mark
    // included pages as renderable without exposing the rest of the ACL.
    visibleToPlayers: true
  };
  delete sanitized.sharedWithPlayerIds;
  delete sanitized.playerAccessEnabled;
  return sanitized;
}

function filterCategoryForPlayer(category, playerId) {
  const originalPages = Array.isArray(category?.pages) ? category.pages : [];
  const originalCategories = Array.isArray(category?.categories) ? category.categories : [];
  const pageIndexes = [];
  const categoryIndexes = [];
  const pages = [];
  const categories = [];

  originalPages.forEach((page, index) => {
    if (hasDirectPlayerAccess(page, playerId)) {
      pageIndexes.push(index);
      pages.push(sanitizeAuthorizedPage(page));
    }
  });

  originalCategories.forEach((child, index) => {
    const filtered = filterCategoryForPlayer(child, playerId);
    if (filtered) {
      categoryIndexes.push(index);
      categories.push(filtered);
    }
  });

  if (pages.length === 0 && categories.length === 0) return null;

  const filtered = { ...category, pages };
  delete filtered.visibleToPlayers;
  delete filtered.sharedWithPlayerIds;
  delete filtered.playerAccessEnabled;
  if (categories.length > 0) filtered.categories = categories;
  else delete filtered.categories;

  const order = recalculateOrder(category?.order, pageIndexes, categoryIndexes);
  if (order) filtered.order = order;
  else delete filtered.order;
  return filtered;
}

/** Return a privacy-safe vault containing only content available to playerId. */
export function filterConfigForPlayer(config, playerId) {
  if (!config || !playerId) return { categories: [] };

  const source = typeof config.toJSON === 'function' ? config.toJSON() : config;
  const originalPages = Array.isArray(source.pages) ? source.pages : [];
  const originalCategories = Array.isArray(source.categories) ? source.categories : [];
  const pageIndexes = [];
  const categoryIndexes = [];
  const pages = [];
  const categories = [];

  originalPages.forEach((page, index) => {
    if (hasDirectPlayerAccess(page, playerId)) {
      pageIndexes.push(index);
      pages.push(sanitizeAuthorizedPage(page));
    }
  });

  originalCategories.forEach((category, index) => {
    const filtered = filterCategoryForPlayer(category, playerId);
    if (filtered) {
      categoryIndexes.push(index);
      categories.push(filtered);
    }
  });

  const filtered = { categories };
  if (pages.length > 0) filtered.pages = pages;
  const order = recalculateOrder(source.order, pageIndexes, categoryIndexes);
  if (order) filtered.order = order;
  return filtered;
}

/** Authorize a stored page using only the grant configured on that page. */
export function canPlayerAccessPage(config, pageId, playerId) {
  if (!config || !pageId || !playerId) return false;
  const source = typeof config.toJSON === 'function' ? config.toJSON() : config;

  const matches = (page) => page?.id === pageId;
  if ((source.pages || []).some(page => matches(page) && hasDirectPlayerAccess(page, playerId))) {
    return true;
  }

  const visit = (category) => {
    if ((category.pages || []).some(page =>
      matches(page) && hasDirectPlayerAccess(page, playerId)
    )) return true;
    return (category.categories || []).some(child => visit(child));
  };

  return (source.categories || []).some(category => visit(category));
}
