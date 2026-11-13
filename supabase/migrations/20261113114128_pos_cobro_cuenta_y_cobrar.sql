-- Punto de venta, parte 2: cobrar la mesa y la caja por turno. Tramo 2 de 3: la cuenta y cobrar.
-- (Sigue a los tramos anteriores; ver el encabezado del tramo 1.)

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. La cuenta
-- ─────────────────────────────────────────────────────────────────────────────

-- Cuántas unidades de un renglón ya están cubiertas por cobros (división por producto).
create function private.pos_paid_units(p_session_id uuid, p_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.pos_payments p
    cross join lateral unnest(p.item_ids) as paid(id)
   where p.session_id = p_session_id and p.status = 'ok' and paid.id = p_item_id;
$$;

-- Los números de la cuenta de una mesa.
--   consumo   = renglones vivos de tandas vivas;
--   descuento = porcentajes (sobre el consumo, redondeado al peso) + montos, nunca más que el consumo;
--   seña      = la de la reserva, hasta donde alcance la cuenta, y solo lo que no usó otra mesa de la
--               misma reserva; nada en una mesa de práctica;
--   falta     = consumo − descuento − seña − cobros.
-- Si la mesa ya cerró, consumo, descuento y seña son los que quedaron escritos al cerrar.
create function private.pos_bill(p_session_id uuid)
returns table (
  subtotal_cents bigint,
  discount_cents bigint,
  deposit_cents bigint,
  due_cents bigint,
  paid_cents bigint,
  remaining_cents bigint,
  overpaid_cents bigint,
  surcharge_cents bigint,
  tip_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_closed public.pos_closed_bills%rowtype;
  v_pct bigint;
  v_off bigint;
  v_net bigint;
  v_deposit bigint := 0;
begin
  select * into v_session from public.table_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(p.amount_cents), 0), coalesce(sum(p.surcharge_cents), 0), coalesce(sum(p.tip_cents), 0)
    into paid_cents, surcharge_cents, tip_cents
    from public.pos_payments p
   where p.session_id = p_session_id and p.status = 'ok';

  select * into v_closed from public.pos_closed_bills cb where cb.session_id = p_session_id;
  if found then
    subtotal_cents := v_closed.subtotal_cents;
    discount_cents := v_closed.discount_cents;
    deposit_cents := v_closed.deposit_cents;
    due_cents := v_closed.due_cents;
    remaining_cents := greatest(due_cents - paid_cents, 0);
    overpaid_cents := greatest(paid_cents - due_cents, 0);
    return next;
    return;
  end if;

  select coalesce(sum(ti.line_total_cents), 0)
    into subtotal_cents
    from public.tickets t
    join public.ticket_items ti on ti.ticket_id = t.id
   where t.session_id = p_session_id and t.status <> 'cancelled' and ti.cancelled_at is null;

  select coalesce(sum(d.value) filter (where d.kind = 'percent'), 0),
         coalesce(sum(d.value) filter (where d.kind = 'amount'), 0)
    into v_pct, v_off
    from public.pos_discounts d
   where d.session_id = p_session_id and d.status = 'active';
  discount_cents := least(
    subtotal_cents,
    ((subtotal_cents * least(v_pct, 10000) + 500000) / 1000000) * 100 + v_off
  );
  v_net := subtotal_cents - discount_cents;

  if v_session.reservation_id is not null and not v_session.is_practice then
    select greatest(r.deposit_cents - coalesce((
             select sum(cb.deposit_cents)
               from public.pos_closed_bills cb
              where cb.reservation_id = r.id and cb.session_id <> p_session_id), 0), 0)
      into v_deposit
      from public.salon_reservations r
     where r.id = v_session.reservation_id;
  end if;
  deposit_cents := least(coalesce(v_deposit, 0), v_net);
  due_cents := v_net - deposit_cents;
  remaining_cents := greatest(due_cents - paid_cents, 0);
  overpaid_cents := greatest(paid_cents - due_cents, 0);
  return next;
end;
$$;

-- Un cobro, como lo leen las pantallas.
create function private.pos_payment_json(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'session_id', p.session_id, 'shift_id', p.shift_id, 'created_at', p.created_at,
    'method', p.method, 'amount_cents', p.amount_cents, 'surcharge_cents', p.surcharge_cents,
    'tip_cents', p.tip_cents, 'tendered_cents', p.tendered_cents, 'change_cents', p.change_cents,
    'total_cents', p.amount_cents + p.surcharge_cents + p.tip_cents,
    'invoice', p.invoice, 'payer_label', p.payer_label, 'item_ids', to_jsonb(p.item_ids),
    'reference', p.reference, 'status', p.status, 'voided_at', p.voided_at,
    'voided_by_name', p.voided_by_name, 'void_reason', p.void_reason, 'is_practice', p.is_practice,
    'created_by_name', p.created_by_name,
    'edits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'field', e.field, 'old_value', e.old_value, 'new_value', e.new_value, 'note', e.note,
        'by_name', e.edited_by_name, 'at', e.created_at, 'after_close', e.shift_closed
      ) order by e.created_at, e.field), '[]'::jsonb)
      from public.pos_payment_edits e where e.payment_id = p.id
    )
  )
  from public.pos_payments p
  where p.id = p_payment_id;
