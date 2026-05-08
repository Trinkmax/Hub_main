-- Plan 5: actualizar submit_ticket para honrar auto-aceptación del tenant.
-- Si está habilitada y el ticket cabe en los caps, va directo a 'accepted'.

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
  v_tenant public.tenants;
  v_auto_accept boolean := false;
  v_ticket_status public.ticket_status;
  v_total_cents bigint := 0;
  v_total_items int := 0;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_line_total bigint;
  v_assigned_to uuid;
begin
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

  -- Pre-calcular totales para evaluar caps de auto-aceptación
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 50 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_tenant_id
        and active = true;
    if v_menu.id is null then
      raise exception 'menu_item_not_available' using errcode = 'P0001';
    end if;
    v_total_cents := v_total_cents + v_menu.price_cents * v_qty;
    v_total_items := v_total_items + v_qty;
  end loop;

  -- Auto-aceptación: leer config tenant + chequear caps
  select * into v_tenant from public.tenants where id = v_tenant_id;
  if v_tenant.ticket_auto_accept_enabled then
    v_auto_accept := true;
    if v_tenant.ticket_auto_accept_max_cents is not null
       and v_total_cents > v_tenant.ticket_auto_accept_max_cents then
      v_auto_accept := false;
    end if;
    if v_tenant.ticket_auto_accept_max_items is not null
       and v_total_items > v_tenant.ticket_auto_accept_max_items then
      v_auto_accept := false;
    end if;
  end if;

  if v_auto_accept then
    v_ticket_status := 'accepted';
  else
    v_ticket_status := 'pending';
  end if;

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

  -- Insertar items (re-loop, ya validados)
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_tenant_id
        and active = true;
    v_qty := (v_item->>'quantity')::int;
    v_line_total := v_menu.price_cents * v_qty;
    v_assigned_to := nullif(v_item->>'assigned_to_guest_id', '')::uuid;
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
  end loop;

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
