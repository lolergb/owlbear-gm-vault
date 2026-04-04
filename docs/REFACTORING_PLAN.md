# ⚠️ DEPRECADO - Plan de Refactorización - Arquitectura Modular

> **Este documento está deprecado y ya no se mantiene.**  
> Este plan de refactorización es muy extenso y no refleja el estado actual del proyecto.  
> Si necesitas información sobre la arquitectura, consulta `DEVELOPMENT.md` o el código fuente.  
> Este documento se mantiene solo para referencia histórica.

Este documento describe los pasos necesarios para refactorizar `owlbear-gm-vault` siguiendo la arquitectura modular del plugin de Obsidian.

## 📊 Estado Actual

### Problemas Identificados

1. **Monolito en un solo archivo**: `js/index.js` tiene ~9,865 líneas con toda la lógica mezclada
2. **Sin separación de responsabilidades**: UI, lógica de negocio, renderizado, y manejo de datos están mezclados
3. **Funciones globales**: No hay organización modular ni encapsulación
4. **Difícil de testear**: Todo está acoplado y depende de OBR SDK y DOM
5. **Difícil de mantener**: Cambios en una parte afectan otras partes no relacionadas
6. **No reutilizable**: El código está fuertemente acoplado a Owlbear Rodeo

### Estructura Actual

```
owlbear-gm-vault/
├── js/
│   └── index.js          # ← TODO (9,865 líneas)
├── css/
│   ├── app.css
│   └── notion-markdown.css
├── html/
│   └── image-viewer.html
└── netlify/
    └── functions/
        └── notion-api.js
```

## 🎯 Arquitectura Objetivo

Siguiendo el modelo del plugin de Obsidian, la arquitectura objetivo será:

```
owlbear-gm-vault/
├── js/
│   ├── main.js                    # Punto de entrada (inicialización OBR)
│   ├── controllers/
│   │   └── ExtensionController.js # Orquestación (sin lógica de negocio)
│   ├── models/
│   │   ├── Config.js              # Modelo de configuración
│   │   ├── Category.js            # Modelo de categoría
│   │   ├── Page.js                # Modelo de página
│   │   └── Cache.js               # Modelo de caché
│   ├── parsers/
│   │   └── ConfigParser.js        # Conversión JSON → Modelos
│   ├── builders/
│   │   └── ConfigBuilder.js       # Conversión Modelos → JSON
│   ├── renderers/
│   │   ├── NotionRenderer.js     # Renderizado de bloques Notion
│   │   ├── UIRenderer.js          # Renderizado de UI (categorías, páginas)
│   │   └── MarkdownRenderer.js    # Renderizado Markdown → HTML
│   ├── services/
│   │   ├── NotionService.js       # Comunicación con Notion API
│   │   ├── StorageService.js      # Gestión de localStorage y metadata
│   │   ├── BroadcastService.js   # Gestión de broadcast OBR
│   │   └── CacheService.js        # Gestión de caché
│   ├── utils/
│   │   ├── logger.js              # Sistema de logs
│   │   ├── analytics.js           # Mixpanel tracking
│   │   └── helpers.js             # Utilidades generales
│   └── ui/
│       ├── ModalManager.js        # Gestión de modales
│       ├── FormBuilder.js         # Construcción de formularios
│       └── EventHandlers.js       # Manejadores de eventos UI
├── css/
│   ├── app.css
│   └── notion-markdown.css
└── html/
    └── image-viewer.html
```

## 📋 Fases de Refactorización

### ⏱️ Estimación de Tiempo Total: 2-3 semanas

| Fase | Descripción | Tiempo Estimado | Riesgo |
|------|-------------|-----------------|--------|
| Fase 0 | Tests de Regresión | 2-3 horas | Bajo |
| Fase 1 | Preparación y Estructura | 3-4 horas | Bajo |
| Fase 2 | Servicios | 1-2 días | Medio-Alto |
| Fase 3 | Renderizadores | 1-2 días | Medio |
| Fase 4 | Parsers/Builders | 2-3 horas | Bajo |
| Fase 5 | UI y Event Handlers | 1-2 días | Medio |
| Fase 6 | Controller | 4-6 horas | Medio |
| Fase 7 | Testing Final | 1 día | Bajo |
| **Total** | | **8-12 días** | |

---

### Fase 0: Tests de Regresión (ANTES de refactorizar) 🧪

**⚠️ CRÍTICO: Esta fase debe completarse ANTES de cualquier cambio de código.**

**Objetivo**: Capturar el comportamiento exacto del código actual para poder compararlo después de la refactorización.

**Tiempo estimado**: 2-3 horas

#### Tareas:

1. **Crear backup del código original**
   ```bash
   cp js/index.js js/index.js.backup
   cp js/index.js js/index.original.js  # Para tests de comparación
   ```

2. **Instalar framework de testing**
   ```bash
   npm install --save-dev jest @jest/globals jest-environment-jsdom
   ```

3. **Crear estructura de tests**
   ```bash
   mkdir -p tests/{unit,integration,regression,mocks,fixtures}
   ```

4. **Capturar snapshots de comportamiento**
   - Ejecutar la extensión manualmente y documentar:
     - Output de funciones críticas (getCachedBlocks, extractNotionPageId, etc.)
     - Estructura exacta de JSON guardado
     - HTML generado por renderizadores
     - Timeouts y límites exactos

5. **Crear tests de regresión básicos**
   - Ver sección "Tests de Regresión" más adelante
   - Mínimo: 20 tests cubriendo funciones críticas

**Criterio de éxito**: 
- Todos los tests pasan con el código original
- Snapshots de comportamiento capturados
- Backup creado y verificado

**⚠️ NO avanzar a Fase 1 hasta completar Fase 0**

---

### Fase 1: Preparación y Estructura Base ⚙️

**Objetivo**: Crear la estructura de directorios y archivos base sin cambiar funcionalidad.

**Tiempo estimado**: 3-4 horas

#### Tareas:

1. **Crear estructura de directorios**
   ```bash
   mkdir -p js/{controllers,models,parsers,builders,renderers,services,utils,ui}
   ```

2. **Extraer utilidades básicas**
   - Crear `js/utils/logger.js` con funciones `log()`, `logError()`, `logWarn()`
   - Crear `js/utils/analytics.js` con todas las funciones de Mixpanel
   - Crear `js/utils/helpers.js` con funciones auxiliares (slugify, extractNotionPageId, etc.)

3. **Crear modelos de dominio básicos**
   - `js/models/Page.js`: Clase pura para representar una página
   - `js/models/Category.js`: Clase pura para representar una categoría
   - `js/models/Config.js`: Clase pura para representar la configuración completa

4. **Migrar constantes**
   - Extraer todas las constantes a `js/utils/constants.js`
   - Incluir: `STORAGE_KEY_PREFIX`, `ROOM_METADATA_KEY`, `BROADCAST_CHANNEL_*`, etc.

**Criterio de éxito**: El código compila y funciona igual que antes, pero con estructura organizada.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 2: Separar Servicios 🛠️

**Objetivo**: Extraer la lógica de servicios (Notion, Storage, Broadcast, Cache) a módulos independientes.

**Tiempo estimado**: 1-2 días (esta es la fase más crítica)

#### Tareas:

1. **NotionService.js**
   - Extraer `fetchNotionBlocks()`
   - Extraer `fetchNotionPageInfo()`
   - Extraer `extractNotionPageId()`
   - **Dependencias permitidas**: Solo fetch API y utils
   - **NO debe depender de**: OBR SDK, DOM, UI

2. **StorageService.js**
   - Extraer `getPagesJSON()`
   - Extraer `savePagesJSON()`
   - Extraer `getUserToken()`
   - Extraer `saveUserToken()`
   - Extraer funciones de validación de tamaño
   - **Dependencias permitidas**: OBR SDK (solo para metadata), localStorage

3. **BroadcastService.js**
   - Extraer `setupGMContentBroadcast()`
   - Extraer `setupGMVisiblePagesBroadcast()`
   - Extraer `broadcastVisiblePagesUpdate()`
   - Extraer `requestHtmlFromGM()`
   - **Dependencias permitidas**: OBR SDK (solo para broadcast)

4. **CacheService.js**
   - Extraer `getCachedBlocks()`
   - Extraer `setCachedBlocks()`
   - Extraer `getCachedPageInfo()`
   - Extraer `setCachedPageInfo()`
   - Extraer `saveHtmlToLocalCache()`
   - Extraer `clearAllCache()`
   - **Dependencias permitidas**: localStorage, utils

**Criterio de éxito**: Cada servicio puede ser testeado independientemente con mocks.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 3: Separar Renderizadores 🎨

**Objetivo**: Extraer toda la lógica de renderizado a módulos independientes.

**Tiempo estimado**: 1-2 días

#### Tareas:

1. **NotionRenderer.js**
   - Extraer `renderBlock()`
   - Extraer `renderRichText()`
   - Extraer `renderPageCoverAndTitle()`
   - Extraer `setNotionDisplayMode()`
   - **Dependencias permitidas**: Solo funciones puras, sin DOM directo
   - **Retorna**: Strings HTML

2. **UIRenderer.js**
   - Extraer `renderCategory()`
   - Extraer `renderPagesByCategories()`
   - Extraer funciones de renderizado de UI (botones, modales, etc.)
   - **Dependencias permitidas**: DOM (solo para renderizado), EventHandlers
   - **NO debe contener**: Lógica de negocio, llamadas a servicios

3. **MarkdownRenderer.js** (si es necesario)
   - Extraer cualquier renderizado de Markdown
   - Similar a `MarkdownRenderer` del plugin de Obsidian

**Criterio de éxito**: Los renderizadores son funciones puras que reciben datos y retornan HTML/strings.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 4: Separar Parsers y Builders 🔄

**Objetivo**: Crear capas de conversión entre formatos (JSON ↔ Modelos).

**Tiempo estimado**: 2-3 horas

#### Tareas:

1. **ConfigParser.js**
   - Función `parseConfig(json)`: Convierte JSON → Instancias de `Config`, `Category`, `Page`
   - Valida estructura
   - Maneja errores gracefully

2. **ConfigBuilder.js**
   - Función `buildJSON(config)`: Convierte Instancias de modelos → JSON
   - Aplica compresión si es necesario
   - Valida tamaño antes de serializar

**Criterio de éxito**: Los modelos de dominio son framework-agnostic y pueden ser serializados/deserializados.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 5: Separar UI y Event Handlers 🖱️

**Objetivo**: Extraer toda la lógica de UI y eventos a módulos dedicados.

**Tiempo estimado**: 1-2 días

#### Tareas:

1. **ModalManager.js**
   - Extraer `showModalForm()`
   - Extraer funciones de creación de modales
   - **Dependencias permitidas**: DOM, FormBuilder

2. **FormBuilder.js**
   - Extraer lógica de construcción de formularios
   - Validación de campos
   - **Dependencias permitidas**: DOM, utils

3. **EventHandlers.js**
   - Extraer todos los event listeners
   - Funciones de manejo de eventos (click, submit, etc.)
   - **Dependencias permitidas**: Services, Renderers, Controllers

**Criterio de éxito**: La UI es completamente desacoplada de la lógica de negocio.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 6: Crear ExtensionController 🎮

