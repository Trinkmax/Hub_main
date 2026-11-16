# Marketing — Tablero de tareas + Link público de la bio

> Dos cosas que hasta ahora vivían fuera del sistema: las tareas de marketing (en
> un grupo de WhatsApp y en la cabeza de una sola persona) y el link de la bio de
> Instagram (en un Biolink de terceros, con la marca de ellos abajo y editable
> sólo por quien tuviera esa contraseña suelta).

## Qué hay

| Ruta | Quién entra | Qué es |
|---|---|---|
| `/[slug]/tareas` | `owner`, `editor` (Contenido), `host` (anfitriona) | El tablero de tareas estilo Monday (desde el 15/11/2026). |
| `/[slug]/enlaces` | `owner` | Editor del link de la bio, con vista previa en vivo. |
| `/l/[slug]` | **cualquiera, sin sesión** | La página pública que va en Instagram. |

Ambas entran por **Marketing** en el sidebar (una sola entrada desde el 07/10/2026:
Tareas, Link de Instagram y Páginas son pestañas arriba de la página, definidas en
`components/shell/section-tabs-config.ts`) y por el ⌘K
(`Tareas de marketing`, `Link de Instagram`, `Nueva tarea de marketing`).

---

## 1. Tablero de tareas — `/[slug]/tareas` (estilo Monday, 15/11/2026)

Lo pidió Nacho Badra con un video de su Monday: «necesito que sea así». El
tablero de septiembre (tarjetas por fecha, tres secciones fijas) «estaba muy
desorganizado» y lo terminado no se iba a ningún lado.

### Cómo se ve

- **Grupos** que arma cada bar (Eventos, Promociones, Impresiones, Redes…), cada
  uno con su color: el riel al costado de las filas y el título. La cabecera del
  grupo lleva la cantidad y una **barrita con el reparto de estados** (cuenta el
  grupo entero, también lo terminado: se ve cuánto falta). Se pliegan (se
  recuerda en el navegador) y el dueño los renombra, les cambia el color, los
  ordena y los borra (con aviso de cuántas tareas se van).
- **La fila** (compu): título que se escribe ahí mismo · globito con la cantidad
  de actualizaciones · Responsable (avatares) · Involucrados (nombres con el
  color de cada persona) · **Estado como celda sólida** · Vencimiento · Notas
  (solo con lugar) · Archivos. Las columnas responden al ancho del tablero
  (container queries), no al de la ventana: en la notebook de Nacho con el menú
  abierto entra igual. En el celular, cada tarea va en dos renglones (título y
  estado; avatares, vencimiento, globitos) y se toca para abrir el panel.
- **Estados** (`lib/marketing/constants.ts`, teclas 1 a 6 en el menú): Por hacer
  (rojo) · En curso (amarillo) · Interrumpido (naranja) · Terminado (verde) ·
  Backlog (gris, «lo dejo para después») · Esperando feedback (azul). Colores en
  `app/globals.css` (bloque «Tareas de marketing»), con el texto calculado para
  pasar AA en los seis.
- **Vencimiento**: vencida en rojo con «!», hoy en ámbar, terminada en verde y
  tachada. Atajos: Hoy, Mañana, El viernes, La semana que viene.
- **Terminadas**: al marcar Terminado la fila destella en verde y se va a
  «Terminadas · N» (abajo, cerrado), con «Deshacer». La tarea conserva su grupo:
  si se reabre desde ahí, vuelve.
- **Cargar rápido**: «+ Agregar tarea» al pie de cada grupo (Enter y queda listo
  para la próxima) y «Nueva tarea» arriba (elige el grupo y carga arriba de
  todo). Pegar una lista carga una tarea por renglón.
- **Arrastrar** para ordenar y para pasar de grupo (dnd-kit, también con
  teclado). Con un filtro puesto no se arrastra: reordenar una parte rompería el
  resto.
- **Filtros**: «Mis tareas» (responsable o involucrado: lo que pidió Nacho
  Badra), cualquier otra persona, el buscador (título y notas, sin tildes) y
  «N vencidas» en el resumen, que filtra.
- **En vivo**: si otro socio cambia algo, el tablero se pone al día solo
  (Realtime de las cinco tablas, con un refresh agrupado).

### El panel de la tarea

