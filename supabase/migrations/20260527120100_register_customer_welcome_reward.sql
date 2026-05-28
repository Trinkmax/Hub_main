-- ============================================================
-- Migración: register_customer_for_session + welcome reward
-- ============================================================
-- Recrea el RPC para que cuando se cree un customer nuevo y haya
-- welcome_reward_configs.enabled = true + reward activo + stock disponible,
-- genere automáticamente una reward_redemption pendiente y escriba el
-- ledger welcome_reward_grants (one-shot por customer_id, garantizado por
-- la unique constraint).
--
-- Cambios respecto a 20260506100500_plan1_session_rpcs.sql:
--   - Variables nuevas: v_cfg, v_reward, v_welcome_redemption_id,
--     v_welcome_reward_name, v_welcome_reward_image_url
--   - Bloque 3.5 entre el "Dedupe customer" y el "Conectar guest con customer"
--   - jsonb de retorno con 3 campos adicionales (todos pueden ser null)

create or replace function public.register_customer_for_session(
  p_qr_token text,
  p_browser_token text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_birthdate date default null,
  p_opt_in_marketing boolean default false,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_guest public.session_guests;
  v_customer public.customers;
  v_customer_id uuid;
  v_was_new_customer boolean := false;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  -- Variables del welcome reward
  v_cfg public.welcome_reward_configs;
  v_reward public.rewards;
  v_welcome_redemption_id uuid;
  v_welcome_reward_name text;
  v_welcome_reward_image_url text;
begin
  -- Validación
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_first) > 60 then
    raise exception 'invalid_first_name' using errcode = 'P0001';
  end if;
  if length(v_last) = 0 or length(v_last) > 60 then
    raise exception 'invalid_last_name' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver sesión (no abre nueva — debe existir)
  select ts.id, ts.tenant_id into v_session_id, v_tenant_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open'
    for update of ts;
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  -- 2. Lookup guest
  select * into v_guest
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token
    for update;
  if v_guest.id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- 3. Dedupe customer por (tenant_id, phone)
  select * into v_customer
    from public.customers
    where tenant_id = v_tenant_id and phone = v_phone and deleted_at is null
    for update;

  if v_customer.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, birthdate,
      opt_in_marketing, opt_in_at, opt_in_ip, source
    ) values (
      v_tenant_id, v_phone, v_first, v_last, p_birthdate,
      p_opt_in_marketing,
      case when p_opt_in_marketing then now() else null end,
      case when p_opt_in_marketing then p_ip else null end,
      'qr'
    ) returning * into v_customer;
    v_customer_id := v_customer.id;
    v_was_new_customer := true;
  else
    -- Existía: actualiza datos básicos si están vacíos, no pisa nombre/apellido
    -- ya cargados; respeta opt_in si ya estaba en true.
    update public.customers
      set first_name = case when length(trim(first_name)) = 0 then v_first else first_name end,
          last_name = case when length(trim(last_name)) = 0 then v_last else last_name end,
          birthdate = coalesce(birthdate, p_birthdate),
          opt_in_marketing = opt_in_marketing or p_opt_in_marketing,
          opt_in_at = case
            when not opt_in_marketing and p_opt_in_marketing then now()
            else opt_in_at
          end,
          opt_in_ip = case
            when not opt_in_marketing and p_opt_in_marketing then p_ip
            else opt_in_ip
          end
      where id = v_customer.id
      returning * into v_customer;
    v_customer_id := v_customer.id;
  end if;

  -- 3.5 Welcome reward (solo si was_new_customer=true, enabled, reward activo, stock OK)
  -- Si algo falla en este bloque (config disabled, reward borrado, sin stock),
  -- silenciosamente no se otorga — NO debe romper el registro del cliente.
  -- El unique(customer_id) en welcome_reward_grants es la barrera one-shot final.
  if v_was_new_customer then
    select * into v_cfg
      from public.welcome_reward_configs
      where tenant_id = v_tenant_id;
    if v_cfg.enabled and v_cfg.reward_id is not null then
      select * into v_reward
        from public.rewards
        where id = v_cfg.reward_id and tenant_id = v_tenant_id and active = true
        for update;
      if v_reward.id is not null and (v_reward.stock is null or v_reward.stock > 0) then
        insert into public.reward_redemptions (
          tenant_id, customer_id, reward_id, points_spent, redeemed_by, status, notes
        ) values (
          v_tenant_id, v_customer_id, v_reward.id, 0, null, 'pending',
          'Regalo de bienvenida automático'
        ) returning id into v_welcome_redemption_id;
        if v_reward.stock is not null then
          update public.rewards set stock = stock - 1 where id = v_reward.id;
        end if;
        insert into public.welcome_reward_grants (
          tenant_id, customer_id, reward_id, redemption_id
        ) values (v_tenant_id, v_customer_id, v_reward.id, v_welcome_redemption_id);
        v_welcome_reward_name := v_reward.name;
        v_welcome_reward_image_url := v_reward.image_url;
      end if;
    end if;
  end if;

  -- 4. Conectar guest con customer
  update public.session_guests
    set customer_id = v_customer_id,
        display_name = coalesce(display_name, v_first),
        last_activity_at = now()
    where id = v_guest.id;

  -- 5. Evento
  insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
    values (
      v_session_id,
      'guest_registered',
      v_guest.id,
      jsonb_build_object(
        'customer_id', v_customer_id,
        'was_new_customer', v_was_new_customer,
        'welcome_redemption_id', v_welcome_redemption_id
      )
    );

  return jsonb_build_object(
    'guest_id', v_guest.id,
    'customer_id', v_customer_id,
    'was_new_customer', v_was_new_customer,
    'welcome_redemption_id', v_welcome_redemption_id,
    'welcome_reward_name', v_welcome_reward_name,
    'welcome_reward_image_url', v_welcome_reward_image_url
  );
end $$;

revoke all on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) from public;
grant execute on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) to anon, authenticated;
