-- Parte 2 de 4 de la migración #10 (acc_periods): checklist del cierre y cierre del mes. Usa las funciones de la
-- parte 1 (acc_compute_iva_position, acc_period_snapshot_hash, acc_void_iva_settlements,
-- acc_generate_iva_settlement); los revoke/grant de cada función viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #10 (acc_periods) · spec §C.5.1, §C.5.3, §F.13
-- ============================================================
-- Qué crea esta parte (en public, EXECUTE solo authenticated):
--   · acc_report_close_checklist(tenant, mes) → jsonb      INVOKER; la forma que lee parseCloseChecklist
--   · acc_close_period(tenant, mes, opciones) → jsonb     C.5.1 (definer)
-- Desvíos (db-api.md): la lista de bloqueos se llama "blockers" (la lee lib/accounting/queries/periods.ts) y la
-- posición va en "iva_position"; el cierre (modo on_close) reemplaza una liquidación vigente que quedó vieja.
-- ============================================================

-- ─── 5. Checklist del cierre de mes (F.13) ───────────────────────────────────
-- INVOKER (corre bajo la RLS de quien llama); el cierre la llama desde su contexto definer para usar
-- exactamente los mismos avisos. Devuelve:
--   {month, period_id, fiscal_year_id, status, starts_on, ends_on, can_close,
--    blockers: [{key: period_already_closed | month_not_finished | close_out_of_order | opening_pending, month,
--                previous_month?}],
--    warnings: [{key, count, …detalle}] con las claves de C.5.1 paso 4 (CLOSE_WARNING_KEYS),
--    info:     [{key: opening_unassigned (amount_cents) | last_month_of_fiscal_year (end_date) |
--                iva_settlement_outdated (label, document_id)}],
--    entries_count, debit_total_cents, credit_total_cents, number_from, number_to, numbers_provisional
--      (en un mes abierto: lo que va a tener al cerrarse, contando la liquidación que se va a generar),
--    is_last_month_of_fiscal_year,
--    iva_position: acc_compute_iva_position + {status, mode, applies, will_generate, replaces_document_id},
--    closed_at, closed_by_name}
create function public.acc_report_close_checklist(p_tenant_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_today date;
  v_upto date;
  v_set public.acc_settings;
  v_period public.acc_periods;
  v_fy_end date;
  v_prev_open date;
  v_blocks jsonb := '[]';
  v_warn jsonb := '[]';
  v_info jsonb := '[]';
  v_n integer;
  v_amount bigint;
  v_list jsonb;
  v_pos jsonb;
  v_fig jsonb;
  v_settle uuid;
  v_applies boolean;
  v_outdated boolean;
  v_will boolean := false;
  v_replaces uuid;
  v_count integer;
  v_debit bigint;
  v_base integer;
  v_acc uuid;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_month is null then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  v_month := date_trunc('month', p_month::timestamp)::date;
  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  select f.end_date into v_fy_end from public.acc_fiscal_years f
   where f.id = v_period.fiscal_year_id and f.tenant_id = p_tenant_id;
  v_today := public.acc_today(p_tenant_id);
  v_upto := least(v_period.ends_on, v_today - 1);

  -- Bloqueos (C.5.1 pasos 1 a 3).
  if v_period.status = 'closed' then
    v_blocks := v_blocks || jsonb_build_object('key', 'period_already_closed', 'month', v_month);
  end if;
  if v_period.ends_on >= v_today then
    v_blocks := v_blocks || jsonb_build_object('key', 'month_not_finished', 'month', v_month);
  end if;
  select min(p.month) into v_prev_open from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month < v_month and p.status = 'open';
  if v_prev_open is not null then
    v_blocks := v_blocks || jsonb_build_object('key', 'close_out_of_order', 'month', v_month, 'previous_month', v_prev_open);
  end if;
  if v_set.opening_status = 'pending'
     and not exists (select 1 from public.acc_periods p
                      where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month < v_month) then
    v_blocks := v_blocks || jsonb_build_object('key', 'opening_pending', 'month', v_month);
  end if;

  -- Avisos (C.5.1 paso 4). missing_daily_closes: solo si el bar ya cargó algún cierre del día.
  if exists (select 1 from public.acc_documents d
              where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted') then
    select count(*)::int, coalesce(jsonb_agg(to_char(g.day, 'YYYY-MM-DD') order by g.day), '[]'::jsonb)
      into v_n, v_list
      from (select gs::date as day
              from generate_series(greatest(v_period.starts_on, v_set.books_start_date)::timestamp,
                                   v_upto::timestamp, interval '1 day') as gs) g
     where not exists (select 1 from public.acc_documents d
                        where d.tenant_id = p_tenant_id and d.kind = 'sales_close' and d.status = 'posted'
                          and d.accounting_date = g.day);
    if v_n > 0 then
      v_warn := v_warn || jsonb_build_object('key', 'missing_daily_closes', 'count', v_n, 'dates', v_list);
    end if;
  end if;

  -- receivables_overdue: partidas de tarjetas, billeteras y plataformas vencidas hace más de 7 días al cierre.
  -- Abierto al último día: imputaciones aplicadas hasta ese día, no desaplicadas antes, de asientos vigentes.
  select count(*)::int, coalesce(sum(x.open_cents), 0)::bigint into v_n, v_amount
    from (select l.amount_cents - coalesce((select sum(a.amount_cents) from public.acc_allocations a
                                              join public.acc_journal_lines cl on cl.id = a.credit_line_id
                                              join public.acc_journal_entries ce on ce.id = cl.entry_id
                                             where a.debit_line_id = l.id and ce.status = 'posted'
                                               and a.applied_on <= v_period.ends_on
                                               and (a.voided_on is null or a.voided_on > v_period.ends_on)), 0) as open_cents
            from public.acc_journal_lines l
            join public.acc_journal_entries e on e.id = l.entry_id
            join public.acc_parties pa on pa.id = l.party_id
           where l.tenant_id = p_tenant_id and l.party_id is not null and l.side = 'debit'
             and l.due_date < v_period.ends_on - 7 and l.entry_date <= v_period.ends_on
             and e.status = 'posted' and not e.is_mirror
             and pa.kind in ('card_processor', 'payment_wallet', 'delivery_platform')
             and l.account_id = pa.receivable_account_id) x
   where x.open_cents > 0;
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'receivables_overdue', 'count', v_n, 'amount_cents', v_amount);
  end if;

  -- treasury_negative: cajas de efectivo en negativo al último día del mes.
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object('treasury_id', t.id, 'name', t.name, 'balance_cents', b.bal)
                                           order by t.sort, t.name), '[]'::jsonb)
    into v_n, v_list
    from public.acc_treasury_accounts t
    cross join lateral (select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end), 0)::bigint as bal
                          from public.acc_journal_lines l
                          join public.acc_journal_entries e on e.id = l.entry_id
                         where l.tenant_id = p_tenant_id and l.account_id = t.account_id
                           and l.entry_date <= v_period.ends_on and e.status = 'posted' and not e.is_mirror) b
   where t.tenant_id = p_tenant_id and t.kind = 'cash' and b.bal < 0;
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'treasury_negative', 'count', v_n, 'treasuries', v_list);
  end if;

  -- treasuries_not_reconciled: cajas con movimientos (no tarjetas) sin «Ajustar saldo» con fecha del mes
  -- (verificada sin diferencia, ajuste de saldo o acreditación por arqueo).
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object('treasury_id', t.id, 'name', t.name,
                                                              'last_checked_on', t.last_checked_on)
                                           order by t.sort, t.name), '[]'::jsonb)
    into v_n, v_list
    from public.acc_treasury_accounts t
   where t.tenant_id = p_tenant_id and t.active and t.kind <> 'credit_card'
     and exists (select 1 from public.acc_journal_lines l
                   join public.acc_journal_entries e on e.id = l.entry_id
                  where l.tenant_id = p_tenant_id and l.account_id = t.account_id and l.entry_date <= v_period.ends_on
                    and e.status = 'posted')
     and not coalesce(t.last_checked_on between v_period.starts_on and v_period.ends_on, false)
     and not exists (select 1 from public.audit_log al
                      where al.tenant_id = p_tenant_id and al.action = 'acc_treasury.checked' and al.entity_id = t.id
                        and al.payload ->> 'as_of' between to_char(v_period.starts_on, 'YYYY-MM-DD')
                                                       and to_char(v_period.ends_on, 'YYYY-MM-DD'))
     and not exists (select 1 from public.acc_documents d
                      where d.tenant_id = p_tenant_id and d.period_id = v_period.id and d.status = 'posted'
                        and d.counted_cents is not null
                        and (exists (select 1 from public.acc_document_lines dl
                                      where dl.document_id = d.id and dl.treasury_account_id = t.id)
                             or (d.kind = 'collection' and d.party_id = t.bank_party_id)));
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'treasuries_not_reconciled', 'count', v_n, 'treasuries', v_list);
  end if;

  -- vat_pending_documentation: IVA de comisiones a documentar con más de 45 días al cierre.
  select a.id into v_acc from public.acc_accounts a where a.tenant_id = p_tenant_id and a.system_key = 'vat_credit_pending';
  select count(*)::int, coalesce(sum(x.open_cents), 0)::bigint into v_n, v_amount
    from (select l.amount_cents - coalesce((select sum(a.amount_cents) from public.acc_allocations a
                                              join public.acc_journal_lines cl on cl.id = a.credit_line_id
                                              join public.acc_journal_entries ce on ce.id = cl.entry_id
                                             where a.debit_line_id = l.id and ce.status = 'posted'
                                               and a.applied_on <= v_period.ends_on
                                               and (a.voided_on is null or a.voided_on > v_period.ends_on)), 0) as open_cents
            from public.acc_journal_lines l
            join public.acc_journal_entries e on e.id = l.entry_id
           where l.tenant_id = p_tenant_id and l.account_id = v_acc and l.side = 'debit'
             and l.entry_date < v_period.ends_on - 45 and e.status = 'posted' and not e.is_mirror) x
   where x.open_cents > 0;
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'vat_pending_documentation', 'count', v_n, 'amount_cents', v_amount);
  end if;

  -- recurring_not_loaded: gastos fijos activos con vencimiento en el mes (o antes) sin cargar ni saltear.
  select count(*)::int, coalesce(jsonb_agg(jsonb_build_object('recurring_id', r.id, 'name', r.name,
                                                              'due_date', r.next_due_date, 'amount_cents', r.amount_cents)
                                           order by r.next_due_date, r.name), '[]'::jsonb)
    into v_n, v_list
    from public.acc_recurring_expenses r
   where r.tenant_id = p_tenant_id and r.active and r.next_due_date <= v_period.ends_on;
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'recurring_not_loaded', 'count', v_n, 'items', v_list);
  end if;

  -- tickets_without_vendor: tiques cargados como gasto sin comercio (no entran al Libro IVA).
  select count(*)::int, coalesce(sum(d.total_cents), 0)::bigint into v_n, v_amount
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.period_id = v_period.id and d.status = 'posted'
     and d.kind = 'expense' and d.voucher_type = 'tique' and d.party_id is null;
  if v_n > 0 then
    v_warn := v_warn || jsonb_build_object('key', 'tickets_without_vendor', 'count', v_n, 'amount_cents', v_amount);
  end if;

  if v_set.cuit is null then
    v_warn := v_warn || jsonb_build_object('key', 'sas_cuit_missing');
  end if;

  -- Información.
  select a.id into v_acc from public.acc_accounts a where a.tenant_id = p_tenant_id and a.system_key = 'opening_equity';
  if v_acc is not null then
    v_amount := -public.acc_account_balance(p_tenant_id, v_acc, v_period.ends_on);
    if v_amount <> 0 then
      v_info := v_info || jsonb_build_object('key', 'opening_unassigned', 'amount_cents', v_amount);
    end if;
  end if;
  if v_period.ends_on = v_fy_end then
    v_info := v_info || jsonb_build_object('key', 'last_month_of_fiscal_year', 'end_date', v_fy_end);
  end if;

  -- Liquidación de IVA: la que se va a generar (on_close + RI) y la vigente que se va a reemplazar.
  v_pos := public.acc_compute_iva_position(p_tenant_id, v_month);
  v_fig := v_pos -> 'figures';
  v_settle := (v_pos -> 'settlement' ->> 'document_id')::uuid;
  v_outdated := v_settle is not null and not coalesce((v_pos -> 'settlement' ->> 'up_to_date')::boolean, false);
  v_applies := v_set.iva_settlement_mode = 'on_close' and v_set.iva_condition = 'responsable_inscripto';
  if v_period.status = 'open' and v_applies then
    v_will := (v_settle is null or v_outdated) and not (v_pos ->> 'is_zero')::boolean;
    v_replaces := case when v_outdated then v_settle end;
  elsif v_period.status = 'open' and v_outdated then
    v_info := v_info || jsonb_build_object('key', 'iva_settlement_outdated', 'document_id', v_settle,
      'label', 'La liquidación de IVA registrada quedó vieja (se cargó algo después). Registrala de nuevo antes de cerrar.');
  end if;

  -- Asientos y numeración (en un mes abierto, lo que va a quedar al cerrarlo).
  if v_period.status = 'closed' then
    v_count := v_period.entries_count;
    v_debit := v_period.debit_total_cents;
  else
    select count(*)::int, coalesce(sum(e.total_cents), 0)::bigint into v_count, v_debit
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.period_id = v_period.id and e.status = 'posted';
    if v_replaces is not null then
      v_count := v_count - 1;
      v_debit := v_debit - coalesce((select e.total_cents from public.acc_journal_entries e
                                      where e.document_id = v_replaces and e.status = 'posted'), 0);
    end if;
    if v_will then
      v_count := v_count + 1;
      v_debit := v_debit + greatest((v_fig ->> 'df')::bigint, 0) + greatest(-(v_fig ->> 'cf')::bigint, 0)
               + greatest((v_pos ->> 'technical_balance_new_cents')::bigint - (v_fig ->> 'st0')::bigint, 0)
               + greatest(-(v_fig ->> 'perc')::bigint, 0) + greatest(-(v_fig ->> 'ret')::bigint, 0)
               + greatest((v_pos ->> 'free_balance_new_cents')::bigint - (v_fig ->> 'ld0')::bigint, 0);
    end if;
    v_base := public.acc_entry_number_base(v_period.fiscal_year_id);
  end if;

  return jsonb_build_object(
    'month', v_month,
    'period_id', v_period.id,
    'fiscal_year_id', v_period.fiscal_year_id,
    'status', v_period.status,
    'starts_on', v_period.starts_on,
    'ends_on', v_period.ends_on,
    'can_close', v_period.status = 'open' and jsonb_array_length(v_blocks) = 0,
    'blockers', v_blocks,
    'warnings', v_warn,
    'info', v_info,
    'entries_count', v_count,
    'debit_total_cents', v_debit,
    'credit_total_cents', v_debit,
    'number_from', case when v_period.status = 'closed' then v_period.number_from
                        when v_count > 0 then v_base + 1 end,
    'number_to', case when v_period.status = 'closed' then v_period.number_to
                      when v_count > 0 then v_base + v_count end,
    'numbers_provisional', v_period.status = 'open',
    'is_last_month_of_fiscal_year', v_period.ends_on = v_fy_end,
    'iva_position', v_pos || jsonb_build_object('status', v_period.status, 'mode', v_set.iva_settlement_mode,
                                                'applies', v_set.iva_condition = 'responsable_inscripto',
                                                'will_generate', v_will, 'replaces_document_id', v_replaces),
    'closed_at', v_period.closed_at,
    'closed_by_name', v_period.closed_by_name);
