-- ============================================================
-- Entradas online — cupo, guardar el lugar y confirmar el pago
-- ============================================================
-- Cuatro funciones, todas SOLO para service_role (las llama el server: la
-- página pública, la compra y el webhook de Mercado Pago). Ninguna se expone
-- a `anon` ni a `authenticated`.
--
--   · ticketing_event_seats   — cuántos lugares tiene, ocupa y guarda cada
--                               función. La MISMA cuenta para la cartelera y
--                               para la compra: la página nunca ofrece un
--                               lugar que la compra después niega.
--   · ticketing_create_order  — guarda el lugar (pedido «pending» con hold)
--                               si todavía entra. Atómica por función.
--   · ticketing_online_manager— el gestor de las reservas online («Venta
--                               online», sin comisión: decisión de los dueños
--                               del 26/10/2026). Lo crea la primera vez.
--   · ticketing_settle_order  — aplica lo que dice Mercado Pago. Si el pago se
--                               aprobó, crea la reserva (una sola vez, aunque
--                               lleguen el webhook y la vuelta del cliente a la
--                               vez).
--
-- LA CUENTA DE LUGARES (igual que el cupo del calendario, R4 de docs/reservas.md):
--   ocupados = Σ coalesce(actual_guests, estimated_guests) de las reservas de
--              la función que no están canceladas ni «no vino»;
--   guardados = Σ party_size de los pedidos pending/rejected con el hold vivo
--              (un rechazo deja reintentar con otra tarjeta sin perder el lugar);
--   quedan = cupo − ocupados − guardados.
-- ============================================================

