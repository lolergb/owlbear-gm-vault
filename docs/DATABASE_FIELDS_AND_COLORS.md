# Soporte para Campos de Bases de Datos y Colores

Este documento detalla la implementación para:
1. **Campos de bases de datos** (properties) - Opcional, toggleable
2. **Colores de texto y fondo** - Renderizado de colores en bloques
3. **Synced blocks** - Bloques sincronizados

## Problema: Bases de Datos sin Campos

**Situación actual**: Cuando se importa una base de datos de Notion, solo se muestra el título, pero no los campos/propiedades que contienen información importante (ej: appearance, wants, RP cue para NPCs).

**Solución propuesta**: Renderizar bases de datos con sus campos de forma **opcional** y **toggleable**.

## Implementación: Bases de Datos con Campos

### Enfoque

Cuando encontramos un bloque `child_database`:
1. **Opción 1 (por defecto)**: Mostrar solo el título (como ahora)
2. **Opción 2 (toggleable)**: Cargar y mostrar las páginas de la DB con sus campos

### API de Notion para Obtener Campos

```javascript
// 1. Obtener schema de la base de datos
GET /v1/databases/{database_id}
// Retorna: { properties: { "Appearance": {...}, "Wants": {...}, ... } }

// 2. Obtener páginas con sus propiedades
POST /v1/databases/{database_id}/query
// Retorna: { results: [{ properties: {...} }] }
```

### Estructura de Propiedades

Cada página en una base de datos tiene un objeto `properties`:

```json
{
  "properties": {
    "Name": {
      "type": "title",
      "title": [{ "plain_text": "NPC Name" }]
    },
    "Appearance": {
      "type": "rich_text",
      "rich_text": [{ "plain_text": "Tall, dark hair" }]
    },
    "Wants": {
      "type": "rich_text",
      "rich_text": [{ "plain_text": "To find the artifact" }]
    },
    "RP Cue": {
      "type": "rich_text",
      "rich_text": [{ "plain_text": "Speaks with a lisp" }]
    },
    "Tags": {
      "type": "multi_select",
      "multi_select": [
        { "name": "Villain", "color": "red" },
        { "name": "Merchant", "color": "blue" }
      ]
    }
  }
}
```

### Implementación Sugerida

```javascript
// En NotionRenderer.js
async _renderDatabase(block, includeFields = false) {
  const dbId = block.id; // El ID del bloque es el database_id
  const dbTitle = block.child_database?.title || 'Database';
  
  if (!includeFields) {
    // Modo simple: solo título
    return `
      <div class="notion-database-reference">
        <span class="database-icon">📊</span>
        <span class="database-title">${dbTitle}</span>
        <button class="database-toggle-fields" 
                data-database-id="${dbId}"
                onclick="toggleDatabaseFields('${dbId}')">
          Show fields
        </button>
      </div>
    `;
  }
  
  // Modo completo: cargar y mostrar campos
  try {
    // 1. Obtener schema de la DB
    const dbSchema = await this.notionService.fetchDatabaseSchema(dbId);
    
    // 2. Obtener páginas con propiedades
    const pages = await this.notionService.queryDatabase(dbId, {
      page_size: 100 // Límite razonable
    });
    
    // 3. Renderizar cada página con sus campos
    const pagesHtml = pages.map(page => 
      this._renderDatabasePage(page, dbSchema)
    ).join('');
    
    return `
      <div class="notion-database" data-database-id="${dbId}">
        <div class="database-header">
          <span class="database-icon">📊</span>
          <span class="database-title">${dbTitle}</span>
          <button class="database-toggle-fields" 
                  data-database-id="${dbId}"
                  onclick="toggleDatabaseFields('${dbId}')">
            Hide fields
          </button>
        </div>
        <div class="database-pages">
          ${pagesHtml}
        </div>
      </div>
    `;
  } catch (error) {
    logWarn('Error cargando base de datos:', error);
    return `<div class="notion-database-error">Error loading database: ${error.message}</div>`;
  }
}

_renderDatabasePage(page, schema) {
  const title = this._extractPageTitle(page);
  const properties = page.properties || {};
  
  // Renderizar solo propiedades relevantes (excluir metadatos)
  const relevantProps = Object.entries(properties)
    .filter(([key, prop]) => {
      // Excluir propiedades del sistema
      return prop.type !== 'created_time' && 
             prop.type !== 'last_edited_time' &&
             prop.type !== 'created_by' &&
             prop.type !== 'last_edited_by';
    });
  
  const fieldsHtml = relevantProps.map(([propName, prop]) => 
    this._renderProperty(propName, prop)
  ).join('');
  
  return `
    <div class="database-page-card">
      <h3 class="database-page-title">${title}</h3>
      <div class="database-page-fields">
        ${fieldsHtml}
      </div>
    </div>
  `;
}

_renderProperty(propName, property) {
  const value = this._formatPropertyValue(property);
  if (!value) return '';
  
  return `
    <div class="database-field">
      <span class="database-field-name">${propName}:</span>
      <span class="database-field-value">${value}</span>
    </div>
  `;
}

_formatPropertyValue(property) {
  switch (property.type) {
    case 'title':
      return this.renderRichText(property.title);
    case 'rich_text':
      return this.renderRichText(property.rich_text);
    case 'number':
      return property.number?.toString() || '';
    case 'select':
      return property.select?.name || '';
    case 'multi_select':
      return property.multi_select
        .map(s => `<span class="notion-tag" data-color="${s.color}">${s.name}</span>`)
        .join('');
    case 'date':
      return property.date?.start || '';
    case 'checkbox':
      return property.checkbox ? '✓' : '';
    case 'url':
      return `<a href="${property.url}" target="_blank">${property.url}</a>`;
    default:
      return JSON.stringify(property);
  }
}
```

