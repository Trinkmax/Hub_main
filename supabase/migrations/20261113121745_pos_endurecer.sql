-- Punto de venta, parte 3: endurecer (docs/features/pos.md).
--
-- Una auditoría de la rama encontró huecos que solo se cierran en la base. Va después de las tres
-- migraciones de cobro y caja (`pos_cobro_*`: usa sus tablas y sus ayudas) y no agrega tablas ni pantallas:
-- aprieta lo que ya hay.
--   1. `pos_cancel_item` daba de baja un renglón «en cola» sin mirar si la mesa seguía abierta, si había
--      pedido la cuenta, si ya tenía cobros o si ese renglón estaba cobrado por producto. Tres cervezas, se
--      cobran dos, se da de baja la tercera: la cuenta queda en cero y la mesa se cierra. Ahora tiene las
--      mismas reglas que `pos_request_void`, y bloquea en el mismo orden que cocina.
--   2. Con el punto de venta apagado en un bar, cualquiera de su salón podía llamar las funciones `pos_*`
--      directo. Ahora todas miran el interruptor del bar.
--   3. Una mesa «de práctica» se cobra sin turno y queda fuera de la caja, y la podía abrir cualquiera del
--      salón. Hasta que la práctica sea de la sucursal, solo vale si la abre un dueño.
--   4. Una tanda que entró pero cuya respuesta se perdió volvía como «la mesa no está abierta» si en el
--      medio la mesa se cerraba. Ahora primero se busca la clave del pedido.
--   5. `menu_stockouts` y `menu_price_changes` tenían alta, cambio y baja para `authenticated` por los
--      permisos por defecto (lo único que lo frenaba era que no hay política de escritura).
--   6. Una reserva cuyo socio fue borrado no se podía sentar. Ahora se sienta sin socio.
--   7. Cambiar el socio de una mesa no dejaba rastro, y de ese socio salen los puntos al cobrar.
--   8. La pantalla de cocina mostraba para siempre la tanda sin avanzar de una mesa ya cerrada.
--
-- Qué toca de lo que ya existe: redefine seis funciones (misma firma, mismos permisos, el cuerpo que hoy
-- está en producción con los cambios de arriba) y saca tres permisos de dos tablas. No cambia ninguna
-- tabla, no borra nada.
--   · `private.pos_require_role`, `public.pos_open_table`, `public.pos_send_order`,
--     `public.pos_update_table`, `public.pos_kitchen_queue`, `public.pos_cancel_item`.
-- Las funciones viejas del servicio de mesa (`mark_session_paid`, `cancel_ticket_item`, `merge_sessions`,
-- el cierre automático) quedan para otra migración.
--
-- Los cuerpos no llevan renglones de comentario a propósito: así su md5 es el mismo se aplique este
-- archivo tal cual o sin comentarios. Lo que cambia y por qué está arriba de cada función.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El interruptor del bar
-- ─────────────────────────────────────────────────────────────────────────────
-- Todas las funciones `pos_*` pasan por acá. Además del rol, ahora exige que el bar tenga el punto de
-- venta prendido (`tenants.feature_flags ->> 'pos' = 'true'`); si no, `pos_disabled`. Primero el rol: quien
-- no trabaja en el bar sigue recibiendo `forbidden` y no se entera de cómo está el interruptor. Igual que
-- en la aplicación (`requireFeature`, `authorize`), un superadmin de la plataforma que además trabaja en el
-- bar puede entrar con el interruptor apagado: es quien lo prende y lo prueba antes.
create or replace function private.pos_require_role(p_tenant_id uuid, variadic p_roles text[])
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
  if not exists (
    select 1 from public.tenants t
     where t.id = p_tenant_id and t.feature_flags ->> 'pos' = 'true'
  ) then
    if not public.is_platform_admin() then
      raise exception 'pos_disabled' using errcode = '0A000';
    end if;
  end if;
  return v_role;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Abrir una mesa
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos cambios sobre el cuerpo de producción:
--   · `p_practice` solo vale si quien abre es dueño; para el resto se ignora, sin error (la mesa se abre
--     de verdad). Una mesa de práctica no entra a ninguna caja: no puede prenderla cualquiera.
--   · el socio de la reserva se toma solo si sigue existiendo en el bar. Antes, una reserva cuyo socio
--     fue borrado contestaba `customer_not_found` y no se podía sentar; ahora se sienta sin socio. Un
--     socio pasado a mano que no existe sigue dando `customer_not_found`.
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
  v_practice := v_practice and v_role = 'owner';

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
-- 3. Mandar una tanda
-- ─────────────────────────────────────────────────────────────────────────────
-- Mismo cuerpo, con dos bloques cambiados de orden: primero se busca la clave del pedido y recién
-- después se mira si la mesa está abierta. Si la tanda ya había entrado se devuelve esa misma con
-- `duplicate: true` aunque la mesa se haya cerrado en el medio (como ya hace `pos_pay` con un cobro).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cambiar el socio de una mesa deja rastro
-- ─────────────────────────────────────────────────────────────────────────────
-- Al cuerpo de producción se le suma un evento en `table_session_events` cada vez que el socio de la mesa
-- cambia (se pone, se reemplaza o se quita), con quién fue y de quién a quién: de ese socio salen los
-- puntos al cobrar. Va con el tipo `guest_registered` (un cliente quedó asociado a la mesa) y
-- `payload.change = 'customer'`: un tipo propio pide agregar un valor al enum, y un valor nuevo no se
-- puede usar en la misma transacción que lo crea.
create or replace function public.pos_update_table(
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
  v_customer uuid;
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

  v_customer := case
    when coalesce(p_clear_customer, false) then null
    else coalesce(p_customer_id, v_session.customer_id)
  end;
  if v_customer is distinct from v_session.customer_id then
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
    values (p_session_id, 'guest_registered', (select auth.uid()),
            jsonb_build_object('source', 'pos', 'change', 'customer',
                               'from', v_session.customer_id, 'to', v_customer));
  end if;

  if p_party_size is not null and p_party_size is distinct from v_session.party_size then
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
    values (p_session_id, 'party_size_changed', (select auth.uid()),
            jsonb_build_object('from', v_session.party_size, 'to', p_party_size));
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La cola de cocina no arrastra mesas cerradas
-- ─────────────────────────────────────────────────────────────────────────────
-- Al cuerpo de producción se le suma una condición: una tanda sale si su mesa sigue abierta, o si la
-- mesa es del día de servicio en curso (la que pagó por adelantado y espera su comida tiene que seguir
-- saliendo). La tanda que nadie avanzó de una mesa cerrada o abandonada ya no queda colgada al día
-- siguiente.
create or replace function public.pos_kitchen_queue(p_branch_id uuid)
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
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'kitchen', 'cashier', 'waiter', 'host');
  v_day := private.pos_service_day(v_branch.tenant_id);

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
        and (s.status = 'open' or s.service_day = v_day)
        and t.fired_at is not null
        and (
          t.status in ('accepted', 'preparing')
          or (t.status = 'ready' and t.ready_at > now() - interval '10 minutes')
        )
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Dar de baja un renglón: las mismas reglas por las dos puertas
-- ─────────────────────────────────────────────────────────────────────────────
-- Cuerpo nuevo (el de producción solo miraba si cocina había empezado). Mismas reglas que
-- `pos_request_void`, con la única diferencia de que esta función nunca deja un pedido: si hace falta
-- el OK, contesta `needs_approval` y la pantalla lo pide por `pos_request_void`.
--   · la mesa tiene que estar abierta (`session_not_open`);
--   · un renglón ya cobrado por producto no se da de baja (`item_already_paid`);
--   · «cargado por error», sin motivo y sin OK, vale mientras cocina no lo empezó Y la mesa no pidió la
--     cuenta ni tiene cobros; después, lleva motivo y lo hace quien puede aprobar (o cualquiera del salón
--     si el bar no pide aprobación para las bajas);
--   · bloquea mesa → tanda → renglón, el mismo orden que `pos_kitchen_advance` y `pos_request_void`
--     (antes tomaba el renglón y después la tanda: dos toques a la vez se podían trabar).
create or replace function public.pos_cancel_item(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ticket_items%rowtype;
  v_ticket public.tickets%rowtype;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_settings public.pos_settings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_free boolean;
begin
  select * into v_item from public.ticket_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  select * into v_ticket from public.tickets where id = v_item.ticket_id;
  v_role := private.pos_require_role(v_ticket.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions where id = v_ticket.session_id for update;
  select * into v_ticket from public.tickets where id = v_ticket.id for update;
  if v_ticket.session_id <> v_session.id then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  select * into v_item from public.ticket_items where id = p_item_id for update;
  if v_item.cancelled_at is not null then
    return jsonb_build_object('item_id', p_item_id, 'cancelled', true, 'duplicate', true);
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  if private.pos_paid_units(v_session.id, p_item_id) > 0 then
    raise exception 'item_already_paid' using errcode = '55000';
  end if;
  v_free := v_item.prep_status = 'queued' and v_session.bill_requested_at is null
            and not exists (
              select 1 from public.pos_payments p where p.session_id = v_session.id and p.status = 'ok'
            );
  v_settings := private.pos_settings_for(v_ticket.tenant_id);
  if not (v_free or v_role = 'owner' or v_role::text = any (v_settings.approver_roles)
          or not v_settings.void_needs_approval) then
    raise exception 'needs_approval' using errcode = '42501';
  end if;
  if v_reason is null and not v_free then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  perform private.pos_cancel_item_core(p_item_id, v_reason, (select auth.uid()));
  perform private.pos_poke(v_session.branch_id, 'kitchen', v_ticket.session_id);
  return jsonb_build_object('item_id', p_item_id, 'cancelled', true, 'duplicate', false);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Agotados e historial de precios: solo lectura de verdad
-- ─────────────────────────────────────────────────────────────────────────────
-- La parte 1 les dio `select`, pero las tablas nacen con alta, cambio y baja para `authenticated` por los
-- permisos por defecto. Se escriben solo por `pos_set_stockout` y por los disparadores de precio.
revoke insert, update, delete on public.menu_stockouts, public.menu_price_changes from authenticated;

notify pgrst, 'reload schema';
