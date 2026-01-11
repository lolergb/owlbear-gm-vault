/**
 * @fileoverview Renderizador de UI para categorías y páginas
 * 
 * Genera el HTML para la navegación de categorías y páginas.
 * Compatible con el CSS existente (app.css)
 */

import { generateColorFromString, getInitial, extractNotionPageId } from '../utils/helpers.js';
import { log } from '../utils/logger.js';

/**
 * Renderizador de interfaz de usuario
 */
export class UIRenderer {
  constructor() {
    // Referencia al StorageService
    this.storageService = null;
    // Referencia al NotionService
    this.notionService = null;
    // Callbacks para páginas
    this.onPageClick = null;
    this.onVisibilityChange = null;
    this.onPageEdit = null;
    this.onPageDelete = null;
    this.onPageMove = null;
    this.onPageDuplicate = null;
    // Callbacks para categorías
    this.onCategoryEdit = null;
    this.onCategoryDelete = null;
    this.onCategoryMove = null;
    this.onCategoryDuplicate = null;
    this.onAddPage = null;
    this.onAddCategory = null;
    this.onShowModal = null;
    // Es GM? (true = GM completo, 'coGM' = coGM solo compartir, false = player)
    this.isGM = true;
    // Es coGM? (solo ve botón compartir)
    this.isCoGM = false;
    // Config para calcular posiciones
    this.config = null;
  }

  /**
   * Inyecta dependencias
   */
  setDependencies({ storageService, notionService }) {
    if (storageService) this.storageService = storageService;
    if (notionService) this.notionService = notionService;
  }

  /**
   * Establece la configuración actual
   */
  setConfig(config) {
    this.config = config;
  }

  /**
   * Establece callbacks de eventos
   */
  setCallbacks(callbacks) {
    const keys = [
      'onPageClick', 'onVisibilityChange', 'onPageShare', 'onPageEdit', 'onPageDelete', 
      'onPageMove', 'onPageDuplicate', 'onCategoryEdit', 'onCategoryDelete',
      'onCategoryMove', 'onCategoryDuplicate', 'onAddPage', 'onAddCategory', 'onShowModal'
    ];
    keys.forEach(key => {
      if (callbacks[key]) this[key] = callbacks[key];
    });
  }

  /**
   * Verifica si una categoría tiene contenido visible para players
   */
  hasVisibleContentForPlayers(category) {
    if (category.pages && category.pages.some(p => p.visibleToPlayers === true)) {
      return true;
    }
    if (category.categories) {
      return category.categories.some(subcat => this.hasVisibleContentForPlayers(subcat));
    }
    return false;
  }