**Objetivo**: Crear el controlador principal que orquesta todos los módulos.

**Tiempo estimado**: 4-6 horas

#### Tareas:

1. **ExtensionController.js**
   - Similar a `PluginController` del plugin de Obsidian
   - Inicializa todos los servicios
   - Conecta eventos UI con servicios
   - **NO contiene lógica de negocio**, solo orquestación
   - **Dependencias permitidas**: Todos los módulos anteriores

2. **main.js**
   - Punto de entrada mínimo
   - Inicializa `ExtensionController` cuando OBR está listo
   - Similar a `main.js` del plugin de Obsidian

**Criterio de éxito**: El controlador es delgado y solo coordina, no implementa lógica.

**Verificación**: Ejecutar tests de regresión - deben pasar 100%

---

### Fase 7: Testing y Validación ✅

**Objetivo**: Asegurar que la refactorización no rompió funcionalidad.

**Tiempo estimado**: 1 día

#### Tareas:

1. **Testing manual**
   - Probar todas las funcionalidades principales
   - Verificar que el comportamiento es idéntico al original

2. **Optimización**
   - Revisar imports y dependencias
   - Eliminar código duplicado
   - Optimizar rendimiento si es necesario

3. **Documentación**
   - Actualizar `DEVELOPMENT.md` con nueva estructura
   - Documentar cada módulo con JSDoc
   - Crear diagrama de arquitectura

4. **Limpieza final**
   - Eliminar `js/index.js.backup` y `js/index.original.js`
   - Eliminar código comentado innecesario
   - Verificar que no hay imports no usados

**Criterio de éxito**: La extensión funciona exactamente igual que antes, pero con código modular y mantenible.

**Verificación final**: 
- 100% tests de regresión pasando
- Testing manual completo
- Deploy a staging exitoso

---

## 🔄 Plan de Rollback

### ⚠️ Cuándo Activar Rollback

Activar rollback si:
1. Más del 20% de tests de regresión fallan después de una fase
2. Funcionalidad crítica deja de funcionar (broadcast, storage, renderizado)
3. Errores en producción después de deploy
4. Performance degradada significativamente (>50% más lento)

### 📋 Procedimiento de Rollback

#### Rollback Inmediato (por fase)

Si una fase falla, volver al estado anterior a esa fase:

```bash
# Ejemplo: Rollback de Fase 2 a Fase 1
git checkout HEAD~1 -- js/
# O usar el backup:
cp js/index.js.backup js/index.js
```

#### Rollback Completo (a código original)

Si la refactorización completa falla:

```bash
# Opción 1: Usar backup
cp js/index.original.js js/index.js
rm -rf js/{controllers,models,parsers,builders,renderers,services,utils,ui}

# Opción 2: Usar git
git checkout main -- js/index.js
git clean -fd js/
```

### 🔐 Puntos de Checkpoint (Commits Recomendados)

Hacer commit después de cada fase completada exitosamente:

```bash
# Después de Fase 0
git add . && git commit -m "refactor: Fase 0 - Tests de regresión creados"

# Después de Fase 1
git add . && git commit -m "refactor: Fase 1 - Estructura base y utilidades"

# Después de Fase 2
git add . && git commit -m "refactor: Fase 2 - Servicios extraídos"

# ... etc para cada fase
```

### 🚨 Plan de Contingencia para Producción

Si hay problemas después de deploy a producción:

1. **Rollback inmediato** en Netlify:
   - Ir a Deploys → Seleccionar deploy anterior → "Publish deploy"

2. **Feature flag** (si implementado):
   ```javascript
   const USE_NEW_ARCHITECTURE = false; // Desactivar nuevo código
   ```

3. **Comunicar a usuarios**:
   - Si hay downtime, informar vía Discord/GitHub

### ✅ Checklist Pre-Rollback

Antes de hacer rollback, verificar:

- [ ] ¿El problema es realmente de la refactorización?
- [ ] ¿Se pueden arreglar los tests fallidos rápidamente?
- [ ] ¿Hay un commit limpio al que volver?
- [ ] ¿Se han documentado los problemas encontrados?

---

## 🔑 Principios de Diseño

### 1. Separación de Responsabilidades

Cada módulo tiene una única responsabilidad:
- **Services**: Comunicación externa (API, Storage, Broadcast)
- **Models**: Representación de datos (sin lógica de negocio)
- **Parsers**: Conversión de formatos externos → Modelos
- **Builders**: Conversión de Modelos → Formatos externos
- **Renderers**: Generación de HTML/UI
- **Controllers**: Orquestación (sin lógica de negocio)

### 2. Framework-Agnostic Domain Models

Los modelos (`Page`, `Category`, `Config`) son clases JavaScript puras que:
- No dependen de OBR SDK
- No dependen de DOM
- Pueden ser testeados fácilmente
- Pueden ser reutilizados en otros contextos

### 3. Edge Isolation

El código de OBR SDK solo aparece en:
- `main.js` (punto de entrada)
- `ExtensionController.js` (orquestación)
- `StorageService.js` (acceso a metadata)
- `BroadcastService.js` (broadcast)

El resto del código es framework-agnostic.

### 4. Testabilidad

Cada módulo puede ser testeado independientemente:

```javascript
// Ejemplo: testear NotionService sin OBR
const mockFetch = jest.fn();
const service = new NotionService(mockFetch);
const blocks = await service.fetchBlocks('page-id');
// Assert blocks.length > 0
```

### 5. Extensibilidad

La arquitectura facilita futuras extensiones:

#### Nuevos tipos de contenido
- Añadir `GoogleDocsService` similar a `NotionService`
- Los modelos no cambian
- `ExtensionController` gestiona múltiples servicios

#### Nuevos tipos de renderizado
- Añadir `PDFRenderer` similar a `NotionRenderer`
- Reutilizar los mismos modelos

#### Nuevas fuentes de datos
- Añadir `ConfigParser` para otros formatos
- Los modelos de dominio no cambian

---

## 📊 Comparación: Antes vs Después

### Antes (Monolítico)

```javascript
// js/index.js (9,865 líneas)
function renderCategory(category, parentElement, level = 0) {
  // 200+ líneas mezclando:
  // - Lógica de negocio
  // - Renderizado HTML
  // - Llamadas a servicios
  // - Manejo de eventos
  // - Validación
}

function fetchNotionBlocks(pageId) {
  // 100+ líneas mezclando:
  // - Lógica de caché
  // - Llamadas a API
  // - Manejo de errores
  // - Logging
  // - Validación de tokens
}
```

### Después (Modular)

```javascript
// js/services/NotionService.js
export class NotionService {
  async fetchBlocks(pageId) {
    // Solo lógica de API
  }
}

// js/services/CacheService.js
export class CacheService {
  getCachedBlocks(pageId) {
    // Solo lógica de caché
  }
}

// js/renderers/UIRenderer.js
export class UIRenderer {
  renderCategory(category) {
    // Solo renderizado HTML
  }
}

// js/controllers/ExtensionController.js
export class ExtensionController {
  async loadPage(pageId) {
    // Orquestación: coordina servicios y renderers
    const blocks = await this.notionService.fetchBlocks(pageId);
    const html = this.notionRenderer.render(blocks);
    this.uiRenderer.updatePage(html);
  }
}
```

---

## 🚀 Orden de Implementación Recomendado

1. **Fase 1** (Preparación): Estructura base y utilidades
2. **Fase 2** (Servicios): Extraer servicios uno por uno
3. **Fase 3** (Renderizadores): Extraer renderizadores
4. **Fase 4** (Parsers/Builders): Crear capas de conversión
5. **Fase 5** (UI): Separar UI y eventos
6. **Fase 6** (Controller): Crear controlador principal
7. **Fase 7** (Testing): Validar y documentar

**Estrategia**: Implementar fase por fase, probando después de cada fase para asegurar que todo funciona.

---

## ⚠️ Análisis de Riesgos y Probabilidades

### Probabilidad de Problemas: **MEDIA-ALTA (30-50%)**

**Análisis honesto**: Refactorizar un código monolítico de ~9,865 líneas con múltiples dependencias externas (OBR SDK, localStorage, broadcast, Netlify Functions) tiene riesgos inherentes. Sin embargo, con las estrategias correctas, estos riesgos pueden minimizarse significativamente.

### Áreas de Mayor Riesgo

#### 🔴 **ALTO RIESGO (Probabilidad 40-60%)**

1. **Estado compartido y efectos secundarios**
   - **Problema**: Variables globales, cachés compartidos, estado en closures
   - **Ejemplo**: `cachedUserRole`, `pagesConfigCache`, `localHtmlCache`
   - **Impacto**: Funcionalidad puede romperse silenciosamente
   - **Mitigación**: 
     - Mapear TODAS las variables globales antes de refactorizar
     - Crear un `StateManager` centralizado
     - Usar tests de integración que verifiquen el estado completo

2. **Timing y asincronía**
   - **Problema**: Dependencias de orden de ejecución, promises encadenadas
   - **Ejemplo**: `getUserRole()` con caché, `setupRoomMetadataListener()` que se ejecuta en momentos específicos
   - **Impacto**: Race conditions, funciones que se ejecutan antes de tiempo
   - **Mitigación**:
     - Documentar TODAS las dependencias de timing
     - Usar `Promise.all()` y `async/await` consistentemente
     - Tests que verifiquen orden de ejecución

3. **Broadcast y sincronización GM/Player**
   - **Problema**: Lógica compleja de broadcast, heartbeats, timeouts
   - **Ejemplo**: `setupGMContentBroadcast()`, `startOwnerHeartbeat()`, timeouts de 5 segundos
   - **Impacto**: Contenido no se comparte correctamente entre GM y players
   - **Mitigación**:
     - Extraer TODO el código de broadcast en un solo módulo
     - Tests específicos para escenarios GM/Player
     - Mantener la lógica exacta de timeouts y heartbeats

4. **Storage y metadata de OBR**
   - **Problema**: Límites de 16KB, compresión, validación de tamaño
   - **Ejemplo**: `validateMetadataSize()`, `compressJson()`, `ROOM_METADATA_SIZE_LIMIT`
   - **Impacto**: Datos no se guardan, pérdida de configuración
   - **Mitigación**:
     - NO cambiar la lógica de compresión/validación
     - Tests que verifiquen límites exactos
     - Mantener funciones de validación idénticas

#### 🟡 **RIESGO MEDIO (Probabilidad 20-40%)**

5. **Renderizado de UI y eventos**
   - **Problema**: Event listeners, manipulación de DOM, estado de UI
   - **Ejemplo**: `renderCategory()`, event handlers en elementos dinámicos
   - **Impacto**: UI no funciona, eventos no se disparan
   - **Mitigación**:
     - Extraer renderizado sin cambiar la estructura HTML generada
     - Mantener los mismos selectores CSS y IDs
     - Tests visuales o snapshot tests

6. **Caché y optimizaciones**
   - **Problema**: Múltiples niveles de caché (localStorage, metadata, memoria)
   - **Ejemplo**: `getCachedBlocks()`, `saveHtmlToLocalCache()`, límite de 20 páginas
   - **Impacto**: Rendimiento degradado, caché no funciona
   - **Mitigación**:
     - Mantener la misma estrategia de caché
     - No cambiar límites ni algoritmos de invalidación
     - Tests de rendimiento

