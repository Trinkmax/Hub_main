-- Permite que staff (owner + cashier) cree formatos (scheduled_event_templates)
-- desde el alta de reservas. La edición/borrado siguen siendo solo-owner
-- (policy existente `set_owner_write`). Las policies RLS se combinan con OR,
-- así que esto solo AGREGA capacidad de INSERT a cashier; owner ya podía.
-- El GRANT a `authenticated` ya existe en la migración core.

drop policy if exists "set_staff_insert" on public.scheduled_event_templates;

create policy "set_staff_insert" on public.scheduled_event_templates
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
