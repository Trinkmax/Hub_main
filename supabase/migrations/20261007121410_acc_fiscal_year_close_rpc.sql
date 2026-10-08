-- Parte 2 de 2 de la migración #15 (acc_fiscal_year_close): cerrar y reabrir el ejercicio. Supone aplicada la
-- parte 1 (la matriz con fy_result/mirror: acc_validate_line valida cada renglón contra ella). Los revoke/grant de
-- cada función viajan con ella; cierra con notify pgrst.
-- ============================================================
-- Sprint 1 «Administración» · fase 4 · migración #15 (acc_fiscal_year_close) · spec §C.5.5, §E.5.18, §I.1 #15
-- ============================================================
-- Qué crea:
--   · private.acc_code_sort_key(código) → text   orden del plan por segmento numérico, el de compareAccountCodes
--     (lib/accounting/posting/year-end.ts: 1.1.9 antes que 1.1.10; con el mismo valor, «01» antes que «1»).
--   · private.acc_fy_write_document(…) → uuid      valida (acc_validate_line) y escribe un comprobante fy_* con su
--     asiento (acc_project_entry, proyección 1:1 de C.3.6); null si no tiene renglones.
--   · public.acc_close_fiscal_year(tenant, ejercicio, expected) → jsonb     C.5.5 (definer, EXECUTE authenticated)
--   · public.acc_reopen_fiscal_year(tenant, ejercicio, motivo) → jsonb      C.5.5 (definer, EXECUTE authenticated)
-- Usa: acc_assert_writer (#6), acc_ensure_fiscal_year y acc_next_doc_seq (#7), acc_validate_line,
-- acc_project_entry y acc_void_doc (#9), acc_period_snapshot_hash (#10), acc_entry_number_base (#5).
-- Lo que manda la server action (lib/accounting/actions/periods.ts): closeFiscalYear → p_expected =
-- {result_cents, balance_sheet_accounts} (lo que armó fiscalYearClosePreview con buildFiscalYearClose: el
-- resultado y la cantidad de renglones del cierre patrimonial) y lee {result_cents, fy_result_number,
-- fy_closing_number}; reopenFiscalYear → p_reason (lo valida reasonField) y no lee el retorno.
-- Desvíos de la spec (en db-api.md):
--   · Exige el ejercicio anterior cerrado (previous_fiscal_year_open): si no, los resultados que quedaron sin
--     refundir harían que el cierre patrimonial no cuadre (la vista previa del motor tampoco lo arma).
--   · Resultado por el TIPO de cada hoja (un grupo de resultados puede mezclar ingresos y egresos, #16). Una hoja
--     de resultado «de control» se refunde por partícipe (el trigger de líneas lo exige); el motor TS no tiene ese
--     caso. Un ejercicio sin saldos se cierra igual, sin comprobantes.
--   · Reapertura: si una línea de la refundición tiene una imputación vigente → document_has_allocations.
-- ============================================================

-- ─── 1. Orden del plan de cuentas ────────────────────────────────────────────
-- Clave de orden de un código «n.n.nn…» (números y puntos, ≤ 24): por segmento, el valor numérico (24 dígitos) y,
-- a igual valor, primero el de más caracteres (como `x < y` en JS: «01» < «1»); un prefijo va antes. Comparar
-- con collate "C" ('.' < '0').
create function private.acc_code_sort_key(p_code text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select string_agg(lpad(coalesce(nullif(ltrim(s.seg, '0'), ''), '0'), 24, '0')
                    || lpad((99 - char_length(s.seg))::text, 2, '0'), '.' order by s.ord)
    from unnest(string_to_array(p_code, '.')) with ordinality as s(seg, ord)
$$;

-- ─── 2. Escribir un comprobante del cierre de ejercicio ──────────────────────
-- p_lines = [{line_no, account_id, party_id?, side, amount_cents, memo}] (role = fy_result o mirror según el
-- tipo). Cada renglón pasa por acc_validate_line (matriz de la parte 1, cuenta imputable y activa, regla
-- fy_result = hoja de ingreso o egreso o «Resultado del ejercicio», mirror = hoja patrimonial, partícipe ⇔ control
-- salvo en los espejos). Total = Σ Debe; el asiento lo proyecta acc_project_entry (mismo tipo que el comprobante).
create function private.acc_fy_write_document(p_tenant uuid, p_actor uuid, p_bundle uuid, p_period_id uuid,
                                              p_kind text, p_date date, p_description text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid := gen_random_uuid();
  v_role text := case when p_kind = 'fy_result' then 'fy_result' else 'mirror' end;
  v_ref text := case p_kind when 'fy_result' then 'd1' when 'fy_closing' then 'd2' else 'd3' end;
  x jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    return null;
  end if;
  for x in select l.value from jsonb_array_elements(p_lines) as l(value) loop
    perform private.acc_validate_line(p_tenant, jsonb_build_object('ref', v_ref, 'kind', p_kind),
                                      x || jsonb_build_object('role', v_role), '{}'::jsonb);
  end loop;
  insert into public.acc_documents (id, tenant_id, bundle_id, period_id, seq, kind, issue_date, accounting_date,
                                    description, total_cents, created_by, created_by_name)
  values (v_doc, p_tenant, p_bundle, p_period_id, private.acc_next_doc_seq(p_tenant), p_kind, p_date, p_date,
          left(p_description, 200),
          (select coalesce(sum((y.value ->> 'amount_cents')::bigint), 0)
             from jsonb_array_elements(p_lines) as y(value) where y.value ->> 'side' = 'debit'),
          p_actor, private.acc_actor_name(p_tenant, p_actor));
  insert into public.acc_document_lines (tenant_id, document_id, line_no, role, account_id, side, amount_cents,
                                         party_id, memo)
  select p_tenant, v_doc, (y.value ->> 'line_no')::smallint, v_role, (y.value ->> 'account_id')::uuid,
         (y.value ->> 'side')::public.acc_side, (y.value ->> 'amount_cents')::bigint, (y.value ->> 'party_id')::uuid,
         left(nullif(y.value ->> 'memo', ''), 200)
    from jsonb_array_elements(p_lines) as y(value);
  perform private.acc_project_entry(p_tenant, v_doc, p_kind, p_actor);
  return v_doc;
end;
$$;

-- ─── 3. Cerrar el ejercicio (C.5.5, E.5.18) ──────────────────────────────────
-- p_expected = {"result_cents", "balance_sheet_accounts"} (lo que vio la persona). Bajo el lock del bar:
--  1. Ejercicio del bar (fiscal_year_not_found) y abierto (fiscal_year_closed); el anterior cerrado
--     (previous_fiscal_year_open); todos sus meses cerrados (periods_open {month}); su período fy_adjustments
--     abierto (FOR UPDATE). El siguiente: acc_ensure_fiscal_year(fin + 1) y su período fy_opening abierto.
--  2. Resultado = −Σ (Debe − Haber) de las hojas de ingreso o egreso (por el tipo de CADA hoja), asientos
--     vigentes no espejo del ejercicio, incluidos los ajustes de cierre (positivo = ganancia). Saldos
--     patrimoniales = toda la historia hasta el fin (sin espejos) + la refundición en «Resultado del ejercicio».
--     Si el resultado o la cantidad de cuentas patrimoniales con saldo no son los que vio → preview_stale
--     {fiscal_year_id, current: {result_cents, balance_sheet_accounts}}.
--  3. Refundición (fy_result, período de ajustes, fecha = fin): una línea por hoja de resultado con saldo (por
--     partícipe si es de control), del lado que la deja en cero, en el orden del plan; la diferencia a
--     current_year_result (Haber si es ganancia). Mueve saldos.
--  4. Cierre patrimonial (fy_closing, espejo, misma fecha): cancela cada cuenta patrimonial por su saldo, sin
--     partícipe. 5. Apertura (fy_opening, espejo, período fy_opening del siguiente, fecha = su inicio): la inversa.
--  6. Numera el período de ajustes después del último número del ejercicio (ajustes de la contadora,
--     refundición y cierre: order_key 7, 8, 9) y lo cierra con su foto; la apertura espejo toma el N° 1 del
--     ejercicio siguiente y su período se cierra con su foto.
--  7. Ejercicio closed, evento fy_closed, audita acc_fiscal_year.closed. Devuelve {result_cents,
--     fy_result_number, fy_closing_number, …}.
create function public.acc_close_fiscal_year(p_tenant_id uuid, p_fiscal_year_id uuid, p_expected jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_fy public.acc_fiscal_years;
  v_prev public.acc_fiscal_years;
  v_open_month date;
  v_adj public.acc_periods;
  v_next_id uuid;
  v_opn public.acc_periods;
  v_cyr public.acc_accounts;
  v_exp jsonb := case when jsonb_typeof(p_expected) = 'object' then p_expected else '{}'::jsonb end;
  v_stale boolean;
  v_res jsonb;
  v_mir jsonb;
  v_result bigint;
  v_bs integer;
  v_lr jsonb;
  v_lc jsonb;
  v_lo jsonb;
  v_label text;
  v_bundle uuid := gen_random_uuid();
  v_doc_r uuid;
  v_doc_c uuid;
  v_doc_o uuid;
  v_docs uuid[];
  v_base integer;
  v_from integer;
  v_to integer;
  v_count integer;
  v_debit bigint;
  v_hash text;
  v_ocount integer;
  v_odebit bigint;
  v_ohash text;
  v_num_r integer;
  v_num_c integer;
  v_num_o integer;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  -- 1. Ejercicio, anterior, meses y períodos especiales.
  select * into v_fy from public.acc_fiscal_years f
   where f.id = p_fiscal_year_id and f.tenant_id = p_tenant_id
     for update;
  if not found then
    raise exception 'fiscal_year_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', p_fiscal_year_id)::text;
  end if;
  if v_fy.status = 'closed' then
    raise exception 'fiscal_year_closed' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_fy.id, 'end_date', v_fy.end_date)::text;
  end if;
  select * into v_prev from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.end_date < v_fy.start_date and f.status <> 'closed'
   order by f.end_date desc
   limit 1;
  if found then
    raise exception 'previous_fiscal_year_open' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_prev.id, 'start_date', v_prev.start_date,
                                  'end_date', v_prev.end_date)::text;
  end if;
  select min(p.month) into v_open_month from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.fiscal_year_id = v_fy.id and p.kind = 'month' and p.status <> 'closed';
  if v_open_month is not null then
    raise exception 'periods_open' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_open_month, 'fiscal_year_id', v_fy.id)::text;
  end if;
  select * into v_adj from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.fiscal_year_id = v_fy.id and p.kind = 'fy_adjustments'
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_fy.id)::text;
  end if;
  if v_adj.status <> 'open' then
    raise exception 'period_already_closed' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_adj.month)::text;
  end if;
  v_next_id := private.acc_ensure_fiscal_year(p_tenant_id, v_fy.end_date + 1);
  select * into v_opn from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.fiscal_year_id = v_next_id and p.kind = 'fy_opening'
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_next_id)::text;
  end if;
  if v_opn.status <> 'open' then
    raise exception 'period_already_closed' using errcode = 'P0001',
      detail = jsonb_build_object('month', v_opn.month)::text;
  end if;
  select * into v_cyr from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.system_key = 'current_year_result';
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'current_year_result')::text;
  end if;

  -- 2. Resultado (hojas de resultado del ejercicio) y saldos patrimoniales históricos al fin.
  select coalesce(jsonb_agg(jsonb_build_object('account_id', x.account_id, 'party_id', x.party_id,
                                               'balance', x.bal, 'memo', x.name)
                            order by private.acc_code_sort_key(x.code) collate "C", x.party_name, x.party_id), '[]'::jsonb),
         coalesce(-sum(x.bal), 0)::bigint
    into v_res, v_result
    from (select l.account_id, l.party_id, a.code, a.name, pt.name as party_name,
                 sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)::bigint as bal
            from public.acc_journal_lines l
            join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
            join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
            left join public.acc_parties pt on pt.id = l.party_id and pt.tenant_id = l.tenant_id
           where l.tenant_id = p_tenant_id and e.fiscal_year_id = v_fy.id and e.status = 'posted' and not e.is_mirror
             and a.type in ('income', 'expense')
           group by l.account_id, l.party_id, a.code, a.name, pt.name
          having sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end) <> 0) x;

  select coalesce(jsonb_agg(jsonb_build_object('account_id', y.id, 'balance', y.bal, 'memo', y.name)
                            order by private.acc_code_sort_key(y.code) collate "C"), '[]'::jsonb),
         count(*)::int
    into v_mir, v_bs
    from (select a.id, a.code, a.name,
                 coalesce(b.bal, 0) - case when a.id = v_cyr.id then v_result else 0 end as bal
            from public.acc_accounts a
            left join (select l.account_id,
                              sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)::bigint as bal
                         from public.acc_journal_lines l
                         join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
                        where l.tenant_id = p_tenant_id and l.entry_date <= v_fy.end_date and e.status = 'posted'
                          and not e.is_mirror
                        group by l.account_id) b on b.account_id = a.id
           where a.tenant_id = p_tenant_id and a.type in ('asset', 'liability', 'equity')
             and (b.account_id is not null or a.id = v_cyr.id)) y
   where y.bal <> 0;

  if jsonb_typeof(v_exp -> 'result_cents') is distinct from 'number'
     or jsonb_typeof(v_exp -> 'balance_sheet_accounts') is distinct from 'number' then
    v_stale := true;
  else
    v_stale := (v_exp ->> 'result_cents')::numeric <> v_result
               or (v_exp ->> 'balance_sheet_accounts')::numeric <> v_bs;
  end if;
  if v_stale then
    raise exception 'preview_stale' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_fy.id,
                                  'current', jsonb_build_object('result_cents', v_result,
                                                                'balance_sheet_accounts', v_bs))::text;
  end if;

  -- 3 a 5. Renglones: refundición (cada resultado del lado que lo cancela; la diferencia, al final), cierre
  -- patrimonial (cancela cada saldo) y apertura (lo repone), como buildFiscalYearClose.
  select coalesce(jsonb_agg(z.l order by z.n), '[]'::jsonb) into v_lr
    from (select r.n, jsonb_build_object('line_no', r.n, 'account_id', r.v ->> 'account_id',
                                         'party_id', r.v ->> 'party_id',
                                         'side', case when (r.v ->> 'balance')::bigint < 0 then 'debit' else 'credit' end,
                                         'amount_cents', abs((r.v ->> 'balance')::bigint), 'memo', r.v ->> 'memo') as l
            from jsonb_array_elements(v_res) with ordinality as r(v, n)
          union all
          select jsonb_array_length(v_res) + 1,
                 jsonb_build_object('line_no', jsonb_array_length(v_res) + 1, 'account_id', v_cyr.id,
                                    'side', case when v_result > 0 then 'credit' else 'debit' end,
                                    'amount_cents', abs(v_result), 'memo', 'Resultado del ejercicio')
           where v_result <> 0) z;
  select coalesce(jsonb_agg(jsonb_build_object('line_no', r.n, 'account_id', r.v ->> 'account_id',
                                               'side', case when (r.v ->> 'balance')::bigint < 0 then 'debit' else 'credit' end,
                                               'amount_cents', abs((r.v ->> 'balance')::bigint), 'memo', r.v ->> 'memo')
                            order by r.n), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('line_no', r.n, 'account_id', r.v ->> 'account_id',
                                               'side', case when (r.v ->> 'balance')::bigint > 0 then 'debit' else 'credit' end,
                                               'amount_cents', abs((r.v ->> 'balance')::bigint), 'memo', r.v ->> 'memo')
                            order by r.n), '[]'::jsonb)
    into v_lc, v_lo
    from jsonb_array_elements(v_mir) with ordinality as r(v, n);

  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  v_label := extract(year from v_fy.end_date)::int::text;
  v_doc_r := private.acc_fy_write_document(p_tenant_id, v_uid, v_bundle, v_adj.id, 'fy_result', v_fy.end_date,
                                           'Refundición de resultados del ejercicio ' || v_label, v_lr);
  v_doc_c := private.acc_fy_write_document(p_tenant_id, v_uid, v_bundle, v_adj.id, 'fy_closing', v_fy.end_date,
                                           'Cierre patrimonial del ejercicio ' || v_label, v_lc);
  v_doc_o := private.acc_fy_write_document(p_tenant_id, v_uid, v_bundle, v_opn.id, 'fy_opening', v_opn.starts_on,
                                           'Apertura del ejercicio siguiente a ' || v_label, v_lo);
  v_docs := array_remove(array[v_doc_r, v_doc_c, v_doc_o], null);
  if cardinality(v_docs) > 0 then
    insert into public.acc_bundles (id, tenant_id, client_ref, operation, request_hash, result, created_by,
                                    created_by_name)
    values (v_bundle, p_tenant_id, gen_random_uuid(), 'post',
            encode(sha256(convert_to(jsonb_build_object('kind', 'fy_close', 'fiscal_year_id', v_fy.id,
                                                        'result_cents', v_result, 'balance_sheet_accounts', v_bs,
                                                        'at', now())::text, 'UTF8')), 'hex'),
            jsonb_build_object('kind', 'fy_close', 'fiscal_year_id', v_fy.id, 'document_ids', to_jsonb(v_docs)),
            v_uid, v_name);
  end if;

  -- 6. Numeración definitiva y foto de los dos períodos especiales.
  perform set_config('acc.numbering', v_adj.id::text, true);
  v_base := public.acc_entry_number_base(v_fy.id);
  with ordered as (
    select e.id, row_number() over (order by e.entry_date, e.order_key, e.posting_seq) as rn
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.period_id = v_adj.id and e.status = 'posted' and e.number is null)
  update public.acc_journal_entries e
     set number = v_base + o.rn::int
    from ordered o
   where e.id = o.id;
  if v_doc_o is not null then
    perform set_config('acc.numbering', v_opn.id::text, true);
    update public.acc_journal_entries e set number = 1
     where e.tenant_id = p_tenant_id and e.document_id = v_doc_o;
  end if;
  perform set_config('acc.numbering', '', true);
  select e.number into v_num_r from public.acc_journal_entries e where e.tenant_id = p_tenant_id and e.document_id = v_doc_r;
  select e.number into v_num_c from public.acc_journal_entries e where e.tenant_id = p_tenant_id and e.document_id = v_doc_c;
  select e.number into v_num_o from public.acc_journal_entries e where e.tenant_id = p_tenant_id and e.document_id = v_doc_o;

  select count(*)::int, coalesce(sum(e.total_cents), 0)::bigint, min(e.number), max(e.number)
    into v_count, v_debit, v_from, v_to
    from public.acc_journal_entries e
   where e.tenant_id = p_tenant_id and e.period_id = v_adj.id and e.status = 'posted';
  v_hash := private.acc_period_snapshot_hash(v_adj.id);
  update public.acc_periods p
     set status = 'closed', closed_at = now(), closed_by = v_uid, closed_by_name = v_name,
         number_from = v_from, number_to = v_to, entries_count = v_count, debit_total_cents = v_debit,
         snapshot_hash = v_hash
   where p.id = v_adj.id;
  select count(*)::int, coalesce(sum(e.total_cents), 0)::bigint into v_ocount, v_odebit
    from public.acc_journal_entries e
   where e.tenant_id = p_tenant_id and e.period_id = v_opn.id and e.status = 'posted';
  v_ohash := private.acc_period_snapshot_hash(v_opn.id);
  update public.acc_periods p
     set status = 'closed', closed_at = now(), closed_by = v_uid, closed_by_name = v_name,
         number_from = v_num_o, number_to = v_num_o, entries_count = v_ocount, debit_total_cents = v_odebit,
         snapshot_hash = v_ohash
   where p.id = v_opn.id;

  -- 7. Ejercicio cerrado, evento y auditoría.
  update public.acc_fiscal_years f
     set status = 'closed', closed_at = now(), closed_by = v_uid, closed_by_name = v_name
   where f.id = v_fy.id;
  insert into public.acc_period_events (tenant_id, period_id, fiscal_year_id, action, reason, actor_id, actor_name, payload)
  values (p_tenant_id, v_adj.id, v_fy.id, 'fy_closed', null, v_uid, v_name,
          jsonb_build_object('result_cents', v_result, 'balance_sheet_accounts', v_bs,
                             'fy_result_number', v_num_r, 'fy_closing_number', v_num_c, 'fy_opening_number', v_num_o,
                             'number_from', v_from, 'number_to', v_to, 'entries_count', v_count,
                             'debit_total_cents', v_debit, 'snapshot_hash', v_hash,
                             'next_fiscal_year_id', v_next_id, 'opening_period_id', v_opn.id,
                             'opening_snapshot_hash', v_ohash));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_fiscal_year.closed', 'acc_fiscal_year', v_fy.id,
    jsonb_build_object('start_date', v_fy.start_date, 'end_date', v_fy.end_date, 'result_cents', v_result,
                       'fy_result_number', v_num_r, 'fy_closing_number', v_num_c, 'fy_opening_number', v_num_o,
                       'document_ids', to_jsonb(v_docs)));

  return jsonb_build_object(
    'fiscal_year_id', v_fy.id,
    'start_date', v_fy.start_date,
    'end_date', v_fy.end_date,
    'result_cents', v_result,
    'balance_sheet_accounts', v_bs,
    'fy_result_number', v_num_r,
    'fy_closing_number', v_num_c,
    'fy_opening_number', v_num_o,
    'fy_result_document_id', v_doc_r,
    'fy_closing_document_id', v_doc_c,
    'fy_opening_document_id', v_doc_o,
    'adjustments_period_id', v_adj.id,
    'number_from', v_from,
    'number_to', v_to,
    'entries_count', v_count,
    'debit_total_cents', v_debit,
    'snapshot_hash', v_hash,
    'next_fiscal_year_id', v_next_id,
    'opening_period_id', v_opn.id);
