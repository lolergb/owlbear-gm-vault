# Configuración de Google Drive para GM Vault

Esta guía te ayudará a configurar Google OAuth 2.0 para usar Google Drive con GM Vault.

## Requisitos

- Una cuenta de Google
- Acceso a Google Cloud Console

## Pasos de Configuración

### 1. Crear un Proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Haz clic en el selector de proyectos (arriba a la izquierda)
3. Haz clic en **"NUEVO PROYECTO"**
4. Ingresa un nombre para tu proyecto (ej: "GM Vault")
5. Haz clic en **"CREAR"**

### 2. Habilitar Google Drive API

1. En el menú lateral, ve a **"APIs y servicios"** → **"Biblioteca"**
2. Busca **"Google Drive API"**
3. Haz clic en **"HABILITAR"**

### 3. Crear Credenciales OAuth 2.0

1. Ve a **"APIs y servicios"** → **"Credenciales"**
2. Haz clic en **"+ CREAR CREDENCIALES"** → **"ID de cliente de OAuth"**
3. Si es la primera vez, configura la pantalla de consentimiento:
   - Selecciona **"Externo"** (a menos que uses Google Workspace)
   - Completa la información requerida
   - En **"Scopes"**, añade: `https://www.googleapis.com/auth/drive.readonly`
   - Completa los campos obligatorios y guarda
4. En **"Tipo de aplicación"**, selecciona **"Aplicación web"**
5. Dale un nombre (ej: "GM Vault Web Client")
6. En **"Orígenes autorizados de JavaScript"**, añade:
   - `https://www.owlbear.rodeo`
   - Tu dominio de desarrollo (ej: `http://localhost:3000` si desarrollas localmente)
7. En **"URI de redirección autorizados"**, añade:
   - `https://www.owlbear.rodeo`
   - Tu dominio de desarrollo
8. Haz clic en **"CREAR"**
9. **Copia el Client ID** (termina en `.apps.googleusercontent.com`)

### 4. Configurar el Client ID en GM Vault

1. Abre GM Vault en Owlbear Rodeo
2. Ve a **Settings**
3. Haz clic en **"Import from Google Drive"**
4. Cuando se te pida, pega tu **Client ID**
5. El Client ID se guardará automáticamente para futuras sesiones

## Uso

Una vez configurado:

1. Haz clic en **"Import from Google Drive"**
2. Se abrirá una ventana de Google para iniciar sesión
3. Autoriza el acceso a Google Drive (solo lectura)
4. Selecciona la carpeta que quieres importar
5. El vault se generará automáticamente

## Seguridad

- El **Client ID** es público y seguro de compartir en el código del cliente
- El **access token** se almacena solo en memoria (no en localStorage)
- Solo se solicita permiso de **lectura** (`drive.readonly`)
- Puedes revocar el acceso en cualquier momento desde tu [cuenta de Google](https://myaccount.google.com/permissions)

## Solución de Problemas

### Error: "Client ID no configurado"
- Asegúrate de haber copiado el Client ID completo
- Verifica que no haya espacios al inicio o final

### Error: "Error de autenticación"
- Verifica que el origen esté autorizado en Google Cloud Console
- Asegúrate de que Google Drive API esté habilitada
- Intenta cerrar sesión y volver a iniciar

### Error: "No se encontraron carpetas"
- Asegúrate de tener al menos una carpeta en tu Google Drive
- Verifica que tengas permisos para acceder a las carpetas

## Referencias

- [Documentación de OAuth 2.0 de Google](https://developers.google.com/identity/protocols/oauth2)
- [Google Drive API](https://developers.google.com/drive/api)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
