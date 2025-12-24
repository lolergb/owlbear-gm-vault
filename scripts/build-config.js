#!/usr/bin/env node

/**
 * Script para generar config.js desde variables de entorno
 * Útil para Netlify, Vercel u otros servicios con variables de entorno
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NOTION_API_BASE = process.env.NOTION_API_BASE || 'https://api.notion.com/v1';

const configContent = `// Configuración generada automáticamente desde variables de entorno
// ⚠️ Este archivo se genera en build time, NO lo edites manualmente

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

const configPath = join(__dirname, '..', 'config', 'config.js');
writeFileSync(configPath, configContent, 'utf8');

console.log('✅ config.js generado exitosamente desde variables de entorno');

