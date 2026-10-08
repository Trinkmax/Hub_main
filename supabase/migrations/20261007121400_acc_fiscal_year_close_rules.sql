-- Parte 1 de 2 de la migración #15 (acc_fiscal_year_close): la matriz de roles con el cierre de ejercicio.
-- Partida en dos para que esta parte sea SOLO private.acc_line_rule y se pueda re-basar sobre la versión vigente
-- sin tocar las RPC (parte 2). Su revoke viaja con ella; el notify pgrst va al final de la parte 2.
-- ============================================================
-- Sprint 1 «Administración» · fase 4 · migración #15 (acc_fiscal_year_close) · spec §C.3.4, §C.5.5, §I.1 #15
-- ============================================================
-- private.acc_line_rule (create or replace: misma firma, retorno, lenguaje y seguridad): TODAS las filas de la
-- versión vigente copiadas tal cual + fy_result/fy_result, fy_closing/mirror y fy_opening/mirror, Debe o Haber
-- (las tres de MATRIX en lib/accounting/validate.ts). acc_post_bundle sigue rechazando fy_* (kind_not_allowed):
-- esos comprobantes los escribe solo acc_close_fiscal_year (parte 2), que valida cada renglón con
-- acc_validate_line contra esta matriz.
-- Base: 20261007121200_acc_sales_collections_rules.sql (71 filas, huella 0e3be86da41c8ace335043200eba7718); esta versión: 74 filas, huella 37cb700c2b9fb8cb08c553d84ac96384.
-- Huella = md5 de «kind|role|sides|regla» de cada fila, ordenadas por (kind, role) en collation C.
-- Si al aplicar la matriz vigente es otra (la #13 suma ventas y cobranzas), la primera guarda aborta con
-- acc_line_rule_rebase_required: regenerar este archivo con sqltests/parts15/rebase_line_rule.py (toma la última
-- migración que declara acc_line_rule) y volver a ensayar. La segunda guarda verifica que lo nuevo sean
-- exactamente las tres filas de la fase 4.
-- ============================================================

-- Guarda 1: la matriz vigente es la base de este archivo (ninguna fila aplicada se pierde).
do $$
declare
  v_fp text;
begin
  select md5(coalesce(string_agg(k.kind || '|' || ro.role || '|' || r.sides::text || '|' || r.account_rule,
                                 E'\n' order by k.kind collate "C", ro.role collate "C"), ''))
    into v_fp
    from unnest(array['opening', 'purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense', 'payment', 'sales_close', 'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection', 'transfer', 'bank_expense', 'cash_movement', 'treasury_adjustment', 'manual', 'reversal', 'iva_settlement', 'fy_result', 'fy_closing', 'fy_opening']) as k(kind)
   cross join unnest(array['net', 'vat', 'gross', 'non_taxed', 'exempt', 'internal_tax', 'perception', 'other_tax', 'control', 'treasury', 'compensation', 'deduction', 'write_off', 'receivable', 'advance', 'sales_invoiced', 'sales_uninvoiced', 'cash_diff', 'vat_pending_release', 'counterpart', 'adjustment_split', 'manual', 'opening', 'settlement', 'reversal', 'fy_result', 'mirror']) as ro(role)
   cross join lateral private.acc_line_rule(k.kind, ro.role) as r;
  if v_fp is distinct from '0e3be86da41c8ace335043200eba7718' then
    raise exception 'acc_line_rule_rebase_required' using errcode = 'P0001',
      detail = jsonb_build_object('applied', v_fp, 'expected', '0e3be86da41c8ace335043200eba7718')::text;
  end if;
end $$;

-- ─── La matriz de roles (C.3.4), versión fase 4 ──────────────────────────────
-- Una fila por (tipo, rol): lados permitidos y regla de cuenta (los nombres de AccountRule de validate.ts).
-- Un tipo sin filas → kind_not_allowed. fy_* nunca entra por acc_post_bundle.
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
      ('payment', 'write_off', '{credit}', 'payment_write_off'),
      -- [fase 3 · #13] Cobranza o acreditación (E.5.7): cajas, deducciones y redondeo al Debe; la partida
      -- «nos debe» del partícipe al Haber.
      ('collection', 'treasury', '{debit}', 'treasury'),
      ('collection', 'deduction', '{debit}', 'collection_deduction'),
      ('collection', 'write_off', '{debit}', 'collection_write_off'),
      ('collection', 'control', '{credit}', 'collection_control'),
      -- [fase 3 · #13] Cierre de ventas del día (E.5.6): ventas, sin factura e IVA pueden ir al Debe (NC del canal
      -- o facturado de más con motivo); la diferencia de caja, faltante al Debe y sobrante al Haber.
      ('sales_close', 'treasury', '{debit}', 'treasury'),
      ('sales_close', 'cash_diff', '{debit,credit}', 'cash_diff'),
      ('sales_close', 'receivable', '{debit}', 'sales_receivable'),
      ('sales_close', 'advance', '{debit}', 'customer_deposits'),
      ('sales_close', 'sales_invoiced', '{debit,credit}', 'sales_invoiced'),
      ('sales_close', 'sales_uninvoiced', '{debit,credit}', 'sales_uninvoiced'),
      ('sales_close', 'vat', '{debit,credit}', 'vat_debit'),
      -- [fase 3 · #13] Factura y ND de venta suelta (E.5.9).
      ('sales_invoice', 'control', '{debit}', 'sales_control'),
      ('sales_invoice', 'sales_invoiced', '{credit}', 'sales_invoiced'),
      ('sales_invoice', 'vat', '{credit}', 'vat_debit'),
      ('sales_debit_note', 'control', '{debit}', 'sales_control'),
      ('sales_debit_note', 'sales_invoiced', '{credit}', 'sales_invoiced'),
      ('sales_debit_note', 'vat', '{credit}', 'vat_debit'),
      -- [fase 3 · #13] NC de venta: los mismos roles, del lado contrario.
      ('sales_credit_note', 'control', '{credit}', 'sales_control'),
      ('sales_credit_note', 'sales_invoiced', '{debit}', 'sales_invoiced'),
      ('sales_credit_note', 'vat', '{debit}', 'vat_debit'),
      -- [fase 4 · #15] Cierre de ejercicio (C.5.5, E.5.18): refundición (fy_result: hojas de ingreso o egreso y
      -- «Resultado del ejercicio») y espejos sin partícipe (mirror: hojas de activo, pasivo y patrimonio neto).
      ('fy_result', 'fy_result', '{debit,credit}', 'fy_result'),
      ('fy_closing', 'mirror', '{debit,credit}', 'mirror'),
      ('fy_opening', 'mirror', '{debit,credit}', 'mirror')
    ) as r(kind, role, sides, account_rule)
   where r.kind = p_kind and r.role = p_role
$$;

-- Guarda 2: lo nuevo son exactamente las tres filas de la fase 4.
do $$
declare
  v_fp text;
begin
  select md5(coalesce(string_agg(k.kind || '|' || ro.role || '|' || r.sides::text || '|' || r.account_rule,
                                 E'\n' order by k.kind collate "C", ro.role collate "C"), ''))
    into v_fp
    from unnest(array['opening', 'purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense', 'payment', 'sales_close', 'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection', 'transfer', 'bank_expense', 'cash_movement', 'treasury_adjustment', 'manual', 'reversal', 'iva_settlement', 'fy_result', 'fy_closing', 'fy_opening']) as k(kind)
   cross join unnest(array['net', 'vat', 'gross', 'non_taxed', 'exempt', 'internal_tax', 'perception', 'other_tax', 'control', 'treasury', 'compensation', 'deduction', 'write_off', 'receivable', 'advance', 'sales_invoiced', 'sales_uninvoiced', 'cash_diff', 'vat_pending_release', 'counterpart', 'adjustment_split', 'manual', 'opening', 'settlement', 'reversal', 'fy_result', 'mirror']) as ro(role)
   cross join lateral private.acc_line_rule(k.kind, ro.role) as r;
  if v_fp is distinct from '37cb700c2b9fb8cb08c553d84ac96384' then
    raise exception 'acc_line_rule_rebase_required' using errcode = 'P0001',
      detail = jsonb_build_object('applied', v_fp, 'expected', '37cb700c2b9fb8cb08c553d84ac96384')::text;
  end if;
end $$;

comment on function private.acc_line_rule(text, text) is
  'Matriz de roles de C.3.4 (versión fase 4: la de la fase anterior + cierre de ejercicio fy_result/fy_closing/fy_opening): lados y regla de cuenta de cada (tipo, rol). Cada fase la reemplaza sumando filas; un tipo sin filas no está habilitado (kind_not_allowed).';

-- Permisos: interna, nadie la ejecuta salvo las RPC definer (create or replace conserva los anteriores).
revoke all on function private.acc_line_rule(text, text) from public, anon, authenticated;
