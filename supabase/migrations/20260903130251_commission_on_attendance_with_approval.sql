-- ============================================================
-- La comisión vuelve a calcularse por asistencia — pero se aprueba
-- ============================================================
-- Los dueños describieron el flujo real: "los encargados cargan cuántos
-- asistieron, nosotros vemos el reporte para luego calcular comisiones".
--
-- Eso cambia el diagnóstico de esta mañana. La objeción a facturar por
-- asistencia era que quien escribe el número no puede ser quien lo cobra. Pero
-- no es Luz la que decide: el sistema PROPONE y los dueños APRUEBAN al tocar
-- "marcar pagado" en el reporte. Con ese paso en el medio, la liquidación deja
-- de moverse sola y a espaldas de nadie, que era el problema de fondo.
--
-- Entonces: cubiertos facturados = coalesce(actual_guests, estimated_guests),
-- como era originalmente.
--
-- SE CONSERVAN los dos arreglos de 20260903124825, que seguían siendo correctos
-- y no dependen de quién paga:
--
--   · La TARIFA se busca por `estimated_guests`. Las tarifas tienen escalones
--     (cena: 1-7 $90, 8-15 $120, 16-30 $130, 31+ $140), así que una cena de 16 a
--     la que vienen 15 caía de $130 a $120 el cubierto: esa única persona
--     costaba $280 cuando el cubierto vale $130. Eso no es cobrar por lo real,
--     es una penalización por cruzar un borde. El escalón lo fija lo que se
--     reservó; los cubiertos, lo que vino.
--
--   · El BONUS de "evento lleno" se evalúa con `sum(estimated_guests)`. "Lleno"
--     es que se agotó el cupo, y el cupo se agota cuando se vende. Además vuelve
--     determinístico un bonus que antes cambiaba según por dónde se hubiera
--     cargado el número.
--
-- ARREGLO NUEVO — comisiones ya pagadas:
-- `commission_ledger` tiene UNIQUE (reservation_id, manager_id). El recálculo
-- borra las entries impagas y reinserta; si ya había una PAGADA para ese gestor,
-- el insert chocaba y la operación fallaba entera con un error ilegible. Con los
-- encargados cargando asistencia de días pasados —algunos ya liquidados— ese
-- camino pasa de raro a frecuente. Ahora el recálculo SALTEA al gestor que ya
-- cobró: lo pagado es inmutable, y corregir la asistencia de una reserva vieja
-- no explota, simplemente no le toca la plata a quien ya la cobró.
-- Ojo al split 50/50: se evalúa por gestor, así que si el primario ya cobró y el
-- asistente no, el asistente igual se recalcula.

create or replace function public.recalc_reservation_commission(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_res public.salon_reservations;
  v_se public.scheduled_events;
  v_guests int;
  v_tier_guests int;
  v_rate bigint;
  v_bonus_per_guest bigint := 0;
  v_total_used int;
  v_base bigint;
  v_bonus_total bigint;
  v_payable bigint;
  v_primary_eligible boolean := false;
  v_assistant_eligible boolean := false;
  v_primary_paid boolean := false;
  v_assistant_paid boolean := false;
begin
  select * into v_res from public.salon_reservations where id = p_reservation_id;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  -- Cubiertos facturados: los que vinieron. Si nadie contó todavía, el estimado.
  v_guests := coalesce(v_res.actual_guests, v_res.estimated_guests);
  -- El ESCALÓN, en cambio, lo fija lo reservado (ver cabecera).
  v_tier_guests := v_res.estimated_guests;

  delete from public.commission_ledger
   where reservation_id = p_reservation_id and paid_at is null;

  if v_res.status in ('cancelled', 'no_show') then return; end if;

  select rate_per_guest_cents into v_rate
    from public.commission_rate_tiers
   where tenant_id = v_res.tenant_id
     and meal_type = v_res.meal_type
     and active
     and v_tier_guests >= min_guests
     and (max_guests is null or v_tier_guests <= max_guests)
   order by min_guests desc
   limit 1;
  if v_rate is null then v_rate := 0; end if;

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

  -- Lo ya cobrado es intocable: si quedó una entry pagada, ese gestor no entra
  -- al recálculo (si no, el insert choca contra el UNIQUE y revienta todo).
  select exists (
    select 1 from public.commission_ledger
     where reservation_id = p_reservation_id
       and manager_id = v_res.primary_manager_id
       and paid_at is not null
  ) into v_primary_paid;

  if v_res.assistant_manager_id is not null then
    select exists (
      select 1 from public.commission_ledger
       where reservation_id = p_reservation_id
         and manager_id = v_res.assistant_manager_id
         and paid_at is not null
    ) into v_assistant_paid;
  end if;

  if v_primary_paid then v_primary_eligible := false; end if;
  if v_assistant_paid then v_assistant_eligible := false; end if;

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
      -- Split: si el asistente ya cobró su mitad, el primario sigue cobrando la
      -- suya, no el total. Si no hay asistente eligible, cobra todo.
      1, case when v_assistant_paid then 2 else 1 end,
      case when v_assistant_paid then (v_payable + 1) / 2 else v_payable end
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
      1, case when v_primary_paid then 2 else 1 end,
      case when v_primary_paid then v_payable / 2 else v_payable end
    );
  end if;
end; $$;

revoke all on function public.recalc_reservation_commission(uuid) from public;
grant execute on function public.recalc_reservation_commission(uuid) to authenticated;

-- Registrar la asistencia vuelve a recalcular: es la base de la propuesta que
-- los dueños después aprueban en el reporte.
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

notify pgrst, 'reload schema';
