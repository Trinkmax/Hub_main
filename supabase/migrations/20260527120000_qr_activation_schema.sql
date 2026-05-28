-- QR Activation by Waiter — schema changes.
--
-- Cambios:
--   1. tenants.total_seats          → capacidad declarativa del bar (nullable).
--   2. table_sessions.party_size    → comensales declarados por el mozo al activar.
--   3. enum session_event_type      → nuevo valor 'party_size_changed'.
--
-- No rompe data existente: ambas columnas nullable, sesiones legacy quedan con
-- party_size = NULL y no aportan a ocupación.

-- ──────────────────────────────────────────────────────────
-- 1. tenants.total_seats
-- ──────────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists total_seats int
  check (total_seats is null or total_seats > 0);

comment on column public.tenants.total_seats is
  'Capacidad total declarada del bar (flexible). NULL = no declarada, no se calcula ocupación relativa.';

-- ──────────────────────────────────────────────────────────
-- 2. table_sessions.party_size
-- ──────────────────────────────────────────────────────────
-- Mantengo nullable para no romper sesiones legacy. Las nuevas sesiones se crean
-- vía RPC activate_table_session, que valida >= 1 antes de insertar.
alter table public.table_sessions
  add column if not exists party_size int
  check (party_size is null or party_size > 0);

comment on column public.table_sessions.party_size is
  'Cantidad de comensales declarada por el mozo al activar. No es cap — más guests pueden conectarse y pedir.';

-- ──────────────────────────────────────────────────────────
-- 3. session_event_type: + party_size_changed
-- ──────────────────────────────────────────────────────────
-- Postgres permite ADD VALUE dentro de una transacción siempre que el nuevo
-- valor no se use en la misma transacción. La próxima migración (RPCs) lo usa,
-- y para entonces ya estará commiteado.
do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.session_event_type'::regtype
      and enumlabel = 'party_size_changed'
  ) then
    alter type public.session_event_type add value 'party_size_changed';
  end if;
end $$;
