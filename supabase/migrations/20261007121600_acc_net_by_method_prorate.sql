-- Migración #17 (acc_net_by_method_prorate): arreglo del «Neto real por medio de cobro» (§F.11, #13 parte 4).
-- El problema: una deducción con medio (la comisión, el IVA y el SIRCUPA del ajuste de saldo de Mercado Pago, que
-- se cargan por medio) se le sumaba ENTERA a ese medio, aunque la cobranza imputara también partidas de fuera del
-- rango. Con acreditaciones semanales que cruzan el fin de mes, septiembre mostraba el QR con 6,22 % de descuento en
-- lugar del 5,32 % real (le tocaba la comisión de las ventas de octubre de esa misma acreditación).
-- El arreglo: la deducción con medio se reparte entre las partidas DE ESE MEDIO que imputó la cobranza (resto
-- mayor, como las deducciones sin medio) y cuenta solo la parte de las partidas del rango. Si la cobranza no imputó
-- ninguna partida de ese medio, va entera al medio, como antes. Misma firma y mismas columnas: create or replace.
-- Con todo dentro del rango da lo mismo que antes (E8 + E17: QR 532, transferencias 350).

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
  -- Lo que imputó cada cobranza a cada partida (de cualquier fecha), con el medio de la partida.
  ca as (
    select co.cdoc, a.debit_line_id as jline, dl1.sales_method_id as mid, sum(a.amount_cents)::bigint as amt
      from co
      join public.acc_journal_lines lc on lc.document_id = co.cdoc and lc.tenant_id = p_tenant_id and lc.side = 'credit'
      join public.acc_allocations a on a.credit_line_id = lc.id and a.tenant_id = p_tenant_id and a.voided_on is null
      join public.acc_journal_lines l1 on l1.id = a.debit_line_id
      join public.acc_journal_entries e1 on e1.id = l1.entry_id and e1.status = 'posted'
      left join public.acc_document_lines dl1 on dl1.id = l1.document_line_id
     group by co.cdoc, a.debit_line_id, dl1.sales_method_id),
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
  tm as (select ca.cdoc, ca.mid, sum(ca.amt) as total from ca where ca.mid is not null group by ca.cdoc, ca.mid),
  -- Reparto de cada deducción entre las partidas que imputó su cobranza (resto mayor: piso por partida y el resto a
  -- la de mayor importe, desempate por id): sin medio, entre todas; con medio, entre las de ese medio.
  sh as (
    select de.cat, ca.jline,
           floor(de.amt::numeric * ca.amt / tt.total)::bigint
             + case when row_number() over (partition by de.did order by ca.amt desc, ca.jline) = 1
                    then de.amt - sum(floor(de.amt::numeric * ca.amt / tt.total)::bigint) over (partition by de.did)
                    else 0 end as amt
      from de
      join ca on ca.cdoc = de.cdoc
      join tt on tt.cdoc = de.cdoc
     where de.mid is null and tt.total > 0
    union all
    select de.cat, ca.jline,
           floor(de.amt::numeric * ca.amt / tm.total)::bigint
             + case when row_number() over (partition by de.did order by ca.amt desc, ca.jline) = 1
                    then de.amt - sum(floor(de.amt::numeric * ca.amt / tm.total)::bigint) over (partition by de.did)
                    else 0 end
      from de
      join ca on ca.cdoc = de.cdoc and ca.mid = de.mid
      join tm on tm.cdoc = de.cdoc and tm.mid = de.mid
     where de.mid is not null and tm.total > 0),
  att as (
    select it.mid, sh.cat, sum(sh.amt)::bigint as amt
      from sh join it on it.jline = sh.jline
     group by it.mid, sh.cat
    union all
    -- Una deducción con medio en una cobranza que no imputó ninguna partida de ese medio: entera al medio.
    select de.mid, de.cat, sum(de.amt)::bigint
      from de
     where de.mid is not null
       and not exists (select 1 from tm where tm.cdoc = de.cdoc and tm.mid = de.mid and tm.total > 0)
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

comment on function public.acc_report_net_by_method(uuid, date, date) is
  'Neto real por medio de cobro (F.11): vendido, comisiones, IVA, retenciones, otros, sin explicar, acreditado, pendiente y descuento %. Las deducciones se reparten entre las partidas que imputó la cobranza (las de su medio, si lo tienen) y cuenta la parte del rango. INVOKER.';

revoke all on function public.acc_report_net_by_method(uuid, date, date) from public, anon;
grant execute on function public.acc_report_net_by_method(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
