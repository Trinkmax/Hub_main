-- ============================================================
-- Migración: Carta — anidamiento ilimitado de categorías
-- ============================================================
-- adjacency list (parent_id self-ref). NULL = categoría raíz.
-- category_id de menu_items pasa a nullable: se usa para "archivar"
-- ítems con historial durante la cascada de borrado, sin romper el ledger.

-- 1. Columnas + índices ---------------------------------------
alter table public.menu_categories
  add column if not exists parent_id uuid
  references public.menu_categories(id) on delete cascade;

alter table public.menu_items
  alter column category_id drop not null;

drop index if exists public.menu_categories_tenant_pos_idx;
create index if not exists menu_categories_tenant_parent_pos_idx
  on public.menu_categories(tenant_id, parent_id, position);
create index if not exists menu_categories_roots_idx
  on public.menu_categories(tenant_id, position) where parent_id is null;
create index if not exists menu_categories_parent_idx
  on public.menu_categories(parent_id);

-- 2. reorder_menu_categories: reordena HERMANOS dentro de un padre.
--    Drop + create: cambia el nombre del parámetro (p_tenant_id → p_parent_id),
--    y CREATE OR REPLACE no permite renombrar parámetros en Postgres.
drop function if exists public.reorder_menu_categories(uuid, uuid[]);
create function public.reorder_menu_categories(
  p_parent_id uuid, p_ordered_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  i int;
begin
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    return;
  end if;
  -- Tenant derivado de las categorías (necesario porque p_parent_id puede ser NULL = raíz).
  select tenant_id into v_tenant
    from public.menu_categories where id = p_ordered_ids[1];
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_categories
      set position = i
      where id = p_ordered_ids[i]
        and tenant_id = v_tenant
        and parent_id is not distinct from p_parent_id;
  end loop;
end; $$;

-- 3. move_category: cambia parent_id con chequeo anti-ciclo.
create or replace function public.move_category(
  p_category_id uuid, p_new_parent_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
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
  if v_role is null or v_role <> 'owner' then
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
end; $$;

-- 4. delete_category_cascade: borra el subárbol; archiva ítems con historial.
create or replace function public.delete_category_cascade(
  p_category_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  v_subtree uuid[];
  v_deleted_items int := 0;
  v_archived_items int := 0;
  v_deleted_categories int := 0;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then
    raise exception 'category_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Subárbol (raíz + descendientes). El filtro por tenant en el paso recursivo
  -- hace explícita la invariante de aislamiento (parent_id siempre intra-tenant).
  with recursive subtree as (
    select id from public.menu_categories where id = p_category_id
    union all
    select c.id from public.menu_categories c join subtree s on c.parent_id = s.id
      and c.tenant_id = v_tenant
  )
  select array_agg(id) into v_subtree from subtree;

  -- Ítems referenciados en historial → archivar (no se pueden borrar físico).
  with refd as (
    select mi.id
    from public.menu_items mi
    where mi.category_id = any(v_subtree)
      and (
        exists (select 1 from public.visit_items vi where vi.menu_item_id = mi.id)
        or exists (select 1 from public.ticket_items ti where ti.menu_item_id = mi.id)
      )
  ), upd as (
    update public.menu_items mi
      set category_id = null, active = false
      from refd
      where mi.id = refd.id
      returning mi.id
  )
  select count(*) into v_archived_items from upd;

  -- Ítems libres → borrar físico (asignaciones de tags caen por on delete cascade).
  with del as (
    delete from public.menu_items mi
      where mi.category_id = any(v_subtree)
      returning mi.id
  )
  select count(*) into v_deleted_items from del;

  -- Borrar la raíz → descendientes caen por parent_id on delete cascade.
  delete from public.menu_categories where id = p_category_id and tenant_id = v_tenant;
  v_deleted_categories := coalesce(array_length(v_subtree, 1), 0);

  return jsonb_build_object(
    'deleted_categories', v_deleted_categories,
    'archived_items', v_archived_items,
    'deleted_items', v_deleted_items
  );
end; $$;

-- 5. GRANTs ---------------------------------------------------
grant execute on function public.reorder_menu_categories(uuid, uuid[]),
  public.move_category(uuid, uuid),
  public.delete_category_cascade(uuid) to authenticated;

-- 6. get_session_state: versión VIGENTE (la de 20260603120000, con image_url
--    por categoría + capture_prompt) + 'parent_id' por categoría para que el
--    cliente arme el árbol. Reproduce la función completa y agrega una línea.
create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_tenant_name text;
  v_tenant_logo_url text;
  v_tenant_settings jsonb;
  v_capture_prompt jsonb;
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int := 0;
  v_menu jsonb;
  v_my_tickets jsonb;
  v_welcome_reward jsonb;
  v_welcome_reward_redeemed jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null
     and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  select name, logo_url, settings
    into v_tenant_name, v_tenant_logo_url, v_tenant_settings
    from public.tenants where id = v_table.tenant_id;

  -- capture_prompt con defaults si la key no existe.
  v_capture_prompt := jsonb_build_object(
    'enabled', coalesce((v_tenant_settings->'capture_prompt'->>'enabled')::boolean, true),
    'headline', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'headline', ''),
      'Sumá puntos en cada visita'),
    'subtext', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'subtext', ''),
      'Dejá tu nombre y teléfono y empezá a ganar beneficios.')
  );

  select jsonb_build_object(
    'enabled', wrc.enabled,
    'reward_id', r.id,
    'name', r.name,
    'description', r.description,
    'image_url', r.image_url,
    'headline', wrc.headline,
    'subtext', wrc.subtext
  )
  into v_welcome_reward
  from public.welcome_reward_configs wrc
  left join public.rewards r
    on r.id = wrc.reward_id
    and r.tenant_id = wrc.tenant_id
    and r.active = true
  where wrc.tenant_id = v_table.tenant_id
    and wrc.enabled = true
    and r.id is not null
    and (r.stock is null or r.stock > 0);

  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is null then
    return jsonb_build_object(
      'is_activated', false,
      'tenant_id', v_table.tenant_id,
      'tenant_name', v_tenant_name,
      'tenant_logo_url', v_tenant_logo_url,
      'physical_table_id', v_table.id,
      'table_label', v_table.label,
      'welcome_reward', v_welcome_reward
    );
  end if;

  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session.id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session.id;

  -- Carta agrupada por categoría. image_url por categoría + parent_id (anidamiento).
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'parent_id', mc.parent_id,
      'image_url', mc.image_url,
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id,
        'name', mi.name,
        'description', mi.description,
        'price_cents', mi.price_cents,
        'image_url', mi.image_url,
        'position', mi.position,
        'featured', mi.featured,
        'points_override', mi.points_override,
        'tags', coalesce(
          (
            select jsonb_agg(jsonb_build_object(
              'id', it.id,
              'name', it.name,
              'color', it.color
            ) order by it.name)
            from public.menu_item_tag_assignments mita
            join public.item_tags it on it.id = mita.tag_id
            where mita.menu_item_id = mi.id
          ),
          '[]'::jsonb
        )
      ) order by mi.position) filter (where mi.id is not null and mi.active), '[]'::jsonb)
    ) as category
    from public.menu_categories mc
    left join public.menu_items mi
      on mi.category_id = mc.id and mi.tenant_id = v_table.tenant_id
    where mc.tenant_id = v_table.tenant_id and mc.active = true
    group by mc.id
  ) cats;

  if v_guest_id is not null then
    select coalesce(jsonb_agg(ticket order by ticket->>'submitted_at' desc), '[]'::jsonb)
    into v_my_tickets
    from (
      select jsonb_build_object(
        'id', t.id,
        'status', t.status,
        'submitted_at', t.submitted_at,
        'total_cents', t.total_cents,
        'cancellation_reason', t.cancellation_reason,
        'items', coalesce(jsonb_agg(jsonb_build_object(
          'id', ti.id,
          'menu_item_name', mi.name,
          'quantity', ti.quantity,
          'unit_price_cents', ti.unit_price_cents,
          'line_total_cents', ti.line_total_cents,
          'notes', ti.notes,
          'cancelled_at', ti.cancelled_at
        )), '[]'::jsonb)
      ) as ticket
      from public.tickets t
      left join public.ticket_items ti on ti.ticket_id = t.id
      left join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session.id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  if v_customer_id is not null then
    select jsonb_build_object(
      'reward_id', r.id,
      'name', r.name,
      'image_url', r.image_url,
      'redemption_id', wrg.redemption_id,
      'granted_at', wrg.granted_at,
      'status', rr.status
    )
    into v_welcome_reward_redeemed
    from public.welcome_reward_grants wrg
    join public.rewards r on r.id = wrg.reward_id
    join public.reward_redemptions rr on rr.id = wrg.redemption_id
    where wrg.customer_id = v_customer_id;
    v_welcome_reward := null;
  end if;

  return jsonb_build_object(
    'is_activated', true,
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'tenant_name', v_tenant_name,
    'tenant_logo_url', v_tenant_logo_url,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', false,
    'menu', v_menu,
    'my_tickets', v_my_tickets,
    'welcome_reward', v_welcome_reward,
    'welcome_reward_redeemed', v_welcome_reward_redeemed,
    'capture_prompt', v_capture_prompt
  );
end $$;

-- get_session_state ya estaba grant a anon, authenticated (Plan 1). CREATE OR
-- REPLACE preserva los grants; lo repetimos explícito por robustez (idempotente).
grant execute on function public.get_session_state(text, text) to anon, authenticated;
