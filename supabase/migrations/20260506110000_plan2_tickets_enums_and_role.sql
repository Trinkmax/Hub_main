-- Plan 2: enums + rol kitchen.

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
-- 2. Sumar 'kitchen' al enum tenant_role existente
-- ──────────────────────────────────────────────────────────
-- Postgres no permite alterar enums usados en check constraints o RLS sin
-- pasos extra. alter type ... add value es seguro a partir de PG 12.
do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'kitchen'
      and enumtypid = 'public.tenant_role'::regtype
  ) then
    alter type public.tenant_role add value 'kitchen';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 3. Helper: user_has_kitchen_role
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
