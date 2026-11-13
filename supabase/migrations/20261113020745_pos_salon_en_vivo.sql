-- Punto de venta, parte 1: el salón en vivo (docs/features/pos.md).
--
-- La mesa se abre, pide, come y paga. Esta parte cubre de abrir a servir:
--   · abrir una mesa con sus comensales, y si había una reserva, con su nombre, su seña y su socio;
--   · tandas: cada pedido sale «ahora» o queda «después», para que la entrada y el principal no lleguen juntos;
--   · cada producto sabe su estación (cocina, fríos, barra) y avanza solo: en cola → en preparación → listo → servido;
--   · aclaraciones para tocar («sin lechuga», «jugoso») en vez de texto libre;
--   · agotado por sucursal y por día, que se levanta solo al día siguiente;
--   · precio propio por sucursal donde haga falta, e historial de precios con quién los cambió.
--
-- Qué toca de lo que ya existe (todo aditivo):
--   · `table_sessions`, `tickets` y `ticket_items` ganan columnas con valor por defecto;
--   · `menu_categories` y `menu_items` ganan `station_id` (opcional);
--   · el recálculo del total de la comanda deja de correr cuando solo cambia el estado de cocina de un renglón;
--   · `menu_items` gana un disparador que anota cada cambio de precio.
-- Las funciones viejas (`add_staff_ticket`, `update_ticket_status`, `mark_session_paid`…) siguen andando igual.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ayudas internas
-- ─────────────────────────────────────────────────────────────────────────────

-- El día de servicio: hasta las 5 de la mañana sigue siendo «ayer» (mismo corte que el tablero operativo).
create function private.pos_service_day(p_tenant_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((now() at time zone coalesce(t.timezone, 'America/Argentina/Cordoba')) - interval '5 hours')::date
    from public.tenants t
   where t.id = p_tenant_id;
$$;

-- Quién puede. Devuelve el rol para quien necesite afinar.
create function private.pos_require_role(p_tenant_id uuid, variadic p_roles text[])
returns public.tenant_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.tenant_role;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null or not (v_role::text = any (p_roles)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Aviso en vivo a las pantallas de una sucursal: no lleva datos, solo «algo cambió, volvé a mirar».
-- Nunca tira abajo la operación que lo llama.
create function private.pos_poke(p_branch_id uuid, p_what text, p_session_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('what', p_what, 'session_id', p_session_id),
    'poke',
    'pos:' || p_branch_id::text,
    false
  );
exception when others then
  null;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estaciones de cocina (del bar: la carta es una sola)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.kitchen_stations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30), -- «Cocina», «Fríos», «Barra»
  color text not null default '#b45309' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_stations_id_tenant_uq unique (id, tenant_id)
);
create unique index kitchen_stations_name_uq on public.kitchen_stations (tenant_id, lower(btrim(name)));
create trigger kitchen_stations_updated_at before update on public.kitchen_stations
  for each row execute function public.set_updated_at();
comment on table public.kitchen_stations is
  'Punto de venta: estaciones donde se prepara cada producto. Cada pantalla de cocina elige cuáles muestra.';

-- La estación se pone en la categoría y la heredan sus productos; un producto puede tener la suya.
alter table public.menu_categories add column station_id uuid;
alter table public.menu_categories
  add constraint menu_categories_station_fk foreign key (station_id, tenant_id)
    references public.kitchen_stations (id, tenant_id) on delete set null (station_id);
alter table public.menu_items add column station_id uuid;
alter table public.menu_items
  add constraint menu_items_station_fk foreign key (station_id, tenant_id)
    references public.kitchen_stations (id, tenant_id) on delete set null (station_id);

-- La estación de un producto: la suya, o la de la categoría más cercana que tenga una.
create function private.pos_item_station(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select i.station_id, i.category_id as next_id, 0 as depth
      from public.menu_items i
     where i.id = p_item_id
    union all
    select c.station_id, c.parent_id, ch.depth + 1
      from chain ch
      join public.menu_categories c on c.id = ch.next_id
     where ch.station_id is null and ch.depth < 12
  )
  select station_id from chain where station_id is not null order by depth limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Aclaraciones: opciones para tocar, no texto libre
-- ─────────────────────────────────────────────────────────────────────────────
create table public.menu_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40), -- «Punto de la carne», «Sin…», «Extras»
  -- single = se elige una; multi = se pueden tocar varias.
  selection text not null default 'multi' check (selection in ('single', 'multi')),
  -- Obligatoria: el producto no se puede pedir sin elegir (el punto de un lomo).
  required boolean not null default false,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_modifier_groups_id_tenant_uq unique (id, tenant_id)
);
create trigger menu_modifier_groups_updated_at before update on public.menu_modifier_groups
  for each row execute function public.set_updated_at();

create table public.menu_modifier_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 40), -- «Jugoso», «Sin lechuga», «Extra cheddar»
  -- Lo que suma al precio (0 en casi todas).
  price_delta_cents bigint not null default 0 check (price_delta_cents between 0 and 100000000),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_modifier_options_id_tenant_uq unique (id, tenant_id),
  constraint menu_modifier_options_group_fk foreign key (group_id, tenant_id)
    references public.menu_modifier_groups (id, tenant_id) on delete cascade
);
create index menu_modifier_options_group_idx on public.menu_modifier_options (group_id, position);
create trigger menu_modifier_options_updated_at before update on public.menu_modifier_options
  for each row execute function public.set_updated_at();

-- A qué se le ofrece cada grupo: a una categoría entera (y lo que cuelga de ella) o a un producto.
create table public.menu_modifier_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid not null,
  category_id uuid references public.menu_categories(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint menu_modifier_links_group_fk foreign key (group_id, tenant_id)
    references public.menu_modifier_groups (id, tenant_id) on delete cascade,
  constraint menu_modifier_links_one_target check (num_nonnulls(category_id, menu_item_id) = 1)
);
create unique index menu_modifier_links_category_uq on public.menu_modifier_links (group_id, category_id)
  where category_id is not null;
create unique index menu_modifier_links_item_uq on public.menu_modifier_links (group_id, menu_item_id)
  where menu_item_id is not null;
create index menu_modifier_links_tenant_idx on public.menu_modifier_links (tenant_id);

comment on table public.menu_modifier_groups is 'Carta: grupos de aclaraciones («Punto de la carne», «Sin…»).';
comment on table public.menu_modifier_options is 'Carta: cada aclaración que se puede tocar, con lo que suma al precio.';
comment on table public.menu_modifier_links is 'Carta: a qué categoría o producto se le ofrece cada grupo de aclaraciones.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que cambia por sucursal: precio propio, si se vende, y agotado de hoy
-- ─────────────────────────────────────────────────────────────────────────────
create table public.menu_item_branches (
  branch_id uuid not null,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Vacío = el precio de la carta.
  price_cents bigint check (price_cents is null or price_cents between 0 and 1000000000000),
  -- Si este producto se vende en esta sucursal.
  available boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, menu_item_id),
  constraint menu_item_branches_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete cascade
);
create index menu_item_branches_item_idx on public.menu_item_branches (menu_item_id);
create index menu_item_branches_tenant_idx on public.menu_item_branches (tenant_id);
create trigger menu_item_branches_updated_at before update on public.menu_item_branches
  for each row execute function public.set_updated_at();
