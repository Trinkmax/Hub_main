# Spec — Editor visual de plano de mesas (floor plan)

> Fecha: 2026-06-05 · Estado: aprobado para plan (post self-review adversarial)
> Workspace afectado: `(manager)/[tenantSlug]/configuracion/mesas` (dueño, desktop-first).
> Forma parte de un set de 3 specs independientes pedidos juntos: **(1) este — Floor plan de mesas**, **(2) Carta del comensal + captura** (ya implementado, mergeado en `main`), **(3) KDS robusto** (pendiente). Este spec NO toca carta ni KDS.

---

## 1. Problema y objetivo

Hoy las mesas (`physical_tables`, cada una con su `qr_token` y su ruta pública `/m/{qrToken}`) se administran en una **grilla de cards** sin ninguna noción espacial: el dueño no puede representar cómo están distribuidas físicamente en el local, ni en qué piso/área está cada una. La gestión (crear, editar, imprimir QR, regenerar token, activar/desactivar, borrar) está repartida en diálogos sueltos.

**Objetivo:** convertir la pantalla de mesas en un **editor visual de plano**, fácilmente editable, donde el dueño:

1. **Dibuja la distribución real** del local: arrastra mesas a su lugar, las redimensiona, y agrega elementos de decoración (paredes, columnas, islas, barra) para que el plano se parezca al salón.
2. **Organiza por áreas configurables** (N por tenant; HUB arranca con "Planta Baja" y "Planta Alta"). El piso es un atributo explícito de la mesa (vía el área donde está ubicada), no se deriva del número.
3. **Gestiona cada mesa-QR desde el canvas**: un panel lateral por mesa permite editar nombre/capacidad, imprimir QR, regenerar token, activar/desactivar, **dividir** (crear otra mesa-QR) y **combinar** (fusionar dos en una, desactivando el QR sobrante sin perder historial).

El **plano absorbe la gestión**: el editor se convierte en LA pantalla de mesas. Se retira la grilla vieja; queda una **lista simple accesible como fallback** (no `<noscript>`: tab/ruta secundaria + fallback de `ErrorBoundary`).

### Alcance v1 (decisiones de brainstorming)

- **Solo el editor del dueño** (`(manager)`, owner). La **vista operativa en vivo del salón** (estado ocupada/libre en tiempo real para el staff) queda para **entrega 2**, sobre el mismo modelo.
- **Sin rotación**: los elementos se mueven y redimensionan, pero no rotan. Se deja la columna `rotation` (default 0) para el futuro, sin UI.
- **Numeración autosugerida editable** por área (`number_start`: PB→1, PA→101).
- Las mesas existentes sin posición entran por una **bandeja lateral de "no ubicadas"** que el dueño arrastra al plano.

---

## 2. Estado actual (anclas de código verificadas)

### `physical_tables` (origen: `20260506100100_plan1_physical_tables.sql`)
Columnas: `id uuid pk`, `tenant_id uuid not null → tenants on delete cascade`, `label text not null check(length(trim(label)) between 1 and 40)`, `capacity int check(>0) nullable`, `qr_token text not null default generate_qr_token()`, `active boolean not null default true`, `created_at`, `updated_at` (trigger `set_updated_at`).
- **NO tiene columna x/y/zone/floor/geometry.** Confirmado: ninguna migración la altera para agregar columnas (solo `enable row level security`).
- Índices: `physical_tables_qr_token_uidx` (UNIQUE global sobre `qr_token`), `physical_tables_tenant_active_idx` sobre `(tenant_id, active)`.
- RLS: `pt_select_member` (SELECT, cualquier miembro), `pt_owner_insert/update/delete` (owner vía `user_role_in_tenant(tenant_id)='owner'`). GRANT: `select, insert, update, delete … to authenticated`. **Sin grant a `anon`** — el comensal `anon` toca mesas solo vía RPCs SECURITY DEFINER que filtran `where qr_token = … and active = true`.
- `generate_qr_token()` (`20260506100000`): 16 chars URL-safe `[a-zA-Z0-9]`. `qr_token` es **estático por mesa** (auto-rotación removida en `20260527120100`); solo el dueño lo rota vía `regenerate_qr_token(uuid)`.

### Única FK que apunta a `physical_tables`
- `table_sessions.physical_table_id uuid → physical_tables(id) on delete set null` (`20260506100200`). **Es la única.**
- **Implicación crítica**: un DELETE físico de una mesa **no** rompe la FK — pone `physical_table_id = NULL` en cada `table_session` histórica, **destruyendo el vínculo mesa↔sesión**. Por eso **combinar/quitar/borrar debe ser soft (`active=false`)**, no delete; ver §6 para la única excepción (mesa nunca usada).

