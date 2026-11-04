-- La puerta: validar con QR las entradas compradas online.
--
-- Pedido del 03/11/2026: los clientes piden un comprobante al pagar la seña. La
-- entrada pasa a tener un QR y quien recibe en la puerta lo escanea desde el salón.
--
-- La llegada no tiene columnas propias: es la de la reserva (status 'arrived',
-- arrived_at, arrived_by, actual_guests), la misma que marca el botón «Llegó»:
-- da igual por dónde se marque, hay una sola verdad y la comisión, el tablero y
-- las estadísticas la ven igual. Un grupo que llega de a partes va sumando en
-- actual_guests.
--
-- ticket_orders solo lo lee el dueño por RLS, y en la puerta están también
-- mozos, cajeros y la anfitriona: por eso funciones SECURITY DEFINER con el rol
-- chequeado adentro, igual que get_redemption_by_token. Devuelven lo justo para
-- la puerta: nunca el teléfono ni los datos de Mercado Pago.
--
-- El rastro va a audit_log desde las funciones, en la misma transacción: el
-- equipo no puede borrarlo y «Deshacer» se apoya en él (quién, cuándo, de cuánto
-- a cuánto).

-- ─── Las condiciones que aceptó cada compra ─────────────────
-- El comprobante las muestra: tienen que ser las de ese momento, no las que la
-- película tenga hoy. Sin copia (compras viejas) no se muestran.
alter table public.ticket_orders add column if not exists terms text;

comment on column public.ticket_orders.terms is
  'Las condiciones de la película al momento de comprar (foto). Null = compra anterior al 01/11/2026, sin condiciones.';

-- Las condiciones se cargaron el 01/11/2026 a las 21:37 UTC y no cambiaron desde
-- entonces (mismo texto en todas las películas): quienes compraron después son
-- los que las aceptaron.
update public.ticket_orders o
   set terms = e.terms
  from public.event_experiences e
 where e.id = o.experience_id
   and e.tenant_id = o.tenant_id
   and o.terms is null
   and e.terms is not null
   and o.created_at >= '2026-11-01 21:37:22+00';

create or replace function public.ticketing_create_order(p_tenant_id uuid, p_experience_id uuid, p_event_id uuid, p_party_size integer, p_option text, p_guest_name text, p_guest_phone text, p_marketing_opt_in boolean, p_client_ip text, p_meal_type public.meal_type)
returns public.ticket_orders
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_exp public.event_experiences;
  v_ev public.scheduled_events;
  v_tz text;
  v_hold integer;
  v_taken integer;
  v_held integer;
  v_left integer;
  v_unit bigint;
  v_full bigint;
  v_live_phone integer;
  v_live_ip integer;
  v_order public.ticket_orders;
