-- ══════════════════════════════════════════════════════════════════
-- RPC: mover varios ítems de la carta a otra categoría (bulk)
-- ══════════════════════════════════════════════════════════════════
--
-- Hasta ahora sólo se podía mover UN ítem (editando category_id en el editor)
-- o una categoría entera (move_category). Esto permite mover N ítems de una o
-- varias categorías a una categoría destino en una sola operación atómica,
-- preservando el orden en que llegaron y anexándolos al final del destino.
--
-- SECURITY DEFINER + guardas manuales (tenant + rol) como el resto de RPCs de
-- carta (move_category, reorder_menu_items). A diferencia de esos, acá se
-- habilita owner|editor: la carta la carga la diseñadora (rol editor) y las
-- policies de menu_items ya permiten owner|editor escribir.
--
-- El orden se preserva vía WITH ORDINALITY; se deduplican ids repetidos y se
-- filtran ítems de otro tenant (defensa en profundidad además del check de rol).
-- updated_at lo setea el trigger menu_items_updated_at. Devuelve cuántos ítems
-- se movieron efectivamente.

create or replace function public.move_menu_items(
  p_item_ids uuid[],
  p_target_category_id uuid
) returns integer
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant  uuid;
  v_role    public.tenant_role;
  v_max_pos int;
  v_count   int;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return 0;
  end if;

  -- Tenant derivado de la categoría destino.
  select tenant_id into v_tenant
    from public.menu_categories
    where id = p_target_category_id;
  if v_tenant is null then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Base de posición: al final de la categoría destino.
  select coalesce(max(position), 0) into v_max_pos
    from public.menu_items
    where category_id = p_target_category_id;

  with input as (
    select id, min(ord) as ord
    from unnest(p_item_ids) with ordinality as u(id, ord)
    group by id
  ),
  ordered as (
    select i.id, row_number() over (order by i.ord) as rn
    from input i
    join public.menu_items mi on mi.id = i.id and mi.tenant_id = v_tenant
  )
  update public.menu_items mi
     set category_id = p_target_category_id,
         position    = v_max_pos + o.rn
    from ordered o
   where mi.id = o.id
     and mi.tenant_id = v_tenant;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.move_menu_items(uuid[], uuid) from public, anon;
grant execute on function public.move_menu_items(uuid[], uuid) to authenticated;
