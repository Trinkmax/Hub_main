-- Punto de venta, parte 2: cobrar la mesa y la caja por turno. Tramo 3 de 3: descuentos, bajas, aprobaciones y la caja.
-- (Sigue a los tramos anteriores; ver el encabezado del tramo 1.)

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Descuentos, bajas y aprobaciones
-- ─────────────────────────────────────────────────────────────────────────────
-- Un descuento a la mesa. p_value: puntos básicos si es porcentaje (1000 = 10 %), centavos si es monto.
-- Quien puede aprobar (o si el bar no pide aprobación) lo aplica directo; el resto deja un pedido.
create function public.pos_add_discount(p_session_id uuid, p_kind text, p_value bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_settings public.pos_settings%rowtype;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
  v_discount_id uuid;
  v_approval_id uuid;
  v_bill record;
begin
  select s.tenant_id into v_tenant from public.table_sessions s where s.id = p_session_id;
  if v_tenant is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_tenant, 'owner', 'cashier', 'waiter', 'host');
  if p_kind is null or p_kind not in ('percent', 'amount') or p_value is null or p_value < 1
     or p_value > 100000000000 or (p_kind = 'percent' and p_value > 10000) then
    raise exception 'discount_invalid' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_session from public.table_sessions s where s.id = p_session_id for update;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  v_settings := private.pos_settings_for(v_tenant);
  v_name := private.pos_actor_name(v_tenant, v_uid);

  if v_role = 'owner' or v_role::text = any (v_settings.approver_roles) or not v_settings.discount_needs_approval then
    -- Reintento (se cortó la señal y el celular lo mandó de nuevo): el mismo descuento, de la misma persona,
    -- hace un momento, no se aplica otra vez.
    select d.id into v_discount_id
      from public.pos_discounts d
     where d.session_id = p_session_id and d.status = 'active' and d.approval_id is null
       and d.kind = p_kind and d.value = p_value and d.reason = v_reason and d.created_by = v_uid
       and d.created_at > now() - interval '2 minutes'
     limit 1;
    if v_discount_id is not null then
      return jsonb_build_object('applied', true, 'discount_id', v_discount_id, 'approval_id', null, 'duplicate', true)
             || private.pos_session_result(p_session_id);
    end if;
    insert into public.pos_discounts (tenant_id, branch_id, session_id, kind, value, reason, created_by, created_by_name)
    values (v_tenant, v_session.branch_id, p_session_id, p_kind, p_value, v_reason, v_uid, v_name)
    returning id into v_discount_id;
    -- Un descuento no puede dejar la mesa con más cobrado que lo que debe.
    select * into v_bill from private.pos_bill(p_session_id);
    if v_bill.overpaid_cents > 0 then
      raise exception 'discount_exceeds_remaining' using errcode = '22023';
    end if;
    perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
    return jsonb_build_object('applied', true, 'discount_id', v_discount_id, 'approval_id', null, 'duplicate', false)
           || private.pos_session_result(p_session_id);
  end if;

  -- El mismo pedido que ya está esperando no se pide dos veces.
  select a.id into v_approval_id
    from public.pos_approvals a
   where a.session_id = p_session_id and a.kind = 'discount' and a.status = 'pending' and a.requested_by = v_uid
     and a.payload = jsonb_build_object('kind', p_kind, 'value', p_value, 'reason', v_reason)
   limit 1;
  if v_approval_id is not null then
    return jsonb_build_object('applied', false, 'discount_id', null, 'approval_id', v_approval_id, 'duplicate', true)
           || private.pos_session_result(p_session_id);
  end if;

  insert into public.pos_approvals (tenant_id, branch_id, kind, session_id, payload, summary, requested_by, requested_by_name)
  values (
    v_tenant, v_session.branch_id, 'discount', p_session_id,
    jsonb_build_object('kind', p_kind, 'value', p_value, 'reason', v_reason),
    left(private.pos_discount_label(p_kind, p_value) || ' · ' || v_reason, 200), v_uid, v_name
  ) returning id into v_approval_id;
  perform private.pos_poke(v_session.branch_id, 'approvals', p_session_id);
  return jsonb_build_object('applied', false, 'discount_id', null, 'approval_id', v_approval_id, 'duplicate', false)
         || private.pos_session_result(p_session_id);
end;
$$;