$$;

-- Cómo quedó la mesa después de un cobro, un descuento o un cierre: la cuenta, si cerró, y los puntos.
create function private.pos_session_result(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bill', (select to_jsonb(b) from private.pos_bill(s.id) b),
    'closed', s.status = 'paid',
    'points', (
      select jsonb_build_object(
        'customer_id', c.id, 'first_name', c.first_name, 'awarded', cb.points_awarded,
        'balance', c.points_balance, 'failed', cb.points_failed
      )
      from public.pos_closed_bills cb
      join public.customers c on c.id = cb.customer_id
      where cb.session_id = s.id and not cb.is_practice
    )
  )
  from public.table_sessions s
  where s.id = p_session_id;
$$;

-- Cerrar una mesa a la que no le queda nada por cobrar. Lo llaman pos_pay (con el último cobro) y
-- pos_close_table (cuando la seña o un descuento ya cubrían todo). La mesa llega bloqueada.
create function private.pos_close_session(p_session_id uuid, p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_bill record;
  v_uid uuid := (select auth.uid());
  v_net bigint;
  v_visit_id uuid;
  v_points integer := 0;
  v_points_failed boolean := false;
  v_calc record;
  v_res_status public.salon_reservation_status;
begin
  select * into v_session from public.table_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  select * into v_bill from private.pos_bill(p_session_id);
  if v_bill.remaining_cents > 0 then
    raise exception 'bill_not_settled' using errcode = '55000';
  end if;
  if v_bill.overpaid_cents > 0 then
    raise exception 'bill_overpaid' using errcode = '55000';
  end if;
  v_net := v_bill.subtotal_cents - v_bill.discount_cents;

  update public.table_sessions set status = 'paid', paid_at = now() where id = p_session_id;

  -- Los puntos del socio de la mesa, igual que mark_session_paid pero por la mesa entera y sobre el
  -- consumo menos los descuentos (la seña es plata que ya había puesto: también suma). Si el motor de
  -- puntos falla, la mesa se cobra igual y queda marcado: a las 2 de la mañana no se frena la caja.
  if not v_session.is_practice and v_session.customer_id is not null then
    begin
      if exists (
        select 1 from public.customers c
         where c.id = v_session.customer_id and c.tenant_id = v_session.tenant_id and c.deleted_at is null
      ) and v_bill.subtotal_cents > 0 then
        insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, source, created_by)
        values (v_session.tenant_id, v_session.customer_id, now(), 0, 'cashier', v_uid)
        returning id into v_visit_id;

        insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        select v_visit_id, ti.menu_item_id, ti.quantity, ti.unit_price_cents, ti.line_total_cents
          from public.ticket_items ti
          join public.tickets t on t.id = ti.ticket_id
         where t.session_id = p_session_id and t.status <> 'cancelled' and ti.cancelled_at is null;

        update public.visits set total_amount_cents = v_net where id = v_visit_id;

        select * into v_calc from public.calculate_visit_points(v_visit_id);
        if v_calc.delta > 0 then
          insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
          values (v_session.tenant_id, v_session.customer_id, v_visit_id, v_calc.delta, 'session_paid', v_calc.breakdown);
          v_points := v_calc.delta;
        end if;
      end if;
    exception when others then
      v_visit_id := null;
      v_points := 0;
      v_points_failed := true;
      raise warning 'pos_close_session: no se pudieron sumar los puntos de la mesa %: %', p_session_id, sqlerrm;
    end;
  end if;

  -- La reserva sentada se cierra con la mesa. Si no se puede (alguien la movió a mano), la mesa cierra igual.
  if not v_session.is_practice and v_session.reservation_id is not null then
    begin
      select r.status into v_res_status
        from public.salon_reservations r
       where r.id = v_session.reservation_id;
      if v_res_status = 'seated' then
        perform private.transition_reservation_status_core(v_session.reservation_id, 'closed', null);
      end if;
    exception when others then
      raise warning 'pos_close_session: no se pudo cerrar la reserva de la mesa %: %', p_session_id, sqlerrm;
    end;
  end if;

  insert into public.pos_closed_bills (
    session_id, tenant_id, branch_id, shift_id, reservation_id, customer_id, service_day, party_size,
    subtotal_cents, discount_cents, deposit_cents, due_cents, visit_id, points_awarded, points_failed,
    is_practice, closed_by, closed_by_name
  ) values (
    p_session_id, v_session.tenant_id, v_session.branch_id, p_shift_id, v_session.reservation_id,
    v_session.customer_id, coalesce(v_session.service_day, private.pos_service_day(v_session.tenant_id)),
    v_session.party_size, v_bill.subtotal_cents, v_bill.discount_cents, v_bill.deposit_cents,
    v_bill.due_cents, v_visit_id, v_points, v_points_failed, v_session.is_practice, v_uid,
    private.pos_actor_name(v_session.tenant_id, v_uid)
  );

  -- Lo que quedó pidiendo permiso ya no tiene sobre qué aplicarse.
  update public.pos_approvals a
     set status = 'cancelled', decided_at = now(), decision_note = 'La mesa se cerró'
   where a.session_id = p_session_id and a.status = 'pending';

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (
    p_session_id, 'session_paid', v_uid,
    jsonb_build_object(
      'source', 'pos', 'total_cents', v_session.total_cents, 'subtotal_cents', v_bill.subtotal_cents,
      'discount_cents', v_bill.discount_cents, 'deposit_cents', v_bill.deposit_cents,
      'paid_cents', v_bill.paid_cents, 'surcharge_cents', v_bill.surcharge_cents,
      'tip_cents', v_bill.tip_cents, 'visits_created', case when v_visit_id is null then 0 else 1 end,
      'total_points', v_points, 'visit_id', v_visit_id, 'practice', v_session.is_practice
    )
  );
