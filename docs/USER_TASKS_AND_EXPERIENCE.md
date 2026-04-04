# Tareas de Usuario y Experiencia Esperada

Este documento define **exactamente** qué puede hacer cada usuario, cómo y dónde, para cada funcionalidad prioritaria.

**Principios de diseño**:
- **No interrumpir el flujo**: El GM está en medio de una partida, no puede perder tiempo
- **Solo mostrar lo que está en el vault**: No agregar complejidad innecesaria
- **Navegación clara**: Siempre saber dónde estás y cómo volver
- **Transparente para el usuario**: Las cosas "simplemente funcionan"

**Principios de Usabilidad (Nielsen)**:
1. **Visibilidad del estado**: Siempre mostrar dónde estás (breadcrumbs) y qué está pasando (loading states)
2. **Correspondencia con el mundo real**: Usar términos familiares (Home, páginas, vault)
3. **Control y libertad**: Múltiples formas de cerrar/volver (X, Escape, clic fuera, breadcrumbs)
4. **Consistencia**: Mismo comportamiento para mentions y páginas de DB
5. **Prevención de errores**: Páginas no disponibles no son clickeables, con feedback claro
6. **Reconocimiento vs recuerdo**: Breadcrumbs, cards visuales, no requiere recordar
7. **Flexibilidad**: Atajos de teclado para usuarios expertos
8. **Diseño minimalista**: Solo información relevante, sin ruido
9. **Mensajes de error claros**: Feedback inmediato y comprensible
10. **Ayuda contextual**: Tooltips donde sea necesario

---

## Fase 1: Enlaces Internos (Mentions @Page)

### Tareas de Usuario - GM

#### Tarea 1.1: Ver enlaces internos en el contenido
**Qué**: Al abrir una página de Notion que contiene mentions `@Page Name`, el GM ve esos enlaces destacados visualmente

**Cómo**:
- Los mentions aparecen con estilo visual distintivo (fondo gris claro, borde redondeado)
- Se ven como enlaces clickeables (cursor pointer, hover effect)
- El texto es el nombre de la página mencionada sin la arroba

**Dónde**:
- Dentro del contenido renderizado de la página de Notion
- En cualquier bloque que contenga rich_text (paragraphs, headings, callouts, quotes, etc.)

**Ejemplo visual**:
```
Este es un párrafo que menciona a Gandalf el Mago y también a Aragorn.
```

Donde `Gandalf el Mago` y `Aragorn` son enlaces clickeables con estilo distintivo.

---

#### Tarea 1.2: Hacer clic en un enlace interno (PÁGINA EN VAULT)
**Qué**: El GM hace clic en un mention de una página que **YA está en el vault**.

**Cómo**:
- **Feedback inmediato**: Al hacer clic, el mention muestra estado "loading" (spinner pequeño o cambio de color)
- Se muestra un **overlay/popup** con z-index alto que muestra la página enlazada **sobre la página en la que se encuentra el usuario**
- El overlay tiene:
  - Header con título de la página
  - Botón de cerrar (X) en la esquina superior derecha
  - Contenido scrollable de la página
  - Estado de carga visible mientras se carga
  - **IMPORTANTE**: Los mentions dentro del contenido del overlay NO son clickeables (texto normal, evita navegación infinita)

**Dónde**:
- El overlay aparece sobre el contenido actual de la extensión
- No bloquea completamente la vista (puede cerrarse fácilmente)
- Tamaño: ~80% del ancho/alto de la extensión, centrado

**Flujo**:
1. GM está viendo "Session Notes" en la extensión
2. Ve mention `Gandalf` (que está en el vault)
3. Hace clic en `Gandalf`
4. **Feedback inmediato**: Mention muestra estado "loading" (<100ms)
5. Overlay aparece con spinner "Loading..." (<500ms)
6. Overlay muestra contenido de "Gandalf" (<1s si está en caché)
7. Puede leer la info rápidamente
8. Hace clic en X, Escape, o fuera del overlay → vuelve a "Session Notes"

