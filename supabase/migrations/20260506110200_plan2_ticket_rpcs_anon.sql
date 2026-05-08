-- Plan 2: RPCs públicas para tickets y request_bill.

-- ──────────────────────────────────────────────────────────
-- RPC: submit_ticket (anon)
-- ──────────────────────────────────────────────────────────
-- p_items: jsonb array con shape:
--   [{"menu_item_id": uuid, "quantity": int, "notes": string|null,
--     "assigned_to_guest_id": uuid|null}]
-- Si "assigned_to_guest_id" es null, el ítem se considera shared.
create or replace function public.submit_ticket(
  p_qr_token text,
  p_browser_token text,
  p_items jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_guest_id uuid;
  v_ticket_id uuid;
  v_existing_ticket public.tickets;
  v_auto_accept boolean;
  v_ticket_status public.ticket_status;
  v_total_cents bigint := 0;
  v_total_items int := 0;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_line_total bigint;
  v_assigned_to uuid;
begin
  -- Validación
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null or length(p_browser_token) < 16 or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'invalid_idempotency_key' using errcode = 'P0001';
  end if;

  -- Resolver sesión + guest
  select ts.id, ts.tenant_id into v_session_id, v_tenant_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open'
    for update of ts;
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select id into v_guest_id
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token;
  if v_guest_id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- Idempotency
  select * into v_existing_ticket
    from public.tickets
    where session_id = v_session_id and idempotency_key = p_idempotency_key;
  if v_existing_ticket.id is not null then
    return jsonb_build_object(
      'ticket_id', v_existing_ticket.id,
      'status', v_existing_ticket.status,
      'idempotent_replay', true
    );
  end if;

  -- Auto-aceptación: Plan 5 va a agregar columnas en tenants. Por ahora always false.
  v_auto_accept := false;

  if v_auto_accept then
    v_ticket_status := 'accepted';
  else
    v_ticket_status := 'pending';
  end if;

  -- Crear ticket
  insert into public.tickets (
    tenant_id, session_id, status, created_by_guest_id,
    submitted_at, idempotency_key,
    accepted_at, accepted_by_user_id
  ) values (
    v_tenant_id, v_session_id, v_ticket_status, v_guest_id,
    now(), p_idempotency_key,
    case when v_auto_accept then now() else null end,
    null
  ) returning id into v_ticket_id;

  -- Insertar items
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_tenant_id
        and active = true;
    if v_menu.id is null then
      raise exception 'menu_item_not_available' using errcode = 'P0001';
    end if;

    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 50 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    v_line_total := v_menu.price_cents * v_qty;
    v_assigned_to := nullif(v_item->>'assigned_to_guest_id', '')::uuid;

    -- Si assigned_to no nulo, debe pertenecer a la sesión
    if v_assigned_to is not null and not exists (
      select 1 from public.session_guests
      where id = v_assigned_to and session_id = v_session_id
    ) then
      raise exception 'invalid_assigned_guest' using errcode = 'P0001';
    end if;

    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents,
      line_total_cents, assigned_to_guest_id, notes
    ) values (
      v_ticket_id, v_menu.id, v_qty, v_menu.price_cents,
      v_line_total, v_assigned_to,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    );

    v_total_cents := v_total_cents + v_line_total;
    v_total_items := v_total_items + v_qty;
  end loop;

  -- Refrescar last_activity_at del guest
  update public.session_guests
    set last_activity_at = now()
    where id = v_guest_id;

  return jsonb_build_object(
    'ticket_id', v_ticket_id,
    'status', v_ticket_status,
    'total_cents', v_total_cents,
    'total_items', v_total_items,
    'idempotent_replay', false
  );
end $$;

revoke all on function public.submit_ticket(text, text, jsonb, text) from public;
grant execute on function public.submit_ticket(text, text, jsonb, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: cancel_pending_ticket (anon)
-- ──────────────────────────────────────────────────────────
create or replace function public.cancel_pending_ticket(
  p_ticket_id uuid,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_guest public.session_guests;
begin
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;

  if v_ticket.status <> 'pending' then
    raise exception 'ticket_not_cancellable' using errcode = 'P0001';
  end if;

  if now() - v_ticket.submitted_at > interval '60 seconds' then
    raise exception 'cancel_window_expired' using errcode = 'P0001';
  end if;

  -- Verificar que el browser_token corresponde al guest creator
  select * into v_guest
    from public.session_guests
    where id = v_ticket.created_by_guest_id;
  if v_guest.id is null or v_guest.browser_token <> p_browser_token then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.tickets
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'guest_cancelled',
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'cancelled', true);
end $$;

revoke all on function public.cancel_pending_ticket(uuid, text) from public;
grant execute on function public.cancel_pending_ticket(uuid, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: request_bill (anon)
-- ──────────────────────────────────────────────────────────
create or replace function public.request_bill(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_guest_id uuid;
begin
  if p_browser_token is null or length(p_browser_token) < 16 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select ts.id into v_session_id
    from public.table_sessions ts
    join public.physical_tables pt on pt.id = ts.physical_table_id
    where pt.qr_token = p_qr_token and ts.status = 'open';
  if v_session_id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select id into v_guest_id
    from public.session_guests
    where session_id = v_session_id and browser_token = p_browser_token;
  if v_guest_id is null then
    raise exception 'guest_not_found' using errcode = 'P0001';
  end if;

  -- Anti-spam: si ya pidió cuenta en los últimos 60s, no-op
  if exists (
    select 1 from public.table_session_events
    where session_id = v_session_id
      and type = 'bill_requested'
      and created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('already_requested', true);
  end if;

  insert into public.table_session_events (session_id, type, created_by_guest_id, payload)
    values (v_session_id, 'bill_requested', v_guest_id, '{}'::jsonb);

  update public.session_guests
    set last_activity_at = now()
    where id = v_guest_id;

  return jsonb_build_object('session_id', v_session_id, 'requested', true);
end $$;

revoke all on function public.request_bill(text, text) from public;
grant execute on function public.request_bill(text, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────
-- Reemplazo: get_session_state extendido
-- ──────────────────────────────────────────────────────────
-- Ahora también devuelve la carta del tenant + los tickets del guest
-- (si tiene browser_token). Compatible con el caller del Plan 1 (los
-- campos existentes siguen).
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
  v_menu jsonb;
  v_my_tickets jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  select label into v_table_label
    from public.physical_tables where id = v_physical_table_id;
  select name into v_tenant_name
    from public.tenants where id = v_tenant_id;

  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session_id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session_id;

  -- Carta agrupada por categoría
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
      on mi.category_id = mc.id and mi.tenant_id = v_tenant_id
    where mc.tenant_id = v_tenant_id and mc.active = true
    group by mc.id
  ) cats;

  -- Tickets propios del guest (si existe)
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
      where t.session_id = v_session_id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'physical_table_id', v_physical_table_id,
    'table_label', v_table_label,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', v_was_new,
    'menu', v_menu,
    'my_tickets', v_my_tickets
  );
end $$;
-- grant ya existe del Plan 1 sobre la firma (text, text)