### Sesiones (origen: `20260506140200_plan5_session_ops.sql` + `lib/sessions-waiter/`)
- Enum `session_status` = `open | paid | merged | abandoned`.
- "Mesa ocupada / con sesión abierta" ⇔ existe fila en `table_sessions` con `physical_table_id = <id>` y `status = 'open'`. Índice parcial `table_sessions_one_open_per_table_uidx` ⇒ **máximo una sesión abierta por mesa**.
- RPCs de **sesión** (operativas, entrega 2 / staff): `merge_sessions`, `split_session`, `move_session`, `mark_session_abandoned`, `mark_session_paid`. **OJO terminológico**: operan sobre *sesiones vivas*. El "dividir/combinar" de **este** spec opera sobre `physical_tables` (estructura), NO sobre sesiones. Por eso los RPC nuevos llevan prefijo `fp_*` y las actions viven en `lib/floor-plan/` (no en `lib/sessions-waiter/`).
- **Guarda faltante (gap real verificado)**: hoy **no existe** validación que impida desactivar/borrar una mesa con sesión abierta. `updateTable` flipea `active` sin chequear; un delete dejaría la sesión abierta huérfana. **Este spec agrega esa guarda, atómica, dentro de RPC.**

### Acciones / queries reutilizables (`lib/tables/`)
- `lib/tables/actions.ts` (`'use server'`, owner-only, revalidan `/${slug}/configuracion/mesas`, auditan vía `logAudit()`): `createTable(slug,_prev,fd)`, `updateTable(slug,_prev,fd)` (keys `id,label,capacity,active`), `deleteTable(slug,id)` (**hard delete**), `regenerateQrToken(slug,id)` (RPC `regenerate_qr_token`).
- `lib/tables/queries.ts` (`server-only`): `listPhysicalTables(tenantId) → PhysicalTableRow[]` `{id,label,capacity,qr_token,active,created_at}`.
- `lib/tables/schemas.ts`: `createTableSchema`, `updateTableSchema` (incluye `active` con **default `true`** — footgun, ver §6.4), `tableIdSchema`.
- `lib/qr.ts`: `renderQrSvg`, `renderQrPngDataUrl`. `lib/tables/qr-pdf.ts`: `buildQrSheet({qrToken,tableLabel,tenantName,baseUrl})` (URL `${baseUrl}/m/${qrToken}`). `PrintQrButton({qrToken})` abre `/print/qr/<token>` — **reusable tal cual**.

### Auditoría (verificado — `lib/audit.ts` + `20260504010000`)
- `audit_log` tiene RLS con **solo política SELECT (owner)** y GRANT **solo `select` a `authenticated`** (sin INSERT). Ningún RPC inserta ahí. La auditoría se hace **siempre en la capa TS** con `logAudit()`, que usa el cliente `service_role` para saltar RLS. → **Los RPC nuevos NO escriben `audit_log`; auditamos en la server action tras el RPC OK.**

### UI actual de mesas que se reemplaza (5 archivos)
`…/configuracion/mesas/page.tsx` (RSC), `_components/tables-list.tsx`, `new-table-dialog.tsx`, `edit-table-dialog.tsx`, `print-qr-button.tsx`. Se **eliminan** los dialogs y la grilla; `print-qr-button.tsx` se **conserva** (lo reusa el inspector).

### Seed y zonas de reservas (confirmado: dominios separados)
- `seed.sql` **NO inserta `physical_tables`** ni setea `salon_capacities`. Las capacidades de reservas se siembran aparte en `20260520030000` (lookup por slug `hub`, `on conflict do nothing`).
- **Zonas de reservas** (`enum salon_zone`, `tenants.settings.salon_capacities`, `salon_zone_capacity_overrides`) son **dominio aparte, sin FK ni join a `physical_tables`**. Las `floor_plan_areas` de este spec son un concepto **nuevo e independiente** (no se unifican en v1).

---

## 3. Decisiones validadas (brainstorming)

| Tema | Decisión |
|---|---|
| Alcance v1 | **Solo el editor del dueño**. Vista operativa en vivo → entrega 2, mismo modelo. |
| Dividir / combinar | **Gestión de mesas-QR en el canvas.** DIVIDIR crea otra mesa+QR; COMBINAR fusiona dos (el QR absorbido pasa a `active=false`, soft). Cambia `physical_tables`. |
| Pisos / áreas | **Áreas configurables (N) por tenant.** HUB: PB/PA. Piso = atributo explícito (vía área), no derivado del número. Independiente de zonas de reservas. |
| Pantalla de mesas | **El plano absorbe la gestión.** Editor visual = LA pantalla de mesas; panel lateral por mesa. Grilla vieja se retira (queda lista simple accesible). |
| Tech de render | **dnd-kit + divs posicionados** (no SVG/canvas). |
| Rotación | **Sin rotación en v1.** Columna `rotation` (default 0) para el futuro. |
| Numeración | **Autosugerencia editable** por área (`number_start`: PB→1, PA→101). |
| Mesas no ubicadas | **Bandeja lateral** para arrastrar al plano. |
| `bar` como elemento | **Decor-only en v1**: visual, sin QR ni sesión (igual que pared/columna/isla). |

