-- Fase 2 — Recompensas EXCLUSIVAS por nivel.
-- rewards.min_tier_id: si está, el cliente debe haber alcanzado ese nivel
-- (lifetime_points_earned >= umbral del nivel) para canjearla.

alter table public.rewards
  add column if not exists min_tier_id uuid references public.loyalty_tiers(id) on delete set null;
create index if not exists rewards_min_tier_idx
  on public.rewards(min_tier_id) where min_tier_id is not null;

-- redeem_reward: igual que phase3 + check de nivel tras los checks de stock/balance.
create or replace function public.redeem_reward(
  p_customer_id uuid,
  p_reward_id uuid
) returns table(redemption_id uuid, balance_after int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_tenant_id uuid;
  v_reward public.rewards;
  v_balance int;
  v_redemption_id uuid;
  v_new_stock int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select tenant_id into v_tenant_id
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_tenant_id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_reward from public.rewards
    where id = p_reward_id and tenant_id = v_tenant_id
    for update;
  if v_reward.id is null then
    raise exception 'reward_not_found' using errcode = 'P0001';
  end if;
  if not v_reward.active then
    raise exception 'reward_inactive' using errcode = 'P0001';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'out_of_stock' using errcode = 'P0001';
  end if;

  -- Gating por nivel: el cliente debe haber alcanzado el umbral del nivel requerido.
  -- Usamos lifetime_points_earned (nunca baja) como base, no el balance gastable.
  if v_reward.min_tier_id is not null then
    if not exists (
      select 1
      from public.loyalty_tiers lt
      join public.customers c on c.id = p_customer_id
      where lt.id = v_reward.min_tier_id
        and c.lifetime_points_earned >= lt.min_lifetime_points
    ) then
      raise exception 'tier_locked' using errcode = 'P0001';
    end if;
  end if;

  select points_balance into v_balance from public.customers
    where id = p_customer_id for update;
  if v_balance < v_reward.cost_points then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;

  insert into public.reward_redemptions (
    tenant_id, customer_id, reward_id, points_spent, redeemed_by
  ) values (
    v_tenant_id, p_customer_id, p_reward_id, v_reward.cost_points, v_uid
  ) returning id into v_redemption_id;

  insert into public.points_transactions (
    tenant_id, customer_id, redemption_id, delta, reason, payload
  ) values (
    v_tenant_id, p_customer_id, v_redemption_id, -v_reward.cost_points,
    'reward_redeem', jsonb_build_object('reward_id', p_reward_id, 'reward_name', v_reward.name)
  );

  if v_reward.stock is not null then
    update public.rewards set stock = stock - 1 where id = p_reward_id
      returning stock into v_new_stock;
  end if;

  return query select v_redemption_id, v_balance - v_reward.cost_points;
end; $$;

revoke all on function public.redeem_reward(uuid, uuid) from public;
grant execute on function public.redeem_reward(uuid, uuid) to authenticated;
