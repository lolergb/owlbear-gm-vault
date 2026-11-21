# Configurar copias privadas de GM Vault 2.2.0

El candidato de la PR #26 incorpora guardado y restauración manual de una sola copia por cuenta. El manifest de pruebas es:

https://deploy-preview-26--owlbear-gm-vault.netlify.app/manifest.json

Instalarlo en una sala de pruebas. El dominio del preview tiene almacenamiento local independiente de producción: que aparezca vacío no significa que se haya perdido el vault de producción. Para llevar un vault al preview, exportar su JSON e importarlo allí. La copia privada excluye el token de Notion.

## Estado del proyecto abierto

Durante la implementación del 21 de noviembre de 2026, el proyecto `gm-vault-production`, referencia `wtrgjhfmakecotdygkqz`, estaba pausado. En la configuración posterior solicitada por el usuario ya aparecía activo y saludable, y la tabla con las políticas de la migración ya estaba creada. Se comprobó ese esquema sin repetir la migración y se ajustó Email OTP a 600 segundos. Para mantener separados preview y producción, usar preferentemente un proyecto de pruebas distinto.

## Base de datos

En el SQL Editor del proyecto destinado a pruebas, ejecutar una sola vez el contenido completo de [la migración](../supabase/migrations/202611210001_private_vault_backups.sql). También puede aplicarse mediante Supabase CLI al proyecto correcto.

La migración crea `public.private_vault_backups`, permisos por columnas, RLS y el trigger de revisión y fecha. Si la tabla ya existe, revisar qué migración la creó antes de continuar; no borrar ni sustituir una tabla existente para resolver el error.

Cada fila pertenece al UUID de Authentication, no al email ni al usuario de Owlbear. El usuario puede leer, crear y actualizar únicamente su fila. No habilitar autenticación anónima para este flujo. No hacen falta buckets de Storage ni Realtime.

Las comprobaciones de PostgreSQL se ejecutan con `npm run test:cloud-db`. Usan la misma migración en PostgreSQL embebido y comprueban aislamiento, permisos, metadatos del servidor, límites y conflictos; no se conectan a tu proyecto alojado.

## Acceso por código y entrega de email

En Authentication, habilitar el proveedor **Email** y permitir el alta de nuevos usuarios si cualquier GM debe poder crear su primera copia. Mantener la confirmación de email activada. El cliente utiliza `signInWithOtp` y `verifyOtp` con tipo `email`; no utiliza contraseña ni una redirección de acceso.

En el proyecto nuevo de pruebas, configurar mensajes propios que muestren **`{{ .Token }}`** como código en los dos casos: **Confirm sign up**, para una cuenta nueva, y **Magic link or OTP**, para usos posteriores. El mensaje debe indicar que hay que introducirlo en GM Vault y que se ignore si no se solicitó. Supabase tramita el primer acceso como un alta; comprobar ambos mensajes evita que solo las cuentas existentes reciban un código. Véanse [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates) y [el flujo de alta de Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go).

Si se reutiliza un proyecto con templates existentes, conservarlos y autorizar cualquier sustitución de forma expresa antes de editar esos templates. La implementación no modifica templates remotos.

El usuario autorizó expresamente sustituir únicamente **Confirm sign up** y **Magic link or OTP** por los mensajes de [alta](../supabase/emails/signup-otp.html) y [acceso](../supabase/emails/login-otp.html), con asunto `Your GM Vault sign-in code`. Son archivos nuevos; su instalación en Supabase queda pendiente de configurar SMTP. El panel del plan gratuito actual no permite editar el contenido de los emails predeterminados sin SMTP propio.

Configurar una caducidad de 10 minutos para Email OTP y un intervalo de reenvío de al menos 60 segundos. La interfaz admite códigos numéricos de entre 6 y 10 dígitos para ajustarse a la longitud del proyecto. Los límites del servidor y del proveedor siguen siendo los efectivos.

