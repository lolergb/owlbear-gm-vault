# 📚 Notion Embed para Owlbear Rodeo

Extensión simple para embebber páginas de Notion directamente en Owlbear Rodeo.

## ✨ Características

- 🎯 Abre páginas de Notion en modales dentro de Owlbear
- 📝 Gestión de páginas por categorías desde la interfaz
- 🎨 Interfaz limpia y oscura
- 💾 Caché persistente para carga rápida
- 🏠 Configuración independiente por room de Owlbear
- 🖼️ Visualización de imágenes en modal a tamaño real

---

## 👥 Para DMs (Usuarios Finales)

**¡Cada usuario usa su propia cuenta de Notion!** Solo necesitas configurar tu token una vez.

### 🚀 Instalación (Una vez)

1. **Obtén la URL de la extensión** del desarrollador
   - Ejemplo: `https://tu-proyecto.netlify.app/manifest.json`

2. **En Owlbear Rodeo:**
   - Ve a tu perfil → "Agregar Extensión"
   - Pega la URL del `manifest.json`
   - Instala

3. **Configura tu token de Notion:**
   - Abre la extensión
   - Clic en **🔑** (arriba a la derecha)
   - Sigue las instrucciones en pantalla
   - **¡Listo!** Ya puedes usar tus páginas de Notion

### 🔑 Obtener tu Token de Notion

**Paso 1: Crear la integración**
1. Ve a https://www.notion.so/my-integrations
2. Clic en **"+ Nueva integración"**
3. Dale un nombre (ej: "Owlbear Notion")
4. Selecciona tu workspace
5. Clic en **"Enviar"**

**Paso 2: Copiar el token**
1. En la página de la integración, busca **"Internal Integration Token"**
2. Clic en **"Mostrar"** y copia el token (empieza con `secret_`)

**Paso 3: Compartir tus páginas**
1. En Notion, abre cada página que quieres usar
2. Clic en **"Compartir"** (arriba a la derecha)
3. Busca el nombre de tu integración y dale acceso

**Paso 4: Configurar en la extensión**
1. En la extensión: **🔑** → Pega el token → **Guardar**
2. ¡Listo! Ya puedes usar tus páginas

### 📖 Uso Diario

1. **Abre Owlbear Rodeo** y entra a tu sala de juego
2. **Abre la extensión** desde el menú de extensiones (icono en la barra superior)
3. **Verás una lista** de páginas de Notion organizadas por categorías
4. **Haz clic en una página** para abrirla y ver su contenido
5. **Usa el botón ← Volver** para regresar a la lista

### 📝 Gestionar tus páginas

**Cada room tiene su propia configuración:**

1. Clic en el botón **⚙️** (arriba a la derecha)
2. Se abre un editor JSON donde puedes:
   - Agregar nuevas páginas
   - Crear nuevas categorías
   - Editar nombres y URLs
   - Eliminar páginas
3. Clic en **"Guardar"** para aplicar los cambios
4. Clic en **"Resetear"** si quieres volver a la configuración por defecto

**Estructura del JSON de configuración:**

```json
{
  "categories": [
    {
      "name": "Nombre de la categoría",
      "pages": [
        {
          "name": "Nombre de la página",
          "url": "URL de la página",
          "selector": "selector-opcional"
        }
      ]
    }
  ]
}
```

**Propiedades de configuración:**

#### Categorías (`categories`)
- **Tipo:** Array de objetos
- **Requerido:** Sí
- **Descripción:** Lista de categorías que agrupan las páginas

#### Categoría (`categories[].name`)
- **Tipo:** String
- **Requerido:** Sí
- **Descripción:** Nombre de la categoría (se muestra como título)

#### Páginas (`categories[].pages`)
- **Tipo:** Array de objetos
- **Requerido:** Sí
- **Descripción:** Lista de páginas dentro de la categoría

#### Página (`categories[].pages[].name`)
- **Tipo:** String
- **Requerido:** Sí
- **Descripción:** Nombre que se muestra en el botón de la página

#### Página (`categories[].pages[].url`)
- **Tipo:** String (URL)
- **Requerido:** Sí
- **Descripción:** URL completa de la página
- **Ejemplos:**
  - Notion: `https://tu-workspace.notion.site/Titulo-2d0d4856c90e80f6801dcafb6b7366e6`
  - Notion (www): `https://www.notion.so/Titulo-2d0d4856c90e80f6801dcafb6b7366e6`
  - Externa: `https://5e.tools/book.html#mm,1`

