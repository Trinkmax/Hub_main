-- Parte 3 (grupo 12b, statements) de la migración #12 (acc_purchases_payments). Partida en varias solo
-- para que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke/grant.
-- Estados de cuenta, antigüedad y semáforo (§F.7):
--   · acc_report_open_items       partidas abiertas de un partícipe («Pagar», «Cobrar», contexto del motor)
--   · acc_report_party_balances   saldos con antigüedad y semáforo de todos los proveedores o cobrables
--   (el estado de cuenta, acc_report_party_statement, va en la parte 4 con las mismas reglas)
-- Convenciones §F.0: plpgsql stable SECURITY INVOKER, acc_assert_reader primero, todo agregado en SQL,
-- solo asientos 'posted' y no espejo. Usa acc_doc_label (parte 2). No necesita nada de la #10 ni de la #11.
--
-- Reglas comunes (espejo de lib/accounting/aging.ts):
--   · Grupo por tipo de partícipe: cobrables = customer, card_processor, payment_wallet, delivery_platform;
--     pagables = el resto (supplier, tax_agency, payroll, partner, bank, other). Lado deuda: Haber en
--     pagables, Debe en cobrables; el lado contrario es «a favor» (NC, anticipos, pagos a cuenta).
--   · Sin cuenta pedida se suman todas las cuentas de control del partícipe salvo vat_credit_pending (el IVA a
--     documentar va aparte); con p_account_id, solo esa (también vat_credit_pending).
--   · Abierto al día X = importe − imputaciones con applied_on ≤ X y (voided_on nulo o > X) cuyas dos partidas
--     son de asientos vigentes (así un pago anulado después de X no deja la factura «pagada» al día X).
--   · Tramos con S = acc_settings.due_soon_days: no_due · not_due (vence > X + S) · due_soon (X ≤ vence ≤ X + S)
--     · overdue_1_30 · overdue_31_60 · overdue_60_plus.

-- ─── 1. Partidas abiertas de un partícipe ────────────────────────────────────
-- p_as_of null = el estado actual (todas las fechas e imputaciones no desaplicadas: lo mismo que
-- acc_open_amount(línea) y el trigger de imputaciones); con fecha = «al día X». Tramo y días contra
-- p_as_of (o hoy de Córdoba). p_side: 'debt' | 'credit' | null (los dos; la columna side dice cuál es).
-- days_overdue = X − vencimiento (negativo: faltan días; null sin vencimiento). Orden: vencimiento
-- (sin vencimiento al final), fecha y carga. Solo partidas con abierto > 0.
create or replace function public.acc_report_open_items(
  p_tenant_id uuid,
  p_party_id uuid,
  p_as_of date,
  p_side text,
  p_account_id uuid default null)
