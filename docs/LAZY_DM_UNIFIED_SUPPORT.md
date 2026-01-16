# Soporte Unificado para Workflow "Lazy DM" (Notion + Obsidian)

Este documento unifica el soporte para ambos workflows de Sly Flourish:
- [Notion para Lazy RPG Prep](https://slyflourish.com/lazy_dnd_with_notion.html)
- [Obsidian para Lazy RPG Prep](https://slyflourish.com/obsidian.html)

## Funcionalidades Comunes del Workflow Lazy DM

Ambos workflows comparten estas características esenciales:

### 1. **Enlaces Internos (Wiki-style Navigation)**
- **Notion**: Mentions con `@` que enlazan a páginas/cards
- **Obsidian**: Enlaces markdown `[[Page Name]]` o `[Link Text](Page Name)`
- **Necesario**: Sistema unificado que procese ambos formatos y permita navegación entre páginas

### 2. **Estructura Jerárquica**
- **Notion**: `child_page` blocks y `link_to_page` blocks
- **Obsidian**: Estructura de carpetas y archivos markdown
- **Necesario**: Renderizar y navegar entre páginas relacionadas

### 3. **Templates de Session Notes**
- **Notion**: Session template con los 8 pasos del Lazy DM
- **Obsidian**: Archivos markdown con templates
- **Ya soportado**: Ambos pueden usar HTML embebido o contenido renderizado

### 4. **Archivos Adjuntos e Imágenes**
- **Notion**: Bloques de imagen, archivos adjuntos
- **Obsidian**: Archivos en carpeta `Attachments`
- **Ya soportado**: ✅ Imágenes con compartir a jugadores

### 5. **Organización por Categorías**
- **Notion**: Bases de datos (Character Database, Campaign Database)
- **Obsidian**: Carpetas (Session Notes, NPCs, Characters, Locations)
- **Ya soportado**: ✅ Sistema de carpetas en la extensión

## Estado Actual

### ✅ Ya Implementado (Funciona para Ambos)

- ✅ Renderizado básico de contenido (HTML, markdown)
- ✅ Imágenes con soporte para compartir con jugadores
- ✅ Sistema de carpetas/páginas
- ✅ HTML embebido (local-first para Obsidian)
- ✅ Caché de contenido
- ✅ Compartir contenido con jugadores
- ✅ Enlaces externos (href en texto)

### ❌ Faltante - Prioridad ALTA (Unificado)

#### 1. **Sistema de Enlaces Internos Unificado**

**Problema**: Los enlaces internos no funcionan en ninguno de los dos workflows.

**Notion**:
- Mentions `@Page Name` no se procesan
- `child_page` y `link_to_page` blocks no se renderizan

**Obsidian**:
- Enlaces `[[Page Name]]` no se procesan
- Enlaces `[Link Text](Page Name)` no se resuelven

**Solución Unificada**:
```javascript
// Sistema unificado de enlaces internos
class InternalLinkProcessor {
  // Procesar mentions de Notion
  processNotionMention(mention) {
    if (mention.type === 'page') {
      return this.createInternalLink(mention.page.id, mention.page.title);
    }
  }
  
  // Procesar enlaces markdown de Obsidian
  processMarkdownLink(linkText, pageName) {
    // Buscar página por nombre en la configuración
    const page = this.findPageByName(pageName);
    if (page) {
      return this.createInternalLink(page.id, linkText || pageName);
    }
  }
  
  // Crear enlace unificado (funciona para ambos)
  createInternalLink(pageId, linkText) {
    return `<a href="#" 
              class="internal-link" 
              data-page-id="${pageId}"
              onclick="loadInternalPage('${pageId}'); return false;">
              ${linkText}
            </a>`;
  }
}
```

**Implementación**:
- En `NotionRenderer.js`: Procesar mentions en `renderRichText()`
- En `MarkdownRenderer.js` (nuevo): Procesar `[[links]]` y `[links](page)`
- Sistema unificado de navegación que funciona para ambos

**Complejidad**: Media

---

#### 2. **Renderizado de Páginas Relacionadas**

**Notion**: `child_page` y `link_to_page` blocks
**Obsidian**: Referencias a otros archivos en el mismo vault

**Solución Unificada**:
```javascript
// Renderizar página relacionada (unificado)
_renderRelatedPage(pageId, title, source = 'notion' | 'obsidian') {
  return `
    <div class="related-page-card" data-source="${source}">
      <a href="#" 
         class="related-page-link" 
         data-page-id="${pageId}"
         onclick="loadInternalPage('${pageId}'); return false;">
        <span class="related-page-icon">📄</span>
        <span class="related-page-title">${title}</span>
      </a>
    </div>
  `;
}
```

**Implementación**:
- `NotionRenderer.js`: Renderizar `child_page` y `link_to_page`
- Sistema de búsqueda de páginas por nombre (para Obsidian)
- UI unificada para ambos tipos

**Complejidad**: Baja-Media

---

#### 3. **Bases de Datos de Notion (Simplificado)**

**Estado**: Solo muestra placeholder

**Enfoque eficiente** (como discutimos):
- Mostrar solo el título de la base de datos como referencia
- NO cargar toda la base de datos
- Si hay páginas específicas enlazadas (via mentions), esas se cargan individualmente

**Implementación**:
```javascript
case 'child_database':
  const dbTitle = block.child_database?.title || 'Database';
  return `
    <div class="notion-database-reference">
      <span class="database-icon">📊</span>
      <span class="database-title">${dbTitle}</span>
      <span class="database-hint">(Referencia - ver en Notion para contenido completo)</span>
    </div>
  `;
```

**Complejidad**: Baja

---

### ⚠️ Faltante - Prioridad MEDIA

#### 4. **Procesamiento de Markdown para Obsidian**

**Necesario**:
- Parser de markdown que convierta a HTML
- Procesar enlaces internos `[[Page Name]]`
- Procesar imágenes relativas `![alt](path/to/image.png)`
- Soporte para frontmatter (metadata YAML)

**Librería sugerida**: `marked` o `markdown-it` con plugins

**Complejidad**: Media

---

#### 5. **Búsqueda de Páginas por Nombre**

**Necesario para Obsidian**:
- Cuando se encuentra un enlace `[[Page Name]]`, buscar la página en la configuración
- Matching flexible (case-insensitive, sin extensiones)
- Fallback si no se encuentra (mostrar como texto plano o enlace roto)

**Complejidad**: Baja

---

## Arquitectura Unificada Propuesta

### Capa de Renderizado

```
ContentRenderer (abstracto)
├── NotionRenderer (extiende ContentRenderer)
│   ├── Procesa bloques de Notion
│   ├── Procesa mentions (@enlaces)
│   └── Renderiza child_page/link_to_page
│
└── MarkdownRenderer (extiende ContentRenderer) [NUEVO]
    ├── Convierte markdown a HTML
    ├── Procesa [[enlaces internos]]
    ├── Procesa imágenes relativas
    └── Procesa frontmatter
```

### Capa de Navegación Unificada

```
InternalLinkHandler
├── processNotionMention(mention) → InternalLink
├── processMarkdownLink(linkText, pageName) → InternalLink
└── createInternalLink(pageId, linkText) → HTML
```

### Capa de Búsqueda

```
PageResolver
├── findPageById(id) → Page
├── findPageByName(name) → Page
└── findPageByUrl(url) → Page
```

## Plan de Implementación Unificado

### Fase 1: Fundamentos (Alta Prioridad)

1. **Sistema de Enlaces Internos Unificado**
   - ✅ Procesar mentions de Notion en `renderRichText()`
   - ✅ Crear `InternalLinkHandler` para manejar enlaces
   - ✅ Sistema de navegación que carga páginas al hacer clic

2. **Renderizado de Páginas Relacionadas**
   - ✅ Renderizar `child_page` y `link_to_page` en Notion
   - ✅ Sistema de búsqueda de páginas por nombre

3. **Bases de Datos Simplificadas**
   - ✅ Mostrar solo título de `child_database` (sin cargar toda la DB)

**Resultado**: Navegación tipo wiki funcionando para Notion

---

### Fase 2: Soporte Completo para Obsidian (Media Prioridad)

1. **MarkdownRenderer**
   - ✅ Parser de markdown a HTML
   - ✅ Procesar `[[enlaces internos]]`
   - ✅ Procesar imágenes relativas
   - ✅ Soporte para frontmatter

2. **Integración con Sistema de Enlaces**
   - ✅ `[[Page Name]]` → buscar página en configuración
   - ✅ Resolver rutas relativas de imágenes
   - ✅ Fallback para enlaces no encontrados

**Resultado**: Soporte completo para Obsidian con navegación tipo wiki

---

### Fase 3: Mejoras y Optimizaciones (Baja Prioridad)

1. **Caché de Enlaces Internos**
   - Caché de páginas visitadas para navegación rápida
   - Pre-cargar páginas relacionadas (opcional)

2. **UI Mejorada**
   - Breadcrumbs para navegación
   - Historial de páginas visitadas
   - Búsqueda dentro del contenido

---

## Impacto en la Experiencia del Usuario

### Con Fase 1 (Notion):
- ✅ Navegación tipo wiki funcionando
- ✅ Enlaces `@Page` funcionan y cargan páginas
- ✅ Páginas hijas visibles y clickeables
- ✅ Experiencia fluida similar a Notion nativo

### Con Fase 2 (Obsidian):
- ✅ Renderizado completo de markdown
- ✅ Enlaces `[[Page Name]]` funcionan
- ✅ Imágenes relativas funcionan
- ✅ Experiencia equivalente a Obsidian

### Con ambas fases:
- ✅ **Un solo sistema** que soporta ambos workflows
- ✅ **Navegación unificada** que funciona igual para Notion y Obsidian
- ✅ **Experiencia consistente** independientemente de la fuente

---

## Consideraciones Técnicas

### Rendimiento
- **Lazy loading**: Solo cargar páginas cuando el usuario hace clic
- **Caché inteligente**: Caché de páginas visitadas
- **NO precargar**: No cargar todas las páginas mencionadas de una vez

### Compatibilidad
- Mantener compatibilidad con contenido existente
- Fallback graceful si no se encuentra una página enlazada
- No romper renderizado actual

### Extensibilidad
- Arquitectura que permita agregar más fuentes en el futuro
- Sistema de plugins para procesadores de contenido

---

## Referencias

- [Sly Flourish - Lazy D&D with Notion](https://slyflourish.com/lazy_dnd_with_notion.html)
- [Sly Flourish - Lazy RPG Prep with Obsidian](https://slyflourish.com/obsidian.html)
- [Notion API - Block types](https://developers.notion.com/reference/block)
- [Notion API - Mentions](https://developers.notion.com/reference/rich-text#mention-objects)
- [Markdown Guide](https://www.markdownguide.org/)

## Documentos Relacionados

- **[DATABASE_FIELDS_AND_COLORS.md](./DATABASE_FIELDS_AND_COLORS.md)**: Implementación detallada de:
  - Campos de bases de datos (opcional, toggleable)
  - Colores de texto y fondo
  - Synced blocks
  - Plan de implementación para primera fase

---

## Notas Finales

Este enfoque unificado:
- ✅ **Simplifica** el código al tener un solo sistema de navegación
- ✅ **Mejora** la experiencia del usuario con navegación consistente
- ✅ **Extiende** fácilmente a otras fuentes en el futuro
- ✅ **Mantiene** compatibilidad con el código existente

La clave es crear una **capa de abstracción** que maneje enlaces internos de forma unificada, independientemente de si vienen de Notion o Obsidian.
