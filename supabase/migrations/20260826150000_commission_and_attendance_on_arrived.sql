-- El servicio se comisiona (y la asistencia se premia) cuando el cliente LLEGA.
--
-- Contexto operativo: en el panel de mozos el único gesto que sobrevive es
-- "Llegó". Sentar y cerrar mesa dejaron de ser tarea del salón — el mozo tiene
-- el celular en una mano y una bandeja en la otra, y en la práctica nunca
-- cerraba: 24 de 29 reservas de HUB quedaron en `pending` para siempre.
--
-- El problema es que `commission_ledger` SOLO se poblaba al llegar a `closed`,
-- así que los gestores no cobraban por reservas que sí se sirvieron, y
-- /mis-numeros mostraba casi cero.
--
-- Este cambio mueve el momento de la verdad de `closed` a `arrived`:
--
--   1. `transition_reservation_status` recalcula la comisión también al pasar a
--      'arrived'. `recalc_reservation_commission` no cambia: sigue saliendo
--      temprano solo para 'cancelled'/'no_show', sigue respetando las entries ya
--      pagadas y sigue facturando por `coalesce(actual_guests, estimated_guests)`
--      — o sea, por el estimado hasta que alguien corrija los cubiertos desde el
--      sheet de la reserva (que dispara su propio recalc). Es idempotente.
--
--   2. El trigger de puntos por asistencia a eventos exigía 'seated'/'closed'.
--      Con el flujo nuevo nunca se dispararía. Ya trae su propio guard de
--      idempotencia (`not exists` sobre points_transactions), así que agregar
--      'arrived' no puede acreditar dos veces si después alguien sí sienta o
--      cierra la mesa desde el manager.
--
-- Lo que NO cambia: la máquina de estados (no se agrega 'arrived' → 'closed'),
-- las RLS, ni la posibilidad del dueño de seguir cerrando mesas desde
-- /[slug]/operativo y /[slug]/reservas/[id].
--
-- Cabo suelto conocido, anotado en BACKLOG.md: revertir 'arrived' → 'pending' no
-- borra la entry del ledger (mismo comportamiento que ya tenía 'closed' →
-- 'seated'). Limpiarlo implicaría hacer que recalc trate 'pending' como "sin
-- servicio", y eso borraría entries impagas ya existentes de reservas pending.

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

  -- Validar transición. Sin cambios respecto de la versión anterior.
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

  -- ⬇ ÚNICO cambio funcional: 'arrived' también liquida.
  if p_to in ('arrived', 'closed', 'no_show', 'cancelled') or p_actual_guests is not null then
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
-- Puntos por asistencia: también desde 'arrived'
-- ──────────────────────────────────────────────────────────
create or replace function public.award_scheduled_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points int;
begin
  if new.status in ('arrived', 'seated', 'closed')
     and (old.status is null or old.status not in ('arrived', 'seated', 'closed'))
     and new.scheduled_event_id is not null
     and new.customer_id is not null then

    select coalesce(nullif(se.attendance_points, 0), t.default_event_attendance_points, 0)
      into v_points
    from public.scheduled_events se
    join public.tenants t on t.id = se.tenant_id
    where se.id = new.scheduled_event_id;

    if coalesce(v_points, 0) > 0
       and not exists (
         select 1 from public.points_transactions pt
         where pt.tenant_id = new.tenant_id
           and pt.customer_id = new.customer_id
           and pt.reason = 'event_attendance'
           and pt.payload ->> 'salon_reservation_id' = new.id::text
       ) then
      insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
      values (
        new.tenant_id, new.customer_id, v_points, 'event_attendance',
        jsonb_build_object(
          'salon_reservation_id', new.id,
          'scheduled_event_id', new.scheduled_event_id
        )
      );
    end if;
  end if;
  return new;
end;
$$;
