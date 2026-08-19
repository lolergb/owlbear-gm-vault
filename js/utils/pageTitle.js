/**
 * Helpers compartidos para resolver títulos de páginas.
 *
 * Notion puede devolver títulos vacíos o el placeholder "Untitled" en algunos
 * contextos (mentions, tablas y páginas enlazadas). Estos helpers evitan que
 * cada renderer o servicio aplique una regla distinta.
 */

export const PAGE_TITLE_FALLBACK = 'Page';

const PLACEHOLDER_TITLES = new Set(['untitled', 'page']);

/**
 * Normaliza un candidato sin modificar su contenido interno.
 * @param {*} value
 * @returns {string}
 */
export function normalizePageTitle(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Indica si un valor no contiene un título real.
 * @param {*} value
 * @returns {boolean}
 */
export function isPlaceholderPageTitle(value) {
  const normalized = normalizePageTitle(value);
  return !normalized || PLACEHOLDER_TITLES.has(normalized.toLowerCase());
}

/**
 * Devuelve el primer título real de la lista, o null si ninguno es válido.
 * El orden de los candidatos expresa su prioridad.
 * @param  {...*} candidates
 * @returns {string|null}
 */
export function getUsablePageTitle(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizePageTitle(candidate);
    if (!isPlaceholderPageTitle(normalized)) return normalized;
  }
  return null;
}

/**
 * Resuelve un título seguro para mostrar en la interfaz.
 * @param  {...*} candidates
 * @returns {string}
 */
export function resolvePageTitle(...candidates) {
  return getUsablePageTitle(...candidates) || PAGE_TITLE_FALLBACK;
}

/**
 * Repara una página que todavía conserva un placeholder.
 * Solo modifica títulos inválidos; nunca sobrescribe un nombre válido.
 * @param {Object|null} page
 * @param  {...*} candidates
 * @returns {{ title: string, changed: boolean }}
 */
export function repairPageTitle(page, ...candidates) {
  const title = resolvePageTitle(...candidates, page?.name);
  const canRepair = page && isPlaceholderPageTitle(page.name) && title !== PAGE_TITLE_FALLBACK;

  if (canRepair) page.name = title;

  return { title, changed: Boolean(canRepair) };
}

