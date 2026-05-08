-- Plan 1: table_session_events — mini ledger de eventos para auditoría y realtime.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.table_session_events (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  type                  public.session_event_type not null,
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index table_session_events_session_idx
  on public.table_session_events(session_id, created_at desc);
create index table_session_events_type_idx
  on public.table_session_events(type, created_at desc);

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.table_session_events enable row level security;

create policy "tse_select_member" on public.table_session_events
  for select to authenticated
  using (
    exists (
      select 1 from public.table_sessions ts
      where ts.id = session_id
        and ts.tenant_id in (select public.user_tenant_ids())
    )
  );

-- Insert solo via RPC. Sin update ni delete (ledger inmutable).

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.table_session_events to authenticated;
