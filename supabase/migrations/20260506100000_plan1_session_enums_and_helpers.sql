-- Plan 1: enums + helpers para el modelo de sesiones de mesa
-- Sin tablas todavía — esta migración solo introduce primitivas reusables.

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────

-- Plan 1 solo necesita estos 4 estados; merged y abandoned vienen de specs futuros
-- pero los dejamos creados desde acá para no migrar el enum después.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'session_status') then
    create type public.session_status as enum (
      'open', 'paid', 'merged', 'abandoned'
    );
  end if;
end $$;

-- Plan 1 solo emite los eventos session_opened, guest_joined, guest_registered.
-- El resto los agregan planes posteriores.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'session_event_type') then
    create type public.session_event_type as enum (
      'session_opened',
      'guest_joined',
      'guest_registered',
      'bill_requested',
      'session_paid',
      'session_merged',
      'session_split',
      'session_abandoned',
      'session_moved'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. Helper: generate_qr_token
-- ──────────────────────────────────────────────────────────
-- Genera 16 chars URL-safe a partir de 12 bytes random.
-- Charset: a-z A-Z 0-9 (sin guiones ni símbolos para QR limpio).
create or replace function public.generate_qr_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_token text := '';
  v_idx int;
begin
  for i in 0..15 loop
    v_idx := (get_byte(v_bytes, i % 12) % 62) + 1;
    v_token := v_token || substring(v_alphabet from v_idx for 1);
  end loop;
  return v_token;
end $$;

revoke all on function public.generate_qr_token() from public;
grant execute on function public.generate_qr_token() to authenticated;

-- ──────────────────────────────────────────────────────────
-- 3. Trigger function: touch_session_guest_activity
-- ──────────────────────────────────────────────────────────
-- Se asocia al insert/update de filas que indican actividad del guest.
-- En Plan 1 no se usa todavía — preparado para que Plan 2 (tickets) lo conecte.
create or replace function public.touch_session_guest_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Caller debe pasar el guest_id en TG_ARGV[0] o en una columna específica.
  -- Implementación se completa en Plan 2 cuando se conecte a tickets.
  return new;
end $$;
