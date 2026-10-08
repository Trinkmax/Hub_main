-- Parte 1 de 1 de la migración #14 (acc_books_contadora): lo que falta de §F para la contadora. Entra entera en
-- una sola llamada (≤ 40 KB); los revoke/grant de cada función viajan con ella y cierra con notify pgrst.
-- ============================================================
-- Sprint 1 «Administración» · fase 4 · migración #14 (acc_books_contadora) · spec §F.12, §F.15, §I.1 #14
-- ============================================================
-- Qué crea (public, plpgsql stable SECURITY INVOKER: corren bajo la RLS de quien llama —dueño con acceso o
-- contadora—, acc_assert_reader primero, filtro explícito por p_tenant_id; EXECUTE solo authenticated):
--   · acc_report_sales_summary(tenant, desde, hasta)                 F.12 «Ventas sin factura» por mes y canal
--   · acc_report_journal_import(tenant, desde, hasta, after, limit)  F.15 filas planas de «Asientos para importar»
--   · acc_report_month_package(tenant, mes) → jsonb                   F.15 «Paquete del mes»: filas de cada archivo
-- Sin índices nuevos: las tres recorren índices que ya existen (aje_order_idx, ajl_entry_idx, adl_document_idx,
-- afv_document_idx, adoc_kind_date_idx); no hubo humo de rendimiento que pida otros.
-- acc_report_sales_summary también figura en la fila #13 de §I.1: si la #13 ya la declaró con esta misma firma y
-- estas mismas columnas, esta versión la reemplaza (create or replace); si las columnas no coinciden, el apply
-- falla con «cannot change return type»: reconciliar antes de aplicar.
-- ============================================================

-- ─── 1. Ventas sin factura (F.12) ────────────────────────────────────────────
-- Por mes (de la fecha contable) y canal: facturado neto (renglones sales_invoiced: netos + no gravado + exento),
-- IVA débito (filas del Libro IVA ventas del comprobante, por su canal; las NC restan), sin factura (renglones
-- sales_uninvoiced) y vendido = facturado neto + IVA + sin factura (lo que entró por los medios). Cuentan los
-- cierres del día y las ventas sueltas vigentes (factura, ND y NC); una anulación con fecha posterior (reversal
-- de un mes cerrado) resta lo de su original en el mes de la anulación. Solo filas con algún importe ≠ 0, en
-- orden (mes, salón, delivery, eventos). Las ventas sin factura no generan IVA débito: el tratamiento lo define
-- la contadora (acc_settings.uninvoiced_sales_mode); la columna está para que lo vea.
create or replace function public.acc_report_sales_summary(p_tenant_id uuid, p_from date, p_to date)
returns table (month date, channel text, sold_cents bigint, invoiced_net_cents bigint, vat_cents bigint,
               uninvoiced_cents bigint)
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
  with src as (
    select d.id as doc_id, d.accounting_date as on_date, 1 as sgn
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.status = 'posted'
       and d.kind in ('sales_close', 'sales_invoice', 'sales_debit_note', 'sales_credit_note')
       and d.accounting_date between p_from and p_to
    union all
    select o.id, r.accounting_date, -1
      from public.acc_documents r
      join public.acc_documents o on o.id = r.reverses_document_id and o.tenant_id = r.tenant_id
     where r.tenant_id = p_tenant_id and r.status = 'posted' and r.kind = 'reversal'
       and o.kind in ('sales_close', 'sales_invoice', 'sales_debit_note', 'sales_credit_note')
       and r.accounting_date between p_from and p_to
  ), amounts as (
    select date_trunc('month', s.on_date::timestamp)::date as m, dl.channel as ch,
           (case when dl.role = 'sales_invoiced'
                 then s.sgn * (case when dl.side = 'credit' then dl.amount_cents else -dl.amount_cents end)
                 else 0 end)::bigint as inv,
           0::bigint as vat,
           (case when dl.role = 'sales_uninvoiced'
                 then s.sgn * (case when dl.side = 'credit' then dl.amount_cents else -dl.amount_cents end)
                 else 0 end)::bigint as uninv
      from src s
      join public.acc_document_lines dl on dl.document_id = s.doc_id and dl.tenant_id = p_tenant_id
     where dl.role in ('sales_invoiced', 'sales_uninvoiced')
    union all
    select date_trunc('month', s.on_date::timestamp)::date, fv.channel, 0::bigint,
           (s.sgn * (case when fv.is_credit_note then -1 else 1 end)
              * (fv.vat_25_cents + fv.vat_5_cents + fv.vat_105_cents + fv.vat_21_cents + fv.vat_27_cents))::bigint,
           0::bigint
      from src s
      join public.acc_fiscal_vouchers fv on fv.document_id = s.doc_id and fv.tenant_id = p_tenant_id
     where fv.book = 'sales' and not fv.voided
  )
  select a.m, a.ch, (sum(a.inv) + sum(a.vat) + sum(a.uninv))::bigint, sum(a.inv)::bigint, sum(a.vat)::bigint,
         sum(a.uninv)::bigint
    from amounts a
   where a.ch is not null
   group by a.m, a.ch
  having sum(a.inv) <> 0 or sum(a.vat) <> 0 or sum(a.uninv) <> 0
   order by a.m, array_position(array['salon', 'delivery', 'events'], a.ch), a.ch;
