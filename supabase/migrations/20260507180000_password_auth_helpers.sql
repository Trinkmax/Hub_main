-- Helpers para autenticación email + password y administración de equipo.
-- Agrega:
--   1) get_tenant_members(p_tenant): owner del tenant lista sus miembros con email/full_name
--   2) find_user_id_by_email(p_email): solo service_role (bypass de admin GoTrue API)

-- ──────────────────────────────────────────────────────────
-- 1. get_tenant_members: listado para la UI de Equipo
-- ──────────────────────────────────────────────────────────
create or replace function public.get_tenant_members(p_tenant uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  full_name text,
  role public.tenant_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.role = 'owner'
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    m.id,
    m.user_id,
    u.email::text,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', '')
    ) as full_name,
    m.role,
    m.created_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant
  order by m.created_at asc;
end;
$$;

revoke all on function public.get_tenant_members(uuid) from public, anon;
grant execute on function public.get_tenant_members(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- 2. find_user_id_by_email: SOLO para service_role.
--    Lo usa la server action que crea miembros con contraseña
--    para detectar si el email ya tiene cuenta y agregar la
--    membership sin pisarle la contraseña existente.
-- ──────────────────────────────────────────────────────────
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
