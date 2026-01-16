# Plan de Implementación Prioritaria: Enlaces Internos, Bases de Datos y Synced Blocks

Este documento detalla el plan de implementación para las **3 funcionalidades más importantes**:

1. **Enlaces internos** - Navegación tipo wiki dentro del vault
2. **Bases de datos con páginas linkadas** - Crear páginas desde DBs embebidas
3. **Synced blocks** - Bloques sincronizados

## Objetivo

Permitir que los usuarios puedan:
- Hacer clic en enlaces `@Page` y navegar a esa página dentro del vault
- Ver bases de datos embebidas y hacer clic en sus páginas para abrirlas
- Ver contenido sincronizado correctamente

---

## 1. Enlaces Internos (Mentions @Page)

### Funcionalidad

Cuando un usuario hace clic en un mention `@Page Name` en el contenido de Notion:
- Buscar esa página en la configuración del vault
- Abrirla en el modal (igual que si hiciera clic en la lista)
- Si no está en el vault, mostrar opción para agregarla

### Implementación

#### Paso 1: Procesar Mentions en Rich Text

```javascript
// En NotionRenderer.js - renderRichText()
renderRichText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) return '';
  
  return richTextArray.map(text => {
    // ... código existente ...
    
    // NUEVO: Procesar mentions
    if (text.type === 'mention') {
      return this._renderMention(text);
    }
    
    // ... resto del código ...
  }).join('');
}

_renderMention(mentionText) {
  const mention = mentionText.mention;
  
  if (mention.type === 'page') {
    const pageId = mention.page.id;
    const pageTitle = mentionText.plain_text || 'Linked Page';
    
    return `
      <a href="#" 
         class="notion-mention notion-mention-page" 
         data-page-id="${pageId}"
         data-page-title="${this._escapeHtml(pageTitle)}"
         onclick="handleInternalPageLink(event, '${pageId}'); return false;">
        ${pageTitle}
      </a>
    `;
  }
  
  // Otros tipos de mentions (database, user) - opcional
  return `<span class="notion-mention">${mentionText.plain_text}</span>`;
}
```

#### Paso 2: Sistema de Resolución de Páginas

```javascript
// En ExtensionController.js o nuevo InternalLinkHandler.js
class InternalLinkHandler {
  constructor(extensionController) {
    this.controller = extensionController;
  }
  
  /**
   * Busca una página por ID de Notion en la configuración
   */
  findPageByNotionId(notionPageId) {
    const config = this.controller.config;
    if (!config) return null;
    
    // Buscar recursivamente en todas las categorías
    return this._searchPageInConfig(config, notionPageId);
  }
  
  _searchPageInConfig(config, notionPageId) {
    // Buscar en páginas de esta categoría
    if (config.pages) {
      for (const page of config.pages) {
        const pageId = extractNotionPageId(page.url);
        if (pageId === notionPageId) {
          return page;
        }
      }
    }
    
    // Buscar en subcategorías
    if (config.categories) {
      for (const category of config.categories) {
        const found = this._searchPageInConfig(category, notionPageId);
        if (found) return found;
      }
    }
    
    return null;
  }
  
  /**
   * Maneja el clic en un enlace interno
   */
  async handleInternalLink(notionPageId, pageTitle) {
    // 1. Buscar si la página está en el vault
    const existingPage = this.findPageByNotionId(notionPageId);
    
    if (existingPage) {
      // Página existe en el vault - abrirla
      await this.controller.openPage(existingPage);
    } else {
      // Página no está en el vault - ofrecer agregarla
      this._offerToAddPage(notionPageId, pageTitle);
    }
  }
  
  _offerToAddPage(notionPageId, pageTitle) {
    const url = `https://www.notion.so/${pageTitle.replace(/\s+/g, '-')}-${notionPageId}`;
    
    if (confirm(`La página "${pageTitle}" no está en tu vault.\n\n¿Quieres agregarla?`)) {
      // Abrir modal para agregar página
      this.controller.showAddPageModal({
        name: pageTitle,
        url: url,
        notionPageId: notionPageId
      });
    }
  }
}
```

#### Paso 3: Función Global para Manejar Clics

```javascript
// En ExtensionController.js o index.js
window.handleInternalPageLink = async function(event, notionPageId) {
  event.preventDefault();
  
  const linkElement = event.target.closest('.notion-mention-page');
  const pageTitle = linkElement?.dataset.pageTitle || 'Page';
  
  if (window.extensionController) {
    await window.extensionController.internalLinkHandler.handleInternalLink(
      notionPageId, 
      pageTitle
    );
  }
};
```

---

## 2. Bases de Datos con Páginas Linkadas

### Funcionalidad

Cuando hay un bloque `child_database`:
- Mostrar las páginas de esa base de datos
- Cada página es clickeable y abre en el vault
- Si la página no está en el vault, ofrecer agregarla

### Implementación

#### Paso 1: Renderizar Base de Datos con Páginas

```javascript
// En NotionRenderer.js
case 'child_database':
  return await this._renderDatabaseWithPages(block);

