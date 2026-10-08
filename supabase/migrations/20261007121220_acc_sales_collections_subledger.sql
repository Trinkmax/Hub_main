-- Parte 3 de 5 de la migración #13 (acc_sales_collections): subdiarios de ventas, ventas por medio y cobranzas
-- (§F.8). Trae sus propios revoke/grant. Va DESPUÉS de 12c·1 (#12, parte 6):
--   · public.acc_report_subledger_sales  nueva: arma 'sales', 'sales_by_method' y 'collections'
--   · public.acc_report_subledger        create or replace de 12c·1 (misma firma, mismos parámetros, mismo
--                                        retorno): su cuerpo TAL CUAL + delega los tres de arriba
-- Convenciones §F.0: plpgsql stable SECURITY INVOKER, acc_assert_reader primero, filtro explícito por
-- p_tenant_id, solo comprobantes 'posted' y asientos vigentes. Las mismas reglas de 12c·1: una fila por
-- comprobante del rango en orden (accounting_date, seq), cursor {d, s}, las anulaciones con fecha de hoy como
-- fila propia con los importes del original en negativo, «al p_to» con las dos partidas de asientos vigentes.

-- ─── 1. Ventas, ventas por medio y cobranzas (F.8) ───────────────────────────
-- row (claves que lee lib/accounting/queries/columns.ts):
--   sales           = cierres del día y ventas sueltas: {row_kind 'line', date, seq, document_id, entry_id, kind,
--                     kind_label ('Cierre del día' | 'Factura' | 'Nota de débito' | 'Nota de crédito'),
--                     document_label, shift, party_id, party_name, sold_salon_cents, sold_delivery_cents,
--                     sold_events_cents, invoiced_net_cents, vat_cents, uninvoiced_cents, total_cents,
--                     cash_diff_cents (faltante +, sobrante −)}; con signo: una NC resta. Vendido de un canal =
--                     facturado + sin factura (renglones, con signo) + IVA de las filas del libro de ese canal; la
--                     suma de los tres canales es el total.
--   sales_by_method = un renglón de medio (caja, partida o seña) de un cierre: {row_kind 'line', date, seq,
--                     document_id, line_no, kind_label, method_id, method_name, channel, channel_label, party_id,
--                     party_name, amount_cents (lo vendido: al primer renglón de caja se le suma la diferencia de
--                     caja), due_date, open_cents (pendiente de la partida al p_to; null en las cajas)};
--                     orden (accounting_date, seq, line_no), cursor {d, s, n}, total_rows = renglones del rango.
--   collections     = {row_kind 'line', date, seq, document_id, entry_id, kind, kind_label, document_label,
--                     party_id, party_name, gross_cents, commission_cents, commission_vat_cents,
--                     vat_perception_cents, vat_withholding_cents, iibb_withholding_cents, sircupa_cents,
--                     income_tax_withholding_cents, certificates [{label}], differences_cents (diferencias +
--                     otros cargos + redondeo), other_cents, write_off_cents, net_received_cents, treasury_name,
--                     commission_voucher_label (el comprobante de la comisión; 'Llega después' si el IVA quedó
--                     a documentar; 'No factura' si fue al gasto), on_account_cents (lo del cobro sin aplicar al
--                     p_to; en una plataforma con neto negativo, lo que le debemos)}.
create or replace function public.acc_report_subledger_sales(p_tenant_id uuid, p_kind text, p_from date, p_to date,
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
  v_n smallint;
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
  if p_kind is null or p_kind not in ('sales', 'sales_by_method', 'collections') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_kind"}';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_s := (p_after ->> 's')::bigint;
      v_n := (p_after ->> 'n')::smallint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_s is null or (p_kind = 'sales_by_method' and v_n is null) then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;

  -- ── Ventas por medio: los renglones de medios de los cierres (al efectivo se le suma la diferencia de caja) ──
  if p_kind = 'sales_by_method' then
    select count(*)::int into v_total
      from public.acc_documents d
      left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
      join public.acc_document_lines x on x.document_id = coalesce(o.id, d.id) and x.tenant_id = d.tenant_id
     where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
       and coalesce(o.kind, d.kind) = 'sales_close'
       and x.role in ('treasury', 'receivable', 'advance');
    return query
    with z as (
      select d.id, d.seq, d.accounting_date, coalesce(o.id, d.id) as src_id, o.id is not null as is_rev,
             x.id as dline_id, x.line_no, x.role, x.amount_cents, x.due_date, x.party_id, x.sales_method_id
        from public.acc_documents d
        left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
        join public.acc_document_lines x on x.document_id = coalesce(o.id, d.id) and x.tenant_id = d.tenant_id
       where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
         and coalesce(o.kind, d.kind) = 'sales_close'
         and x.role in ('treasury', 'receivable', 'advance')
         and (v_d is null or (d.accounting_date, d.seq, x.line_no) > (v_d, v_s, v_n))
       order by d.accounting_date, d.seq, x.line_no
       limit v_limit),
    ar as (
      select a.debit_line_id, a.credit_line_id, a.amount_cents
        from public.acc_allocations a
        join public.acc_journal_lines l1 on l1.id = a.debit_line_id
        join public.acc_journal_entries e1 on e1.id = l1.entry_id and e1.status = 'posted'
        join public.acc_journal_lines l2 on l2.id = a.credit_line_id
        join public.acc_journal_entries e2 on e2.id = l2.entry_id and e2.status = 'posted'
       where a.tenant_id = p_tenant_id and a.party_id in (select z.party_id from z where z.party_id is not null)
         and a.applied_on <= p_to and (a.voided_on is null or a.voided_on > p_to))
    select jsonb_build_object(
             'row_kind', 'line', 'date', z.accounting_date, 'seq', z.seq, 'document_id', z.id, 'line_no', z.line_no,
             'kind_label', case when z.is_rev then 'Anulación · Cierre del día' else 'Cierre del día' end,
             'method_id', m.id, 'method_name', m.name, 'channel', m.channel,
             'channel_label', case m.channel when 'salon' then 'Salón' when 'delivery' then 'Delivery' else 'Eventos' end,
             'party_id', z.party_id, 'party_name', coalesce(nullif(btrim(p.trade_name), ''), p.name),
             'amount_cents', (case when z.is_rev then -1 else 1 end)
                             * (z.amount_cents + case when z.role = 'treasury' and z.line_no = fl.first_tr then fl.cash_diff
                                                      else 0 end),
             'due_date', z.due_date,
             'open_cents', case when z.is_rev or z.role = 'treasury' then null
                                else greatest(z.amount_cents - coalesce((select sum(ar.amount_cents) from ar
                                                                          where ar.debit_line_id = jl.id or ar.credit_line_id = jl.id), 0), 0) end),
           jsonb_build_object('d', z.accounting_date, 's', z.seq, 'n', z.line_no),
           v_total
      from z
      left join public.acc_sales_methods m on m.id = z.sales_method_id and m.tenant_id = p_tenant_id
      left join public.acc_parties p on p.id = z.party_id and p.tenant_id = p_tenant_id
      left join public.acc_journal_lines jl on jl.document_line_id = z.dline_id and jl.tenant_id = p_tenant_id
      cross join lateral (
        select min(y.line_no) filter (where y.role = 'treasury') as first_tr,
               coalesce(sum(case when y.side = 'debit' then y.amount_cents else -y.amount_cents end)
                          filter (where y.role = 'cash_diff'), 0)::bigint as cash_diff
          from public.acc_document_lines y
         where y.document_id = z.src_id and y.tenant_id = p_tenant_id) fl
     order by z.accounting_date, z.seq, z.line_no;
    return;
  end if;

  -- ── Subdiarios por comprobante: el conjunto del rango (con las anulaciones de esas clases) ──
  v_kinds := case p_kind when 'sales' then array['sales_close', 'sales_invoice', 'sales_debit_note', 'sales_credit_note']
                         else array['collection'] end;
  select count(*)::int into v_total
    from public.acc_documents d
    left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
   where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
     and (d.kind = any (v_kinds) or o.kind = any (v_kinds));

  -- ── Ventas: cierres del día y ventas sueltas (factura, ND, NC) ──
  -- Vendido por canal = Σ con signo de ventas facturadas y sin factura del canal + IVA (con signo) de las filas
  -- del libro de ese canal; facturado neto, IVA débito y sin factura con signo (las NC ya restan); el total y la
  -- diferencia de caja (faltante +, sobrante −) del comprobante. Una anulación, todo con el signo invertido.
  if p_kind = 'sales' then
    return query
    with dd as (
      select d.id, d.seq, d.accounting_date, d.kind, coalesce(d.shift, o.shift) as shift,
             coalesce(o.id, d.id) as src_id, coalesce(o.kind, d.kind) as src_kind, o.id is not null as is_rev,
             case when o.id is null then d.total_cents else o.total_cents end as total,
             case when o.id is null then '' else 'Anulación · ' end
               || public.acc_doc_label(coalesce(o.kind, d.kind), coalesce(o.voucher_type, d.voucher_type),
                                       coalesce(o.point_of_sale, d.point_of_sale), coalesce(o.number, d.number)) as label,
             coalesce(d.party_id, o.party_id) as party_id,
             coalesce(d.party_name_snapshot, o.party_name_snapshot) as party_name,
             case when o.id is null then 1 else -1 end as rv
        from public.acc_documents d
        left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
       where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
         and (d.kind = any (v_kinds) or o.kind = any (v_kinds))
         and (v_d is null or (d.accounting_date, d.seq) > (v_d, v_s))
       order by d.accounting_date, d.seq
       limit v_limit)
    select jsonb_build_object(
             'row_kind', 'line', 'date', dd.accounting_date, 'seq', dd.seq, 'document_id', dd.id,
             'entry_id', (select e.id from public.acc_journal_entries e where e.document_id = dd.id and e.tenant_id = p_tenant_id),
             'kind', dd.kind,
             'kind_label', case when dd.is_rev then 'Anulación · ' else '' end
                           || case dd.src_kind when 'sales_close' then 'Cierre del día' when 'sales_invoice' then 'Factura'
                                               when 'sales_debit_note' then 'Nota de débito' else 'Nota de crédito' end,
             'document_label', dd.label, 'shift', dd.shift, 'party_id', dd.party_id, 'party_name', dd.party_name,
             'sold_salon_cents', dd.rv * (s.l_salon + v.v_salon),
             'sold_delivery_cents', dd.rv * (s.l_delivery + v.v_delivery),
             'sold_events_cents', dd.rv * (s.l_events + v.v_events),
             'invoiced_net_cents', dd.rv * s.inv, 'vat_cents', dd.rv * s.vat, 'uninvoiced_cents', dd.rv * s.uninv,
             'total_cents', dd.rv * (case when dd.src_kind = 'sales_credit_note' then -1 else 1 end) * dd.total,
             'cash_diff_cents', dd.rv * s.cash_diff),
           jsonb_build_object('d', dd.accounting_date, 's', dd.seq),
           v_total
      from dd
      cross join lateral (
        select coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role = 'sales_invoiced'), 0)::bigint as inv,
               coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role = 'sales_uninvoiced'), 0)::bigint as uninv,
               coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role = 'vat'), 0)::bigint as vat,
               coalesce(sum(case when x.side = 'debit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role = 'cash_diff'), 0)::bigint as cash_diff,
               coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role in ('sales_invoiced', 'sales_uninvoiced') and x.channel = 'salon'), 0)::bigint as l_salon,
               coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role in ('sales_invoiced', 'sales_uninvoiced') and x.channel = 'delivery'), 0)::bigint as l_delivery,
               coalesce(sum(case when x.side = 'credit' then x.amount_cents else -x.amount_cents end)
                          filter (where x.role in ('sales_invoiced', 'sales_uninvoiced') and x.channel = 'events'), 0)::bigint as l_events
          from public.acc_document_lines x
         where x.document_id = dd.src_id and x.tenant_id = p_tenant_id) s
      cross join lateral (
        select coalesce(sum(fv.vt) filter (where fv.channel = 'salon'), 0)::bigint as v_salon,
               coalesce(sum(fv.vt) filter (where fv.channel = 'delivery'), 0)::bigint as v_delivery,
               coalesce(sum(fv.vt) filter (where fv.channel = 'events'), 0)::bigint as v_events
          from (select y.channel, (case when y.is_credit_note then -1 else 1 end)
                                  * (y.vat_25_cents + y.vat_5_cents + y.vat_105_cents + y.vat_21_cents + y.vat_27_cents) as vt
                  from public.acc_fiscal_vouchers y
                 where y.document_id = dd.src_id and y.tenant_id = p_tenant_id and y.book = 'sales' and not y.is_reversal) fv) v
     order by dd.accounting_date, dd.seq;
    return;
  end if;

  -- ── Cobranzas y acreditaciones ──
  if p_kind = 'collections' then
    return query
    with dd as (
      select d.id, d.seq, d.accounting_date, d.kind,
             coalesce(o.id, d.id) as src_id, o.id is not null as is_rev,
             case when o.id is null then d.total_cents else o.total_cents end as total,
             coalesce(o.voucher_type, d.voucher_type) as voucher_type,
             coalesce(o.point_of_sale, d.point_of_sale) as pos, coalesce(o.number, d.number) as num,
             case when o.id is null then '' else 'Anulación · ' end
               || public.acc_doc_label('collection', coalesce(o.voucher_type, d.voucher_type),
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
      select a.debit_line_id, a.credit_line_id, a.amount_cents
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
             'kind', dd.kind, 'kind_label', case when dd.is_rev then 'Anulación · Cobro' else 'Cobro' end,
             'document_label', dd.label, 'party_id', dd.party_id, 'party_name', dd.party_name,
             'gross_cents', dd.sg * dd.total,
             'commission_cents', dd.sg * s.comm, 'commission_vat_cents', dd.sg * s.vat,
             'vat_perception_cents', dd.sg * s.perc, 'vat_withholding_cents', dd.sg * s.ret_iva,
             'iibb_withholding_cents', dd.sg * s.ret_iibb, 'sircupa_cents', dd.sg * s.sircupa,
             'income_tax_withholding_cents', dd.sg * s.ret_gan, 'certificates', coalesce(s.certs, '[]'::jsonb),
             'differences_cents', dd.sg * (s.dif + s.otro + s.wo), 'other_cents', dd.sg * s.otro,
             'write_off_cents', dd.sg * s.wo, 'net_received_cents', dd.sg * s.recv, 'treasury_name', s.treasuries,
             'commission_voucher_label', case when dd.voucher_type is not null
                                                then public.acc_doc_label('collection', dd.voucher_type, dd.pos, dd.num)
                                              when s.vat_later > 0 then 'Llega después'
                                              when s.vat > 0 then 'No factura' end,
             'on_account_cents', case when dd.is_rev then null
                                      else coalesce((select sum(greatest(jl.amount_cents - coalesce((
                                                        select sum(ar.amount_cents) from ar
                                                         where ar.debit_line_id = jl.id or ar.credit_line_id = jl.id), 0), 0))
                                                       from public.acc_journal_lines jl
                                                       join public.acc_document_lines x on x.id = jl.document_line_id
                                                      where jl.document_id = dd.id and jl.tenant_id = p_tenant_id
                                                        and x.role = 'control'), 0) end),
           jsonb_build_object('d', dd.accounting_date, 's', dd.seq),
           v_total
      from dd
      cross join lateral (
        select coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'comision'), 0)::bigint as comm,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'iva_comision'), 0)::bigint as vat,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'iva_comision'
                                                      and a.system_key = 'vat_credit_pending'), 0)::bigint as vat_later,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'percepcion_iva_comision'), 0)::bigint as perc,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'ret_iva'), 0)::bigint as ret_iva,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'ret_iibb'), 0)::bigint as ret_iibb,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'sircupa'), 0)::bigint as sircupa,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'ret_ganancias'), 0)::bigint as ret_gan,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'diferencia'), 0)::bigint as dif,
               coalesce(sum(x.amount_cents) filter (where x.role = 'deduction' and x.tax_kind = 'otro'), 0)::bigint as otro,
               coalesce(sum(x.amount_cents) filter (where x.role = 'write_off'), 0)::bigint as wo,
               coalesce(sum(x.amount_cents) filter (where x.role = 'treasury'), 0)::bigint as recv,
               string_agg(distinct t.name, ' · ') filter (where x.role = 'treasury') as treasuries,
               jsonb_agg(jsonb_build_object('label', x.certificate_number) order by x.line_no)
                 filter (where x.certificate_number is not null) as certs
          from public.acc_document_lines x
          join public.acc_accounts a on a.id = x.account_id and a.tenant_id = x.tenant_id
          left join public.acc_treasury_accounts t on t.id = x.treasury_account_id and t.tenant_id = x.tenant_id
         where x.document_id = dd.src_id and x.tenant_id = p_tenant_id) s
     order by dd.accounting_date, dd.seq;
    return;
  end if;
