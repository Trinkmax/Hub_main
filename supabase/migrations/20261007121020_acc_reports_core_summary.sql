-- Parte 3 de 3 de la migración #11 (acc_reports_core): el Resumen (F.10), versión fase 1. Usa
-- acc_report_treasury_balances (parte 2), acc_report_close_checklist y acc_compute_iva_position (#10). Los
-- revoke/grant viajan con la función; última parte (notify pgrst).
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #11 (acc_reports_core) · spec §F.10
-- ============================================================

-- ─── 9. Resumen (F.10), versión fase 1 ───────────────────────────────────────
-- Una sola llamada. Fase 1: plata disponible (cajas, por acreditar, deuda de tarjetas), cajas sin ajustar,
-- mes para cerrar, patrimonio inicial sin asignar, CUIT de la SAS, estado de los libros, IVA del mes, lo
-- cargado en el mes y primeros pasos. payables/receivables van en null hasta la #12/#13 (deuda, vencimientos,
-- gastos fijos, te deben, cierres que faltan), que reemplazan esta función con la misma firma.
--   {as_of, treasuries:[{id, name, kind, account_code, balance_cents, pending_wallet_cents, last_movement_date,
--    last_checked_on}], available_cents, card_debt_cents, pending_wallet_cents, payables: null, receivables: null,
--    iva_month: {month, to_pay_cents, in_favor_cents, provisional} | null, month_to_date: {sold_cents,
--    purchases_and_expenses_cents}, attention: [{kind, ref_id, label, amount_cents, date, days, count}] (≤ 8),
--    books: {last_closed_month, closed_by, closed_at, open_month, open_warnings},
--    first_steps: {first_expense, first_daily_close, accountant_added, partner_granted}}
create function public.acc_report_summary(p_tenant_id uuid, p_as_of date)
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

  -- Este mes, hasta p_as_of (los cierres del día; nunca «ganancia»).
  select coalesce(sum(d.total_cents) filter (where d.kind = 'sales_close'), 0)::bigint,
         coalesce(sum(case when d.kind = 'purchase_credit_note' then -d.total_cents else d.total_cents end)
                    filter (where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense')), 0)::bigint
    into v_sold, v_spent
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.status = 'posted' and d.accounting_date between v_month and v_as_of
     and d.kind in ('sales_close', 'purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense');

  return jsonb_build_object(
    'as_of', v_as_of,
    'treasuries', v_tr,
    'available_cents', v_available,
    'card_debt_cents', v_card,
    'pending_wallet_cents', v_pending,
    'payables', null,
    'receivables', null,
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
  'Resumen de Administración (F.10), versión fase 1: plata disponible, cajas sin ajustar, mes para cerrar, libros, IVA del mes y primeros pasos. INVOKER.';

revoke all on function public.acc_report_summary(uuid, date) from public, anon;
grant execute on function public.acc_report_summary(uuid, date) to authenticated;

notify pgrst, 'reload schema';
