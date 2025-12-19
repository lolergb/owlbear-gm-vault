console.log('🚀 Iniciando carga de index.js...');

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

console.log('✅ OBR SDK importado');

// Importar configuración
// Si config.js no existe, copia config.example.js a config.js y completa los datos
import { 
  NOTION_API_TOKEN, 
  NOTION_API_BASE, 
  NOTION_PAGES 
} from "./config.js";

// Verificar que las páginas se cargaron correctamente
console.log('✅ Config.js cargado');
console.log('📄 Páginas importadas:', NOTION_PAGES?.length || 0);
if (NOTION_PAGES && NOTION_PAGES.length > 0) {
  console.log('📝 Nombres de páginas:', NOTION_PAGES.map(p => p.name));
  console.log('🔗 URLs:', NOTION_PAGES.map(p => p.url));
} else {
  console.warn('⚠️ No se encontraron páginas en config.js');
}

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

// Función para extraer el ID de página desde una URL de Notion
function extractNotionPageId(url) {
  try {
    // Formato: https://workspace.notion.site/Title-{32-char-id}?params
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('-');
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      // El ID tiene 32 caracteres hexadecimales
      if (lastPart && lastPart.length >= 32) {
        const pageId = lastPart.substring(0, 32);
        // Convertir a formato UUID con guiones
        return `${pageId.substring(0, 8)}-${pageId.substring(8, 12)}-${pageId.substring(12, 16)}-${pageId.substring(16, 20)}-${pageId.substring(20, 32)}`;
      }
    }
    return null;
  } catch (e) {
    console.error('Error al extraer ID de Notion:', e);
    return null;
  }
}

// Función para obtener bloques de una página de Notion
async function fetchNotionBlocks(pageId) {
  // Verificar que el token esté configurado
  if (!NOTION_API_TOKEN || NOTION_API_TOKEN === 'tu_token_de_notion_aqui') {
    throw new Error('El token de la API de Notion no está configurado. Edita config.js y agrega tu token.');
  }

  try {
    const response = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_API_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 401) {
        throw new Error('Token inválido o sin permisos. Verifica que el token en config.js sea correcto y que la integración tenga acceso a esta página.');
      } else if (response.status === 404) {
        throw new Error('Página no encontrada. Verifica que la URL sea correcta y que la integración tenga acceso.');
      } else {
        throw new Error(`Error de API: ${response.status} - ${errorData.message || response.statusText}`);
      }
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Error al obtener bloques de Notion:', error);
    throw error;
  }
}

// Función para renderizar texto con formato
function renderRichText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) return '';
  
  return richTextArray.map(text => {
    let content = text.plain_text || '';
    
    if (text.annotations) {
      if (text.annotations.bold) content = `<strong class="notion-text-bold">${content}</strong>`;
      if (text.annotations.italic) content = `<em class="notion-text-italic">${content}</em>`;
      if (text.annotations.underline) content = `<u class="notion-text-underline">${content}</u>`;
      if (text.annotations.strikethrough) content = `<s class="notion-text-strikethrough">${content}</s>`;
      if (text.annotations.code) content = `<code class="notion-text-code">${content}</code>`;
      
      if (text.href) {
        content = `<a href="${text.href}" class="notion-text-link" target="_blank" rel="noopener noreferrer">${content}</a>`;
      }
    }
    
    return content;
  }).join('');
}

// Función para renderizar un bloque individual
function renderBlock(block) {
  const type = block.type;
  
  switch (type) {
    case 'paragraph':
      const paragraphText = renderRichText(block.paragraph?.rich_text);
      return `<p class="notion-paragraph">${paragraphText || '<br>'}</p>`;
    
    case 'heading_1':
      return `<h1>${renderRichText(block.heading_1?.rich_text)}</h1>`;
    
    case 'heading_2':
      return `<h2>${renderRichText(block.heading_2?.rich_text)}</h2>`;
    
    case 'heading_3':
      return `<h3>${renderRichText(block.heading_3?.rich_text)}</h3>`;
    
    case 'bulleted_list_item':
      return `<li class="notion-bulleted-list-item">${renderRichText(block.bulleted_list_item?.rich_text)}</li>`;
    
    case 'numbered_list_item':
      return `<li class="notion-numbered-list-item">${renderRichText(block.numbered_list_item?.rich_text)}</li>`;
    
    case 'image':
      const image = block.image;
      const imageUrl = image?.external?.url || image?.file?.url;
      const caption = image?.caption ? renderRichText(image.caption) : '';
      
      if (imageUrl) {
        return `
          <div class="notion-image">
            <img src="${imageUrl}" alt="${caption || ''}" />
            ${caption ? `<div class="notion-image-caption">${caption}</div>` : ''}
          </div>
        `;
      }
      return '';
    
    case 'divider':
      return '<div class="notion-divider"></div>';
    
    case 'code':
      const codeText = renderRichText(block.code?.rich_text);
      const language = block.code?.language || '';
      return `<pre class="notion-code"><code>${codeText}</code></pre>`;
    
    case 'quote':
      return `<div class="notion-quote">${renderRichText(block.quote?.rich_text)}</div>`;
    
    case 'callout':
      const callout = block.callout;
      const icon = callout?.icon?.emoji || '💡';
      const calloutText = renderRichText(callout?.rich_text);
      return `
        <div class="notion-callout">
          <div class="notion-callout-icon">${icon}</div>
          <div class="notion-callout-content">${calloutText}</div>
        </div>
      `;
    
    case 'table':
      // Las tablas requieren una llamada adicional para obtener las filas
      return '<div class="notion-table-placeholder">[Tabla - Requiere implementación adicional]</div>';
    
    case 'child_database':
      return '<div class="notion-database-placeholder">[Base de datos - Requiere implementación adicional]</div>';
    
    default:
      console.log('Tipo de bloque no soportado:', type, block);
      return '';
  }
}

