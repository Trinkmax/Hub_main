-- Plan 1: RPCs del modelo de sesiones.
-- Este archivo agrupa las 5 RPCs del Plan 1.

-- ──────────────────────────────────────────────────────────
-- RPC 1: regenerate_qr_token (autenticada, owner-only)
-- ──────────────────────────────────────────────────────────
create or replace function public.regenerate_qr_token(
  p_table_id uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_new_token text;
begin
  -- 1. Resolver tenant de la mesa
  select tenant_id into v_tenant_id
    from public.physical_tables
    where id = p_table_id;
  if v_tenant_id is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- 2. Verificar role del caller
  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  -- 3. Rotar
  v_new_token := public.generate_qr_token();
  update public.physical_tables
    set qr_token = v_new_token, updated_at = now()
    where id = p_table_id;

  return v_new_token;
end $$;

revoke all on function public.regenerate_qr_token(uuid) from public;
grant execute on function public.regenerate_qr_token(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC 2: get_or_open_session (interno, usado por las RPCs públicas)
-- ──────────────────────────────────────────────────────────
-- Resuelve un qr_token a una sesión open. Si no existe, abre una nueva.
-- Devuelve session.id y tenant_id. Si el qr_token no coincide con ninguna
-- mesa activa, raise.
create or replace function public.get_or_open_session(
  p_qr_token text
) returns table(session_id uuid, tenant_id uuid, physical_table_id uuid, was_new boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_was_new boolean := false;
begin
  -- 1. Buscar la mesa por token
  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true
    for update;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- 2. Buscar sesión open en esa mesa
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open'
    for update;

  -- 3. Si no hay, abrir una nueva
  if v_session.id is null then
    insert into public.table_sessions (tenant_id, physical_table_id)
      values (v_table.tenant_id, v_table.id)
      returning * into v_session;
    insert into public.table_session_events (session_id, type, payload)
      values (v_session.id, 'session_opened', '{"trigger": "qr_scan"}'::jsonb);
    v_was_new := true;
  end if;

  return query select v_session.id, v_session.tenant_id, v_table.id, v_was_new;
end $$;

revoke all on function public.get_or_open_session(text) from public;
-- No grant a anon ni authenticated: solo lo invocan otras RPCs.

-- ──────────────────────────────────────────────────────────
-- RPC 3: get_session_state (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Snapshot que el comensal recibe al escanear el QR.
-- Si no hay sesión open, abre una. Si el caller tiene browser_token,
-- también devuelve su guest_id (si está unido a esta sesión).
create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_physical_table_id uuid;
  v_was_new boolean;
  v_table_label text;
  v_tenant_name text;
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int;
begin
  -- Validación mínima
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver / abrir sesión
  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  -- 2. Cargar info pública de mesa y tenant
  select label into v_table_label
    from public.physical_tables where id = v_physical_table_id;
  select name into v_tenant_name
    from public.tenants where id = v_tenant_id;

  -- 3. Si el caller tiene browser_token, buscar su guest
  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session_id and browser_token = p_browser_token;
    -- Si existe, refrescar last_activity_at
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  -- 4. Contar guests de la sesión (info pública para "somos N en la mesa")
  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'physical_table_id', v_physical_table_id,
    'table_label', v_table_label,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', v_was_new
  );
end $$;

revoke all on function public.get_session_state(text, text) from public;
grant execute on function public.get_session_state(text, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC 4: join_session_as_guest (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Crea (o reconecta) un guest en la sesión asociada al qr_token.
-- Idempotente: si ya existe el (session_id, browser_token), devuelve el existente.
create or replace function public.join_session_as_guest(
  p_qr_token text,
  p_browser_token text,
  p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_physical_table_id uuid;
  v_was_new boolean;
  v_guest_id uuid;
  v_existing public.session_guests;
  v_clean_name text;
  v_was_new_guest boolean := false;
begin
  -- Validación
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  v_clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if v_clean_name is not null and length(v_clean_name) > 40 then
    raise exception 'display_name_too_long' using errcode = 'P0001';
  end if;

  -- Resolver sesión (abre si no existe)
  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  -- Lookup existing
  select * into v_existing
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token
    for update;

  if v_existing.id is not null then
    -- Reconectar: actualiza display_name si lo pasaron, refresca actividad
    update public.session_guests
      set display_name = coalesce(v_clean_name, display_name),
          last_activity_at = now()
      where id = v_existing.id;
    v_guest_id := v_existing.id;
  else
    -- Crear guest nuevo
    insert into public.session_guests (session_id, browser_token, display_name)
      values (v_session_id, p_browser_token, v_clean_name)
      returning id into v_guest_id;
    insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
      values (v_session_id, 'guest_joined', v_guest_id,
              jsonb_build_object('display_name', v_clean_name));
    v_was_new_guest := true;
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'guest_id', v_guest_id,
    'was_new_guest', v_was_new_guest,
    'was_new_session', v_was_new
  );
end $$;

revoke all on function public.join_session_as_guest(text, text, text) from public;
grant execute on function public.join_session_as_guest(text, text, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC 5: register_customer_for_session (pública, anon)
-- ──────────────────────────────────────────────────────────
-- Registra al guest como customer (opt-in puntos).
-- Dedupe por (tenant_id, phone) — si ya existía, lo asocia.
create or replace function public.register_customer_for_session(
  p_qr_token text,
  p_browser_token text,
  p_phone text,
  p_first_name text,
  p_last_name text,
  p_birthdate date default null,
  p_opt_in_marketing boolean default false,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_guest public.session_guests;
  v_customer public.customers;
  v_customer_id uuid;
  v_was_new_customer boolean := false;
  v_phone text := trim(coalesce(p_phone, ''));
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
begin
  -- Validación
  if length(v_phone) < 8 or length(v_phone) > 20 then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if length(v_first) = 0 or length(v_first) > 60 then
    raise exception 'invalid_first_name' using errcode = 'P0001';
  end if;
  if length(v_last) = 0 or length(v_last) > 60 then
    raise exception 'invalid_last_name' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver sesión (no abre nueva — debe existir)
  select ts.id, ts.tenant_id into v_session_id, v_tenant_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open'
    for update of ts;
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  -- 2. Lookup guest
  select * into v_guest
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token
    for update;
  if v_guest.id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- 3. Dedupe customer por (tenant_id, phone)
  select * into v_customer
    from public.customers
    where tenant_id = v_tenant_id and phone = v_phone and deleted_at is null
    for update;

  if v_customer.id is null then
    insert into public.customers (
      tenant_id, phone, first_name, last_name, birthdate,
      opt_in_marketing, opt_in_at, opt_in_ip, source
    ) values (
      v_tenant_id, v_phone, v_first, v_last, p_birthdate,
      p_opt_in_marketing,
      case when p_opt_in_marketing then now() else null end,
      case when p_opt_in_marketing then p_ip else null end,
      'qr'
    ) returning * into v_customer;
    v_customer_id := v_customer.id;
    v_was_new_customer := true;
  else
    -- Existía: actualiza datos básicos si están vacíos, no pisa nombre/apellido
    -- ya cargados; respeta opt_in si ya estaba en true.
    update public.customers
      set first_name = case when length(trim(first_name)) = 0 then v_first else first_name end,
          last_name = case when length(trim(last_name)) = 0 then v_last else last_name end,
          birthdate = coalesce(birthdate, p_birthdate),
          opt_in_marketing = opt_in_marketing or p_opt_in_marketing,
          opt_in_at = case
            when not opt_in_marketing and p_opt_in_marketing then now()
            else opt_in_at
          end,
          opt_in_ip = case
            when not opt_in_marketing and p_opt_in_marketing then p_ip
            else opt_in_ip
          end
      where id = v_customer.id
      returning * into v_customer;
    v_customer_id := v_customer.id;
  end if;

  -- 4. Conectar guest con customer
  update public.session_guests
    set customer_id = v_customer_id,
        display_name = coalesce(display_name, v_first),
        last_activity_at = now()
    where id = v_guest.id;

  -- 5. Evento
  insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
    values (
      v_session_id,
      'guest_registered',
      v_guest.id,
      jsonb_build_object(
        'customer_id', v_customer_id,
        'was_new_customer', v_was_new_customer
      )
    );

  return jsonb_build_object(
    'guest_id', v_guest.id,
    'customer_id', v_customer_id,
    'was_new_customer', v_was_new_customer
  );
end $$;

revoke all on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) from public;
grant execute on function public.register_customer_for_session(
  text, text, text, text, text, date, boolean, text, text
) to anon, authenticated;
