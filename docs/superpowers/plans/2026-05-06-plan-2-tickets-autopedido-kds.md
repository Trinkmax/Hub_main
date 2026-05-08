# Plan 2 — Tickets, auto-pedido del comensal y KDS lite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo end-to-end del comensal: ver carta desde el QR, armar carrito, "Realizar orden" → comanda en `pending` → mozo confirma → cocina prepara → mozo entrega. Sin pago ni puntos todavía (Plan 3).

**Architecture:** Dos tablas nuevas (`tickets`, `ticket_items`), un rol nuevo (`kitchen`), 7 RPCs (3 anon, 4 autenticadas con role-gating), una vista pública de la carta, y tres UIs nuevas: carta pública con carrito, dashboard de sesiones del mozo y vista lite de cocina. Realtime via Supabase para propagar cambios de estado.

**Tech Stack:** Igual que Plan 1, suma `@supabase/realtime-js` que ya viene con `supabase-js`.

**Spec referencia:** `docs/superpowers/specs/2026-05-06-mesas-pedidos-puntos-design.md` §4.4–4.5, §6.1–6.3, §7 (parcial), §8.

**Convenciones del repo**: ver Plan 1, sección homónima. No las repito.

**Modo de ejecución**: si Docker no está disponible, ejecutar "en seco" — escribir migrations + commit, dejar `db:reset` y tests RLS para cuando Docker esté. Cada commit se hace tras un `npm run typecheck && npm run lint:fix` exitoso.

---

## File Structure

### Migraciones (en orden)
- `supabase/migrations/20260506110000_plan2_tickets_enums_and_role.sql` — enum `ticket_status`, rol `kitchen` agregado a `memberships`, helper `user_has_kitchen_role`.
- `supabase/migrations/20260506110100_plan2_tickets_tables.sql` — tablas `tickets`, `ticket_items` + RLS + GRANTs + trigger de `total_cents` en `table_sessions`.
- `supabase/migrations/20260506110200_plan2_ticket_rpcs_anon.sql` — RPCs públicas: `submit_ticket`, `cancel_pending_ticket`, `request_bill`, extiende `get_session_state` para incluir tickets propios + carta.
- `supabase/migrations/20260506110300_plan2_ticket_rpcs_auth.sql` — RPCs autenticadas: `accept_ticket`, `reject_ticket`, `update_ticket_status`, `cancel_ticket_item`, `add_staff_ticket`.

### Lib (TypeScript)
- `lib/tickets/schemas.ts`, `lib/tickets/queries.ts`, `lib/tickets/actions.ts` — queries y server actions del mozo + cocina sobre tickets.
- `lib/m-session/actions.ts` extend con `submitTicket`, `cancelTicket`, `requestBill`, `refreshState`.
- `lib/sessions-waiter/queries.ts`, `lib/sessions-waiter/actions.ts` — queries y actions para el dashboard mozo (listar sesiones open, marcar paid placeholder).
- `lib/realtime/subscribe.ts` — helper compartido para suscribir a un canal y cleanup.

### Páginas
- `app/m/[qrToken]/_components/mesa-screen.tsx` — extender con: tabs (Carta / Mis órdenes), carrito sticky, submit, tracking de tickets propios.
- `app/m/[qrToken]/_components/menu-list.tsx` — render de la carta con add-to-cart (client).
- `app/m/[qrToken]/_components/cart-sheet.tsx` — drawer del carrito con submit.
- `app/m/[qrToken]/_components/my-orders-pane.tsx` — pestaña de tickets propios con realtime.
- `app/(dashboard)/[tenantSlug]/sesiones/page.tsx` — dashboard mozo: grilla de sesiones open con badges.
- `app/(dashboard)/[tenantSlug]/sesiones/_components/sessions-grid.tsx` — client, realtime.
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/page.tsx` — detalle de sesión con tickets, guests, acciones.
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/session-detail.tsx` — client.
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/ticket-card.tsx` — render de un ticket con sus items y botones de estado.
- `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/add-staff-ticket-dialog.tsx` — mozo crea comanda de palabra.
- `app/(dashboard)/[tenantSlug]/cocina/page.tsx` — KDS lite, server, gating role kitchen|owner.
- `app/(dashboard)/[tenantSlug]/cocina/_components/kds-screen.tsx` — client, realtime.

### Tests
- `tests/rls/tickets.test.ts` — RLS de tickets (read-only para staff, write via RPC) + tests de submit_ticket, accept, reject, update_status, cancel_item, add_staff_ticket vía cliente authenticated y anon.

---

## Tasks

> Total: 24 tasks. DB primero (1-11), backend lib (12-15), UI cliente (16-19), UI mozo (20-22), UI cocina (23), smoke (24).

---

### Task 1: Migration — `ticket_status` enum + `kitchen` role

**Files:**
- Create: `supabase/migrations/20260506110000_plan2_tickets_enums_and_role.sql`

- [ ] **Step 1: Escribir la migration**

```sql
-- Plan 2: enums + rol kitchen.

-- ──────────────────────────────────────────────────────────
-- 1. Enum ticket_status
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. Sumar 'kitchen' al enum tenant_role existente
-- ──────────────────────────────────────────────────────────
-- Postgres no permite alterar enums usados en check constraints o RLS sin
-- pasos extra. Usamos alter type ... add value que es seguro a partir de PG 12.
do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'kitchen'
      and enumtypid = 'public.tenant_role'::regtype
  ) then
    alter type public.tenant_role add value 'kitchen';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 3. Helper: user_has_kitchen_role
-- ──────────────────────────────────────────────────────────
create or replace function public.user_has_kitchen_role(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
      and role in ('owner', 'kitchen')
  )
$$;

revoke all on function public.user_has_kitchen_role(uuid) from public;
grant execute on function public.user_has_kitchen_role(uuid) to authenticated;
```

- [ ] **Step 2**: Commit `feat(plan2): enum ticket_status + rol kitchen + helper user_has_kitchen_role`

---

### Task 2: Migration — `tickets` y `ticket_items`

**Files:**
- Create: `supabase/migrations/20260506110100_plan2_tickets_tables.sql`

- [ ] **Step 1: Escribir la migration**

```sql
-- Plan 2: tickets y ticket_items.

-- ──────────────────────────────────────────────────────────
-- 1. tickets
-- ──────────────────────────────────────────────────────────
create table public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  status                public.ticket_status not null default 'pending',
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  submitted_at          timestamptz not null default now(),
  accepted_at           timestamptz,
  accepted_by_user_id   uuid references auth.users(id) on delete set null,
  prepared_at           timestamptz,
  served_at             timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  total_cents           bigint not null default 0 check (total_cents >= 0),
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (
    (created_by_guest_id is not null and created_by_user_id is null) or
    (created_by_guest_id is null and created_by_user_id is not null)
  )
);

create unique index tickets_idempotency_uidx
  on public.tickets(session_id, idempotency_key)
  where idempotency_key is not null;
create index tickets_session_idx
  on public.tickets(session_id, submitted_at desc);
create index tickets_tenant_pending_idx
  on public.tickets(tenant_id, status, submitted_at)
  where status in ('pending', 'accepted', 'preparing', 'ready');

create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. ticket_items
-- ──────────────────────────────────────────────────────────
create table public.ticket_items (
  id                      uuid primary key default gen_random_uuid(),
  ticket_id               uuid not null references public.tickets(id) on delete cascade,
  menu_item_id            uuid not null references public.menu_items(id) on delete restrict,
  quantity                int not null check (quantity > 0),
  unit_price_cents        bigint not null check (unit_price_cents >= 0),
  line_total_cents        bigint not null check (line_total_cents >= 0),
  assigned_to_guest_id    uuid references public.session_guests(id) on delete set null,
  notes                   text,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz not null default now()
);

create index ticket_items_ticket_idx on public.ticket_items(ticket_id);
create index ticket_items_assigned_idx
  on public.ticket_items(assigned_to_guest_id)
  where assigned_to_guest_id is not null;
create index ticket_items_menu_item_idx on public.ticket_items(menu_item_id);

-- ──────────────────────────────────────────────────────────
-- 3. Trigger: mantener total_cents en table_sessions y tickets
-- ──────────────────────────────────────────────────────────
create or replace function public.recalc_ticket_total()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_ticket_id uuid;
  v_session_id uuid;
  v_ticket_total bigint;
  v_session_total bigint;
begin
  v_ticket_id := coalesce(new.ticket_id, old.ticket_id);

  -- Recalcular total del ticket (suma de líneas no canceladas)
  select coalesce(sum(line_total_cents), 0) into v_ticket_total
    from public.ticket_items
    where ticket_id = v_ticket_id and cancelled_at is null;
  update public.tickets
    set total_cents = v_ticket_total, updated_at = now()
    where id = v_ticket_id
    returning session_id into v_session_id;

  -- Recalcular total de la sesión (suma de tickets no cancelados)
  if v_session_id is not null then
    select coalesce(sum(total_cents), 0) into v_session_total
      from public.tickets
      where session_id = v_session_id and status <> 'cancelled';
    update public.table_sessions
      set total_cents = v_session_total, updated_at = now()
      where id = v_session_id;
  end if;

  return coalesce(new, old);
end $$;

create trigger ticket_items_recalc_total
  after insert or update or delete on public.ticket_items
  for each row execute function public.recalc_ticket_total();

-- También recalcular cuando un ticket cambia de estado (cancelled afecta total sesión)
create or replace function public.recalc_session_on_ticket_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_session_total bigint;
begin
  if new.status is distinct from old.status and (
    new.status = 'cancelled' or old.status = 'cancelled'
  ) then
    select coalesce(sum(total_cents), 0) into v_session_total
      from public.tickets
      where session_id = new.session_id and status <> 'cancelled';
    update public.table_sessions
      set total_cents = v_session_total, updated_at = now()
      where id = new.session_id;
  end if;
  return new;
end $$;

create trigger tickets_recalc_session_total
  after update on public.tickets
  for each row execute function public.recalc_session_on_ticket_status();

-- ──────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────
alter table public.tickets enable row level security;
create policy "tk_select_member" on public.tickets
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- Sin policies de write para authenticated. Solo via RPC SECURITY DEFINER.

alter table public.ticket_items enable row level security;
create policy "ti_select_member" on public.ticket_items
  for select to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and t.tenant_id in (select public.user_tenant_ids())
    )
  );

