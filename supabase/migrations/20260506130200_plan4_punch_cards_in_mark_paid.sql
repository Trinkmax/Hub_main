-- Plan 4: extender mark_session_paid para procesar punch cards
-- + RPC pública get_loyalty_state.

-- ──────────────────────────────────────────────────────────
-- Helper: advance_punch_cards_for_visit
-- ──────────────────────────────────────────────────────────
-- Para un (customer_id, visit_id) recién creados, evalúa todas las
-- punch_card_templates activas del tenant y avanza/completa cards.
-- Solo cuenta items NO cancelados.
create or replace function public._advance_punch_cards_for_visit(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_visit_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_summary jsonb := '[]'::jsonb;
  v_template public.punch_card_templates;
  v_qty_matched int;
  v_card public.customer_punch_cards;
  v_new_stamps int;
  v_redemption_id uuid;
  v_reward public.rewards;
begin
  for v_template in
    select * from public.punch_card_templates
      where tenant_id = p_tenant_id and active = true
  loop
    -- Cantidad del visit que matchea el trigger
    if v_template.trigger_type = 'item' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        where vi.visit_id = p_visit_id
          and vi.menu_item_id = v_template.trigger_ref_id;
    elsif v_template.trigger_type = 'category' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        join public.menu_items mi on mi.id = vi.menu_item_id
        where vi.visit_id = p_visit_id
          and mi.category_id = v_template.trigger_ref_id;
    elsif v_template.trigger_type = 'tag' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        join public.menu_item_tag_assignments mita on mita.menu_item_id = vi.menu_item_id
        where vi.visit_id = p_visit_id
          and mita.tag_id = v_template.trigger_ref_id;
    else
      v_qty_matched := 0;
    end if;

    if v_qty_matched <= 0 then
      continue;
    end if;

    -- Buscar card activa del cliente para este template (lock para evitar race)
    select * into v_card
      from public.customer_punch_cards
      where customer_id = p_customer_id
        and template_id = v_template.id
        and completed_at is null
        and expired_at is null
      for update;

    if v_card.id is null then
      -- Crear nueva card
      v_new_stamps := least(v_qty_matched, v_template.threshold);
      insert into public.customer_punch_cards (
        tenant_id, customer_id, template_id, current_stamps, threshold_snapshot
      ) values (
        p_tenant_id, p_customer_id, v_template.id, v_new_stamps, v_template.threshold
      ) returning * into v_card;
    else
      v_new_stamps := least(v_card.current_stamps + v_qty_matched, v_card.threshold_snapshot);
      update public.customer_punch_cards
        set current_stamps = v_new_stamps,
            updated_at = now()
        where id = v_card.id
        returning * into v_card;
    end if;

    -- Si llegó al threshold, completar y generar redemption pending
    if v_card.current_stamps >= v_card.threshold_snapshot then
      select * into v_reward from public.rewards where id = v_template.reward_id;
      insert into public.reward_redemptions (
        tenant_id, customer_id, reward_id, points_spent, status
      ) values (
        p_tenant_id, p_customer_id, v_template.reward_id, 0, 'pending'
      ) returning id into v_redemption_id;

      update public.customer_punch_cards
        set completed_at = now(),
            reward_redemption_id = v_redemption_id,
            updated_at = now()
        where id = v_card.id;

      v_summary := v_summary || jsonb_build_object(
        'template_id', v_template.id,
        'template_name', v_template.name,
        'completed', true,
        'reward_redemption_id', v_redemption_id,
        'reward_name', v_reward.name
      );
    else
      v_summary := v_summary || jsonb_build_object(
        'template_id', v_template.id,
        'template_name', v_template.name,
        'completed', false,
        'current_stamps', v_card.current_stamps,
        'threshold', v_card.threshold_snapshot
      );
    end if;
  end loop;

  return v_summary;
end $$;

revoke all on function public._advance_punch_cards_for_visit(uuid, uuid, uuid) from public;
-- No grant — solo lo invoca mark_session_paid desde el server.

-- ──────────────────────────────────────────────────────────
-- Reemplazo: mark_session_paid extendido con punch cards
-- ──────────────────────────────────────────────────────────
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
  v_punch_summary jsonb;
begin
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

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

  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_guest in
    select sg.id as guest_id, sg.customer_id, sg.display_name
    from public.session_guests sg
    where sg.session_id = p_session_id
      and sg.customer_id is not null
  loop
    select coalesce(sum(ti.line_total_cents), 0) into v_total_for_guest
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    if v_total_for_guest = 0 then
      continue;
    end if;

    insert into public.visits (
      tenant_id, customer_id, visited_at, total_amount_cents, source, created_by
    ) values (
      v_session.tenant_id, v_guest.customer_id, now(), 0, 'cashier', auth.uid()
    ) returning id into v_visit_id;

    insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
    select v_visit_id, ti.menu_item_id, ti.quantity, ti.unit_price_cents, ti.line_total_cents
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    update public.visits set total_amount_cents = v_total_for_guest where id = v_visit_id;

    -- Puntos
    select * into v_calc from public.calculate_visit_points(v_visit_id);
    if v_calc.delta > 0 then
      insert into public.points_transactions (
        tenant_id, customer_id, visit_id, delta, reason, payload
      ) values (
        v_session.tenant_id, v_guest.customer_id, v_visit_id, v_calc.delta,
        'session_paid', v_calc.breakdown
      );
      v_total_points := v_total_points + v_calc.delta;
    end if;

    -- Punch cards
    v_punch_summary := public._advance_punch_cards_for_visit(
      v_session.tenant_id, v_guest.customer_id, v_visit_id
    );

    v_breakdown := v_breakdown || jsonb_build_object(
      'guest_id', v_guest.guest_id,
      'customer_id', v_guest.customer_id,
      'display_name', v_guest.display_name,
      'visit_id', v_visit_id,
      'total_cents', v_total_for_guest,
      'points', v_calc.delta,
      'rules', v_calc.breakdown,
      'punch_cards', v_punch_summary
    );

    v_visits_created := v_visits_created + 1;
  end loop;

  update public.table_sessions
    set status = 'paid',
        paid_at = now(),
        updated_at = now()
    where id = p_session_id;

  if v_session.physical_table_id is not null then
    v_new_qr := public.generate_qr_token();
    update public.physical_tables
      set qr_token = v_new_qr, updated_at = now()
      where id = v_session.physical_table_id;
  end if;

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

-- grants ya estaban del Plan 3
