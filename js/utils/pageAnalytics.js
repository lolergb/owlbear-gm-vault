const CREATION_METHODS = new Set(['manual', 'notion', 'url', 'file']);

function isPrivateOrLocalHostname(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
  if (hostname === '::1' || hostname === '[::1]') return true;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const first = Number(ipv4[1]);
  const second = Number(ipv4[2]);
  return first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function normalizeAnalyticsDomain(hostname) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');

  if (!normalized) return 'unknown';
  if (isPrivateOrLocalHostname(normalized)) return 'private_or_local';

  // Avoid exposing tenant/workspace subdomains for common hosted providers.
  if (normalized === 'notion.site' || normalized.endsWith('.notion.site')) return 'notion.site';
  if (normalized === 'notion.so' || normalized.endsWith('.notion.so')) return 'notion.so';
  if (normalized === 'sharepoint.com' || normalized.endsWith('.sharepoint.com')) return 'sharepoint.com';
  if (normalized === 'googleusercontent.com' || normalized.endsWith('.googleusercontent.com')) {
    return 'googleusercontent.com';
  }

  return normalized.slice(0, 120);
}

function classifyEmbedProvider(parsedUrl, pageType) {
  const hostname = parsedUrl?.hostname?.toLowerCase() || '';
  const pathname = parsedUrl?.pathname?.toLowerCase() || '';

  if (
    hostname === '1drv.ms' ||
    hostname === 'onedrive.live.com' ||
    hostname.endsWith('.sharepoint.com') ||
    pageType === 'onedrive'
  ) {
    return 'onedrive';
  }

  if (
    hostname.startsWith('maps.google.') ||
    (hostname.endsWith('google.com') && pathname.startsWith('/maps'))
  ) {
    return 'maps';
  }

  if (
    hostname === 'docs.google.com' ||
    hostname === 'drive.google.com' ||
    hostname.endsWith('.googleusercontent.com') ||
    pageType === 'google_doc'
  ) {
    return 'google';
  }

  if (
    hostname.endsWith('notion.so') ||
    hostname.endsWith('notion.site') ||
    pageType === 'notion'
  ) {
    return 'notion';
  }

  if (hostname === 'youtu.be' || hostname.endsWith('youtube.com')) return 'youtube';
  if (hostname.endsWith('vimeo.com')) return 'vimeo';
  if (parsedUrl) return 'generic_web';
  return 'other';
}

/**
 * Build low-cardinality, privacy-conscious metadata for page creation analytics.
 * The full URL is intentionally never returned.
 */
export function buildPageAddedMetadata({
  url,
  pageType = 'unknown',
  creationMethod = 'manual',
  isEmbedCode = false
} = {}) {
  let parsedUrl = null;
  try {
    const candidate = new URL(String(url || ''));
    if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
      parsedUrl = candidate;
    }
  } catch {
    // Invalid or absent URLs are represented with controlled fallback values.
  }

  return {
    url_domain: parsedUrl ? normalizeAnalyticsDomain(parsedUrl.hostname) : 'unknown',
    embed_provider: classifyEmbedProvider(parsedUrl, pageType),
    creation_method: CREATION_METHODS.has(creationMethod) ? creationMethod : 'unknown',
    is_embed_code: Boolean(isEmbedCode)
  };
}
