# Marketing — Páginas HTML del bar (`/p/[slug]`)

> El encargado de marketing arma landings a mano (HTML + CSS) para cada evento,
> promo o carta especial. Hasta ahora no tenía dónde publicarlas: terminaban en
> un hosting gratuito con dominio ajeno y publicidad encima, o directamente no
> se hacían. Ahora las sube al panel y quedan en `hubbar.com.ar/p/lo-que-sea`,
> con un link corto listo para pegar en una historia.

## Qué hay

| Ruta | Quién entra | Qué es |
|---|---|---|
| `/[slug]/paginas` | `owner` | La lista: link, estado, visitas, última edición. |
| `/[slug]/paginas/[pageId]` | `owner` | El editor: código, previa en vivo, imágenes, historial. |
| `/p/[pageSlug]` | **cualquiera, sin sesión** | La landing publicada, servida tal cual. |

Entra por el grupo **Marketing** del sidebar (`Páginas`) y por el ⌘K
(`Páginas`, `Nueva página HTML`).

---

## 1. Lo importante: por qué el HTML va sandboxeado

Esto no es un detalle de implementación, es **la razón por la que la feature es
segura** y hay que entenderlo antes de tocar nada.

El HTML lo escribe una persona (no nosotros) y se sirve desde el **mismo
dominio que el panel**. Las cookies de sesión de `@supabase/ssr` se setean con
`httpOnly: false` por diseño —el cliente del browser necesita leerlas—, así que
un `<script>` copiado de cualquier tutorial dentro de una landing podría hacer
`document.cookie` y llevarse la sesión completa de quien la abra: el dueño de
otro bar, un superadmin, cualquiera.

La defensa es un header:

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
  allow-popups-to-escape-sandbox allow-modals allow-downloads;
  frame-ancestors 'none'
```

Sin `allow-same-origin`, el documento queda en un **origen opaco**:
`document.cookie`, `localStorage`, `indexedDB` y `fetch` con credenciales tiran
`SecurityError`, y las cookies `SameSite=Lax` (las nuestras) ni siquiera viajan
en sus requests. Es lo que recomienda Google para hostear contenido de usuarios
y lo que hace hoy `raw.githubusercontent.com`.

**Lo que el sandbox NO rompe** (verificado): Google Fonts, scripts de CDN
(GSAP, Alpine…), imágenes externas, iframes de YouTube, formularios a servicios
externos, animaciones, `fetch` a APIs con CORS abierto.

**Lo que sí rompe, y por eso la pantalla avisa:**

| Cosa | Qué pasa |
|---|---|
| `localStorage` / `sessionStorage` / `document.cookie` | **Tiran excepción** (no devuelven vacío): el script se corta ahí y la landing queda a medio armar. |
| Google Analytics (`gtag`) | Falla en silencio: cero visitas, cero errores. Por eso el contador propio. |
| `Referer` saliente | No se manda. Para atribuir clicks a partners, usar UTMs. |
| Embeds que necesitan cookies | Cargan, pero degradados (YouTube pierde "reanudar", etc.). |

**Lo que el sandbox no tapa:** `history.pushState` puede reescribir la barra de
direcciones a otra ruta del mismo dominio. Por eso la sección es **sólo del
dueño** y cada publicación queda en `audit_log`.

El header vive en `lib/landings/security.ts` y se aplica **dos veces a
propósito**: en `next.config.ts` (que gana siempre — Next descarta el header del
`Response` si la config ya seteó esa key) y en el Route Handler. Si alguien
borra uno, el otro sigue de pie. `tests/lib/landing-security.test.ts` es el
candado: se pone en rojo si desaparece el sandbox o si alguien agrega
`allow-same-origin` para "arreglar" el `localStorage` de una landing.

---

## 2. El editor — `/[slug]/paginas/[pageId]`

Tres solapas a la izquierda y la previa a la derecha (arriba, en celular).

- **Código** — un textarea monospace. Se puede pegar, arrastrar un archivo
  `.html` encima o subirlo con el botón. `⌘S` / `Ctrl+S` guarda. Arriba a la
  derecha, el peso contra el techo de 512 KB.
- **Imágenes** — la galería del bar (ver abajo).
- **Historial** — visitas + las últimas 20 versiones.

### La previa no puede mentir

El `<iframe>` de la previa usa **exactamente los mismos flags de sandbox** que
la página publicada (`LANDING_PREVIEW_SANDBOX`, comparado con `LANDING_CSP` en
un test). Si algo no anda online, tampoco anda en la previa — que es
justamente lo que hace que sirva.

Dos modos: **celular** (390 px, con marco) y **escritorio** (renderiza a 1280 px
y lo achica con `transform: scale` midiendo la columna, porque mostrar una
página de escritorio en una columna de 380 px sin escalar daría una vista
mobile, o sea lo contrario de lo que se quiere revisar).

### La revisión rápida

Debajo de la previa, `lib/landings/checks.ts` (función pura, sin DOM) marca lo
que rompe una landing sin dar ningún error visible mientras la editás:

| Aviso | Nivel | Por qué |
|---|---|---|
| Falta `<meta viewport>` | error | En el celular se ve la versión de escritorio en miniatura, y casi todo el tráfico entra desde Instagram. |
| Rutas relativas (`img/hero.jpg`, `/fotos/a.png`) | error | Esas carpetas están en la compu de quien escribió el HTML, no en hubbar.com.ar. Sólo salen ilesas las URLs absolutas, `data:`, `#ancla` y `/p/otra-pagina`. |
| `localStorage` y compañía | error | Ver arriba: cortan el script. |
| Falta `<!DOCTYPE html>` / `<title>` | aviso | Modo compatibilidad y preview feo al compartir. |
| Recursos por `http://` | aviso | El navegador los bloquea en una página https. |
| `gtag` / Analytics | aviso | No cuenta nada dentro del sandbox. |
| `document.write` | aviso | Si corre tarde, borra la página entera. |
| Falta `<meta charset>` / código > 300 KB | tip | Acentos rotos; página lenta en 4G. |