---

## 4. Modelo de datos (migración nueva)

Migración nueva en `supabase/migrations/` (slug `floor_plan_editor`). Sigue LEY §4/§5. **`physical_tables` queda intacto** (no se le agregan columnas).

> **Idempotencia bajo MCP (sin Docker local).** La migración se aplica vía Supabase MCP `apply_migration`, no por `db:reset`. Por eso **todo `create type` / `create table` va con guarda** (`do $$ begin if not exists (...) then create type ...; end if; end $$;` para enums; `create table if not exists`; `create index if not exists`), de modo que una re-aplicación no falle.

### 4.1 `floor_plan_areas` — áreas/pisos configurables
```sql
create table if not exists public.floor_plan_areas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 40),
  position      int  not null default 0,
  width         int  not null default 1200 check (width  between 200 and 6000),
  height        int  not null default 800  check (height between 200 and 6000),
  number_start  int  not null default 1 check (number_start between 0 and 100000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- unicidad por tenant (backing del on conflict del seed; evita áreas duplicadas)
create unique index if not exists floor_plan_areas_tenant_name_uidx
  on public.floor_plan_areas (tenant_id, lower(trim(name)));
create index if not exists floor_plan_areas_tenant_pos_idx
  on public.floor_plan_areas (tenant_id, position);
```
- Orden canónico de áreas: `order by position, created_at, id`. `reorderAreas` reasigna posiciones densas `0..n-1` en un batch.

### 4.2 `floor_plan_elements` — todo lo que vive en el canvas
```sql
do $$ begin
  if not exists (select 1 from pg_type where typname = 'floor_element_kind') then
    create type public.floor_element_kind  as enum ('table','wall','pillar','island','bar');
  end if;
  if not exists (select 1 from pg_type where typname = 'floor_element_shape') then
    create type public.floor_element_shape as enum ('rect','circle');
  end if;
end $$;

create table if not exists public.floor_plan_elements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  area_id           uuid not null references public.floor_plan_areas(id) on delete cascade,
  kind              public.floor_element_kind  not null,
  shape             public.floor_element_shape not null default 'rect',
  physical_table_id uuid references public.physical_tables(id) on delete cascade, -- solo kind='table'
  x                 int  not null default 0   check (x between -10000 and 10000),
  y                 int  not null default 0   check (y between -10000 and 10000),
  width             int  not null default 80  check (width  between 8 and 6000),
  height            int  not null default 80  check (height between 8 and 6000),
  rotation          int  not null default 0,   -- reservado v2; siempre 0 en v1
  z_index           int  not null default 0,
  label             text check (label is null or length(label) <= 40),
  color             text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),  -- 6 dígitos
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fpe_table_has_pt check (
    (kind = 'table' and physical_table_id is not null) or
    (kind <> 'table' and physical_table_id is null)
  )
);
create unique index if not exists floor_plan_elements_pt_uidx
  on public.floor_plan_elements (physical_table_id)
  where physical_table_id is not null;          -- 1 mesa ⇒ a lo sumo 1 elemento (anti-join de la bandeja)
create index if not exists floor_plan_elements_area_idx   on public.floor_plan_elements (area_id);
create index if not exists floor_plan_elements_tenant_idx on public.floor_plan_elements (tenant_id);
```

**Invariantes (no DB-triviales) y su enforcement** — ver §4.3:
- **Cross-tenant**: `element.tenant_id = area.tenant_id` y, si `kind='table'`, `= physical_table.tenant_id`. (RLS solo verifica que el caller sea owner de `element.tenant_id`; NO que `area_id`/`physical_table_id` sean del mismo tenant.)
- **Mesa activa**: un elemento `kind='table'` solo puede referenciar una `physical_table` **activa**. Desactivar/combinar borra el elemento; reactivar manda la mesa a la bandeja (sin elemento).
- **Geometría dentro del área**: NO se enforcea a nivel DB (el `x/y/width/height` puede exceder el área). Se **clampea solo en el editor** (last-write-wins). Límite v1 aceptado; los CHECK de `x/y` (±10000) solo evitan basura grosera de un caller no-UI.