end;
$$;

-- ─── 4. Reabrir el ejercicio (C.5.5) ─────────────────────────────────────────
-- Ejercicio del bar (fiscal_year_not_found) y cerrado (fiscal_year_not_closed); el siguiente no cerrado
-- (next_fiscal_year_closed); motivo ≥ 5 letras (reason_required). Reabre los dos períodos especiales (sin foto),
-- borra sus números (los ajustes de la contadora vuelven a provisorios), anula la refundición, el cierre y la
-- apertura espejo («Reapertura del ejercicio»), deja el ejercicio abierto, registra fy_reopened con el motivo y
-- audita acc_fiscal_year.reopened. Devuelve {fiscal_year_id, voided_document_ids, voided_count, numbers_cleared}.
create function public.acc_reopen_fiscal_year(p_tenant_id uuid, p_fiscal_year_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_fy public.acc_fiscal_years;
  v_next public.acc_fiscal_years;
  v_adj public.acc_periods;
  v_opn public.acc_periods;
  v_docs uuid[];
  v_doc uuid;
  v_allocs integer;
  v_n integer;
  v_cleared integer := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_fy from public.acc_fiscal_years f
   where f.id = p_fiscal_year_id and f.tenant_id = p_tenant_id
     for update;
  if not found then
    raise exception 'fiscal_year_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', p_fiscal_year_id)::text;
  end if;
  if v_fy.status <> 'closed' then
    raise exception 'fiscal_year_not_closed' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_fy.id, 'end_date', v_fy.end_date)::text;
  end if;
  select * into v_next from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.start_date = v_fy.end_date + 1
     for update;
  if found and v_next.status = 'closed' then
    raise exception 'next_fiscal_year_closed' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_next.id, 'end_date', v_next.end_date)::text;
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v_reason := left(v_reason, 300);

  select * into v_adj from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.fiscal_year_id = v_fy.id and p.kind = 'fy_adjustments'
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001',
      detail = jsonb_build_object('fiscal_year_id', v_fy.id)::text;
  end if;
  if v_next.id is not null then
    select * into v_opn from public.acc_periods p
     where p.tenant_id = p_tenant_id and p.fiscal_year_id = v_next.id and p.kind = 'fy_opening'
       for update;
  end if;

  -- Los comprobantes que generó el cierre (vigentes).
  select coalesce(array_agg(d.id order by d.seq), '{}') into v_docs
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.status = 'posted'
     and ((d.period_id = v_adj.id and d.kind in ('fy_result', 'fy_closing'))
          or (d.period_id = v_opn.id and d.kind = 'fy_opening'));
  select count(*)::int into v_allocs
    from public.acc_journal_lines l
    join public.acc_allocations a on a.tenant_id = l.tenant_id and a.voided_on is null
                                 and (a.debit_line_id = l.id or a.credit_line_id = l.id)
   where l.tenant_id = p_tenant_id and l.document_id = any (v_docs);
  if v_allocs > 0 then
    raise exception 'document_has_allocations' using errcode = 'P0001',
      detail = jsonb_build_object('count', v_allocs)::text;
  end if;

  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  -- Primero se reabren los períodos: la guardia de asientos exige el período abierto para tocar números y estados.
  update public.acc_periods p
     set status = 'open', closed_at = null, closed_by = null, closed_by_name = null,
         number_from = null, number_to = null, entries_count = null, debit_total_cents = null, snapshot_hash = null
   where p.tenant_id = p_tenant_id and p.id in (v_adj.id, v_opn.id) and p.status = 'closed';
  perform set_config('acc.numbering', v_adj.id::text, true);
  update public.acc_journal_entries e set number = null
   where e.tenant_id = p_tenant_id and e.period_id = v_adj.id and e.number is not null;
  get diagnostics v_n = row_count;
  v_cleared := v_n;
  if v_opn.id is not null then
    perform set_config('acc.numbering', v_opn.id::text, true);
    update public.acc_journal_entries e set number = null
     where e.tenant_id = p_tenant_id and e.period_id = v_opn.id and e.number is not null;
    get diagnostics v_n = row_count;
    v_cleared := v_cleared + v_n;
  end if;
  perform set_config('acc.numbering', '', true);
  foreach v_doc in array v_docs loop
    perform private.acc_void_doc(p_tenant_id, v_uid, v_name, v_doc, 'Reapertura del ejercicio');
  end loop;

  update public.acc_fiscal_years f
     set status = 'open', closed_at = null, closed_by = null, closed_by_name = null
   where f.id = v_fy.id;
  insert into public.acc_period_events (tenant_id, period_id, fiscal_year_id, action, reason, actor_id, actor_name, payload)
  values (p_tenant_id, v_adj.id, v_fy.id, 'fy_reopened', v_reason, v_uid, v_name,
          jsonb_build_object('voided_count', cardinality(v_docs), 'numbers_cleared', v_cleared,
                             'number_from', v_adj.number_from, 'number_to', v_adj.number_to,
                             'snapshot_hash', v_adj.snapshot_hash, 'opening_period_id', v_opn.id));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_fiscal_year.reopened', 'acc_fiscal_year', v_fy.id,
    jsonb_build_object('start_date', v_fy.start_date, 'end_date', v_fy.end_date,
                       'voided_count', cardinality(v_docs), 'numbers_cleared', v_cleared));

  return jsonb_build_object('fiscal_year_id', v_fy.id, 'voided_document_ids', to_jsonb(v_docs),
                            'voided_count', cardinality(v_docs), 'numbers_cleared', v_cleared);
