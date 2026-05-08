-- Plan 3: mark_session_paid — cobro atómico con puntos.
-- Materializa visits + visit_items desde tickets de la sesión.
-- Reutiliza calculate_visit_points y triggers de stats existentes.

create or replace function public.mark_session_paid(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_role text;
  v_new_qr text;
  v_guest record;
  v_visit_id uuid;
  v_total_for_guest bigint;
  v_calc record;
  v_total_points int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_visits_created int := 0;
begin
  -- Lock session
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  -- Idempotente: si ya está paid, devolver el resultado anterior
  if v_session.status = 'paid' then
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'paid',
      'idempotent', true,
      'total_cents', v_session.total_cents
    );
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  -- Verificar role del caller
  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Para cada guest registrado con al menos un item asignado, crear visit
  for v_guest in
    select sg.id as guest_id, sg.customer_id, sg.display_name
    from public.session_guests sg
    where sg.session_id = p_session_id
      and sg.customer_id is not null
  loop
    -- Sumar items asignados a este guest, no cancelados, de tickets no cancelados
    select coalesce(sum(ti.line_total_cents), 0) into v_total_for_guest
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    -- Si no consumió nada propio, saltar (no crear visita vacía)
    if v_total_for_guest = 0 then
      continue;
    end if;

    -- Crear visit. Trigger visits_apply_stats actualiza customer counts.
    insert into public.visits (
      tenant_id, customer_id, visited_at, total_amount_cents, source, created_by
    ) values (
      v_session.tenant_id, v_guest.customer_id, now(), 0, 'cashier', auth.uid()
    ) returning id into v_visit_id;

    -- Insertar visit_items copiando los ticket_items asignados
    insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
    select v_visit_id, ti.menu_item_id, ti.quantity, ti.unit_price_cents, ti.line_total_cents
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    -- Update total_amount_cents (dispara trigger visits_apply_stats)
    update public.visits set total_amount_cents = v_total_for_guest where id = v_visit_id;

    -- Calcular puntos via motor existente
    select * into v_calc from public.calculate_visit_points(v_visit_id);
    if v_calc.delta > 0 then
      insert into public.points_transactions (
        tenant_id, customer_id, visit_id, delta, reason, payload
      ) values (
        v_session.tenant_id, v_guest.customer_id, v_visit_id, v_calc.delta,
        'session_paid', v_calc.breakdown
      );
      v_total_points := v_total_points + v_calc.delta;
      v_breakdown := v_breakdown || jsonb_build_object(
        'guest_id', v_guest.guest_id,
        'customer_id', v_guest.customer_id,
        'display_name', v_guest.display_name,
        'visit_id', v_visit_id,
        'total_cents', v_total_for_guest,
        'points', v_calc.delta,
        'rules', v_calc.breakdown
      );
    else
      v_breakdown := v_breakdown || jsonb_build_object(
        'guest_id', v_guest.guest_id,
        'customer_id', v_guest.customer_id,
        'display_name', v_guest.display_name,
        'visit_id', v_visit_id,
        'total_cents', v_total_for_guest,
        'points', 0,
        'rules', '[]'::jsonb
      );
    end if;

    v_visits_created := v_visits_created + 1;
  end loop;

  -- Marcar sesión paid
  update public.table_sessions
    set status = 'paid',
        paid_at = now(),
        updated_at = now()
    where id = p_session_id;

  -- Rotar qr_token de la mesa física (si tiene una asignada)
  if v_session.physical_table_id is not null then
    v_new_qr := public.generate_qr_token();
    update public.physical_tables
      set qr_token = v_new_qr, updated_at = now()
      where id = v_session.physical_table_id;
  end if;

  -- Emitir evento
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_paid',
    auth.uid(),
    jsonb_build_object(
      'total_cents', v_session.total_cents,
      'visits_created', v_visits_created,
      'total_points', v_total_points,
      'breakdown', v_breakdown
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'paid',
    'idempotent', false,
    'total_cents', v_session.total_cents,
    'visits_created', v_visits_created,
    'total_points', v_total_points,
    'breakdown', v_breakdown
  );
end $$;

revoke all on function public.mark_session_paid(uuid) from public;
grant execute on function public.mark_session_paid(uuid) to authenticated;
