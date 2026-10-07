-- Parte 6 de 7 de la migración #12 (acc_purchases_payments), grupo 12c: subdiarios de compras y de pagos
-- (§F.8). Partida en varias solo para que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte
-- trae sus propios revoke/grant. Va DESPUÉS de la #11 (parte 2):
--   · public.acc_report_subledger_purchases  nueva: arma los subdiarios 'purchases' y 'payments'
--   · public.acc_report_subledger            create or replace de la #11 (misma firma, mismos parámetros, mismo
--                                            retorno): el cuerpo de la #11 TAL CUAL (disponibilidades) + delega
--                                            'purchases' y 'payments' en la de arriba. La #13 vuelve a reemplazarla
--                                            para delegar ventas, ventas por medio y cobranzas en su propia función.
-- Así cada fase suma una función chica en vez de reescribir todo el subdiario. Las dos: plpgsql stable SECURITY
-- INVOKER, acc_assert_reader primero (§F.0), filtro explícito por p_tenant_id, solo comprobantes 'posted' y
-- asientos vigentes. Usa acc_doc_label (12a·2).
--
-- Subdiarios por comprobante: una fila por comprobante vigente del rango (por fecha contable) en orden
-- (accounting_date, seq); cursor {d, s}; total_rows = comprobantes del rango (sin fila de saldo anterior). Una
-- anulación con fecha de hoy («reversal», C.4.3) de un comprobante de esas clases entra como fila propia, con
-- los importes del original en negativo («Anulación · …»). Las NC de proveedor van en negativo (como en el Libro
-- IVA). «Al p_to»: una imputación cuenta si applied_on ≤ p_to, no está desaplicada antes y sus dos partidas son
-- de asientos vigentes (la misma regla que acc_report_party_statement), así un mes cerrado da siempre lo mismo.

-- ─── 1. Compras y pagos (F.8) ────────────────────────────────────────────────
-- row (claves que lee lib/accounting/queries/columns.ts):
--   purchases = compras, ND, NC y gastos de contado: {row_kind 'line', date, seq, document_id, entry_id, kind,
--               kind_label, document_label, party_id, party_name, tax_id, imputation (la cuenta principal; «(+N)»
--               si hay más), net_cents, vat_cents, non_taxed_cents (no gravado, exento y sin crédito: gross +
--               non_taxed + exempt), perceptions_cents (percepciones, impuestos internos y otros tributos),
--               total_cents, payment_form_label ('Contado' | 'Cuenta corriente'), due_date, status_label
--               ('Pagada' | 'Pago parcial' | 'Impaga' | 'Anulada'; en NC 'Aplicada' | 'Aplicada en parte' |
--               'Sin aplicar'), open_cents (pendiente de su partida al p_to)}. La factura mensual de comisiones
--               (settles) no tiene partida: forma, estado y pendiente en null; su neto es 0 (ya se gastó en las
--               cobranzas).
--   payments  = pagos + la parte de caja de los gastos: {row_kind 'line', date, seq, document_id, entry_id, kind,
--               kind_label, document_label, party_id, party_name (en un gasto sin proveedor, su descripción),
--               methods [{label (caja), amount_cents}], applied_to [{label (comprobante), amount_cents}] (lo
--               imputado por el pago al p_to, también con saldos a favor usados en el mismo envío),
--               credits_used_cents, compensations_cents, on_account_cents (lo del pago sin imputar al p_to),
--               total_cents}.
create or replace function public.acc_report_subledger_purchases(p_tenant_id uuid, p_kind text, p_from date, p_to date,
                                                                 p_after jsonb default null, p_limit integer default 500)
