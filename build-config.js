#!/usr/bin/env node

/**
 * Script para generar config.js desde variables de entorno
 * Útil para Netlify, Vercel u otros servicios con variables de entorno
 * 
 * Uso:
 *   NOTION_API_TOKEN=tu_token node build-config.js
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN || '';
const NOTION_API_BASE = process.env.NOTION_API_BASE || 'https://api.notion.com/v1';

if (!NOTION_API_TOKEN) {
  console.error('❌ Error: NOTION_API_TOKEN no está definido en las variables de entorno');
  process.exit(1);
}

// El token ya no se incluye en config.js - se usa Netlify Function como proxy
const configContent = `// Configuración generada automáticamente desde variables de entorno
// ⚠️ Este archivo se genera en build time, NO lo edites manualmente
// El token se mantiene seguro en el servidor usando Netlify Functions

export const NOTION_API_BASE = "${NOTION_API_BASE}";

// Configuración de páginas de Notion
export const NOTION_PAGES = [
  {
    name: "Ganar Tiempo",
    url: "https://solid-jingle-6ee.notion.site/Ganar-Tiempo-2ccd4856c90e80febdfcd5fdfc08d0fd"
  },
  {
    name: "Espíritu de las Sombras",
    url: "https://solid-jingle-6ee.notion.site/Esp-ritu-de-las-Sombras-2b3d4856c90e81a9aef1df8eba748244"
  }
];
`;

const configPath = join(__dirname, 'config.js');
writeFileSync(configPath, configContent, 'utf8');

console.log('✅ config.js generado exitosamente desde variables de entorno');