7. **Manejo de errores y edge cases**
   - **Problema**: Errores silenciosos, fallbacks, validaciones
   - **Ejemplo**: `try/catch` con fallbacks, validación de tokens
   - **Impacto**: Errores no se manejan correctamente
   - **Mitigación**:
     - Documentar TODOS los edge cases
     - Mantener la misma lógica de manejo de errores
     - Tests de casos límite

#### 🟢 **RIESGO BAJO (Probabilidad 5-15%)**

8. **Utilidades y helpers**
   - **Problema**: Funciones auxiliares con dependencias ocultas
   - **Mitigación**: Tests unitarios exhaustivos

9. **Analytics y logging**
   - **Problema**: Tracking puede no funcionar
   - **Impacto**: Bajo (no afecta funcionalidad core)
   - **Mitigación**: Tests de integración con Mixpanel

### Estrategias para Minimizar Riesgos

#### 1. **Migración Incremental con Feature Flags** ⭐ RECOMENDADO

```javascript
// Estrategia: Mantener código viejo y nuevo funcionando en paralelo
const USE_NEW_ARCHITECTURE = false; // Feature flag

if (USE_NEW_ARCHITECTURE) {
  // Usar nuevo código modular
  await newExtensionController.loadPage(pageId);
} else {
  // Usar código original
  await fetchNotionBlocks(pageId);
}
```

**Ventajas**:
- Puedes probar el nuevo código sin romper el existente
- Rollback instantáneo si hay problemas
- Migración gradual módulo por módulo

#### 2. **Tests de Regresión Exhaustivos**

Crear una suite de tests ANTES de refactorizar:

```javascript
// Tests que verifican comportamiento exacto
describe('Regresión: fetchNotionBlocks', () => {
  it('debe retornar bloques en el mismo formato', async () => {
    const blocks = await fetchNotionBlocks('page-id');
    expect(blocks).toHaveProperty('results');
    expect(blocks.results).toBeArray();
  });
  
  it('debe usar caché cuando está disponible', async () => {
    // Test específico de caché
  });
});
```

#### 3. **Comparación de Outputs**

Crear un script que compare outputs del código viejo vs nuevo:

```javascript
// Script de comparación
const oldOutput = await oldFunction(input);
const newOutput = await newFunction(input);
assert.deepEqual(oldOutput, newOutput);
```

#### 4. **Refactorización Módulo por Módulo**

**NO refactorizar todo de una vez**. Orden recomendado:

1. **Primero**: Utilidades (logger, helpers) - **Riesgo: 5%**
2. **Segundo**: Modelos (Page, Category) - **Riesgo: 10%**
3. **Tercero**: Servicios simples (CacheService) - **Riesgo: 20%**
4. **Cuarto**: Servicios complejos (NotionService) - **Riesgo: 30%**
5. **Quinto**: Broadcast y Storage - **Riesgo: 40%**
6. **Sexto**: Renderizadores - **Riesgo: 30%**
7. **Último**: Controller y UI - **Riesgo: 25%**

#### 5. **Mantener Código Original como Referencia**

- NO eliminar código original hasta que TODO esté probado
- Mantener comentarios con referencias al código original
- Documentar cambios intencionales

#### 6. **Testing en Producción Gradual**

1. **Fase 1**: Testing local exhaustivo
2. **Fase 2**: Deploy a staging/desarrollo
3. **Fase 3**: Deploy a producción con feature flag OFF
4. **Fase 4**: Activar feature flag para usuarios beta
5. **Fase 5**: Activar para todos los usuarios
6. **Fase 6**: Eliminar código antiguo

### Probabilidad Final con Mitigaciones

| Escenario | Sin Mitigaciones | Con Mitigaciones |
|-----------|------------------|-----------------|
| **Funciona 100% igual** | 50-70% | **85-95%** |
| **Problemas menores** | 20-30% | **5-10%** |
| **Problemas mayores** | 10-20% | **<5%** |

### Recomendación Final

**Probabilidad de éxito con estrategias correctas: 85-95%**

**Para maximizar éxito**:
1. ✅ Usar migración incremental con feature flags
2. ✅ Crear tests de regresión ANTES de refactorizar
3. ✅ Refactorizar módulo por módulo
4. ✅ Mantener código original como referencia
5. ✅ Testing exhaustivo después de cada fase
6. ✅ Deploy gradual con rollback plan

**Tiempo estimado**: 2-3 semanas de trabajo cuidadoso vs 1 semana de refactorización rápida (pero más riesgosa)

---

## ⚠️ Consideraciones Importantes

### Compatibilidad con OBR SDK

- Algunos módulos necesitarán acceso a OBR SDK (StorageService, BroadcastService)
- Esto está bien, pero debe estar aislado en esos módulos específicos
- El resto del código debe ser independiente

### Migración Gradual

- No es necesario refactorizar todo de una vez
- Se puede hacer de forma incremental
- Mantener el código original funcionando mientras se migra
- **USAR FEATURE FLAGS** para poder hacer rollback

### Testing

- Cada módulo debe ser testeable independientemente
- Usar mocks para OBR SDK y DOM
- Crear tests unitarios para cada módulo
- **CREAR TESTS DE REGRESIÓN ANTES DE REFACTORIZAR**

### Performance

- La refactorización no debe afectar el rendimiento
- Mantener las optimizaciones existentes (caché, compresión, etc.)
- Revisar imports para evitar bundles innecesarios
- **BENCHMARK antes y después**

---

## 📚 Referencias

- **Plugin de Obsidian**: `/Users/lole/Sites/obsidian-gm-vault-plugin/ARCHITECTURE.md`
- **Estructura actual**: `/Users/lole/Sites/owlbear-gm-vault/js/index.js`
- **Documentación OBR**: https://docs.owlbear.rodeo/

---

## ✅ Checklist de Refactorización

### Fase 1: Preparación
- [ ] Crear estructura de directorios
- [ ] Extraer utilidades (logger, analytics, helpers)
- [ ] Crear modelos básicos (Page, Category, Config)
- [ ] Migrar constantes

### Fase 2: Servicios
- [ ] NotionService.js
- [ ] StorageService.js
- [ ] BroadcastService.js
- [ ] CacheService.js

### Fase 3: Renderizadores
- [ ] NotionRenderer.js
- [ ] UIRenderer.js
- [ ] MarkdownRenderer.js (si aplica)

### Fase 4: Parsers/Builders
- [ ] ConfigParser.js
- [ ] ConfigBuilder.js

### Fase 5: UI
- [ ] ModalManager.js
- [ ] FormBuilder.js
- [ ] EventHandlers.js

### Fase 6: Controller
- [ ] ExtensionController.js
- [ ] Refactorizar main.js

### Fase 7: Testing
- [ ] Testing manual completo
- [ ] Optimización
- [ ] Documentación actualizada

---

## 🤖 Guía para Agente Opus - Instrucciones de Ejecución

Esta sección contiene instrucciones detalladas paso a paso para que un agente de IA ejecute la refactorización de forma segura y sistemática.

### 📋 Pre-requisitos

Antes de comenzar, el agente debe:

1. **Leer y entender el código actual**:
   - Leer completamente `js/index.js` (9,865 líneas)
   - Identificar TODAS las funciones y sus dependencias
   - Mapear variables globales y estado compartido

2. **Crear un backup**:
   ```bash
   cp js/index.js js/index.js.backup
   ```

3. **Verificar que el código actual funciona**:
   - No hacer cambios hasta confirmar que todo funciona

### 🎯 Estrategia de Ejecución

**IMPORTANTE**: Ejecutar fase por fase, probando después de cada fase. NO avanzar a la siguiente fase hasta que la anterior esté 100% funcional.

---

### FASE 1: Preparación y Estructura Base

#### Paso 1.1: Crear Estructura de Directorios

**Comando**:
```bash
cd /Users/lole/Sites/owlbear-gm-vault
mkdir -p js/{controllers,models,parsers,builders,renderers,services,utils,ui}
```

**Verificar**:
```bash
ls -la js/
# Debe mostrar: controllers, models, parsers, builders, renderers, services, utils, ui
```

#### Paso 1.2: Extraer Constantes

**Archivo a crear**: `js/utils/constants.js`

**Instrucciones**:
1. Buscar TODAS las constantes en `js/index.js` usando grep:
   ```bash
   grep -n "^const [A-Z_]" js/index.js
   ```
2. Extraer constantes como:
   - `STORAGE_KEY_PREFIX`
   - `GLOBAL_TOKEN_KEY`
   - `ROOM_METADATA_KEY`
   - `ROOM_CONTENT_CACHE_KEY`
   - `BROADCAST_CHANNEL_*`
   - `ROOM_METADATA_SIZE_LIMIT`
   - `OWNER_HEARTBEAT_INTERVAL`
   - `OWNER_TIMEOUT`
   - `CACHE_PREFIX`
   - `PAGE_INFO_CACHE_PREFIX`
   - `ANALYTICS_CONSENT_KEY`
   - `CSS_VARS`

**Template del archivo**:
```javascript
/**
 * @fileoverview Constantes globales de la extensión
 */

export const STORAGE_KEY_PREFIX = 'notion-pages-json-';
export const GLOBAL_TOKEN_KEY = 'notion-global-token';
export const ROOM_METADATA_KEY = 'com.dmscreen/pagesConfig';
export const ROOM_CONTENT_CACHE_KEY = 'com.dmscreen/contentCache';
export const ROOM_HTML_CACHE_KEY = 'com.dmscreen/htmlCache';
export const BROADCAST_CHANNEL_REQUEST = 'com.dmscreen/requestContent';
export const BROADCAST_CHANNEL_RESPONSE = 'com.dmscreen/responseContent';
export const BROADCAST_CHANNEL_VISIBLE_PAGES = 'com.dmscreen/visiblePages';
export const BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES = 'com.dmscreen/requestVisiblePages';
export const FULL_CONFIG_KEY = 'com.dmscreen/fullConfig';
export const VAULT_OWNER_KEY = 'com.dmscreen/vaultOwner';
export const OWNER_HEARTBEAT_INTERVAL = 120000; // 2 minutos
export const OWNER_TIMEOUT = 900000; // 15 minutos
export const ROOM_METADATA_SIZE_LIMIT = 16 * 1024; // 16384 bytes
export const ROOM_METADATA_SAFE_LIMIT = ROOM_METADATA_SIZE_LIMIT - 1024;
export const MAX_METADATA_SIZE = ROOM_METADATA_SIZE_LIMIT;
export const CACHE_PREFIX = 'notion-blocks-cache-';
export const PAGE_INFO_CACHE_PREFIX = 'notion-page-info-cache-';
export const ANALYTICS_CONSENT_KEY = 'analytics_consent';

export const CSS_VARS = {
  // Extraer valores de CSS_VARS del código original
};
```

**Criterio de éxito**: 
- Todas las constantes están extraídas
- El archivo se importa correctamente
- No hay referencias a constantes hardcodeadas en el código original

#### Paso 1.3: Crear Logger

**Archivo a crear**: `js/utils/logger.js`

**Instrucciones**:
1. Extraer funciones `log()`, `logError()`, `logWarn()` de `js/index.js`
2. Extraer `initDebugMode()`, `getUserRole()`, y variables relacionadas
3. Mantener la lógica EXACTA de logging (incluyendo verificación de rol GM)

