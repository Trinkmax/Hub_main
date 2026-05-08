-- Phase 4: storage bucket `event-covers` (público read, write owner-only)
-- Path convention: {tenant_id}/{event_id}/cover.{ext}

insert into storage.buckets (id, name, public)
  values ('event-covers', 'event-covers', true)
  on conflict (id) do update set public = excluded.public;

-- Lectura pública (lo que sube el bucket público igual queda permisivo,
-- pero dejamos policy explícita por claridad).
create policy "event_covers_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'event-covers');

-- Escritura: solo owner del tenant. El path empieza con {tenant_id}/.
-- Validamos que ese tenant_id de la primera carpeta es uno donde el caller es owner.
create policy "event_covers_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-covers'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "event_covers_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'event-covers'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  )
  with check (
    bucket_id = 'event-covers'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );

create policy "event_covers_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-covers'
    and public.user_role_in_tenant(
      (string_to_array(name, '/'))[1]::uuid
    ) = 'owner'
  );
