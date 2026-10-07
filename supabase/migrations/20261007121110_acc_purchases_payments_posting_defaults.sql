-- Parte 2 (grupo 12a, posting) de la migración #12 (acc_purchases_payments). Partida en varias solo para
-- que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke/grant.
-- Lecturas de los formularios de compras y gastos (§C.6, §H.5, §H.6), sin tablas nuevas:
--   · acc_doc_label            «Factura A 0003-00001290» / «Pago» (la usan esta parte y la 12b)
--   · acc_form_defaults        lo que el sistema recuerda de un proveedor
--   · acc_quick_expense_suggestions  los chips de «¿En qué?» de «Nuevo gasto»
--   · acc_possible_duplicate   el aviso en vivo «¿no la cargaste ya?»
-- Todas INVOKER (corren bajo la RLS de quien llama; las de datos empiezan con acc_assert_reader), stable,
-- search_path vacío; EXECUTE solo authenticated. No necesita nada de la #9, la #10 ni la #11.

-- ─── 1. Etiqueta de un comprobante ──────────────────────────────────────────
-- Espejo de voucherDisplay (lib/accounting/voucher-types.ts) y de KIND_LABELS (posting/common.ts):
-- con tipo de comprobante, «<tipo> PPPP-NNNNNNNN» (PV a 4 dígitos y número a 8, sin cortar si son más
-- largos); sin tipo o «sin comprobante», el nombre del tipo de documento.
create or replace function public.acc_doc_label(p_kind text, p_voucher_type text, p_point_of_sale integer, p_number bigint)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_voucher_type is null or p_voucher_type = 'sin_comprobante' then
      case p_kind
        when 'opening' then 'Asiento de apertura'
        when 'purchase' then 'Compra'
        when 'purchase_credit_note' then 'Nota de crédito de proveedor'
        when 'purchase_debit_note' then 'Nota de débito de proveedor'
        when 'expense' then 'Gasto'
        when 'payment' then 'Pago'
        when 'sales_close' then 'Cierre del día'
        when 'sales_invoice' then 'Factura de venta'
        when 'sales_credit_note' then 'Nota de crédito de venta'
        when 'sales_debit_note' then 'Nota de débito de venta'
        when 'collection' then 'Cobro'
        when 'transfer' then 'Movimiento entre cuentas'
        when 'bank_expense' then 'Gasto bancario'
        when 'cash_movement' then 'Movimiento de caja'
        when 'treasury_adjustment' then 'Ajuste de saldo'
        when 'manual' then 'Asiento manual'
        when 'reversal' then 'Anulación'
        when 'iva_settlement' then 'Liquidación de IVA'
        when 'fy_result' then 'Refundición de resultados'
        when 'fy_closing' then 'Cierre patrimonial'
        when 'fy_opening' then 'Apertura del ejercicio'
        else coalesce(p_kind, 'Comprobante')
      end
    else
      (case p_voucher_type
        when 'factura_a' then 'Factura A'
        when 'nota_debito_a' then 'Nota de débito A'
        when 'nota_credito_a' then 'Nota de crédito A'
        when 'recibo_a' then 'Recibo A'
        when 'factura_b' then 'Factura B'
        when 'nota_debito_b' then 'Nota de débito B'
        when 'nota_credito_b' then 'Nota de crédito B'
        when 'recibo_b' then 'Recibo B'
        when 'factura_c' then 'Factura C'
        when 'nota_debito_c' then 'Nota de débito C'
        when 'nota_credito_c' then 'Nota de crédito C'
        when 'recibo_c' then 'Recibo C'
        when 'factura_m' then 'Factura M'
        when 'nota_debito_m' then 'Nota de débito M'
        when 'nota_credito_m' then 'Nota de crédito M'
        when 'tique_factura_a' then 'Tique factura A'
        when 'tique_factura_b' then 'Tique factura B'
        when 'tique_factura_c' then 'Tique factura C'
        when 'tique' then 'Tique'
        when 'liquidacion' then 'Liquidación de tarjeta o plataforma'
        when 'resumen_bancario' then 'Resumen bancario'
        when 'otro_comprobante' then 'Otro comprobante'
        when 'ddjj_impuesto' then 'DDJJ o boleta de impuesto'
        else p_voucher_type
      end)
      || case when p_point_of_sale is not null and p_number is not null then
           ' ' || lpad(p_point_of_sale::text, greatest(4, length(p_point_of_sale::text)), '0')
           || '-' || lpad(p_number::text, greatest(8, length(p_number::text)), '0')
         else '' end
  end
