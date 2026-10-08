-- Parte 1 de 5 de la migración #13 (acc_sales_collections), partida en cinco para que cada apply_migration por
-- MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke/grant.
-- Fase 3 de §C.3.4/§C.3.5: habilita en acc_post_bundle el cierre de ventas del día, las ventas sueltas (factura,
-- ND y NC) y las cobranzas o acreditaciones. La #9 ya valida todo lo demás para estos tipos (acc_check_document:
-- partícipe y su tipo, tipo de comprobante, duplicados de ventas, rangos que se pisan, cierre repetido, IVA por
-- rango con su tolerancia, totales, arqueo de billetera, facturado de más con motivo; acc_validate_line: medio
-- de cobro de cada renglón y TODAS las reglas de cuenta de checkAccountRule); acá solo se suman sus filas a la
-- matriz y sus ramas a la conciliación:
--   · private.acc_line_rule        filas de fase 1 (#9) y fase 2 (#12) copiadas TAL CUAL de la versión aplicada
--                                  (12a·1) + collection, sales_close, sales_invoice, sales_debit_note y
--                                  sales_credit_note (lados invertidos): espejo de MATRIX de validate.ts
--   · private.acc_reconcile_fiscal resumen bancario y compras copiados TAL CUAL de 12a·1 + cobranzas (comprobante
--                                  de la comisión) y ventas (cierre y ventas sueltas), con los «reason» de
--                                  reconcileFiscal: collection_rows, commission_net|vat|perception|computable,
--                                  sales_invoiced_<canal>, sales_vat_<alícuota>, sales_uninvoiced_<canal>; y
--                                  como red: identity, counterparty, commission_total, sales_rows
-- Mismas firmas, mismo tipo de retorno, mismo lenguaje y seguridad (create or replace). Después de esta parte
-- solo quedan sin filas iva_settlement/reversal (los genera su RPC) y fy_* (#15).

-- ─── 1. La matriz de roles (C.3.4), versión fase 3 ────────────────────────────
-- Una fila por (tipo, rol): lados permitidos y regla de cuenta (los nombres de AccountRule de validate.ts).
-- Fase 4 (#15) suma fy_result/fy_closing/fy_opening. Un tipo sin filas → kind_not_allowed.
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
      ('sales_credit_note', 'vat', '{debit}', 'vat_debit')
    ) as r(kind, role, sides, account_rule)
   where r.kind = p_kind and r.role = p_role
$$;

-- ─── 2. Conciliación con el comprobante fiscal (C.3.5), versión fase 3 ────────
-- Sobre lo ya insertado (renglones y filas del libro), antes del asiento. fiscal_mismatch con
-- {document_id, reason} = el primer desvío (mismas razones que reconcileFiscal de validate.ts). Resumen bancario
-- y compras: sin cambios (12a·1). Cobranza sin comprobante de la comisión: no hay nada que conciliar.
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
  elsif d.kind = 'collection' then
    -- [fase 3 · #13] Cobranza con el comprobante de la comisión (liquidación o factura, libro de compras): una
    -- sola fila; como red, su identidad con la cabecera, la contraparte = el partícipe y que la fila no traiga
    -- más que comisión, IVA y percepción. Después, lo descontado contra la fila (reconcileFiscal).
    select coalesce(sum(dl.amount_cents) filter (where dl.tax_kind = 'comision'), 0) as comm,
           coalesce(sum(dl.amount_cents) filter (where dl.tax_kind = 'iva_comision'), 0) as vat,
           coalesce(sum(dl.amount_cents) filter (where dl.tax_kind = 'percepcion_iva_comision'), 0) as perc,
           coalesce(sum(dl.amount_cents) filter (where dl.tax_kind = 'iva_comision' and a.system_key = 'vat_credit'), 0)
             as computable
      into s
      from public.acc_document_lines dl
      join public.acc_accounts a on a.id = dl.account_id and a.tenant_id = dl.tenant_id
     where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role = 'deduction';
    v_reason := case
      when v_rows <> 1 then 'collection_rows'
      when f.book <> 'purchases' or f.is_credit_note or f.voucher_type is distinct from d.voucher_type
        or f.afip_voucher_code is distinct from d.afip_voucher_code or f.point_of_sale is distinct from d.point_of_sale
        or f.number_from is distinct from d.number or f.number_to is not null then 'identity'
      when f.counterparty_party_id is distinct from d.party_id then 'counterparty'
      when f.total_cents <> f.net_21_cents + f.vat_21_cents + f.perc_iva_cents then 'commission_total'
      when s.comm <> f.net_21_cents then 'commission_net'
      when s.vat <> f.vat_21_cents then 'commission_vat'
      when s.perc <> f.perc_iva_cents then 'commission_perception'
      when s.computable <> f.vat_computable_cents then 'commission_computable' end;
  elsif d.kind in ('sales_close', 'sales_invoice', 'sales_credit_note', 'sales_debit_note') then
    -- [fase 3 · #13] Ventas (cierre del día y ventas sueltas). Como red: la venta suelta lleva una sola fila del
    -- libro de ventas con el signo de su tipo (identity); el cierre, solo filas del libro de ventas con tipos de
    -- venta y el signo de su tipo (sales_rows). Después, igual que reconcileFiscal: por canal, Σ con signo (NC −)
    -- de netos + no gravado + exento de las filas = Σ con signo de sales_invoiced; por alícuota, Σ con signo del
    -- IVA de las filas = Σ con signo de los renglones vat; en el cierre, por canal, vendido (cajas, partidas y
    -- señas por el canal de su medio + la diferencia de caja en el canal del primer renglón de caja) − facturado
    -- − IVA de las filas = sin factura (renglones, con signo).
    if d.kind <> 'sales_close' then
      v_reason := case
        when v_rows <> 1 then 'sales_rows'
        when f.book <> 'sales' or f.is_credit_note <> (d.kind = 'sales_credit_note') then 'identity' end;
    elsif exists (select 1 from public.acc_fiscal_vouchers x
                   where x.document_id = d.id and x.tenant_id = p_tenant
                     and (x.book <> 'sales'
                          or x.voucher_type not in ('factura_a', 'factura_b', 'nota_debito_a', 'nota_debito_b',
                                                    'nota_credito_a', 'nota_credito_b', 'tique_factura_a', 'tique_factura_b')
                          or x.is_credit_note <> (x.voucher_type in ('nota_credito_a', 'nota_credito_b')))) then
      v_reason := 'sales_rows';
    end if;
    if v_reason is null then
      select 'sales_invoiced_' || c.ch into v_reason
        from (select fv.channel as ch,
                     (case when fv.is_credit_note then -1 else 1 end)
                       * (fv.net_0_cents + fv.net_25_cents + fv.net_5_cents + fv.net_105_cents + fv.net_21_cents
                          + fv.net_27_cents + fv.non_taxed_cents + fv.exempt_cents) as amt
                from public.acc_fiscal_vouchers fv
               where fv.document_id = d.id and fv.tenant_id = p_tenant
              union all
              select dl.channel, -(case when dl.side = 'credit' then dl.amount_cents else -dl.amount_cents end)
                from public.acc_document_lines dl
               where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role = 'sales_invoiced') c
       group by c.ch
      having sum(c.amt) <> 0
       order by array_position(array['salon', 'delivery', 'events'], c.ch)
       limit 1;
    end if;
    if v_reason is null then
      select 'sales_vat_' || r.rate::text into v_reason
        from (values (0), (250), (500), (1050), (2100), (2700)) as r(rate)
       where (select coalesce(sum((case when fv.is_credit_note then -1 else 1 end)
                                  * case r.rate when 250 then fv.vat_25_cents when 500 then fv.vat_5_cents
                                                when 1050 then fv.vat_105_cents when 2100 then fv.vat_21_cents
                                                when 2700 then fv.vat_27_cents else 0 end), 0)
                from public.acc_fiscal_vouchers fv
               where fv.document_id = d.id and fv.tenant_id = p_tenant)
             <> (select coalesce(sum(case when dl.side = 'credit' then dl.amount_cents else -dl.amount_cents end), 0)
                   from public.acc_document_lines dl
                  where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role = 'vat' and dl.vat_rate_bp = r.rate)
       order by r.rate
       limit 1;
    end if;
    if v_reason is null and d.kind = 'sales_close' then
      select 'sales_uninvoiced_' || c.ch into v_reason
        from (select m.channel as ch, dl.amount_cents as amt
                from public.acc_document_lines dl
                join public.acc_sales_methods m on m.id = dl.sales_method_id and m.tenant_id = dl.tenant_id
               where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role in ('treasury', 'receivable', 'advance')
              union all
              select (select m.channel
                        from public.acc_document_lines t
                        join public.acc_sales_methods m on m.id = t.sales_method_id and m.tenant_id = t.tenant_id
                       where t.document_id = d.id and t.tenant_id = p_tenant and t.role = 'treasury'
                       order by t.line_no
                       limit 1),
                     sum(case when dl.side = 'debit' then dl.amount_cents else -dl.amount_cents end)
                from public.acc_document_lines dl
               where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role = 'cash_diff'
              union all
              select dl.channel, -(case when dl.side = 'credit' then dl.amount_cents else -dl.amount_cents end)
                from public.acc_document_lines dl
               where dl.document_id = d.id and dl.tenant_id = p_tenant and dl.role in ('sales_invoiced', 'sales_uninvoiced')
              union all
              select fv.channel, -(case when fv.is_credit_note then -1 else 1 end)
                                   * (fv.vat_25_cents + fv.vat_5_cents + fv.vat_105_cents + fv.vat_21_cents + fv.vat_27_cents)
                from public.acc_fiscal_vouchers fv
               where fv.document_id = d.id and fv.tenant_id = p_tenant) c
       where c.ch is not null
       group by c.ch
      having coalesce(sum(c.amt), 0) <> 0
       order by array_position(array['salon', 'delivery', 'events'], c.ch)
       limit 1;
    end if;
  else
    v_reason := 'kind_not_supported';     -- cierres de ejercicio y lo que no concilia con un libro IVA
  end if;

  if v_reason is not null then
    perform private.acc_raise('fiscal_mismatch', jsonb_build_object('document_id', d.id, 'reason', v_reason));
  end if;
end;
$$;

comment on function private.acc_line_rule(text, text) is
  'Matriz de roles de C.3.4 (versión fase 3: + cierre del día, ventas sueltas y cobranzas): lados y regla de cuenta de cada (tipo, rol). Cada fase la reemplaza sumando filas; un tipo sin filas no está habilitado (kind_not_allowed).';
comment on function private.acc_reconcile_fiscal(uuid, uuid) is
  'Conciliación de C.3.5 sobre lo ya insertado (antes del asiento). Versión fase 3: resumen bancario, compras, cobranzas (comprobante de la comisión) y ventas (cierre del día y ventas sueltas). fiscal_mismatch con {document_id, reason}.';

-- Permisos: internas, nadie las ejecuta salvo las RPC definer (create or replace conserva los de antes).
revoke all on function private.acc_line_rule(text, text) from public, anon, authenticated;
revoke all on function private.acc_reconcile_fiscal(uuid, uuid) from public, anon, authenticated;