  /**
   * Renderiza todas las categorías desde config
   * @param {Object} config - Configuración
   * @param {HTMLElement} container - Contenedor
   * @param {string} roomId - ID de la room
   * @param {boolean|Object} isGMOrOptions - true/false para GM, o objeto {isGM, isCoGM}
   */
  renderAllCategories(config, container, roomId, isGMOrOptions = true) {
    // Soportar tanto boolean como objeto de opciones
    if (typeof isGMOrOptions === 'object') {
      this.isGM = isGMOrOptions.isGM !== false;
      this.isCoGM = isGMOrOptions.isCoGM === true;
    } else {
      this.isGM = isGMOrOptions;
      this.isCoGM = false;
    }
    
    container.innerHTML = '';

    // Verificar si hay contenido (páginas o categorías en root)
    const hasRootPages = config?.pages && config.pages.length > 0;
    const hasRootCategories = config?.categories && config.categories.length > 0;
    const hasContent = hasRootPages || hasRootCategories;

    if (!hasContent) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <p class="empty-state-text">No pages configured</p>
          <p class="empty-state-hint">Click + to add your first page or folder</p>
        </div>
      `;
      return;
    }

    // Obtener orden combinado del root (páginas + categorías mezcladas)
    const rootPages = (config.pages || []).filter(page => {
      // Filtrar páginas válidas
      if (!page.url || page.url.includes('...') || 
          (!page.url.startsWith('http') && !page.url.startsWith('/'))) {
        return false;
      }
      // Si es jugador, filtrar solo páginas visibles
      if (!this.isGM && page.visibleToPlayers !== true) {
        return false;
      }
      return true;
    });
    
    const rootCombinedOrder = this._getCombinedOrder(config, rootPages);
    
    // Renderizar según el orden combinado del root
    rootCombinedOrder.forEach((item, index) => {
      if (item.type === 'page') {
        const page = rootPages[item.index];
        if (page) {
          // Usar el índice original en config.pages
          const originalIndex = (config.pages || []).findIndex(p => p.name === page.name && p.url === page.url);
          const pageButton = this._createPageButton(page, roomId, [], originalIndex !== -1 ? originalIndex : item.index, this.isGM);
          container.appendChild(pageButton);
          // Aplicar animación con delay stagger
          requestAnimationFrame(() => {
            pageButton.classList.add('list-item-entering');
          });
        }
      } else if (item.type === 'category') {
        const category = (config.categories || [])[item.index];
        if (category) {
          // Si es jugador, verificar que la categoría tiene contenido visible
          if (this.isGM || this.hasVisibleContentForPlayers(category)) {
      this.renderCategory(category, container, 0, roomId, [], this.isGM);
            // Aplicar animación al título de la categoría
            const categoryTitle = container.querySelector('.category:last-child .category-title-container');
            if (categoryTitle) {
              requestAnimationFrame(() => {
                categoryTitle.classList.add('list-item-entering');
              });
            }
          }
        }
      }
    });
  }

  /**
   * Renderiza una categoría completa
   */
  renderCategory(category, parentElement, level = 0, roomId = null, categoryPath = [], isGM = true) {
    // Si es jugador, verificar contenido visible
    if (!isGM && !this.hasVisibleContentForPlayers(category)) {
      return;
    }

    if (!category.name) return;

    // Filtrar páginas válidas
    let categoryPages = (category.pages || []).filter(page => 
      page.url && 
      !page.url.includes('...') && 
      (page.url.startsWith('http') || page.url.startsWith('/'))
    );

    // Si es jugador, filtrar solo páginas visibles
    if (!isGM) {
      categoryPages = categoryPages.filter(page => page.visibleToPlayers === true);
    }

    const hasPages = categoryPages.length > 0;
    const hasSubcategories = category.categories && category.categories.length > 0;
    const hasContent = hasPages || hasSubcategories;

    // Crear contenedor de categoría (usa clases del CSS original)
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category-group';
    categoryDiv.dataset.level = level;
    categoryDiv.dataset.categoryName = category.name;

    // === TÍTULO CON BOTÓN DE COLAPSAR ===
    const titleContainer = document.createElement('div');
    titleContainer.className = 'category-title-container';

    // Botón de colapsar
    const collapseButton = document.createElement('button');
    collapseButton.className = 'category-collapse-button';
    
    const collapseIcon = document.createElement('img');
    collapseIcon.className = 'category-collapse-icon';
    
    const collapseStateKey = `category-collapsed-${category.name}-level-${level}`;
    const isCollapsed = localStorage.getItem(collapseStateKey) === 'true';
    collapseIcon.src = isCollapsed ? 'img/folder-close.svg' : 'img/folder-open.svg';
    collapseIcon.alt = isCollapsed ? 'Expand' : 'Collapse';
    collapseButton.appendChild(collapseIcon);
    titleContainer.appendChild(collapseButton);

    // Título
    const headingLevel = Math.min(level + 2, 6);
    const categoryTitle = document.createElement(`h${headingLevel}`);
    categoryTitle.className = 'category-title';
    categoryTitle.textContent = category.name;
    titleContainer.appendChild(categoryTitle);

    // Botón de menú contextual para carpetas (solo GM completo, no coGM)
    if (isGM && !this.isCoGM) {
      const contextMenuButton = document.createElement('button');
      contextMenuButton.className = 'category-context-menu-button icon-button';
      contextMenuButton.innerHTML = '<img src="img/icon-contextualmenu.svg" class="icon-button-icon" alt="Menu" />';
      contextMenuButton.title = 'Folder options';
      contextMenuButton.style.opacity = '0';
      
      // Mostrar/ocultar en hover
      titleContainer.addEventListener('mouseenter', () => {
        if (!contextMenuButton.classList.contains('context-menu-active')) {
          contextMenuButton.style.opacity = '1';
        }
      });
      titleContainer.addEventListener('mouseleave', (e) => {
        if (!contextMenuButton.classList.contains('context-menu-active')) {
          contextMenuButton.style.opacity = '0';
        }
      });

      contextMenuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          this._showCategoryContextMenu(contextMenuButton, category, [...categoryPath, category.name], titleContainer, roomId);
        } catch (error) {
          console.error('Error al mostrar menú contextual de categoría:', error, { category, categoryPath });
        }
      });

      titleContainer.appendChild(contextMenuButton);
    }

    categoryDiv.appendChild(titleContainer);

    // === CONTENIDO ===
    const contentContainer = document.createElement('div');
    contentContainer.className = 'category-content';
    contentContainer.style.display = isCollapsed ? 'none' : 'block';

    // Obtener orden combinado (páginas + subcategorías mezcladas)
    const combinedOrder = this._getCombinedOrder(category, categoryPages);
    
    // Renderizar según el orden combinado
    combinedOrder.forEach((item, index) => {
      if (item.type === 'page') {
        const page = categoryPages[item.index];
        if (page) {
          // Usar el índice original en category.pages, no en categoryPages filtradas
          const originalIndex = (category.pages || []).findIndex(p => p.name === page.name && p.url === page.url);
          const pageButton = this._createPageButton(page, roomId, [...categoryPath, category.name], originalIndex !== -1 ? originalIndex : item.index, isGM);
          contentContainer.appendChild(pageButton);
          // Aplicar animación con delay stagger
          requestAnimationFrame(() => {
            pageButton.classList.add('list-item-entering');
          });
        }
      } else if (item.type === 'category') {
        const subcat = (category.categories || [])[item.index];
        if (subcat) {
          // Si es jugador, verificar que la subcategoría tiene contenido visible
          if (isGM || this.hasVisibleContentForPlayers(subcat)) {
            this.renderCategory(subcat, contentContainer, level + 1, roomId, [...categoryPath, category.name], isGM);
            // Aplicar animación al título de la categoría
            const subcatTitle = contentContainer.querySelector(`.category:last-child .category-title-container`);
            if (subcatTitle) {
              requestAnimationFrame(() => {
                subcatTitle.classList.add('list-item-entering');
              });
            }
          }
        }
      }
    });

    categoryDiv.appendChild(contentContainer);

    // === EVENT LISTENERS ===
    // Click para colapsar/expandir
    titleContainer.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      
      const newIsCollapsed = contentContainer.style.display !== 'none';
      contentContainer.style.display = newIsCollapsed ? 'none' : 'block';
      collapseIcon.src = newIsCollapsed ? 'img/folder-close.svg' : 'img/folder-open.svg';
      localStorage.setItem(collapseStateKey, newIsCollapsed);
    });

    parentElement.appendChild(categoryDiv);
    
    // Aplicar animación al título de la categoría
    requestAnimationFrame(() => {
      titleContainer.classList.add('list-item-entering');
    });
  }

  /**
   * Crea un botón de página (compatible con CSS original)
   * @private
   */
  _createPageButton(page, roomId, categoryPath, pageIndex, isGM) {
    const button = document.createElement('button');
    button.className = 'page-button';
    button.dataset.pageIndex = pageIndex;
    button.dataset.pageName = page.name;
    button.dataset.pageUrl = page.url;

    // Generar color e inicial del placeholder
    const placeholderColor = generateColorFromString(page.name);
    const placeholderInitial = getInitial(page.name);

    // Determinar icono de tipo de link
    let linkIconHtml = '';
    const url = page.url || '';
    if (url.includes('notion.so') || url.includes('notion.site')) {
      linkIconHtml = '<img src="img/icon-notion.svg" alt="Notion" class="page-link-icon">';
    } else if (url.includes('dndbeyond.com')) {
      linkIconHtml = '<img src="img/icon-dnd.svg" alt="D&D Beyond" class="page-link-icon">';
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      linkIconHtml = '<img src="img/icon-youtube.svg" alt="YouTube" class="page-link-icon">';
    } else if (url.includes('vimeo.com')) {
      linkIconHtml = '<img src="img/icon-vimeo.svg" alt="Vimeo" class="page-link-icon">';
    } else if (url.includes('drive.google.com') || url.includes('docs.google.com') || url.includes('sheets.google.com') || url.includes('slides.google.com')) {
      linkIconHtml = '<img src="img/icon-google-docs.svg" alt="Google Docs" class="page-link-icon">';
    } else if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i)) {
      linkIconHtml = '<img src="img/icon-image.svg" alt="Image" class="page-link-icon">';
    } else if (url.match(/\.(mp4|webm|mov)(\?|$)/i)) {
      linkIconHtml = '<img src="img/icon-link.svg" alt="Video" class="page-link-icon">'; // No hay icon-video
    } else if (url.match(/\.(pdf)(\?|$)/i)) {
      linkIconHtml = '<img src="img/icon-pdf.svg" alt="PDF" class="page-link-icon">';
    } else if (url.includes('dropbox.com')) {
      linkIconHtml = '<img src="img/icon-dropbox.svg" alt="Dropbox" class="page-link-icon">';
    } else if (url.includes('figma.com')) {
      linkIconHtml = '<img src="img/icon-figma.svg" alt="Figma" class="page-link-icon">';
    } else if (url.includes('github.com') || url.includes('github.io')) {
      linkIconHtml = '<img src="img/icon-github.svg" alt="GitHub" class="page-link-icon">';
    } else if (url.includes('onedrive.live.com') || url.includes('1drv.ms')) {
      linkIconHtml = '<img src="img/icon-onedrive.svg" alt="OneDrive" class="page-link-icon">';
    } else if (url.includes('codepen.io')) {
      linkIconHtml = '<img src="img/icon-codepen.svg" alt="CodePen" class="page-link-icon">';
    } else if (url.includes('jsfiddle.net')) {
      linkIconHtml = '<img src="img/icon-jsfiddle.svg" alt="JSFiddle" class="page-link-icon">';
    } else if (url.startsWith('http')) {
      linkIconHtml = '<img src="img/icon-link.svg" alt="Link" class="page-link-icon">';
    }

    // Indicador de visible para players
    const visibleIndicator = page.visibleToPlayers 
      ? '<span class="page-visibility-badge">👁️</span>' 
      : '';

    // HTML del botón
    button.innerHTML = `
      <div class="page-button-inner">
        <div class="page-icon-placeholder" style="background: ${placeholderColor};">${placeholderInitial}</div>
        <div class="page-name-text">${page.name}</div>
        ${visibleIndicator}
        ${linkIconHtml}
      </div>
    `;

    // Contenedor de botones de acción (siempre visible para todos los roles)
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'page-button-actions';

    // Botón de compartir con players (todos: GM, coGM y Player)
    const shareButton = document.createElement('button');
    shareButton.className = 'page-share-button';
    shareButton.innerHTML = '<img src="img/icon-players.svg" alt="Share">';
    shareButton.title = 'Share with players';
    
    shareButton.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('🔗 Share button clicked for:', page.name, 'onPageShare:', !!this.onPageShare);
      if (this.onPageShare) {
        this.onPageShare(page, categoryPath, pageIndex);
      } else {
        console.warn('⚠️ onPageShare callback not defined');
      }
    });

    actionsContainer.appendChild(shareButton);

    // Botones adicionales solo para GM completo (no coGM ni Player)
    if (isGM && !this.isCoGM) {
        // Botón de visibilidad
        const visibilityButton = document.createElement('button');
        visibilityButton.className = 'page-visibility-button';
        visibilityButton.innerHTML = `<img src="img/${page.visibleToPlayers ? 'icon-eye-open' : 'icon-eye-close'}.svg" alt="Visibility">`;
        visibilityButton.title = page.visibleToPlayers ? 'Visible to players' : 'Hidden from players';
        
        visibilityButton.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.onVisibilityChange) {
            this.onVisibilityChange(page, categoryPath, pageIndex, !page.visibleToPlayers);
          }
        });

        // Botón de menú contextual (editar/eliminar)
        const contextMenuButton = document.createElement('button');
        contextMenuButton.className = 'page-context-menu-button';
        contextMenuButton.innerHTML = '<img src="img/icon-contextualmenu.svg" alt="Menu">';
        contextMenuButton.title = 'Options';
        contextMenuButton.setAttribute('data-page-name', page.name);
        contextMenuButton.setAttribute('data-page-index', pageIndex);
        
        contextMenuButton.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          try {
            this._showPageContextMenu(contextMenuButton, page, categoryPath, pageIndex);
          } catch (error) {
            console.error('Error al mostrar menú contextual:', error, { page, categoryPath, pageIndex });
          }
        });

        actionsContainer.appendChild(visibilityButton);
        actionsContainer.appendChild(contextMenuButton);
    }
    
    button.appendChild(actionsContainer);

    // Click para abrir página
    button.addEventListener('click', (e) => {
      // Ignorar clicks en los botones de acción
      if (e.target.closest('.page-button-actions')) return;
      
      if (this.onPageClick) {
        this.onPageClick(page, categoryPath, pageIndex);
      }
    });

    // Intentar cargar icono real de Notion
    const pageId = extractNotionPageId(page.url);
    if (pageId && this.notionService) {
      this._loadPageIcon(button, pageId, page.name, linkIconHtml);
    }

    return button;
  }

  /**
   * Obtiene el orden combinado de páginas y categorías
   * @private
   */
  _getCombinedOrder(category, filteredPages = null) {
    const pages = filteredPages || category.pages || [];
    const categories = category.categories || [];
    
    // Si existe un orden guardado explícito, usarlo
    if (category.order && Array.isArray(category.order)) {
      // Validar y filtrar orden existente
      const validOrder = category.order.filter(item => {
        if (item.type === 'category') {
          return categories[item.index];
        } else if (item.type === 'page') {
          return pages[item.index];
        }
        return false;
      });
      
      // Agregar elementos nuevos que no estén en el orden
      categories.forEach((cat, index) => {
        if (!validOrder.some(o => o.type === 'category' && o.index === index)) {
          validOrder.push({ type: 'category', index });
        }
      });
      
      pages.forEach((page, index) => {
        if (!validOrder.some(o => o.type === 'page' && o.index === index)) {
          validOrder.push({ type: 'page', index });
        }
      });
      
      return validOrder;
    }
    
    // Verificar si hay campos _order (importado desde Notion)
    const hasNotionOrder = pages.some(p => p._order !== undefined) || 
                           categories.some(c => c._order !== undefined);
    
    if (hasNotionOrder) {
      // Combinar todo y ordenar por _order
      const allItems = [];
      
      categories.forEach((cat, index) => {
        allItems.push({ 
          type: 'category', 
          index, 
          _order: cat._order !== undefined ? cat._order : 9999 
        });
      });
      
      pages.forEach((page, index) => {
        allItems.push({ 
          type: 'page', 
          index, 
          _order: page._order !== undefined ? page._order : 9999 
        });
      });
      
      // Ordenar por _order
      allItems.sort((a, b) => a._order - b._order);
      
      return allItems.map(item => ({ type: item.type, index: item.index }));
    }
    
    // Si no hay orden guardado ni _order, usar defecto (categorías primero, luego páginas)
    const order = [];
    categories.forEach((cat, index) => {
      order.push({ type: 'category', index });
    });
    pages.forEach((page, index) => {
      order.push({ type: 'page', index });
    });
    
    return order;
  }

  /**
   * Carga el icono real de una página de Notion
   * @private
   */
  async _loadPageIcon(button, pageId, pageName, linkIconHtml) {
    try {
      const pageInfo = await this.notionService.fetchPageInfo(pageId);
      if (pageInfo && pageInfo.icon) {
        let iconHtml = '';
        if (pageInfo.icon.type === 'emoji') {
          iconHtml = `<span class="page-icon-emoji">${pageInfo.icon.emoji || '📄'}</span>`;
        } else if (pageInfo.icon.type === 'external' && pageInfo.icon.external?.url) {
          iconHtml = `<img src="${pageInfo.icon.external.url}" alt="${pageName}" class="page-icon-image" />`;
        } else if (pageInfo.icon.type === 'file' && pageInfo.icon.file?.url) {
          iconHtml = `<img src="${pageInfo.icon.file.url}" alt="${pageName}" class="page-icon-image" />`;
        }

        if (iconHtml) {
          const inner = button.querySelector('.page-button-inner');
          if (inner) {
            inner.innerHTML = `
              <div style="display: flex; align-items: center; gap: var(--spacing-md); width: 100%;">
                ${iconHtml}
                <div class="page-name" style="flex: 1; text-align: left;">${pageName}</div>
                ${linkIconHtml}
              </div>
            `;
          }
        }
      }
    } catch (e) {
      // Ignorar errores de carga de icono
    }
  }

  /**
   * Obtiene el objeto padre dado un path de categorías
   * @private
   */
  _getParentFromPath(categoryPath) {
    if (!this.config) return null;
    let current = this.config;
    for (const catName of categoryPath) {
      const cat = (current.categories || []).find(c => c.name === catName);
      if (cat) current = cat;
      else return null;
    }
    return current;
  }

  /**
   * Obtiene el total de páginas en una categoría (para validar move)
   * @private
   */
  _getTotalPagesInCategory(categoryPath) {
    if (!this.config) return 0;
    let current = this.config;
    for (const catName of categoryPath) {
      const cat = (current.categories || []).find(c => c.name === catName);
      if (cat) current = cat;
      else return 0;
    }
    return (current.pages || []).length;
  }

  /**
   * Obtiene el total de categorías en el padre
   * @private
   */
  _getTotalCategoriesInParent(categoryPath) {
    if (!this.config) return 0;
    if (categoryPath.length === 0) return (this.config.categories || []).length;
    
    let current = this.config;
    // Navegar hasta el padre (todos menos el último)
    for (let i = 0; i < categoryPath.length - 1; i++) {
      const catName = categoryPath[i];
      const cat = (current.categories || []).find(c => c.name === catName);
      if (cat) current = cat;
      else return 0;
    }
    return (current.categories || []).length;
  }

  /**
   * Obtiene el índice de una categoría en su padre
   * @private  
   */
  _getCategoryIndex(categoryPath) {
    if (!this.config || categoryPath.length === 0) return -1;
    const catName = categoryPath[categoryPath.length - 1];
    
    let current = this.config;
    // Navegar hasta el padre
    for (let i = 0; i < categoryPath.length - 1; i++) {
      const name = categoryPath[i];
      const cat = (current.categories || []).find(c => c.name === name);
      if (cat) current = cat;
      else return -1;
    }
    return (current.categories || []).findIndex(c => c.name === catName);
  }

  /**
   * Muestra el menú contextual de una página
   * @private
   */
  _showPageContextMenu(button, page, categoryPath, pageIndex) {
    if (!button || !page) {
      console.error('_showPageContextMenu: button o page no válidos', { button, page });
      return;
    }

    const existingMenu = document.getElementById('context-menu');
    if (existingMenu) existingMenu.remove();

    const pageButton = button.closest('.page-button');
    if (pageButton) pageButton.classList.add('context-menu-open');
    button.classList.add('context-menu-active');

    const rect = button.getBoundingClientRect();
    
    // Calcular si se puede mover usando el orden combinado
    let canMoveUp = false;
    let canMoveDown = false;
    
    try {
      const parent = this._getParentFromPath(categoryPath);
      if (parent) {
        const combinedOrder = this._getCombinedOrder(parent, parent?.pages || []);
        const posInOrder = combinedOrder.findIndex(o => o.type === 'page' && o.index === pageIndex);
        canMoveUp = posInOrder > 0;
        canMoveDown = posInOrder >= 0 && posInOrder < combinedOrder.length - 1;
      }
    } catch (e) {
      console.error('Error calculando orden para menú contextual:', e);
    }
    
    const menuItems = [
      { 
        icon: 'img/icon-edit.svg', 
        text: 'Edit', 
        action: () => this._showEditPageModal(page, categoryPath, pageIndex)
      },
      { 
        icon: 'img/icon-clone.svg', 
        text: 'Duplicate', 
        action: () => {
          if (this.onPageDuplicate) {
            this.onPageDuplicate(page, categoryPath, pageIndex);
          }
        }
      },
      { separator: true }
    ];

    // Agregar opciones de mover solo si es posible
    if (canMoveUp) {
      menuItems.push({ 
        icon: 'img/icon-arrow.svg', 
        text: 'Move up',
        rotation: 'rotate(90deg)',
        action: () => {
          if (this.onPageMove) {
            this.onPageMove(page, categoryPath, pageIndex, 'up');
          }
        }
      });
    }
    if (canMoveDown) {
      menuItems.push({ 
        icon: 'img/icon-arrow.svg', 
        text: 'Move down',
        rotation: 'rotate(-90deg)',
        action: () => {
          if (this.onPageMove) {
            this.onPageMove(page, categoryPath, pageIndex, 'down');
          }
        }
      });
    }
    if (canMoveUp || canMoveDown) {
      menuItems.push({ separator: true });
    }

    menuItems.push({ 
      icon: 'img/icon-trash.svg', 
      text: 'Delete', 
      action: () => this._confirmDeletePage(page, categoryPath, pageIndex)
    });

    // Validar que rect sea válido
    if (!rect || rect.width === 0 || rect.height === 0) {
      console.error('_showPageContextMenu: rect no válido', { rect, button });
      return;
    }

    try {
      const menu = this._createContextMenu(menuItems, { x: rect.left, y: rect.bottom + 4 }, () => {
        button.classList.remove('context-menu-active');
        if (pageButton) pageButton.classList.remove('context-menu-open');
      });
      
      if (!menu) {
        console.error('_showPageContextMenu: _createContextMenu retornó null');
      }
    } catch (e) {
      console.error('Error creando menú contextual:', e);
      // Limpiar clases en caso de error
      button.classList.remove('context-menu-active');
      if (pageButton) pageButton.classList.remove('context-menu-open');
    }
  }

  /**
   * Muestra el menú contextual de una categoría
   * @private
   */
  _showCategoryContextMenu(button, category, categoryPath, titleContainer, roomId) {
    if (!button || !category) {
      console.error('_showCategoryContextMenu: button o category no válidos', { button, category });
      return;
    }

    const existingMenu = document.getElementById('context-menu');
    if (existingMenu) existingMenu.remove();

    button.classList.add('context-menu-active');
    titleContainer.classList.add('context-menu-open');

    const rect = button.getBoundingClientRect();
    
    // Calcular si se puede mover usando el orden combinado
    let canMoveUp = false;
    let canMoveDown = false;
    
    try {
      // Para categorías, el padre es el path sin el último elemento
      const parentPath = categoryPath.slice(0, -1);
      const parent = this._getParentFromPath(parentPath);
      if (parent) {
        const catIndex = this._getCategoryIndex(categoryPath);
        const combinedOrder = this._getCombinedOrder(parent, parent?.pages || []);
        const posInOrder = combinedOrder.findIndex(o => o.type === 'category' && o.index === catIndex);
        canMoveUp = posInOrder > 0;
        canMoveDown = posInOrder >= 0 && posInOrder < combinedOrder.length - 1;
      }
    } catch (e) {
      console.error('Error calculando orden para menú contextual de categoría:', e);
    }
    
    const menuItems = [
      { 
        icon: 'img/folder-close.svg', 
        text: 'Add folder', 
        action: () => {
          if (this.onAddCategory) {
            this.onAddCategory(categoryPath, roomId);
          }
        }
      },
      { 
        icon: 'img/icon-page.svg', 
        text: 'Add page', 
        action: () => {
          if (this.onAddPage) {
            this.onAddPage(categoryPath, roomId);
          }
        }
      },
      { separator: true },
      { 
        icon: 'img/icon-edit.svg', 
        text: 'Edit', 
        action: () => {
          if (this.onCategoryEdit) {
            this.onCategoryEdit(category, categoryPath);
          }
        }
      },
      { 
        icon: 'img/icon-clone.svg', 
        text: 'Duplicate', 
        action: () => {
          if (this.onCategoryDuplicate) {
            this.onCategoryDuplicate(category, categoryPath);
          }
        }
      },
      { separator: true }
    ];

    // Agregar opciones de mover solo si es posible
    if (canMoveUp) {
      menuItems.push({ 
        icon: 'img/icon-arrow.svg', 
        text: 'Move up',
        rotation: 'rotate(90deg)',
        action: () => {
          if (this.onCategoryMove) {
            this.onCategoryMove(category, categoryPath, 'up');
          }
        }
      });
    }
    if (canMoveDown) {
      menuItems.push({ 
        icon: 'img/icon-arrow.svg', 
        text: 'Move down',
        rotation: 'rotate(-90deg)',
        action: () => {
          if (this.onCategoryMove) {
            this.onCategoryMove(category, categoryPath, 'down');
          }
        }
      });
    }
    if (canMoveUp || canMoveDown) {
      menuItems.push({ separator: true });
    }

    menuItems.push({ 
      icon: 'img/icon-trash.svg', 
      text: 'Delete', 
      action: () => {
        if (confirm(`Delete folder "${category.name}" and all its contents?`)) {
          if (this.onCategoryDelete) {
            this.onCategoryDelete(category, categoryPath);
          }
        }
      }
    });

    // Validar que rect sea válido
    if (!rect || rect.width === 0 || rect.height === 0) {
      console.error('_showCategoryContextMenu: rect no válido', { rect, button });
      return;
    }

    try {
      const menu = this._createContextMenu(menuItems, { x: rect.left, y: rect.bottom + 4 }, () => {
        button.classList.remove('context-menu-active');
        titleContainer.classList.remove('context-menu-open');
        button.style.opacity = '0';
      });
      
      if (!menu) {
        console.error('_showCategoryContextMenu: _createContextMenu retornó null');
      }
    } catch (e) {
      console.error('Error creando menú contextual de categoría:', e);
      // Limpiar clases en caso de error
      button.classList.remove('context-menu-active');
      titleContainer.classList.remove('context-menu-open');
    }
  }

  /**
   * Crea un menú contextual con overlay para capturar clicks fuera
   * @private
   */
  _createContextMenu(items, position, onClose) {
    // Remover menú y overlay existentes
    const existingMenu = document.getElementById('context-menu');
    if (existingMenu) existingMenu.remove();
    const existingOverlay = document.getElementById('context-menu-overlay');
    if (existingOverlay) existingOverlay.remove();

    // Crear overlay invisible que captura clicks
    const overlay = document.createElement('div');
    overlay.id = 'context-menu-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 9999;
      background: transparent;
    `;

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
    menu.style.zIndex = '10000';

    // Cerrar menú
    const closeMenu = () => {
      menu.remove();
      overlay.remove();
      if (onClose) onClose();
    };

    // Click en overlay cierra el menú (y NO propaga a otros elementos)
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    });

    items.forEach(item => {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.className = 'context-menu__separator';
        menu.appendChild(separator);
        return;
      }

      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu__item';

      // Icono
      let iconHtml = '';
      if (item.icon && item.icon.startsWith('img/')) {
        const rotation = item.rotation ? `transform: ${item.rotation};` : '';
        iconHtml = `<img src="${item.icon}" alt="" class="context-menu__icon" style="${rotation}" />`;
      } else {
        iconHtml = `<span class="context-menu__icon">${item.icon || ''}</span>`;
      }

      menuItem.innerHTML = `${iconHtml}<span>${item.text}</span>`;

      menuItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeMenu();
        if (item.action) {
          try {
            await item.action();
          } catch (error) {
            console.error('Error ejecutando acción del menú:', error);
          }
        }
      });

      menu.appendChild(menuItem);
    });

    // Agregar overlay y menú al body
    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    // Ajustar posición si se sale de la pantalla
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${position.x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${position.y - rect.height}px`;
    }

    return menu;
  }

  /**
   * Muestra modal de edición de página
   * @private
   */
  _showEditPageModal(page, categoryPath, pageIndex) {
    if (this.onShowModal) {
      this.onShowModal('edit-page', {
        page,
        categoryPath,
        pageIndex
      });
    }
  }

  /**
   * Confirma eliminación de página
   * @private
   */
  _confirmDeletePage(page, categoryPath, pageIndex) {
    if (confirm(`Delete "${page.name}"?`)) {
      if (this.onPageDelete) {
        this.onPageDelete(page, categoryPath, pageIndex);
      }
    }
  }

  // ============================================
  // TOAST SYSTEM
  // ============================================

  /**
   * Muestra un toast genérico
   * @param {Object} options - Opciones del toast
   * @param {string} options.type - Tipo: 'success', 'error', 'warning', 'info'
   * @param {string} options.title - Título del toast
   * @param {string} options.message - Mensaje del toast (opcional)
   * @param {number} options.duration - Duración en ms (0 = no auto-cerrar)
   * @returns {HTMLElement} - Elemento del toast
   */
  showToast({ type = 'info', title, message = '', duration = 5000 }) {
    // Remover toast existente
    const existing = document.getElementById('gm-toast');
    if (existing) {
      existing.remove();
    }

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.id = 'gm-toast';
    toast.className = `gm-toast gm-toast--${type}`;
    
    toast.innerHTML = `
      <div class="gm-toast__content">
        <span class="gm-toast__icon">${icons[type] || icons.info}</span>
        <div class="gm-toast__body">
          <div class="gm-toast__title">${title}</div>
          ${message ? `<div class="gm-toast__message">${message}</div>` : ''}
        </div>
        <button class="gm-toast__close" aria-label="Close">✕</button>
      </div>
    `;

    // Evento de cerrar
    toast.querySelector('.gm-toast__close').addEventListener('click', () => {
      this.hideToast();
    });

    document.body.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
      toast.classList.add('gm-toast--visible');
    });

    // Auto-cerrar si tiene duración
    if (duration > 0) {
      this._toastTimeout = setTimeout(() => {
        this.hideToast();
      }, duration);
    }

    return toast;
  }

  /**
   * Oculta el toast actual
   */
  hideToast() {
    if (this._toastTimeout) {
      clearTimeout(this._toastTimeout);
      this._toastTimeout = null;
    }

    const toast = document.getElementById('gm-toast');
    if (toast) {
      toast.classList.remove('gm-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }
  }

  /**
   * Toast de éxito
   */
  showSuccessToast(title, message = '', duration = 5000) {
    return this.showToast({ type: 'success', title, message, duration });
  }

  /**
   * Toast de error
   */
  showErrorToast(title, message = '', duration = 8000) {
    return this.showToast({ type: 'error', title, message, duration });
  }

  /**
   * Toast de advertencia
   */
  showWarningToast(title, message = '', duration = 6000) {
    return this.showToast({ type: 'warning', title, message, duration });
  }

  /**
   * Toast de información
   */
  showInfoToast(title, message = '', duration = 5000) {
    return this.showToast({ type: 'info', title, message, duration });
  }
}

export default UIRenderer;
