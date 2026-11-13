# Candidato 2.1.1: conservar los datos de v1

Base: `e8f1b8f` (2.1). Este candidato no contiene la reversión a v1 ni el
servicio de reconstrucción de metadatos preparado para aquella reversión.

## Cambio

Al abrir una sala, 2.1 eliminaba `pagesConfig`, `fullConfig`, `contentCache`
y `htmlCache` al registrar al GM propietario. Ahora solo actualiza
`com.dmscreen/vaultOwner`: conserva los demás metadatos y no copia el vault
privado a la sala.

El GM sigue cargando `notion-pages-json-<roomId>` desde el mismo dominio y
navegador. Conserva `notion-global-token`, identificadores, orden y visibilidad.
Si no existe una copia por sala, sigue admitiendo la copia antigua
`notion-pages-json-default`. El arranque no modifica ninguna de esas copias.
Un vault vacío guardado se respeta; no se sustituye por ejemplos.

La carga distingue una copia ausente de una ilegible. Si el JSON de la sala
está dañado o su estructura no es válida, se detiene antes de establecer el
propietario, sin cargar otro vault por defecto ni abrir una copia parcial que
pueda sobrescribir la original. Lo mismo se aplica al antiguo vault default.

## Salas que ya pasaron por 2.1

Con el GM conectado y su copia local intacta, 2.1 vuelve a compartir la lista
visible y atender solicitudes de contenido por broadcast. Ese flujo no necesita
los metadatos eliminados; no los repoblamos ni introducimos lectura offline.
Las páginas ocultas y el token no se incluyen en los mensajes para jugadores.

Esto no recupera datos cuyo único ejemplar estuviera en los metadatos borrados,
ni una copia local borrada o reemplazada después. Para esos casos hace falta el
navegador original u otra copia de seguridad. Si el contenido dependía de una
caché eliminada, se necesita poder volver a obtenerlo de su origen.

## Validación y publicación

Las pruebas de integración simulan clientes GM y Player conectados y usan los
servicios reales de carga y broadcast, con el SDK y el origen de contenido
simulados. Cubren una sala v1 intacta, una sala ya modificada por 2.1 y una sala
reabierta con v1 tras el rollback. Verifican lista y contenido compartido,
privacidad, copia local/token intactos y ausencia de borrados de metadatos.
También comprueban que no se incorpora un fallback offline para jugadores.

Ejecutar: `npm test -- --runInBand`.

La versión y las URLs de los módulos modificados pasan a `2.1.1` para
identificar el parche. Este documento no acredita un despliegue: hace falta
publicar el candidato en el mismo dominio de producción tras su revisión.
Las sesiones abiertas con código anterior necesitan recargarse para usarlo.
No se han modificado salas reales para probarlo.