### 4.3 Triggers de integridad (BEFORE INSERT/UPDATE — seguros, no afectan deletes/cascade)
```sql
-- valida tenant_id consistente y, para mesas, que la mesa sea activa
create or replace function public.fp_elements_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_area_tenant uuid; v_pt_tenant uuid; v_pt_active boolean;
begin
  select tenant_id into v_area_tenant from public.floor_plan_areas where id = new.area_id;
  if v_area_tenant is null or v_area_tenant <> new.tenant_id then
    raise exception 'fp_tenant_mismatch_area' using errcode = '42501';
  end if;
  if new.kind = 'table' then
    select tenant_id, active into v_pt_tenant, v_pt_active
      from public.physical_tables where id = new.physical_table_id;
    if v_pt_tenant is null or v_pt_tenant <> new.tenant_id then
      raise exception 'fp_tenant_mismatch_table' using errcode = '42501';
    end if;
    if v_pt_active is not true then
      raise exception 'fp_table_inactive' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger fp_elements_integrity_biu
  before insert or update on public.floor_plan_elements
  for each row execute function public.fp_elements_integrity();

-- updated_at en ambas tablas (trigger set_updated_at existente)
create trigger floor_plan_areas_updated_at    before update on public.floor_plan_areas
  for each row execute function public.set_updated_at();
create trigger floor_plan_elements_updated_at before update on public.floor_plan_elements
  for each row execute function public.set_updated_at();
```
> **No** se agrega trigger BEFORE DELETE en `physical_tables`: rompería el `on delete cascade` de `tenants` (al borrar un tenant con sesiones, el trigger abortaría). El borrado seguro se controla en la capa de acción (ver §6.4).

### 4.4 RLS + GRANTs (ambas tablas)
```sql
alter table public.floor_plan_areas    enable row level security;
alter table public.floor_plan_elements enable row level security;

create policy "fpa_select_member" on public.floor_plan_areas
  for select to authenticated using (tenant_id in (select public.user_tenant_ids()));
create policy "fpe_select_member" on public.floor_plan_elements
  for select to authenticated using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE solo owner (idéntico a pt_owner_*)
create policy "fpa_owner_insert" on public.floor_plan_areas for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "fpa_owner_update" on public.floor_plan_areas for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "fpa_owner_delete" on public.floor_plan_areas for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
-- idem fpe_owner_insert / fpe_owner_update / fpe_owner_delete sobre floor_plan_elements

grant select, insert, update, delete on public.floor_plan_areas    to authenticated;
grant select, insert, update, delete on public.floor_plan_elements to authenticated;
```
> §5 LEY: sin GRANT, las tablas son invisibles para `supabase-js`. RLS sigue siendo la única defensa de filas. El SELECT lo abre a cualquier miembro (incl. rol `kitchen`) — intencional, porque la vista operativa de entrega 2 lo consumirá; en v1 igual el editor es owner-only por la guarda de ruta/acción.

### 4.5 Seed HUB (idempotente, en la migración — patrón `20260520030000`)
```sql
do $seed$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub';
  if v_tenant is not null then
    insert into public.floor_plan_areas (tenant_id, name, position, number_start)
    values (v_tenant, 'Planta Baja', 0, 1), (v_tenant, 'Planta Alta', 1, 101)
    on conflict (tenant_id, lower(trim(name))) do nothing;
  end if;
end $seed$;
```
- **El seed es solo-HUB (conveniencia demo).** Todo tenant nuevo arranca **sin áreas** → ver onboarding zero-area en §5/§6. (Opcional, fuera salvo pedido: sembrar 3-4 mesas ya ubicadas en HUB para que la demo no arranque vacía.)

### 4.6 Tipos
- `npm run db:types` tras la migración → regenera `types/database.ts` (tablas + enums nuevos).

---

## 5. Componentes / archivos

### Defaults deterministas (decisión de ingeniería; ajustables)
| Parámetro | Valor v1 |
|---|---|
| Grid (lógico) | **20 px** |
| Mínimo de resize | **24 px** |
| `table` | shape elegible al crear (`rect` por defecto, o `circle` para mesa redonda); 80×80; capacidad default `null` |
| `wall` | rect 200×16 |
| `pillar` | circle 40×40 |
| `island` | rect 120×80 |
| `bar` | rect 240×40 |
| Área nueva | 1200×800, `number_start` editable |
| Offset de DIVIDIR | nuevo elemento en `(source.x + source.width + grid, source.y)`, clampeado al área |
| `shape` post-creación | **no editable en v1** (se fija al crear) |
| `z_index` por defecto | decor `0`, mesa `10`; orden de render `(z_index, created_at, id)` |

### DOM de 3 capas (clave para zoom/pan + dnd-kit)
1. **viewport** (`overflow:hidden`, **sin** transform) — es el límite de medición de `DndContext` y el contenedor del `restrictToParent`.
2. **stage** (`position:relative`, `transform: translate(panX,panY) scale(s)`, `width/height = área lógica`).
3. **FloorElement** (`position:absolute`, `left/top` en px **lógicos**).

### Page (RSC) — `…/configuracion/mesas/page.tsx` (reescrita)
`requireTenantAccess` + guard owner; `getFloorPlan(tenant.id)` → áreas + elementos + mesas no ubicadas; pasa objetos planos serializables (sin `Date`) como props. Si el tenant **no tiene áreas**, renderiza un **empty state con CTA "Crear primera área"** (default `Salón`, `number_start=1`). El editor cliente se monta dentro de un **`ErrorBoundary`** cuyo fallback es `tables-list-fallback`; además la lista es una **tab secundaria siempre alcanzable** (a11y, no `<noscript>`).

