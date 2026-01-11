/**
 * @fileoverview Constantes globales de la extensión GM Vault
 * 
 * Este módulo centraliza todas las constantes usadas en la aplicación.
 * Agrupa las constantes por funcionalidad para facilitar su uso.
 */

// ============================================
// STORAGE KEYS
// ============================================
export const STORAGE_KEY_PREFIX = 'notion-pages-json-';
export const TOKEN_STORAGE_PREFIX = 'notion-user-token-';
export const GLOBAL_TOKEN_KEY = 'notion-global-token';
export const ANALYTICS_CONSENT_KEY = 'analytics_consent';

// ============================================
// CACHE KEYS
// ============================================
export const CACHE_PREFIX = 'notion-blocks-cache-';
export const PAGE_INFO_CACHE_PREFIX = 'notion-page-info-cache-';

// ============================================
// ROOM METADATA KEYS
// ============================================
export const ROOM_METADATA_KEY = 'com.dmscreen/pagesConfig';
export const ROOM_CONTENT_CACHE_KEY = 'com.dmscreen/contentCache';
export const ROOM_HTML_CACHE_KEY = 'com.dmscreen/htmlCache';
export const FULL_CONFIG_KEY = 'com.dmscreen/fullConfig';
export const VAULT_OWNER_KEY = 'com.dmscreen/vaultOwner';
export const METADATA_KEY = 'com.dmscreen';

// ============================================
// BROADCAST CHANNELS
// ============================================
export const BROADCAST_CHANNEL_REQUEST = 'com.dmscreen/requestContent';
export const BROADCAST_CHANNEL_RESPONSE = 'com.dmscreen/responseContent';
export const BROADCAST_CHANNEL_VISIBLE_PAGES = 'com.dmscreen/visiblePages';
export const BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES = 'com.dmscreen/requestVisiblePages';
export const BROADCAST_CHANNEL_SHOW_IMAGE = 'com.dmscreen/showImage';
export const BROADCAST_CHANNEL_REQUEST_FULL_VAULT = 'com.dmscreen/requestFullVault';
export const BROADCAST_CHANNEL_RESPONSE_FULL_VAULT = 'com.dmscreen/responseFullVault';

// ============================================
// TIMEOUTS Y LÍMITES
// ============================================
export const OWNER_HEARTBEAT_INTERVAL = 120000; // 2 minutos
export const OWNER_TIMEOUT = 900000; // 15 minutos
export const ROOM_METADATA_SIZE_LIMIT = 16 * 1024; // 16384 bytes
export const ROOM_METADATA_SAFE_LIMIT = ROOM_METADATA_SIZE_LIMIT - 1024; // Dejar 1KB de margen
export const MAX_METADATA_SIZE = ROOM_METADATA_SIZE_LIMIT; // Alias

// ============================================
// CSS VARIABLES
// ============================================
export const CSS_VARS = {
  '--card-bg': '48, 46, 42',
  '--card-bg-rgb': '48, 46, 42',
  '--text-primary': '#1e201c',
  '--text-secondary': '#6e746b',
  '--text-link': '#7BAFD4',
  '--bg-surface': '#e6e2dc',
  '--bg-main': '#f5f2ed',
};

// ============================================
// NOTION BLOCK TYPES
// ============================================
export const NOTION_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2', 
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'code',
  'image',
  'video',
  'bookmark',
  'divider',
  'table',
  'table_row',
  'column_list',
  'column',
  'link_preview',
  'synced_block',
  'child_page',
  'child_database',
];

// ============================================
// EXPORT AGRUPADO
// ============================================
export const STORAGE = {
  KEY_PREFIX: STORAGE_KEY_PREFIX,
  TOKEN_PREFIX: TOKEN_STORAGE_PREFIX,
  GLOBAL_TOKEN: GLOBAL_TOKEN_KEY,
  ANALYTICS_CONSENT: ANALYTICS_CONSENT_KEY,
  CACHE_PREFIX,
  PAGE_INFO_CACHE_PREFIX,
};

export const METADATA = {
  ROOM_KEY: ROOM_METADATA_KEY,
  CONTENT_CACHE: ROOM_CONTENT_CACHE_KEY,
  HTML_CACHE: ROOM_HTML_CACHE_KEY,
  FULL_CONFIG: FULL_CONFIG_KEY,
  VAULT_OWNER: VAULT_OWNER_KEY,
  KEY: METADATA_KEY,
};

export const BROADCAST = {
  REQUEST: BROADCAST_CHANNEL_REQUEST,
  RESPONSE: BROADCAST_CHANNEL_RESPONSE,
  VISIBLE_PAGES: BROADCAST_CHANNEL_VISIBLE_PAGES,
  REQUEST_VISIBLE_PAGES: BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES,
  SHOW_IMAGE: BROADCAST_CHANNEL_SHOW_IMAGE,
};

export const LIMITS = {
  METADATA_SIZE: ROOM_METADATA_SIZE_LIMIT,
  METADATA_SAFE: ROOM_METADATA_SAFE_LIMIT,
  MAX_METADATA: MAX_METADATA_SIZE,
  OWNER_HEARTBEAT: OWNER_HEARTBEAT_INTERVAL,
  OWNER_TIMEOUT,
};