end;
$$;

-- El turno al que entra un cobro. De verdad: tiene que haber uno abierto en la sucursal (y si hay más
-- de una caja abierta, hay que decir cuál). De práctica: el turno de práctica si hay, o ninguno.
-- Lo deja bloqueado contra un cierre simultáneo: si el turno se cierra justo ahora, el cobro no entra.
create function private.pos_shift_for_payment(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_practice boolean,
  p_shift_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if p_shift_id is not null then
    select sh.id into v_id
      from public.pos_shifts sh
     where sh.id = p_shift_id and sh.tenant_id = p_tenant_id and sh.branch_id = p_branch_id
       and sh.is_practice = p_practice and sh.status = 'open'
       for share;
    if v_id is null then
      raise exception 'shift_not_open' using errcode = '55000';
    end if;
    return v_id;
  end if;

  select count(*) into v_count
    from public.pos_shifts sh
   where sh.branch_id = p_branch_id and sh.is_practice = p_practice and sh.status = 'open';
  if v_count > 1 then
    raise exception 'shift_required' using errcode = '55000';
  end if;
  if v_count = 1 then
    select sh.id into v_id
      from public.pos_shifts sh
     where sh.branch_id = p_branch_id and sh.is_practice = p_practice and sh.status = 'open'
       for share;
  end if;
  if v_id is null and not p_practice then
    raise exception 'no_open_shift' using errcode = '55000';
  end if;
  return v_id;
end;
$$;

-- La cuenta de una mesa para la pantalla de cobro: números, renglones, cobros, descuentos, la reserva,
-- el socio, lo que espera aprobación y lo que este usuario puede hacer.
create function public.pos_bill(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_settings public.pos_settings%rowtype;
  v_approver boolean;
  v_bill record;
begin
  select * into v_session from public.table_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  v_settings := private.pos_settings_for(v_session.tenant_id);
  v_approver := v_role = 'owner' or v_role::text = any (v_settings.approver_roles);
  select * into v_bill from private.pos_bill(p_session_id);

  return jsonb_build_object(
    'now', now(),
    'session', jsonb_build_object(
      'id', v_session.id, 'status', v_session.status, 'branch_id', v_session.branch_id,
      'table_id', v_session.physical_table_id,
      'table_label', (select p.label from public.physical_tables p where p.id = v_session.physical_table_id),
      'alias', v_session.alias, 'party_size', v_session.party_size, 'kind', v_session.kind,
      'is_practice', v_session.is_practice, 'opened_at', v_session.opened_at,
      'bill_requested_at', v_session.bill_requested_at, 'paid_at', v_session.paid_at
    ),
    'bill', to_jsonb(v_bill),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ti.id, 'ticket_id', t.id, 'course', t.course, 'menu_item_id', ti.menu_item_id,
        'name', mi.name, 'quantity', ti.quantity, 'unit_price_cents', ti.unit_price_cents,
        'line_total_cents', ti.line_total_cents, 'modifiers', ti.modifiers, 'notes', ti.notes,
        'paid_units', private.pos_paid_units(v_session.id, ti.id)
      ) order by t.submitted_at, ti.created_at, ti.id), '[]'::jsonb)
      from public.tickets t
      join public.ticket_items ti on ti.ticket_id = t.id
      join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session.id and t.status <> 'cancelled' and ti.cancelled_at is null
    ),
    'voids', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ti.id, 'name', mi.name, 'quantity', ti.quantity, 'amount_cents', ti.line_total_cents,
        'reason', ti.cancellation_reason, 'at', ti.cancelled_at,
        'by_name', private.pos_actor_name(v_session.tenant_id, ti.cancelled_by)
      ) order by ti.cancelled_at), '[]'::jsonb)
      from public.tickets t
      join public.ticket_items ti on ti.ticket_id = t.id
      join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session.id and ti.cancelled_at is not null
    ),
    'discounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'kind', d.kind, 'value', d.value, 'reason', d.reason,
        'amount_cents', case
          when d.kind = 'percent' then ((v_bill.subtotal_cents * d.value + 500000) / 1000000) * 100
          else d.value
        end,
        'by_name', d.created_by_name, 'approved_by_name', d.approved_by_name, 'at', d.created_at,
        'mine', coalesce(d.created_by = (select auth.uid()), false)
      ) order by d.created_at), '[]'::jsonb)
      from public.pos_discounts d
      where d.session_id = v_session.id and d.status = 'active'
    ),
    'payments', (
      select coalesce(jsonb_agg(private.pos_payment_json(p.id) order by p.created_at, p.id), '[]'::jsonb)
      from public.pos_payments p
      where p.session_id = v_session.id
    ),
    'reservation', (
      select jsonb_build_object(
        'id', r.id, 'name', r.guest_name, 'status', r.status, 'deposit_cents', r.deposit_cents,
        'guests', coalesce(r.actual_guests, r.estimated_guests)
      )
      from public.salon_reservations r
      where r.id = v_session.reservation_id
    ),
    'customer', (
      select jsonb_build_object(
        'id', c.id, 'first_name', c.first_name, 'last_name', c.last_name,
        'points_balance', c.points_balance, 'tier', lt.name, 'tier_color', lt.color
      )
      from public.customers c
      left join public.loyalty_tiers lt on lt.id = c.current_tier_id
      where c.id = v_session.customer_id
    ),
    'closed', (
      select jsonb_build_object(
        'at', cb.closed_at, 'by_name', cb.closed_by_name, 'points_awarded', cb.points_awarded,
        'points_failed', cb.points_failed
      )
      from public.pos_closed_bills cb
      where cb.session_id = v_session.id
    ),
    'pending_approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'summary', a.summary, 'payload', a.payload,
        'requested_by_name', a.requested_by_name, 'requested_at', a.requested_at,
        'mine', coalesce(a.requested_by = (select auth.uid()), false)
      ) order by a.requested_at), '[]'::jsonb)
      from public.pos_approvals a
      where a.session_id = v_session.id and a.status = 'pending'
    ),
    -- Los turnos donde puede entrar este cobro (si hay más de uno, la pantalla pregunta en qué caja).
    'shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', sh.id, 'register_id', sh.register_id, 'register', rg.name, 'label', sh.label,
        'opened_at', sh.opened_at, 'opened_by_name', sh.opened_by_name
      ) order by rg.position, sh.opened_at), '[]'::jsonb)
      from public.pos_shifts sh
      join public.pos_registers rg on rg.id = sh.register_id
      where sh.branch_id = v_session.branch_id and sh.status = 'open' and sh.is_practice = v_session.is_practice
    ),
    'settings', jsonb_build_object(
      'credit_surcharge_bp', v_settings.credit_surcharge_bp,
      'invoice_by_method', v_settings.invoice_by_method,
      'tip_presets_pct', to_jsonb(v_settings.tip_presets_pct),
      'bill_denominations', to_jsonb(v_settings.bill_denominations),
      'transfer_alias', v_settings.transfer_alias,
      'transfer_holder', v_settings.transfer_holder
    ),
    'can', jsonb_build_object(
      'role', v_role,
      'approve', v_approver,
      'discount_direct', v_approver or not v_settings.discount_needs_approval,
      'void_direct', v_approver or not v_settings.void_needs_approval,
      'void_payment', v_role in ('owner', 'cashier'),
      -- Cerrar una mesa a la que no se le cobró nada (la seña o un descuento cubrían todo).
      'close_without_payment', v_approver
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Cobrar
-- ─────────────────────────────────────────────────────────────────────────────
-- Un cobro de una parte de la cuenta. La base decide lo que no se le puede creer al celular:
--   · tiene que haber un turno de caja abierto en la sucursal de la mesa (no_open_shift);
--   · el monto no puede pasar lo que falta (amount_exceeds_remaining, con lo que falta en `detail`);
--   · el recargo de crédito sale de pos_settings y va solo sobre este cobro;
--   · el vuelto es lo que entregó menos el monto y la propina;
--   · «facturar», si nadie dijo nada, sale del medio de pago;
--   · con la misma clave devuelve el cobro que ya hizo: reintentar sin señal no cobra dos veces.
-- Cuando lo que falta llega a cero cierra la mesa (ver private.pos_close_session).
create function public.pos_pay(
  p_session_id uuid,
  p_method text,
  p_amount_cents bigint,
  p_idempotency_key text default null,
  p_tendered_cents bigint default null,
  p_tip_cents bigint default 0,
  p_invoice boolean default null,
  p_payer_label text default null,
  p_item_ids uuid[] default null,
  p_reference text default null,
  p_shift_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_session public.table_sessions%rowtype;
  v_payment public.pos_payments%rowtype;
  v_settings public.pos_settings%rowtype;
  v_bill record;
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_tip bigint := coalesce(p_tip_cents, 0);
  v_items uuid[] := coalesce(p_item_ids, '{}'::uuid[]);
  v_shift_id uuid;
  v_day date;
  v_surcharge bigint := 0;
  v_tendered bigint;
  v_change bigint := 0;
  v_closed boolean := false;
begin
  if p_method is null or p_method not in ('cash', 'transfer', 'qr', 'debit', 'credit', 'other') then
    raise exception 'method_invalid' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000000 then
    raise exception 'amount_invalid' using errcode = '22023';
  end if;
  if v_tip < 0 or v_tip > 100000000000 then
    raise exception 'tip_invalid' using errcode = '22023';
  end if;
  if v_key is not null and char_length(v_key) not between 8 and 80 then
    raise exception 'idempotency_key_invalid' using errcode = '22023';
  end if;

  select s.tenant_id into v_tenant from public.table_sessions s where s.id = p_session_id;
  if v_tenant is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_tenant, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions s where s.id = p_session_id for update;

  if v_key is not null then
    select * into v_payment
      from public.pos_payments p
     where p.session_id = p_session_id and p.idempotency_key = v_key;
    if found then
      return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'duplicate', true)
             || private.pos_session_result(p_session_id);
    end if;
  end if;

  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  select * into v_bill from private.pos_bill(p_session_id);
  if v_bill.remaining_cents <= 0 then
    raise exception 'nothing_to_pay' using errcode = '55000';
  end if;
  if p_amount_cents > v_bill.remaining_cents then
    raise exception 'amount_exceeds_remaining' using errcode = '22023', detail = v_bill.remaining_cents::text;
  end if;

  v_shift_id := private.pos_shift_for_payment(v_tenant, v_session.branch_id, v_session.is_practice, p_shift_id);
  if v_shift_id is not null then
    select sh.service_day into v_day from public.pos_shifts sh where sh.id = v_shift_id;
  end if;
  v_day := coalesce(v_day, private.pos_service_day(v_tenant));
  v_settings := private.pos_settings_for(v_tenant);

  if p_method = 'credit' then
    -- Redondeado al peso: nadie cobra centavos.
    v_surcharge := ((p_amount_cents * v_settings.credit_surcharge_bp + 500000) / 1000000) * 100;
  end if;
  if p_method = 'cash' and p_tendered_cents is not null then
    if p_tendered_cents < p_amount_cents + v_tip then
      raise exception 'tendered_too_low' using errcode = '22023';
    end if;
    v_tendered := p_tendered_cents;
    v_change := p_tendered_cents - p_amount_cents - v_tip;
  end if;

  -- División por producto: cada renglón tiene que ser de esta mesa y estar vivo, y no se puede cubrir
  -- más unidades de las que tiene (dos celulares cobrando la misma cerveza).
  if cardinality(v_items) > 0 then
    if cardinality(v_items) > 400 then
      raise exception 'items_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1
        from (select x.id from unnest(v_items) as x(id) group by x.id) want
       where not exists (
         select 1
           from public.ticket_items ti
           join public.tickets t on t.id = ti.ticket_id
          where ti.id = want.id and t.session_id = p_session_id
            and t.status <> 'cancelled' and ti.cancelled_at is null
       )
    ) then
      raise exception 'items_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1
        from (select x.id, count(*) as units from unnest(v_items) as x(id) group by x.id) want
        join public.ticket_items ti on ti.id = want.id
       where want.units + private.pos_paid_units(p_session_id, want.id) > ti.quantity
    ) then
      raise exception 'items_already_paid' using errcode = '55000';
    end if;
  end if;

  insert into public.pos_payments (
    tenant_id, branch_id, session_id, shift_id, service_day, method, amount_cents, surcharge_cents,
    tip_cents, tendered_cents, change_cents, invoice, payer_label, item_ids, reference, is_practice,
    idempotency_key, created_by, created_by_name
  ) values (
    v_tenant, v_session.branch_id, p_session_id, v_shift_id, v_day, p_method, p_amount_cents, v_surcharge,
    v_tip, v_tendered, v_change,
    coalesce(
      p_invoice,
      -- Si el ajuste del bar para ese medio no es un sí/no, no frena el cobro: vale la regla de fábrica.
      case when jsonb_typeof(v_settings.invoice_by_method -> p_method) = 'boolean'
           then (v_settings.invoice_by_method ->> p_method)::boolean end,
      p_method not in ('cash', 'other')
    ),
    nullif(left(btrim(coalesce(p_payer_label, '')), 60), ''), v_items,
    nullif(left(btrim(coalesce(p_reference, '')), 80), ''), v_session.is_practice,
    v_key, v_uid, private.pos_actor_name(v_tenant, v_uid)
  ) returning * into v_payment;

  if p_amount_cents = v_bill.remaining_cents then
    perform private.pos_close_session(p_session_id, v_shift_id);
    v_closed := true;
  end if;

  perform private.pos_poke(v_session.branch_id, 'cash', p_session_id);
  if v_closed then
    perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  end if;
  return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'duplicate', false)
         || private.pos_session_result(p_session_id);
