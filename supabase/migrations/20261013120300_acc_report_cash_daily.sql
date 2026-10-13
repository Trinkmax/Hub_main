-- Reunión con los socios del 12/10/2026 · «Gráfico del flujo de caja»: cómo se movió la plata de las cajas
-- día por día (Cajas y bancos › Saldos › «Cómo se movió la plata»). Solo una función de lectura: no crea
-- tablas ni toca datos.
-- ============================================================
-- acc_report_cash_daily(p_tenant_id, p_from, p_to)
-- ============================================================
-- Una fila por caja o cuenta y, primero, una fila con treasury_id null: todas las cajas juntas.
--   opening_cents · saldo al cierre del día anterior a p_from
--   closing_cents · saldo al cierre de p_to
--   days          · [{day, in_cents, out_cents, balance_cents}] en orden, SOLO los días con movimiento
--                   (los demás arrastran el saldo del anterior: los completa la pantalla). balance_cents es
--                   el saldo al cierre de ese día.
-- Los días van adentro de la fila de su caja (y no una fila por día y caja) para que la respuesta nunca
-- pase el tope de filas de la API: un año con tres cajas ya serían más de 1.000 filas.
--
-- Mismas reglas que acc_report_treasury_balances y el subdiario de disponibilidades (#11):
--   · saldo = Debe − Haber de la cuenta de la caja; entró = Debe, salió = Haber. En la tarjeta de la empresa
--     (pasivo) la deuda sale negativa: la pantalla la da vuelta y la dice como deuda.
--   · solo asientos vigentes (status = 'posted': los anulados no cuentan) y sin los espejos de cierre y
--     apertura de ejercicio (is_mirror).
--   · cajas activas, o inactivas con saldo o movimientos en el rango.
-- La fila de todas las cajas (treasury_id null) suma las cajas de activo, sin las tarjetas de la empresa
-- (como «Plata disponible» y el flujo de caja). Ahí mover plata entre cajas no es entrada ni salida: cada
-- asiento cuenta por su neto entre las cajas de activo (pagar la tarjeta desde el banco sí es una salida).
-- Así el saldo de cada día sigue siendo el del día anterior + lo que entró − lo que salió.
--
-- Definer de solo lectura: acc_assert_reader primero y filtro explícito por p_tenant_id en cada tabla.
-- Hasta 366 días por llamada.
create function public.acc_report_cash_daily(p_tenant_id uuid, p_from date, p_to date)
returns table (treasury_id uuid, name text, kind text, active boolean, opening_cents bigint,
               closing_cents bigint, days jsonb)
language plpgsql
stable
security definer
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
  if p_to - p_from > 365 then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_to"}';
  end if;
  return query
  with tl as (
    -- Las líneas de las cuentas de caja hasta p_to, de asientos vigentes y sin espejos.
    select t.id as tid, t.kind as tkind, l.entry_id, l.entry_date, l.side, l.amount_cents
      from public.acc_treasury_accounts t
      join public.acc_journal_lines l
        on l.tenant_id = p_tenant_id and l.account_id = t.account_id and l.entry_date <= p_to
      join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = p_tenant_id
     where t.tenant_id = p_tenant_id and e.status = 'posted' and not e.is_mirror
  ), op as (
    -- Saldo anterior de cada caja.
    select tl.tid, sum(case when tl.side = 'debit' then tl.amount_cents else -tl.amount_cents end)::bigint as cents
      from tl
     where tl.entry_date < p_from
     group by tl.tid
  ), dm as (
    -- Lo que entró y salió de cada caja, por día.
    select tl.tid, tl.entry_date as d,
           coalesce(sum(tl.amount_cents) filter (where tl.side = 'debit'), 0)::bigint as din,
           coalesce(sum(tl.amount_cents) filter (where tl.side = 'credit'), 0)::bigint as dout
      from tl
     where tl.entry_date >= p_from
     group by tl.tid, tl.entry_date
  ), dr as (
    select dm.tid, dm.d, dm.din, dm.dout,
           (coalesce(op.cents, 0)
            + sum(dm.din - dm.dout) over (partition by dm.tid order by dm.d))::bigint as bal
      from dm
      left join op on op.tid = dm.tid
  ), da as (
    select dr.tid, sum(dr.din - dr.dout)::bigint as net,
           jsonb_agg(jsonb_build_object('day', dr.d, 'in_cents', dr.din, 'out_cents', dr.dout,
                                        'balance_cents', dr.bal) order by dr.d) as days
      from dr
     group by dr.tid
  ), te as (
    -- Todas las cajas de activo: el neto de cada asiento (mover plata entre cajas da cero y no cuenta).
    select tl.entry_date as d,
           sum(case when tl.side = 'debit' then tl.amount_cents else -tl.amount_cents end)::bigint as net
      from tl
     where tl.tkind <> 'credit_card' and tl.entry_date >= p_from
     group by tl.entry_id, tl.entry_date
  ), tm as (
    select te.d,
           coalesce(sum(te.net) filter (where te.net > 0), 0)::bigint as din,
           coalesce(-sum(te.net) filter (where te.net < 0), 0)::bigint as dout
      from te
     where te.net <> 0
     group by te.d
  ), tot as (
    select coalesce(sum(op.cents), 0)::bigint as cents
      from op
      join public.acc_treasury_accounts t on t.id = op.tid and t.tenant_id = p_tenant_id
     where t.kind <> 'credit_card'
  ), tr as (
    select tm.d, tm.din, tm.dout,
           ((select tot.cents from tot) + sum(tm.din - tm.dout) over (order by tm.d))::bigint as bal
      from tm
  ), res as (
    select 0 as grp, null::uuid as treasury_id, null::text as name, null::text as kind, true as active,
           0::smallint as sort,
           (select tot.cents from tot) as opening_cents,
           ((select tot.cents from tot) + coalesce((select sum(tr.din - tr.dout) from tr), 0))::bigint as closing_cents,
           coalesce((select jsonb_agg(jsonb_build_object('day', tr.d, 'in_cents', tr.din, 'out_cents', tr.dout,
                                                         'balance_cents', tr.bal) order by tr.d)
                       from tr), '[]'::jsonb) as days
    union all
    select 1, t.id, t.name, t.kind, t.active, t.sort,
           coalesce(op.cents, 0)::bigint,
           (coalesce(op.cents, 0) + coalesce(da.net, 0))::bigint,
           coalesce(da.days, '[]'::jsonb)
      from public.acc_treasury_accounts t
      left join op on op.tid = t.id
      left join da on da.tid = t.id
     where t.tenant_id = p_tenant_id
       and (t.active or coalesce(op.cents, 0) <> 0 or da.tid is not null)
  )
  select res.treasury_id, res.name, res.kind, res.active, res.opening_cents, res.closing_cents, res.days
    from res
   order by res.grp, res.sort, res.name;
end;
$$;

comment on function public.acc_report_cash_daily(uuid, date, date) is
  'Cajas y bancos, día por día: por caja (y treasury_id null = todas las de activo, sin mover plata entre cajas) el saldo anterior, el del cierre y los días con movimiento [{day, in_cents, out_cents, balance_cents}]. Hasta 366 días. Definer de solo lectura: acc_assert_reader y filtro por bar.';

revoke all on function public.acc_report_cash_daily(uuid, date, date) from public, anon;
grant execute on function public.acc_report_cash_daily(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