end;
$$;

-- ─── 6. Cerrar el mes (C.5.1) ────────────────────────────────────────────────
-- p_options = {"warnings_ack": [...], "iva_settlement": {"generate": true, "expected": {…ivaExpectedJson…}}}.
-- Bloqueos → period_not_found, period_already_closed, month_not_finished, close_out_of_order, opening_pending.
-- Avisos sin aceptar → close_warnings (detail {month, warnings}). Liquidación (on_close + RI + generate, que es
-- true si no viene): reemplaza una liquidación vigente que quedó vieja, compara con expected (preview_stale) y
-- la crea. Congela la numeración, guarda la foto, cierra, registra el evento y audita.
create function public.acc_close_period(p_tenant_id uuid, p_month date, p_options jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_month date;
  v_opts jsonb := case when jsonb_typeof(p_options) = 'object' then p_options else '{}'::jsonb end;
  v_iva_opts jsonb;
  v_period public.acc_periods;
  v_set public.acc_settings;
  v_prev_open date;
  v_check jsonb;
  v_ack text[];
  v_pending integer;
  v_pos jsonb;
  v_applies boolean;
  v_generate boolean;
  v_settlement uuid;
  v_old uuid[];
  v_base integer;
  v_from integer;
  v_to integer;
  v_count integer;
  v_debit bigint;
  v_hash text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_month is null then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  v_month := date_trunc('month', p_month::timestamp)::date;

  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  if v_period.status <> 'open' then
    raise exception 'period_already_closed' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  if v_period.ends_on >= public.acc_today(p_tenant_id) then
    raise exception 'month_not_finished' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  select min(p.month) into v_prev_open from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month < v_month and p.status = 'open';
  if v_prev_open is not null then
    raise exception 'close_out_of_order' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_month, 'previous_month', v_prev_open)::text;
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  if v_set.opening_status = 'pending'
     and not exists (select 1 from public.acc_periods p
                      where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month < v_month) then
    raise exception 'opening_pending' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;

  -- Avisos: los mismos del checklist, calculados bajo el lock.
  v_check := public.acc_report_close_checklist(p_tenant_id, v_month);
  select coalesce(array_agg(x.k), '{}') into v_ack
    from jsonb_array_elements_text(case when jsonb_typeof(v_opts -> 'warnings_ack') = 'array'
                                        then v_opts -> 'warnings_ack' else '[]'::jsonb end) as x(k);
  select count(*)::int into v_pending
    from jsonb_array_elements(v_check -> 'warnings') as w(v)
   where not ((w.v ->> 'key') = any (v_ack));
  if v_pending > 0 then
    raise exception 'close_warnings' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_month, 'warnings', v_check -> 'warnings')::text;
  end if;

  -- Liquidación de IVA (E.5.15).
  v_pos := v_check -> 'iva_position';
  v_settlement := (v_pos -> 'settlement' ->> 'document_id')::uuid;
  v_applies := v_set.iva_settlement_mode = 'on_close' and v_set.iva_condition = 'responsable_inscripto';
  v_iva_opts := case when jsonb_typeof(v_opts -> 'iva_settlement') = 'object' then v_opts -> 'iva_settlement' else '{}'::jsonb end;
  v_generate := v_applies and case when jsonb_typeof(v_iva_opts -> 'generate') = 'boolean'
                                   then (v_iva_opts ->> 'generate')::boolean else true end;
  if v_generate then
    if v_settlement is not null and not coalesce((v_pos -> 'settlement' ->> 'up_to_date')::boolean, false) then
      select coalesce(array_agg(d.id), '{}') into v_old from public.acc_documents d
       where d.tenant_id = p_tenant_id and d.period_id = v_period.id and d.kind = 'iva_settlement' and d.status = 'posted';
      perform private.acc_void_iva_settlements(p_tenant_id, v_old, v_uid, 'Reemplazada al cerrar el mes');
      v_settlement := null;
    end if;
    if v_settlement is null then
      v_settlement := private.acc_generate_iva_settlement(p_tenant_id, v_period.id, v_iva_opts -> 'expected', v_uid);
    end if;
  end if;

  -- Numeración definitiva (C.5.3): sigue la del período anterior del ejercicio.
  perform set_config('acc.numbering', v_period.id::text, true);
  v_base := public.acc_entry_number_base(v_period.fiscal_year_id);
  with ordered as (
    select e.id, row_number() over (order by e.entry_date, e.order_key, e.posting_seq) as rn
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.period_id = v_period.id and e.status = 'posted' and e.number is null)
  update public.acc_journal_entries e
     set number = v_base + o.rn::int
    from ordered o
   where e.id = o.id;
  perform set_config('acc.numbering', '', true);

  -- Foto.
  select count(*)::int, coalesce(sum(e.total_cents), 0)::bigint, min(e.number), max(e.number)
    into v_count, v_debit, v_from, v_to
    from public.acc_journal_entries e
   where e.tenant_id = p_tenant_id and e.period_id = v_period.id and e.status = 'posted';
  v_hash := private.acc_period_snapshot_hash(v_period.id);
  v_name := private.acc_actor_name(p_tenant_id, v_uid);

  update public.acc_periods p
     set status = 'closed', closed_at = now(), closed_by = v_uid, closed_by_name = v_name,
         number_from = v_from, number_to = v_to, entries_count = v_count, debit_total_cents = v_debit,
         snapshot_hash = v_hash, iva_settlement_document_id = v_settlement
   where p.id = v_period.id;

  insert into public.acc_period_events (tenant_id, period_id, fiscal_year_id, action, reason, actor_id, actor_name, payload)
  values (p_tenant_id, v_period.id, v_period.fiscal_year_id, 'closed', null, v_uid, v_name,
          jsonb_build_object('number_from', v_from, 'number_to', v_to, 'entries_count', v_count,
                             'debit_total_cents', v_debit, 'snapshot_hash', v_hash,
                             'iva_settlement_document_id', v_settlement, 'warnings_ack', to_jsonb(v_ack)));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_period.closed', 'acc_period', v_period.id,
    jsonb_build_object('month', v_month, 'number_from', v_from, 'number_to', v_to, 'entries_count', v_count,
                       'debit_total_cents', v_debit, 'iva_settlement_document_id', v_settlement));

  return jsonb_build_object(
    'month', v_month,
    'period_id', v_period.id,
    'number_from', v_from,
    'number_to', v_to,
    'entries_count', v_count,
    'debit_total_cents', v_debit,
    'snapshot_hash', v_hash,
    'iva_settlement_document_id', v_settlement,
    'iva_to_pay_cents', case when v_set.iva_condition = 'responsable_inscripto' then (v_pos ->> 'to_pay_cents')::bigint else 0 end,
    'iva_in_favor_cents', case when v_set.iva_condition = 'responsable_inscripto' then (v_pos ->> 'in_favor_cents')::bigint else 0 end);
end;
$$;

comment on function public.acc_report_close_checklist(uuid, date) is
  'Checklist del cierre de mes (F.13): bloqueos, avisos de C.5.1, información, posición de IVA y numeración que va a tomar. INVOKER.';
comment on function public.acc_close_period(uuid, date, jsonb) is
  'Cierra un mes (C.5.1): avisos aceptados, liquidación de IVA, numeración definitiva, foto (snapshot_hash) y evento.';

revoke all on function public.acc_report_close_checklist(uuid, date) from public, anon;
grant execute on function public.acc_report_close_checklist(uuid, date) to authenticated;
revoke all on function public.acc_close_period(uuid, date, jsonb) from public, anon;
grant execute on function public.acc_close_period(uuid, date, jsonb) to authenticated;
