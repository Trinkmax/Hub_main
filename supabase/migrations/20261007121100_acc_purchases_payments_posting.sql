-- Parte 1 (grupo 12a, posting) de la migración #12 (acc_purchases_payments). Partida en varias solo para
-- que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke.
-- Fase 2 de §C.3.4/§C.3.5: habilita en acc_post_bundle las compras, NC y ND de proveedor y las órdenes de pago.
-- La #9 ya valida todo lo demás para estos tipos (acc_check_document: partícipe, tipo de comprobante, duplicados,
-- comprobante fiscal, factura de comisiones, compensaciones, write_off; acc_validate_line: TODAS las reglas de
-- cuenta de checkAccountRule); acá solo se suman sus filas a la matriz y su rama a la conciliación:
--   · private.acc_line_rule        filas de fase 1 copiadas TAL CUAL de la #9 + purchase, purchase_debit_note,
--                                  purchase_credit_note (lados invertidos) y payment
--   · private.acc_reconcile_fiscal resumen bancario igual que la #9 + compras (factura, ND, NC y factura mensual
--                                  de comisiones); el resto sigue en kind_not_supported hasta la #13
-- Mismas firmas, mismo tipo de retorno, mismo lenguaje y seguridad que la #9 (create or replace). Espejo de
-- lib/accounting/validate.ts (MATRIX/lineRule y reconcileFiscal): mismos nombres de regla y mismos «reason».