comment on table public.menu_item_branches is
  'Carta: lo que un producto tiene de distinto en una sucursal (precio propio, si se vende). Sin fila, vale la carta.';

create table public.menu_stockouts (
  branch_id uuid not null,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  service_day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Con fecha = alguien avisó que volvió a haber.
  cleared_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, menu_item_id, service_day),
  constraint menu_stockouts_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete cascade
);
create index menu_stockouts_day_idx on public.menu_stockouts (branch_id, service_day) where cleared_at is null;
create index menu_stockouts_tenant_idx on public.menu_stockouts (tenant_id);
create trigger menu_stockouts_updated_at before update on public.menu_stockouts
  for each row execute function public.set_updated_at();
comment on table public.menu_stockouts is
  'Carta: «agotado hoy» por sucursal y día de servicio. Al día siguiente la fila ya no cuenta: se levanta solo.';

-- Historial de precios: quién cambió qué y cuándo. No se edita.
create table public.menu_price_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  -- Vacío = el precio de la carta; con sucursal = su precio propio.
  branch_id uuid references public.branches(id) on delete set null,
  old_price_cents bigint,
  new_price_cents bigint,
  -- Los cambios hechos juntos (un aumento por categoría) comparten tanda.
  batch_id uuid,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index menu_price_changes_item_idx on public.menu_price_changes (menu_item_id, created_at desc);
create index menu_price_changes_tenant_idx on public.menu_price_changes (tenant_id, created_at desc);
comment on table public.menu_price_changes is 'Carta: historial de precios (quién, cuándo, de cuánto a cuánto).';

create function private.pos_tg_log_item_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_cents is distinct from old.price_cents then
    insert into public.menu_price_changes (tenant_id, menu_item_id, old_price_cents, new_price_cents, batch_id, changed_by)
    values (
      new.tenant_id, new.id, old.price_cents, new.price_cents,
      nullif(current_setting('pos.price_batch', true), '')::uuid,
      (select auth.uid())
    );
  end if;
  return new;
exception when others then
  -- Anotar el historial nunca puede impedir cambiar un precio.
  return new;
end;
$$;
create trigger menu_items_log_price
  after update of price_cents on public.menu_items
  for each row execute function private.pos_tg_log_item_price();

create function private.pos_tg_log_branch_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old bigint := case when tg_op = 'UPDATE' then old.price_cents else null end;
begin
  if new.price_cents is distinct from v_old then
    insert into public.menu_price_changes (
      tenant_id, menu_item_id, branch_id, old_price_cents, new_price_cents, batch_id, changed_by
    ) values (
      new.tenant_id, new.menu_item_id, new.branch_id, v_old, new.price_cents,
      nullif(current_setting('pos.price_batch', true), '')::uuid,
      (select auth.uid())
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
create trigger menu_item_branches_log_price
  after insert or update of price_cents on public.menu_item_branches
  for each row execute function private.pos_tg_log_branch_price();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Ajustes del punto de venta (del bar)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pos_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Cuándo una mesa pide atención, en minutos.
  order_warn_minutes smallint not null default 6 check (order_warn_minutes between 1 and 120),     -- sentada sin pedir
  kitchen_warn_minutes smallint not null default 12 check (kitchen_warn_minutes between 1 and 240), -- esperando comida
  kitchen_late_minutes smallint not null default 20 check (kitchen_late_minutes between 1 and 240), -- demorada
  ready_warn_minutes smallint not null default 2 check (ready_warn_minutes between 1 and 60),       -- lista sin llevar
  bill_warn_minutes smallint not null default 4 check (bill_warn_minutes between 1 and 60),         -- pidió la cuenta
  -- Recargo de crédito en puntos básicos (1000 = 10 %). Va solo sobre la parte que se paga con crédito.
  credit_surcharge_bp integer not null default 0 check (credit_surcharge_bp between 0 and 5000),
  -- Qué medios se facturan si nadie dice otra cosa. El efectivo, no.
  invoice_by_method jsonb not null default
    '{"cash": false, "transfer": true, "qr": true, "debit": true, "credit": true, "other": false}'::jsonb
    check (jsonb_typeof(invoice_by_method) = 'object'),
  tip_presets_pct smallint[] not null default '{10}',
  -- Quién da el OK a descuentos y bajas.
  approver_roles text[] not null default '{owner,cashier}'
    check (approver_roles <@ '{owner,cashier,waiter,host}'::text[] and cardinality(approver_roles) >= 1),
  discount_needs_approval boolean not null default true,
  void_needs_approval boolean not null default true,
  transfer_alias text check (transfer_alias is null or char_length(btrim(transfer_alias)) between 1 and 60),
  transfer_holder text check (transfer_holder is null or char_length(btrim(transfer_holder)) between 1 and 80),
  -- Billetes en uso, de mayor a menor, en pesos: para contar la caja billete por billete.
  bill_denominations integer[] not null default '{20000,10000,2000,1000,500,200,100}',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_settings_minutes_order check (kitchen_late_minutes >= kitchen_warn_minutes)
);
create trigger pos_settings_updated_at before update on public.pos_settings
  for each row execute function public.set_updated_at();
comment on table public.pos_settings is 'Punto de venta: ajustes del bar (tiempos de alerta, recargo, qué se factura, billetes).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La mesa, la tanda y el renglón
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.table_sessions
  add column reservation_id uuid references public.salon_reservations(id) on delete set null,
  add column customer_id uuid references public.customers(id) on delete set null,
  add column bill_requested_at timestamptz,
  add column service_day date,
  -- Modo práctica: el personal aprende con pedidos de prueba que no llegan a la caja ni a los reportes.
  add column is_practice boolean not null default false,
  -- table = mesa; quick = venta rápida sin mesa; delivery = pedido de una app.
  add column kind text not null default 'table' check (kind in ('table', 'quick', 'delivery')),
  add column note text check (note is null or char_length(note) <= 300);
create index table_sessions_reservation_idx on public.table_sessions (reservation_id)
  where reservation_id is not null;
create index table_sessions_customer_idx on public.table_sessions (customer_id)
  where customer_id is not null;
create index table_sessions_service_day_idx on public.table_sessions (branch_id, service_day);
-- Una reserva se sienta en una sola mesa abierta a la vez.
create unique index table_sessions_reservation_open_uq on public.table_sessions (reservation_id)
  where reservation_id is not null and status = 'open';

comment on column public.table_sessions.reservation_id is 'La reserva que se sentó en esta mesa: de ahí salen el nombre, la seña y las notas.';
comment on column public.table_sessions.customer_id is 'El socio del club de la mesa: suma los puntos al cobrar.';
comment on column public.table_sessions.bill_requested_at is 'Cuándo pidieron la cuenta (vacío = no la pidieron).';

alter table public.tickets
  -- 1 = primera tanda, 2 = segunda…
  add column course smallint not null default 1 check (course between 1 and 9),
  -- «Después»: la tanda está cargada pero cocina todavía no la ve.
  add column held boolean not null default false,
  add column fired_at timestamptz,
  add column kitchen_seen_at timestamptz,
  add column ready_at timestamptz,
  add column is_practice boolean not null default false;
