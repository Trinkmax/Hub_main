-- ============================================================
-- Club: foto propia en beneficios de nivel + orden manual de canjeables
-- ============================================================
-- ITEM 6 — "no me deja modificar los beneficios poniéndoles fotos".
--   `tier_benefits` no tenía columna de imagen: la única foto posible venía
--   prestada de la recompensa vinculada (rewards.image_url), así que un
--   beneficio 'discount' o 'perk' JAMÁS podía tener foto. La card del wallet
--   (benefit-card.tsx) ya sabe renderizar `imageUrl` — sólo faltaba el dato.
--
-- ITEM 7 — "se debería poder cambiar el orden de los beneficios y de los
--   canjeables". `tier_benefits.sort` ya existía (pero sin UI); `rewards` NO
--   tenía orden y salía por cost_points. Acá: columna + backfill que respeta
--   el orden que el dueño ve hoy, y los dos RPC de reordenamiento.
-- ============================================================

-- ── 1) ITEM 6: foto propia del beneficio ────────────────────────────────
alter table public.tier_benefits
  add column if not exists image_url text;

comment on column public.tier_benefits.image_url is
  'Foto propia del beneficio (bucket menu-images). Le gana a la foto de la recompensa vinculada y al logo del aliado.';

-- ── 2) ITEM 7: orden manual de canjeables ───────────────────────────────
alter table public.rewards
  add column if not exists sort int not null default 0;

-- Backfill: arranca replicando el orden actual (cost_points asc, name asc) para
-- que el primer render post-deploy sea idéntico al de hoy y nada "salte".
with ordered as (
  select id, row_number() over (partition by tenant_id order by cost_points asc, name asc) as rn
  from public.rewards
)
update public.rewards r
set sort = o.rn
from ordered o
where o.id = r.id and r.sort = 0;

create index if not exists rewards_tenant_sort_idx on public.rewards (tenant_id, sort);

-- ── 3) RPC de reordenamiento ────────────────────────────────────────────
-- Un solo statement por lista, transaccional (a diferencia de N updates desde
-- la action, que ante un fallo parcial dejaban el orden inconsistente).
-- Ambas listas son owner-only, igual que el resto del editor del club.

create or replace function public.reorder_tier_benefits(p_tier_id uuid, p_ordered_ids uuid[])
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

  select tenant_id into v_tenant from public.loyalty_tiers where id = p_tier_id;
  if v_tenant is null then
    raise exception 'tier_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  update public.tier_benefits tb
  set sort = o.rn
  from (
    select id, ordinality::int as rn
    from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
  ) o
  where tb.id = o.id
    and tb.tier_id = p_tier_id
    and tb.tenant_id = v_tenant;
end $$;

create or replace function public.reorder_rewards(p_tenant_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.tenant_role;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;

  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  update public.rewards r
  set sort = o.rn
  from (
    select id, ordinality::int as rn
    from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
  ) o
  where r.id = o.id
    and r.tenant_id = p_tenant_id;
end $$;

revoke execute on function public.reorder_tier_benefits(uuid, uuid[]) from public, anon;
revoke execute on function public.reorder_rewards(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_tier_benefits(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_rewards(uuid, uuid[]) to authenticated;