begin
  select * into v_exp
    from public.event_experiences
   where id = p_experience_id and tenant_id = p_tenant_id;
  if v_exp.id is null or not v_exp.published then
    raise exception 'ticketing_experience_unavailable' using errcode = 'P0001';
  end if;

  -- Serializa las compras de la MISMA función: dos personas pidiendo los
  -- últimos lugares a la vez no pueden pasar las dos. NO KEY UPDATE (y no
  -- UPDATE) para no chocar con el FOR KEY SHARE que toma cada alta de reserva
  -- por la FK: el panel nunca queda esperando por una compra web.
  select * into v_ev
    from public.scheduled_events
   where id = p_event_id and tenant_id = p_tenant_id
   for no key update;
  if v_ev.id is null or v_ev.template_id <> v_exp.template_id or v_ev.private_group then
    raise exception 'ticketing_event_unavailable' using errcode = 'P0001';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  if (v_ev.event_date + v_ev.starts_at_local)
       <= (now() at time zone coalesce(v_tz, 'America/Argentina/Cordoba')) then
    raise exception 'ticketing_event_started' using errcode = 'P0001';
  end if;

  -- Entre el mínimo y el máximo de la película (Cine y degustación: de 2 en
  -- adelante).
  if p_party_size is null
     or p_party_size < greatest(v_exp.min_party_size, 1)
     or p_party_size > v_exp.max_party_size then
    raise exception 'ticketing_invalid_party_size' using errcode = 'P0001';
  end if;

  -- Lo que se cobra hoy por persona y el precio completo de la foto: todo
  -- online, el precio; con seña, el de efectivo si la película tiene uno. Hay
  -- películas que se reservan SOLO con seña (allow_full_payment = false).
  if p_option = 'full' then
    if not v_exp.allow_full_payment and v_exp.deposit_cents > 0 then
      raise exception 'ticketing_invalid_option' using errcode = 'P0001';
    end if;
    v_unit := v_exp.price_cents;
    v_full := v_exp.price_cents;
  elsif p_option = 'deposit' and v_exp.deposit_cents > 0 then
    v_unit := v_exp.deposit_cents;
    v_full := coalesce(v_exp.cash_price_cents, v_exp.price_cents);
  else
    raise exception 'ticketing_invalid_option' using errcode = 'P0001';
  end if;

  -- Un lugar guardado por persona y función: si el mismo WhatsApp vuelve a
  -- empezar (cambió la cantidad, tocó «Empezar de nuevo»), su pedido anterior
  -- suelta los lugares en vez de guardar el doble.
  update public.ticket_orders
     set hold_expires_at = now()
   where tenant_id = p_tenant_id
     and scheduled_event_id = p_event_id
     and guest_phone = p_guest_phone
     and status in ('pending', 'rejected')
     and hold_expires_at > now();

  -- Techo de lugares guardados a la vez, para que nadie vacíe la cartelera a
  -- fuerza de pedidos sin pagar: 3 por WhatsApp y 4 por IP (holgado para una
  -- IP compartida de celular) en todo el bar.
  select count(*) into v_live_phone
    from public.ticket_orders o
   where o.tenant_id = p_tenant_id
     and o.guest_phone = p_guest_phone
     and o.status in ('pending', 'rejected')
     and o.hold_expires_at > now();
  if v_live_phone >= 3 then
    raise exception 'ticketing_too_many_holds' using errcode = 'P0001';
  end if;
  if p_client_ip is not null and p_client_ip <> 'unknown' then
    select count(*) into v_live_ip
      from public.ticket_orders o
     where o.tenant_id = p_tenant_id
       and o.client_ip = left(p_client_ip, 64)
       and o.status in ('pending', 'rejected')
       and o.hold_expires_at > now();
    if v_live_ip >= 4 then
      raise exception 'ticketing_too_many_holds' using errcode = 'P0001';
    end if;
  end if;

  select s.taken, s.held into v_taken, v_held
    from public.ticketing_event_seats(p_tenant_id, array[p_event_id]) s;
  v_left := v_ev.capacity - coalesce(v_taken, 0) - coalesce(v_held, 0);
  if v_left < p_party_size then
    -- El detalle lleva cuántos quedan: la página lo dice («Quedan 3 lugares»).
    raise exception 'ticketing_not_enough_seats'
      using errcode = 'P0001', detail = greatest(v_left, 0)::text;
  end if;

  select s.hold_minutes into v_hold
    from public.ticketing_settings s
   where s.tenant_id = p_tenant_id;

  insert into public.ticket_orders (
    tenant_id, experience_id, scheduled_event_id,
    title, event_date, event_time, meal_type,
    party_size, payment_option, unit_price_cents, full_price_cents, total_cents,
    balance_cash_only,
    guest_name, guest_phone, marketing_opt_in, client_ip,
    status, hold_expires_at, terms
  ) values (
    p_tenant_id, v_exp.id, v_ev.id,
    v_exp.title, v_ev.event_date, v_ev.starts_at_local, p_meal_type,
    p_party_size, p_option, v_unit, v_full, v_unit * p_party_size,
    p_option = 'deposit' and v_exp.cash_price_cents is not null,
    btrim(p_guest_name), p_guest_phone, coalesce(p_marketing_opt_in, false), left(p_client_ip, 64),
    'pending', now() + make_interval(mins => coalesce(v_hold, 15)), v_exp.terms
  )
  returning * into v_order;

  return v_order;
end;
$function$;

-- Para «Deshacer» y para el panel: lo que pasó con una entrada, sin recorrer todo
-- el registro del bar.
create index if not exists audit_log_ticket_door_idx
  on public.audit_log (tenant_id, entity_id, created_at desc)
  where entity = 'ticket_order';

