-- Parte 2 de 3 de la migración #11 (acc_reports_core): cajas y bancos, subdiario de disponibilidades, flujo
-- de caja y posición de IVA. Usa acc_compute_iva_position (#10) y acc_doc_label (parte 1). Los revoke/grant
-- de cada función viajan con ella; el Resumen y el notify pgrst van en la parte 3.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #11 (acc_reports_core) · spec §F.6, §F.8, §F.9
-- ============================================================

-- ─── 5. Cajas y bancos (F.9) ─────────────────────────────────────────────────
-- Saldo de cada caja al día p_as_of (Debe − Haber: la deuda de una tarjeta de la empresa sale negativa),
-- lo que una billetera tiene por acreditar (partidas Debe abiertas al día en «Mercado Pago a acreditar» de su
-- partícipe: imputaciones aplicadas hasta ese día, no desaplicadas antes, de asientos vigentes), último
-- movimiento y último ajuste. Activas, o inactivas con saldo. Orden: sort, nombre.
create function public.acc_report_treasury_balances(p_tenant_id uuid, p_as_of date)
returns table (treasury_id uuid, name text, kind text, account_code text, balance_cents bigint,
               pending_wallet_cents bigint, last_movement_date date, last_checked_on date,
               account_id uuid, active boolean, sort smallint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_as_of is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_as_of"}';
  end if;
  return query
  select t.id, t.name, t.kind, a.code, coalesce(b.bal, 0)::bigint, coalesce(w.pending, 0)::bigint, b.last_date,
         t.last_checked_on, t.account_id, t.active, t.sort
    from public.acc_treasury_accounts t
    join public.acc_accounts a on a.id = t.account_id
    left join lateral (
      select sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)::bigint as bal,
             max(l.entry_date) as last_date
        from public.acc_journal_lines l
        join public.acc_journal_entries e on e.id = l.entry_id
       where l.tenant_id = p_tenant_id and l.account_id = t.account_id and l.entry_date <= p_as_of
         and e.status = 'posted' and not e.is_mirror) b on true
    left join lateral (
      select sum(l.amount_cents
                 - coalesce((select sum(al.amount_cents) from public.acc_allocations al
                              join public.acc_journal_lines cl on cl.id = al.credit_line_id
                              join public.acc_journal_entries ce on ce.id = cl.entry_id
                             where al.debit_line_id = l.id and ce.status = 'posted' and al.applied_on <= p_as_of
                               and (al.voided_on is null or al.voided_on > p_as_of)), 0))::bigint as pending
        from public.acc_journal_lines l
        join public.acc_journal_entries e on e.id = l.entry_id
        join public.acc_accounts ra on ra.id = l.account_id
       where t.kind = 'wallet' and t.bank_party_id is not null
         and l.tenant_id = p_tenant_id and l.party_id = t.bank_party_id and l.side = 'debit'
         and ra.system_key = 'receivable_wallets' and l.entry_date <= p_as_of
         and e.status = 'posted' and not e.is_mirror) w on true
   where t.tenant_id = p_tenant_id and (t.active or coalesce(b.bal, 0) <> 0)
   order by t.sort, t.name;
end;
$$;

-- ─── 6. Subdiarios (F.8), versión fase 1: disponibilidades ───────────────────
-- p_kind = 'treasury' (las otras clases llegan con la #12 y la #13: hoy → invalid_report_param).
-- Líneas de las cuentas de caja (incluye apertura y manuales), de una caja o de todas las de activo (sin las
-- tarjetas de la empresa). row = {row_kind 'opening'|'line', date, entry_id, document_id, document_seq,
-- document_kind, document_label, treasury_id, treasury_name, description, memo, counterpart, inflow_cents,
-- outflow_cents, balance_cents}; la primera página empieza con «Saldo anterior». Keyset {d, k, s, n}.
create function public.acc_report_subledger(p_tenant_id uuid, p_kind text, p_from date, p_to date,
                                            p_treasury_id uuid default null, p_after jsonb default null,
                                            p_limit integer default 500)
returns table ("row" jsonb, cursor jsonb, total_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_accounts uuid[];
  v_opening bigint;
  v_before bigint;
  v_total integer;
  v_d date;
  v_k smallint;
  v_s bigint;
  v_n smallint;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if p_kind is distinct from 'treasury' then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_kind"}';
  end if;
  if p_treasury_id is not null
     and not exists (select 1 from public.acc_treasury_accounts t where t.id = p_treasury_id and t.tenant_id = p_tenant_id) then
    raise exception 'treasury_not_found' using errcode = 'P0001';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_k := (p_after ->> 'k')::smallint;
      v_s := (p_after ->> 's')::bigint;
      v_n := (p_after ->> 'n')::smallint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_k is null or v_s is null or v_n is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;
  select coalesce(array_agg(t.account_id), '{}') into v_accounts
    from public.acc_treasury_accounts t
   where t.tenant_id = p_tenant_id
     and (case when p_treasury_id is not null then t.id = p_treasury_id else t.kind <> 'credit_card' end);

  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date < p_from), 0)::bigint,
         coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date >= p_from and v_d is not null
                              and (l.entry_date, e.order_key, e.posting_seq, l.line_no) <= (v_d, v_k, v_s, v_n)), 0)::bigint,
         (count(*) filter (where l.entry_date >= p_from))::int
    into v_opening, v_before, v_total
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id
   where l.tenant_id = p_tenant_id and l.account_id = any (v_accounts) and l.entry_date <= p_to
     and e.status = 'posted' and not e.is_mirror;

  if p_after is null then
    return query
    select jsonb_build_object('row_kind', 'opening', 'date', p_from, 'treasury_id', p_treasury_id,
                              'description', 'Saldo anterior', 'balance_cents', v_opening),
           null::jsonb, v_total;
  end if;

  return query
  with pg as (
    select l.id, l.entry_id, l.document_id, l.account_id, l.line_no, l.side, l.amount_cents, l.memo, l.entry_date,
           e.order_key, e.posting_seq, e.description
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
     where l.tenant_id = p_tenant_id and l.account_id = any (v_accounts) and l.entry_date between p_from and p_to
       and e.status = 'posted' and not e.is_mirror
       and (v_d is null or (l.entry_date, e.order_key, e.posting_seq, l.line_no) > (v_d, v_k, v_s, v_n))
     order by l.entry_date, e.order_key, e.posting_seq, l.line_no
     limit v_limit
  )
  select jsonb_build_object(
           'row_kind', 'line', 'date', pg.entry_date, 'entry_id', pg.entry_id, 'document_id', pg.document_id,
           'document_seq', d.seq, 'document_kind', d.kind,
           'document_label', public.acc_doc_label(d.kind, d.voucher_type, d.point_of_sale, d.number),
           'treasury_id', t.id, 'treasury_name', t.name, 'description', pg.description, 'memo', pg.memo,
           'counterpart', (select string_agg(distinct a2.name, ' · ' order by a2.name)
                             from public.acc_journal_lines l2
                             join public.acc_accounts a2 on a2.id = l2.account_id
                            where l2.entry_id = pg.entry_id and l2.id <> pg.id and l2.tenant_id = p_tenant_id),
           'inflow_cents', case when pg.side = 'debit' then pg.amount_cents else 0 end,
           'outflow_cents', case when pg.side = 'credit' then pg.amount_cents else 0 end,
           'balance_cents', v_opening + v_before
                            + sum(case when pg.side = 'debit' then pg.amount_cents else -pg.amount_cents end)
                                over (order by pg.entry_date, pg.order_key, pg.posting_seq, pg.line_no
                                      rows between unbounded preceding and current row)),
         jsonb_build_object('d', pg.entry_date, 'k', pg.order_key, 's', pg.posting_seq, 'n', pg.line_no),
         v_total
    from pg
    join public.acc_documents d on d.id = pg.document_id and d.tenant_id = p_tenant_id
    join public.acc_treasury_accounts t on t.account_id = pg.account_id and t.tenant_id = p_tenant_id
   order by pg.entry_date, pg.order_key, pg.posting_seq, pg.line_no;