Configurar **Custom SMTP** con el proveedor y remitente elegidos y verificar SPF, DKIM y DMARC del dominio. Las credenciales SMTP se introducen únicamente en Supabase. Su servicio de envío predeterminado está limitado a destinatarios del equipo y no es suficiente para probar con buzones externos. Documentación: [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) y [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

La Site URL puede apuntar al origen del preview para identificar el entorno. Este flujo por código no necesita añadir una ruta callback ni permitir redirecciones comodín. Mantener habilitado el método de acceso passwordless por email: OTP comparte su implementación con Magic Link, aunque el mensaje muestre únicamente el código.

## Variables de Netlify

En el proyecto Netlify `owlbear-gm-vault`, añadir estas variables **en contexto Deploy Previews**, con alcance Functions cuando el plan permita elegirlo. En el plan actual solo está disponible All scopes; los valores de URL y clave pública siguen limitados a Deploy Previews:

| Variable | Valor |
| --- | --- |
| `GM_VAULT_CLOUD_ENABLED` | `true` |
| `GM_VAULT_SUPABASE_URL` | URL HTTPS del proyecto elegido, por ejemplo `https://<project-ref>.supabase.co` |
| `GM_VAULT_SUPABASE_PUBLISHABLE_KEY` | Clave pública publishable del mismo proyecto; también se admite una clave pública `anon` anterior |

Las tres variables pertenecen al mismo proyecto y contexto. No configurar una clave `secret` ni `service_role`: el endpoint las rechaza. No introducir credenciales de SMTP o base de datos en Netlify para esta función. Las claves públicas se pueden exponer al navegador porque las políticas de la base de datos exigen la sesión individual del usuario. Véase [API keys](https://supabase.com/docs/guides/getting-started/api-keys).

En la configuración del 21 de noviembre se guardaron las tres variables para Deploy Previews y se fijó `GM_VAULT_CLOUD_ENABLED=false` en Production. El redespliegue de la PR #26 terminó correctamente y su endpoint público devolvió `enabled: true`. La lectura directa de copias con la clave pública y sin sesión fue rechazada con HTTP 401 y `permission denied`, como corresponde.

Volver a desplegar la PR después de cambiar variables. Comprobar `/.netlify/functions/get-cloud-config` en el preview: devuelve `enabled: true`, la URL y la clave pública. Sin configuración válida devuelve solo `enabled: false` y las acciones explican que las copias privadas no están configuradas. El arranque local no consulta ese endpoint.

Para desarrollo con `npm run dev`, definir las mismas variables en el entorno del proceso antes de iniciarlo. El servidor local implementa el endpoint de configuración. No guardar variables en el repositorio.

## Prueba con dos perfiles dentro de Owlbear

1. En el perfil A, abrir una sala de pruebas como GM y añadir dos páginas, una carpeta y una página compartida. Verificar que el arranque y la carga de ejemplos funcionan sin cuenta de nube.
2. Abrir Settings y **Save private backup**. Introducir email A y el código recibido. Revisar el resumen y confirmar. En Authentication → Users debe aparecer el usuario verificado y en la tabla una fila con su `user_id`.
3. Cerrar y reabrir el panel. Editar una página y guardar de nuevo. Debe reutilizar la sesión, avisar de sustitución y aumentar `revision` en la misma fila, conservando una sola copia. Usar otra sala no crea una segunda fila.
4. En el perfil B o en otro dispositivo, entrar como GM autorizado, elegir **Restore private backup** y verificar el mismo email A con un código nuevo. Cancelar la revisión primero: el vault local debe seguir intacto. Reabrir y confirmar: comprobar contenido, orden e IDs.
5. La restauración deja el acceso de jugadores desactivado. Reactivarlo expresamente desde los controles existentes y comprobarlo como Player. Los Players y Co-GMs no tienen controles de nube. El token de Notion de otro dispositivo se configura por separado.
6. En Settings, **Undo restore** debe devolver la copia local anterior. Si se hicieron ediciones después de restaurar, la reversión se detiene para protegerlas; conservar una exportación JSON antes de cualquier recuperación manual.
7. Abrir una revisión de guardado en A y otra en B. Confirmar en A y luego en B. La segunda debe mostrar conflicto y conservar la copia de A.
8. Usar **Sign out** en B y acceder con email B. No debe aparecer la copia de A. Guardar con B crea su propia fila. Verificar el aislamiento también con peticiones directas a la Data API, nunca con `service_role`.
9. Probar código erróneo, caducado y reenvío; interrupción de red; espacio local insuficiente; cierre del panel durante una lectura; cambio de rol/sala durante revisión. Tras un timeout de guardado, usar **Check backup** antes de volver a escribir.

Al utilizar la misma sala desde otro dispositivo, liberar primero el ownership mediante el comportamiento actual de Owlbear. Esta función no toma el control de otro GM activo.

## Recuperación y desactivación

Antes de reemplazar un vault local se guarda y verifica su estado anterior. Una operación interrumpida muestra una elección local al reabrir; esa recuperación no necesita Supabase. Se mantiene una copia anterior por sala. **Undo restore** exige que el destino no haya sido editado desde la restauración.

**Clear local data** elimina los vaults y sus copias de recuperación locales, mantiene la sesión de nube y no borra ni descarga la copia remota. **Sign out** cierra solo la sesión de ese dispositivo y conserva los vaults. Para desactivar nuevas operaciones remotas, retirar `GM_VAULT_CLOUD_ENABLED=true` y volver a desplegar; el uso local y la recuperación local siguen disponibles.

La copia es privada mediante controles de acceso, no cifrado de extremo a extremo. Los operadores con privilegios del proyecto pueden acceder al contenido. Los documentos y recursos externos siguen dependiendo de sus propios orígenes.

## Validación del candidato

En esta implementación se verificaron las pruebas de regresión y de los nuevos servicios y diálogos, 24 comprobaciones de PostgreSQL con la migración real y una comprobación de interoperabilidad con el SDK oficial 2.119.2 mediante 15 peticiones HTTP simuladas. La CI ejecuta la suite completa y las comprobaciones de PostgreSQL.

La revisión del navegador recorrió acceso, código incorrecto, primera copia, sesión reutilizada, restauración y Undo en dos sesiones lógicas de QA, con email simulado, usando temas claro y oscuro y panel estrecho. La ruta local `/__dev/cloud?state=configured&profile=a` sirve exclusivamente para estas pruebas mediante `npm run dev`; su código simulado es `123456` y no envía emails. La extensión instalada desde el manifest siempre utiliza el servicio Supabase real cuando está configurado.

La entrega real de OTP y la prueba final con dos perfiles reales dentro de Owlbear quedan pendientes de configurar SMTP y los dos mensajes autorizados. El proyecto ya está activo, su tabla y políticas se han comprobado y la preview tiene conexión. Las pruebas simuladas no acreditan el envío real de códigos ni el ciclo completo con sesiones del servicio alojado.
