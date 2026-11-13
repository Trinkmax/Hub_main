-- Punto de venta, parte 4: práctica por sucursal, liberar una mesa, ventas por día y un candado para que
-- una mesa del punto de venta no se cierre por un camino que no conoce los cobros (docs/features/pos.md).
--
--   1. Modo práctica de la SUCURSAL. Lo prende un dueño y se apaga solo a las 5 de la mañana. Mientras
--      está prendido, cada mesa que se abre ahí es de práctica: se carga, sale en cocina con su cinta de
--      «Prueba» y se cobra, pero no entra en ninguna caja ni en ningún número, no suma puntos y no toca la
--      reserva. Antes la práctica era un dato que mandaba el celular; ahora la decide la base.
--   2. Liberar una mesa que se abrió por error (`pos_release_table`): solo si no tiene nada cargado ni
--      cobrado. No había manera de hacerlo desde el punto de venta.
--   3. Un candado al final de cada transacción (`table_sessions_pos_guard`): en un bar con el punto de
--      venta prendido, una mesa no pasa a «cobrada» sin su cuenta cerrada, ni a «abandonada» o «juntada»
--      con cobros hechos o con consumo sin cobrar. Las funciones viejas del servicio de mesa
--      (`mark_session_paid`, `mark_session_abandoned`, `merge_sessions`) no conocen los cobros: con esto,
--      si alguien las llama sobre una mesa del punto de venta, no pasa nada.
--   4. El cierre automático de la madrugada (`auto_abandon_stale_sessions`) ya no toca las mesas de un bar
--      con el punto de venta: una mesa que debe plata no desaparece sola. Sí levanta las mesas de práctica
--      que quedaron abiertas cuando la práctica terminó.
--   5. Los renglones de una tanda quedan en el orden en que el mozo los cargó (cada uno con su hora).
--   6. `pos_sales_days`: lo vendido día por día, para los dueños.
--
-- Qué toca de lo que ya existe: agrega una columna a `branches` (`practice_until`, vacía), un disparador
-- a `table_sessions` y redefine tres funciones (`pos_open_table`, `pos_send_order`,
-- `auto_abandon_stale_sessions`) con la misma firma y los mismos permisos. No borra nada.
--
-- Los cuerpos no llevan renglones de comentario a propósito: así su md5 es el mismo se aplique este
-- archivo tal cual o sin comentarios.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Modo práctica de la sucursal
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.branches add column practice_until timestamptz;
comment on column public.branches.practice_until is
  'Punto de venta: hasta cuándo la sucursal está en modo práctica. Vacío o pasado = no está. Lo pone pos_set_practice.';