end;
$$;

-- ─── 2. Asientos para importar (F.15) ────────────────────────────────────────
-- Una fila por línea de los asientos vigentes del rango (incluye los espejos, igual que el diario), en el orden
-- del diario: (fecha, order_key, posting_seq) y dentro del asiento primero el Debe, por line_no. Columnas del
-- CSV «Fecha;N° asiento;Código de cuenta;Cuenta;Debe;Haber;Leyenda;Comprobante;CUIT;Partícipe»: entry_number =
-- el congelado o el provisorio (acc_entry_number_base + row_number() sobre todos los vigentes sin número del
-- ejercicio, como acc_report_journal); legend = memo de la línea o, si no tiene, la descripción del asiento.
-- Keyset: p_after = el `cursor` {d, k, s, c, n} de la última fila (c = 0 Debe / 1 Haber); p_limit tope 500.
-- total_rows = líneas del rango (lo que mira el exporte antes de transmitir: 413 sobre 200.000). Un rango que
-- cruza dos ejercicios → range_crosses_fiscal_year (la numeración arranca de nuevo en cada uno).
create function public.acc_report_journal_import(p_tenant_id uuid, p_from date, p_to date, p_after jsonb default null,
                                                 p_limit integer default 500)
returns table (entry_id uuid, entry_number integer, number_is_provisional boolean, entry_date date, entry_kind text,
               line_no smallint, account_id uuid, account_code text, account_name text, debit_cents bigint,
               credit_cents bigint, legend text, document_id uuid, document_label text, party_id uuid,
               party_tax_id text, party_name text, cursor jsonb, total_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_d date;
  v_k smallint;
  v_s bigint;
  v_c integer;
  v_n smallint;
  v_fy uuid;
  v_base integer := 0;
  v_total integer;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from public.acc_fiscal_years f
       where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from) > 1 then
    raise exception 'range_crosses_fiscal_year' using errcode = 'P0001';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_k := (p_after ->> 'k')::smallint;
      v_s := (p_after ->> 's')::bigint;
      v_c := (p_after ->> 'c')::integer;
      v_n := (p_after ->> 'n')::smallint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_k is null or v_s is null or v_c is null or v_c not in (0, 1) or v_n is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;
  select f.id into v_fy from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from;
  if v_fy is not null then
    v_base := public.acc_entry_number_base(v_fy);
  end if;
  select count(*)::int into v_total
    from public.acc_journal_entries e
    join public.acc_journal_lines l on l.entry_id = e.id and l.tenant_id = e.tenant_id
   where e.tenant_id = p_tenant_id and e.status = 'posted' and e.entry_date between p_from and p_to;

  return query
  with prov as (
    select e.id, (v_base + row_number() over (order by e.entry_date, e.order_key, e.posting_seq))::int as n
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.fiscal_year_id = v_fy and e.status = 'posted' and e.number is null
  ), pg as (
    select e.id as eid, e.number as num, e.entry_date as ed, e.kind as ek, e.description as descr,
           e.document_id as did, e.order_key as okey, e.posting_seq as pseq,
           (case when l.side = 'credit' then 1 else 0 end) as cr, l.line_no as lno, l.account_id as aid,
           l.amount_cents as amt, l.party_id as pid, l.memo as lmemo
      from public.acc_journal_entries e
      join public.acc_journal_lines l on l.entry_id = e.id and l.tenant_id = e.tenant_id
     where e.tenant_id = p_tenant_id and e.status = 'posted' and e.entry_date between p_from and p_to
       and (v_d is null
            or (e.entry_date, e.order_key, e.posting_seq, (case when l.side = 'credit' then 1 else 0 end), l.line_no)
               > (v_d, v_k, v_s, v_c, v_n))
     order by e.entry_date, e.order_key, e.posting_seq, (case when l.side = 'credit' then 1 else 0 end), l.line_no
     limit v_limit
  )
  select pg.eid, coalesce(pg.num, prov.n), pg.num is null, pg.ed, pg.ek, pg.lno, pg.aid, a.code, a.name,
         (case when pg.cr = 0 then pg.amt else 0 end)::bigint, (case when pg.cr = 1 then pg.amt else 0 end)::bigint,
         coalesce(nullif(btrim(pg.lmemo), ''), pg.descr), pg.did,
         public.acc_doc_label(d.kind, d.voucher_type, d.point_of_sale, d.number), pg.pid, pt.tax_id, pt.name,
         jsonb_build_object('d', pg.ed, 'k', pg.okey, 's', pg.pseq, 'c', pg.cr, 'n', pg.lno), v_total
    from pg
    join public.acc_documents d on d.id = pg.did and d.tenant_id = p_tenant_id
    join public.acc_accounts a on a.id = pg.aid and a.tenant_id = p_tenant_id
    left join public.acc_parties pt on pt.id = pg.pid and pt.tenant_id = p_tenant_id
    left join prov on prov.id = pg.eid
   order by pg.ed, pg.okey, pg.pseq, pg.cr, pg.lno;