-- ──────────────────────────────────────────────────────────
-- 5. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.tickets to authenticated;
grant select on public.ticket_items to authenticated;
```

- [ ] **Step 2**: Commit `feat(plan2): tablas tickets y ticket_items con triggers de total_cents`

---

### Task 3: Migration — RPCs públicas (anon)

**Files:**
- Create: `supabase/migrations/20260506110200_plan2_ticket_rpcs_anon.sql`

Tres RPCs públicas: `submit_ticket`, `cancel_pending_ticket`, `request_bill`. Más una nueva versión de `get_session_state` que ahora también devuelve la carta y los tickets propios del guest.

- [ ] **Step 1: Escribir la migration**

```sql
-- Plan 2: RPCs públicas para tickets y request_bill.

-- ──────────────────────────────────────────────────────────
-- RPC: submit_ticket (anon)
-- ──────────────────────────────────────────────────────────
-- p_items: jsonb array con shape:
--   [{"menu_item_id": uuid, "quantity": int, "notes": string|null,
--     "assigned_to_guest_id": uuid|null}]
-- Si "assigned_to_guest_id" es null, el ítem se considera shared.
create or replace function public.submit_ticket(
  p_qr_token text,
  p_browser_token text,
  p_items jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_guest_id uuid;
  v_ticket_id uuid;
  v_existing_ticket public.tickets;
  v_auto_accept boolean;
  v_auto_max_cents bigint;
  v_auto_max_items int;
  v_ticket_status public.ticket_status;
  v_total_cents bigint := 0;
  v_total_items int := 0;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_line_total bigint;
  v_assigned_to uuid;
begin
  -- Validación
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'invalid_idempotency_key' using errcode = 'P0001';
  end if;

  -- Resolver sesión + guest
  select ts.id, ts.tenant_id into v_session_id, v_tenant_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open'
    for update of ts;
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select id into v_guest_id
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token;
  if v_guest_id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency
  select * into v_existing_ticket
    from public.tickets
    where session_id = v_session_id and idempotency_key = p_idempotency_key;
  if v_existing_ticket.id is not null then
    return jsonb_build_object(
      'ticket_id', v_existing_ticket.id,
      'status', v_existing_ticket.status,
      'idempotent_replay', true
    );
  end if;

  -- Auto-aceptación config (default off)
  -- Usamos columnas en tenants si existen; si no, default false.
  -- Plan 5 va a agregar estas columnas; por ahora siempre pending.
  v_auto_accept := false;

  -- Determinar status final
  if v_auto_accept then
    v_ticket_status := 'accepted';
  else
    v_ticket_status := 'pending';
  end if;

  -- Crear ticket
  insert into public.tickets (
    tenant_id, session_id, status, created_by_guest_id,
    submitted_at, idempotency_key,
    accepted_at, accepted_by_user_id
  ) values (
    v_tenant_id, v_session_id, v_ticket_status, v_guest_id,
    now(), p_idempotency_key,
    case when v_auto_accept then now() else null end,
    null
  ) returning id into v_ticket_id;

  -- Insertar items
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_tenant_id
        and active = true;
    if v_menu.id is null then
      raise exception 'menu_item_not_available' using errcode = 'P0001';
    end if;

    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 50 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    v_line_total := v_menu.price_cents * v_qty;
    v_assigned_to := nullif(v_item->>'assigned_to_guest_id', '')::uuid;

    -- Si assigned_to no nulo, debe pertenecer a la sesión
    if v_assigned_to is not null and not exists (
      select 1 from public.session_guests
      where id = v_assigned_to and session_id = v_session_id
    ) then
      raise exception 'invalid_assigned_guest' using errcode = 'P0001';
    end if;

    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents,
      line_total_cents, assigned_to_guest_id, notes
    ) values (
      v_ticket_id, v_menu.id, v_qty, v_menu.price_cents,
      v_line_total, v_assigned_to,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    );

    v_total_cents := v_total_cents + v_line_total;
    v_total_items := v_total_items + v_qty;
  end loop;

  -- Refrescar last_activity_at del guest
  update public.session_guests
    set last_activity_at = now()
    where id = v_guest_id;

  return jsonb_build_object(
    'ticket_id', v_ticket_id,
    'status', v_ticket_status,
    'total_cents', v_total_cents,
    'total_items', v_total_items,
    'idempotent_replay', false
  );
end $$;

revoke all on function public.submit_ticket(text, text, jsonb, text) from public;
grant execute on function public.submit_ticket(text, text, jsonb, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: cancel_pending_ticket (anon)
-- ──────────────────────────────────────────────────────────
-- El comensal puede cancelar su propio ticket si todavía está pending
-- y dentro de 60 segundos desde submit.
create or replace function public.cancel_pending_ticket(
  p_ticket_id uuid,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_guest public.session_guests;
begin
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;

  if v_ticket.status <> 'pending' then
    raise exception 'ticket_not_cancellable' using errcode = 'P0001';
  end if;

  if now() - v_ticket.submitted_at > interval '60 seconds' then
    raise exception 'cancel_window_expired' using errcode = 'P0001';
  end if;

  -- Verificar que el browser_token corresponde al guest creator
  select * into v_guest
    from public.session_guests
    where id = v_ticket.created_by_guest_id;
  if v_guest.id is null or v_guest.browser_token <> p_browser_token then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.tickets
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'guest_cancelled',
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'cancelled', true);
end $$;

revoke all on function public.cancel_pending_ticket(uuid, text) from public;
grant execute on function public.cancel_pending_ticket(uuid, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: request_bill (anon)
-- ──────────────────────────────────────────────────────────
-- Escribe un evento bill_requested en la sesión. No bloquea pedidos.
create or replace function public.request_bill(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_guest_id uuid;
begin
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select ts.id into v_session_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open';
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select id into v_guest_id
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token;
  if v_guest_id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- Anti-spam: si ya pidió cuenta en los últimos 60s, no-op
  if exists (
    select 1 from public.table_session_events
    where session_id = v_session_id
      and type = 'bill_requested'
      and created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('already_requested', true);
  end if;

  insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
    values (v_session_id, 'bill_requested', v_guest_id, '{}'::jsonb);

  update public.session_guests
    set last_activity_at = now()
    where id = v_guest_id;

  return jsonb_build_object('session_id', v_session_id, 'requested', true);
end $$;

revoke all on function public.request_bill(text, text) from public;
grant execute on function public.request_bill(text, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- Reemplazo: get_session_state extendido
-- ──────────────────────────────────────────────────────────
-- Ahora también devuelve la carta del tenant + los tickets del guest
-- (si tiene browser_token). Compatible con el caller del Plan 1 (los
-- campos existentes siguen).
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
  v_menu jsonb;
  v_my_tickets jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  select label into v_table_label
    from public.physical_tables where id = v_physical_table_id;
  select name into v_tenant_name
    from public.tenants where id = v_tenant_id;

  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session_id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session_id;

  -- Carta agrupada por categoría
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id,
        'name', mi.name,
        'description', mi.description,
        'price_cents', mi.price_cents,
        'image_url', mi.image_url,
        'position', mi.position
      ) order by mi.position) filter (where mi.id is not null and mi.active), '[]'::jsonb)
    ) as category
    from public.menu_categories mc
    left join public.menu_items mi
      on mi.category_id = mc.id and mi.tenant_id = v_tenant_id
    where mc.tenant_id = v_tenant_id and mc.active = true
    group by mc.id
  ) cats;

  -- Tickets propios del guest (si existe)
  if v_guest_id is not null then
    select coalesce(jsonb_agg(ticket order by ticket->>'submitted_at' desc), '[]'::jsonb)
    into v_my_tickets
    from (
      select jsonb_build_object(
        'id', t.id,
        'status', t.status,
        'submitted_at', t.submitted_at,
        'total_cents', t.total_cents,
        'cancellation_reason', t.cancellation_reason,
        'items', coalesce(jsonb_agg(jsonb_build_object(
          'id', ti.id,
          'menu_item_name', mi.name,
          'quantity', ti.quantity,
          'unit_price_cents', ti.unit_price_cents,
          'line_total_cents', ti.line_total_cents,
          'notes', ti.notes,
          'cancelled_at', ti.cancelled_at
        )), '[]'::jsonb)
      ) as ticket
      from public.tickets t
      left join public.ticket_items ti on ti.ticket_id = t.id
      left join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session_id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'physical_table_id', v_physical_table_id,
    'table_label', v_table_label,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', v_was_new,
    'menu', v_menu,
    'my_tickets', v_my_tickets
  );
end $$;
-- grant ya existe del Plan 1
```

- [ ] **Step 2**: Commit `feat(plan2): RPCs públicas submit_ticket / cancel_pending / request_bill + carta en get_session_state`

---

### Task 4: Migration — RPCs autenticadas

**Files:**
- Create: `supabase/migrations/20260506110300_plan2_ticket_rpcs_auth.sql`

Cinco RPCs para staff: `accept_ticket`, `reject_ticket`, `update_ticket_status`, `cancel_ticket_item`, `add_staff_ticket`.

- [ ] **Step 1: Escribir la migration**

```sql
-- Plan 2: RPCs autenticadas para staff (waiter, owner, kitchen).

-- Helper interno: verifica que el caller tiene un rol permitido en el tenant
-- de la sesión/ticket.
create or replace function public._check_staff_role(
  p_tenant_id uuid,
  p_allowed_roles text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_role = any(p_allowed_roles)) then
    raise exception 'role_not_allowed' using errcode = '42501';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- RPC: accept_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.accept_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner']);

  if v_ticket.status = 'accepted' then
    return jsonb_build_object('ticket_id', p_ticket_id, 'status', 'accepted', 'idempotent', true);
  end if;
  if v_ticket.status <> 'pending' then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;

  update public.tickets
    set status = 'accepted',
        accepted_at = now(),
        accepted_by_user_id = auth.uid(),
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', 'accepted', 'idempotent', false);
end $$;