end;
$$;

-- Cerrar una mesa a la que no le queda nada por cobrar sin que haya un último cobro: la seña o un
-- descuento cubrían todo, o se dio de baja lo que faltaba pagar.
create function public.pos_close_table(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  v_session public.table_sessions%rowtype;
  v_bill record;
  v_shift_id uuid;
  v_open integer;
begin
  select s.tenant_id into v_tenant from public.table_sessions s where s.id = p_session_id;
  if v_tenant is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_tenant, 'owner', 'cashier', 'waiter', 'host');
  select * into v_session from public.table_sessions s where s.id = p_session_id for update;

  if v_session.status = 'paid' then
    return jsonb_build_object('duplicate', true) || private.pos_session_result(p_session_id);
  end if;
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  select * into v_bill from private.pos_bill(p_session_id);
  -- Una mesa sin consumo no se «cobra»: se libera (eso es del salón, no de la caja).
  if v_bill.subtotal_cents = 0 and v_bill.paid_cents = 0 then
    raise exception 'nothing_to_charge' using errcode = '55000';
  end if;
  if v_bill.remaining_cents > 0 then
    raise exception 'bill_not_settled' using errcode = '55000', detail = v_bill.remaining_cents::text;
  end if;
  if v_bill.overpaid_cents > 0 then
    raise exception 'bill_overpaid' using errcode = '55000', detail = v_bill.overpaid_cents::text;
  end if;
  -- Cerrar una mesa a la que nunca se le cobró nada (la seña o un descuento cubrían todo) es dar por buena
  -- una cuenta en cero: lo hace quien puede aprobar, no cualquiera del salón.
  if v_bill.paid_cents = 0 and not private.pos_is_approver(v_tenant, v_role) then
    raise exception 'close_needs_approver' using errcode = '42501';
  end if;

  -- A qué turno se le anota el cierre: al que está abierto. Con más de una caja abierta, a la del último
  -- cobro de la mesa si sigue abierta. Nunca a un turno ya cerrado: cambiaría números que alguien firmó.
  select count(*) into v_open
    from public.pos_shifts sh
   where sh.branch_id = v_session.branch_id and sh.is_practice = v_session.is_practice and sh.status = 'open';
  if v_open = 1 then
    select sh.id into v_shift_id
      from public.pos_shifts sh
     where sh.branch_id = v_session.branch_id and sh.is_practice = v_session.is_practice and sh.status = 'open'
       for share;
  elsif v_open > 1 then
    select sh.id into v_shift_id
      from public.pos_shifts sh
     where sh.id = (
             select p.shift_id
               from public.pos_payments p
              where p.session_id = p_session_id and p.status = 'ok' and p.shift_id is not null
              order by p.created_at desc
              limit 1)
       and sh.status = 'open'
       for share;
  end if;

  perform private.pos_close_session(p_session_id, v_shift_id);
  perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  return jsonb_build_object('duplicate', false) || private.pos_session_result(p_session_id);