-- Lo que ya había salió a cocina cuando se aceptó.
update public.tickets set fired_at = coalesce(accepted_at, submitted_at) where fired_at is null and status <> 'pending';
create index tickets_kitchen_idx on public.tickets (tenant_id, fired_at)
  where fired_at is not null and status in ('accepted', 'preparing', 'ready');

comment on column public.tickets.held is 'La tanda espera («después»): se marcha cuando el mozo avisa.';
comment on column public.tickets.fired_at is 'Cuándo salió a cocina. Vacío mientras espera.';
comment on column public.tickets.kitchen_seen_at is 'Cuándo una pantalla de cocina la mostró por primera vez («cocina lo vio»).';

alter table public.ticket_items
  add column station_id uuid references public.kitchen_stations(id) on delete set null,
  add column prep_status text not null default 'queued'
    check (prep_status in ('queued', 'preparing', 'ready', 'served')),
  add column started_at timestamptz,
  add column ready_at timestamptz,
  add column served_at timestamptz,
  -- Foto de las aclaraciones elegidas: [{ "label": "Jugoso", "group": "Punto", "delta_cents": 0 }]
  add column modifiers jsonb not null default '[]'::jsonb check (jsonb_typeof(modifiers) = 'array'),
  add column cancelled_by uuid references auth.users(id) on delete set null;
-- Lo que ya estaba servido o listo queda como estaba.
update public.ticket_items ti
   set prep_status = case t.status when 'served' then 'served' when 'ready' then 'ready' when 'preparing' then 'preparing' else 'queued' end,
       served_at = case when t.status = 'served' then t.served_at end
  from public.tickets t
 where t.id = ti.ticket_id and t.status in ('served', 'ready', 'preparing');
create index ticket_items_station_idx on public.ticket_items (station_id) where station_id is not null;

comment on column public.ticket_items.prep_status is 'Dónde está el renglón: en cola, en preparación, listo o servido.';
comment on column public.ticket_items.modifiers is 'Aclaraciones elegidas al pedir, como quedaron ese día.';

-- El total de la comanda solo se recalcula cuando cambia algo que lo mueve, no en cada avance de cocina.
create or replace trigger ticket_items_recalc_total
  after insert or delete or update of quantity, unit_price_cents, line_total_cents, cancelled_at, ticket_id
  on public.ticket_items
  for each row execute function public.recalc_ticket_total();

-- El estado de la tanda sale del de sus renglones.
create function private.pos_sync_ticket(p_ticket_id uuid)
returns public.ticket_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_started integer;
  v_done integer;
  v_served integer;
  v_status public.ticket_status;
  v_new public.ticket_status;
begin
  select status into v_status from public.tickets where id = p_ticket_id for update;
  if v_status is null or v_status in ('pending', 'cancelled') then
    return v_status;
  end if;

  select count(*),
         count(*) filter (where prep_status in ('preparing', 'ready', 'served')),
         count(*) filter (where prep_status in ('ready', 'served')),
         count(*) filter (where prep_status = 'served')
    into v_total, v_started, v_done, v_served
    from public.ticket_items
   where ticket_id = p_ticket_id and cancelled_at is null;

  if v_total = 0 then
    return v_status;
  end if;

  v_new := case
    when v_served = v_total then 'served'
    when v_done = v_total then 'ready'
    when v_started > 0 then 'preparing'
    else 'accepted'
  end;

  if v_new is distinct from v_status then
    update public.tickets
       set status = v_new,
           prepared_at = case when v_new in ('preparing', 'ready', 'served') then coalesce(prepared_at, now()) else prepared_at end,
           ready_at = case when v_new in ('ready', 'served') then coalesce(ready_at, now()) else null end,
           served_at = case when v_new = 'served' then coalesce(served_at, now()) else null end
     where id = p_ticket_id;
  end if;
  return v_new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.kitchen_stations enable row level security;
alter table public.menu_modifier_groups enable row level security;
alter table public.menu_modifier_options enable row level security;
alter table public.menu_modifier_links enable row level security;
alter table public.menu_item_branches enable row level security;
alter table public.menu_stockouts enable row level security;
alter table public.menu_price_changes enable row level security;
alter table public.pos_settings enable row level security;

-- La carta la lee quien trabaja en el bar y la editan dueño y contenido (como menu_items).
create policy kitchen_stations_read on public.kitchen_stations for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy kitchen_stations_write on public.kitchen_stations for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy menu_modifier_groups_read on public.menu_modifier_groups for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy menu_modifier_groups_write on public.menu_modifier_groups for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy menu_modifier_options_read on public.menu_modifier_options for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy menu_modifier_options_write on public.menu_modifier_options for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy menu_modifier_links_read on public.menu_modifier_links for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy menu_modifier_links_write on public.menu_modifier_links for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy menu_item_branches_read on public.menu_item_branches for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy menu_item_branches_write on public.menu_item_branches for all to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

-- El agotado lo marca quien está en el salón o en la cocina, por pos_set_stockout.
create policy menu_stockouts_read on public.menu_stockouts for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));

create policy menu_price_changes_read on public.menu_price_changes for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy pos_settings_read on public.pos_settings for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'host'));
create policy pos_settings_owner_write on public.pos_settings for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

do $$
declare
  t text;
begin
  foreach t in array array[
    'kitchen_stations', 'menu_modifier_groups', 'menu_modifier_options', 'menu_modifier_links',
    'menu_item_branches', 'menu_stockouts', 'menu_price_changes', 'pos_settings'
  ]
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
         with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))',
      t || '_no_accountant', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.kitchen_stations, public.menu_modifier_groups, public.menu_modifier_options,
  public.menu_modifier_links, public.menu_item_branches, public.pos_settings
  to authenticated, service_role;