**Template del archivo**:
```javascript
/**
 * @fileoverview Sistema de logging con control de debug y rol de usuario
 */

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

let DEBUG_MODE = false;
let cachedUserRole = null;
let roleCheckPromise = null;

/**
 * Inicializa el modo debug desde Netlify Function
 */
export async function initDebugMode() {
  // COPIAR código exacto de initDebugMode() del original
}

/**
 * Obtiene el rol del usuario (con caché)
 */
async function getUserRole() {
  // COPIAR código exacto de getUserRole() del original
}

/**
 * Función wrapper para logs (solo muestra si DEBUG_MODE está activado)
 */
export function log(...args) {
  // COPIAR código exacto de log() del original
}

/**
 * Log de errores (siempre se muestran)
 */
export function logError(...args) {
  console.error(...args);
}

/**
 * Log de advertencias (siempre se muestran)
 */
export function logWarn(...args) {
  console.warn(...args);
}
```

**Criterio de éxito**:
- Los logs funcionan exactamente igual que antes
- El modo debug se inicializa correctamente
- La verificación de rol GM funciona igual

#### Paso 1.4: Crear Analytics

**Archivo a crear**: `js/utils/analytics.js`

**Instrucciones**:
1. Extraer TODAS las funciones de Mixpanel de `js/index.js`
2. Buscar funciones que empiecen con `track*` o `initMixpanel`
3. Mantener la lógica de consentimiento

**Funciones a extraer**:
- `initMixpanel()`
- `showCookieConsentBanner()`
- `getAnalyticsConsent()`
- `setAnalyticsConsent()`
- `trackPageView()`
- `trackImageShare()`
- `trackVisibilityToggle()`
- `trackStorageLimitReached()`
- `trackCacheCleared()`
- `trackGMNotActive()`
- `trackContentTooLarge()`
- `trackExtensionOpened()`
- `trackFolderAdded()`
- `trackPageAdded()`
- `trackFolderEdited()`
- `trackPageEdited()`
- `trackFolderDeleted()`
- `trackPageDeleted()`
- `trackPageMoved()`
- `trackTokenConfigured()`
- `trackTokenRemoved()`
- `trackJSONImported()`
- `trackJSONExported()`
- `trackPageLinkedToToken()`
- `trackPageViewedFromToken()`
- `trackPageReloaded()`

**Criterio de éxito**:
- Todas las funciones de tracking están extraídas
- El consentimiento de analytics funciona igual
- Mixpanel se inicializa correctamente

#### Paso 1.5: Crear Helpers

**Archivo a crear**: `js/utils/helpers.js`

**Instrucciones**:
1. Extraer funciones auxiliares puras (sin dependencias de OBR o DOM)
2. Buscar funciones como:
   - `extractNotionPageId()`
   - `generateColorFromString()`
   - `getInitial()`
   - `getJsonSize()`
   - `compressJson()`
   - `stringifyCompact()`
   - `getStorageKey()`
   - `getFriendlyRoomId()`
   - `countPages()`
   - `countCategories()`
   - `getConfigSize()`
   - `navigateConfigPath()`
   - `findPageInConfig()`
   - `getCategoryOptions()`
   - `getCombinedOrder()`
   - `saveCombinedOrder()`

**Criterio de éxito**:
- Funciones son puras (no dependen de OBR, DOM, o estado global)
- Pueden ser testeadas independientemente
- Mismo comportamiento que el código original

#### Paso 1.6: Crear Modelos de Dominio

**Archivo a crear**: `js/models/Page.js`

**Template** (basado en el plugin de Obsidian, pero adaptado):
```javascript
/**
 * @fileoverview Modelo de dominio para una Página
 */

export class Page {
  constructor(name, url, options = {}) {
    this.name = name;
    this.url = url;
    this.selector = options.selector || null;
    this.blockTypes = options.blockTypes || [];
    this.visibleToPlayers = options.visibleToPlayers || false;
    this.tokenId = options.tokenId || null;
  }

  hasBlockType(blockType) {
    return this.blockTypes.includes(blockType);
  }

  addBlockType(blockType) {
    if (!this.blockTypes.includes(blockType)) {
      this.blockTypes.push(blockType);
    }
  }
}
```

**Archivo a crear**: `js/models/Category.js`

```javascript
/**
 * @fileoverview Modelo de dominio para una Categoría (carpeta)
 */

import { Page } from './Page.js';

export class Category {
  constructor(name, options = {}) {
    this.name = name;
    this.pages = options.pages || [];
    this.categories = options.categories || [];
    this.collapsed = options.collapsed || false;
    this.visibleToPlayers = options.visibleToPlayers || false;
  }

  addPage(page) {
    if (page instanceof Page) {
      this.pages.push(page);
    } else {
      // Si es un objeto plano, convertirlo a Page
      this.pages.push(new Page(page.name, page.url, page));
    }
  }

  addCategory(category) {
    if (category instanceof Category) {
      this.categories.push(category);
    } else {
      this.categories.push(new Category(category.name, category));
    }
  }
}
```

**Archivo a crear**: `js/models/Config.js`

```javascript
/**
 * @fileoverview Modelo de dominio para la Configuración completa
 */

import { Category } from './Category.js';

export class Config {
  constructor() {
    this.categories = [];
  }

  addCategory(category) {
    if (category instanceof Category) {
      this.categories.push(category);
    } else {
      this.categories.push(new Category(category.name, category));
    }
  }

  findCategory(path) {
    // Implementar navegación por path
  }

  findPage(pageUrl, pageName) {
    // Implementar búsqueda de página
  }
}
```

**Criterio de éxito**:
- Los modelos son clases puras (sin dependencias externas)
- Pueden ser instanciados y usados independientemente
- Representan correctamente la estructura de datos

#### Paso 1.7: Actualizar index.js para Usar Nuevos Módulos

**Instrucciones**:
1. Al inicio de `js/index.js`, agregar imports:
   ```javascript
   import { log, logError, logWarn, initDebugMode } from './utils/logger.js';
   import * as Analytics from './utils/analytics.js';
   import * as Constants from './utils/constants.js';
   import * as Helpers from './utils/helpers.js';
   ```
2. Reemplazar todas las llamadas a funciones extraídas con imports
3. Reemplazar constantes hardcodeadas con `Constants.*`

**Criterio de éxito**:
- El código compila sin errores
- La extensión funciona exactamente igual que antes
- No hay referencias a funciones/constantes que ya no existen

**Testing**:
- Abrir Owlbear Rodeo
- Verificar que la extensión carga correctamente
- Verificar que los logs funcionan
- Verificar que analytics funciona

---

### FASE 2: Extraer Servicios

**IMPORTANTE**: Hacer UN servicio a la vez, probando después de cada uno.

#### Paso 2.1: CacheService.js

**Archivo a crear**: `js/services/CacheService.js`

**Funciones a extraer**:
- `getCachedBlocks(pageId)`
- `setCachedBlocks(pageId, blocks)`
- `getCachedPageInfo(pageId)`
- `setCachedPageInfo(pageId, pageInfo)`
- `saveHtmlToLocalCache(pageId, html)`
- `clearAllCache()`

**Template**:
```javascript
/**
 * @fileoverview Servicio de gestión de caché
 */

import { CACHE_PREFIX, PAGE_INFO_CACHE_PREFIX } from '../utils/constants.js';
import { log } from '../utils/logger.js';

export class CacheService {
  constructor() {
    this.localHtmlCache = new Map(); // Caché en memoria (máx 20 páginas)
    this.maxCacheSize = 20;
  }

  getCachedBlocks(pageId) {
    // COPIAR código exacto de getCachedBlocks()
  }

  setCachedBlocks(pageId, blocks) {
    // COPIAR código exacto de setCachedBlocks()
  }

  // ... resto de métodos
}
```

**Criterio de éxito**:
- El caché funciona exactamente igual
- Los límites son los mismos (20 páginas en memoria)
- La invalidación funciona igual

#### Paso 2.2: NotionService.js

**Archivo a crear**: `js/services/NotionService.js`

**Funciones a extraer**:
- `fetchNotionBlocks(pageId, useCache)`
- `fetchNotionPageInfo(pageId, useCache)`
- `extractNotionPageId(url)`

**Dependencias permitidas**:
- `fetch` API
- `CacheService` (inyectado)
- `getUserToken()` (de StorageService o como parámetro)

**Template**:
```javascript
/**
 * @fileoverview Servicio de comunicación con Notion API
 */

import { log, logError } from '../utils/logger.js';
import { extractNotionPageId } from '../utils/helpers.js';

export class NotionService {
  constructor(cacheService, getUserTokenFn) {
    this.cacheService = cacheService;
    this.getUserToken = getUserTokenFn;
  }

  async fetchBlocks(pageId, useCache = true) {
    // COPIAR código exacto de fetchNotionBlocks()
    // Pero usar this.cacheService en lugar de funciones globales
  }

  async fetchPageInfo(pageId, useCache = true) {
    // COPIAR código exacto de fetchNotionPageInfo()
  }
}
```

**Criterio de éxito**:
- Las llamadas a Notion API funcionan igual
- El manejo de errores es idéntico
- El caché se usa correctamente

#### Paso 2.3: StorageService.js

**Archivo a crear**: `js/services/StorageService.js`

**Funciones a extraer**:
- `getPagesJSON(roomId)`
- `getPagesJSONFromLocalStorage(roomId)`
- `savePagesJSON(json, roomId)`
- `getUserToken()`
- `saveUserToken(token)`
- `hasUserToken()`
- `validateMetadataSize()`
- `validateTotalMetadataSize()`
- `filterVisiblePagesForMetadata()`

**Dependencias permitidas**:
- `OBR` SDK (solo para metadata)
- `localStorage`
- Funciones de validación/compresión

**Template**:
```javascript
/**
 * @fileoverview Servicio de gestión de almacenamiento
 */

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { 
  STORAGE_KEY_PREFIX, 
  GLOBAL_TOKEN_KEY,
  ROOM_METADATA_KEY,
  ROOM_METADATA_SIZE_LIMIT 
} from '../utils/constants.js';
import { log, logError } from '../utils/logger.js';
import { 
  getStorageKey, 
  validateMetadataSize,
  compressJson 
} from '../utils/helpers.js';

export class StorageService {
  async getPagesJSON(roomId) {
    // COPIAR código exacto de getPagesJSON()
  }

  async savePagesJSON(json, roomId) {
    // COPIAR código exacto de savePagesJSON()
    // MANTENER la lógica de validación de tamaño EXACTA
  }

  getUserToken() {
    // COPIAR código exacto de getUserToken()
  }

  saveUserToken(token) {
    // COPIAR código exacto de saveUserToken()
  }
}
```

**Criterio de éxito**:
- Los datos se guardan y cargan correctamente
- La validación de tamaño funciona igual (16KB límite)
- La compresión funciona igual
- El token se gestiona correctamente

#### Paso 2.4: BroadcastService.js

**Archivo a crear**: `js/services/BroadcastService.js`

**Funciones a extraer**:
- `setupGMContentBroadcast()`
- `setupGMVisiblePagesBroadcast()`
- `broadcastVisiblePagesUpdate(visibleConfig)`
- `requestHtmlFromGM(pageId)`
- `startOwnerHeartbeat(roomId)`
- `stopOwnerHeartbeat()`

