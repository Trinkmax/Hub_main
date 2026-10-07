-- Parte 1 de 4 de la migración #10 (acc_periods), partida en cuatro para que cada apply_migration por MCP
-- sea chica (≤ ~40 KB). Mismas sentencias y orden que el diseño de la #10; los revoke/grant de cada función
-- viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #10 (acc_periods)
-- Posición y liquidación de IVA, foto del período (spec §C.1, §E.5.15, §F.6)
-- ============================================================
-- Qué crea esta parte:
--   · public.acc_compute_iva_position(tenant, mes) → jsonb: la posición del mes por el art. 24 (INVOKER,
--     EXECUTE authenticated: la usan el cierre, que es definer, y los reportes, que son invoker; §0.3 #11).
--   · private.acc_period_snapshot_hash(período) → text: sha256 de asientos, líneas e imputaciones del período.
--   · private.acc_void_iva_settlements: anula liquidaciones de IVA vigentes (reapertura o reemplazo).
--   · private.acc_generate_iva_settlement: compara con lo que vio el usuario y crea el comprobante
--     iva_settlement con su asiento (espejo exacto de buildIvaSettlement de posting/iva-settlement.ts).
-- No usa nada de la #9 que no esté aplicado (escribe el comprobante y su asiento directo, bajo los triggers
-- de la #5); la liquidación no pasa por acc_post_bundle (que la rechaza: la escribe solo su RPC).
--
-- Desvíos de la spec (documentados en db-api.md):
--   · ST₀/LD₀ = saldo de vat_technical_balance / vat_free_balance ANTES de la liquidación del mes: todo lo
--     anterior al mes más lo del propio mes que no es la liquidación (la apertura de los libros o un ajuste
--     manual de esos saldos entran en el mismo mes; la spec solo miraba fechas < mes y los dejaba afuera).
--   · La posición informa la liquidación vigente del mes y si sigue al día ("settlement.up_to_date"): si se
--     cargó algo después de liquidar, el cierre (on_close) o «Registrar la liquidación» la reemplazan.
--   · Lo que vio el usuario (p_expected) se compara con las 7 cifras que manda la server action
--     (ivaExpectedJson: debit_cents, credit_cents, perceptions_cents, withholdings_cents, to_pay_cents,
--     technical_balance_new_cents, free_balance_new_cents) o con las 6 de "figures" (df, cf, perc, ret, st0, ld0).
-- ============================================================

-- ─── 1. Posición mensual de IVA (art. 24) ────────────────────────────────────
-- DF, CF, PERC, RET = movimientos netos del período mensual (asientos vigentes, sin espejos ni la propia
-- liquidación). Fórmula de E.5.15 (igual que computeIvaPosition): saldo técnico = DF − CF − ST₀; si es > 0,
-- x = saldo técnico − (PERC + RET + LD₀) → a pagar x (o LD₁ = −x); si no, ST₁ = −saldo técnico y
-- LD₁ = LD₀ + PERC + RET. by_rate sale de los libros IVA del mes (firmados); la conciliación lista los asientos
-- sin comprobante fiscal que movieron IVA (manuales, anulaciones de meses cerrados en modo adjustment_only).
create function public.acc_compute_iva_position(p_tenant uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_end date;
  v_period_id uuid;
  v_acc_df uuid; v_acc_cf uuid; v_acc_perc uuid; v_acc_ret uuid;
  v_acc_st uuid; v_acc_ld uuid; v_acc_pay uuid; v_acc_pend uuid;
  v_df bigint := 0; v_cf bigint := 0; v_perc bigint := 0; v_ret bigint := 0;
  v_st0 bigint := 0; v_ld0 bigint := 0;
  v_tb bigint; v_x bigint; v_to_pay bigint; v_st1 bigint; v_ld1 bigint;
  v_pending bigint := 0;
  v_sales_rate jsonb := '{}'; v_purch_rate jsonb := '{}';
  v_book_df bigint := 0; v_book_cf bigint := 0;
  v_diff_n int := 0; v_diff_cf bigint := 0; v_diff_df bigint := 0; v_diffs jsonb := '[]';
  v_settle uuid;
  v_settle_ok boolean;
begin
  if p_tenant is null or p_month is null then
    return null;
  end if;
  v_month := date_trunc('month', p_month::timestamp)::date;
  v_end := (v_month + interval '1 month' - interval '1 day')::date;

  select p.id into v_period_id
    from public.acc_periods p
   where p.tenant_id = p_tenant and p.kind = 'month' and p.month = v_month;

  select (array_agg(a.id) filter (where a.system_key = 'vat_debit'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_credit'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_perceptions'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_withholdings'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_technical_balance'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_free_balance'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_payable'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_credit_pending'))[1]
    into v_acc_df, v_acc_cf, v_acc_perc, v_acc_ret, v_acc_st, v_acc_ld, v_acc_pay, v_acc_pend
    from public.acc_accounts a
   where a.tenant_id = p_tenant
     and a.system_key in ('vat_debit', 'vat_credit', 'vat_perceptions', 'vat_withholdings',
                          'vat_technical_balance', 'vat_free_balance', 'vat_payable', 'vat_credit_pending');

  -- Movimientos del mes (sin la liquidación).
  if v_period_id is not null then
    select coalesce(sum(case when l.account_id = v_acc_df then
                          case when l.side = 'credit' then l.amount_cents else -l.amount_cents end end), 0)::bigint,
           coalesce(sum(case when l.account_id = v_acc_cf then
                          case when l.side = 'debit' then l.amount_cents else -l.amount_cents end end), 0)::bigint,
           coalesce(sum(case when l.account_id = v_acc_perc then
                          case when l.side = 'debit' then l.amount_cents else -l.amount_cents end end), 0)::bigint,
           coalesce(sum(case when l.account_id = v_acc_ret then
                          case when l.side = 'debit' then l.amount_cents else -l.amount_cents end end), 0)::bigint
      into v_df, v_cf, v_perc, v_ret
      from public.acc_journal_entries e
      join public.acc_journal_lines l on l.entry_id = e.id
     where e.tenant_id = p_tenant and e.period_id = v_period_id and e.status = 'posted'
       and not e.is_mirror and e.kind <> 'iva_settlement'
       and l.account_id in (v_acc_df, v_acc_cf, v_acc_perc, v_acc_ret);
  end if;

  -- Arrastres: saldo a favor antes de la liquidación del mes (lo contabilizado, nunca recalculado).
  select coalesce(sum(case when l.account_id = v_acc_st then
                        case when l.side = 'debit' then l.amount_cents else -l.amount_cents end end), 0)::bigint,
         coalesce(sum(case when l.account_id = v_acc_ld then
                        case when l.side = 'debit' then l.amount_cents else -l.amount_cents end end), 0)::bigint
    into v_st0, v_ld0
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id
   where l.tenant_id = p_tenant and l.account_id in (v_acc_st, v_acc_ld)
     and e.status = 'posted' and not e.is_mirror
     and (l.entry_date < v_month or (e.period_id = v_period_id and e.kind <> 'iva_settlement'));

  v_tb := v_df - v_cf - v_st0;
  if v_tb > 0 then
    v_x := v_tb - (v_perc + v_ret + v_ld0);
    if v_x > 0 then
      v_to_pay := v_x; v_st1 := 0; v_ld1 := 0;
    else
      v_to_pay := 0; v_st1 := 0; v_ld1 := -v_x;
    end if;
  else
    v_to_pay := 0; v_st1 := -v_tb; v_ld1 := v_ld0 + v_perc + v_ret;
  end if;

  -- Libros IVA del mes (firmados: NC y anulaciones en modo negative_row restan), de comprobantes vigentes.
  select jsonb_strip_nulls(jsonb_build_object(
           '250', nullif(sum(x.sg * x.vat_25_cents), 0), '500', nullif(sum(x.sg * x.vat_5_cents), 0),
           '1050', nullif(sum(x.sg * x.vat_105_cents), 0), '2100', nullif(sum(x.sg * x.vat_21_cents), 0),
           '2700', nullif(sum(x.sg * x.vat_27_cents), 0))),
         coalesce(sum(x.sg * (x.vat_25_cents + x.vat_5_cents + x.vat_105_cents + x.vat_21_cents + x.vat_27_cents)), 0)::bigint
    into v_sales_rate, v_book_df
    from (select f.*, (case when f.is_credit_note then -1 else 1 end) * (case when f.is_reversal then -1 else 1 end) as sg
            from public.acc_fiscal_vouchers f
           where f.tenant_id = p_tenant and f.book = 'sales' and f.period_month = v_month and not f.voided
             and exists (select 1 from public.acc_documents d where d.id = f.document_id and d.status = 'posted')) x;
  select jsonb_strip_nulls(jsonb_build_object(
           '250', nullif(sum(x.sg * x.vat_25_cents), 0), '500', nullif(sum(x.sg * x.vat_5_cents), 0),
           '1050', nullif(sum(x.sg * x.vat_105_cents), 0), '2100', nullif(sum(x.sg * x.vat_21_cents), 0),
           '2700', nullif(sum(x.sg * x.vat_27_cents), 0))),
         coalesce(sum(x.sg * x.vat_computable_cents), 0)::bigint
    into v_purch_rate, v_book_cf
    from (select f.*, (case when f.is_credit_note then -1 else 1 end) * (case when f.is_reversal then -1 else 1 end) as sg
            from public.acc_fiscal_vouchers f
           where f.tenant_id = p_tenant and f.book = 'purchases' and f.period_month = v_month and not f.voided
             and exists (select 1 from public.acc_documents d where d.id = f.document_id and d.status = 'posted')) x;

  if v_acc_pend is not null then
    v_pending := public.acc_account_balance(p_tenant, v_acc_pend, v_end);
  end if;

  if v_period_id is not null then
    -- Asientos sin comprobante fiscal que movieron IVA (los primeros 50, en orden del diario).
    select count(*)::int, coalesce(sum(m.cf), 0)::bigint, coalesce(sum(m.df), 0)::bigint,
           coalesce(jsonb_agg(jsonb_build_object(
             'entry_id', m.entry_id, 'document_id', m.document_id, 'document_seq', m.seq, 'kind', m.kind,
             'entry_date', m.entry_date, 'description', m.description,
             'label', case when m.kind = 'reversal' then m.description || ' (ajuste de un período cerrado)'
                           when m.kind in ('manual', 'adjustment', 'payroll', 'fy_adjustment')
                             then 'Asiento manual que movió IVA sin comprobante: ' || m.description
                           else m.description end,
             'vat_credit_cents', m.cf, 'vat_debit_cents', m.df) order by m.rn) filter (where m.rn <= 50), '[]'::jsonb)
      into v_diff_n, v_diff_cf, v_diff_df, v_diffs
      from (select g.*, row_number() over (order by g.entry_date, g.posting_seq) as rn
              from (select e.id as entry_id, e.document_id, d.seq, e.kind, e.entry_date, e.description, e.posting_seq,
                           sum(case when l.account_id = v_acc_cf then
                                 case when l.side = 'debit' then l.amount_cents else -l.amount_cents end
                               else 0 end)::bigint as cf,
                           sum(case when l.account_id = v_acc_df then
                                 case when l.side = 'credit' then l.amount_cents else -l.amount_cents end
                               else 0 end)::bigint as df
                      from public.acc_journal_entries e
                      join public.acc_documents d on d.id = e.document_id
                      join public.acc_journal_lines l on l.entry_id = e.id
                     where e.tenant_id = p_tenant and e.period_id = v_period_id and e.status = 'posted'
                       and not e.is_mirror and e.kind <> 'iva_settlement'
                       and l.account_id in (v_acc_cf, v_acc_df)
                       and not exists (select 1 from public.acc_fiscal_vouchers f
                                        where f.document_id = e.document_id and f.tenant_id = p_tenant and not f.voided)
                     group by e.id, e.document_id, d.seq, e.kind, e.entry_date, e.description, e.posting_seq) g
             where g.cf <> 0 or g.df <> 0) m;

    -- Liquidación vigente del mes y si todavía coincide con lo que se generaría hoy.
    select d.id into v_settle
      from public.acc_documents d
     where d.tenant_id = p_tenant and d.period_id = v_period_id and d.kind = 'iva_settlement' and d.status = 'posted'
     order by d.seq desc
     limit 1;
    if v_settle is not null then
      select not exists (
               select 1
                 from (select w.account_id, w.amount
                         from (values (v_acc_df, v_df), (v_acc_cf, -v_cf), (v_acc_st, v_st1 - v_st0),
                                      (v_acc_perc, -v_perc), (v_acc_ret, -v_ret), (v_acc_ld, v_ld1 - v_ld0),
                                      (v_acc_pay, -v_to_pay)) as w(account_id, amount)
                        where w.amount <> 0) want
                 full join (select l.account_id,
                                   sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)::bigint as amount
                              from public.acc_journal_lines l
                             where l.tenant_id = p_tenant and l.document_id = v_settle
                             group by l.account_id) have on have.account_id = want.account_id
                where coalesce(want.amount, 0) <> coalesce(have.amount, 0))
        into v_settle_ok;
    end if;
  end if;

  return jsonb_build_object(
    'month', v_month,
    'period_id', v_period_id,
    'figures', jsonb_build_object('df', v_df, 'cf', v_cf, 'perc', v_perc, 'ret', v_ret, 'st0', v_st0, 'ld0', v_ld0),
    'debit_fiscal', jsonb_build_object('by_rate', coalesce(v_sales_rate, '{}'::jsonb), 'total_cents', v_df),
    'credit_fiscal', jsonb_build_object('by_rate', coalesce(v_purch_rate, '{}'::jsonb), 'total_cents', v_cf),
    'technical_balance_prev_cents', v_st0,
    'free_balance_prev_cents', v_ld0,
    'perceptions_cents', v_perc,
    'withholdings_cents', v_ret,
    'technical_balance_cents', v_tb,
    'to_pay_cents', v_to_pay,
    'technical_balance_new_cents', v_st1,
    'free_balance_new_cents', v_ld1,
    'in_favor_cents', v_st1 + v_ld1,
    'pending_documentation_cents', v_pending,
    'is_zero', (v_df = 0 and v_cf = 0 and v_perc = 0 and v_ret = 0 and v_st1 = v_st0 and v_ld1 = v_ld0 and v_to_pay = 0),
    'settlement', jsonb_build_object('document_id', v_settle, 'up_to_date', v_settle_ok),
    'reconciliation', jsonb_build_object(
      'purchases_book_vat_computable_cents', v_book_cf,
      'journal_vat_credit_cents', v_cf,
      'sales_book_vat_cents', v_book_df,
      'journal_vat_debit_cents', v_df,
      'differences', v_diffs,
      'differences_count', v_diff_n,
      'unexplained_vat_credit_cents', v_cf - v_book_cf - v_diff_cf,
      'unexplained_vat_debit_cents', v_df - v_book_df - v_diff_df,
      'matches', (v_cf = v_book_cf and v_df = v_book_df),
      'fully_explained', (v_cf - v_book_cf - v_diff_cf = 0 and v_df - v_book_df - v_diff_df = 0)));
end;
$$;

-- ─── 2. Foto de un período (C.1) ─────────────────────────────────────────────
-- sha256 de: asientos (id, número, estado) + sus líneas (id, cuenta, partícipe, lado, importe, vencimiento),
-- en orden (posting_seq, line_no), + imputaciones aplicadas en el mes (id, importe, applied_on; no voided_on,
-- que puede cambiar después sin alterar el pasado). Fechas con to_char: no depende de DateStyle.
create function private.acc_period_snapshot_hash(p_period_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with per as (
    select p.id, p.tenant_id, p.kind, p.starts_on, p.ends_on from public.acc_periods p where p.id = p_period_id
  ), r as (
    select e.posting_seq as k1, 0 as k2, e.id as k3,
           format('E|%s|%s|%s', e.id, coalesce(e.number::text, ''), e.status) as t
      from public.acc_journal_entries e
      join per on e.period_id = per.id and e.tenant_id = per.tenant_id
    union all
    select e.posting_seq, l.line_no, l.id,
           format('L|%s|%s|%s|%s|%s|%s', l.id, l.account_id, coalesce(l.party_id::text, ''), l.side, l.amount_cents,
                  coalesce(to_char(l.due_date, 'YYYY-MM-DD'), ''))
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
      join per on e.period_id = per.id and e.tenant_id = per.tenant_id
    union all
    select 9223372036854775807, 0, a.id,
           format('A|%s|%s|%s', a.id, a.amount_cents, to_char(a.applied_on, 'YYYY-MM-DD'))
      from public.acc_allocations a
      join per on a.tenant_id = per.tenant_id
     where per.kind = 'month' and a.applied_on between per.starts_on and per.ends_on
  )
  select encode(sha256(convert_to(coalesce(string_agg(r.t, E'\n' order by r.k1, r.k2, r.k3), ''), 'UTF8')), 'hex')
    from r
$$;

-- ─── 3. Anular liquidaciones de IVA (reapertura o reemplazo) ─────────────────
-- Con el período abierto y sin número (la reapertura limpia la numeración antes). Si la partida de «IVA a
-- pagar» tiene una imputación vigente → iva_settlement_paid (anulá primero el pago a ARCA).
create function private.acc_void_iva_settlements(p_tenant uuid, p_document_ids uuid[], p_actor uuid, p_reason text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_n integer := 0;
  r record;
begin
  if p_document_ids is null or cardinality(p_document_ids) = 0 then
    return 0;
  end if;
  if exists (select 1 from public.acc_journal_lines l
              where l.tenant_id = p_tenant and l.document_id = any (p_document_ids)
                and (exists (select 1 from public.acc_allocations a where a.debit_line_id = l.id and a.voided_on is null)
                     or exists (select 1 from public.acc_allocations a where a.credit_line_id = l.id and a.voided_on is null))) then
    raise exception 'iva_settlement_paid' using errcode = 'P0001',
      detail = jsonb_build_object('month', (select date_trunc('month', min(d.accounting_date)::timestamp)::date
                                              from public.acc_documents d
                                             where d.tenant_id = p_tenant and d.id = any (p_document_ids)))::text;
  end if;
  v_name := private.acc_actor_name(p_tenant, p_actor);
  for r in
    select d.id, d.seq, d.total_cents
      from public.acc_documents d
     where d.tenant_id = p_tenant and d.id = any (p_document_ids) and d.kind = 'iva_settlement' and d.status = 'posted'
     order by d.seq
  loop
    update public.acc_journal_entries e
       set status = 'voided', voided_at = now(), voided_by = p_actor, voided_by_name = v_name, void_reason = p_reason
     where e.tenant_id = p_tenant and e.document_id = r.id and e.status = 'posted';
    update public.acc_documents d
       set status = 'voided', voided_at = now(), voided_by = p_actor, voided_by_name = v_name, void_reason = p_reason
     where d.tenant_id = p_tenant and d.id = r.id;
    perform private.acc_audit(p_tenant, p_actor, 'acc_document.voided', 'acc_document', r.id,
      jsonb_build_object('kind', 'iva_settlement', 'seq', r.seq, 'total_cents', r.total_cents,
                         'with_bundle', false, 'undo', false));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ─── 4. Generar la liquidación de IVA (E.5.15) ───────────────────────────────
-- p_expected = lo que vio el usuario: las 7 cifras de ivaExpectedJson (si además trae
-- technical_balance_prev_cents / free_balance_prev_cents, también se comparan) o las 6 de "figures" (sueltas
-- o dentro de "figures"). Si no coinciden con las de ahora → preview_stale con las nuevas. Sin p_expected
-- solo pasa si no hay nada para liquidar. Todo en cero → null (no crea nada). Renglones en el orden de
-- buildIvaSettlement: D vat_debit DF · H vat_credit CF · vat_technical_balance ST₁−ST₀ · H vat_perceptions
-- PERC · H vat_withholdings RET · vat_free_balance LD₁−LD₀ · H vat_payable [ARCA] a pagar (vence el
-- iva_due_day del mes siguiente). Fecha = último día del mes. Asiento = proyección 1:1 (C.3.6).
create function private.acc_generate_iva_settlement(p_tenant uuid, p_period_id uuid, p_expected jsonb, p_actor uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period public.acc_periods;
  v_set public.acc_settings;
  v_pos jsonb;
  v_fig jsonb;
  v_exp jsonb;
  v_cur jsonb;
  v_key text;
  v_ok_a boolean := true;
  v_ok_b boolean := true;
  v_stale boolean;
  v_df bigint; v_cf bigint; v_perc bigint; v_ret bigint; v_st0 bigint; v_ld0 bigint;
  v_st1 bigint; v_ld1 bigint; v_to_pay bigint; v_total bigint;
  v_acc_df uuid; v_acc_cf uuid; v_acc_st uuid; v_acc_perc uuid; v_acc_ret uuid; v_acc_ld uuid; v_acc_pay uuid;
  v_party public.acc_parties;
  v_name text;
  v_date date;
  v_due date;
  v_desc text;
  v_seq bigint;
  v_doc_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_bundle_id uuid := gen_random_uuid();
  v_months text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                           'septiembre', 'octubre', 'noviembre', 'diciembre'];
begin
  select * into v_period from public.acc_periods p where p.id = p_period_id and p.tenant_id = p_tenant;
  if not found or v_period.kind <> 'month' then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = jsonb_build_object('month', v_period.month)::text;
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant;
  if not found then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;

  v_pos := public.acc_compute_iva_position(p_tenant, v_period.month);
  v_fig := v_pos -> 'figures';
  v_df := (v_fig ->> 'df')::bigint;
  v_cf := (v_fig ->> 'cf')::bigint;
  v_perc := (v_fig ->> 'perc')::bigint;
  v_ret := (v_fig ->> 'ret')::bigint;
  v_st0 := (v_fig ->> 'st0')::bigint;
  v_ld0 := (v_fig ->> 'ld0')::bigint;
  v_to_pay := (v_pos ->> 'to_pay_cents')::bigint;
  v_st1 := (v_pos ->> 'technical_balance_new_cents')::bigint;
  v_ld1 := (v_pos ->> 'free_balance_new_cents')::bigint;
  v_cur := jsonb_build_object(
    'debit_cents', v_df, 'credit_cents', v_cf, 'perceptions_cents', v_perc, 'withholdings_cents', v_ret,
    'to_pay_cents', v_to_pay, 'technical_balance_new_cents', v_st1, 'free_balance_new_cents', v_ld1,
    'technical_balance_prev_cents', v_st0, 'free_balance_prev_cents', v_ld0,
    'df', v_df, 'cf', v_cf, 'perc', v_perc, 'ret', v_ret, 'st0', v_st0, 'ld0', v_ld0);

  v_exp := case when jsonb_typeof(p_expected -> 'figures') = 'object' then p_expected -> 'figures' else p_expected end;
  if jsonb_typeof(v_exp) = 'object' then
    -- (a) Las 7 cifras de la server action, y los saldos anteriores si vienen.
    foreach v_key in array array['debit_cents', 'credit_cents', 'perceptions_cents', 'withholdings_cents',
                                 'to_pay_cents', 'technical_balance_new_cents', 'free_balance_new_cents',
                                 'technical_balance_prev_cents', 'free_balance_prev_cents'] loop
      if v_exp -> v_key is null and v_key in ('technical_balance_prev_cents', 'free_balance_prev_cents') then
        continue;
      elsif jsonb_typeof(v_exp -> v_key) is distinct from 'number' then
        v_ok_a := false;
      elsif (v_exp ->> v_key)::numeric <> (v_cur ->> v_key)::numeric then
        v_ok_a := false;
      end if;
    end loop;
    -- (b) Las 6 de "figures".
    foreach v_key in array array['df', 'cf', 'perc', 'ret', 'st0', 'ld0'] loop
      if jsonb_typeof(v_exp -> v_key) is distinct from 'number' then
        v_ok_b := false;
      elsif (v_exp ->> v_key)::numeric <> (v_cur ->> v_key)::numeric then
        v_ok_b := false;
      end if;
    end loop;
    v_stale := not (v_ok_a or v_ok_b);
  else
    v_stale := not (v_pos ->> 'is_zero')::boolean;
  end if;
  if v_stale then
    raise exception 'preview_stale' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_period.month, 'figures', v_fig,
                                  'current', jsonb_build_object(
                                    'debit_cents', v_df, 'credit_cents', v_cf, 'perceptions_cents', v_perc,
                                    'withholdings_cents', v_ret, 'to_pay_cents', v_to_pay,
                                    'technical_balance_new_cents', v_st1, 'free_balance_new_cents', v_ld1))::text;
  end if;
  if (v_pos ->> 'is_zero')::boolean then
    return null;
  end if;

  select (array_agg(a.id) filter (where a.system_key = 'vat_debit'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_credit'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_technical_balance'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_perceptions'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_withholdings'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_free_balance'))[1],
         (array_agg(a.id) filter (where a.system_key = 'vat_payable'))[1]
    into v_acc_df, v_acc_cf, v_acc_st, v_acc_perc, v_acc_ret, v_acc_ld, v_acc_pay
    from public.acc_accounts a
   where a.tenant_id = p_tenant
     and a.system_key in ('vat_debit', 'vat_credit', 'vat_technical_balance', 'vat_perceptions',
                          'vat_withholdings', 'vat_free_balance', 'vat_payable');
  if v_acc_df is null or v_acc_cf is null or v_acc_st is null or v_acc_perc is null or v_acc_ret is null
     or v_acc_ld is null or v_acc_pay is null then
    raise exception 'account_not_found' using errcode = 'P0001', detail = jsonb_build_object('field', 'vat_accounts')::text;
  end if;

  -- ARCA: el partícipe activo cuya cuenta «le debemos» es IVA a pagar (como partyForPayable).
  select * into v_party
    from public.acc_parties pa
   where pa.tenant_id = p_tenant and pa.active and pa.payable_account_id = v_acc_pay
   order by (pa.system_key = 'arca') desc nulls last, (pa.kind = 'tax_agency') desc, pa.name, pa.id
   limit 1;
  if v_to_pay > 0 and v_party.id is null then
    raise exception 'party_required' using errcode = 'P0001', detail = jsonb_build_object('field', 'arcaPartyId')::text;
  end if;

  v_date := v_period.ends_on;
  v_due := make_date(extract(year from v_date + 1)::int, extract(month from v_date + 1)::int, v_set.iva_due_day);
  v_desc := 'Liquidación de IVA de ' || v_months[extract(month from v_date)::int] || ' de '
            || extract(year from v_date)::int::text;
  v_total := greatest(v_df, 0) + greatest(-v_cf, 0) + greatest(v_st1 - v_st0, 0) + greatest(-v_perc, 0)
           + greatest(-v_ret, 0) + greatest(v_ld1 - v_ld0, 0);
  v_name := private.acc_actor_name(p_tenant, p_actor);
  v_seq := private.acc_next_doc_seq(p_tenant);

  insert into public.acc_documents (id, tenant_id, bundle_id, period_id, seq, kind, party_id, party_name_snapshot,
                                    party_doc_type_snapshot, party_doc_number_snapshot, party_iva_condition_snapshot,
                                    issue_date, accounting_date, due_date, description, total_cents,
                                    created_by, created_by_name)
  values (v_doc_id, p_tenant, v_bundle_id, v_period.id, v_seq, 'iva_settlement', v_party.id, v_party.name,
          case when v_party.id is null then null when v_party.tax_id_type = 'cuit' then 80
               when v_party.tax_id_type = 'cuil' then 86 when v_party.tax_id_type = 'dni' then 96 else 99 end,
          case when v_party.id is null then null when v_party.tax_id_type = 'none' then '0' else v_party.tax_id end,
          v_party.iva_condition,
          v_date, v_date, case when v_to_pay > 0 then v_due end, v_desc, v_total, p_actor, v_name);

  insert into public.acc_document_lines (tenant_id, document_id, line_no, role, account_id, side, amount_cents,
                                         party_id, due_date, memo)
  select p_tenant, v_doc_id, (row_number() over (order by x.ord))::smallint, 'settlement', x.account_id,
         (case when x.amount > 0 then 'debit' else 'credit' end)::public.acc_side, abs(x.amount),
         x.party_id, x.due_date, x.memo
    from (values (1, v_acc_df, v_df, null::uuid, null::date, 'Débito fiscal del mes'),
                 (2, v_acc_cf, -v_cf, null, null, 'Crédito fiscal del mes'),
                 (3, v_acc_st, v_st1 - v_st0, null, null, 'Saldo técnico a favor'),
                 (4, v_acc_perc, -v_perc, null, null, 'Percepciones de IVA del mes'),
                 (5, v_acc_ret, -v_ret, null, null, 'Retenciones de IVA del mes'),
                 (6, v_acc_ld, v_ld1 - v_ld0, null, null, 'Saldo de libre disponibilidad'),
                 (7, v_acc_pay, -v_to_pay, v_party.id, case when v_to_pay > 0 then v_due end, 'IVA a pagar'))
         as x(ord, account_id, amount, party_id, due_date, memo)
   where x.amount <> 0;

  insert into public.acc_journal_entries (id, tenant_id, fiscal_year_id, period_id, document_id, entry_date, kind,
                                          description, total_cents, created_by, created_by_name)
  values (v_entry_id, p_tenant, v_period.fiscal_year_id, v_period.id, v_doc_id, v_date, 'iva_settlement',
          v_desc, v_total, p_actor, v_name);
  -- document_id y entry_date de las líneas los copia el trigger desde la cabecera (como acc_project_entry).
  insert into public.acc_journal_lines (tenant_id, entry_id, document_line_id, line_no, account_id,
                                        side, amount_cents, party_id, due_date, memo)
  select dl.tenant_id, v_entry_id, dl.id, dl.line_no, dl.account_id, dl.side, dl.amount_cents, dl.party_id,
         case when dl.party_id is null then null else coalesce(dl.due_date, case when v_to_pay > 0 then v_due end) end,
         dl.memo
    from public.acc_document_lines dl
   where dl.document_id = v_doc_id and dl.tenant_id = p_tenant
   order by dl.line_no;

  insert into public.acc_bundles (id, tenant_id, client_ref, operation, request_hash, result, created_by, created_by_name)
  values (v_bundle_id, p_tenant, gen_random_uuid(), 'post',
          encode(sha256(convert_to(jsonb_build_object('kind', 'iva_settlement', 'period_id', v_period.id,
                                                      'figures', v_fig)::text, 'UTF8')), 'hex'),
          jsonb_build_object('kind', 'iva_settlement', 'document_ids', jsonb_build_array(v_doc_id),
                             'entry_ids', jsonb_build_array(v_entry_id)),
          p_actor, v_name);

  perform private.acc_audit(p_tenant, p_actor, 'acc_document.posted', 'acc_document', v_doc_id,
    jsonb_build_object('kind', 'iva_settlement', 'voucher_type', null, 'seq', v_seq, 'total_cents', v_total,
                       'accounting_date', v_date, 'party_id', v_party.id, 'bundle_id', v_bundle_id, 'preview_hash', null));
  return v_doc_id;
end;
$$;

comment on function public.acc_compute_iva_position(uuid, date) is
  'Posición mensual de IVA (art. 24, E.5.15) con los libros por alícuota, la conciliación y la liquidación vigente del mes. INVOKER.';
comment on function private.acc_period_snapshot_hash(uuid) is
  'sha256 de asientos, líneas e imputaciones aplicadas de un período (C.1): la foto que guarda el cierre.';
comment on function private.acc_void_iva_settlements(uuid, uuid[], uuid, text) is
  'Anula liquidaciones de IVA vigentes (reapertura o reemplazo). iva_settlement_paid si su partida tiene un pago aplicado.';
comment on function private.acc_generate_iva_settlement(uuid, uuid, jsonb, uuid) is
  'Crea el comprobante iva_settlement del mes con su asiento (E.5.15), comparando con lo que vio el usuario (preview_stale). Null si todo es cero.';

revoke all on function public.acc_compute_iva_position(uuid, date) from public, anon;
grant execute on function public.acc_compute_iva_position(uuid, date) to authenticated;
revoke all on function private.acc_period_snapshot_hash(uuid) from public, anon, authenticated;
revoke all on function private.acc_void_iva_settlements(uuid, uuid[], uuid, text) from public, anon, authenticated;
revoke all on function private.acc_generate_iva_settlement(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