end;
$$;

-- ─── 3. Paquete del mes (F.15) ───────────────────────────────────────────────
-- Las filas de cada archivo del paquete en una sola llamada, en el orden de MONTH_PACKAGE_BOOKS
-- (lib/accounting/queries/labels.ts) y con las mismas unidades que muestra Libros. Cada conteo sale de la MISMA
-- lectura que arma el archivo (paridad con el CSV): diario = asientos vigentes del mes (lines = sus líneas = las
-- filas de «Asientos para importar»); sumas y saldos = filas de acc_report_trial_balance; mayor general = sus
-- imputables con movimiento o saldo anterior; libros IVA y alícuotas = total_rows de su primera página;
-- subdiarios = total_rows de acc_report_subledger; saldos = partícipes con deuda o saldo a favor al último día
-- del mes (o a hoy, si el mes no terminó). Un conteo que la base todavía no puede hacer (la función de esa fase
-- no está, o no conoce esa clase de subdiario: invalid_report_param) queda en null sin tirar la lista, igual que
-- getMonthPackage; cualquier otro error sube. posicion-iva no tiene conteo (rows null). Además: el estado del
-- mes (status open | closed | missing, quién y cuándo lo cerró, numeración) y sas_cuit_missing (los libros IVA
-- y la posición piden el CUIT de la SAS para exportarse).
create function public.acc_report_month_package(p_tenant_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_first date;
  v_last date;
  v_as_of date;
  v_period public.acc_periods;
  v_cuit text;
  v_entries integer;
  v_lines integer;
  v_trial integer;
  v_ledger integer;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  r record;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_month is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_month"}';
  end if;
  v_first := date_trunc('month', p_month::timestamp)::date;
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  v_as_of := least(v_last, public.acc_today(p_tenant_id));
  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_first;
  select s.cuit into v_cuit from public.acc_settings s where s.tenant_id = p_tenant_id;

  select count(distinct e.id)::int, count(l.id)::int into v_entries, v_lines
    from public.acc_journal_entries e
    left join public.acc_journal_lines l on l.entry_id = e.id and l.tenant_id = e.tenant_id
   where e.tenant_id = p_tenant_id and e.status = 'posted' and e.entry_date between v_first and v_last;

  begin
    select count(*)::int,
           (count(*) filter (where t.postable and not t.is_virtual
                               and (t.period_debit_cents <> 0 or t.period_credit_cents <> 0
                                    or t.opening_debit_cents <> t.opening_credit_cents)))::int
      into v_trial, v_ledger
      from public.acc_report_trial_balance(p_tenant_id, v_first, v_last, false) t;
  exception when undefined_function then
    v_trial := null;
    v_ledger := null;
  end;

  for r in
    select x.k, x.q
      from (values
        ('iva-compras', format('select r.total_rows from public.acc_report_iva_book(%L::uuid, %L, %L::date, null::jsonb, 1) r limit 1',
                               p_tenant_id, 'purchases', v_first)),
        ('iva-compras-alicuotas', format('select r.total_rows from public.acc_report_iva_aliquots(%L::uuid, %L, %L::date, null::jsonb, 1) r limit 1',
                                         p_tenant_id, 'purchases', v_first)),
        ('iva-ventas', format('select r.total_rows from public.acc_report_iva_book(%L::uuid, %L, %L::date, null::jsonb, 1) r limit 1',
                              p_tenant_id, 'sales', v_first)),
        ('iva-ventas-alicuotas', format('select r.total_rows from public.acc_report_iva_aliquots(%L::uuid, %L, %L::date, null::jsonb, 1) r limit 1',
                                        p_tenant_id, 'sales', v_first)),
        ('subdiario-compras', 'purchases'), ('subdiario-pagos', 'payments'), ('subdiario-ventas', 'sales'),
        ('subdiario-cobranzas', 'collections'), ('subdiario-disponibilidades', 'treasury'),
        ('saldos-proveedores', format('select count(*)::int from public.acc_report_party_balances(%L::uuid, %L::date, %L) b where b.debt_cents <> 0 or b.credit_cents <> 0',
                                      p_tenant_id, v_as_of, 'payables')),
        ('saldos-clientes', format('select count(*)::int from public.acc_report_party_balances(%L::uuid, %L::date, %L) b where b.debt_cents <> 0 or b.credit_cents <> 0',
                                   p_tenant_id, v_as_of, 'receivables'))
      ) as x(k, q)
  loop
    begin
      if r.k like 'subdiario-%' then
        execute format('select r.total_rows from public.acc_report_subledger(p_tenant_id => %L::uuid, p_kind => %L, '
                       || 'p_from => %L::date, p_to => %L::date, p_treasury_id => null::uuid, p_after => null::jsonb, '
                       || 'p_limit => 1) r limit 1', p_tenant_id, r.q, v_first, v_last)
          into v_n;
      else
        execute r.q into v_n;
      end if;
      v_counts := v_counts || jsonb_build_object(r.k, coalesce(v_n, 0));
    exception
      when undefined_function then
        v_counts := v_counts || jsonb_build_object(r.k, null);
      when raise_exception then
        if sqlerrm = 'invalid_report_param' then
          v_counts := v_counts || jsonb_build_object(r.k, null);
        else
          raise;
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'month', v_first,
    'from', v_first,
    'to', v_last,
    'as_of', v_as_of,
    'status', coalesce(v_period.status, 'missing'),
    'period_id', v_period.id,
    'closed_at', v_period.closed_at,
    'closed_by_name', v_period.closed_by_name,
    'number_from', v_period.number_from,
    'number_to', v_period.number_to,
    'sas_cuit_missing', v_cuit is null,
    'files', jsonb_build_array(
      jsonb_build_object('libro', 'diario', 'rows', v_entries, 'unit', 'asientos', 'lines', v_lines),
      jsonb_build_object('libro', 'mayor-general', 'rows', v_ledger, 'unit', 'cuentas'),
      jsonb_build_object('libro', 'sumas-y-saldos', 'rows', v_trial, 'unit', 'cuentas'),
      jsonb_build_object('libro', 'iva-compras', 'rows', v_counts -> 'iva-compras', 'unit', 'comprobantes'),
      jsonb_build_object('libro', 'iva-compras-alicuotas', 'rows', v_counts -> 'iva-compras-alicuotas', 'unit', 'filas'),
      jsonb_build_object('libro', 'iva-ventas', 'rows', v_counts -> 'iva-ventas', 'unit', 'comprobantes'),
      jsonb_build_object('libro', 'iva-ventas-alicuotas', 'rows', v_counts -> 'iva-ventas-alicuotas', 'unit', 'filas'),
      jsonb_build_object('libro', 'posicion-iva', 'rows', null, 'unit', null),
      jsonb_build_object('libro', 'subdiario-compras', 'rows', v_counts -> 'subdiario-compras', 'unit', 'filas'),
      jsonb_build_object('libro', 'subdiario-pagos', 'rows', v_counts -> 'subdiario-pagos', 'unit', 'filas'),
      jsonb_build_object('libro', 'subdiario-ventas', 'rows', v_counts -> 'subdiario-ventas', 'unit', 'filas'),
      jsonb_build_object('libro', 'subdiario-cobranzas', 'rows', v_counts -> 'subdiario-cobranzas', 'unit', 'filas'),
      jsonb_build_object('libro', 'subdiario-disponibilidades', 'rows', v_counts -> 'subdiario-disponibilidades', 'unit', 'filas'),
      jsonb_build_object('libro', 'saldos-proveedores', 'rows', v_counts -> 'saldos-proveedores', 'unit', 'proveedores'),
      jsonb_build_object('libro', 'saldos-clientes', 'rows', v_counts -> 'saldos-clientes', 'unit', 'clientes')));
end;
$$;

comment on function public.acc_report_sales_summary(uuid, date, date) is
  'Ventas sin factura (F.12): vendido, facturado neto, IVA débito y sin factura por mes y canal (cierres y ventas sueltas; las anulaciones restan en su mes). INVOKER.';
comment on function public.acc_report_journal_import(uuid, date, date, jsonb, integer) is
  'Asientos para importar (F.15): una fila por línea del diario con número, cuenta, Debe/Haber, leyenda, comprobante y CUIT; keyset {d, k, s, c, n}. INVOKER.';
comment on function public.acc_report_month_package(uuid, date) is
  'Paquete del mes (F.15): estado del mes y filas de cada archivo (las mismas lecturas que los exportes; null si la fase todavía no lo cuenta). INVOKER.';

revoke all on function public.acc_report_sales_summary(uuid, date, date) from public, anon;
grant execute on function public.acc_report_sales_summary(uuid, date, date) to authenticated;
revoke all on function public.acc_report_journal_import(uuid, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_journal_import(uuid, date, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_month_package(uuid, date) from public, anon;
grant execute on function public.acc_report_month_package(uuid, date) to authenticated;

notify pgrst, 'reload schema';
