-- ══════════════════════════════════════════════════════════════════
-- Permisos de los roles nuevos + soporte de video en la carta
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Carta: escribir menu_categories / menu_items / item_tags pasa
--       de owner-only a owner|editor (la diseñadora carga la carta).
alter policy "mc_owner_insert" on public.menu_categories
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "mc_owner_update" on public.menu_categories
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "mc_owner_delete" on public.menu_categories
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'));

alter policy "mi_owner_insert" on public.menu_items
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "mi_owner_update" on public.menu_items
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "mi_owner_delete" on public.menu_items
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'));

alter policy "it_owner_insert" on public.item_tags
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "it_owner_update" on public.item_tags
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','editor'));
alter policy "it_owner_delete" on public.item_tags
  using (public.user_role_in_tenant(tenant_id) in ('owner','editor'));

-- ── 2. Storage menu-images: el editor sube/reemplaza/borra media de su tenant
--       (el path arranca con {tenant_id}/, igual que hoy).
alter policy "menu_images_owner_insert" on storage.objects
  with check (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) in ('owner','editor')
  );
alter policy "menu_images_owner_update" on storage.objects
  using (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) in ('owner','editor')
  )
  with check (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) in ('owner','editor')
  );
alter policy "menu_images_owner_delete" on storage.objects
  using (
    bucket_id = 'menu-images'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) in ('owner','editor')
  );

-- ── 3. Reservas + eventos: host opera como el staff de reservas.
alter policy "sr_staff_write" on public.salon_reservations
  using (public.user_role_in_tenant(tenant_id) in ('owner','cashier','host'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','cashier','host'));

alter policy "sev_staff_write" on public.scheduled_events
  using (public.user_role_in_tenant(tenant_id) in ('owner','cashier','host'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner','cashier','host'));

alter policy "set_staff_insert" on public.scheduled_event_templates
  with check (public.user_role_in_tenant(tenant_id) in ('owner','cashier','host'));

-- ── 4. Comisiones: cada gestor vinculado (reservation_managers.user_id)
--       puede LEER sus propias entradas del ledger (el owner ya ve todo).
create policy "cl_manager_self_select" on public.commission_ledger
  for select to authenticated
  using (
    exists (
      select 1 from public.reservation_managers rm
      where rm.id = commission_ledger.manager_id
        and rm.tenant_id = commission_ledger.tenant_id
        and rm.user_id = (select auth.uid())
    )
  );

-- ── 5. Video en la carta: una URL por ítem (mismo bucket menu-images).
alter table public.menu_items add column if not exists video_url text;

-- ── 6. Hardening del bucket: límite de tamaño (60 MB por objeto, pensado
--       para clips cortos) y allowlist de MIME de lo que la app realmente
--       sube (el uploader convierte HEIC→webp/avif/jpeg antes de subir).
update storage.buckets
   set file_size_limit = 62914560,
       allowed_mime_types = array[
         'image/webp','image/avif','image/jpeg','image/png',
         'video/mp4','video/webm','video/quicktime'
       ]
 where id = 'menu-images';