end;
$$;

comment on function private.acc_code_sort_key(text) is
  'Clave de orden de un código de cuenta por segmento numérico (compareAccountCodes del motor). Comparar con collate "C".';
comment on function private.acc_fy_write_document(uuid, uuid, uuid, uuid, text, date, text, jsonb) is
  'Valida (acc_validate_line) y escribe un comprobante fy_result/fy_closing/fy_opening con su asiento (C.3.6). Null si no tiene renglones.';
comment on function public.acc_close_fiscal_year(uuid, uuid, jsonb) is
  'Cierra el ejercicio (C.5.5): refundición, cierre y apertura espejo del siguiente (N° 1), numeración y foto de los períodos especiales, comparando con lo que vio el usuario (preview_stale).';
comment on function public.acc_reopen_fiscal_year(uuid, uuid, text) is
  'Reabre un ejercicio cerrado si el siguiente no lo está (C.5.5): anula refundición, cierre y apertura espejo, reabre los períodos especiales y registra el motivo.';

revoke all on function private.acc_code_sort_key(text) from public, anon, authenticated;
revoke all on function private.acc_fy_write_document(uuid, uuid, uuid, uuid, text, date, text, jsonb) from public, anon, authenticated;
revoke all on function public.acc_close_fiscal_year(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_close_fiscal_year(uuid, uuid, jsonb) to authenticated;
revoke all on function public.acc_reopen_fiscal_year(uuid, uuid, text) from public, anon;
grant execute on function public.acc_reopen_fiscal_year(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
