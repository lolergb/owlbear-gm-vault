# Configuración de Preview Deployments en Netlify

Esta guía explica cómo configurar preview deployments automáticos para Pull Requests (MR) en Netlify.

## Configuración Automática

Netlify crea automáticamente preview deployments cuando:
1. Tu sitio está conectado a un repositorio Git (GitHub, GitLab, Bitbucket)
2. Se abre un Pull Request o Merge Request

## Pasos para Habilitar Preview Deployments

### 1. Conectar el Repositorio

1. Ve a tu **Netlify Dashboard**
2. Selecciona tu sitio
3. Ve a **Site settings** → **Build & deploy** → **Continuous Deployment**
4. Si no está conectado, haz clic en **Link to Git provider**
5. Autoriza Netlify y selecciona tu repositorio
6. Configura:
   - **Branch to deploy**: `main` o `master` (tu rama principal)
   - **Build command**: `node scripts/build-config.js`
   - **Publish directory**: `.` (raíz del proyecto)

### 2. Configurar Deploy Previews

1. En **Site settings** → **Build & deploy** → **Deploy contexts**
2. Asegúrate de que **Deploy previews** esté habilitado
3. Opcional: Configura **Branch deploys** si quieres previews para otras ramas

### 3. Configuración de Headers para Previews

Los headers CORS están configurados en `netlify.toml` para permitir acceso desde `https://www.owlbear.rodeo`.

Si necesitas que los previews funcionen en otros dominios, puedes:

**Opción A: Permitir todos los dominios de Netlify (recomendado para previews)**
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
```

**Opción B: Configurar headers específicos por contexto**
```toml
# Headers para producción
[[headers]]
  for = "/*"
  [headers.values]
    Access-Control-Allow-Origin = "https://www.owlbear.rodeo"

# Headers para previews (más permisivos)
[[headers]]
  for = "/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
```

### 4. Variables de Entorno

Las variables de entorno se pueden configurar por contexto:

1. Ve a **Site settings** → **Environment variables**
2. Agrega variables específicas para:
   - **Production**: Variables para el sitio en producción
   - **Deploy previews**: Variables para previews de PRs
   - **Branch deploys**: Variables para otras ramas

**Variables importantes:**

- `DEBUG_MODE`: Modo debug
  - Valor: `true` o `1` para activar logs de debug
  - Útil para deploy previews: `true` (solo en previews para debugging)

## Cómo Funciona

1. **Cuando abres un PR**:
   - Netlify detecta automáticamente el PR
   - Ejecuta el build command
   - Crea un preview deployment único
   - Genera una URL como: `deploy-preview-123--tusitio.netlify.app`

2. **Comentario automático en el PR**:
   - Netlify puede comentar automáticamente en el PR con el link del preview
   - Para habilitarlo: **Site settings** → **Build & deploy** → **Deploy notifications**

3. **Estado del deployment**:
   - Netlify muestra el estado del deployment en el PR (✅ o ❌)
   - Puedes ver los logs del build directamente desde el PR

## Verificación

Para verificar que funciona:

1. Crea una nueva rama: `git checkout -b test-preview`
2. Haz un cambio pequeño
3. Abre un Pull Request
4. Ve a tu Netlify Dashboard → **Deploys**
5. Deberías ver un nuevo deployment con el contexto "Deploy preview"

## Troubleshooting

### Los previews no se crean automáticamente

- Verifica que el repositorio esté conectado
- Revisa que "Deploy previews" esté habilitado
- Verifica los permisos de Netlify en tu repositorio

### Los headers CORS no funcionan en previews

- Los previews usan dominios diferentes (`*.netlify.app`)
- Considera usar `Access-Control-Allow-Origin: *` para previews
- O configura headers específicos por contexto

### El build falla en previews

- Revisa los logs en Netlify Dashboard
- Verifica que todas las dependencias estén en `package.json`
- Asegúrate de que el build command funcione localmente

## Recursos

- [Documentación oficial de Netlify Deploy Previews](https://docs.netlify.com/site-deploys/deploy-previews/)
- [Configuración de netlify.toml](https://docs.netlify.com/configure-builds/file-based-configuration/)

