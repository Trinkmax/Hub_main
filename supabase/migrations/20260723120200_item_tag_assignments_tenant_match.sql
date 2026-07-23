-- ══════════════════════════════════════════════════════════════════
-- Hardening: la asignación etiqueta↔ítem debe ser del MISMO tenant
-- ══════════════════════════════════════════════════════════════════
--
-- La policy mita_owner_write derivaba el tenant sólo del menu_item referenciado
-- y no validaba que el tag_id fuera del mismo tenant. Un miembro owner|editor
-- del tenant A podía insertar (item_A, tag_B) apuntando a una etiqueta de otro
-- tenant B (path: toggleTagOnMenuItem, que confía 100% en RLS). Como la carta
-- pública se lee con service_role (bypass RLS) y hace join a item_tags sin
-- filtrar por tenant, eso filtraba el nombre/color de una etiqueta ajena en la
-- carta de A. Cerramos el vector en la capa RLS: el with check ahora exige que
-- exista un item_tag con el MISMO tenant que el ítem. El using (delete/select)
-- mantiene sólo el check de rol sobre el tenant del ítem.

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
      join public.item_tags t on t.tenant_id = mi.tenant_id
      where mi.id = menu_item_tag_assignments.menu_item_id
        and t.id = menu_item_tag_assignments.tag_id
        and public.user_role_in_tenant(mi.tenant_id) in ('owner', 'editor')
    )
  );
