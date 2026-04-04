# ⚠️ DEPRECADO - Features Pendientes / Mejoras Futuras

> **Este documento está deprecado y ya no se mantiene.**  
> La información sobre features pendientes está desactualizada.  
> Para información actual sobre el estado del proyecto, consulta `README.md` y `docs/DEVELOPMENT.md`.  
> Este documento se mantiene solo para referencia histórica.

## Tipos de Bloques de Notion Pendientes

### 1. **File Blocks** (Archivos adjuntos)
- **Descripción**: Bloques que contienen archivos adjuntos (PDFs, imágenes, documentos, etc.)
- **Prioridad**: Media
- **Complejidad**: Baja
- **Notas**: Notion permite adjuntar archivos que se muestran como bloques. Podría renderizarse como un enlace de descarga o preview si es imagen/PDF.

### 2. **PDF Blocks** (PDFs embebidos)
- **Descripción**: Bloques específicos para PDFs embebidos
- **Prioridad**: Media
- **Complejidad**: Media
- **Notas**: Similar a Google Docs, podría renderizarse en un iframe o mostrar un enlace de descarga.

### 3. **Synced Blocks** (Bloques sincronizados)
- **Descripción**: Bloques que se sincronizan entre múltiples páginas
- **Prioridad**: Baja
- **Complejidad**: Alta
- **Notas**: Requiere manejar referencias entre páginas y sincronización de contenido.

### 4. **Equation Blocks** (Ecuaciones LaTeX)
- **Descripción**: Bloques de ecuaciones matemáticas en formato LaTeX
- **Prioridad**: Baja
- **Complejidad**: Media
- **Notas**: Requiere una librería de renderizado de LaTeX (ej: KaTeX o MathJax).

### 5. **Child Page Blocks** (Páginas hijas)
- **Descripción**: Bloques que referencian otras páginas de Notion
- **Prioridad**: Media
- **Complejidad**: Media
- **Notas**: Podría renderizarse como un enlace o expandirse inline.

## Mejoras de UX/UI

### 1. **Mejor manejo de errores de imágenes**
- **Descripción**: Actualmente hay manejo básico, pero podría mejorarse con retry automático o mejor feedback visual
- **Prioridad**: Baja
- **Complejidad**: Baja

### 2. **Lazy loading de imágenes**
- **Descripción**: Cargar imágenes solo cuando están visibles en viewport
- **Prioridad**: Media
- **Complejidad**: Media
- **Notas**: Mejoraría el rendimiento en páginas con muchas imágenes.

### 3. **Búsqueda dentro de páginas**
- **Descripción**: Buscar texto dentro del contenido de una página de Notion
- **Prioridad**: Baja
- **Complejidad**: Media

### 4. **Exportar página como PDF/HTML**
- **Descripción**: Permitir exportar una página renderizada como PDF o HTML
- **Prioridad**: Baja
- **Complejidad**: Media

## Mejoras de Rendimiento

### 1. **Virtual scrolling para listas largas**
- **Descripción**: Renderizar solo los elementos visibles en listas muy largas de páginas/carpetas
- **Prioridad**: Baja
- **Complejidad**: Alta
- **Notas**: Solo necesario si hay vaults con cientos de páginas.

### 2. **Compresión de caché**
- **Descripción**: Comprimir el HTML/JSON antes de guardar en localStorage
- **Prioridad**: Baja
- **Complejidad**: Media
- **Notas**: Ya hay algo de compresión, pero podría mejorarse.

### 3. **Service Worker para caché offline**
- **Descripción**: Usar Service Workers para cachear contenido y permitir uso offline
- **Prioridad**: Baja
- **Complejidad**: Alta

## Mejoras de Funcionalidad

### 1. **Soporte para más servicios de embed**
- **Descripción**: Agregar soporte para más servicios (Figma, CodePen, OneDrive, Dropbox, etc.)
- **Prioridad**: Baja
- **Complejidad**: Baja
- **Notas**: El código original tiene muchos comentados como "PRÓXIMAMENTE".

### 2. **Filtros avanzados de bloques**
- **Descripción**: Permitir filtros más complejos (ej: "solo headings y listas", "excluir imágenes")
- **Prioridad**: Baja
- **Complejidad**: Baja

### 3. **Temas personalizables**
- **Descripción**: Permitir cambiar el tema de la extensión (dark/light/custom)
- **Prioridad**: Baja
- **Complejidad**: Media

### 4. **Atajos de teclado**
- **Descripción**: Agregar atajos de teclado para acciones comunes (abrir modal, compartir, etc.)
- **Prioridad**: Baja
- **Complejidad**: Baja

## Mejoras de Analytics

### 1. **Métricas de uso más detalladas**
- **Descripción**: Trackear más eventos y métricas (tiempo en página, páginas más vistas, etc.)
- **Prioridad**: Baja
- **Complejidad**: Baja

### 2. **Dashboard de analytics para GMs**
- **Descripción**: Mostrar estadísticas de uso dentro de la extensión
- **Prioridad**: Muy Baja
- **Complejidad**: Media

## Notas Generales

- La mayoría de estas features son "nice to have" y no críticas para el funcionamiento básico
- Las prioridades están basadas en utilidad vs complejidad de implementación
- Muchas features del código original están implementadas o mejoradas en la nueva versión
- El código actual es más modular y mantenible que el original, facilitando agregar nuevas features

## Features ya implementadas (para referencia)

✅ Autenticación y roles (GM, Co-GM, Player)  
✅ Vault ownership y heartbeat  
✅ Broadcast de contenido entre roles  
✅ Caché completo de Notion (bloques, pageInfo, HTML)  
✅ Menús contextuales para tokens  
✅ Analytics (Mixpanel) con consentimiento  
✅ Cookie consent banner  
✅ Manejo de límites de storage  
✅ Cover, icono y título de Notion  
✅ Columnas y tablas  
✅ Toggle, callouts, quotes, código  
✅ Videos (YouTube, Vimeo)  
✅ Google Docs/Sheets/Slides  
✅ Bookmarks y embeds  
✅ Compartir contenido (con manejo de límite 64KB)  
✅ Recargar página forzando caché  
✅ Content-demo (HTML estático)  
✅ Manejo de errores de imágenes con retry  
✅ Indicador de visibilidad para players  
✅ Export/Import de vault  
✅ Modo solo lectura para Co-GM  