Se abre con «Abrir», con el globito o con `?tarea=<id>` («Copiar link» para
mandarlo por WhatsApp). Título grande editable, estado, vencimiento,
responsables, involucrados, grupo (para pasarla a otro), notas que se guardan
solas, y dos pestañas:

- **Actualizaciones**: el hilo de Monday. Quien la carga deja el detalle (textos,
  guiones) y quien la hace deja lo entregado ahí mismo, con archivos (adjuntar o
  pegar con ⌘V). Después de publicar ofrece pasarla a «Esperando feedback» o
  «Terminado». Cada uno edita o borra lo suyo; el dueño borra cualquiera.
- **Archivos**: arrastrar o elegir (fotos, videos, PDF, Office, zip; hasta 50 MB
  cada uno; lo más pesado, como link), pegar un link, miniaturas de las fotos,
  bajar con el nombre original.

Los archivos van **directo del navegador al bucket privado** `marketing-files`
con la sesión de la persona (mismo camino que los comprobantes de
Administración): el servidor valida y da las rutas (`prepareTaskUploads`), el
navegador sube, y el servidor registra (`registerTaskFiles` / `postTaskUpdate`).
Se ven con URLs firmadas de 1 h.

### Rutina de la semana (el «Orgánico» de antes)

Lo que se repite **todas** las semanas: historias, reels, el mensaje al canal.
No son tareas — no tienen fecha ni responsable, tienen **cupo semanal** y se
reinician solas cada lunes. Es la otra vista del mismo lugar
(`?vista=rutina&semana=YYYY-MM-DD`; los viejos `?seccion=organico` siguen
andando). Tildar = insertar la fila; destildar = borrarla. La arma el dueño;
Contenido y la anfitriona tildan.

### Quién puede

| | Dueño | Contenido (`editor`) | Anfitriona (`host`) |
|---|---|---|---|
| Ver el tablero y la rutina | ✓ | ✓ | ✓ |
| Crear, editar, asignar, comentar, subir archivos | ✓ | ✓ | ✓ |
| Borrar una tarea | ✓ | la que creó | la que creó |
| Borrar actualizaciones / archivos | ✓ | los suyos | los suyos |
| Grupos y rutinas (crear, cambiar, borrar) | ✓ | — | — |

Enforceado en cuatro capas: el menú (dueño entra por **Marketing**; Contenido y
la anfitriona tienen su entrada **Tareas**), el proxy (`tareas` en
`MANAGER_SCOPED_PREFIXES`), la página y las actions (`MARKETING_TASK_ROLES` /
`MARKETING_GROUP_ROLES` de `lib/tenant/roles.ts`) y la base
(`marketing_member_tenant_ids()` / `marketing_manager_tenant_ids()`). A una tarea
solo se puede sumar gente que trabaja el tablero de ese bar (política de
`marketing_task_people`). La contadora no ve nada (RESTRICTIVE `_no_accountant`
en cada tabla).

**Candados** (migración `20261116001427_marketing_tasks_candados.sql`, después de la
revisión independiente del 15/11/2026): un disparador fija el autor, el bar y la fecha
de alta de cada tarea y calcula «quién y cuándo la terminó» del cambio de estado (antes,
con la consola, alguien podía ponerse como autor de una tarea ajena y borrarla); las
actualizaciones no cambian de tarea ni de autor; un archivo del bucket lo borra quien lo
subió, un dueño o quien creó la tarea; y una tarea sin grupo solo crea grupo si la carga
un dueño. Las actions repiten las reglas antes de tocar el bucket, nunca borran un objeto
si el registro falló porque la ruta ya era de otro archivo, y el navegador borra lo que
subió si no lo pudo registrar.

En el celular de la anfitriona, las cuatro pestañas de Reservas siguen sueltas en
la barra de abajo; «Mis números» y «Tareas» quedan en «Más».

El combo de personas sale del RPC **`get_marketing_team`** (cruza `memberships`
con `auth.users` y `reservation_managers` para el nombre real).

### Tex

`ver_tareas`, `preparar_tarea`, `preparar_estado_tarea`,
`preparar_actualizacion_tarea`, `ver_checklist_organico` y
`preparar_tilde_rutina` (`lib/tex/tools/mensajeria/tareas.ts`), para los mismos
tres roles.

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
marketing_task_groups      id, tenant_id, name, color, position     (los grupos; color de una paleta fija)
marketing_tasks            id, tenant_id, group_id, title, status, due_date, notes, position,
                           created_by, completed_at, completed_by
                           (+ las columnas del tablero de septiembre, que quedan sin uso hasta
                           la migración de limpieza: category, kind, specifications, file_url,
                           responsible_user_id, involved_user_id, ideal_date, defined_date)