end;
$$;

-- Anular un cobro: solo mientras la mesa sigue abierta, con motivo, y lo hace dueño o caja. Si el
-- turno en el que entró ya cerró, solo un dueño (cambia números que alguien ya firmó).
create function public.pos_void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.pos_payments%rowtype;
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_shift_status text;
begin
  select * into v_payment from public.pos_payments p where p.id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_payment.tenant_id, 'owner', 'cashier');
  -- Siempre en el mismo orden (mesa → turno → cobro), igual que al corregir: dos toques a la vez no se traban.
  select * into v_session from public.table_sessions s where s.id = v_payment.session_id for update;
  if v_payment.shift_id is not null then
    select sh.status into v_shift_status from public.pos_shifts sh where sh.id = v_payment.shift_id for share;
  end if;
  select * into v_payment from public.pos_payments p where p.id = p_payment_id for update;

  if v_payment.status = 'voided' then
    return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'duplicate', true)
           || private.pos_session_result(v_payment.session_id);
  end if;
  if v_session.status <> 'open' then
    raise exception 'table_already_closed' using errcode = '55000';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_shift_status = 'closed' and v_role <> 'owner' then
    raise exception 'closed_shift_owner_only' using errcode = '42501';
  end if;

  update public.pos_payments
     set status = 'voided', voided_at = now(), voided_by = v_uid,
         voided_by_name = private.pos_actor_name(v_payment.tenant_id, v_uid),
         void_reason = left(v_reason, 200)
   where id = p_payment_id;

  perform private.pos_poke(v_payment.branch_id, 'cash', v_payment.session_id);
  return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'duplicate', false)
         || private.pos_session_result(v_payment.session_id);
