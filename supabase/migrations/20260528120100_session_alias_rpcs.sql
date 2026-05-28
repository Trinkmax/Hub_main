-- Session alias — RPCs.
--
-- Cambios:
--   - DROP + recreate de las 3 RPCs de activación con `p_alias text default null` agregado.
--   - NEW: update_session_alias(p_session_id uuid, p_alias text)
--
-- Como la signature cambia, no podemos usar CREATE OR REPLACE solamente —
-- hay que dropear primero.

drop function if exists public.activate_table_session(text, int, text);
drop function if exists public.activate_table_session_by_id(uuid, int, text);
drop function if exists public.internal_activate_session_for_table(uuid, int, text, uuid);

create or replace function public.internal_activate_session_for_table(
  p_table_id uuid,
  p_party_size int,
  p_source text,
  p_user_id uuid,
  p_alias text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_was_already boolean := false;
  v_clean_alias text;
begin
  if p_party_size is null or p_party_size < 1 then
    raise exception 'party_size_invalid' using errcode = 'P0001';
  end if;
  if p_source not in ('scan', 'manual') then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;

  v_clean_alias := nullif(trim(coalesce(p_alias, '')), '');
  if v_clean_alias is not null and length(v_clean_alias) > 60 then
    raise exception 'alias_too_long' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where id = p_table_id and active = true
    for update;
  if v_table.id is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is not null then
    v_was_already := true;
  else
    insert into public.table_sessions (
      tenant_id, physical_table_id, opened_by, party_size, status, alias
    ) values (
      v_table.tenant_id, v_table.id, p_user_id, p_party_size, 'open', v_clean_alias
    ) returning * into v_session;

    insert into public.table_session_events (
      session_id, type, created_by_user_id, payload
    ) values (
      v_session.id,
      'session_opened',
      p_user_id,
      jsonb_build_object(
        'source', p_source,
        'party_size', p_party_size,
        'alias', v_clean_alias
      )
    );
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'alias', v_session.alias,
    'was_already_active', v_was_already
  );
end $$;

revoke all on function public.internal_activate_session_for_table(uuid, int, text, uuid, text) from public;

create or replace function public.activate_table_session(
  p_qr_token text,
  p_party_size int,
  p_source text default 'scan',
  p_alias text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_table_id uuid;
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  select id, tenant_id into v_table_id, v_tenant_id
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table_id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('waiter', 'cashier', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.internal_activate_session_for_table(
    v_table_id, p_party_size, p_source, v_user_id, p_alias
  );
end $$;

revoke all on function public.activate_table_session(text, int, text, text) from public;
grant execute on function public.activate_table_session(text, int, text, text) to authenticated;

create or replace function public.activate_table_session_by_id(
  p_physical_table_id uuid,
  p_party_size int,
  p_source text default 'manual',
  p_alias text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_id
    from public.physical_tables
    where id = p_physical_table_id and active = true;
  if v_tenant_id is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('waiter', 'cashier', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.internal_activate_session_for_table(
    p_physical_table_id, p_party_size, p_source, v_user_id, p_alias
  );
end $$;

revoke all on function public.activate_table_session_by_id(uuid, int, text, text) from public;
grant execute on function public.activate_table_session_by_id(uuid, int, text, text) to authenticated;

create or replace function public.update_session_alias(
  p_session_id uuid,
  p_alias text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_session public.table_sessions;
  v_clean_alias text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  v_clean_alias := nullif(trim(coalesce(p_alias, '')), '');
  if v_clean_alias is not null and length(v_clean_alias) > 60 then
    raise exception 'alias_too_long' using errcode = 'P0001';
  end if;

  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('waiter', 'cashier', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.table_sessions
    set alias = v_clean_alias, updated_at = now()
    where id = p_session_id;

  insert into public.table_session_events (
    session_id, type, created_by_user_id, payload
  ) values (
    p_session_id,
    'alias_changed',
    v_user_id,
    jsonb_build_object(
      'previous', v_session.alias,
      'next', v_clean_alias
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'alias', v_clean_alias,
    'previous_alias', v_session.alias
  );
end $$;

revoke all on function public.update_session_alias(uuid, text) from public;
grant execute on function public.update_session_alias(uuid, text) to authenticated;
