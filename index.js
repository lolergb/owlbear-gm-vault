// OBR se carga desde el CDN en index.html
const OBR = window.OBR;

// Configuración de páginas de Notion
// Agrega aquí tus páginas públicas de Notion
const NOTION_PAGES = [
  {
    name: "Ganar Tiempo",
    url: "https://solid-jingle-6ee.notion.site/Ganar-Tiempo-2ccd4856c90e80febdfcd5fdfc08d0fd"
  }
  // Agrega más páginas aquí:
  // {
  //   name: "Otra Aventura",
  //   url: "https://tu-notion.notion.site/Tu-Pagina-..."
  // }
];

OBR.onReady(() => {
  const pageList = document.getElementById("page-list");

  if (NOTION_PAGES.length === 0) {
    pageList.innerHTML = `
      <div class="empty-state">
        <p>No hay páginas configuradas</p>
        <p>Edita <code>index.js</code> para agregar tus páginas de Notion</p>
      </div>
    `;
    return;
  }

  // Crear botones para cada página
  NOTION_PAGES.forEach((page, index) => {
    const button = document.createElement("button");
    button.className = "page-button";
    button.innerHTML = `
      <div class="page-name">${page.name}</div>
      <div class="page-url">${page.url}</div>
    `;
    
    button.addEventListener("click", async () => {
      try {
        await OBR.modal.open({
          id: `notion-modal-${index}`,
          url: page.url,
          width: Math.min(window.innerWidth * 0.9, 1200),
          height: Math.min(window.innerHeight * 0.9, 800),
          fullscreen: false
        });
      } catch (error) {
        console.error("Error al abrir modal:", error);
        alert("Error al abrir la página de Notion. Verifica que la URL sea pública.");
      }
    });

    pageList.appendChild(button);
  });
});