#### Página (`categories[].pages[].selector`)
- **Tipo:** String (CSS selector)
- **Requerido:** No (opcional)
- **Descripción:** Selector CSS (ID o clase) para cargar solo un elemento específico de la página
- **Cuándo usarlo:** Solo para URLs que NO son de Notion (URLs externas)
- **Ejemplos:**
  - Por ID: `"#main-content"`
  - Por clase: `".article-body"`
  - Por selector: `"div.container > section.content"`
- **Nota:** Si se omite, se carga toda la página. Si se proporciona, solo se muestra el elemento seleccionado (útil para páginas externas donde solo quieres mostrar una sección específica)

**Ejemplo completo con todas las opciones:**

```json
{
  "categories": [
    {
      "name": "Aventuras",
      "pages": [
        {
          "name": "Mi Primera Aventura",
          "url": "https://tu-workspace.notion.site/Mi-Primera-Aventura-2d0d4856c90e80f6801dcafb6b7366e6"
        },
        {
          "name": "Encuentros Aleatorios",
          "url": "https://www.notion.so/Encuentros-Aleatorios-3e1e5967d01e91f7912ec8bf7c8477f8"
        },
        {
          "name": "NPCs Importantes",
          "url": "https://tu-workspace.notion.site/NPCs-Importantes-4f2f6078e02e02f8023fd9cf8d9589f9"
        }
      ]
    },
    {
      "name": "Referencias Externas",
      "pages": [
        {
          "name": "Manual D&D 5e",
          "url": "https://5e.tools/book.html#mm,1",
          "selector": "#content"
        },
        {
          "name": "Wiki de Reglas",
          "url": "https://ejemplo.com/wiki/reglas",
          "selector": ".main-article"
        },
        {
          "name": "Calculadora de Daño",
          "url": "https://calculadora.com/damage",
          "selector": "#calculator-container"
        },
        {
          "name": "Página Completa (sin selector)",
          "url": "https://ejemplo.com/pagina-completa"
        }
      ]
    },
    {
      "name": "Tokens y Mapas",
      "pages": [
        {
          "name": "Colección de Tokens",
          "url": "https://tu-workspace.notion.site/Tokens-5a3a7189f03e03f9034ge0df0e0690a0"
        },
        {
          "name": "Mapas de Batalla",
          "url": "https://www.notion.so/Mapas-de-Batalla-6b4b8290g14f14g0145ih1ef1f17a1b1"
        }
      ]
    },
    {
      "name": "Notas de Sesión",
      "pages": [
        {
          "name": "Sesión 1 - Introducción",
          "url": "https://tu-workspace.notion.site/Sesion-1-7c5c93a1h25g25h1256ji2fg2g28b2c2"
        },
        {
          "name": "Sesión 2 - El Bosque",
          "url": "https://tu-workspace.notion.site/Sesion-2-8d6d04b2i36h36i2367kj3gh3h39c3d3"
        }
      ]
    }
  ]
}
```

**Ejemplo mínimo (una categoría, una página):**

```json
{
  "categories": [
    {
      "name": "General",
      "pages": [
        {
          "name": "Mi Página",
          "url": "https://tu-notion.notion.site/Mi-Pagina-2d0d4856c90e80f6801dcafb6b7366e6"
        }
      ]
    }
  ]
}
```

**Notas importantes:**
- Las categorías se ordenan alfabéticamente automáticamente
- Las páginas dentro de cada categoría también se ordenan alfabéticamente
- El `selector` solo funciona con URLs externas (no-Notion)
- Para páginas de Notion, el `selector` se ignora (se usa la API de Notion)
- Los iconos de las páginas se cargan automáticamente desde Notion

### 🔄 Actualizar contenido

- **Recarga automática:** El contenido se cachea para cargar rápido
- **Botón 🔄:** Fuerza la recarga de una página específica (útil si actualizaste Notion)
- **Botón 🗑️:** Limpia todo el caché (útil si algo no se actualiza)

### 💡 Consejos

