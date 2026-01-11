/**
 * @fileoverview Renderizador de bloques de Notion a HTML
 * 
 * Convierte los bloques de la API de Notion a HTML.
 */

import { log, logWarn } from '../utils/logger.js';

/**
 * Renderizador de contenido de Notion
 */
export class NotionRenderer {
  constructor() {
    // Referencia al NotionService para obtener bloques hijos
    this.notionService = null;
  }

  /**
   * Inyecta dependencias
   * @param {Object} deps - Dependencias
   */
  setDependencies({ notionService }) {
    if (notionService) this.notionService = notionService;
  }

  /**
   * Renderiza rich text de Notion a HTML
   * @param {Array} richTextArray - Array de rich text
   * @returns {string}
   */
  renderRichText(richTextArray) {
    if (!richTextArray || richTextArray.length === 0) return '';
    
    return richTextArray.map(text => {
      let content = text.plain_text || '';
      
      // Convertir saltos de línea a <br>
      content = content.replace(/\n/g, '<br>');
      
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

  /**
   * Renderiza un bloque individual
   * @param {Object} block - Bloque de Notion
   * @returns {string}
   */
  renderBlock(block) {
    const type = block.type;
    
    switch (type) {
      case 'paragraph':
        const paragraphText = this.renderRichText(block.paragraph?.rich_text);
        return `<p class="notion-paragraph">${paragraphText || '<br>'}</p>`;
      
      case 'heading_1':
        return this._renderHeading(block, 1);
      
      case 'heading_2':
        return this._renderHeading(block, 2);
      
      case 'heading_3':
        return this._renderHeading(block, 3);
      
      case 'bulleted_list_item':
        return `<li class="notion-bulleted-list-item">${this.renderRichText(block.bulleted_list_item?.rich_text)}</li>`;
      
      case 'numbered_list_item':
        return `<li class="notion-numbered-list-item">${this.renderRichText(block.numbered_list_item?.rich_text)}</li>`;
      
      case 'image':
        return this._renderImage(block);
      
      case 'divider':
        return '<div class="notion-divider"></div>';
      
      case 'code':
        const codeText = this.renderRichText(block.code?.rich_text);
        return `<pre class="notion-code"><code>${codeText}</code></pre>`;
      
      case 'quote':
        return `<div class="notion-quote">${this.renderRichText(block.quote?.rich_text)}</div>`;
      
      case 'callout':
        return this._renderCallout(block);
      
      case 'table':
        return `<div class="notion-table-container" data-table-id="${block.id}">Loading table...</div>`;
      
      case 'child_database':
        return '<div class="notion-database-placeholder">[Base de datos - Requiere implementación adicional]</div>';
      
      case 'column_list':
        return '<div class="notion-column-list">[Columnas - Procesando...]</div>';
      
      case 'column':
        return '<div class="notion-column">[Columna - Procesando...]</div>';
      
      case 'to_do':
        const todo = block.to_do;
        const todoText = this.renderRichText(todo?.rich_text);
        const checked = todo?.checked ? 'checked' : '';
        return `<div class="notion-todo"><input type="checkbox" ${checked} disabled> ${todoText}</div>`;
      
      case 'toggle':
        const toggle = block.toggle;
        const toggleText = this.renderRichText(toggle?.rich_text);
        return `<details class="notion-toggle"><summary>${toggleText}</summary><div class="notion-toggle-content" data-toggle-id="${block.id}">Loading content...</div></details>`;
      
      case 'bookmark':
        return this._renderBookmark(block);
      
      case 'video':
        return this._renderVideo(block);
      
      case 'embed':
        return this._renderEmbed(block);
      
      case 'link_preview':
        return this._renderLinkPreview(block);
      
      default:
        logWarn('Tipo de bloque no soportado:', type);
        return '';
    }
  }

  /**
   * Renderiza una imagen
   * @private
   */
  _renderImage(block) {
    const image = block.image;
    let imageUrl = null;
    let imageType = null;
    
    if (image?.external?.url) {
      imageUrl = image.external.url;
      imageType = 'external';
    } else if (image?.file?.url) {
      imageUrl = image.file.url;
      imageType = 'file';
    }
    
    const caption = image?.caption ? this.renderRichText(image.caption) : '';
    
    if (imageUrl) {
      const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      log('🖼️ Renderizando imagen:', {
        type: imageType,
        url: imageUrl.substring(0, 80) + (imageUrl.length > 80 ? '...' : ''),
        hasCaption: !!caption
      });
      
      return `
        <div class="notion-image" data-block-id="${block.id}">
          <div class="notion-image-container">
            <div class="image-loading">
              <div class="loading-spinner"></div>
            </div>
            <img 
              src="${imageUrl}" 
              alt="${caption || 'Imagen de Notion'}" 
              class="notion-image-clickable" 
              data-image-id="${imageId}" 
              data-image-url="${imageUrl}" 
              data-image-caption="${caption.replace(/"/g, '&quot;')}"
              data-block-id="${block.id}"
              loading="eager"
              onload="this.classList.add('loaded'); const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove();"
              onerror="this.style.display='none'; const errorDiv = document.createElement('div'); errorDiv.className='empty-state notion-image-error'; errorDiv.innerHTML='<div class=\\'empty-state-icon\\'>⚠️</div><p class=\\'empty-state-text\\'>Could not load image</p><p class=\\'empty-state-hint\\'>The URL may have expired</p><button class=\\'btn btn--sm btn--ghost\\' onclick=\\'window.refreshImage && window.refreshImage(this)\\'>🔄 Reload page</button>'; this.parentElement.appendChild(errorDiv);"
            />
            <button class="notion-image-share-button share-button" 
                    data-image-url="${imageUrl}" 
                    data-image-caption="${caption.replace(/"/g, '&quot;')}"
                    title="Share with room">
              <img src="img/icon-players.svg" alt="Share" />
            </button>
          </div>
          ${caption ? `<div class="notion-image-caption">${caption}</div>` : ''}
        </div>
      `;
    } else {
      logWarn('Bloque de imagen sin URL válida:', block.id);
      return '<div class="notion-image-unavailable">[Imagen no disponible]</div>';
    }
  }

  /**
   * Renderiza un heading (soporta toggleable headings)
   * @private
   */
  _renderHeading(block, level) {
    const headingData = block[`heading_${level}`];
    const text = this.renderRichText(headingData?.rich_text);
    const isToggleable = headingData?.is_toggleable === true;
    
    if (isToggleable) {
      // Heading con toggle - se renderizará con hijos en renderBlocks
      return `<h${level} class="notion-heading notion-heading-toggle" data-toggle-heading="${block.id}">${text}</h${level}>`;
    }
    
    return `<h${level} class="notion-heading">${text}</h${level}>`;
  }

  /**
   * Renderiza un callout (soporta hijos)
   * @private
   */
  _renderCallout(block) {
    const callout = block.callout;
    const icon = callout?.icon?.emoji || '💡';
    const calloutText = this.renderRichText(callout?.rich_text);
    
    // Si tiene hijos, se renderizarán después
    const hasChildren = block.has_children;
    const childrenPlaceholder = hasChildren 
      ? `<div class="notion-callout-children" data-callout-id="${block.id}"></div>`
      : '';
    
    return `
      <div class="notion-callout" data-has-children="${hasChildren}">
        <div class="notion-callout-icon">${icon}</div>
        <div class="notion-callout-content">
          ${calloutText}
          ${childrenPlaceholder}
        </div>
      </div>
    `;
  }

  /**
   * Renderiza un bookmark
   * @private
   */
  _renderBookmark(block) {
    const url = block.bookmark?.url || '';
    const caption = block.bookmark?.caption ? this.renderRichText(block.bookmark.caption) : '';
    return `
      <div class="notion-bookmark">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${caption || url}</a>
      </div>
    `;
  }

  /**
   * Renderiza un video
   * @private
   */
  _renderVideo(block) {
    const video = block.video;
    let videoUrl = video?.external?.url || video?.file?.url || '';
    
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      // Convertir URL de YouTube a embed
      const videoId = this._extractYouTubeId(videoUrl);
      if (videoId) {
        return `
          <div class="notion-video">
            <iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>
          </div>
        `;
      }
    }
    
    return `
      <div class="notion-video">
        <video controls src="${videoUrl}"></video>
      </div>
    `;
  }

  /**
   * Renderiza un embed
   * @private
   */
  _renderEmbed(block) {
    const url = block.embed?.url || '';
    return `
      <div class="notion-embed">
        <iframe src="${url}" frameborder="0"></iframe>
      </div>
    `;
  }

  /**
   * Renderiza un link preview
   * @private
   */
  _renderLinkPreview(block) {
    const url = block.link_preview?.url || '';
    return `
      <div class="notion-link-preview">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
      </div>
    `;
  }

  /**
   * Extrae el ID de YouTube de una URL
   * @private
   */
  _extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  /**
   * Renderiza una tabla completa de Notion
   * @param {Object} tableBlock - Bloque de tabla
   * @returns {Promise<string>}
   */
  async renderTable(tableBlock) {
    try {
      if (!this.notionService) {
        logWarn('NotionService no disponible para renderizar tabla');
        return '<div class="notion-table-placeholder">[Tabla - NotionService no disponible]</div>';
      }

      // Obtener las filas de la tabla
      const rows = await this.notionService.fetchBlocks(tableBlock.id);
      
      if (!rows || rows.length === 0) {
        return `
          <div class="empty-state notion-table-placeholder">
            <div class="empty-state-icon">📊</div>
            <p class="empty-state-text">Empty table</p>
          </div>
        `;
      }
      
      // Obtener el número de columnas de la primera fila
      const firstRow = rows[0];
      const columnCount = firstRow?.table_row?.cells?.length || 0;
      
      if (columnCount === 0) {
        return `
          <div class="empty-state notion-table-placeholder">
            <div class="empty-state-icon">📊</div>
            <p class="empty-state-text">Table without columns</p>
          </div>
        `;
      }
      
      let tableHtml = '<table class="notion-table">';
      
      // Renderizar cada fila
      rows.forEach((rowBlock, rowIndex) => {
        if (rowBlock.type === 'table_row') {
          const cells = rowBlock.table_row?.cells || [];
          tableHtml += '<tr>';
          
          // Renderizar cada celda
          for (let i = 0; i < columnCount; i++) {
            const cell = cells[i] || [];
            const cellContent = this.renderRichText(cell);
            // La primera fila suele ser el encabezado
            const isHeader = rowIndex === 0;
            const tag = isHeader ? 'th' : 'td';
            tableHtml += `<${tag}>${cellContent || '&nbsp;'}</${tag}>`;
          }
          
          tableHtml += '</tr>';
        }
      });
      
      tableHtml += '</table>';
      return tableHtml;
    } catch (error) {
      logWarn('Error al renderizar tabla:', error);
      return `
        <div class="empty-state notion-table-placeholder">
          <div class="empty-state-icon">⚠️</div>
          <p class="empty-state-text">Error loading table</p>
          <p class="empty-state-hint">${error.message}</p>
        </div>
      `;
    }
  }

  /**
   * Renderiza múltiples bloques con manejo de listas
   * @param {Array} blocks - Array de bloques
   * @param {Array|string} blockTypes - Tipos a filtrar (opcional)
   * @param {number} headingLevelOffset - Offset para niveles de heading
   * @returns {Promise<string>}
   */
  async renderBlocks(blocks, blockTypes = null, headingLevelOffset = 0) {
    let html = '';
    let inList = false;
    let listType = null;
    let listItems = [];

    const typesArray = blockTypes ? (Array.isArray(blockTypes) ? blockTypes : [blockTypes]) : null;
    
    if (typesArray) {
      console.log('🔍 Filtro de bloques activo:', typesArray);
      console.log('📦 Total de bloques a procesar:', blocks?.length || 0);
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const type = block.type;

      // Filtrar por tipo si hay filtro activo
      if (typesArray && !this._matchesFilter(block, typesArray)) {
        console.log(`❌ Bloque filtrado: ${block.type}`, block.id?.substring(0, 8));
        continue;
      }
      
      if (typesArray) {
        console.log(`✅ Bloque incluido: ${block.type}`, block.id?.substring(0, 8));
      }

      // Manejo de listas
      if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        const currentListType = type === 'bulleted_list_item' ? 'ul' : 'ol';
        
        if (!inList || listType !== currentListType) {
          // Cerrar lista anterior si existe
          if (inList && listItems.length > 0) {
            html += `<${listType} class="notion-list">${listItems.join('')}</${listType}>`;
            listItems = [];
          }
          inList = true;
          listType = currentListType;
        }
        
        listItems.push(this.renderBlock(block));
        continue;
      } else if (inList) {
        // Cerrar lista si el siguiente bloque no es de lista
        html += `<${listType} class="notion-list">${listItems.join('')}</${listType}>`;
        listItems = [];
        inList = false;
        listType = null;
      }

      // Manejar toggle
      if (type === 'toggle' && block.has_children) {
        html += await this._renderToggleWithChildren(block, typesArray, headingLevelOffset);
        continue;
      }

      // Manejar toggle headings (heading_1, heading_2, heading_3 con is_toggleable)
      if ((type === 'heading_1' || type === 'heading_2' || type === 'heading_3') && block.has_children) {
        const headingData = block[type];
        if (headingData?.is_toggleable) {
          html += await this._renderToggleHeading(block, type, typesArray, headingLevelOffset);
          continue;
        }
      }

      // Manejar callouts con hijos
      if (type === 'callout' && block.has_children) {
        html += await this._renderCalloutWithChildren(block, typesArray, headingLevelOffset);
        continue;
      }

      // Manejar column_list
      if (type === 'column_list') {
        const result = await this._renderColumnList(block, blocks, i, typesArray, headingLevelOffset);
        html += result.html;
        i += result.siblingColumnsCount;
        continue;
      }

      // Manejar tablas
      if (type === 'table') {
        try {
          const tableHtml = await this.renderTable(block);
          html += tableHtml;
          log('✅ Tabla renderizada:', block.id);
        } catch (error) {
          log('❌ Error al renderizar tabla:', error);
          html += `
            <div class="empty-state notion-table-placeholder">
              <div class="empty-state-icon">⚠️</div>
              <p class="empty-state-text">Error loading table</p>
            </div>
          `;
        }
        continue;
      }

      // Renderizar bloque normal
      html += this.renderBlock(block);
    }

    // Cerrar lista pendiente
    if (inList && listItems.length > 0) {
      html += `<${listType} class="notion-list">${listItems.join('')}</${listType}>`;
    }

    return html;
  }

  /**
   * Verifica si un bloque coincide con el filtro
   * @private
   */
  _matchesFilter(block, typesArray) {
    if (!typesArray) return true;
    
    // Los toggles, column_list, callouts, y bloques con hijos siempre se procesan 
    // para buscar contenido filtrado dentro de ellos
    if (block.type === 'toggle' || block.type === 'column_list' || block.type === 'callout' || block.has_children) {
      return true;
    }
    
    return typesArray.includes(block.type);
  }

  /**
   * Renderiza un toggle con sus hijos
   * @private
   */
  async _renderToggleWithChildren(block, typesArray, headingLevelOffset) {
    const toggleText = this.renderRichText(block.toggle?.rich_text);
    let toggleContent = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id);
      if (children.length > 0) {
        toggleContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    }

    // Si hay filtro y el toggle no tiene contenido filtrado, no mostrarlo
    if (typesArray && !typesArray.includes('toggle') && !toggleContent.trim()) {
      return '';
    }

    return `
      <details class="notion-toggle">
        <summary class="notion-toggle-summary">${toggleText}</summary>
        <div class="notion-toggle-content">${toggleContent}</div>
      </details>
    `;
  }