**Resultado**: Acceso rápido a información sin perder el contexto de dónde estaba. Siempre sabes qué está pasando.

---

#### Tarea 1.3: Ver/Hacer clic en enlace interno (PÁGINA NO EN VAULT)
**Qué**: Este caso **NO debería darse** en el flujo normal, ya que todas las páginas mencionadas deberían estar en el vault.

**Nota**: Si por alguna razón se detecta un mention de una página que no está en el vault:
- El mention aparece como **texto normal** (sin estilo de enlace)
- No es clickeable
- No hay tooltip ni feedback especial
- Se trata como texto plano del contenido

**Razón**: 
- El workflow esperado es que todas las páginas relevantes estén en el vault
- No agregar complejidad para un caso edge que no debería ocurrir
- Si ocurre, simplemente se ignora (texto normal)

---


### Tareas de Usuario - Player

#### Tarea 1.5: Ver enlaces internos (solo páginas visibles)
**Qué**: Los players ven los mentions, pero **solo los de páginas visibles** tienen estilo clickeable.

**Cómo**:
- Si la página mencionada tiene `visibleToPlayers: true`:
  - El mention aparece con estilo clickeable (igual que para GM)
  - Al hacer clic, se abre modal igual que para GM
  - **IMPORTANTE**: Si la página tiene mentions dentro, NO son clickeables (texto normal)
- Si la página mencionada **NO tiene** `visibleToPlayers: true`:
  - El mention **NO aparece visualmente diferente** (texto normal, sin estilo)
  - No es clickeable
  - No hay tooltip ni mensaje

**Dónde**:
- Dentro del contenido renderizado
- Los mentions no visibles se ven como texto normal

**Razón**: Los players no deben saber que existe una página que no pueden ver. Es información que no les concierne.

**Ejemplo**:
```
Este es un párrafo que menciona a Gandalf el Mago y también a Aragorn.
```

Si "Gandalf" es visible pero "Aragorn" no:
- `Gandalf el Mago` → enlace clickeable (estilo distintivo)
- `Aragorn` → texto normal (sin estilo, no clickeable)

---

## Fase 2: Bases de Datos con Páginas Linkadas

### Tareas de Usuario - GM

#### Tarea 2.1: Ver base de datos como carpeta
**Qué**: Cuando una página de Notion contiene un bloque `child_database`, el GM ve una **carpeta** con las páginas de esa base de datos que están en el vault.

**Cómo**:
- **NO se muestra dentro del contenido de la página**
- Se crea/actualiza una **carpeta** en el vault con el nombre de la base de datos
- Dentro de esa carpeta, se muestran **solo las páginas que están en el vault** y pertenecen a esa DB
- La carpeta aparece en la lista de carpetas del vault (como cualquier otra carpeta)
- Puede expandirse/colapsarse como cualquier carpeta
- Las páginas dentro se muestran como páginas normales del vault

**Dónde**:
- En la lista de carpetas del vault (nivel raíz, no dentro del contenido de Notion)
- Se comporta exactamente igual que cualquier otra carpeta

**Lógica de matching**:
- Se busca en el vault todas las páginas cuyo `pageId` de Notion coincida con alguna página de la base de datos
- Si una página de la DB está en el vault → aparece en la carpeta
- Si una página de la DB NO está en el vault → no aparece en la carpeta
- **IMPORTANTE**: La carpeta **solo se crea si hay al menos una página en el vault** que pertenezca a esa DB
- La carpeta se crea en el **nivel raíz** del vault (mismo nivel que otras carpetas principales)
- La carpeta se actualiza automáticamente cuando se detecta un `child_database` y hay páginas matching

