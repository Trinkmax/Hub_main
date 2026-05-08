-- Plan 2.b: enum ticket_status + helper user_has_kitchen_role.
--
-- Separado de 20260506110000 porque user_has_kitchen_role consume el
-- valor 'kitchen' de tenant_role, y Postgres no permite usar un valor
-- de enum nuevo en la misma transacción donde se agregó (SQLSTATE 55P04).

-- ──────────────────────────────────────────────────────────
-- 1. Enum ticket_status
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. Helper: user_has_kitchen_role
-- ──────────────────────────────────────────────────────────
create or replace function public.user_has_kitchen_role(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
      and role in ('owner', 'kitchen')
  )
$$;

revoke all on function public.user_has_kitchen_role(uuid) from public;
grant execute on function public.user_has_kitchen_role(uuid) to authenticated;
