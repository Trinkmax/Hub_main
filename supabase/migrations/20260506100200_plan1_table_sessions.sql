-- Plan 1: table_sessions — la primitiva central, el grupo de gente que se sienta.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.table_sessions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  physical_table_id   uuid references public.physical_tables(id) on delete set null,
  status              public.session_status not null default 'open',
  opened_at           timestamptz not null default now(),
  paid_at             timestamptz,
  merged_into         uuid references public.table_sessions(id) on delete set null,
  abandoned_reason    text,
  opened_by           uuid references auth.users(id) on delete set null,
  total_cents         bigint not null default 0 check (total_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Coherencia de timestamps por estado:
  check (
    (status = 'open' and paid_at is null and merged_into is null and abandoned_reason is null)
    or (status = 'paid' and paid_at is not null and merged_into is null and abandoned_reason is null)
    or (status = 'merged' and merged_into is not null)
    or (status = 'abandoned' and abandoned_reason is not null)
  )
);

-- Una sesión open por mesa a la vez.
create unique index table_sessions_one_open_per_table_uidx
  on public.table_sessions(physical_table_id)
  where status = 'open' and physical_table_id is not null;

create index table_sessions_tenant_status_idx
  on public.table_sessions(tenant_id, status, opened_at desc);
create index table_sessions_physical_table_idx
  on public.table_sessions(physical_table_id, opened_at desc);

create trigger table_sessions_updated_at before update on public.table_sessions
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.table_sessions enable row level security;

-- SELECT: cualquier miembro del tenant.
create policy "ts_select_member" on public.table_sessions
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- INSERT/UPDATE/DELETE: prohibidos a authenticated. Solo via RPCs SECURITY DEFINER.
-- (No se crean policies de write — RLS bloquea sin policy.)

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.table_sessions to authenticated;
-- INSERT/UPDATE/DELETE no se grantean: bloqueados por RLS y solo accesibles via RPC.
