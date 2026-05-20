-- ============================================================
-- RPCs SECURITY DEFINER para salon_reservations
-- ============================================================
-- Estos RPCs permiten que el waiter opere (transiciones de estado, cantidad
-- real) sin abrir UPDATE en RLS. También centralizan la lógica de:
--   - cálculo de cupos por día (zona + evento)
--   - máquina de estados de reserva
--   - recálculo de comisión (idempotente, respeta entries pagadas)

-- ──────────────────────────────────────────────────────────
-- helper: lock key estable por (tenant_id, fecha)
-- ──────────────────────────────────────────────────────────
create or replace function public.reservation_day_lock_key(
  p_tenant_id uuid, p_date date
) returns bigint language sql immutable as $$
  select ('x' || substr(md5('res:' || p_tenant_id::text || ':' || p_date::text), 1, 16))::bit(64)::bigint
$$;

-- ──────────────────────────────────────────────────────────
-- evaluate_day_capacity — snapshot por bucket (zona o evento)
-- ──────────────────────────────────────────────────────────
-- Output:
--   bucket text   — 'zone:planta_alta' | 'zone:planta_baja' | 'event:<uuid>'
--   used int
--   capacity int
--   available int
--
-- Reglas:
--   - Reservas 'cancelled' o 'no_show' no cuentan.
--   - Una reserva con zone='event_floating' SIEMPRE consume del evento.
--   - Una reserva 'special' que pide un template con consume_special_reservations=true
--     consume del evento (no de la zona física).
--   - Resto consume de su zona física.
create or replace function public.evaluate_day_capacity(
  p_tenant_id uuid, p_date date
) returns table (
  bucket text,
  used int,
  capacity int,
  available int
)
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
begin
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  return query
  with active_reservations as (
    select sr.*, t.consume_special_reservations
      from public.salon_reservations sr
      left join public.scheduled_events se on se.id = sr.scheduled_event_id
      left join public.scheduled_event_templates t on t.id = se.template_id
     where sr.tenant_id = p_tenant_id
       and sr.reservation_date = p_date
       and sr.status not in ('cancelled', 'no_show')
  ),
  zone_usage as (
    select
      ('zone:' || ar.zone::text) as bucket,
      sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.zone <> 'event_floating'
       and not (
         ar.kind = 'special'
         and ar.scheduled_event_id is not null
         and coalesce(ar.consume_special_reservations, false) = true
       )
     group by ar.zone
  ),
  event_usage as (
    select
      ('event:' || ar.scheduled_event_id::text) as bucket,
      sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.scheduled_event_id is not null
       and (
         ar.zone = 'event_floating'
         or (ar.kind = 'special' and coalesce(ar.consume_special_reservations, false) = true)
       )
     group by ar.scheduled_event_id
  ),
  -- Capacidad por zona: override del día o default del settings.
  zone_caps as (
    select
      'zone:planta_alta' as bucket,
      coalesce(
        (select c.capacity from public.salon_zone_capacity_overrides c
           where c.tenant_id = p_tenant_id
             and c.zone = 'planta_alta'
             and c.override_date = p_date),
        coalesce(
          ((select settings from public.tenants where id = p_tenant_id)
            ->'salon_capacities'->>'planta_alta')::int,
          0
        )
      ) as capacity
    union all
    select
      'zone:planta_baja',
      coalesce(
        (select c.capacity from public.salon_zone_capacity_overrides c
           where c.tenant_id = p_tenant_id
             and c.zone = 'planta_baja'
             and c.override_date = p_date),
        coalesce(
          ((select settings from public.tenants where id = p_tenant_id)
            ->'salon_capacities'->>'planta_baja')::int,
          0
        )
      )
  ),
  event_caps as (
    select
      ('event:' || se.id::text) as bucket,
      se.capacity
      from public.scheduled_events se
     where se.tenant_id = p_tenant_id
       and se.event_date = p_date
  )
  select zc.bucket,
         coalesce(zu.used, 0)::int as used,
         zc.capacity::int,
         greatest(zc.capacity - coalesce(zu.used, 0), 0)::int as available
    from zone_caps zc
    left join zone_usage zu on zu.bucket = zc.bucket
  union all
  select ec.bucket,
         coalesce(eu.used, 0)::int as used,
         ec.capacity::int,
         greatest(ec.capacity - coalesce(eu.used, 0), 0)::int as available
    from event_caps ec
    left join event_usage eu on eu.bucket = ec.bucket;
end; $$;

revoke all on function public.evaluate_day_capacity(uuid, date) from public;
grant execute on function public.evaluate_day_capacity(uuid, date) to authenticated;