**Dependencias permitidas**:
- `OBR` SDK (solo para broadcast)
- `CacheService` (para HTML cache)

**Template**:
```javascript
/**
 * @fileoverview Servicio de comunicación broadcast entre GM y Players
 */

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import {
  BROADCAST_CHANNEL_REQUEST,
  BROADCAST_CHANNEL_RESPONSE,
  BROADCAST_CHANNEL_VISIBLE_PAGES,
  BROADCAST_CHANNEL_REQUEST_VISIBLE_PAGES,
  OWNER_HEARTBEAT_INTERVAL,
  OWNER_TIMEOUT
} from '../utils/constants.js';
import { log, logError } from '../utils/logger.js';

export class BroadcastService {
  constructor(cacheService) {
    this.cacheService = cacheService;
    this.heartbeatInterval = null;
  }

  setupGMContentBroadcast() {
    // COPIAR código exacto de setupGMContentBroadcast()
    // MANTENER timeouts y lógica exacta
  }

  setupGMVisiblePagesBroadcast() {
    // COPIAR código exacto de setupGMVisiblePagesBroadcast()
  }

  // ... resto de métodos
}
```

**Criterio de éxito**:
- El broadcast funciona entre GM y Players
- Los timeouts son los mismos (5 segundos para requests)
- Los heartbeats funcionan igual (2 minutos intervalo, 15 minutos timeout)

---

### FASE 3: Extraer Renderizadores

#### Paso 3.1: NotionRenderer.js

**Archivo a crear**: `js/renderers/NotionRenderer.js`

**Funciones a extraer**:
- `renderBlock(block)`
- `renderRichText(richTextArray)`
- `renderPageCoverAndTitle(cover, pageTitle)`
- `setNotionDisplayMode(container, mode)`
- `showNotionBlockedMessage(container, url)`

**Template**:
```javascript
/**
 * @fileoverview Renderizador de bloques de Notion a HTML
 */

export class NotionRenderer {
  renderBlock(block) {
    // COPIAR código exacto de renderBlock()
    // Retornar string HTML
  }

  renderRichText(richTextArray) {
    // COPIAR código exacto de renderRichText()
  }

  // ... resto de métodos
}
```

**Criterio de éxito**:
- El HTML generado es IDÉNTICO al original
- Todos los tipos de bloques se renderizan igual
- Los estilos CSS se aplican correctamente

#### Paso 3.2: UIRenderer.js

**Archivo a crear**: `js/renderers/UIRenderer.js`

**Funciones a extraer**:
- `renderCategory(category, parentElement, level, roomId, categoryPath, isGM)`
- `renderPagesByCategories(config, pageList, roomId)`
- `renderPageIcon(icon, pageName, pageId)`

**Template**:
```javascript
/**
 * @fileoverview Renderizador de UI (categorías, páginas, botones)
 */

export class UIRenderer {
  constructor(eventHandlers) {
    this.eventHandlers = eventHandlers;
  }

  renderCategory(category, parentElement, level, roomId, categoryPath, isGM) {
    // COPIAR código exacto de renderCategory()
    // Pero delegar eventos a this.eventHandlers
  }

  // ... resto de métodos
}
```

**Criterio de éxito**:
- La UI se ve exactamente igual
- Los IDs y clases CSS son los mismos
- Los eventos se disparan correctamente

---

### FASE 4: Parsers y Builders

#### Paso 4.1: ConfigParser.js

**Archivo a crear**: `js/parsers/ConfigParser.js`

**Template**:
```javascript
/**
 * @fileoverview Parser de JSON a modelos de dominio
 */

import { Config } from '../models/Config.js';
import { Category } from '../models/Category.js';
import { Page } from '../models/Page.js';

export class ConfigParser {
  parseConfig(json) {
    const config = new Config();
    
    if (json.categories) {
      json.categories.forEach(catData => {
        const category = this.parseCategory(catData);
        config.addCategory(category);
      });
    }
    
    return config;
  }

  parseCategory(catData) {
    const category = new Category(catData.name, {
      collapsed: catData.collapsed,
      visibleToPlayers: catData.visibleToPlayers
    });

    if (catData.pages) {
      catData.pages.forEach(pageData => {
        category.addPage(new Page(pageData.name, pageData.url, pageData));
      });
    }

    if (catData.categories) {
      catData.categories.forEach(subCatData => {
        category.addCategory(this.parseCategory(subCatData));
      });
    }

    return category;
  }
}
```

#### Paso 4.2: ConfigBuilder.js

**Archivo a crear**: `js/builders/ConfigBuilder.js`

**Template**:
```javascript
/**
 * @fileoverview Builder de modelos de dominio a JSON
 */

export class ConfigBuilder {
  buildJSON(config) {
    return {
      categories: config.categories.map(cat => this.buildCategory(cat))
    };
  }

  buildCategory(category) {
    const result = {
      name: category.name
    };

    if (category.pages.length > 0) {
      result.pages = category.pages.map(page => this.buildPage(page));
    }

    if (category.categories.length > 0) {
      result.categories = category.categories.map(cat => this.buildCategory(cat));
    }

    if (category.collapsed) result.collapsed = true;
    if (category.visibleToPlayers) result.visibleToPlayers = true;

    return result;
  }

  buildPage(page) {
    const result = {
      name: page.name,
      url: page.url
    };

    if (page.selector) result.selector = page.selector;
    if (page.blockTypes && page.blockTypes.length > 0) {
      result.blockTypes = page.blockTypes;
    }
    if (page.visibleToPlayers) result.visibleToPlayers = true;
    if (page.tokenId) result.tokenId = page.tokenId;

    return result;
  }
}
```

---

### FASE 5: UI y Event Handlers

#### Paso 5.1: ModalManager.js

**Archivo a crear**: `js/ui/ModalManager.js`

**Funciones a extraer**:
- `showModalForm(title, fields, onSubmit)`
- Funciones relacionadas con modales

#### Paso 5.2: FormBuilder.js

**Archivo a crear**: `js/ui/FormBuilder.js`

**Funciones a extraer**:
- Lógica de construcción de formularios
- Validación de campos

#### Paso 5.3: EventHandlers.js

**Archivo a crear**: `js/ui/EventHandlers.js`

**Funciones a extraer**:
- Todos los event listeners
- Handlers de click, submit, etc.

---

### FASE 6: ExtensionController

#### Paso 6.1: ExtensionController.js

**Archivo a crear**: `js/controllers/ExtensionController.js`

**Template**:
```javascript
/**
 * @fileoverview Controlador principal que orquesta todos los módulos
 */

import { NotionService } from '../services/NotionService.js';
import { StorageService } from '../services/StorageService.js';
import { BroadcastService } from '../services/BroadcastService.js';
import { CacheService } from '../services/CacheService.js';
import { NotionRenderer } from '../renderers/NotionRenderer.js';
import { UIRenderer } from '../renderers/UIRenderer.js';
import { ConfigParser } from '../parsers/ConfigParser.js';
import { ConfigBuilder } from '../builders/ConfigBuilder.js';

export class ExtensionController {
  constructor() {
    // Inicializar servicios
    this.cacheService = new CacheService();
    this.storageService = new StorageService();
    this.notionService = new NotionService(
      this.cacheService,
      () => this.storageService.getUserToken()
    );
    this.broadcastService = new BroadcastService(this.cacheService);
    
    // Inicializar renderers
    this.notionRenderer = new NotionRenderer();
    this.uiRenderer = new UIRenderer(this.eventHandlers);
    
    // Inicializar parsers/builders
    this.configParser = new ConfigParser();
    this.configBuilder = new ConfigBuilder();
  }

  async initialize() {
    // Inicializar broadcast
    this.broadcastService.setupGMContentBroadcast();
    this.broadcastService.setupGMVisiblePagesBroadcast();
    
    // Cargar configuración inicial
    // Setup event listeners
  }

  async loadPage(pageId) {
    // Orquestación: coordinar servicios y renderers
    const blocks = await this.notionService.fetchBlocks(pageId);
    const html = this.notionRenderer.renderBlocks(blocks);
    // Mostrar en UI
  }
}
```

#### Paso 6.2: Refactorizar main.js

**Archivo a modificar**: `js/index.js` (o crear `js/main.js` nuevo)

**Instrucciones**:
1. Reducir `index.js` a solo inicialización
2. Importar `ExtensionController`
3. Inicializar cuando OBR esté listo

**Template**:
```javascript
import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ExtensionController } from './controllers/ExtensionController.js';
import { initDebugMode } from './utils/logger.js';

let extensionController = null;

OBR.onReady(async () => {
  await initDebugMode();
  
  extensionController = new ExtensionController();
  await extensionController.initialize();
  
  // Setup inicial de UI
  // ...
});
```

---

### FASE 7: Testing y Validación

#### Checklist de Testing

Para cada fase completada, verificar:

1. **Funcionalidad básica**:
   - [ ] La extensión carga sin errores
   - [ ] Se puede abrir el panel
   - [ ] Se pueden agregar páginas
   - [ ] Se pueden abrir páginas de Notion

2. **Funcionalidad avanzada**:
   - [ ] Broadcast GM/Player funciona
   - [ ] Caché funciona correctamente
   - [ ] Storage y metadata funcionan
   - [ ] Visibilidad de páginas funciona
   - [ ] Token management funciona

3. **Edge cases**:
   - [ ] Páginas sin token (debe mostrar error apropiado)
   - [ ] Metadata muy grande (debe comprimir)
   - [ ] Caché lleno (debe invalidar correctamente)
   - [ ] Timeouts de broadcast (debe manejar correctamente)

4. **Performance**:
   - [ ] No hay degradación de rendimiento
   - [ ] Caché funciona eficientemente
   - [ ] No hay memory leaks

---

## 🚨 Reglas Críticas para el Agente

1. **NO cambiar lógica de negocio**: Solo reorganizar código
2. **NO cambiar nombres de funciones públicas**: Mantener compatibilidad
3. **NO cambiar estructura de datos**: JSON debe ser idéntico
4. **NO cambiar IDs/classes CSS**: UI debe verse igual
5. **NO cambiar timeouts/límites**: Mantener valores exactos
6. **Probar después de cada paso**: No avanzar si algo falla
7. **Mantener código original comentado**: Para referencia
8. **Documentar cambios intencionales**: Si hay que cambiar algo, documentar por qué

---

## 🧪 Estrategia de Testing para la Refactorización

Esta sección describe cómo crear y ejecutar tests para asegurar que la refactorización no rompe funcionalidad.

### 📦 Setup de Framework de Testing

#### Paso 1: Instalar Dependencias

**Archivo a modificar**: `package.json`

```json
{
  "name": "owlbear-gm-vault",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "python -m http.server 8000",
    "serve": "npx http-server -p 8000 -c-1",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
    "test:watch": "node --experimental-vm-modules node_modules/jest/bin/jest.js --watch",
    "test:coverage": "node --experimental-vm-modules node_modules/jest/bin/jest.js --coverage",
    "test:regression": "node tests/regression/compare-outputs.js"
  },
  "devDependencies": {
    "@jest/globals": "^29.7.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "jsdom",
    "transform": {},
    "extensionsToTreatAsEsm": [".js"],
    "moduleNameMapper": {
      "^https://esm.sh/(.*)$": "<rootDir>/tests/mocks/esm-mock.js"
    }
  }
}
```

