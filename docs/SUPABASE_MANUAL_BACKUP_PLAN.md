# Plan de copia privada manual con Supabase para GM Vault

Estado: propuesta para revisión. Fecha: 21 de noviembre de 2026.

Añadir dos acciones en Settings, **Save private backup** y **Restore private backup**, para conservar una sola copia remota por cuenta. El email y el código de un solo uso se piden al elegir una acción cuando no hay sesión válida. Los usos posteriores aprovechan la sesión. La edición y persistencia local por sala siguen siendo el funcionamiento habitual.

## Base publicada verificada

La base de implementación será **`4703cad5ec50c10476ab9b65ce1e980a8c5dd8db`**, merge de la PR #25. La comprobación del 21 de noviembre de 2026, alrededor de las 21:11 CET, obtiene:

| Evidencia | Resultado |
| --- | --- |
| [Manifest de producción](https://owlbear-gm-vault.netlify.app/manifest.json) | `version: 2.1.5` |
| [Versión del cliente publicado](https://owlbear-gm-vault.netlify.app/js/utils/buildVersion.js) | `BUILD_VERSION = '2.1.5'` |
| [Referencia generada por el build publicado](https://owlbear-gm-vault.netlify.app/js/utils/buildRef.js) | `BUILD_REF = '4703cad5ec50c10476ab9b65ce1e980a8c5dd8db'` |
| [Metadatos Git del commit publicado](https://api.github.com/repos/lolergb/owlbear-gm-vault/git/commits/4703cad5ec50c10476ab9b65ce1e980a8c5dd8db) | Segundo padre: `d8e754748a47962ec2ff26910b1aba430df72731`; árbol: `965332ab7de83c75676cc86e3e71d521c4ba04da` |
| `git rev-parse 'd8e7547^{tree}'` en este checkout | El mismo árbol `965332ab7de83c75676cc86e3e71d521c4ba04da` |

`d8e7547` tiene el mismo contenido fuente, pero la referencia desplegada es el merge `4703cad5`. El archivo `buildRef.js` se genera durante el build mediante `scripts/write-build-ref.mjs`; esa diferencia generada es esperable. Crear la rama de implementación desde el SHA publicado y registrar otra vez producción antes de publicar el candidato.

## Alcance y comportamiento local

- Una cuenta Supabase tiene un único espacio de copia. Guardar desde cualquier sala actualiza ese mismo espacio, con confirmación si ya existe una copia. La interfaz explicará que las salas comparten esa única copia.
- Las acciones están disponibles para el GM que puede gestionar el vault activo. Players, Co-GMs y visores auxiliares quedan fuera de esta primera entrega. La cuenta Supabase es independiente de la identidad de Owlbear y del token de Notion.
- Guardar y recuperar son acciones manuales. Abrir la extensión, iniciar sesión, editar páginas, cambiar de sala o recuperar una copia no guardan ni descargan el vault automáticamente.
- El arranque conserva la secuencia actual: recuperación beta existente, copia local de sala, fallback antiguo `notion-pages-json-default` cuando corresponda y estado inicial. En 2.1.5 el primer uso abre vacío y **Load example vault** carga los ejemplos bajo demanda. Ambas opciones siguen disponibles sin cuenta Supabase.
- Un vault vacío guardado localmente sigue siendo válido. Un vault local ilegible conserva su error y sus bytes originales; no se sustituye por ejemplos ni por una copia remota.
- Importación, exportación JSON, acceso de jugadores y enlaces a mapas/tokens mantienen sus rutas actuales. Los originales de ejemplos y templates permanecen intactos.

Fuera de alcance: sincronización automática, catálogo de vaults, historial remoto, colaboración en nube, compartir copias por URL, nuevas políticas de ownership de Owlbear y migración de datos del prototipo multivault. Mantener `codex/cloud-vaults-p0` y cualquier trabajo multivault en sus ramas y entornos; no incorporarlos a esta PR ni usarlos como base de implementación.

## Contenido de la copia

Guardar una instantánea de la configuración del vault activo, equivalente al backup JSON actual, dentro de un contrato `schema_version: 1`. Conservar IDs, páginas raíz, carpetas anidadas, orden, iconos, filtros, audiencia configurada y `htmlContent` embebido. Verificar la ida y vuelta con los serializadores existentes para evitar pérdidas silenciosas.

Excluir el token de Notion, sesiones Supabase, email, cachés de contenido e imágenes, consentimiento de analytics, datos de otras salas, ownership y metadatos de escenas. Los documentos externos siguen dependiendo de sus orígenes; esta copia no descarga sus archivos. Conservar IDs permite resolver enlaces ya existentes en la misma sala, pero no recrea mapas o tokens en otra sala.

Proponer un máximo inicial de **2 MiB de JSON UTF-8**, validado en cliente y servidor. Un vault vacío no podrá crear ni reemplazar la copia remota en esta primera entrega, en coherencia con la importación de backups actual. La aplicación debe explicar ambos límites antes de enviar datos.

La privacidad se basa en HTTPS y autorización por usuario mediante RLS. El contenido será accesible para operadores con privilegios del proyecto; esta propuesta no incorpora cifrado de extremo a extremo. Los secretos de conexión de Notion siguen siendo locales.

## Acceso con email y código

1. Al pulsar guardar o recuperar, cargar el módulo de nube y su configuración pública. Si existe sesión válida, mostrar la cuenta utilizada y continuar con la revisión de la operación.
2. Si falta sesión, pedir email con el texto de propósito: guardar y recuperar una copia privada. Permitir cancelar y seguir trabajando localmente.
3. Solicitar el código mediante `signInWithOtp`. Permitir crear cuenta durante este paso tanto para guardar como para recuperar; una cuenta nueva que intenta recuperar verá el estado de copia inexistente. Esto evita introducir un flujo separado de registro.
4. Verificar el código con `verifyOtp({ email, token, type: 'email' })`. La verificación abre la revisión de la acción pendiente; no sustituye su confirmación final.
5. Mantener la sesión con el almacenamiento y renovación del SDK, en una clave propia del proyecto y del entorno. Configurar `persistSession`, `autoRefreshToken` y desactivar detección de sesión en URL para este flujo por código. Inicializar el cliente solo al usar nube; su carga o renovación no bloquean el arranque local.
6. Ofrecer **Sign out** para este dispositivo y cambiar de cuenta. Cancelar operaciones pendientes y descartar cualquier payload remoto en memoria al salir o cambiar de usuario. El cierre de sesión no borra la copia remota ni el vault local. Un nuevo dispositivo realiza su propia verificación por email.

Gestionar una sola instancia del cliente por contexto activo y probar reapertura del popover, renovación y pestañas concurrentes. Ante almacenamiento bloqueado, permitir sesión en memoria durante ese uso y explicar que habrá que introducir un código la próxima vez. Una sesión inválida vuelve al paso de acceso cuando se elige una acción; un fallo de red ofrece reintento sin borrar automáticamente la sesión.

Supabase diferencia el código del enlace de acceso mediante el contenido del email. El proyecto nuevo de esta función debe configurar un mensaje con código y verificación dentro de la extensión. La documentación describe `signInWithOtp`, `verifyOtp` y esa configuración en [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless); la persistencia y renovación se apoyan en [User sessions](https://supabase.com/docs/guides/auth/sessions).

### Entrega del código

Configurar **SMTP propio antes de probar con usuarios externos o publicar**: proveedor, remitente de GM Vault, dominio autorizado y SPF, DKIM y DMARC. El SMTP de prueba de Supabase restringe los destinatarios a miembros del equipo y no sirve como entrega de producción. Véase [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

El mensaje será exclusivamente de acceso, con código, caducidad y la indicación de ignorarlo si no se solicitó. Usar un proyecto nuevo y una configuración de email propia, sin modificar templates existentes. Proponer caducidad de 10 minutos y reenvío tras 60 segundos, ajustados a los límites efectivos del proyecto y del proveedor. Aplicar los límites del servidor a solicitudes y verificaciones; el contador de la interfaz es solo una ayuda. Probar entrega real, spam, rechazo y retraso con dos buzones externos antes de dar por válida la función.

## Flujos de guardado

### Primera copia

1. Comprobar que el contexto actual es un GM autorizado, con sala conocida y vault válido. Preparar una instantánea sin credenciales.
2. Resolver el acceso y consultar la fila del usuario. La ausencia de fila se distingue de un error de consulta.
3. Mostrar cuenta, número de páginas y carpetas, tamaño y aviso de copia única. Confirmar con **Save private backup**.
4. Volver a comprobar usuario, sala, rol y cambios locales durante el acceso o la revisión. Si cambiaron, cancelar o reconstruir la revisión.
5. Crear mediante `INSERT`. Si otra sesión ya creó la fila, volver al flujo de actualización y pedir revisión; no usar un `upsert` que la sustituya silenciosamente.
6. Confirmar únicamente cuando el servidor devuelve la fila guardada y su revisión. El vault local permanece como estaba.

### Actualización de una copia existente

1. Leer la revisión y fecha de la copia actual. Mostrar **Replace private backup**, la cuenta y los resúmenes de la copia existente y de la nueva instantánea. Advertir que no hay historial remoto.
2. Tras confirmar, actualizar solo si la revisión sigue siendo la leída: `UPDATE ... WHERE user_id = auth.uid() AND revision = expected_revision`.
3. Cero filas actualizadas significa conflicto. Leer el estado actual y volver a pedir revisión. Nunca resolverlo con sustitución automática por la última escritura.
4. Ante timeout tras enviar, consultar el identificador de escritura de la operación. Si coincide, confirmar el guardado; si no puede determinarse, mostrar **Could not confirm backup** y permitir comprobar de nuevo. No repetir a ciegas una escritura.

## Restauración segura en otro dispositivo

1. Abrir Owlbear como GM autorizado y elegir **Restore private backup**. Pedir email y código si hace falta; no intentar recuperar nada durante el arranque.
2. Descargar solo la fila propia. Validar versión del contrato, tamaño, estructura y preflight con `ConfigParser` antes de tocar almacenamiento o UI. Rechazar una versión futura incompatible; los avisos de pérdida deben mostrarse y aceptarse expresamente.
3. Mostrar fecha y resumen remoto, cuenta y sala de destino, junto al resumen local. La única operación inicial será reemplazar el vault de esa sala; conservar las opciones de combinar o añadir en la importación JSON existente.
4. Informar de que el token de Notion no viene incluido. Conservar el token local si existe y permitir configurar uno después. Restaurar la estructura no debe depender de tener un token válido.
5. Preparar una copia local de recuperación del estado anterior, incluidos los bytes originales y la distinción entre clave ausente y vault vacío. Verificar esa escritura antes de reemplazar. Si no hay espacio para conservarla, abortar conservando el vault actual.
6. Revalidar identidad, rol, ownership y sala. Bloquear cambios del vault en esta instancia durante el commit y detectar cambios locales mientras la revisión estaba abierta. Si el destino cambió, exigir una revisión nueva. No reclamar automáticamente el ownership a otro GM activo.
7. Aplicar primero la persistencia local y comprobar su lectura. Solo después actualizar modelo, builder, renderers y vista, y comunicar los cambios de sala. No invocar directamente el flujo actual de importación: `saveConfig` cambia memoria antes de saber si se guardó, y `_applyJsonImport` también marca el origen y transforma el formato.
8. Al restaurar, desactivar el acceso de jugadores mediante `playerAccessEnabled: false` en todas las páginas, conservando su audiencia configurada. Explicarlo en la revisión y en el resultado. El GM revisa y vuelve a habilitar el acceso con los controles existentes; ningún broadcast publica contenido privado durante la aplicación.
9. Mantener una sola copia local anterior por sala con **Undo restore**. La reversión también verifica persistencia antes de cambiar la UI. Un marcador local de operación pendiente permite resolver una interrupción al reabrir, sin consultar Supabase ni convertir la nube en una dependencia del arranque.

Si falla la escritura, conservar o recuperar los bytes originales y no emitir broadcasts. Si falla la comunicación con Owlbear después de guardar, informar de **Vault restored locally; room update failed** y permitir reintentar esa comunicación. No presentar el vault como perdido ni repetir la restauración. Una recuperación nunca modifica la copia remota.

## Datos y aislamiento por usuario

Usar Supabase Auth y una tabla Postgres `private_vault_backups`; no hacen falta Storage, Realtime ni un proxy de vaults en Netlify para este alcance.

| Campo | Contrato propuesto |
| --- | --- |
| `user_id` | UUID, clave primaria, referencia a `auth.users(id)` con borrado en cascada; un único registro por usuario |
| `schema_version` | Versión del formato de copia, inicialmente `1` |
| `payload` | JSONB del vault, con comprobaciones de estructura y tamaño |
| `revision` | Entero creciente, inicializado e incrementado por el servidor |
| `updated_at` | Fecha asignada por el servidor |
| `last_write_id` | UUID de la operación para comprobar respuestas de escritura perdidas |

La migración crea conjuntamente permisos, RLS, restricciones y trigger de metadatos. Revocar permisos por defecto y dar a `authenticated` solo `SELECT`, `INSERT` y `UPDATE` necesarios; `anon` no accede. Las políticas de lectura y actualización usan `auth.uid() = user_id`; inserción y actualización incluyen `WITH CHECK` con esa condición. Impedir cambiar el propietario y fijar la revisión y fecha en servidor, aunque el cliente intente enviarlas. No habilitar autenticación anónima para esta función.

El filtro del cliente mejora la consulta, pero la separación se exige en la base de datos. La clave pública o publishable puede estar en el cliente; nunca una `service_role`, una clave secreta ni credenciales SMTP. No crear vistas o funciones privilegiadas que eludan estas reglas. Probar también solicitudes directas a la API con otro `user_id`, sin depender de los botones. Base técnica: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Integración y secuencia de implementación

| Paso | Cambios previstos | Resultado revisable |
| --- | --- | --- |
| 1 | Rama desde `4703cad5`; proyecto Supabase de pruebas y SMTP propio; migración en `supabase/migrations/` y pruebas en `supabase/tests/` | Dos cuentas aisladas y entrega real del código |
| 2 | `CloudBackupService` y cliente Supabase cargados bajo demanda; configuración pública habilitable mediante una función pequeña `get-cloud-config` | Acceso y operaciones remotas verificables, sin alterar `saveConfig` ni `_loadConfig` por dependencia de nube |
| 3 | Nuevo diálogo para acceso, revisión y resultado; dos acciones en Settings; hooks acotados en `ExtensionController` | Primera copia y actualización con control de conflictos |
| 4 | Helper local de aplicación y recuperación, con comprobación de escritura en `StorageService`; aviso de operación local pendiente al arrancar | Restauración y reversión verificadas antes de cambiar memoria o emitir contenido |
| 5 | Pruebas de regresión, dos perfiles y Owlbear; actualización de documentación de usuario y checklist de publicación | Candidato para revisión y Deploy Preview |

Fijar una versión explícita del SDK ESM compatible con el proyecto estático actual. Resolver errores de importación del módulo dentro de la acción de nube para que un proveedor o CDN inaccesible no impidan el uso local. Las nuevas claves de sesión y recuperación tendrán prefijos propios; revisar expresamente su relación con **Clear local data**. Limpiar datos locales no borra la nube ni dispara una restauración automática; el cierre de sesión tiene su control independiente.

Preview y producción usarán proyectos y claves de sesión separados. La configuración pública incluirá un interruptor de disponibilidad; desactivarlo detiene nuevas operaciones remotas y conserva el uso local y la recuperación local pendiente. Antes de publicar, repetir la comprobación del commit de producción, registrar el rollback y ejecutar el checklist existente. Esta entrega inicial contiene únicamente el plan; la implementación y la publicación son pasos posteriores.

## Errores y mensajes

| Situación | Respuesta y conservación de datos |
| --- | --- |
| Email inválido | Corregir el campo antes de solicitar el código |
| Código incorrecto, usado o caducado | Permitir corregir o pedir otro; no tocar ninguna copia |
| Reenvío limitado o error SMTP | Mostrar espera o fallo de envío y permitir reintento; una respuesta de Auth no acredita entrega al buzón |
| Sesión inválida o cuenta cambiada | Cancelar revisión pendiente y volver al acceso; no reutilizar payloads de la cuenta anterior |
| Red caída o Supabase indisponible | Conservar estado local y remoto; ofrecer reintento manual |
| No existe copia | Mostrar **No private backup found**; no crear ni restaurar un vault vacío |
| Copia incompatible, corrupta o demasiado grande | Detener antes de escribir; conservar ambas copias |
| Revisión remota cambiada | Mostrar conflicto y pedir revisión nueva |
| Sala, rol o destino local cambiados | Cancelar commit y reconstruir la revisión cuando el contexto sea válido |
| Cuota o escritura local fallida | Abortar sin actualizar memoria o broadcasts; conservar recuperación anterior |
| Respuesta perdida después de guardar | Comprobar `last_write_id` antes de declarar éxito o volver a escribir |

Los diagnósticos usarán códigos acotados de operación y fallo. No registrar email, OTP, JWT, refresh token, token de Notion, JSON, nombres, URLs ni cuerpos completos de respuestas. La funcionalidad no depende del consentimiento de analytics; cualquier telemetría opcional respeta el consentimiento actual.

## Pruebas y criterios de aceptación

Las pruebas siguientes pertenecen a la implementación. La verificación realizada para este plan acredita la base publicada y el comportamiento leído en el código, no el funcionamiento de una integración Supabase ya construida.

### Pruebas automatizadas

- Ejecutar `npm test -- --runInBand`, cubriendo el arranque, el vault vacío, ejemplos, fallback v1, recuperación beta, importación/exportación, token local, privacidad de broadcasts y enlaces de escena existentes.
- Probar los servicios nuevos: cuenta nueva y sesión reutilizada, cancelación, cambio de cuenta durante petición, doble clic, expiración, conflictos entre dispositivos y timeout con resultado incierto.
- Probar ida y vuelta de páginas raíz, carpetas y orden mixto, IDs, HTML embebido y audiencias. Confirmar ausencia de credenciales en payload y logs y acceso desactivado tras restaurar.
- Simular cuota, fallo de escritura y lectura posterior, interrupción entre fases, cambio de sala/rol y cambios locales durante la revisión. Comprobar bytes anteriores, modelo y ausencia de broadcasts antes del commit; verificar **Undo restore** y reapertura con operación pendiente.
- Ejecutar `supabase test db`: anónimo rechazado; A y B pueden operar solo su fila; A no lee ni escribe la fila B ni cambia su propietario; dos inserciones no crean dos copias; dos actualizaciones con la misma revisión no triunfan ambas; metadatos y límites se aplican en servidor.
- Verificar que arrancar, editar o limpiar datos locales no dispara operaciones de backup, y que el fallo de carga del SDK afecta solo a la acción remota.

### Dos perfiles y Owlbear real

| Escenario | Comprobación exigida |
| --- | --- |
| Perfil A limpio, sin sesión | Arranque local, **Add page** y **Load example vault** sin pedir email ni depender de Supabase |
| A con cuenta A y vault de prueba | Código recibido en buzón externo; primera copia confirmada; cerrar y reabrir el popover y actualizar sin otro código mientras la sesión sea válida |
| Perfil B limpio, misma cuenta A | Pedir su propio código; recuperar manualmente, revisar destino, conservar IDs y no publicar páginas; configurar Notion por separado |
| A y B con la misma cuenta | Abrir ambas revisiones, guardar desde A y confirmar desde B: conflicto sin pérdida; probar también guardar desde otra sala |
| B cambia a cuenta B | Sin acceso a copia A, tampoco por API directa; crea su propia copia y A permanece intacta |
| B con vault local diferente | Cancelar preserva todo; restaurar conserva copia anterior; **Undo restore** recupera el vault previo |
| Dentro del iframe de Owlbear | Email, pegado del código, foco, cancelar, reenvío, cierre/reapertura y persistencia con las restricciones reales del navegador |
| GM, Player y Co-GM en sala de prueba | Sin controles de nube para Player/Co-GM; sin secretos en metadatos/broadcasts; compartir solo al reactivarlo expresamente; respetar otro GM propietario activo |
| Red bloqueada y sesión caducada | Mensajes recuperables; edición local, ejemplos y exportación siguen disponibles cuando sus propios orígenes estén accesibles |
| Regresión 2.1.5 | Ver y enlazar páginas a mapas y tokens, contenido externo y compartición actual siguen funcionando |

Usar salas y datos de prueba. Para recuperar en la misma sala desde otro dispositivo, liberar antes el ownership mediante el comportamiento existente; esta función no añade un mecanismo de toma de control. Registrar navegador, perfil, cuenta de prueba, entorno, commit, resultado y evidencia sin secretos. Aceptar el candidato solo cuando pasen el aislamiento real entre cuentas, la entrega real de OTP y la restauración dentro de Owlbear.

## Decisiones propuestas para revisión

Confirmar este alcance de una copia única, acceso por OTP bajo demanda y operaciones manuales, junto con tres decisiones de producto: excluir el token de Notion, reactivar el acceso de jugadores manualmente tras recuperar y limitar inicialmente la copia a 2 MiB. La implementación deberá concretar el proyecto Supabase, el remitente SMTP y sus límites efectivos en el entorno de pruebas antes de publicar un candidato.