grant select on public.menu_stockouts, public.menu_price_changes to authenticated;
grant select, insert, update, delete on public.menu_stockouts, public.menu_price_changes to service_role;
revoke all on
  public.kitchen_stations, public.menu_modifier_groups, public.menu_modifier_options,
  public.menu_modifier_links, public.menu_item_branches, public.menu_stockouts,
  public.menu_price_changes, public.pos_settings
  from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Abrir una mesa
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos toques: la mesa y cuántos son. Si hay reserva, llega y se sienta en el mismo gesto, con la mesa y
-- los que vinieron; el nombre y el socio salen de ahí.
create function public.pos_open_table(
  p_table_id uuid,
  p_party_size integer,
  p_reservation_id uuid default null,
  p_customer_id uuid default null,
  p_alias text default null,
  p_practice boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table public.physical_tables%rowtype;
  v_session public.table_sessions%rowtype;
  v_res public.salon_reservations%rowtype;
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
  v_customer uuid := p_customer_id;
  v_practice boolean := coalesce(p_practice, false);
begin
  if p_party_size is null or p_party_size < 1 or p_party_size > 100 then
    raise exception 'party_size_invalid' using errcode = '22023';
  end if;

  select * into v_table from public.physical_tables where id = p_table_id and active for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_table.tenant_id, 'owner', 'cashier', 'waiter', 'host');

  select * into v_session
    from public.table_sessions
   where physical_table_id = v_table.id and status = 'open';
  if found then
    return jsonb_build_object('session_id', v_session.id, 'already_open', true);
  end if;

  if p_reservation_id is not null then
    select * into v_res
      from public.salon_reservations
     where id = p_reservation_id and tenant_id = v_table.tenant_id
       for update;
    if not found then
      raise exception 'reservation_not_found' using errcode = 'P0002';
    end if;
    if v_res.status in ('cancelled', 'closed') then
      raise exception 'reservation_not_available' using errcode = '55000';
    end if;
    if exists (select 1 from public.table_sessions s where s.reservation_id = v_res.id and s.status = 'open') then
      raise exception 'reservation_already_seated' using errcode = '55000';
    end if;
    v_alias := coalesce(v_alias, nullif(btrim(v_res.guest_name), ''));
    v_customer := coalesce(v_customer, v_res.customer_id);
  end if;

  if v_customer is not null and not exists (
    select 1 from public.customers c
     where c.id = v_customer and c.tenant_id = v_table.tenant_id and c.deleted_at is null
  ) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  insert into public.table_sessions (
    tenant_id, branch_id, physical_table_id, opened_by, party_size, status, alias,
    reservation_id, customer_id, service_day, is_practice
  ) values (
    v_table.tenant_id, v_table.branch_id, v_table.id, (select auth.uid()), p_party_size, 'open', left(v_alias, 60),
    p_reservation_id, v_customer, private.pos_service_day(v_table.tenant_id), v_practice
  ) returning * into v_session;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    v_session.id, 'session_opened', (select auth.uid()),
    jsonb_build_object('source', 'pos', 'party_size', p_party_size, 'alias', v_session.alias,
                       'reservation_id', p_reservation_id)
  );

  if p_reservation_id is not null and not v_practice then
    if v_res.status in ('pending', 'no_show') then
      perform private.transition_reservation_status_core(v_res.id, 'arrived', p_party_size);
    end if;
    if v_res.status in ('pending', 'no_show', 'arrived') then
      perform private.transition_reservation_status_core(v_res.id, 'seated', p_party_size);
    end if;
    update public.salon_reservations
       set table_label = left(v_table.label, 24)
     where id = v_res.id and table_label is distinct from left(v_table.label, 24);
  end if;

  perform private.pos_poke(v_table.branch_id, 'floor', v_session.id);
  return jsonb_build_object('session_id', v_session.id, 'already_open', false);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Mandar una tanda
-- ─────────────────────────────────────────────────────────────────────────────
-- p_items: [{ "menu_item_id": uuid, "quantity": int, "option_ids": [uuid…], "notes": text }]
-- p_fire = true la manda a cocina ahora; false la deja esperando («después»).
-- La clave de idempotencia hace que reintentar sin señal nunca duplique el pedido.
create function public.pos_send_order(
  p_session_id uuid,
  p_items jsonb,
  p_fire boolean default true,
  p_course integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_ticket public.tickets%rowtype;
  v_item jsonb;
  v_menu public.menu_items%rowtype;
  v_override public.menu_item_branches%rowtype;
  v_qty integer;
  v_unit bigint;
  v_delta bigint;
  v_mods jsonb;
  v_option_ids uuid[];
  v_day date;
  v_fire boolean := coalesce(p_fire, true);
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_lines integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 80 then
    raise exception 'order_too_long' using errcode = '22023';
  end if;

  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  if v_key is not null then
    select * into v_ticket from public.tickets where session_id = p_session_id and idempotency_key = v_key;
    if found then
      return jsonb_build_object('ticket_id', v_ticket.id, 'total_cents', v_ticket.total_cents,
                                'fired', v_ticket.fired_at is not null, 'duplicate', true);
    end if;
  end if;

  v_day := private.pos_service_day(v_session.tenant_id);

  insert into public.tickets (
    tenant_id, session_id, status, created_by_user_id, submitted_at, accepted_at, accepted_by_user_id,
    idempotency_key, course, held, fired_at, is_practice
  ) values (
    v_session.tenant_id, p_session_id, 'accepted', (select auth.uid()), now(), now(), (select auth.uid()),
    v_key, least(greatest(coalesce(p_course, 1), 1), 9), not v_fire,
    case when v_fire then now() end, v_session.is_practice
  ) returning * into v_ticket;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
     where id = (v_item ->> 'menu_item_id')::uuid
       and tenant_id = v_session.tenant_id
       and active;
    if not found then
      raise exception 'item_not_available' using errcode = '55000', detail = coalesce(v_item ->> 'menu_item_id', '');
    end if;

    select * into v_override
      from public.menu_item_branches
     where branch_id = v_session.branch_id and menu_item_id = v_menu.id;
    if found and not v_override.available then
      raise exception 'item_not_available' using errcode = '55000', detail = v_menu.name;
    end if;
    if exists (
      select 1 from public.menu_stockouts so
       where so.branch_id = v_session.branch_id and so.menu_item_id = v_menu.id
         and so.service_day = v_day and so.cleared_at is null
    ) then
      raise exception 'item_sold_out' using errcode = '55000', detail = v_menu.name;
    end if;

    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;

    -- Las aclaraciones valen solo si son del bar; su texto y su precio se toman de la carta, no del pedido.
    v_option_ids := coalesce(
      (select array_agg(distinct x::uuid)
         from jsonb_array_elements_text(
           case when jsonb_typeof(v_item -> 'option_ids') = 'array' then v_item -> 'option_ids' else '[]'::jsonb end
         ) x),
      '{}'::uuid[]
    );
    if cardinality(v_option_ids) > 12 then
      raise exception 'too_many_options' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'group', g.name, 'delta_cents', o.price_delta_cents)
                              order by g.position, o.position, o.label), '[]'::jsonb),
           coalesce(sum(o.price_delta_cents), 0),
           count(*)
      into v_mods, v_delta, v_lines
      from public.menu_modifier_options o
      join public.menu_modifier_groups g on g.id = o.group_id
     where o.id = any (v_option_ids) and o.tenant_id = v_session.tenant_id and o.active and g.active;
    if v_lines <> cardinality(v_option_ids) then
      raise exception 'option_not_available' using errcode = '55000', detail = v_menu.name;
    end if;

    v_unit := coalesce(v_override.price_cents, v_menu.price_cents) + v_delta;

    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents, line_total_cents, notes, station_id, modifiers
    ) values (
      v_ticket.id, v_menu.id, v_qty, v_unit, v_unit * v_qty,
      nullif(left(btrim(coalesce(v_item ->> 'notes', '')), 200), ''),
      private.pos_item_station(v_menu.id), v_mods
    );
  end loop;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  perform private.pos_poke(v_session.branch_id, case when v_fire then 'kitchen' else 'floor' end, p_session_id);
  return jsonb_build_object('ticket_id', v_ticket.id, 'total_cents', v_ticket.total_cents,
                            'fired', v_fire, 'duplicate', false);
end;
$$;

