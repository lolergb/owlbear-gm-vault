# 📚 Notion Embed para Owlbear Rodeo

Extensión simple para embebber páginas públicas de Notion directamente en Owlbear Rodeo.

## ✨ Características

- 🎯 Abre páginas de Notion en modales dentro de Owlbear
- 📝 Configuración simple: solo agrega URLs en `index.js`
- 🎨 Interfaz limpia y oscura
- 🔒 Funciona con páginas públicas de Notion

## 🚀 Instalación

### Opción 1: GitHub Pages (Recomendado)

1. **Crea un repositorio en GitHub** con estos archivos
2. **Habilita GitHub Pages** en Settings → Pages
3. **Copia la URL** de tu `manifest.json` (ej: `https://tu-usuario.github.io/owlbear-notion-embed/manifest.json`)
4. **En Owlbear Rodeo:**
   - Ve a tu perfil
   - Clic en "Agregar Extensión"
   - Pega la URL del `manifest.json`

### Opción 2: Alojamiento Local (Desarrollo)

1. **Instala un servidor local:**
   ```bash
   # Con Python
   python -m http.server 8000
   
   # O con Node.js
   npx http-server -p 8000
   ```

2. **Usa la URL local** en Owlbear:
   - `http://localhost:8000/manifest.json`

### Opción 3: Otros Servicios

Puedes alojar en cualquier servicio estático:
- **Netlify** (gratis)
- **Vercel** (gratis)
- **Render** (gratis)

## ⚙️ Configuración

Edita el archivo `index.js` y agrega tus páginas de Notion en el array `NOTION_PAGES`:

```javascript
const NOTION_PAGES = [
  {
    name: "Ganar Tiempo",
    url: "https://solid-jingle-6ee.notion.site/Ganar-Tiempo-..."
  },
  {
    name: "Otra Aventura",
    url: "https://tu-notion.notion.site/Otra-Pagina-..."
  }
];
```

### 🔓 Hacer una página de Notion pública

1. Abre tu página en Notion
2. Clic en "Compartir" (arriba a la derecha)
3. Activa "Compartir en la web"
4. Copia la URL pública
5. Pégala en `index.js`

## 📦 Estructura del Proyecto

```
owlbear-notion-embed/
├── manifest.json      # Configuración de la extensión
├── index.html         # Interfaz de usuario
├── index.js           # Lógica y configuración de páginas
├── icon.svg           # Icono de la extensión (opcional)
└── README.md          # Esta documentación
```

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

## 🐛 Solución de Problemas

**La página no se abre:**
- Verifica que la URL de Notion sea pública
- Asegúrate de que la URL esté completa (sin parámetros `?source=...`)

**La extensión no aparece:**
- Verifica que el `manifest.json` sea accesible públicamente
- Revisa que la URL del manifest sea correcta en Owlbear

**Error de CORS:**
- Asegúrate de alojar la extensión en un servidor (no usar `file://`)

## 📄 Licencia

Uso personal - Siéntete libre de modificar y usar como quieras.