revoke all on function public.accept_ticket(uuid) from public;
grant execute on function public.accept_ticket(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: reject_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.reject_ticket(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_clean_reason text;
begin
  v_clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_clean_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner']);

  if v_ticket.status <> 'pending' then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;

  update public.tickets
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = v_clean_reason,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'cancelled', true);
end $$;

revoke all on function public.reject_ticket(uuid, text) from public;
grant execute on function public.reject_ticket(uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: update_ticket_status (waiter, owner, kitchen)
-- ──────────────────────────────────────────────────────────
-- Transiciones válidas:
--   accepted -> preparing (waiter, kitchen, owner)
--   preparing -> ready (waiter, kitchen, owner)
--   ready -> served (waiter, owner)
create or replace function public.update_ticket_status(
  p_ticket_id uuid,
  p_new_status public.ticket_status
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_role text;
  v_allowed boolean := false;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_ticket.tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Validar transición + rol
  if v_ticket.status = 'accepted' and p_new_status = 'preparing' then
    if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
  elsif v_ticket.status = 'preparing' and p_new_status = 'ready' then
    if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
  elsif v_ticket.status = 'ready' and p_new_status = 'served' then
    if v_role in ('waiter', 'owner') then v_allowed := true; end if;
  end if;

  if not v_allowed then
    raise exception 'invalid_transition_or_role' using errcode = '42501';
  end if;

  update public.tickets
    set status = p_new_status,
        prepared_at = case when p_new_status = 'preparing' and prepared_at is null then now() else prepared_at end,
        served_at = case when p_new_status = 'served' then now() else served_at end,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', p_new_status);
end $$;

revoke all on function public.update_ticket_status(uuid, public.ticket_status) from public;
grant execute on function public.update_ticket_status(uuid, public.ticket_status) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: cancel_ticket_item (waiter, owner, kitchen)
-- ──────────────────────────────────────────────────────────
-- Cancela un ítem específico (típicamente por sin stock).
create or replace function public.cancel_ticket_item(
  p_ticket_item_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.ticket_items;
  v_ticket public.tickets;
  v_clean_reason text;
begin
  v_clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_clean_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_item from public.ticket_items where id = p_ticket_item_id for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if v_item.cancelled_at is not null then
    return jsonb_build_object('item_id', p_ticket_item_id, 'idempotent', true);
  end if;

  select * into v_ticket from public.tickets where id = v_item.ticket_id;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner', 'kitchen']);

  update public.ticket_items
    set cancelled_at = now(),
        cancellation_reason = v_clean_reason
    where id = p_ticket_item_id;

  return jsonb_build_object('item_id', p_ticket_item_id, 'cancelled', true);
end $$;

revoke all on function public.cancel_ticket_item(uuid, text) from public;
grant execute on function public.cancel_ticket_item(uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: add_staff_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
-- Comanda de palabra creada por el mozo. Va directo a accepted (no pasa por
-- pending ni mozo confirma de nuevo).
create or replace function public.add_staff_ticket(
  p_session_id uuid,
  p_items jsonb,
  p_assigned_to_guest_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_ticket_id uuid;
  v_total_cents bigint := 0;
  v_total_items int := 0;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_line_total bigint;
  v_assigned_to uuid;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;

  select * into v_session from public.table_sessions where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  perform public._check_staff_role(v_session.tenant_id, array['waiter', 'owner']);

  -- Verificar que el guest asignado pertenece a la sesión (si se pasó)
  if p_assigned_to_guest_id is not null then
    if not exists (
      select 1 from public.session_guests
      where id = p_assigned_to_guest_id and session_id = p_session_id
    ) then
      raise exception 'invalid_assigned_guest' using errcode = 'P0001';
    end if;
  end if;

  insert into public.tickets (
    tenant_id, session_id, status, created_by_user_id,
    submitted_at, accepted_at, accepted_by_user_id
  ) values (
    v_session.tenant_id, p_session_id, 'accepted', auth.uid(),
    now(), now(), auth.uid()
  ) returning id into v_ticket_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_session.tenant_id
        and active = true;
    if v_menu.id is null then
      raise exception 'menu_item_not_available' using errcode = 'P0001';
    end if;

    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 50 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    v_line_total := v_menu.price_cents * v_qty;
    v_assigned_to := nullif(v_item->>'assigned_to_guest_id', '')::uuid;
    if v_assigned_to is null then
      v_assigned_to := p_assigned_to_guest_id;  -- fallback al asignado global
    end if;

    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents,
      line_total_cents, assigned_to_guest_id, notes
    ) values (
      v_ticket_id, v_menu.id, v_qty, v_menu.price_cents,
      v_line_total, v_assigned_to,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    );

    v_total_cents := v_total_cents + v_line_total;
    v_total_items := v_total_items + v_qty;
  end loop;

  return jsonb_build_object(
    'ticket_id', v_ticket_id,
    'status', 'accepted',
    'total_cents', v_total_cents,
    'total_items', v_total_items
  );
end $$;

revoke all on function public.add_staff_ticket(uuid, jsonb, uuid) from public;
grant execute on function public.add_staff_ticket(uuid, jsonb, uuid) to authenticated;
```

- [ ] **Step 2**: Commit `feat(plan2): RPCs autenticadas accept/reject/update_status/cancel_item/add_staff_ticket`

---

### Task 5: RLS tests para tickets

**Files:**
- Create: `tests/rls/tickets.test.ts`

Tests para validar que tickets/ticket_items son SELECT-only para authenticated, INSERT directo bloqueado, y que las RPCs respetan roles.

- [ ] **Step 1: Escribir el test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — tickets / ticket_items', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let waiter: Awaited<ReturnType<typeof createUserClient>>
  let cashier: Awaited<ReturnType<typeof createUserClient>>
  let kitchen: Awaited<ReturnType<typeof createUserClient>>
  let outsider: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string
  let categoryId: string
  let menuItemId: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('tkOwn') })
    waiter = await createUserClient({ email: uniqueEmail('tkWai') })
    cashier = await createUserClient({ email: uniqueEmail('tkCas') })
    kitchen = await createUserClient({ email: uniqueEmail('tkKit') })
    outsider = await createUserClient({ email: uniqueEmail('tkOut') })

    tenant = await createTenant({
      name: 'Tickets Bar',
      slug: uniqueSlug('tk-bar'),
      ownerId: owner.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
      { tenant_id: tenant.id, user_id: cashier.userId, role: 'cashier' },
      { tenant_id: tenant.id, user_id: kitchen.userId, role: 'kitchen' },
    ])

    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'TK-1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('failed seed pt')
    qrToken = pt.qr_token

    const { data: cat } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenant.id, name: 'Tragos' })
      .select('id')
      .single()
    if (!cat) throw new Error('failed seed cat')
    categoryId = cat.id

    const { data: item } = await service
      .from('menu_items')
      .insert({
        tenant_id: tenant.id,
        category_id: categoryId,
        name: 'Fernet',
        price_cents: 350000,
      })
      .select('id')
      .single()
    if (!item) throw new Error('failed seed item')
    menuItemId = item.id
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(waiter.userId)
    await deleteUser(cashier.userId)
    await deleteUser(kitchen.userId)
    await deleteUser(outsider.userId)
  })

  it('comensal anon submit_ticket crea ticket pending', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: 'idem-001',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'pending', total_items: 2, idempotent_replay: false })
  })

  it('submit_ticket es idempotente con misma idempotency_key', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_items: [{ menu_item_id: menuItemId, quantity: 99, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: 'idem-001',
    })
    expect(data).toMatchObject({ idempotent_replay: true })
  })

  it('owner authenticated NO puede insertar ticket directamente', async () => {
    const { error } = await owner.client.from('tickets').insert({
      tenant_id: tenant.id,
      session_id: '00000000-0000-0000-0000-000000000000',
      status: 'pending',
    })
    expect(error).not.toBeNull()
  })

  it('waiter accept_ticket marca como accepted', async () => {
    const service = getServiceClient()
    const { data: tk } = await service
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending')
      .limit(1)
      .single()
    if (!tk) throw new Error('no pending ticket to accept')

    const { data, error } = await waiter.client.rpc('accept_ticket', { p_ticket_id: tk.id })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'accepted' })
  })

  it('cashier no puede accept_ticket (role no permitido)', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCash123',
      p_display_name: null,
    })
    const { data: submitData } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCash123',
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: `idem-${Date.now()}`,
    })
    const tkId = (submitData as { ticket_id: string }).ticket_id

    const { error } = await cashier.client.rpc('accept_ticket', { p_ticket_id: tkId })
    expect(error?.message).toMatch(/role_not_allowed|forbidden/)
  })

  it('kitchen puede update_ticket_status accepted -> preparing', async () => {
    const service = getServiceClient()
    const { data: tk } = await service
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'accepted')
      .limit(1)
      .single()
    if (!tk) throw new Error('no accepted ticket')

    const { error } = await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: tk.id,
      p_new_status: 'preparing',
    })
    expect(error).toBeNull()
  })

  it('kitchen NO puede marcar served (solo waiter/owner)', async () => {
    const service = getServiceClient()
    // Forzamos un ticket a ready para testear served
    const { data: tk } = await service
      .from('tickets')
      .update({ status: 'ready' })
      .eq('tenant_id', tenant.id)
      .eq('status', 'preparing')
      .select('id')
      .limit(1)
      .single()
    if (!tk) throw new Error('no preparing ticket')

    const { error } = await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: tk.id,
      p_new_status: 'served',
    })
    expect(error?.message).toMatch(/invalid_transition_or_role|role_not_allowed/)
  })

  it('outsider no puede ver tickets del tenant', async () => {
    const { data } = await outsider.client.from('tickets').select('id').eq('tenant_id', tenant.id)
    expect(data?.length ?? 0).toBe(0)
  })

  it('cancel_pending_ticket falla si ticket ya está accepted', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCancel1',
      p_display_name: null,
    })
    const { data: submitData } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCancel1',
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: `idem-cancel-${Date.now()}`,
    })
    const tkId = (submitData as { ticket_id: string }).ticket_id
    await waiter.client.rpc('accept_ticket', { p_ticket_id: tkId })

    const { error } = await anon.rpc('cancel_pending_ticket', {
      p_ticket_id: tkId,
      p_browser_token: 'tkBrowserCancel1',
    })
    expect(error?.message).toContain('ticket_not_cancellable')
  })

  it('add_staff_ticket por waiter crea ticket en accepted', async () => {
    const service = getServiceClient()
    const { data: sess } = await service
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    if (!sess) throw new Error('no session')

    const { data, error } = await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sess.id,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: 'cortesía', assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'accepted' })
  })

  it('cancel_ticket_item por kitchen marca cancelled_at', async () => {
    const service = getServiceClient()
    const { data: ti } = await service
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .limit(1)
      .single()
    if (!ti) throw new Error('no item')

    const { error } = await kitchen.client.rpc('cancel_ticket_item', {
      p_ticket_item_id: ti.id,
      p_reason: 'sin stock',
    })
    expect(error).toBeNull()
  })

  it('request_bill escribe evento bill_requested', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserBill456',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('request_bill', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserBill456',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ requested: true })
  })
})
```

- [ ] **Step 2**: Commit `test(plan2): RLS tickets + RPCs (submit, accept, status, cancel, add_staff, request_bill)`

---

### Task 6: lib/tickets — schemas + queries + actions (waiter)

**Files:**
- Create: `lib/tickets/schemas.ts`
- Create: `lib/tickets/queries.ts`
- Create: `lib/tickets/actions.ts`

Server actions del staff: aceptar, rechazar, avanzar estado, cancelar ítem, agregar staff ticket.

- [ ] **Step 1: Schemas**

```typescript
import { z } from 'zod'

const ticketIdSchema = z.string().uuid()
const reasonSchema = z.string().trim().min(1, 'Motivo requerido').max(200)

export const acceptTicketSchema = z.object({ ticket_id: ticketIdSchema })

export const rejectTicketSchema = z.object({
  ticket_id: ticketIdSchema,
  reason: reasonSchema,
})

export const updateTicketStatusSchema = z.object({
  ticket_id: ticketIdSchema,
  new_status: z.enum(['preparing', 'ready', 'served']),
})

export const cancelTicketItemSchema = z.object({
  ticket_item_id: z.string().uuid(),
  reason: reasonSchema,
})

export const addStaffTicketSchema = z.object({
  session_id: z.string().uuid(),
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(50),
    notes: z.string().trim().max(200).optional().nullable(),
    assigned_to_guest_id: z.string().uuid().nullable().optional(),
  })).min(1, 'El ticket no puede estar vacío'),
  assigned_to_guest_id: z.string().uuid().nullable().optional(),
})
```

- [ ] **Step 2: Queries**

```typescript
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type TicketRow = {
  id: string
  status: string
  submitted_at: string
  accepted_at: string | null
  prepared_at: string | null
  served_at: string | null
  total_cents: number
  cancellation_reason: string | null
  created_by_guest_id: string | null
  created_by_user_id: string | null
}

export type TicketItemRow = {
  id: string
  ticket_id: string
  menu_item_id: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  assigned_to_guest_id: string | null
  notes: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  menu_item_name?: string
}

export async function listTicketsForSession(sessionId: string): Promise<TicketRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tickets')
    .select(
      'id, status, submitted_at, accepted_at, prepared_at, served_at, total_cents, cancellation_reason, created_by_guest_id, created_by_user_id',
    )
    .eq('session_id', sessionId)
    .order('submitted_at', { ascending: true })
  if (error) {
    console.error('[tickets.listForSession]', error.message)
    return []
  }
  return (data ?? []) as TicketRow[]
}

export async function listTicketItemsForTickets(ticketIds: string[]): Promise<TicketItemRow[]> {
  if (ticketIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ticket_items')
    .select(
      'id, ticket_id, menu_item_id, quantity, unit_price_cents, line_total_cents, assigned_to_guest_id, notes, cancelled_at, cancellation_reason, menu_items(name)',
    )
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[tickets.listItemsForTickets]', error.message)
    return []
  }
  type Joined = TicketItemRow & { menu_items: { name: string } | { name: string }[] | null }
  return (data ?? []).map((row) => {
    const r = row as Joined
    const menuItem = Array.isArray(r.menu_items) ? r.menu_items[0] : r.menu_items
    return { ...r, menu_item_name: menuItem?.name }
  })
}

export async function listKitchenQueue(tenantId: string): Promise<TicketRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tickets')
    .select(
      'id, status, submitted_at, accepted_at, prepared_at, served_at, total_cents, cancellation_reason, created_by_guest_id, created_by_user_id, session_id',
    )
    .eq('tenant_id', tenantId)
    .in('status', ['accepted', 'preparing', 'ready'])
    .order('submitted_at', { ascending: true })
  if (error) {
    console.error('[tickets.listKitchenQueue]', error.message)
    return []
  }
  return (data ?? []) as TicketRow[]
}
```

- [ ] **Step 3: Actions**

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
  type TenantRole,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  acceptTicketSchema,
  addStaffTicketSchema,
  cancelTicketItemSchema,
  rejectTicketSchema,
  updateTicketStatusSchema,
} from './schemas'

export type TicketActionState =
  | { ok: true; message?: string; ticketId?: string; status?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string, allowed: ReadonlyArray<TenantRole>) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, allowed)
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

export async function acceptTicket(
  slug: string,
  ticketId: string,
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = acceptTicketSchema.safeParse({ ticket_id: ticketId })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('accept_ticket', { p_ticket_id: parsed.data.ticket_id })
  if (error) {
    console.error('[tickets.accept]', error.message)
    return { ok: false, message: 'No se pudo aceptar la comanda.' }
  }
  revalidatePath(`/${slug}/sesiones`)
  revalidatePath(`/${slug}/cocina`)
  return { ok: true, ticketId: parsed.data.ticket_id, status: (data as { status: string }).status }
}

export async function rejectTicket(
  slug: string,
  ticketId: string,
  reason: string,
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = rejectTicketSchema.safeParse({ ticket_id: ticketId, reason })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('reject_ticket', {
    p_ticket_id: parsed.data.ticket_id,
    p_reason: parsed.data.reason,
  })
  if (error) {
    console.error('[tickets.reject]', error.message)
    return { ok: false, message: 'No se pudo rechazar.' }
  }
  revalidatePath(`/${slug}/sesiones`)
  return { ok: true, ticketId: parsed.data.ticket_id }
}

export async function updateTicketStatus(
  slug: string,
  ticketId: string,
  newStatus: 'preparing' | 'ready' | 'served',
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner', 'kitchen'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateTicketStatusSchema.safeParse({
    ticket_id: ticketId,
    new_status: newStatus,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_ticket_status', {
    p_ticket_id: parsed.data.ticket_id,
    p_new_status: parsed.data.new_status,
  })
  if (error) {
    if (error.message.includes('invalid_transition_or_role')) {
      return { ok: false, message: 'No podés cambiar el estado a ese.' }
    }
    console.error('[tickets.updateStatus]', error.message)
    return { ok: false, message: 'No se pudo actualizar el estado.' }
  }
  revalidatePath(`/${slug}/sesiones`)
  revalidatePath(`/${slug}/cocina`)
  return { ok: true, ticketId: parsed.data.ticket_id, status: parsed.data.new_status }
}

export async function cancelTicketItem(
  slug: string,
  ticketItemId: string,
  reason: string,
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner', 'kitchen'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = cancelTicketItemSchema.safeParse({ ticket_item_id: ticketItemId, reason })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_ticket_item', {
    p_ticket_item_id: parsed.data.ticket_item_id,
    p_reason: parsed.data.reason,
  })
  if (error) {
    console.error('[tickets.cancelItem]', error.message)
    return { ok: false, message: 'No se pudo cancelar el ítem.' }
  }
  revalidatePath(`/${slug}/sesiones`)
  revalidatePath(`/${slug}/cocina`)
  return { ok: true }
}