**Ejemplo**:
- Base de datos "NPC Database" tiene 50 páginas en Notion
- En el vault hay 3 páginas que pertenecen a esa DB: "Gandalf", "Aragorn", "Legolas"
- Se crea carpeta "NPC Database" en el nivel raíz del vault
- Dentro de esa carpeta aparecen las 3 páginas: "Gandalf", "Aragorn", "Legolas"
- El GM puede hacer clic en cualquier página como siempre

**Razón**: 
- Mantiene la consistencia: solo hay carpetas, páginas y modales
- No agrega nuevos patrones de UI
- El GM puede organizar y acceder a las páginas como siempre lo hace
- Solo se crea si hay contenido relevante (no carpetas vacías innecesarias)

---

#### Tarea 2.2: Hacer clic en página de base de datos
**Qué**: El GM hace clic en una página dentro de la carpeta de la base de datos.

**Cómo**:
- **Mismo comportamiento que cualquier página del vault**: Se abre normalmente
- No hay diferencia con otras páginas
- Las páginas dentro de la carpeta se comportan exactamente igual que páginas en otras carpetas

**Dónde**:
- En la lista de páginas dentro de la carpeta (como cualquier otra carpeta)
- Se abre igual que cualquier otra página del vault

**Flujo**:
1. GM ve carpeta "NPC Database" en el vault
2. Expande la carpeta
3. Ve 3 páginas: "Gandalf", "Aragorn", "Legolas"
4. Clic en "Gandalf"
5. Se abre la página "Gandalf" normalmente (igual que cualquier otra página)

**Resultado**: Experiencia completamente unificada. No hay diferencia entre páginas de una base de datos y páginas normales.

---

#### Tarea 2.3: Base de datos sin páginas en vault
**Qué**: Si una base de datos no tiene ninguna página en el vault, **NO se crea la carpeta**.

**Cómo**:
- **NO se crea ninguna carpeta** si no hay páginas matching en el vault
- El bloque `child_database` en el contenido de Notion simplemente no genera ninguna acción
- Si más adelante el GM agrega páginas de esa DB al vault, entonces se crea la carpeta automáticamente

**Dónde**:
- No aparece nada en el vault (no hay carpeta)

**Razón**: 
- No crear carpetas vacías innecesarias
- Solo mostrar lo que tiene contenido relevante
- La carpeta aparecerá automáticamente cuando haya páginas matching

---

### Tareas de Usuario - Player

#### Tarea 2.4: Ver base de datos (solo si hay páginas visibles)
**Qué**: Los players ven la carpeta de la base de datos **solo si al menos una página dentro tiene `visibleToPlayers: true`**.

**Cómo**:
- **La carpeta solo aparece si hay al menos una página visible**
- Si ninguna página tiene `visibleToPlayers: true`, la carpeta **NO aparece** para players
- Si hay páginas visibles, la carpeta aparece igual que para GM
- Solo se muestran las páginas que tienen `visibleToPlayers: true`
- Las páginas no visibles no aparecen en la lista

**Dónde**:
- En la lista de carpetas del vault (solo si hay páginas visibles)

**Restricciones**:
- Players solo ven la carpeta si tiene contenido visible
- Players solo ven páginas visibles dentro de la carpeta
- Al hacer clic en una página, se abre normalmente (igual que cualquier otra página)

**Razón**: 
- Los players no deben saber que existe una carpeta si no pueden ver su contenido
- Mantiene la privacidad: no revela información sobre estructura del vault

---

## Fase 3: Synced Blocks

### Tareas de Usuario - GM y Player

#### Tarea 3.1: Ver bloque sincronizado (transparente)
**Qué**: Los bloques sincronizados se renderizan exactamente igual que cualquier otro bloque.

**Cómo**:
- El bloque se renderiza normalmente con su contenido
- **NO hay diferencia** con cualquier otro bloque (paragraph, callout, etc.)
- **NO hay indicador visual** de que es un bloque sincronizado
- **NO hay diferencia** entre bloque original y copia
- El usuario simplemente ve el contenido dentro de la página del vault

