-- Fase 2 — Beneficio RECURRENTE por nivel (cumpleaños / mensual).
-- grant_tier_benefits() corre por cron: otorga una reward_redemption gratis (points_spent=0,
-- pending) al cliente que está EN ese nivel, una vez por período. Idempotente por
-- unique(customer_id, tier_id, period_key) + on conflict do nothing.

create table public.tier_benefit_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  tier_id uuid not null references public.loyalty_tiers(id) on delete cascade,
  period_key text not null,
  reward_id uuid references public.rewards(id) on delete set null,
  redemption_id uuid references public.reward_redemptions(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (customer_id, tier_id, period_key)
);
create index tier_benefit_grants_tenant_idx
  on public.tier_benefit_grants(tenant_id, granted_at desc);

alter table public.tier_benefit_grants enable row level security;
create policy "tbg_select_member" on public.tier_benefit_grants for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- inserts solo vía RPC SECURITY DEFINER (cron). Sin policy de write.
grant select on public.tier_benefit_grants to authenticated;

-- ──────────────────────────────────────────────────────────
-- grant_tier_benefits() — invocada por /api/cron/grant-tier-benefits (service_role).
-- ──────────────────────────────────────────────────────────
create or replace function public.grant_tier_benefits()
returns table(granted_count int)
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
  v_today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  t record;
  cu record;
  v_period text;
  v_redemption_id uuid;
  v_inserted uuid;
begin
  for t in
    select * from public.loyalty_tiers
    where active = true and benefit_cadence <> 'none' and benefit_reward_id is not null
  loop
    for cu in
      select c.id, c.birthdate
      from public.customers c
      where c.tenant_id = t.tenant_id
        and c.deleted_at is null
        and c.current_tier_id = t.id
    loop
      if t.benefit_cadence = 'monthly' then
        v_period := to_char(v_today, 'YYYY-MM');
      elsif t.benefit_cadence = 'birthday' then
        if cu.birthdate is null
           or extract(month from cu.birthdate) <> extract(month from v_today) then
          continue;
        end if;
        v_period := 'bday-' || to_char(v_today, 'YYYY');
      else
        continue;
      end if;

      insert into public.tier_benefit_grants (tenant_id, customer_id, tier_id, period_key, reward_id)
      values (t.tenant_id, cu.id, t.id, v_period, t.benefit_reward_id)
      on conflict (customer_id, tier_id, period_key) do nothing
      returning id into v_inserted;

      if v_inserted is null then continue; end if;

      insert into public.reward_redemptions (
        tenant_id, customer_id, reward_id, points_spent, status, notes
      ) values (
        t.tenant_id, cu.id, t.benefit_reward_id, 0, 'pending', 'Beneficio de nivel automático'
      ) returning id into v_redemption_id;

      update public.tier_benefit_grants set redemption_id = v_redemption_id where id = v_inserted;
      v_count := v_count + 1;
    end loop;
  end loop;

  return query select v_count;
end; $$;

revoke all on function public.grant_tier_benefits() from public;
-- la invoca el cron con service_role (bypassa grants). No se otorga a authenticated.
