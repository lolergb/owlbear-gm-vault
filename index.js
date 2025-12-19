import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

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

// Manejo de errores global para capturar problemas de carga
window.addEventListener('error', (event) => {
  console.error('Error global:', event.error);
  if (event.message && event.message.includes('fetch')) {
    console.error('Error de fetch detectado:', event.message);
  }
});

// Manejo de errores no capturados
window.addEventListener('unhandledrejection', (event) => {
  console.error('Promesa rechazada no manejada:', event.reason);
  if (event.reason && event.reason.message && event.reason.message.includes('fetch')) {
    console.error('Error de fetch en promesa rechazada:', event.reason);
  }
});

// Intentar inicializar Owlbear con manejo de errores
try {
  OBR.onReady(() => {
    console.log('Owlbear SDK listo');
    console.log('URL actual:', window.location.href);
    console.log('Origen:', window.location.origin);
    
    const pageList = document.getElementById("page-list");

    if (!pageList) {
      console.error('No se encontró el elemento page-list');
      return;
    }

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
      
      button.addEventListener("click", () => {
        console.log("Cargando Notion en el popover:", page.url);
        
        // Obtener elementos
        const pageList = document.getElementById("page-list");
        const notionContainer = document.getElementById("notion-container");
        const backButton = document.getElementById("back-button");
        const pageTitle = document.getElementById("page-title");
        const notionIframe = document.getElementById("notion-iframe");
        
        if (pageList && notionContainer && backButton && pageTitle && notionIframe) {
          // Ocultar lista y mostrar contenedor de Notion
          pageList.classList.add("hidden");
          notionContainer.classList.remove("hidden");
          backButton.classList.remove("hidden");
          pageTitle.textContent = page.name;
          
          // Cargar el iframe con la URL de Notion
          notionIframe.src = page.url;
          
          // Configurar el botón de volver (solo una vez)
          if (!backButton.dataset.listenerAdded) {
            backButton.addEventListener("click", () => {
              // Volver a mostrar la lista
              pageList.classList.remove("hidden");
              notionContainer.classList.add("hidden");
              backButton.classList.add("hidden");
              pageTitle.textContent = "📚 Páginas de Notion";
              notionIframe.src = "";
            });
            backButton.dataset.listenerAdded = "true";
          }
        } else {
          console.error("No se encontraron los elementos necesarios");
          // Fallback: abrir en nueva ventana
          window.open(page.url, '_blank', 'noopener,noreferrer');
        }
      });

      pageList.appendChild(button);
    });
  });
} catch (error) {
  console.error('Error al cargar el SDK de Owlbear:', error);
  const pageList = document.getElementById("page-list");
  if (pageList) {
    pageList.innerHTML = `
      <div class="empty-state">
        <p>Error crítico al cargar la extensión</p>
        <p>Verifica la consola para más detalles</p>
        <p style="font-size: 11px; margin-top: 8px; color: #888;">${error.message || 'Error desconocido'}</p>
      </div>
    `;
  }
}

