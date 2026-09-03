-- ============================================================
-- La comisión se paga por lo RESERVADO, no por lo que asistió
-- ============================================================
-- Decisión del dueño, al arrancar a registrar la asistencia real.
--
-- El problema no era la plata en sí: cobrar por 18 cuando vinieron 18 es
-- defendible. El problema es QUIÉN escribe ese número. Luz carga las reservas,
-- Luz pasa lista, y Luz es la única gestora con comisión: el sistema le pedía
-- escribir un dato que le bajaba su propio sueldo. Con ese incentivo, o no lo
-- anota o anota el estimado — y por eso hoy hay 114 de 137 reservas sin contar.
--
-- Desacoplar el registro del pago arregla el incentivo: la asistencia real pasa
-- a ser un dato del dueño (ocupación, ausentismo, quién no viene) y deja de
-- tener consecuencia sobre la liquidación. Dentro de unos meses el bar va a
-- tener el ausentismo medido de verdad y va a poder decidir el esquema con
-- evidencia, en vez de que a la gestora le baje el número sin aviso.
--
-- No es un cheque en blanco: una reserva en 'no_show' o 'cancelled' sigue
-- pagando CERO (el early return de abajo no cambia). Lo que se deja de castigar
-- es el faltante parcial, que no es responsabilidad del gestor — el bar bloqueó
-- la mesa igual.
--
-- Efectos colaterales, todos buenos, que salieron de la auditoría del 03/09:
--   · Corregir la asistencia ya no toca `commission_ledger`, así que desaparece
--     el crash por unique violation al recalcular sobre una entry ya PAGADA.
--   · El bonus de "evento lleno" deja de depender de por dónde entró el número
--     (antes `transition_reservation_status` cascadeaba y
--     `update_reservation_actual_guests` no, así que el bonus quedaba repartido
--     según el orden en que alguien tocara las reservas).
--   · La liquidación deja de moverse retroactivamente sola.

-- ── 1. La base de cálculo pasa a ser `estimated_guests`.
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

  -- LO RESERVADO. Antes era coalesce(actual_guests, estimated_guests).
  v_guests := v_res.estimated_guests;

  delete from public.commission_ledger
   where reservation_id = p_reservation_id and paid_at is null;

  -- Sin servicio efectivo no se comisiona. Un no-show total sigue pagando 0.
  if v_res.status in ('cancelled', 'no_show') then return; end if;

  -- 1) Tarifa base: meal_type + rango de personas.
  --    Al mirar lo reservado, el escalón de tarifa deja de castigar el faltante:
  --    una cena de 16 que vienen 15 seguía pagando $130 y no $120, o sea una
  --    sola persona le costaba $280 cuando el cubierto vale $130.
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

  -- 2) Bonus por evento full. También sobre lo reservado: "lleno" es que se
  --    agotó el cupo, y eso pasa cuando se vende, no cuando se sienta.
  if v_res.scheduled_event_id is not null then
    select * into v_se from public.scheduled_events where id = v_res.scheduled_event_id;
    if v_se.id is not null and v_se.full_bonus_active then
      select sum(estimated_guests)::int into v_total_used
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

  select coalesce(commission_eligible, false) into v_primary_eligible
    from public.reservation_managers where id = v_res.primary_manager_id;
  if v_res.assistant_manager_id is not null then
    select coalesce(commission_eligible, false) into v_assistant_eligible
      from public.reservation_managers where id = v_res.assistant_manager_id;
  end if;

  if v_primary_eligible and v_assistant_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents,
      split_factor_numerator, split_factor_denominator,
      payable_cents
    ) values (
      v_res.tenant_id, v_res.id, v_res.primary_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total,
      1, 2, (v_payable + 1) / 2
    ), (
      v_res.tenant_id, v_res.id, v_res.assistant_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total,
      1, 2, v_payable / 2
    );
  elsif v_primary_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents,
      split_factor_numerator, split_factor_denominator,
      payable_cents
    ) values (
      v_res.tenant_id, v_res.id, v_res.primary_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total,
      1, 1, v_payable
    );
  elsif v_assistant_eligible then
    insert into public.commission_ledger (
      tenant_id, reservation_id, manager_id, meal_type, guests_billed,
      base_rate_per_guest_cents, base_total_cents,
      bonus_per_guest_cents, bonus_total_cents,
      split_factor_numerator, split_factor_denominator,
      payable_cents
    ) values (
      v_res.tenant_id, v_res.id, v_res.assistant_manager_id, v_res.meal_type, v_guests,
      v_rate, v_base, v_bonus_per_guest, v_bonus_total,
      1, 1, v_payable
    );
  end if;
end; $$;

revoke all on function public.recalc_reservation_commission(uuid) from public;
grant execute on function public.recalc_reservation_commission(uuid) to authenticated;

-- ── 2. Registrar la asistencia deja de tocar la liquidación.
--    Es lo que hace que anotar "vinieron 18" sea gratis para quien lo anota.
--    Y de paso saca el camino que reventaba al recalcular sobre una comisión
--    ya pagada de una reserva vieja: el "Pasar lista" del cierre pasa por acá.
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

  -- Sin recálculo de comisión a propósito: la asistencia es un dato de
  -- ocupación, no la base de la liquidación.
  return v_res;
end; $$;

revoke all on function public.update_reservation_actual_guests(uuid, int) from public;
grant execute on function public.update_reservation_actual_guests(uuid, int) to authenticated;

notify pgrst, 'reload schema';
