-- ============================================================
-- Floor plan editor — RPCs estructurales fp_*
-- ============================================================
-- Gestión de mesas-QP (physical_tables) y áreas desde el canvas del editor.
-- Convención (espejo de regenerate_qr_token / merge_sessions):
--   * language plpgsql security definer set search_path = ''
--   * identificadores 100% schema-qualified
--   * v_tenant resuelto desde la fila; owner check vía user_role_in_tenant
--     (raise 'owner_required' errcode '42501')
--   * guarda de sesión abierta atómica con FOR UPDATE
--     (raise 'table_has_open_session' errcode 'P0001')
--   * revoke all from public; grant execute to authenticated
-- Los RPC NO escriben audit_log: la auditoría se hace en la capa TS
-- (lib/floor-plan/actions.ts con logAudit) tras el RPC OK.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- fp_create_table
-- ──────────────────────────────────────────────────────────
-- Crea una physical_table (qr_token por default) + su floor_plan_element
-- (kind='table', z=10, width/height = defaults de 'table' = 80x80) en una
-- transacción. Resuelve el tenant desde el área. Owner-only.
-- Devuelve {table_id, element_id, qr_token}.
create or replace function public.fp_create_table(
  p_area_id  uuid,
  p_label    text,
  p_capacity int,
  p_shape    public.floor_element_shape,
  p_x        int,
  p_y        int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant     uuid;
  v_role       text;
  v_clean      text;
  v_table_id   uuid;
  v_element_id uuid;
  v_qr_token   text;
begin
  -- 1. Resolver tenant desde el área
  select tenant_id into v_tenant
    from public.floor_plan_areas
    where id = p_area_id;
  if v_tenant is null then
    raise exception 'area_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check sobre el tenant del área
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Validar label
  v_clean := nullif(trim(coalesce(p_label, '')), '');
  if v_clean is null or length(v_clean) > 40 then
    raise exception 'invalid_label' using errcode = 'P0001';
  end if;

  -- 4. Insertar la mesa (qr_token por default)
  insert into public.physical_tables (tenant_id, label, capacity)
    values (v_tenant, v_clean, p_capacity)
    returning id, qr_token into v_table_id, v_qr_token;

  -- 5. Insertar su elemento en el plano (kind='table', z=10, 80x80)
  --    El trigger fp_elements_integrity valida tenant + mesa activa.
  insert into public.floor_plan_elements (
    tenant_id, area_id, kind, shape, physical_table_id,
    x, y, width, height, z_index
  ) values (
    v_tenant, p_area_id, 'table', p_shape, v_table_id,
    p_x, p_y, 80, 80, 10
  ) returning id into v_element_id;

  return jsonb_build_object(
    'table_id',   v_table_id,
    'element_id', v_element_id,
    'qr_token',   v_qr_token
  );
end $$;

revoke all on function public.fp_create_table(uuid, text, int, public.floor_element_shape, int, int) from public;
grant execute on function public.fp_create_table(uuid, text, int, public.floor_element_shape, int, int) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_merge_tables
-- ──────────────────────────────────────────────────────────
-- Combina dos mesas-QR: la absorbida pasa a active=false (soft, conserva
-- historial) y se le borra el floor_plan_element. La sobreviviente conserva
-- su QR y su elemento. Guarda atómica: si la absorbida tiene sesión abierta,
-- raise 'table_has_open_session'. Owner-only.
-- Devuelve {ok:true}.
create or replace function public.fp_merge_tables(
  p_survivor_table_id uuid,
  p_absorbed_table_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant          uuid;
  v_role            text;
  v_survivor_tenant uuid;
begin
  -- 1. Lock pesimista sobre la mesa absorbida + resolver su tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_absorbed_table_id
    for update;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check sobre el tenant de la absorbida
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Mismo-tenant que la sobreviviente
  select tenant_id into v_survivor_tenant
    from public.physical_tables
    where id = p_survivor_table_id;
  if v_survivor_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;
  if v_survivor_tenant <> v_tenant then
    raise exception 'cross_tenant_merge' using errcode = 'P0001';
  end if;

  -- 4. Guarda de sesión abierta sobre la absorbida (atómica con el lock)
  if exists (
    select 1 from public.table_sessions
    where physical_table_id = p_absorbed_table_id and status = 'open'
  ) then
    raise exception 'table_has_open_session' using errcode = 'P0001';
  end if;

  -- 5. Soft-deactivate de la absorbida + sacar su elemento del plano
  update public.physical_tables
    set active = false, updated_at = now()
    where id = p_absorbed_table_id;

  delete from public.floor_plan_elements
    where physical_table_id = p_absorbed_table_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_merge_tables(uuid, uuid) from public;
grant execute on function public.fp_merge_tables(uuid, uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_set_table_active
-- ──────────────────────────────────────────────────────────
-- Activa/desactiva una mesa. Al desactivar: lock + guarda de sesión abierta
-- (table_has_open_session) + active=false + borra su elemento (sale del
-- canvas). Al reactivar: active=true (su elemento ya no existe; la mesa
-- reaparece en la bandeja de no ubicadas vía el anti-join de getFloorPlan).
-- Owner-only. Devuelve {ok:true}.
create or replace function public.fp_set_table_active(
  p_table_id uuid,
  p_active   boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
begin
  -- 1. Lock pesimista + resolver tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_table_id
    for update;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  if p_active = false then
    -- 3a. Desactivar: guarda de sesión abierta (atómica con el lock)
    if exists (
      select 1 from public.table_sessions
      where physical_table_id = p_table_id and status = 'open'
    ) then
      raise exception 'table_has_open_session' using errcode = 'P0001';
    end if;

    update public.physical_tables
      set active = false, updated_at = now()
      where id = p_table_id;

    -- Sacar la mesa del canvas
    delete from public.floor_plan_elements
      where physical_table_id = p_table_id;
  else
    -- 3b. Reactivar: vuelve a la bandeja (sin elemento)
    update public.physical_tables
      set active = true, updated_at = now()
      where id = p_table_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_set_table_active(uuid, boolean) from public;
grant execute on function public.fp_set_table_active(uuid, boolean) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_delete_table
-- ──────────────────────────────────────────────────────────
-- Hard delete de una mesa SIN historial. Si existe alguna table_session
-- ligada a la mesa → raise 'table_has_history' (se debe desactivar en su
-- lugar). El floor_plan_element cae por on delete cascade. Owner-only.
-- Devuelve {ok:true}.
create or replace function public.fp_delete_table(
  p_table_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
begin
  -- 1. Resolver tenant
  select tenant_id into v_tenant
    from public.physical_tables
    where id = p_table_id;
  if v_tenant is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Bloquear si tiene historial de sesiones (un delete pondría
  --    physical_table_id = NULL en cada sesión por la FK on delete set null,
  --    destruyendo el vínculo mesa↔sesión).
  if exists (
    select 1 from public.table_sessions
    where physical_table_id = p_table_id
  ) then
    raise exception 'table_has_history' using errcode = 'P0001';
  end if;

  -- 4. Hard delete (el floor_plan_element cae por cascade)
  delete from public.physical_tables
    where id = p_table_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_delete_table(uuid) from public;
grant execute on function public.fp_delete_table(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- fp_delete_area
-- ──────────────────────────────────────────────────────────
-- Borra un área. Bloquea si tiene mesas activas ubicadas
-- (area_has_active_tables). No se puede borrar la última área del tenant
-- (cannot_delete_last_area). Los elementos del área (decor + mesas no
-- activas) caen por on delete cascade. Owner-only. Devuelve {ok:true}.
create or replace function public.fp_delete_area(
  p_area_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role   text;
  v_count  bigint;
begin
  -- 1. Resolver tenant
  select tenant_id into v_tenant
    from public.floor_plan_areas
    where id = p_area_id;
  if v_tenant is null then
    raise exception 'area_not_found' using errcode = 'P0001';
  end if;

  -- 2. Owner check
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Bloquear si hay mesas activas ubicadas en el área
  if exists (
    select 1
    from public.floor_plan_elements e
    join public.physical_tables pt on pt.id = e.physical_table_id
    where e.area_id = p_area_id and pt.active
  ) then
    raise exception 'area_has_active_tables' using errcode = 'P0001';
  end if;

  -- 4. No borrar la última área del tenant
  select count(*) into v_count
    from public.floor_plan_areas
    where tenant_id = v_tenant;
  if v_count <= 1 then
    raise exception 'cannot_delete_last_area' using errcode = 'P0001';
  end if;

  -- 5. Borrar (los floor_plan_elements caen por cascade)
  delete from public.floor_plan_areas
    where id = p_area_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.fp_delete_area(uuid) from public;
grant execute on function public.fp_delete_area(uuid) to authenticated;
