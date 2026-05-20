-- ============================================================
-- evaluate_day_capacity: auto-attach reservas sin evento al "default" del día
-- ============================================================
-- Cuando hay 1 solo evento programado para una fecha cuyo template tiene
-- `consume_special_reservations = true` (Sushi Libre, Pizza Libre, etc.),
-- TODAS las reservas del día (incluso las que no eligieron explícitamente
-- el evento) cuentan al cupo del evento.
--
-- Refleja el modelo real del bar: "esta noche es Sushi Libre — los 18 que
-- vienen comen sushi, ocupando además sus mesas en PA/PB".
--
-- Si hay 0 o 2+ eventos consumibles del día, no hay default y las reservas
-- solo cuentan al evento al que estén atadas explícitamente.
--
-- NOTA: la asociación virtual es solo para visualización del cupo. El bonus
-- de comisión por evento full sigue requiriendo `scheduled_event_id` explícito
-- en la reserva — eso lo decide el dueño asociando manualmente desde el
-- detalle de la reserva.

create or replace function public.evaluate_day_capacity(
  p_tenant_id uuid, p_date date
) returns table (bucket text, used int, capacity int, available int)
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
  v_default_event_id uuid;
  v_consumable_count int;
begin
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select count(*), min(se.id::text)::uuid into v_consumable_count, v_default_event_id
    from public.scheduled_events se
    join public.scheduled_event_templates t on t.id = se.template_id
   where se.tenant_id = p_tenant_id
     and se.event_date = p_date
     and t.consume_special_reservations = true;

  if v_consumable_count <> 1 then v_default_event_id := null; end if;

  return query
  with active_reservations as (
    select sr.*
      from public.salon_reservations sr
     where sr.tenant_id = p_tenant_id
       and sr.reservation_date = p_date
       and sr.status not in ('cancelled', 'no_show')
  ),
  zone_usage as (
    select ('zone:' || ar.zone::text) as bucket,
           sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.zone <> 'event_floating'
     group by ar.zone
  ),
  event_usage as (
    select ('event:' || coalesce(ar.scheduled_event_id, v_default_event_id)::text) as bucket,
           sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.scheduled_event_id is not null
        or (ar.scheduled_event_id is null and v_default_event_id is not null)
     group by coalesce(ar.scheduled_event_id, v_default_event_id)
  ),
  zone_caps as (
    select 'zone:planta_alta' as bucket,
      coalesce(
        (select c.capacity from public.salon_zone_capacity_overrides c
           where c.tenant_id = p_tenant_id and c.zone = 'planta_alta' and c.override_date = p_date),
        coalesce(((select settings from public.tenants where id = p_tenant_id)->'salon_capacities'->>'planta_alta')::int, 0)
      ) as capacity
    union all
    select 'zone:planta_baja',
      coalesce(
        (select c.capacity from public.salon_zone_capacity_overrides c
           where c.tenant_id = p_tenant_id and c.zone = 'planta_baja' and c.override_date = p_date),
        coalesce(((select settings from public.tenants where id = p_tenant_id)->'salon_capacities'->>'planta_baja')::int, 0)
      )
  ),
  event_caps as (
    select ('event:' || se.id::text) as bucket, se.capacity
      from public.scheduled_events se
     where se.tenant_id = p_tenant_id and se.event_date = p_date
  )
  select zc.bucket, coalesce(zu.used, 0)::int, zc.capacity::int,
         greatest(zc.capacity - coalesce(zu.used, 0), 0)::int
    from zone_caps zc left join zone_usage zu on zu.bucket = zc.bucket
  union all
  select ec.bucket, coalesce(eu.used, 0)::int, ec.capacity::int,
         greatest(ec.capacity - coalesce(eu.used, 0), 0)::int
    from event_caps ec left join event_usage eu on eu.bucket = ec.bucket;
end; $$;

revoke all on function public.evaluate_day_capacity(uuid, date) from public;
grant execute on function public.evaluate_day_capacity(uuid, date) to authenticated;
