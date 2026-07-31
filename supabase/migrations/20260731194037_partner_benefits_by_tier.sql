-- ============================================================
-- Aliados: N beneficios por marca, cada uno con su set de niveles
-- ============================================================
-- ITEM 8 — "en aliados debería poder asignarse a qué categorías corresponde
--   cada beneficio de un aliado. Guapa 10% para Select y Gold, y el mismo
--   aliado 30% para Black y Signature".
--
-- Hoy un aliado es una fila plana en `partners` con UN solo `discount_label` de
-- texto libre y cero relación con niveles. Con eso no se puede expresar el
-- pedido: harían falta 4 filas y las 4 mostrarían el mismo texto.
--
-- Modelo: `partners` queda como FICHA de la marca (nombre, logo, rubro, link) y
-- los descuentos se mudan a `partner_benefits`, cada uno con un set arbitrario
-- de niveles vía `partner_benefit_tiers`. Set arbitrario (no "de tal nivel para
-- arriba") porque el dueño puede querer saltear un nivel.
--
-- Regla de visualización (decisión del dueño): el socio ve SÓLO el beneficio de
-- SU nivel, no la suma de los de abajo. La resuelve la query del wallet.
--
-- ITEM 9 se alimenta de acá: el wallet agrupa aliados por nivel igual que ya
-- hace con los beneficios ("Mirá los beneficios de cada categoría").
-- ============================================================

-- ── 1) partner_benefits ─────────────────────────────────────────────────
create table if not exists public.partner_benefits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 80),
  description text check (description is null or length(description) <= 280),
  discount_pct numeric(5,2) check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  image_url text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_benefits_partner_idx on public.partner_benefits (partner_id, sort);
create index if not exists partner_benefits_tenant_idx on public.partner_benefits (tenant_id);

drop trigger if exists partner_benefits_updated_at on public.partner_benefits;
create trigger partner_benefits_updated_at before update on public.partner_benefits
  for each row execute function public.set_updated_at();

alter table public.partner_benefits enable row level security;

drop policy if exists "pben_select_member" on public.partner_benefits;
create policy "pben_select_member" on public.partner_benefits for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "pben_owner_insert" on public.partner_benefits;
create policy "pben_owner_insert" on public.partner_benefits for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "pben_owner_update" on public.partner_benefits;
create policy "pben_owner_update" on public.partner_benefits for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
drop policy if exists "pben_owner_delete" on public.partner_benefits;
create policy "pben_owner_delete" on public.partner_benefits for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.partner_benefits to authenticated;

-- ── 2) partner_benefit_tiers (N:N beneficio ↔ nivel) ────────────────────
create table if not exists public.partner_benefit_tiers (
  benefit_id uuid not null references public.partner_benefits(id) on delete cascade,
  tier_id uuid not null references public.loyalty_tiers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (benefit_id, tier_id)
);
create index if not exists partner_benefit_tiers_tier_idx on public.partner_benefit_tiers (tier_id);
create index if not exists partner_benefit_tiers_tenant_idx on public.partner_benefit_tiers (tenant_id);

alter table public.partner_benefit_tiers enable row level security;

drop policy if exists "pbt_select_member" on public.partner_benefit_tiers;
create policy "pbt_select_member" on public.partner_benefit_tiers for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "pbt_owner_write" on public.partner_benefit_tiers;
create policy "pbt_owner_write" on public.partner_benefit_tiers for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.partner_benefit_tiers to authenticated;

-- Coherencia multi-tenant: el beneficio y el nivel tienen que ser del mismo bar
-- que la fila de vínculo. Sin esto, un owner podría linkear su beneficio a un
-- nivel ajeno (la RLS mira `tenant_id` de la fila, no de los FK).
create or replace function public.partner_benefit_tiers_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_benefit_tenant uuid;
  v_tier_tenant uuid;
begin
  select tenant_id into v_benefit_tenant from public.partner_benefits where id = new.benefit_id;
  select tenant_id into v_tier_tenant from public.loyalty_tiers where id = new.tier_id;
  if v_benefit_tenant is null or v_tier_tenant is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_benefit_tenant <> new.tenant_id or v_tier_tenant <> new.tenant_id then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.partner_benefit_tiers_tenant_match() from public, anon, authenticated;

drop trigger if exists trg_pbt_tenant_match on public.partner_benefit_tiers;
create trigger trg_pbt_tenant_match
  before insert or update on public.partner_benefit_tiers
  for each row execute function public.partner_benefit_tiers_tenant_match();

-- ── 3) Migración de datos: el discount_label plano pasa a ser un beneficio ──
-- Cada aliado que ya tenía un descuento cargado se convierte en UN beneficio
-- aplicable a TODOS los niveles activos (equivalente exacto a lo que se veía
-- antes). El dueño después lo acota o agrega más desde el editor.
insert into public.partner_benefits (tenant_id, partner_id, label, sort, active)
select p.tenant_id, p.id, p.discount_label, 0, p.active
from public.partners p
where coalesce(trim(p.discount_label), '') <> ''
  and not exists (select 1 from public.partner_benefits pb where pb.partner_id = p.id);

insert into public.partner_benefit_tiers (benefit_id, tier_id, tenant_id)
select pb.id, lt.id, pb.tenant_id
from public.partner_benefits pb
join public.loyalty_tiers lt on lt.tenant_id = pb.tenant_id and lt.active = true
where not exists (
  select 1 from public.partner_benefit_tiers x where x.benefit_id = pb.id
)
on conflict do nothing;

-- ── 4) Reordenamiento de beneficios de un aliado ────────────────────────
create or replace function public.reorder_partner_benefits(p_partner_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;

  select tenant_id into v_tenant from public.partners where id = p_partner_id;
  if v_tenant is null then
    raise exception 'partner_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  update public.partner_benefits pb
  set sort = o.rn
  from (
    select id, ordinality::int as rn
    from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
  ) o
  where pb.id = o.id
    and pb.partner_id = p_partner_id
    and pb.tenant_id = v_tenant;
end $$;

revoke execute on function public.reorder_partner_benefits(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_partner_benefits(uuid, uuid[]) to authenticated;

comment on table public.partner_benefits is
  'ITEM 8: beneficios de una marca aliada. N por aliado, cada uno con su set de niveles en partner_benefit_tiers. El socio ve sólo el de SU nivel.';
