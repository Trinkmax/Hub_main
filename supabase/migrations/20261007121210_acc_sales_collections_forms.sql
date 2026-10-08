-- Parte 2 de 5 de la migración #13 (acc_sales_collections): lecturas de los formularios de ventas (§C.6).
-- Cada función trae sus propios revoke/grant. plpgsql stable SECURITY INVOKER (bajo la RLS de quien llama),
-- acc_assert_reader primero, filtro explícito por p_tenant_id.
--   · acc_sales_range_defaults  nueva: el último «hasta» de cada tipo y punto de venta del libro de ventas
--   · acc_treasury_check        create or replace de la versión fase 1 (#9, misma firma y retorno): suma, en
--                               billeteras, las partidas a acreditar y las estimaciones por tasa

-- ─── 1. Rangos del cierre del día: «Desde» = último «hasta» + 1 (H.9) ─────────
-- [{voucher_type, point_of_sale, channel, last_number_to, last_date, sales_point_label}]: una entrada por tipo y
-- punto de venta con historia en el libro de ventas (cierres y ventas sueltas vigentes; sin las filas de una
-- anulación), con el número más alto cargado y el canal de esa fila. Sin historia → [] (la UI arranca vacía).
-- Orden: punto de venta, tipo.
create or replace function public.acc_sales_range_defaults(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.acc_assert_reader(p_tenant_id);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'voucher_type', x.voucher_type, 'point_of_sale', x.point_of_sale, 'channel', x.channel,
             'last_number_to', x.last_number_to, 'last_date', x.voucher_date, 'sales_point_label', sp.label)
             order by x.point_of_sale, x.voucher_type collate "C"), '[]'::jsonb)
      from (select distinct on (fv.voucher_type, fv.point_of_sale)
                   fv.voucher_type, fv.point_of_sale, fv.channel,
                   coalesce(fv.number_to, fv.number_from) as last_number_to, fv.voucher_date
              from public.acc_fiscal_vouchers fv
              join public.acc_documents d on d.id = fv.document_id and d.tenant_id = fv.tenant_id
             where fv.tenant_id = p_tenant_id and fv.book = 'sales' and not fv.voided and not fv.is_reversal
               and d.status = 'posted'
             order by fv.voucher_type, fv.point_of_sale, coalesce(fv.number_to, fv.number_from) desc,
                      fv.voucher_date desc, fv.created_at desc) x
      left join public.acc_sales_points sp on sp.tenant_id = p_tenant_id and sp.number = x.point_of_sale);
end;
$$;