-- Quitar un descuento (no se borra: queda quién lo quitó). Lo hace quien puede aprobar, o quien lo puso.
create function public.pos_remove_discount(p_discount_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount public.pos_discounts%rowtype;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
begin
  select * into v_discount from public.pos_discounts d where d.id = p_discount_id;
  if not found then
    raise exception 'discount_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_discount.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions s where s.id = v_discount.session_id for update;
  select * into v_discount from public.pos_discounts d where d.id = p_discount_id for update;

  if v_discount.status = 'removed' then
    return jsonb_build_object('removed', true, 'duplicate', true) || private.pos_session_result(v_discount.session_id);
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  -- Ojo con el NULL: si quien lo puso ya no existe, la comparación no puede dejar pasar a cualquiera.
  if not (private.pos_is_approver(v_discount.tenant_id, v_role) or coalesce(v_discount.created_by = v_uid, false)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.pos_discounts
     set status = 'removed', removed_at = now(), removed_by = v_uid,
         removed_by_name = private.pos_actor_name(v_discount.tenant_id, v_uid)
   where id = p_discount_id;

  perform private.pos_poke(v_session.branch_id, 'floor', v_discount.session_id);
  return jsonb_build_object('removed', true, 'duplicate', false) || private.pos_session_result(v_discount.session_id);
end;
$$;

-- Dar de baja un renglón, por dentro: lo mismo que hace pos_cancel_item (parte 1) después de chequear.
create function private.pos_cancel_item_core(p_item_id uuid, p_reason text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
begin
  -- Primero la tanda y después el renglón: el mismo orden que usa cocina al avanzar una comanda.
  select ti.ticket_id into v_ticket_id from public.ticket_items ti where ti.id = p_item_id;
  if v_ticket_id is null then
    return;
  end if;
  perform 1 from public.tickets t where t.id = v_ticket_id for update;

  update public.ticket_items
     set cancelled_at = now(),
         cancellation_reason = left(coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Cargado por error'), 200),
         cancelled_by = p_by
   where id = p_item_id and cancelled_at is null;
  if not found then
    return;
  end if;

  -- Una tanda sin renglones vivos se cancela entera.
  if not exists (select 1 from public.ticket_items ti where ti.ticket_id = v_ticket_id and ti.cancelled_at is null) then
    update public.tickets
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Sin productos'
     where id = v_ticket_id and status <> 'cancelled';
  else
    perform private.pos_sync_ticket(v_ticket_id);
  end if;
end;
$$;

-- La baja con circuito de aprobación. pos_cancel_item (parte 1) sigue igual: deja al mozo dar de baja lo
-- que cocina no empezó y le contesta needs_approval por lo demás. Esta función cubre ese «lo demás»: si
-- quien llama puede aprobar (o el bar no pide aprobación para las bajas) lo da de baja ahí mismo; si no,
-- deja el pedido para que alguien dé el OK. Es más estricta que la de la parte 1 en dos cosas: un renglón
-- ya cobrado por producto no se da de baja, y con la cuenta pedida o un cobro hecho ya nada es «directo».
create function public.pos_request_void(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ticket_items%rowtype;
  v_ticket public.tickets%rowtype;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_settings public.pos_settings%rowtype;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
  v_name text;
  v_approval_id uuid;
  v_free boolean;
begin
  select * into v_item from public.ticket_items ti where ti.id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  select * into v_ticket from public.tickets t where t.id = v_item.ticket_id;
  v_role := private.pos_require_role(v_ticket.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions s where s.id = v_ticket.session_id for update;
  select * into v_ticket from public.tickets t where t.id = v_ticket.id for update;
  if v_ticket.session_id <> v_session.id then
    -- La tanda cambió de mesa mientras tanto: que vuelva a intentar con la cuenta al día.
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  select * into v_item from public.ticket_items ti where ti.id = p_item_id for update;

  if v_item.cancelled_at is not null then
    return jsonb_build_object('applied', true, 'approval_id', null, 'duplicate', true);
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  if private.pos_paid_units(v_session.id, p_item_id) > 0 then
    raise exception 'item_already_paid' using errcode = '55000';
  end if;
  -- «Cargado por error» vale mientras cocina no lo empezó Y la mesa todavía no entró en la cuenta: después
  -- de pedir la cuenta o de un cobro, toda baja lleva motivo y el OK de quien puede darlo.
  v_free := v_item.prep_status = 'queued' and v_session.bill_requested_at is null
            and not exists (
              select 1 from public.pos_payments p where p.session_id = v_session.id and p.status = 'ok'
            );
  if v_reason is null and not v_free then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  v_settings := private.pos_settings_for(v_ticket.tenant_id);

  if v_free or v_role = 'owner' or v_role::text = any (v_settings.approver_roles)
     or not v_settings.void_needs_approval then
    perform private.pos_cancel_item_core(p_item_id, v_reason, v_uid);
    perform private.pos_poke(v_session.branch_id, 'kitchen', v_session.id);
    return jsonb_build_object('applied', true, 'approval_id', null, 'duplicate', false);
  end if;

  select a.id into v_approval_id
    from public.pos_approvals a
   where a.session_id = v_session.id and a.kind = 'void_item' and a.status = 'pending'
     and a.payload ->> 'item_id' = p_item_id::text
   limit 1;
  if v_approval_id is not null then
    return jsonb_build_object('applied', false, 'approval_id', v_approval_id, 'duplicate', true);
  end if;

  v_name := private.pos_actor_name(v_ticket.tenant_id, v_uid);
  insert into public.pos_approvals (tenant_id, branch_id, kind, session_id, payload, summary, requested_by, requested_by_name)
  select v_ticket.tenant_id, v_session.branch_id, 'void_item', v_session.id,
         jsonb_build_object('item_id', v_item.id, 'reason', v_reason, 'name', mi.name,
                            'quantity', v_item.quantity, 'amount_cents', v_item.line_total_cents),
         left('Baja: ' || v_item.quantity::text || ' × ' || mi.name || ' · ' || v_reason, 200), v_uid, v_name
    from public.menu_items mi
   where mi.id = v_item.menu_item_id
  returning id into v_approval_id;

  perform private.pos_poke(v_session.branch_id, 'approvals', v_session.id);
  return jsonb_build_object('applied', false, 'approval_id', v_approval_id, 'duplicate', false);
end;
$$;

-- El OK (o el no) a un pedido. Aprobar aplica la cosa en el mismo movimiento; quien pidió puede retirar
-- su propio pedido. Si la mesa ya cerró, el pedido se cae solo.
create function public.pos_decide_approval(p_approval_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.pos_approvals%rowtype;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  v_can boolean;
  v_status text;
  v_item_id uuid;
  v_bill record;
begin
  select * into v_approval from public.pos_approvals a where a.id = p_approval_id;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_approval.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions s where s.id = v_approval.session_id for update;
  select * into v_approval from public.pos_approvals a where a.id = p_approval_id for update;

  if v_approval.status <> 'pending' then
    return jsonb_build_object('approval_id', v_approval.id, 'status', v_approval.status, 'kind', v_approval.kind,
                              'duplicate', true);
  end if;
  v_can := private.pos_is_approver(v_approval.tenant_id, v_role);
  v_name := private.pos_actor_name(v_approval.tenant_id, v_uid);

  if not coalesce(p_approve, false) then
    if v_can then
      v_status := 'rejected';
    elsif v_approval.requested_by = v_uid then
      v_status := 'cancelled';
    else
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif not v_can then
    raise exception 'forbidden' using errcode = '42501';
  elsif v_session.status <> 'open' then
    v_status := 'cancelled';
    v_note := coalesce(v_note, 'La mesa ya se cerró');
  else
    v_status := 'approved';
    if v_approval.kind = 'discount' then
      insert into public.pos_discounts (
        tenant_id, branch_id, session_id, kind, value, reason, approval_id, created_by, created_by_name, approved_by_name
      ) values (
        v_approval.tenant_id, v_approval.branch_id, v_approval.session_id, v_approval.payload ->> 'kind',
        (v_approval.payload ->> 'value')::bigint, v_approval.payload ->> 'reason', v_approval.id,
        v_approval.requested_by, v_approval.requested_by_name, v_name
      );
      select * into v_bill from private.pos_bill(v_approval.session_id);
      if v_bill.overpaid_cents > 0 then
        raise exception 'discount_exceeds_remaining' using errcode = '22023';
      end if;
      perform private.pos_poke(v_approval.branch_id, 'floor', v_approval.session_id);
    else
      v_item_id := (v_approval.payload ->> 'item_id')::uuid;
      if not exists (
        select 1
          from public.ticket_items ti
          join public.tickets t on t.id = ti.ticket_id
         where ti.id = v_item_id and t.session_id = v_approval.session_id
      ) then
        raise exception 'item_not_found' using errcode = 'P0002';
      end if;
      if private.pos_paid_units(v_approval.session_id, v_item_id) > 0 then
        raise exception 'item_already_paid' using errcode = '55000';
      end if;
      perform private.pos_cancel_item_core(v_item_id, v_approval.payload ->> 'reason', v_approval.requested_by);
      perform private.pos_poke(v_approval.branch_id, 'kitchen', v_approval.session_id);
    end if;
  end if;

  update public.pos_approvals
     set status = v_status, decided_by = v_uid, decided_by_name = v_name, decided_at = now(), decision_note = v_note
   where id = p_approval_id;

  perform private.pos_poke(v_approval.branch_id, 'approvals', v_approval.session_id);
  return jsonb_build_object('approval_id', v_approval.id, 'status', v_status, 'kind', v_approval.kind,
                            'duplicate', false);
end;
$$;

-- La bandeja de pedidos de una sucursal. Quien puede aprobar ve todo lo pendiente; el resto, lo suyo.
-- `recent` trae lo decidido en las últimas 12 horas, para que quien pidió vea qué le contestaron.
create function public.pos_approvals_inbox(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_can boolean;
begin
  select * into v_branch from public.branches b where b.id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  v_can := private.pos_is_approver(v_branch.tenant_id, v_role);

  return jsonb_build_object(
    'now', now(),
    'can_decide', v_can,
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'status', a.status, 'summary', a.summary, 'payload', a.payload,
        'session_id', a.session_id, 'table_label', p.label, 'alias', s.alias,
        'requested_by_name', a.requested_by_name, 'requested_at', a.requested_at,
        'mine', coalesce(a.requested_by = v_uid, false)
      ) order by a.requested_at), '[]'::jsonb)
      from public.pos_approvals a
      join public.table_sessions s on s.id = a.session_id
      left join public.physical_tables p on p.id = s.physical_table_id
      where a.branch_id = p_branch_id and a.status = 'pending' and (v_can or a.requested_by = v_uid)
    ),
    'recent', (
      select coalesce(jsonb_agg(x.row order by x.decided_at desc), '[]'::jsonb)
      from (
        select a.decided_at, jsonb_build_object(
          'id', a.id, 'kind', a.kind, 'status', a.status, 'summary', a.summary,
          'session_id', a.session_id, 'table_label', p.label, 'alias', s.alias,
          'requested_by_name', a.requested_by_name, 'requested_at', a.requested_at,
          'decided_by_name', a.decided_by_name, 'decided_at', a.decided_at, 'decision_note', a.decision_note,
          'mine', coalesce(a.requested_by = v_uid, false)
        ) as row
        from public.pos_approvals a
        join public.table_sessions s on s.id = a.session_id
        left join public.physical_tables p on p.id = s.physical_table_id
        where a.branch_id = p_branch_id and a.status <> 'pending'
          and a.decided_at > now() - interval '12 hours'
          and (v_can or a.requested_by = v_uid)
        order by a.decided_at desc
        limit 30
      ) x
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. La caja: abrir, mover plata, cerrar
-- ─────────────────────────────────────────────────────────────────────────────
-- Abrir el turno. p_opening_float_cents es lo que quien abre dice que hay; al lado queda lo que el turno
-- anterior de esa caja dijo que dejaba («Quedaron $ 15.000 de cambio, ¿están?»). Si la sucursal todavía
-- no tiene caja, se crea «Caja». Dos toques seguidos devuelven el mismo turno.
create function public.pos_open_shift(
  p_branch_id uuid,
  p_opening_float_cents bigint,
  p_label text default null,
  p_note text default null,
  p_register_id uuid default null,
  p_practice boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_register public.pos_registers%rowtype;
  v_shift public.pos_shifts%rowtype;
  v_uid uuid := (select auth.uid());
  v_practice boolean := coalesce(p_practice, false);
  v_expected bigint;
  v_count integer;
begin
  select * into v_branch from public.branches b where b.id = p_branch_id and b.active;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier');
  if p_opening_float_cents is null or p_opening_float_cents < 0 or p_opening_float_cents > 100000000000 then
    raise exception 'amount_invalid' using errcode = '22023';
  end if;

  if p_register_id is not null then
    select * into v_register
      from public.pos_registers r
     where r.id = p_register_id and r.branch_id = p_branch_id and r.active
       for update;
    if not found then
      raise exception 'register_not_found' using errcode = 'P0002';
    end if;
  else
    select count(*) into v_count from public.pos_registers r where r.branch_id = p_branch_id and r.active;
    if v_count > 1 then
      raise exception 'register_required' using errcode = '22023';
    end if;
    if v_count = 0 then
      insert into public.pos_registers (tenant_id, branch_id, name)
      values (v_branch.tenant_id, p_branch_id, 'Caja')
      on conflict (branch_id, lower(btrim(name))) do update set active = true;
    end if;
    select * into v_register
      from public.pos_registers r
     where r.branch_id = p_branch_id and r.active
     order by r.position, r.created_at
     limit 1
       for update;
  end if;

  select * into v_shift
    from public.pos_shifts sh
   where sh.register_id = v_register.id and sh.is_practice = v_practice and sh.status = 'open';
  if found then
    return jsonb_build_object('shift_id', v_shift.id, 'register_id', v_register.id, 'already_open', true,
                              'opening_float_cents', v_shift.opening_float_cents,
                              'opening_expected_cents', v_shift.opening_expected_cents);
  end if;

  select sh.leave_float_cents into v_expected
    from public.pos_shifts sh
   where sh.register_id = v_register.id and sh.is_practice = v_practice and sh.status = 'closed'
   order by sh.closed_at desc
   limit 1;

  insert into public.pos_shifts (
    tenant_id, branch_id, register_id, service_day, label, is_practice, opened_by, opened_by_name,
    opening_float_cents, opening_expected_cents, opening_note
  ) values (
    v_branch.tenant_id, p_branch_id, v_register.id, private.pos_service_day(v_branch.tenant_id),
    nullif(left(btrim(coalesce(p_label, '')), 30), ''), v_practice, v_uid,
    private.pos_actor_name(v_branch.tenant_id, v_uid), p_opening_float_cents, v_expected,
    nullif(left(btrim(coalesce(p_note, '')), 300), '')
  ) returning * into v_shift;

  perform private.pos_poke(p_branch_id, 'cash', null);
  return jsonb_build_object('shift_id', v_shift.id, 'register_id', v_register.id, 'already_open', false,
                            'opening_float_cents', v_shift.opening_float_cents,
                            'opening_expected_cents', v_shift.opening_expected_cents);
end;
$$;

-- Plata que entra o sale del cajón sin ser un cobro. Siempre con motivo; la foto es opcional y tiene que
-- estar en la carpeta del bar.
create function public.pos_cash_movement(
  p_shift_id uuid,
  p_kind text,
  p_amount_cents bigint,
  p_reason text,
  p_photo_path text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts%rowtype;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_id uuid;
begin
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id;
  if not found then
    raise exception 'shift_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_shift.tenant_id, 'owner', 'cashier');
  if p_kind is null or p_kind not in ('in', 'out') then
    raise exception 'movement_kind_invalid' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000000 then
    raise exception 'amount_invalid' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_photo is not null and (
    char_length(v_photo) > 300 or v_photo like '%..%' or v_photo not like v_shift.tenant_id::text || '/%'
  ) then
    raise exception 'photo_path_invalid' using errcode = '22023';
  end if;
  if v_key is not null and char_length(v_key) not between 8 and 80 then
    raise exception 'idempotency_key_invalid' using errcode = '22023';
  end if;

  -- Bloqueado contra un cierre simultáneo: lo que se anota entra en el arqueo o no se anota.
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id for share;
  if v_key is not null then
    select m.id into v_id
      from public.pos_cash_movements m
     where m.shift_id = p_shift_id and m.idempotency_key = v_key;
    if v_id is not null then
      return jsonb_build_object('movement_id', v_id, 'duplicate', true);
    end if;
  end if;
  if v_shift.status <> 'open' then
    raise exception 'shift_not_open' using errcode = '55000';
  end if;

  insert into public.pos_cash_movements (
    tenant_id, branch_id, shift_id, kind, amount_cents, reason, photo_path, idempotency_key, created_by, created_by_name
  ) values (
    v_shift.tenant_id, v_shift.branch_id, p_shift_id, p_kind, p_amount_cents, v_reason, v_photo, v_key, v_uid,
    private.pos_actor_name(v_shift.tenant_id, v_uid)
  )
  on conflict (shift_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    -- Dos reintentos a la vez con la misma clave: entró el otro.
    select m.id into v_id
      from public.pos_cash_movements m
     where m.shift_id = p_shift_id and m.idempotency_key = v_key;
    return jsonb_build_object('movement_id', v_id, 'duplicate', true);
  end if;

  perform private.pos_poke(v_shift.branch_id, 'cash', null);
  return jsonb_build_object('movement_id', v_id, 'duplicate', false);
end;
$$;

-- Un movimiento anotado por error: no se borra, se anula con motivo. Con el turno cerrado, solo un dueño.
create function public.pos_void_cash_movement(p_movement_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.pos_cash_movements%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
  v_shift_status text;
begin
  select * into v_movement from public.pos_cash_movements m where m.id = p_movement_id;
  if not found then
    raise exception 'movement_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_movement.tenant_id, 'owner', 'cashier');
  select sh.status into v_shift_status from public.pos_shifts sh where sh.id = v_movement.shift_id for share;
  select * into v_movement from public.pos_cash_movements m where m.id = p_movement_id for update;

  if v_movement.voided_at is not null then
    return jsonb_build_object('movement_id', v_movement.id, 'duplicate', true);
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_shift_status = 'closed' and v_role <> 'owner' then
    raise exception 'closed_shift_owner_only' using errcode = '42501';
  end if;

  update public.pos_cash_movements
     set voided_at = now(), voided_by = v_uid,
         voided_by_name = private.pos_actor_name(v_movement.tenant_id, v_uid), void_reason = v_reason
   where id = p_movement_id;

  perform private.pos_poke(v_movement.branch_id, 'cash', null);
  return jsonb_build_object('movement_id', v_movement.id, 'duplicate', false);
end;
$$;

-- Los números de un turno, en vivo: cuánto entró por cada medio, cuánto efectivo tiene que haber, y la
-- lista de descuentos, bajas, anulaciones, correcciones y movimientos con quién hizo cada cosa.
--   · efectivo que tiene que haber = cambio inicial + cobros en efectivo + ingresos − retiros. El vuelto ya
--     está descontado (amount_cents es lo que quedó) y la propina no cuenta: va aparte;
--   · nunca entran los cobros anulados ni los de práctica (salvo en un turno de práctica, que solo tiene esos);
--   · mesas, comensales y per cápita salen de las cuentas que se cerraron en este turno;
--   · las bajas son las que se dieron mientras el turno estuvo abierto, en esta sucursal.
create function private.pos_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts%rowtype;
  v_until timestamptz;
  v_n integer;
  v_sales bigint;
  v_surcharge bigint;
  v_tips bigint;
  v_invoiced bigint;
  v_cash_sales bigint;
  v_cash_tips bigint;
  v_in bigint;
  v_out bigint;
  v_tables integer;
  v_people integer;
  v_consumption bigint;
  v_discounts bigint;
  v_deposits bigint;
begin
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id;
  if not found then
    return null;
  end if;
  v_until := coalesce(v_shift.closed_at, now());

  select count(*)::integer,
         coalesce(sum(p.amount_cents), 0),
         coalesce(sum(p.surcharge_cents), 0),
         coalesce(sum(p.tip_cents), 0),
         coalesce(sum(p.amount_cents + p.surcharge_cents) filter (where p.invoice), 0),
         coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.tip_cents) filter (where p.method = 'cash'), 0)
    into v_n, v_sales, v_surcharge, v_tips, v_invoiced, v_cash_sales, v_cash_tips
    from public.pos_payments p
   where p.shift_id = v_shift.id and p.status = 'ok' and p.is_practice = v_shift.is_practice;

  select coalesce(sum(m.amount_cents) filter (where m.kind = 'in'), 0),
         coalesce(sum(m.amount_cents) filter (where m.kind = 'out'), 0)
    into v_in, v_out
    from public.pos_cash_movements m
   where m.shift_id = v_shift.id and m.voided_at is null;

  select count(*)::integer,
         coalesce(sum(coalesce(cb.party_size, 0)), 0)::integer,
         coalesce(sum(cb.subtotal_cents - cb.discount_cents), 0),
         coalesce(sum(cb.discount_cents), 0),
         coalesce(sum(cb.deposit_cents), 0)
    into v_tables, v_people, v_consumption, v_discounts, v_deposits
    from public.pos_closed_bills cb
   where cb.shift_id = v_shift.id and cb.is_practice = v_shift.is_practice;

  return jsonb_build_object(
    'by_method', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', x.method, 'count', x.n, 'amount_cents', x.amount, 'surcharge_cents', x.surcharge,
        'tip_cents', x.tip, 'total_cents', x.amount + x.surcharge + x.tip
      ) order by array_position(array['cash', 'transfer', 'qr', 'debit', 'credit', 'other'], x.method)), '[]'::jsonb)
      from (
        select p.method, count(*)::integer as n, sum(p.amount_cents)::bigint as amount,
               sum(p.surcharge_cents)::bigint as surcharge, sum(p.tip_cents)::bigint as tip
          from public.pos_payments p
         where p.shift_id = v_shift.id and p.status = 'ok' and p.is_practice = v_shift.is_practice
         group by p.method
      ) x
    ),
    'payments_count', v_n,
    'sales_cents', v_sales,
    'surcharge_cents', v_surcharge,
    'tip_cents', v_tips,
    'collected_cents', v_sales + v_surcharge + v_tips,
    'invoiced_cents', v_invoiced,
    'not_invoiced_cents', v_sales + v_surcharge - v_invoiced,
    'opening_float_cents', v_shift.opening_float_cents,
    'opening_expected_cents', v_shift.opening_expected_cents,
    'cash_sales_cents', v_cash_sales,
    'cash_tips_cents', v_cash_tips,
    'cash_in_cents', v_in,
    'cash_out_cents', v_out,
    'expected_cash_cents', v_shift.opening_float_cents + v_cash_sales + v_in - v_out,
    'tables', v_tables,
    'people', v_people,
    'consumption_cents', v_consumption,
    'per_person_cents', case when v_people > 0 then ((v_consumption / v_people + 50) / 100) * 100 end,
    'discount_cents', v_discounts,
    'deposit_cents', v_deposits,
    'discounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', d.session_id, 'table_label', pt.label, 'kind', d.kind, 'value', d.value,
        'amount_cents', case
          when d.kind = 'percent' then ((cb.subtotal_cents * d.value + 500000) / 1000000) * 100
          else d.value
        end,
        'reason', d.reason, 'by_name', d.created_by_name, 'approved_by_name', d.approved_by_name, 'at', d.created_at
      ) order by d.created_at), '[]'::jsonb)
      from public.pos_closed_bills cb
      join public.pos_discounts d on d.session_id = cb.session_id and d.status = 'active'
      join public.table_sessions s on s.id = cb.session_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      where cb.shift_id = v_shift.id and cb.is_practice = v_shift.is_practice
    ),
    -- Cada seña que se descontó: plata que no pasó por la caja esta noche. A la vista, para cotejarla.
    'deposits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', cb.session_id, 'table_label', pt.label, 'name', r.guest_name,
        'amount_cents', cb.deposit_cents, 'by_name', cb.closed_by_name, 'at', cb.closed_at
      ) order by cb.closed_at), '[]'::jsonb)
      from public.pos_closed_bills cb
      join public.table_sessions s on s.id = cb.session_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      left join public.salon_reservations r on r.id = cb.reservation_id
      where cb.shift_id = v_shift.id and cb.is_practice = v_shift.is_practice and cb.deposit_cents > 0
    ),
    'item_voids', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'session_id', s.id, 'table_label', pt.label, 'name', mi.name, 'quantity', ti.quantity,
        'amount_cents', ti.line_total_cents, 'reason', ti.cancellation_reason,
        'started', ti.prep_status <> 'queued',
        'by_name', private.pos_actor_name(s.tenant_id, ti.cancelled_by), 'at', ti.cancelled_at
      ) order by ti.cancelled_at), '[]'::jsonb)
      from public.table_sessions s
      join public.tickets t on t.session_id = s.id
      join public.ticket_items ti on ti.ticket_id = t.id
      join public.menu_items mi on mi.id = ti.menu_item_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      where s.branch_id = v_shift.branch_id and s.is_practice = v_shift.is_practice
        and s.service_day between v_shift.service_day - 1 and v_shift.service_day + 1
        and ti.cancelled_at >= v_shift.opened_at and ti.cancelled_at <= v_until
    ),
    'payment_voids', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'session_id', p.session_id, 'table_label', pt.label, 'method', p.method,
        'amount_cents', p.amount_cents, 'reason', p.void_reason, 'by_name', p.voided_by_name, 'at', p.voided_at
      ) order by p.voided_at), '[]'::jsonb)
      from public.pos_payments p
      join public.table_sessions s on s.id = p.session_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      where p.shift_id = v_shift.id and p.status = 'voided'
    ),
    'corrections', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'session_id', p.session_id, 'table_label', pt.label,
        'amount_cents', p.amount_cents, 'field', e.field, 'old_value', e.old_value, 'new_value', e.new_value,
        'note', e.note, 'by_name', e.edited_by_name, 'at', e.created_at, 'after_close', e.shift_closed
      ) order by e.created_at, e.field), '[]'::jsonb)
      from public.pos_payment_edits e
      join public.pos_payments p on p.id = e.payment_id
      join public.table_sessions s on s.id = p.session_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      where p.shift_id = v_shift.id
    ),
    'movements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'amount_cents', m.amount_cents, 'reason', m.reason,
        'photo_path', m.photo_path, 'by_name', m.created_by_name, 'at', m.created_at,
        'voided_at', m.voided_at, 'voided_by_name', m.voided_by_name, 'void_reason', m.void_reason
      ) order by m.created_at), '[]'::jsonb)
      from public.pos_cash_movements m
      where m.shift_id = v_shift.id
    ),
    -- Lo que queda abierto en el salón ahora mismo (un turno puede cerrar con mesas todavía comiendo).
    'open_tables', (
      select jsonb_build_object('count', count(*), 'pending_cents', coalesce(sum(b.remaining_cents), 0))
      from public.table_sessions s
      cross join lateral private.pos_bill(s.id) b
      where s.branch_id = v_shift.branch_id and s.status = 'open' and s.is_practice = v_shift.is_practice
    )
  );