end;
$$;

-- Corregir un cobro: elegir el medio correcto y/o si se factura. No cambia el monto ni borra nada:
-- cada cambio queda en pos_payment_edits con quién y cuándo. Turno abierto: dueño o caja. Turno
-- cerrado: solo un dueño.
-- El recargo es del crédito: si el cobro deja de ser crédito se va; si pasa a ser crédito se calcula,
-- salvo que p_surcharge diga que no se cobró (false). Con p_surcharge vacío y sin cambiar de medio, no se toca.
create function public.pos_edit_payment(
  p_payment_id uuid,
  p_method text default null,
  p_invoice boolean default null,
  p_note text default null,
  p_surcharge boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.pos_payments%rowtype;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  v_shift_closed boolean := false;
  v_method text;
  v_invoice boolean;
  v_surcharge bigint;
begin
  select * into v_payment from public.pos_payments p where p.id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_payment.tenant_id, 'owner', 'cashier');
  if p_method is not null and p_method not in ('cash', 'transfer', 'qr', 'debit', 'credit', 'other') then
    raise exception 'method_invalid' using errcode = '22023';
  end if;

  if v_payment.shift_id is not null then
    select sh.status = 'closed' into v_shift_closed
      from public.pos_shifts sh
     where sh.id = v_payment.shift_id
       for share;
    if v_shift_closed and v_role <> 'owner' then
      raise exception 'closed_shift_owner_only' using errcode = '42501';
    end if;
  end if;
  select * into v_payment from public.pos_payments p where p.id = p_payment_id for update;
  if v_payment.status <> 'ok' then
    raise exception 'payment_voided' using errcode = '55000';
  end if;

  v_method := coalesce(p_method, v_payment.method);
  v_invoice := coalesce(p_invoice, v_payment.invoice);
  v_surcharge := case
    when v_method <> 'credit' then 0
    when v_payment.method = 'credit' and p_surcharge is null then v_payment.surcharge_cents
    when coalesce(p_surcharge, true) then
      ((v_payment.amount_cents * (private.pos_settings_for(v_payment.tenant_id)).credit_surcharge_bp + 500000) / 1000000) * 100
    else 0
  end;

  if v_method = v_payment.method and v_invoice = v_payment.invoice and v_surcharge = v_payment.surcharge_cents then
    return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'changed', false);
  end if;

  v_name := private.pos_actor_name(v_payment.tenant_id, v_uid);
  if v_method <> v_payment.method then
    insert into public.pos_payment_edits (tenant_id, payment_id, field, old_value, new_value, note, shift_closed, edited_by, edited_by_name)
    values (v_payment.tenant_id, v_payment.id, 'method', v_payment.method, v_method, v_note, coalesce(v_shift_closed, false), v_uid, v_name);
  end if;
  if v_invoice <> v_payment.invoice then
    insert into public.pos_payment_edits (tenant_id, payment_id, field, old_value, new_value, note, shift_closed, edited_by, edited_by_name)
    values (v_payment.tenant_id, v_payment.id, 'invoice', v_payment.invoice::text, v_invoice::text, v_note, coalesce(v_shift_closed, false), v_uid, v_name);
  end if;
  if v_surcharge <> v_payment.surcharge_cents then
    insert into public.pos_payment_edits (tenant_id, payment_id, field, old_value, new_value, note, shift_closed, edited_by, edited_by_name)
    values (v_payment.tenant_id, v_payment.id, 'surcharge_cents', v_payment.surcharge_cents::text, v_surcharge::text, v_note, coalesce(v_shift_closed, false), v_uid, v_name);
  end if;

  update public.pos_payments
     set method = v_method,
         invoice = v_invoice,
         surcharge_cents = v_surcharge,
         -- Con cuánto pagó y el vuelto solo tienen sentido si era efectivo y sigue siéndolo.
         tendered_cents = case when v_method = 'cash' and v_payment.method = 'cash' then tendered_cents end,
         change_cents = case when v_method = 'cash' and v_payment.method = 'cash' then change_cents else 0 end
   where id = p_payment_id;

  perform private.pos_poke(v_payment.branch_id, 'cash', v_payment.session_id);
  return jsonb_build_object('payment', private.pos_payment_json(v_payment.id), 'changed', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos de las funciones de este tramo
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.pos_bill(uuid) from public, anon;
revoke all on function public.pos_pay(uuid, text, bigint, text, bigint, bigint, boolean, text, uuid[], text, uuid) from public, anon;
revoke all on function public.pos_close_table(uuid) from public, anon;
revoke all on function public.pos_void_payment(uuid, text) from public, anon;
revoke all on function public.pos_edit_payment(uuid, text, boolean, text, boolean) from public, anon;
grant execute on function public.pos_bill(uuid) to authenticated;
grant execute on function public.pos_pay(uuid, text, bigint, text, bigint, bigint, boolean, text, uuid[], text, uuid) to authenticated;
grant execute on function public.pos_close_table(uuid) to authenticated;
grant execute on function public.pos_void_payment(uuid, text) to authenticated;
grant execute on function public.pos_edit_payment(uuid, text, boolean, text, boolean) to authenticated;
revoke all on function private.pos_paid_units(uuid, uuid) from public, anon, authenticated;
revoke all on function private.pos_bill(uuid) from public, anon, authenticated;
revoke all on function private.pos_payment_json(uuid) from public, anon, authenticated;
revoke all on function private.pos_session_result(uuid) from public, anon, authenticated;
revoke all on function private.pos_close_session(uuid, uuid) from public, anon, authenticated;
revoke all on function private.pos_shift_for_payment(uuid, uuid, boolean, uuid) from public, anon, authenticated;