marketing_task_people      task_id, user_id, role (responsible | involved)   ← varias de cada una
marketing_task_updates     task_id, author_id, body                           ← el hilo
marketing_task_files       task_id, update_id?, kind (file | link), storage_path | url,
                           file_name, mime_type, size_bytes                   ← bucket marketing-files
marketing_routines         id, tenant_id, title, description, slots, position, active
                           unique (id, tenant_id)  ← habilita la FK compuesta de abajo
marketing_routine_checks   id, tenant_id, routine_id, week_start, slot, completed_by
                           unique (routine_id, week_start, slot)
                           FK (routine_id, tenant_id) → marketing_routines (id, tenant_id)

public_link_pages          tenant_id (PK), headline, bio, active
public_links               id, tenant_id, label, description, url, icon,
                           highlight, position, active
```

Enum `marketing_task_status`: todo · in_progress · blocked · done · backlog ·
waiting_feedback. Claves en inglés como el resto del schema; los labels en
español viven en `lib/marketing/constants.ts`. Todas las hijas cuelgan de la
tarea con FK compuesta `(task_id, tenant_id)` (nada cruza de bar) y la tarea del
grupo con `(group_id, tenant_id)`.

**RLS** (migración `20261115230118_marketing_tasks_board_v2.sql`): ver «Quién
puede». `revoke all … from anon` en todas. Las cinco tablas del tablero están en
la publicación `supabase_realtime`. Reordenar es la RPC `marketing_reorder_tasks`
(security invoker: manda la RLS).

**La página pública no lee con `anon`**: la sirve un Server Component con
`createServiceClient()` filtrando por `tenant_id`, igual que `/carta`.
`public.tenants` tampoco es legible por `anon` y abrirlo sólo para esto
expondría `feature_flags`, teléfonos de feedback y config de puntos.

Migraciones: `20260903213046_marketing_tasks_board.sql`,
`20260903213113_public_links_bio_page.sql`, y el tablero estilo Monday:
`20261115225856_marketing_task_status_v2.sql` (los dos estados nuevos, sola
porque un valor de enum no se usa en la misma transacción) y
`20261115230118_marketing_tasks_board_v2.sql` («expandir ahora, limpiar
después»: agrega todo y conserva las columnas viejas para que el código anterior
siguiera andando entre la migración y el deploy).

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
  _components/task-board.tsx             estado optimista, filtros, arrastrar, en vivo, panel
  _components/board-toolbar.tsx          resumen, Mis tareas, persona, buscador, Tablero/Rutina
  _components/group-section.tsx          grupo: cabecera con la barrita, filas, «+ Agregar tarea»
  _components/task-row.tsx               la fila (compu) y la tarjeta de dos renglones (celular)
  _components/status-picker.tsx          la celda sólida y los seis estados
  _components/people-picker.tsx          responsables / involucrados
  _components/due-picker.tsx             vencimiento con atajos
  _components/done-section.tsx           «Terminadas»
  _components/task-panel.tsx             el panel de la tarea
  _components/task-updates.tsx           actualizaciones (escribir, editar, borrar)
  _components/task-files.tsx             archivos y links
  _components/upload.ts                  subida directa al bucket
  _components/new-task-popover.tsx       «Nueva tarea»
  _components/groups-empty.tsx           tablero vacío y «Nuevo grupo»
  _components/organic-checklist.tsx      rutina de la semana: progreso, casilleros
  _components/routine-dialog.tsx         alta/edición/borrado de rutinas
app/(manager)/[tenantSlug]/enlaces/      page + loading + _components/
  _components/links-manager.tsx          encabezado, lista, previa
  _components/link-dialog.tsx            alta/edición/borrado de botones
app/l/[tenantSlug]/                      page + not-found (pública)
components/public-links/link-page-view.tsx   ← compartido página real ↔ previa
components/ui/copy-button.tsx            (extraído: había 4 copias ad-hoc)
lib/marketing/{constants,board,files,week,schemas,queries,actions}.ts
lib/public-links/{schemas,queries,actions}.ts
tests/lib/{marketing-board,marketing-files,marketing-week,marketing-schemas,public-links-schemas}.test.ts
```
