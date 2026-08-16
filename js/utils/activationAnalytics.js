/**
 * Helpers for activation analytics.
 *
 * Content origin is deliberately a small controlled enum. This lets Mixpanel
 * separate bundled examples from content created by a GM without sending page
 * names or full URLs as part of the activation events.
 */

export const CONTENT_ORIGINS = Object.freeze({
  DEMO: 'demo',
  USER: 'user',
  IMPORT: 'import'
});

const VALID_CONTENT_ORIGINS = new Set(Object.values(CONTENT_ORIGINS));

// Older installs persisted the bundled configuration before pages had an
// explicit origin. These public URLs let us migrate those pages in memory.
const BUNDLED_DEMO_URLS = new Set([
  'https://app.notion.com/p/Quick-Start-Beta-3b8d4856c90e8092aa7fd83915f6e55e?source=copy_link',
  'https://www.5esrd.com/wp-content/uploads/2016/12/DeanSpencer-elfrogue-reduced.png',
  'https://www.5esrd.com/gamemastering/monsters-foes/monsters-by-type/humanoids/goblin/',
  'https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf',
  'https://www.notion.so/Session-Notes-Template-2d8d4856c90e806eb8fffd6f055eaf3b',
  'https://www.notion.so/Scene-The-Watched-Crossroads-2d8d4856c90e804185b4cf910d4817c1',
  'https://www.notion.so/Maera-Manos-Secas-2d8d4856c90e8030b014dbbb7bf5306d',
  'https://docs.google.com/presentation/d/1oIMHW9qRPMSauD16w6uxTbRBtSZGaTBWC57OnM7MKnU',
  'https://docs.google.com/spreadsheets/d/1YG2RgqGYro4nedTnCiaaUxDHGHoyxSQlLtqUAGua010',
  'https://docs.google.com/document/d/1tza3tqn9gAFn5ppfm4eR2oz5JSAvXMa0LZ-EpJaQ7n0',
  'https://vimeo.com/253905163',
  'https://www.youtube.com/watch?v=YE7VzlLtp-4'
]);

export function isBundledDemoUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (BUNDLED_DEMO_URLS.has(url)) return true;

  try {
    const parsed = new URL(url, 'https://owlbear-gm-vault.netlify.app');
    return parsed.pathname.includes('/content-demo/');
  } catch {
    return url.includes('content-demo/');
  }
}

export function normalizeContentOrigin(origin, url = '') {
  const normalized = String(origin || '').toLowerCase();
  if (VALID_CONTENT_ORIGINS.has(normalized)) return normalized;
  return isBundledDemoUrl(url) ? CONTENT_ORIGINS.DEMO : CONTENT_ORIGINS.USER;
}

export function getVaultState(config) {
  const pages = config?.getAllPages?.() || [];
  if (pages.length === 0) return 'empty';
  return pages.every((page) => normalizeContentOrigin(page?.origin, page?.url) === CONTENT_ORIGINS.DEMO)
    ? 'demo'
    : 'configured';
}

/** Mark imported page trees in either legacy (pages/categories) or items format. */
export function markContentOrigin(categories = [], pages = [], origin = CONTENT_ORIGINS.IMPORT) {
  const safeOrigin = normalizeContentOrigin(origin);
  const markPage = (page) => {
    if (page && typeof page === 'object') page.origin = safeOrigin;
  };
  const walkCategory = (category) => {
    if (!category || typeof category !== 'object') return;
    (category.pages || []).forEach(markPage);
    (category.categories || []).forEach(walkCategory);
    (category.items || []).forEach((item) => {
      if (item?.type === 'page') markPage(item);
      else if (item?.type === 'category') walkCategory(item);
    });
  };

  (pages || []).forEach(markPage);
  (categories || []).forEach(walkCategory);
}
