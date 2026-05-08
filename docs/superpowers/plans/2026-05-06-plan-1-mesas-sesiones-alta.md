# Plan 1 — Mesas físicas, sesiones básicas y alta de comensal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la primitiva fundacional del sistema de mesas: el inventario `physical_tables` con QR rotativo, el modelo `table_sessions` que se abre al escanear, los `session_guests` distinguibles por celular y los `table_session_events` para auditoría. Más una página pública mínima `/m/[qr_token]` donde el comensal puede registrarse para puntos, y una página owner `/configuracion/mesas` con CRUD + impresión de QRs.

**Architecture:** Cuatro tablas nuevas con RLS, tres RPCs públicas (`SECURITY DEFINER`, vía `qr_token`) para que el comensal anónimo opere sin tocar tablas directo, una RPC autenticada `regenerate_qr_token`, y dos páginas Next.js (una autenticada, una pública anon). No hay pedidos todavía — el siguiente plan agrega tickets/comandas.

**Tech Stack:** Next.js 16.2.4 App Router · React 19.2.5 · TypeScript estricto · Supabase 2.105 (`supabase-js`) + CLI 2.98 · Tailwind v4.2.4 + shadcn `new-york` · zod 4.4.3 · vitest 4.1.5 · Biome · `qrcode` 1.5.4 (ya instalado).

**Spec referencia:** `docs/superpowers/specs/2026-05-06-mesas-pedidos-puntos-design.md` §3, §4.1–4.3, §4.8, §4.9 (parcial), §5, §6.4, §7.1 (parcial), §7.2 (parcial).

---

## File Structure

### Nuevas migraciones (Supabase)

- `supabase/migrations/20260506100000_plan1_session_enums_and_helpers.sql` — enums `session_status`, `session_event_type` (parcial: solo eventos del Plan 1), helper `generate_qr_token()`, helper `set_session_guest_activity()` trigger.
- `supabase/migrations/20260506100100_plan1_physical_tables.sql` — tabla `physical_tables` + RLS + GRANTs.
- `supabase/migrations/20260506100200_plan1_table_sessions.sql` — tabla `table_sessions` + RLS + GRANTs.
- `supabase/migrations/20260506100300_plan1_session_guests.sql` — tabla `session_guests` + trigger de `last_activity_at` + RLS + GRANTs.
- `supabase/migrations/20260506100400_plan1_session_events.sql` — tabla `table_session_events` + RLS + GRANTs.
- `supabase/migrations/20260506100500_plan1_session_rpcs.sql` — RPCs `get_session_by_qr_token`, `get_session_state`, `join_session_as_guest`, `register_customer_for_session`, `regenerate_qr_token`. GRANTs y REVOKEs al final.

### Lib (TypeScript)

- `lib/tables/schemas.ts` — zod schemas para CRUD de mesas.
- `lib/tables/queries.ts` — `listPhysicalTables(tenantId)`.
- `lib/tables/actions.ts` — Server Actions `createTable`, `updateTable`, `deleteTable`, `regenerateQrToken`, `getQrPdfUrl`.
- `lib/tables/qr-pdf.ts` — Helper que genera un PDF con el QR (server-only).
- `lib/m-session/schemas.ts` — zod schemas para registro público.
- `lib/m-session/actions.ts` — Server Actions públicas `joinSession`, `registerCustomer`.
- `lib/m-session/browser-token.ts` — `getOrCreateBrowserToken()` (client only, localStorage).

### Páginas

- `app/(dashboard)/[tenantSlug]/configuracion/mesas/page.tsx` — pantalla owner: lista de mesas + acciones.
- `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/tables-list.tsx` — client component, grilla con acciones.
- `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/new-table-dialog.tsx` — client, dialog de alta.
- `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx` — client, dialog de edición.
- `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/regenerate-qr-button.tsx` — client, alert dialog de confirmación.
- `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/print-qr-button.tsx` — client, abre tab de impresión.
- `app/print/qr/[qrToken]/page.tsx` — server, valida auth y arma sheet (vive fuera del grupo `(dashboard)` para no heredar su layout).
- `app/print/qr/[qrToken]/_components/print-sheet.tsx` — client, render del sheet + auto-print.
- `app/m/[qrToken]/page.tsx` — página pública, server component, anon.
- `app/m/[qrToken]/_components/mesa-screen.tsx` — client component principal.
- `app/m/[qrToken]/_components/register-dialog.tsx` — client, dialog de opt-in puntos.
- `app/m/[qrToken]/loading.tsx` — skeleton.
- `app/m/[qrToken]/not-found.tsx` — pantalla de QR inválido.

### Tests

- `tests/rls/physical-tables.test.ts` — RLS de `physical_tables`.
- `tests/rls/sessions.test.ts` — RLS de `table_sessions`, `session_guests`, `table_session_events` y RPCs públicas/autenticadas.

---

## Convenciones del repo (para consistencia)

- **Migraciones**: cada una empieza con un comentario de propósito + tablas/RPCs que crea. Bloque de extensiones, enums (idempotente con `do $$ begin ... end $$`), tablas (con índices), triggers, RLS al final + GRANTs.
- **Helper functions ya existentes** que vas a usar: `public.user_tenant_ids()` (devuelve setof uuid de tenants donde el user es miembro), `public.user_role_in_tenant(tenant_id)` (devuelve TenantRole o null), `public.set_updated_at()` (trigger genérico que actualiza `updated_at`).
- **Tests RLS**: usan `describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip`. Helpers en `tests/rls/setup.ts`: `createUserClient`, `createTenant`, `getServiceClient`, `uniqueEmail`, `uniqueSlug`, `deleteUser`.
- **Server Actions**: `'use server'` arriba, `authorize(slug, allowedRoles)` helper (copy del de `lib/customers/actions.ts`), `ActionState` discriminated union, errores en español rioplatense, `revalidatePath` post-mutación.
- **Public Server Actions**: usan `rateLimit` (de `@/lib/rate-limit`), `getRequestIp`, `getRequestUserAgent`. NO requieren auth.
- **GRANTs**: por la regla de Supabase (30/05/2026), toda tabla nueva en `public` necesita `grant select, insert, update, delete on public.<tabla> to authenticated`. Si tiene acceso anon, va vía RPC `SECURITY DEFINER` (no se grantea a `anon` directo a la tabla).
- **Naming**: tablas `snake_case` plural; columnas `snake_case`; RPCs prefijo `p_` para parámetros (ver `submit_capture` como referencia).

---

## Tasks

> Total: 21 tasks. Cada task es self-contained. Las tasks 1-7 son DB foundation (sin UI). Tasks 8-12 son RPCs (con tests). Tasks 13-17 son UI owner. Tasks 18-21 son UI pública.

---

### Task 1: Migration — enums y helpers

**Files:**
- Create: `supabase/migrations/20260506100000_plan1_session_enums_and_helpers.sql`

Crea los enums `session_status` y `session_event_type` (con los valores del Plan 1), una función `generate_qr_token()` que produce un string criptográficamente fuerte de 16 chars URL-safe, y un trigger genérico `touch_session_guest_activity()` para actualizar `last_activity_at` (lo usaremos en Task 4).

- [ ] **Step 1: Escribir el archivo de migration**

```sql
-- Plan 1: enums + helpers para el modelo de sesiones de mesa
-- Sin tablas todavía — esta migración solo introduce primitivas reusables.

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────

-- Plan 1 solo necesita estos 4 estados; merged y abandoned vienen de specs futuros
-- pero los dejamos creados desde acá para no migrar el enum después.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'session_status') then
    create type public.session_status as enum (
      'open', 'paid', 'merged', 'abandoned'
    );
  end if;
end $$;

-- Plan 1 solo emite los eventos session_opened, guest_joined, guest_registered.
-- El resto los agregan planes posteriores.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'session_event_type') then
    create type public.session_event_type as enum (
      'session_opened',
      'guest_joined',
      'guest_registered',
      'bill_requested',
      'session_paid',
      'session_merged',
      'session_split',
      'session_abandoned',
      'session_moved'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. Helper: generate_qr_token
-- ──────────────────────────────────────────────────────────
-- Genera 16 chars URL-safe a partir de 12 bytes random.
-- Charset: a-z A-Z 0-9 (sin guiones ni símbolos para QR limpio).
create or replace function public.generate_qr_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_token text := '';
  v_idx int;
begin
  for i in 0..15 loop
    v_idx := (get_byte(v_bytes, i % 12) % 62) + 1;
    v_token := v_token || substring(v_alphabet from v_idx for 1);
  end loop;
  return v_token;
end $$;

revoke all on function public.generate_qr_token() from public;
grant execute on function public.generate_qr_token() to authenticated;

-- ──────────────────────────────────────────────────────────
-- 3. Trigger function: touch_session_guest_activity
-- ──────────────────────────────────────────────────────────
-- Se asocia al insert/update de filas que indican actividad del guest.
-- En Plan 1 no se usa todavía — preparado para que Plan 2 (tickets) lo conecte.
create or replace function public.touch_session_guest_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Caller debe pasar el guest_id en TG_ARGV[0] o en una columna específica.
  -- Implementación se completa en Plan 2 cuando se conecte a tickets.
  return new;
end $$;
```

- [ ] **Step 2: Aplicar la migración localmente**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

Expected: la migración se aplica sin errores. Output debe terminar con `Finished supabase db reset`.

- [ ] **Step 3: Verificar enums creados**

```bash
psql "$DATABASE_URL" -c "select enumlabel from pg_enum where enumtypid = 'public.session_status'::regtype order by enumsortorder;"
```

