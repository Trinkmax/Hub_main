-- Parte 4 de 5 de la migración #13 (acc_sales_collections): reportes de ventas (§F.11, §F.12, §F.9). Cada
-- función trae sus propios revoke/grant. Las tres nuevas: plpgsql stable SECURITY INVOKER, acc_assert_reader
-- primero (§F.0), filtro explícito por p_tenant_id, solo comprobantes 'posted' y asientos vigentes.
--   · acc_report_net_by_method   neto real por medio de cobro (el pedido de Franco)
--   · acc_report_sales_summary   ventas sin factura por mes y canal (para la contadora)
--   · acc_report_cash_projection proyección de las próximas semanas

-- ─── 1. Neto real por medio de cobro (F.11) ───────────────────────────────────
-- Una fila por medio con ventas en los cierres del rango (o con descuentos atribuidos), en el orden del cierre:
--   sold_cents         Σ renglones del medio en los cierres del rango (caja, partida o seña); al efectivo se le
--                      suma la diferencia de caja (lo vendido, no lo contado).
--   commission_cents, commission_vat_cents, withholdings_cents (retenciones de IVA, IIBB y Ganancias, SIRCUPA
--                      y percepción de IVA de la comisión), other_charges_cents (otros cargos y redondeos),
--                      unexplained_cents (diferencias sin explicar; en el efectivo, el faltante − sobrante):
--                      salen de las cobranzas que imputaron partidas del medio (estado actual: imputaciones no
--                      desaplicadas de asientos vigentes). Una deducción con sales_method_id va directo a ese
--                      medio; una sin medio se prorratea por lo imputado por esa cobranza a cada partida (resto
--                      mayor: piso por partida y el resto a la de mayor importe, desempate por id).
--   credited_cents     acreditado neto = lo imputado por cobranzas − esas deducciones (en el efectivo, lo que
--                      entró a la caja).
--   pending_cents      lo que sigue abierto hoy de las partidas del medio.
--   discount_bp        (comisión + IVA + retenciones + otros) × 10000 / lo imputado por cobranzas (redondeo);
--                      0 en el efectivo; null si todavía no se acreditó nada.
-- E8 + E17: QR 22.000.000 → descuentos 1.169.300 (532 = 5,32 %), transferencias 18.000.000 → 630.000 (350),
-- 700 sin explicar (385 al QR y 315 a transferencias).
create or replace function public.acc_report_net_by_method(p_tenant_id uuid, p_from date, p_to date)
returns table (method_id uuid, method_name text, channel text, sold_cents bigint, commission_cents bigint,
               commission_vat_cents bigint, withholdings_cents bigint, other_charges_cents bigint,
               unexplained_cents bigint, credited_cents bigint, pending_cents bigint, discount_bp integer)
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
  with cl as (
    select d.id
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted'
       and d.accounting_date between p_from and p_to),
  fl as (
    select y.document_id, min(y.line_no) filter (where y.role = 'treasury') as first_tr,
           coalesce(sum(case when y.side = 'debit' then y.amount_cents else -y.amount_cents end)
                      filter (where y.role = 'cash_diff'), 0)::bigint as cash_diff
      from cl
      join public.acc_document_lines y on y.document_id = cl.id and y.tenant_id = p_tenant_id
     group by y.document_id),
  it as (
    select x.sales_method_id as mid, x.role, x.amount_cents as booked,
           x.amount_cents + case when x.role = 'treasury' and x.line_no = fl.first_tr then fl.cash_diff else 0 end as sold,
           jl.id as jline
      from cl
      join fl on fl.document_id = cl.id
      join public.acc_document_lines x on x.document_id = cl.id and x.tenant_id = p_tenant_id
      join public.acc_journal_lines jl on jl.document_line_id = x.id and jl.tenant_id = p_tenant_id
     where x.role in ('treasury', 'receivable', 'advance') and x.sales_method_id is not null),
  al as (
    select it.mid, it.jline, a.amount_cents as amt, l2.document_id as cdoc
      from it
      join public.acc_allocations a on a.debit_line_id = it.jline and a.tenant_id = p_tenant_id and a.voided_on is null
      join public.acc_journal_lines l2 on l2.id = a.credit_line_id
      join public.acc_journal_entries e2 on e2.id = l2.entry_id and e2.status = 'posted'
     where it.role <> 'treasury'),
  co as (
    select distinct al.cdoc
      from al
      join public.acc_documents c on c.id = al.cdoc and c.tenant_id = p_tenant_id and c.kind = 'collection'),
  ca as (
    select co.cdoc, a.debit_line_id as jline, sum(a.amount_cents)::bigint as amt
      from co
      join public.acc_journal_lines lc on lc.document_id = co.cdoc and lc.tenant_id = p_tenant_id and lc.side = 'credit'
      join public.acc_allocations a on a.credit_line_id = lc.id and a.tenant_id = p_tenant_id and a.voided_on is null
      join public.acc_journal_lines l1 on l1.id = a.debit_line_id
      join public.acc_journal_entries e1 on e1.id = l1.entry_id and e1.status = 'posted'
     group by co.cdoc, a.debit_line_id),
  de as (
    select x.document_id as cdoc, x.id as did, x.amount_cents as amt, x.sales_method_id as mid,
           case when x.role = 'write_off' or x.tax_kind = 'otro' then 'other'
                when x.tax_kind = 'comision' then 'commission'
                when x.tax_kind = 'iva_comision' then 'commission_vat'
                when x.tax_kind = 'diferencia' then 'unexplained'
                else 'withholdings' end as cat
      from co
      join public.acc_document_lines x on x.document_id = co.cdoc and x.tenant_id = p_tenant_id
     where x.role in ('deduction', 'write_off')),
  tt as (select ca.cdoc, sum(ca.amt) as total from ca group by ca.cdoc),
  sh as (
    select de.cat, ca.jline,
           floor(de.amt::numeric * ca.amt / tt.total)::bigint
             + case when row_number() over (partition by de.did order by ca.amt desc, ca.jline) = 1
                    then de.amt - sum(floor(de.amt::numeric * ca.amt / tt.total)::bigint) over (partition by de.did)
                    else 0 end as amt
      from de
      join ca on ca.cdoc = de.cdoc
      join tt on tt.cdoc = de.cdoc
     where de.mid is null and tt.total > 0),
  att as (
    select it.mid, sh.cat, sum(sh.amt)::bigint as amt
      from sh join it on it.jline = sh.jline
     group by it.mid, sh.cat
    union all
    select de.mid, de.cat, sum(de.amt)::bigint
      from de
     where de.mid is not null
     group by de.mid, de.cat),
  ag as (
    select att.mid,
           coalesce(sum(att.amt) filter (where att.cat = 'commission'), 0)::bigint as comm,
           coalesce(sum(att.amt) filter (where att.cat = 'commission_vat'), 0)::bigint as cvat,
           coalesce(sum(att.amt) filter (where att.cat = 'withholdings'), 0)::bigint as wh,
           coalesce(sum(att.amt) filter (where att.cat = 'other'), 0)::bigint as oth,
           coalesce(sum(att.amt) filter (where att.cat = 'unexplained'), 0)::bigint as unx
      from att
     group by att.mid),
  so as (
    select it.mid, sum(it.sold)::bigint as sold,
           coalesce(sum(it.booked) filter (where it.role = 'treasury'), 0)::bigint as cash_in,
           coalesce(sum(it.sold - it.booked) filter (where it.role = 'treasury'), 0)::bigint as cash_diff
      from it
     group by it.mid),
  cr as (
    select al.mid, sum(al.amt)::bigint as gross
      from al join co on co.cdoc = al.cdoc
     group by al.mid),
  pe as (
    select it.mid,
           sum(greatest(it.booked - coalesce((select sum(a.amount_cents)
                                                from public.acc_allocations a
                                                join public.acc_journal_lines l2 on l2.id = a.credit_line_id
                                                join public.acc_journal_entries e2 on e2.id = l2.entry_id and e2.status = 'posted'
                                               where a.debit_line_id = it.jline and a.tenant_id = p_tenant_id
                                                 and a.voided_on is null), 0), 0))::bigint as pending
      from it
     where it.role <> 'treasury'
     group by it.mid)
  select m.id, m.name, m.channel,
         coalesce(so.sold, 0)::bigint,
         coalesce(ag.comm, 0)::bigint, coalesce(ag.cvat, 0)::bigint, coalesce(ag.wh, 0)::bigint, coalesce(ag.oth, 0)::bigint,
         (coalesce(ag.unx, 0) + coalesce(so.cash_diff, 0))::bigint,
         (coalesce(so.cash_in, 0) + coalesce(cr.gross, 0) - coalesce(ag.comm, 0) - coalesce(ag.cvat, 0)
          - coalesce(ag.wh, 0) - coalesce(ag.oth, 0) - coalesce(ag.unx, 0))::bigint,
         coalesce(pe.pending, 0)::bigint,
         case when coalesce(cr.gross, 0) > 0
                then round((coalesce(ag.comm, 0) + coalesce(ag.cvat, 0) + coalesce(ag.wh, 0) + coalesce(ag.oth, 0))
                           * 10000.0 / cr.gross)::integer
              when m.kind = 'treasury' and coalesce(so.sold, 0) <> 0 then 0 end
    from (select so.mid from so union select ag.mid from ag) k
    join public.acc_sales_methods m on m.id = k.mid and m.tenant_id = p_tenant_id
    left join so on so.mid = k.mid
    left join cr on cr.mid = k.mid
    left join ag on ag.mid = k.mid
    left join pe on pe.mid = k.mid
   order by m.sort, m.name;
