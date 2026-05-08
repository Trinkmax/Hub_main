-- Plan 4: RPC pública get_loyalty_state
-- El comensal registrado ve su balance de puntos + progreso de cards activas.

create or replace function public.get_loyalty_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_customer_id uuid;
  v_customer public.customers;
  v_cards jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- Resolver sesión + customer del guest
  select ts.id, ts.tenant_id, sg.customer_id
    into v_session_id, v_tenant_id, v_customer_id
    from public.session_guests sg
    join public.table_sessions ts on ts.id = sg.session_id
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token
      and sg.browser_token = p_browser_token
    order by ts.opened_at desc
    limit 1;
  if v_customer_id is null then
    return jsonb_build_object('registered', false);
  end if;

  select * into v_customer from public.customers where id = v_customer_id;

  -- Cards activas del customer en este tenant
  select coalesce(jsonb_agg(jsonb_build_object(
    'card_id', cpc.id,
    'template_id', cpc.template_id,
    'template_name', t.name,
    'description', t.description,
    'image_url', t.image_url,
    'current_stamps', cpc.current_stamps,
    'threshold', cpc.threshold_snapshot,
    'reward_name', r.name
  )), '[]'::jsonb) into v_cards
  from public.customer_punch_cards cpc
  join public.punch_card_templates t on t.id = cpc.template_id
  join public.rewards r on r.id = t.reward_id
  where cpc.customer_id = v_customer_id
    and cpc.tenant_id = v_tenant_id
    and cpc.completed_at is null
    and cpc.expired_at is null;

  return jsonb_build_object(
    'registered', true,
    'customer_id', v_customer_id,
    'first_name', v_customer.first_name,
    'points_balance', v_customer.points_balance,
    'active_cards', v_cards
  );
end $$;

revoke all on function public.get_loyalty_state(text, text) from public;
grant execute on function public.get_loyalty_state(text, text) to anon, authenticated;
