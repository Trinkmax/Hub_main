-- Parte 2 de 2 de «Ventas: objetivo por día y ventas contra caja» (12/10/2026): el reporte de la proyección.
-- Una fila por día del rango (también los días sin nada), con lo que la pantalla necesita para armar la planilla
-- de los socios: objetivo y nota, lo vendido por canal, la comisión ESTIMADA de cada canal y lo que entró en caja.
--   · Lo vendido sale de los cierres del día vigentes de ese día (contabilizados, sin anular y sin un contra-
--     asiento vigente): cada renglón con medio de cobro va al canal de su medio. El faltante o sobrante de caja
--     se suma al canal del efectivo (lo vendido en efectivo es lo contado ± la diferencia), como en «Neto por
--     medio de cobro».
--   · La comisión es una estimación: importe del medio × commission_bp de su procesador, billetera o plataforma
--     (acc_parties, lo de Ajustes), redondeado al centavo por renglón. Un medio sin tasa cuenta 0.
--   · cash_counted_cents: Σ de acc_daily_cash_counts del día; null si ese día no se cargó nada.
-- Las cuentas derivadas (venta real, venta neta, cumplimiento, acumulados) se hacen en TypeScript
-- (lib/accounting/projection.ts). INVOKER: corre con la RLS de quien llama, como los demás acc_report_*.

create function public.acc_report_sales_projection(p_tenant_id uuid, p_from date, p_to date)
returns table (day date, target_cents bigint, note text, closes integer,
               salon_cents bigint, delivery_cents bigint, events_cents bigint,
               salon_commission_cents bigint, delivery_commission_cents bigint, events_commission_cents bigint,
               cash_counted_cents bigint)
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
  if p_to - p_from > 400 then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', 'p_to')::text;
  end if;
  return query
  with cl as (
    select d.id, d.accounting_date as dy
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted'
       and d.accounting_date between p_from and p_to
       and not exists (select 1 from public.acc_documents r
                        where r.tenant_id = p_tenant_id and r.reverses_document_id = d.id and r.status = 'posted')),
  ln as (
    select cl.dy, m.channel as ch, x.amount_cents as amt,
           round(x.amount_cents::numeric * coalesce(p.commission_bp, 0) / 10000)::bigint as fee
      from cl
      join public.acc_document_lines x on x.document_id = cl.id and x.tenant_id = p_tenant_id
      join public.acc_sales_methods m on m.id = x.sales_method_id and m.tenant_id = p_tenant_id
      left join public.acc_parties p on p.id = m.party_id and p.tenant_id = p_tenant_id
     where x.role in ('treasury', 'receivable', 'advance')
    union all
    -- Faltante (Debe) o sobrante (Haber) de caja: va al canal del medio en efectivo de ese cierre.
    select cl.dy,
           coalesce((select m.channel
                       from public.acc_document_lines t
                       join public.acc_treasury_accounts ta on ta.id = t.treasury_account_id and ta.tenant_id = p_tenant_id
                       join public.acc_sales_methods m on m.id = t.sales_method_id and m.tenant_id = p_tenant_id
                      where t.document_id = cl.id and t.tenant_id = p_tenant_id and t.role = 'treasury'
                        and ta.kind = 'cash'
                      order by t.line_no
                      limit 1), 'salon'),
           case when y.side = 'debit' then y.amount_cents else -y.amount_cents end,
           0::bigint
      from cl
      join public.acc_document_lines y on y.document_id = cl.id and y.tenant_id = p_tenant_id
     where y.role = 'cash_diff'),
  sa as (
    select ln.dy,
           coalesce(sum(ln.amt) filter (where ln.ch = 'salon'), 0)::bigint as salon,
           coalesce(sum(ln.amt) filter (where ln.ch = 'delivery'), 0)::bigint as delivery,
           coalesce(sum(ln.amt) filter (where ln.ch = 'events'), 0)::bigint as events,
           coalesce(sum(ln.fee) filter (where ln.ch = 'salon'), 0)::bigint as salon_fee,
           coalesce(sum(ln.fee) filter (where ln.ch = 'delivery'), 0)::bigint as delivery_fee,
           coalesce(sum(ln.fee) filter (where ln.ch = 'events'), 0)::bigint as events_fee
      from ln
     group by ln.dy),
  cn as (select cl.dy, count(*)::integer as n from cl group by cl.dy),
  cc as (
    select c.day as dy, sum(c.amount_cents)::bigint as amt
      from public.acc_daily_cash_counts c
     where c.tenant_id = p_tenant_id and c.day between p_from and p_to
     group by c.day)
  select g.dy, t.target_cents, t.note, coalesce(cn.n, 0),
         coalesce(sa.salon, 0)::bigint, coalesce(sa.delivery, 0)::bigint, coalesce(sa.events, 0)::bigint,
         coalesce(sa.salon_fee, 0)::bigint, coalesce(sa.delivery_fee, 0)::bigint, coalesce(sa.events_fee, 0)::bigint,
         cc.amt
    from (select s::date as dy from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') s) g
    left join public.acc_sales_targets t on t.tenant_id = p_tenant_id and t.day = g.dy
    left join sa on sa.dy = g.dy
    left join cn on cn.dy = g.dy
    left join cc on cc.dy = g.dy
   order by g.dy;
end;
$$;

comment on function public.acc_report_sales_projection(uuid, date, date) is
  'Proyección de ventas: una fila por día con objetivo, nota, cierres, vendido por canal (salón, delivery, eventos), comisión estimada por canal (medio × commission_bp) y lo que entró en caja. INVOKER.';

revoke all on function public.acc_report_sales_projection(uuid, date, date) from public, anon;
grant execute on function public.acc_report_sales_projection(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