-- ──────────────────────────────────────────────────────────
-- recalc_reservation_commission — recalcula entries no pagadas
-- ──────────────────────────────────────────────────────────
-- Idempotente: borra entries con paid_at = null y reinserta según tarifas vigentes.
-- Entries con paid_at != null son intocables (auditabilidad de plata pagada).
create or replace function public.recalc_reservation_commission(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_res public.salon_reservations;
  v_se public.scheduled_events;
  v_guests int;
  v_rate bigint;
  v_bonus_per_guest bigint := 0;
  v_total_used int;
  v_base bigint;
  v_bonus_total bigint;
  v_payable bigint;
  v_primary_eligible boolean := false;
  v_assistant_eligible boolean := false;
begin
  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_guests := coalesce(v_res.actual_guests, v_res.estimated_guests);

  -- Borrar entries no pagadas previas.
  delete from public.commission_ledger
   where reservation_id = p_reservation_id and paid_at is null;

  -- Sin servicio efectivo no se comisiona.
  if v_res.status in ('cancelled', 'no_show') then return; end if;

  -- 1) Tarifa base: meal_type + rango de personas.
  select rate_per_guest_cents into v_rate
    from public.commission_rate_tiers
   where tenant_id = v_res.tenant_id
     and meal_type = v_res.meal_type
     and active
     and v_guests >= min_guests
     and (max_guests is null or v_guests <= max_guests)
   order by min_guests desc
   limit 1;
  if v_rate is null then v_rate := 0; end if;

  -- 2) Bonus por evento full.
  if v_res.scheduled_event_id is not null then
    select * into v_se from public.scheduled_events where id = v_res.scheduled_event_id;
    if v_se.id is not null and v_se.full_bonus_active then
      select sum(coalesce(actual_guests, estimated_guests))::int into v_total_used
        from public.salon_reservations
       where scheduled_event_id = v_se.id
         and status not in ('cancelled', 'no_show');
      if v_total_used is not null and v_total_used >= v_se.capacity then
        select bonus_per_guest_cents into v_bonus_per_guest
          from public.commission_bonus_rules
         where tenant_id = v_res.tenant_id
           and scope = 'scheduled_event_full'
           and active;
        v_bonus_per_guest := coalesce(v_bonus_per_guest, 0);
      end if;
    end if;
  end if;

  v_base := v_rate::bigint * v_guests::bigint;
  v_bonus_total := v_bonus_per_guest::bigint * v_guests::bigint;
  v_payable := v_base + v_bonus_total;

  -- 3) Eligibilidad de cada gestor.
  select coalesce(commission_eligible, false) into v_primary_eligible
    from public.reservation_managers where id = v_res.primary_manager_id;
  if v_res.assistant_manager_id is not null then
    select coalesce(commission_eligible, false) into v_assistant_eligible
      from public.reservation_managers where id = v_res.assistant_manager_id;
  end if;

  -- 4) Insertar entries según split.
  -- Si ambos eligibles → 50/50 con redondeo: primario recibe ceil/2, asistente floor/2.
  -- Si solo uno eligible → 100% a ese. Si ninguno → no entries.
  if v_primary_eligible and v_assistant_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents,
      split_factor_numerator, split_factor_denominator,
      payable_cents
    ) values
      (v_res.tenant_id, v_res.id, v_res.primary_manager_id, v_res.meal_type, v_guests,
       v_rate, v_base, v_bonus_per_guest, v_bonus_total, 1, 2,
       (v_payable + 1) / 2),
      (v_res.tenant_id, v_res.id, v_res.assistant_manager_id, v_res.meal_type, v_guests,
       v_rate, v_base, v_bonus_per_guest, v_bonus_total, 1, 2,
       v_payable / 2);
  elsif v_primary_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents, payable_cents
    ) values (
      v_res.tenant_id, v_res.id, v_res.primary_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total, v_payable
    );
  elsif v_assistant_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents, payable_cents
    ) values (
      v_res.tenant_id, v_res.id, v_res.assistant_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total, v_payable
    );
  end if;
end; $$;