### Guardar es publicar (y por eso existe el historial)

`landing_pages.html` **es lo que está en vivo**. No hay borrador aparte:
mientras la página está apagada no la ve nadie, y una vez publicada, guardar es
publicar (el botón lo dice: *Publicar cambios*). Publicar con cambios sin
guardar guarda primero — publicar la versión vieja sería el peor default.

Cada guardado que cambia algo deja una versión (`Guardada` / `Publicada` /
`Restaurada`) y se podan las que pasan de 20. En el historial, *Ver* la carga en
la previa con una banda arriba y *Restaurar* la trae al editor.

Dos guardas para no perder trabajo, porque el buffer del editor no está en
ninguna base hasta que se guarda:

- **Restaurar con cambios sin guardar los guarda primero** (quedan como una
  versión más) y recién después restaura. Si no, el diálogo prometía que "lo que
  tenés ahora queda guardado en el historial" y era mentira.
- **Volver al listado con cambios sin guardar pregunta** (Seguir editando /
  Guardar y salir / Salir sin guardar). `beforeunload` sólo cubre cerrar la
  pestaña; la navegación del App Router pasa de largo.

El listado del historial **no baja el HTML**: usa la columna generada
`size_chars` (migración `20260905140000`). Traer los 20 documentos para calcular
los KB eran hasta 10 MB por render, y la ruta es `force-dynamic`.

### Ajustes

Nombre interno, link y **"Que Google la encuentre"** (`indexable`, apagado por
default). Apagado, el handler manda `X-Robots-Tag: noindex, nofollow`: una
landing a medio hacer no tiene por qué quedar pegada al dominio del panel, cuya
reputación es compartida con el login del bar. Cambiar el link de una página ya
publicada avisa explícitamente que el anterior deja de funcionar.

---

## 3. Las imágenes — bucket `landing-media`

Suben **desde el browser** (`lib/landings/media.ts`), no por Server Action: el
body de una action tiene 1 MB y una foto de celular pesa cuatro veces eso. La
sesión del dueño más las policies del bucket (una carpeta por `tenant_id`) son
las que autorizan.

- Se achican a 1600 px y se reencodean a AVIF → WebP → JPEG (se reusa
  `processImageForUpload` de la carta).
- **Los GIF van tal cual**: pasarlos por el canvas los dejaría en un cuadro.
- Bucket público con allowlist de MIME (`webp, avif, jpeg, png, gif`) y techo de
  10 MB. **Sin SVG a propósito**: es contenido activo, no una imagen.
- Cada imagen tiene *Insertar* (mete un `<img>` en la posición del cursor, con
  `max-width:100%` para que no desborde en el celular) y *Copiar link*.

---

## 4. Las visitas

Google Analytics no funciona adentro del sandbox, así que el contador es
nuestro y es server-side: el Route Handler llama a `bump_landing_view(page_id)`,
que en **una sola sentencia atómica** suma al total y al rollup del día — el día
resuelto en la zona horaria del bar, para que una visita de la 1 AM del sábado
cuente como sábado.

Dos detalles que importan:

- El trigger de `updated_at` tiene una cláusula `WHEN` que **excluye** las
  columnas del contador. Si no, el panel diría "editada hace 2 minutos" cada vez
  que entra un visitante. **Si en el futuro se agrega una columna editable a
  `landing_pages`, hay que sumarla a ese `WHEN`.**
- La función es `security definer` y no tiene `execute` para `anon` ni
  `authenticated`: sólo la llama el server con `service_role`. Nadie puede
  inflar el contador desde afuera.