-- ─── Quién puede: los mismos que hoy marcan «Llegó» ─────────
create or replace function private.ticket_door_authorize(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_role public.tenant_role;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
end;
$$;

-- El día de servicio del bar: hasta las 5 AM sigue siendo «ayer» (mismo corte
-- que SERVICE_DAY_ROLLOVER_HOUR de lib/salon/operativo.ts).
create or replace function private.ticket_door_service_day(p_tenant_id uuid)
returns date
language sql
stable
security definer
set search_path to ''
as $$
  select ((now() at time zone coalesce(t.timezone, 'America/Argentina/Cordoba')) - interval '5 hours')::date
    from public.tenants t
   where t.id = p_tenant_id;
$$;

-- ─── Lo que ve quien recibe ─────────────────────────────────
create or replace function private.ticket_door_ticket(p_order public.ticket_orders)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_res public.salon_reservations;
  v_poster text;
  v_accent text;
  v_by text;
  v_tz text;
  v_inside int;
  v_expected int;
begin
  select coalesce(t.timezone, 'America/Argentina/Cordoba') into v_tz
    from public.tenants t
   where t.id = p_order.tenant_id;

  if p_order.reservation_id is not null then
    select r.* into v_res
      from public.salon_reservations r
     where r.id = p_order.reservation_id
       and r.tenant_id = p_order.tenant_id;
  end if;

  if p_order.experience_id is not null then
    select e.poster_url, e.accent_hex into v_poster, v_accent
      from public.event_experiences e
     where e.id = p_order.experience_id
       and e.tenant_id = p_order.tenant_id;
  end if;

  if v_res.arrived_by is not null then
    -- El nombre con el que el bar conoce a su gente. Nunca el email.
    select coalesce(
             (select m.display_name
                from public.reservation_managers m
               where m.tenant_id = p_order.tenant_id
                 and m.user_id = v_res.arrived_by
               limit 1),
             split_part(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), ' ', 1)
           )
      into v_by
      from auth.users u
     where u.id = v_res.arrived_by;
  end if;

  if v_res.scheduled_event_id is not null then
    -- La sala: cuántos entraron y cuántos se esperan. Un grupo a medio entrar
    -- sigue esperando a los que faltan (greatest), aunque actual_guests sea menor.
    select
      coalesce(sum(coalesce(r.actual_guests, r.estimated_guests))
        filter (where r.status in ('arrived', 'seated', 'closed')), 0)::int,
      coalesce(sum(greatest(coalesce(r.actual_guests, 0), r.estimated_guests))
        filter (where r.status not in ('cancelled', 'no_show')), 0)::int
      into v_inside, v_expected
      from public.salon_reservations r
     where r.tenant_id = p_order.tenant_id
       and r.scheduled_event_id = v_res.scheduled_event_id;
  end if;

  return jsonb_build_object(
    'order_id', p_order.id,
    'short_code', upper(left(p_order.id::text, 8)),
    'status', p_order.status,
    'title', p_order.title,
    'poster_url', v_poster,
    'accent_hex', v_accent,
    'guest_name', p_order.guest_name,
    'party_size', p_order.party_size,
    'payment_option', p_order.payment_option,
    'unit_price_cents', p_order.unit_price_cents,
    'full_price_cents', p_order.full_price_cents,
    'paid_cents', p_order.paid_cents,
    'balance_cash_only', p_order.balance_cash_only,
    'event_date', p_order.event_date,
    'event_time', to_char(p_order.event_time, 'HH24:MI'),
    'service_day', private.ticket_door_service_day(p_order.tenant_id),
    'reservation', case when v_res.id is null then null else jsonb_build_object(
      'id', v_res.id,
      'status', v_res.status,
      'date', v_res.reservation_date,
      'time', to_char(v_res.reservation_time_local, 'HH24:MI'),
      'estimated_guests', v_res.estimated_guests,
      'actual_guests', v_res.actual_guests,
      'arrived_at_label', to_char(v_res.arrived_at at time zone v_tz, 'HH24:MI'),
      'arrived_by_name', v_by
    ) end,
    'room', case when v_expected is null then null else jsonb_build_object(
      'inside', v_inside,
      'expected', v_expected
    ) end
  );
end;
$$;

