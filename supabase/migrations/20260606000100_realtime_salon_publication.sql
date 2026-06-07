-- ============================================================
-- Habilitar Realtime publication para tablas del salón operativo
-- ============================================================
-- Arregla el bug verificado: table_sessions / tickets / ticket_items /
-- table_session_events NO estaban en supabase_realtime, por lo que las
-- suscripciones del staff solo recibían eventos por el safety-net de 30s.
--
-- Patrón idempotente (espejo de 20260520040000_salon_reservations_realtime).
-- RLS no cambia: realtime respeta las políticas SELECT existentes; solo
-- 'authenticated' (staff/dueño) recibe — 'anon' (comensal) no tiene policy.
-- replica identity DEFAULT alcanza (los filtros usan PK / tenant_id / session_id
-- presentes en NEW).
-- db:types NO es necesario (no cambian tablas, columnas ni enums).

do $$
begin
  begin
    alter publication supabase_realtime add table public.table_sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tickets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.ticket_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.table_session_events;
  exception when duplicate_object then null;
  end;
end $$;