### Nuevos Métodos en NotionService

```javascript
// En NotionService.js
async fetchDatabaseSchema(databaseId) {
  const response = await fetch(
    `${this.apiBaseUrl}/databases/${databaseId}`,
    {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Notion-Version': '2022-06-28'
      }
    }
  );
  
  if (!response.ok) throw new Error('Failed to fetch database schema');
  const data = await response.json();
  return data.properties; // Schema de propiedades
}

async queryDatabase(databaseId, options = {}) {
  const { page_size = 100, filter, sorts } = options;
  
  const response = await fetch(
    `${this.apiBaseUrl}/databases/${databaseId}/query`,
    {
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
    }
  );
  
  if (!response.ok) throw new Error('Failed to query database');
  const data = await response.json();
  return data.results; // Array de páginas con propiedades
}
```

### Toggle para Mostrar/Ocultar Campos

```javascript
// Función global para toggle (o en ExtensionController)
async function toggleDatabaseFields(databaseId) {
  const container = document.querySelector(`[data-database-id="${databaseId}"]`);
  if (!container) return;
  
  const isExpanded = container.classList.contains('expanded');
  
  if (isExpanded) {
    // Colapsar: mostrar solo título
    container.classList.remove('expanded');
    // ... actualizar HTML
  } else {
    // Expandir: cargar y mostrar campos
    container.classList.add('expanded');
    // ... cargar datos y actualizar HTML
  }
}
```

---

## Colores de Texto y Fondo

### Estado Actual

**Faltante**: Los bloques de Notion pueden tener:
- `color` en annotations de rich_text (color de texto)
- `color` en el bloque mismo (color de fondo)

### Implementación

#### 1. Colores en Rich Text

```javascript
// En NotionRenderer.js - renderRichText()
if (text.annotations) {
  // ... otros formatos ...
  
  // Color de texto
  if (text.annotations.color && text.annotations.color !== 'default') {
    const colorClass = `notion-color-${text.annotations.color}`;
    content = `<span class="${colorClass}">${content}</span>`;
  }
}
```

#### 2. Colores de Fondo en Bloques

```javascript
// En NotionRenderer.js - renderBlock()
renderBlock(block) {
  const type = block.type;
  let html = '';
  
  // Obtener color del bloque (si existe)
  const blockColor = block[type]?.color || 'default';
  
  switch (type) {
    case 'paragraph':
      const paragraphText = this.renderRichText(block.paragraph?.rich_text);
      const bgClass = blockColor !== 'default' 
        ? `notion-bg-${blockColor}` 
        : '';
      html = `<p class="notion-paragraph ${bgClass}">${paragraphText || '<br>'}</p>`;
      break;
    
    case 'callout':
      // Los callouts ya tienen color, pero verificar
      const calloutColor = block.callout?.color || blockColor;
      // ... renderizar con color
      break;
    
    // ... otros bloques
  }
  
  return html;
}
```

#### 3. CSS para Colores

