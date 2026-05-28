-- QR Activation by Waiter — RPCs.
--
-- Cambio fundamental: el comensal ya NO crea sesiones. El mozo activa la mesa
-- vía RPC autenticada, y solo ahí nace la sesión. Las RPCs públicas (anon) leen
-- el estado o raise 'no_active_session'.
--
-- RPCs nuevas:
--   - get_active_session_by_qr_token(text)
--   - activate_table_session(text, int, text)
--   - activate_table_session_by_id(uuid, int, text)
--   - update_session_party_size(uuid, int)
--   - get_salon_occupancy(uuid)
--
-- RPCs modificadas (CREATE OR REPLACE):
--   - get_session_state(text, text)          -- ya no auto-abre
--   - join_session_as_guest(text, text, text) -- raise si no hay sesión
--   - mark_session_paid(uuid)                -- quita rotación automática del qr_token
--
-- RPCs eliminadas:
--   - get_or_open_session(text)              -- DROP, reemplazada
--
-- ════════════════════════════════════════════════════════════
-- 1. DROP get_or_open_session
-- ════════════════════════════════════════════════════════════
-- Sin caller restante después de este archivo. Drop seguro.
drop function if exists public.get_or_open_session(text);

-- ════════════════════════════════════════════════════════════
-- 2. NUEVO: get_active_session_by_qr_token
-- ════════════════════════════════════════════════════════════
-- Lookup-only. Devuelve la sesión open de la mesa cuyo qr_token coincide, o
-- NULLs si no hay sesión activa. NUNCA crea. Si el qr_token no matchea ninguna
-- mesa activa, raise invalid_qr_token.
create or replace function public.get_active_session_by_qr_token(
  p_qr_token text
) returns table(
  session_id uuid,
  tenant_id uuid,
  physical_table_id uuid,
  table_label text,
  is_activated boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  return query select
    v_session.id,
    v_table.tenant_id,
    v_table.id,
    v_table.label,
    v_session.id is not null;
end $$;

revoke all on function public.get_active_session_by_qr_token(text) from public;
-- No grant directo a anon/authenticated: solo lo invocan otras RPCs.

-- ════════════════════════════════════════════════════════════
-- 3. NUEVO: internal_activate_session_for_table (helper interno)
-- ════════════════════════════════════════════════════════════
-- Lógica común entre las dos firmas públicas de activación.
-- Espera que el caller ya haya validado el role del usuario.
create or replace function public.internal_activate_session_for_table(
  p_table_id uuid,
  p_party_size int,
  p_source text,
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_was_already boolean := false;
begin
  if p_party_size is null or p_party_size < 1 then
    raise exception 'party_size_invalid' using errcode = 'P0001';
  end if;
  if p_source not in ('scan', 'manual') then
    raise exception 'invalid_source' using errcode = 'P0001';
  end if;

  -- Lock pesimista sobre la mesa para que dos mozos no creen sesiones a la vez.
  select * into v_table
    from public.physical_tables
    where id = p_table_id and active = true
    for update;
  if v_table.id is null then
    raise exception 'table_not_found' using errcode = 'P0001';
  end if;

  -- ¿Ya hay sesión open en esta mesa?
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is not null then
    v_was_already := true;
  else
    insert into public.table_sessions (
      tenant_id, physical_table_id, opened_by, party_size, status
    ) values (
      v_table.tenant_id, v_table.id, p_user_id, p_party_size, 'open'
    ) returning * into v_session;

    insert into public.table_session_events (
      session_id, type, created_by_user_id, payload
    ) values (
      v_session.id,
      'session_opened',
      p_user_id,
      jsonb_build_object('source', p_source, 'party_size', p_party_size)
    );
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'was_already_active', v_was_already
  );
end $$;

revoke all on function public.internal_activate_session_for_table(uuid, int, text, uuid) from public;

-- ════════════════════════════════════════════════════════════
-- 4. NUEVO: activate_table_session (por QR token)
-- ════════════════════════════════════════════════════════════
-- Llamada cuando el mozo escanea con la cámara del salón.
create or replace function public.activate_table_session(
  p_qr_token text,
  p_party_size int,
  p_source text default 'scan'
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
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role not in ('waiter', 'cashier', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.internal_activate_session_for_table(
    v_table_id, p_party_size, p_source, v_user_id
  );
end $$;

revoke all on function public.activate_table_session(text, int, text) from public;
grant execute on function public.activate_table_session(text, int, text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 5. NUEVO: activate_table_session_by_id (fallback manual)
-- ════════════════════════════════════════════════════════════
-- Llamada cuando el mozo activa desde la grilla sin escanear (cámara falla,
-- QR dañado, etc.).
create or replace function public.activate_table_session_by_id(
  p_physical_table_id uuid,
  p_party_size int,
  p_source text default 'manual'
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
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role not in ('waiter', 'cashier', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.internal_activate_session_for_table(
    p_physical_table_id, p_party_size, p_source, v_user_id
  );
end $$;

revoke all on function public.activate_table_session_by_id(uuid, int, text) from public;
grant execute on function public.activate_table_session_by_id(uuid, int, text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 6. NUEVO: update_session_party_size
-- ════════════════════════════════════════════════════════════
-- El mozo puede ajustar la declaración si llega o se va gente.
create or replace function public.update_session_party_size(
  p_session_id uuid,
  p_party_size int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_session public.table_sessions;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_party_size is null or p_party_size < 1 then
    raise exception 'party_size_invalid' using errcode = 'P0001';
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
    set party_size = p_party_size, updated_at = now()
    where id = p_session_id;

  insert into public.table_session_events (
    session_id, type, created_by_user_id, payload
  ) values (
    p_session_id,
    'party_size_changed',
    v_user_id,
    jsonb_build_object(
      'previous', v_session.party_size,
      'next', p_party_size
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'party_size', p_party_size,
    'previous_party_size', v_session.party_size
  );
end $$;

revoke all on function public.update_session_party_size(uuid, int) from public;
grant execute on function public.update_session_party_size(uuid, int) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 7. NUEVO: get_salon_occupancy
-- ════════════════════════════════════════════════════════════
-- Snapshot de ocupación para el panel del mozo.
create or replace function public.get_salon_occupancy(
  p_tenant_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_total_seats int;
  v_occupied int;
  v_open_sessions int;
begin
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select total_seats into v_total_seats
    from public.tenants where id = p_tenant_id;

  select
    coalesce(sum(coalesce(party_size, 0)), 0),
    count(*)
  into v_occupied, v_open_sessions
  from public.table_sessions
  where tenant_id = p_tenant_id and status = 'open';

  return jsonb_build_object(
    'total_seats', v_total_seats,
    'occupied_seats', v_occupied,
    'available_seats', case
      when v_total_seats is null then null
      else greatest(v_total_seats - v_occupied, 0)
    end,
    'open_sessions', v_open_sessions,
    'over_capacity', case
      when v_total_seats is null then false
      else v_occupied > v_total_seats
    end
  );
end $$;

revoke all on function public.get_salon_occupancy(uuid) from public;
grant execute on function public.get_salon_occupancy(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 8. REEMPLAZO: get_session_state (sin auto-abrir)
-- ════════════════════════════════════════════════════════════
-- Antes: llamaba a get_or_open_session que abría sesión si no había.
-- Ahora: si no hay sesión open, devuelve {is_activated: false} sin crear nada.
create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_tenant_name text;
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int := 0;
  v_menu jsonb;
  v_my_tickets jsonb;
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

  select name into v_tenant_name
    from public.tenants where id = v_table.tenant_id;

  -- ¿Hay sesión activa?
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is null then
    -- Mesa sin activar: devolvemos solo el contexto público mínimo.
    return jsonb_build_object(
      'is_activated', false,
      'tenant_id', v_table.tenant_id,
      'tenant_name', v_tenant_name,
      'physical_table_id', v_table.id,
      'table_label', v_table.label
    );
  end if;

  -- Sesión activa: resolver guest del browser_token si vino.
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

  -- Carta agrupada por categoría (idéntico a Plan 2)
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id,
        'name', mi.name,
        'description', mi.description,
        'price_cents', mi.price_cents,
        'image_url', mi.image_url,
        'position', mi.position
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

  return jsonb_build_object(
    'is_activated', true,
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'tenant_name', v_tenant_name,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', false,
    'menu', v_menu,
    'my_tickets', v_my_tickets
  );
end $$;
-- grants ya existen de Plan 1.

-- ════════════════════════════════════════════════════════════
-- 9. REEMPLAZO: join_session_as_guest (raise si no hay sesión)
-- ════════════════════════════════════════════════════════════
create or replace function public.join_session_as_guest(
  p_qr_token text,
  p_browser_token text,
  p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_guest_id uuid;
  v_existing public.session_guests;
  v_clean_name text;
  v_was_new_guest boolean := false;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null
     or length(p_browser_token) < 16
     or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  v_clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if v_clean_name is not null and length(v_clean_name) > 40 then
    raise exception 'display_name_too_long' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- Sin auto-create: la sesión debe existir.
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open'
    for update;
  if v_session.id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select * into v_existing
    from public.session_guests
    where session_id = v_session.id and browser_token = p_browser_token
    for update;

  if v_existing.id is not null then
    update public.session_guests
      set display_name = coalesce(v_clean_name, display_name),
          last_activity_at = now()
      where id = v_existing.id;
    v_guest_id := v_existing.id;
  else
    insert into public.session_guests (session_id, browser_token, display_name)
      values (v_session.id, p_browser_token, v_clean_name)
      returning id into v_guest_id;
    insert into public.table_session_events (
      session_id, type, created_by_guest_id, payload
    ) values (
      v_session.id, 'guest_joined', v_guest_id,
      jsonb_build_object('display_name', v_clean_name)
    );
    v_was_new_guest := true;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'guest_id', v_guest_id,
    'was_new_guest', v_was_new_guest,
    'was_new_session', false
  );
end $$;
-- grants ya existen de Plan 1.

-- ════════════════════════════════════════════════════════════
-- 10. REEMPLAZO: mark_session_paid sin rotación automática del qr_token
-- ════════════════════════════════════════════════════════════
-- Misma lógica que la versión Plan 3, sin el bloque que regeneraba el qr_token.
-- Decisión: el qr_token es estático por mesa. Solo el owner lo rota manualmente
-- vía regenerate_qr_token.
create or replace function public.mark_session_paid(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_role text;
  v_guest record;
  v_visit_id uuid;
  v_total_for_guest bigint;
  v_calc record;
  v_total_points int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_visits_created int := 0;
begin
  -- Lock session
  select * into v_session
    from public.table_sessions
    where id = p_session_id
    for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;

  -- Idempotente: si ya está paid, devolver
  if v_session.status = 'paid' then
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'paid',
      'idempotent', true,
      'total_cents', v_session.total_cents
    );
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_session.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Para cada guest registrado con al menos un item asignado, crear visit
  for v_guest in
    select sg.id as guest_id, sg.customer_id, sg.display_name
    from public.session_guests sg
    where sg.session_id = p_session_id
      and sg.customer_id is not null
  loop
    select coalesce(sum(ti.line_total_cents), 0) into v_total_for_guest
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    if v_total_for_guest = 0 then
      continue;
    end if;

    -- Crear visit con total 0; el trigger visits_apply_stats reacciona al update.
    insert into public.visits (
      tenant_id, customer_id, visited_at, total_amount_cents, source, created_by
    ) values (
      v_session.tenant_id, v_guest.customer_id, now(), 0, 'cashier', auth.uid()
    ) returning id into v_visit_id;

    insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
    select v_visit_id, ti.menu_item_id, ti.quantity, ti.unit_price_cents, ti.line_total_cents
    from public.ticket_items ti
    join public.tickets t on t.id = ti.ticket_id
    where t.session_id = p_session_id
      and t.status <> 'cancelled'
      and ti.assigned_to_guest_id = v_guest.guest_id
      and ti.cancelled_at is null;

    update public.visits set total_amount_cents = v_total_for_guest where id = v_visit_id;

    select * into v_calc from public.calculate_visit_points(v_visit_id);
    if v_calc.delta > 0 then
      insert into public.points_transactions (
        tenant_id, customer_id, visit_id, delta, reason, payload
      ) values (
        v_session.tenant_id, v_guest.customer_id, v_visit_id, v_calc.delta,
        'session_paid', v_calc.breakdown
      );
      v_total_points := v_total_points + v_calc.delta;
      v_breakdown := v_breakdown || jsonb_build_object(
        'guest_id', v_guest.guest_id,
        'customer_id', v_guest.customer_id,
        'display_name', v_guest.display_name,
        'visit_id', v_visit_id,
        'total_cents', v_total_for_guest,
        'points', v_calc.delta,
        'rules', v_calc.breakdown
      );
    else
      v_breakdown := v_breakdown || jsonb_build_object(
        'guest_id', v_guest.guest_id,
        'customer_id', v_guest.customer_id,
        'display_name', v_guest.display_name,
        'visit_id', v_visit_id,
        'total_cents', v_total_for_guest,
        'points', 0,
        'rules', '[]'::jsonb
      );
    end if;

    v_visits_created := v_visits_created + 1;
  end loop;

  -- Marcar sesión paid
  update public.table_sessions
    set status = 'paid',
        paid_at = now(),
        updated_at = now()
    where id = p_session_id;

  -- NO rotamos qr_token. El token es estático por mesa; solo el owner lo
  -- regenera manualmente vía regenerate_qr_token.

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id,
    'session_paid',
    auth.uid(),
    jsonb_build_object(
      'total_cents', v_session.total_cents,
      'visits_created', v_visits_created,
      'total_points', v_total_points,
      'breakdown', v_breakdown
    )
  );

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'paid',
    'idempotent', false,
    'total_cents', v_session.total_cents,
    'visits_created', v_visits_created,
    'total_points', v_total_points,
    'breakdown', v_breakdown
  );
end $$;
-- grants ya existen del Plan 3.