end;
$$;

-- ─── 2. Ventas sin factura por mes y canal (F.12) ─────────────────────────────
-- De los cierres del día y las ventas sueltas del rango (una anulación con fecha de hoy, con el signo del
-- original invertido, en el mes de la anulación): facturado neto = Σ con signo de ventas facturadas del canal;
-- IVA débito = Σ con signo del IVA de las filas del libro de ventas del canal; sin factura = Σ con signo de
-- ventas sin factura; vendido = la suma de los tres. Las ventas sin factura no generan IVA débito: el
-- tratamiento lo define la contadora (uninvoiced_sales_mode). Orden: mes, canal (salón, delivery, eventos).
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
  with dd as (
    select date_trunc('month', d.accounting_date::timestamp)::date as mo, coalesce(o.id, d.id) as src_id,
           case when o.id is null then 1 else -1 end as rv
      from public.acc_documents d
      left join public.acc_documents o on d.kind = 'reversal' and o.id = d.reverses_document_id and o.tenant_id = d.tenant_id
     where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between p_from and p_to
       and coalesce(o.kind, d.kind) in ('sales_close', 'sales_invoice', 'sales_debit_note', 'sales_credit_note')),
  x as (
    select dd.mo, l.channel as ch, l.role as part,
           dd.rv * (case when l.side = 'credit' then l.amount_cents else -l.amount_cents end) as amt
      from dd
      join public.acc_document_lines l on l.document_id = dd.src_id and l.tenant_id = p_tenant_id
     where l.role in ('sales_invoiced', 'sales_uninvoiced')
    union all
    select dd.mo, fv.channel, 'vat',
           dd.rv * (case when fv.is_credit_note then -1 else 1 end)
             * (fv.vat_25_cents + fv.vat_5_cents + fv.vat_105_cents + fv.vat_21_cents + fv.vat_27_cents)
      from dd
      join public.acc_fiscal_vouchers fv on fv.document_id = dd.src_id and fv.tenant_id = p_tenant_id
     where fv.book = 'sales' and not fv.is_reversal)
  select x.mo, x.ch, sum(x.amt)::bigint,
         coalesce(sum(x.amt) filter (where x.part = 'sales_invoiced'), 0)::bigint,
         coalesce(sum(x.amt) filter (where x.part = 'vat'), 0)::bigint,
         coalesce(sum(x.amt) filter (where x.part = 'sales_uninvoiced'), 0)::bigint
    from x
   where x.ch is not null
   group by x.mo, x.ch
   order by x.mo, array_position(array['salon', 'delivery', 'events'], x.ch);