**Dónde**:
- En el lugar donde está el bloque `synced_block` en la página
- Se renderiza igual que cualquier otro bloque (paragraph, heading, callout, etc.)

**Razón**: 
- Es completamente transparente para el usuario
- No necesita saber que es un bloque sincronizado
- Solo ve el contenido dentro de su página del vault
- Funciona igual que cualquier otro contenido de Notion

**Implementación técnica**:
- Si es original → cargar hijos directamente y renderizar
- Si es copia → cargar hijos del original y renderizar
- Para el usuario: no hay diferencia, es contenido normal de la página

---

## Flujos de Usuario Completos

### Flujo 1: Navegación con Mentions (GM)

1. GM abre "Session Notes" desde el vault
2. Ve contenido con mentions: `Gandalf`, `Aragorn`, `Rivendell` (todos en el vault)
3. Hace clic en `Gandalf`
4. Aparece modal mostrando "Gandalf" (X en la esquina superior derecha)
5. **IMPORTANTE**: Si "Gandalf" tiene mentions dentro (ej: `Rivendell`), esos mentions NO son clickeables (texto normal)
6. GM lee la información de "Gandalf"
7. Hace clic en X o Escape → cierra modal, vuelve a "Session Notes"
8. Puede hacer clic en otro mention `Aragorn` si lo necesita
9. Se abre modal con "Aragorn"
10. Cierra modal → vuelve a "Session Notes"

**Resultado esperado**: Acceso rápido a información sin navegación infinita. Solo un nivel de profundidad.

---

### Flujo 2: Base de Datos de NPCs (GM)

1. GM tiene una página de Notion que contiene bloque `child_database` "NPC Database"
2. La DB tiene 50 páginas en Notion, pero solo 3 están en el vault: "Gandalf", "Aragorn", "Legolas"
3. **Automáticamente** se crea/actualiza carpeta "NPC Database" en el vault
4. GM ve la carpeta "NPC Database" en su lista de carpetas
5. Expande la carpeta
6. Ve 3 páginas: "Gandalf", "Aragorn", "Legolas"
7. Hace clic en "Gandalf"
8. Se abre la página "Gandalf" normalmente (igual que cualquier otra página del vault)
9. Lee la información
10. Cierra la página o vuelve al vault
11. Puede hacer clic en "Aragorn" desde la carpeta
12. Se abre la página "Aragorn" normalmente

**Resultado esperado**: Las páginas de la base de datos aparecen como una carpeta normal. Acceso igual que cualquier otra página del vault.

---

### Flujo 3: Mention de página no en vault (GM) - Caso Edge

1. GM abre "Session Notes"
2. Ve mention `Nuevo NPC` que NO está en el vault (caso edge, no debería ocurrir)
3. El mention aparece como **texto normal** (sin estilo de enlace, no clickeable)
4. GM puede seguir leyendo sin interrupciones
5. El mention se trata como texto plano del contenido

**Resultado esperado**: Caso edge manejado gracefully. No interrumpe el flujo. En el workflow normal, todas las páginas mencionadas deberían estar en el vault.

---

### Flujo 4: Player viendo contenido compartido

1. GM abre "Session Notes" y marca como visible para players
2. Player ve "Session Notes" en su lista
3. Player abre "Session Notes"
4. Ve mentions `Gandalf` (visible) y `Aragorn` (no visible)
5. `Gandalf` aparece como enlace clickeable
6. `Aragorn` aparece como texto normal (sin estilo, no clickeable)
7. Player hace clic en `Gandalf`
8. Se abre modal con página "Gandalf" (X en esquina superior derecha)
9. **IMPORTANTE**: Si "Gandalf" tiene mentions dentro, NO son clickeables (texto normal)
10. Player ve carpeta "NPC Database" en el vault
11. Solo ve páginas de NPCs marcados como visibles dentro de la carpeta
12. Puede hacer clic en esas páginas y verlas normalmente

**Resultado esperado**: Players solo ven lo que el GM quiere que vean, sin saber que existe otra información. Navegación limitada a un nivel.