-- Marchar una tanda que estaba esperando.
create function public.pos_fire_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
  v_branch uuid;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_ticket.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_ticket.status = 'cancelled' then
    raise exception 'ticket_cancelled' using errcode = '55000';
  end if;
  if v_ticket.fired_at is null then
    update public.tickets set held = false, fired_at = now() where id = p_ticket_id;
  end if;
  select branch_id into v_branch from public.table_sessions where id = v_ticket.session_id;
  perform private.pos_poke(v_branch, 'kitchen', v_ticket.session_id);
  return jsonb_build_object('ticket_id', p_ticket_id, 'fired', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Cocina: avanzar (o deshacer) una tanda
-- ─────────────────────────────────────────────────────────────────────────────
-- p_to: 'preparing' | 'ready' | 'queued' (deshacer). p_station_ids limita a las estaciones de esa pantalla;
-- sin estaciones, mueve toda la tanda. Lo que ya está servido no se toca.
create function public.pos_kitchen_advance(
  p_ticket_id uuid,
  p_to text,
  p_station_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets%rowtype;
  v_branch uuid;
  v_status public.ticket_status;
  v_moved integer;
begin
  if p_to not in ('queued', 'preparing', 'ready') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_ticket.tenant_id, 'owner', 'kitchen', 'cashier', 'waiter');
  if v_ticket.status = 'cancelled' or v_ticket.fired_at is null then
    raise exception 'ticket_not_in_kitchen' using errcode = '55000';
  end if;

  update public.ticket_items
     set prep_status = p_to,
         started_at = case when p_to = 'queued' then null else coalesce(started_at, now()) end,
         ready_at = case when p_to = 'ready' then coalesce(ready_at, now()) else null end
   where ticket_id = p_ticket_id
     and cancelled_at is null
     and prep_status <> 'served'
     and prep_status <> p_to
     and (p_station_ids is null or cardinality(p_station_ids) = 0
          or station_id is null or station_id = any (p_station_ids));
  get diagnostics v_moved = row_count;

  v_status := private.pos_sync_ticket(p_ticket_id);
  select branch_id into v_branch from public.table_sessions where id = v_ticket.session_id;
  perform private.pos_poke(v_branch, 'kitchen', v_ticket.session_id);
  return jsonb_build_object('ticket_id', p_ticket_id, 'status', v_status, 'moved', v_moved);
end;
$$;

-- Una pantalla de cocina mostró estas tandas: «cocina lo vio».
create function public.pos_kitchen_seen(p_ticket_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_count integer;
begin
  if p_ticket_ids is null or cardinality(p_ticket_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ticket_ids) > 200 then
    raise exception 'too_many_tickets' using errcode = '22023';
  end if;
  -- Todas del mismo bar, y de uno donde quien llama trabaja en cocina o en el salón.
  select min(t.tenant_id::text)::uuid into v_tenant from public.tickets t where t.id = any (p_ticket_ids);
  if v_tenant is null then
    return 0;
  end if;
  perform private.pos_require_role(v_tenant, 'owner', 'kitchen', 'cashier', 'waiter');
  update public.tickets
     set kitchen_seen_at = now()
   where id = any (p_ticket_ids)
     and tenant_id = v_tenant
     and kitchen_seen_at is null
     and fired_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Servir, pedir la cuenta, dar de baja un renglón, cambiar de mesa
-- ─────────────────────────────────────────────────────────────────────────────
-- «Servido» por mesa (sin p_item_ids) o por producto. p_only_ready = false sirve todo lo que salió a cocina
-- aunque nadie lo haya marcado listo (para el bar que no usa pantalla de cocina).
create function public.pos_mark_served(
  p_session_id uuid,
  p_item_ids uuid[] default null,
  p_only_ready boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_ticket_id uuid;
  v_count integer := 0;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');

  with moved as (
    update public.ticket_items ti
       set prep_status = 'served',
           served_at = now(),
           started_at = coalesce(ti.started_at, now()),
           ready_at = coalesce(ti.ready_at, now())
      from public.tickets t
     where t.id = ti.ticket_id
       and t.session_id = p_session_id
       and t.status <> 'cancelled'
       and t.fired_at is not null
       and ti.cancelled_at is null
       and ti.prep_status <> 'served'
       and (p_item_ids is null or ti.id = any (p_item_ids))
       and (not coalesce(p_only_ready, true) or ti.prep_status = 'ready' or p_item_ids is not null)
    returning ti.ticket_id
  )
  select count(*) into v_count from moved;

  for v_ticket_id in
    select t.id from public.tickets t where t.session_id = p_session_id and t.status in ('accepted', 'preparing', 'ready')
  loop
    perform private.pos_sync_ticket(v_ticket_id);
  end loop;

  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('session_id', p_session_id, 'served', v_count);
end;
$$;

create function public.pos_request_bill(p_session_id uuid, p_on boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  if coalesce(p_on, true) and v_session.bill_requested_at is null then
    update public.table_sessions set bill_requested_at = now() where id = p_session_id;
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
    values (p_session_id, 'bill_requested', (select auth.uid()), jsonb_build_object('source', 'pos'));
  elsif not coalesce(p_on, true) and v_session.bill_requested_at is not null then
    update public.table_sessions set bill_requested_at = null where id = p_session_id;
  end if;

  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('session_id', p_session_id, 'bill_requested', coalesce(p_on, true));
end;
$$;

-- Dar de baja un renglón. El mozo puede mientras cocina no lo haya empezado; después, solo dueño o caja.
create function public.pos_cancel_item(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ticket_items%rowtype;
  v_ticket public.tickets%rowtype;
  v_role public.tenant_role;
  v_branch uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_item from public.ticket_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  select * into v_ticket from public.tickets where id = v_item.ticket_id for update;
  v_role := private.pos_require_role(v_ticket.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_item.cancelled_at is not null then
    return jsonb_build_object('item_id', p_item_id, 'cancelled', true, 'duplicate', true);
  end if;
  if v_item.prep_status <> 'queued' and v_role::text not in ('owner', 'cashier') then
    raise exception 'needs_approval' using errcode = '42501';
  end if;
  if v_reason is null and v_item.prep_status <> 'queued' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.ticket_items
     set cancelled_at = now(),
         cancellation_reason = left(coalesce(v_reason, 'Cargado por error'), 200),
         cancelled_by = (select auth.uid())
   where id = p_item_id;

  -- Una tanda sin renglones vivos se cancela entera.
  if not exists (select 1 from public.ticket_items where ticket_id = v_ticket.id and cancelled_at is null) then
    update public.tickets
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Sin productos'
     where id = v_ticket.id and status <> 'cancelled';
  else
    perform private.pos_sync_ticket(v_ticket.id);
  end if;

  select branch_id into v_branch from public.table_sessions where id = v_ticket.session_id;
  perform private.pos_poke(v_branch, 'kitchen', v_ticket.session_id);
  return jsonb_build_object('item_id', p_item_id, 'cancelled', true, 'duplicate', false);
end;
$$;

-- Cambiar de mesa (dentro de la misma sucursal). La reserva, si hay, se entera de la mesa nueva.
create function public.pos_move_table(p_session_id uuid, p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_table public.physical_tables%rowtype;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  select * into v_table
    from public.physical_tables
   where id = p_table_id and tenant_id = v_session.tenant_id and active
     for update;
  if not found or v_table.branch_id <> v_session.branch_id then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if v_table.id = v_session.physical_table_id then
    return jsonb_build_object('session_id', p_session_id, 'table_id', p_table_id, 'moved', false);
  end if;
  if exists (select 1 from public.table_sessions s where s.physical_table_id = p_table_id and s.status = 'open') then
    raise exception 'table_busy' using errcode = '55000';
  end if;

  update public.table_sessions set physical_table_id = p_table_id where id = p_session_id;
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (p_session_id, 'session_moved', (select auth.uid()),
          jsonb_build_object('from_physical_table_id', v_session.physical_table_id, 'to_physical_table_id', p_table_id));
  if v_session.reservation_id is not null then
    update public.salon_reservations
       set table_label = left(v_table.label, 24)
     where id = v_session.reservation_id and table_label is distinct from left(v_table.label, 24);
  end if;

  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('session_id', p_session_id, 'table_id', p_table_id, 'moved', true);
end;
$$;

-- Cambiar cuántos son, el nombre o el socio de una mesa abierta.
create function public.pos_update_table(
  p_session_id uuid,
  p_party_size integer default null,
  p_alias text default null,
  p_customer_id uuid default null,
  p_clear_customer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  if p_party_size is not null and (p_party_size < 1 or p_party_size > 100) then
    raise exception 'party_size_invalid' using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c
     where c.id = p_customer_id and c.tenant_id = v_session.tenant_id and c.deleted_at is null
  ) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;

  update public.table_sessions
     set party_size = coalesce(p_party_size, party_size),
         alias = case when p_alias is null then alias else left(v_alias, 60) end,
         customer_id = case
           when coalesce(p_clear_customer, false) then null
           else coalesce(p_customer_id, customer_id)
         end
   where id = p_session_id;

  if p_party_size is not null and p_party_size is distinct from v_session.party_size then
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
    values (p_session_id, 'party_size_changed', (select auth.uid()),
            jsonb_build_object('from', v_session.party_size, 'to', p_party_size));
    -- Los comensales de la reserva siguen a los de la mesa: de ahí sale el per cápita.
    if v_session.reservation_id is not null and not v_session.is_practice then
      update public.salon_reservations
         set actual_guests = p_party_size
       where id = v_session.reservation_id and actual_guests is distinct from p_party_size;
    end if;
  end if;

  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('session_id', p_session_id);
end;
$$;

-- Agotado hoy, por sucursal. Lo marca cualquiera del salón o de la cocina.
create function public.pos_set_stockout(p_branch_id uuid, p_menu_item_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_day date;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier', 'waiter', 'kitchen', 'host');
  if not exists (
    select 1 from public.menu_items i where i.id = p_menu_item_id and i.tenant_id = v_branch.tenant_id
  ) then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  v_day := private.pos_service_day(v_branch.tenant_id);

  if coalesce(p_on, true) then
    insert into public.menu_stockouts (branch_id, menu_item_id, service_day, tenant_id, created_by)
    values (p_branch_id, p_menu_item_id, v_day, v_branch.tenant_id, (select auth.uid()))
    on conflict (branch_id, menu_item_id, service_day)
      do update set cleared_at = null, created_by = excluded.created_by;
  else
    update public.menu_stockouts
       set cleared_at = now()
     where branch_id = p_branch_id and menu_item_id = p_menu_item_id and service_day = v_day and cleared_at is null;
  end if;

  perform private.pos_poke(p_branch_id, 'menu', null);
  return jsonb_build_object('menu_item_id', p_menu_item_id, 'sold_out', coalesce(p_on, true));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Lo que leen las pantallas (una sola ida a la base por pantalla)
-- ─────────────────────────────────────────────────────────────────────────────

-- El salón de una sucursal: sectores, plano, mesas abiertas con dónde está su comida, y las reservas de hoy.
create function public.pos_floor_snapshot(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_day date;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier', 'waiter', 'kitchen', 'host');
  v_day := private.pos_service_day(v_branch.tenant_id);

  return jsonb_build_object(
    'now', now(),
    'service_day', v_day,
    'branch', jsonb_build_object(
      'id', v_branch.id, 'name', v_branch.name, 'short_name', v_branch.short_name,
      'slug', v_branch.slug, 'color', v_branch.color, 'is_default', v_branch.is_default
    ),
    'settings', (
      select jsonb_build_object(
        'order_warn_minutes', s.order_warn_minutes, 'kitchen_warn_minutes', s.kitchen_warn_minutes,
        'kitchen_late_minutes', s.kitchen_late_minutes, 'ready_warn_minutes', s.ready_warn_minutes,
        'bill_warn_minutes', s.bill_warn_minutes
      )
      from public.pos_settings s where s.tenant_id = v_branch.tenant_id
    ),
    'areas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'position', a.position, 'width', a.width, 'height', a.height
      ) order by a.position, a.name), '[]'::jsonb)
      from public.floor_plan_areas a where a.branch_id = v_branch.id
    ),
    'elements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'area_id', e.area_id, 'kind', e.kind, 'shape', e.shape,
        'x', e.x, 'y', e.y, 'w', e.width, 'h', e.height, 'rotation', e.rotation,
        'corner_radius', e.corner_radius, 'z', e.z_index, 'label', e.label, 'color', e.color,
        'table_id', e.physical_table_id, 'table_label', p.label, 'capacity', p.capacity
      ) order by e.z_index, e.id), '[]'::jsonb)
      from public.floor_plan_elements e
      join public.floor_plan_areas a on a.id = e.area_id
      left join public.physical_tables p on p.id = e.physical_table_id
      where a.branch_id = v_branch.id and (e.physical_table_id is null or p.active)
    ),
    'loose_tables', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'capacity', p.capacity)
                                order by p.label), '[]'::jsonb)
      from public.physical_tables p
      where p.branch_id = v_branch.id and p.active
        and not exists (select 1 from public.floor_plan_elements e where e.physical_table_id = p.id)
    ),
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_id', s.physical_table_id, 'opened_at', s.opened_at, 'party_size', s.party_size,
        'alias', s.alias, 'reservation_id', s.reservation_id, 'bill_requested_at', s.bill_requested_at,
        'total_cents', s.total_cents, 'is_practice', s.is_practice, 'kind', s.kind,
        'customer', (
          select jsonb_build_object('id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
                                    'tier', lt.name, 'tier_color', lt.color)
          from public.customers c
          left join public.loyalty_tiers lt on lt.id = c.current_tier_id
          where c.id = s.customer_id
        ),
        'held_tickets', k.held_tickets,
        'items_queued', k.items_queued, 'items_preparing', k.items_preparing,
        'items_ready', k.items_ready, 'items_served', k.items_served,
        'waiting_since', k.waiting_since, 'ready_since', k.ready_since,
        'last_served_at', k.last_served_at, 'first_order_at', k.first_order_at
      ) order by s.opened_at), '[]'::jsonb)
      from public.table_sessions s
      left join lateral (
        select
          count(distinct t.id) filter (where t.fired_at is null and t.held) as held_tickets,
          count(ti.id) filter (where t.fired_at is not null and ti.prep_status = 'queued') as items_queued,
          count(ti.id) filter (where t.fired_at is not null and ti.prep_status = 'preparing') as items_preparing,
          count(ti.id) filter (where t.fired_at is not null and ti.prep_status = 'ready') as items_ready,
          count(ti.id) filter (where t.fired_at is not null and ti.prep_status = 'served') as items_served,
          min(t.fired_at) filter (where ti.prep_status in ('queued', 'preparing')) as waiting_since,
          min(ti.ready_at) filter (where ti.prep_status = 'ready') as ready_since,
          max(ti.served_at) as last_served_at,
          min(t.submitted_at) as first_order_at
        from public.tickets t
        join public.ticket_items ti on ti.ticket_id = t.id and ti.cancelled_at is null
        where t.session_id = s.id and t.status <> 'cancelled'
      ) k on true
      where s.branch_id = v_branch.id and s.status = 'open'
    ),
    'reservations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'time', to_char(r.reservation_time_local, 'HH24:MI'), 'name', r.guest_name,
        'guests', coalesce(r.actual_guests, r.estimated_guests), 'status', r.status,
        'table_label', r.table_label, 'deposit_cents', r.deposit_cents, 'kind', r.kind,
        'comments', case when r.highlight_comment then r.comments end,
        'alerts', r.service_alerts, 'customer_id', r.customer_id,
        'event', coalesce(se.name_override, tpl.name)
      ) order by r.reservation_time_local, r.guest_name), '[]'::jsonb)
      from public.salon_reservations r
      left join public.scheduled_events se on se.id = r.scheduled_event_id
      left join public.scheduled_event_templates tpl on tpl.id = se.template_id
      where r.tenant_id = v_branch.tenant_id
        and r.reservation_date = v_day
        and r.status in ('pending', 'arrived')
        and ((r.branch_id is null and v_branch.is_default) or r.branch_id = v_branch.id)
        and not exists (select 1 from public.table_sessions s2 where s2.reservation_id = r.id and s2.status = 'open')
    )
  );