### Nuevos (cliente, en `…/configuracion/mesas/_components/`)
- `floor-plan-editor.tsx` — orquesta. **Dueño del estado**: geometría committeada `{x,y,w,h,z}` por elemento, `selectedId`, `{scale,panX,panY}`, área activa. Provee `DndContext`, bandeja, paleta, inspectores, cola de persistencia.
- `floor-canvas.tsx` — viewport + stage (3 capas). Grilla de fondo. Contenedor restringido del drag.
- `floor-element.tsx` — div posicionado (`left/top` lógico + `CSS.Translate.toString(transform)` durante drag). `useDraggable`; **activator solo en el body** (`setActivatorNodeRef`), no en los handles. Estado **transitorio** (delta de drag/resize); sube a editor en `dragEnd`/`pointerUp`.
- `element-palette.tsx` — agregar mesa / pared / columna / isla / barra (con los defaults de arriba).
- `table-inspector.tsx` — panel de mesa seleccionada: editar **nombre/capacidad** (reusa `updateTable`, **sin** tocar `active`), imprimir QR (`PrintQrButton`), regenerar token (`regenerateQrToken`), **activar/desactivar Switch → RPC `fp_set_table_active`** (nunca `updateTable`), **dividir**, **combinar**, **quitar del plano**, al frente/al fondo (z_index).
- `decor-inspector.tsx` — tamaño, etiqueta, color, z-index (al frente/al fondo), borrar. (Shape no editable.)
- `area-manager.tsx` — crear/renombrar/reordenar/borrar áreas; editar `width/height/number_start`.
- `unplaced-tray.tsx` — bandeja de mesas activas sin elemento; arrastrables al canvas / botón "colocar".
- `resize-handles.tsx` — handles propios; `onPointerDown` hace `e.stopPropagation()` + `setPointerCapture`; escribe w/h transitorio, sube en `pointerUp`.
- `tables-list-fallback.tsx` — lista accesible (tabla/`<ul>`) con las mismas acciones, sin canvas. **Camino accesible canónico.**

### Lógica (`lib/floor-plan/`)
- `schemas.ts` — zod de área/geometría/decor/merge/createTableInPlan/setTableActive. **Puro testeable.**
- `queries.ts` (`server-only`) — `getFloorPlan(tenantId)` (ver §6.5).
- `actions.ts` (`'use server'`, owner-only, audit TS) — ver §6.
- `numbering.ts` — `suggestNextLabel(area, existingLabels)`. **Puro testeable.**
- `grid.ts` — `snapToGrid(value, grid)` + modifiers v6 custom `createSnapModifier(grid, getScale)` y `restrictToParent(getScale)` (ver §8). **Puro testeable.**

### Modificados
- `…/mesas/page.tsx` (reescrita). Se eliminan `tables-list.tsx`, `new-table-dialog.tsx`, `edit-table-dialog.tsx`. `print-qr-button.tsx` se conserva.
- `lib/tables/schemas.ts` + `lib/tables/actions.ts` — **`updateTable` deja de manejar `active`** (se quita de `updateTableSchema`); su único caller (el viejo `edit-table-dialog`) se elimina. La activación pasa a ser RPC-only. *(Plan: verificar que no quede otro caller de `updateTable` que dependa de `active`.)*

---

## 6. Server actions / RPCs (`lib/floor-plan/`)

Patrón uniforme de cada **server action**: `requireTenantAccess(slug)` + `requireRole(role,['owner'])`, validación zod, llamada al RPC (si aplica), y **auditoría en TS con `logAudit()`** tras éxito, `revalidatePath('/${slug}/configuracion/mesas')`. **Los RPC no escriben `audit_log`** (§2).

### 6.1 Convención obligatoria de RPC (espejo de `regenerate_qr_token`, `20260506100500`)
Todo RPC nuevo:
- `language plpgsql security definer set search_path = ''`, **identificadores 100% schema-qualified** (`public.physical_tables`, `public.floor_plan_elements`, `public.table_sessions`, `public.generate_qr_token()`, …).
- Resuelve `tenant_id` desde la fila y verifica `public.user_role_in_tenant(v_tenant) = 'owner'`, si no `raise exception 'owner_required' using errcode='42501'`.
- Cierra con `revoke all on function … from public; grant execute on function … to authenticated;`.

### 6.2 Lectura y áreas
- **`getFloorPlan(tenantId)`** (query, §6.5).
- **Áreas**: `createArea`, `renameArea`, `updateAreaCanvas` (width/height/number_start), `reorderAreas` (posiciones densas `0..n-1` en batch), `deleteArea`.
  - `deleteArea` **bloquea** si el área tiene **mesas activas ubicadas**: `exists(select 1 from public.floor_plan_elements e join public.physical_tables pt on pt.id = e.physical_table_id where e.area_id = $1 and pt.active)` → mensaje accionable. Decor y mesas no ubicadas no bloquean (el decor cae por `on delete cascade`).
  - **No se puede borrar la última área** (un tenant siempre tiene ≥1 área, o el editor cae al empty-state). El editor maneja explícitamente el estado zero-área (CTA crear primera).

