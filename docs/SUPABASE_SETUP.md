# Configurar copias privadas de GM Vault 2.2.0

El candidato de la PR #26 incorpora guardado y restauración manual de varias copias con nombre por cuenta. Un nombre nuevo crea una copia independiente. Repetir el mismo nombre pide confirmar la sustitución de esa copia; las demás se conservan. El manifest de pruebas es:

https://deploy-preview-26--owlbear-gm-vault.netlify.app/manifest.json

**Actualización del 22 de noviembre de 2026:** la preview ya permite probar varias copias con nombre. La segunda migración está aplicada: `Previous backup` conserva contenido, revisión y fecha, con RLS y tres políticas activas; las escrituras del cliente antiguo quedan deshabilitadas. Se guardaron y recuperaron dos copias con contenidos distintos desde dos salas de Owlbear y se comprobó que sustituir una conserva las demás. No hace falta configurar nada más para probar en esta preview. La nube sigue desactivada en el despliegue de producción.

Instalarlo en una sala de pruebas. El dominio del preview tiene almacenamiento local independiente de producción: que aparezca vacío no significa que se haya perdido el vault de producción. Para llevar un vault al preview, exportar su JSON e importarlo allí. La copia privada excluye el token de Notion.

## Estado del proyecto abierto

El proyecto configurado es `gm-vault-production`, referencia `wtrgjhfmakecotdygkqz`, activo y saludable. Su tabla inicial y políticas ya estaban creadas y se comprobaron sin repetir la primera migración. Email OTP está ajustado a 600 segundos, con códigos de 8 dígitos. La comprobación anterior a la ampliación encontró una copia para la cuenta de prueba, con revisión `2` y versión de esquema `1`; la segunda migración la conserva con el nombre `Previous backup`. Para mantener separados preview y producción en futuros cambios, usar preferentemente un proyecto de pruebas distinto.

## Base de datos

En un proyecto nuevo, aplicar una sola vez y en este orden:

1. [Migración inicial](../supabase/migrations/202611210001_private_vault_backups.sql).
2. [Migración de copias con nombre](../supabase/migrations/202611220001_named_private_vault_backups.sql).

En un proyecto que solo tenga la migración inicial, aplicar únicamente la segunda. En `gm-vault-production` ya están aplicadas ambas: no repetirlas. También pueden aplicarse mediante Supabase CLI al proyecto correcto. Ejecutar la segunda migración **antes** de desplegar el cliente con nombres y recargar las pestañas de la preview después del despliegue.

La segunda migración crea `public.private_vault_backup_entries`: UUID de copia, propietario, nombre único dentro de la cuenta, fechas, payload y revisión. Copia las filas anteriores como `Previous backup` conservando contenido, revisión y fecha. La tabla original `public.private_vault_backups` queda como respaldo de solo lectura. Sus permisos de escritura se retiran para que una pestaña antigua no guarde fuera del catálogo nuevo. No borrar ninguna de las dos tablas ni volver a ejecutar una migración ya aplicada.

Cada fila pertenece al UUID de Authentication, no al email ni al usuario de Owlbear. El usuario puede leer, crear y actualizar únicamente sus copias. El nombre admite de 1 a 80 caracteres, se recortan espacios exteriores y no se permiten controles. Los nombres distinguen mayúsculas; un nombre idéntico identifica la misma copia. Una sustitución filtra propietario, UUID de copia y revisión. No se ofrecen borrado ni renombrado remoto. No habilitar autenticación anónima para este flujo. No hacen falta buckets de Storage ni Realtime.

Las 59 comprobaciones de PostgreSQL se ejecutan con `npm run test:cloud-db`. Aplican ambas migraciones en PostgreSQL embebido y comprueban conservación de la copia anterior, varias copias por cuenta, aislamiento, permisos, nombres, metadatos del servidor, límites y conflictos; no se conectan a tu proyecto alojado.

## Acceso por código y entrega de email

En Authentication, habilitar el proveedor **Email** y permitir el alta de nuevos usuarios si cualquier GM debe poder crear su primera copia. Mantener la confirmación de email activada. El cliente utiliza `signInWithOtp` y `verifyOtp` con tipo `email`; no utiliza contraseña ni una redirección de acceso.

En el proyecto nuevo de pruebas, configurar mensajes propios que muestren **`{{ .Token }}`** como código en los dos casos: **Confirm sign up**, para una cuenta nueva, y **Magic link or OTP**, para usos posteriores. El mensaje debe indicar que hay que introducirlo en GM Vault y que se ignore si no se solicitó. Supabase tramita el primer acceso como un alta; comprobar ambos mensajes evita que solo las cuentas existentes reciban un código. Véanse [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates) y [el flujo de alta de Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go).