end;
$$;

-- Una mesa abierta, entera: tandas, renglones, la reserva y el socio.
create function public.pos_session_detail(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  select * into v_session from public.table_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'kitchen', 'host');

  return jsonb_build_object(
    'now', now(),
    'session', jsonb_build_object(
      'id', v_session.id, 'status', v_session.status, 'branch_id', v_session.branch_id,
      'table_id', v_session.physical_table_id, 'opened_at', v_session.opened_at,
      'party_size', v_session.party_size, 'alias', v_session.alias, 'note', v_session.note,
      'bill_requested_at', v_session.bill_requested_at, 'total_cents', v_session.total_cents,
      'is_practice', v_session.is_practice, 'kind', v_session.kind, 'paid_at', v_session.paid_at
    ),
    'table', (
      select jsonb_build_object('id', p.id, 'label', p.label, 'capacity', p.capacity, 'area', a.name)
      from public.physical_tables p
      left join public.floor_plan_elements e on e.physical_table_id = p.id
      left join public.floor_plan_areas a on a.id = e.area_id
      where p.id = v_session.physical_table_id
    ),
    'reservation', (
      select jsonb_build_object(
        'id', r.id, 'name', r.guest_name, 'time', to_char(r.reservation_time_local, 'HH24:MI'),
        'guests', coalesce(r.actual_guests, r.estimated_guests), 'deposit_cents', r.deposit_cents,
        'kind', r.kind, 'comments', r.comments, 'alerts', r.service_alerts,
        'cake_count', r.cake_count, 'champagne_count', r.champagne_count,
        'event', coalesce(se.name_override, tpl.name)
      )
      from public.salon_reservations r
      left join public.scheduled_events se on se.id = r.scheduled_event_id
      left join public.scheduled_event_templates tpl on tpl.id = se.template_id
      where r.id = v_session.reservation_id
    ),
    'customer', (
      select jsonb_build_object(
        'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
        'points_balance', c.points_balance, 'tier', lt.name, 'tier_color', lt.color,
        'total_visits', c.total_visits, 'alerts', c.service_alerts
      )
      from public.customers c
      left join public.loyalty_tiers lt on lt.id = c.current_tier_id
      where c.id = v_session.customer_id
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'status', t.status, 'course', t.course, 'held', t.held,
        'submitted_at', t.submitted_at, 'fired_at', t.fired_at, 'kitchen_seen_at', t.kitchen_seen_at,
        'ready_at', t.ready_at, 'served_at', t.served_at, 'total_cents', t.total_cents,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', ti.id, 'menu_item_id', ti.menu_item_id, 'name', mi.name, 'quantity', ti.quantity,
            'unit_price_cents', ti.unit_price_cents, 'line_total_cents', ti.line_total_cents,
            'notes', ti.notes, 'modifiers', ti.modifiers, 'station_id', ti.station_id,
            'prep_status', ti.prep_status, 'ready_at', ti.ready_at, 'served_at', ti.served_at,
            'cancelled_at', ti.cancelled_at, 'cancellation_reason', ti.cancellation_reason
          ) order by ti.created_at, ti.id), '[]'::jsonb)
          from public.ticket_items ti
          join public.menu_items mi on mi.id = ti.menu_item_id
          where ti.ticket_id = t.id
        )
      ) order by t.submitted_at, t.id), '[]'::jsonb)
      from public.tickets t
      where t.session_id = v_session.id and t.status <> 'cancelled'
    )
  );