Expected output:
```
 enumlabel
-----------
 open
 paid
 merged
 abandoned
```

- [ ] **Step 4: Verificar generate_qr_token**

```bash
psql "$DATABASE_URL" -c "select public.generate_qr_token();"
```

Expected: un string de 16 chars alfanuméricos (ej: `a3xK9pQRm2Tw4nLs`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100000_plan1_session_enums_and_helpers.sql
git commit -m "feat(plan1): enums session_status/event_type y helper generate_qr_token"
```

---

### Task 2: Migration — `physical_tables`

**Files:**
- Create: `supabase/migrations/20260506100100_plan1_physical_tables.sql`

Tabla del inventario físico de mesas. Vida indefinida. `qr_token` rota cuando se cierra una sesión.

- [ ] **Step 1: Escribir el archivo de migration**

```sql
-- Plan 1: physical_tables — el inventario de mesas físicas con QR rotativo.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.physical_tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 40),
  capacity    int check (capacity is null or capacity > 0),
  qr_token    text not null default public.generate_qr_token(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Único por tenant: el qr_token es el path público, no puede colisionar
-- entre tenants ni dentro del mismo tenant.
create unique index physical_tables_qr_token_uidx
  on public.physical_tables(qr_token);
create index physical_tables_tenant_active_idx
  on public.physical_tables(tenant_id, active);

create trigger physical_tables_updated_at before update on public.physical_tables
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.physical_tables enable row level security;

-- SELECT: cualquier miembro del tenant.
create policy "pt_select_member" on public.physical_tables
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: solo owner.
create policy "pt_owner_insert" on public.physical_tables
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "pt_owner_update" on public.physical_tables
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "pt_owner_delete" on public.physical_tables
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.physical_tables to authenticated;
```

- [ ] **Step 2: Aplicar la migración**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

Expected: aplica sin errores.

- [ ] **Step 3: Verificar la tabla**

```bash
psql "$DATABASE_URL" -c "\d public.physical_tables"
```

Expected: muestra columnas, índices y RLS habilitada.

- [ ] **Step 4: Smoke insert manual**

```bash
psql "$DATABASE_URL" <<'EOF'
-- Asume que ya hay un tenant en seed.sql
insert into public.physical_tables (tenant_id, label)
select id, 'Mesa de prueba' from public.tenants limit 1
returning id, label, qr_token;
EOF
```

Expected: una fila insertada, `qr_token` no nulo de 16 chars.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100100_plan1_physical_tables.sql
git commit -m "feat(plan1): tabla physical_tables con RLS owner-write"
```

---

### Task 3: Migration — `table_sessions`

**Files:**
- Create: `supabase/migrations/20260506100200_plan1_table_sessions.sql`

La sesión de mesa. Se abre al escanear, vive hasta `paid`. Constraint: solo una sesión `open` por mesa simultánea.

- [ ] **Step 1: Escribir el archivo de migration**

```sql
-- Plan 1: table_sessions — la primitiva central, el grupo de gente que se sienta.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.table_sessions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  physical_table_id   uuid references public.physical_tables(id) on delete set null,
  status              public.session_status not null default 'open',
  opened_at           timestamptz not null default now(),
  paid_at             timestamptz,
  merged_into         uuid references public.table_sessions(id) on delete set null,
  abandoned_reason    text,
  opened_by           uuid references auth.users(id) on delete set null,
  total_cents         bigint not null default 0 check (total_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Coherencia de timestamps por estado:
  check (
    (status = 'open' and paid_at is null and merged_into is null and abandoned_reason is null)
    or (status = 'paid' and paid_at is not null and merged_into is null and abandoned_reason is null)
    or (status = 'merged' and merged_into is not null)
    or (status = 'abandoned' and abandoned_reason is not null)
  )
);

-- Una sesión open por mesa a la vez.
create unique index table_sessions_one_open_per_table_uidx
  on public.table_sessions(physical_table_id)
  where status = 'open' and physical_table_id is not null;

create index table_sessions_tenant_status_idx
  on public.table_sessions(tenant_id, status, opened_at desc);
create index table_sessions_physical_table_idx
  on public.table_sessions(physical_table_id, opened_at desc);

create trigger table_sessions_updated_at before update on public.table_sessions
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.table_sessions enable row level security;

-- SELECT: cualquier miembro del tenant.
create policy "ts_select_member" on public.table_sessions
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: prohibidos a authenticated. Solo via RPCs SECURITY DEFINER.
-- (No se crean policies de write — RLS bloquea sin policy.)

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.table_sessions to authenticated;
-- INSERT/UPDATE/DELETE no se grantean: bloqueados por RLS y solo accesibles via RPC.
```

- [ ] **Step 2: Aplicar la migración**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

Expected: aplica sin errores.

- [ ] **Step 3: Verificar el constraint de "una open por mesa"**

```bash
psql "$DATABASE_URL" <<'EOF'
-- Setup
with t as (insert into public.tenants (name, slug) values ('Bar Test', 'bar-test') returning id),
p as (insert into public.physical_tables (tenant_id, label)
      select id, 'M1' from t returning id, tenant_id)
insert into public.table_sessions (tenant_id, physical_table_id)
select tenant_id, id from p;
-- Segundo open en la misma mesa: debe fallar
insert into public.table_sessions (tenant_id, physical_table_id)
select tenant_id, id from public.physical_tables where label='M1';
EOF
```

Expected: el segundo insert falla con `duplicate key value violates unique constraint "table_sessions_one_open_per_table_uidx"`.

- [ ] **Step 4: Verificar el check de coherencia de estados**

```bash
psql "$DATABASE_URL" -c "
update public.table_sessions set status='paid' where status='open';
"
```

Expected: falla con violation del check (porque no se setea `paid_at`).

```bash
psql "$DATABASE_URL" -c "
update public.table_sessions set status='paid', paid_at=now() where status='open';
"
```

Expected: éxito.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100200_plan1_table_sessions.sql
git commit -m "feat(plan1): tabla table_sessions con constraint de una open por mesa"
```

---

### Task 4: Migration — `session_guests`

**Files:**
- Create: `supabase/migrations/20260506100300_plan1_session_guests.sql`

Guests = celulares conectados a la sesión. Distinguibles por `browser_token` en localStorage.

- [ ] **Step 1: Escribir el archivo de migration**

```sql
-- Plan 1: session_guests — celulares conectados a la sesión, identificados por browser_token.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.session_guests (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.table_sessions(id) on delete cascade,
  browser_token       text not null check (length(browser_token) between 16 and 64),
  display_name        text check (display_name is null or length(trim(display_name)) between 1 and 40),
  customer_id         uuid references public.customers(id) on delete set null,
  joined_at           timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- Un browser_token único por sesión: cada celular es un slot.
create unique index session_guests_token_uidx
  on public.session_guests(session_id, browser_token);

create index session_guests_session_idx
  on public.session_guests(session_id, joined_at desc);
create index session_guests_customer_idx
  on public.session_guests(customer_id) where customer_id is not null;
create index session_guests_activity_idx
  on public.session_guests(last_activity_at);

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.session_guests enable row level security;

create policy "sg_select_member" on public.session_guests
  for select to authenticated
  using (
    exists (
      select 1 from public.table_sessions ts
      where ts.id = session_id
        and ts.tenant_id in (select public.user_tenant_ids())
    )
  );

-- Sin policies de write para authenticated. Solo via RPC SECURITY DEFINER.

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.session_guests to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
psql "$DATABASE_URL" -c "\d public.session_guests"
```

Expected: tabla existe con índices.

- [ ] **Step 3: Smoke — insertar un guest**

```bash
psql "$DATABASE_URL" <<'EOF'
with s as (
  select id from public.table_sessions limit 1
)
insert into public.session_guests (session_id, browser_token)
select id, 'aBcDeFgHiJkLmNoP' from s
returning id, browser_token, last_activity_at;
EOF
```

Expected: una fila insertada con `last_activity_at = now()`.

- [ ] **Step 4: Verificar unique de (session_id, browser_token)**

```bash
psql "$DATABASE_URL" <<'EOF'
with s as (
  select id from public.table_sessions limit 1
)
insert into public.session_guests (session_id, browser_token)
select id, 'aBcDeFgHiJkLmNoP' from s;
EOF
```

Expected: falla con `duplicate key value violates unique constraint`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100300_plan1_session_guests.sql
git commit -m "feat(plan1): tabla session_guests con browser_token único por sesión"
```

---

### Task 5: Migration — `table_session_events`

**Files:**
- Create: `supabase/migrations/20260506100400_plan1_session_events.sql`

Mini ledger de eventos de sesión para auditoría y realtime.

- [ ] **Step 1: Escribir el archivo de migration**

```sql
-- Plan 1: table_session_events — mini ledger de eventos para auditoría y realtime.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.table_session_events (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  type                  public.session_event_type not null,
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index table_session_events_session_idx
  on public.table_session_events(session_id, created_at desc);
create index table_session_events_type_idx
  on public.table_session_events(type, created_at desc);

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.table_session_events enable row level security;

create policy "tse_select_member" on public.table_session_events
  for select to authenticated
  using (
    exists (
      select 1 from public.table_sessions ts
      where ts.id = session_id
        and ts.tenant_id in (select public.user_tenant_ids())
    )
  );

-- Insert solo via RPC. Sin update ni delete (ledger inmutable).

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.table_session_events to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
psql "$DATABASE_URL" -c "\d public.table_session_events"
```

Expected: tabla con sus índices.

- [ ] **Step 3: Verificar que RLS bloquea insert directo de un user authenticated**

(Lo testearemos formalmente en Task 7, acá solo smoke con service role.)

- [ ] **Step 4: Regenerar types/database.ts**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:types
```

Expected: `types/database.ts` se actualiza con las nuevas tablas y enums.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100400_plan1_session_events.sql types/database.ts
git commit -m "feat(plan1): tabla table_session_events (mini ledger inmutable) + types"
```

---

### Task 6: RLS test — `physical_tables`

**Files:**
- Create: `tests/rls/physical-tables.test.ts`

Verifica el aislamiento multi-tenant y el role gating de `physical_tables`.

- [ ] **Step 1: Escribir el test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — physical_tables', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('ptA') })
    ownerB = await createUserClient({ email: uniqueEmail('ptB') })
    cashierA = await createUserClient({ email: uniqueEmail('ptCash') })
    waiterA = await createUserClient({ email: uniqueEmail('ptWait') })

    tenantA = await createTenant({
      name: 'Bar A', slug: uniqueSlug('pt-a'), ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B', slug: uniqueSlug('pt-b'), ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(waiterA.userId)
  })

  it('owner can insert and select physical_tables in their tenant', async () => {
    const { data, error } = await ownerA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa 1' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data).toMatchObject({ label: 'Mesa 1', active: true })
    expect(data?.qr_token).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  it('cashier and waiter can SELECT but not INSERT', async () => {
    const { data: cashierRead } = await cashierA.client
      .from('physical_tables')
      .select('id, label')
    expect(cashierRead?.length).toBeGreaterThan(0)

    const { error: cashierInsert } = await cashierA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa Forbidden' })
    expect(cashierInsert).not.toBeNull()

    const { error: waiterInsert } = await waiterA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa Forbidden 2' })
    expect(waiterInsert).not.toBeNull()
  })

  it('owner of tenant B cannot see physical_tables of tenant A', async () => {
    const { data } = await ownerB.client
      .from('physical_tables')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data?.length ?? 0).toBe(0)
  })

  it('owner cannot insert physical_tables in another tenant', async () => {
    const { error } = await ownerB.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Crossed' })
    expect(error).not.toBeNull()
  })

  it('qr_token is globally unique', async () => {
    const service = getServiceClient()
    const { data: t1 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'A1' })
      .select('qr_token')
      .single()
    const { error: dup } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantB.id, label: 'B1', qr_token: t1!.qr_token })
    expect(dup).not.toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test**

```bash
cd /mnt/c/Users/Agust/Hub
npm run test:ci -- tests/rls/physical-tables.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/physical-tables.test.ts
git commit -m "test(plan1): RLS de physical_tables (tenant isolation + role gating)"
```

---

### Task 7: RLS test — `table_sessions`, `session_guests`, `table_session_events`

**Files:**
- Create: `tests/rls/sessions.test.ts`

Verifica que las tablas operativas son **solo lectura** para authenticated y que el aislamiento entre tenants funciona. Las inserciones se testean en Task 11+ vía las RPCs.

- [ ] **Step 1: Escribir el test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — sessions / guests / events (read-only para authenticated)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let sessionA: { id: string }
  let physicalTableA: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('seA') })
    ownerB = await createUserClient({ email: uniqueEmail('seB') })
    tenantA = await createTenant({
      name: 'SE A', slug: uniqueSlug('se-a'), ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'SE B', slug: uniqueSlug('se-b'), ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'SE-T1' })
      .select('id')
      .single()
    physicalTableA = pt!

    const { data: sess } = await service
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: pt!.id })
      .select('id')
      .single()
    sessionA = sess!

    await service.from('session_guests').insert({
      session_id: sess!.id,
      browser_token: 'guestSession12345',
      display_name: 'Guest #1',
    })

    await service.from('table_session_events').insert({
      session_id: sess!.id,
      type: 'session_opened',
      payload: { initial: true },
    })
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
  })

  it('owner of A reads sessions, guests and events of A', async () => {
    const { data: sessions } = await ownerA.client
      .from('table_sessions')
      .select('id, status')
    expect(sessions?.find((s) => s.id === sessionA.id)).toBeDefined()

    const { data: guests } = await ownerA.client
      .from('session_guests')
      .select('id, browser_token')
      .eq('session_id', sessionA.id)
    expect(guests?.length).toBe(1)

    const { data: events } = await ownerA.client
      .from('table_session_events')
      .select('id, type')
      .eq('session_id', sessionA.id)
    expect(events?.[0]?.type).toBe('session_opened')
  })

  it('owner of B cannot read sessions or guests of A', async () => {
    const { data: sessions } = await ownerB.client
      .from('table_sessions')
      .select('id')
      .eq('id', sessionA.id)
    expect(sessions?.length ?? 0).toBe(0)

    const { data: guests } = await ownerB.client
      .from('session_guests')
      .select('id')
      .eq('session_id', sessionA.id)
    expect(guests?.length ?? 0).toBe(0)
  })

  it('owner cannot INSERT into table_sessions directly (must use RPC)', async () => {
    const { error } = await ownerA.client
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: physicalTableA.id })
    expect(error).not.toBeNull()
  })

  it('owner cannot INSERT into session_guests directly', async () => {
    const { error } = await ownerA.client
      .from('session_guests')
      .insert({
        session_id: sessionA.id,
        browser_token: 'attemptedDirect12',
      })
    expect(error).not.toBeNull()
  })

  it('owner cannot INSERT into table_session_events directly', async () => {
    const { error } = await ownerA.client
      .from('table_session_events')
      .insert({
        session_id: sessionA.id,
        type: 'session_opened',
      })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test**

```bash
cd /mnt/c/Users/Agust/Hub
npm run test:ci -- tests/rls/sessions.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/rls/sessions.test.ts
git commit -m "test(plan1): RLS sessions/guests/events son read-only para authenticated"
```

---

### Task 8: Migration — RPC `regenerate_qr_token` (autenticada)

**Files:**
- Modify: nuevo archivo `supabase/migrations/20260506100500_plan1_session_rpcs.sql` (este task crea el archivo y agrega solo esta RPC; las siguientes tasks lo van extendiendo).

Owner-only RPC para rotar el `qr_token` de una mesa cuando se compromete.

- [ ] **Step 1: Crear el archivo de migration con la RPC**

```sql
-- Plan 1: RPCs del modelo de sesiones.
-- Este archivo agrupa las 5 RPCs del Plan 1 — se construye incrementalmente
-- a lo largo de las tasks 8-12. Cada task agrega una RPC al final.

-- ──────────────────────────────────────────────────────────
-- RPC 1: regenerate_qr_token (autenticada, owner-only)
-- ──────────────────────────────────────────────────────────
create or replace function public.regenerate_qr_token(
  p_table_id uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_new_token text;
begin
  -- 1. Resolver tenant de la mesa
  select tenant_id into v_tenant_id
    from public.physical_tables
    where id = p_table_id;
  if v_tenant_id is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Verificar role del caller
  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Rotar
  v_new_token := public.generate_qr_token();
  update public.physical_tables
    set qr_token = v_new_token, updated_at = now()
    where id = p_table_id;

  return v_new_token;
end $$;

revoke all on function public.regenerate_qr_token(uuid) from public;
grant execute on function public.regenerate_qr_token(uuid) to authenticated;
```

- [ ] **Step 2: Aplicar la migración**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

Expected: aplica sin errores.

- [ ] **Step 3: Smoke con service role**

```bash
psql "$DATABASE_URL" <<'EOF'
with t as (select id from public.physical_tables limit 1)
select public.regenerate_qr_token((select id from t)) as new_token;
EOF
```

Expected: devuelve un nuevo token de 16 chars.

- [ ] **Step 4: No commitear todavía** — el archivo se va a extender en tasks 9-12.

---

### Task 9: Migration — RPC `get_session_by_qr_token` (helper interno)

**Files:**
- Modify: `supabase/migrations/20260506100500_plan1_session_rpcs.sql` (append)

Helper interno usado por las RPCs públicas para resolver el `qr_token` a una sesión activa, creando una nueva si la mesa no tiene ninguna `open`.

- [ ] **Step 1: Append al archivo de migration**

```sql

-- ──────────────────────────────────────────────────────────
-- RPC 2: get_or_open_session (interno, usado por las RPCs públicas)
-- ──────────────────────────────────────────────────────────
-- Resuelve un qr_token a una sesión open. Si no existe, abre una nueva.
-- Devuelve session.id y tenant_id. Si el qr_token no coincide con ninguna
-- mesa activa, raise.
create or replace function public.get_or_open_session(
  p_qr_token text
) returns table(session_id uuid, tenant_id uuid, physical_table_id uuid, was_new boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_was_new boolean := false;
begin
  -- 1. Buscar la mesa por token
  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true
    for update;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- 2. Buscar sesión open en esa mesa
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open'
    for update;

  -- 3. Si no hay, abrir una nueva
  if v_session.id is null then
    insert into public.table_sessions (tenant_id, physical_table_id)
      values (v_table.tenant_id, v_table.id)
      returning * into v_session;
    insert into public.table_session_events (session_id, type, payload)
      values (v_session.id, 'session_opened', '{"trigger": "qr_scan"}'::jsonb);
    v_was_new := true;
  end if;

  return query select v_session.id, v_session.tenant_id, v_table.id, v_was_new;
end $$;

revoke all on function public.get_or_open_session(text) from public;
-- No grant a anon ni authenticated: solo lo invocan otras RPCs.
```

- [ ] **Step 2: Aplicar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

Expected: aplica.

- [ ] **Step 3: Smoke con service role**

```bash
psql "$DATABASE_URL" <<'EOF'
with t as (select qr_token from public.physical_tables limit 1)
select * from public.get_or_open_session((select qr_token from t));
-- Llamarla de nuevo: was_new debe ser false la segunda vez.
select * from public.get_or_open_session((select qr_token from t));
EOF
```

Expected: primera llamada `was_new=true`, segunda `was_new=false`, mismo `session_id`.

- [ ] **Step 4: No commitear todavía.**

---

### Task 10: Migration — RPC pública `get_session_state`

**Files:**
- Modify: `supabase/migrations/20260506100500_plan1_session_rpcs.sql` (append)

RPC pública que el comensal llama al escanear el QR. Devuelve un snapshot mínimo: id de sesión, info de la mesa, info del guest (si existe). En Plan 1 NO incluye carta ni tickets — eso llega en Plan 2.

- [ ] **Step 1: Append al archivo de migration**

```sql

-- ──────────────────────────────────────────────────────────
-- RPC 3: get_session_state (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Snapshot que el comensal recibe al escanear el QR.
-- Si no hay sesión open, abre una. Si el caller tiene browser_token,
-- también devuelve su guest_id (si está unido a esta sesión).
create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_physical_table_id uuid;
  v_was_new boolean;
  v_table_label text;
  v_tenant_name text;
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int;
begin
  -- Validación mínima
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver / abrir sesión
  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  -- 2. Cargar info pública de mesa y tenant
  select label into v_table_label
    from public.physical_tables where id = v_physical_table_id;
  select name into v_tenant_name
    from public.tenants where id = v_tenant_id;

  -- 3. Si el caller tiene browser_token, buscar su guest
  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session_id and browser_token = p_browser_token;
    -- Si existe, refrescar last_activity_at
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  -- 4. Contar guests de la sesión (info pública para "somos N en la mesa")
  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'physical_table_id', v_physical_table_id,
    'table_label', v_table_label,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', v_was_new
  );
end $$;

revoke all on function public.get_session_state(text, text) from public;
grant execute on function public.get_session_state(text, text) to anon, authenticated;
```

- [ ] **Step 2: Aplicar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

- [ ] **Step 3: Smoke con anon**

```bash
psql "$DATABASE_URL" <<'EOF'
set role anon;
with t as (select qr_token from public.physical_tables limit 1)
select public.get_session_state((select qr_token from t), 'aBcDeFgHiJkLmNoP');
reset role;
EOF
```

Expected: devuelve jsonb con `session_id`, `tenant_name`, `table_label`, `guest_id=null` (porque el browser_token no creó guest todavía).

- [ ] **Step 4: No commitear todavía.**

---

### Task 11: Migration — RPC pública `join_session_as_guest`

**Files:**
- Modify: `supabase/migrations/20260506100500_plan1_session_rpcs.sql` (append)

Crea una entrada en `session_guests` para el celular que escanea. Si ya existe (mismo browser_token en la sesión), es no-op.

- [ ] **Step 1: Append al archivo de migration**

```sql

-- ──────────────────────────────────────────────────────────
-- RPC 4: join_session_as_guest (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Crea (o reconecta) un guest en la sesión asociada al qr_token.
-- Idempotente: si ya existe el (session_id, browser_token), devuelve el existente.
create or replace function public.join_session_as_guest(
  p_qr_token text,
  p_browser_token text,
  p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_physical_table_id uuid;
  v_was_new boolean;
  v_guest_id uuid;
  v_existing public.session_guests;
  v_clean_name text;
  v_was_new_guest boolean := false;
begin
  -- Validación
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  v_clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if v_clean_name is not null and length(v_clean_name) > 40 then
    raise exception 'display_name_too_long' using errcode = 'P0001';
  end if;

  -- Resolver sesión (abre si no existe)
  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  -- Lookup existing
  select * into v_existing
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token
    for update;

  if v_existing.id is not null then
    -- Reconectar: actualiza display_name si lo pasaron, refresca actividad
    update public.session_guests
      set display_name = coalesce(v_clean_name, display_name),
          last_activity_at = now()
      where id = v_existing.id;
    v_guest_id := v_existing.id;
  else
    -- Crear guest nuevo
    insert into public.session_guests (session_id, browser_token, display_name)
      values (v_session_id, p_browser_token, v_clean_name)
      returning id into v_guest_id;
    insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
      values (v_session_id, 'guest_joined', v_guest_id,
              jsonb_build_object('display_name', v_clean_name));
    v_was_new_guest := true;
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'guest_id', v_guest_id,
    'was_new_guest', v_was_new_guest,
    'was_new_session', v_was_new
  );
end $$;

revoke all on function public.join_session_as_guest(text, text, text) from public;
grant execute on function public.join_session_as_guest(text, text, text) to anon, authenticated;
```

- [ ] **Step 2: Aplicar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

- [ ] **Step 3: Smoke con anon**

```bash
psql "$DATABASE_URL" <<'EOF'
set role anon;
with t as (select qr_token from public.physical_tables limit 1)
select public.join_session_as_guest(
  (select qr_token from t), 'pruebaTokenABC123', 'Juan'
);
-- Llamar otra vez con el mismo token: was_new_guest=false
select public.join_session_as_guest(
  (select qr_token from t), 'pruebaTokenABC123', null
);
reset role;
EOF
```

Expected: primera llamada `was_new_guest=true`, segunda `was_new_guest=false`, mismo `guest_id`.

- [ ] **Step 4: No commitear todavía.**

---

### Task 12: Migration — RPC pública `register_customer_for_session`

**Files:**
- Modify: `supabase/migrations/20260506100500_plan1_session_rpcs.sql` (append)

Conecta un guest existente con un cliente registrado (con teléfono). Reutiliza la lógica de dedupe por (tenant_id, phone) que ya está en `customers`.

- [ ] **Step 1: Append al archivo de migration**

```sql

-- ──────────────────────────────────────────────────────────
-- RPC 5: register_customer_for_session (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Registra al guest como customer (opt-in puntos).
-- Dedupe por (tenant_id, phone) — si ya existía, lo asocia.
create or replace function public.register_customer_for_session(
  p_qr_token text,
  p_browser_token text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_birthdate date default null,
  p_opt_in_marketing boolean default false,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_guest public.session_guests;
  v_customer public.customers;
  v_customer_id uuid;
  v_was_new_customer boolean := false;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
begin
  -- Validación
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_first) > 60 then
    raise exception 'invalid_first_name' using errcode = 'P0001';
  end if;
  if length(v_last) = 0 or length(v_last) > 60 then
    raise exception 'invalid_last_name' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver sesión (no abre nueva — debe existir)
  select id, tenant_id into v_session_id, v_tenant_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open'
    for update of ts;
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  -- 2. Lookup guest
  select * into v_guest
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token
    for update;
  if v_guest.id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- 3. Dedupe customer por (tenant_id, phone)
  select * into v_customer
    from public.customers
    where tenant_id = v_tenant_id and phone = v_phone and deleted_at is null
    for update;

  if v_customer.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, birthdate,
      opt_in_marketing, opt_in_at, opt_in_ip, source
    ) values (
      v_tenant_id, v_phone, v_first, v_last, p_birthdate,
      p_opt_in_marketing,
      case when p_opt_in_marketing then now() else null end,
      case when p_opt_in_marketing then p_ip else null end,
      'qr'
    ) returning * into v_customer;
    v_customer_id := v_customer.id;
    v_was_new_customer := true;
  else
    -- Existía: actualiza datos básicos si están vacíos, no pisa nombre/apellido
    -- ya cargados; respeta opt_in si ya estaba en true.
    update public.customers
      set first_name = case when length(trim(first_name)) = 0 then v_first else first_name end,
          last_name = case when length(trim(last_name)) = 0 then v_last else last_name end,
          birthdate = coalesce(birthdate, p_birthdate),
          opt_in_marketing = opt_in_marketing or p_opt_in_marketing,
          opt_in_at = case
            when not opt_in_marketing and p_opt_in_marketing then now()
            else opt_in_at
          end,
          opt_in_ip = case
            when not opt_in_marketing and p_opt_in_marketing then p_ip
            else opt_in_ip
          end
      where id = v_customer.id
      returning * into v_customer;
    v_customer_id := v_customer.id;
  end if;

  -- 4. Conectar guest con customer
  update public.session_guests
    set customer_id = v_customer_id,
        display_name = coalesce(display_name, v_first),
        last_activity_at = now()
    where id = v_guest.id;

  -- 5. Evento
  insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
    values (
      v_session_id,
      'guest_registered',
      v_guest.id,
      jsonb_build_object(
        'customer_id', v_customer_id,
        'was_new_customer', v_was_new_customer
      )
    );

  return jsonb_build_object(
    'guest_id', v_guest.id,
    'customer_id', v_customer_id,
    'was_new_customer', v_was_new_customer
  );
end $$;

revoke all on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) from public;
grant execute on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) to anon, authenticated;
```

- [ ] **Step 2: Aplicar**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:reset
```

- [ ] **Step 3: Smoke**

```bash
psql "$DATABASE_URL" <<'EOF'
set role anon;
with t as (select qr_token from public.physical_tables limit 1)
select public.join_session_as_guest((select qr_token from t), 'tokenSmoke12345');
with t as (select qr_token from public.physical_tables limit 1)
select public.register_customer_for_session(
  (select qr_token from t),
  'tokenSmoke12345',
  '+5491133445566',
  'Maria',
  'Garcia',
  '1990-05-15'::date,
  true,
  '127.0.0.1',
  'test-ua'
);
reset role;
EOF
```

Expected: devuelve `customer_id` y `was_new_customer=true` la primera vez. Las repetidas son no-op.

- [ ] **Step 4: Regenerar types y commitear todas las RPCs juntas**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:types
git add supabase/migrations/20260506100500_plan1_session_rpcs.sql types/database.ts
git commit -m "feat(plan1): RPCs de sesiones (regenerate_qr_token + 4 RPCs públicas)"
```

---

### Task 13: Tests RLS de las RPCs públicas

**Files:**
- Modify: `tests/rls/sessions.test.ts` (extender con tests de RPCs)

Agregar al describe existente tests que validen el comportamiento de las RPCs públicas vía cliente anon.

- [ ] **Step 1: Crear cliente anon en setup (si no existe)**

Verifica primero que `tests/rls/setup.ts` exporta una helper para crear un cliente anon. Si no, agregala:

```typescript
// En tests/rls/setup.ts (si falta):
export function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
```

Si ya existe `getAnonClient`, saltea este paso.

- [ ] **Step 2: Agregar el bloque de tests en `tests/rls/sessions.test.ts`**

Append antes del último `}`:

```typescript
import { getAnonClient } from './setup'

describeIfRls('RPCs públicas — get_session_state / join / register', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('rpc') })
    tenant = await createTenant({
      name: 'RPC Bar', slug: uniqueSlug('rpc-bar'), ownerId: owner.userId,
    })
    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T1' })
      .select('qr_token')
      .single()
    qrToken = pt!.qr_token
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
  })

  it('get_session_state opens a new session on first scan', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      table_label: 'RPC-T1',
      tenant_name: 'RPC Bar',
      was_new_session: true,
      guest_id: null,
    })
  })

  it('get_session_state returns same session on second scan', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(data).toMatchObject({ was_new_session: false })
  })

  it('get_session_state with invalid qr_token raises', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('get_session_state', {
      p_qr_token: 'doesNotExistAtAll',
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error?.message).toContain('invalid_qr_token')
  })

  it('join_session_as_guest creates a guest', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcGuestToken123',
      p_display_name: 'Lucia',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_new_guest: true })
    expect(data?.guest_id).toBeDefined()
  })

  it('join_session_as_guest is idempotent on second call', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcGuestToken123',
      p_display_name: 'Lucia',
    })
    expect(data).toMatchObject({ was_new_guest: false })
  })

  it('register_customer_for_session creates a new customer and links the guest', async () => {
    const anon = getAnonClient()
    // Asegurar guest
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcRegisterToken1',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('register_customer_for_session', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcRegisterToken1',
      p_phone: '+5491134567890',
      p_first_name: 'Carla',
      p_last_name: 'Roldan',
      p_birthdate: '1985-03-12',
      p_opt_in_marketing: true,
      p_ip: '10.0.0.1',
      p_user_agent: 'vitest',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_new_customer: true })
  })

  it('register_customer_for_session deduplicates by phone within the tenant', async () => {
    const anon = getAnonClient()
    // Crear otra sesión / guest distinto pero mismo phone
    const service = getServiceClient()
    const { data: pt2 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T2' })
      .select('qr_token')
      .single()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: pt2!.qr_token,
      p_browser_token: 'rpcDupToken12345',
      p_display_name: null,
    })
    const { data } = await anon.rpc('register_customer_for_session', {
      p_qr_token: pt2!.qr_token,
      p_browser_token: 'rpcDupToken12345',
      p_phone: '+5491134567890',
      p_first_name: 'Carla',
      p_last_name: 'Roldan',
      p_birthdate: null,
      p_opt_in_marketing: false,
      p_ip: null,
      p_user_agent: null,
    })
    expect(data).toMatchObject({ was_new_customer: false })
  })
})
```

- [ ] **Step 3: Correr los tests**

```bash
cd /mnt/c/Users/Agust/Hub
npm run test:ci -- tests/rls/sessions.test.ts
```

Expected: 12+ tests pass (5 anteriores + 7 nuevos).

- [ ] **Step 4: Commit**

```bash
git add tests/rls/sessions.test.ts tests/rls/setup.ts
git commit -m "test(plan1): tests anon de RPCs get_session_state/join/register"
```

---

### Task 14: lib/tables — schemas + queries + actions (CRUD)

**Files:**
- Create: `lib/tables/schemas.ts`
- Create: `lib/tables/queries.ts`
- Create: `lib/tables/actions.ts`

Server-side bridge entre la UI del owner y la DB para gestionar `physical_tables`.

- [ ] **Step 1: Crear `lib/tables/schemas.ts`**

```typescript
import { z } from 'zod'

const labelField = z
  .string()
  .trim()
  .min(1, 'Ingresá un nombre')
  .max(40, 'Máximo 40 caracteres')

export const createTableSchema = z.object({
  label: labelField,
  capacity: z
    .union([z.coerce.number().int().min(1).max(50), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
})

export const updateTableSchema = z.object({
  id: z.string().uuid(),
  label: labelField,
  capacity: z
    .union([z.coerce.number().int().min(1).max(50), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  active: z.coerce.boolean().default(true),
})

export const tableIdSchema = z.object({
  id: z.string().uuid(),
})
```

- [ ] **Step 2: Crear `lib/tables/queries.ts`**

```typescript
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PhysicalTableRow = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
  created_at: string
}

export async function listPhysicalTables(tenantId: string): Promise<PhysicalTableRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('physical_tables')
    .select('id, label, capacity, qr_token, active, created_at')
    .eq('tenant_id', tenantId)
    .order('label', { ascending: true })

  if (error) {
    console.error('[tables.listPhysicalTables]', error.message)
    return []
  }
  return data ?? []
}
```

- [ ] **Step 3: Crear `lib/tables/actions.ts`**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { createTableSchema, tableIdSchema, updateTableSchema } from './schemas'

export type TableActionState =
  | { ok: true; message?: string; tableId?: string; qrToken?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function createTable(
  slug: string,
  _prev: TableActionState,
  formData: FormData,
): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTableSchema.safeParse({
    label: formData.get('label'),
    capacity: formData.get('capacity'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('physical_tables')
    .insert({
      tenant_id: access.tenant.id,
      label: parsed.data.label,
      capacity: parsed.data.capacity,
    })
    .select('id, qr_token')
    .single()

  if (error) {
    console.error('[tables.createTable]', error.message)
    return { ok: false, message: 'No se pudo crear la mesa.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    action: 'physical_table.create',
    metadata: { table_id: data.id, label: parsed.data.label },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, tableId: data.id, qrToken: data.qr_token }
}

export async function updateTable(
  slug: string,
  _prev: TableActionState,
  formData: FormData,
): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateTableSchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label'),
    capacity: formData.get('capacity'),
    active: formData.get('active') === 'on',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('physical_tables')
    .update({
      label: parsed.data.label,
      capacity: parsed.data.capacity,
      active: parsed.data.active,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[tables.updateTable]', error.message)
    return { ok: false, message: 'No se pudo actualizar la mesa.' }
  }

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, tableId: parsed.data.id }
}

export async function deleteTable(slug: string, id: string): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tableIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('physical_tables')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[tables.deleteTable]', error.message)
    return { ok: false, message: 'No se pudo eliminar la mesa.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    action: 'physical_table.delete',
    metadata: { table_id: parsed.data.id },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, tableId: parsed.data.id }
}

export async function regenerateQrToken(slug: string, id: string): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tableIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('regenerate_qr_token', { p_table_id: parsed.data.id })

  if (error) {
    console.error('[tables.regenerateQrToken]', error.message)
    return { ok: false, message: 'No se pudo regenerar el QR.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    action: 'physical_table.regenerate_qr',
    metadata: { table_id: parsed.data.id },
  })

  revalidatePath(`/${slug}/configuracion/mesas`)
  return { ok: true, tableId: parsed.data.id, qrToken: data }
}
```

- [ ] **Step 4: Verificar typecheck**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/tables/schemas.ts lib/tables/queries.ts lib/tables/actions.ts
git commit -m "feat(plan1): server actions y queries para CRUD de physical_tables"
```

---

### Task 15: Helper de QR PDF (server-only)

**Files:**
- Create: `lib/tables/qr-pdf.ts`

Genera un PDF con el QR + label de la mesa. Usa la librería `qrcode` (ya instalada) para producir el data URL del QR, y construye un PDF simple usando una API HTML→PDF mínima vía Node.

> **Nota técnica**: hay tres formas de generar PDFs en Next.js. La más simple sin nuevas dependencias es generar el QR como SVG/PNG vía `qrcode` y servir un HTML con CSS de impresión que el navegador convierte a PDF (`window.print()`). Esa es la que implementamos acá: el "PDF" es una vista server-rendered optimizada para impresión, no un PDF real.

- [ ] **Step 1: Crear `lib/tables/qr-pdf.ts`**

```typescript
import 'server-only'
import QRCode from 'qrcode'

export type QrSheet = {
  tableLabel: string
  tenantName: string
  qrUrl: string
  qrDataUrl: string
}

/**
 * Genera la información necesaria para imprimir un QR de mesa.
 * Devuelve el data URL del QR (PNG en base64) y los textos a renderizar.
 * El componente client se encarga de presentar el sheet y disparar window.print().
 */
export async function buildQrSheet(opts: {
  qrToken: string
  tableLabel: string
  tenantName: string
  baseUrl: string
}): Promise<QrSheet> {
  const qrUrl = `${opts.baseUrl.replace(/\/+$/, '')}/m/${opts.qrToken}`
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 1024,
    color: { dark: '#000000', light: '#ffffff' },
  })
  return {
    tableLabel: opts.tableLabel,
    tenantName: opts.tenantName,
    qrUrl,
    qrDataUrl,
  }
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add lib/tables/qr-pdf.ts
git commit -m "feat(plan1): helper buildQrSheet para imprimir QR de mesa"
```

---

### Task 16: Página `/configuracion/mesas` + componentes principales

**Files:**
- Create: `app/(dashboard)/[tenantSlug]/configuracion/mesas/page.tsx`
- Create: `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/tables-list.tsx`
- Create: `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/new-table-dialog.tsx`

UI server component + dos client components básicos. Estilo consistente con `app/(dashboard)/[tenantSlug]/clientes/page.tsx`.

- [ ] **Step 1: Crear `page.tsx` (server component)**

```tsx
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listPhysicalTables } from '@/lib/tables/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { NewTableDialog } from './_components/new-table-dialog'
import { TablesList } from './_components/tables-list'

export const metadata = { title: 'Mesas' }

export default async function MesasPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenant: { id: string; name: string }
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenant = access.tenant
    role = access.role
  } catch {
    notFound()
  }

  if (role !== 'owner') notFound()

  const tables = await listPhysicalTables(tenant.id)

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Mesas"
        description="Gestioná las mesas físicas del bar y sus QRs."
        actions={<NewTableDialog tenantSlug={tenantSlug} />}
      />
      <Section>
        <TablesList tenantSlug={tenantSlug} tenantName={tenant.name} tables={tables} />
      </Section>
    </main>
  )
}
```

- [ ] **Step 2: Crear `_components/new-table-dialog.tsx` (client)**

```tsx
'use client'

import { Plus } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTable, type TableActionState } from '@/lib/tables/actions'

const initialState: TableActionState = { ok: false, message: '' }

export function NewTableDialog({ tenantSlug }: { tenantSlug: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    (prev: TableActionState, fd: FormData) => createTable(tenantSlug, prev, fd),
    initialState,
  )

  if (state.ok && open) {
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" />
          Nueva mesa
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva mesa</DialogTitle>
          <DialogDescription>
            La mesa nace con un QR único. Lo podés imprimir desde la lista.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div>
            <Label htmlFor="label">Nombre</Label>
            <Input
              id="label"
              name="label"
              autoFocus
              required
              maxLength={40}
              placeholder="Ej: Mesa 5, Barra 1, VIP"
            />
            {state.fieldErrors?.label && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.label}</p>
            )}
          </div>
          <div>
            <Label htmlFor="capacity">Capacidad (opcional)</Label>
            <Input id="capacity" name="capacity" type="number" min={1} max={50} />
            {state.fieldErrors?.capacity && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.capacity}</p>
            )}
          </div>
          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creando…' : 'Crear mesa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Crear `_components/tables-list.tsx` (client)**

```tsx
'use client'

import { Pencil, Printer, RefreshCw, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { deleteTable, regenerateQrToken } from '@/lib/tables/actions'
import { EditTableDialog } from './edit-table-dialog'
import { PrintQrButton } from './print-qr-button'

export type TableRow = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
  created_at: string
}

export function TablesList({
  tenantSlug,
  tenantName,
  tables,
}: {
  tenantSlug: string
  tenantName: string
  tables: TableRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<TableRow | null>(null)

  const handleDelete = (id: string, label: string) => {
    startTransition(async () => {
      const result = await deleteTable(tenantSlug, id)
      if (result.ok) toast.success(`Mesa "${label}" eliminada`)
      else toast.error(result.message)
    })
  }

  const handleRegenerate = (id: string, label: string) => {
    startTransition(async () => {
      const result = await regenerateQrToken(tenantSlug, id)
      if (result.ok) toast.success(`QR de "${label}" regenerado`)
      else toast.error(result.message)
    })
  }

  if (tables.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay mesas"
        description="Creá la primera mesa para imprimir su QR y empezar a recibir pedidos."
      />
    )
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <div
            key={t.id}
            className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{t.label}</h3>
                <p className="text-xs text-muted-foreground">
                  Capacidad: {t.capacity ?? 'sin definir'}
                </p>
              </div>
              {!t.active && <Badge variant="secondary">Inactiva</Badge>}
            </div>

            <code className="block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {t.qr_token}
            </code>

            <div className="flex flex-wrap gap-1.5">
              <PrintQrButton qrToken={t.qr_token} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(t)}
                disabled={pending}
              >
                <Pencil className="size-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <RefreshCw className="size-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerar QR de "{t.label}"</AlertDialogTitle>
                    <AlertDialogDescription>
                      El QR actual va a quedar inservible. Tenés que reimprimir y reemplazar el
                      QR físico de la mesa. Las sesiones abiertas siguen funcionando para los
                      celulares ya conectados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRegenerate(t.id, t.label)}>
                      Sí, regenerar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={pending}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Eliminar "{t.label}"</AlertDialogTitle>
                    <AlertDialogDescription>
                      Si la mesa tiene sesiones históricas, esta acción podría fallar. Considerá
                      desactivarla en lugar de borrarla.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDelete(t.id, t.label)}>
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditTableDialog
          tenantSlug={tenantSlug}
          table={editing}
          open={Boolean(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: Verificar typecheck (espera errores por imports faltantes — los crearemos en task 17)**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck 2>&1 | head -30
```

- [ ] **Step 5: No commitear todavía** (faltan EditTableDialog y PrintQrButton).

---

### Task 17: Componentes auxiliares — `EditTableDialog` y `PrintQrButton`

**Files:**
- Create: `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/edit-table-dialog.tsx`
- Create: `app/(dashboard)/[tenantSlug]/configuracion/mesas/_components/print-qr-button.tsx`

- [ ] **Step 1: Crear `edit-table-dialog.tsx`**

```tsx
'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type TableActionState, updateTable } from '@/lib/tables/actions'

const initialState: TableActionState = { ok: false, message: '' }

export function EditTableDialog({
  tenantSlug,
  table,
  open,
  onClose,
}: {
  tenantSlug: string
  table: { id: string; label: string; capacity: number | null; active: boolean }
  open: boolean
  onClose: () => void
}) {
  const [state, action, pending] = useActionState(
    (prev: TableActionState, fd: FormData) => updateTable(tenantSlug, prev, fd),
    initialState,
  )

  useEffect(() => {
    if (state.ok) onClose()
  }, [state.ok, onClose])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar mesa</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={table.id} />
          <div>
            <Label htmlFor="edit-label">Nombre</Label>
            <Input
              id="edit-label"
              name="label"
              defaultValue={table.label}
              required
              maxLength={40}
            />
            {state.fieldErrors?.label && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.label}</p>
            )}
          </div>
          <div>
            <Label htmlFor="edit-capacity">Capacidad</Label>
            <Input
              id="edit-capacity"
              name="capacity"
              type="number"
              min={1}
              max={50}
              defaultValue={table.capacity ?? ''}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="edit-active" name="active" defaultChecked={table.active} />
            <Label htmlFor="edit-active">Mesa activa</Label>
          </div>
          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Crear `print-qr-button.tsx`**

```tsx
'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PrintQrButton({ qrToken }: { qrToken: string }) {
  const handleClick = () => {
    const url = `/print/qr/${encodeURIComponent(qrToken)}`
    window.open(url, '_blank', 'width=600,height=800')
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleClick}>
      <Printer className="size-3.5" />
    </Button>
  )
}
```

- [ ] **Step 3: Crear página de impresión server `app/print/qr/[qrToken]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildQrSheet } from '@/lib/tables/qr-pdf'
import { PrintSheet } from './_components/print-sheet'

export const metadata = { title: 'Imprimir QR' }
export const dynamic = 'force-dynamic'

export default async function PrintQrPage({
  params,
}: {
  params: Promise<{ qrToken: string }>
}) {
  const { qrToken } = await params

  // 1. Auth: el caller debe estar autenticado.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // 2. Resolver mesa por qr_token (vía service: bypass RLS para ubicar el tenant).
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('label, tenant_id, qr_token')
    .eq('qr_token', qrToken)
    .maybeSingle()
  if (!table) notFound()

  // 3. Verificar que el user es owner del tenant de esa mesa.
  const { data: membership } = await service
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', table.tenant_id)
    .maybeSingle()
  if (!membership || membership.role !== 'owner') notFound()

  // 4. Tenant name para el sheet.
  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', table.tenant_id)
    .maybeSingle()
  if (!tenant) notFound()

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const sheet = await buildQrSheet({
    qrToken: table.qr_token,
    tableLabel: table.label,
    tenantName: tenant.name,
    baseUrl,
  })

  return <PrintSheet sheet={sheet} />
}
```

- [ ] **Step 4: Crear `_components/print-sheet.tsx` (client)**

```tsx
'use client'

import { useEffect } from 'react'
import type { QrSheet } from '@/lib/tables/qr-pdf'

export function PrintSheet({ sheet }: { sheet: QrSheet }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-black">
      <style>{`
        @page { size: A6 portrait; margin: 8mm; }
        @media print { .no-print { display: none; } body { background: white; } }
      `}</style>
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-gray-500">{sheet.tenantName}</p>
        <h1 className="mt-1 text-3xl font-bold">{sheet.tableLabel}</h1>
      </div>
      <img
        src={sheet.qrDataUrl}
        alt={`QR de ${sheet.tableLabel}`}
        className="size-72"
      />
      <p className="text-center text-sm text-gray-700">
        Escaneá para ver la carta y pedir desde tu celular.
      </p>
      <p className="break-all text-center text-[10px] text-gray-400">{sheet.qrUrl}</p>
      <button
        type="button"
        className="no-print mt-6 rounded-lg bg-black px-4 py-2 text-sm text-white"
        onClick={() => window.print()}
      >
        Imprimir
      </button>
    </main>
  )
}
```

> **Nota arquitectural**: la página vive en `app/print/qr/[qrToken]/page.tsx` (fuera del grupo `(dashboard)`) para no heredar el layout del dashboard. Hereda solo del `app/layout.tsx` raíz, que renderiza el `<html>/<body>` mínimo.

> **Nota tasks 16/17**: en `tables-list.tsx` (Task 16), el componente `<PrintQrButton>` ahora se invoca solo con `qrToken` (no con `tenantName` ni `tableLabel`). Asegurate de pasar la prop correcta cuando lo uses.

- [ ] **Step 4: Verificar typecheck**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/\[tenantSlug\]/configuracion/mesas/
git commit -m "feat(plan1): pantalla owner /configuracion/mesas con CRUD + impresión QR"
```

---

### Task 18: Lib pública — `m-session/browser-token.ts`

**Files:**
- Create: `lib/m-session/browser-token.ts`

Helper client-only para gestionar el `browser_token` en localStorage.

- [ ] **Step 1: Crear el archivo**

```typescript
'use client'

const STORAGE_KEY = 'hub:browser_token'
const TOKEN_LENGTH = 24

function generateToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(TOKEN_LENGTH)
    crypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      out += alphabet[bytes[i]! % alphabet.length]
    }
    return out
  }
  // Fallback (no debería usarse en navegadores modernos)
  let out = ''
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export function getOrCreateBrowserToken(): string {
  if (typeof window === 'undefined') {
    throw new Error('getOrCreateBrowserToken must be called in the browser')
  }
  let token = window.localStorage.getItem(STORAGE_KEY)
  if (!token || token.length < 16 || token.length > 64) {
    token = generateToken()
    window.localStorage.setItem(STORAGE_KEY, token)
  }
  return token
}

export function clearBrowserToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/m-session/browser-token.ts
git commit -m "feat(plan1): helper getOrCreateBrowserToken (localStorage)"
```

---

### Task 19: Lib pública — `m-session/schemas.ts` y `m-session/actions.ts`

**Files:**
- Create: `lib/m-session/schemas.ts`
- Create: `lib/m-session/actions.ts`

Server Actions públicas (sin auth) que el comensal usa desde la pantalla `/m/[qrToken]`.

- [ ] **Step 1: Crear `schemas.ts`**

```typescript
import { z } from 'zod'
import { tryNormalizePhone } from '@/lib/phone'

const browserTokenField = z
  .string()
  .min(16, 'Token inválido')
  .max(64, 'Token inválido')

const qrTokenField = z
  .string()
  .min(8, 'QR inválido')
  .max(32, 'QR inválido')

const phoneField = z
  .string()
  .min(1, 'Ingresá un teléfono')
  .transform((v, ctx) => {
    const normalized = tryNormalizePhone(v)
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Teléfono inválido' })
      return z.NEVER
    }
    return normalized
  })

