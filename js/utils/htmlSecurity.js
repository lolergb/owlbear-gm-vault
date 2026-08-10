/**
 * Security helpers for HTML assembled from external content.
 *
 * Escaping and URL validation are deliberately separate: HTML escaping stops
 * markup injection, while URL validation rejects executable protocols such as
 * javascript: and data:.
 */

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const SAFE_RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/\s]+={0,2})$/i;
const FORBIDDEN_CSS_TOKENS = /(?:url\s*\(|expression\s*\(|@import|javascript\s*:|data\s*:|vbscript\s*:|\\)/i;

const ALLOWED_NOTION_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'BUTTON', 'CODE', 'DETAILS', 'DIV', 'EM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'IFRAME', 'IMG', 'INPUT',
  'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'SUMMARY', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'VIDEO'
]);

const DROP_WITH_CONTENT_TAGS = new Set([
  'BASE', 'EMBED', 'FORM', 'LINK', 'MATH', 'META', 'OBJECT', 'SCRIPT',
  'STYLE', 'SVG', 'TEMPLATE'
]);

const GLOBAL_ATTRIBUTES = new Set([
  'class', 'hidden', 'role', 'tabindex', 'title'
]);

const TAG_ATTRIBUTES = {
  A: new Set(['href', 'rel', 'target']),
  BUTTON: new Set(['disabled', 'type']),
  DETAILS: new Set(['open']),
  IFRAME: new Set([
    'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy',
    'sandbox', 'src', 'title'
  ]),
  IMG: new Set(['alt', 'height', 'loading', 'src', 'width']),
  INPUT: new Set(['checked', 'disabled', 'type']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan']),
  TIME: new Set(['datetime']),
  VIDEO: new Set(['controls', 'height', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src', 'width'])
};

const URL_DATA_ATTRIBUTES = new Set([
  'data-image-url',
  'data-mention-page-url',
  'data-video-url'
]);

/**
 * Escape a value for an HTML text or quoted-attribute context.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeUrl(value, allowedProtocols, { allowRelative = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw || CONTROL_CHARACTERS.test(raw)) return '';

  try {
    if (allowRelative && !/^[a-z][a-z\d+.-]*:/i.test(raw)) {
      const base = globalThis.location?.origin || 'https://gm-vault.invalid';
      const parsedRelative = new URL(raw, `${base}/`);
      if (!HTTP_PROTOCOLS.has(parsedRelative.protocol.toLowerCase())) return '';
      return parsedRelative.href;
    }

    const parsed = new URL(raw);
    if (!allowedProtocols.has(parsed.protocol.toLowerCase())) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** Only absolute HTTP(S) URLs are valid for remote media and embeds. */
export function sanitizeHttpUrl(value) {
  return normalizeUrl(value, HTTP_PROTOCOLS);
}

/** HTTP(S), mailto and tel are valid for user-facing links. */
export function sanitizeLinkUrl(value) {
  return normalizeUrl(value, LINK_PROTOCOLS);
}

/** Only the embed endpoints produced by GM Vault are valid video frames. */
export function sanitizeVideoEmbedUrl(value) {
  const safeUrl = sanitizeHttpUrl(value);
  if (!safeUrl) return '';

  try {
    const parsed = new URL(safeUrl);
    if (parsed.protocol !== 'https:') return '';
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (
      (hostname === 'youtube.com' || hostname === 'youtube-nocookie.com') &&
      /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname)
    ) {
      return parsed.href;
    }

    if (hostname === 'player.vimeo.com' && /^\/video\/\d+\/?$/.test(parsed.pathname)) {
      return parsed.href;
    }
  } catch {
    // Fall through to the common rejection below.
  }

  return '';
}

/** Only the Google preview endpoints produced by GM Vault are valid document frames. */
export function sanitizeGoogleEmbedUrl(value) {
  const safeUrl = sanitizeHttpUrl(value);
  if (!safeUrl) return '';

  try {
    const parsed = new URL(safeUrl);
    if (parsed.protocol !== 'https:') return '';
    const hostname = parsed.hostname.toLowerCase();
    const safeId = '[A-Za-z0-9_-]+';
    const docsPath = new RegExp(`^/(?:presentation|spreadsheets|document)/d/${safeId}/(?:embed|preview)/?$`);
    const drivePath = new RegExp(`^/file/d/${safeId}/preview/?$`);

    if (hostname === 'docs.google.com' && docsPath.test(parsed.pathname)) return parsed.href;
    if (hostname === 'drive.google.com' && drivePath.test(parsed.pathname)) return parsed.href;
  } catch {
    // Fall through to the common rejection below.
  }

  return '';
}

/** HTTPS iframe URL that cannot share the extension's storage origin. */
export function sanitizeExternalIframeUrl(
  value,
  currentOrigin = globalThis.location?.origin
) {
  const safeUrl = sanitizeHttpUrl(value);
  if (!safeUrl) return '';

  try {
    const parsed = new URL(safeUrl);
    if (parsed.protocol !== 'https:') return '';
    if (currentOrigin && parsed.origin === currentOrigin) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function sanitizeResourceUrl(value) {
  return normalizeUrl(value, HTTP_PROTOCOLS, { allowRelative: true });
}

/**
 * Embedded local-first exports may contain raster images encoded as base64.
 * SVG is intentionally excluded because it can carry active content.
 */
function sanitizeImageResourceUrl(value, { allowRasterDataImages = false } = {}) {
  const raw = String(value ?? '').trim();
  if (allowRasterDataImages) {
    const match = raw.match(SAFE_RASTER_DATA_URL);
    if (match) {
      const header = raw.slice(0, raw.indexOf(',') + 1);
      return header + match[1].replace(/\s/g, '');
    }
  }
  return sanitizeResourceUrl(raw);
}

/** HTTP(S), relative URLs and raster-only base64 data URLs for image contexts. */
export function sanitizeImageUrl(value) {
  return sanitizeImageResourceUrl(value, { allowRasterDataImages: true });
}

function isAllowedAttribute(element, name) {
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  if (name.startsWith('aria-') || name.startsWith('data-')) return true;
  return TAG_ATTRIBUTES[element.tagName]?.has(name) === true;
}

function sanitizeColumnStyle(element, value) {
  if (element.tagName !== 'DIV') return '';
  const match = String(value).match(/^\s*--column-count\s*:\s*(\d{1,2})\s*;?\s*$/);
  if (!match) return '';
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > 20) return '';
  return `--column-count: ${count}`;
}

function isSafeLength(value, { allowAuto = false, allowPercent = false } = {}) {
  const normalized = String(value).trim().toLowerCase();
  if (allowAuto && normalized === 'auto') return true;
  if (normalized === '0') return true;
  const pixelMatch = normalized.match(/^(\d+(?:\.\d+)?)px$/);
  if (pixelMatch && Number(pixelMatch[1]) <= 200) return true;
  const percentMatch = allowPercent && normalized.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentMatch && Number(percentMatch[1]) <= 100) return true;
  return false;
}

function isSafeSpacing(value) {
  const parts = String(value).trim().split(/\s+/);
  return parts.length >= 1 && parts.length <= 4 && parts.every(part => isSafeLength(part));
}

function isSafeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value).trim());
}