  /**
   * Renderiza un heading toggle (h1, h2, h3 con is_toggleable)
   * @private
   */
  async _renderToggleHeading(block, type, typesArray, headingLevelOffset) {
    const level = parseInt(type.replace('heading_', ''));
    const headingData = block[type];
    const headingText = this.renderRichText(headingData?.rich_text);
    let toggleContent = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id);
      if (children.length > 0) {
        toggleContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    }

    // Si hay filtro y el toggle no tiene contenido, no mostrarlo
    if (typesArray && !typesArray.includes(type) && !toggleContent.trim()) {
      return '';
    }

    return `
      <details class="notion-toggle notion-toggle-heading notion-toggle-h${level}">
        <summary class="notion-toggle-summary"><h${level} class="notion-heading">${headingText}</h${level}></summary>
        <div class="notion-toggle-content">${toggleContent}</div>
      </details>
    `;
  }

  /**
   * Renderiza un callout con sus hijos
   * @private
   */
  async _renderCalloutWithChildren(block, typesArray, headingLevelOffset) {
    const callout = block.callout;
    const icon = callout?.icon?.emoji || '💡';
    const calloutText = this.renderRichText(callout?.rich_text);
    let childrenContent = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id);
      if (children.length > 0) {
        childrenContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    }

    return `
      <div class="notion-callout">
        <div class="notion-callout-icon">${icon}</div>
        <div class="notion-callout-content">
          ${calloutText}
          ${childrenContent ? `<div class="notion-callout-children">${childrenContent}</div>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Renderiza una lista de columnas
   * @private
   */
  async _renderColumnList(columnListBlock, allBlocks, currentIndex, typesArray, headingLevelOffset) {
    let columns = [];
    let siblingColumnsCount = 0;

    // Buscar columnas como hijos
    if (columnListBlock.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(columnListBlock.id);
      columns = children.filter(b => b.type === 'column');
    }

    // O como bloques hermanos
    if (columns.length === 0) {
      let index = currentIndex + 1;
      while (index < allBlocks.length && allBlocks[index].type === 'column') {
        columns.push(allBlocks[index]);
        siblingColumnsCount++;
        index++;
      }
    }

    if (columns.length === 0) {
      return { html: '<div class="notion-column-list">[Sin columnas]</div>', siblingColumnsCount: 0 };
    }

    const columnHtmls = await Promise.all(columns.map(async (col) => {
      let content = '';
      if (col.has_children && this.notionService) {
        const children = await this.notionService.fetchChildBlocks(col.id);
        content = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
      
      if (typesArray && !content.trim()) {
        return '';
      }
      
      return `<div class="notion-column">${content}</div>`;
    }));

    const validColumns = columnHtmls.filter(h => h);
    if (validColumns.length === 0) {
      return { html: '', siblingColumnsCount };
    }

    const html = `
      <div class="notion-column-list" style="--column-count: ${validColumns.length}">
        ${validColumns.join('')}
      </div>
    `;

    return { html, siblingColumnsCount };
  }
}

export default NotionRenderer;

