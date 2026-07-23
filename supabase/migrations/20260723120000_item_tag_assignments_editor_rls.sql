-- ══════════════════════════════════════════════════════════════════
-- Fix: el rol `editor` puede etiquetar ítems de la carta
-- ══════════════════════════════════════════════════════════════════
--
-- La migración 20260716120100_editor_host_permissions_menu_video amplió a
-- owner|editor las policies de escritura de menu_categories, menu_items e
-- item_tags — pero se olvidó de la tabla join menu_item_tag_assignments, que
-- quedó owner-only. Resultado: un `editor` podía crear etiquetas pero al
-- asignarlas a un ítem el INSERT lo rechazaba RLS ("no me deja ponerlas en
-- los productos"). MENU_EDIT_ROLES = ['owner','editor'] y el server action ya
-- autoriza a ambos, así que la única barrera era esta policy.
--
-- La policy es ALL (cubre insert/update/delete). El tenant se deriva del ítem
-- referenciado (la tabla join no tiene tenant_id propio).

alter policy "mita_owner_write" on public.menu_item_tag_assignments
  using (
    exists (
      select 1
      from public.menu_items mi
      where mi.id = menu_item_tag_assignments.menu_item_id
        and public.user_role_in_tenant(mi.tenant_id) in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.menu_items mi
      where mi.id = menu_item_tag_assignments.menu_item_id
        and public.user_role_in_tenant(mi.tenant_id) in ('owner', 'editor')
    )
  );
