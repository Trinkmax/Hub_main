# Marketing — Tablero de tareas + Link público de la bio

> Dos cosas que hasta ahora vivían fuera del sistema: las tareas de marketing (en
> un grupo de WhatsApp y en la cabeza de una sola persona) y el link de la bio de
> Instagram (en un Biolink de terceros, con la marca de ellos abajo y editable
> sólo por quien tuviera esa contraseña suelta).

## Qué hay

| Ruta | Quién entra | Qué es |
|---|---|---|
| `/[slug]/tareas` | `owner` | El tablero compartido de los socios. |
| `/[slug]/enlaces` | `owner` | Editor del link de la bio, con vista previa en vivo. |
| `/l/[slug]` | **cualquiera, sin sesión** | La página pública que va en Instagram. |

Ambas entran por el grupo **Marketing** del sidebar y por el ⌘K
(`Tareas de marketing`, `Link de Instagram`, `Nueva tarea de marketing`).

---

## 1. Tablero de tareas — `/[slug]/tareas`

Cinco solapas. Las tres primeras son categorías reales de la DB; las otras dos
son vistas.

- **Eventos · Promociones · Impresiones** — el listado de tareas de esa sección,
  con el contador de lo que sigue abierto (todo lo que no está `Terminado`).
- **Orgánico** — el checklist semanal recurrente (ver abajo). No es una
  categoría de tarea: es otra tabla.
- **Mis tareas** — filtro por persona (arranca en vos) y por rol en la tarea:
  *Ambos · Responsable · Involucrado*.

Arriba, un buscador que filtra sobre título + especificaciones + comentarios,
sin tildes (`grabacion` encuentra `grabación`) y sin round-trip: todas las
tareas se traen de una sola vez y el filtrado es en el cliente.

### Los cajones de fecha

El listado no se ordena: se agrupa en cinco cajones colapsables —
**Fechas pasadas · Hoy · Esta semana · La próxima semana · Más adelante**.

El cajón sale de la **fecha efectiva** = `defined_date ?? ideal_date`:

- `ideal_date` es el deseo ("estaría bueno para el finde").
- `defined_date` es el compromiso ("sale el jueves") y manda sobre la ideal.
- Sin ninguna de las dos, la tarea es un pendiente sin compromiso → *Más adelante*.

Las ventanas son **móviles** (7 y 14 días desde hoy), no el calendario: un
martes, "esta semana" tiene que llegar hasta el lunes que viene y no morirse el
domingo. Todo se calcula en el reloj del bar (`America/Argentina/Cordoba`) y en
el **server** — `today` y la etiqueta de la semana viajan como props para que un
render a las 23:59 y la hidratación a las 00:00 no digan cosas distintas.

Ver `lib/marketing/week.ts` (puro, sin red) y `tests/lib/marketing-week.test.ts`.

### La tarjeta

Punto de color por estado, título (click = editar), especificaciones, y una fila
de metadatos: tipo de tarea, fecha, responsable, involucrado, *Con contexto* si
hay comentarios, y *Archivo* si hay link. A la derecha, el chip de estado abre un
menú con los cuatro estados —
**Por hacer · En proceso · Interrumpido · Terminado** — y el cambio se pinta
optimista (es el gesto más frecuente del tablero).

Marcar *Terminado* congela `completed_at` / `completed_by`; volver atrás los limpia.

### Orgánico (checklist semanal)

Lo que se repite **todas** las semanas: historias, reels, el mensaje al canal.
No son tareas — no tienen fecha ni responsable, tienen **cupo semanal**
("reels: 3 por semana") y se reinician solas cada lunes.

- La semana viaja por la URL (`?seccion=organico&semana=YYYY-MM-DD`) porque los
  tildes los trae el server. Se normaliza siempre al lunes.
- **Tildar = insertar la fila; destildar = borrarla.** No existe el estado
  "sin hacer": ni filas basura por cada rutina × semana que nadie tocó, ni un
  booleano que mantener.
- Barra de progreso con `hechas / total` de esa semana.
- Las rutinas se editan (nombre, detalle, veces por semana) y se borran. En el
  estado vacío hay un botón que carga un **checklist sugerido** genérico
  (`SUGGESTED_ROUTINES` en `lib/marketing/constants.ts`) para que un bar nuevo
  no arranque mirando una pantalla en blanco.

> El checklist real de HUB (Branca, Happy Hour, Stella, meriendas…) se cargó
> como **dato**, no en la migración: es contenido de ese bar, no del schema.

### Quién puede

`owner` y nadie más — es la mesa de los socios. Está enforceado en tres capas:
el sidebar (`roles: ['owner']`), la page (`requireRole(access.role, ['owner'])`)
y las policies de la DB (`user_role_in_tenant(tenant_id) = 'owner'`).

El combo Responsable / Involucrado sale del RPC **`get_marketing_team`**, que
cruza `memberships` con `auth.users` y `reservation_managers` para conseguir el
nombre real con el que se conocen entre ellos (`auth.users.full_name` casi
siempre viene vacío y `auth.users` no es accesible vía PostgREST). Excluye al
staff de salón: una tarea de marketing no se le asigna a un mozo.

---