end;
$$;

-- ─── 3. Proyección de caja de las próximas semanas (F.9) ─────────────────────
-- p_as_of null = hoy; p_weeks 1..12 (null = 4). Semana 0: de p_as_of al domingo; después, de lunes a domingo
-- (week_start = p_as_of y después cada lunes). Saldo inicial = cajas, bancos y billeteras al p_as_of (sin la
-- tarjeta de la empresa). Entra: partidas abiertas hoy de cobrables (lado Debe) por vencimiento. Sale: partidas
-- abiertas hoy de pagables (lado Haber) por vencimiento + gastos fijos activos de monto conocido en cada
-- vencimiento (según su frecuencia). Lo vencido va a la semana 0; lo que no tiene vencimiento no se proyecta;
-- el IVA a documentar no es plata. projected_balance_cents = saldo inicial + Σ (entra − sale) acumulado.
create or replace function public.acc_report_cash_projection(p_tenant_id uuid, p_as_of date, p_weeks integer default 4)
returns table (week_start date, expected_in_cents bigint, expected_out_cents bigint, projected_balance_cents bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_as_of date;
  v_weeks integer;
  v_end date;
  v_start bigint;
begin
  perform public.acc_assert_reader(p_tenant_id);
  v_as_of := coalesce(p_as_of, public.acc_today(p_tenant_id));
  v_weeks := least(greatest(coalesce(p_weeks, 4), 1), 12);
  v_end := (date_trunc('week', v_as_of::timestamp) + make_interval(weeks => v_weeks))::date - 1;
  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end), 0)::bigint
    into v_start
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id
    join public.acc_treasury_accounts t on t.account_id = l.account_id and t.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id and l.entry_date <= v_as_of and e.status = 'posted' and not e.is_mirror
     and t.kind <> 'credit_card';
  return query
  with wk as (
    select g.i,
           case when g.i = 0 then v_as_of
                else (date_trunc('week', v_as_of::timestamp) + make_interval(weeks => g.i))::date end as ws,
           (date_trunc('week', v_as_of::timestamp) + make_interval(weeks => g.i + 1))::date - 1 as we
      from generate_series(0, v_weeks - 1) as g(i)),
  op as (
    select greatest(l.due_date, v_as_of) as dt,
           case when p.kind in ('customer', 'card_processor', 'payment_wallet', 'delivery_platform') then 1 else -1 end as dir,
           l.amount_cents - coalesce((select sum(a.amount_cents)
                                        from public.acc_allocations a
                                       where (a.debit_line_id = l.id or a.credit_line_id = l.id)
                                         and a.tenant_id = p_tenant_id and a.voided_on is null), 0) as open_cents
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
      join public.acc_parties p on p.id = l.party_id and p.tenant_id = l.tenant_id
      join public.acc_accounts ac on ac.id = l.account_id and ac.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id and l.party_id is not null and l.due_date is not null and l.due_date <= v_end
       and l.entry_date <= v_as_of and e.status = 'posted' and not e.is_mirror
       and ac.system_key is distinct from 'vat_credit_pending'
       and l.side = (case when p.kind in ('customer', 'card_processor', 'payment_wallet', 'delivery_platform')
                          then 'debit' else 'credit' end)::public.acc_side),
  rx as (
    select greatest((r.next_due_date + make_interval(months => n.k * case r.frequency when 'monthly' then 1
                                                                                     when 'bimonthly' then 2
                                                                                     when 'quarterly' then 3
                                                                                     else 12 end))::date,
                    v_as_of) as dt,
           -1 as dir, r.amount_cents as open_cents
      from public.acc_recurring_expenses r
      cross join generate_series(0, 12) as n(k)
     where r.tenant_id = p_tenant_id and r.active and r.amount_cents is not null
       and (r.next_due_date + make_interval(months => n.k * case r.frequency when 'monthly' then 1
                                                                            when 'bimonthly' then 2
                                                                            when 'quarterly' then 3
                                                                            else 12 end))::date <= v_end),
  ev as (
    select op.dt, op.dir, op.open_cents from op where op.open_cents > 0
    union all
    select rx.dt, rx.dir, rx.open_cents from rx),
  ag as (
    select wk.i, wk.ws,
           coalesce(sum(ev.open_cents) filter (where ev.dir = 1), 0)::bigint as inn,
           coalesce(sum(ev.open_cents) filter (where ev.dir = -1), 0)::bigint as outt
      from wk
      left join ev on ev.dt between wk.ws and wk.we
     group by wk.i, wk.ws)
  select ag.ws, ag.inn, ag.outt, (v_start + sum(ag.inn - ag.outt) over (order by ag.i))::bigint
    from ag
   order by ag.i;
end;
$$;

comment on function public.acc_report_net_by_method(uuid, date, date) is
  'Neto real por medio de cobro (F.11): vendido, comisiones, IVA, retenciones, otros, sin explicar, acreditado, pendiente y descuento %. INVOKER.';
comment on function public.acc_report_sales_summary(uuid, date, date) is
  'Ventas sin factura por mes y canal (F.12): vendido, facturado neto, IVA débito y sin factura. INVOKER.';
comment on function public.acc_report_cash_projection(uuid, date, integer) is
  'Proyección de caja (F.9): por semana, lo que entra de cobrables, lo que sale a pagables y gastos fijos, y el saldo proyectado. INVOKER.';

revoke all on function public.acc_report_net_by_method(uuid, date, date) from public, anon;
grant execute on function public.acc_report_net_by_method(uuid, date, date) to authenticated;
revoke all on function public.acc_report_sales_summary(uuid, date, date) from public, anon;
grant execute on function public.acc_report_sales_summary(uuid, date, date) to authenticated;
revoke all on function public.acc_report_cash_projection(uuid, date, integer) from public, anon;
grant execute on function public.acc_report_cash_projection(uuid, date, integer) to authenticated;
