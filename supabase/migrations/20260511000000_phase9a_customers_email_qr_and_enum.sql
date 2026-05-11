-- Phase 9a: pedidos Nacho mayo 2026 (parte 1: extensiones simples)
-- a) customers.email + email_opt_in_at + único parcial por tenant
-- b) customers.qr_token + qr_token_generated_at + backfill + único global
-- c) punch_trigger_type += 'visit_window'  (debe commitearse antes de usarse)
-- d) bucket storage menu-images (mismo patrón que tenant-logos)

-- ──────────────────────────────────────────────────────────
-- a) Email
-- ──────────────────────────────────────────────────────────
alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists email_opt_in_at timestamptz;

create unique index if not exists customers_tenant_email_uidx
  on public.customers (tenant_id, lower(email))
  where email is not null and deleted_at is null;

-- ──────────────────────────────────────────────────────────
-- b) QR token personal del cliente
-- ──────────────────────────────────────────────────────────
alter table public.customers add column if not exists qr_token text;
alter table public.customers add column if not exists qr_token_generated_at timestamptz;

-- Backfill antes de NOT NULL
update public.customers
  set qr_token = encode(gen_random_bytes(16), 'hex'),
      qr_token_generated_at = now()
  where qr_token is null;

alter table public.customers
  alter column qr_token set default encode(gen_random_bytes(16), 'hex');
alter table public.customers
  alter column qr_token_generated_at set default now();

alter table public.customers alter column qr_token set not null;
alter table public.customers alter column qr_token_generated_at set not null;

create unique index if not exists customers_qr_token_uidx
  on public.customers (qr_token);

-- ──────────────────────────────────────────────────────────
-- c) Enum visit_window (para punch_card de almuerzos)
-- ──────────────────────────────────────────────────────────
alter type public.punch_trigger_type add value if not exists 'visit_window';

-- ──────────────────────────────────────────────────────────
-- d) Bucket menu-images
-- ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('menu-images', 'menu-images', true)
  on conflict (id) do update set public = excluded.public;

create policy "menu_images_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'menu-images');

create policy "menu_images_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "menu_images_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  )
  with check (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "menu_images_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );
