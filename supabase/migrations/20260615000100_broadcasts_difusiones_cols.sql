-- ============================================================
-- Difusiones MVP — variable_mapping + tracking de entrega por recipient
-- ============================================================
-- LEY: broadcasts/broadcast_recipients ya tienen RLS + GRANT (authenticated full /
-- recipients select-only). Las columnas nuevas quedan cubiertas — no requieren GRANT.
-- Idempotente. Correr `db:types` (MCP) después.
-- ============================================================

-- Mapeo de variables del template ({índice de param} -> origen + fallback).
alter table public.broadcasts
  add column if not exists variable_mapping jsonb not null default '{}'::jsonb;

-- Timestamps de entrega/lectura/respuesta por recipient.
alter table public.broadcast_recipients
  add column if not exists delivered_at timestamptz;
alter table public.broadcast_recipients
  add column if not exists read_at timestamptz;
alter table public.broadcast_recipients
  add column if not exists replied_at timestamptz;