La respuesta va con `Cache-Control: no-store` a propósito: sin eso el CDN
serviría la página sin pasar por el origen y el contador mentiría, además de
demorar los cambios que el dueño espera ver al toque en el celular.

---

## Datos

```sql
landing_pages          -- id, tenant_id, slug UNIQUE GLOBAL, title, html,
                       -- published, indexable, views, last_viewed_at,
                       -- published_at + unique (id, tenant_id)
landing_page_versions  -- id, tenant_id, page_id, html, label, created_by
                       -- FK compuesta (page_id, tenant_id)
landing_page_views     -- tenant_id, page_id, day, views  PK (page_id, day)
bump_landing_view(uuid)-- suma total + día, atómico, sólo service_role
```

- **El slug es único en TODA la plataforma**, no por bar: `/p/promo` no lleva el
  bar adentro. Mismo criterio que `customer_capture_links.slug`. El editor
  chequea disponibilidad antes (con `service_role`, devolviendo sólo un
  booleano) y el `unique` de la DB es la verdad final: un `23505` se traduce a
  "ese final de link ya está usado".
- Las tres tablas son **owner-only** (`user_role_in_tenant(tenant_id) = 'owner'`)
  y ninguna tiene grant a `anon`: la página publicada la sirve el handler con
  `service_role` filtrando por `slug` + `published`.
- Las FK son **compuestas** `(page_id, tenant_id)`: RLS filtra filas al leer,
  no valida valores al escribir, así que sin esto una versión podría colgar de
  la página de otro bar.
- El HTML tiene techo de 512 KB en el CHECK y en zod. En Postgres `length()`
  cuenta caracteres y en JS `.length` cuenta unidades UTF-16 (más, para los
  emojis): si pasa zod, pasa el CHECK.

---

## Ruta pública nueva: los tres lugares

Igual que con `/l/`, agregar `/p/` fueron tres ediciones y saltearse cualquiera
rompe algo distinto:

1. `PUBLIC_PREFIXES` en `lib/supabase/middleware.ts` — si no, el proxy exige
   sesión y quien abre la landing desde Instagram cae en `/login`.
   (También está en `MACHINE_PREFIXES`: la landing es anónima, no hace falta ni
   instanciar el cliente de Supabase en el proxy.)
2. `RESERVED_SLUGS` en `lib/tenant/types.ts` — si no, un usuario logueado que
   entre a `/p/promo` cae en el ruteo por rol tratando `p` como slug de un bar.
3. El test `tests/lib/middleware-public-paths.test.ts`, que es el candado.

Y una cuarta, propia de esta feature: el bloque de headers de `/p/:slug*` en
`next.config.ts` **tiene que ir después** del `/:path*` general, porque en Next
gana la última definición para la misma key.

---

## Smoke manual

```bash
# 1. Publicá una página desde el panel con este HTML mínimo y guardá.
#    <!doctype html><html lang="es-AR"><head><meta charset="utf-8">
#    <meta name="viewport" content="width=device-width, initial-scale=1">
#    <title>Prueba</title></head><body><h1>Hola</h1></body></html>

# 2. Los headers tienen que salir así (UN solo CSP, con sandbox):
curl -sI https://hubbar.com.ar/p/<slug> | grep -iE \
  'content-type|content-security-policy|x-robots-tag|referrer|cross-origin|cache-control'

# 3. En la landing publicada, consola del navegador:
#    document.cookie  → SecurityError
#    localStorage     → SecurityError

# 4. Apagá "Publicada" → /p/<slug> tiene que dar 404.
# 5. Prendé "Que Google la encuentre" → desaparece el X-Robots-Tag.
```

Pendiente de probar en **Safari iOS** (todo el testeo empírico del sandbox fue
en Chrome; la spec dice lo mismo y MDN lo marca Baseline desde 2016, pero el
tráfico real del bar entra por ahí).

---

## Archivos

```
app/(manager)/[tenantSlug]/paginas/           page + loading + _components/
  _components/pages-list.tsx                  lista, duplicar, borrar
  _components/new-page-dialog.tsx             alta (nombre → slug sugerido)
app/(manager)/[tenantSlug]/paginas/[pageId]/  page + loading + _components/
  _components/landing-editor.tsx              barra, estado, guardar/publicar
  _components/preview-panel.tsx               iframe sandbox + revisión
  _components/media-panel.tsx                 galería de imágenes
  _components/history-panel.tsx               visitas + versiones
  _components/settings-dialog.tsx             nombre, link, indexable
app/p/[slug]/route.ts                         la landing publicada (HTML crudo)
lib/landings/security.ts                      ← los headers, en un solo lugar
lib/landings/{schemas,checks,queries,actions,media}.ts
supabase/migrations/20260905120000_landing_pages.sql
supabase/migrations/20260905140000_landing_version_size.sql
tests/lib/{landing-checks,landing-schemas,landing-security}.test.ts
tests/rls/landings.test.ts
```
