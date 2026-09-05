-- ============================================================
-- Máquina de estados: "No vino" deja de ser terminal
-- ============================================================
-- Caso real de todas las noches: la anfitriona marca "No vino" a las 21:25 y
-- el grupo aparece a las 21:40. Hasta ahora `no_show` era terminal en la RPC
-- (`illegal_transition`) y la única salida era ir al formulario completo o
-- pedirle al dueño que lo arregle a mano. En la pantalla operativa nueva el
-- gesto es un toque: "Apareció" → vuelve a esperando, o directo "Llegó".
--
-- Dos pares nuevos, nada más:
--   · no_show → pending  ("me equivoqué / apareció, todavía no lo sentamos")
--   · no_show → arrived  ("apareció, entró ya", con conteo opcional)
--
-- Comisiones: `recalc_reservation_commission` ya borra las entries impagas al
-- pasar a no_show (sale temprano con 0). Volver a `pending` no dispara recalc
-- (igual que arrived → pending hoy) y el ledger queda vacío hasta que se marque
-- "Llegó", momento en el que se liquida como siempre. Las entries PAGADAS nunca
-- se tocan (mismo criterio que 20260903130251).
--
-- `cancelled` sigue siendo terminal: cancelar es una decisión del cliente y se
-- deshace desde la edición completa, no desde el pase de lista.
--
-- El resto de la función es copia literal de 20260826150000 (no se puede
-- editar una migración aplicada).

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

  -- Validar transición. ⬇ ÚNICO cambio: los dos pares que salen de no_show.
  if not (
    (v_res.status, p_to) in (
      ('pending', 'arrived'),
      ('pending', 'no_show'),
      ('pending', 'cancelled'),
      ('arrived', 'seated'),
      ('arrived', 'pending'),
      ('seated',  'closed'),
      ('seated',  'arrived'),
      ('closed',  'seated'),
      ('no_show', 'pending'),
      ('no_show', 'arrived')
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
