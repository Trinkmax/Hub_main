-- ══════════════════════════════════════════════════════════════════
-- Los RPC de orden/movimiento de carta pasan de owner-only a owner|editor
-- ══════════════════════════════════════════════════════════════════
--
-- reorder_menu_items, reorder_menu_categories y move_category chequeaban
-- v_role <> 'owner' y rechazaban a la diseñadora (rol editor) con "forbidden"
-- → en la UI aparecía "No pudimos reordenar." / "No pudimos mover la categoría."
-- Las policies de tabla de menu_items/menu_categories y MENU_EDIT_ROLES ya
-- habilitan owner|editor a escribir; alineamos estos RPC al mismo criterio.
-- El resto de la lógica queda idéntica.

create or replace function public.reorder_menu_items(p_category_id uuid, p_ordered_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  i int;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then raise exception 'category_not_found' using errcode = 'P0001'; end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_items
      set position = i
      where id = p_ordered_ids[i] and category_id = p_category_id;
  end loop;
end; $function$;

create or replace function public.reorder_menu_categories(p_parent_id uuid, p_ordered_ids uuid[])
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  i int;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;
  select tenant_id into v_tenant
    from public.menu_categories where id = p_ordered_ids[1];
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_categories
      set position = i
      where id = p_ordered_ids[i]
        and tenant_id = v_tenant
        and parent_id is not distinct from p_parent_id;
  end loop;
end; $function$;

create or replace function public.move_category(p_category_id uuid, p_new_parent_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  v_parent_tenant uuid;
  v_max_pos int;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_new_parent_id is not null then
    if p_new_parent_id = p_category_id then
      raise exception 'cycle' using errcode = 'P0001';
    end if;
    select tenant_id into v_parent_tenant from public.menu_categories where id = p_new_parent_id;
    if v_parent_tenant is null or v_parent_tenant <> v_tenant then
      raise exception 'invalid_parent' using errcode = 'P0001';
    end if;
    -- Anti-ciclo: el nuevo padre NO puede ser descendiente de la categoría movida.
    if exists (
      with recursive descendants as (
        select id from public.menu_categories where parent_id = p_category_id
        union all
        select c.id from public.menu_categories c
          join descendants d on c.parent_id = d.id
      )
      select 1 from descendants where id = p_new_parent_id
    ) then
      raise exception 'cycle' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(max(position), 0) into v_max_pos
    from public.menu_categories
    where tenant_id = v_tenant and parent_id is not distinct from p_new_parent_id;
  update public.menu_categories
    set parent_id = p_new_parent_id, position = v_max_pos + 1
    where id = p_category_id and tenant_id = v_tenant;
end; $function$;
