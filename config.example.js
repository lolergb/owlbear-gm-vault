// Ejemplo de configuración
// Copia este archivo a config.js y completa con tus datos
// ⚠️ NO subas config.js a GitHub (está en .gitignore)

// Configuración de la API de Notion
// NOTA: En producción (Netlify), el token se usa en el servidor (Netlify Functions)
// Solo necesitas el token aquí para desarrollo local
export const NOTION_API_TOKEN = "tu_token_de_notion_aqui"; // Solo para desarrollo local
export const NOTION_API_BASE = "https://api.notion.com/v1";

// Configuración de páginas de Notion
export const NOTION_PAGES = [
  {
    name: "Ganar Tiempo",
    url: "https://solid-jingle-6ee.notion.site/Ganar-Tiempo-2ccd4856c90e80febdfcd5fdfc08d0fd"
  },
  {
    name: "Otra Aventura",
    url: "https://tu-notion.notion.site/Otra-Pagina-..."
  },
  {
    name: "Encuentros",
    url: "https://tu-notion.notion.site/Encuentros-..."
  }
];
