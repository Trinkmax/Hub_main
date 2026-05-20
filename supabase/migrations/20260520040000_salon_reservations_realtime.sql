-- ============================================================
-- Habilitar Realtime publication para reservas de salón
-- ============================================================
-- El panel operativo escucha cambios en estas dos tablas vía
-- supabase-js channels. commission_ledger NO va en Realtime (info de plata).

-- alter publication es idempotente solo si la tabla no está ya en el set.
-- Usamos do$$ con catch para no romper si ya existen.
do $$ begin
  begin
    alter publication supabase_realtime add table public.salon_reservations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.scheduled_events;
  exception when duplicate_object then null;
  end;
end $$;
