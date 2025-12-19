import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@1/dist/index.esm.js";

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
      
      button.addEventListener("click", async () => {
        try {
          console.log("Abriendo modal con URL:", page.url);
          console.log("Dimensiones del modal:", {
            width: Math.min(window.innerWidth * 0.9, 1200),
            height: Math.min(window.innerHeight * 0.9, 800)
          });
          
          // Intentar abrir en modal primero
          try {
            const modalResult = await OBR.modal.open({
              id: `notion-modal-${index}`,
              url: page.url,
              width: Math.min(window.innerWidth * 0.9, 1200),
              height: Math.min(window.innerHeight * 0.9, 800)
            });
            
            console.log("Modal abierto exitosamente:", modalResult);
            
            // Verificar si el modal se cargó correctamente después de un breve delay
            setTimeout(() => {
              console.log("Verificando estado del modal después de 2 segundos...");
            }, 2000);
            
          } catch (modalError) {
            console.warn("Error al abrir modal, intentando alternativa:", modalError);
            // Si el modal falla, ofrecer abrir en nueva ventana
            const openInNewWindow = confirm(
              "No se pudo abrir Notion en el modal (Notion bloquea iframes).\n\n" +
              "¿Deseas abrirlo en una nueva ventana?"
            );
            
            if (openInNewWindow) {
              window.open(page.url, '_blank', 'noopener,noreferrer');
            }
          }
        } catch (error) {
          console.error("Error general al abrir página:", error);
          console.error("Detalles del error:", {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
          
          // Ofrecer abrir en nueva ventana como alternativa
          const openInNewWindow = confirm(
            `Error al abrir la página de Notion: ${error.message}\n\n` +
            "Notion bloquea el embedding en iframes por seguridad.\n\n" +
            "¿Deseas abrirlo en una nueva ventana?"
          );
          
          if (openInNewWindow) {
            window.open(page.url, '_blank', 'noopener,noreferrer');
          }
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