end;
$$;

-- La carta para pedir en una sucursal: precios de ahí, agotados de hoy, aclaraciones y lo que más sale a esta hora.
create function public.pos_menu(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_day date;
  v_tz text;
  v_hour integer;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier', 'waiter', 'kitchen', 'host');
  v_day := private.pos_service_day(v_branch.tenant_id);
  select coalesce(t.timezone, 'America/Argentina/Cordoba') into v_tz from public.tenants t where t.id = v_branch.tenant_id;
  v_hour := extract(hour from (now() at time zone v_tz))::integer;

  return jsonb_build_object(
    'service_day', v_day,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'parent_id', c.parent_id, 'position', c.position, 'station_id', c.station_id
      ) order by c.position, c.name), '[]'::jsonb)
      from public.menu_categories c where c.tenant_id = v_branch.tenant_id and c.active
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category_id', i.category_id, 'position', i.position,
        'price_cents', coalesce(ib.price_cents, i.price_cents),
        'description', i.description,
        'station_id', private.pos_item_station(i.id),
        'sold_out', so.menu_item_id is not null
      ) order by i.position, i.name), '[]'::jsonb)
      from public.menu_items i
      left join public.menu_item_branches ib on ib.menu_item_id = i.id and ib.branch_id = v_branch.id
      left join public.menu_stockouts so
        on so.menu_item_id = i.id and so.branch_id = v_branch.id and so.service_day = v_day and so.cleared_at is null
      where i.tenant_id = v_branch.tenant_id and i.active and i.category_id is not null
        and coalesce(ib.available, true)
    ),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)
                                order by s.position, s.name), '[]'::jsonb)
      from public.kitchen_stations s where s.tenant_id = v_branch.tenant_id and s.active
    ),
    'modifier_groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'selection', g.selection, 'required', g.required,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'delta_cents', o.price_delta_cents)
                                    order by o.position, o.label), '[]'::jsonb)
          from public.menu_modifier_options o where o.group_id = g.id and o.active
        ),
        'category_ids', (
          select coalesce(jsonb_agg(l.category_id), '[]'::jsonb)
          from public.menu_modifier_links l where l.group_id = g.id and l.category_id is not null
        ),
        'item_ids', (
          select coalesce(jsonb_agg(l.menu_item_id), '[]'::jsonb)
          from public.menu_modifier_links l where l.group_id = g.id and l.menu_item_id is not null
        )
      ) order by g.position, g.name), '[]'::jsonb)
      from public.menu_modifier_groups g where g.tenant_id = v_branch.tenant_id and g.active
    ),
    -- Lo que más sale a esta hora (± 1 h) en esta sucursal, en las últimas cuatro semanas.
    'popular_now', (
      select coalesce(jsonb_agg(x.menu_item_id order by x.qty desc), '[]'::jsonb)
      from (
        select ti.menu_item_id, sum(ti.quantity) as qty
        from public.ticket_items ti
        join public.tickets t on t.id = ti.ticket_id
        join public.table_sessions s on s.id = t.session_id
        where s.branch_id = v_branch.id
          and not s.is_practice
          and t.status <> 'cancelled'
          and ti.cancelled_at is null
          and t.submitted_at > now() - interval '28 days'
          and abs(extract(hour from (t.submitted_at at time zone v_tz))::integer - v_hour) in (0, 1, 23)
        group by ti.menu_item_id
        order by sum(ti.quantity) desc
        limit 12
      ) x
    )
  );