-- ─── Escanear: mirar sin tocar nada ─────────────────────────
-- Por el id del pedido (el QR) o por el número impreso en la entrada (a mano).
-- Devuelve null si no es una entrada de ESTE bar.
create or replace function public.ticket_door_lookup(
  p_tenant_id uuid,
  p_order_id uuid default null,
  p_short_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_order public.ticket_orders;
begin
  perform private.ticket_door_authorize(p_tenant_id);

  if p_order_id is not null then
    select o.* into v_order
      from public.ticket_orders o
     where o.tenant_id = p_tenant_id
       and o.id = p_order_id;
  elsif p_short_code ~ '^[0-9a-fA-F]{8}$' then
    -- Dos pedidos con los mismos 8 primeros en un bar es casi imposible: si
    -- pasara, gana el pagado más nuevo.
    select o.* into v_order
      from public.ticket_orders o
     where o.tenant_id = p_tenant_id
       and o.id::text like lower(p_short_code) || '%'
     order by (o.status = 'approved') desc, o.created_at desc
     limit 1;
  end if;

  if v_order.id is null then
    return null;
  end if;
  return private.ticket_door_ticket(v_order);
end;
$$;

-- ─── Dejar pasar ────────────────────────────────────────────
-- Toda la validación otra vez acá: la pantalla pudo quedar vieja y dos celulares
-- pueden escanear la misma entrada a la vez. El FOR UPDATE ordena las llamadas,
-- pero no alcanza: de un grupo de 4, dos celulares que eligen 2 sumarían 4 con dos
-- personas adentro. Por eso `p_expected_inside`: cuántos había adentro cuando
-- quien recibe miró la pantalla. Si no coincide, no se suma (y un reintento por
-- haber perdido la señal tampoco cuenta dos veces).
create or replace function public.ticket_door_admit(
  p_tenant_id uuid,
  p_order_id uuid,
  p_guests integer,
  p_expected_inside integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.ticket_orders;
  v_res public.salon_reservations;
  v_total int;
  v_inside int;
begin
  perform private.ticket_door_authorize(p_tenant_id);

  select o.* into v_order
    from public.ticket_orders o
   where o.tenant_id = p_tenant_id
     and o.id = p_order_id
   for update;
  if v_order.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  if v_order.status = 'refunded' then
    raise exception 'ticket_refunded' using errcode = 'P0001';
  end if;
  if v_order.status <> 'approved' then
    raise exception 'ticket_not_paid' using errcode = 'P0001';
  end if;
  if v_order.reservation_id is null then
    raise exception 'ticket_no_reservation' using errcode = 'P0001';
  end if;

  select r.* into v_res
    from public.salon_reservations r
   where r.id = v_order.reservation_id
     and r.tenant_id = p_tenant_id
   for update;
  if v_res.id is null then
    raise exception 'ticket_no_reservation' using errcode = 'P0001';
  end if;
  if v_res.status = 'cancelled' then
    raise exception 'ticket_cancelled' using errcode = 'P0001';
  end if;

  v_total := greatest(v_order.party_size, v_res.estimated_guests);
  v_inside := case
    when v_res.status in ('arrived', 'seated', 'closed')
      then coalesce(v_res.actual_guests, v_res.estimated_guests)
    else 0
  end;
  if v_inside >= v_total then
    raise exception 'ticket_already_used' using errcode = 'P0001';
  end if;
  if v_res.reservation_date <> private.ticket_door_service_day(p_tenant_id) then
    raise exception 'ticket_other_day' using errcode = 'P0001';
  end if;
  if p_expected_inside is distinct from v_inside then
    raise exception 'ticket_stale' using errcode = 'P0001';
  end if;
  if p_guests is null or p_guests < 1 or p_guests > v_total - v_inside then
    raise exception 'ticket_invalid_guests' using errcode = 'P0001';
  end if;

  -- Por los mismos núcleos que el botón «Llegó»: comisiones y evento incluidos.
  if v_res.status in ('pending', 'no_show') then
    perform private.transition_reservation_status_core(v_res.id, 'arrived', p_guests);
  else
    perform private.update_reservation_actual_guests_core(v_res.id, v_inside + p_guests);
  end if;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (
    p_tenant_id, (select auth.uid()), 'ticket_order.door_admit', 'ticket_order', p_order_id,
    jsonb_build_object(
      'guests', p_guests,
      'inside_before', v_inside,
      'inside_after', v_inside + p_guests,
      'reservation_id', v_res.id
    )
  );

  return private.ticket_door_ticket(v_order);
end;
$$;

-- ─── Deshacer ───────────────────────────────────────────────
-- Para el toque de más: «Dejar pasar a 4» cuando llegaron 2. Borrar una llegada
-- permite esconder plata o hacer pasar a alguien con la entrada de otro, así que
-- va con cuatro candados, todos acá y no en la pantalla (decisión del 03/11/2026):
-- solo unos segundos, solo quien dejó pasar, una sola vez por entrada, y queda en
-- audit_log, que el equipo no puede tocar y los dueños ven en Ventas online. Pasado
-- eso, se corrige en Reservas.
create or replace function public.ticket_door_undo(
  p_tenant_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.ticket_orders;
  v_res public.salon_reservations;
  v_last public.audit_log;
  v_before int;
  v_after int;
  v_inside int;
begin
  perform private.ticket_door_authorize(p_tenant_id);

  select o.* into v_order
    from public.ticket_orders o
   where o.tenant_id = p_tenant_id
     and o.id = p_order_id
   for update;
  if v_order.id is null or v_order.reservation_id is null then
    raise exception 'ticket_undo_unavailable' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.audit_log a
     where a.tenant_id = p_tenant_id
       and a.entity = 'ticket_order'
       and a.entity_id = p_order_id
       and a.action = 'ticket_order.door_undo'
  ) then
    raise exception 'ticket_undo_unavailable' using errcode = 'P0001';
  end if;

  select a.* into v_last
    from public.audit_log a
   where a.tenant_id = p_tenant_id
     and a.entity = 'ticket_order'
     and a.entity_id = p_order_id
     and a.action = 'ticket_order.door_admit'
   order by a.created_at desc
   limit 1;
  if v_last.id is null then
    raise exception 'ticket_undo_unavailable' using errcode = 'P0001';
  end if;
  if v_last.user_id is distinct from (select auth.uid()) then
    raise exception 'ticket_undo_other_user' using errcode = 'P0001';
  end if;
  if v_last.created_at < now() - interval '30 seconds' then
    raise exception 'ticket_undo_expired' using errcode = 'P0001';
  end if;

  select r.* into v_res
    from public.salon_reservations r
   where r.id = v_order.reservation_id
     and r.tenant_id = p_tenant_id
   for update;

  v_before := (v_last.payload ->> 'inside_before')::int;
  v_after := (v_last.payload ->> 'inside_after')::int;
  v_inside := case
    when v_res.status in ('arrived', 'seated', 'closed')
      then coalesce(v_res.actual_guests, v_res.estimated_guests)
    else 0
  end;
  -- Si en el medio la sentaron o corrigieron el número, no se pisa lo que hicieron.
  if v_res.id is null or v_res.status <> 'arrived' or v_inside <> v_after then
    raise exception 'ticket_stale' using errcode = 'P0001';
  end if;

  if v_before = 0 then
    perform private.transition_reservation_status_core(v_res.id, 'pending', null);
    update public.salon_reservations
       set actual_guests = null,
           arrived_at = null,
           arrived_by = null
     where id = v_res.id
       and tenant_id = p_tenant_id;
    perform public.recalc_reservation_commission(v_res.id);
  else
    perform private.update_reservation_actual_guests_core(v_res.id, v_before);
  end if;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (
    p_tenant_id, (select auth.uid()), 'ticket_order.door_undo', 'ticket_order', p_order_id,
    jsonb_build_object(
      'from', v_after,
      'to', v_before,
      'reservation_id', v_res.id,
      'admit_log_id', v_last.id
    )
  );

  return private.ticket_door_ticket(v_order);
end;
$$;

-- ─── La sala de hoy: el cartel arriba del escáner ───────────
create or replace function public.ticket_door_today(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_day date;
  v_rows jsonb;
begin
  perform private.ticket_door_authorize(p_tenant_id);
  v_day := private.ticket_door_service_day(p_tenant_id);

  select coalesce(jsonb_agg(row_to_json(f) order by f.time), '[]'::jsonb)
    into v_rows
    from (
      select
        ev.id as event_id,
        e.title,
        to_char(ev.starts_at_local, 'HH24:MI') as time,
        coalesce((
          select sum(coalesce(r.actual_guests, r.estimated_guests))
            from public.salon_reservations r
           where r.tenant_id = p_tenant_id
             and r.scheduled_event_id = ev.id
             and r.status in ('arrived', 'seated', 'closed')
        ), 0)::int as inside,
        coalesce((
          select sum(greatest(coalesce(r.actual_guests, 0), r.estimated_guests))
            from public.salon_reservations r
           where r.tenant_id = p_tenant_id
             and r.scheduled_event_id = ev.id
             and r.status not in ('cancelled', 'no_show')
        ), 0)::int as expected
      from public.scheduled_events ev
      join public.event_experiences e
        on e.template_id = ev.template_id
       and e.tenant_id = ev.tenant_id
     where ev.tenant_id = p_tenant_id
       and ev.event_date = v_day
    ) f;

  return v_rows;
end;
$$;

-- ─── Permisos ───────────────────────────────────────────────
revoke all on function private.ticket_door_authorize(uuid) from public, anon, authenticated;
revoke all on function private.ticket_door_service_day(uuid) from public, anon, authenticated;
revoke all on function private.ticket_door_ticket(public.ticket_orders) from public, anon, authenticated;

revoke all on function public.ticket_door_lookup(uuid, uuid, text) from public, anon;
revoke all on function public.ticket_door_admit(uuid, uuid, integer, integer) from public, anon;
revoke all on function public.ticket_door_undo(uuid, uuid) from public, anon;
revoke all on function public.ticket_door_today(uuid) from public, anon;
grant execute on function public.ticket_door_lookup(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.ticket_door_admit(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.ticket_door_undo(uuid, uuid) to authenticated, service_role;
grant execute on function public.ticket_door_today(uuid) to authenticated, service_role;