end;
$$;

-- ─── 7. Flujo de caja (F.9) ──────────────────────────────────────────────────
-- Movimientos de las cajas de activo (sin las tarjetas de la empresa), por mes y categoría según el tipo de
-- comprobante (una anulación cuenta como el original) y su partícipe. category (claves estables; la UI y el
-- CSV ponen el texto): sales (Cobros de ventas) · suppliers (Pagos a proveedores y gastos de contado) ·
-- taxes (Impuestos) · payroll (Sueldos y cargas: personal, ARCA seguridad social, sindicato) · bank
-- (Comisiones y gastos bancarios) · partners (Socios) · other (Otros). No cuentan la apertura ni los movimientos
-- entre cajas (un movimiento que netea cero entre cajas de activo); pagar la tarjeta de la empresa es «other».
create function public.acc_report_cash_flow(p_tenant_id uuid, p_from date, p_to date)
returns table (month date, category text, inflow_cents bigint, outflow_cents bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  return query
  with tl as (
    select l.entry_id, l.side, l.amount_cents, l.entry_date, e.document_id
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
      join public.acc_treasury_accounts t on t.account_id = l.account_id and t.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id and l.entry_date between p_from and p_to
       and e.status = 'posted' and not e.is_mirror and t.kind <> 'credit_card'
  ), net as (
    select tl.entry_id, sum(case when tl.side = 'debit' then tl.amount_cents else -tl.amount_cents end) as n
      from tl
     group by tl.entry_id
  ), cls as (
    select tl.side, tl.amount_cents, tl.entry_date,
           case
             when coalesce(od.kind, d.kind) = 'opening' then null
             when coalesce(od.kind, d.kind) = 'transfer' then case when net.n = 0 then null else 'other' end
             when coalesce(od.kind, d.kind) in ('sales_close', 'collection', 'sales_invoice', 'sales_debit_note',
                                                'sales_credit_note') then 'sales'
             when coalesce(od.kind, d.kind) = 'bank_expense' then 'bank'
             when coalesce(od.kind, d.kind) in ('expense', 'purchase', 'purchase_debit_note', 'purchase_credit_note')
               then 'suppliers'
             when coalesce(od.kind, d.kind) in ('payment', 'cash_movement') then
               case
                 when coalesce(op.kind, pt.kind) = 'payroll' or coalesce(op.system_key, pt.system_key) in ('arca_ss', 'sindicato')
                   then 'payroll'
                 when coalesce(op.kind, pt.kind) = 'tax_agency' then 'taxes'
                 when coalesce(op.kind, pt.kind) = 'partner' then 'partners'
                 when coalesce(op.kind, pt.kind) = 'supplier' and coalesce(od.kind, d.kind) = 'payment' then 'suppliers'
                 else 'other'
               end
             else 'other'
           end as category
      from tl
      join net on net.entry_id = tl.entry_id
      join public.acc_documents d on d.id = tl.document_id and d.tenant_id = p_tenant_id
      left join public.acc_parties pt on pt.id = d.party_id
      left join public.acc_documents od on od.id = d.reverses_document_id and od.tenant_id = p_tenant_id
      left join public.acc_parties op on op.id = od.party_id
  )
  select date_trunc('month', c.entry_date::timestamp)::date, c.category,
         coalesce(sum(c.amount_cents) filter (where c.side = 'debit'), 0)::bigint,
         coalesce(sum(c.amount_cents) filter (where c.side = 'credit'), 0)::bigint
    from cls c
   where c.category is not null
   group by 1, 2
   order by 1, array_position(array['sales', 'suppliers', 'taxes', 'payroll', 'bank', 'partners', 'other'], c.category);
end;
$$;

-- ─── 8. Posición mensual de IVA (F.6) ────────────────────────────────────────
-- acc_compute_iva_position (#10) + status del mes, liquidación vigente (settlement_document_id), modo y si la
-- SAS liquida IVA (applies = responsable inscripta). period_not_found si el mes no está en los libros.
create function public.acc_report_iva_position(p_tenant_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_period public.acc_periods;
  v_set public.acc_settings;
  v_pos jsonb;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_month is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_month"}';
  end if;
  v_month := date_trunc('month', p_month)::date;
  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  v_pos := public.acc_compute_iva_position(p_tenant_id, v_month);
  return v_pos || jsonb_build_object(
    'status', v_period.status,
    'closed_at', v_period.closed_at,
    'settlement_document_id', v_pos -> 'settlement' -> 'document_id',
    'mode', v_set.iva_settlement_mode,
    'applies', v_set.iva_condition = 'responsable_inscripto');
end;
$$;

comment on function public.acc_report_treasury_balances(uuid, date) is
  'Cajas y bancos (F.9): saldo (Debe − Haber), por acreditar, último movimiento y último ajuste. INVOKER.';
comment on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) is
  'Subdiarios (F.8). Versión fase 1: disponibilidades (treasury), con saldo anterior y acumulado, keyset. INVOKER.';
comment on function public.acc_report_cash_flow(uuid, date, date) is
  'Flujo de caja realizado (F.9) por mes y categoría, sin apertura ni movimientos entre cajas. INVOKER.';
comment on function public.acc_report_iva_position(uuid, date) is
  'Posición mensual de IVA (F.6): acc_compute_iva_position + estado del mes y liquidación. INVOKER.';

revoke all on function public.acc_report_treasury_balances(uuid, date) from public, anon;
grant execute on function public.acc_report_treasury_balances(uuid, date) to authenticated;
revoke all on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) from public, anon;
grant execute on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) to authenticated;
revoke all on function public.acc_report_cash_flow(uuid, date, date) from public, anon;
grant execute on function public.acc_report_cash_flow(uuid, date, date) to authenticated;
revoke all on function public.acc_report_iva_position(uuid, date) from public, anon;
grant execute on function public.acc_report_iva_position(uuid, date) to authenticated;