export async function addStaffTicket(
  slug: string,
  input: {
    sessionId: string
    items: Array<{ menu_item_id: string; quantity: number; notes?: string | null; assigned_to_guest_id?: string | null }>
    assignedToGuestId?: string | null
  },
): Promise<TicketActionState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = addStaffTicketSchema.safeParse({
    session_id: input.sessionId,
    items: input.items,
    assigned_to_guest_id: input.assignedToGuestId,
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('add_staff_ticket', {
    p_session_id: parsed.data.session_id,
    p_items: parsed.data.items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      notes: i.notes ?? null,
      assigned_to_guest_id: i.assigned_to_guest_id ?? null,
    })),
    p_assigned_to_guest_id: parsed.data.assigned_to_guest_id ?? null,
  })
  if (error) {
    console.error('[tickets.addStaff]', error.message)
    return { ok: false, message: 'No se pudo agregar la comanda.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'add_staff',
    entity: 'ticket',
    entityId: (data as { ticket_id: string }).ticket_id,
    payload: { session_id: parsed.data.session_id, items_count: parsed.data.items.length },
  })

  revalidatePath(`/${slug}/sesiones`)
  return { ok: true, ticketId: (data as { ticket_id: string }).ticket_id }
}
```

- [ ] **Step 4**: typecheck + lint:fix + commit `feat(plan2): server actions de tickets para staff`

---

### Task 7: lib/sessions-waiter — listar sesiones open

**Files:**
- Create: `lib/sessions-waiter/queries.ts`

- [ ] **Step 1**:

```typescript
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type WaiterSessionRow = {
  id: string
  table_label: string | null
  opened_at: string
  total_cents: number
  guest_count: number
  pending_tickets: number
  bill_requested: boolean
}

export async function listOpenSessions(tenantId: string): Promise<WaiterSessionRow[]> {
  const supabase = await createClient()

  const { data: sessions, error } = await supabase
    .from('table_sessions')
    .select('id, opened_at, total_cents, physical_table_id, physical_tables(label)')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  if (error || !sessions) {
    console.error('[sessions-waiter.list]', error?.message)
    return []
  }

  const sessionIds = sessions.map((s) => s.id)
  if (sessionIds.length === 0) return []

  const [{ data: guests }, { data: pendings }, { data: events }] = await Promise.all([
    supabase
      .from('session_guests')
      .select('session_id')
      .in('session_id', sessionIds),
    supabase
      .from('tickets')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('status', 'pending'),
    supabase
      .from('table_session_events')
      .select('session_id, created_at')
      .in('session_id', sessionIds)
      .eq('type', 'bill_requested')
      .order('created_at', { ascending: false }),
  ])

  const guestCounts = new Map<string, number>()
  for (const g of guests ?? []) {
    guestCounts.set(g.session_id, (guestCounts.get(g.session_id) ?? 0) + 1)
  }
  const pendingCounts = new Map<string, number>()
  for (const p of pendings ?? []) {
    pendingCounts.set(p.session_id, (pendingCounts.get(p.session_id) ?? 0) + 1)
  }
  const billRequested = new Set<string>()
  for (const e of events ?? []) {
    billRequested.add(e.session_id)
  }

  type SessionWithTable = typeof sessions[number] & {
    physical_tables: { label: string } | { label: string }[] | null
  }
  return sessions.map((s) => {
    const sw = s as SessionWithTable
    const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables
    return {
      id: s.id,
      table_label: pt?.label ?? null,
      opened_at: s.opened_at,
      total_cents: s.total_cents ?? 0,
      guest_count: guestCounts.get(s.id) ?? 0,
      pending_tickets: pendingCounts.get(s.id) ?? 0,
      bill_requested: billRequested.has(s.id),
    }
  })
}

export type WaiterSessionDetail = {
  id: string
  status: string
  opened_at: string
  paid_at: string | null
  total_cents: number
  table_label: string | null
  guests: Array<{ id: string; display_name: string | null; customer_id: string | null; last_activity_at: string }>
  bill_requested: boolean
}

