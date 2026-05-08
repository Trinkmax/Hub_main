-- Phase redesign-2026: storage bucket `tenant-logos` (público read, owner-only write).
-- Path convention: {tenant_id}/logo.{ext}
-- Replica el patrón de `event-covers` (phase4) y reusa user_role_in_tenant().

insert into storage.buckets (id, name, public)
  values ('tenant-logos', 'tenant-logos', true)
  on conflict (id) do update set public = excluded.public;

-- Lectura pública: el logo aparece en sidebar, login (futuro) y emails.
create policy "tenant_logos_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tenant-logos');

-- Escritura solo owner. El path empieza con {tenant_id}/.
create policy "tenant_logos_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tenant-logos'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "tenant_logos_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'tenant-logos'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  )
  with check (
    bucket_id = 'tenant-logos'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "tenant_logos_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tenant-logos'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );
