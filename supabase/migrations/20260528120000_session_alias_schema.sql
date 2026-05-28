-- Session alias — schema changes.
--
-- Cambios:
--   1. table_sessions.alias     → nombre opcional del grupo (ej. "Cumple de Juan")
--   2. session_event_type       → nuevo valor 'alias_changed'

alter table public.table_sessions
  add column if not exists alias text
  check (alias is null or length(trim(alias)) between 1 and 60);

comment on column public.table_sessions.alias is
  'Nombre opcional del grupo que ocupa la mesa (p.ej. "Cumple de Juan"). NULL = no se muestra alias, se cae al label de la mesa.';

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.session_event_type'::regtype
      and enumlabel = 'alias_changed'
  ) then
    alter type public.session_event_type add value 'alias_changed';
  end if;
end $$;