// Función para renderizar todos los bloques
function renderBlocks(blocks) {
  let html = '';
  let inList = false;
  let listType = null;
  let listItems = [];
  
  blocks.forEach((block, index) => {
    const type = block.type;
    
    // Manejar listas agrupadas
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const currentListType = type === 'bulleted_list_item' ? 'ul' : 'ol';
      
      if (!inList || listType !== currentListType) {
        // Cerrar lista anterior si existe
        if (inList && listItems.length > 0) {
          html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
          listItems = [];
        }
        inList = true;
        listType = currentListType;
      }
      
      listItems.push(renderBlock(block));
    } else {
      // Cerrar lista si estábamos en una
      if (inList && listItems.length > 0) {
        html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
        listItems = [];
        inList = false;
        listType = null;
      }
      
      html += renderBlock(block);
    }
  });
  
  // Cerrar lista si queda abierta
  if (inList && listItems.length > 0) {
    html += `<${listType === 'ul' ? 'ul' : 'ol'} class="notion-${listType === 'ul' ? 'bulleted' : 'numbered'}-list">${listItems.join('')}</${listType === 'ul' ? 'ul' : 'ol'}>`;
  }
  
  return html;
}

// Función para cargar y renderizar contenido de Notion desde la API
async function loadNotionContent(url, container) {
  const contentDiv = container.querySelector('#notion-content');
  const iframe = container.querySelector('#notion-iframe');
  
  if (!contentDiv) {
    console.error('No se encontró el contenedor de contenido');
    return;
  }
  
  // Mostrar loading
  contentDiv.innerHTML = '<div class="notion-loading">Cargando contenido...</div>';
  container.classList.add('show-content');
  
  try {
    // Extraer ID de la página
    const pageId = extractNotionPageId(url);
    if (!pageId) {
      throw new Error('No se pudo extraer el ID de la página desde la URL');
    }
    
    console.log('Obteniendo bloques para página:', pageId);
    
    // Obtener bloques
    const blocks = await fetchNotionBlocks(pageId);
    console.log('Bloques obtenidos:', blocks.length);
    
    if (blocks.length === 0) {
      contentDiv.innerHTML = '<div class="notion-loading">No se encontró contenido en esta página.</div>';
      return;
    }
    
    // Renderizar bloques
    const html = renderBlocks(blocks);
    contentDiv.innerHTML = html;
    
  } catch (error) {
    console.error('Error al cargar contenido de Notion:', error);
    contentDiv.innerHTML = `
      <div class="notion-error">
        <strong>Error al cargar el contenido:</strong><br>
        ${error.message}<br><br>
        <button onclick="window.open('${url}', '_blank')" style="
          background: #4a9eff;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          color: #fff;
          cursor: pointer;
        ">Abrir en Notion</button>
      </div>
    `;
  }
}

