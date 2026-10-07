-- Parte 5 (grupo 12b, statements) de la migración #12 (acc_purchases_payments). Partida en varias solo
-- para que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke/grant.
-- Libros IVA (§F.4 compras, §F.5 ventas, §F.5b alícuotas), los dos lados (ventas queda vacío hasta la fase 3):
--   · acc_report_iva_book         filas del libro del mes, paginadas por keyset
--   · acc_report_iva_book_totals  suma firmada de cada columna del mes
--   · acc_report_iva_aliquots     una fila por comprobante × alícuota (archivo de alícuotas), paginada
-- Leen solo acc_fiscal_vouchers del mes (period_month) no anulados y de comprobantes vigentes. No necesitan
-- nada de la #9, la #10 ni la #11. plpgsql stable SECURITY INVOKER, acc_assert_reader primero (§F.0).
--
-- Signo: sign = (NC ? −1 : 1) × (is_reversal ? −1 : 1). Los importes que devuelven estas funciones YA van
-- multiplicados por sign (las NC y las anulaciones en modo negative_row salen negativas): pantalla y CSV
-- los muestran tal cual, sin volver a aplicar sign. Orden y cursor: (voucher_date, voucher_type, PV,
-- número desde, id) (+ alícuota en el archivo de alícuotas); voucher_type compara en collate "C".

-- ─── 1. Filas del libro ──────────────────────────────────────────────────────
-- p_book: 'purchases' | 'sales'; p_month: cualquier día del mes. amounts = {net_0_cents, net_25_cents,
-- vat_25_cents, net_5_cents, vat_5_cents, net_105_cents, vat_105_cents, net_21_cents, vat_21_cents,
-- net_27_cents, vat_27_cents, non_taxed_cents, undiscriminated_cents, exempt_cents, perc_iva_cents,
-- perc_iibb_cents, perc_ganancias_cents, perc_municipal_cents, internal_taxes_cents, other_taxes_cents,
-- total_cents, vat_computable_cents} (todas las claves, con signo). cursor {d, t, p, n, i}; p_limit tope 500.
create or replace function public.acc_report_iva_book(
  p_tenant_id uuid,
  p_book text,
  p_month date,
  p_after jsonb default null,
  p_limit integer default 500)
