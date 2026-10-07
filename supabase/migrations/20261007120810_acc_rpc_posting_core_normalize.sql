-- Parte 2 de 5 de la migración #9 (acc_rpc_posting_core): forma de cada comprobante del bundle (C.3.3 paso 3).
-- Interna (private, SECURITY DEFINER, sin EXECUTE para nadie); la usa acc_post_bundle (parte 4) bajo el lock del
-- bar. Mismas sentencias y orden que el diseño de la #9.
--   · acc_normalize_document: cabecera, renglones y filas del libro IVA con sus tipos, partícipes ({id}/{ref})
--     resueltos y la foto fiscal de la contraparte tomada del partícipe.

-- ─── 1. Forma del comprobante (paso 3) ────────────────────────────────────────
-- p_bctx = {today, party_refs: {ref: id}, doc_refs: {ref: id}, bundle_id}.
create function private.acc_normalize_document(p_tenant uuid, p_doc jsonb, p_bctx jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb := jsonb_build_object('document', p_doc ->> 'ref');
  lw jsonb;
  r record;
  e record;
  cp jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_fvs jsonb := '[]'::jsonb;
  v_acks jsonb := '[]'::jsonb;
  v_ln bigint;
  v_role text;
  v_side text;
  v_acc uuid;
  v_book text;
  v_vt text;
  v_cp uuid;
  p public.acc_parties;
  v_name text;
  v_dt bigint;
  v_dn text;
  v_iva text;
  v_cp_ok boolean;
  v_amounts jsonb;
  v_val bigint;
begin
  -- Renglones: 1..500, line_no únicos (los demás chequeos de forma los hace acc_validate_line).
  if jsonb_typeof(p_doc -> 'lines') is distinct from 'array' then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"lines"}');
  end if;
  if jsonb_array_length(p_doc -> 'lines') = 0 then
    perform private.acc_raise('amount_required', w);
  end if;
  if jsonb_array_length(p_doc -> 'lines') > 500 then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"too_many_lines"}');
  end if;
  for r in select l.value as x, l.ordinality as i
             from jsonb_array_elements(p_doc -> 'lines') with ordinality as l(value, ordinality) loop
    lw := w || jsonb_build_object('line', r.i);
    if jsonb_typeof(r.x) <> 'object' then
      perform private.acc_raise('invalid_bundle', lw || '{"reason":"line"}');
    end if;
    v_ln := private.acc_jbig(r.x, 'line_no', lw);
    if v_ln is null or v_ln not between 1 and 500 then
      perform private.acc_raise('invalid_bundle', lw || '{"reason":"line_no"}');
    end if;
    lw := w || jsonb_build_object('line_no', v_ln);
    v_role := private.acc_jtext(r.x, 'role', lw);
    v_side := private.acc_jtext(r.x, 'side', lw);
    v_acc := private.acc_juuid(r.x, 'account_id', lw);
    if v_role is null or v_role not in ('net', 'vat', 'gross', 'non_taxed', 'exempt', 'internal_tax', 'perception',
         'other_tax', 'control', 'treasury', 'compensation', 'deduction', 'write_off', 'receivable', 'advance',
         'sales_invoiced', 'sales_uninvoiced', 'cash_diff', 'vat_pending_release', 'counterpart', 'adjustment_split',
         'manual', 'opening', 'settlement', 'reversal', 'fy_result', 'mirror')
       or v_side is null or v_side not in ('debit', 'credit') or v_acc is null then
      perform private.acc_raise('invalid_bundle', lw || '{"reason":"role_side_account"}');
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_ln, 'role', v_role, 'side', v_side, 'account_id', v_acc,
      'amount_cents', private.acc_jbig(r.x, 'amount_cents', lw),
      'party_id', private.acc_jkey(p_tenant, r.x, 'party', p_bctx -> 'party_refs', lw, 'party'),
      'due_date', private.acc_jdate(r.x, 'due_date', lw),
      'treasury_account_id', private.acc_juuid(r.x, 'treasury_account_id', lw),
      'sales_method_id', private.acc_juuid(r.x, 'sales_method_id', lw),
      'vat_rate_bp', private.acc_jbig(r.x, 'vat_rate_bp', lw),
      'base_cents', private.acc_jbig(r.x, 'base_cents', lw),
      'vat_computed_cents', private.acc_jbig(r.x, 'vat_computed_cents', lw),
      'tax_kind', private.acc_jtext(r.x, 'tax_kind', lw),
      'jurisdiction_code', private.acc_jbig(r.x, 'jurisdiction_code', lw),
      'channel', private.acc_jtext(r.x, 'channel', lw),
      'certificate_number', private.acc_jtext(r.x, 'certificate_number', lw),
      'reference', private.acc_jtext(r.x, 'reference', lw),
      'memo', private.acc_jtext(r.x, 'memo', lw)));
  end loop;
  if (select count(distinct x.value ->> 'line_no') from jsonb_array_elements(v_lines) x) <> jsonb_array_length(v_lines) then
    perform private.acc_raise('invalid_bundle', w || '{"reason":"line_no"}');
  end if;

  -- Filas del libro IVA (≤ 50). La foto fiscal de la contraparte la toma la RPC del partícipe (C.3.1):
  -- tipo y número de documento y condición frente al IVA enviados tienen que coincidir (cp_ok); el nombre es
  -- texto derivado y se toma del partícipe.
  if p_doc -> 'fiscal_vouchers' is not null and jsonb_typeof(p_doc -> 'fiscal_vouchers') <> 'null' then
    if jsonb_typeof(p_doc -> 'fiscal_vouchers') <> 'array' then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"fiscal_vouchers"}');
    end if;
    if jsonb_array_length(p_doc -> 'fiscal_vouchers') > 50 then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"too_many_fiscal_vouchers"}');
    end if;
    for r in select f.value as x, f.ordinality as i
               from jsonb_array_elements(p_doc -> 'fiscal_vouchers') with ordinality as f(value, ordinality) loop
      lw := w || jsonb_build_object('fiscal_voucher', r.i);
      if jsonb_typeof(r.x) <> 'object' or jsonb_typeof(r.x -> 'counterparty') is distinct from 'object'
         or jsonb_typeof(r.x -> 'amounts') is distinct from 'object' then
        perform private.acc_raise('invalid_bundle', lw || '{"reason":"fiscal_voucher"}');
      end if;
      v_book := private.acc_jtext(r.x, 'book', lw);
      v_vt := private.acc_jtext(r.x, 'voucher_type', lw);
      if v_book is null or v_book not in ('purchases', 'sales')
         or not exists (select 1 from private.acc_voucher_info(v_vt) vi where vi.iva_book)
         or private.acc_jdate(r.x, 'voucher_date', lw) is null or private.acc_jbool(r.x, 'is_credit_note', lw) is null
         or private.acc_jbig(r.x, 'point_of_sale', lw) is null or private.acc_jbig(r.x, 'number_from', lw) is null
         or coalesce(private.acc_jtext(r.x, 'channel', lw), 'salon') not in ('salon', 'delivery', 'events') then
        perform private.acc_raise('invalid_bundle', lw || '{"reason":"fiscal_voucher"}');
      end if;
      cp := r.x -> 'counterparty';
      v_cp := private.acc_jkey(p_tenant, cp, 'party', p_bctx -> 'party_refs', lw, 'party');
      v_name := btrim(coalesce(private.acc_jtext(cp, 'name', lw), ''));
      v_dt := private.acc_jbig(cp, 'doc_type', lw);
      v_dn := private.acc_jtext(cp, 'doc_number', lw);
      v_iva := private.acc_jtext(cp, 'iva_condition', lw);
      v_cp_ok := true;
      if v_cp is not null then
        select * into p from public.acc_parties x where x.id = v_cp and x.tenant_id = p_tenant;
        v_cp_ok := v_dt is not distinct from (case p.tax_id_type when 'cuit' then 80 when 'cuil' then 86
                                                                  when 'dni' then 96 else 99 end)
                   and v_dn is not distinct from (case when p.tax_id_type = 'none' then '0' else coalesce(p.tax_id, '0') end)
                   and v_iva is not distinct from p.iva_condition;
        v_name := p.name;
        v_dt := case p.tax_id_type when 'cuit' then 80 when 'cuil' then 86 when 'dni' then 96 else 99 end;
        v_dn := case when p.tax_id_type = 'none' then '0' else coalesce(p.tax_id, '0') end;
        v_iva := p.iva_condition;
      end if;
      if char_length(v_name) not between 1 and 160 or v_dt is null or v_dt not in (80, 86, 96, 99)
         or v_dn is null or v_dn !~ '^[0-9]{1,11}$'
         or v_iva is null or v_iva not in ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final',
                                           'no_alcanzado', 'sin_datos') then
        perform private.acc_raise('invalid_bundle', lw || '{"reason":"counterparty"}');
      end if;
      v_amounts := '{"net_0_cents":0,"net_25_cents":0,"vat_25_cents":0,"net_5_cents":0,"vat_5_cents":0,
        "net_105_cents":0,"vat_105_cents":0,"net_21_cents":0,"vat_21_cents":0,"net_27_cents":0,"vat_27_cents":0,
        "non_taxed_cents":0,"undiscriminated_cents":0,"exempt_cents":0,"perc_iva_cents":0,"perc_iibb_cents":0,
        "perc_ganancias_cents":0,"perc_municipal_cents":0,"internal_taxes_cents":0,"other_taxes_cents":0,
        "total_cents":0,"vat_computable_cents":0}'::jsonb;
      for e in select a.key, a.value from jsonb_each(r.x -> 'amounts') a loop
        v_val := private.acc_to_bigint(e.value);
        if not (v_amounts ? e.key) or v_val is null or abs(v_val) > 1000000000000000 then
          perform private.acc_raise('invalid_bundle', lw || jsonb_build_object('reason', 'amounts', 'key', e.key));
        end if;
        v_amounts := jsonb_set(v_amounts, array[e.key], to_jsonb(v_val));
      end loop;
      v_fvs := v_fvs || jsonb_build_array(v_amounts || jsonb_build_object(
        'book', v_book, 'voucher_type', v_vt,
        'afip_voucher_code', private.acc_jbig(r.x, 'afip_voucher_code', lw),
        'is_credit_note', private.acc_jbool(r.x, 'is_credit_note', lw),
        'voucher_date', private.acc_jdate(r.x, 'voucher_date', lw),
        'point_of_sale', private.acc_jbig(r.x, 'point_of_sale', lw),
        'number_from', private.acc_jbig(r.x, 'number_from', lw),
        'number_to', private.acc_jbig(r.x, 'number_to', lw),
        'channel', private.acc_jtext(r.x, 'channel', lw),
        'counterparty_party_id', v_cp, 'counterparty_name', v_name, 'counterparty_doc_type', v_dt,
        'counterparty_doc_number', v_dn, 'counterparty_iva_condition', v_iva, 'cp_ok', v_cp_ok));
    end loop;
  end if;

  -- Avisos aceptados: lista de textos.
  if p_doc -> 'warnings_ack' is not null and jsonb_typeof(p_doc -> 'warnings_ack') <> 'null' then
    if jsonb_typeof(p_doc -> 'warnings_ack') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_doc -> 'warnings_ack') a where jsonb_typeof(a.value) <> 'string') then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"warnings_ack"}');
    end if;
    v_acks := p_doc -> 'warnings_ack';
  end if;

  return jsonb_build_object(
    'ref', p_doc ->> 'ref',
    'kind', p_doc ->> 'kind',
    'entry_kind', private.acc_jtext(p_doc, 'entry_kind', w),
    'voucher_type', private.acc_jtext(p_doc, 'voucher_type', w),
    'afip_voucher_code', private.acc_jbig(p_doc, 'afip_voucher_code', w),
    'party_id', private.acc_jkey(p_tenant, p_doc, 'party', p_bctx -> 'party_refs', w, 'party'),
    'issue_date', private.acc_jdate(p_doc, 'issue_date', w),
    'accounting_date', private.acc_jdate(p_doc, 'accounting_date', w),
    'due_date', private.acc_jdate(p_doc, 'due_date', w),
    'point_of_sale', private.acc_jbig(p_doc, 'point_of_sale', w),
    'number', private.acc_jbig(p_doc, 'number', w),
    'shift', nullif(btrim(private.acc_jtext(p_doc, 'shift', w)), ''),
    'description', btrim(coalesce(private.acc_jtext(p_doc, 'description', w), '')),
    'notes', nullif(btrim(private.acc_jtext(p_doc, 'notes', w)), ''),
    'total_cents', private.acc_jbig(p_doc, 'total_cents', w),
    'control_account_id', private.acc_juuid(p_doc, 'control_account_id', w),
    'related_document_id', private.acc_jkey(p_tenant, p_doc, 'related_document', p_bctx -> 'doc_refs', w, 'document'),
    'replaces_document_id', private.acc_juuid(p_doc, 'replaces_document_id', w),
    'corrects_document_id', private.acc_juuid(p_doc, 'corrects_document_id', w),
    'recurring_expense_id', private.acc_juuid(p_doc, 'recurring_expense_id', w),
    'settles_commissions', coalesce(private.acc_jbool(p_doc, 'settles_commissions', w), false),
    'counted_cents', private.acc_jbig(p_doc, 'counted_cents', w),
    'expected_book_cents', private.acc_jbig(p_doc, 'expected_book_cents', w),
    'warnings_ack', v_acks,
    'override_reason', nullif(btrim(private.acc_jtext(p_doc, 'override_reason', w)), ''),
    'lines', v_lines,
    'fiscal_vouchers', v_fvs);
end;
$$;

comment on function private.acc_normalize_document(uuid, jsonb, jsonb) is
  'Paso 3 de C.3.3: forma de un comprobante del payload de acc_post_bundle (tipos, partícipes resueltos, foto fiscal de la contraparte). Devuelve el comprobante normalizado (columnas de acc_documents/acc_document_lines/acc_fiscal_vouchers).';

revoke all on function private.acc_normalize_document(uuid, jsonb, jsonb) from public, anon, authenticated;
