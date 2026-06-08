-- Mover ítems entre mesas (corrección de errores de carga).
-- Enfoque aditivo: inserta en una comanda nueva del destino + descuenta en el
-- origen, de modo que los triggers de recálculo ajustan AMBAS sesiones.
-- El comensal se "porta" al destino (match/crea por customer_id para
-- registrados; placeholder por nombre para anónimos), con opción de reasignar.
create or replace function public.move_ticket_items(
  p_source_session_id uuid,
  p_target_table_id   uuid,
  p_moves jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.table_sessions;
  v_target_table public.physical_tables;
  v_source_label text;
  v_target_label text;
  v_target_session_id uuid;
  v_target_ticket_id uuid;
  v_existing_session uuid;
  v_move jsonb;
  v_item public.ticket_items;
  v_src_guest public.session_guests;
  v_qty int;
  v_assign text;
  v_target_guest uuid;
  v_mapped uuid;
  v_guest_map jsonb := '{}'::jsonb;
  v_moved_count int := 0;
  v_clean_key text;
begin
  -- 0. Idempotencia: si ya existe una comanda con esta key, devolverla sin re-mover.
  v_clean_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_clean_key is not null then
    select t.id, t.session_id into v_target_ticket_id, v_target_session_id
      from public.tickets t
      where t.idempotency_key = v_clean_key
      limit 1;
    if v_target_ticket_id is not null then
      return jsonb_build_object(
        'target_session_id', v_target_session_id,
        'target_ticket_id', v_target_ticket_id,
        'moved_count', 0,
        'idempotent', true
      );
    end if;
  end if;

  -- 1. Payload no vacío.
  if p_moves is null or jsonb_array_length(p_moves) = 0 then
    raise exception 'no_moves' using errcode = 'P0001';
  end if;

  -- 2. Sesión origen (lock) + estado open.
  select * into v_source from public.table_sessions
    where id = p_source_session_id for update;
  if v_source.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_source.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  -- 3. Rol permitido.
  perform public._check_staff_role(v_source.tenant_id, array['owner', 'waiter']);

  -- 4. Mesa destino válida, mismo tenant, distinta del origen.
  select * into v_target_table from public.physical_tables
    where id = p_target_table_id;
  if v_target_table.id is null or v_target_table.tenant_id <> v_source.tenant_id then
    raise exception 'invalid_target_table' using errcode = 'P0001';
  end if;
  if v_target_table.id = v_source.physical_table_id then
    raise exception 'same_table_move' using errcode = 'P0001';
  end if;
  v_target_label := v_target_table.label;
  select label into v_source_label from public.physical_tables
    where id = v_source.physical_table_id;

  -- 5. Resolver/crear sesión destino.
  select id into v_existing_session from public.table_sessions
    where physical_table_id = p_target_table_id and status = 'open'
    limit 1;
  if v_existing_session is not null then
    v_target_session_id := v_existing_session;
  else
    insert into public.table_sessions (tenant_id, physical_table_id)
      values (v_source.tenant_id, p_target_table_id)
      returning id into v_target_session_id;
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
      values (v_target_session_id, 'session_opened', auth.uid(), '{"trigger":"items_move"}'::jsonb);
  end if;

  -- 6. Comanda destino: served (fuera del KDS).
  insert into public.tickets (
    tenant_id, session_id, status, created_by_user_id,
    submitted_at, accepted_at, accepted_by_user_id, served_at, idempotency_key
  ) values (
    v_source.tenant_id, v_target_session_id, 'served', auth.uid(),
    now(), now(), auth.uid(), now(), v_clean_key
  ) returning id into v_target_ticket_id;

  -- 7. Procesar cada move.
  for v_move in select * from jsonb_array_elements(p_moves) loop
    v_qty := (v_move->>'quantity')::int;
    v_assign := coalesce(nullif(trim(v_move->>'assign'), ''), 'auto');

    -- 7a. Cargar ítem origen (lock) y validar que pertenece a la sesión origen.
    select ti.* into v_item
      from public.ticket_items ti
      join public.tickets t on t.id = ti.ticket_id
      where ti.id = (v_move->>'ticket_item_id')::uuid
        and t.session_id = p_source_session_id
      for update of ti;
    if v_item.id is null then
      raise exception 'item_not_in_session' using errcode = 'P0001';
    end if;
    if v_item.cancelled_at is not null then
      raise exception 'item_cancelled' using errcode = 'P0001';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > v_item.quantity then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    -- 7b. Resolver comensal destino.
    if v_assign = 'shared' then
      v_target_guest := null;
    elsif v_assign = 'auto' then
      if v_item.assigned_to_guest_id is null then
        v_target_guest := null;
      else
        v_mapped := nullif(v_guest_map->>(v_item.assigned_to_guest_id::text), '')::uuid;
        if v_mapped is not null then
          v_target_guest := v_mapped;
        else
          select * into v_src_guest from public.session_guests
            where id = v_item.assigned_to_guest_id;
          v_target_guest := null;
          if v_src_guest.customer_id is not null then
            select id into v_target_guest from public.session_guests
              where session_id = v_target_session_id
                and customer_id = v_src_guest.customer_id
              limit 1;
          end if;
          if v_target_guest is null then
            insert into public.session_guests (session_id, browser_token, display_name, customer_id)
              values (
                v_target_session_id,
                'mv' || replace(gen_random_uuid()::text, '-', ''),
                v_src_guest.display_name,
                v_src_guest.customer_id
              )
              returning id into v_target_guest;
          end if;
          v_guest_map := v_guest_map
            || jsonb_build_object(v_item.assigned_to_guest_id::text, v_target_guest);
        end if;
      end if;
    else
      -- assign es un uuid de comensal del destino.
      select id into v_target_guest from public.session_guests
        where id = v_assign::uuid and session_id = v_target_session_id;
      if v_target_guest is null then
        raise exception 'invalid_assigned_guest' using errcode = 'P0001';
      end if;
    end if;

    -- 7c. Insertar en la comanda destino.
    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents,
      line_total_cents, assigned_to_guest_id, notes
    ) values (
      v_target_ticket_id, v_item.menu_item_id, v_qty, v_item.unit_price_cents,
      v_item.unit_price_cents * v_qty, v_target_guest,
      nullif(trim(coalesce(v_item.notes, '') || ' (movido de ' || coalesce(v_source_label, 'mesa') || ')'), '')
    );

    -- 7d. Descontar del origen.
    if v_qty = v_item.quantity then
      update public.ticket_items
        set cancelled_at = now(),
            cancellation_reason = 'Movido a ' || coalesce(v_target_label, 'otra mesa')
        where id = v_item.id;
    else
      update public.ticket_items
        set quantity = v_item.quantity - v_qty,
            line_total_cents = v_item.unit_price_cents * (v_item.quantity - v_qty)
        where id = v_item.id;
    end if;

    v_moved_count := v_moved_count + 1;
  end loop;

  -- 8. Eventos en ambas sesiones (dispara realtime en grilla/plano/detalle).
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values
    (p_source_session_id, 'items_moved', auth.uid(),
      jsonb_build_object('direction', 'out', 'target_session_id', v_target_session_id,
                         'target_ticket_id', v_target_ticket_id, 'moved_count', v_moved_count)),
    (v_target_session_id, 'items_moved', auth.uid(),
      jsonb_build_object('direction', 'in', 'source_session_id', p_source_session_id,
                         'target_ticket_id', v_target_ticket_id, 'moved_count', v_moved_count));

  return jsonb_build_object(
    'target_session_id', v_target_session_id,
    'target_ticket_id', v_target_ticket_id,
    'moved_count', v_moved_count,
    'idempotent', false
  );
end $$;

revoke all on function public.move_ticket_items(uuid, uuid, jsonb, text) from public;
grant execute on function public.move_ticket_items(uuid, uuid, jsonb, text) to authenticated;