async _renderDatabaseWithPages(block) {
  const dbId = block.id; // El ID del bloque es el database_id
  const dbTitle = block.child_database?.title || 'Database';
  
  try {
    // Obtener páginas de la base de datos
    const pages = await this.notionService.queryDatabase(dbId, {
      page_size: 100
    });
    
    if (!pages || pages.length === 0) {
      return `
        <div class="notion-database" data-database-id="${dbId}">
          <div class="database-header">
            <span class="database-icon">📊</span>
            <span class="database-title">${dbTitle}</span>
          </div>
          <div class="database-empty">No pages in this database</div>
        </div>
      `;
    }
    
    // Renderizar cada página como card clickeable
    const pagesHtml = pages.map(page => 
      this._renderDatabasePageCard(page)
    ).join('');
    
    return `
      <div class="notion-database" data-database-id="${dbId}">
        <div class="database-header">
          <span class="database-icon">📊</span>
          <span class="database-title">${dbTitle}</span>
          <span class="database-count">${pages.length} pages</span>
        </div>
        <div class="database-pages-grid">
          ${pagesHtml}
        </div>
      </div>
    `;
  } catch (error) {
    logWarn('Error cargando base de datos:', error);
    return `
      <div class="notion-database-error">
        <span class="database-icon">📊</span>
        <span class="database-title">${dbTitle}</span>
        <p class="error-message">Error loading database: ${error.message}</p>
      </div>
    `;
  }
}

_renderDatabasePageCard(page) {
  const pageId = page.id;
  const title = this._extractPageTitleFromPage(page);
  const icon = page.icon || null;
  const cover = page.cover || null;
  
  // Extraer algunas propiedades importantes para mostrar
  const properties = page.properties || {};
  const preview = this._getPagePreview(properties);
  
  return `
    <div class="database-page-card" 
         data-page-id="${pageId}"
         onclick="handleDatabasePageClick(event, '${pageId}', '${this._escapeHtml(title)}');">
      ${cover ? `<div class="database-page-cover" style="background-image: url('${cover}')"></div>` : ''}
      <div class="database-page-content">
        ${icon ? `<div class="database-page-icon">${this._renderIcon(icon)}</div>` : ''}
        <h3 class="database-page-title">${title}</h3>
        ${preview ? `<div class="database-page-preview">${preview}</div>` : ''}
      </div>
    </div>
  `;
}

_extractPageTitleFromPage(page) {
  // Buscar propiedad de tipo 'title'
  const properties = page.properties || {};
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'title' && prop.title && prop.title.length > 0) {
      return prop.title[0].plain_text || key;
    }
  }
  return 'Untitled';
}

_getPagePreview(properties) {
  // Obtener primera propiedad de texto para preview
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length > 0) {
      const text = prop.rich_text[0].plain_text;
      return text.substring(0, 100) + (text.length > 100 ? '...' : '');
    }
  }
  return null;
}
```

#### Paso 2: Métodos en NotionService

```javascript
// En NotionService.js
async queryDatabase(databaseId, options = {}) {
  const { page_size = 100, filter, sorts } = options;
  
  const url = `${this.apiBaseUrl}/databases/${databaseId}/query`;
  
  const response = await this.fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      page_size,
      filter,
      sorts
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to query database');
  }
  
  const data = await response.json();
  return data.results; // Array de páginas
}
```

#### Paso 3: Manejar Clic en Página de Base de Datos

```javascript
// Función global para manejar clics en páginas de DB
window.handleDatabasePageClick = async function(event, pageId, pageTitle) {
  event.preventDefault();
  event.stopPropagation();
  
  if (window.extensionController) {
    const handler = window.extensionController.internalLinkHandler;
    await handler.handleInternalLink(pageId, pageTitle);
  }
};
```

---

## 3. Synced Blocks

### Funcionalidad

Los bloques sincronizados deben:
- Detectar si es el bloque original o una copia
- Si es copia, cargar el contenido del original
- Renderizar el contenido correctamente

### Implementación

```javascript
// En NotionRenderer.js
case 'synced_block':
  return await this._renderSyncedBlock(block);