create or replace function public.ticketing_event_seats(p_tenant_id uuid, p_event_ids uuid[])
returns table (scheduled_event_id uuid, capacity integer, taken integer, held integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    se.id,
    se.capacity,
    coalesce((
      select sum(coalesce(r.actual_guests, r.estimated_guests))::integer
        from public.salon_reservations r
       where r.scheduled_event_id = se.id
         and r.status not in ('cancelled', 'no_show')
    ), 0),
    coalesce((
      select sum(o.party_size)::integer
        from public.ticket_orders o
       where o.scheduled_event_id = se.id
         and o.status in ('pending', 'rejected')
         and o.hold_expires_at > now()
    ), 0)
  from public.scheduled_events se
  where se.tenant_id = p_tenant_id
    and se.id = any (p_event_ids)
$$;

revoke all on function public.ticketing_event_seats(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.ticketing_event_seats(uuid, uuid[]) to service_role;

-- ──────────────────────────────────────────────
-- $10.000 — para el comentario que lee el staff en la reserva.
-- ──────────────────────────────────────────────

create or replace function public.ticketing_format_ars(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  -- En to_char la coma es literal (no depende del locale): después se cambia
  -- por el punto de miles de es-AR.
  select '$' || replace(to_char(round(coalesce(p_cents, 0) / 100.0), 'FM999,999,999,990'), ',', '.')
$$;

revoke all on function public.ticketing_format_ars(bigint) from public, anon, authenticated;
grant execute on function public.ticketing_format_ars(bigint) to service_role;

-- ──────────────────────────────────────────────
-- Guardar el lugar
-- ──────────────────────────────────────────────

create or replace function public.ticketing_create_order(
  p_tenant_id uuid,
  p_experience_id uuid,
  p_event_id uuid,
  p_party_size integer,
  p_option text,
  p_guest_name text,
  p_guest_phone text,
  p_marketing_opt_in boolean,
  p_client_ip text,
  p_meal_type public.meal_type
)
returns public.ticket_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp public.event_experiences;
  v_ev public.scheduled_events;
  v_tz text;
  v_hold integer;
  v_taken integer;
  v_held integer;
  v_left integer;
  v_unit bigint;
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

  if p_party_size is null or p_party_size < 1 or p_party_size > v_exp.max_party_size then
    raise exception 'ticketing_invalid_party_size' using errcode = 'P0001';
  end if;

  if p_option = 'full' then
    v_unit := v_exp.price_cents;
  elsif p_option = 'deposit' and v_exp.deposit_cents > 0 then
    v_unit := v_exp.deposit_cents;
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
    guest_name, guest_phone, marketing_opt_in, client_ip,
    status, hold_expires_at
  ) values (
    p_tenant_id, v_exp.id, v_ev.id,
    v_exp.title, v_ev.event_date, v_ev.starts_at_local, p_meal_type,
    p_party_size, p_option, v_unit, v_exp.price_cents, v_unit * p_party_size,
    btrim(p_guest_name), p_guest_phone, coalesce(p_marketing_opt_in, false), left(p_client_ip, 64),
    'pending', now() + make_interval(mins => coalesce(v_hold, 15))
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.ticketing_create_order(
  uuid, uuid, uuid, integer, text, text, text, boolean, text, public.meal_type
) from public, anon, authenticated;
grant execute on function public.ticketing_create_order(
  uuid, uuid, uuid, integer, text, text, text, boolean, text, public.meal_type
) to service_role;

-- ──────────────────────────────────────────────
-- El gestor de las reservas online
-- ──────────────────────────────────────────────

create or replace function public.ticketing_online_manager(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager uuid;
begin
  select s.online_manager_id into v_manager
    from public.ticketing_settings s
   where s.tenant_id = p_tenant_id;
  if v_manager is not null then
    return v_manager;
  end if;

  -- Sin cuenta del equipo (user_id null) y sin comisión. Si ya existe uno con
  -- ese nombre se reusa tal cual (el update no cambia nada: es para que el
  -- RETURNING devuelva el id).
  insert into public.reservation_managers (tenant_id, display_name, commission_eligible, active, notes)
  values (
    p_tenant_id, 'Venta online', false, true,
    'Reservas pagadas por la web con Mercado Pago. Se crean solas y no cobran comisión.'
  )
  on conflict (tenant_id, display_name)
    do update set display_name = excluded.display_name
  returning id into v_manager;

  insert into public.ticketing_settings (tenant_id, online_manager_id)
  values (p_tenant_id, v_manager)
  on conflict (tenant_id)
    do update set online_manager_id = excluded.online_manager_id;

  return v_manager;
end;
$$;

revoke all on function public.ticketing_online_manager(uuid) from public, anon, authenticated;
grant execute on function public.ticketing_online_manager(uuid) to service_role;

-- ──────────────────────────────────────────────
-- Aplicar lo que dice Mercado Pago
-- ──────────────────────────────────────────────
-- El server SIEMPRE le pregunta el estado del pago a Mercado Pago con el token
-- del bar antes de llamar acá: los parámetros son lo que respondió la API, no
-- lo que trajo un webhook. Devuelve un jsonb con el estado final y si esta
-- llamada fue la que aprobó (para auditar una sola vez).

create or replace function public.ticketing_settle_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_id text,
  p_mp_status text,
  p_mp_status_detail text,
  p_payment_type text,
  p_paid_cents bigint,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.ticket_orders;
  v_ev public.scheduled_events;
  v_customer uuid;
  v_first text;
  v_last text;
  v_manager uuid;
  v_taken integer;
  v_attention text;
  v_reservation uuid;
  v_balance bigint;
  v_comment text;
begin
  -- El lock del pedido es lo que hace que el webhook y la vuelta del cliente
  -- no creen dos reservas: el segundo espera y encuentra «approved».
  select * into v_order
    from public.ticket_orders
   where id = p_order_id and tenant_id = p_tenant_id
   for update;
  if v_order.id is null then
    raise exception 'ticketing_order_not_found' using errcode = 'P0001';
  end if;

  -- ── Aprobado ────────────────────────────────
  if p_mp_status = 'approved' then
    if v_order.status in ('approved', 'refunded') then
      -- Ya estaba. Un pago aprobado DISTINTO para el mismo pedido es un cobro
      -- doble: no se duplica la reserva, se marca para que lo mire una persona.
      if v_order.status = 'approved' and v_order.mp_payment_id is distinct from p_payment_id then
        -- Se queda la marca que ya hubiera (un «cargá la reserva a mano» de
        -- event_missing pesa más); el cobro doble igual queda en audit_log.
        update public.ticket_orders
           set attention = coalesce(attention, 'duplicate_payment')
         where id = v_order.id;
        return jsonb_build_object(
          'order_id', v_order.id, 'status', v_order.status,
          'reservation_id', v_order.reservation_id,
          'newly_approved', false,
          'attention', coalesce(v_order.attention, 'duplicate_payment'),
          'duplicate_payment_id', p_payment_id
        );
      end if;
      return jsonb_build_object(
        'order_id', v_order.id, 'status', v_order.status,
        'reservation_id', v_order.reservation_id,
        'newly_approved', false, 'attention', v_order.attention
      );
    end if;

    if p_paid_cents is null or p_paid_cents < v_order.total_cents then
      v_attention := 'amount_mismatch';
    end if;

    -- El cliente, por teléfono: mismo criterio que el alta manual de reservas
    -- (lo reusa si existe, si no lo crea como adquirido por reserva).
    select c.id into v_customer
      from public.customers c
     where c.tenant_id = p_tenant_id
       and c.phone = v_order.guest_phone
       and c.deleted_at is null
     limit 1;

    if v_customer is null then
      v_first := split_part(btrim(v_order.guest_name), ' ', 1);
      v_last := nullif(btrim(substr(btrim(v_order.guest_name), length(v_first) + 1)), '');
      insert into public.customers (
        tenant_id, phone, first_name, last_name, source, acquisition_channel
      ) values (
        p_tenant_id, v_order.guest_phone, v_first, coalesce(v_last, '—'), 'manual', 'reservation'
      )
      on conflict (tenant_id, phone) where deleted_at is null do nothing
      returning id into v_customer;

      if v_customer is null then
        select c.id into v_customer
          from public.customers c
         where c.tenant_id = p_tenant_id
           and c.phone = v_order.guest_phone
           and c.deleted_at is null
         limit 1;
      end if;
    else
      update public.customers
         set acquisition_channel = 'reservation'
       where id = v_customer
         and acquisition_channel <> 'reservation';
    end if;

    -- Opt-in solo si lo tildó. Si ya estaba suscripto no se toca; si se había
    -- dado de baja y vuelve a aceptar, queda ESTE consentimiento (fecha e IP de
    -- ahora), igual que el alta del club.
    if v_order.marketing_opt_in and v_customer is not null then
      update public.customers
         set opt_in_marketing = true,
             opt_in_at = now(),
             opt_in_ip = v_order.client_ip
       where id = v_customer
         and not opt_in_marketing;
    end if;

    if v_order.scheduled_event_id is not null then
      select * into v_ev
        from public.scheduled_events
       where id = v_order.scheduled_event_id
       for no key update;
    end if;

    if v_ev.id is null then
      -- Pagó pero la fecha ya no existe: sin evento no hay dónde sentarlo.
      -- Queda aprobado y marcado; la reserva la carga una persona.
      v_attention := coalesce(v_attention, 'event_missing');
    else
      select coalesce(sum(coalesce(r.actual_guests, r.estimated_guests)), 0)::integer
        into v_taken
        from public.salon_reservations r
       where r.scheduled_event_id = v_ev.id
         and r.status not in ('cancelled', 'no_show');
      -- Pagó después de que se le venció el lugar y alguien más lo tomó: la
      -- reserva se crea igual (pagó) y se marca el sobrecupo.
      if v_taken + v_order.party_size > v_ev.capacity then
        v_attention := coalesce(v_attention, 'overbooked');
      end if;

      v_manager := public.ticketing_online_manager(p_tenant_id);
      v_balance := (v_order.full_price_cents - v_order.unit_price_cents) * v_order.party_size;
      v_comment := case
        when v_order.payment_option = 'deposit' then
          format(
            'Pagó online con Mercado Pago una seña de %s. Resta cobrar %s en efectivo.',
            public.ticketing_format_ars(coalesce(p_paid_cents, 0)),
            public.ticketing_format_ars(v_balance)
          )
        else
          format(
            'Pagó online con Mercado Pago el total (%s). No resta cobrar nada.',
            public.ticketing_format_ars(coalesce(p_paid_cents, 0))
          )
      end;

      -- La fecha y la hora salen del EVENTO (no de la foto del pedido): si lo
      -- movieron, la reserva va con él (el trigger exige que coincidan).
      insert into public.salon_reservations (
        tenant_id, customer_id, guest_name, guest_phone, kind, meal_type,
        reservation_date, reservation_time_local, zone, scheduled_event_id,
        estimated_guests, deposit_cents, origin, primary_manager_id,
        comments, highlight_comment, status, created_by
      ) values (
        p_tenant_id, v_customer, v_order.guest_name, v_order.guest_phone, 'normal', v_order.meal_type,
        v_ev.event_date, v_ev.starts_at_local, 'event_floating', v_ev.id,
        v_order.party_size, coalesce(p_paid_cents, 0), 'web', v_manager,
        v_comment, true, 'pending', null
      )
      returning id into v_reservation;
    end if;

    update public.ticket_orders
       set status = 'approved',
           mp_payment_id = p_payment_id,
           mp_status = p_mp_status,
           mp_status_detail = p_mp_status_detail,
           mp_payment_type = p_payment_type,
           paid_cents = p_paid_cents,
           paid_at = coalesce(p_paid_at, now()),
           reservation_id = v_reservation,
           customer_id = v_customer,
           attention = v_attention
     where id = v_order.id;

    return jsonb_build_object(
      'order_id', v_order.id, 'status', 'approved',
      'reservation_id', v_reservation,
      'newly_approved', true, 'attention', v_attention
    );
  end if;

  -- ── Devuelto o contracargo ──────────────────
  if p_mp_status in ('refunded', 'charged_back') then
    if v_order.status = 'approved' and v_order.mp_payment_id = p_payment_id then
      update public.ticket_orders
         set status = 'refunded',
             mp_status = p_mp_status,
             mp_status_detail = p_mp_status_detail
       where id = v_order.id;
      -- La reserva queda (decide el bar), pero el staff tiene que saber que ya
      -- no hay plata adelantada.
      if v_order.reservation_id is not null then
        update public.salon_reservations
           set deposit_cents = 0,
               comments = left('Mercado Pago devolvió el pago de esta reserva. ' || coalesce(comments, ''), 2000)
         where id = v_order.reservation_id
           and status <> 'cancelled';
      end if;
      return jsonb_build_object(
        'order_id', v_order.id, 'status', 'refunded',
        'reservation_id', v_order.reservation_id,
        'newly_approved', false, 'newly_refunded', true, 'attention', v_order.attention
      );
    end if;
    -- Ya devuelto (Mercado Pago avisa varias veces): nada nuevo que auditar.
    return jsonb_build_object(
      'order_id', v_order.id, 'status', v_order.status,
      'reservation_id', v_order.reservation_id,
      'newly_approved', false, 'attention', v_order.attention
    );
  end if;

  -- ── Rechazado / cancelado / todavía en curso ─
  -- Solo mientras no se aprobó: un rechazo que llega tarde no pisa un pago.
  if v_order.status in ('pending', 'rejected') then
    update public.ticket_orders
       set status = case when p_mp_status in ('rejected', 'cancelled') then 'rejected' else 'pending' end,
           mp_payment_id = p_payment_id,
           mp_status = p_mp_status,
           mp_status_detail = p_mp_status_detail,
           mp_payment_type = p_payment_type
     where id = v_order.id;
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', case when p_mp_status in ('rejected', 'cancelled') then 'rejected' else 'pending' end,
      'reservation_id', null,
      'newly_approved', false, 'attention', v_order.attention
    );
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'status', v_order.status,
    'reservation_id', v_order.reservation_id,
    'newly_approved', false, 'attention', v_order.attention
  );
end;
$$;

revoke all on function public.ticketing_settle_order(
  uuid, uuid, text, text, text, text, bigint, timestamptz
) from public, anon, authenticated;
grant execute on function public.ticketing_settle_order(
  uuid, uuid, text, text, text, text, bigint, timestamptz
) to service_role;

notify pgrst, 'reload schema';