---

## Estados y Mensajes

### Estados de Carga

**Cargando página desde mention**:
```
Empty state style:
- Icono: ⏳
- Título: "Loading page..."
- Texto obligatorio: "Please wait while we load the content"
- Texto opcional: "[Page name]"
```

**Cargando base de datos** (matching de páginas):
```
(Transparente - se procesa en background)
No se muestra loading state, la carpeta se actualiza automáticamente
```

---

### Mensajes Informativos (Nielsen #9 - Mensajes de error claros)

**Base de datos sin páginas en vault**:
```
No se crea carpeta - no aparece nada en el vault
```

**Carpeta de base de datos sin páginas visibles (Player)**:
```
La carpeta NO aparece para players si no hay páginas visibles
```

**Mention no clickeable (tooltip)**:
```
Tooltip al hover (después de 500ms): 
"This page is not in your vault. Add it manually if needed."
[Icono: ℹ️]
```

**Error cargando página**:
```
"Error loading page: [mensaje específico]"
[Icono: ⚠️]
[Acción: Botón "Retry" o "Open in Notion"]
```

**Página no encontrada**:
```
"Page not found in vault"
[Icono: ❌]
[Acción sugerida: "This page may have been removed"]
```

**Principios aplicados**:
- **Lenguaje claro**: Sin jerga técnica
- **Explicación**: Por qué pasó el problema
- **Solución**: Qué puede hacer el usuario
- **Tono positivo**: No culpar al usuario

---

## Consideraciones de UX

### Modal (para enlaces internos)