-- ─── 2. «Ajustar saldo»: saldo de libro de una caja (versión fase 3) ──────────
-- Igual que la fase 1 (book_cents = lado normal; book_dc_cents = Debe − Haber; último ajuste; última
-- verificación) y además, en una billetera con partícipe (Mercado Pago):
--   · open_wallet_items [{line_id, document_id, document_seq, method, sales_method_id, accounting_date,
--     due_date, amount_cents, open_cents}]: partidas Debe del partícipe en «Mercado Pago a acreditar»
--     (receivable_wallets) con fecha ≤ p_as_of y abierto > 0 HOY (imputaciones no desaplicadas de asientos
--     vigentes: lo mismo que lee la acción con acc_report_open_items), por fecha y carga. method = el medio
--     del cierre («QR Mercado Pago», «Transferencia»).
--   · pending_wallet_cents = Σ open_cents.
--   · estimates {commission_cents, commission_vat_cents, sircupa_cents} con las tasas del partícipe, redondeo
--     a la mitad hacia arriba (percentOf): comisión = commission_bp sobre lo abierto que no vino de
--     transferencias (medio con system_key 'transfer'); IVA = 21 % de la comisión; SIRCUPA = sircupa_bp
--     sobre todo lo abierto. E17: QR 22.000.000 + transferencias 18.000.000 → 330.000 / 69.300 / 1.400.000.
-- last_adjustment_date cuenta también las acreditaciones por arqueo (cobro con counted_cents a esa billetera o
-- de su partícipe). Para las demás cajas, open_wallet_items [] y estimaciones en 0 (como la fase 1).
create or replace function public.acc_treasury_check(p_tenant_id uuid, p_treasury_id uuid, p_as_of date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tr public.acc_treasury_accounts;
  v_side public.acc_side;
  v_as_of date;
  v_dc bigint;
  v_last date;
  v_party public.acc_parties;
  v_items jsonb := '[]'::jsonb;
  v_open bigint := 0;
  v_open_fee bigint := 0;
  v_comm bigint := 0;
begin
  perform public.acc_assert_reader(p_tenant_id);
  select * into v_tr from public.acc_treasury_accounts t where t.id = p_treasury_id and t.tenant_id = p_tenant_id;
  if not found then
    raise exception 'treasury_not_found' using errcode = 'P0001';
  end if;
  select a.normal_side into v_side from public.acc_accounts a where a.id = v_tr.account_id and a.tenant_id = p_tenant_id;
  v_as_of := coalesce(p_as_of, public.acc_today(p_tenant_id));
  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end), 0)::bigint into v_dc
    from public.acc_journal_lines l join public.acc_journal_entries e on e.id = l.entry_id
   where l.tenant_id = p_tenant_id and l.account_id = v_tr.account_id and e.status = 'posted' and not e.is_mirror
     and l.entry_date <= v_as_of;
  select max(d.accounting_date) into v_last
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.status = 'posted'
     and (d.kind = 'treasury_adjustment' or (d.kind = 'collection' and d.counted_cents is not null))
     and (exists (select 1 from public.acc_document_lines dl
                   where dl.document_id = d.id and dl.tenant_id = p_tenant_id and dl.treasury_account_id = v_tr.id)
          or (d.kind = 'collection' and v_tr.bank_party_id is not null and d.party_id = v_tr.bank_party_id));

  if v_tr.kind = 'wallet' and v_tr.bank_party_id is not null then
    select * into v_party from public.acc_parties p where p.id = v_tr.bank_party_id and p.tenant_id = p_tenant_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', i.id, 'document_id', i.document_id, 'document_seq', i.seq,
             'method', coalesce(i.method_name, i.memo, 'Venta'), 'sales_method_id', i.sales_method_id,
             'accounting_date', i.entry_date, 'due_date', i.due_date, 'amount_cents', i.amount_cents,
             'open_cents', i.open_cents) order by i.entry_date, i.posting_seq, i.line_no), '[]'::jsonb),
           coalesce(sum(i.open_cents), 0)::bigint,
           coalesce(sum(i.open_cents) filter (where i.method_key is distinct from 'transfer'), 0)::bigint
      into v_items, v_open, v_open_fee
      from (select l.id, l.document_id, l.entry_date, l.due_date, l.amount_cents, l.line_no, l.memo, e.posting_seq,
                   d.seq, dl.sales_method_id, m.name as method_name, m.system_key as method_key,
                   l.amount_cents - coalesce((select sum(a.amount_cents)
                                                from public.acc_allocations a
                                                join public.acc_journal_lines cl on cl.id = a.credit_line_id
                                                join public.acc_journal_entries ce on ce.id = cl.entry_id
                                               where a.debit_line_id = l.id and a.tenant_id = p_tenant_id
                                                 and a.voided_on is null and ce.status = 'posted'), 0) as open_cents
              from public.acc_journal_lines l
              join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
              join public.acc_accounts ra on ra.id = l.account_id and ra.tenant_id = l.tenant_id
              join public.acc_documents d on d.id = l.document_id and d.tenant_id = l.tenant_id
              join public.acc_document_lines dl on dl.id = l.document_line_id and dl.tenant_id = l.tenant_id
              left join public.acc_sales_methods m on m.id = dl.sales_method_id and m.tenant_id = dl.tenant_id
             where l.tenant_id = p_tenant_id and l.party_id = v_tr.bank_party_id and l.side = 'debit'
               and ra.system_key = 'receivable_wallets' and l.entry_date <= v_as_of
               and e.status = 'posted' and not e.is_mirror) i
     where i.open_cents > 0;
    v_comm := (v_open_fee * greatest(coalesce(v_party.commission_bp, 0), 0) + 5000) / 10000;
  end if;

  return jsonb_build_object(
    'treasury_id', v_tr.id, 'as_of', v_as_of,
    'book_cents', case when v_side = 'credit' then -v_dc else v_dc end,
    'book_dc_cents', v_dc,
    'last_adjustment_date', v_last, 'last_checked_on', v_tr.last_checked_on,
    'open_wallet_items', v_items,
    'pending_wallet_cents', v_open,
    'estimates', jsonb_build_object(
      'commission_cents', v_comm,
      'commission_vat_cents', (v_comm * 2100 + 5000) / 10000,
      'sircupa_cents', (v_open * greatest(coalesce(v_party.sircupa_bp, 0), 0) + 5000) / 10000));
end;
$$;

comment on function public.acc_sales_range_defaults(uuid) is
  'Cierre del día (H.9): el último «hasta» de cada tipo y punto de venta del libro de ventas, para proponer el «desde». INVOKER.';
comment on function public.acc_treasury_check(uuid, uuid, date) is
  'Saldo de libro de una caja para «Ajustar saldo» (versión fase 3): book_cents (lado normal), book_dc_cents (Debe − Haber), último ajuste y verificación y, en billeteras, las partidas a acreditar con las estimaciones por tasa.';

revoke all on function public.acc_sales_range_defaults(uuid) from public, anon;
grant execute on function public.acc_sales_range_defaults(uuid) to authenticated;
revoke all on function public.acc_treasury_check(uuid, uuid, date) from public, anon;
grant execute on function public.acc_treasury_check(uuid, uuid, date) to authenticated;
