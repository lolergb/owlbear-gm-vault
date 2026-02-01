/**
 * @fileoverview Renderizador de bloques de Notion a HTML
 * 
 * Convierte los bloques de la API de Notion a HTML.
 */

import { log, logWarn } from '../utils/logger.js';

/** Tag en bloques code que marca contenido solo para GM/coGM (oculto para players) */
const GM_ONLY_CODE_TAG = '🔒 GM';

/**
 * Renderizador de contenido de Notion
 */
export class NotionRenderer {
  constructor() {
    // Referencia al NotionService para obtener bloques hijos
    this.notionService = null;
    // Referencia al Config para verificar si páginas están en el vault
    this.config = null;
    // Callback para verificar visibilidad de página (para players)
    this.isPageVisibleCallback = null;
    // Flag para indicar si estamos renderizando dentro de un modal (mentions no clickeables)
    this.isRenderingInModal = false;
    // Flag para indicar si el usuario es GM
    this.isGM = true;
    // Flag para indicar si el usuario es Co-GM (GM promovido, solo lectura)
    this.isCoGM = false;
    // Flag para usar caché al obtener bloques hijos (tablas, toggles, etc.)
    // Se configura antes de llamar a renderBlocks
    this.useCache = true;
  }

  /**
   * Inyecta dependencias
   * @param {Object} deps - Dependencias
   */
  setDependencies({ notionService, config, isPageVisibleCallback, isGM, isCoGM }) {
    if (notionService) this.notionService = notionService;
    if (config !== undefined) this.config = config;
    if (isPageVisibleCallback !== undefined) this.isPageVisibleCallback = isPageVisibleCallback;
    if (isGM !== undefined) this.isGM = isGM;
    if (isCoGM !== undefined) this.isCoGM = isCoGM;
  }

  /**
   * Configura el modo de renderizado
   * Solo actualiza los valores que se pasan explícitamente
   * @param {Object} options - Opciones de renderizado
   */
  setRenderingOptions(options = {}) {
    if (options.isInModal !== undefined) {
      this.isRenderingInModal = options.isInModal;
    }
    if (options.useCache !== undefined) {
      this.useCache = options.useCache;
      log(`🔧 NotionRenderer.useCache configurado a: ${this.useCache}`);
    }
  }

  /**
   * Obtiene el texto plano de un array rich_text (sin HTML)
   * @param {Array} richTextArray - Array de rich text de Notion
   * @returns {string}
   * @private
   */
  _getPlainTextFromRichText(richTextArray) {
    if (!richTextArray || !Array.isArray(richTextArray)) return '';
    return richTextArray.map(t => t.plain_text || '').join('');
  }

  /**
   * Si el bloque es un code que contiene el tag GM-only, devuelve true.
   * @param {Object} block - Bloque de Notion
   * @returns {boolean}
   * @private
   */
  _getCodeBlockGmTag(block) {
    if (block?.type !== 'code' || !block.code?.rich_text) return false;
    const text = this._getPlainTextFromRichText(block.code.rich_text);
    return text.includes(GM_ONLY_CODE_TAG);
  }

  /**
   * Comprueba si el bloque tiene rich_text que contiene el tag GM-only
   * (callout, toggle, heading, paragraph, quote, to_do, list items, etc.).
   * Así detectamos 🔒 GM tanto en bloque "code" como en texto/código inline.
   * @param {Object} block - Bloque de Notion
   * @returns {boolean}
   * @private
   */
  _blockRichTextContainsGmTag(block) {
    if (!block) return false;
    let richText = null;
    switch (block.type) {
      case 'paragraph': richText = block.paragraph?.rich_text; break;
      case 'heading_1': richText = block.heading_1?.rich_text; break;
      case 'heading_2': richText = block.heading_2?.rich_text; break;
      case 'heading_3': richText = block.heading_3?.rich_text; break;
      case 'callout': richText = block.callout?.rich_text; break;
      case 'toggle': richText = block.toggle?.rich_text; break;
      case 'quote': richText = block.quote?.rich_text; break;
      case 'code': richText = block.code?.rich_text; break;
      case 'to_do': richText = block.to_do?.rich_text; break;
      case 'bulleted_list_item': richText = block.bulleted_list_item?.rich_text; break;
      case 'numbered_list_item': richText = block.numbered_list_item?.rich_text; break;
      case 'toggle_heading_1': richText = block.heading_1?.rich_text; break;
      case 'toggle_heading_2': richText = block.heading_2?.rich_text; break;
      case 'toggle_heading_3': richText = block.heading_3?.rich_text; break;
      default: break;
    }
    if (!richText || !Array.isArray(richText)) return false;
    const text = this._getPlainTextFromRichText(richText);
    return text.includes(GM_ONLY_CODE_TAG);
  }