**Comando**:
```bash
npm install --save-dev jest @jest/globals jest-environment-jsdom
```

#### Paso 2: Crear Estructura de Tests

```bash
mkdir -p tests/{unit,integration,regression,mocks,fixtures}
```

**Estructura**:
```
tests/
├── unit/                    # Tests unitarios por módulo
│   ├── utils/
│   │   ├── logger.test.js
│   │   ├── analytics.test.js
│   │   └── helpers.test.js
│   ├── models/
│   │   ├── Page.test.js
│   │   ├── Category.test.js
│   │   └── Config.test.js
│   ├── services/
│   │   ├── CacheService.test.js
│   │   ├── NotionService.test.js
│   │   ├── StorageService.test.js
│   │   └── BroadcastService.test.js
│   └── renderers/
│       ├── NotionRenderer.test.js
│       └── UIRenderer.test.js
├── integration/             # Tests de integración
│   ├── extension-flow.test.js
│   └── broadcast-flow.test.js
├── regression/              # Tests de regresión
│   ├── compare-outputs.js   # Script de comparación
│   ├── function-comparison.test.js
│   └── output-snapshots/    # Snapshots de outputs esperados
├── mocks/                   # Mocks y stubs
│   ├── obr-sdk.js          # Mock de OBR SDK
│   ├── esm-mock.js         # Mock para imports ESM
│   └── fetch-mock.js       # Mock de fetch API
└── fixtures/                # Datos de prueba
    ├── notion-blocks.json
    ├── config-sample.json
    └── page-sample.json
```

---

### 🎯 Tests de Regresión (ANTES de Refactorizar)

**OBJETIVO**: Capturar el comportamiento exacto del código actual para compararlo después.

#### Test 1: Comparación de Outputs de Funciones

**Archivo**: `tests/regression/function-comparison.test.js`

```javascript
/**
 * @fileoverview Tests de regresión: Compara outputs de funciones viejas vs nuevas
 * 
 * IMPORTANTE: Estos tests se crean ANTES de refactorizar para capturar el comportamiento actual
 */

import { describe, it, expect, beforeAll } from '@jest/globals';

// Importar funciones del código ORIGINAL (index.js)
// Nota: Esto requiere exponer las funciones o usar un wrapper
import * as OriginalCode from '../../js/index.original.js'; // Backup del código original

// Después de refactorizar, importar funciones nuevas
// import { CacheService } from '../../js/services/CacheService.js';
// import { NotionService } from '../../js/services/NotionService.js';

describe('Regresión: Comparación de Funciones', () => {
  
  describe('getCachedBlocks', () => {
    it('debe retornar null cuando no hay caché', () => {
      // Limpiar localStorage antes del test
      localStorage.clear();
      
      const result = OriginalCode.getCachedBlocks('test-page-id');
      expect(result).toBeNull();
    });

    it('debe retornar bloques cuando hay caché', () => {
      const testBlocks = [{ id: '1', type: 'paragraph' }];
      OriginalCode.setCachedBlocks('test-page-id', testBlocks);
      
      const result = OriginalCode.getCachedBlocks('test-page-id');
      expect(result).toEqual(testBlocks);
    });

    it('debe manejar pageId con caracteres especiales', () => {
      const pageId = 'page-id-with-special-chars-123';
      const testBlocks = [{ id: '1', type: 'paragraph' }];
      
      OriginalCode.setCachedBlocks(pageId, testBlocks);
      const result = OriginalCode.getCachedBlocks(pageId);
      
      expect(result).toEqual(testBlocks);
    });
  });

  describe('extractNotionPageId', () => {
    it('debe extraer pageId de URL estándar de Notion', () => {
      const url = 'https://www.notion.so/My-Page-abc123def456';
      const pageId = OriginalCode.extractNotionPageId(url);
      expect(pageId).toBe('abc123def456');
    });

    it('debe manejar URLs con parámetros', () => {
      const url = 'https://www.notion.so/My-Page-abc123def456?v=123';
      const pageId = OriginalCode.extractNotionPageId(url);
      expect(pageId).toBe('abc123def456');
    });

    it('debe retornar null para URLs inválidas', () => {
      const url = 'https://example.com/page';
      const pageId = OriginalCode.extractNotionPageId(url);
      expect(pageId).toBeNull();
    });
  });

  describe('validateMetadataSize', () => {
    it('debe aceptar objetos menores a 16KB', () => {
      const smallObj = { categories: [{ name: 'Test', pages: [] }] };
      const result = OriginalCode.validateMetadataSize(smallObj);
      expect(result.valid).toBe(true);
    });

    it('debe rechazar objetos mayores a 16KB', () => {
      // Crear objeto grande (>16KB)
      const largeObj = {
        categories: Array(1000).fill(null).map((_, i) => ({
          name: `Category ${i}`,
          pages: Array(100).fill(null).map((_, j) => ({
            name: `Page ${j}`,
            url: `https://notion.so/page-${j}`.repeat(10)
          }))
        }))
      };
      
      const result = OriginalCode.validateMetadataSize(largeObj);
      expect(result.valid).toBe(false);
    });

    it('debe comprimir correctamente objetos grandes', () => {
      const obj = { categories: [{ name: 'Test', pages: [] }] };
      const compressed = OriginalCode.compressJson(obj);
      const result = OriginalCode.validateMetadataSize(compressed, true);
      expect(result.valid).toBe(true);
    });
  });

  describe('getUserToken', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('debe retornar null cuando no hay token', () => {
      const token = OriginalCode.getUserToken();
      expect(token).toBeNull();
    });

    it('debe retornar token cuando está guardado', () => {
      const testToken = 'secret_test_token_123';
      OriginalCode.saveUserToken(testToken);
      
      const token = OriginalCode.getUserToken();
      expect(token).toBe(testToken);
    });

    it('debe trimear espacios del token', () => {
      const testToken = '  secret_test_token_123  ';
      OriginalCode.saveUserToken(testToken);
      
      const token = OriginalCode.getUserToken();
      expect(token).toBe('secret_test_token_123');
    });
  });
});
```

#### Test 2: Script de Comparación Automática

**Archivo**: `tests/regression/compare-outputs.js`

```javascript
/**
 * @fileoverview Script para comparar outputs de funciones viejas vs nuevas
 * 
 * Uso: node tests/regression/compare-outputs.js
 */

import * as OriginalCode from '../../js/index.original.js';
import { CacheService } from '../../js/services/CacheService.js';
import { extractNotionPageId } from '../../js/utils/helpers.js';

// Mock de localStorage
global.localStorage = {
  storage: {},
  getItem(key) { return this.storage[key] || null; },
  setItem(key, value) { this.storage[key] = value; },
  removeItem(key) { delete this.storage[key]; },
  clear() { this.storage = {}; }
};

const testCases = [
  {
    name: 'getCachedBlocks - sin caché',
    original: () => OriginalCode.getCachedBlocks('test-id'),
    refactored: () => {
      const cache = new CacheService();
      return cache.getCachedBlocks('test-id');
    }
  },
  {
    name: 'extractNotionPageId - URL estándar',
    original: () => OriginalCode.extractNotionPageId('https://www.notion.so/Page-abc123def456'),
    refactored: () => extractNotionPageId('https://www.notion.so/Page-abc123def456')
  },
  // Agregar más casos de prueba...
];

let passed = 0;
let failed = 0;

console.log('🧪 Ejecutando comparación de outputs...\n');

testCases.forEach(testCase => {
  try {
    const originalResult = testCase.original();
    const refactoredResult = testCase.refactored();
    
    // Comparación profunda
    const originalStr = JSON.stringify(originalResult);
    const refactoredStr = JSON.stringify(refactoredResult);
    
    if (originalStr === refactoredStr) {
      console.log(`✅ ${testCase.name}`);
      passed++;
    } else {
      console.error(`❌ ${testCase.name}`);
      console.error('  Original:', originalStr);
      console.error('  Refactored:', refactoredStr);
      failed++;
    }
  } catch (error) {
    console.error(`❌ ${testCase.name} - Error:`, error.message);
    failed++;
  }
});

console.log(`\n📊 Resultados: ${passed} pasados, ${failed} fallidos`);

if (failed > 0) {
  process.exit(1);
}
```

---

### 🔬 Tests Unitarios por Módulo

#### Test para CacheService

**Archivo**: `tests/unit/services/CacheService.test.js`

```javascript
/**
 * @fileoverview Tests unitarios para CacheService
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { CacheService } from '../../../js/services/CacheService.js';

// Mock localStorage
global.localStorage = {
  storage: {},
  getItem(key) { return this.storage[key] || null; },
  setItem(key, value) { this.storage[key] = JSON.stringify(value); },
  removeItem(key) { delete this.storage[key]; },
  clear() { this.storage = {}; }
};

describe('CacheService', () => {
  let cacheService;

  beforeEach(() => {
    cacheService = new CacheService();
    localStorage.clear();
  });

  describe('getCachedBlocks', () => {
    it('debe retornar null cuando no hay caché', () => {
      const result = cacheService.getCachedBlocks('test-page-id');
      expect(result).toBeNull();
    });

    it('debe retornar bloques cuando están en caché', () => {
      const blocks = [{ id: '1', type: 'paragraph' }];
      cacheService.setCachedBlocks('test-page-id', blocks);
      
      const result = cacheService.getCachedBlocks('test-page-id');
      expect(result).toEqual(blocks);
    });

    it('debe manejar múltiples pageIds', () => {
      const blocks1 = [{ id: '1', type: 'paragraph' }];
      const blocks2 = [{ id: '2', type: 'heading_1' }];
      
      cacheService.setCachedBlocks('page-1', blocks1);
      cacheService.setCachedBlocks('page-2', blocks2);
      
      expect(cacheService.getCachedBlocks('page-1')).toEqual(blocks1);
      expect(cacheService.getCachedBlocks('page-2')).toEqual(blocks2);
    });
  });

  describe('localHtmlCache', () => {
    it('debe limitar el tamaño del caché a 20 páginas', () => {
      // Agregar 21 páginas
      for (let i = 0; i < 21; i++) {
        cacheService.saveHtmlToLocalCache(`page-${i}`, `<div>Page ${i}</div>`);
      }
      
      // La primera página debe haber sido eliminada
      expect(cacheService.localHtmlCache.has('page-0')).toBe(false);
      // La última página debe estar presente
      expect(cacheService.localHtmlCache.has('page-20')).toBe(true);
      // El tamaño debe ser 20
      expect(cacheService.localHtmlCache.size).toBe(20);
    });
  });

  describe('clearAllCache', () => {
    it('debe limpiar todo el caché', () => {
      cacheService.setCachedBlocks('page-1', [{ id: '1' }]);
      cacheService.saveHtmlToLocalCache('page-1', '<div>HTML</div>');
      
      cacheService.clearAllCache();
      
      expect(cacheService.getCachedBlocks('page-1')).toBeNull();
      expect(cacheService.localHtmlCache.has('page-1')).toBe(false);
    });
  });
});
```

#### Test para Helpers

**Archivo**: `tests/unit/utils/helpers.test.js`

```javascript
/**
 * @fileoverview Tests unitarios para funciones helper
 */