$$;

-- ─── 2. Lo que el sistema recuerda de un proveedor (§H.5, tabla «Lo que el sistema recuerda») ───
-- {account_id, voucher_type, vat_rate_bp, point_of_sale, last_number, treasury_account_id,
--  payment_term_days, suggested_term_days, median_total_cents, last_total_cents, cuit_missing}.
-- Cuentan las compras, ND y gastos vigentes del proveedor (sin NC ni facturas de comisiones). Lo que no se
-- sabe va en null y decide lib/accounting/defaults.ts (pickVoucherType por condición, pickVatRate → 21 %,
-- pickTreasury → Caja). p_party_id null → todo null y cuit_missing false.
create or replace function public.acc_form_defaults(p_tenant_id uuid, p_party_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_party public.acc_parties;
  v_last public.acc_documents;
  v_voucher text;
  v_pos integer;
  v_last_number bigint;
  v_rate integer;
  v_account uuid;
  v_treasury uuid;
  v_terms integer[];
  v_suggested integer;
  v_median bigint;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_party_id is null then
    return jsonb_build_object(
      'account_id', null, 'voucher_type', null, 'vat_rate_bp', null, 'point_of_sale', null, 'last_number', null,
      'treasury_account_id', null, 'payment_term_days', null, 'suggested_term_days', null,
      'median_total_cents', null, 'last_total_cents', null, 'cuit_missing', false);
  end if;
  select p.* into v_party from public.acc_parties p where p.id = p_party_id and p.tenant_id = p_tenant_id;
  if not found then
    raise exception 'party_not_found' using errcode = 'P0001';
  end if;

  -- El último comprobante de compra o gasto del proveedor.
  select d.* into v_last
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
     and d.kind in ('purchase', 'purchase_debit_note', 'expense') and not d.settles_commissions
   order by d.accounting_date desc, d.seq desc
   limit 1;

  -- Tipo: el del último; si no hay ninguno, el habitual cargado en el proveedor.
  v_voucher := coalesce(v_last.voucher_type, v_party.default_voucher_type);

  -- Punto de venta del último comprobante de ese tipo y el número más alto de ese punto de venta.
  if v_voucher is not null then
    select d.point_of_sale into v_pos
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
       and d.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense')
       and d.voucher_type = v_voucher and d.point_of_sale is not null
     order by d.accounting_date desc, d.seq desc
     limit 1;
    if v_pos is not null then
      select max(d.number) into v_last_number
        from public.acc_documents d
       where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
         and d.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense')
         and d.voucher_type = v_voucher and d.point_of_sale = v_pos;
    end if;
  end if;

  if v_last.id is not null then
    -- Alícuota: la de mayor neto del último comprobante (empate: la más alta), como pickVatRate.
    select dl.vat_rate_bp into v_rate
      from public.acc_document_lines dl
     where dl.document_id = v_last.id and dl.tenant_id = p_tenant_id and dl.role = 'net' and dl.vat_rate_bp is not null
     group by dl.vat_rate_bp
     order by sum(dl.amount_cents) desc, dl.vat_rate_bp desc
     limit 1;
    -- Imputación usada: la de mayor importe entre los renglones de imputación del último comprobante.
    select dl.account_id into v_account
      from public.acc_document_lines dl
      join public.acc_accounts a on a.id = dl.account_id and a.tenant_id = dl.tenant_id and a.active and a.postable
     where dl.document_id = v_last.id and dl.tenant_id = p_tenant_id
       and dl.role in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax')
     order by dl.amount_cents desc, dl.line_no
     limit 1;
  end if;
  -- La cuenta habitual del proveedor gana (si sigue activa); si no, la última usada.
  v_account := coalesce(
    (select a.id from public.acc_accounts a
      where a.id = v_party.default_account_id and a.tenant_id = p_tenant_id and a.active and a.postable),
    v_account);

  -- Medio: la caja del último pago (o gasto de contado) a ese proveedor.
  select dl.treasury_account_id into v_treasury
    from public.acc_documents d
    join public.acc_document_lines dl on dl.document_id = d.id and dl.tenant_id = d.tenant_id
   where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
     and d.kind in ('payment', 'expense') and dl.role = 'treasury'
   order by d.accounting_date desc, d.seq desc, dl.amount_cents desc, dl.line_no
   limit 1;

  -- Plazo (suggestPaymentTerm): las últimas 3 facturas a crédito vencen con el mismo plazo, distinto del
  -- cargado. No cuentan las de contado de «Nuevo gasto» (vencen el día de emisión y se pagan en el mismo
  -- envío), las DDJJ ni las facturas de comisiones. Un vencimiento vacío corta la racha (= all da null).
  select array_agg(t.term) into v_terms
    from (select d.due_date - d.issue_date as term
            from public.acc_documents d
           where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
             and d.kind = 'purchase' and not d.settles_commissions
             and coalesce(d.voucher_type, '') <> 'ddjj_impuesto'
             and not (d.due_date is not null and d.due_date = d.issue_date
                      and exists (select 1 from public.acc_documents x
                                   where x.tenant_id = d.tenant_id and x.bundle_id = d.bundle_id and x.kind = 'payment'))
           order by d.accounting_date desc, d.seq desc
           limit 3) t;
  if coalesce(cardinality(v_terms), 0) = 3 and v_terms[1] between 0 and 365
     and v_terms[1] = all (v_terms) and v_terms[1] <> v_party.payment_term_days then
    v_suggested := v_terms[1];
  end if;

  -- Monto habitual (medianCents): mediana de los últimos 10 comprobantes con total > 0; con una cantidad
  -- par, el promedio de los dos del medio redondeado hacia arriba (entero).
  with s as (
    select d.total_cents
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
       and d.kind in ('purchase', 'purchase_debit_note', 'expense') and not d.settles_commissions
     order by d.accounting_date desc, d.seq desc
     limit 10),
  o as (
    select s.total_cents, row_number() over (order by s.total_cents) as rn, count(*) over () as n
      from s
     where s.total_cents > 0)
  select case when max(o.n) % 2 = 1 then max(o.total_cents) filter (where o.rn = (o.n + 1) / 2)
              else (max(o.total_cents) filter (where o.rn = o.n / 2)
                    + max(o.total_cents) filter (where o.rn = o.n / 2 + 1) + 1) / 2 end
    into v_median
    from o;

  return jsonb_build_object(
    'account_id', v_account,
    'voucher_type', v_voucher,
    'vat_rate_bp', v_rate,
    'point_of_sale', v_pos,
    'last_number', v_last_number,
    'treasury_account_id', v_treasury,
    'payment_term_days', v_party.payment_term_days,
    'suggested_term_days', v_suggested,
    'median_total_cents', v_median,
    'last_total_cents', v_last.total_cents,
    'cuit_missing', not (v_party.tax_id_type = 'cuit' and v_party.tax_id is not null));
end;
$$;

-- ─── 3. Chips de «¿En qué?» (§H.5) ───────────────────────────────────────────
-- Hasta 6, por frecuencia en compras, ND y gastos vigentes de los últimos 60 días (hoy de Córdoba incluido;
-- desempate: el más reciente). Un comprobante con proveedor suma al chip del proveedor; uno sin proveedor,
-- al de su cuenta de imputación principal (la de mayor importe). Solo partícipes y cuentas activos.
-- [{type: 'party'|'account', party_id, account_id, label, account_name, treasury_account_id, voucher_type,
--   uses, last_date}]: account_id = la habitual del proveedor (si está activa) o la última usada;
-- treasury_account_id = la caja del último gasto de contado o del pago del mismo envío; voucher_type = el del
-- último. Sin datos → [].
create or replace function public.acc_quick_expense_suggestions(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date;
begin
  perform public.acc_assert_reader(p_tenant_id);
  v_today := public.acc_today(p_tenant_id);
  return coalesce((
    with docs as (
      select d.id, d.party_id, d.voucher_type, d.accounting_date, d.seq, d.bundle_id
        from public.acc_documents d
       where d.tenant_id = p_tenant_id and d.status = 'posted'
         and d.kind in ('purchase', 'purchase_debit_note', 'expense') and not d.settles_commissions
         and d.accounting_date between v_today - 60 and v_today),
    imput as (
      select distinct on (dl.document_id) dl.document_id, dl.account_id
        from public.acc_document_lines dl
        join docs on docs.id = dl.document_id
       where dl.tenant_id = p_tenant_id and dl.role in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax')
       order by dl.document_id, dl.amount_cents desc, dl.line_no),
    paid as (
      select distinct on (docs.id) docs.id as document_id, dl.treasury_account_id
        from docs
        join public.acc_documents pd on pd.tenant_id = p_tenant_id and pd.bundle_id = docs.bundle_id
                                    and pd.status = 'posted' and pd.kind in ('expense', 'payment')
        join public.acc_document_lines dl on dl.document_id = pd.id and dl.tenant_id = p_tenant_id and dl.role = 'treasury'
       order by docs.id, dl.amount_cents desc, dl.line_no),
    base as (
      select docs.party_id, i.account_id, pd.treasury_account_id, docs.voucher_type, docs.accounting_date, docs.seq
        from docs
        left join imput i on i.document_id = docs.id
        left join paid pd on pd.document_id = docs.id),
    grouped as (
      select case when b.party_id is not null then 'party' else 'account' end as kind,
             coalesce(b.party_id, b.account_id) as target_id,
             count(*)::integer as uses,
             max(b.accounting_date) as last_date,
             (array_agg(b.account_id order by b.accounting_date desc, b.seq desc)
                filter (where b.account_id is not null))[1] as account_id,
             (array_agg(b.treasury_account_id order by b.accounting_date desc, b.seq desc)
                filter (where b.treasury_account_id is not null))[1] as treasury_account_id,
             (array_agg(b.voucher_type order by b.accounting_date desc, b.seq desc))[1] as voucher_type
        from base b
       where coalesce(b.party_id, b.account_id) is not null
       group by 1, 2),
    chips as (
      select g.kind, g.target_id, g.uses, g.last_date, g.treasury_account_id, g.voucher_type,
             case when g.kind = 'party' then coalesce(da.id, ua.id) else g.target_id end as account_id,
             case when g.kind = 'party' then coalesce(da.name, ua.name) else ga.name end as account_name,
             case when g.kind = 'party' then coalesce(nullif(btrim(p.trade_name), ''), p.name) else ga.name end as label
        from grouped g
        left join public.acc_parties p on g.kind = 'party' and p.id = g.target_id and p.tenant_id = p_tenant_id
        left join public.acc_accounts da on g.kind = 'party' and da.id = p.default_account_id
                                        and da.tenant_id = p_tenant_id and da.active and da.postable
        left join public.acc_accounts ua on g.kind = 'party' and ua.id = g.account_id
                                        and ua.tenant_id = p_tenant_id and ua.active and ua.postable
        left join public.acc_accounts ga on g.kind = 'account' and ga.id = g.target_id
                                        and ga.tenant_id = p_tenant_id and ga.active and ga.postable
       where (g.kind = 'party' and p.active) or (g.kind = 'account' and ga.id is not null)
       order by g.uses desc, g.last_date desc, 9
       limit 6)
    select jsonb_agg(jsonb_build_object(
             'type', c.kind,
             'party_id', case when c.kind = 'party' then c.target_id end,
             'account_id', c.account_id,
             'label', c.label,
             'account_name', c.account_name,
             'treasury_account_id', c.treasury_account_id,
             'voucher_type', c.voucher_type,
             'uses', c.uses,
             'last_date', c.last_date)
           order by c.uses desc, c.last_date desc, c.label)
      from chips c), '[]'::jsonb);
end;
$$;

-- ─── 4. «¿No la cargaste ya?» (§C.6, §H.5, §H.6) ─────────────────────────────
-- 1) mismo proveedor, tipo, PV y número entre compras, NC y ND vigentes (lo que adoc_purchase_dup_uq
--    rechazaría al guardar) → match 'number';
-- 2) si no, mismo proveedor y total con emisión a ±3 días (una NC solo contra NC; el resto contra compras,
--    ND y gastos; sin facturas de comisiones), la de fecha más cercana → match 'amount'.
-- → {document_id, label, accounting_date, issue_date, total_cents, party_name, match} o null. Sin
-- proveedor → null (el aviso de la RPC por partícipe o cuenta lo da acc_post_bundle al guardar).
create or replace function public.acc_possible_duplicate(
  p_tenant_id uuid,
  p_party_id uuid,
  p_total_cents bigint,
  p_issue_date date,
  p_voucher_type text,
  p_point_of_sale integer,
  p_number bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_doc public.acc_documents;
  v_match text;
  v_credit boolean := coalesce(p_voucher_type like 'nota\_credito%', false);
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_party_id is null then
    return null;
  end if;

  if p_voucher_type is not null and p_point_of_sale is not null and p_number is not null then
    select d.* into v_doc
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
       and d.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note')
       and d.voucher_type = p_voucher_type and d.point_of_sale = p_point_of_sale and d.number = p_number
     order by d.accounting_date desc, d.seq desc
     limit 1;
    if found then
      v_match := 'number';
    end if;
  end if;

  if v_match is null and p_total_cents is not null and p_issue_date is not null then
    select d.* into v_doc
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.party_id = p_party_id and d.status = 'posted'
       and d.total_cents = p_total_cents and not d.settles_commissions
       and d.issue_date between p_issue_date - 3 and p_issue_date + 3
       and (case when v_credit then d.kind = 'purchase_credit_note'
                 else d.kind in ('purchase', 'purchase_debit_note', 'expense') end)
     order by abs(d.issue_date - p_issue_date), d.accounting_date desc, d.seq desc
     limit 1;
    if found then
      v_match := 'amount';
    end if;
  end if;

  if v_match is null then
    return null;
  end if;
  return jsonb_build_object(
    'document_id', v_doc.id,
    'label', public.acc_doc_label(v_doc.kind, v_doc.voucher_type, v_doc.point_of_sale, v_doc.number),
    'accounting_date', v_doc.accounting_date,
    'issue_date', v_doc.issue_date,
    'total_cents', v_doc.total_cents,
    'party_name', (select coalesce(nullif(btrim(p.trade_name), ''), p.name)
                     from public.acc_parties p where p.id = p_party_id and p.tenant_id = p_tenant_id),
    'match', v_match);
end;
$$;

comment on function public.acc_doc_label(text, text, integer, bigint) is
  'Etiqueta de un comprobante: «Factura A 0003-00001290», o el nombre del tipo de documento («Pago»).';
comment on function public.acc_form_defaults(uuid, uuid) is
  'Lo que el sistema recuerda de un proveedor para «Nuevo gasto» y la factura de compra (H.5). INVOKER.';
comment on function public.acc_quick_expense_suggestions(uuid) is
  'Hasta 6 chips de «¿En qué?» (proveedores y cuentas más usados en 60 días). INVOKER.';
comment on function public.acc_possible_duplicate(uuid, uuid, bigint, date, text, integer, bigint) is
  'Aviso en vivo de comprobante repetido (mismo PV-número, o mismo proveedor y total a ±3 días). INVOKER.';

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.acc_doc_label(text, text, integer, bigint) from public, anon;
grant execute on function public.acc_doc_label(text, text, integer, bigint) to authenticated;
revoke all on function public.acc_form_defaults(uuid, uuid) from public, anon;
grant execute on function public.acc_form_defaults(uuid, uuid) to authenticated;
revoke all on function public.acc_quick_expense_suggestions(uuid) from public, anon;
grant execute on function public.acc_quick_expense_suggestions(uuid) to authenticated;
revoke all on function public.acc_possible_duplicate(uuid, uuid, bigint, date, text, integer, bigint) from public, anon;
grant execute on function public.acc_possible_duplicate(uuid, uuid, bigint, date, text, integer, bigint) to authenticated;
