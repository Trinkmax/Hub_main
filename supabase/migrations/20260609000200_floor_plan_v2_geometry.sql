-- ============================================================
-- Floor Plan v2 — geometría + realtime del plano
-- ============================================================
-- 1) corner_radius: redondeo del cuerpo de mesas/decoración (rounded-rect).
-- 2) CHECK de rotation (0..359): la columna ya existía (default 0, sin check);
--    todos los valores actuales son 0, así que el constraint es seguro.
-- 3) Publica floor_plan_elements / floor_plan_areas en supabase_realtime para
--    que la vista En vivo refleje colocaciones/rotaciones del dueño sin esperar
--    un session-event.
--
-- LEY: la tabla floor_plan_elements ya tiene RLS + GRANTs
-- (grant select,insert,update,delete to authenticated) → las columnas nuevas
-- quedan cubiertas, no requieren GRANT. RLS sin cambios; realtime respeta las
-- policies SELECT existentes (anon no tiene policy → nunca recibe eventos).
-- Idempotente (apply_migration sin Docker local). Correr `npm run db:types`.
-- ============================================================

-- 1) corner_radius (rounded-rect del cuerpo). add column if not exists = idempotente.
alter table public.floor_plan_elements
  add column if not exists corner_radius int not null default 0
    check (corner_radius between 0 and 200);

-- 2) CHECK de rotation (add constraint no es idempotente nativo → guarda).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fpe_rotation_range'
      and conrelid = 'public.floor_plan_elements'::regclass
  ) then
    alter table public.floor_plan_elements
      add constraint fpe_rotation_range check (rotation between 0 and 359);
  end if;
end $$;

-- 3) Realtime del plano (espejo idempotente de 20260606000100_realtime_salon_publication).
do $$ begin
  begin
    alter publication supabase_realtime add table public.floor_plan_elements;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.floor_plan_areas;
  exception when duplicate_object then null; end;
end $$;