const nameField = z.string().trim().min(1, 'Requerido').max(60, 'Máximo 60')

export const joinSessionSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  display_name: z
    .union([z.string().trim().min(1).max(40), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null)),
})

export const registerCustomerSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  phone: phoneField,
  first_name: nameField,
  last_name: nameField,
  birthdate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido'), z.literal('')])
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable()
    .optional(),
  opt_in_marketing: z.coerce.boolean().default(false),
  // honeypot
  website: z.string().optional(),
})
```

- [ ] **Step 2: Crear `actions.ts`**

```typescript
'use server'

import { z } from 'zod'
import { getRequestIp, getRequestUserAgent } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { joinSessionSchema, registerCustomerSchema } from './schemas'

export type JoinSessionResult =
  | { ok: true; sessionId: string; guestId: string; wasNewGuest: boolean }
  | { ok: false; message: string }

export type RegisterCustomerResult =
  | { ok: true; customerId: string; wasNewCustomer: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function joinSession(params: {
  qrToken: string
  browserToken: string
  displayName?: string | null
}): Promise<JoinSessionResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `m-join:${ip}`, limit: 30, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = joinSessionSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
    display_name: params.displayName ?? null,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('join_session_as_guest', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_display_name: parsed.data.display_name,
  })

  if (error) {
    if (error.message.includes('invalid_qr_token')) {
      return { ok: false, message: 'El QR no es válido o la mesa no está activa.' }
    }
    console.error('[m-session.joinSession]', error.message)
    return { ok: false, message: 'No pudimos unirte a la mesa.' }
  }

  const result = data as {
    session_id: string
    guest_id: string
    was_new_guest: boolean
  }
  return {
    ok: true,
    sessionId: result.session_id,
    guestId: result.guest_id,
    wasNewGuest: result.was_new_guest,
  }
}

