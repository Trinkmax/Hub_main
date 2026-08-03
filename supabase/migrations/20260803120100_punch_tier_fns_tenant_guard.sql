-- ============================================================
-- Cierre multi-tenant de las funciones de nivel (corrige 20260803120000)
-- ============================================================
-- `customer_effective_tier(customer_id)` y `punch_template_allows_customer()`
-- nacieron `security definer` con grant a `authenticated` y sin ningún chequeo
-- de membresía: cualquier usuario logueado de cualquier bar podía preguntar por
-- el id de cualquier cliente y averiguar en qué categoría está. Es una lectura
-- cross-tenant, o sea violación de la LEY multi-tenant (CLAUDE.md §4), aunque lo
-- que devuelva sea sólo un uuid.
--
-- Criterio: el mismo que usa `add_punch_stamp` desde la corrección
-- 20260731205453 — si hay `auth.uid()` (todo el tráfico que entra como
-- `authenticated`) se exige membresía en el tenant del cliente. Sin usuario sólo
-- puede ser un contexto de confianza: el trigger interno o service_role, porque
-- `anon` no tiene grant sobre estas funciones.
-- ============================================================
create or replace function public.customer_effective_tier(p_customer_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tier uuid;
begin
  select tenant_id into v_tenant from public.customers where id = p_customer_id;
  if v_tenant is null then
    return null;
  end if;

  if (select auth.uid()) is not null and public.user_role_in_tenant(v_tenant) is null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select t.id into v_tier
    from public.loyalty_tiers t
    join public.customers c on c.id = p_customer_id
   where t.tenant_id = c.tenant_id
     and t.active = true
     and t.min_category_points <= coalesce(c.category_points, 0)
   order by t.min_category_points desc, t.sort desc
   limit 1;

  return v_tier;
end $$;

revoke execute on function public.customer_effective_tier(uuid) from public, anon;
grant execute on function public.customer_effective_tier(uuid) to authenticated;

comment on function public.customer_effective_tier(uuid) is
  'Nivel vigente del socio según sus puntos de categoría. Espejo de resolveTier (lib/points/tiers.ts). Exige membresía si hay usuario logueado.';

-- `punch_template_allows_customer` hereda el portero: llama a la anterior, que
-- ahora tira `forbidden` si el que pregunta no es del bar.
create or replace function public.punch_template_allows_customer(
  p_template_id uuid,
  p_customer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
           select 1 from public.punch_card_template_tiers where template_id = p_template_id
         )
      or exists (
           select 1 from public.punch_card_template_tiers
            where template_id = p_template_id
              and tier_id = public.customer_effective_tier(p_customer_id)
         )
$$;

revoke execute on function public.punch_template_allows_customer(uuid, uuid) from public, anon;
grant execute on function public.punch_template_allows_customer(uuid, uuid) to authenticated;
