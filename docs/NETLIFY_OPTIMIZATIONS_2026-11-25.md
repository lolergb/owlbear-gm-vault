# Optimización preparada para GM Vault

Base: producción `3b93fb0725233bafe3c9579885b2f20bf96ced05`, confirmada en Netlify y recuperada de `origin/main`.
Rama de trabajo: `codex/reduce-netlify-requests`. La publicación en producción queda pendiente de autorización.

## Cambios

- `npm run build` genera `dist/` con esbuild. Las seis páginas cargan un JS minificado por página. La principal carga dos CSS locales, conservando el orden de la cascada y la posición de la hoja externa de Google Fonts.
- `/assets/*` tiene nombres con hash y `max-age=31536000, immutable`. HTML y manifest siguen revalidándose para descubrir nuevas versiones. El navegador puede reutilizar los assets sin una petición 304 mientras su caché los conserve.
- Se unifican imports que apuntaban al mismo archivo con distintas query strings. Los imports dinámicos locales quedan dentro del paquete de cada página, con inicialización diferida; no hay fragmentos locales que una sesión abierta necesite descargar después de otra publicación. Los SDK externos conservan sus URL y carga actuales.
- El build incorpora únicamente contexto, indicador beta, debug y SHA validado. Producción fuerza debug a false. La aplicación compilada deja de pedir `get-debug-mode` y el manifest para detectar beta; Owlbear sigue pudiendo consultar el manifest.
- La disponibilidad demo y la configuración pública de Mixpanel comparten solicitudes simultáneas y una caché de cinco minutos en `sessionStorage`, separada por origen, versión y endpoint. Solo se guardan campos permitidos. Los errores no entran en la caché y el código funciona si el navegador bloquea el almacenamiento.
- Mixpanel sigue requiriendo consentimiento. No se cachean credenciales de Notion, contenido, autenticación ni respuestas de backups. El token público de proyecto de Mixpanel conserva el mismo uso que antes.
- El directorio publicado usa una lista explícita de recursos. Se mantienen las URL antiguas de JS/CSS para sesiones anteriores y `/docs/store.md`, cuyo consumidor aún no está identificado. No se publica el repositorio completo.

Los HTML y CSS originales permanecen intactos: la compilación transforma las copias en `dist/`. Los endpoints antiguos también permanecen disponibles para clientes anteriores.

## Comparación local con la base de producción

| Carga principal | Producción base | Build preparado |
| --- | ---: | ---: |
| Peticiones JS locales del grafo estático inicial | 54 URL / 50 archivos | 1 |
| CSS locales, incluido el import de tokens | 8 | 2 |
| JS sin compresión | 900.083 bytes, suma del grafo | ~435.057 bytes |
| JS con gzip local | 227.842 bytes, suma por URL | ~120.098 bytes |

El paquete nuevo incluye además los módulos locales de backups antes diferidos. Los tamaños son una comparación local, no una captura de transferencia de Netlify. No incluyen HTML, imágenes, fuentes, SDK externos, otras páginas ni funciones. No equivalen a una reducción garantizada del tráfico total o de los créditos. El contenido de los archivos y la referencia del build pueden variar ligeramente sus tamaños.

## Validación

- `npm test -- --runInBand`: 84 suites, 947 pruebas correctas. Incluye arranque del JS minificado en JSDOM con SDK de Owlbear simulado, consentimiento, caché/TTL, fallos y almacenamiento bloqueado.
- `npm run test:build`: 7 pruebas correctas sobre las seis páginas, conservación del marcado, orden CSS, referencias a recursos, ausencia de fragmentos locales, hash estable, invalidación al cambiar versión y exclusión de secretos.
- `npm run test:cloud-db`: 71 comprobaciones PostgreSQL de aislamiento, permisos, límites y conflictos correctas.
- `git diff --check`: sin errores de formato.
- CI incorpora las pruebas del artefacto. Los resultados remotos y el estado del preview se consultan en la PR.

El compilador señala un método `trackContentTooLarge` duplicado que ya existía en producción. Se conserva su comportamiento (prevalece la última definición); no bloquea el build.

## Reproducir y revisar

```sh
npm ci
npm test -- --runInBand
npm run test:build
npm run test:cloud-db
npm run build
```

Usar Node 20.19 o posterior. `dist/` y `.build/` son salidas locales ignoradas por Git. El informe de módulos queda en `.build/metafile.json`. Netlify aporta `CONTEXT` y `COMMIT_REF`; sin ellos el build local usa producción y referencia `unknown`. El build no modifica `js/utils/buildRef.js` en el árbol fuente.

`DEBUG_MODE` debe estar disponible en el ámbito de build para activar debug de previews; cualquier cambio de ese indicador requiere recompilar. La configuración pública de demo/Mixpanel puede tardar hasta cinco minutos en refrescarse entre instancias/recargas de una pestaña. Las comprobaciones y credenciales del servidor siguen siendo la autoridad.

## Pendiente al autorizar publicación

La validación local no sustituye abrir la extensión real dentro de Owlbear y comprobar las cabeceras servidas por Netlify. Tras publicar, comprobar popover, background, visores, Notion y backups; observar carga en frío, reapertura y una actualización de versión. Comparar después una ventana representativa de 24 horas con la auditoría: peticiones, respuestas 304, funciones auxiliares, errores y transferencia. Hasta entonces, el consumo del sitio publicado no cambia.
