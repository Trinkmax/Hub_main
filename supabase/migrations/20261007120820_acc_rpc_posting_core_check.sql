-- Parte 3 de 5 de la migración #9 (acc_rpc_posting_core): validación de cada comprobante del bundle (C.3.3
-- paso 5). Interna (private, SECURITY DEFINER, sin EXECUTE para nadie); la usa acc_post_bundle (parte 4) bajo el
-- lock del bar. Mismas sentencias y orden que el diseño de la #9.
--   · acc_check_document: partícipe, fechas, período, tipo de comprobante, duplicados, renglones vía
--     acc_validate_line, IVA, totales y cuadre, comprobante fiscal y reglas propias del tipo. Devuelve el
--     comprobante normalizado + period_id, fiscal_year_id, treasury_id y los avisos que encontró.

-- ─── 1. Validación del comprobante (paso 5) ──────────────────────────────────
create function private.acc_check_document(p_tenant uuid, p_n jsonb, p_bctx jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb := jsonb_build_object('document', p_n ->> 'ref');
  v_kind text := p_n ->> 'kind';
  v_ek text := p_n ->> 'entry_kind';
  v_vt text := p_n ->> 'voucher_type';
  v_party_id uuid := (p_n ->> 'party_id')::uuid;
  v_issue date := (p_n ->> 'issue_date')::date;
  v_date date := (p_n ->> 'accounting_date')::date;
  v_due date := (p_n ->> 'due_date')::date;
  v_pos bigint := (p_n ->> 'point_of_sale')::bigint;
  v_num bigint := (p_n ->> 'number')::bigint;
  v_total bigint := (p_n ->> 'total_cents')::bigint;
  v_counted bigint := (p_n ->> 'counted_cents')::bigint;
  v_expected bigint := (p_n ->> 'expected_book_cents')::bigint;
  v_replaces uuid := (p_n ->> 'replaces_document_id')::uuid;
  v_settles boolean := coalesce((p_n ->> 'settles_commissions')::boolean, false);
  v_lines jsonb := p_n -> 'lines';
  v_fvs jsonb := coalesce(p_n -> 'fiscal_vouchers', '[]'::jsonb);
  v_acks text[] := array(select jsonb_array_elements_text(coalesce(p_n -> 'warnings_ack', '[]'::jsonb)));
  v_today date := (p_bctx ->> 'today')::date;
  v_purchase boolean := v_kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note');
  v_sales_doc boolean := v_kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note');
  s public.acc_settings;
  p public.acc_parties;
  v_old public.acc_documents;
  v_fyr public.acc_fiscal_years;
  v_per public.acc_periods;
  f public.acc_fiscal_vouchers;
  v_letter text;
  v_pvat text;
  v_ivabook boolean := false;
  v_numbered boolean := false;
  t record;
  v_a record;
  r record;
  v_j jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_latest date;
  v_fy uuid;
  v_ok boolean;
  v_txt text;
  v_rule text;
  v_tid uuid;
  v_tk text;
  v_tname text;
  v_dup date;
  v_diff bigint;
  v_tol bigint;
  v_exp bigint;
  v_bal bigint;
  v_acc uuid;
begin
  select * into s from public.acc_settings x where x.tenant_id = p_tenant;

  -- Paso 3: forma de la cabecera.
  if v_ek is null or not (v_ek = any (case v_kind when 'opening' then array['opening']
                                                  when 'manual' then array['manual', 'adjustment', 'payroll', 'fy_adjustment']
                                                  else array['standard'] end)) then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"entry_kind"}');
  end if;
  if v_issue is null or v_date is null then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"dates"}');
  end if;
  if char_length(p_n ->> 'description') not between 1 and 200 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"description"}');
  end if;
  if coalesce(char_length(p_n ->> 'notes'), 0) > 1000 or coalesce(char_length(p_n ->> 'shift'), 0) > 20 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"text_length"}');
  end if;
  if v_total is null or v_total not between 0 and 1000000000000000 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"total_range"}');
  end if;
  if v_pos not between 0 and 99999 or v_num not between 1 and 99999999
     or (p_n ->> 'afip_voucher_code')::bigint not between 0 and 32767 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"voucher_number_range"}');
  end if;
  if v_vt is not null then
    select vi.letter, vi.purchase_vat, vi.iva_book, vi.numbered into v_letter, v_pvat, v_ivabook, v_numbered
      from private.acc_voucher_info(v_vt) vi;
    if not found then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"voucher_type"}');
    end if;
    if v_numbered and v_kind <> 'expense' and (v_pos is null or v_num is null) then
      perform private.acc_raise('voucher_number_required', w);
    end if;
  end if;
  if p_n ->> 'override_reason' is not null and char_length(p_n ->> 'override_reason') not between 5 and 300 then
    perform private.acc_raise('reason_required', w);
  end if;
  if (v_counted is null) <> (v_expected is null) or abs(v_counted) > 1000000000000000 or abs(v_expected) > 1000000000000000
     or (v_kind = 'treasury_adjustment' and v_counted is null) then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"balance_check_pair"}');
  end if;
  if v_counted is not null and v_kind not in ('treasury_adjustment', 'collection') then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"balance_check_kind"}');
  end if;

  -- 5.1 Partícipe: del bar (ya resuelto), activo, obligatorio y de un tipo compatible.
  if v_party_id is null then
    if v_purchase or v_sales_doc or v_kind in ('payment', 'collection') then
      perform private.acc_raise('party_required', w);
    end if;
  else
    select * into p from public.acc_parties x where x.id = v_party_id and x.tenant_id = p_tenant;
    if not p.active then
      perform private.acc_raise('party_inactive', w);
    end if;
    if ((v_purchase or v_kind = 'expense') and p.kind = 'customer')
       or (v_sales_doc and p.kind not in ('customer', 'partner', 'other'))
       or (v_kind = 'collection' and p.kind not in ('customer', 'card_processor', 'payment_wallet', 'delivery_platform',
                                                     'partner', 'other')) then
      perform private.acc_raise('party_kind_mismatch', w || jsonb_build_object('party_name', coalesce(p.trade_name, p.name),
        'party_role', case when v_sales_doc then 'customer' else 'supplier' end));
    end if;
    if v_vt = 'ddjj_impuesto' and p.kind <> 'tax_agency' then
      perform private.acc_raise('ddjj_requires_tax_agency', w);
    end if;
  end if;

  -- 5.2 Fechas.
  if v_date < s.books_start_date then
    perform private.acc_raise('date_before_start', w || jsonb_build_object('books_start_date', s.books_start_date));
  end if;
  v_latest := case when v_kind = 'manual' then (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date
                   else v_today end;
  if v_date > v_latest or v_issue > v_latest then
    perform private.acc_raise('date_in_future', w);
  end if;
  if v_issue > v_date then
    perform private.acc_raise('accounting_before_issue', w);
  end if;
  if v_due < v_issue then
    perform private.acc_raise('due_before_issue', w);
  end if;
  if v_purchase and v_date - v_issue > 60 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'late_registration', 'document', p_n ->> 'ref',
                'issue_date', v_issue, 'accounting_month', to_char(v_date, 'YYYY-MM')));
  end if;

  -- 5.3 Período (crea el ejercicio si falta) y abierto.
  v_fy := private.acc_ensure_fiscal_year(p_tenant, v_date);
  if v_ek = 'fy_adjustment' then
    select * into v_fyr from public.acc_fiscal_years x where x.id = v_fy and x.tenant_id = p_tenant;
    if v_date <> v_fyr.end_date then
      perform private.acc_raise('fy_adjustment_date', w || jsonb_build_object('end_date', v_fyr.end_date));
    end if;
    v_per := private.acc_period_for(p_tenant, v_date, 'fy_adjustments');
  else
    v_per := private.acc_period_for(p_tenant, v_date, 'month');
  end if;
  if v_per.status <> 'open' then
    perform private.acc_raise('period_closed', w || jsonb_build_object('month', to_char(v_per.month, 'YYYY-MM')));
  end if;

  -- 5.4 Tipo de comprobante: permitido para el documento (voucherTypesForKind) y para la condición del
  -- partícipe en compras (matriz de E.3).
  v_ok := case
    when v_kind in ('purchase', 'purchase_debit_note') then v_vt in ('factura_a', 'nota_debito_a', 'recibo_a', 'factura_b',
         'nota_debito_b', 'recibo_b', 'factura_c', 'nota_debito_c', 'recibo_c', 'factura_m', 'nota_debito_m',
         'tique_factura_a', 'tique_factura_b', 'tique_factura_c', 'tique', 'otro_comprobante', 'ddjj_impuesto',
         'sin_comprobante')
    when v_kind = 'purchase_credit_note' then v_vt in ('nota_credito_a', 'nota_credito_b', 'nota_credito_c', 'nota_credito_m')
    when v_kind = 'expense' then v_vt in ('sin_comprobante', 'tique')
    when v_kind in ('sales_invoice', 'sales_debit_note') then v_vt in ('factura_a', 'factura_b', 'nota_debito_a',
         'nota_debito_b', 'tique_factura_a', 'tique_factura_b')
    when v_kind = 'sales_credit_note' then v_vt in ('nota_credito_a', 'nota_credito_b')
    when v_kind = 'collection' then v_vt is null or v_vt in ('liquidacion', 'factura_a', 'factura_b', 'otro_comprobante')
    when v_kind = 'bank_expense' then v_vt is null or v_vt in ('resumen_bancario', 'factura_a', 'otro_comprobante')
    else v_vt is null end;
  if not coalesce(v_ok, false) then
    perform private.acc_raise('invalid_voucher_for_kind', w);
  end if;
  if v_purchase and v_pvat = 'no'
     and exists (select 1 from jsonb_array_elements(v_lines) l where l.value ->> 'role' in ('net', 'vat')) then
    perform private.acc_raise('vat_not_allowed_for_voucher', w);
  end if;
  if v_purchase and v_party_id is not null then
    v_txt := case p.iva_condition
      when 'responsable_inscripto' then case when v_letter = 'C' then 'rejected' when v_letter = 'M' then 'voucher_m'
                                             when v_letter = 'B' or v_vt in ('tique', 'sin_comprobante')
                                               then 'voucher_condition' end
      when 'monotributo' then case when v_letter in ('A', 'B', 'M') then 'rejected' end
      when 'exento' then case when v_letter in ('A', 'M') then 'rejected' end
      else case when v_letter is not null then 'rejected' end end;
    if v_txt = 'rejected' then
      perform private.acc_raise('invalid_voucher_for_condition',
        w || jsonb_build_object('condition', p.iva_condition, 'voucher_type', v_vt));
    elsif v_txt is not null then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', v_txt, 'document', p_n ->> 'ref', 'voucher_type', v_vt));
    end if;
  end if;

  -- «Corregir» (C.4.2): el viejo es del bar, está vigente, es del mismo tipo y su mes está abierto.
  if v_replaces is not null then
    select * into v_old from public.acc_documents x where x.id = v_replaces and x.tenant_id = p_tenant for update;
    if not found then
      perform private.acc_raise('document_not_found', w);
    end if;
    if v_old.status <> 'posted' then
      perform private.acc_raise('document_voided', w);
    end if;
    if v_old.kind <> v_kind then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"replaces_kind"}');
    end if;
    select x.status, x.month into t from public.acc_periods x where x.id = v_old.period_id;
    if t.status <> 'open' then
      perform private.acc_raise('cannot_void_closed_period', w || jsonb_build_object('month', to_char(t.month, 'YYYY-MM')));
    end if;
  end if;

  -- 5.5 Duplicados (sin contar el comprobante que se corrige).
  if v_purchase and v_num is not null then
    select x.accounting_date into v_dup from public.acc_documents x
     where x.tenant_id = p_tenant and x.party_id = v_party_id and x.voucher_type = v_vt and x.point_of_sale = v_pos
       and x.number = v_num and x.status = 'posted' and x.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note')
       and x.id is distinct from v_replaces
     limit 1;
    if found then
      perform private.acc_raise('duplicate_document', w || jsonb_build_object('voucher_type', v_vt, 'point_of_sale', v_pos,
        'number', v_num, 'date', v_dup));
    end if;
  end if;
  if v_sales_doc then
    select x.accounting_date into v_dup from public.acc_documents x
     where x.tenant_id = p_tenant and x.voucher_type = v_vt and x.point_of_sale = v_pos and x.number = v_num
       and x.status = 'posted' and x.kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note')
       and x.id is distinct from v_replaces
     limit 1;
    if found then
      perform private.acc_raise('duplicate_document', w || jsonb_build_object('voucher_type', v_vt, 'point_of_sale', v_pos,
        'number', v_num, 'date', v_dup));
    end if;
  end if;
  if v_kind = 'sales_close' and exists (select 1 from public.acc_documents x
       where x.tenant_id = p_tenant and x.kind = 'sales_close' and x.status = 'posted' and x.accounting_date = v_date
         and coalesce(x.shift, '') = coalesce(p_n ->> 'shift', '') and x.id is distinct from v_replaces) then
    perform private.acc_raise('daily_close_exists', w || jsonb_build_object('date', v_date));
  end if;
  if v_kind = 'opening' then
    if v_date <> s.books_start_date then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"opening_date"}');
    end if;
    if s.opening_status <> 'pending' and v_replaces is null then
      perform private.acc_raise('opening_exists', w);
    end if;
  end if;
  -- Aviso «posible duplicado»: gasto o compra sin número igual a otro (mismo partícipe, o sin partícipe la misma
  -- cuenta), mismo total y fechas a un día o menos.
  if (v_kind = 'expense' or v_purchase) and v_num is null then
    v_acc := (select (l.value ->> 'account_id')::uuid from jsonb_array_elements(v_lines) with ordinality l(value, i)
               where l.value ->> 'role' in ('gross', 'net') order by l.i limit 1);
    select x.accounting_date, coalesce(x.party_name_snapshot, x.description) as label into t
      from public.acc_documents x
     where x.tenant_id = p_tenant and x.status = 'posted' and x.number is null and x.total_cents = v_total
       and x.kind in ('expense', 'purchase', 'purchase_credit_note', 'purchase_debit_note')
       and abs(x.accounting_date - v_date) <= 1 and x.id is distinct from v_replaces
       and x.bundle_id is distinct from (p_bctx ->> 'bundle_id')::uuid
       and ((v_party_id is not null and x.party_id = v_party_id)
            or (v_party_id is null and x.party_id is null
                and exists (select 1 from public.acc_document_lines dl
                             where dl.document_id = x.id and dl.role in ('gross', 'net') and dl.account_id = v_acc)))
     order by abs(x.accounting_date - v_date), x.seq desc
     limit 1;
    if found then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'possible_duplicate', 'document', p_n ->> 'ref',
                  'amount_cents', v_total, 'party_name', t.label, 'date', t.accounting_date));
    end if;
  end if;

  -- 5.6 Renglones contra la matriz (la caja del documento decide las cuentas de reparto de un arqueo).
  v_tid := (select (l.value ->> 'treasury_account_id')::uuid from jsonb_array_elements(v_lines) with ordinality l(value, i)
             where l.value ->> 'role' = 'treasury' and l.value ->> 'treasury_account_id' is not null order by l.i limit 1);
  if v_tid is not null then
    select x.kind, x.name into v_tk, v_tname from public.acc_treasury_accounts x where x.id = v_tid and x.tenant_id = p_tenant;
  end if;
  if v_kind in ('manual', 'opening') and jsonb_array_length(v_lines) < 2 then
    perform private.acc_raise('entry_too_few_lines', w);
  end if;
  for v_j in select l.value from jsonb_array_elements(v_lines) l loop
    perform private.acc_validate_line(p_tenant,
      jsonb_build_object('ref', p_n ->> 'ref', 'kind', v_kind, 'party_id', v_party_id, 'voucher_type', v_vt,
                         'settles_commissions', v_settles, 'fiscal_count', jsonb_array_length(v_fvs)),
      v_j,
      jsonb_build_object('sas_iva_condition', s.iva_condition, 'uninvoiced_sales_mode', s.uninvoiced_sales_mode,
                         'treasury_kind', v_tk, 'treasury_name', v_tname));
  end loop;

  -- 5.7 IVA contra lo calculado: ≤ tolerancia pasa; hasta max(100, ⌈1 %⌉) es aviso vat_diff; más, error.
  -- En el cierre del día se mira cada rango (tolerancia max(ajuste, min(N, 50))).
  for r in
    select l.vat_rate_bp as rate, l.amount_cents as given, l.vat_computed_cents as computed,
           s.vat_tolerance_cents::bigint as tol
      from jsonb_populate_recordset(null::public.acc_document_lines, v_lines) l
     where l.role = 'vat' and v_kind <> 'sales_close'
    union all
    select c.rate, (fv.value ->> c.vat_key)::bigint,
           ((fv.value ->> c.net_key)::bigint * c.rate + 5000) / 10000,
           greatest(s.vat_tolerance_cents::bigint,
                    least(coalesce((fv.value ->> 'number_to')::bigint - (fv.value ->> 'number_from')::bigint + 1, 1), 50))
      from jsonb_array_elements(v_fvs) fv
      cross join (values (250, 'net_25_cents', 'vat_25_cents'), (500, 'net_5_cents', 'vat_5_cents'),
                         (1050, 'net_105_cents', 'vat_105_cents'), (2100, 'net_21_cents', 'vat_21_cents'),
                         (2700, 'net_27_cents', 'vat_27_cents')) as c(rate, net_key, vat_key)
     where v_kind = 'sales_close' and fv.value ->> 'book' = 'sales'
  loop
    v_diff := abs(r.given - r.computed);
    if v_diff > r.tol then
      if v_diff <= greatest(100, (r.computed + 99) / 100) then
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'vat_diff', 'document', p_n ->> 'ref',
                    'rate_bp', r.rate, 'diff_cents', v_diff));
      else
        perform private.acc_raise('vat_out_of_tolerance', w || jsonb_build_object('rate_bp', r.rate));
      end if;
    end if;
  end loop;

  -- 5.8 Cuadre, cantidades por rol y total por tipo (validateStructure / validateTotals).
  select count(*) filter (where l.role = 'treasury') as n_tr,
         count(*) filter (where l.role = 'treasury' and l.side = 'debit') as n_tr_d,
         count(*) filter (where l.role = 'treasury' and l.side = 'credit') as n_tr_c,
         count(distinct l.treasury_account_id) filter (where l.role = 'treasury') as n_tr_distinct,
         count(*) filter (where l.role = 'gross') as n_gross,
         count(*) filter (where l.role = 'compensation') as n_comp,
         count(distinct l.account_id) filter (where l.role = 'control') as n_ctrl_acc,
         coalesce(sum(l.amount_cents) filter (where l.side = 'debit'), 0) as s_d,
         coalesce(sum(l.amount_cents) filter (where l.side = 'credit'), 0) as s_c,
         coalesce(sum(l.amount_cents) filter (where l.role = 'treasury'), 0) as s_tr,
         coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.role = 'treasury'), 0) as tr_dc,
         coalesce(max(l.amount_cents) filter (where l.role = 'treasury'), 0) as tr_max,
         coalesce(min(l.amount_cents) filter (where l.role = 'treasury'), 0) as tr_min,
         coalesce(sum(l.amount_cents) filter (where l.role = 'control'), 0) as s_ctrl,
         coalesce(sum(l.amount_cents) filter (where l.role = 'gross'), 0) as s_gross,
         coalesce(sum(l.amount_cents) filter (where l.role = 'write_off'), 0) as s_wo,
         coalesce(sum(l.amount_cents) filter (where l.role in ('receivable', 'advance')), 0) as s_recv,
         coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.role = 'cash_diff'), 0) as cash_diff
    into t
    from jsonb_populate_recordset(null::public.acc_document_lines, v_lines) l;
  if t.s_d <> t.s_c then
    perform private.acc_raise('entry_not_balanced', w || jsonb_build_object('debit_cents', t.s_d, 'credit_cents', t.s_c));
  end if;
  if v_kind = 'expense' and (t.n_tr <> 1 or t.n_gross > 20) then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"expense_shape"}');
  elsif v_kind in ('bank_expense', 'cash_movement', 'treasury_adjustment') and t.n_tr <> 1 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"one_treasury"}');
  elsif v_kind = 'transfer' then
    if t.n_tr <> 2 or t.n_tr_d <> 1 or t.n_tr_c <> 1 then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"transfer_shape"}');
    end if;
    if t.n_tr_distinct < 2 then
      perform private.acc_raise('same_treasury', w);
    end if;
    if t.tr_max <> t.tr_min then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"transfer_amounts"}');
    end if;
  elsif v_kind = 'payment' then
    if t.n_tr + t.n_comp = 0 then
      perform private.acc_raise('amount_required', w);
    end if;
    if t.s_wo > 100000 then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"write_off_cap"}');
    end if;
  end if;
  if v_kind in ('payment', 'collection') and t.n_ctrl_acc > 1 then
    perform private.acc_raise('mixed_control_accounts', w);
  end if;
  v_exp := case
    when v_purchase then case when v_settles then null else t.s_ctrl end
    when v_kind in ('expense', 'bank_expense', 'cash_movement', 'treasury_adjustment') then t.s_tr
    when v_kind in ('payment', 'collection') or v_sales_doc then t.s_ctrl
    when v_kind = 'transfer' then t.tr_max
    when v_kind = 'sales_close' then t.s_tr + t.cash_diff + t.s_recv
    else t.s_d end;
  if v_exp <> v_total then
    perform private.acc_raise('total_mismatch', w || jsonb_build_object('computed_cents', v_exp, 'control_cents', v_total));
  end if;
  if v_kind = 'expense' and t.s_gross <> v_total then
    perform private.acc_raise('total_mismatch', w || jsonb_build_object('computed_cents', t.s_gross, 'control_cents', v_total));
  end if;

  -- 5.9 Comprobante fiscal: obligatorio o prohibido según el tipo, forma de cada fila, CUIT, identidad, foto de la
  -- contraparte y rangos de ventas que se pisan. La conciliación con los renglones la hace acc_reconcile_fiscal.
  v_rule := case
    when v_purchase or v_sales_doc then case when v_ivabook then 'required' else 'forbidden' end
    when v_kind in ('collection', 'bank_expense') then case when v_vt is not null then 'optional' else 'forbidden' end
    when v_kind = 'sales_close' then 'optional'
    else 'forbidden' end;
  if v_rule = 'required' and jsonb_array_length(v_fvs) = 0 then
    perform private.acc_raise('fiscal_voucher_missing', w);
  end if;
  if v_rule = 'forbidden' and jsonb_array_length(v_fvs) > 0 then
    perform private.acc_raise('fiscal_voucher_not_allowed', w);
  end if;
  for v_j in select fv.value from jsonb_array_elements(v_fvs) fv loop
    f := jsonb_populate_record(null::public.acc_fiscal_vouchers, v_j);
    if f.book = 'sales' and f.number_to is null then
      perform private.acc_raise('range_required', w);
    end if;
    if f.number_to < f.number_from or f.point_of_sale not between 0 and 99999 or f.number_from not between 1 and 99999999
       or f.number_to > 99999999 then
      perform private.acc_raise('range_invalid', w);
    end if;
    if least(f.net_0_cents, f.net_25_cents, f.vat_25_cents, f.net_5_cents, f.vat_5_cents, f.net_105_cents, f.vat_105_cents,
             f.net_21_cents, f.vat_21_cents, f.net_27_cents, f.vat_27_cents, f.non_taxed_cents, f.undiscriminated_cents,
             f.exempt_cents, f.perc_iva_cents, f.perc_iibb_cents, f.perc_ganancias_cents, f.perc_municipal_cents,
             f.internal_taxes_cents, f.other_taxes_cents, f.total_cents, f.vat_computable_cents) < 0
       or f.total_cents <> f.net_0_cents + f.net_25_cents + f.vat_25_cents + f.net_5_cents + f.vat_5_cents + f.net_105_cents
                          + f.vat_105_cents + f.net_21_cents + f.vat_21_cents + f.net_27_cents + f.vat_27_cents
                          + f.non_taxed_cents + f.undiscriminated_cents + f.exempt_cents + f.perc_iva_cents
                          + f.perc_iibb_cents + f.perc_ganancias_cents + f.perc_municipal_cents
                          + f.internal_taxes_cents + f.other_taxes_cents
       or f.vat_computable_cents > f.vat_25_cents + f.vat_5_cents + f.vat_105_cents + f.vat_21_cents + f.vat_27_cents
       or (f.book = 'sales' and (f.channel is null or f.undiscriminated_cents > 0)) then
      perform private.acc_raise('fiscal_mismatch', w || '{"reason":"shape"}');
    end if;
    if (f.book = 'purchases' or exists (select 1 from private.acc_voucher_info(f.voucher_type) vi where vi.letter = 'A'))
       and not (f.counterparty_doc_type = 80 and coalesce(public.acc_cuit_is_valid(f.counterparty_doc_number), false)) then
      perform private.acc_raise('party_tax_id_required', w || jsonb_build_object('party_name', f.counterparty_name));
    end if;
    if date_trunc('month', f.voucher_date::timestamp) > date_trunc('month', v_date::timestamp) then
      perform private.acc_raise('fiscal_mismatch', w || '{"reason":"voucher_after_book_month"}');
    end if;
    if v_rule = 'required'
       and (f.voucher_type is distinct from v_vt or f.afip_voucher_code is distinct from (p_n ->> 'afip_voucher_code')::smallint
            or f.point_of_sale is distinct from v_pos or f.number_from is distinct from v_num
            or f.voucher_date is distinct from v_issue
            or f.book <> case when v_purchase then 'purchases' else 'sales' end) then
      perform private.acc_raise('fiscal_mismatch', w || '{"reason":"identity"}');
    end if;
    if (v_rule = 'required' and f.counterparty_party_id is not null and f.counterparty_party_id <> v_party_id)
       or not coalesce((v_j ->> 'cp_ok')::boolean, false) then
      perform private.acc_raise('fiscal_mismatch', w || '{"reason":"counterparty"}');
    end if;
    if f.book = 'sales' then
      select d.accounting_date into v_dup
        from public.acc_fiscal_vouchers y join public.acc_documents d on d.id = y.document_id
       where y.tenant_id = p_tenant and y.book = 'sales' and not y.voided and y.voucher_type = f.voucher_type
         and y.point_of_sale = f.point_of_sale and y.number_from <= f.number_to
         and coalesce(y.number_to, y.number_from) >= f.number_from and d.id is distinct from v_replaces
       limit 1;
      if found then
        perform private.acc_raise('duplicate_sales_range', w || jsonb_build_object('point_of_sale', f.point_of_sale,
          'number_from', f.number_from, 'number_to', f.number_to, 'date', v_dup));
      end if;
    end if;
  end loop;

  -- 5.10 Reglas propias del tipo que solo puede decidir la base.
  if v_settles and (not v_purchase or p.commission_vat_mode is distinct from 'monthly_invoice') then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"settles_commissions"}');
  end if;
  if v_kind = 'payment' then
    if t.s_wo > 0 then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'write_off', 'document', p_n ->> 'ref',
                  'amount_cents', t.s_wo));
    end if;
    -- Nunca más saldo a favor que el de cada cuenta compensable a la fecha del pago (sin el comprobante que se
    -- corrige: se anula en esta misma transacción).
    for r in select l.account_id, sum(l.amount_cents) as used
               from jsonb_populate_recordset(null::public.acc_document_lines, v_lines) l
              where l.role = 'compensation' group by l.account_id loop
      select coalesce(sum(case when jl.side = 'debit' then jl.amount_cents else -jl.amount_cents end), 0)::bigint
        into v_bal
        from public.acc_journal_lines jl join public.acc_journal_entries e on e.id = jl.entry_id
       where jl.tenant_id = p_tenant and jl.account_id = r.account_id and e.status = 'posted' and not e.is_mirror
         and jl.entry_date <= v_date and jl.document_id is distinct from v_replaces;
      if r.used > v_bal then
        select a.code, a.name into v_a from public.acc_accounts a where a.id = r.account_id;
        perform private.acc_raise('compensation_exceeds_balance', w || jsonb_build_object('available_cents', v_bal,
          'account_code', v_a.code, 'account_name', v_a.name));
      end if;
    end loop;
  end if;
  -- Arqueo (y arqueo de billetera en un cobro): el saldo de libro a la fecha, sin este comprobante (ni el que se
  -- corrige), es el que vio la persona (stale_balance) y contado − libro = lo que mueve la caja. Debe − Haber (la
  -- tarjeta de la empresa da negativo), igual que el motor. En un bundle, cuenta lo que ya escribieron los
  -- comprobantes anteriores (nota 6 del motor: [collection, treasury_adjustment]).
  if v_counted is not null then
    if v_kind = 'treasury_adjustment' and v_tk = 'cash' and v_counted < 0 then
      perform private.acc_raise('cash_count_invalid', w);
    end if;
    if v_kind = 'collection' and v_tid is not null and v_tk is distinct from 'wallet' then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"wallet_check_kind"}');
    end if;
    if v_tid is not null then
      select coalesce(sum(case when jl.side = 'debit' then jl.amount_cents else -jl.amount_cents end), 0)::bigint
        into v_bal
        from public.acc_treasury_accounts ta
        join public.acc_journal_lines jl on jl.account_id = ta.account_id and jl.tenant_id = ta.tenant_id
        join public.acc_journal_entries e on e.id = jl.entry_id
       where ta.id = v_tid and ta.tenant_id = p_tenant and e.status = 'posted' and not e.is_mirror
         and jl.entry_date <= v_date and jl.document_id is distinct from v_replaces;
      if v_bal <> v_expected then
        perform private.acc_raise('stale_balance', w || jsonb_build_object('book_cents', v_bal));
      end if;
    end if;
    if v_counted - v_expected <> t.tr_dc then
      perform private.acc_raise('balance_check_mismatch', w);
    end if;
  end if;
  -- Cierre del día: facturado de más en un canal se acepta a sabiendas y con motivo.
  if v_kind = 'sales_close' then
    for r in select l.channel, sum(case when l.side = 'credit' then l.amount_cents else -l.amount_cents end) as uninvoiced
               from jsonb_populate_recordset(null::public.acc_document_lines, v_lines) l
              where l.role = 'sales_uninvoiced' group by l.channel loop
      if r.uninvoiced < 0 then
        if not ('invoiced_exceeds_sold' = any (v_acks)) then
          v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'invoiced_exceeds_sold', 'document', p_n ->> 'ref',
                      'channel', r.channel));
        elsif p_n ->> 'override_reason' is null then
          perform private.acc_raise('invoiced_exceeds_sold', w || jsonb_build_object('channel', r.channel));
        end if;
      end if;
    end loop;
  end if;
  -- Referencias de la cabecera.
  if p_n ->> 'related_document_id' is not null and not exists (select 1 from public.acc_documents x
       where x.id = (p_n ->> 'related_document_id')::uuid and x.tenant_id = p_tenant and x.status = 'posted') then
    perform private.acc_raise('document_voided', w || '{"reason":"related_document"}');
  end if;
  if p_n ->> 'corrects_document_id' is not null and not exists (select 1 from public.acc_documents x
       where x.id = (p_n ->> 'corrects_document_id')::uuid and x.tenant_id = p_tenant) then
    perform private.acc_raise('document_not_found', w || '{"reason":"corrects_document"}');
  end if;
  if p_n ->> 'recurring_expense_id' is not null and not exists (select 1 from public.acc_recurring_expenses x
       where x.id = (p_n ->> 'recurring_expense_id')::uuid and x.tenant_id = p_tenant) then
    perform private.acc_raise('recurring_not_found', w);
  end if;
  if p_n ->> 'control_account_id' is not null and not exists (select 1 from public.acc_accounts x
       where x.id = (p_n ->> 'control_account_id')::uuid and x.tenant_id = p_tenant) then
    perform private.acc_raise('account_not_found', w || '{"reason":"control_account"}');
  end if;

  return p_n || jsonb_build_object('period_id', v_per.id, 'fiscal_year_id', v_per.fiscal_year_id, 'treasury_id', v_tid,
                                   'warnings', v_warn);
end;
$$;

comment on function private.acc_check_document(uuid, jsonb, jsonb) is
  'Paso 5 de C.3.3 sobre un comprobante normalizado. Levanta la primera clave que falla; devuelve el comprobante + period_id, fiscal_year_id, treasury_id y los avisos encontrados (warnings).';

revoke all on function private.acc_check_document(uuid, jsonb, jsonb) from public, anon, authenticated;
