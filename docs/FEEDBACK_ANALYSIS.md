# Análisis de Feedback del Usuario

## ✅ SOPORTADO / IMPLEMENTADO

### 1. Tipos de datos adicionales (video, spreadsheet, etc.)
- ✅ **Soportado**: Videos (YouTube, Vimeo), spreadsheets (Google Sheets), documentos (Google Docs), presentaciones (Google Slides)
- **Ubicación**: `js/models/Page.js`, `js/controllers/ExtensionController.js`

### 2. Player view toggle
- ✅ **Soportado**: Toggle para alternar entre vista GM y vista de jugador
- **Ubicación**: `js/controllers/ExtensionController.js` (líneas 2314-2367)

### 3. Filtro de texto
- ✅ **Soportado**: Filtro de texto con preservación de selecciones entre búsquedas
- **Comentario del usuario**: "The text filter is very nice and it's convenient that my selections are preserved across searches."

### 4. Renderizado de Notion
- ✅ **Soportado**: Renderizado de bloques toggleables y otros elementos de Notion
- **Comentario del usuario**: "I continue to be impressed by how well Notion renders through the GM Vault, including things like toggled blocks."

### 5. Importación de Notion con opciones de merge
- ✅ **Parcialmente soportado**: Existe funcionalidad de merge/append/replace en el código
- **Ubicación**: `js/controllers/ExtensionController.js` (líneas 3035-3058)
- **Nota**: El usuario reporta que las importaciones son mutuamente exclusivas, lo que sugiere que el modo por defecto podría ser "replace" en lugar de "merge"

---

## ❌ NO SOPORTADO / PROBLEMAS REPORTADOS

### 1. Vimeo demo video no carga
- ❌ **Problema**: El link de video demo de Vimeo no funciona (Chrome en MacOS)
- **Ubicación del código**: `public/default-config.json` (línea 86: `https://vimeo.com/148751763`)
- **Código relacionado**: `js/controllers/ExtensionController.js` (líneas 4660-4759), `js/renderers/NotionRenderer.js` (líneas 342-363)
- **Posible causa**: Problema con la extracción del ID de Vimeo o con el servicio de thumbnail (vumbnail.com)

### 2. Drag o pop out de GM vault entries
- ❌ **No soportado**: No existe funcionalidad para arrastrar o hacer pop out de las entradas del GM vault
- **Comentario del usuario**: "I wish that it was possible to drag or pop out the GM vault entries or view so I could see other things, like the initiative order, while still viewing Notion pages"

### 3. Checkbox en importación de Notion no funciona
- ❌ **Bug**: Click en el checkbox mismo no hace nada, solo funciona click en el nombre
- **Ubicación del código**: `js/controllers/ExtensionController.js` (líneas 3339-3357)
- **Problema identificado**: El código tiene lógica para manejar clicks en el checkbox, pero parece que hay un conflicto con el event handler del item

### 4. Importaciones mutuamente exclusivas
- ❌ **Problema**: Importar una página reemplaza las importaciones anteriores, incluso si son páginas diferentes
- **Ubicación del código**: `js/controllers/ExtensionController.js` (líneas 3023-3058)
- **Nota**: Aunque existe código para merge/append, el comportamiento por defecto parece ser "replace"

### 5. Importación borra páginas personalizadas
- ❌ **Problema**: Importar desde Notion borra no solo otras importaciones de Notion, sino también páginas añadidas manualmente
- **Relacionado con**: #4 - El modo por defecto debería ser "merge" en lugar de "replace"

### 6. Campos de bases de datos no se importan
- ❌ **No soportado**: Las importaciones de bases de datos no traen la información de los campos (properties)
- **Ubicación del código**: `js/services/NotionService.js` (líneas 784-816), `js/renderers/NotionRenderer.js` (línea 177)
- **Documentación**: `docs/DATABASE_FIELDS_AND_COLORS.md` describe el problema y una solución propuesta
- **Comentario del usuario**: "I have an NPC database with many entries that have little more than the database fields. The fields hold most important information, like appearance, wants, and RP cue, and that's usually enough."

### 7. Botón de compartir imagen visible en player view
- ❌ **Problema**: El botón de compartir imágenes está visible en la vista de jugador (debería estar oculto)
- **Ubicación del código**: `js/index.js` (líneas 3406-3457), `html/image-viewer.html` (líneas 194-229)
- **Problema identificado**: El código muestra el botón para todos los roles (línea 3412: `button.style.display = 'flex'`)

### 8. Botón de compartir permanece verde después de click
- ❌ **Problema de UX**: El botón permanece verde después de hacer click, dando la impresión de que es un toggle
- **Ubicación del código**: `js/index.js` (líneas 3442-3451), `html/image-viewer.html` (línea 222)
- **Problema identificado**: El botón se marca como "shared" pero no hay indicación clara de que no es un toggle

### 9. Colores de fondo y texto no se renderizan
- ❌ **No soportado**: Los colores de fondo y posiblemente los colores de texto de Notion no se renderizan
- **Documentación**: `docs/DATABASE_FIELDS_AND_COLORS.md` describe el problema y una solución propuesta
- **Ubicación del código**: `js/renderers/NotionRenderer.js` - no hay implementación de colores en `renderRichText()` o `renderBlock()`

### 10. Synced blocks no se importan
- ❌ **Parcialmente soportado**: Existe código para renderizar synced blocks, pero puede no estar funcionando correctamente
- **Ubicación del código**: `js/renderers/NotionRenderer.js` (líneas 208-211, 765-803)
- **Nota**: El código existe pero el usuario reporta que no funcionan

### 11. Chrome interpreta token field como password
- ❌ **Problema**: Chrome sugiere guardar contraseña cuando se importa (probablemente interpreta el campo de token como password)
- **Solución sugerida**: Agregar `autocomplete="off"` o cambiar el tipo de input

### 12. Agregar página al root no funciona después de importar
- ❌ **Bug**: No se puede agregar páginas al root después de importar páginas desde Notion
- **Ubicación del código**: `js/controllers/ExtensionController.js` (líneas 3528-3579), `js/index.js` (líneas 6099-6188, 6202-6269)
- **Problema identificado**: En `addPageToPageListWithCategorySelector` (línea 6163-6169), si `targetCategoryPath.length === 0`, crea una carpeta "General" en lugar de agregar al root

### 13. Opción de ajustar tamaño de imagen al compartir
- ❌ **No soportado**: No existe opción para ajustar el tamaño de la imagen al compartir (fit to screen vs scrollable)
- **Comentario del usuario**: "it might be nice to have the option of sizing an image to fit the screen when shared, rather than having to scroll"

---

## RESUMEN

### Total de puntos: 13
- ✅ **Soportado**: 5 (1 completamente, 4 parcialmente)
- ❌ **No soportado/Problemas**: 8

### Prioridades sugeridas:
1. **Alta**: Checkbox no funciona (#3), Importaciones mutuamente exclusivas (#4), Agregar página al root (#12)
2. **Media**: Botón compartir visible en player view (#7), Campos de bases de datos (#6), Colores de Notion (#9)
3. **Baja**: Drag/pop out (#2), Opción de tamaño de imagen (#13), Vimeo demo (#1 - puede ser problema del video específico)
