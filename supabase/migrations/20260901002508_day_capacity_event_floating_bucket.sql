-- ============================================================
-- evaluate_day_capacity: bucket propio para las reservas de evento
-- ============================================================
-- El problema que arregla: en /reservas el contador "Cubiertos" sumaba solo
-- los buckets 'zone:planta_alta' + 'zone:planta_baja'. Las reservas atadas a
-- un evento programado se cargan con zone='event_floating' (no eligen planta),
-- así que caían únicamente en el bucket 'event:<uuid>' y quedaban FUERA del
-- contador: un día con 30 cubiertos a la carta + 12 de Sushi Libre mostraba 30.
-- La misma pantalla en modo rango ("Este mes") sí los contaba, así que los dos
-- modos se contradecían entre sí.
--
-- Decisión del dueño: la gente del evento igual se sienta en el salón, así que
-- ocupa lugar real y tiene que sumar al total del día, comparado contra el tope
-- físico (PA + PB).
--
-- Cómo: `zone_usage` deja de filtrar 'event_floating' y `zone_caps` gana la fila
-- 'zone:event_floating' con capacity 0 (bucket informativo: no tiene tope
-- propio, el tope que le aplica es el del salón). Así cada reserva activa cae
-- en EXACTAMENTE UN bucket de zona, y el consumidor puede sumar los tres sin
-- riesgo de doble conteo — cosa que antes era imposible, porque una reserva con
-- zona física + scheduled_event_id aparece a propósito en su zona Y en su
-- evento (son ejes ortogonales: dónde se sienta vs. a qué evento vino).
--
-- Los buckets 'event:<uuid>' quedan intactos: siguen midiendo el cupo del
-- evento, que es otro control y se muestra en el calendario y en su detalle.

create or replace function public.evaluate_day_capacity(
  p_tenant_id uuid, p_date date
) returns table (bucket text, used int, capacity int, available int)
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
begin
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  return query
  with active_reservations as (
    select sr.*
      from public.salon_reservations sr
     where sr.tenant_id = p_tenant_id
       and sr.reservation_date = p_date
       and sr.status not in ('cancelled', 'no_show')
  ),
  -- Una fila por zona, incluida 'event_floating': partición completa de las
  -- reservas activas del día (cada reserva tiene exactamente una zona).
  zone_usage as (
    select ('zone:' || ar.zone::text) as bucket,
           sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     group by ar.zone
  ),
  event_usage as (
    select ('event:' || ar.scheduled_event_id::text) as bucket,
           sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.scheduled_event_id is not null
     group by ar.scheduled_event_id
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
    union all
    -- Sin tope propio: estas reservas no reservan planta, pero sus comensales
    -- sí ocupan el salón. Quien muestre el total del día suma las tres zonas
    -- y compara contra PA + PB.
    select 'zone:event_floating', 0
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

notify pgrst, 'reload schema';