  /**
   * True si el bloque (o sus descendientes) contiene el tag GM-only
   * (bloque code o rich_text con 🔒 GM en callout, toggle, heading, etc.).
   * @param {Array} blocks - Array de bloques
   * @returns {Promise<boolean>}
   * @private
   */
  async _hasGmOnlyContentInDescendants(blocks) {
    if (!blocks || blocks.length === 0) return false;
    for (const block of blocks) {
      if (this._getCodeBlockGmTag(block) || this._blockRichTextContainsGmTag(block)) return true;
      if (block.has_children && this.notionService) {
        const children = await this.notionService.fetchChildBlocks(block.id, this.useCache);
        if (await this._hasGmOnlyContentInDescendants(children)) return true;
      }
    }
    return false;
  }

  /**
   * Renderiza rich text de Notion a HTML
   * @param {Array} richTextArray - Array de rich text
   * @returns {string}
   */
  renderRichText(richTextArray) {
    if (!richTextArray || richTextArray.length === 0) return '';
    
    return richTextArray.map(text => {
      // Detectar mentions de página
      if (text.type === 'mention' && text.mention?.type === 'page') {
        return this._renderPageMention(text);
      }
      
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
   * Renderiza un mention de página
   * @private
   * @param {Object} text - Objeto rich_text de tipo mention
   * @returns {string} - HTML del mention
   */
  _renderPageMention(text) {
    const mentionedPageId = text.mention?.page?.id;
    const apiDisplayName = text.plain_text || 'Page';
    
    // Si estamos dentro de un modal, los mentions NO son clickeables (evita navegación infinita)
    if (this.isRenderingInModal) {
      return `<span class="notion-mention notion-mention--disabled" aria-disabled="true">${apiDisplayName}</span>`;
    }
    
    // Si no hay config, renderizar como texto plano (pero con data-mention-page-id para actualización posterior)
    if (!this.config) {
      return `<span class="notion-mention notion-mention--plain" data-mention-page-id="${mentionedPageId}" data-mention-page-name="${apiDisplayName.replace(/"/g, '&quot;')}">${apiDisplayName}</span>`;
    }
    
    // Buscar si la página está en el vault
    const pageInVault = this.config.findPageByNotionId(mentionedPageId);
    
    // Si la página no está en el vault, renderizar como texto plano (pero con data para actualización posterior)
    if (!pageInVault) {
      return `<span class="notion-mention notion-mention--plain" data-mention-page-id="${mentionedPageId}" data-mention-page-name="${apiDisplayName.replace(/"/g, '&quot;')}">${apiDisplayName}</span>`;
    }
    
    // Usar el nombre del vault si está disponible, ya que la API a veces devuelve "Untitled"
    // especialmente en tablas y otros bloques anidados
    const displayName = pageInVault.name || apiDisplayName;
    
    // Para players: verificar si la página es visible
    // GM Master y Co-GM pueden ver todo, solo players tienen restricciones
    // Los mentions son SIEMPRE clickeables para que puedan ver el mensaje de "página no disponible"
    // La verificación de acceso real se hace en _openMentionedPage
    const isVisibleForPlayer = !this.isGM && this.isPageVisibleCallback 
      ? this.isPageVisibleCallback(pageInVault) 
      : true;
    
    // Clase adicional para indicar visualmente páginas con acceso restringido (solo para players)
    const lockedClass = !this.isGM && !isVisibleForPlayer ? ' notion-mention--locked' : '';
    
    // Página en vault: renderizar como enlace clickeable (incluso si no visible, para mostrar mensaje)
    return `<span 
      class="notion-mention notion-mention--link${lockedClass}" 
      data-mention-page-id="${mentionedPageId}"
      data-mention-page-name="${displayName.replace(/"/g, '&quot;')}"
      data-mention-page-url="${pageInVault.url || ''}"
      role="button"
      tabindex="0"
      aria-label="Open ${displayName}"
    >${displayName}</span>`;
  }

  /**
   * Renderiza las propiedades de una página de base de datos
   * @param {Object} properties - Propiedades de la página
   * @returns {string} - HTML de las propiedades
   */
  renderPageProperties(properties) {
    if (!properties) return '';
    
    // Filtrar propiedades del sistema y vacías
    const systemProps = ['created_time', 'last_edited_time', 'created_by', 'last_edited_by'];
    
    const relevantProps = Object.entries(properties)
      .filter(([key, prop]) => {
        // Excluir propiedades del sistema
        if (systemProps.includes(prop.type)) return false;
        // Excluir el título (ya se muestra arriba)
        if (prop.type === 'title') return false;
        // Excluir propiedades vacías
        const value = this._getPropertyValue(prop);
        return value !== null && value !== '';
      });
    
    if (relevantProps.length === 0) return '';
    
    const propsHtml = relevantProps.map(([propName, prop]) => 
      this._renderProperty(propName, prop)
    ).join('');
    
    return `<div class="notion-page-properties">${propsHtml}</div>`;
  }

  /**
   * Renderiza una propiedad individual
   * @private
   */
  _renderProperty(propName, property) {
    const valueHtml = this._formatPropertyValue(property);
    if (!valueHtml) return '';
    
    return `
      <div class="notion-property">
        <span class="notion-property__name">${this._escapeHtml(propName)}</span>
        <span class="notion-property__value">${valueHtml}</span>
      </div>
    `;
  }

  /**
   * Obtiene el valor de una propiedad (para filtrar vacías)
   * @private
   */
  _getPropertyValue(property) {
    switch (property.type) {
      case 'title':
        return property.title?.map(t => t.plain_text).join('') || null;
      case 'rich_text':
        return property.rich_text?.map(t => t.plain_text).join('') || null;
      case 'number':
        return property.number;
      case 'select':
        return property.select?.name || null;
      case 'multi_select':
        return property.multi_select?.length > 0 ? property.multi_select : null;
      case 'date':
        return property.date?.start || null;
      case 'checkbox':
        return property.checkbox;
      case 'url':
        return property.url || null;
      case 'email':
        return property.email || null;
      case 'phone_number':
        return property.phone_number || null;
      case 'formula':
        return this._getFormulaValue(property.formula);
      case 'rollup':
        return this._getRollupValue(property.rollup);
      case 'relation':
        return property.relation?.length > 0 ? property.relation : null;
      case 'people':
        return property.people?.length > 0 ? property.people : null;
      case 'files':
        return property.files?.length > 0 ? property.files : null;
      case 'status':
        return property.status?.name || null;
      default:
        return null;
    }
  }

  /**
   * Formatea el valor de una propiedad para HTML
   * @private
   */
  _formatPropertyValue(property) {
    switch (property.type) {
      case 'rich_text':
        return this.renderRichText(property.rich_text);
      
      case 'number':
        return property.number !== null ? property.number.toString() : '';
      
      case 'select':
        if (!property.select) return '';
        return this._renderSelectTag(property.select.name, property.select.color);
      
      case 'multi_select':
        if (!property.multi_select?.length) return '';
        return property.multi_select
          .map(s => this._renderSelectTag(s.name, s.color))
          .join('');
      
      case 'status':
        if (!property.status) return '';
        return this._renderSelectTag(property.status.name, property.status.color);
      
      case 'date':
        if (!property.date) return '';
        const start = property.date.start;
        const end = property.date.end;
        if (end) {
          return `${this._formatDate(start)} → ${this._formatDate(end)}`;
        }
        return this._formatDate(start);
      
      case 'checkbox':
        return property.checkbox 
          ? '<span class="notion-checkbox notion-checkbox--checked">✓</span>' 
          : '<span class="notion-checkbox">○</span>';
      
      case 'url':
        if (!property.url) return '';
        const displayUrl = property.url.length > 40 
          ? property.url.substring(0, 40) + '...' 
          : property.url;
        return `<a href="${this._escapeHtml(property.url)}" class="notion-property-link" target="_blank" rel="noopener">${this._escapeHtml(displayUrl)}</a>`;
      
      case 'email':
        if (!property.email) return '';
        return `<a href="mailto:${this._escapeHtml(property.email)}" class="notion-property-link">${this._escapeHtml(property.email)}</a>`;
      
      case 'phone_number':
        if (!property.phone_number) return '';
        return `<a href="tel:${this._escapeHtml(property.phone_number)}" class="notion-property-link">${this._escapeHtml(property.phone_number)}</a>`;
      
      case 'formula':
        return this._formatFormulaValue(property.formula);
      
      case 'rollup':
        return this._formatRollupValue(property.rollup);
      
      case 'relation':
        if (!property.relation?.length) return '';
        return `<span class="notion-relation-count">${property.relation.length} linked</span>`;
      
      case 'people':
        if (!property.people?.length) return '';
        return property.people
          .map(p => `<span class="notion-person">${this._escapeHtml(p.name || 'Unknown')}</span>`)
          .join('');
      
      case 'files':
        if (!property.files?.length) return '';
        return `<span class="notion-files-count">${property.files.length} file(s)</span>`;
      
      default:
        return '';
    }
  }

  /**
   * Renderiza un tag de select/multi_select
   * @private
   */
  _renderSelectTag(name, color) {
    const colorClass = color ? `notion-tag--${color}` : '';
    return `<span class="notion-tag ${colorClass}">${this._escapeHtml(name)}</span>`;
  }

  /**
   * Formatea una fecha
   * @private
   */
  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      // Si tiene hora (no es medianoche UTC), mostrar también la hora
      if (dateStr.includes('T') && !dateStr.endsWith('T00:00:00.000Z')) {
        return date.toLocaleString('es-ES', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      return date.toLocaleDateString('es-ES', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  }

  /**
   * Obtiene valor de formula
   * @private
   */
  _getFormulaValue(formula) {
    if (!formula) return null;
    switch (formula.type) {
      case 'string': return formula.string;
      case 'number': return formula.number;
      case 'boolean': return formula.boolean;
      case 'date': return formula.date?.start;
      default: return null;
    }
  }

  /**
   * Formatea valor de formula
   * @private
   */
  _formatFormulaValue(formula) {
    if (!formula) return '';
    switch (formula.type) {
      case 'string': return this._escapeHtml(formula.string || '');
      case 'number': return formula.number?.toString() || '';
      case 'boolean': return formula.boolean ? '✓' : '✗';
      case 'date': return this._formatDate(formula.date?.start);
      default: return '';
    }
  }

  /**
   * Obtiene valor de rollup
   * @private
   */
  _getRollupValue(rollup) {
    if (!rollup) return null;
    switch (rollup.type) {
      case 'number': return rollup.number;
      case 'date': return rollup.date?.start;
      case 'array': return rollup.array?.length > 0 ? rollup.array : null;
      default: return null;
    }
  }

  /**
   * Formatea valor de rollup
   * @private
   */
  _formatRollupValue(rollup) {
    if (!rollup) return '';
    switch (rollup.type) {
      case 'number': return rollup.number?.toString() || '';
      case 'date': return this._formatDate(rollup.date?.start);
      case 'array': 
        if (!rollup.array?.length) return '';
        return `${rollup.array.length} item(s)`;
      default: return '';
    }
  }

  /**
   * Escapa HTML
   * @private
   */
  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      
      case 'code': {
        const codeText = this.renderRichText(block.code?.rich_text);
        const gmOnlyClass = this._getCodeBlockGmTag(block) ? ' notion-gm-only' : '';
        return `<pre class="notion-code${gmOnlyClass}"><code>${codeText}</code></pre>`;
      }
      
      case 'quote': {
        const quoteGmClass = this._blockRichTextContainsGmTag(block) ? ' notion-gm-only' : '';
        return `<div class="notion-quote${quoteGmClass}">${this.renderRichText(block.quote?.rich_text)}</div>`;
      }
      
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
      
      case 'synced_block':
        // Synced blocks se procesan de forma asíncrona en renderBlocks
        // Placeholder para el procesamiento síncrono
        return `<div class="notion-synced-block" data-synced-block-id="${block.id}"></div>`;
      
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
              onerror="this.style.display='none'; const loading = this.parentElement.querySelector('.image-loading'); if(loading) loading.remove(); if(!this.parentElement.querySelector('.notion-image-error')) { const errorDiv = document.createElement('div'); errorDiv.className='empty-state notion-image-error'; errorDiv.innerHTML='<div class=\\'empty-state-icon\\'>⚠️</div><p class=\\'empty-state-text\\'>Could not load image</p><p class=\\'empty-state-hint\\'>The URL may have expired</p><button class=\\'btn btn--sm btn--ghost\\' onclick=\\'window.refreshImage && window.refreshImage(this)\\'>🔄 Reload page</button>'; this.parentElement.appendChild(errorDiv); }"
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
    const gmOnlyClass = this._blockRichTextContainsGmTag(block) ? ' notion-gm-only' : '';

    // Si tiene hijos, se renderizarán después
    const hasChildren = block.has_children;
    const childrenPlaceholder = hasChildren 
      ? `<div class="notion-callout-children" data-callout-id="${block.id}"></div>`
      : '';

    return `
      <div class="notion-callout${gmOnlyClass}" data-has-children="${hasChildren}">
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
   * Renderiza una base de datos de Notion
   * @param {Object} databaseBlock - Bloque de base de datos
   * @returns {Promise<string>}
   */
  async renderDatabase(databaseBlock) {
    try {
      if (!this.notionService) {
        throw new Error('NotionService no disponible');
      }

      const databaseId = databaseBlock.id;
      const databaseTitle = databaseBlock.child_database?.title || 'Database';
      
      // Intentar obtener información de la base de datos para verificar si es accesible
      // Si se puede obtener, significa que la base de datos se procesó correctamente
      // durante la importación, así que no mostramos nada
      try {
        const dbPages = await this.notionService.fetchDatabasePages(databaseId);
        
        // Si se puede obtener información, la base de datos se procesó correctamente
        // No mostramos nada porque las páginas ya están en el vault
        if (dbPages && dbPages.length >= 0) {
          log('✅ Base de datos procesada correctamente:', databaseTitle);
          return ''; // No mostrar nada si se procesó correctamente
        }
      } catch (dbError) {
        // Si hay un error al obtener la base de datos, mostrar mensaje de error
        logWarn('Error al obtener información de base de datos:', dbError);
        throw new Error('La base de datos no está accesible o no está compartida con tu integración de Notion');
      }
      
      // Si llegamos aquí, no debería pasar, pero por seguridad retornamos vacío
      return '';
    } catch (error) {
      logWarn('Error al renderizar base de datos:', error);
      throw error; // Re-lanzar para que se maneje en renderBlocks
    }
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

      // Obtener las filas de la tabla (respetar useCache para refresh)
      log(`📊 renderTable: obteniendo filas para tabla ${tableBlock.id}, useCache=${this.useCache}`);
      const rows = await this.notionService.fetchBlocks(tableBlock.id, this.useCache);
      
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

      // Manejar synced_block (renderizado transparente)
      if (type === 'synced_block') {
        html += await this._renderSyncedBlock(block, typesArray, headingLevelOffset);
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

      // Manejar bases de datos
      if (type === 'child_database') {
        try {
          const dbHtml = await this.renderDatabase(block);
          html += dbHtml;
        } catch (error) {
          log('❌ Error al renderizar base de datos:', error);
          html += `
            <div class="empty-state notion-database-placeholder">
              <div class="empty-state-icon">⚠️</div>
              <p class="empty-state-text">Error loading database</p>
              <p class="empty-state-hint">${error.message || 'The database may not be accessible'}</p>
            </div>
          `;
        }
        continue;
      }

      // Renderizar bloque normal (los code con 🔒 GM llevan clase notion-gm-only; se ocultan con CSS para players)
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
    
    // Los toggles, column_list, callouts, synced_block y bloques con hijos siempre se procesan 
    // para buscar contenido filtrado dentro de ellos
    if (block.type === 'toggle' || block.type === 'column_list' || block.type === 'callout' || 
        block.type === 'synced_block' || block.has_children) {
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
    let gmOnlyClass = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id, this.useCache);
      if (children.length > 0) {
        if (this._blockRichTextContainsGmTag(block) || await this._hasGmOnlyContentInDescendants(children)) gmOnlyClass = ' notion-gm-only';
        toggleContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    } else if (this._blockRichTextContainsGmTag(block)) {
      gmOnlyClass = ' notion-gm-only';
    }

    // Si hay filtro y el toggle no tiene contenido filtrado, no mostrarlo
    if (typesArray && !typesArray.includes('toggle') && !toggleContent.trim()) {
      return '';
    }

    return `
      <details class="notion-toggle${gmOnlyClass}">
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
    let gmOnlyClass = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id, this.useCache);
      if (children.length > 0) {
        if (this._blockRichTextContainsGmTag(block) || await this._hasGmOnlyContentInDescendants(children)) gmOnlyClass = ' notion-gm-only';
        toggleContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    } else if (this._blockRichTextContainsGmTag(block)) {
      gmOnlyClass = ' notion-gm-only';
    }

    // Si hay filtro y el toggle no tiene contenido, no mostrarlo
    if (typesArray && !typesArray.includes(type) && !toggleContent.trim()) {
      return '';
    }

    return `
      <details class="notion-toggle notion-toggle-heading notion-toggle-h${level}${gmOnlyClass}">
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
    let gmOnlyClass = '';

    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id, this.useCache);
      if (children.length > 0) {
        if (this._blockRichTextContainsGmTag(block) || await this._hasGmOnlyContentInDescendants(children)) gmOnlyClass = ' notion-gm-only';
        childrenContent = await this.renderBlocks(children, typesArray, headingLevelOffset);
      }
    } else if (this._blockRichTextContainsGmTag(block)) {
      gmOnlyClass = ' notion-gm-only';
    }

    return `
      <div class="notion-callout${gmOnlyClass}">
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
      const children = await this.notionService.fetchChildBlocks(columnListBlock.id, this.useCache);
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
        const children = await this.notionService.fetchChildBlocks(col.id, this.useCache);
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

  /**
   * Renderiza un synced_block de forma transparente
   * El usuario no ve diferencia entre bloque original y copia
   * @private
   * @param {Object} block - Bloque synced_block
   * @param {Array} typesArray - Filtro de tipos
   * @param {number} headingLevelOffset - Offset de headings
   * @returns {Promise<string>}
   */
  async _renderSyncedBlock(block, typesArray, headingLevelOffset) {
    try {
      if (!this.notionService) {
        logWarn('NotionService no disponible para synced_block');
        return '';
      }

      const syncedBlock = block.synced_block;
      
      // Si es original (synced_from es null) - los hijos están en el bloque mismo
      // Si es copia (synced_from tiene block_id) - cargar hijos del bloque original
      let blockIdToFetch;
      
      if (syncedBlock?.synced_from?.block_id) {
        // Es una copia - cargar desde el bloque original
        blockIdToFetch = syncedBlock.synced_from.block_id;
        log('📌 Synced block (copia) - cargando desde original:', blockIdToFetch);
      } else {
        // Es el original - cargar sus propios hijos
        blockIdToFetch = block.id;
        log('📌 Synced block (original) - cargando hijos de:', blockIdToFetch);
      }

      // Obtener los bloques hijos (respetar useCache para refresh)
      const children = await this.notionService.fetchChildBlocks(blockIdToFetch, this.useCache);
      
      if (!children || children.length === 0) {
        return '';
      }

      // Renderizar los hijos de forma transparente (sin wrapper especial)
      const content = await this.renderBlocks(children, typesArray, headingLevelOffset);
      
      return content;
    } catch (error) {
      logWarn('Error al renderizar synced_block:', error);
      return '';
    }
  }
}

export default NotionRenderer;