end;
$$;

-- La cola de cocina de una sucursal: tandas que salieron y no están servidas, por orden de llegada.
create function public.pos_kitchen_queue(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'kitchen', 'cashier', 'waiter', 'host');

  return jsonb_build_object(
    'now', now(),
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name, 'color', v_branch.color),
    'settings', (
      select jsonb_build_object('kitchen_warn_minutes', s.kitchen_warn_minutes, 'kitchen_late_minutes', s.kitchen_late_minutes)
      from public.pos_settings s where s.tenant_id = v_branch.tenant_id
    ),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)
                                order by s.position, s.name), '[]'::jsonb)
      from public.kitchen_stations s where s.tenant_id = v_branch.tenant_id and s.active
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'session_id', t.session_id, 'status', t.status, 'course', t.course,
        'fired_at', t.fired_at, 'ready_at', t.ready_at, 'kitchen_seen_at', t.kitchen_seen_at,
        'is_practice', t.is_practice,
        'table_label', p.label, 'area', a.name, 'alias', s.alias, 'party_size', s.party_size,
        'kind', s.kind,
        'event', (
          select coalesce(se.name_override, tpl.name)
          from public.salon_reservations r
          join public.scheduled_events se on se.id = r.scheduled_event_id
          join public.scheduled_event_templates tpl on tpl.id = se.template_id
          where r.id = s.reservation_id
        ),
        'alerts', (select r.service_alerts from public.salon_reservations r where r.id = s.reservation_id),
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', ti.id, 'menu_item_id', ti.menu_item_id, 'name', mi.name, 'quantity', ti.quantity,
            'notes', ti.notes, 'modifiers', ti.modifiers, 'station_id', ti.station_id,
            'prep_status', ti.prep_status, 'started_at', ti.started_at, 'ready_at', ti.ready_at
          ) order by ti.created_at, ti.id), '[]'::jsonb)
          from public.ticket_items ti
          join public.menu_items mi on mi.id = ti.menu_item_id
          where ti.ticket_id = t.id and ti.cancelled_at is null
        )
      ) order by t.fired_at, t.id), '[]'::jsonb)
      from public.tickets t
      join public.table_sessions s on s.id = t.session_id
      left join public.physical_tables p on p.id = s.physical_table_id
      left join public.floor_plan_elements e on e.physical_table_id = p.id
      left join public.floor_plan_areas a on a.id = e.area_id
      where s.branch_id = v_branch.id
        and t.fired_at is not null
        and (
          t.status in ('accepted', 'preparing')
          -- Lo listo se queda un rato a la vista, por si hay que deshacer.
          or (t.status = 'ready' and t.ready_at > now() - interval '10 minutes')
        )
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Permisos de las funciones
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.pos_open_table(uuid, integer, uuid, uuid, text, boolean) from public, anon;
revoke all on function public.pos_send_order(uuid, jsonb, boolean, integer, text) from public, anon;
revoke all on function public.pos_fire_ticket(uuid) from public, anon;
revoke all on function public.pos_kitchen_advance(uuid, text, uuid[]) from public, anon;
revoke all on function public.pos_kitchen_seen(uuid[]) from public, anon;
revoke all on function public.pos_mark_served(uuid, uuid[], boolean) from public, anon;
revoke all on function public.pos_request_bill(uuid, boolean) from public, anon;
revoke all on function public.pos_cancel_item(uuid, text) from public, anon;
revoke all on function public.pos_move_table(uuid, uuid) from public, anon;
revoke all on function public.pos_update_table(uuid, integer, text, uuid, boolean) from public, anon;
revoke all on function public.pos_set_stockout(uuid, uuid, boolean) from public, anon;
revoke all on function public.pos_floor_snapshot(uuid) from public, anon;
revoke all on function public.pos_session_detail(uuid) from public, anon;
revoke all on function public.pos_menu(uuid) from public, anon;
revoke all on function public.pos_kitchen_queue(uuid) from public, anon;

grant execute on function public.pos_open_table(uuid, integer, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.pos_send_order(uuid, jsonb, boolean, integer, text) to authenticated;
grant execute on function public.pos_fire_ticket(uuid) to authenticated;
grant execute on function public.pos_kitchen_advance(uuid, text, uuid[]) to authenticated;
grant execute on function public.pos_kitchen_seen(uuid[]) to authenticated;
grant execute on function public.pos_mark_served(uuid, uuid[], boolean) to authenticated;
grant execute on function public.pos_request_bill(uuid, boolean) to authenticated;
grant execute on function public.pos_cancel_item(uuid, text) to authenticated;
grant execute on function public.pos_move_table(uuid, uuid) to authenticated;
grant execute on function public.pos_update_table(uuid, integer, text, uuid, boolean) to authenticated;
grant execute on function public.pos_set_stockout(uuid, uuid, boolean) to authenticated;
grant execute on function public.pos_floor_snapshot(uuid) to authenticated;
grant execute on function public.pos_session_detail(uuid) to authenticated;
grant execute on function public.pos_menu(uuid) to authenticated;
grant execute on function public.pos_kitchen_queue(uuid) to authenticated;

revoke all on function private.pos_service_day(uuid) from public, anon, authenticated;
revoke all on function private.pos_require_role(uuid, text[]) from public, anon, authenticated;
revoke all on function private.pos_poke(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.pos_item_station(uuid) from public, anon, authenticated;
revoke all on function private.pos_sync_ticket(uuid) from public, anon, authenticated;
revoke all on function private.pos_tg_log_item_price() from public, anon, authenticated;
revoke all on function private.pos_tg_log_branch_price() from public, anon, authenticated;

notify pgrst, 'reload schema';