returns table (
  line_id uuid, document_id uuid, document_label text, account_id uuid, sales_method_id uuid,
  entry_date date, due_date date, amount_cents bigint, open_cents bigint, days_overdue integer, bucket text,
  side public.acc_side, document_seq bigint, document_kind text, account_code text, account_name text, memo text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_kind text;
  v_debt public.acc_side;
  v_want public.acc_side;
  v_ref date;
  v_soon integer;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_side is not null and p_side not in ('debt', 'credit') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_side"}';
  end if;
  select pt.kind into v_kind from public.acc_parties pt where pt.id = p_party_id and pt.tenant_id = p_tenant_id;
  if v_kind is null then
    raise exception 'party_not_found' using errcode = 'P0001';
  end if;
  v_debt := case when v_kind in ('customer', 'card_processor', 'payment_wallet', 'delivery_platform')
                 then 'debit' else 'credit' end::public.acc_side;
  v_want := case p_side
              when 'debt' then v_debt
              when 'credit' then case v_debt when 'debit' then 'credit' else 'debit' end::public.acc_side
            end;
  v_ref := coalesce(p_as_of, public.acc_today(p_tenant_id));
  select s.due_soon_days into v_soon from public.acc_settings s where s.tenant_id = p_tenant_id;
  v_soon := coalesce(v_soon, 7);

  return query
  with li as (
    select l.id, l.document_id, l.document_line_id, l.account_id, l.side, l.amount_cents, l.due_date,
           l.entry_date, l.line_no, l.memo, e.order_key, e.posting_seq
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
      join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id and l.party_id = p_party_id
       and e.status = 'posted' and not e.is_mirror
       and (p_as_of is null or l.entry_date <= p_as_of)
       and (v_want is null or l.side = v_want)
       and (case when p_account_id is null then a.system_key is distinct from 'vat_credit_pending'
                 else l.account_id = p_account_id end)),
  ar as (
    select a.debit_line_id, a.credit_line_id, a.amount_cents
      from public.acc_allocations a
      join public.acc_journal_lines dl on dl.id = a.debit_line_id
      join public.acc_journal_entries de on de.id = dl.entry_id and de.status = 'posted'
      join public.acc_journal_lines cl on cl.id = a.credit_line_id
      join public.acc_journal_entries ce on ce.id = cl.entry_id and ce.status = 'posted'
     where a.tenant_id = p_tenant_id and a.party_id = p_party_id
       and (case when p_as_of is null then a.voided_on is null
                 else a.applied_on <= p_as_of and (a.voided_on is null or a.voided_on > p_as_of) end)),
  al as (
    select x.line_id, sum(x.amount_cents)::bigint as applied
      from (select ar.debit_line_id as line_id, ar.amount_cents from ar
            union all
            select ar.credit_line_id, ar.amount_cents from ar) x
     group by x.line_id)
  select li.id,
         li.document_id,
         case when d.kind = 'opening' then 'Saldo inicial' || coalesce(' · ' || nullif(btrim(dl.reference), ''), '')
              else public.acc_doc_label(d.kind, d.voucher_type, d.point_of_sale, d.number) end,
         li.account_id,
         dl.sales_method_id,
         li.entry_date,
         li.due_date,
         li.amount_cents,
         (li.amount_cents - coalesce(al.applied, 0))::bigint,
         (v_ref - li.due_date)::integer,
         case when li.due_date is null then 'no_due'
              when li.due_date >= v_ref then case when li.due_date - v_ref <= v_soon then 'due_soon' else 'not_due' end
              when v_ref - li.due_date <= 30 then 'overdue_1_30'
              when v_ref - li.due_date <= 60 then 'overdue_31_60'
              else 'overdue_60_plus' end,
         li.side,
         d.seq,
         d.kind,
         ac.code,
         ac.name,
         li.memo
    from li
    left join al on al.line_id = li.id
    join public.acc_documents d on d.id = li.document_id and d.tenant_id = p_tenant_id
    join public.acc_document_lines dl on dl.id = li.document_line_id and dl.tenant_id = p_tenant_id
    join public.acc_accounts ac on ac.id = li.account_id and ac.tenant_id = p_tenant_id
   where li.amount_cents - coalesce(al.applied, 0) > 0
   order by li.due_date nulls last, li.entry_date, li.order_key, li.posting_seq, li.line_no;
end;
$$;

-- ─── 2. Saldos con antigüedad y semáforo (proveedores o cobrables) ───────────
-- p_as_of null = hoy de Córdoba. p_group: 'payables' | 'receivables'. Una fila por partícipe del grupo que
-- esté activo o tenga algo abierto. Deuda/a favor/tramos = Σ abierto > 0; net = deuda − a favor.
-- Semáforo (trafficLight de aging.ts): red si lo vencido supera lo a favor («Vencida hace N días» /
-- «<Nombre> está atrasada N días», la más vieja); yellow si lo vencido queda cubierto («Tenés|Hay $ X a
-- favor sin aplicar») o si algo vence en S días («Vence hoy|en N días» / «Se acredita hoy|en N días»);
-- green «Al día»; none «Sin deuda» (+ « · A favor $ X»). Plata como moneyShort: «$ 1.240.000» o
-- «$ 1.240,50» (con espacio duro). Extras (al final): trade_name, active, system_key, overdue_cents
-- (Σ de los tres tramos vencidos) y last_increase_date (última partida del lado deuda: «Última compra»).
create or replace function public.acc_report_party_balances(p_tenant_id uuid, p_as_of date, p_group text)
returns table (
  party_id uuid, party_name text, party_kind text, tax_id text,
  debt_cents bigint, credit_cents bigint, net_cents bigint,
  not_due_cents bigint, due_soon_cents bigint, overdue_1_30_cents bigint,
  overdue_31_60_cents bigint, overdue_60_plus_cents bigint, no_due_cents bigint,
  oldest_due_date date, next_due_date date, traffic_light text, traffic_text text,
  trade_name text, active boolean, system_key text, overdue_cents bigint, last_increase_date date)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_as_of date;
  v_soon integer;
  v_recv boolean;
  v_debt public.acc_side;
  v_kinds text[];
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_group is null or p_group not in ('payables', 'receivables') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_group"}';
  end if;
  v_recv := p_group = 'receivables';
  v_kinds := case when v_recv then array['customer', 'card_processor', 'payment_wallet', 'delivery_platform']
                  else array['supplier', 'tax_agency', 'payroll', 'partner', 'bank', 'other'] end;
  v_debt := case when v_recv then 'debit' else 'credit' end::public.acc_side;
  v_as_of := coalesce(p_as_of, public.acc_today(p_tenant_id));
  select s.due_soon_days into v_soon from public.acc_settings s where s.tenant_id = p_tenant_id;
  v_soon := coalesce(v_soon, 7);

  return query
  with pt as (
    select p.id, p.name, p.trade_name, p.kind, p.tax_id, p.active, p.system_key,
           coalesce(nullif(btrim(p.trade_name), ''), p.name) as display
      from public.acc_parties p
     where p.tenant_id = p_tenant_id and p.kind = any (v_kinds)),
  li as (
    select l.id, l.party_id, l.side, l.amount_cents, l.due_date, l.entry_date
      from public.acc_journal_lines l
      join pt on pt.id = l.party_id
      join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
      join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id and l.entry_date <= v_as_of
       and e.status = 'posted' and not e.is_mirror
       and a.system_key is distinct from 'vat_credit_pending'),
  ar as (
    select a.debit_line_id, a.credit_line_id, a.amount_cents
      from public.acc_allocations a
      join pt on pt.id = a.party_id
      join public.acc_journal_lines dl on dl.id = a.debit_line_id
      join public.acc_journal_entries de on de.id = dl.entry_id and de.status = 'posted'
      join public.acc_journal_lines cl on cl.id = a.credit_line_id
      join public.acc_journal_entries ce on ce.id = cl.entry_id and ce.status = 'posted'
     where a.tenant_id = p_tenant_id and a.applied_on <= v_as_of
       and (a.voided_on is null or a.voided_on > v_as_of)),
  al as (
    select x.line_id, sum(x.amount_cents)::bigint as applied
      from (select ar.debit_line_id as line_id, ar.amount_cents from ar
            union all
            select ar.credit_line_id, ar.amount_cents from ar) x
     group by x.line_id),
  it as (
    select li.party_id, li.side, li.due_date, li.entry_date,
           li.amount_cents - coalesce(al.applied, 0) as open_cents,
           case when li.due_date is null then 'no_due'
                when li.due_date >= v_as_of then
                  case when li.due_date - v_as_of <= v_soon then 'due_soon' else 'not_due' end
                when v_as_of - li.due_date <= 30 then 'overdue_1_30'
                when v_as_of - li.due_date <= 60 then 'overdue_31_60'
                else 'overdue_60_plus' end as tramo
      from li
      left join al on al.line_id = li.id),
  g as (
    select it.party_id,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0), 0)::bigint as debt,
           coalesce(sum(it.open_cents) filter (where it.side <> v_debt and it.open_cents > 0), 0)::bigint as credit,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'not_due'), 0)::bigint as t_not_due,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'due_soon'), 0)::bigint as t_due_soon,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'overdue_1_30'), 0)::bigint as t_o30,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'overdue_31_60'), 0)::bigint as t_o60,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'overdue_60_plus'), 0)::bigint as t_o60p,
           coalesce(sum(it.open_cents) filter (where it.side = v_debt and it.open_cents > 0 and it.tramo = 'no_due'), 0)::bigint as t_no_due,
           min(it.due_date) filter (where it.side = v_debt and it.open_cents > 0 and it.due_date < v_as_of) as oldest_due,
           min(it.due_date) filter (where it.side = v_debt and it.open_cents > 0 and it.due_date >= v_as_of) as next_due,
           max(it.entry_date) filter (where it.side = v_debt) as last_increase
      from it
     group by it.party_id),
  r as (
    select pt.id, pt.name, pt.kind, pt.tax_id, pt.trade_name, pt.active, pt.system_key, pt.display,
           coalesce(g.debt, 0) as debt, coalesce(g.credit, 0) as credit,
           coalesce(g.t_not_due, 0) as t_not_due, coalesce(g.t_due_soon, 0) as t_due_soon,
           coalesce(g.t_o30, 0) as t_o30, coalesce(g.t_o60, 0) as t_o60, coalesce(g.t_o60p, 0) as t_o60p,
           coalesce(g.t_no_due, 0) as t_no_due,
           coalesce(g.t_o30, 0) + coalesce(g.t_o60, 0) + coalesce(g.t_o60p, 0) as overdue,
           g.oldest_due, g.next_due, g.last_increase,
           '$' || chr(160)
             || regexp_replace((coalesce(g.credit, 0) / 100)::text, '(\d)(?=(\d{3})+$)', '\1.', 'g')
             || case when coalesce(g.credit, 0) % 100 <> 0
                     then ',' || lpad((coalesce(g.credit, 0) % 100)::text, 2, '0') else '' end as credit_text
      from pt
      left join g on g.party_id = pt.id
     where pt.active or coalesce(g.debt, 0) <> 0 or coalesce(g.credit, 0) <> 0)
  select r.id, r.name, r.kind, r.tax_id,
         r.debt, r.credit, (r.debt - r.credit)::bigint,
         r.t_not_due, r.t_due_soon, r.t_o30, r.t_o60, r.t_o60p, r.t_no_due,
         r.oldest_due, r.next_due,
         case when r.debt <= 0 then 'none'
              when r.overdue > 0 and r.overdue > r.credit then 'red'
              when r.overdue > 0 then 'yellow'
              when r.t_due_soon > 0 and r.next_due is not null then 'yellow'
              else 'green' end,
         case when r.debt <= 0 then
                'Sin deuda' || case when r.credit > 0 then ' · A favor ' || r.credit_text else '' end
              when r.overdue > 0 and r.overdue > r.credit then
                (case when v_recv then r.display || ' está atrasada ' else 'Vencida hace ' end)
                || (v_as_of - r.oldest_due)::text
                || case when v_as_of - r.oldest_due = 1 then ' día' else ' días' end
              when r.overdue > 0 then
                (case when v_recv then 'Hay ' else 'Tenés ' end) || r.credit_text || ' a favor sin aplicar'
              when r.t_due_soon > 0 and r.next_due is not null then
                case when r.next_due = v_as_of then (case when v_recv then 'Se acredita hoy' else 'Vence hoy' end)
                     else (case when v_recv then 'Se acredita en ' else 'Vence en ' end)
                          || (r.next_due - v_as_of)::text
                          || case when r.next_due - v_as_of = 1 then ' día' else ' días' end
                end
              else 'Al día' end,
         r.trade_name, r.active, r.system_key, r.overdue::bigint, r.last_increase
    from r
   order by r.name, r.id;
end;
$$;

comment on function public.acc_report_open_items(uuid, uuid, date, text, uuid) is
  'Partidas abiertas de un partícipe (F.7): estado actual (p_as_of null) o al día X; deuda, a favor o las dos. INVOKER.';
comment on function public.acc_report_party_balances(uuid, date, text) is
  'Saldos de proveedores o cobrables al día X con antigüedad y semáforo (F.7). INVOKER.';

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.acc_report_open_items(uuid, uuid, date, text, uuid) from public, anon;
grant execute on function public.acc_report_open_items(uuid, uuid, date, text, uuid) to authenticated;
revoke all on function public.acc_report_party_balances(uuid, date, text) from public, anon;
grant execute on function public.acc_report_party_balances(uuid, date, text) to authenticated;