-- Prender o apagar la práctica de una sucursal. Solo un dueño. Prendida dura hasta las 5 de la mañana que
-- viene (el fin del día de servicio). Al apagarla, las mesas de práctica que quedaron abiertas se levantan.
create function public.pos_set_practice(p_branch_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_zone text;
  v_until timestamptz;
  v_cleared integer := 0;
  r record;
begin
  select * into v_branch from public.branches b where b.id = p_branch_id for update;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner');

  if coalesce(p_on, false) then
    select coalesce(t.timezone, 'America/Argentina/Cordoba') into v_zone
      from public.tenants t where t.id = v_branch.tenant_id;
    v_until := ((((now() at time zone v_zone) - interval '5 hours')::date + 1) + time '05:00') at time zone v_zone;
  else
    for r in
      select s.id from public.table_sessions s
       where s.branch_id = p_branch_id and s.status = 'open' and s.is_practice
       for update
    loop
      update public.table_sessions
         set status = 'abandoned', abandoned_reason = 'practice_ended'
       where id = r.id;
      insert into public.table_session_events (session_id, type, created_by_user_id, payload)
      values (r.id, 'session_abandoned', (select auth.uid()),
              jsonb_build_object('source', 'pos', 'reason', 'practice_ended'));
      v_cleared := v_cleared + 1;
    end loop;
  end if;

  update public.branches set practice_until = v_until where id = p_branch_id;
  perform private.pos_poke(p_branch_id, 'floor', null);
  return jsonb_build_object('branch_id', p_branch_id, 'practice_until', v_until, 'cleared', v_cleared);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Abrir una mesa: la práctica la decide la sucursal
-- ─────────────────────────────────────────────────────────────────────────────
-- El cuerpo de producción con un cambio: la mesa es de práctica si la sucursal está en práctica en ese
-- momento. `p_practice` queda en la firma (lo siguen mandando los celulares con la versión anterior) pero
-- ya no decide nada.
create or replace function public.pos_open_table(
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
  v_role public.tenant_role;
begin
  if p_party_size is null or p_party_size < 1 or p_party_size > 100 then
    raise exception 'party_size_invalid' using errcode = '22023';
  end if;

  select * into v_table from public.physical_tables where id = p_table_id and active for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_table.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  v_practice := exists (
    select 1 from public.branches b
     where b.id = v_table.branch_id and b.practice_until is not null and b.practice_until > now()
  );

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
    if v_customer is null and exists (
      select 1 from public.customers c
       where c.id = v_res.customer_id and c.tenant_id = v_table.tenant_id and c.deleted_at is null
    ) then
      v_customer := v_res.customer_id;
    end if;
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
-- 3. Mandar una tanda: los renglones quedan en el orden en que se cargaron
-- ─────────────────────────────────────────────────────────────────────────────
-- El cuerpo de producción con un cambio: cada renglón se guarda con la hora del reloj en ese instante.
-- Antes todos nacían con la hora de la transacción y, a igual hora, el orden lo decidía el id.
create or replace function public.pos_send_order(
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

  if v_key is not null then
    select * into v_ticket from public.tickets where session_id = p_session_id and idempotency_key = v_key;
    if found then
      return jsonb_build_object('ticket_id', v_ticket.id, 'total_cents', v_ticket.total_cents,
                                'fired', v_ticket.fired_at is not null, 'duplicate', true);
    end if;
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
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
      ticket_id, menu_item_id, quantity, unit_price_cents, line_total_cents, notes, station_id, modifiers,
      created_at
    ) values (
      v_ticket.id, v_menu.id, v_qty, v_unit, v_unit * v_qty,
      nullif(left(btrim(coalesce(v_item ->> 'notes', '')), 200), ''),
      private.pos_item_station(v_menu.id), v_mods, clock_timestamp()
    );
  end loop;

  select * into v_ticket from public.tickets where id = v_ticket.id;
  perform private.pos_poke(v_session.branch_id, case when v_fire then 'kitchen' else 'floor' end, p_session_id);
  return jsonb_build_object('ticket_id', v_ticket.id, 'total_cents', v_ticket.total_cents,
                            'fired', v_fire, 'duplicate', false);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Liberar una mesa abierta por error
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo una mesa sin nada vivo cargado y sin cobros. Si tiene consumo, primero se da de baja (con el
-- circuito de siempre) o se cobra. Dos toques seguidos devuelven lo mismo.
create function public.pos_release_table(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
begin
  select * into v_session from public.table_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');

  if v_session.status = 'abandoned' then
    return jsonb_build_object('session_id', p_session_id, 'released', true, 'duplicate', true);
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.pos_payments p where p.session_id = p_session_id and p.status = 'ok'
  ) then
    raise exception 'table_has_payments' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.tickets t
      join public.ticket_items ti on ti.ticket_id = t.id
     where t.session_id = p_session_id and t.status <> 'cancelled' and ti.cancelled_at is null
  ) then
    raise exception 'table_has_consumption' using errcode = '55000';
  end if;

  update public.table_sessions
     set status = 'abandoned', abandoned_reason = 'released'
   where id = p_session_id;
  update public.pos_approvals a
     set status = 'cancelled', decided_at = now(), decision_note = 'La mesa se liberó'
   where a.session_id = p_session_id and a.status = 'pending';
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (p_session_id, 'session_abandoned', (select auth.uid()),
          jsonb_build_object('source', 'pos', 'reason', 'released'));

  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('session_id', p_session_id, 'released', true, 'duplicate', false);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Una mesa del punto de venta no se cierra por un camino que no conoce los cobros
-- ─────────────────────────────────────────────────────────────────────────────
-- Corre al final de la transacción (cuando ya está todo escrito) cada vez que una mesa cambia de estado:
--   · con cobros hechos no puede quedar «abandonada» ni «juntada», en ningún bar;
--   · en un bar con el punto de venta prendido, «cobrada» pide su cuenta cerrada (`pos_closed_bills`) y
--     «abandonada» o «juntada» piden que no quede consumo sin cobrar.
-- Las mesas de práctica no entran: no son plata de verdad.
-- Las funciones del punto de venta cumplen todo esto solas; las viejas, sobre una mesa del punto de venta,
-- chocan acá y no dejan nada escrito.
create function private.pos_tg_session_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pos boolean;
begin
  if new.status = old.status or new.status = 'open' or new.is_practice then
    return null;
  end if;

  if new.status in ('abandoned', 'merged') and exists (
    select 1 from public.pos_payments p where p.session_id = new.id and p.status = 'ok'
  ) then
    raise exception 'pos_session_has_payments' using errcode = '55000';
  end if;

  select coalesce(t.feature_flags ->> 'pos', 'false') = 'true' into v_pos
    from public.tenants t where t.id = new.tenant_id;
  if not coalesce(v_pos, false) then
    return null;
  end if;

  if new.status = 'paid' and not exists (
    select 1 from public.pos_closed_bills cb where cb.session_id = new.id
  ) then
    raise exception 'pos_session_needs_bill' using errcode = '55000';
  end if;
  if new.status in ('abandoned', 'merged') and exists (
    select 1
      from public.tickets t
      join public.ticket_items ti on ti.ticket_id = t.id
     where t.session_id = new.id and t.status <> 'cancelled' and ti.cancelled_at is null
  ) then
    raise exception 'pos_session_has_consumption' using errcode = '55000';
  end if;
  return null;
end;
$$;

create constraint trigger table_sessions_pos_guard
  after update of status on public.table_sessions
  deferrable initially deferred
  for each row
  execute function private.pos_tg_session_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El cierre automático de la madrugada
-- ─────────────────────────────────────────────────────────────────────────────
-- Igual que antes para los bares sin punto de venta. En los que lo tienen prendido no toca las mesas de
-- verdad (una mesa que debe plata la cierra una persona); sí levanta las de práctica que quedaron
-- abiertas cuando la práctica de su sucursal ya terminó.
create or replace function public.auto_abandon_stale_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
  v_threshold timestamptz;
begin
  for r in
    select ts.id, ts.tenant_id, t.session_auto_abandon_hours,
           coalesce(max(sg.last_activity_at), ts.opened_at) as last_activity
    from public.table_sessions ts
    join public.tenants t on t.id = ts.tenant_id
    left join public.session_guests sg on sg.session_id = ts.id
    where ts.status = 'open'
      and coalesce(t.feature_flags ->> 'pos', 'false') <> 'true'
    group by ts.id, ts.tenant_id, t.session_auto_abandon_hours, ts.opened_at
  loop
    v_threshold := now() - (r.session_auto_abandon_hours || ' hours')::interval;
    if r.last_activity < v_threshold then
      update public.table_sessions
        set status = 'abandoned',
            abandoned_reason = 'auto_stale',
            updated_at = now()
        where id = r.id;
      insert into public.table_session_events (session_id, type, payload)
      values (
        r.id,
        'session_abandoned',
        jsonb_build_object('reason', 'auto_stale', 'last_activity', r.last_activity)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  for r in
    select ts.id
      from public.table_sessions ts
      join public.branches b on b.id = ts.branch_id
     where ts.status = 'open' and ts.is_practice
       and (b.practice_until is null or b.practice_until <= now())
  loop
    update public.table_sessions
      set status = 'abandoned',
          abandoned_reason = 'practice_ended',
          updated_at = now()
      where id = r.id;
    insert into public.table_session_events (session_id, type, payload)
    values (r.id, 'session_abandoned', jsonb_build_object('source', 'pos', 'reason', 'practice_ended'));
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('abandoned_count', v_count);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Lo vendido, día por día
-- ─────────────────────────────────────────────────────────────────────────────
-- Para los dueños. Un día es su ventana de servicio (de 5 a 5, hora del bar): cuenta lo que se cobró y
-- las mesas que se cerraron adentro. Mismas reglas que el resumen de la caja: la venta es lo que bajó de
-- las cuentas, el recargo y la propina van aparte, y ni lo anulado ni lo de práctica cuentan.
-- `p_branch_id` vacío = todas las sucursales del bar. Hasta 400 días por pedido.
create function public.pos_sales_days(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_since timestamptz;
  v_until timestamptz;
begin
  perform private.pos_require_role(p_tenant_id, 'owner');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'range_invalid' using errcode = '22023';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = p_tenant_id
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  select coalesce(t.timezone, 'America/Argentina/Cordoba') into v_zone
    from public.tenants t where t.id = p_tenant_id;
  v_since := (p_from + time '05:00') at time zone v_zone;
  v_until := ((p_to + 1) + time '05:00') at time zone v_zone;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'sales_cents', coalesce(pay.sales, 0),
        'surcharge_cents', coalesce(pay.surcharge, 0),
        'tip_cents', coalesce(pay.tips, 0),
        'payments', coalesce(pay.n, 0),
        'by_method', coalesce(pay.by_method, '{}'::jsonb),
        'tables', coalesce(bill.n, 0),
        'people', coalesce(bill.people, 0),
        'consumption_cents', coalesce(bill.consumption, 0),
        'discount_cents', coalesce(bill.discounts, 0),
        'deposit_cents', coalesce(bill.deposits, 0)
      ) order by d.day), '[]'::jsonb)
      from (
        select coalesce(x.day, y.day) as day
          from (
            select distinct ((p.created_at at time zone v_zone) - interval '5 hours')::date as day
              from public.pos_payments p
             where p.tenant_id = p_tenant_id and p.status = 'ok' and not p.is_practice
               and (p_branch_id is null or p.branch_id = p_branch_id)
               and p.created_at >= v_since and p.created_at < v_until
          ) x
          full join (
            select distinct ((cb.closed_at at time zone v_zone) - interval '5 hours')::date as day
              from public.pos_closed_bills cb
             where cb.tenant_id = p_tenant_id and not cb.is_practice
               and (p_branch_id is null or cb.branch_id = p_branch_id)
               and cb.closed_at >= v_since and cb.closed_at < v_until
          ) y on y.day = x.day
      ) d
      left join lateral (
        select sum(m.amount)::bigint as sales, sum(m.surcharge)::bigint as surcharge,
               sum(m.tips)::bigint as tips, sum(m.n)::integer as n,
               jsonb_object_agg(m.method, m.amount + m.surcharge) as by_method
          from (
            select p.method, sum(p.amount_cents)::bigint as amount, sum(p.surcharge_cents)::bigint as surcharge,
                   sum(p.tip_cents)::bigint as tips, count(*)::integer as n
              from public.pos_payments p
             where p.tenant_id = p_tenant_id and p.status = 'ok' and not p.is_practice
               and (p_branch_id is null or p.branch_id = p_branch_id)
               and p.created_at >= v_since and p.created_at < v_until
               and ((p.created_at at time zone v_zone) - interval '5 hours')::date = d.day
             group by p.method
          ) m
      ) pay on true
      left join lateral (
        select count(*)::integer as n,
               coalesce(sum(coalesce(cb.party_size, 0)), 0)::integer as people,
               coalesce(sum(cb.subtotal_cents - cb.discount_cents), 0)::bigint as consumption,
               coalesce(sum(cb.discount_cents), 0)::bigint as discounts,
               coalesce(sum(cb.deposit_cents), 0)::bigint as deposits
          from public.pos_closed_bills cb
         where cb.tenant_id = p_tenant_id and not cb.is_practice
           and (p_branch_id is null or cb.branch_id = p_branch_id)
           and cb.closed_at >= v_since and cb.closed_at < v_until
           and ((cb.closed_at at time zone v_zone) - interval '5 hours')::date = d.day
      ) bill on true
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.pos_set_practice(uuid, boolean) from public, anon;
revoke all on function public.pos_release_table(uuid) from public, anon;
revoke all on function public.pos_sales_days(uuid, date, date, uuid) from public, anon;
grant execute on function public.pos_set_practice(uuid, boolean) to authenticated;
grant execute on function public.pos_release_table(uuid) to authenticated;
grant execute on function public.pos_sales_days(uuid, date, date, uuid) to authenticated;
revoke all on function private.pos_tg_session_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