/**
 * Preserve the small, non-executable subset of inline CSS emitted by the
 * Obsidian exporter. Values are validated per property; CSS functions, URLs,
 * escapes and at-rules never cross this boundary.
 */
function sanitizeEmbeddedStyle(element, value) {
  const raw = String(value ?? '').trim();
  if (!raw || FORBIDDEN_CSS_TOKENS.test(raw)) return '';

  const safeDeclarations = [];
  const declarations = raw.split(';').map(part => part.trim()).filter(Boolean);

  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim().toLowerCase();
    let safe = false;

    switch (property) {
      case '--column-count': {
        const count = /^\d{1,2}$/.test(propertyValue) ? Number(propertyValue) : 0;
        safe = element.tagName === 'DIV' && count >= 1 && count <= 20;
        break;
      }
      case 'padding':
      case 'margin':
        safe = isSafeSpacing(propertyValue);
        break;
      case 'margin-bottom':
      case 'gap':
      case 'border-radius':
      case 'font-size':
        safe = isSafeLength(propertyValue);
        break;
      case 'width':
      case 'height':
        safe = isSafeLength(propertyValue, { allowAuto: true, allowPercent: true });
        break;
      case 'background':
      case 'background-color':
      case 'color':
        safe = isSafeColor(propertyValue);
        break;
      case 'border-left':
        safe = /^(?:\d|[1-9]\d|20)(?:\.\d+)?px\s+solid\s+#[0-9a-f]{3,8}$/i.test(propertyValue);
        break;
      case 'text-align':
        safe = /^(?:left|right|center|start|end)$/.test(propertyValue);
        break;
      case 'display':
        safe = /^(?:flex|inline-block)$/.test(propertyValue);
        break;
      case 'flex':
        safe = /^(?:0|1|2|3|4)$/.test(propertyValue);
        break;
      case 'position':
        safe = propertyValue === 'relative';
        break;
      case 'object-fit':
        safe = /^(?:contain|cover)$/.test(propertyValue);
        break;
      case 'cursor':
        safe = /^(?:default|pointer)$/.test(propertyValue);
        break;
      case 'pointer-events':
        safe = /^(?:auto|none)$/.test(propertyValue);
        break;
      default:
        safe = false;
    }

    if (safe) safeDeclarations.push(`${property}: ${propertyValue}`);
  }

  return safeDeclarations.join('; ');
}

