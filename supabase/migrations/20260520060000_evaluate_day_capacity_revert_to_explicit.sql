-- ============================================================
-- Revert del auto-attach (20260520050000) — vuelta al modelo explícito
-- ============================================================
-- El modelo del bar es:
--   - Reservas normales (cena a la carta) → consumen su zona física
--   - Reservas atadas a un evento (vinieron a Sushi Libre) → consumen el cupo del evento
--   - Una reserva NO contagia su cupo a otros buckets — son ortogonales
--
-- Auto-attach implícito (suma todas las del día al evento default) era
-- engañoso porque mezclaba clientes a la carta con clientes del evento.
-- Lo correcto es: el cupo del evento se llena SOLO con reservas que
-- explícitamente pidieron ese evento.
--
-- Reservas especiales (cumple/recibida) que piden un formato (ej. Pizza
-- Libre en una recibida del martes 15 sin pizza libre programada) crean
-- una instance ad-hoc del template via el helper ensure_scheduled_event_for_template
-- al guardarse, y quedan atadas con scheduled_event_id seteado.

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
  zone_usage as (
    select ('zone:' || ar.zone::text) as bucket,
           sum(coalesce(ar.actual_guests, ar.estimated_guests))::int as used
      from active_reservations ar
     where ar.zone <> 'event_floating'
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

-- ============================================================
-- Helper: ensure_scheduled_event_for_template
-- ============================================================
-- Para reservas especiales que piden un formato calendizado (ej. Pizza
-- Libre en una recibida del martes 15 sin pizza libre programada):
-- - Si ya existe scheduled_event de ese template ese día → retorna su id
-- - Si no existe → crea ad-hoc con default_capacity del template
--
-- Usado desde createSalonReservation cuando kind in ('birthday','special')
-- y el user eligió un template.
create or replace function public.ensure_scheduled_event_for_template(
  p_template_id uuid,
  p_event_date date,
  p_starts_at_local time default '21:00'::time,
  p_capacity int default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_template public.scheduled_event_templates;
  v_role public.tenant_role;
  v_existing_id uuid;
  v_new_id uuid;
  v_capacity int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_template from public.scheduled_event_templates where id = p_template_id;
  if v_template.id is null then raise exception 'template_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_template.tenant_id);
  if v_role is null or v_role not in ('owner','cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Existe instance ese día?
  select id into v_existing_id from public.scheduled_events
   where tenant_id = v_template.tenant_id
     and template_id = p_template_id
     and event_date = p_event_date;

  if v_existing_id is not null then return v_existing_id; end if;

  -- Crear ad-hoc.
  v_capacity := coalesce(p_capacity, v_template.default_capacity, 30);
  insert into public.scheduled_events (
    tenant_id, template_id, event_date, starts_at_local,
    capacity, meal_type, full_bonus_active, notes
  ) values (
    v_template.tenant_id, p_template_id, p_event_date, p_starts_at_local,
    v_capacity, v_template.default_meal_type, false,
    'Ad-hoc creado por reserva especial'
  ) returning id into v_new_id;

  return v_new_id;
end; $$;

revoke all on function public.ensure_scheduled_event_for_template(uuid, date, time, int) from public;
grant execute on function public.ensure_scheduled_event_for_template(uuid, date, time, int) to authenticated;

notify pgrst, 'reload schema';
