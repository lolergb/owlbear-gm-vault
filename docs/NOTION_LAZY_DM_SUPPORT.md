# Soporte para Workflow "Lazy DM" con Notion

> **📌 Nota**: Este documento ha sido integrado en el [documento unificado de soporte Lazy DM](./LAZY_DM_UNIFIED_SUPPORT.md) que cubre tanto Notion como Obsidian. Consulta ese documento para la arquitectura unificada y el plan de implementación completo.

Este documento detalla qué funcionalidades faltan específicamente para Notion, descrito en [Sly Flourish's Lazy D&D Notion Campaign Template](https://slyflourish.com/lazy_dnd_with_notion.html).

## Funcionalidades Clave del Workflow Lazy DM

El template de Sly Flourish utiliza:

1. **Bases de datos (Databases)** para organizar contenido:
   - Character Database (personajes)
   - Campaign Database (NPCs, items, locations, villains)
   
2. **Vistas de bases de datos**:
   - Gallery views (vista de tarjetas con imágenes)
   - Table views (vista de tabla con propiedades)
   - Filtros por tags/propiedades

3. **Enlaces internos** usando "@" (mentions):
   - Enlazar entre páginas/cards dentro del mismo workspace
   - Navegación tipo wiki

4. **Páginas hijas (child_page)**:
   - Estructura jerárquica de páginas
   - Navegación entre páginas relacionadas

5. **Imágenes en todo**:
   - Portraits de personajes/NPCs
   - Covers de páginas
   - Imágenes en cards de bases de datos

## Estado Actual vs. Necesario

### ✅ Ya Implementado

- ✅ Renderizado básico de bloques (paragraphs, headings, lists, etc.)
- ✅ Imágenes con soporte para compartir con jugadores
- ✅ Covers y títulos de páginas
- ✅ Toggles, callouts, quotes
- ✅ Tablas básicas
- ✅ Columnas
- ✅ Detección de `child_page` y `link_to_page` (en NotionService)

### ❌ Faltante - Prioridad ALTA

#### 1. **Renderizado de Bases de Datos (child_database)**

**Estado actual**: Solo muestra placeholder `[Base de datos - Requiere implementación adicional]`

**Enfoque simplificado** (más eficiente):
- Un bloque `child_database` solo contiene el **título** de la base de datos y su **ID**
- **NO** necesitamos cargar toda la base de datos
- Solo mostrar el título como un enlace clickeable o placeholder informativo
- Si hay páginas específicas enlazadas en el contenido (via mentions), esas ya se cargarán individualmente

**Implementación sugerida**:
```javascript
// En NotionRenderer.js
case 'child_database':
  const dbTitle = block.child_database?.title || 'Database';
  const dbId = block.id; // El ID del bloque es el mismo que el database_id
  return `
    <div class="notion-database-link">
      <a href="#" class="notion-database-title" data-database-id="${dbId}">
        📊 ${dbTitle}
      </a>
      <p class="notion-database-hint">Click para ver la base de datos en Notion</p>
    </div>
  `;
```

**Alternativa (si queremos mostrar algo más)**:
- Opcionalmente, buscar si hay páginas de esta DB mencionadas en el contenido actual
- Mostrar solo esas páginas enlazadas, no toda la base de datos

**Complejidad**: Baja (enfoque simplificado)

---

#### 2. **Mentions en Rich Text (@enlaces)**

**Estado actual**: Los mentions no se procesan, solo se muestra el texto plano

**Enfoque eficiente**:
- Detectar `mention` objects en `rich_text` arrays
- Convertir a enlaces clickeables que **carguen la página al hacer clic** (lazy loading)
- **NO** precargar todas las páginas mencionadas, solo cuando el usuario haga clic

**Tipos de mentions a soportar**:
- `mention.type === 'page'` - Enlaces a páginas (prioridad alta)
- `mention.type === 'database'` - Enlaces a bases de datos (opcional, mostrar título)
- `mention.type === 'user'` - Menciones de usuarios (opcional, solo texto)

**Implementación sugerida**:
```javascript
// En NotionRenderer.js - renderRichText()
if (text.type === 'mention') {
  const mention = text.mention;
  if (mention.type === 'page') {
    const pageId = mention.page.id;
    const pageTitle = text.plain_text;
    // Enlace que carga la página al hacer clic (no precarga)
    return `<a href="#" class="notion-mention notion-mention-page" 
                data-page-id="${pageId}"
                onclick="loadNotionPage('${pageId}'); return false;">
                ${pageTitle}
              </a>`;
  } else if (mention.type === 'database') {
    // Solo mostrar el título, no cargar la DB completa
    return `<span class="notion-mention notion-mention-database">${text.plain_text}</span>`;
  }
}
```

**Complejidad**: Baja-Media (más simple al no precargar)

---

#### 3. **Renderizado de child_page y link_to_page**

**Estado actual**: Se detectan pero NO se renderizan en el contenido

**Necesario**:
- Renderizar `child_page` blocks como cards/enlaces clickeables
- Renderizar `link_to_page` blocks como enlaces clickeables
- Mostrar título y opcionalmente icono/cover de la página
- Permitir navegación directa a esas páginas

**Implementación sugerida**:
```javascript
// En NotionRenderer.js
case 'child_page':
  return this._renderChildPage(block);
  
case 'link_to_page':
  return this._renderLinkToPage(block);
```

**Complejidad**: Baja-Media

---

### ⚠️ Faltante - Prioridad MEDIA

#### 4. **Soporte para Propiedades de Bases de Datos**

**Necesario**:
- Mostrar propiedades de registros (text, number, select, multi_select, etc.)
- Renderizar tags (multi_select) con colores
- Mostrar relaciones entre bases de datos
- Formatear fechas, números, etc.

**Complejidad**: Media

---

#### 5. **Filtros y Vistas de Bases de Datos**

**Necesario**:
- Detectar qué vista se está usando (gallery vs table)
- Aplicar filtros si están configurados en Notion
- Ordenar por propiedades

**Nota**: Esto puede ser complejo porque las vistas son configuración de Notion, no parte de la API directamente.

**Complejidad**: Alta

---

### 📋 Faltante - Prioridad BAJA

#### 6. **Soporte para Templates**

El artículo menciona "Session Template" que se puede generar. Los templates en Notion son bloques especiales.

**Complejidad**: Baja (pero templates están deprecated en la API)

---

## Plan de Implementación Sugerido

### Fase 1: Fundamentos (Alta Prioridad) - Enfoque Eficiente
1. ✅ Renderizar `child_page` y `link_to_page` como enlaces clickeables (lazy loading)
2. ✅ Implementar mentions en rich_text para enlaces internos (lazy loading)
3. ✅ Renderizado básico de `child_database` (solo título/enlace, sin cargar toda la DB)

**Nota importante**: Este enfoque solo carga contenido cuando el usuario hace clic, no precarga todo. Esto es más eficiente y rápido.

### Fase 3: Mejoras (Media Prioridad)
1. ✅ Propiedades avanzadas (fechas, números, relaciones)
2. ✅ Colores y estilos de tags
3. ✅ Imágenes en cards de bases de datos

### Fase 4: Optimizaciones (Baja Prioridad)
1. ✅ Caché de bases de datos
2. ✅ Lazy loading de registros
3. ✅ Filtros y ordenamiento

## Impacto en la Experiencia del Usuario

### Con las mejoras de Fase 1 (enfoque eficiente):
- ✅ Los usuarios podrán navegar entre páginas usando enlaces "@" (carga al hacer clic)
- ✅ Verán las páginas hijas como enlaces clickeables (carga al hacer clic)
- ✅ Las bases de datos mostrarán su título como referencia
- ✅ **Ventaja**: Carga rápida inicial, solo carga lo que el usuario necesita ver

### Con todas las fases:
- ✅ Experiencia equivalente a usar Notion directamente
- ✅ Todo el contenido del template de Sly Flourish funcionará correctamente

## Notas Técnicas

### Límites de la API de Notion
- Las bases de datos grandes pueden requerir paginación
- Algunas propiedades avanzadas pueden no estar disponibles
- Las vistas personalizadas (filtros, orden) no se pueden obtener directamente

### Consideraciones de Rendimiento
- **Enfoque eficiente**: Solo cargar páginas cuando el usuario hace clic (lazy loading)
- **NO** precargar toda la base de datos, solo mostrar título/enlace
- Caché inteligente para páginas visitadas (ya implementado)
- Las páginas mencionadas se cargan bajo demanda, no todas a la vez

### Compatibilidad
- Verificar que los cambios no rompan el renderizado actual
- Mantener compatibilidad con páginas que no usan estas features

## Referencias

- [Notion API - Databases](https://developers.notion.com/reference/database)
- [Notion API - Query a database](https://developers.notion.com/reference/post-database-query)
- [Notion API - Block types](https://developers.notion.com/reference/block)
- [Sly Flourish - Lazy D&D with Notion](https://slyflourish.com/lazy_dnd_with_notion.html)