### 6.3 Geometría
- **`updateElementsGeometry(items[])`** — upsert batch de `{id,x,y,width,height,z_index}` **únicamente** (nunca `area_id`/`tenant_id`/`kind`/`physical_table_id`). Mover una mesa a **otro piso** = `removeFromPlan` + `placeTable` en la otra área (no hay drag cross-área; cada área es su propio canvas/tab). Last-write-wins. Persistencia: ver §7 (cola única debounced + rollback).

### 6.4 Estructura mesa-QR (RPCs `fp_*` con guarda atómica)
Cada RPC bloquea fila con `for update` y verifica sesión abierta **en la misma transacción**:
- **`createTableInPlan`** → RPC `fp_create_table(p_tenant, p_area, p_label, p_capacity, p_shape, p_x, p_y)`: inserta `physical_tables` (qr_token por default) **+** su `floor_plan_element` (`kind='table'`, z=10) en una transacción; devuelve `{table_id, element_id, qr_token}`. `label` se autosugiere en cliente (`suggestNextLabel`, editable).
- **`splitTable(sourceElementId)`** → reusa `fp_create_table` con `area`+`capacity`+`shape` heredados del source y posición `(source.x+source.width+grid, source.y)` clampeada al área; `label` = `suggestNextLabel`. (No toca sesiones.)
- **`placeTable(tableId, areaId, x, y)`** → inserta el `floor_plan_element` de una mesa de la bandeja. El trigger §4.3 **rechaza** si la mesa está inactiva o es de otro tenant.
- **`removeFromPlan(elementId)`** → borra solo el `floor_plan_element` (la mesa vuelve a la bandeja; sigue activa). **Guarda sesión abierta** (no quitar del plano una mesa ocupada → confunde al staff). Distinto de desactivar.
- **`mergeTables`** → RPC `fp_merge_tables(p_survivor_table_id, p_absorbed_table_id)`: `for update` sobre la **absorbida**; si tiene sesión abierta → `raise 'table_has_open_session' (P0001)`; setea `absorbed.active=false`; borra su `floor_plan_element`; (mismo-tenant check). Sobreviviente conserva QR y elemento. UI confirma con `AlertDialog`.
- **`deactivateTable` / `reactivateTable`** → RPC `fp_set_table_active(p_table_id, p_active)`: al desactivar, `for update` + guarda sesión abierta (`table_has_open_session`), `active=false`, **borra su elemento** (sale del canvas). Al reactivar, `active=true` (vuelve a la bandeja, sin elemento).
- **`deleteTablePermanently(tableId)`** → **única vía de hard delete**, RPC que verifica `not exists(select 1 from public.table_sessions where physical_table_id = p_table_id)`; si hay historial → `raise 'table_has_history'`. El `floor_plan_element` cae por `on delete cascade`. La UI **solo ofrece** esta opción para mesas sin historial; para el resto, ofrece **desactivar**. El `deleteTable` legacy de `lib/tables` se **retira del editor** (y se endurece con el mismo check, o se deja de exportar a UI).
- **Decoración**: `addDecor(areaId, kind, shape, geom)`, `updateDecor(id, …)` (tamaño/etiqueta/color/z), `deleteDecor(id)` — `floor_plan_elements` con `kind in (wall,pillar,island,bar)`, `physical_table_id=null`.
- **Reuso directo**: editar label/capacidad → `updateTable` (**sin `active`**); imprimir → `PrintQrButton`; regenerar token → `regenerateQrToken`.

> **`active` es RPC-only** (resuelve el footgun: `updateTableSchema` tenía `active` con default `true`; reusar `updateTable` para editar el nombre habría **reactivado** silenciosamente una mesa desactivada). El editor nunca flipea `active` por `updateTable`.

Auditoría TS (`logAudit`): `createTableInPlan`, `splitTable`, `mergeTables`, `deactivate/reactivate`, `deleteArea`, `deleteTablePermanently`. Geometría/decor de bajo riesgo y alto volumen **no** audita.

### 6.5 `getFloorPlan(tenantId)` — query exacta
- `areas`: `select … from public.floor_plan_areas where tenant_id=$1 order by position, created_at, id`.
- `elements`: `select … from public.floor_plan_elements where tenant_id=$1 order by z_index, created_at, id` (+ join a `physical_tables` para traer `label/capacity/qr_token/active` de las mesas).
- `unplacedTables` (anti-join, usa `floor_plan_elements_pt_uidx`):
  ```sql
  select pt.* from public.physical_tables pt
  where pt.tenant_id = $1 and pt.active
    and not exists (select 1 from public.floor_plan_elements e where e.physical_table_id = pt.id);
  ```
  Mesas reactivadas o de áreas borradas (su elemento cayó por cascade) **reaparecen acá** correctamente.

---

## 7. Edge cases y manejo de errores

