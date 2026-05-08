-- Phase 2: customers + capture (QR público)
-- Tablas: customers, customer_tags, customer_tag_assignments,
--         customer_capture_links, customer_capture_submissions
-- RPC: submit_capture (anon, atómico, dedupe por phone)
-- RLS: aislamiento por membresía + select público en links activos

-- ──────────────────────────────────────────────────────────
-- 1. Extensiones
-- ──────────────────────────────────────────────────────────
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ──────────────────────────────────────────────────────────
-- 2. Wrapper IMMUTABLE para indexar con unaccent
-- ──────────────────────────────────────────────────────────
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select public.unaccent('public.unaccent', $1) $$;

-- ──────────────────────────────────────────────────────────
-- 3. Enum customer_source
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'customer_source') then
    create type public.customer_source as enum ('qr', 'manual', 'import');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 4. Tablas
-- ──────────────────────────────────────────────────────────

-- 4.1 customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  first_name text not null,
  last_name text not null,
  birthdate date check (birthdate is null or birthdate > '1900-01-01'),
  opt_in_marketing boolean not null default false,
  opt_in_at timestamptz,
  opt_in_ip text,
  source public.customer_source not null default 'manual',
  notes text,
  last_visit_at timestamptz,
  total_visits integer not null default 0 check (total_visits >= 0),
  total_spent_cents bigint not null default 0 check (total_spent_cents >= 0),
  points_balance integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_tenant_phone_uidx
  on public.customers(tenant_id, phone) where deleted_at is null;
create index customers_tenant_created_idx
  on public.customers(tenant_id, created_at desc);
create index customers_tenant_last_visit_idx
  on public.customers(tenant_id, last_visit_at desc nulls last);
create index customers_name_trgm_idx on public.customers using gin (
  (lower(public.f_unaccent(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))))
  gin_trgm_ops
);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- 4.2 customer_tags
create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  color text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index customer_tags_tenant_idx on public.customer_tags(tenant_id);