end;
$$;

-- ─── 2. Subdiarios (F.8), versión fase 3: los seis ────────────────────────────
-- El cuerpo de 12c·1 TAL CUAL (disponibilidades de la #11; compras y pagos delegados en
-- acc_report_subledger_purchases) + ventas, ventas por medio y cobranzas delegados en la función de arriba.
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
  -- Ventas, ventas por medio y cobranzas (#13): los arma acc_report_subledger_sales.
  if p_kind in ('sales', 'sales_by_method', 'collections') then
    return query
    select x."row", x.cursor, x.total_rows
      from public.acc_report_subledger_sales(p_tenant_id, p_kind, p_from, p_to, p_after, p_limit) x;
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

comment on function public.acc_report_subledger_sales(uuid, text, date, date, jsonb, integer) is
  'Subdiarios de ventas (sales), ventas por medio (sales_by_method) y cobranzas (collections) de F.8, keyset; los usa acc_report_subledger. INVOKER.';
comment on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) is
  'Subdiarios (F.8). Versión fase 3: disponibilidades (treasury), compras y pagos (acc_report_subledger_purchases), ventas, ventas por medio y cobranzas (acc_report_subledger_sales), keyset. INVOKER.';

revoke all on function public.acc_report_subledger_sales(uuid, text, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_subledger_sales(uuid, text, date, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) from public, anon;
grant execute on function public.acc_report_subledger(uuid, text, date, date, uuid, jsonb, integer) to authenticated;