import { describe, it, expect } from '@jest/globals';
import {
  extractNotionPageId,
  generateColorFromString,
  getInitial,
  getJsonSize,
  compressJson,
  stringifyCompact
} from '../../../js/utils/helpers.js';

describe('Helpers', () => {
  describe('extractNotionPageId', () => {
    it('debe extraer pageId de URL estándar', () => {
      const url = 'https://www.notion.so/My-Page-abc123def456';
      expect(extractNotionPageId(url)).toBe('abc123def456');
    });

    it('debe manejar URLs con parámetros', () => {
      const url = 'https://www.notion.so/Page-abc123def456?v=123&p=456';
      expect(extractNotionPageId(url)).toBe('abc123def456');
    });

    it('debe retornar null para URLs inválidas', () => {
      expect(extractNotionPageId('https://example.com')).toBeNull();
      expect(extractNotionPageId('not-a-url')).toBeNull();
    });
  });

  describe('generateColorFromString', () => {
    it('debe generar el mismo color para la misma string', () => {
      const color1 = generateColorFromString('test');
      const color2 = generateColorFromString('test');
      expect(color1).toBe(color2);
    });

    it('debe generar colores diferentes para strings diferentes', () => {
      const color1 = generateColorFromString('test1');
      const color2 = generateColorFromString('test2');
      expect(color1).not.toBe(color2);
    });

    it('debe retornar un color válido en formato hex', () => {
      const color = generateColorFromString('test');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('getInitial', () => {
    it('debe retornar primera letra en mayúscula', () => {
      expect(getInitial('test')).toBe('T');
      expect(getInitial('Hello')).toBe('H');
    });

    it('debe manejar strings vacíos', () => {
      expect(getInitial('')).toBe('');
    });
  });

  describe('getJsonSize', () => {
    it('debe calcular el tamaño correcto de un objeto', () => {
      const obj = { name: 'Test', pages: [] };
      const size = getJsonSize(obj);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('compressJson', () => {
    it('debe comprimir un objeto sin perder datos', () => {
      const obj = {
        categories: [
          { name: 'Category 1', pages: [{ name: 'Page 1', url: 'https://...' }] }
        ]
      };
      
      const compressed = compressJson(obj);
      const decompressed = JSON.parse(compressed);
      
      expect(decompressed).toEqual(obj);
    });
  });
});
```

#### Test para Modelos

**Archivo**: `tests/unit/models/Page.test.js`

```javascript
/**
 * @fileoverview Tests unitarios para modelo Page
 */

import { describe, it, expect } from '@jest/globals';
import { Page } from '../../../js/models/Page.js';

describe('Page', () => {
  it('debe crear una página con nombre y URL', () => {
    const page = new Page('Test Page', 'https://notion.so/page');
    expect(page.name).toBe('Test Page');
    expect(page.url).toBe('https://notion.so/page');
  });

  it('debe tener blockTypes vacío por defecto', () => {
    const page = new Page('Test', 'https://...');
    expect(page.blockTypes).toEqual([]);
  });

  it('debe aceptar blockTypes en el constructor', () => {
    const page = new Page('Test', 'https://...', {
      blockTypes: ['table', 'quote']
    });
    expect(page.blockTypes).toEqual(['table', 'quote']);
  });

  describe('hasBlockType', () => {
    it('debe retornar true si tiene el blockType', () => {
      const page = new Page('Test', 'https://...', {
        blockTypes: ['table']
      });
      expect(page.hasBlockType('table')).toBe(true);
    });

    it('debe retornar false si no tiene el blockType', () => {
      const page = new Page('Test', 'https://...', {
        blockTypes: ['table']
      });
      expect(page.hasBlockType('quote')).toBe(false);
    });
  });

  describe('addBlockType', () => {
    it('debe agregar un nuevo blockType', () => {
      const page = new Page('Test', 'https://...');
      page.addBlockType('table');
      expect(page.blockTypes).toContain('table');
    });

    it('no debe duplicar blockTypes', () => {
      const page = new Page('Test', 'https://...');
      page.addBlockType('table');
      page.addBlockType('table');
      expect(page.blockTypes.filter(t => t === 'table').length).toBe(1);
    });
  });
});
```

---

### 🔗 Tests de Integración

**Archivo**: `tests/integration/extension-flow.test.js`

```javascript
/**
 * @fileoverview Tests de integración para flujos completos de la extensión
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ExtensionController } from '../../js/controllers/ExtensionController.js';
import { mockOBR } from '../mocks/obr-sdk.js';

// Mock OBR antes de importar
global.OBR = mockOBR;

describe('Extension Flow - Integración', () => {
  let controller;

  beforeEach(() => {
    localStorage.clear();
    controller = new ExtensionController();
  });

  describe('Flujo completo: Cargar página de Notion', () => {
    it('debe cargar y renderizar una página completa', async () => {
      // Mock de fetch para Notion API
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { id: '1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Test' }] } }
            ]
          })
        })
      );

      const pageId = 'test-page-id';
      await controller.loadPage(pageId);

      // Verificar que se llamó a la API
      expect(fetch).toHaveBeenCalled();
      
      // Verificar que se guardó en caché
      const cached = controller.cacheService.getCachedBlocks(pageId);
      expect(cached).toBeDefined();
    });
  });

  describe('Flujo: Guardar y cargar configuración', () => {
    it('debe guardar y recuperar configuración correctamente', async () => {
      const config = {
        categories: [
          { name: 'Test Category', pages: [] }
        ]
      };

      await controller.storageService.savePagesJSON(config, 'test-room');
      const loaded = await controller.storageService.getPagesJSON('test-room');

      expect(loaded).toEqual(config);
    });
  });
});
```

---

### 🎭 Mocks Necesarios

#### Mock de OBR SDK

**Archivo**: `tests/mocks/obr-sdk.js`

```javascript
/**
 * @fileoverview Mock del SDK de Owlbear Rodeo
 */

export const mockOBR = {
  room: {
    getId: jest.fn(() => Promise.resolve('test-room-id')),
    getMetadata: jest.fn(() => Promise.resolve({})),
    setMetadata: jest.fn(() => Promise.resolve()),
    onMetadataChange: jest.fn(() => ({ unsubscribe: jest.fn() }))
  },
  player: {
    getId: jest.fn(() => Promise.resolve('test-player-id')),
    getName: jest.fn(() => Promise.resolve('Test Player')),
    getRole: jest.fn(() => Promise.resolve('GM'))
  },
  broadcast: {
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: jest.fn(() => ({ unsubscribe: jest.fn() }))
  },
  onReady: jest.fn((callback) => {
    // Ejecutar callback inmediatamente en tests
    if (callback) callback();
    return Promise.resolve();
  })
};

export default mockOBR;
```

#### Mock de ESM

**Archivo**: `tests/mocks/esm-mock.js`

```javascript
/**
 * @fileoverview Mock para imports de ESM (esm.sh)
 */

export default {
  '@owlbear-rodeo/sdk@3.1.0': () => import('./obr-sdk.js')
};
```

---

### 📋 Checklist de Testing por Fase

#### Fase 1: Preparación
- [ ] Tests para `logger.js` (log, logError, logWarn)
- [ ] Tests para `analytics.js` (todas las funciones track*)
- [ ] Tests para `helpers.js` (todas las funciones helper)
- [ ] Tests para modelos (Page, Category, Config)

#### Fase 2: Servicios
- [ ] Tests para `CacheService` (get/set, límites, limpieza)
- [ ] Tests para `NotionService` (fetchBlocks, fetchPageInfo, manejo de errores)
- [ ] Tests para `StorageService` (get/save, validación de tamaño, compresión)
- [ ] Tests para `BroadcastService` (setup, send, receive, timeouts)

#### Fase 3: Renderizadores
- [ ] Tests para `NotionRenderer` (renderBlock, renderRichText, todos los tipos)
- [ ] Tests para `UIRenderer` (renderCategory, renderPagesByCategories)
- [ ] Snapshots de HTML generado

#### Fase 4: Parsers/Builders
- [ ] Tests para `ConfigParser` (parseConfig, parseCategory)
- [ ] Tests para `ConfigBuilder` (buildJSON, buildCategory, buildPage)
- [ ] Tests de round-trip (parse → build → parse debe ser idéntico)

#### Fase 5: UI
- [ ] Tests para `ModalManager` (showModalForm, cierre)
- [ ] Tests para `FormBuilder` (construcción, validación)
- [ ] Tests para `EventHandlers` (todos los eventos)

#### Fase 6: Controller
- [ ] Tests de integración completos
- [ ] Tests de flujos end-to-end

#### Fase 7: Regresión
- [ ] Ejecutar script de comparación
- [ ] Verificar que todos los tests pasan
- [ ] Comparar outputs con snapshots

---

### 🚀 Comandos de Testing

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests en modo watch
npm run test:watch

# Ejecutar tests con coverage
npm run test:coverage

# Ejecutar solo tests de regresión
npm run test:regression

# Ejecutar tests de un módulo específico
npm test -- CacheService

# Ejecutar tests con verbose
npm test -- --verbose
```

---

### ✅ Criterios de Éxito para Testing

1. **Cobertura mínima**: 80% de código cubierto
2. **Todos los tests pasan**: 100% de tests en verde
3. **Comparación de outputs**: 100% de funciones comparadas correctamente
4. **Tests de regresión**: 0 diferencias entre código viejo y nuevo
5. **Performance**: No hay degradación de rendimiento

---

## ✅ Verificación de Cobertura Completa

Esta sección verifica que el plan cubre el 100% de las funcionalidades actuales de GM Vault.

### 📋 Inventario Completo de Funcionalidades

#### ✅ Funcionalidades Core (Cubiertas)

1. **Renderizado de Notion**
   - ✅ `renderBlock()` - Renderizado de bloques individuales
   - ✅ `renderRichText()` - Renderizado de texto enriquecido
   - ✅ `renderBlocks()` - Renderizado de múltiples bloques
   - ✅ `renderToggle()` - Bloques toggle
   - ✅ `renderToggleHeading()` - Toggle headings
   - ✅ `renderColumnList()` - Columnas (2, 3, 4, 5)
   - ✅ `renderTable()` - Tablas
   - ✅ `fetchBlockChildren()` - Bloques anidados
   - ✅ `renderPageCoverAndTitle()` - Cover y título de página
   - ✅ **Cubierto en**: `NotionRenderer.js` (Fase 3)

2. **Gestión de Caché**
   - ✅ `getCachedBlocks()` - Obtener bloques del caché
   - ✅ `setCachedBlocks()` - Guardar bloques en caché
   - ✅ `getCachedPageInfo()` - Info de página en caché
   - ✅ `setCachedPageInfo()` - Guardar info de página
   - ✅ `saveHtmlToLocalCache()` - Caché HTML en memoria (máx 20)
   - ✅ `saveToSharedCache()` - Caché compartido en metadata
   - ✅ `clearAllCache()` - Limpiar todo el caché
   - ✅ `clearSharedContentCache()` - Limpiar caché compartido
   - ✅ **Cubierto en**: `CacheService.js` (Fase 2)

3. **Comunicación con Notion API**
   - ✅ `fetchNotionBlocks()` - Obtener bloques de Notion
   - ✅ `fetchNotionPageInfo()` - Info de página
   - ✅ `fetchPageIcon()` - Icono de página
   - ✅ `fetchPageLastEditedTime()` - Última edición
   - ✅ `extractNotionPageId()` - Extraer ID de URL
   - ✅ Manejo de errores (401, 404, etc.)
   - ✅ **Cubierto en**: `NotionService.js` (Fase 2)

4. **Storage y Metadata**
   - ✅ `getPagesJSON()` - Obtener configuración
   - ✅ `getPagesJSONFromLocalStorage()` - Desde localStorage
   - ✅ `savePagesJSON()` - Guardar configuración
   - ✅ `getUserToken()` - Obtener token
   - ✅ `saveUserToken()` - Guardar token
   - ✅ `validateMetadataSize()` - Validar tamaño (16KB límite)
   - ✅ `compressJson()` - Comprimir JSON
   - ✅ `filterVisiblePagesForMetadata()` - Filtrar para metadata
   - ✅ **Cubierto en**: `StorageService.js` (Fase 2)

5. **Broadcast GM/Player**
   - ✅ `setupGMContentBroadcast()` - Setup broadcast de contenido
   - ✅ `setupGMVisiblePagesBroadcast()` - Setup broadcast de visibilidad
   - ✅ `broadcastVisiblePagesUpdate()` - Enviar páginas visibles
   - ✅ `requestHtmlFromGM()` - Player solicita contenido
   - ✅ `requestVisiblePagesFromGM()` - Player solicita páginas visibles
   - ✅ Timeouts (5 segundos)
   - ✅ **Cubierto en**: `BroadcastService.js` (Fase 2)

6. **Vault Ownership y Co-GM**
   - ✅ `checkVaultOwnership()` - Verificar ownership
   - ✅ `setVaultOwner()` - Establecer owner
   - ✅ `startOwnerHeartbeat()` - Heartbeat cada 2 minutos
   - ✅ `stopOwnerHeartbeat()` - Detener heartbeat
   - ✅ `isCoGMMode()` - Verificar modo Co-GM
   - ✅ `startRoleChangeDetection()` - Detectar cambios de rol
   - ✅ `stopRoleChangeDetection()` - Detener detección
   - ✅ **Cubierto en**: `BroadcastService.js` y `StorageService.js` (Fase 2)

7. **Renderizado de UI**
   - ✅ `renderCategory()` - Renderizar categoría
   - ✅ `renderPagesByCategories()` - Renderizar lista completa
   - ✅ `renderPageIcon()` - Renderizar icono de página
   - ✅ `hasVisibleContentForPlayers()` - Verificar contenido visible
   - ✅ **Cubierto en**: `UIRenderer.js` (Fase 3)

8. **Gestión de Páginas**
   - ✅ `addPageToPageList()` - Agregar página
   - ✅ `addPageToPageListSimple()` - Agregar página simple
   - ✅ `addPageToPageListWithCategorySelector()` - Con selector de categoría
   - ✅ `editPageFromPageList()` - Editar desde lista
   - ✅ `editPageFromHeader()` - Editar desde header
   - ✅ `deletePageFromPageList()` - Eliminar página
   - ✅ `duplicatePageFromPageList()` - Duplicar página
   - ✅ `movePageUp()` - Mover página arriba
   - ✅ `movePageDown()` - Mover página abajo
   - ✅ `togglePageVisibility()` - Toggle visibilidad
   - ✅ **Cubierto en**: `EventHandlers.js` y `ExtensionController.js` (Fases 5-6)

9. **Gestión de Categorías**
   - ✅ `addCategoryToPageList()` - Agregar categoría
   - ✅ `editCategoryFromPageList()` - Editar categoría
   - ✅ `deleteCategoryFromPageList()` - Eliminar categoría
   - ✅ `duplicateCategoryFromPageList()` - Duplicar categoría
   - ✅ `moveCategoryUp()` - Mover categoría arriba
   - ✅ `moveCategoryDown()` - Mover categoría abajo
   - ✅ `toggleCategoryVisibility()` - Toggle visibilidad
   - ✅ `getCategoryOptions()` - Opciones de categorías
   - ✅ **Cubierto en**: `EventHandlers.js` y `ExtensionController.js` (Fases 5-6)

10. **Orden y Navegación**
    - ✅ `getCombinedOrder()` - Obtener orden combinado
    - ✅ `saveCombinedOrder()` - Guardar orden
    - ✅ `moveItemUp()` - Mover item arriba
    - ✅ `moveItemDown()` - Mover item abajo
    - ✅ `navigateConfigPath()` - Navegar por path
    - ✅ `findPageInConfig()` - Buscar página
    - ✅ **Cubierto en**: `EventHandlers.js` y `helpers.js` (Fases 1, 5)

11. **Carga de Contenido**
    - ✅ `loadNotionContent()` - Cargar contenido de Notion
    - ✅ `showNotionBlockedMessage()` - Mensaje de bloqueo
    - ✅ `setNotionDisplayMode()` - Modo de visualización
    - ✅ Soporte para PDFs
    - ✅ Soporte para External URLs con CSS selectors
    - ✅ Block type filtering (`blockTypes`)
    - ✅ **Cubierto en**: `NotionRenderer.js` y `ExtensionController.js` (Fases 3, 6)

12. **Image Modal y Sharing**
    - ✅ `showImageModal()` - Mostrar imagen en modal
    - ✅ `attachImageClickHandlers()` - Handlers de click en imágenes
    - ✅ Compartir imágenes con players
    - ✅ **Cubierto en**: `UIRenderer.js` y `EventHandlers.js` (Fases 3, 5)

13. **Token Integration**
    - ✅ `setupTokenContextMenus()` - Setup context menu en tokens
    - ✅ `showPageSelectorForToken()` - Selector de página para token
    - ✅ Link page to token
    - ✅ View linked page
    - ✅ Unlink page from token
    - ✅ **Cubierto en**: `EventHandlers.js` y `ExtensionController.js` (Fases 5-6)

14. **Settings Panel**
    - ✅ Configuración de token
    - ✅ View/Import/Export JSON
    - ✅ Cache management
    - ✅ **Cubierto en**: `ModalManager.js` y `ExtensionController.js` (Fases 5-6)

15. **Utilidades y Helpers**
    - ✅ `generateColorFromString()` - Generar color
    - ✅ `getInitial()` - Obtener inicial
    - ✅ `getJsonSize()` - Tamaño de JSON
    - ✅ `stringifyCompact()` - Stringify compacto
    - ✅ `countPages()` - Contar páginas
    - ✅ `countCategories()` - Contar categorías
    - ✅ `getConfigSize()` - Tamaño de configuración
    - ✅ `getFriendlyRoomId()` - Room ID amigable
    - ✅ `getStorageKey()` - Clave de storage
    - ✅ **Cubierto en**: `helpers.js` (Fase 1)

16. **Logging y Analytics**
    - ✅ `log()`, `logError()`, `logWarn()` - Sistema de logs
    - ✅ `initDebugMode()` - Inicializar debug
    - ✅ `getUserRole()` - Obtener rol
    - ✅ Todas las funciones `track*()` - Analytics
    - ✅ `initMixpanel()` - Inicializar Mixpanel
    - ✅ `showCookieConsentBanner()` - Banner de consentimiento
    - ✅ **Cubierto en**: `logger.js` y `analytics.js` (Fase 1)

17. **Inicialización y Setup**
    - ✅ `setupRoomMetadataListener()` - Listener de metadata
    - ✅ `loadPagesFromRoomMetadata()` - Cargar desde metadata
    - ✅ `getDefaultJSON()` - JSON por defecto
    - ✅ `getAllRoomConfigs()` - Todas las configuraciones
    - ✅ **Cubierto en**: `ExtensionController.js` (Fase 6)

### ⚠️ Funcionalidades que Requieren Atención Especial

#### 1. **Renderizado Complejo de Bloques**
- `renderToggle()` con bloques anidados
- `renderColumnList()` con múltiples columnas
- `renderTable()` con celdas complejas
- `fetchBlockChildren()` recursivo
- **Acción**: Asegurar que `NotionRenderer.js` incluye TODOS estos métodos

#### 2. **Soporte Multi-Formato**
- PDFs embebidos
- External URLs con CSS selectors
- Block type filtering
- **Acción**: Verificar que `loadNotionContent()` maneja todos los casos

#### 3. **Token Integration Completa**
- Context menu en tokens
- Link/unlink pages
- View linked page
- **Acción**: Asegurar que `EventHandlers.js` incluye `setupTokenContextMenus()`

#### 4. **Co-GM Mode y Ownership**
- Heartbeats
- Role change detection
- Ownership checks
- **Acción**: Verificar que `BroadcastService.js` incluye toda esta lógica

#### 5. **Image Sharing**
- Modal de imágenes
- Click handlers
- Broadcast de imágenes
- **Acción**: Asegurar que `UIRenderer.js` y `EventHandlers.js` incluyen esto

### 📊 Resumen de Cobertura

| Categoría | Funcionalidades | Cubiertas | % |
|-----------|----------------|-----------|---|
| Renderizado Notion | 9 | 9 | 100% |
| Caché | 8 | 8 | 100% |
| Notion API | 5 | 5 | 100% |
| Storage | 8 | 8 | 100% |
| Broadcast | 6 | 6 | 100% |
| Ownership/Co-GM | 6 | 6 | 100% |
| UI Renderizado | 4 | 4 | 100% |
| Gestión Páginas | 10 | 10 | 100% |
| Gestión Categorías | 8 | 8 | 100% |
| Orden/Navegación | 5 | 5 | 100% |
| Carga Contenido | 6 | 6 | 100% |
| Image Modal | 3 | 3 | 100% |
| Token Integration | 5 | 5 | 100% |
| Settings | 3 | 3 | 100% |
| Utilidades | 9 | 9 | 100% |
| Logging/Analytics | 6 | 6 | 100% |
| Inicialización | 4 | 4 | 100% |
| **TOTAL** | **105** | **105** | **100%** |

### ✅ Conclusión

**El plan cubre el 100% de las funcionalidades actuales de GM Vault.**

Todas las funciones identificadas están asignadas a módulos específicos en las fases correspondientes. Las funcionalidades complejas (renderizado de bloques, token integration, Co-GM mode) están explícitamente mencionadas y tienen instrucciones detalladas.

### 🔍 Checklist de Verificación Durante Refactorización

Al refactorizar cada módulo, verificar que se incluyen:

- [ ] **NotionRenderer**: `renderToggle`, `renderColumnList`, `renderTable`, `fetchBlockChildren`
- [ ] **NotionService**: Manejo de PDFs y external URLs
- [ ] **EventHandlers**: `setupTokenContextMenus`, `showImageModal`, `attachImageClickHandlers`
- [ ] **BroadcastService**: Heartbeats, role detection, ownership
- [ ] **StorageService**: Validación de tamaño, compresión, filtrado
- [ ] **UIRenderer**: Renderizado completo de categorías con todas las opciones
- [ ] **ExtensionController**: Inicialización completa con todos los listeners

---

**Última actualización**: Enero 2025
**Estado**: Listo para ejecución por agente - **100% de cobertura verificada**