export async function getSessionForWaiter(sessionId: string): Promise<WaiterSessionDetail | null> {
  const supabase = await createClient()
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, status, opened_at, paid_at, total_cents, physical_tables(label)')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return null

  const { data: guests } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id, last_activity_at')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  const { data: billEvent } = await supabase
    .from('table_session_events')
    .select('id')
    .eq('session_id', sessionId)
    .eq('type', 'bill_requested')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  type SessionWithTable = typeof session & {
    physical_tables: { label: string } | { label: string }[] | null
  }
  const sw = session as SessionWithTable
  const pt = Array.isArray(sw.physical_tables) ? sw.physical_tables[0] : sw.physical_tables

  return {
    id: session.id,
    status: session.status,
    opened_at: session.opened_at,
    paid_at: session.paid_at,
    total_cents: session.total_cents ?? 0,
    table_label: pt?.label ?? null,
    guests: guests ?? [],
    bill_requested: Boolean(billEvent),
  }
}
```

- [ ] **Step 2**: typecheck + lint:fix + commit `feat(plan2): queries del dashboard mozo (sesiones open + detalle)`

---

### Task 8: lib/m-session — extender con submitTicket / cancelTicket / requestBill / refreshState

**Files:**
- Modify: `lib/m-session/actions.ts` (append)
- Modify: `lib/m-session/schemas.ts` (append)

- [ ] **Step 1: Extender schemas**

```typescript
// Append a lib/m-session/schemas.ts:
export const submitTicketSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
  items: z.array(z.object({
    menu_item_id: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(50),
    notes: z.string().trim().max(200).nullable().optional(),
    assigned_to_guest_id: z.string().uuid().nullable().optional(),
  })).min(1, 'Tu carrito está vacío'),
  idempotency_key: z.string().min(8).max(64),
})

export const cancelTicketSchema = z.object({
  ticket_id: z.string().uuid(),
  browser_token: browserTokenField,
})

export const requestBillSchema = z.object({
  qr_token: qrTokenField,
  browser_token: browserTokenField,
})
```

- [ ] **Step 2: Extender actions**

```typescript
// Append a lib/m-session/actions.ts:
import { cancelTicketSchema, requestBillSchema, submitTicketSchema } from './schemas'

export type SubmitTicketResult =
  | { ok: true; ticketId: string; status: string; idempotentReplay: boolean; totalCents?: number }
  | { ok: false; message: string }

export type CancelTicketResult = { ok: true } | { ok: false; message: string }

export type RequestBillResult = { ok: true; alreadyRequested: boolean } | { ok: false; message: string }

export type SessionStateResult =
  | { ok: true; data: SessionStateData }
  | { ok: false; message: string }

export type SessionStateData = {
  session_id: string
  tenant_id: string
  tenant_name: string
  table_label: string
  guest_id: string | null
  customer_id: string | null
  guest_count: number
  was_new_session: boolean
  menu: Array<{
    id: string
    name: string
    position: number
    items: Array<{
      id: string
      name: string
      description: string | null
      price_cents: number
      image_url: string | null
      position: number
    }>
  }>
  my_tickets: Array<{
    id: string
    status: string
    submitted_at: string
    total_cents: number
    cancellation_reason: string | null
    items: Array<{
      id: string
      menu_item_name: string | null
      quantity: number
      unit_price_cents: number
      line_total_cents: number
      notes: string | null
      cancelled_at: string | null
    }>
  }>
}

export async function refreshState(params: {
  qrToken: string
  browserToken: string
}): Promise<SessionStateResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_session_state', {
    p_qr_token: params.qrToken,
    p_browser_token: params.browserToken,
  })
  if (error) {
    if (error.message.includes('invalid_qr_token')) {
      return { ok: false, message: 'El QR no es válido.' }
    }
    console.error('[m-session.refreshState]', error.message)
    return { ok: false, message: 'No se pudo cargar la mesa.' }
  }
  return { ok: true, data: data as SessionStateData }
}

export async function submitTicket(params: {
  qrToken: string
  browserToken: string
  items: Array<{ menu_item_id: string; quantity: number; notes?: string | null; assigned_to_guest_id?: string | null }>
  idempotencyKey: string
}): Promise<SubmitTicketResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `m-submit:${ip}`, limit: 60, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Demasiados pedidos seguidos. Esperá un momento.' }
    }
    throw e
  }

  const parsed = submitTicketSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
    items: params.items,
    idempotency_key: params.idempotencyKey,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_ticket', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_items: parsed.data.items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      notes: i.notes ?? null,
      assigned_to_guest_id: i.assigned_to_guest_id ?? null,
    })),
    p_idempotency_key: parsed.data.idempotency_key,
  })

  if (error) {
    if (error.message.includes('no_active_session')) return { ok: false, message: 'La sesión no está activa.' }
    if (error.message.includes('guest_not_found')) return { ok: false, message: 'Volvé a escanear el QR.' }
    if (error.message.includes('menu_item_not_available')) return { ok: false, message: 'Algún ítem ya no está disponible.' }
    if (error.message.includes('empty_cart')) return { ok: false, message: 'Tu carrito está vacío.' }
    console.error('[m-session.submitTicket]', error.message)
    return { ok: false, message: 'No pudimos enviar tu pedido.' }
  }

  const result = data as { ticket_id: string; status: string; total_cents?: number; idempotent_replay: boolean }
  return {
    ok: true,
    ticketId: result.ticket_id,
    status: result.status,
    idempotentReplay: result.idempotent_replay,
    totalCents: result.total_cents,
  }
}

export async function cancelTicket(params: {
  ticketId: string
  browserToken: string
}): Promise<CancelTicketResult> {
  const parsed = cancelTicketSchema.safeParse({
    ticket_id: params.ticketId,
    browser_token: params.browserToken,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_pending_ticket', {
    p_ticket_id: parsed.data.ticket_id,
    p_browser_token: parsed.data.browser_token,
  })
  if (error) {
    if (error.message.includes('cancel_window_expired')) return { ok: false, message: 'Ya pasó el tiempo para cancelar.' }
    if (error.message.includes('ticket_not_cancellable')) return { ok: false, message: 'Esta comanda ya no se puede cancelar.' }
    console.error('[m-session.cancelTicket]', error.message)
    return { ok: false, message: 'No se pudo cancelar.' }
  }
  return { ok: true }
}

export async function requestBill(params: {
  qrToken: string
  browserToken: string
}): Promise<RequestBillResult> {
  const parsed = requestBillSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_bill', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
  })
  if (error) {
    if (error.message.includes('no_active_session')) return { ok: false, message: 'La sesión no está activa.' }
    console.error('[m-session.requestBill]', error.message)
    return { ok: false, message: 'No se pudo avisar al mozo.' }
  }
  const result = data as { already_requested?: boolean; requested?: boolean }
  return { ok: true, alreadyRequested: Boolean(result.already_requested) }
}
```

- [ ] **Step 3**: typecheck + lint:fix + commit `feat(plan2): m-session actions submit/cancel/requestBill/refreshState`

---

### Task 9: Realtime helper

**Files:**
- Create: `lib/realtime/subscribe.ts`

- [ ] **Step 1**:

```typescript
'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser'

type Filter = `${string}=eq.${string}`

export type SubscribeOptions = {
  channel: string
  events: Array<{
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    table: string
    filter?: Filter
    onChange: (payload: unknown) => void
  }>
}

/**
 * Suscribe a uno o varios eventos postgres_changes y devuelve un cleanup.
 * Pensado para usar dentro de useEffect.
 */
export function subscribeChanges(opts: SubscribeOptions): () => void {
  const supabase = createClient()
  let ch: RealtimeChannel = supabase.channel(opts.channel)
  for (const evt of opts.events) {
    ch = ch.on(
      // biome-ignore lint/suspicious/noExplicitAny: Supabase realtime types are loose
      'postgres_changes' as any,
      {
        event: evt.event,
        schema: 'public',
        table: evt.table,
        ...(evt.filter ? { filter: evt.filter } : {}),
      },
      evt.onChange,
    )
  }
  ch.subscribe()
  return () => {
    void supabase.removeChannel(ch)
  }
}
```

- [ ] **Step 2**: commit `feat(plan2): helper subscribeChanges para postgres_changes`

---

### Task 10: UI pública — extender mesa-screen con tabs Carta / Mis órdenes

**Files:**
- Replace: `app/m/[qrToken]/_components/mesa-screen.tsx`
- Create: `app/m/[qrToken]/_components/menu-list.tsx`
- Create: `app/m/[qrToken]/_components/cart-sheet.tsx`
- Create: `app/m/[qrToken]/_components/my-orders-pane.tsx`

Reemplaza completamente `mesa-screen.tsx` con la versión nueva. Las pestañas usan `Tabs` de shadcn. El carrito es un client store en el propio componente (no global).

- [ ] **Step 1: Reescribir `mesa-screen.tsx`**

```tsx
'use client'

import { Sparkles, UserCircle2, Receipt } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { joinSession, refreshState, requestBill, type SessionStateData } from '@/lib/m-session/actions'
import { getOrCreateBrowserToken } from '@/lib/m-session/browser-token'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { CartSheet } from './cart-sheet'
import { MenuList } from './menu-list'
import { MyOrdersPane } from './my-orders-pane'
import { RegisterDialog } from './register-dialog'