**Diseño** (Nielsen #8 - Minimalista):
- **Mismo estilo que modales de edición existentes** (consistencia)
- Z-index: Alto (por encima de todo)
- Tamaño: Similar a modales de edición (ancho fijo, altura adaptativa)
- Posición: Centrado
- Fondo: Semi-transparente detrás (backdrop blur opcional, ~0.4 opacity)
- Header: Título de la página + botón X en la esquina superior derecha (siempre visible)
- Contenido: Scrollable
- **Animación de entrada**: Fade in + slide up (200ms) para feedback visual
- **IMPORTANTE**: Los mentions dentro del contenido del modal NO son clickeables (texto normal)

**Comportamiento** (Nielsen #3 - Control y libertad):
- **Múltiples formas de cerrar**:
  - Clic fuera del modal → cierra
  - Clic en X (esquina superior derecha) → cierra
  - Escape key → cierra
- **Focus trap** (Nielsen #1 - Visibilidad del estado):
  - Al abrir: Focus en el modal (primer elemento interactivo)
  - Tab: No sale del modal
  - Shift+Tab: Navegación circular dentro del modal
- **Estado de carga** (Nielsen #1):
  - **Empty state style**: Icono + Título + Texto obligatorio + Texto opcional
  - Ejemplo loading:
    - Icono: ⏳
    - Título: "Loading page..."
    - Texto obligatorio: "Please wait while we load the content"
    - Texto opcional: "[Page name]"


### Performance

- **Modal**: Abrir <500ms
- **Cargar página en modal**: <1s si está en caché
- **Base de datos (matching)**: Procesar en background <2s (transparente)

### Accesibilidad y Atajos de Teclado

**Atajos de teclado** (Nielsen #7 - Flexibilidad y eficiencia):
- `Escape`: Cierra modal
- `Tab`: Navega entre elementos dentro del modal
- `Shift+Tab`: Navega hacia atrás
- `Enter` o `Space`: Activa elemento con focus

**Accesibilidad** (WCAG 2.1):
- Modal: Focus trap (Tab no sale del modal)
- Escape: Cierra modal (anunciado por screen readers)
- Screen readers: 
  - Anuncian "Modal opened: [page name]" al abrir
  - Anuncian estado de carga: "Loading page content"
  - Anuncian cuando mentions no son clickeables: "Link to [page name] (not available)"
- **ARIA labels**:
  - `aria-label` en botón X: "Close modal"
  - `aria-live="polite"` para cambios de contenido
  - `aria-disabled="true"` en mentions no clickeables (dentro del modal o no en vault)

---

## Resumen de Permisos

| Funcionalidad | GM | Player |
|--------------|----|----|
| Ver mentions (página en vault) | ✅ Clickeable | ✅ Clickeable (si visible) |
| Ver mentions (página NO en vault) | ⚠️ Texto normal (caso edge) | ❌ Texto normal |
| Clic en mention (página en vault) | ✅ Overlay | ✅ Overlay (si visible) |
| Ver base de datos | ✅ Carpeta (solo si hay páginas) | ✅ Carpeta (solo si hay páginas visibles) |
| Clic en página de DB | ✅ Página normal | ✅ Página normal (si visible) |
| Ver synced blocks | ✅ Transparente (igual que otros bloques) | ✅ Transparente (igual que otros bloques) |

---

## Preguntas Resueltas

1. **Historial de navegación**: ✅ NO breadcrumbs - solo modal con X para cerrar (evita navegación infinita)
2. **Límite de páginas en DB**: ✅ Solo páginas en vault (sin límite artificial)
3. **Base de datos como**: ✅ Carpeta en el vault (no dentro del contenido)
4. **Indicador de synced block**: ✅ Completamente transparente (igual que cualquier otro bloque)
5. **Mensajes de error**: ✅ Empty states con icono + título + texto obligatorio + texto opcional
6. **Navegación infinita**: ✅ Prevenida - mentions dentro del modal NO son clickeables

---

## Principios Clave

### Principios de Diseño
1. **Solo mostrar lo que está en el vault**: No agregar complejidad innecesaria
2. **Modal simple**: Mismo estilo que modales de edición, fácil de cerrar
3. **Sin navegación infinita**: Solo un nivel de profundidad (mentions en modal no son clickeables)
4. **Consistencia de UI**: Solo carpetas, páginas y modales (no nuevos patrones)
5. **Transparente**: Las cosas simplemente funcionan (synced blocks = bloques normales)
6. **No interrumpir**: El GM está en medio de una partida

### Principios de Usabilidad (Nielsen) Aplicados

1. ✅ **Visibilidad del estado del sistema**: 
   - Breadcrumbs siempre visibles
   - Estados de carga claros
   - Feedback inmediato en interacciones

2. ✅ **Correspondencia con el mundo real**: 
   - Términos familiares (Home, páginas, vault)
   - Patrones conocidos (breadcrumbs, overlay)

3. ✅ **Control y libertad del usuario**: 
   - Múltiples formas de cerrar (X, Escape, clic fuera, breadcrumbs)
   - Navegación bidireccional

4. ✅ **Consistencia y estándares**: 
   - Mismo comportamiento para mentions y páginas de DB
   - Patrones consistentes en toda la app

5. ✅ **Prevención de errores**: 
   - Páginas no disponibles no son clickeables
   - Feedback claro de por qué no funciona

6. ✅ **Reconocimiento en lugar de recuerdo**: 
   - Páginas en carpetas (patrón conocido)
   - Empty states claros con iconos
   - No requiere recordar qué está en el vault

7. ✅ **Flexibilidad y eficiencia**: 
   - Atajos de teclado para usuarios expertos (Escape, Tab)
   - Acceso rápido a información sin navegación compleja

8. ✅ **Diseño estético y minimalista**: 
   - Solo información relevante
   - Sin ruido visual innecesario

9. ✅ **Ayuda a reconocer, diagnosticar y recuperarse de errores**: 
   - Mensajes claros y comprensibles
   - Sugerencias de solución

10. ✅ **Ayuda y documentación**: 
    - Tooltips contextuales
    - Mensajes informativos claros

---

Este documento refleja la experiencia optimizada para el flujo real del GM durante una partida de D&D.
