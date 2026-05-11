-- Phase 9b: pedidos Nacho mayo 2026 (parte 2)
-- a) punch_card_templates: trigger_ref_id nullable + config jsonb + check
-- b) RPC award_points_by_amount (acreditación rápida vía QR)
-- c) RPC register_lunch_visit (punch card visit_window manual)
-- d) RPC rotate_customer_qr_token (revocar/regenerar QR del cliente)

-- ──────────────────────────────────────────────────────────
-- a) punch_card_templates: soporte visit_window
-- ──────────────────────────────────────────────────────────
alter table public.punch_card_templates
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.punch_card_templates
  alter column trigger_ref_id drop not null;

alter table public.punch_card_templates
  drop constraint if exists punch_card_templates_trigger_ref_check;

alter table public.punch_card_templates
  add constraint punch_card_templates_trigger_ref_check check (
    (trigger_type in ('item','category','tag') and trigger_ref_id is not null)
    or (trigger_type = 'visit_window' and trigger_ref_id is null)
  );

-- ──────────────────────────────────────────────────────────
-- b) award_points_by_amount: acredita puntos por monto $ via QR escaneado
-- ──────────────────────────────────────────────────────────
-- Reusa reglas per_amount activas del tenant (mayor prioridad gana).
-- Crea visit sintética (sin items) para mantener stats consistentes.
create or replace function public.award_points_by_amount(
  p_customer_id uuid,
  p_amount_cents bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers;
  v_role text;
  v_rule public.points_rules;
  v_every_cents bigint;
  v_pts_per_step int;
  v_points int := 0;
  v_visit_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_customer
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_customer.tenant_id);
  if v_role is null or v_role not in ('owner','cashier','waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_rule
    from public.points_rules
    where tenant_id = v_customer.tenant_id
      and type = 'per_amount'
      and active = true
    order by priority desc
    limit 1;

  if v_rule.id is not null then
    v_every_cents := coalesce((v_rule.config->>'every_cents')::bigint, 100);
    v_pts_per_step := coalesce((v_rule.config->>'points')::int, 1);
    if v_every_cents > 0 then
      v_points := (p_amount_cents / v_every_cents)::int * v_pts_per_step;
    end if;
  end if;

  insert into public.visits (
    tenant_id, customer_id, visited_at, total_amount_cents, source, created_by
  ) values (
    v_customer.tenant_id, p_customer_id, now(), p_amount_cents, 'cashier', auth.uid()
  ) returning id into v_visit_id;

  if v_points > 0 then
    insert into public.points_transactions (
      tenant_id, customer_id, visit_id, delta, reason, payload
    ) values (
      v_customer.tenant_id, p_customer_id, v_visit_id, v_points,
      'qr_award',
      jsonb_build_object(
        'amount_cents', p_amount_cents,
        'rule_id', v_rule.id,
        'every_cents', v_every_cents,
        'points_per_step', v_pts_per_step
      )
    );
  end if;

  return jsonb_build_object(
    'visit_id', v_visit_id,
    'points_awarded', v_points,
    'amount_cents', p_amount_cents,
    'new_balance', (select points_balance from public.customers where id = p_customer_id)
  );
end $$;

revoke all on function public.award_points_by_amount(uuid, bigint) from public;
grant execute on function public.award_points_by_amount(uuid, bigint) to authenticated;

-- ──────────────────────────────────────────────────────────
-- c) register_lunch_visit: marca un almuerzo en punch_card visit_window
-- ──────────────────────────────────────────────────────────
-- Valida horario/día/cupo diario contra template.config.
-- Crea card si no existe, suma stamp, completa si llega al threshold.
-- Usa America/Argentina/Cordoba como TZ default; cuando se necesite por-tenant
-- se levanta de tenants.timezone (hoy aún no existe esa columna).
create or replace function public.register_lunch_visit(
  p_customer_id uuid,
  p_template_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers;
  v_template public.punch_card_templates;
  v_role text;
  v_card public.customer_punch_cards;
  v_now timestamptz := now();
  v_local_dt timestamp;
  v_local_time time;
  v_local_dow int;
  v_cfg jsonb;
  v_hours_from time;
  v_hours_to time;
  v_days int[];
  v_max_per_day int;
  v_today_count int;
  v_new_stamps int;
  v_completed boolean := false;
  v_redemption_id uuid;
  v_reward public.rewards;
begin
  select * into v_customer
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_customer.tenant_id);
  if v_role is null or v_role not in ('owner','cashier','waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_template
    from public.punch_card_templates
    where id = p_template_id
      and tenant_id = v_customer.tenant_id
      and active = true;
  if v_template.id is null then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;
  if v_template.trigger_type <> 'visit_window' then
    raise exception 'wrong_trigger_type' using errcode = 'P0001';
  end if;

  v_cfg := v_template.config;
  v_hours_from := coalesce((v_cfg->>'hours_from')::time, '00:00'::time);
  v_hours_to := coalesce((v_cfg->>'hours_to')::time, '23:59'::time);
  v_days := coalesce(
    (select array_agg((j)::int) from jsonb_array_elements_text(v_cfg->'days_of_week') as j),
    array[1,2,3,4,5,6,7]
  );
  v_max_per_day := coalesce((v_cfg->>'max_per_day')::int, 1);

  v_local_dt := (v_now at time zone 'America/Argentina/Cordoba')::timestamp;
  v_local_time := v_local_dt::time;
  v_local_dow := extract(isodow from v_local_dt)::int;

  if v_local_time < v_hours_from or v_local_time > v_hours_to then
    raise exception 'outside_window' using errcode = 'P0001';
  end if;
  if not (v_local_dow = any(v_days)) then
    raise exception 'wrong_day_of_week' using errcode = 'P0001';
  end if;

  select * into v_card
    from public.customer_punch_cards
    where customer_id = p_customer_id
      and template_id = p_template_id
      and completed_at is null
      and expired_at is null
    for update;

  if v_card.id is null then
    insert into public.customer_punch_cards (
      tenant_id, customer_id, template_id, current_stamps, threshold_snapshot
    ) values (
      v_customer.tenant_id, p_customer_id, p_template_id, 0, v_template.threshold
    ) returning * into v_card;
  end if;

  select count(*) into v_today_count
    from public.points_transactions pt
    where pt.customer_id = p_customer_id
      and pt.reason = 'lunch_visit'
      and (pt.payload->>'template_id')::uuid = p_template_id
      and (pt.created_at at time zone 'America/Argentina/Cordoba')::date
          = (v_now at time zone 'America/Argentina/Cordoba')::date;

  if v_today_count >= v_max_per_day then
    raise exception 'already_stamped_today' using errcode = 'P0001';
  end if;

  v_new_stamps := least(v_card.current_stamps + 1, v_card.threshold_snapshot);

  update public.customer_punch_cards
    set current_stamps = v_new_stamps, updated_at = v_now
    where id = v_card.id;

  insert into public.points_transactions (
    tenant_id, customer_id, visit_id, delta, reason, payload
  ) values (
    v_customer.tenant_id, p_customer_id, null, 0, 'lunch_visit',
    jsonb_build_object(
      'template_id', p_template_id,
      'template_name', v_template.name,
      'new_stamps', v_new_stamps,
      'threshold', v_card.threshold_snapshot
    )
  );

  if v_new_stamps >= v_card.threshold_snapshot then
    select * into v_reward from public.rewards where id = v_template.reward_id;
    insert into public.reward_redemptions (
      tenant_id, customer_id, reward_id, points_spent, status
    ) values (
      v_customer.tenant_id, p_customer_id, v_template.reward_id, 0, 'pending'
    ) returning id into v_redemption_id;

    update public.customer_punch_cards
      set completed_at = v_now,
          reward_redemption_id = v_redemption_id,
          updated_at = v_now
      where id = v_card.id;
    v_completed := true;
  end if;

  return jsonb_build_object(
    'template_id', p_template_id,
    'template_name', v_template.name,
    'current_stamps', v_new_stamps,
    'threshold', v_card.threshold_snapshot,
    'completed', v_completed,
    'reward_redemption_id', v_redemption_id,
    'reward_name', v_reward.name
  );
end $$;

revoke all on function public.register_lunch_visit(uuid, uuid) from public;
grant execute on function public.register_lunch_visit(uuid, uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- d) rotate_customer_qr_token: regenera el qr_token (owner only)
-- ──────────────────────────────────────────────────────────
create or replace function public.rotate_customer_qr_token(p_customer_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_customer public.customers;
  v_role text;
  v_new_token text;
begin
  select * into v_customer
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_customer.tenant_id);
  if v_role <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_new_token := encode(gen_random_bytes(16), 'hex');
  update public.customers
    set qr_token = v_new_token,
        qr_token_generated_at = now(),
        updated_at = now()
    where id = p_customer_id;

  return v_new_token;
end $$;

revoke all on function public.rotate_customer_qr_token(uuid) from public;
grant execute on function public.rotate_customer_qr_token(uuid) to authenticated;
