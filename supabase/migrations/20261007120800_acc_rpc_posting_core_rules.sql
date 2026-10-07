-- Parte 1 de 5 de la migración #9 (acc_rpc_posting_core), partida en cinco para que cada apply_migration
-- por MCP sea chica (≤ ~40 KB). Mismas sentencias y mismo orden que el diseño de la #9; los revoke de cada
-- función viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #9
-- Núcleo de imputación (spec §C.0, §C.3, §C.4, §E.6, §E.7)
-- ============================================================
-- Qué crea esta parte (todo en private, SECURITY DEFINER o puro, sin EXECUTE para nadie):
--   · acc_raise: levanta una clave de negocio (P0001) con `detail` en JSON (lo lee lib/accounting/errors.ts).
--   · acc_jtext / acc_jbig / acc_juuid / acc_jdate / acc_jbool / acc_jkey: lectura tipada del payload de
--     acc_post_bundle (null si falta; invalid_bundle con {document, line_no?, reason: <campo>} si el tipo no sirve).
--   · acc_voucher_info: el catálogo de tipos de comprobante (espejo de VOUCHER_CATALOG de voucher-types.ts).
--   · acc_is_imputation: «imputación» de C.3.4 (espejo de isImputationAccount de validate.ts).
--   · acc_line_rule(kind, role) → (sides, account_rule): la matriz de C.3.4, versión fase 1. Las fases
--     siguientes la reemplazan (create or replace) SUMANDO filas al values; un tipo sin filas no está habilitado.
--   · acc_validate_line: forma del renglón, rol y lado, cuenta, partícipe, caja, medio y la regla de cuenta del
--     rol. Implementa TODAS las reglas de cuenta de validate.ts (checkAccountRule), así las fases 2 a 4 solo
--     suman filas en acc_line_rule.
--   · acc_doc_sum: Σ de renglones de un comprobante por rol (y tipo de impuesto / alícuota).
--   · acc_reconcile_fiscal: conciliación de C.3.5 sobre lo ya insertado; versión fase 1 = resumen bancario.
--     Una rama por tipo: compras (#12) y ventas/cobranzas (#13) suman la suya con create or replace.
-- ============================================================

-- ─── 1. Errores con detalle ──────────────────────────────────────────────────
-- Siempre levanta: P0001, mensaje = clave, detail = JSON (o sin detail). Volatile a propósito: nunca se pliega.
create function private.acc_raise(p_key text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_detail is null then
    raise exception '%', p_key using errcode = 'P0001';
  end if;
  raise exception '%', p_key using errcode = 'P0001', detail = p_detail::text;
end;
$$;

-- ─── 2. Lectura tipada del payload ───────────────────────────────────────────
create function private.acc_jtext(p jsonb, p_key text, p_where jsonb)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_key) <> 'string' then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  return p ->> p_key;
end;
$$;

create function private.acc_jbig(p jsonb, p_key text, p_where jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint;
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := private.acc_to_bigint(p -> p_key);
  if v is null then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  return v;
end;
$$;

create function private.acc_juuid(p jsonb, p_key text, p_where jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v uuid;
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := case when jsonb_typeof(p -> p_key) = 'string' then private.acc_to_uuid(p ->> p_key) end;
  if v is null then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  return v;
end;
$$;

create function private.acc_jdate(p jsonb, p_key text, p_where jsonb)
returns date
language plpgsql
set search_path = ''
as $$
declare
  v date;
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := case when jsonb_typeof(p -> p_key) = 'string' then private.acc_to_date(p ->> p_key) end;
  if v is null then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  return v;
end;
$$;

create function private.acc_jbool(p jsonb, p_key text, p_where jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v boolean;
begin
  if p -> p_key is null or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := private.acc_to_bool(p -> p_key);
  if v is null then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  return v;
end;
$$;

-- {"id": …} existente del bar, {"ref": …} creado en este bundle (p_refs = {ref: id}) o null.
-- p_entity 'party' → party_not_found; 'document' → document_not_found (y un ref que no existe todavía: invalid_bundle).
create function private.acc_jkey(p_tenant uuid, p jsonb, p_key text, p_refs jsonb, p_where jsonb, p_entity text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := p -> p_key;
  v_id uuid;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'object' or not (v ? 'id' or v ? 'ref') then
    perform private.acc_raise('invalid_bundle', coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key));
  end if;
  if v ? 'id' then
    v_id := private.acc_to_uuid(v ->> 'id');
    if v_id is null
       or (p_entity = 'party' and not exists (select 1 from public.acc_parties x where x.id = v_id and x.tenant_id = p_tenant))
       or (p_entity = 'document' and not exists (select 1 from public.acc_documents x where x.id = v_id and x.tenant_id = p_tenant)) then
      perform private.acc_raise(p_entity || '_not_found', p_where);
    end if;
  else
    v_id := private.acc_to_uuid(p_refs ->> (v ->> 'ref'));
    if v_id is null then
      perform private.acc_raise(case when p_entity = 'party' then 'party_not_found' else 'invalid_bundle' end,
        coalesce(p_where, '{}'::jsonb) || jsonb_build_object('reason', p_key || '_ref'));
    end if;
  end if;
  return v_id;
end;
$$;

-- ─── 3. Catálogos ────────────────────────────────────────────────────────────
-- Tipos de comprobante (espejo de VOUCHER_CATALOG): letra, si discrimina IVA para quien lo recibe, si va a
-- un libro IVA, si lleva PV y número, si es NC y el código AFIP. 0 filas = tipo desconocido.
create function private.acc_voucher_info(p_type text)
returns table (letter text, purchase_vat text, iva_book boolean, numbered boolean, is_credit_note boolean,
               afip_code smallint)
language sql
immutable
set search_path = ''
as $$
  select v.letter, v.purchase_vat, v.iva_book, v.numbered, v.is_credit_note, v.afip_code::smallint
    from (values
      ('factura_a', 'A'::text, 'yes'::text, true, true, false, 1),
      ('nota_debito_a', 'A', 'yes', true, true, false, 2),
      ('nota_credito_a', 'A', 'yes', true, true, true, 3),
      ('recibo_a', 'A', 'yes', true, true, false, 4),
      ('factura_b', 'B', 'no', true, true, false, 6),
      ('nota_debito_b', 'B', 'no', true, true, false, 7),
      ('nota_credito_b', 'B', 'no', true, true, true, 8),
      ('recibo_b', 'B', 'no', true, true, false, 9),
      ('factura_c', 'C', 'no', true, true, false, 11),
      ('nota_debito_c', 'C', 'no', true, true, false, 12),
      ('nota_credito_c', 'C', 'no', true, true, true, 13),
      ('recibo_c', 'C', 'no', true, true, false, 15),
      ('factura_m', 'M', 'yes', true, true, false, 51),
      ('nota_debito_m', 'M', 'yes', true, true, false, 52),
      ('nota_credito_m', 'M', 'yes', true, true, true, 53),
      ('tique_factura_a', 'A', 'yes', true, true, false, 81),
      ('tique_factura_b', 'B', 'no', true, true, false, 82),
      ('tique_factura_c', 'C', 'no', true, true, false, 111),
      ('tique', null, 'no', true, true, false, 83),
      ('liquidacion', null, 'yes', true, true, false, null),
      ('resumen_bancario', null, 'yes', true, true, false, null),
      ('otro_comprobante', null, 'optional', true, true, false, 99),
      ('ddjj_impuesto', null, 'no', false, false, false, null),
      ('sin_comprobante', null, 'no', false, false, false, null)
    ) as v(type, letter, purchase_vat, iva_book, numbered, is_credit_note, afip_code)
   where v.type = p_type
$$;

-- «Imputación» de C.3.4: imputable y activa, sin partícipe obligatorio, que no es de caja, de egreso o activo,
-- y purchase_selectable o sin system_key.
create function private.acc_is_imputation(a public.acc_accounts)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a.postable and a.active and not a.requires_party and not a.is_treasury
     and a.type in ('expense', 'asset') and (a.purchase_selectable or a.system_key is null)
$$;

-- ─── 4. La matriz de roles (C.3.4), versión fase 1 ─────────────────────────────
-- Una fila por (tipo, rol): lados permitidos y regla de cuenta (los nombres de AccountRule de validate.ts).
-- Fase 2 (#12) suma purchase/purchase_credit_note/purchase_debit_note/payment; fase 3 (#13) sales_close,
-- collection y ventas sueltas; fase 4 (#15) fy_result/fy_closing/fy_opening. Un tipo sin filas → kind_not_allowed.
create function private.acc_line_rule(p_kind text, p_role text)
returns table (sides public.acc_side[], account_rule text)
language sql
immutable
set search_path = ''
as $$
  select r.sides, r.account_rule
    from (values
      ('opening', 'opening', '{debit,credit}'::public.acc_side[], 'any_postable'::text),
      ('expense', 'gross', '{debit}', 'imputation'),
      ('expense', 'treasury', '{credit}', 'treasury'),
      ('transfer', 'treasury', '{debit,credit}', 'treasury'),
      ('bank_expense', 'net', '{debit}', 'imputation'),
      ('bank_expense', 'vat', '{debit}', 'bank_vat'),
      ('bank_expense', 'perception', '{debit}', 'bank_perception'),
      ('bank_expense', 'gross', '{debit}', 'imputation'),
      ('bank_expense', 'other_tax', '{debit}', 'bank_other_tax'),
      ('bank_expense', 'treasury', '{credit}', 'treasury'),
      ('cash_movement', 'treasury', '{debit,credit}', 'treasury'),
      ('cash_movement', 'counterpart', '{debit,credit}', 'counterpart'),
      ('treasury_adjustment', 'treasury', '{debit,credit}', 'treasury'),
      ('treasury_adjustment', 'adjustment_split', '{debit,credit}', 'adjustment_split'),
      ('manual', 'manual', '{debit,credit}', 'any_postable'),
      ('iva_settlement', 'settlement', '{debit,credit}', 'settlement'),
      ('reversal', 'reversal', '{debit,credit}', 'reversal')
    ) as r(kind, role, sides, account_rule)
   where r.kind = p_kind and r.role = p_role
$$;

-- ─── 5. Un renglón contra la matriz (C.3.3 paso 6, espejo de validateLines) ────
-- p_doc: cabecera normalizada {ref, kind, party_id, voucher_type, settles_commissions, fiscal_count};
-- p_line: renglón normalizado (columnas de acc_document_lines, party_id ya resuelto);
-- p_ctx: {sas_iva_condition, uninvoiced_sales_mode, treasury_kind, treasury_name}.
create function private.acc_validate_line(p_tenant uuid, p_doc jsonb, p_line jsonb, p_ctx jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_doc ->> 'kind';
  v_role text := p_line ->> 'role';
  v_side text := p_line ->> 'side';
  v_amount bigint := (p_line ->> 'amount_cents')::bigint;
  v_tax text := p_line ->> 'tax_kind';
  v_channel text := p_line ->> 'channel';
  v_rate bigint := (p_line ->> 'vat_rate_bp')::bigint;
  v_base bigint := (p_line ->> 'base_cents')::bigint;
  v_vatc bigint := (p_line ->> 'vat_computed_cents')::bigint;
  v_jur bigint := (p_line ->> 'jurisdiction_code')::bigint;
  v_party_id uuid := (p_line ->> 'party_id')::uuid;
  v_doc_party_id uuid := (p_doc ->> 'party_id')::uuid;
  v_tr_id uuid := (p_line ->> 'treasury_account_id')::uuid;
  v_method_id uuid := (p_line ->> 'sales_method_id')::uuid;
  v_settles boolean := coalesce((p_doc ->> 'settles_commissions')::boolean, false);
  v_where jsonb := jsonb_build_object('document', p_doc ->> 'ref', 'line_no', p_line -> 'line_no');
  v_detail jsonb;
  v_sides public.acc_side[];
  v_rule text;
  a public.acc_accounts;
  v_key text;
  v_lp public.acc_parties;
  v_dp public.acc_parties;
  v_tr public.acc_treasury_accounts;
  v_m public.acc_sales_methods;
  v_imp boolean;
  v_ok boolean;
  v_err text;
  v_commission text;
begin
  -- Forma de las columnas (los CHECK de adl_*): si falla es un error del motor.
  if v_amount is null or v_amount not between 1 and 1000000000000000 then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"amount"}');
  end if;
  if v_amount > 999999999999 then
    perform private.acc_raise('amount_too_large', v_where);
  end if;
  if ((v_tax is not null) <> (v_role in ('perception', 'other_tax', 'deduction', 'adjustment_split', 'compensation'))
      and v_role <> 'vat')
     or (v_tax is not null and v_tax not in ('iva', 'iibb', 'ganancias', 'municipal', 'internos', 'ley_25413_credito',
         'ley_25413_debito', 'sircreb', 'sircupa', 'comision', 'iva_comision', 'percepcion_iva_comision', 'ret_iva',
         'ret_iibb', 'ret_ganancias', 'interes', 'diferencia', 'rendimiento', 'otro')) then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"tax_kind"}');
  end if;
  if ((v_channel is not null) <> (v_role in ('sales_invoiced', 'sales_uninvoiced'))
      and v_role not in ('receivable', 'treasury', 'vat'))
     or (v_channel is not null and v_channel not in ('salon', 'delivery', 'events')) then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"channel"}');
  end if;
  if (v_rate is not null and v_rate not in (0, 250, 500, 1050, 2100, 2700))
     or v_base not between 0 and 1000000000000000 or v_vatc not between 0 and 1000000000000000 then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"vat_rate"}');
  end if;
  if v_role = 'net' and (v_rate is null or v_base is distinct from v_amount) then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"net_shape"}');
  end if;
  if v_role = 'vat' then
    if v_rate is null or v_base is null or v_vatc is null then
      perform private.acc_raise('invalid_bundle', v_where || '{"reason":"vat_shape"}');
    end if;
    if v_vatc <> (v_base * v_rate + 5000) / 10000 then      -- redondeo a la mitad hacia arriba (vatFromNet)
      perform private.acc_raise('vat_computed_mismatch', v_where);
    end if;
  end if;
  if p_line ->> 'due_date' is not null and v_party_id is null then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"due_without_party"}');
  end if;
  if v_jur is not null and v_jur not between 901 and 924 then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"jurisdiction"}');
  end if;
  if coalesce(char_length(p_line ->> 'certificate_number'), 0) > 40 or coalesce(char_length(p_line ->> 'reference'), 0) > 60
     or coalesce(char_length(p_line ->> 'memo'), 0) > 200 then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"text_length"}');
  end if;

  -- Rol y lado.
  select r.sides, r.account_rule into v_sides, v_rule from private.acc_line_rule(v_kind, v_role) r limit 1;
  if v_rule is null or v_side is null or not (v_side::public.acc_side = any (v_sides)) then
    perform private.acc_raise('invalid_line_role', v_where || jsonb_build_object('role', v_role));
  end if;
  -- La factura mensual de comisiones solo pasa el IVA a crédito fiscal (E.5.1).
  if v_kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note')
     and (case when v_settles then v_role not in ('vat', 'vat_pending_release') else v_role = 'vat_pending_release' end) then
    perform private.acc_raise('invalid_line_role', v_where || jsonb_build_object('role', v_role));
  end if;
  if v_role = 'perception' and v_tax = 'iibb' and v_jur is null then
    perform private.acc_raise('invalid_bundle', v_where || '{"reason":"jurisdiction_required"}');
  end if;

  -- Cuenta del bar, imputable y activa (la anulación espeja cuentas desactivadas).
  select * into a from public.acc_accounts x where x.id = (p_line ->> 'account_id')::uuid and x.tenant_id = p_tenant;
  if not found then
    perform private.acc_raise('account_not_found', v_where);
  end if;
  v_key := a.system_key;
  v_detail := v_where || jsonb_build_object('account_code', a.code, 'account_name', a.name);
  if not a.postable then
    perform private.acc_raise('account_not_postable', v_detail);
  end if;
  if not a.active and v_kind <> 'reversal' then
    perform private.acc_raise('account_inactive', v_detail);
  end if;
  if v_kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note') and v_settles and v_role = 'vat'
     and v_key is distinct from 'vat_credit' then
    perform private.acc_raise('line_account_invalid', v_detail);
  end if;

  -- Partícipe ⇔ cuenta de control (los espejos del cierre de ejercicio nunca llevan).
  if v_role = 'mirror' then
    if v_party_id is not null then
      perform private.acc_raise('party_not_allowed', v_detail);
    end if;
  elsif a.requires_party and v_party_id is null then
    perform private.acc_raise('account_requires_party', v_detail);
  elsif not a.requires_party and v_party_id is not null then
    perform private.acc_raise('party_not_allowed', v_detail);
  end if;
  if v_party_id is not null then
    select * into v_lp from public.acc_parties x where x.id = v_party_id and x.tenant_id = p_tenant;
    if not found then
      perform private.acc_raise('party_not_found', v_where);
    end if;
  end if;
  if v_doc_party_id is not null then
    select * into v_dp from public.acc_parties x where x.id = v_doc_party_id and x.tenant_id = p_tenant;
  end if;
  -- La línea de control, la liberación de «IVA a documentar» y una deducción con partícipe son del partícipe
  -- del documento.
  if (v_role in ('control', 'vat_pending_release') or (v_role = 'deduction' and a.requires_party))
     and v_party_id is distinct from v_doc_party_id then
    perform private.acc_raise('control_party_mismatch', v_where);
  end if;

  -- Caja: activa y con la cuenta del renglón.
  if v_role = 'treasury' then
    select * into v_tr from public.acc_treasury_accounts t where t.id = v_tr_id and t.tenant_id = p_tenant;
    if not found or not v_tr.active or v_tr.account_id <> a.id then
      perform private.acc_raise('treasury_mismatch', v_where);
    end if;
  elsif v_tr_id is not null then
    perform private.acc_raise('treasury_mismatch', v_where);
  end if;

  -- Medio de cobro: en el cierre del día cada caja, partida y seña dice de qué medio viene.
  if v_kind = 'sales_close' and v_method_id is null and v_role in ('treasury', 'receivable', 'advance') then
    perform private.acc_raise('sales_method_mismatch', v_where);
  elsif v_method_id is not null then
    select * into v_m from public.acc_sales_methods m where m.id = v_method_id and m.tenant_id = p_tenant;
    if not found or not v_m.active
       or (v_role = 'treasury' and not coalesce(v_m.kind = 'treasury' and v_m.treasury_account_id = v_tr_id, false))
       or (v_role = 'receivable' and not coalesce(case
             when v_m.kind in ('receivable', 'settled_now') then v_party_id = v_m.party_id and v_lp.receivable_account_id = a.id
             when v_m.kind = 'customer_account' then v_lp.kind in ('customer', 'partner', 'other')
             else false end, false))
       or (v_role = 'advance' and not coalesce(v_m.kind = 'advance' and v_party_id = v_m.party_id, false)) then
      perform private.acc_raise('sales_method_mismatch', v_where);
    end if;
  end if;

  -- Regla de cuenta del rol (espejo de checkAccountRule).
  v_imp := private.acc_is_imputation(a);
  case v_rule
    when 'imputation' then
      v_ok := v_imp;
    when 'imputation_or_other_taxes' then
      v_ok := v_imp or v_key = 'other_taxes_expense';
    when 'purchase_vat' then
      -- Si el IVA computa va a crédito fiscal; si no, al costo (una cuenta de imputación).
      if v_doc_party_id is null or p_doc ->> 'voucher_type' is null then
        v_ok := v_key = 'vat_credit' or v_imp;
      elsif exists (select 1 from private.acc_voucher_info(p_doc ->> 'voucher_type') vi where vi.purchase_vat <> 'no')
            and v_dp.iva_condition = 'responsable_inscripto' and p_ctx ->> 'sas_iva_condition' = 'responsable_inscripto' then
        v_ok := v_key = 'vat_credit';
      else
        v_ok := v_imp;
      end if;
    when 'bank_vat' then
      -- Crédito fiscal solo si el gasto entra al libro IVA; si no, al gasto.
      v_ok := case when coalesce((p_doc ->> 'fiscal_count')::int, 0) > 0 then v_key = 'vat_credit' else v_imp end;
    when 'purchase_perception' then
      if v_tax in ('iva', 'iibb', 'ganancias', 'municipal') then
        v_ok := v_key = case v_tax when 'iva' then 'vat_perceptions' when 'iibb' then 'iibb_perceptions'
                                   when 'ganancias' then 'income_tax_perceptions' else 'other_taxes_expense' end;
      else
        v_err := 'invalid_line_role';
      end if;
    when 'bank_perception' then
      if v_tax = 'iva' then v_ok := v_key = 'vat_perceptions'; else v_err := 'invalid_line_role'; end if;
    when 'purchase_control' then
      v_ok := v_doc_party_id is not null and a.requires_party
              and (a.id = v_dp.payable_account_id
                   or (v_dp.kind = 'tax_agency' and v_key in ('vat_payable', 'iibb_payable', 'municipal_payable',
                                                              'income_tax_payable', 'other_taxes_payable')));
    when 'vat_credit' then
      v_ok := v_key = 'vat_credit';
    when 'vat_credit_pending' then
      v_ok := v_key = 'vat_credit_pending';
    when 'treasury' then
      v_ok := a.is_treasury;
    when 'payment_control' then
      v_ok := a.requires_party;
    when 'compensation' then
      if v_doc_party_id is null or v_dp.kind <> 'tax_agency' then
        v_err := 'compensation_not_allowed';
      else
        v_ok := v_key in ('iibb_perceptions', 'iibb_withholdings', 'iibb_sircreb', 'iibb_sircupa', 'iibb_balance',
                          'income_tax_withholdings', 'income_tax_perceptions', 'income_tax_advances', 'bank_tax_credit',
                          'vat_free_balance');
      end if;
    when 'payment_write_off' then
      v_ok := v_key in ('discounts_obtained', 'other_income');
    when 'collection_deduction' then
      v_commission := case v_dp.kind when 'card_processor' then 'fees_cards' when 'payment_wallet' then 'fees_wallets'
                                     when 'delivery_platform' then 'fees_platforms' else 'fees_other' end;
      v_ok := case v_tax
        when 'comision' then v_key = v_commission
        when 'iva_comision' then v_key in ('vat_credit', 'vat_credit_pending', v_commission)
        when 'percepcion_iva_comision' then v_key = 'vat_perceptions'
        when 'ret_iva' then v_key = 'vat_withholdings'
        when 'ret_iibb' then v_key = 'iibb_withholdings'
        when 'sircupa' then v_key = 'iibb_sircupa'
        when 'ret_ganancias' then v_key = 'income_tax_withholdings'
        when 'diferencia' then v_key = 'reconciliation_differences'
        when 'otro' then v_imp end;
      if v_tax is null or v_tax not in ('comision', 'iva_comision', 'percepcion_iva_comision', 'ret_iva', 'ret_iibb',
                                        'sircupa', 'ret_ganancias', 'diferencia', 'otro') then
        v_err := 'invalid_line_role';
      end if;
    when 'collection_write_off' then
      v_ok := v_key = 'fees_other';
    when 'collection_control' then
      v_ok := v_doc_party_id is not null and (a.id = v_dp.receivable_account_id or v_key = 'receivable_customers');
    when 'cash_diff' then
      v_ok := v_key = case when v_side = 'debit' then 'cash_short' else 'cash_over' end;
    when 'sales_receivable' then
      v_ok := a.requires_party and v_party_id is not null
              and (a.id = v_lp.receivable_account_id or v_key = 'receivable_customers');
    when 'customer_deposits' then
      v_ok := v_key = 'customer_deposits';
    when 'sales_invoiced' then
      if v_channel is null then v_err := 'invalid_bundle'; else v_ok := v_key = 'sales_' || v_channel || '_invoiced'; end if;
    when 'sales_uninvoiced' then
      if v_channel is null then
        v_err := 'invalid_bundle';
      else
        v_ok := v_key = 'sales_' || v_channel || '_uninvoiced'
                or (p_ctx ->> 'uninvoiced_sales_mode' = 'single_account' and v_key = 'sales_' || v_channel || '_invoiced');
      end if;
    when 'vat_debit' then
      v_ok := v_key = 'vat_debit';
    when 'sales_control' then
      v_ok := v_doc_party_id is not null and a.id = v_dp.receivable_account_id;
    when 'bank_other_tax' then
      if v_tax in ('ley_25413_credito', 'ley_25413_debito') then
        v_ok := v_key in ('bank_tax_credit', 'bank_tax_expense');
      elsif v_tax = 'sircreb' then
        v_ok := v_key = 'iibb_sircreb';
      elsif v_tax = 'interes' then
        v_ok := v_key = 'interest_expense';
      elsif v_tax = 'otro' then
        v_ok := v_imp;
      else
        v_err := 'invalid_line_role';
      end if;
    when 'counterpart' then
      -- Cualquier imputable que no sea de caja ni de IVA (con partícipe si la cuenta lo pide).
      v_ok := a.postable and not a.is_treasury
              and coalesce(v_key not in ('vat_credit', 'vat_credit_pending', 'vat_technical_balance', 'vat_free_balance',
                                         'vat_perceptions', 'vat_withholdings', 'vat_debit', 'vat_payable'), true);
    when 'adjustment_split' then
      -- Nunca una diferencia de banco o billetera como faltante de caja (E.5.13).
      v_ok := v_key = any (case p_ctx ->> 'treasury_kind'
        when 'cash' then array['cash_short', 'cash_over']
        when 'wallet' then array['fees_wallets', 'iibb_sircupa', 'vat_credit_pending', 'interest_income',
                                 'reconciliation_differences']
        when 'bank' then array['bank_fees', 'interest_income', 'reconciliation_differences']
        when 'credit_card' then array['fees_other', 'reconciliation_differences']
        when 'other' then array['reconciliation_differences', 'cash_short', 'cash_over']
        else array[]::text[] end);
      if not coalesce(v_ok, false) then
        v_err := 'adjustment_account_invalid';
        v_detail := v_detail || jsonb_build_object('treasury_name', p_ctx ->> 'treasury_name');
      end if;
    when 'any_postable' then
      v_ok := a.postable;
    when 'settlement' then
      v_ok := v_key in ('vat_debit', 'vat_credit', 'vat_perceptions', 'vat_withholdings', 'vat_technical_balance',
                        'vat_free_balance', 'vat_payable');
    when 'reversal' then
      v_ok := true;
    when 'fy_result' then
      v_ok := a.type in ('income', 'expense') or v_key = 'current_year_result';
    when 'mirror' then
      v_ok := a.type in ('asset', 'liability', 'equity');
    else
      v_err := 'invalid_line_role';
  end case;
  if v_err is not null or not coalesce(v_ok, false) then
    perform private.acc_raise(coalesce(v_err, 'line_account_invalid'), v_detail);
  end if;