export async function registerCustomer(formData: FormData): Promise<RegisterCustomerResult> {
  const ip = await getRequestIp()
  const userAgent = await getRequestUserAgent()

  try {
    rateLimit({ key: `m-register:${ip}`, limit: 10, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = registerCustomerSchema.safeParse({
    qr_token: formData.get('qr_token'),
    browser_token: formData.get('browser_token'),
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    birthdate: formData.get('birthdate') ?? '',
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
    website: formData.get('website') ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  // Honeypot anti-bot
  if (parsed.data.website && parsed.data.website.length > 0) {
    return { ok: false, message: 'Solicitud rechazada' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('register_customer_for_session', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_phone: parsed.data.phone,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_birthdate: parsed.data.birthdate ?? null,
    p_opt_in_marketing: parsed.data.opt_in_marketing,
    p_ip: ip,
    p_user_agent: userAgent ?? '',
  })

  if (error) {
    if (error.message.includes('no_active_session')) {
      return { ok: false, message: 'No hay una mesa activa para este QR.' }
    }
    if (error.message.includes('guest_not_found')) {
      return { ok: false, message: 'Volvé a escanear el QR.' }
    }
    if (error.message.includes('invalid_phone')) {
      return { ok: false, message: 'Teléfono inválido' }
    }
    console.error('[m-session.registerCustomer]', error.message)
    return { ok: false, message: 'No pudimos guardar tus datos.' }
  }

  const result = data as { customer_id: string; was_new_customer: boolean }
  return {
    ok: true,
    customerId: result.customer_id,
    wasNewCustomer: result.was_new_customer,
  }
}
```

- [ ] **Step 3: Verificar typecheck**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add lib/m-session/
git commit -m "feat(plan1): server actions públicas joinSession y registerCustomer"
```

---

### Task 20: Página pública `/m/[qrToken]/page.tsx`

**Files:**
- Create: `app/m/[qrToken]/page.tsx`
- Create: `app/m/[qrToken]/loading.tsx`
- Create: `app/m/[qrToken]/not-found.tsx`
- Create: `app/m/[qrToken]/_components/mesa-screen.tsx`
- Create: `app/m/[qrToken]/_components/register-dialog.tsx`

La página pública que el comensal ve al escanear. En Plan 1 NO muestra carta — solo info de mesa + botón de registro.

- [ ] **Step 1: Crear `page.tsx` (server component)**

```tsx
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { MesaScreen } from './_components/mesa-screen'

export const metadata = { title: 'Mesa' }

export default async function MesaPage({
  params,
}: {
  params: Promise<{ qrToken: string }>
}) {
  const { qrToken } = await params

  // Validamos que el qr_token existe usando service client (bypass RLS).
  // El cliente browser hará get_session_state vía RPC anon para abrir/sumarse.
  const service = createServiceClient()
  const { data: table } = await service
    .from('physical_tables')
    .select('label, tenant_id, active')
    .eq('qr_token', qrToken)
    .maybeSingle()

  if (!table || !table.active) notFound()

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', table.tenant_id)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <main className="min-h-screen bg-background">
      <MesaScreen
        qrToken={qrToken}
        tableLabel={table.label}
        tenantName={tenant.name}
      />
    </main>
  )
}
```

- [ ] **Step 2: Crear `loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col gap-4 p-6">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-32 w-full" />
    </main>
  )
}
```

- [ ] **Step 3: Crear `not-found.tsx`**

```tsx
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">QR no válido</h1>
        <p className="text-sm text-muted-foreground">
          Pedile al mozo el QR correcto de tu mesa.
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Crear `_components/mesa-screen.tsx` (client)**

```tsx
'use client'

import { Sparkles, UserCircle2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { joinSession } from '@/lib/m-session/actions'
import { getOrCreateBrowserToken } from '@/lib/m-session/browser-token'
import { RegisterDialog } from './register-dialog'

type SessionInfo = {
  sessionId: string
  guestId: string
  wasNewGuest: boolean
}

export function MesaScreen({
  qrToken,
  tableLabel,
  tenantName,
}: {
  qrToken: string
  tableLabel: string
  tenantName: string
}) {
  const [browserToken, setBrowserToken] = useState<string | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [registered, setRegistered] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = getOrCreateBrowserToken()
    setBrowserToken(token)
  }, [])

  useEffect(() => {
    if (!browserToken) return
    let cancelled = false
    void (async () => {
      const result = await joinSession({ qrToken, browserToken, displayName: null })
      if (cancelled) return
      if (result.ok) {
        setSession({
          sessionId: result.sessionId,
          guestId: result.guestId,
          wasNewGuest: result.wasNewGuest,
        })
      } else {
        setError(result.message)
        toast.error(result.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browserToken, qrToken])

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-10">
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {tenantName}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          {tableLabel}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {error ? 'No pudimos abrir tu mesa.' : 'Estás en tu mesa.'}
        </p>
      </div>

      {session && !registered && (
        <div className="card-hairline space-y-4 rounded-2xl border bg-card/90 p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" />
            <span>Sumá puntos en cada pedido.</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cargá tu teléfono y nombre en 30 segundos. Es opcional — podés pedir igual sin
            registrarte.
          </p>
          <Button className="w-full" onClick={() => setShowRegister(true)}>
            Registrarme para sumar puntos
          </Button>
        </div>
      )}

      {registered && (
        <div className="card-hairline space-y-2 rounded-2xl border bg-card/90 p-5 shadow-xl">
          <div className="flex items-center gap-2 text-sm">
            <UserCircle2 className="size-4 text-primary" />
            <span>Estás registrado para sumar puntos. </span>
          </div>
          <p className="text-xs text-muted-foreground">
            En el próximo plan vas a poder pedir desde acá. Por ahora pedile al mozo lo que
            quieras y al cobrar la mesa sumás tus puntos.
          </p>
        </div>
      )}

      {session && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Users className="size-3" />
          Sesión abierta · ID interno {session.sessionId.slice(0, 8)}
        </p>
      )}

      {session && showRegister && browserToken && (
        <RegisterDialog
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          onClose={() => setShowRegister(false)}
          onRegistered={() => {
            setRegistered(true)
            setShowRegister(false)
            toast.success('¡Listo! Tus puntos van a sumarse al cerrar la mesa.')
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Crear `_components/register-dialog.tsx`**

```tsx
'use client'

import { useActionState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerCustomer, type RegisterCustomerResult } from '@/lib/m-session/actions'

const initial: RegisterCustomerResult = { ok: false, message: '' }

export function RegisterDialog({
  qrToken,
  browserToken,
  tenantName,
  onClose,
  onRegistered,
}: {
  qrToken: string
  browserToken: string
  tenantName: string
  onClose: () => void
  onRegistered: () => void
}) {
  const [state, action, pending] = useActionState(
    (_prev: RegisterCustomerResult, fd: FormData) => registerCustomer(fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) onRegistered()
  }, [state.ok, onRegistered])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sumá puntos en {tenantName}</DialogTitle>
          <DialogDescription>
            Solo necesitamos tres datos. Tus datos quedan únicamente con {tenantName}.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="qr_token" value={qrToken} />
          <input type="hidden" name="browser_token" value={browserToken} />

          {/* honeypot anti-bot — invisible para humanos */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first_name">Nombre</Label>
              <Input id="first_name" name="first_name" autoFocus required maxLength={60} />
              {state.fieldErrors?.first_name && (
                <p className="mt-1 text-xs text-destructive">{state.fieldErrors.first_name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="last_name">Apellido</Label>
              <Input id="last_name" name="last_name" required maxLength={60} />
              {state.fieldErrors?.last_name && (
                <p className="mt-1 text-xs text-destructive">{state.fieldErrors.last_name}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="phone">Teléfono</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              required
              placeholder="11 4567 8901"
              autoComplete="tel"
            />
            {state.fieldErrors?.phone && (
              <p className="mt-1 text-xs text-destructive">{state.fieldErrors.phone}</p>
            )}
          </div>

          <div>
            <Label htmlFor="birthdate">Cumpleaños (opcional)</Label>
            <Input id="birthdate" name="birthdate" type="date" />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="opt_in_marketing" name="opt_in_marketing" defaultChecked />
            <Label htmlFor="opt_in_marketing" className="text-xs text-muted-foreground">
              Quiero recibir novedades y promos por WhatsApp
            </Label>
          </div>

          {!state.ok && state.message && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Sumar puntos'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Verificar typecheck y biome**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add app/m/
git commit -m "feat(plan1): página pública /m/[qrToken] con alta de comensal"
```

---

### Task 21: Smoke manual + documentación + cleanup final

**Files:**
- Create: `docs/superpowers/plans/2026-05-06-plan-1-smoke.md`

Documentar el smoke manual end-to-end del Plan 1. Esto **no implementa código nuevo**; cierra el plan y deja el guion exacto para validar antes de pasar al Plan 2.

- [ ] **Step 1: Levantar el dev server y supabase local**

```bash
cd /mnt/c/Users/Agust/Hub
npm run db:start
npm run dev
```

Esperá que ambos estén corriendo. Acceso: `http://localhost:3000`.

- [ ] **Step 2: Smoke owner — crear, editar, regenerar, imprimir, eliminar mesas**

1. Logueate como owner del tenant seed.
2. Andá a `/<slug>/configuracion/mesas`. Verificá que carga la página.
3. Tocá "Nueva mesa", crear "Mesa Test 1" con capacidad 4.
4. Verificá que aparece en la lista con un `qr_token` visible.
5. Tocá el botón de imprimir. Debería abrir una nueva pestaña con el QR + label, con prompt de imprimir automático.
6. Volvé a la lista y tocá editar. Cambiá el nombre a "Mesa Test 1B" y guardá. Verificá que se actualiza.
7. Tocá regenerar QR. Confirmá. Verificá que el `qr_token` cambia.
8. Tocá eliminar. Confirmá. Verificá que desaparece.

- [ ] **Step 3: Smoke comensal — escanear y registrarse**

1. Crea de nuevo "Mesa 5".
2. Copiá el `qr_token` (visible en la card).
3. Abrí en una pestaña incógnito: `http://localhost:3000/m/<qr_token>`.
4. Verificá que aparece "Mesa 5" + nombre del bar + botón de registro.
5. Tocá "Registrarme para sumar puntos".
6. Llenar el form con teléfono, nombre, apellido, cumpleaños. Submit.
7. Verificá toast de éxito y mensaje de "registrado".
8. Refrescá la pestaña. Verificá que el estado de "registrado" persiste (el `browser_token` está en localStorage y la sesión sigue abierta en DB).

- [ ] **Step 4: Smoke bordes — QR inválido, registro duplicado**

1. Andá a `http://localhost:3000/m/inventadoXYZ123` → debería mostrar "QR no válido".
2. En otra pestaña incógnito (browser_token nuevo), escanea la misma "Mesa 5". Verificá que se une como guest #2 a la sesión existente (no abre nueva).
3. En esa pestaña, registrate con el **mismo teléfono** que el primer comensal. Verificá que NO crea customer duplicado: en la DB, `customers` debe tener una sola fila para ese phone, y el `session_guests.customer_id` del segundo guest apunta al mismo customer.
4. Verifica vía SQL:

```sql
select count(*) from public.session_guests where customer_id is not null;
-- Debería ser 2 (los dos guests apuntando al mismo customer).
select count(*) from public.customers where phone = '<el teléfono que usaste>';
-- Debería ser 1.
```

- [ ] **Step 5: Smoke RLS — owner del Bar B no ve mesas del Bar A**

1. Logueate como owner del tenant B.
2. Intentá acceder directo a `/<slug-tenant-A>/configuracion/mesas`. Debería responder `notFound()` (404).
3. Si tu seed solo tiene un tenant, creá uno de prueba con un user diferente y repetí.

- [ ] **Step 6: Documentar resultado**

Crear `docs/superpowers/plans/2026-05-06-plan-1-smoke.md` con:

```markdown
# Plan 1 — Smoke manual

**Fecha**: <hoy>
**Operador**: <tu nombre>
**Resultado global**: ✅ todo verde / ⚠️ ver issues abajo

## Pasos ejecutados

1. ✅ Owner crea/edita/regenera/elimina mesa
2. ✅ Imprimir QR abre vista con QR válido
3. ✅ Comensal escanea, se registra, persiste tras refresh
4. ✅ QR inválido muestra not-found
5. ✅ Dedupe de customer por phone funciona
6. ✅ RLS bloquea cross-tenant

## Issues encontrados

(Si los hay, describilos acá con repro y fix.)

## Screenshots / video

(Adjuntos si son relevantes.)
```

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/plans/2026-05-06-plan-1-smoke.md
git commit -m "docs(plan1): smoke manual end-to-end documentado"
```

- [ ] **Step 8: Correr full test suite y typecheck**

```bash
cd /mnt/c/Users/Agust/Hub
npm run typecheck && npm run lint && npm run test:ci
```

Expected: typecheck clean, lint clean (o solo warnings preexistentes), todos los tests pass.

---

## Resumen de entregables del Plan 1

Después de ejecutar las 21 tasks:

**Migrations**: 6 archivos en `supabase/migrations/` (enums + helpers, 4 tablas, RPCs).

**Server-side TypeScript**: `lib/tables/`, `lib/m-session/`, `lib/tables/qr-pdf.ts`.

**Páginas**:
- `/<slug>/configuracion/mesas` (owner) con CRUD + impresión QR.
- `/m/[qrToken]` (público anon) con alta de comensal.

**Tests**: `tests/rls/physical-tables.test.ts` y `tests/rls/sessions.test.ts` (incluye RPCs).

**Outcome**: el bar puede gestionar mesas, imprimir QRs y los comensales pueden escanear y registrarse para puntos. **No hay pedidos todavía** — eso llega en Plan 2.

---

## Lo que NO está en Plan 1 (queda para Plan 2+)

- Tickets, comandas, ítems, estados de pedido.
- Carta visible en `/m/[qrToken]` con carrito y submit.
- Dashboard del mozo (`/<slug>/sesiones`).
- KDS (`/<slug>/cocina`) y rol `kitchen`.
- `mark_session_paid` con motor de puntos integrado.
- Punch cards.
- Operaciones avanzadas (split/merge/move).
- Auto-aceptación + caps.
- Cron de abandoned + expire de punch cards.
