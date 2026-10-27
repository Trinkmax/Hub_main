-- ============================================================
-- Entradas online — el precio en efectivo (27/10/2026)
-- ============================================================
-- En HUB, quien paga el resto en efectivo en el bar paga menos: $30.000 por
-- persona (seña de $5.000 online + $25.000 en efectivo) contra $35.000 todo
-- con Mercado Pago. Hasta hoy el saldo en el bar salía de precio − seña
-- ($30.000 por persona, $60.000 para dos) y tenía que ser $25.000 ($50.000).
--
-- `price_cents` sigue siendo el precio por persona si paga todo online.
-- `cash_price_cents` es el total por persona si señá y paga el resto en
-- efectivo. Null = el mismo precio (como hasta hoy). El GRANT de la tabla es
-- por tabla, así que ya cubre la columna nueva.

alter table public.event_experiences
  add column if not exists cash_price_cents bigint
    check (cash_price_cents between 100 and 100000000);

-- Siempre queda algo para pagar en el bar. Con DO para que sea idempotente.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'event_experiences_cash_above_deposit'
       and conrelid = 'public.event_experiences'::regclass
  ) then
    alter table public.event_experiences
      add constraint event_experiences_cash_above_deposit
      check (cash_price_cents is null or cash_price_cents > deposit_cents);
  end if;
end;
$$;

comment on column public.event_experiences.cash_price_cents is
  'Total por persona si señá online y paga el resto en efectivo en el bar (centavos). Null = price_cents.';

-- ──────────────────────────────────────────────
-- Guardar el lugar, con el precio en efectivo
-- ──────────────────────────────────────────────
-- Igual que en 20261027150000_ticketing_min_party_price_note salvo el precio
-- completo de la foto del pedido: con seña, es el de efectivo. Así el saldo
-- ((completo − seña) × personas) sale bien en el comentario de la reserva
-- que lee el staff y en «Mi entrada», sin tocar ticketing_settle_order.
-- Misma firma: CREATE OR REPLACE conserva los permisos (solo service_role).

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

  -- Lo que se cobra hoy por persona y el precio completo de la foto: todo con
  -- Mercado Pago, el precio online; con seña, el de efectivo (HUB: $30.000).
  if p_option = 'full' then
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
    guest_name, guest_phone, marketing_opt_in, client_ip,
    status, hold_expires_at
  ) values (
    p_tenant_id, v_exp.id, v_ev.id,
    v_exp.title, v_ev.event_date, v_ev.starts_at_local, p_meal_type,
    p_party_size, p_option, v_unit, v_full, v_unit * p_party_size,
    btrim(p_guest_name), p_guest_phone, coalesce(p_marketing_opt_in, false), left(p_client_ip, 64),
    'pending', now() + make_interval(mins => coalesce(v_hold, 15))
  )
  returning * into v_order;

  return v_order;
end;
$$;