- **Cada usuario tiene su propio token:** Configura tu token una vez y úsalo en todas las rooms
- **Cada room es independiente:** Las páginas se configuran por room, pero el token es compartido
- **Token privado:** Tu token se guarda localmente en tu navegador, solo tú lo ves
- **URLs de Notion:** Puedes usar páginas privadas (no necesitan ser públicas) si las compartes con tu integración
- **Iconos:** Las páginas muestran su icono de Notion automáticamente
- **Imágenes:** Haz clic en cualquier imagen para verla a tamaño real
- **Cambiar token:** Clic en **🔑** → Eliminar Token para volver a usar el token del servidor (si está configurado)

---

---

## 🛠️ Para Desarrolladores (Solo quien despliega)

> **⚠️ Esta sección es SOLO para quien despliega la extensión. Los usuarios finales NO necesitan hacer esto.**

### 🚀 Despliegue en Netlify

1. **Fork/clona este repositorio**

2. **Crea cuenta en Netlify** (gratis)

3. **Conecta tu repositorio:**
   - "Add new site" → "Import an existing project"
   - Conecta GitHub/GitLab → Selecciona este repo

4. **Deploy automático:**
   - Netlify detectará y desplegará automáticamente
   - **No necesitas configurar token** - cada usuario configurará el suyo

5. **Comparte la URL:**
   - Ejemplo: `https://tu-proyecto.netlify.app/manifest.json`
   - Comparte esta URL con los usuarios
   - **Cada usuario configurará su propio token** desde la interfaz (botón 🔑)

### 🔧 Token Opcional del Servidor (Opcional)

Si quieres que funcione sin que los usuarios configuren nada (páginas compartidas):

1. **En Netlify Dashboard:**
   - Settings → Environment variables
   - Agrega: `NOTION_API_TOKEN` = `tu_token_de_notion`
   - Obtén el token: https://www.notion.so/my-integrations

2. **En Notion:**
   - Comparte tus páginas con la integración
   - Los usuarios verán estas páginas sin configurar nada

3. **Los usuarios pueden:**
   - Usar páginas compartidas (sin token)
   - O configurar su propio token (🔑) para sus páginas

### 📝 Configurar páginas iniciales (Opcional)

Las páginas se pueden gestionar desde la interfaz, pero puedes configurar páginas iniciales editando `build-config.js`:

```javascript
export const NOTION_PAGES = [
  {
    name: "Mi Aventura",
    url: "https://tu-notion.notion.site/Mi-Aventura-..."
  }
];
```

### 🔧 Desarrollo Local

1. **Copia el archivo de ejemplo:**
   ```bash
   cp config.example.js config.js
   ```

2. **Edita `config.js`** y agrega tu token (solo para desarrollo local):
   ```javascript
   export const NOTION_API_TOKEN = "tu_token_de_notion_aqui";
   ```

3. **Servidor local:**
   ```bash
   npx http-server -p 8000
   ```

4. **Usa en Owlbear:**
   - `http://localhost:8000/manifest.json`

#### Para GitHub Pages

GitHub Pages solo sirve archivos estáticos, por lo que no puedes usar variables de entorno directamente. Opciones:

- **Opción A (Simple - Solo desarrollo):** 
  - Mantén `config.js` local y no lo subas a GitHub (ya está en `.gitignore`)
  - ⚠️ **Advertencia:** Si alguien accede a tu sitio, el token estará visible en el código del cliente

- **Opción B (Segura - Requiere GitHub Actions):**
  - Crea un workflow de GitHub Actions
  - Usa GitHub Secrets para almacenar el token
  - El workflow genera `config.js` en build time
  - Ver ejemplo en `.github/workflows/deploy.yml` (crear si es necesario)

### 🔓 Hacer una página de Notion pública

1. Abre tu página en Notion
2. Clic en "Compartir" (arriba a la derecha)
3. Activa "Compartir en la web"
4. Copia la URL pública
5. Pégala en `index.js`

## 📦 Estructura del Proyecto

```
owlbear-notion-embed/
├── manifest.json              # Configuración de la extensión
├── index.html                 # Interfaz de usuario
├── index.js                   # Lógica principal
├── notion-markdown.css        # Estilos para renderizar contenido
├── icon.svg                   # Icono de la extensión
├── config.example.js          # Plantilla de configuración
├── build-config.js            # Script de build para Netlify
├── test-notion-api.js         # Script de prueba (desarrollo)
├── netlify/
│   └── functions/
│       └── notion-api.js      # Netlify Function (proxy seguro)
├── netlify.toml               # Configuración de Netlify
├── package.json               # Configuración de Node.js
├── .gitignore                 # Archivos ignorados por Git
└── README.md                  # Esta documentación
```