```css
/* Colores de texto */
.notion-color-gray { color: #787774; }
.notion-color-brown { color: #9f6b53; }
.notion-color-orange { color: #d9730d; }
.notion-color-yellow { color: #cb912f; }
.notion-color-green { color: #448361; }
.notion-color-blue { color: #337ea9; }
.notion-color-purple { color: #9065b0; }
.notion-color-pink { color: #c14c8a; }
.notion-color-red { color: #d1242f; }

/* Colores de fondo */
.notion-bg-gray_background { background-color: #f1f1ef; }
.notion-bg-brown_background { background-color: #f4f1eb; }
.notion-bg-orange_background { background-color: #fbecdd; }
.notion-bg-yellow_background { background-color: #fbf3db; }
.notion-bg-green_background { background-color: #ddedea; }
.notion-bg-blue_background { background-color: #ddebf1; }
.notion-bg-purple_background { background-color: #eae4f2; }
.notion-bg-pink_background { background-color: #f4dfeb; }
.notion-bg-red_background { background-color: #fbe4e4; }
```

---

## Synced Blocks

### Estado Actual

**Faltante**: Los bloques sincronizados (`synced_block`) no se renderizan.

### Implementación

```javascript
// En NotionRenderer.js
case 'synced_block':
  return await this._renderSyncedBlock(block);

async _renderSyncedBlock(block) {
  const syncedBlock = block.synced_block;
  
  // Verificar si es el bloque original o una copia
  if (syncedBlock.synced_from === null) {
    // Es el bloque original - cargar su contenido
    if (block.has_children && this.notionService) {
      const children = await this.notionService.fetchChildBlocks(block.id);
      const childrenHtml = await this.renderBlocks(children);
      return `
        <div class="notion-synced-block" data-synced-id="${block.id}">
          ${childrenHtml}
        </div>
      `;
    }
  } else {
    // Es una copia - referenciar al original
    const originalId = syncedBlock.synced_from.block_id;
    return `
      <div class="notion-synced-block" 
           data-synced-id="${block.id}"
           data-original-id="${originalId}">
        [Synced content - loading...]
      </div>
    `;
  }
  
  return '<div class="notion-synced-block">[Synced block]</div>';
}
```

**Nota**: Los synced blocks pueden ser complejos porque requieren:
- Detectar si es original o copia
- Cargar el contenido del original si es copia
- Manejar referencias circulares

---

## Bloques Esenciales para Primera Fase

### Prioridad ALTA (Fase 1)

1. ✅ **Mentions (@enlaces)** - Sistema de enlaces internos
2. ✅ **child_page y link_to_page** - Páginas relacionadas
3. ✅ **Colores en rich_text** - Color de texto
4. ✅ **Colores de fondo en bloques** - Color de fondo (paragraph, callout, etc.)

### Prioridad MEDIA (Fase 1.5)

5. ⚠️ **Bases de datos con campos** - Toggleable, opcional
6. ⚠️ **Synced blocks** - Renderizado básico

### Prioridad BAJA (Fase 2)

7. 📋 **Propiedades avanzadas** - Fechas, números, relaciones complejas
8. 📋 **Tags con colores** - Renderizado de multi_select con colores

---

## Plan de Implementación para Primera Fase

### Paso 1: Colores (Rápido)
1. Agregar soporte para `color` en annotations de rich_text
2. Agregar soporte para `color` en bloques (paragraph, callout, etc.)
3. Agregar CSS para colores de texto y fondo

**Tiempo estimado**: 2-3 horas

### Paso 2: Enlaces Internos (Esencial)
1. Procesar mentions en `renderRichText()`
2. Renderizar `child_page` y `link_to_page`
3. Sistema de navegación lazy loading

**Tiempo estimado**: 4-6 horas

### Paso 3: Bases de Datos con Campos (Opcional)
1. Métodos en NotionService para obtener schema y páginas
2. Renderizado de propiedades
3. Toggle para mostrar/ocultar campos

**Tiempo estimado**: 6-8 horas

### Paso 4: Synced Blocks (Complejo)
1. Detectar bloque original vs copia
2. Cargar contenido del original
3. Manejar referencias

**Tiempo estimado**: 4-6 horas

---

## Resumen de Bloques Esenciales Fase 1

| Bloque | Prioridad | Complejidad | Tiempo |
|--------|-----------|-------------|--------|
| Colores (texto) | ALTA | Baja | 1h |
| Colores (fondo) | ALTA | Baja | 1h |
| Mentions (@) | ALTA | Media | 3h |
| child_page | ALTA | Baja | 2h |
| link_to_page | ALTA | Baja | 2h |
| **Total Fase 1** | | | **~9 horas** |
| Database fields | MEDIA | Media | 6-8h |
| Synced blocks | MEDIA | Alta | 4-6h |

---

## Referencias

- [Notion API - Query database](https://developers.notion.com/reference/post-database-query)
- [Notion API - Page properties](https://developers.notion.com/reference/page-property-values)
- [Notion API - Block colors](https://developers.notion.com/reference/block#block-colors)
- [Notion API - Synced blocks](https://developers.notion.com/reference/block#synced-block)