- **Combinar/desactivar/quitar/borrar con sesión abierta** → bloqueado por el RPC (`table_has_open_session`), mensaje accionable ("La mesa tiene una sesión abierta; cerrala o cobrá antes"). El chequeo es **atómico con `for update`**; el TS **delega** en el RPC (no reimplementa el check en JS; un check JS sería TOCTOU-racy y best-effort UX a lo sumo).
- **Borrar mesa con historial** → no se ofrece hard delete; se ofrece **desactivar** (soft). Hard delete solo para mesas sin `table_session` (RPC `deleteTablePermanently`, raise `table_has_history`).
- **Borrar área** → bloqueada si hay mesas activas ubicadas (§6.2); no se puede borrar la última.
- **Zero-área (caso común, no edge)** → todo tenant nuevo no-HUB arranca sin áreas → empty-state + CTA crear primera. `createTableInPlan` exige `p_area`.
- **Mesas no ubicadas (backfill)** → toda mesa activa sin elemento aparece en la bandeja.
- **Concurrencia** → geometría last-write-wins. **El editor NO es realtime en v1**: dos owners ven los cambios del otro solo al recargar. Decisión consciente (editar de a un owner es la norma).
- **Persistencia de geometría (optimista)** → una **única cola** `Map<elementId, geom>` flusheada por **debounce** (drag-end y resize-end **encolan en la misma cola**, nunca dos escritores en paralelo) y en `beforeunload`. **Si el flush falla** → `toast` de error + **revertir el estado optimista** de los ids afectados (o marcarlos dirty y reintentar). Cumple §6/§7 CLAUDE.md (no tragarse errores, retry con CTA).
- **Zoom/pan + dnd-kit (gotcha verificado)** → con `transform: scale(s)`, dnd-kit reporta rects y `delta` en px de **pantalla**. Compensación canónica en §8. El pan es **transform-based** (no scroll nativo): `autoScroll={false}` en `DndContext`.
- **Touch** → elementos arrastrables con `touchAction:'none'`; `PointerSensor` `activationConstraint:{distance:8}` (un click <8px **selecciona**, no mueve).
- **Off-canvas** → CHECK `x/y ±10000` evita basura de un caller no-UI; el editor clampea al área.

---

## 8. Render / interacción (dnd-kit v6 — API verificada)

> **Trampa de versión (verificada vía Context7)**: el repo usa la línea **estable v6** (`@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10`, `@dnd-kit/utilities ^3.2.2`). Context7 indexa hoy mayormente el **rewrite next-gen 0.x** (`@dnd-kit/react`, `@dnd-kit/dom`), cuyas APIs (`SnapModifier.configure`, `PointerSensor.configure({activationConstraints:[new …]})`, `DragDropProvider`, `useDraggable` con ref callback, `RestrictToElement`) **NO existen en v6**. Implementar contra la API v6 de abajo.