async _renderSyncedBlock(block) {
  const syncedBlock = block.synced_block;
  
  // Verificar si es el bloque original o una copia
  if (syncedBlock.synced_from === null) {
    // Es el bloque original - cargar su contenido directamente
    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id);
      if (children && children.length > 0) {
        const childrenHtml = await this.renderBlocks(children);
        return `
          <div class="notion-synced-block notion-synced-block-original" 
               data-synced-id="${block.id}">
            ${childrenHtml}
          </div>
        `;
      }
    }
    return '<div class="notion-synced-block">[Empty synced block]</div>';
  } else {
    // Es una copia - cargar contenido del original
    const originalBlockId = syncedBlock.synced_from.block_id;
    
    try {
      // Obtener el bloque original
      const originalBlock = await this.notionService.fetchBlock(originalBlockId);
      
      if (originalBlock && originalBlock.has_children) {
        const children = await this.notionService.fetchChildBlocks(originalBlockId);
        if (children && children.length > 0) {
          const childrenHtml = await this.renderBlocks(children);
          return `
            <div class="notion-synced-block notion-synced-block-copy" 
                 data-synced-id="${block.id}"
                 data-original-id="${originalBlockId}">
              ${childrenHtml}
            </div>
          `;
        }
      }
      
      return '<div class="notion-synced-block">[Synced content unavailable]</div>';
    } catch (error) {
      logWarn('Error cargando synced block:', error);
      return `
        <div class="notion-synced-block-error">
          [Error loading synced content]
        </div>
      `;
    }
  }
}
```

#### Método en NotionService para Obtener Bloque Individual

```javascript
// En NotionService.js
async fetchBlock(blockId) {
  const url = `${this.apiBaseUrl}/blocks/${blockId}`;
  
  const response = await this.fetch(url, {
    headers: {
      'Authorization': `Bearer ${this.token}`,
      'Notion-Version': '2022-06-28'
    }
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to fetch block');
  }
  
  return await response.json();
}
```

---

## Orden de Implementación Recomendado

### Fase 1: Enlaces Internos (Mentions) - 4-5 horas
1. ✅ Procesar mentions en `renderRichText()`
2. ✅ Crear `InternalLinkHandler`
3. ✅ Sistema de búsqueda de páginas por ID
4. ✅ Función global para manejar clics
5. ✅ Testing

**Resultado**: Los usuarios pueden hacer clic en `@Page` y navegar

---

### Fase 2: Bases de Datos con Páginas - 5-6 horas
1. ✅ Método `queryDatabase()` en NotionService
2. ✅ Renderizar `child_database` con páginas
3. ✅ Cards clickeables para cada página
4. ✅ Integrar con InternalLinkHandler
5. ✅ Testing

**Resultado**: Los usuarios ven bases de datos y pueden abrir sus páginas

---

### Fase 3: Synced Blocks - 3-4 horas
1. ✅ Método `fetchBlock()` en NotionService
2. ✅ Renderizar `synced_block` (original y copia)
3. ✅ Manejar referencias al original
4. ✅ Testing

**Resultado**: Los bloques sincronizados se renderizan correctamente

---

## CSS Necesario

```css
/* Enlaces internos (mentions) */
.notion-mention {
  background-color: rgba(55, 53, 47, 0.08);
  border-radius: 3px;
  padding: 2px 4px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.2s;
}

.notion-mention:hover {
  background-color: rgba(55, 53, 47, 0.16);
}

.notion-mention-page {
  /* Estilo específico para páginas */
}

/* Bases de datos */
.notion-database {
  margin: 1em 0;
  border: 1px solid rgba(55, 53, 47, 0.16);
  border-radius: 3px;
  padding: 1em;
}

.database-header {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 1em;
  font-weight: 600;
}

.database-pages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1em;
}

.database-page-card {
  border: 1px solid rgba(55, 53, 47, 0.16);
  border-radius: 3px;
  padding: 1em;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.database-page-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.database-page-title {
  font-size: 1em;
  font-weight: 600;
  margin: 0.5em 0;
}

.database-page-preview {
  font-size: 0.875em;
  color: rgba(55, 53, 47, 0.6);
  margin-top: 0.5em;
}

/* Synced blocks */
.notion-synced-block {
  margin: 1em 0;
  padding: 1em;
  background-color: rgba(55, 53, 47, 0.03);
  border-left: 3px solid rgba(55, 53, 47, 0.16);
}

.notion-synced-block-copy {
  opacity: 0.95;
}
```

---

## Testing

### Casos de Prueba

1. **Enlaces internos**:
   - ✅ Mention a página que existe en el vault → debe abrirla
   - ✅ Mention a página que NO existe → debe ofrecer agregarla
   - ✅ Múltiples mentions en una página

2. **Bases de datos**:
   - ✅ Base de datos vacía → mostrar mensaje
   - ✅ Base de datos con páginas → mostrar cards
   - ✅ Clic en página de DB → debe abrirla o ofrecer agregarla
   - ✅ Base de datos grande (100+ páginas) → paginación

3. **Synced blocks**:
   - ✅ Bloque original → renderizar contenido
   - ✅ Bloque copia → cargar contenido del original
   - ✅ Bloque con referencias circulares → manejar gracefully

---

## Resumen

**Tiempo total estimado**: 12-15 horas

**Prioridad**:
1. Enlaces internos (crítico para navegación)
2. Bases de datos (crítico para workflow Lazy DM)
3. Synced blocks (importante para contenido reutilizable)

**Impacto**: Estas 3 funcionalidades habilitan el workflow completo de Lazy DM con Notion.