returns table ("row" jsonb, cursor jsonb, total_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_total integer;
  v_d date;
  v_s bigint;
  v_kinds text[];
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('purchases', 'payments') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_kind"}';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_s := (p_after ->> 's')::bigint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_s is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;

  -- ── Subdiarios por comprobante: el conjunto del rango (con las anulaciones de esas clases) ──
  v_kinds := case p_kind when 'purchases' then array['purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense']
                         else array['payment', 'expense'] end;
  select count(*)::int into v_total
    from public.acc_documents d
    left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
   where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
     and (d.kind = any (v_kinds) or o.kind = any (v_kinds));

  if p_kind = 'purchases' then
    return query
    with dd as (
      select d.id, d.seq, d.accounting_date, d.kind, d.bundle_id, d.due_date,
             coalesce(o.id, d.id) as src_id, coalesce(o.kind, d.kind) as src_kind, o.id is not null as is_rev,
             case when o.id is null then d.total_cents else o.total_cents end as total,
             coalesce(o.settles_commissions, d.settles_commissions) as settles,
             case when o.id is null then '' else 'Anulación · ' end
               || public.acc_doc_label(coalesce(o.kind, d.kind), coalesce(o.voucher_type, d.voucher_type),
                                       coalesce(o.point_of_sale, d.point_of_sale), coalesce(o.number, d.number)) as label,
             coalesce(d.party_id, o.party_id) as party_id,
             coalesce(d.party_name_snapshot, o.party_name_snapshot) as party_name,
             case when coalesce(d.party_doc_type_snapshot, o.party_doc_type_snapshot) = 80
                  then coalesce(d.party_doc_number_snapshot, o.party_doc_number_snapshot) end as tax_id,
             (case when o.id is null then 1 else -1 end)
               * (case when coalesce(o.kind, d.kind) = 'purchase_credit_note' then -1 else 1 end) as sg
        from public.acc_documents d
        left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
       where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
         and (d.kind = any (v_kinds) or o.kind = any (v_kinds))
         and (v_d is null or (d.accounting_date, d.seq) > (v_d, v_s))
       order by d.accounting_date, d.seq
       limit v_limit),
    ar as (
      select a.debit_line_id, a.credit_line_id, a.amount_cents
        from public.acc_allocations a
        join public.acc_journal_lines l1 on l1.id = a.debit_line_id
        join public.acc_journal_entries e1 on e1.id = l1.entry_id and e1.status = 'posted'
        join public.acc_journal_lines l2 on l2.id = a.credit_line_id
        join public.acc_journal_entries e2 on e2.id = l2.entry_id and e2.status = 'posted'
       where a.tenant_id = p_tenant_id and a.party_id in (select dd.party_id from dd where dd.party_id is not null)
         and a.applied_on <= p_to and (a.voided_on is null or a.voided_on > p_to)),
    al as (
      select x.line_id, sum(x.amount_cents)::bigint as applied
        from (select ar.debit_line_id as line_id, ar.amount_cents from ar
              union all
              select ar.credit_line_id, ar.amount_cents from ar) x
       group by x.line_id)
    select jsonb_build_object(
             'row_kind', 'line', 'date', dd.accounting_date, 'seq', dd.seq, 'document_id', dd.id,
             'entry_id', (select e.id from public.acc_journal_entries e where e.document_id = dd.id and e.tenant_id = p_tenant_id),
             'kind', dd.kind,
             'kind_label', case when dd.is_rev then 'Anulación · ' else '' end
                           || case dd.src_kind
                                when 'purchase' then case when dd.settles then 'Factura de comisiones' else 'Compra' end
                                when 'purchase_debit_note' then 'Nota de débito'
                                when 'purchase_credit_note' then 'Nota de crédito'
                                else 'Gasto' end,
             'document_label', dd.label, 'party_id', dd.party_id, 'party_name', dd.party_name, 'tax_id', dd.tax_id,
             'imputation', s.imp || case when s.n_imp > 1 then ' (+' || (s.n_imp - 1)::text || ')' else '' end,
             'net_cents', dd.sg * s.net, 'vat_cents', dd.sg * s.vat, 'non_taxed_cents', dd.sg * s.nontax,
             'perceptions_cents', dd.sg * s.taxes, 'total_cents', dd.sg * dd.total,
             'payment_form_label', case when dd.is_rev or dd.settles then null
                                        when dd.src_kind = 'expense' then 'Contado'
                                        when exists (select 1 from public.acc_documents p
                                                      where p.bundle_id = dd.bundle_id and p.tenant_id = p_tenant_id
                                                        and p.kind = 'payment' and p.status = 'posted') then 'Contado'
                                        else 'Cuenta corriente' end,
             'due_date', case when not dd.is_rev then dd.due_date end,
             'status_label', case when dd.is_rev or dd.settles then null
                                  when dd.src_kind = 'expense' then 'Pagada'
                                  when rv.anulada then 'Anulada'
                                  when c.amt is null then null
                                  when c.open = 0 then case when dd.src_kind = 'purchase_credit_note' then 'Aplicada' else 'Pagada' end
                                  when c.open < c.amt then case when dd.src_kind = 'purchase_credit_note' then 'Aplicada en parte'
                                                                else 'Pago parcial' end
                                  else case when dd.src_kind = 'purchase_credit_note' then 'Sin aplicar' else 'Impaga' end end,
             'open_cents', case when dd.is_rev or dd.settles then null
                                when dd.src_kind = 'expense' or rv.anulada then 0
                                else dd.sg * coalesce(c.open, 0) end),
           jsonb_build_object('d', dd.accounting_date, 's', dd.seq),
           v_total
      from dd
      cross join lateral (
        select coalesce(sum(x.amount_cents) filter (where x.role = 'net'), 0)::bigint as net,
               coalesce(sum(x.amount_cents) filter (where x.role = 'vat'), 0)::bigint as vat,
               coalesce(sum(x.amount_cents) filter (where x.role in ('gross', 'non_taxed', 'exempt')), 0)::bigint as nontax,
               coalesce(sum(x.amount_cents) filter (where x.role in ('perception', 'internal_tax', 'other_tax')), 0)::bigint as taxes,
               count(distinct x.account_id) filter (where x.role in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax')) as n_imp,
               (array_agg(a.name order by x.amount_cents desc, x.line_no)
                  filter (where x.role in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax')))[1] as imp
          from public.acc_document_lines x
          join public.acc_accounts a on a.id = x.account_id and a.tenant_id = x.tenant_id
         where x.document_id = dd.src_id and x.tenant_id = p_tenant_id) s
      cross join lateral (
        select sum(jl.amount_cents)::bigint as amt,
               sum(greatest(jl.amount_cents - coalesce(al.applied, 0), 0))::bigint as open
          from public.acc_journal_lines jl
          join public.acc_document_lines x on x.id = jl.document_line_id and x.role = 'control'
          left join al on al.line_id = jl.id
         where jl.document_id = dd.id and jl.tenant_id = p_tenant_id and not dd.is_rev) c
      cross join lateral (
        select exists (select 1 from public.acc_documents r
                        where r.reverses_document_id = dd.id and r.tenant_id = p_tenant_id and r.kind = 'reversal'
                          and r.status = 'posted' and r.accounting_date <= p_to) as anulada) rv
     order by dd.accounting_date, dd.seq;
    return;
  end if;

  -- ── Pagos (y la parte de caja de los gastos) ──
  return query
  with dd as (
    select d.id, d.seq, d.accounting_date, d.kind, d.description,
           coalesce(o.id, d.id) as src_id, coalesce(o.kind, d.kind) as src_kind, o.id is not null as is_rev,
           case when o.id is null then d.total_cents else o.total_cents end as total,
           case when o.id is null then '' else 'Anulación · ' end
             || public.acc_doc_label(coalesce(o.kind, d.kind), coalesce(o.voucher_type, d.voucher_type),
                                     coalesce(o.point_of_sale, d.point_of_sale), coalesce(o.number, d.number)) as label,
           coalesce(d.party_id, o.party_id) as party_id,
           coalesce(d.party_name_snapshot, o.party_name_snapshot) as party_name,
           case when o.id is null then 1 else -1 end as sg
      from public.acc_documents d
      left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
     where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
       and (d.kind = any (v_kinds) or o.kind = any (v_kinds))
       and (v_d is null or (d.accounting_date, d.seq) > (v_d, v_s))
     order by d.accounting_date, d.seq
     limit v_limit),
  ar as (
    select a.debit_line_id, a.credit_line_id, a.amount_cents, a.document_id, a.kind,
           l1.document_id as d_doc, l2.document_id as c_doc
      from public.acc_allocations a
      join public.acc_journal_lines l1 on l1.id = a.debit_line_id
      join public.acc_journal_entries e1 on e1.id = l1.entry_id and e1.status = 'posted'
      join public.acc_journal_lines l2 on l2.id = a.credit_line_id
      join public.acc_journal_entries e2 on e2.id = l2.entry_id and e2.status = 'posted'
     where a.tenant_id = p_tenant_id and a.party_id in (select dd.party_id from dd where dd.party_id is not null)
       and a.applied_on <= p_to and (a.voided_on is null or a.voided_on > p_to))
  select jsonb_build_object(
           'row_kind', 'line', 'date', dd.accounting_date, 'seq', dd.seq, 'document_id', dd.id,
           'entry_id', (select e.id from public.acc_journal_entries e where e.document_id = dd.id and e.tenant_id = p_tenant_id),
           'kind', dd.kind,
           'kind_label', case when dd.is_rev then 'Anulación · ' else '' end
                         || case dd.src_kind when 'payment' then 'Pago' else 'Gasto' end,
           'document_label', dd.label, 'party_id', dd.party_id,
           'party_name', coalesce(dd.party_name, case when dd.src_kind = 'expense' then dd.description end),
           'methods', coalesce(m.items, '[]'::jsonb),
           'applied_to', coalesce(ap.items, '[]'::jsonb),
           'credits_used_cents', coalesce(ap.credits, 0),
           'compensations_cents', dd.sg * m.comp,
           'on_account_cents', case when dd.is_rev or dd.src_kind <> 'payment' then 0
                                    else coalesce((select sum(greatest(jl.amount_cents - coalesce((
                                                     select sum(ar.amount_cents) from ar
                                                      where ar.debit_line_id = jl.id or ar.credit_line_id = jl.id), 0), 0))
                                                     from public.acc_journal_lines jl
                                                     join public.acc_document_lines x on x.id = jl.document_line_id
                                                    where jl.document_id = dd.id and jl.tenant_id = p_tenant_id
                                                      and x.role = 'control'), 0) end,
           'total_cents', dd.sg * dd.total),
         jsonb_build_object('d', dd.accounting_date, 's', dd.seq),
         v_total
    from dd
    cross join lateral (
      select jsonb_agg(jsonb_build_object('label', coalesce(t.name, 'Caja'), 'amount_cents', dd.sg * x.amount_cents)
                       order by x.line_no) filter (where x.role = 'treasury') as items,
             coalesce(sum(x.amount_cents) filter (where x.role = 'compensation'), 0)::bigint as comp
        from public.acc_document_lines x
        left join public.acc_treasury_accounts t on t.id = x.treasury_account_id and t.tenant_id = x.tenant_id
       where x.document_id = dd.src_id and x.tenant_id = p_tenant_id) m
    left join lateral (
      select jsonb_agg(jsonb_build_object('label', g.label, 'amount_cents', g.amt) order by g.dt, g.seq) as items,
             sum(g.credits)::bigint as credits
        from (select cd.seq, cd.accounting_date as dt,
                     public.acc_doc_label(cd.kind, cd.voucher_type, cd.point_of_sale, cd.number) as label,
                     sum(ar.amount_cents)::bigint as amt,
                     coalesce(sum(ar.amount_cents) filter (where ar.d_doc <> dd.id), 0)::bigint as credits
                from ar
                join public.acc_documents cd on cd.id = ar.c_doc and cd.tenant_id = p_tenant_id
               where not dd.is_rev and dd.src_kind = 'payment' and ar.kind <> 'reversal'
                 and (ar.d_doc = dd.id or ar.document_id = dd.id)
               group by cd.id, cd.seq, cd.accounting_date, cd.kind, cd.voucher_type, cd.point_of_sale, cd.number) g) ap on true
   order by dd.accounting_date, dd.seq;
end;
$$;

-- ─── 2. Subdiarios (F.8), versión fase 2: disponibilidades + compras y pagos ───
-- Igual que la #11 (p_kind 'treasury': líneas de las cuentas de caja con «Saldo anterior», keyset {d, k, s, n})
-- y 'purchases' / 'payments' delegados en acc_report_subledger_purchases. Ventas, ventas por medio y cobranzas
-- siguen en invalid_report_param hasta la #13.
create or replace function public.acc_report_subledger(p_tenant_id uuid, p_kind text, p_from date, p_to date,
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
  -- Compras y pagos (12c): los arma acc_report_subledger_purchases (mismas validaciones, cursor {d, s}).
  if p_kind in ('purchases', 'payments') then
    return query
    select x."row", x.cursor, x.total_rows
      from public.acc_report_subledger_purchases(p_tenant_id, p_kind, p_from, p_to, p_after, p_limit) x;
    return;
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

comment on function public.acc_report_subledger_purchases(uuid, text, date, date, jsonb, integer) is
  'Subdiarios de compras (purchases) y de pagos (payments) de F.8, keyset {d, s}; los usa acc_report_subledger. INVOKER.';
comment on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) is
  'Subdiarios (F.8). Versión fase 2: disponibilidades (treasury, con saldo anterior y acumulado), compras y pagos (delegados en acc_report_subledger_purchases), keyset. INVOKER.';

revoke all on function public.acc_report_subledger_purchases(uuid, text, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_subledger_purchases(uuid, text, date, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) from public, anon;
grant execute on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) to authenticated;