## 2. Link público de la bio — `/l/[slug]`

Una sola página, papel crema y tinta forest, con el logo del bar arriba y los
botones abajo. El botón *destacado* se pinta sólido (para el destino que el bar
quiere empujar esta semana); el resto va en contorno.

- **Se ve siempre en claro** (`force-light` + `viewport.themeColor` único): es la
  vitrina del bar, no tiene por qué cambiar de color según el modo oscuro del
  celular de quien mira.
- `title: { absolute: … }` para escapar del template global `%s · HUB`.
- Todos los `<a>` van con `target="_blank" rel="noopener noreferrer"`: son links
  de terceros cargados por el bar.
- Si la página está apagada (`public_link_pages.active = false`) o el slug no
  existe → 404 con su propio `not-found.tsx`.

### El editor — `/[slug]/enlaces`

Arriba, la URL pública lista para pegar en Instagram con botón de copiar y
*Ver página*. Abajo, dos columnas:

- **Izquierda**: encabezado (título, bajada, interruptor de publicada) y la lista
  de botones — reordenar con flechas, prender/apagar sin borrar, editar, eliminar.
- **Derecha**: la **vista previa** dentro de un marco de celular, sticky. Usa el
  **mismo componente** que la página real (`components/public-links/link-page-view.tsx`)
  — es lo único que garantiza que la previa no mienta. En modo previa los botones
  se ven pero no navegan.

Las URLs se normalizan al guardar: quien pega `wa.me/549351…` obtiene
`https://wa.me/549351…`. Pero si el texto **ya trae un esquema**, no se toca —
prefijarle `https://` a un `javascript:alert(1)` lo convertiría en una URL
formalmente válida y el filtro lo dejaría pasar (`tests/lib/public-links-schemas.test.ts`).

---

## Datos

```
marketing_tasks            id, tenant_id, title, category, kind, status,
                           specifications, notes, file_url,
                           responsible_user_id, involved_user_id,
                           ideal_date, defined_date,
                           created_by, completed_at, completed_by
marketing_routines         id, tenant_id, title, description, slots, position, active
                           unique (id, tenant_id)  ← habilita la FK compuesta de abajo
marketing_routine_checks   id, tenant_id, routine_id, week_start, slot, completed_by
                           unique (routine_id, week_start, slot)
                           FK (routine_id, tenant_id) → marketing_routines (id, tenant_id)

public_link_pages          tenant_id (PK), headline, bio, active
public_links               id, tenant_id, label, description, url, icon,
                           highlight, position, active
```

Enums: `marketing_task_category` (eventos·promociones·impresiones),
`marketing_task_status` (todo·in_progress·blocked·done) y `marketing_task_kind`
(design·shoot·edit·script·ads·publish·print·coordinate·other). Claves en inglés
como el resto del schema; los labels en español viven en
`lib/marketing/constants.ts`.

**RLS**: las cinco tablas son `for all to authenticated` con
`public.user_role_in_tenant(tenant_id) = 'owner'`, más `revoke all … from anon`
(el proyecto arrastra default privileges que le regalan SELECT/INSERT a `anon`
en cada tabla nueva de `public`).

**La página pública no lee con `anon`**: la sirve un Server Component con
`createServiceClient()` filtrando por `tenant_id`, igual que `/carta`.
`public.tenants` tampoco es legible por `anon` y abrirlo sólo para esto
expondría `feature_flags`, teléfonos de feedback y config de puntos.

Migraciones: `20260903213046_marketing_tasks_board.sql` y
`20260903213113_public_links_bio_page.sql`.

---

## Ruta pública nueva: los tres lugares

Agregar `/l/` no fue una edición sino tres, y saltearse cualquiera rompe algo
distinto:

1. `PUBLIC_PREFIXES` en `lib/supabase/middleware.ts` — si no, el proxy exige
   sesión y manda a `/login`.
2. `RESERVED_SLUGS` en `lib/tenant/types.ts` — si no, un usuario logueado que
   entre a `/l/hub` cae en el ruteo por rol tratando `l` como slug de un bar.
3. El test `tests/lib/middleware-public-paths.test.ts`, que es el candado.

---

## Archivos

```
app/(manager)/[tenantSlug]/tareas/       page + loading + _components/
  _components/marketing-board.tsx        solapas, buscador, filtros, agrupado
  _components/task-card.tsx              tarjeta + menú de estado
  _components/task-dialog.tsx            alta/edición/borrado
  _components/organic-checklist.tsx      semana, progreso, casilleros
  _components/routine-dialog.tsx         alta/edición/borrado de rutinas
app/(manager)/[tenantSlug]/enlaces/      page + loading + _components/
  _components/links-manager.tsx          encabezado, lista, previa
  _components/link-dialog.tsx            alta/edición/borrado de botones
app/l/[tenantSlug]/                      page + not-found (pública)
components/public-links/link-page-view.tsx   ← compartido página real ↔ previa
components/ui/copy-button.tsx            (extraído: había 4 copias ad-hoc)
lib/marketing/{constants,week,schemas,queries,actions}.ts
lib/public-links/{schemas,queries,actions}.ts
tests/lib/{marketing-week,marketing-schemas,public-links-schemas}.test.ts
```