export type CartItem = {
  menuItemId: string
  name: string
  unitPriceCents: number
  quantity: number
  notes: string | null
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
  const [state, setState] = useState<SessionStateData | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [billPending, setBillPending] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  // 1. Resolver browser_token
  useEffect(() => {
    setBrowserToken(getOrCreateBrowserToken())
  }, [])

  // 2. Join + initial state
  useEffect(() => {
    if (!browserToken) return
    let cancelled = false
    void (async () => {
      const join = await joinSession({ qrToken, browserToken, displayName: null })
      if (cancelled) return
      if (!join.ok) {
        setError(join.message)
        toast.error(join.message)
        return
      }
      const fresh = await refreshState({ qrToken, browserToken })
      if (cancelled) return
      if (fresh.ok) {
        setState(fresh.data)
        sessionIdRef.current = fresh.data.session_id
      } else {
        setError(fresh.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [browserToken, qrToken])

  // 3. Realtime: cuando cambian mis tickets, refrescar
  useEffect(() => {
    if (!state || !browserToken) return
    const sessionId = state.session_id
    const refresh = async () => {
      const r = await refreshState({ qrToken, browserToken })
      if (r.ok) setState(r.data)
    }
    const cleanup = subscribeChanges({
      channel: `m-${sessionId}`,
      events: [
        { event: '*', table: 'tickets', filter: `session_id=eq.${sessionId}`, onChange: () => void refresh() },
        { event: '*', table: 'ticket_items', onChange: () => void refresh() },
      ],
    })
    return cleanup
  }, [state, browserToken, qrToken])

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const ix = prev.findIndex((c) => c.menuItemId === item.menuItemId && c.notes === item.notes)
      if (ix >= 0) {
        const next = [...prev]
        const cur = next[ix]
        if (cur) next[ix] = { ...cur, quantity: cur.quantity + item.quantity }
        return next
      }
      return [...prev, item]
    })
    toast.success(`Agregado: ${item.name}`)
  }, [])

  const updateCartItem = useCallback((index: number, patch: Partial<CartItem>) => {
    setCart((prev) => {
      const next = [...prev]
      const cur = next[index]
      if (!cur) return prev
      const updated = { ...cur, ...patch }
      if (updated.quantity <= 0) {
        next.splice(index, 1)
      } else {
        next[index] = updated
      }
      return next
    })
  }, [])

  const cartTotalCents = useMemo(
    () => cart.reduce((sum, c) => sum + c.unitPriceCents * c.quantity, 0),
    [cart],
  )

  const handleRequestBill = useCallback(async () => {
    if (!browserToken) return
    setBillPending(true)
    const r = await requestBill({ qrToken, browserToken })
    setBillPending(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.alreadyRequested) {
      toast.info('Ya le avisaste al mozo. Vamos en camino.')
    } else {
      toast.success('Listo, el mozo viene con la cuenta.')
    }
  }, [browserToken, qrToken])

  const refreshAfterSubmit = useCallback(async () => {
    if (!browserToken) return
    const r = await refreshState({ qrToken, browserToken })
    if (r.ok) setState(r.data)
  }, [browserToken, qrToken])

  if (error && !state) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <h1 className="font-display text-2xl font-semibold">No pudimos abrir tu mesa</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {tenantName}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{tableLabel}</h1>
      </header>

      {state && !state.customer_id && (
        <button
          type="button"
          className="card-hairline flex w-full items-center justify-between gap-2 rounded-2xl border bg-card/90 p-4 text-left text-sm shadow-sm hover:bg-card/95"
          onClick={() => setShowRegister(true)}
        >
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Sumá puntos en cada pedido
          </span>
          <span className="text-xs text-muted-foreground">Registrarme →</span>
        </button>
      )}

      {state?.customer_id && (
        <div className="card-hairline flex items-center gap-2 rounded-2xl border bg-card/90 p-3 text-sm shadow-sm">
          <UserCircle2 className="size-4 text-primary" />
          <span>Sumando puntos en {tenantName}</span>
        </div>
      )}

      <Tabs defaultValue="menu" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="menu">Carta</TabsTrigger>
          <TabsTrigger value="orders">
            Mis órdenes
            {state && state.my_tickets.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {state.my_tickets.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-4">
          {state ? (
            <MenuList categories={state.menu} onAdd={addToCart} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Cargando carta…</p>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          {state && browserToken ? (
            <MyOrdersPane
              tickets={state.my_tickets}
              browserToken={browserToken}
              onCancelled={refreshAfterSubmit}
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Cargando…</p>
          )}
        </TabsContent>
      </Tabs>

      {state && (
        <div className="sticky bottom-3 z-10 flex gap-2">
          <Button
            variant="outline"
            onClick={handleRequestBill}
            disabled={billPending}
            className="flex-1"
          >
            <Receipt className="mr-1.5 size-4" />
            Pedir la cuenta
          </Button>
          <Button
            onClick={() => setShowCart(true)}
            disabled={cart.length === 0}
            className="flex-1"
          >
            Carrito ({cart.length}) ${(cartTotalCents / 100).toFixed(2)}
          </Button>
        </div>
      )}

      {state && showRegister && browserToken && (
        <RegisterDialog
          qrToken={qrToken}
          browserToken={browserToken}
          tenantName={tenantName}
          onClose={() => setShowRegister(false)}
          onRegistered={() => {
            setShowRegister(false)
            void refreshAfterSubmit()
            toast.success('¡Listo! Estás sumando puntos.')
          }}
        />
      )}

      {state && showCart && browserToken && (
        <CartSheet
          qrToken={qrToken}
          browserToken={browserToken}
          cart={cart}
          onUpdate={updateCartItem}
          onClose={() => setShowCart(false)}
          onSubmitted={() => {
            setCart([])
            setShowCart(false)
            void refreshAfterSubmit()
            toast.success('Pedido enviado. Esperando confirmación del mozo.')
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: `menu-list.tsx`**

```tsx
'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { SessionStateData } from '@/lib/m-session/actions'
import type { CartItem } from './mesa-screen'

type Category = SessionStateData['menu'][number]
type Item = Category['items'][number]

export function MenuList({
  categories,
  onAdd,
}: {
  categories: Category[]
  onAdd: (item: CartItem) => void
}) {
  const [opening, setOpening] = useState<Item | null>(null)
  const [qty, setQty] = useState(1)
  const [notes, setNotes] = useState('')

  const reset = () => {
    setQty(1)
    setNotes('')
    setOpening(null)
  }

  const handleAdd = () => {
    if (!opening) return
    onAdd({
      menuItemId: opening.id,
      name: opening.name,
      unitPriceCents: opening.price_cents,
      quantity: qty,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    })
    reset()
  }

  return (
    <div className="space-y-6">
      {categories.map((cat) => (
        <section key={cat.id}>
          <h2 className="font-display text-base font-semibold tracking-tight">{cat.name}</h2>
          <div className="mt-2 space-y-2">
            {cat.items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left shadow-sm hover:bg-card/95"
                onClick={() => setOpening(it)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{it.name}</p>
                  {it.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{it.description}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-semibold">
                    ${(it.price_cents / 100).toFixed(2)}
                  </span>
                  <Plus className="size-4 text-primary" />
                </div>
              </button>
            ))}
            {cat.items.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin ítems en esta categoría.</p>
            )}
          </div>
        </section>
      ))}

      <Sheet open={Boolean(opening)} onOpenChange={(o) => !o && reset()}>
        <SheetContent side="bottom">
          {opening && (
            <>
              <SheetHeader>
                <SheetTitle>{opening.name}</SheetTitle>
                {opening.description && (
                  <p className="text-sm text-muted-foreground">{opening.description}</p>
                )}
              </SheetHeader>
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setQty(Math.max(1, qty - 1))}
                  >
                    −
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="w-20 text-center"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => setQty(qty + 1)}>
                    +
                  </Button>
                  <span className="ml-auto text-sm font-semibold">
                    ${((opening.price_cents * qty) / 100).toFixed(2)}
                  </span>
                </div>
                <Textarea
                  placeholder="Notas (sin cebolla, bien frío…)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                />
                <Button onClick={handleAdd} className="w-full">
                  Agregar al carrito
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
```

- [ ] **Step 3: `cart-sheet.tsx`**

```tsx
'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { submitTicket } from '@/lib/m-session/actions'
import type { CartItem } from './mesa-screen'

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function CartSheet({
  qrToken,
  browserToken,
  cart,
  onUpdate,
  onClose,
  onSubmitted,
}: {
  qrToken: string
  browserToken: string
  cart: CartItem[]
  onUpdate: (index: number, patch: Partial<CartItem>) => void
  onClose: () => void
  onSubmitted: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = cart.reduce((sum, c) => sum + c.unitPriceCents * c.quantity, 0)

  const handleSubmit = async () => {
    if (cart.length === 0) return
    setPending(true)
    setError(null)
    const result = await submitTicket({
      qrToken,
      browserToken,
      items: cart.map((c) => ({
        menu_item_id: c.menuItemId,
        quantity: c.quantity,
        notes: c.notes,
        assigned_to_guest_id: null,
      })),
      idempotencyKey: generateIdempotencyKey(),
    })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSubmitted()
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Tu carrito</SheetTitle>
        </SheetHeader>
        <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto">
          {cart.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">El carrito está vacío.</p>
          )}
          {cart.map((c, i) => (
            <div key={`${c.menuItemId}-${i}`} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="flex-1">
                <p className="font-medium">{c.name}</p>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  ${(c.unitPriceCents / 100).toFixed(2)} c/u
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={c.quantity}
                  onChange={(e) =>
                    onUpdate(i, {
                      quantity: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-16 text-center"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onUpdate(i, { quantity: 0 })}
                  className="h-6 px-2"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <SheetFooter className="mt-4">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="font-display text-lg font-semibold">
              ${(total / 100).toFixed(2)}
            </span>
            <Button onClick={handleSubmit} disabled={pending || cart.length === 0}>
              {pending ? 'Enviando…' : 'Realizar orden'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 4: `my-orders-pane.tsx`**

```tsx
'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { cancelTicket, type SessionStateData } from '@/lib/m-session/actions'

type Ticket = SessionStateData['my_tickets'][number]

const STATUS_LABEL: Record<string, string> = {
  pending: 'Esperando confirmación',
  accepted: 'Mozo confirmó · en cocina',
  preparing: 'Preparando',
  ready: 'Listo · esperando que te lo lleven',
  served: 'Entregado',
  cancelled: 'Cancelada',
}

function withinCancelWindow(submittedAt: string): boolean {
  return Date.now() - new Date(submittedAt).getTime() < 60_000
}

export function MyOrdersPane({
  tickets,
  browserToken,
  onCancelled,
}: {
  tickets: Ticket[]
  browserToken: string
  onCancelled: () => void
}) {
  const [pending, startTransition] = useTransition()

  if (tickets.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Todavía no pediste nada. Andá a Carta y armá tu pedido.
      </p>
    )
  }

  const handleCancel = (ticketId: string) => {
    startTransition(async () => {
      const r = await cancelTicket({ ticketId, browserToken })
      if (r.ok) onCancelled()
    })
  }

  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Comanda #{t.id.slice(0, 6)}
              </p>
              <p className="text-sm font-medium">
                {STATUS_LABEL[t.status] ?? t.status}
              </p>
            </div>
            <p className="text-sm font-semibold">${(t.total_cents / 100).toFixed(2)}</p>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {t.items.map((it) => (
              <li
                key={it.id}
                className={
                  it.cancelled_at
                    ? 'text-xs text-muted-foreground line-through'
                    : 'text-sm'
                }
              >
                {it.quantity}× {it.menu_item_name ?? 'Ítem'}
                {it.notes && <span className="text-xs text-muted-foreground"> — {it.notes}</span>}
              </li>
            ))}
          </ul>
          {t.status === 'pending' && withinCancelWindow(t.submitted_at) && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => handleCancel(t.id)}
            >
              Cancelar
            </Button>
          )}
          {t.cancellation_reason && (
            <p className="mt-2 text-xs text-destructive">{t.cancellation_reason}</p>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5**: typecheck + lint:fix + commit `feat(plan2): página /m/[qrToken] con carta + carrito + mis órdenes + realtime`

---

### Task 11: Página dashboard mozo `/[tenantSlug]/sesiones`

**Files:**
- Create: `app/(dashboard)/[tenantSlug]/sesiones/page.tsx`
- Create: `app/(dashboard)/[tenantSlug]/sesiones/_components/sessions-grid.tsx`

- [ ] **Step 1: page.tsx (server)**

```tsx
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listOpenSessions } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { SessionsGrid } from './_components/sessions-grid'

export const metadata = { title: 'Sesiones' }
export const dynamic = 'force-dynamic'

export default async function SesionesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const sessions = await listOpenSessions(tenantId)

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title="Sesiones"
        description="Mesas abiertas y comandas activas."
      />
      <Section>
        <SessionsGrid tenantSlug={tenantSlug} initialSessions={sessions} tenantId={tenantId} />
      </Section>
    </main>
  )
}
```

- [ ] **Step 2: `sessions-grid.tsx` (client, realtime)**

```tsx
'use client'

import { Bell, Receipt, Users } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import type { WaiterSessionRow } from '@/lib/sessions-waiter/queries'

export function SessionsGrid({
  tenantSlug,
  tenantId,
  initialSessions,
}: {
  tenantSlug: string
  tenantId: string
  initialSessions: WaiterSessionRow[]
}) {
  const [sessions, setSessions] = useState(initialSessions)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sessions/list?tenant_id=${encodeURIComponent(tenantId)}`, {
      cache: 'no-store',
    })
    if (res.ok) {
      const data = (await res.json()) as { sessions: WaiterSessionRow[] }
      setSessions(data.sessions)
    }
  }, [tenantId])

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `waiter-${tenantId}`,
      events: [
        { event: '*', table: 'tickets', filter: `tenant_id=eq.${tenantId}`, onChange: () => void refresh() },
        { event: '*', table: 'table_sessions', filter: `tenant_id=eq.${tenantId}`, onChange: () => void refresh() },
        { event: 'INSERT', table: 'table_session_events', onChange: () => void refresh() },
      ],
    })
    return cleanup
  }, [tenantId, refresh])

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="No hay mesas abiertas"
        description="Cuando un comensal escanee un QR, la mesa va a aparecer acá."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={`/${tenantSlug}/sesiones/${s.id}`}
          className="block rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-card/95"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-medium">{s.table_label ?? 'Mesa'}</h3>
              <p className="text-xs text-muted-foreground">
                Abierta {new Date(s.opened_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <p className="font-semibold">${(s.total_cents / 100).toFixed(2)}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1">
              <Users className="size-3" />
              {s.guest_count}
            </Badge>
            {s.pending_tickets > 0 && (
              <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
                <Bell className="size-3" />
                {s.pending_tickets} pending
              </Badge>
            )}
            {s.bill_requested && (
              <Badge variant="destructive" className="gap-1">
                <Receipt className="size-3" />
                Pidieron cuenta
              </Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: API route para refresh**

Crear `app/api/sessions/list/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listOpenSessions } from '@/lib/sessions-waiter/queries'

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  if (!tenantId) return new NextResponse('tenant_id required', { status: 400 })

  // RLS protege la query: solo retorna sesiones del tenant donde el user es miembro.
  const sessions = await listOpenSessions(tenantId)
  return NextResponse.json({ sessions })
}
```

- [ ] **Step 4**: typecheck + lint:fix + commit `feat(plan2): dashboard mozo /sesiones con realtime`

---

### Task 12: Página detalle de sesión `/[tenantSlug]/sesiones/[sessionId]`

**Files:**
- Create: `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/page.tsx`
- Create: `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/session-detail.tsx`
- Create: `app/(dashboard)/[tenantSlug]/sesiones/[sessionId]/_components/ticket-card.tsx`

- [ ] **Step 1: page.tsx (server)**

```tsx
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listTicketItemsForTickets, listTicketsForSession } from '@/lib/tickets/queries'
import { getSessionForWaiter } from '@/lib/sessions-waiter/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { SessionDetail } from './_components/session-detail'

export const metadata = { title: 'Sesión' }
export const dynamic = 'force-dynamic'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sessionId: string }>
}) {
  const { tenantSlug, sessionId } = await params

  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    role = access.role
  } catch {
    notFound()
  }

  if (!['waiter', 'owner', 'cashier'].includes(role)) notFound()

  const session = await getSessionForWaiter(sessionId)
  if (!session) notFound()

  const tickets = await listTicketsForSession(sessionId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return (
    <main className="space-y-6 py-6">
      <PageHeader
        title={`${session.table_label ?? 'Mesa'} — sesión`}
        description={`Total acumulado: $${(session.total_cents / 100).toFixed(2)}`}
      />
      <SessionDetail
        tenantSlug={tenantSlug}
        session={session}
        initialTickets={tickets}
        initialItems={items}
      />
    </main>
  )
}
```

- [ ] **Step 2: `session-detail.tsx` (client)**

```tsx
'use client'

import { Receipt } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import type { WaiterSessionDetail } from '@/lib/sessions-waiter/queries'
import type { TicketItemRow, TicketRow } from '@/lib/tickets/queries'
import { TicketCard } from './ticket-card'

export function SessionDetail({
  tenantSlug,
  session,
  initialTickets,
  initialItems,
}: {
  tenantSlug: string
  session: WaiterSessionDetail
  initialTickets: TicketRow[]
  initialItems: TicketItemRow[]
}) {
  const [tickets, setTickets] = useState(initialTickets)
  const [items, setItems] = useState(initialItems)
  const [billRequested, setBillRequested] = useState(session.bill_requested)

  const refresh = useCallback(async () => {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(session.id)}/snapshot`,
      { cache: 'no-store' },
    )
    if (res.ok) {
      const data = (await res.json()) as {
        tickets: TicketRow[]
        items: TicketItemRow[]
        bill_requested: boolean
      }
      setTickets(data.tickets)
      setItems(data.items)
      setBillRequested(data.bill_requested)
    }
  }, [session.id])

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `session-${session.id}`,
      events: [
        { event: '*', table: 'tickets', filter: `session_id=eq.${session.id}`, onChange: () => void refresh() },
        { event: '*', table: 'ticket_items', onChange: () => void refresh() },
        { event: 'INSERT', table: 'table_session_events', filter: `session_id=eq.${session.id}`, onChange: () => void refresh() },
      ],
    })
    return cleanup
  }, [session.id, refresh])

  const itemsByTicket = new Map<string, TicketItemRow[]>()
  for (const it of items) {
    const arr = itemsByTicket.get(it.ticket_id) ?? []
    arr.push(it)
    itemsByTicket.set(it.ticket_id, arr)
  }

  return (
    <div className="space-y-4">
      {billRequested && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <Receipt className="size-4 text-destructive" />
          <span>El comensal pidió la cuenta.</span>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comensales ({session.guests.length})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {session.guests.map((g) => (
            <Badge key={g.id} variant={g.customer_id ? 'default' : 'outline'}>
              {g.display_name ?? `Guest #${g.id.slice(0, 4)}`}
              {g.customer_id ? ' ✓' : ''}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comandas ({tickets.length})
        </h2>
        <div className="space-y-2">
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin comandas todavía.</p>
          ) : (
            tickets.map((t) => (
              <TicketCard
                key={t.id}
                tenantSlug={tenantSlug}
                ticket={t}
                items={itemsByTicket.get(t.id) ?? []}
                onChange={refresh}
              />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: `ticket-card.tsx`**

```tsx
'use client'

import { Check, ChefHat, Truck, X } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { acceptTicket, rejectTicket, updateTicketStatus } from '@/lib/tickets/actions'
import type { TicketItemRow, TicketRow } from '@/lib/tickets/queries'

const STATUS_VARIANTS: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  pending: 'outline',
  accepted: 'default',
  preparing: 'default',
  ready: 'default',
  served: 'secondary',
  cancelled: 'destructive',
}

export function TicketCard({
  tenantSlug,
  ticket,
  items,
  onChange,
}: {
  tenantSlug: string
  ticket: TicketRow
  items: TicketItemRow[]
  onChange: () => void
}) {
  const [pending, startTransition] = useTransition()

  const handle = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(success)
        onChange()
      } else {
        toast.error(r.message ?? 'Error')
      }
    })
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            #{ticket.id.slice(0, 6)} · {new Date(ticket.submitted_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <Badge variant={STATUS_VARIANTS[ticket.status] ?? 'outline'} className="mt-1">
            {ticket.status}
          </Badge>
        </div>
        <p className="font-semibold">${(ticket.total_cents / 100).toFixed(2)}</p>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((it) => (
          <li
            key={it.id}
            className={it.cancelled_at ? 'text-xs text-muted-foreground line-through' : ''}
          >
            {it.quantity}× {it.menu_item_name ?? 'Ítem'}
            {it.notes && <span className="text-xs text-muted-foreground"> — {it.notes}</span>}
          </li>
        ))}
      </ul>
      {ticket.cancellation_reason && (
        <p className="mt-1 text-xs text-destructive">Motivo: {ticket.cancellation_reason}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ticket.status === 'pending' && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => handle(() => acceptTicket(tenantSlug, ticket.id), 'Aceptada')}
            >
              <Check className="mr-1 size-3.5" />
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt('Motivo del rechazo:') ?? ''
                if (reason.trim()) {
                  handle(() => rejectTicket(tenantSlug, ticket.id, reason.trim()), 'Rechazada')
                }
              }}
            >
              <X className="mr-1 size-3.5" />
              Rechazar
            </Button>
          </>
        )}
        {ticket.status === 'accepted' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => handle(() => updateTicketStatus(tenantSlug, ticket.id, 'preparing'), 'En preparación')}
          >
            <ChefHat className="mr-1 size-3.5" />
            Empezar
          </Button>
        )}
        {ticket.status === 'preparing' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => handle(() => updateTicketStatus(tenantSlug, ticket.id, 'ready'), 'Listo')}
          >
            Listo para servir
          </Button>
        )}
        {ticket.status === 'ready' && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => handle(() => updateTicketStatus(tenantSlug, ticket.id, 'served'), 'Entregado')}
          >
            <Truck className="mr-1 size-3.5" />
            Marcar entregado
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: API route para refresh del detalle**

Crear `app/api/sessions/[sessionId]/snapshot/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSessionForWaiter } from '@/lib/sessions-waiter/queries'
import { listTicketItemsForTickets, listTicketsForSession } from '@/lib/tickets/queries'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const session = await getSessionForWaiter(sessionId)
  if (!session) return new NextResponse('not_found', { status: 404 })

  const tickets = await listTicketsForSession(sessionId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return NextResponse.json({
    tickets,
    items,
    bill_requested: session.bill_requested,
  })
}
```

- [ ] **Step 5**: typecheck + lint:fix + commit `feat(plan2): vista detalle de sesión con tickets y acciones del mozo`

---

### Task 13: Página KDS `/[tenantSlug]/cocina`

**Files:**
- Create: `app/(dashboard)/[tenantSlug]/cocina/page.tsx`
- Create: `app/(dashboard)/[tenantSlug]/cocina/_components/kds-screen.tsx`

- [ ] **Step 1: page.tsx (server)**

```tsx
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { listKitchenQueue, listTicketItemsForTickets } from '@/lib/tickets/queries'
import { requireTenantAccess } from '@/lib/tenant'
import { KdsScreen } from './_components/kds-screen'

export const metadata = { title: 'Cocina' }
export const dynamic = 'force-dynamic'

export default async function CocinaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  let tenantId: string
  let role: string
  try {
    const access = await requireTenantAccess(tenantSlug)
    tenantId = access.tenant.id
    role = access.role
  } catch {
    notFound()
  }

  if (!['kitchen', 'owner'].includes(role)) notFound()

  const tickets = await listKitchenQueue(tenantId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))

  return (
    <main className="space-y-6 py-6">
      <PageHeader title="Cocina" description="Comandas activas en orden de antigüedad." />
      <KdsScreen
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        initialTickets={tickets}
        initialItems={items}
      />
    </main>
  )
}
```

- [ ] **Step 2: `kds-screen.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { cancelTicketItem, updateTicketStatus } from '@/lib/tickets/actions'
import type { TicketItemRow, TicketRow } from '@/lib/tickets/queries'

function elapsed(from: string): string {
  const ms = Date.now() - new Date(from).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return `hace ${h}h ${min % 60}min`
}

export function KdsScreen({
  tenantSlug,
  tenantId,
  initialTickets,
  initialItems,
}: {
  tenantSlug: string
  tenantId: string
  initialTickets: TicketRow[]
  initialItems: TicketItemRow[]
}) {
  const [tickets, setTickets] = useState(initialTickets)
  const [items, setItems] = useState(initialItems)
  const [pending, startTransition] = useTransition()

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/kitchen/queue?tenant_id=${encodeURIComponent(tenantId)}`, {
      cache: 'no-store',
    })
    if (res.ok) {
      const data = (await res.json()) as { tickets: TicketRow[]; items: TicketItemRow[] }
      setTickets(data.tickets)
      setItems(data.items)
    }
  }, [tenantId])

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `kitchen-${tenantId}`,
      events: [
        { event: '*', table: 'tickets', filter: `tenant_id=eq.${tenantId}`, onChange: () => void refresh() },
        { event: '*', table: 'ticket_items', onChange: () => void refresh() },
      ],
    })
    return cleanup
  }, [tenantId, refresh])

  const handle = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
    startTransition(async () => {
      const r = await fn()
      if (r.ok) {
        toast.success(success)
        void refresh()
      } else {
        toast.error(r.message ?? 'Error')
      }
    })
  }

  const itemsByTicket = new Map<string, TicketItemRow[]>()
  for (const it of items) {
    const arr = itemsByTicket.get(it.ticket_id) ?? []
    arr.push(it)
    itemsByTicket.set(it.ticket_id, arr)
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        title="Sin comandas activas"
        description="Cuando el mozo confirme un pedido, va a aparecer acá."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tickets.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                #{t.id.slice(0, 6)} · {elapsed(t.submitted_at)}
              </p>
              <Badge variant={t.status === 'preparing' ? 'default' : 'outline'} className="mt-1">
                {t.status}
              </Badge>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(itemsByTicket.get(t.id) ?? []).map((it) => (
              <li
                key={it.id}
                className={
                  it.cancelled_at
                    ? 'text-xs text-muted-foreground line-through'
                    : 'flex items-start justify-between gap-2'
                }
              >
                <span>
                  {it.quantity}× {it.menu_item_name ?? 'Ítem'}
                  {it.notes && (
                    <span className="text-xs text-muted-foreground"> — {it.notes}</span>
                  )}
                </span>
                {!it.cancelled_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5 text-[11px]"
                    disabled={pending}
                    onClick={() => {
                      const reason = window.prompt('Motivo (típico: sin stock):') ?? ''
                      if (reason.trim()) {
                        handle(() => cancelTicketItem(tenantSlug, it.id, reason.trim()), 'Ítem cancelado')
                      }
                    }}
                  >
                    Sin stock
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-1.5">
            {t.status === 'accepted' && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => handle(() => updateTicketStatus(tenantSlug, t.id, 'preparing'), 'Empezando')}
              >
                Empezar
              </Button>
            )}
            {t.status === 'preparing' && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => handle(() => updateTicketStatus(tenantSlug, t.id, 'ready'), 'Listo')}
              >
                Listo
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: API route**

Crear `app/api/kitchen/queue/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listKitchenQueue, listTicketItemsForTickets } from '@/lib/tickets/queries'

export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('unauthorized', { status: 401 })

  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant_id')
  if (!tenantId) return new NextResponse('tenant_id required', { status: 400 })

  const tickets = await listKitchenQueue(tenantId)
  const items = await listTicketItemsForTickets(tickets.map((t) => t.id))
  return NextResponse.json({ tickets, items })
}
```

- [ ] **Step 4**: typecheck + lint:fix + commit `feat(plan2): KDS lite /cocina con realtime y acciones de avance`

---

### Task 14: Smoke doc + final cleanup

**Files:**
- Create: `docs/superpowers/plans/2026-05-06-plan-2-smoke.md`

- [ ] **Step 1**: Crear `docs/superpowers/plans/2026-05-06-plan-2-smoke.md` con guion completo:

```markdown
# Plan 2 — Smoke manual

> Pendiente de ejecución con Docker disponible.

## Pre-requisitos

Mismos que Plan 1 + `npm run db:reset` aplicado a las migraciones de Plan 2.

## Verificaciones

### 1. Migrations + tests RLS

```bash
npm run db:reset
npm run db:types
npm run test:ci -- tests/rls/tickets.test.ts
```

Esperado: tests pass.

### 2. Smoke comensal — pedido completo

1. Owner crea mesa "M5" (Plan 1).
2. Comensal escanea `/m/<token>` desde incógnito.
3. Pestaña "Carta": se ven categorías + ítems con precio.
4. Tap a un ítem: sheet con qty + notas → "Agregar al carrito".
5. Botón "Carrito (N)" abajo abre el sheet con la lista.
6. "Realizar orden" → toast "Pedido enviado. Esperando confirmación".
7. Pestaña "Mis órdenes" muestra el ticket en `pending`.

### 3. Smoke mozo — confirmar y avanzar

1. Logueate como waiter en otra pestaña.
2. Andá a `/<slug>/sesiones`. Verás la mesa M5 con badge "1 pending".
3. Click → vista detalle. Comanda en `pending`. Click "Confirmar".
4. Realtime: la pestaña del comensal cambia a `accepted` automáticamente.
5. En `/<slug>/cocina` (logueate como kitchen) la comanda aparece. Click "Empezar" → `preparing`. Click "Listo" → `ready`.
6. Vuelve al mozo. La comanda está `ready`. Click "Marcar entregado" → `served`.
7. Comensal ve su ticket como "Entregado".

### 4. Smoke cancel

1. Comensal arma otro pedido y submitea.
2. Antes de 60s, en "Mis órdenes" toca "Cancelar".
3. Verificá que pasa a `cancelled` con motivo `guest_cancelled`.
4. Otro pedido. Mozo confirma. Comensal intenta cancelar → ya no aparece botón, o si lo apretó antes, error "Esta comanda ya no se puede cancelar".

### 5. Smoke sin stock

1. Mozo o cocina, en una comanda en `accepted` o `preparing`, click "Sin stock" en un ítem específico.
2. Comensal en "Mis órdenes": el ítem aparece tachado.
3. El total del ticket se ajusta automáticamente (trigger recalc_ticket_total).

### 6. Smoke pedir cuenta

1. Comensal toca "Pedir la cuenta" abajo.
2. Toast "Listo, el mozo viene con la cuenta."
3. En `/<slug>/sesiones` la mesa muestra badge rojo "Pidieron cuenta".
4. Re-pulsar "Pedir cuenta" en menos de 60s → toast "Ya le avisaste al mozo".

### 7. Smoke add_staff_ticket

1. Mozo en detalle de sesión, supuesto botón "Agregar comanda" (NO incluida en Task 12, queda como nice-to-have para refinement). Por ahora se testea via SQL o Studio:

```bash
psql "$DB_URL" <<EOF
select * from public.add_staff_ticket(
  '<session_id>',
  '[{"menu_item_id":"<item>","quantity":1,"notes":null,"assigned_to_guest_id":null}]'::jsonb,
  null
);
EOF
```

Esperado: ticket en `accepted` directo.

### 8. Smoke RLS roles

1. Cashier intenta accept_ticket → error.
2. Kitchen intenta marcar served → error.
3. Outsider no ve tickets de otro tenant.

## Issues conocidos / lo que queda fuera

- `add_staff_ticket` desde UI: el dialog mozo no se incluyó en Plan 2 (lo dejamos para Plan 3 o un refinement de mozo móvil). El RPC funciona vía SQL.
- Mark session paid + puntos: Plan 3.
- Auto-aceptación: Plan 5 (la columna en tenants no existe, el código la asume false).
```

- [ ] **Step 2**: commit `docs(plan2): smoke manual end-to-end documentado`

---

## Resumen Plan 2

**Migrations**: 4 (enums+rol, tablas, rpcs anon, rpcs auth).
**Lib TS**: `lib/tickets/`, `lib/sessions-waiter/`, `lib/realtime/`, extensión de `lib/m-session/`.
**Páginas nuevas**: `/m/[qrToken]` extendida; `/[slug]/sesiones`, `/[slug]/sesiones/[id]`, `/[slug]/cocina`.
**API routes**: `/api/sessions/list`, `/api/sessions/[id]/snapshot`, `/api/kitchen/queue` (para refresh post-realtime).
**Tests**: `tests/rls/tickets.test.ts`.
**Outcome**: ciclo end-to-end del comensal funciona — pide, mozo confirma, cocina avanza, comensal trackea, mozo entrega. Sin pago ni puntos todavía.