-- 4.3 customer_tag_assignments
create table public.customer_tag_assignments (
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id uuid not null references public.customer_tags(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (customer_id, tag_id)
);
create index customer_tag_assignments_tag_idx
  on public.customer_tag_assignments(tag_id);

-- 4.4 customer_capture_links
create table public.customer_capture_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-zA-Z0-9_-]{4,32}$'),
  label text not null check (length(trim(label)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index customer_capture_links_tenant_idx
  on public.customer_capture_links(tenant_id);

-- 4.5 customer_capture_submissions
create table public.customer_capture_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  link_id uuid not null references public.customer_capture_links(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  phone text not null,
  first_name text not null,
  last_name text not null,
  opt_in_marketing boolean not null default false,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index customer_capture_submissions_tenant_created_idx
  on public.customer_capture_submissions(tenant_id, created_at desc);
create index customer_capture_submissions_link_idx
  on public.customer_capture_submissions(link_id, created_at desc);

-- ──────────────────────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────────────────────

-- 5.1 customers
alter table public.customers enable row level security;

create policy "customers_select_member" on public.customers
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

create policy "customers_insert_member" on public.customers
  for insert to authenticated
  with check (tenant_id in (select public.user_tenant_ids()));

create policy "customers_update_member" on public.customers
  for update to authenticated
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

create policy "customers_delete_owner" on public.customers
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 5.2 customer_tags (members all)
alter table public.customer_tags enable row level security;

create policy "ct_member_all" on public.customer_tags
  for all to authenticated
  using (tenant_id in (select public.user_tenant_ids()))
  with check (tenant_id in (select public.user_tenant_ids()));

-- 5.3 customer_tag_assignments (lookup join — chequea que tag y customer
--     pertenezcan al mismo tenant, accesible para el caller)
alter table public.customer_tag_assignments enable row level security;

create policy "cta_member_all" on public.customer_tag_assignments
  for all to authenticated
  using (
    exists (
      select 1 from public.customers c
      join public.customer_tags t on t.tenant_id = c.tenant_id
      where c.id = customer_id
        and t.id = tag_id
        and c.tenant_id in (select public.user_tenant_ids())
    )
  )
  with check (
    exists (
      select 1 from public.customers c
      join public.customer_tags t on t.tenant_id = c.tenant_id
      where c.id = customer_id
        and t.id = tag_id
        and c.tenant_id in (select public.user_tenant_ids())
    )
  );

-- 5.4 customer_capture_links (members CRUD + anon active select)
alter table public.customer_capture_links enable row level security;

create policy "ccl_member_select" on public.customer_capture_links
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

create policy "ccl_owner_insert" on public.customer_capture_links
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "ccl_owner_update" on public.customer_capture_links
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "ccl_owner_delete" on public.customer_capture_links
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

create policy "ccl_anon_active_select" on public.customer_capture_links
  for select to anon
  using (active = true);

-- 5.5 customer_capture_submissions (insert solo via RPC submit_capture)
alter table public.customer_capture_submissions enable row level security;

create policy "ccs_member_select" on public.customer_capture_submissions
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

create policy "ccs_owner_delete" on public.customer_capture_submissions
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- 6. RPC submit_capture (anon, SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────
create or replace function public.submit_capture(
  p_link_slug text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_opt_in boolean,
  p_ip text,
  p_user_agent text
) returns table(customer_id uuid, was_new boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.customer_capture_links;
  v_existing public.customers;
  v_customer_id uuid;
  v_was_new boolean := false;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
begin
  -- 0. Cinturón: validación mínima (la fuerte vive en TS antes de esta RPC)
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_last) = 0 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;

  -- 1. Resolver link y validar active
  select * into v_link from public.customer_capture_links
    where slug = p_link_slug and active = true;
  if v_link.id is null then
    raise exception 'invalid_or_inactive_link' using errcode = 'P0001';
  end if;

  -- 2. Dedupe por (tenant_id, phone) where deleted_at is null
  select * into v_existing from public.customers
    where tenant_id = v_link.tenant_id
      and phone = v_phone
      and deleted_at is null
    for update;

  if v_existing.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, source,
      opt_in_marketing, opt_in_at, opt_in_ip
    ) values (
      v_link.tenant_id, v_phone, v_first, v_last, 'qr',
      p_opt_in,
      case when p_opt_in then now() else null end,
      case when p_opt_in then p_ip else null end
    ) returning id into v_customer_id;
    v_was_new := true;
  else
    update public.customers set
      first_name = case
        when coalesce(first_name, '') = '' then v_first
        else first_name
      end,
      last_name = case
        when coalesce(last_name, '') = '' then v_last
        else last_name
      end,
      opt_in_marketing = opt_in_marketing or p_opt_in,
      opt_in_at = case
        when not opt_in_marketing and p_opt_in then now()
        else opt_in_at
      end,
      opt_in_ip = case
        when not opt_in_marketing and p_opt_in then p_ip
        else opt_in_ip
      end
    where id = v_existing.id;
    v_customer_id := v_existing.id;
  end if;

  -- 3. Insert submission con FK al customer (datos crudos para auditoría)
  insert into public.customer_capture_submissions (
    tenant_id, link_id, customer_id, phone, first_name, last_name,
    opt_in_marketing, ip, user_agent
  ) values (
    v_link.tenant_id, v_link.id, v_customer_id,
    v_phone, v_first, v_last,
    p_opt_in, p_ip, p_user_agent
  );

  return query select v_customer_id, v_was_new;
end; $$;

revoke all on function public.submit_capture(text, text, text, text, boolean, text, text) from public;
grant execute on function public.submit_capture(text, text, text, text, boolean, text, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- 7. GRANTs Data API (obligatorio post 30/05/2026)
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.customer_tags to authenticated;
grant select, insert, update, delete on public.customer_tag_assignments to authenticated;
grant select, insert, update, delete on public.customer_capture_links to authenticated;
grant select on public.customer_capture_links to anon;
grant select, delete on public.customer_capture_submissions to authenticated;
-- NO grant insert a anon en submissions: la única vía es submit_capture()