end;
$$;

-- Cerrar el turno. Se cuenta la plata ANTES de ver cuánto tenía que haber (eso lo cuida la pantalla); acá
-- se compara lo contado con lo esperado y queda la diferencia, lo que se deja de cambio y el resumen.
-- p_breakdown: { "bills": [{ "value": 20000, "count": 3 }, …], "other_cents": 0 } — tiene que sumar lo contado.
create function public.pos_close_shift(
  p_shift_id uuid,
  p_counted_cents bigint,
  p_breakdown jsonb default null,
  p_leave_float_cents bigint default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.pos_shifts%rowtype;
  v_uid uuid := (select auth.uid());
  v_sum bigint;
  v_leave bigint := coalesce(p_leave_float_cents, 0);
  v_summary jsonb;
  v_expected bigint;
begin
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id;
  if not found then
    raise exception 'shift_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_shift.tenant_id, 'owner', 'cashier');
  -- Bloqueado: los cobros que estén entrando terminan antes, y los que lleguen después ya no entran.
  select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id for update;

  if v_shift.status = 'closed' then
    return jsonb_build_object(
      'shift_id', v_shift.id, 'already_closed', true, 'expected_cash_cents', v_shift.expected_cash_cents,
      'counted_cash_cents', v_shift.counted_cash_cents, 'difference_cents', v_shift.difference_cents,
      'leave_float_cents', v_shift.leave_float_cents,
      'withdrawn_cents', v_shift.counted_cash_cents - v_shift.leave_float_cents, 'summary', v_shift.summary
    );
  end if;
  if p_counted_cents is null or p_counted_cents < 0 or p_counted_cents > 100000000000 then
    raise exception 'count_invalid' using errcode = '22023';
  end if;
  if v_leave < 0 or v_leave > p_counted_cents then
    raise exception 'leave_float_invalid' using errcode = '22023';
  end if;

  if p_breakdown is not null then
    begin
      if jsonb_typeof(p_breakdown) <> 'object'
         or jsonb_typeof(coalesce(p_breakdown -> 'bills', '[]'::jsonb)) <> 'array'
         or jsonb_array_length(coalesce(p_breakdown -> 'bills', '[]'::jsonb)) > 40
         or exists (
           select 1 from jsonb_array_elements(coalesce(p_breakdown -> 'bills', '[]'::jsonb)) b
            where (b ->> 'value')::bigint < 1 or (b ->> 'count')::bigint < 0 or (b ->> 'count')::bigint > 100000
         )
         or coalesce((p_breakdown ->> 'other_cents')::bigint, 0) < 0 then
        raise exception 'count_invalid';
      end if;
      select coalesce(sum((b ->> 'value')::bigint * 100 * (b ->> 'count')::bigint), 0)
             + coalesce((p_breakdown ->> 'other_cents')::bigint, 0)
        into v_sum
        from jsonb_array_elements(coalesce(p_breakdown -> 'bills', '[]'::jsonb)) b;
    exception when others then
      raise exception 'count_invalid' using errcode = '22023';
    end;
    if v_sum is distinct from p_counted_cents then
      raise exception 'count_mismatch' using errcode = '22023';
    end if;
  end if;

  v_summary := private.pos_shift_summary(p_shift_id);
  v_expected := (v_summary ->> 'expected_cash_cents')::bigint;
  v_summary := v_summary || jsonb_build_object(
    'counted_cash_cents', p_counted_cents,
    'difference_cents', p_counted_cents - v_expected,
    'leave_float_cents', v_leave,
    'withdrawn_cents', p_counted_cents - v_leave,
    'closed_at', now()
  );

  update public.pos_shifts
     set status = 'closed', closed_at = now(), closed_by = v_uid,
         closed_by_name = private.pos_actor_name(v_shift.tenant_id, v_uid),
         counted_cash_cents = p_counted_cents, count_breakdown = p_breakdown,
         expected_cash_cents = v_expected, difference_cents = p_counted_cents - v_expected,
         leave_float_cents = v_leave, closing_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
         summary = v_summary
   where id = p_shift_id;

  perform private.pos_poke(v_shift.branch_id, 'cash', null);
  return jsonb_build_object(
    'shift_id', v_shift.id, 'already_closed', false, 'expected_cash_cents', v_expected,
    'counted_cash_cents', p_counted_cents, 'difference_cents', p_counted_cents - v_expected,
    'leave_float_cents', v_leave, 'withdrawn_cents', p_counted_cents - v_leave, 'summary', v_summary
  );
end;
$$;

-- La pantalla de caja de una sucursal: el turno abierto (o el último que se cerró), sus números en vivo,
-- los cobros del día de servicio con sus correcciones, las cajas con lo que dejó cada una y los pedidos
-- pendientes. Con p_shift_id se mira un turno puntual (historial).
create function public.pos_shift_snapshot(
  p_branch_id uuid,
  p_shift_id uuid default null,
  p_practice boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
  v_shift public.pos_shifts%rowtype;
  v_role public.tenant_role;
  v_settings public.pos_settings%rowtype;
  v_uid uuid := (select auth.uid());
  v_practice boolean := coalesce(p_practice, false);
  v_day date;
begin
  select * into v_branch from public.branches b where b.id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier');
  v_settings := private.pos_settings_for(v_branch.tenant_id);

  if p_shift_id is not null then
    select * into v_shift from public.pos_shifts sh where sh.id = p_shift_id and sh.branch_id = p_branch_id;
    if not found then
      raise exception 'shift_not_found' using errcode = 'P0002';
    end if;
    v_practice := v_shift.is_practice;
  else
    -- El abierto (si hay más de una caja, el que abrió quien mira); si no hay, el último que cerró.
    select * into v_shift
      from public.pos_shifts sh
     where sh.branch_id = p_branch_id and sh.is_practice = v_practice
     order by (sh.status = 'open') desc, (sh.opened_by is not distinct from v_uid) desc,
              coalesce(sh.closed_at, sh.opened_at) desc
     limit 1;
  end if;
  v_day := coalesce(v_shift.service_day, private.pos_service_day(v_branch.tenant_id));

  return jsonb_build_object(
    'now', now(),
    'service_day', v_day,
    'practice', v_practice,
    'role', v_role,
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name, 'slug', v_branch.slug),
    'settings', jsonb_build_object(
      'bill_denominations', to_jsonb(v_settings.bill_denominations),
      'credit_surcharge_bp', v_settings.credit_surcharge_bp,
      'invoice_by_method', v_settings.invoice_by_method,
      'tip_presets_pct', to_jsonb(v_settings.tip_presets_pct)
    ),
    'registers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'position', r.position,
        'open_shift_id', (
          select sh.id from public.pos_shifts sh
           where sh.register_id = r.id and sh.status = 'open' and sh.is_practice = v_practice
        ),
        -- Lo que dejó el último turno de esta caja: con eso se abre el que sigue.
        'last_closed', (
          select jsonb_build_object(
            'shift_id', sh.id, 'label', sh.label, 'closed_at', sh.closed_at,
            'closed_by_name', sh.closed_by_name, 'leave_float_cents', sh.leave_float_cents
          )
          from public.pos_shifts sh
          where sh.register_id = r.id and sh.status = 'closed' and sh.is_practice = v_practice
          order by sh.closed_at desc
          limit 1
        )
      ) order by r.position, r.created_at), '[]'::jsonb)
      from public.pos_registers r
      where r.branch_id = p_branch_id and r.active
    ),
    'shift', case when v_shift.id is null then null else jsonb_build_object(
      'id', v_shift.id, 'register_id', v_shift.register_id,
      'register', (select r.name from public.pos_registers r where r.id = v_shift.register_id),
      'label', v_shift.label, 'status', v_shift.status, 'service_day', v_shift.service_day,
      'is_practice', v_shift.is_practice, 'opened_at', v_shift.opened_at,
      'opened_by_name', v_shift.opened_by_name, 'opening_float_cents', v_shift.opening_float_cents,
      'opening_expected_cents', v_shift.opening_expected_cents, 'opening_note', v_shift.opening_note,
      'closed_at', v_shift.closed_at, 'closed_by_name', v_shift.closed_by_name,
      'counted_cash_cents', v_shift.counted_cash_cents, 'count_breakdown', v_shift.count_breakdown,
      'expected_cash_cents', v_shift.expected_cash_cents, 'difference_cents', v_shift.difference_cents,
      'leave_float_cents', v_shift.leave_float_cents, 'closing_note', v_shift.closing_note,
      -- La foto que quedó al cerrar. `live` (abajo) son los mismos números recalculados ahora: si un
      -- dueño corrigió algo después del cierre, se ve la diferencia entre los dos.
      'summary', v_shift.summary
    ) end,
    'live', case when v_shift.id is null then null else private.pos_shift_summary(v_shift.id) end,
    'payments', (
      select coalesce(jsonb_agg(x.row order by x.created_at desc, x.id), '[]'::jsonb)
      from (
        select p.created_at, p.id,
               private.pos_payment_json(p.id)
               || jsonb_build_object('table_label', pt.label, 'alias', s.alias, 'table_closed', s.status = 'paid') as row
          from public.pos_payments p
          join public.table_sessions s on s.id = p.session_id
          left join public.physical_tables pt on pt.id = s.physical_table_id
         where p.branch_id = p_branch_id and p.is_practice = v_practice
           and (p.service_day = v_day or p.shift_id = v_shift.id)
         order by p.created_at desc
         limit 600
      ) x
    ),
    'pending_approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'summary', a.summary, 'payload', a.payload, 'session_id', a.session_id,
        'table_label', pt.label, 'alias', s.alias, 'requested_by_name', a.requested_by_name,
        'requested_at', a.requested_at
      ) order by a.requested_at), '[]'::jsonb)
      from public.pos_approvals a
      join public.table_sessions s on s.id = a.session_id
      left join public.physical_tables pt on pt.id = s.physical_table_id
      where a.branch_id = p_branch_id and a.status = 'pending'
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de las funciones de este tramo
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.pos_add_discount(uuid, text, bigint, text) from public, anon;
revoke all on function public.pos_remove_discount(uuid) from public, anon;
revoke all on function public.pos_request_void(uuid, text) from public, anon;
revoke all on function public.pos_decide_approval(uuid, boolean, text) from public, anon;
revoke all on function public.pos_approvals_inbox(uuid) from public, anon;
revoke all on function public.pos_open_shift(uuid, bigint, text, text, uuid, boolean) from public, anon;
revoke all on function public.pos_cash_movement(uuid, text, bigint, text, text, text) from public, anon;
revoke all on function public.pos_void_cash_movement(uuid, text) from public, anon;
revoke all on function public.pos_close_shift(uuid, bigint, jsonb, bigint, text) from public, anon;
revoke all on function public.pos_shift_snapshot(uuid, uuid, boolean) from public, anon;
grant execute on function public.pos_add_discount(uuid, text, bigint, text) to authenticated;
grant execute on function public.pos_remove_discount(uuid) to authenticated;
grant execute on function public.pos_request_void(uuid, text) to authenticated;
grant execute on function public.pos_decide_approval(uuid, boolean, text) to authenticated;
grant execute on function public.pos_approvals_inbox(uuid) to authenticated;
grant execute on function public.pos_open_shift(uuid, bigint, text, text, uuid, boolean) to authenticated;
grant execute on function public.pos_cash_movement(uuid, text, bigint, text, text, text) to authenticated;
grant execute on function public.pos_void_cash_movement(uuid, text) to authenticated;
grant execute on function public.pos_close_shift(uuid, bigint, jsonb, bigint, text) to authenticated;
grant execute on function public.pos_shift_snapshot(uuid, uuid, boolean) to authenticated;
revoke all on function private.pos_cancel_item_core(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.pos_shift_summary(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
