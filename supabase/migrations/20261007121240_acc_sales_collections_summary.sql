-- Parte 5 de 5 de la migración #13 (acc_sales_collections): el Resumen (§F.10) con lo que te deben y los cierres
-- que faltan. Trae sus propios revoke/grant; última parte de la #13: termina con notify pgrst.
-- Va DESPUÉS de 12c·2 (#12, parte 7): reemplaza otra vez (create or replace, misma firma y retorno)
-- public.acc_report_summary con el cuerpo de 12c·2 TAL CUAL (cajas, plata disponible, le debés, facturas
-- vencidas y por vencer, gastos fijos, cajas sin ajustar, mes para cerrar, patrimonio inicial, CUIT, libros, IVA
-- del mes, este mes y primeros pasos) más:
--   · receivables {total_cents, overdue_cents, top: [{party_id, name, open_cents, days_late}] (≤ 5, los que más
--     deben)}: de acc_report_party_balances al día, grupo 'receivables' (clientes, tarjetas, billeteras y
--     plataformas; sin el IVA a documentar).
--   · attention receivable_overdue (uno por cobrable en rojo: label = nombre, amount = vencido, date = el
--     vencimiento más viejo, days = días de atraso, party_id), missing_daily_close (una fila: count = días sin
--     cierre, date = el más viejo, days = días desde ese; label null) y vat_pending_documentation (uno por
--     partícipe con IVA de comisiones a documentar de más de 45 días: label = nombre, amount = abierto, date = la
--     partida más vieja, count = partidas, party_id).
-- El orden de urgencia y el corte en 8 no cambian (F.10).
create or replace function public.acc_report_summary(p_tenant_id uuid, p_as_of date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date;
  v_as_of date;
  v_set public.acc_settings;
  v_tr jsonb;
  v_available bigint;
  v_card bigint;
  v_pending bigint;
  v_att jsonb;
  v_open public.acc_periods;
  v_last public.acc_periods;
  v_check jsonb;
  v_iva jsonb;
  v_pos jsonb;
  v_month date;
  v_sold bigint;
  v_spent bigint;
  v_acc uuid;
  v_amount bigint;
  v_payables jsonb;
  v_parties jsonb;
  r record;
  v_n integer;
  v_label text;
  v_line uuid;
  v_receivables jsonb;
  v_upto date;
  v_first date;
  v_months text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                           'septiembre', 'octubre', 'noviembre', 'diciembre'];
begin
  perform public.acc_assert_reader(p_tenant_id);
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  if not found then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
  v_today := public.acc_today(p_tenant_id);
  v_as_of := coalesce(p_as_of, v_today);
  v_month := date_trunc('month', v_as_of::timestamp)::date;

  -- Plata disponible y cajas sin ajustar hace más de 7 días (con movimientos; no las tarjetas), en una pasada.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.treasury_id, 'name', b.name, 'kind', b.kind, 'account_code', b.account_code,
           'balance_cents', b.balance_cents, 'pending_wallet_cents', b.pending_wallet_cents,
           'last_movement_date', b.last_movement_date, 'last_checked_on', b.last_checked_on)
           order by b.sort, b.name), '[]'::jsonb),
         coalesce(sum(b.balance_cents) filter (where b.kind <> 'credit_card'), 0)::bigint,
         coalesce(sum(greatest(-b.balance_cents, 0)) filter (where b.kind = 'credit_card'), 0)::bigint,
         coalesce(sum(b.pending_wallet_cents), 0)::bigint,
         coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'treasury_unchecked', 'ref_id', b.treasury_id, 'label', b.name, 'amount_cents', b.balance_cents,
           'date', b.last_checked_on, 'days', v_as_of - b.last_checked_on, 'count', null)
           order by b.last_checked_on nulls first, b.sort, b.name)
           filter (where b.kind <> 'credit_card' and b.last_movement_date is not null
                     and (b.last_checked_on is null or b.last_checked_on < v_as_of - 7)), '[]'::jsonb)
    into v_tr, v_available, v_card, v_pending, v_att
    from public.acc_report_treasury_balances(p_tenant_id, v_as_of) b
   where b.active;

  -- Le debés (F.10): de los saldos con antigüedad de los pagables al día (12b·1). Los proveedores en rojo y los
  -- que tienen algo que vence en S días quedan en v_parties para los avisos (vencido más viejo primero).
  select jsonb_build_object('total_cents', coalesce(sum(b.debt_cents), 0)::bigint,
                            'overdue_cents', coalesce(sum(b.overdue_cents), 0)::bigint,
                            'due_week_cents', coalesce(sum(b.due_soon_cents), 0)::bigint,
                            'parties_red', count(*) filter (where b.traffic_light = 'red')),
         coalesce(jsonb_agg(jsonb_build_object(
           'party_id', b.party_id, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.party_name),
           'red', b.traffic_light = 'red', 'overdue_cents', b.overdue_cents, 'oldest_due', b.oldest_due_date,
           'due_soon_cents', b.due_soon_cents, 'next_due', b.next_due_date)
           order by b.oldest_due_date nulls last, b.next_due_date nulls last, b.party_name)
           filter (where b.traffic_light = 'red' or b.due_soon_cents > 0), '[]'::jsonb)
    into v_payables, v_parties
    from public.acc_report_party_balances(p_tenant_id, v_as_of, 'payables') b;

  -- Vencidas: una fila por proveedor en rojo (hasta 8), con el comprobante si es uno solo.
  for r in select (e.value ->> 'party_id')::uuid as party_id, e.value ->> 'name' as name,
                  (e.value ->> 'overdue_cents')::bigint as amount, (e.value ->> 'oldest_due')::date as due
             from jsonb_array_elements(v_parties) with ordinality as e(value, ord)
            where (e.value ->> 'red')::boolean
            order by e.ord
            limit 8 loop
    select count(*)::int, min(oi.document_label), (array_agg(oi.line_id))[1]
      into v_n, v_label, v_line
      from public.acc_report_open_items(p_tenant_id, r.party_id, v_as_of, 'debt') oi
     where oi.days_overdue > 0;
    v_att := v_att || jsonb_build_object(
      'kind', 'payable_overdue', 'ref_id', case when v_n = 1 then v_line end,
      'label', r.name || ' · ' || case when v_n = 1 then v_label else v_n::text || ' comprobantes' end,
      'amount_cents', r.amount, 'date', r.due, 'days', v_as_of - r.due, 'party_id', r.party_id, 'count', v_n);
  end loop;
  -- Vencen esta semana (en S días): una fila por proveedor (hasta 8), el vencimiento más cercano primero.
  for r in select (e.value ->> 'party_id')::uuid as party_id, e.value ->> 'name' as name,
                  (e.value ->> 'due_soon_cents')::bigint as amount, (e.value ->> 'next_due')::date as due
             from jsonb_array_elements(v_parties) e
            where (e.value ->> 'due_soon_cents')::bigint > 0
            order by (e.value ->> 'next_due')::date, e.value ->> 'name'
            limit 8 loop
    select count(*)::int, min(oi.document_label), (array_agg(oi.line_id))[1]
      into v_n, v_label, v_line
      from public.acc_report_open_items(p_tenant_id, r.party_id, v_as_of, 'debt') oi
     where oi.bucket = 'due_soon';
    v_att := v_att || jsonb_build_object(
      'kind', 'payable_due_week', 'ref_id', case when v_n = 1 then v_line end,
      'label', r.name || ' · ' || case when v_n = 1 then v_label else v_n::text || ' comprobantes' end,
      'amount_cents', r.amount, 'date', r.due, 'days', r.due - v_as_of, 'party_id', r.party_id, 'count', v_n);
  end loop;
  -- Te deben (F.10): de los saldos de los cobrables al día (12b·1): Σ deuda, Σ vencido y los 5 que más deben
  -- (days_late = días desde el vencimiento más viejo, null si no hay nada vencido). Los atrasados (en rojo: lo
  -- vencido no está cubierto por lo a favor) van a «Necesita atención», el más viejo primero.
  select jsonb_build_object('total_cents', coalesce(sum(b.debt_cents), 0)::bigint,
                            'overdue_cents', coalesce(sum(b.overdue_cents), 0)::bigint,
                            'top', coalesce(jsonb_agg(jsonb_build_object(
                                     'party_id', b.party_id, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.party_name),
                                     'open_cents', b.debt_cents, 'days_late', v_as_of - b.oldest_due_date)
                                     order by b.debt_cents desc, b.party_name)
                                     filter (where b.debt_cents > 0 and b.rk <= 5), '[]'::jsonb)),
         v_att || coalesce(jsonb_agg(jsonb_build_object(
                    'kind', 'receivable_overdue', 'ref_id', null,
                    'label', coalesce(nullif(btrim(b.trade_name), ''), b.party_name), 'amount_cents', b.overdue_cents,
                    'date', b.oldest_due_date, 'days', v_as_of - b.oldest_due_date, 'party_id', b.party_id, 'count', null)
                    order by b.oldest_due_date, b.party_name) filter (where b.traffic_light = 'red'), '[]'::jsonb)
    into v_receivables, v_att
    from (select x.*, row_number() over (order by x.debt_cents desc, x.party_name) as rk
            from public.acc_report_party_balances(p_tenant_id, v_as_of, 'receivables') x) b;

  -- Cierres que faltan (F.10): días desde max(inicio de los libros, p_as_of − 30) hasta ayer sin cierre del día
  -- (el de ayer falta recién desde las 5:00 de hoy, hora del bar). Como el checklist del mes, solo si el bar ya
  -- cargó algún cierre (antes lo pide «Primeros pasos»). Una fila: count = días, date = el más viejo.
  if exists (select 1 from public.acc_documents d
              where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted') then
    v_upto := case when v_as_of = v_today
                        and extract(hour from now() at time zone coalesce(
                              (select t.timezone from public.tenants t where t.id = p_tenant_id),
                              'America/Argentina/Cordoba')) < 5
                   then v_as_of - 2 else v_as_of - 1 end;
    select count(*)::int, min(g.day) into v_n, v_first
      from (select gs::date as day
              from generate_series(greatest(v_set.books_start_date, v_as_of - 30)::timestamp, v_upto::timestamp,
                                   interval '1 day') as gs) g
     where not exists (select 1 from public.acc_documents d
                        where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted'
                          and d.accounting_date = g.day);
    if v_n > 0 then
      v_att := v_att || jsonb_build_object('kind', 'missing_daily_close', 'ref_id', null, 'label', null,
                                           'amount_cents', null, 'date', v_first, 'days', v_as_of - v_first,
                                           'party_id', null, 'count', v_n);
    end if;
  end if;

  -- IVA de comisiones a documentar con más de 45 días (como el checklist): uno por partícipe, el más viejo primero.
  select v_att || coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'vat_pending_documentation', 'ref_id', null, 'label', x.name, 'amount_cents', x.open_cents,
           'date', x.oldest, 'days', v_as_of - x.oldest, 'party_id', x.party_id, 'count', x.n)
           order by x.oldest, x.name), '[]'::jsonb)
    into v_att
    from (select y.party_id, coalesce(nullif(btrim(p.trade_name), ''), p.name) as name, count(*)::int as n,
                 sum(y.open_cents)::bigint as open_cents, min(y.entry_date) as oldest
            from (select l.party_id, l.entry_date,
                         l.amount_cents - coalesce((select sum(al.amount_cents)
                                                      from public.acc_allocations al
                                                      join public.acc_journal_lines cl on cl.id = al.credit_line_id
                                                      join public.acc_journal_entries ce on ce.id = cl.entry_id
                                                     where al.debit_line_id = l.id and al.tenant_id = p_tenant_id
                                                       and ce.status = 'posted' and al.applied_on <= v_as_of
                                                       and (al.voided_on is null or al.voided_on > v_as_of)), 0) as open_cents
                    from public.acc_journal_lines l
                    join public.acc_journal_entries e on e.id = l.entry_id
                    join public.acc_accounts ac on ac.id = l.account_id and ac.tenant_id = l.tenant_id
                   where l.tenant_id = p_tenant_id and ac.system_key = 'vat_credit_pending' and l.side = 'debit'
                     and l.party_id is not null and l.entry_date < v_as_of - 45
                     and e.status = 'posted' and not e.is_mirror) y
            join public.acc_parties p on p.id = y.party_id and p.tenant_id = p_tenant_id
           where y.open_cents > 0
           group by y.party_id, p.trade_name, p.name) x;

  -- Gastos fijos por cargar: vencimiento dentro de su aviso (o ya vencido), sin cargar ni saltear.
  select v_att || coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'recurring_due', 'ref_id', x.id, 'label', x.name, 'amount_cents', x.amount_cents,
           'date', x.next_due_date, 'days', x.next_due_date - v_as_of, 'party_id', x.party_id, 'count', null)
           order by x.next_due_date, x.name), '[]'::jsonb)
    into v_att
    from (select rx.id, rx.name, rx.amount_cents, rx.next_due_date, rx.party_id
            from public.acc_recurring_expenses rx
           where rx.tenant_id = p_tenant_id and rx.active and rx.next_due_date <= v_as_of + rx.remind_days_before
           order by rx.next_due_date, rx.name
           limit 8) x;

  -- Libros: último mes cerrado y primer mes abierto (con su checklist).
  select * into v_last from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.status = 'closed'
   order by p.month desc
   limit 1;
  select * into v_open from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.status = 'open'
   order by p.month
   limit 1;
  if v_open.id is not null then
    v_check := public.acc_report_close_checklist(p_tenant_id, v_open.month);
    if (v_check ->> 'can_close')::boolean then
      v_att := v_att || jsonb_build_object(
        'kind', 'month_ready', 'ref_id', v_open.id,
        'label', initcap(v_months[extract(month from v_open.month)::int]) || ' ' || extract(year from v_open.month)::int::text,
        'amount_cents', null, 'date', v_open.month, 'days', null,
        'count', jsonb_array_length(v_check -> 'warnings'));
    end if;
  end if;

  -- Patrimonio inicial sin asignar y CUIT de la SAS.
  select a.id into v_acc from public.acc_accounts a where a.tenant_id = p_tenant_id and a.system_key = 'opening_equity';
  if v_acc is not null then
    v_amount := -public.acc_account_balance(p_tenant_id, v_acc, v_as_of);
    if v_amount <> 0 then
      v_att := v_att || jsonb_build_object('kind', 'opening_unassigned', 'ref_id', v_acc,
                                           'label', 'Saldo de apertura a asignar', 'amount_cents', v_amount,
                                           'date', null, 'days', null, 'count', null);
    end if;
  end if;
  if v_set.cuit is null then
    v_att := v_att || jsonb_build_object('kind', 'sas_cuit_missing', 'ref_id', null, 'label', 'Falta el CUIT de la SAS',
                                         'amount_cents', null, 'date', null, 'days', null, 'count', null);
  end if;
  -- Orden de urgencia de F.10 y corte en 8.
  select coalesce(jsonb_agg(x.v order by x.rk, x.ord), '[]'::jsonb) into v_att
    from (select e.v, e.ord,
                 array_position(array['payable_overdue', 'payable_due_week', 'recurring_due', 'missing_daily_close',
                                      'receivable_overdue', 'treasury_unchecked', 'month_ready', 'opening_unassigned',
                                      'vat_pending_documentation', 'sas_cuit_missing'], e.v ->> 'kind') as rk
            from jsonb_array_elements(v_att) with ordinality as e(v, ord)
           order by 3, e.ord
           limit 8) x;

  -- IVA del mes (estimado) si la SAS es responsable inscripta y el mes está en los libros.
  if v_set.iva_condition = 'responsable_inscripto'
     and exists (select 1 from public.acc_periods p
                  where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month) then
    v_pos := public.acc_compute_iva_position(p_tenant_id, v_month);
    v_iva := jsonb_build_object('month', v_month, 'to_pay_cents', v_pos -> 'to_pay_cents',
                                'in_favor_cents', v_pos -> 'in_favor_cents',
                                'provisional', not exists (select 1 from public.acc_periods p
                                                            where p.tenant_id = p_tenant_id and p.kind = 'month'
                                                              and p.month = v_month and p.status = 'closed'));
  end if;

  -- Este mes, hasta p_as_of: lo vendido sale de los cierres del día (nunca «ganancia»); compras y gastos =
  -- compras, ND, gastos de contado y bancarios − NC, sin la factura mensual de comisiones.
  select coalesce(sum(d.total_cents) filter (where d.kind = 'sales_close'), 0)::bigint,
         coalesce(sum(case when d.kind = 'purchase_credit_note' then -d.total_cents else d.total_cents end)
                    filter (where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense',
                                             'bank_expense')
                              and not d.settles_commissions), 0)::bigint
    into v_sold, v_spent
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between v_month and v_as_of
     and d.kind in ('sales_close', 'purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'bank_expense');

  return jsonb_build_object(
    'as_of', v_as_of,
    'treasuries', v_tr,
    'available_cents', v_available,
    'card_debt_cents', v_card,
    'pending_wallet_cents', v_pending,
    'payables', v_payables,
    'receivables', v_receivables,
    'iva_month', v_iva,
    'month_to_date', jsonb_build_object('sold_cents', v_sold, 'purchases_and_expenses_cents', v_spent),
    'attention', v_att,
    'books', jsonb_build_object(
      'last_closed_month', v_last.month, 'closed_by', v_last.closed_by_name, 'closed_at', v_last.closed_at,
      'open_month', v_open.month,
      'open_warnings', case when v_check is not null then jsonb_array_length(v_check -> 'warnings') end),
    'first_steps', jsonb_build_object(
      'first_expense', exists (select 1 from public.acc_documents d
                                where d.tenant_id = p_tenant_id and d.status = 'posted'
                                  and d.kind in ('expense', 'purchase')),
      'first_daily_close', exists (select 1 from public.acc_documents d
                                    where d.tenant_id = p_tenant_id and d.status = 'posted' and d.kind = 'sales_close'),
      'accountant_added', exists (select 1 from public.memberships m
                                   where m.tenant_id = p_tenant_id and m.role = 'accountant'),
      'partner_granted', (select count(*) from public.acc_access x
                           where x.tenant_id = p_tenant_id and x.revoked_at is null) > 1));
end;
$$;

comment on function public.acc_report_summary(uuid, date) is
  'Resumen de Administración (F.10), versión fase 3: + te deben (receivables), cobros atrasados, cierres del día que faltan e IVA de comisiones a documentar. INVOKER.';

revoke all on function public.acc_report_summary(uuid, date) from public, anon;
grant execute on function public.acc_report_summary(uuid, date) to authenticated;

notify pgrst, 'reload schema';