end;
$$;

-- ─── 6. Conciliación con el comprobante fiscal (C.3.5) ────────────────────────
-- Σ de los renglones de un comprobante por rol; p_tax_kind / p_rate null = todos.
create function private.acc_doc_sum(p_document_id uuid, p_role text, p_tax_kind text default null, p_rate int default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(dl.amount_cents), 0)::bigint
    from public.acc_document_lines dl
   where dl.document_id = p_document_id and dl.role = p_role
     and (p_tax_kind is null or dl.tax_kind = p_tax_kind)
     and (p_rate is null or dl.vat_rate_bp = p_rate)
$$;

-- Sobre lo ya insertado (renglones y filas del libro), antes del asiento. fiscal_mismatch con
-- {document_id, reason} = el primer desvío (mismas razones que reconcileFiscal de validate.ts).
-- Una rama por tipo: las fases siguientes la reemplazan sumando la suya.
create function private.acc_reconcile_fiscal(p_tenant uuid, p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  f public.acc_fiscal_vouchers;
  v_rows int;
  v_reason text;
begin
  select * into d from public.acc_documents x where x.id = p_document_id and x.tenant_id = p_tenant;
  if not found then
    perform private.acc_raise('document_not_found', jsonb_build_object('document_id', p_document_id));
  end if;
  select count(*) into v_rows from public.acc_fiscal_vouchers x where x.document_id = d.id and x.tenant_id = p_tenant;
  if v_rows = 0 and d.kind <> 'sales_close' then
    return;                                 -- sin filas del libro no hay nada que conciliar (el cierre sí: «sin factura»)
  end if;
  select * into f from public.acc_fiscal_vouchers x where x.document_id = d.id and x.tenant_id = p_tenant
   order by x.created_at, x.id limit 1;

  if d.kind = 'bank_expense' then
    -- Resumen bancario: hoy solo la alícuota 21 % (igual que el motor).
    v_reason := case
      when v_rows <> 1 then 'bank_rows'
      when private.acc_doc_sum(d.id, 'net') <> f.net_21_cents then 'bank_net'
      when private.acc_doc_sum(d.id, 'vat') <> f.vat_21_cents then 'bank_vat'
      when private.acc_doc_sum(d.id, 'perception') <> f.perc_iva_cents then 'bank_perception' end;
  else
    v_reason := 'kind_not_supported';     -- compras (#12) y ventas/cobranzas (#13) suman su rama
  end if;

  if v_reason is not null then
    perform private.acc_raise('fiscal_mismatch', jsonb_build_object('document_id', d.id, 'reason', v_reason));
  end if;
end;
$$;

comment on function private.acc_line_rule(text, text) is
  'Matriz de roles de C.3.4 (versión fase 1): lados y regla de cuenta de cada (tipo, rol). Cada fase la reemplaza sumando filas; un tipo sin filas no está habilitado (kind_not_allowed).';
comment on function private.acc_validate_line(uuid, jsonb, jsonb, jsonb) is
  'Valida un renglón normalizado contra la matriz (C.3.3 paso 6): forma, rol y lado, cuenta, partícipe, caja, medio de cobro y regla de cuenta del rol. Levanta la primera clave que falla.';
comment on function private.acc_reconcile_fiscal(uuid, uuid) is
  'Conciliación de C.3.5 sobre lo ya insertado (antes del asiento). Versión fase 1: resumen bancario. fiscal_mismatch con {document_id, reason}.';

-- Permisos de las funciones de esta parte: internas, nadie las ejecuta salvo las RPC definer.
revoke all on function private.acc_raise(text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_jtext(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_jbig(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_juuid(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_jdate(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_jbool(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_jkey(uuid, jsonb, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function private.acc_voucher_info(text) from public, anon, authenticated;
revoke all on function private.acc_is_imputation(public.acc_accounts) from public, anon, authenticated;
revoke all on function private.acc_line_rule(text, text) from public, anon, authenticated;
revoke all on function private.acc_validate_line(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.acc_doc_sum(uuid, text, text, int) from public, anon, authenticated;
revoke all on function private.acc_reconcile_fiscal(uuid, uuid) from public, anon, authenticated;