// Función para mostrar mensaje cuando Notion bloquea el iframe
function showNotionBlockedMessage(container, url) {
  container.innerHTML = `
    <div style="padding: 40px 20px; text-align: center; color: #e0e0e0;">
      <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
      <h2 style="color: #fff; margin-bottom: 12px; font-size: 18px;">Notion bloquea el embedding</h2>
      <p style="color: #999; margin-bottom: 20px; font-size: 14px; line-height: 1.5;">
        Notion no permite que sus páginas se carguen en iframes por razones de seguridad.<br>
        Puedes abrir la página en una nueva ventana para verla.
      </p>
      <button id="open-notion-window" style="
        background: #4a9eff;
        border: none;
        border-radius: 8px;
        padding: 12px 24px;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      ">Abrir en nueva ventana</button>
    </div>
  `;
  
  const openButton = container.querySelector('#open-notion-window');
  if (openButton) {
    openButton.addEventListener('click', () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    openButton.addEventListener('mouseenter', () => {
      openButton.style.background = '#5aaeff';
    });
    openButton.addEventListener('mouseleave', () => {
      openButton.style.background = '#4a9eff';
    });
  }
}

// Intentar inicializar Owlbear con manejo de errores
console.log('🔄 Intentando inicializar Owlbear SDK...');

try {
  OBR.onReady(() => {
    console.log('✅ Owlbear SDK listo');
    console.log('🌐 URL actual:', window.location.href);
    console.log('🔗 Origen:', window.location.origin);
    
    // Verificar que las variables se cargaron
    console.log('🔍 Verificando variables...');
    console.log('NOTION_API_TOKEN existe:', !!NOTION_API_TOKEN);
    console.log('NOTION_PAGES existe:', !!NOTION_PAGES);
    console.log('NOTION_PAGES es array:', Array.isArray(NOTION_PAGES));
    console.log('NOTION_PAGES.length:', NOTION_PAGES?.length || 0);
    
    if (NOTION_PAGES && NOTION_PAGES.length > 0) {
      console.log('📋 Todas las páginas:', NOTION_PAGES);
      NOTION_PAGES.forEach((page, i) => {
        console.log(`  ${i + 1}. ${page.name}: ${page.url}`);
      });
    } else {
      console.error('❌ NOTION_PAGES está vacío o no se cargó correctamente');
    }
    
    const pageList = document.getElementById("page-list");

    if (!pageList) {
      console.error('❌ No se encontró el elemento page-list');
      return;
    }

    console.log('✅ page-list encontrado');

    // Filtrar páginas válidas (que tengan URLs reales, no placeholders)
    const validPages = NOTION_PAGES.filter(page => 
      page.url && 
      !page.url.includes('...') && 
      page.url.startsWith('http')
    );

    console.log('📊 Total de páginas configuradas:', NOTION_PAGES?.length || 0);
    console.log('✅ Páginas válidas encontradas:', validPages.length);
    if (validPages.length > 0) {
      console.log('📝 Páginas válidas:', validPages.map(p => `${p.name} (${p.url.substring(0, 50)}...)`));
    } else {
      console.warn('⚠️ No hay páginas válidas después del filtro');
      if (NOTION_PAGES && NOTION_PAGES.length > 0) {
        console.log('🔍 Páginas filtradas:');
        NOTION_PAGES.forEach((page, i) => {
          const isValid = page.url && !page.url.includes('...') && page.url.startsWith('http');
          console.log(`  ${i + 1}. ${page.name}: ${isValid ? '✅ válida' : '❌ inválida'} - ${page.url}`);
        });
      }
    }

    if (validPages.length === 0) {
      pageList.innerHTML = `
        <div class="empty-state">
          <p>No hay páginas configuradas</p>
          <p>Edita <code>config.js</code> para agregar tus páginas de Notion</p>
          <p style="font-size: 12px; margin-top: 8px; color: #888;">
            Asegúrate de que las URLs sean completas (sin "...")
          </p>
        </div>
      `;
      return;
    }

    // Crear botones para cada página válida
    console.log('Creando botones para', validPages.length, 'páginas');
    validPages.forEach((page, index) => {
      console.log(`Creando botón ${index + 1}:`, page.name);
      const button = document.createElement("button");
      button.className = "page-button";
      button.innerHTML = `
        <div class="page-name">${page.name}</div>
        <div class="page-url">${page.url}</div>
      `;
      
      button.addEventListener("click", async () => {
        console.log("Cargando Notion en el popover:", page.url);
        
        // Obtener elementos
        const pageList = document.getElementById("page-list");
        const notionContainer = document.getElementById("notion-container");
        const backButton = document.getElementById("back-button");
        const pageTitle = document.getElementById("page-title");
        const notionContent = document.getElementById("notion-content");
        
        if (pageList && notionContainer && backButton && pageTitle && notionContent) {
          // Ocultar lista y mostrar contenedor de Notion
          pageList.classList.add("hidden");
          notionContainer.classList.remove("hidden");
          backButton.classList.remove("hidden");
          pageTitle.textContent = page.name;
          
          // Cargar contenido desde la API
          await loadNotionContent(page.url, notionContainer);
          
          // Configurar el botón de volver (solo una vez)
          if (!backButton.dataset.listenerAdded) {
            backButton.addEventListener("click", () => {
              // Volver a mostrar la lista
              pageList.classList.remove("hidden");
              notionContainer.classList.add("hidden");
              backButton.classList.add("hidden");
              pageTitle.textContent = "📚 Páginas de Notion";
              notionContainer.classList.remove("show-content");
              if (notionContent) {
                notionContent.innerHTML = "";
              }
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
      console.log(`Botón agregado: ${page.name}`);
    });
    
    console.log('Total de botones creados:', pageList.children.length);
  });
} catch (error) {
  console.error('❌ Error crítico al cargar el SDK de Owlbear:', error);
  console.error('Stack:', error.stack);
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

// Log adicional para verificar que el script se ejecutó completamente
console.log('✅ index.js cargado completamente');