- **`@dnd-kit/modifiers` NO está instalado.** `createSnapModifier`/`restrictToParentElement` viven ahí → **NO instalar**; se escriben **custom** en `lib/floor-plan/grid.ts` (firma v6 `({transform, draggingNodeRect, containerNodeRect}) => Transform`). Si más adelante se prefiere el paquete sería `@dnd-kit/modifiers@^9`, **NO v10+**.
- **Todo modifier preserva `scaleX/scaleY`**: `return { ...transform, x, y }` (omitirlos colapsa el elemento mid-drag).
- **Snap bajo escala (lógico)**: `createSnapModifier(grid, getScale)` ⇒ `x = Math.round(transform.x / scale / grid) * grid * scale` (snap en espacio lógico, devuelto en px de pantalla). `getScale` cierra sobre el `scale` vigente (re-`useMemo` de los modifiers keyed en `scale`).
- **restrictToParent bajo escala**: clampea en **espacio lógico** — divide `containerNodeRect`/`draggingNodeRect` por `scale` antes de acotar. Orden de modifiers: `[snap, restrict]` (restrict manda en el borde).
- **Commit canónico (una sola pipeline)** en `onDragEnd`: `newLogicalX = snapToGrid(storedLogicalX + event.delta.x / scale, grid)` (idem Y), luego `clamp([0, area.width - element.width])`. El snap del modifier es para **preview live**; el commit re-aplica snap en lógico para que ambos coincidan (sin doble-proceso ni drift).
- **Sensores**: `useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}), useSensor(KeyboardSensor,{coordinateGetter}))`. `KeyboardSensor`: el paso por flecha es **`grid*scale`** (px pantalla = 1 celda lógica).
- **Resize**: dnd-kit **no** redimensiona. Handles propios (`resize-handles.tsx`): `onPointerDown` → `e.stopPropagation()` + `setPointerCapture`; el **activator del drag está solo en el body** (`setActivatorNodeRef`), de modo que arrastrar un handle no dispara el drag de dnd-kit. (Este es el bug #1 esperable "drag y resize peleando" — queda diseñado, no asumido.)
- **Zoom/pan**: estado `{scale,panX,panY}` aplicado como `transform` al **stage**; botones +/−/fit. `autoScroll={false}` (no hay scroll nativo).
- **a11y (CLAUDE.md §7)**:
  - **Selección ≠ drag de teclado**: click/Enter sobre un elemento lo **selecciona y abre el inspector**; el drag por teclado es un modo aparte (pickup con barra espaciadora, flechas mueven, Esc cancela). Documentar el keymap para que Enter no choque entre "abrir inspector" y "levantar para arrastrar".
  - `DndContext accessibility={{ announcements, screenReaderInstructions }}` en **español**.
  - Elementos decorativos con `aria-label` (kind + label) y `aria-roledescription`; evitar tab-stops mudos.
  - `tables-list-fallback` es el **camino accesible canónico** (no solo respaldo).
- **Persistencia**: ver §7 (cola única debounced + rollback).

---

## 9. Multi-tenant / seguridad (LEY)

- Dos tablas nuevas con `tenant_id`, RLS (select miembro / write owner), GRANTs a `authenticated` — patrón idéntico a `physical_tables`. SELECT abierto a cualquier miembro (incl. `kitchen`) por la vista de entrega 2; el editor v1 es owner-only por guarda de ruta/acción.
- RPCs nuevos `security definer set search_path = ''`, schema-qualified, con check owner y `revoke/grant` (§6.1).
- **Integridad cross-tenant** enforced por trigger (§4.3), no por confianza en el cliente. `updateElementsGeometry` jamás cambia `area_id`/`tenant_id`.
- **Guarda de sesión abierta atómica** en RPC (§6.4/§7).
- Sin PII en logs. Auditoría TS en mutaciones estructurales (§6).
- El comensal `anon` no se ve afectado (sigue tocando solo RPCs de sesión que filtran `qr_token` + `active=true`).

---

## 10. Testing (DoD)

- **Unit (Vitest, `tests/lib/`)**:
  - `numbering.ts` — `suggestNextLabel` (próximo libre desde `number_start`, huecos, áreas distintas).
  - `grid.ts` — `snapToGrid`; `createSnapModifier` y `restrictToParent` correctos **a scale=1 y scale=2**; modifiers preservan `scaleX/scaleY`.
  - `schemas.ts` — zod de área/geometría/decor/merge (límites, color hex 6 dígitos, capacity, x/y bounds).
- **RLS / integración (`tests/rls/`)** — además del aislamiento por tenant y write-solo-owner:
  - `fp_merge_tables` y `fp_set_table_active(false)` **levantan `table_has_open_session`** con sesión abierta. *(Guarda headline — requerido, no opcional.)*
  - Insertar un segundo elemento para la misma mesa **falla** (índice 1:1).
  - Insertar un elemento con `area_id`/`physical_table_id` de otro tenant **falla** (trigger `fp_tenant_mismatch_*`); insertar elemento de mesa inactiva **falla** (`fp_table_inactive`).
  - `deleteArea` con mesas activas ubicadas **bloquea**; cashier/waiter **no** puede llamar los `fp_*` (`owner_required`).
- **Smoke manual (en PR)**: crear/renombrar/reordenar/borrar áreas (intentar borrar última y con mesas → bloqueo) → tenant zero-área → CTA crear primera → crear mesas (QR + autosugerencia editable) → arrastrar (snap) y redimensionar a scale 1 y con zoom → pan → decoración (pared/columna/isla/barra) → dividir → combinar (QR absorbido desactivado; combinar con sesión abierta → bloqueo) → desactivar/reactivar (vuelve a bandeja) → colocar "no ubicada" → quitar del plano → imprimir QR → regenerar token → dark mode → teclado (Tab selecciona+inspector, modo mover con flechas) → fallback lista → simular fallo de persistencia (toast + revert).

> Sin Docker local → migraciones vía **Supabase MCP `apply_migration`** (proyecto `ogplsevtrclzxvyejlns`); los tests de RLS corren en CI contra Supabase local.

---

## 11. Por defecto / fuera de alcance v1

- **Vista operativa en vivo del salón** (tiempo real para staff) → **entrega 2**, mismo modelo.
- **Editor NO realtime**: cambios concurrentes se ven al recargar.
- **Rotación libre** → fuera (queda la columna `rotation`).
- **`shape` editable post-creación**, **undo/redo**, **multiselección/mover en bloque**, **plantillas**, **alineación/guías**, **colisión/overlap**, **drag cross-área** (se mueve vía bandeja) → fuera.
- **Unificar `floor_plan_areas` con `salon_zone`** → fuera (dominios separados).
- **Imagen de fondo del plano** → fuera (canvas de divs; sin fondo en v1).
- Colores de decor son responsabilidad del dueño; render neutral (token) cuando `color is null` para que dark mode se vea bien.
- No se toca puntos, reservas, carta ni KDS.