Si se reutiliza un proyecto con templates existentes, conservarlos y autorizar cualquier sustitución de forma expresa antes de editar esos templates. La extensión no modifica templates remotos automáticamente.

El usuario autorizó expresamente sustituir únicamente **Confirm sign up** y **Magic link or OTP** por los mensajes de [alta](../supabase/emails/signup-otp.html) y [acceso](../supabase/emails/login-otp.html), con asunto `Your GM Vault sign-in code`. Ambos se instalaron en Supabase después de activar SMTP. Los originales locales se conservaron y el resto de mensajes remotos no se modificó. El panel del plan gratuito actual no permite editar el contenido de los emails predeterminados sin SMTP propio.

Configurar una caducidad de 10 minutos para Email OTP y un intervalo de reenvío de al menos 60 segundos. La interfaz admite códigos numéricos de entre 6 y 10 dígitos para ajustarse a la longitud del proyecto. Los límites del servidor y del proveedor siguen siendo los efectivos.

Configurar **Custom SMTP** con el proveedor y remitente elegidos y verificar SPF, DKIM y DMARC del dominio. Las credenciales SMTP se introducen únicamente en Supabase. Su servicio de envío predeterminado está limitado a destinatarios del equipo y no es suficiente para probar con buzones externos. Documentación: [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) y [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

El usuario eligió Resend Free y autorizó su alta y los tres registros nuevos de envío de `auth.bynewroman.com`. La cuenta ya está creada y GoDaddy confirmó el guardado del TXT `resend._domainkey.auth` y los CNAME `rsend.auth` y `send.auth`; también se comprobó que resuelven en DNS público. Se conservaron los registros anteriores del dominio. Resend confirmó el dominio como **Verified / Ready**, en la región de Irlanda, con seguimiento de aperturas y clics desactivado. SMTP quedó configurado con el remitente `GM Vault <codes@auth.bynewroman.com>`, host `smtp.resend.com`, puerto `465` y usuario `resend`. El usuario creó y guardó una clave de solo envío restringida al subdominio. El error inicial de credenciales SMTP se resolvió al volver a pegarla y guardarla: se recibieron y verificaron dos códigos reales en el buzón autorizado durante la prueba. No guardar esa clave en el repositorio, Netlify ni el chat.

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
2. Abrir Settings y **Save private backup**. Introducir email A y el código recibido. Escribir `Session A`, revisar el resumen y confirmar. Guardar otra instantánea como `Session B`; deben quedar ambas en `private_vault_backup_entries` con su `user_id` y UUIDs distintos.
3. Cerrar y reabrir el panel. Editar una página y guardar otra vez como `Session A`. Debe reutilizar la sesión, avisar de sustitución y aumentar solo la revisión de A, manteniendo B intacta. Un nombre nuevo conserva otra copia incluso desde otra sala.
4. En el perfil B o en otro dispositivo, entrar como GM autorizado, elegir **Restore private backup** y verificar el mismo email A con un código nuevo. Seleccionar `Session A` por nombre y fecha. Cancelar la revisión primero: el vault local debe seguir intacto. Reabrir, elegir `Session B` y confirmar: comprobar que se recupera exactamente B, con su contenido, orden e IDs. La lista solicita solo metadatos y el payload se lee únicamente al elegir una copia.
5. La restauración deja el acceso de jugadores desactivado. Reactivarlo expresamente desde los controles existentes y comprobarlo como Player. Los Players y Co-GMs no tienen controles de nube. El token de Notion de otro dispositivo se configura por separado.
6. En Settings, **Undo restore** debe devolver la copia local anterior. Si se hicieron ediciones después de restaurar, la reversión se detiene para protegerlas; conservar una exportación JSON antes de cualquier recuperación manual.
7. Abrir dos revisiones de sustitución del mismo nombre. Confirmar una y después la otra. La segunda debe mostrar conflicto y conservar la versión más reciente. Sustituir un nombre no modifica otro; dos altas simultáneas del mismo nombre tampoco crean dos filas.
8. Usar **Sign out** en B y acceder con email B. No debe aparecer la copia de A. Guardar con B crea su propia fila. Verificar el aislamiento también con peticiones directas a la Data API, nunca con `service_role`.
9. Probar código erróneo, caducado y reenvío; interrupción de red; espacio local insuficiente; cierre del panel durante una lectura; cambio de rol/sala durante revisión. Tras un timeout de guardado, usar **Check backup** antes de volver a escribir.

Al utilizar la misma sala desde otro dispositivo, liberar primero el ownership mediante el comportamiento actual de Owlbear. Esta función no toma el control de otro GM activo.

## Recuperación y desactivación

Antes de reemplazar un vault local se guarda y verifica su estado anterior. Una operación interrumpida muestra una elección local al reabrir; esa recuperación no necesita Supabase. Se mantiene una copia anterior por sala. **Undo restore** exige que el destino no haya sido editado desde la restauración.

**Clear local data** elimina los vaults y sus copias de recuperación locales, mantiene la sesión de nube y no borra ni descarga la copia remota. **Sign out** cierra solo la sesión de ese dispositivo y conserva los vaults. Para desactivar nuevas operaciones remotas, retirar `GM_VAULT_CLOUD_ENABLED=true` y volver a desplegar; el uso local y la recuperación local siguen disponibles.

La copia es privada mediante controles de acceso, no cifrado de extremo a extremo. Los operadores con privilegios del proyecto pueden acceder al contenido. Los documentos y recursos externos siguen dependiendo de sus propios orígenes.

## Validación del candidato

En esta implementación pasaron 865 pruebas de Jest en 79 suites y 59 comprobaciones de PostgreSQL con ambas migraciones reales. La comprobación inicial de interoperabilidad con el SDK oficial 2.119.2 usó 15 peticiones HTTP simuladas. La CI ejecuta la suite completa y las comprobaciones de PostgreSQL. El flujo con nombres añade pruebas de listado paginado sin payloads, selección por UUID, nombres no válidos, cancelación durante la lectura y conservación de otras copias.

La revisión del navegador recorrió acceso, código incorrecto, primera copia, sesión reutilizada, restauración y Undo en dos sesiones lógicas de QA, con email simulado, usando temas claro y oscuro y panel estrecho. La ruta local `/__dev/cloud?state=configured&profile=a` sirve exclusivamente para estas pruebas mediante `npm run dev`; su código simulado es `123456` y no envía emails. La extensión instalada desde el manifest siempre utiliza el servicio Supabase real cuando está configurado.

Antes de ampliar a varias copias, la preview 2.2.0 se instaló dentro de dos salas nuevas de Owlbear, `GM Vault 2.2.0 backup test` y `GM Vault 2.2.0 restore test`, usando el SDK y el servicio Supabase reales:

- Se recibió un código real por email, se verificó y se guardó la primera copia de 12 páginas y 6 carpetas del vault de ejemplo.
- La segunda sala empezó vacía. Reutilizó la sesión, leyó la copia remota y conservó su estado vacío al cancelar la revisión.
- Al confirmar, recuperó el mismo contenido y orden mostrados en la primera sala. Los 12 controles de acceso de jugadores quedaron desactivados.
- **Undo restore** devolvió la segunda sala a su estado vacío anterior.
- Se activó el acceso de jugadores de una página de prueba en la primera sala y se sustituyó la copia usando la sesión existente.
- Después de cerrar sesión en la segunda sala se solicitó y verificó un segundo código real. La copia actualizada se recuperó correctamente y los 12 controles de acceso de jugadores volvieron a quedar desactivados, incluida la página compartida.
- Una consulta de solo lectura confirmó una sola fila para esa cuenta, revisión `2` y esquema `1`.

El 22 de noviembre se repitió el ciclo con la ampliación de nombres desplegada en `abf06bc` y ambas migraciones aplicadas:

- Se guardó `Prueba 2.2.0 — sesión 1` con 12 páginas y 6 carpetas, y `Prueba 2.2.0 — sesión 2` con 13 páginas y 6 carpetas. Solo la segunda incluía la página de prueba `Diferencia de la sesión 2`.
- La segunda sala ofreció esas dos copias y `Previous backup` en el selector. Recuperar la sesión 1 dejó ausente la página adicional; recuperar la sesión 2 la mostró.
- Guardar otra vez con el nombre de la sesión 2 pidió confirmar su sustitución. Una consulta de solo lectura confirmó tres filas: copia anterior en revisión 2, sesión 1 en revisión 1 y sesión 2 en revisión 2. Las otras copias se conservaron.
- La Data API de `private_vault_backup_entries` rechazó la lectura sin sesión con HTTP 401 usando únicamente la clave pública.

Estas pruebas reales se hicieron con una cuenta y dos salas en el mismo navegador, reutilizando la sesión verificada. La prueba adicional desde otro dispositivo y la comprobación alojada con una segunda cuenta permanecen como QA recomendado; el aislamiento entre cuentas se comprobó en PostgreSQL embebido. No se publicaron cambios en el despliegue de producción.
