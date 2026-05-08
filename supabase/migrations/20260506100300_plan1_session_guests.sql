-- Plan 1: session_guests — celulares conectados a la sesión, identificados por browser_token.

-- ──────────────────────────────────────────────────────────
-- 1. Tabla
-- ──────────────────────────────────────────────────────────
create table public.session_guests (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.table_sessions(id) on delete cascade,
  browser_token       text not null check (length(browser_token) between 16 and 64),
  display_name        text check (display_name is null or length(trim(display_name)) between 1 and 40),
  customer_id         uuid references public.customers(id) on delete set null,
  joined_at           timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- Un browser_token único por sesión: cada celular es un slot.
create unique index session_guests_token_uidx
  on public.session_guests(session_id, browser_token);

create index session_guests_session_idx
  on public.session_guests(session_id, joined_at desc);
create index session_guests_customer_idx
  on public.session_guests(customer_id) where customer_id is not null;
create index session_guests_activity_idx
  on public.session_guests(last_activity_at);

-- ──────────────────────────────────────────────────────────
-- 2. RLS
-- ──────────────────────────────────────────────────────────
alter table public.session_guests enable row level security;

create policy "sg_select_member" on public.session_guests
  for select to authenticated
  using (
    exists (
      select 1 from public.table_sessions ts
      where ts.id = session_id
        and ts.tenant_id in (select public.user_tenant_ids())
    )
  );

-- Sin policies de write para authenticated. Solo via RPC SECURITY DEFINER.

-- ──────────────────────────────────────────────────────────
-- 3. GRANTs
-- ──────────────────────────────────────────────────────────
grant select on public.session_guests to authenticated;
