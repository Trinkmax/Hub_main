-- mark_session_paid extendido con redención de puntos como descuento.
--
-- Cambios vs la versión 20260527 (sin rotar qr_token):
--   - Nuevo p_redemptions jsonb default '[]' con [{customer_id, points_to_redeem}].
--   - Valida flag + cap + saldo antes de aplicar.
--   - Inserta points_transactions con delta negativo (trigger actualiza balance).
--   - visit.total_amount_cents = share - redeem (puntos nuevos solo sobre lo
--     pagado en plata; no se cicla saldo).
--   - Persiste sum y breakdown en table_sessions.

drop function if exists public.mark_session_paid(uuid);

create or replace function public.mark_session_paid(
  p_session_id uuid,
  p_redemptions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_tenant public.tenants;
  v_role text;
  v_guest record;
  v_visit_id uuid;
  v_share bigint;
  v_redeem_cents bigint;
  v_total_for_visit bigint;
  v_calc record;
  v_total_points int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_visits_created int := 0;
  v_redemption jsonb;
  v_redemption_entry jsonb;
  v_redemptions_norm jsonb := '[]'::jsonb;
  v_total_redeemed_cents bigint := 0;
  v_points_to_redeem int;
  v_cap_cents bigint;
  v_customer public.customers;
  v_redemptions_count int;
begin
  -- 0. Validaciones iniciales sobre redemptions
  v_redemptions_count := coalesce(jsonb_array_length(coalesce(p_redemptions, '[]'::jsonb)), 0);

  -- 1. Lock session
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  -- Idempotente
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

  -- 2. Levantar config del tenant (rate, max_pct, enabled)
  select * into v_tenant from public.tenants where id = v_session.tenant_id;
  if v_tenant.id is null then
    raise exception 'tenant_not_found' using errcode = 'P0001';
  end if;

  if v_redemptions_count > 0 and v_tenant.points_redemption_enabled is not true then
    raise exception 'redemption_disabled' using errcode = 'P0001';
  end if;

  -- 3. Pre-procesar redemptions: para cada (customer_id, points_to_redeem)
  --    validamos y guardamos un map customer_id → redeem_cents que se usa al
  --    crear el visit del cliente.
  if v_redemptions_count > 0 then
    for v_redemption in select * from jsonb_array_elements(p_redemptions) loop
      v_points_to_redeem := nullif((v_redemption->>'points_to_redeem')::int, 0);
      if v_points_to_redeem is null or v_points_to_redeem <= 0 then
        raise exception 'invalid_points_to_redeem' using errcode = 'P0001';
      end if;

      -- Customer en la sesión
      select c.* into v_customer
        from public.customers c
        join public.session_guests sg on sg.customer_id = c.id
        where c.id = (v_redemption->>'customer_id')::uuid
          and sg.session_id = p_session_id
        limit 1;
      if v_customer.id is null then
        raise exception 'customer_not_in_session' using errcode = 'P0001';
      end if;

      -- Saldo suficiente
      if v_customer.points_balance < v_points_to_redeem then
        raise exception 'insufficient_balance' using errcode = 'P0001';
      end if;

      -- Share del cliente en la sesión
      select coalesce(sum(ti.line_total_cents), 0) into v_share
        from public.ticket_items ti
        join public.tickets t on t.id = ti.ticket_id
        join public.session_guests sg on sg.id = ti.assigned_to_guest_id
        where t.session_id = p_session_id
          and t.status <> 'cancelled'
          and ti.cancelled_at is null
          and sg.customer_id = v_customer.id;

      -- Cap
      v_cap_cents := floor(v_share::numeric * v_tenant.points_redemption_max_pct / 100);
      v_redeem_cents := v_points_to_redeem::bigint * v_tenant.points_to_cents_rate::bigint;

      if v_redeem_cents > v_cap_cents then
        raise exception 'exceeds_cap' using errcode = 'P0001';
      end if;
      if v_redeem_cents > v_share then
        raise exception 'exceeds_share' using errcode = 'P0001';
      end if;

      -- Asentar en ledger
      insert into public.points_transactions (
        tenant_id, customer_id, delta, reason, payload
      ) values (
        v_session.tenant_id, v_customer.id, -v_points_to_redeem,
        'session_payment_discount',
        jsonb_build_object(
          'session_id', p_session_id,
          'redeem_cents', v_redeem_cents,
          'rate_centavos_per_point', v_tenant.points_to_cents_rate
        )
      );

      v_total_redeemed_cents := v_total_redeemed_cents + v_redeem_cents;
      v_redemptions_norm := v_redemptions_norm || jsonb_build_object(
        'customer_id', v_customer.id,
        'points_used', v_points_to_redeem,
        'redeem_cents', v_redeem_cents,
        'share_cents', v_share
      );
    end loop;
  end if;

  -- 4. Crear visit por cada guest registrado (igual que antes, restando redeem)
  for v_guest in
    select sg.id as guest_id, sg.customer_id, sg.display_name
    from public.session_guests sg
    where sg.session_id = p_session_id
      and sg.customer_id is not null
  loop
    select coalesce(sum(ti.line_total_cents), 0) into v_share
      from public.ticket_items ti
      join public.tickets t on t.id = ti.ticket_id
      where t.session_id = p_session_id
        and t.status <> 'cancelled'
        and ti.assigned_to_guest_id = v_guest.guest_id
        and ti.cancelled_at is null;

    if v_share = 0 then
      continue;
    end if;

    -- Buscar redemption matching de este customer
    select (entry->>'redeem_cents')::bigint into v_redeem_cents
      from jsonb_array_elements(v_redemptions_norm) entry
      where (entry->>'customer_id')::uuid = v_guest.customer_id
      limit 1;
    v_redeem_cents := coalesce(v_redeem_cents, 0);
    v_total_for_visit := v_share - v_redeem_cents;

    -- Crear visit. total_amount_cents = parte pagada en plata.
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

    update public.visits set total_amount_cents = v_total_for_visit where id = v_visit_id;

    -- Puntos nuevos sobre v_total_for_visit (lo pagado en plata)
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

    v_breakdown := v_breakdown || jsonb_build_object(
      'guest_id', v_guest.guest_id,
      'customer_id', v_guest.customer_id,
      'display_name', v_guest.display_name,
      'visit_id', v_visit_id,
      'share_cents', v_share,
      'redeem_cents', v_redeem_cents,
      'paid_cash_cents', v_total_for_visit,
      'points', coalesce(v_calc.delta, 0),
      'rules', coalesce(v_calc.breakdown, '[]'::jsonb)
    );
    v_visits_created := v_visits_created + 1;
  end loop;

  -- 5. Marcar sesión paid y persistir redenciones
  update public.table_sessions
    set status = 'paid',
        paid_at = now(),
        updated_at = now(),
        points_redeemed_cents = v_total_redeemed_cents,
        points_redemptions = v_redemptions_norm
    where id = p_session_id;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_paid',
    auth.uid(),
    jsonb_build_object(
      'total_cents', v_session.total_cents,
      'total_redeemed_cents', v_total_redeemed_cents,
      'visits_created', v_visits_created,
      'total_points', v_total_points,
      'breakdown', v_breakdown,
      'redemptions', v_redemptions_norm
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'paid',
    'idempotent', false,
    'total_cents', v_session.total_cents,
    'total_redeemed_cents', v_total_redeemed_cents,
    'visits_created', v_visits_created,
    'total_points', v_total_points,
    'breakdown', v_breakdown,
    'redemptions', v_redemptions_norm
  );
end $$;

revoke all on function public.mark_session_paid(uuid, jsonb) from public;
grant execute on function public.mark_session_paid(uuid, jsonb) to authenticated;
