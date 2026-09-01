-- ============================================================
-- Formatos de evento: el anfitrión (host) también los edita
-- ============================================================
-- Luz gestiona reservas y eventos con rol `host`. Podía CREAR formatos
-- (policy `set_staff_insert`, que ya incluye host desde 20260716120100) pero
-- no verlos ni corregirlos: el editor del catálogo estaba escondido detrás de
-- un gate owner-only en la UI y el UPDATE lo bloqueaba `set_owner_write`.
-- Crear sin poder arreglar un typo no es una capacidad usable.
--
-- Decisión del dueño: host crea Y edita formatos. Borrar sigue siendo del owner
-- (hoy ni siquiera existe una action de borrado; `set_owner_write` lo cubre).
--
-- Las policies se combinan con OR, así que esto solo AGREGA UPDATE a host;
-- el owner ya podía por `set_owner_write` (for all).

drop policy if exists "set_host_update" on public.scheduled_event_templates;

create policy "set_host_update" on public.scheduled_event_templates
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'host'))
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'host'));

notify pgrst, 'reload schema';