function sanitizeElementAttributes(
  element,
  { allowEmbeddedStyles = false, allowRasterDataImages = false } = {}
) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    let value = attribute.value;

    if (name.startsWith('on') || name === 'srcdoc') {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === 'style') {
      const safeStyle = allowEmbeddedStyles
        ? sanitizeEmbeddedStyle(element, value)
        : sanitizeColumnStyle(element, value);
      if (safeStyle) element.setAttribute('style', safeStyle);
      else element.removeAttribute(attribute.name);
      continue;
    }

    if (!isAllowedAttribute(element, name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (name === 'href') {
      value = sanitizeLinkUrl(value);
    } else if (name === 'src' || name === 'poster') {
      if (element.tagName === 'IFRAME' && name === 'src') {
        // Iframes must be absolute HTTPS resources outside the extension's
        // own origin. Otherwise a same-origin viewer can become an XSS gadget
        // when combined with allow-scripts/allow-same-origin.
        value = sanitizeExternalIframeUrl(value);
      } else {
        value = element.tagName === 'IMG' && name === 'src'
          ? sanitizeImageResourceUrl(value, { allowRasterDataImages })
          : sanitizeResourceUrl(value);
      }
    } else if (URL_DATA_ATTRIBUTES.has(name)) {
      value = name === 'data-image-url'
        ? sanitizeImageResourceUrl(value, { allowRasterDataImages })
        : sanitizeResourceUrl(value);
    }

    if ((name === 'href' || name === 'src' || name === 'poster' || URL_DATA_ATTRIBUTES.has(name)) && !value) {
      element.removeAttribute(attribute.name);
      continue;
    }

    element.setAttribute(attribute.name, value);
  }

  if (element.tagName === 'A' && element.hasAttribute('href')) {
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
  }

  if (element.tagName === 'BUTTON') {
    element.setAttribute('type', 'button');
  }

  if (element.tagName === 'INPUT') {
    if (element.getAttribute('type') !== 'checkbox') element.setAttribute('type', 'checkbox');
    element.setAttribute('disabled', '');
  }

  if (element.tagName === 'IFRAME') {
    if (!element.hasAttribute('src')) {
      element.remove();
      return;
    }
    const frameUrl = element.getAttribute('src');
    const trustedEmbed = sanitizeVideoEmbedUrl(frameUrl) || sanitizeGoogleEmbedUrl(frameUrl);
    const sandboxTokens = [
      'allow-scripts',
      'allow-forms',
      'allow-popups',
      'allow-presentation'
    ];
    // Generic embeds remain on an opaque origin even after redirects. The
    // stricter Google/Vimeo/YouTube allowlists may keep their own origin so
    // their official players can access cookies/storage required to work.
    if (trustedEmbed) sandboxTokens.push('allow-same-origin');
    element.setAttribute('sandbox', sandboxTokens.join(' '));
    element.setAttribute('referrerpolicy', 'no-referrer');
    element.setAttribute('loading', 'lazy');
  }
}

/**
 * Sanitize a complete Notion HTML fragment at the DOM insertion boundary.
 * This also protects players from HTML created by an older GM client and from
 * stale in-memory cache entries produced before output escaping was added.
 * @param {*} html
 * @returns {string}
 */
function sanitizeHtmlFragment(html, options = {}) {
  const source = String(html ?? '');
  if (!globalThis.document?.createElement) return escapeHtml(source);

  const template = document.createElement('template');
  template.innerHTML = source;
  const elements = Array.from(template.content.querySelectorAll('*')).reverse();

  for (const element of elements) {
    if (DROP_WITH_CONTENT_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }

    if (!ALLOWED_NOTION_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    sanitizeElementAttributes(element, options);
  }

  return template.innerHTML;
}

export function sanitizeNotionHtml(html) {
  return sanitizeHtmlFragment(html);
}

/**
 * Sanitize local-first HTML while preserving the safe presentation subset
 * emitted by the Obsidian exporter (raster base64 images and simple layout
 * declarations). It remains safe for untrusted broadcast/session payloads.
 * @param {*} html
 * @returns {string}
 */
export function sanitizeEmbeddedHtml(html) {
  return sanitizeHtmlFragment(html, {
    allowEmbeddedStyles: true,
    allowRasterDataImages: true
  });
}