revoke all on function public.recalc_reservation_commission(uuid) from public;
grant execute on function public.recalc_reservation_commission(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- recalc_event_commissions — reaplica bonus cuando un evento se llena
-- ──────────────────────────────────────────────────────────
create or replace function public.recalc_event_commissions(p_scheduled_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select id from public.salon_reservations
     where scheduled_event_id = p_scheduled_event_id
       and status not in ('cancelled', 'no_show')
  loop
    perform public.recalc_reservation_commission(r.id);
  end loop;
end; $$;

revoke all on function public.recalc_event_commissions(uuid) from public;
grant execute on function public.recalc_event_commissions(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- transition_reservation_status — máquina de estados
-- ──────────────────────────────────────────────────────────
-- Transiciones legales:
--   pending  → arrived | no_show | cancelled
--   arrived  → seated | pending (revertir)
--   seated   → closed | arrived (revertir)
--   closed   → seated (revertir, solo misma fecha)
-- Cuando llega a 'closed' con actual_guests, dispara recalc de comisión.
-- Si además ese close completa el evento al 100% por primera vez, dispara
-- recalc en cascada de todas las reservas del evento.
create or replace function public.transition_reservation_status(
  p_reservation_id uuid,
  p_to public.salon_reservation_status,
  p_actual_guests int default null
) returns public.salon_reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_now timestamptz := now();
  v_was_full boolean := false;
  v_is_full_now boolean := false;
  v_total int;
  v_se public.scheduled_events;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id for update;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  -- Snapshot pre-transición del estado de capacidad del evento (si aplica).
  if v_res.scheduled_event_id is not null then
    select * into v_se from public.scheduled_events where id = v_res.scheduled_event_id;
    if v_se.id is not null then
      select sum(coalesce(actual_guests, estimated_guests))::int into v_total
        from public.salon_reservations
       where scheduled_event_id = v_se.id
         and status not in ('cancelled', 'no_show');
      v_was_full := coalesce(v_total, 0) >= v_se.capacity;
    end if;
  end if;

  -- Validar transición.
  if not (
    (v_res.status, p_to) in (
      ('pending', 'arrived'),
      ('pending', 'no_show'),
      ('pending', 'cancelled'),
      ('arrived', 'seated'),
      ('arrived', 'pending'),
      ('seated',  'closed'),
      ('seated',  'arrived'),
      ('closed',  'seated')
    )
  ) then
    raise exception 'illegal_transition' using errcode = 'P0001';
  end if;

  update public.salon_reservations sr
     set status = p_to,
         actual_guests = coalesce(p_actual_guests, sr.actual_guests),
         arrived_at = case when p_to = 'arrived' and sr.arrived_at is null then v_now else sr.arrived_at end,
         arrived_by = case when p_to = 'arrived' and sr.arrived_by is null then v_uid else sr.arrived_by end,
         seated_at  = case when p_to = 'seated'  and sr.seated_at  is null then v_now else sr.seated_at  end,
         seated_by  = case when p_to = 'seated'  and sr.seated_by  is null then v_uid else sr.seated_by  end,
         closed_at  = case when p_to = 'closed'  then v_now else sr.closed_at  end,
         closed_by  = case when p_to = 'closed'  then v_uid else sr.closed_by  end,
         cancelled_at = case when p_to = 'cancelled' and sr.cancelled_at is null then v_now else sr.cancelled_at end
   where id = p_reservation_id
   returning * into v_res;

  -- Recalc comisión si pasa a 'closed' (o si actualizamos actual_guests).
  if p_to in ('closed', 'no_show', 'cancelled') or p_actual_guests is not null then
    perform public.recalc_reservation_commission(p_reservation_id);
  end if;

  -- Si quedó full por primera vez → reaplica bonus a todas las reservas del evento.
  if v_se.id is not null and not v_was_full then
    select sum(coalesce(actual_guests, estimated_guests))::int into v_total
      from public.salon_reservations
     where scheduled_event_id = v_se.id
       and status not in ('cancelled', 'no_show');
    v_is_full_now := coalesce(v_total, 0) >= v_se.capacity;
    if v_is_full_now then
      perform public.recalc_event_commissions(v_se.id);
    end if;
  end if;

  return v_res;
end; $$;

revoke all on function public.transition_reservation_status(uuid, public.salon_reservation_status, int) from public;
grant execute on function public.transition_reservation_status(uuid, public.salon_reservation_status, int) to authenticated;

-- ──────────────────────────────────────────────────────────
-- update_reservation_actual_guests — actualiza cantidad real sin cambiar status
-- ──────────────────────────────────────────────────────────
-- Permite que el mozo registre cantidad real antes de cerrar la mesa.
-- Dispara recalc de comisión.
create or replace function public.update_reservation_actual_guests(
  p_reservation_id uuid,
  p_actual_guests int
) returns public.salon_reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.salon_reservations;
  v_role public.tenant_role;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res from public.salon_reservations where id = p_reservation_id for update;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if p_actual_guests is null or p_actual_guests < 1 or p_actual_guests > 99 then
    raise exception 'invalid_guests' using errcode = 'P0001';
  end if;

  update public.salon_reservations
     set actual_guests = p_actual_guests
   where id = p_reservation_id
   returning * into v_res;

  perform public.recalc_reservation_commission(p_reservation_id);
  return v_res;
end; $$;

revoke all on function public.update_reservation_actual_guests(uuid, int) from public;
grant execute on function public.update_reservation_actual_guests(uuid, int) to authenticated;

-- ──────────────────────────────────────────────────────────
-- mark_commission_paid — owner marca un grupo de entries como pagadas
-- ──────────────────────────────────────────────────────────
create or replace function public.mark_commission_paid(
  p_ledger_ids uuid[],
  p_paid_at timestamptz default now()
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_updated int := 0;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  -- Solo entries cuyo tenant tenga al usuario como owner.
  with eligible as (
    update public.commission_ledger cl
       set paid_at = p_paid_at
     where cl.id = any(p_ledger_ids)
       and cl.paid_at is null
       and public.user_role_in_tenant(cl.tenant_id) = 'owner'
    returning 1
  )
  select count(*)::int into v_updated from eligible;

  return v_updated;
end; $$;

revoke all on function public.mark_commission_paid(uuid[], timestamptz) from public;
grant execute on function public.mark_commission_paid(uuid[], timestamptz) to authenticated;
