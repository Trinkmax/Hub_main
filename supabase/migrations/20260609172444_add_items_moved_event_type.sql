-- Agrega el valor 'items_moved' al enum session_event_type.
-- Lo usa el RPC move_ticket_items (20260608200330) al emitir el evento de
-- movimiento de ítems en las sesiones origen y destino. Sin este valor, el
-- insert en table_session_events falla con 22P02 (invalid enum input).
-- Patrón idempotente igual a 'party_size_changed' / 'alias_changed'.

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.session_event_type'::regtype
      and enumlabel = 'items_moved'
  ) then
    alter type public.session_event_type add value 'items_moved';
  end if;
end $$;
