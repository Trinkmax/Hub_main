-- ============================================================
-- Beneficios ricos por nivel + marcas aliadas (partners)
-- ============================================================
-- Reemplaza el beneficio único (loyalty_tiers.benefit_cadence + benefit_reward_id)
-- por una lista `tier_benefits` con 4 tipos:
--   • recurring_reward → ítem gratis mensual/cumpleaños (auto-emitido por cron, N por mes)
--   • discount         → % off en un contexto (display-only, lo aplica el staff)
--   • perk             → beneficio físico/otro (ej. remera) (display-only)
--   • partner          → descuento de marca aliada externa (display-only)
--
-- `partners`: catálogo de marcas aliadas por tenant (borrador hasta cerrar el acuerdo).
--
-- LEY multi-tenant: RLS tenant-read / owner-write + GRANT a authenticated.
-- Regenerar types/database.ts tras esta migración.
-- ============================================================

-- ── 1) partners (catálogo de marcas aliadas) ────────────────────────────
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  logo_url text,
  discount_label text check (discount_label is null or length(discount_label) <= 40),
  category text check (category is null or length(category) <= 40),
  url text,
  active boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partners_tenant_idx on public.partners(tenant_id, sort);
create trigger partners_updated_at before update on public.partners
  for each row execute function public.set_updated_at();

alter table public.partners enable row level security;
create policy "partners_select_member" on public.partners for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "partners_owner_insert" on public.partners for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "partners_owner_update" on public.partners for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "partners_owner_delete" on public.partners for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
grant select, insert, update, delete on public.partners to authenticated;

-- ── 2) tier_benefits (beneficios ricos por nivel) ───────────────────────
create table public.tier_benefits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tier_id uuid not null references public.loyalty_tiers(id) on delete cascade,
  kind text not null check (kind in ('recurring_reward','discount','perk','partner')),
  label text not null check (length(trim(label)) between 1 and 80),
  description text,
  icon text,
  reward_id uuid references public.rewards(id) on delete set null,
  cadence public.tier_benefit_cadence not null default 'monthly',
  quantity int not null default 1 check (quantity between 1 and 20),
  discount_pct numeric(5,2) check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  discount_scope text,
  partner_id uuid references public.partners(id) on delete set null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tier_benefits_kind_shape check (
    (kind = 'recurring_reward' and reward_id is not null)
    or (kind = 'discount' and discount_pct is not null)
    or (kind = 'perk')
    or (kind = 'partner' and partner_id is not null)
  )
);
create index tier_benefits_tier_idx on public.tier_benefits(tier_id, sort);
create index tier_benefits_tenant_idx on public.tier_benefits(tenant_id);
create trigger tier_benefits_updated_at before update on public.tier_benefits
  for each row execute function public.set_updated_at();

alter table public.tier_benefits enable row level security;
create policy "tb_select_member" on public.tier_benefits for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "tb_owner_insert" on public.tier_benefits for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "tb_owner_update" on public.tier_benefits for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "tb_owner_delete" on public.tier_benefits for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
grant select, insert, update, delete on public.tier_benefits to authenticated;

-- ── 3) Migrar el beneficio único existente → tier_benefits ──────────────
insert into public.tier_benefits (tenant_id, tier_id, kind, label, reward_id, cadence, quantity, sort, active)
select t.tenant_id, t.id, 'recurring_reward',
       coalesce(r.name, 'Beneficio de nivel'),
       t.benefit_reward_id, t.benefit_cadence, 1, 0, true
from public.loyalty_tiers t
left join public.rewards r on r.id = t.benefit_reward_id
where t.benefit_cadence <> 'none' and t.benefit_reward_id is not null;

-- ── 4) Drop columnas obsoletas de loyalty_tiers ─────────────────────────
alter table public.loyalty_tiers
  drop column if exists benefit_cadence,
  drop column if exists benefit_reward_id;

-- ── 5) tier_benefit_grants: idempotencia por beneficio (no por nivel) ────
alter table public.tier_benefit_grants
  add column if not exists tier_benefit_id uuid references public.tier_benefits(id) on delete cascade;

do $$
declare c text;
begin
  select conname into c from pg_constraint
    where conrelid = 'public.tier_benefit_grants'::regclass and contype = 'u';
  if c is not null then
    execute format('alter table public.tier_benefit_grants drop constraint %I', c);
  end if;
end $$;

create unique index if not exists tier_benefit_grants_unique_idx
  on public.tier_benefit_grants(customer_id, tier_benefit_id, period_key);

-- ── 6) grant_tier_benefits: emite N canjes por beneficio recurrente ──────
create or replace function public.grant_tier_benefits()
returns table(granted_count int)
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
  v_today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  b record;
  cu record;
  v_period text;
  v_grant_id uuid;
  v_redemption_id uuid;
  i int;
begin
  for b in
    select tb.id, tb.tenant_id, tb.tier_id, tb.reward_id, tb.cadence, tb.quantity, tb.label
    from public.tier_benefits tb
    join public.loyalty_tiers lt on lt.id = tb.tier_id
    where tb.active = true and tb.kind = 'recurring_reward'
      and tb.reward_id is not null and tb.cadence <> 'none'
      and lt.active = true
  loop
    for cu in
      select c.id, c.birthdate
      from public.customers c
      where c.tenant_id = b.tenant_id
        and c.deleted_at is null
        and c.current_tier_id = b.tier_id
    loop
      if b.cadence = 'monthly' then
        v_period := to_char(v_today, 'YYYY-MM');
      elsif b.cadence = 'birthday' then
        if cu.birthdate is null
           or extract(month from cu.birthdate) <> extract(month from v_today) then
          continue;
        end if;
        v_period := 'bday-' || to_char(v_today, 'YYYY');
      else
        continue;
      end if;

      insert into public.tier_benefit_grants
        (tenant_id, customer_id, tier_id, tier_benefit_id, period_key, reward_id)
      values (b.tenant_id, cu.id, b.tier_id, b.id, v_period, b.reward_id)
      on conflict do nothing
      returning id into v_grant_id;

      if v_grant_id is null then continue; end if;

      for i in 1 .. greatest(b.quantity, 1) loop
        insert into public.reward_redemptions
          (tenant_id, customer_id, reward_id, points_spent, status, notes)
        values (b.tenant_id, cu.id, b.reward_id, 0, 'pending', b.label)
        returning id into v_redemption_id;
      end loop;

      update public.tier_benefit_grants set redemption_id = v_redemption_id where id = v_grant_id;
      v_count := v_count + greatest(b.quantity, 1);
    end loop;
  end loop;

  return query select v_count;
end; $$;
revoke execute on function public.grant_tier_benefits() from anon, authenticated;
