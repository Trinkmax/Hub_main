-- Plan 5: RPCs de operaciones avanzadas sobre sesiones.

-- ──────────────────────────────────────────────────────────
-- mark_session_abandoned
-- ──────────────────────────────────────────────────────────
-- Marca la sesión como abandoned (sin generar puntos).
create or replace function public.mark_session_abandoned(
  p_session_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_role text;
  v_clean text;
begin
  v_clean := nullif(trim(coalesce(p_reason, '')), '');
  select * into v_session from public.table_sessions
    where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.table_sessions
    set status = 'abandoned',
        abandoned_reason = coalesce(v_clean, 'manual'),
        updated_at = now()
    where id = p_session_id;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_abandoned',
    auth.uid(),
    jsonb_build_object('reason', coalesce(v_clean, 'manual'))
  );

  return jsonb_build_object('session_id', p_session_id, 'status', 'abandoned');
end $$;

revoke all on function public.mark_session_abandoned(uuid, text) from public;
grant execute on function public.mark_session_abandoned(uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- merge_sessions
-- ──────────────────────────────────────────────────────────
-- Absorbe N sesiones en una sobreviviente. Migra tickets, guests, events.
-- Las absorbidas pasan a status='merged' con merged_into=survivor.
create or replace function public.merge_sessions(
  p_survivor_id uuid,
  p_absorbed_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_survivor public.table_sessions;
  v_role text;
  v_absorbed_id uuid;
  v_absorbed public.table_sessions;
  v_total bigint;
begin
  if p_absorbed_ids is null or array_length(p_absorbed_ids, 1) = 0 then
    raise exception 'no_absorbed_sessions' using errcode = 'P0001';
  end if;

  select * into v_survivor from public.table_sessions
    where id = p_survivor_id for update;
  if v_survivor.id is null then
    raise exception 'survivor_not_found' using errcode = 'P0001';
  end if;
  if v_survivor.status <> 'open' then
    raise exception 'survivor_not_open' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_survivor.tenant_id);
  if v_role is null or v_role not in ('owner', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  foreach v_absorbed_id in array p_absorbed_ids loop
    if v_absorbed_id = p_survivor_id then continue; end if;

    select * into v_absorbed from public.table_sessions
      where id = v_absorbed_id for update;
    if v_absorbed.id is null then
      raise exception 'absorbed_not_found' using errcode = 'P0001';
    end if;
    if v_absorbed.tenant_id <> v_survivor.tenant_id then
      raise exception 'cross_tenant_merge' using errcode = '42501';
    end if;
    if v_absorbed.status <> 'open' then
      raise exception 'absorbed_not_open' using errcode = 'P0001';
    end if;

    -- Migrar tickets
    update public.tickets set session_id = p_survivor_id
      where session_id = v_absorbed_id;
    -- Migrar guests
    update public.session_guests set session_id = p_survivor_id
      where session_id = v_absorbed_id;
    -- Migrar events
    update public.table_session_events set session_id = p_survivor_id
      where session_id = v_absorbed_id;

    -- Marcar absorbida
    update public.table_sessions
      set status = 'merged',
          merged_into = p_survivor_id,
          updated_at = now()
      where id = v_absorbed_id;

    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
    values (
      p_survivor_id,
      'session_merged',
      auth.uid(),
      jsonb_build_object('absorbed_session_id', v_absorbed_id)
    );
  end loop;

  -- Recalcular total de la sobreviviente
  select coalesce(sum(total_cents), 0) into v_total
    from public.tickets
    where session_id = p_survivor_id and status <> 'cancelled';
  update public.table_sessions
    set total_cents = v_total, updated_at = now()
    where id = p_survivor_id;

  return jsonb_build_object(
    'survivor_id', p_survivor_id,
    'absorbed_count', array_length(p_absorbed_ids, 1),
    'total_cents', v_total
  );
end $$;

revoke all on function public.merge_sessions(uuid, uuid[]) from public;
grant execute on function public.merge_sessions(uuid, uuid[]) to authenticated;

-- ──────────────────────────────────────────────────────────
-- move_session
-- ──────────────────────────────────────────────────────────
-- Cambia physical_table_id de una sesión open a otra mesa libre.
create or replace function public.move_session(
  p_session_id uuid,
  p_new_physical_table_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_new_table public.physical_tables;
  v_role text;
  v_existing_open uuid;
begin
  select * into v_session from public.table_sessions
    where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_new_table from public.physical_tables
    where id = p_new_physical_table_id;
  if v_new_table.id is null or v_new_table.tenant_id <> v_session.tenant_id then
    raise exception 'invalid_target_table' using errcode = 'P0001';
  end if;

  -- Verificar que la mesa target no tiene otra sesión open
  select id into v_existing_open from public.table_sessions
    where physical_table_id = p_new_physical_table_id and status = 'open' and id <> p_session_id;
  if v_existing_open is not null then
    raise exception 'target_table_busy' using errcode = 'P0001';
  end if;

  update public.table_sessions
    set physical_table_id = p_new_physical_table_id, updated_at = now()
    where id = p_session_id;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_moved',
    auth.uid(),
    jsonb_build_object(
      'from_physical_table_id', v_session.physical_table_id,
      'to_physical_table_id', p_new_physical_table_id
    )
  );

  return jsonb_build_object('session_id', p_session_id, 'new_physical_table_id', p_new_physical_table_id);
end $$;

revoke all on function public.move_session(uuid, uuid) from public;
grant execute on function public.move_session(uuid, uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- split_session
-- ──────────────────────────────────────────────────────────
-- Divide una sesión: mueve N guests + sus tickets a una nueva sesión en
-- otra mesa física. Los guests deben pertenecer a la sesión origen.
create or replace function public.split_session(
  p_source_id uuid,
  p_target_physical_table_id uuid,
  p_guest_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.table_sessions;
  v_target_table public.physical_tables;
  v_role text;
  v_new_session_id uuid;
  v_existing_open uuid;
  v_total bigint;
begin
  if p_guest_ids is null or array_length(p_guest_ids, 1) = 0 then
    raise exception 'no_guests_to_split' using errcode = 'P0001';
  end if;

  select * into v_source from public.table_sessions
    where id = p_source_id for update;
  if v_source.id is null or v_source.status <> 'open' then
    raise exception 'source_not_available' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_source.tenant_id);
  if v_role is null or v_role not in ('owner', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_target_table from public.physical_tables
    where id = p_target_physical_table_id;
  if v_target_table.id is null or v_target_table.tenant_id <> v_source.tenant_id then
    raise exception 'invalid_target_table' using errcode = 'P0001';
  end if;

  select id into v_existing_open from public.table_sessions
    where physical_table_id = p_target_physical_table_id and status = 'open';
  if v_existing_open is not null then
    raise exception 'target_table_busy' using errcode = 'P0001';
  end if;

  -- Crear sesión destino
  insert into public.table_sessions (tenant_id, physical_table_id)
    values (v_source.tenant_id, p_target_physical_table_id)
    returning id into v_new_session_id;

  insert into public.table_session_events (session_id, type, payload)
    values (v_new_session_id, 'session_opened', '{"trigger":"split"}'::jsonb);

  -- Migrar guests seleccionados
  update public.session_guests
    set session_id = v_new_session_id
    where id = any(p_guest_ids) and session_id = p_source_id;

  -- Migrar tickets creados por esos guests (full ticket; los items shared en
  -- esos tickets se mueven con ellos, lo cual es razonable: el grupo se llevó
  -- la cuenta de la mesa).
  update public.tickets
    set session_id = v_new_session_id
    where session_id = p_source_id
      and created_by_guest_id = any(p_guest_ids);

  -- Recalcular totales de ambas sesiones
  select coalesce(sum(total_cents), 0) into v_total
    from public.tickets
    where session_id = v_new_session_id and status <> 'cancelled';
  update public.table_sessions set total_cents = v_total where id = v_new_session_id;

  select coalesce(sum(total_cents), 0) into v_total
    from public.tickets
    where session_id = p_source_id and status <> 'cancelled';
  update public.table_sessions set total_cents = v_total where id = p_source_id;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_source_id,
    'session_split',
    auth.uid(),
    jsonb_build_object(
      'new_session_id', v_new_session_id,
      'guest_ids', to_jsonb(p_guest_ids)
    )
  );

  return jsonb_build_object(
    'source_id', p_source_id,
    'new_session_id', v_new_session_id,
    'guests_moved', array_length(p_guest_ids, 1)
  );
end $$;

revoke all on function public.split_session(uuid, uuid, uuid[]) from public;
grant execute on function public.split_session(uuid, uuid, uuid[]) to authenticated;