## 🧪 Probar que funciona

Antes de usar la extensión, verifica que la API de Notion esté configurada correctamente:

```bash
# Ejecuta el script de prueba
npm test
# o directamente:
node test-notion-api.js
```

El script verificará:
- ✅ Que `config.js` existe y tiene el token configurado
- ✅ Que el token es válido
- ✅ Que puede acceder a las páginas configuradas
- ✅ Que obtiene los bloques correctamente

**Si hay errores:**
- **Token no válido:** Verifica que el token sea correcto en `config.js`
- **Sin permisos:** Asegúrate de que la integración de Notion tenga acceso a las páginas
- **Página no encontrada:** Verifica que las URLs en `config.js` sean correctas

## 🎮 Uso

1. **Abre Owlbear Rodeo** y crea/abre una sala
2. **Selecciona la extensión** desde el menú de extensiones
3. **Haz clic en una página** para abrirla en un modal
4. **Navega** por tu contenido de Notion sin salir de Owlbear

## 🔧 Desarrollo

### Requisitos

- Servidor web estático (cualquiera funciona)
- Páginas de Notion configuradas como públicas

### SDK de Owlbear

Esta extensión usa el SDK oficial de Owlbear Rodeo:
- [Documentación](https://docs.owlbear.rodeo/)
- [API de Modales](https://docs.owlbear.rodeo/extensions/apis/modal/)

## 📝 Notas

- Las páginas de Notion deben ser **públicas** para funcionar
- El modal se abre con un tamaño responsive
- Puedes tener múltiples páginas configuradas
- La extensión es completamente privada si no la compartes públicamente
- **⚠️ Seguridad:** El token de la API está en `config.js` que NO se sube a GitHub (está en `.gitignore`)

## 🔐 Seguridad

**Para Desarrolladores:**

- ✅ El token se almacena en Netlify (variables de entorno)
- ✅ El token NUNCA se expone al cliente (usa Netlify Functions como proxy)
- ✅ `config.js` está en `.gitignore` y NO se sube a GitHub
- ✅ Los usuarios finales nunca ven ni necesitan el token

**Para Usuarios:**

- ✅ No necesitas saber nada sobre tokens
- ✅ Solo usa la extensión normalmente

## 🐛 Solución de Problemas

**La página no se abre:**
- Verifica que la URL de Notion sea pública
- Asegúrate de que la URL esté completa (sin parámetros `?source=...`)

**La extensión no aparece:**
- Verifica que el `manifest.json` sea accesible públicamente
- Revisa que la URL del manifest sea correcta en Owlbear

**Error de CORS:**
- Asegúrate de alojar la extensión en un servidor (no usar `file://`)

## 🗺️ Roadmap / Próximos Pasos

### ✅ Implementado
- ✅ Texto, encabezados (H1, H2, H3)
- ✅ Listas (bulleted, numbered, to-do)
- ✅ Toggle list y Toggle headings (H1, H2, H3)
- ✅ Imágenes (clickables, modal a tamaño real)
- ✅ Tablas
- ✅ Columnas (2, 3, 4, 5 columnas)
- ✅ Code, Quote, Callout
- ✅ Divider

### 🔜 Próximas Implementaciones

#### Child Database (Bases de datos anidadas)
- **Estado:** Pendiente
- **Complejidad:** Media-Alta
- **Descripción:** Renderizar bases de datos completas que están dentro de una página
- **Requisitos:** 
  - Obtener estructura de la base de datos
  - Renderizar filas y columnas
  - Soporte para diferentes tipos de propiedades (texto, número, fecha, etc.)
  - Paginación si hay muchas filas

#### Block Equation (Fórmulas matemáticas)
- **Estado:** Pendiente
- **Complejidad:** Media
- **Descripción:** Renderizar fórmulas matemáticas usando KaTeX o MathJax
- **Requisitos:**
  - Integrar librería de renderizado matemático
  - Parsear formato LaTeX de Notion

#### Synced Block (Bloques sincronizados)
- **Estado:** Pendiente
- **Complejidad:** Media
- **Descripción:** Renderizar bloques que están sincronizados entre páginas
- **Requisitos:**
  - Detectar bloques sincronizados
  - Obtener contenido del bloque original

## 📄 Licencia

Uso personal - Siéntete libre de modificar y usar como quieras.

