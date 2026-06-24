-- El formulario del club ahora pide email y fecha de nacimiento (obligatorios).
-- `submit_capture` suma `p_email` y `p_birthdate`, los guarda en `customers`
-- (rellena si estaban vacíos en un cliente que vuelve) y mantiene el resto igual.
-- El opt-in de marketing pasa a ser implícito al sumarse (se registra con ts+IP).

drop function if exists public.submit_capture(text, text, text, text, boolean, text, text);

create function public.submit_capture(
  p_link_slug text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_opt_in boolean,
  p_ip text,
  p_user_agent text,
  p_email text default null,
  p_birthdate date default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_link public.customer_capture_links;
  v_existing public.customers;
  v_customer_id uuid;
  v_qr_token text;
  v_was_new boolean := false;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_email text := nullif(trim(lower(coalesce(p_email, ''))), '');
  v_cfg public.welcome_reward_configs;
  v_reward public.rewards;
  v_welcome_redemption_id uuid;
  v_welcome_reward_name text;
  v_welcome_reward_image_url text;
  v_welcome_bonus_points int := 0;
begin
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_last) = 0 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    raise exception 'invalid_or_inactive_link' using errcode = 'P0001';
  end if;

  select * into v_existing from public.customers
    where tenant_id = v_link.tenant_id
      and phone = v_phone
      and deleted_at is null
    for update;

  if v_existing.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, email, birthdate, source,
      opt_in_marketing, opt_in_at, opt_in_ip
    ) values (
      v_link.tenant_id, v_phone, v_first, v_last, v_email, p_birthdate, 'qr',
      p_opt_in,
      case when p_opt_in then now() else null end,
      case when p_opt_in then p_ip else null end
    ) returning id, qr_token into v_customer_id, v_qr_token;
    v_was_new := true;
  else
    update public.customers set
      first_name = case when coalesce(first_name, '') = '' then v_first else first_name end,
      last_name = case when coalesce(last_name, '') = '' then v_last else last_name end,
      email = coalesce(email, v_email),
      birthdate = coalesce(birthdate, p_birthdate),
      opt_in_marketing = opt_in_marketing or p_opt_in,
      opt_in_at = case when not opt_in_marketing and p_opt_in then now() else opt_in_at end,
      opt_in_ip = case when not opt_in_marketing and p_opt_in then p_ip else opt_in_ip end
    where id = v_existing.id
    returning id, qr_token into v_customer_id, v_qr_token;
  end if;

  -- Regalo de bienvenida + puntos bonus (solo customers nuevos, configurable).
  if v_was_new then
    select * into v_cfg from public.welcome_reward_configs where tenant_id = v_link.tenant_id;

    if v_cfg.enabled and v_cfg.reward_id is not null then
      select * into v_reward from public.rewards
        where id = v_cfg.reward_id and tenant_id = v_link.tenant_id and active = true
        for update;
      if v_reward.id is not null and (v_reward.stock is null or v_reward.stock > 0) then
        insert into public.reward_redemptions (
          tenant_id, customer_id, reward_id, points_spent, redeemed_by, status, notes
        ) values (
          v_link.tenant_id, v_customer_id, v_reward.id, 0, null, 'pending',
          'Regalo de bienvenida automático'
        ) returning id into v_welcome_redemption_id;
        if v_reward.stock is not null then
          update public.rewards set stock = stock - 1 where id = v_reward.id;
        end if;
        insert into public.welcome_reward_grants (
          tenant_id, customer_id, reward_id, redemption_id
        ) values (v_link.tenant_id, v_customer_id, v_reward.id, v_welcome_redemption_id)
        on conflict (customer_id) do nothing;
        v_welcome_reward_name := v_reward.name;
        v_welcome_reward_image_url := v_reward.image_url;
      end if;
    end if;

    if v_cfg.enabled and coalesce(v_cfg.bonus_points, 0) > 0 then
      if not exists (
        select 1 from public.points_transactions
        where customer_id = v_customer_id and reason = 'welcome_bonus'
      ) then
        insert into public.points_transactions (tenant_id, customer_id, delta, reason, payload)
        values (
          v_link.tenant_id, v_customer_id, v_cfg.bonus_points, 'welcome_bonus',
          jsonb_build_object('source', 'welcome_bonus')
        );
        v_welcome_bonus_points := v_cfg.bonus_points;
      end if;
    end if;
  end if;

  insert into public.customer_capture_submissions (
    tenant_id, link_id, customer_id, phone, first_name, last_name,
    opt_in_marketing, ip, user_agent
  ) values (
    v_link.tenant_id, v_link.id, v_customer_id,
    v_phone, v_first, v_last,
    p_opt_in, p_ip, p_user_agent
  );

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'tenant_id', v_link.tenant_id,
    'qr_token', v_qr_token,
    'was_new', v_was_new,
    'welcome_reward_name', v_welcome_reward_name,
    'welcome_reward_image_url', v_welcome_reward_image_url,
    'welcome_bonus_points', v_welcome_bonus_points
  );
end;
$function$;

revoke all on function public.submit_capture(text, text, text, text, boolean, text, text, text, date) from public;
grant execute on function public.submit_capture(text, text, text, text, boolean, text, text, text, date) to anon, authenticated;
