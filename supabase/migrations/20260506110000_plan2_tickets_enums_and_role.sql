-- Plan 2.a: agrega el rol 'kitchen' al enum tenant_role.
--
-- Postgres rechaza usar un valor de enum recién agregado en la misma
-- transacción donde se hizo ALTER TYPE ADD VALUE (SQLSTATE 55P04).
-- Esta migración SOLO agrega el valor; el helper que lo consume vive en
-- 20260506110001_plan2_ticket_status_and_kitchen_helper.sql.

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'kitchen'
      and enumtypid = 'public.tenant_role'::regtype
  ) then
    alter type public.tenant_role add value 'kitchen';
  end if;
end $$;
