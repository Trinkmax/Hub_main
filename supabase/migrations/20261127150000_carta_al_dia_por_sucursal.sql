-- La carta al día también por sucursal (docs/features/carta-por-sucursal.md).
--
-- Desde que cada sucursal tiene su carta, lo que dice `menu_item_branches` (si un producto se vende en esa
-- sucursal y su precio propio) se ve en la carta pública. Cambiarlo en Carta → Precios tiene que actualizar
-- las cartas abiertas en los celulares igual que cualquier otro cambio de la carta: suben la versión del bar
-- (`menu_revisions`) los mismos disparadores por sentencia que ya tienen `menu_items` y `menu_categories`
-- (migración 20261115225854_menu_revisions). La tabla lleva `tenant_id`, así que sirve la misma función.

create trigger menu_item_branches_rev_ins after insert on public.menu_item_branches
  referencing new table as new_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_item_branches_rev_upd after update on public.menu_item_branches
  referencing new table as new_rows old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_item_branches_rev_del after delete on public.menu_item_branches
  referencing old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
