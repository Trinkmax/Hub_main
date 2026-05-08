-- Plan 2: RPCs autenticadas para staff (waiter, owner, kitchen).

-- Helper interno: verifica que el caller tiene un rol permitido en el tenant
-- de la sesión/ticket.
create or replace function public._check_staff_role(
  p_tenant_id uuid,
  p_allowed_roles text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  v_role := public.user_role_in_tenant(p_tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (v_role = any(p_allowed_roles)) then
    raise exception 'role_not_allowed' using errcode = '42501';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- RPC: accept_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.accept_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner']);

  if v_ticket.status = 'accepted' then
    return jsonb_build_object('ticket_id', p_ticket_id, 'status', 'accepted', 'idempotent', true);
  end if;
  if v_ticket.status <> 'pending' then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;

  update public.tickets
    set status = 'accepted',
        accepted_at = now(),
        accepted_by_user_id = auth.uid(),
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', 'accepted', 'idempotent', false);
end $$;

revoke all on function public.accept_ticket(uuid) from public;
grant execute on function public.accept_ticket(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: reject_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.reject_ticket(p_ticket_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_clean_reason text;
begin
  v_clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_clean_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner']);

  if v_ticket.status <> 'pending' then
    raise exception 'invalid_status_transition' using errcode = 'P0001';
  end if;

  update public.tickets
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = v_clean_reason,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'cancelled', true);
end $$;

revoke all on function public.reject_ticket(uuid, text) from public;
grant execute on function public.reject_ticket(uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: update_ticket_status (waiter, owner, kitchen)
-- ──────────────────────────────────────────────────────────
-- Transiciones válidas:
--   accepted -> preparing (waiter, kitchen, owner)
--   preparing -> ready (waiter, kitchen, owner)
--   ready -> served (waiter, owner)
create or replace function public.update_ticket_status(
  p_ticket_id uuid,
  p_new_status public.ticket_status
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_role text;
  v_allowed boolean := false;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_ticket.tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Validar transición + rol
  if v_ticket.status = 'accepted' and p_new_status = 'preparing' then
    if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
  elsif v_ticket.status = 'preparing' and p_new_status = 'ready' then
    if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
  elsif v_ticket.status = 'ready' and p_new_status = 'served' then
    if v_role in ('waiter', 'owner') then v_allowed := true; end if;
  end if;

  if not v_allowed then
    raise exception 'invalid_transition_or_role' using errcode = '42501';
  end if;

  update public.tickets
    set status = p_new_status,
        prepared_at = case when p_new_status = 'preparing' and prepared_at is null then now() else prepared_at end,
        served_at = case when p_new_status = 'served' then now() else served_at end,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', p_new_status);
end $$;

revoke all on function public.update_ticket_status(uuid, public.ticket_status) from public;
grant execute on function public.update_ticket_status(uuid, public.ticket_status) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: cancel_ticket_item (waiter, owner, kitchen)
-- ──────────────────────────────────────────────────────────
create or replace function public.cancel_ticket_item(
  p_ticket_item_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.ticket_items;
  v_ticket public.tickets;
  v_clean_reason text;
begin
  v_clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_clean_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_item from public.ticket_items where id = p_ticket_item_id for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if v_item.cancelled_at is not null then
    return jsonb_build_object('item_id', p_ticket_item_id, 'idempotent', true);
  end if;

  select * into v_ticket from public.tickets where id = v_item.ticket_id;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner', 'kitchen']);

  update public.ticket_items
    set cancelled_at = now(),
        cancellation_reason = v_clean_reason
    where id = p_ticket_item_id;

  return jsonb_build_object('item_id', p_ticket_item_id, 'cancelled', true);
end $$;

revoke all on function public.cancel_ticket_item(uuid, text) from public;
grant execute on function public.cancel_ticket_item(uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────
-- RPC: add_staff_ticket (waiter, owner)
-- ──────────────────────────────────────────────────────────
-- Comanda de palabra creada por el mozo. Va directo a accepted.
create or replace function public.add_staff_ticket(
  p_session_id uuid,
  p_items jsonb,
  p_assigned_to_guest_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.table_sessions;
  v_ticket_id uuid;
  v_total_cents bigint := 0;
  v_total_items int := 0;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_line_total bigint;
  v_assigned_to uuid;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;

  select * into v_session from public.table_sessions where id = p_session_id for update;
  if v_session.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  perform public._check_staff_role(v_session.tenant_id, array['waiter', 'owner']);

  -- Verificar que el guest asignado pertenece a la sesión (si se pasó)
  if p_assigned_to_guest_id is not null then
    if not exists (
      select 1 from public.session_guests
      where id = p_assigned_to_guest_id and session_id = p_session_id
    ) then
      raise exception 'invalid_assigned_guest' using errcode = 'P0001';
    end if;
  end if;

  insert into public.tickets (
    tenant_id, session_id, status, created_by_user_id,
    submitted_at, accepted_at, accepted_by_user_id
  ) values (
    v_session.tenant_id, p_session_id, 'accepted', auth.uid(),
    now(), now(), auth.uid()
  ) returning id into v_ticket_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_menu
      from public.menu_items
      where id = (v_item->>'menu_item_id')::uuid
        and tenant_id = v_session.tenant_id
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
    if v_assigned_to is null then
      v_assigned_to := p_assigned_to_guest_id;  -- fallback al asignado global
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

  return jsonb_build_object(
    'ticket_id', v_ticket_id,
    'status', 'accepted',
    'total_cents', v_total_cents,
    'total_items', v_total_items
  );
end $$;

revoke all on function public.add_staff_ticket(uuid, jsonb, uuid) from public;
grant execute on function public.add_staff_ticket(uuid, jsonb, uuid) to authenticated;