returns table (
  voucher_id uuid, document_id uuid, document_seq bigint, voucher_date date, voucher_type text,
  afip_voucher_code smallint, sign smallint, is_reversal boolean, point_of_sale integer, number_from bigint,
  number_to bigint, counterparty_name text, counterparty_doc_type smallint, counterparty_doc_number text,
  counterparty_iva_condition text, channel text, amounts jsonb, accounting_date date, cursor jsonb, total_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month date;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_total integer;
  v_d date;
  v_t text;
  v_p integer;
  v_n bigint;
  v_i uuid;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_book is null or p_book not in ('purchases', 'sales') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_book"}';
  end if;
  if p_month is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_month"}';
  end if;
  v_month := date_trunc('month', p_month)::date;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_t := p_after ->> 't';
      v_p := (p_after ->> 'p')::integer;
      v_n := (p_after ->> 'n')::bigint;
      v_i := (p_after ->> 'i')::uuid;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_t is null or v_p is null or v_n is null or v_i is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;

  select count(*)::integer into v_total
    from public.acc_fiscal_vouchers fv
    join public.acc_documents d on d.id = fv.document_id and d.tenant_id = fv.tenant_id
   where fv.tenant_id = p_tenant_id and fv.book = p_book and fv.period_month = v_month
     and not fv.voided and d.status = 'posted';

  return query
  with pg as (
    select fv.*, d.seq as doc_seq, d.accounting_date as doc_accounting_date,
           ((case when fv.is_credit_note then -1 else 1 end) * (case when fv.is_reversal then -1 else 1 end))::smallint as sg
      from public.acc_fiscal_vouchers fv
      join public.acc_documents d on d.id = fv.document_id and d.tenant_id = fv.tenant_id
     where fv.tenant_id = p_tenant_id and fv.book = p_book and fv.period_month = v_month
       and not fv.voided and d.status = 'posted'
       and (v_d is null
            or (fv.voucher_date, fv.voucher_type collate "C", fv.point_of_sale, fv.number_from, fv.id)
               > (v_d, v_t collate "C", v_p, v_n, v_i))
     order by fv.voucher_date, fv.voucher_type collate "C", fv.point_of_sale, fv.number_from, fv.id
     limit v_limit)
  select pg.id, pg.document_id, pg.doc_seq, pg.voucher_date, pg.voucher_type, pg.afip_voucher_code, pg.sg,
         pg.is_reversal, pg.point_of_sale, pg.number_from, pg.number_to, pg.counterparty_name,
         pg.counterparty_doc_type, pg.counterparty_doc_number, pg.counterparty_iva_condition, pg.channel,
         jsonb_build_object(
           'net_0_cents', pg.sg * pg.net_0_cents,
           'net_25_cents', pg.sg * pg.net_25_cents, 'vat_25_cents', pg.sg * pg.vat_25_cents,
           'net_5_cents', pg.sg * pg.net_5_cents, 'vat_5_cents', pg.sg * pg.vat_5_cents,
           'net_105_cents', pg.sg * pg.net_105_cents, 'vat_105_cents', pg.sg * pg.vat_105_cents,
           'net_21_cents', pg.sg * pg.net_21_cents, 'vat_21_cents', pg.sg * pg.vat_21_cents,
           'net_27_cents', pg.sg * pg.net_27_cents, 'vat_27_cents', pg.sg * pg.vat_27_cents,
           'non_taxed_cents', pg.sg * pg.non_taxed_cents,
           'undiscriminated_cents', pg.sg * pg.undiscriminated_cents,
           'exempt_cents', pg.sg * pg.exempt_cents,
           'perc_iva_cents', pg.sg * pg.perc_iva_cents,
           'perc_iibb_cents', pg.sg * pg.perc_iibb_cents,
           'perc_ganancias_cents', pg.sg * pg.perc_ganancias_cents,
           'perc_municipal_cents', pg.sg * pg.perc_municipal_cents,
           'internal_taxes_cents', pg.sg * pg.internal_taxes_cents,
           'other_taxes_cents', pg.sg * pg.other_taxes_cents,
           'total_cents', pg.sg * pg.total_cents,
           'vat_computable_cents', pg.sg * pg.vat_computable_cents),
         pg.doc_accounting_date,
         jsonb_build_object('d', pg.voucher_date, 't', pg.voucher_type, 'p', pg.point_of_sale,
                            'n', pg.number_from, 'i', pg.id),
         v_total
    from pg
   order by pg.voucher_date, pg.voucher_type collate "C", pg.point_of_sale, pg.number_from, pg.id;
end;
$$;

-- ─── 2. Totales del libro (suma firmada de cada columna) ─────────────────────
-- → {"book", "month", "rows", <las 22 claves de amounts con su suma firmada>}.
create or replace function public.acc_report_iva_book_totals(p_tenant_id uuid, p_book text, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_month date;
  v_out jsonb;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_book is null or p_book not in ('purchases', 'sales') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_book"}';
  end if;
  if p_month is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_month"}';
  end if;
  v_month := date_trunc('month', p_month)::date;

  with s as (
    select ((case when fv.is_credit_note then -1 else 1 end) * (case when fv.is_reversal then -1 else 1 end))::bigint as sg,
           fv.*
      from public.acc_fiscal_vouchers fv
      join public.acc_documents d on d.id = fv.document_id and d.tenant_id = fv.tenant_id
     where fv.tenant_id = p_tenant_id and fv.book = p_book and fv.period_month = v_month
       and not fv.voided and d.status = 'posted')
  select jsonb_build_object(
           'book', p_book,
           'month', v_month,
           'rows', count(*),
           'net_0_cents', coalesce(sum(s.sg * s.net_0_cents), 0)::bigint,
           'net_25_cents', coalesce(sum(s.sg * s.net_25_cents), 0)::bigint,
           'vat_25_cents', coalesce(sum(s.sg * s.vat_25_cents), 0)::bigint,
           'net_5_cents', coalesce(sum(s.sg * s.net_5_cents), 0)::bigint,
           'vat_5_cents', coalesce(sum(s.sg * s.vat_5_cents), 0)::bigint,
           'net_105_cents', coalesce(sum(s.sg * s.net_105_cents), 0)::bigint,
           'vat_105_cents', coalesce(sum(s.sg * s.vat_105_cents), 0)::bigint,
           'net_21_cents', coalesce(sum(s.sg * s.net_21_cents), 0)::bigint,
           'vat_21_cents', coalesce(sum(s.sg * s.vat_21_cents), 0)::bigint,
           'net_27_cents', coalesce(sum(s.sg * s.net_27_cents), 0)::bigint,
           'vat_27_cents', coalesce(sum(s.sg * s.vat_27_cents), 0)::bigint,
           'non_taxed_cents', coalesce(sum(s.sg * s.non_taxed_cents), 0)::bigint,
           'undiscriminated_cents', coalesce(sum(s.sg * s.undiscriminated_cents), 0)::bigint,
           'exempt_cents', coalesce(sum(s.sg * s.exempt_cents), 0)::bigint,
           'perc_iva_cents', coalesce(sum(s.sg * s.perc_iva_cents), 0)::bigint,
           'perc_iibb_cents', coalesce(sum(s.sg * s.perc_iibb_cents), 0)::bigint,
           'perc_ganancias_cents', coalesce(sum(s.sg * s.perc_ganancias_cents), 0)::bigint,
           'perc_municipal_cents', coalesce(sum(s.sg * s.perc_municipal_cents), 0)::bigint,
           'internal_taxes_cents', coalesce(sum(s.sg * s.internal_taxes_cents), 0)::bigint,
           'other_taxes_cents', coalesce(sum(s.sg * s.other_taxes_cents), 0)::bigint,
           'total_cents', coalesce(sum(s.sg * s.total_cents), 0)::bigint,
           'vat_computable_cents', coalesce(sum(s.sg * s.vat_computable_cents), 0)::bigint)
    into v_out
    from s;
  return v_out;
end;
$$;

-- ─── 3. Archivo de alícuotas (una fila por comprobante × alícuota) ───────────
-- Solo las alícuotas con neto o IVA distinto de cero (B, C y tiques de compras, con todo en «no
-- discriminado», no dan filas). Código de alícuota AFIP: 0 % → 3, 2,5 % → 9, 5 % → 8, 10,5 % → 4,
-- 21 % → 5, 27 % → 6. net_cents y vat_cents con signo. cursor {d, t, p, n, i, r}; p_limit tope 500.
create or replace function public.acc_report_iva_aliquots(
  p_tenant_id uuid,
  p_book text,
  p_month date,
  p_after jsonb default null,
  p_limit integer default 500)
returns table (
  voucher_id uuid, document_id uuid, document_seq bigint, voucher_date date, voucher_type text,
  afip_voucher_code smallint, sign smallint, point_of_sale integer, number_from bigint, number_to bigint,
  counterparty_doc_type smallint, counterparty_doc_number text, counterparty_name text,
  vat_rate_bp integer, afip_aliquot_code smallint, net_cents bigint, vat_cents bigint, cursor jsonb, total_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_month date;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_total integer;
  v_d date;
  v_t text;
  v_p integer;
  v_n bigint;
  v_i uuid;
  v_r integer;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_book is null or p_book not in ('purchases', 'sales') then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_book"}';
  end if;
  if p_month is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_month"}';
  end if;
  v_month := date_trunc('month', p_month)::date;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_t := p_after ->> 't';
      v_p := (p_after ->> 'p')::integer;
      v_n := (p_after ->> 'n')::bigint;
      v_i := (p_after ->> 'i')::uuid;
      v_r := (p_after ->> 'r')::integer;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_t is null or v_p is null or v_n is null or v_i is null or v_r is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;

  return query
  with al as (
    select fv.id, fv.document_id, d.seq, fv.voucher_date, fv.voucher_type, fv.afip_voucher_code,
           ((case when fv.is_credit_note then -1 else 1 end) * (case when fv.is_reversal then -1 else 1 end))::smallint as sg,
           fv.point_of_sale, fv.number_from, fv.number_to, fv.counterparty_doc_type, fv.counterparty_doc_number,
           fv.counterparty_name, r.rate, r.code, r.net, r.vat
      from public.acc_fiscal_vouchers fv
      join public.acc_documents d on d.id = fv.document_id and d.tenant_id = fv.tenant_id
      cross join lateral (values
        (0, 3::smallint, fv.net_0_cents, 0::bigint),
        (250, 9::smallint, fv.net_25_cents, fv.vat_25_cents),
        (500, 8::smallint, fv.net_5_cents, fv.vat_5_cents),
        (1050, 4::smallint, fv.net_105_cents, fv.vat_105_cents),
        (2100, 5::smallint, fv.net_21_cents, fv.vat_21_cents),
        (2700, 6::smallint, fv.net_27_cents, fv.vat_27_cents)) as r(rate, code, net, vat)
     where fv.tenant_id = p_tenant_id and fv.book = p_book and fv.period_month = v_month
       and not fv.voided and d.status = 'posted'
       and (r.net <> 0 or r.vat <> 0)),
  cnt as (
    select count(*)::integer as n from al),
  pg as (
    select al.*
      from al
     where v_d is null
        or (al.voucher_date, al.voucher_type collate "C", al.point_of_sale, al.number_from, al.id, al.rate)
           > (v_d, v_t collate "C", v_p, v_n, v_i, v_r)
     order by al.voucher_date, al.voucher_type collate "C", al.point_of_sale, al.number_from, al.id, al.rate
     limit v_limit)
  select pg.id, pg.document_id, pg.seq, pg.voucher_date, pg.voucher_type, pg.afip_voucher_code, pg.sg,
         pg.point_of_sale, pg.number_from, pg.number_to, pg.counterparty_doc_type, pg.counterparty_doc_number,
         pg.counterparty_name, pg.rate, pg.code, (pg.sg * pg.net)::bigint, (pg.sg * pg.vat)::bigint,
         jsonb_build_object('d', pg.voucher_date, 't', pg.voucher_type, 'p', pg.point_of_sale,
                            'n', pg.number_from, 'i', pg.id, 'r', pg.rate),
         (select cnt.n from cnt)
    from pg
   order by pg.voucher_date, pg.voucher_type collate "C", pg.point_of_sale, pg.number_from, pg.id, pg.rate;
end;
$$;

comment on function public.acc_report_iva_book(uuid, text, date, jsonb, integer) is
  'Libro IVA compras o ventas del mes (F.4/F.5), importes con signo, paginado por keyset. INVOKER.';
comment on function public.acc_report_iva_book_totals(uuid, text, date) is
  'Totales firmados de cada columna del libro IVA del mes (F.4/F.5). INVOKER.';
comment on function public.acc_report_iva_aliquots(uuid, text, date, jsonb, integer) is
  'Archivo de alícuotas del libro IVA del mes (F.5b): una fila por comprobante × alícuota, con signo. INVOKER.';

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.acc_report_iva_book(uuid, text, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_iva_book(uuid, text, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_iva_book_totals(uuid, text, date) from public, anon;
grant execute on function public.acc_report_iva_book_totals(uuid, text, date) to authenticated;
revoke all on function public.acc_report_iva_aliquots(uuid, text, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_iva_aliquots(uuid, text, date, jsonb, integer) to authenticated;