-- ─── 1. La matriz de roles (C.3.4), versión fase 2 ────────────────────────────
-- Una fila por (tipo, rol): lados permitidos y regla de cuenta (los nombres de AccountRule de validate.ts).
-- Fase 3 (#13) suma sales_close, collection y ventas sueltas; fase 4 (#15) fy_result/fy_closing/fy_opening.
-- Un tipo sin filas → kind_not_allowed.
create or replace function private.acc_line_rule(p_kind text, p_role text)
returns table (sides public.acc_side[], account_rule text)
language sql
immutable
set search_path = ''
as $$
  select r.sides, r.account_rule
    from (values
      -- [fase 1 · #9] (copia exacta)
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
      ('reversal', 'reversal', '{debit,credit}', 'reversal'),
      -- [fase 2 · #12] Compra y ND de proveedor (E.5.1); vat_pending_release solo en la factura de comisiones
      -- (acc_validate_line lo restringe a settles_commissions).
      ('purchase', 'net', '{debit}', 'imputation'),
      ('purchase', 'vat', '{debit}', 'purchase_vat'),
      ('purchase', 'gross', '{debit}', 'imputation'),
      ('purchase', 'non_taxed', '{debit}', 'imputation'),
      ('purchase', 'exempt', '{debit}', 'imputation'),
      ('purchase', 'internal_tax', '{debit}', 'imputation'),
      ('purchase', 'perception', '{debit}', 'purchase_perception'),
      ('purchase', 'other_tax', '{debit}', 'imputation_or_other_taxes'),
      ('purchase', 'control', '{credit}', 'purchase_control'),
      ('purchase', 'vat_pending_release', '{credit}', 'vat_credit_pending'),
      ('purchase_debit_note', 'net', '{debit}', 'imputation'),
      ('purchase_debit_note', 'vat', '{debit}', 'purchase_vat'),
      ('purchase_debit_note', 'gross', '{debit}', 'imputation'),
      ('purchase_debit_note', 'non_taxed', '{debit}', 'imputation'),
      ('purchase_debit_note', 'exempt', '{debit}', 'imputation'),
      ('purchase_debit_note', 'internal_tax', '{debit}', 'imputation'),
      ('purchase_debit_note', 'perception', '{debit}', 'purchase_perception'),
      ('purchase_debit_note', 'other_tax', '{debit}', 'imputation_or_other_taxes'),
      ('purchase_debit_note', 'control', '{credit}', 'purchase_control'),
      ('purchase_debit_note', 'vat_pending_release', '{credit}', 'vat_credit_pending'),
      -- [fase 2 · #12] NC de proveedor (E.5.2): los mismos roles, del lado contrario.
      ('purchase_credit_note', 'net', '{credit}', 'imputation'),
      ('purchase_credit_note', 'vat', '{credit}', 'purchase_vat'),
      ('purchase_credit_note', 'gross', '{credit}', 'imputation'),
      ('purchase_credit_note', 'non_taxed', '{credit}', 'imputation'),
      ('purchase_credit_note', 'exempt', '{credit}', 'imputation'),
      ('purchase_credit_note', 'internal_tax', '{credit}', 'imputation'),
      ('purchase_credit_note', 'perception', '{credit}', 'purchase_perception'),
      ('purchase_credit_note', 'other_tax', '{credit}', 'imputation_or_other_taxes'),
      ('purchase_credit_note', 'control', '{debit}', 'purchase_control'),
      ('purchase_credit_note', 'vat_pending_release', '{debit}', 'vat_credit_pending'),
      -- [fase 2 · #12] Orden de pago (E.5.5).
      ('payment', 'control', '{debit}', 'payment_control'),
      ('payment', 'treasury', '{credit}', 'treasury'),
      ('payment', 'compensation', '{credit}', 'compensation'),
      ('payment', 'write_off', '{credit}', 'payment_write_off')
    ) as r(kind, role, sides, account_rule)
   where r.kind = p_kind and r.role = p_role
$$;

-- ─── 2. Conciliación con el comprobante fiscal (C.3.5), versión fase 2 ────────
-- Sobre lo ya insertado (renglones y filas del libro), antes del asiento. fiscal_mismatch con
-- {document_id, reason} = el primer desvío (mismas razones que reconcileFiscal de validate.ts).
-- Compras (purchase, purchase_debit_note, purchase_credit_note): una sola fila (purchase_rows); como red,
-- identidad de la fila con la cabecera (identity) y contraparte (counterparty), que acc_check_document ya
-- validó en el payload. Factura mensual de comisiones: Σ vat = Σ IVA de la fila = computable =
-- Σ vat_pending_release y total = total. El resto, por alícuota Σ net = neto_r y Σ vat = IVA_r (al 0 % no hay
-- IVA), Σ vat en vat_credit = computable, gross = no discriminado, no gravado, exento, internos, otros
-- tributos, percepciones por tipo y total. Una NC lleva todo en positivo, igual que su fila.
create or replace function private.acc_reconcile_fiscal(p_tenant uuid, p_document_id uuid)
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
  s record;
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
    -- [fase 1 · #9] Resumen bancario: hoy solo la alícuota 21 % (igual que el motor).
    v_reason := case
      when v_rows <> 1 then 'bank_rows'
      when private.acc_doc_sum(d.id, 'net') <> f.net_21_cents then 'bank_net'
      when private.acc_doc_sum(d.id, 'vat') <> f.vat_21_cents then 'bank_vat'
      when private.acc_doc_sum(d.id, 'perception') <> f.perc_iva_cents then 'bank_perception' end;
  elsif d.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note') then
    -- [fase 2 · #12] Compras.
    select coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 0), 0) as net_0,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 0), 0) as vat_0,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 250), 0) as net_250,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 250), 0) as vat_250,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 500), 0) as net_500,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 500), 0) as vat_500,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 1050), 0) as net_1050,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 1050), 0) as vat_1050,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 2100), 0) as net_2100,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 2100), 0) as vat_2100,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'net' and dl.vat_rate_bp = 2700), 0) as net_2700,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and dl.vat_rate_bp = 2700), 0) as vat_2700,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat'), 0) as vat_all,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat' and a.system_key = 'vat_credit'), 0) as vat_cf,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'gross'), 0) as gross,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'non_taxed'), 0) as non_taxed,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'exempt'), 0) as exempt,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'internal_tax'), 0) as internal_tax,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'other_tax'), 0) as other_tax,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'perception' and dl.tax_kind = 'iva'), 0) as perc_iva,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'perception' and dl.tax_kind = 'iibb'), 0) as perc_iibb,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'perception' and dl.tax_kind = 'ganancias'), 0) as perc_ganancias,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'perception' and dl.tax_kind = 'municipal'), 0) as perc_municipal,
           coalesce(sum(dl.amount_cents) filter (where dl.role = 'vat_pending_release'), 0) as released
      into s
      from public.acc_document_lines dl
      join public.acc_accounts a on a.id = dl.account_id and a.tenant_id = dl.tenant_id
     where dl.document_id = d.id and dl.tenant_id = p_tenant;
    v_reason := case
      when v_rows <> 1 then 'purchase_rows'
      when f.book <> 'purchases' or f.voucher_type is distinct from d.voucher_type
        or f.afip_voucher_code is distinct from d.afip_voucher_code or f.point_of_sale is distinct from d.point_of_sale
        or f.number_from is distinct from d.number or f.number_to is not null or f.voucher_date <> d.issue_date
        or f.is_credit_note <> (d.kind = 'purchase_credit_note') then 'identity'
      when f.counterparty_party_id is not null and f.counterparty_party_id is distinct from d.party_id then 'counterparty'
      when d.settles_commissions then case
        when s.vat_all <> f.vat_25_cents + f.vat_5_cents + f.vat_105_cents + f.vat_21_cents + f.vat_27_cents
          then 'commissions_vat'
        when s.vat_all <> f.vat_computable_cents then 'commissions_computable'
        when s.vat_all <> s.released then 'commissions_release'
        when f.total_cents <> d.total_cents then 'commissions_total' end
      when s.net_0 <> f.net_0_cents then 'net_0'
      when s.vat_0 <> 0 then 'vat_0'
      when s.net_250 <> f.net_25_cents then 'net_250'
      when s.vat_250 <> f.vat_25_cents then 'vat_250'
      when s.net_500 <> f.net_5_cents then 'net_500'
      when s.vat_500 <> f.vat_5_cents then 'vat_500'
      when s.net_1050 <> f.net_105_cents then 'net_1050'
      when s.vat_1050 <> f.vat_105_cents then 'vat_1050'
      when s.net_2100 <> f.net_21_cents then 'net_2100'
      when s.vat_2100 <> f.vat_21_cents then 'vat_2100'
      when s.net_2700 <> f.net_27_cents then 'net_2700'
      when s.vat_2700 <> f.vat_27_cents then 'vat_2700'
      when s.vat_cf <> f.vat_computable_cents then 'vat_computable'
      when s.gross <> f.undiscriminated_cents then 'undiscriminated'
      when s.non_taxed <> f.non_taxed_cents then 'non_taxed'
      when s.exempt <> f.exempt_cents then 'exempt'
      when s.internal_tax <> f.internal_taxes_cents then 'internal_taxes'
      when s.other_tax <> f.other_taxes_cents then 'other_taxes'
      when s.perc_iva <> f.perc_iva_cents then 'perc_iva'
      when s.perc_iibb <> f.perc_iibb_cents then 'perc_iibb'
      when s.perc_ganancias <> f.perc_ganancias_cents then 'perc_ganancias'
      when s.perc_municipal <> f.perc_municipal_cents then 'perc_municipal'
      when f.total_cents <> d.total_cents then 'total' end;
  else
    v_reason := 'kind_not_supported';     -- ventas, cierres y cobranzas (#13) suman su rama
  end if;

  if v_reason is not null then
    perform private.acc_raise('fiscal_mismatch', jsonb_build_object('document_id', d.id, 'reason', v_reason));
  end if;
end;
$$;

comment on function private.acc_line_rule(text, text) is
  'Matriz de roles de C.3.4 (versión fase 2: + compras, NC y ND de proveedor y pagos): lados y regla de cuenta de cada (tipo, rol). Cada fase la reemplaza sumando filas; un tipo sin filas no está habilitado (kind_not_allowed).';
comment on function private.acc_reconcile_fiscal(uuid, uuid) is
  'Conciliación de C.3.5 sobre lo ya insertado (antes del asiento). Versión fase 2: resumen bancario + compras. fiscal_mismatch con {document_id, reason}.';

-- Permisos: internas, nadie las ejecuta salvo las RPC definer (create or replace conserva los de la #9).
revoke all on function private.acc_line_rule(text, text) from public, anon, authenticated;
revoke all on function private.acc_reconcile_fiscal(uuid, uuid) from public, anon, authenticated;
