-- Parte 1 de 3 de la migración #11 (acc_reports_core), partida en tres para que cada apply_migration por MCP
-- sea chica (≤ ~40 KB). Mismas sentencias y orden que el diseño de la #11; los revoke/grant de cada función
-- viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #11 (acc_reports_core)
-- Libros: diario, mayor y sumas y saldos (spec §F.0, §F.1, §F.2, §F.3)
-- ============================================================
-- Convenciones §F.0: plpgsql stable SECURITY INVOKER (corren bajo la RLS de quien llama: dueño con acceso o
-- contadora), acc_assert_reader primero, todo agregado en SQL, filtro explícito por p_tenant_id, solo
-- asientos 'posted'; los saldos excluyen espejos (el diario los muestra). Keyset: p_after = el `cursor` de la
-- última fila ({d, k, s} en el diario; {d, k, s, n} en el mayor), p_limit con tope (200 asientos / 500 líneas).
-- Errores: invalid_report_param ({param}), range_invalid (desde > hasta), range_crosses_fiscal_year (diario y
-- mayor), account_not_found, party_not_found. Plata en centavos; saldos con signo = Debe − Haber.
-- Numeración: la congelada, o la provisoria = acc_entry_number_base(ejercicio) + row_number() sobre TODOS los
-- asientos vigentes sin número del ejercicio en orden (entry_date, order_key, posting_seq) (C.5.3).
-- ============================================================

-- ─── 1. Etiqueta de un comprobante ──────────────────────────────────────────
-- La misma de la #12 (create or replace con cuerpo idéntico: la #12 la vuelve a declarar sin cambios).
-- Espejo de voucherDisplay y de KIND_LABELS: con tipo de comprobante «<tipo> PPPP-NNNNNNNN»; sin tipo o
-- «sin comprobante», el nombre del tipo de documento.
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

-- ─── 2. Libro diario (F.1) ───────────────────────────────────────────────────
-- Asientos vigentes del rango (incluye los espejos), en orden (entry_date, order_key, posting_seq); lines =
-- [{line_no, account_id, account_code, account_name, party_id, party_name, party_tax_id, memo, due_date,
-- debit_cents, credit_cents}], primero el Debe. total_entries = asientos del rango (todas las páginas).
create function public.acc_report_journal(p_tenant_id uuid, p_from date, p_to date, p_after jsonb default null,
                                          p_limit integer default 100)
returns table (entry_id uuid, number integer, number_is_provisional boolean, entry_date date, kind text,
               description text, document_id uuid, document_seq bigint, document_kind text, document_label text,
               created_by_name text, total_cents bigint, lines jsonb, cursor jsonb, total_entries integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_d date;
  v_k smallint;
  v_s bigint;
  v_fy uuid;
  v_base integer := 0;
  v_total integer;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from public.acc_fiscal_years f
       where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from) > 1 then
    raise exception 'range_crosses_fiscal_year' using errcode = 'P0001';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_k := (p_after ->> 'k')::smallint;
      v_s := (p_after ->> 's')::bigint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_k is null or v_s is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;
  select f.id into v_fy from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from;
  if v_fy is not null then
    v_base := public.acc_entry_number_base(v_fy);
  end if;
  select count(*)::int into v_total
    from public.acc_journal_entries e
   where e.tenant_id = p_tenant_id and e.status = 'posted' and e.entry_date between p_from and p_to;

  return query
  with prov as (
    select e.id, (v_base + row_number() over (order by e.entry_date, e.order_key, e.posting_seq))::int as n
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.fiscal_year_id = v_fy and e.status = 'posted' and e.number is null
  ), pg as (
    select e.id, e.number, e.entry_date, e.kind, e.description, e.document_id, e.created_by_name, e.total_cents,
           e.order_key, e.posting_seq
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.status = 'posted' and e.entry_date between p_from and p_to
       and (v_d is null or (e.entry_date, e.order_key, e.posting_seq) > (v_d, v_k, v_s))
     order by e.entry_date, e.order_key, e.posting_seq
     limit v_limit
  )
  select pg.id, coalesce(pg.number, prov.n), pg.number is null, pg.entry_date, pg.kind, pg.description,
         pg.document_id, d.seq, d.kind, public.acc_doc_label(d.kind, d.voucher_type, d.point_of_sale, d.number),
         pg.created_by_name, pg.total_cents,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'line_no', l.line_no, 'account_id', l.account_id, 'account_code', a.code, 'account_name', a.name,
                    'party_id', l.party_id, 'party_name', pt.name, 'party_tax_id', pt.tax_id, 'memo', l.memo,
                    'due_date', l.due_date,
                    'debit_cents', case when l.side = 'debit' then l.amount_cents else 0 end,
                    'credit_cents', case when l.side = 'credit' then l.amount_cents else 0 end)
                  order by (l.side = 'credit'), l.line_no), '[]'::jsonb)
            from public.acc_journal_lines l
            join public.acc_accounts a on a.id = l.account_id
            left join public.acc_parties pt on pt.id = l.party_id
           where l.entry_id = pg.id and l.tenant_id = p_tenant_id),
         jsonb_build_object('d', pg.entry_date, 'k', pg.order_key, 's', pg.posting_seq),
         v_total
    from pg
    join public.acc_documents d on d.id = pg.document_id and d.tenant_id = p_tenant_id
    left join prov on prov.id = pg.id
   order by pg.entry_date, pg.order_key, pg.posting_seq;
end;
$$;

-- ─── 3. Mayor (F.2) ──────────────────────────────────────────────────────────
-- Una cuenta hoja o un grupo (suma sus hojas: «Mayor de Caja y bancos»); p_party_id filtra las partidas de un
-- partícipe. Primera página: fila 'opening' con el saldo anterior (patrimoniales: toda la historia;
-- resultados: desde el inicio del ejercicio de p_from), decidido por el tipo de CADA hoja, nunca por el del
-- grupo (un grupo puede juntar hojas de ingreso y de egreso). Sin espejos. Saldo acumulado con signo (Debe − Haber);
-- la UI pone «A» en las de saldo acreedor. total_rows = líneas del rango. p_from y p_to llevan default null
-- solo porque Postgres no deja un parámetro sin default detrás de p_party_id: son obligatorios.
create function public.acc_report_ledger(p_tenant_id uuid, p_account_id uuid, p_party_id uuid default null,
                                         p_from date default null, p_to date default null,
                                         p_after jsonb default null, p_limit integer default 500)
returns table (row_kind text, entry_id uuid, entry_number integer, number_is_provisional boolean, entry_date date,
               document_id uuid, document_seq bigint, document_label text, description text, party_id uuid,
               party_name text, due_date date, memo text, debit_cents bigint, credit_cents bigint,
               running_balance_cents bigint, cursor jsonb, total_rows integer,
               account_id uuid, account_code text, account_name text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_type public.acc_account_type;
  v_accounts uuid[];
  v_fy uuid;
  v_fy_start date;
  v_base integer := 0;
  v_opening bigint;
  v_before bigint;
  v_total integer;
  v_d date;
  v_k smallint;
  v_s bigint;
  v_n smallint;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if (select count(*) from public.acc_fiscal_years f
       where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from) > 1 then
    raise exception 'range_crosses_fiscal_year' using errcode = 'P0001';
  end if;
  select a.type into v_type from public.acc_accounts a where a.id = p_account_id and a.tenant_id = p_tenant_id;
  if v_type is null then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  if p_party_id is not null
     and not exists (select 1 from public.acc_parties pt where pt.id = p_party_id and pt.tenant_id = p_tenant_id) then
    raise exception 'party_not_found' using errcode = 'P0001';
  end if;
  if p_after is not null then
    begin
      v_d := (p_after ->> 'd')::date;
      v_k := (p_after ->> 'k')::smallint;
      v_s := (p_after ->> 's')::bigint;
      v_n := (p_after ->> 'n')::smallint;
    exception when others then
      v_d := null;
    end;
    if v_d is null or v_k is null or v_s is null or v_n is null then
      raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_after"}';
    end if;
  end if;
  select coalesce(array_agg(a.id), '{}') into v_accounts
    from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.postable and (a.id = p_account_id or p_account_id = any (a.path));
  select f.id, f.start_date into v_fy, v_fy_start from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.start_date <= p_to and f.end_date >= p_from;
  if v_fy is not null then
    v_base := public.acc_entry_number_base(v_fy);
  end if;

  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date < p_from
                              and (la.type in ('asset', 'liability', 'equity')
                                   or l.entry_date >= coalesce(v_fy_start, p_from))), 0)::bigint,
         coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date >= p_from and v_d is not null
                              and (l.entry_date, e.order_key, e.posting_seq, l.line_no) <= (v_d, v_k, v_s, v_n)), 0)::bigint,
         (count(*) filter (where l.entry_date >= p_from))::int
    into v_opening, v_before, v_total
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id
    join public.acc_accounts la on la.id = l.account_id
   where l.tenant_id = p_tenant_id and l.account_id = any (v_accounts) and l.entry_date <= p_to
     and e.status = 'posted' and not e.is_mirror
     and (p_party_id is null or l.party_id = p_party_id);

  if p_after is null then
    return query
    select 'opening'::text, null::uuid, null::integer, null::boolean, p_from, null::uuid, null::bigint,
           'Saldo anterior'::text, 'Saldo anterior'::text, null::uuid, null::text, null::date, null::text,
           null::bigint, null::bigint, v_opening, null::jsonb, v_total, null::uuid, null::text, null::text;
  end if;

  return query
  with prov as (
    select e.id, (v_base + row_number() over (order by e.entry_date, e.order_key, e.posting_seq))::int as n
      from public.acc_journal_entries e
     where e.tenant_id = p_tenant_id and e.fiscal_year_id = v_fy and e.status = 'posted' and e.number is null
  ), pg as (
    select l.id, l.entry_id, l.document_id, l.account_id, l.line_no, l.side, l.amount_cents, l.party_id, l.due_date,
           l.memo, l.entry_date, e.order_key, e.posting_seq, e.number, e.description
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
     where l.tenant_id = p_tenant_id and l.account_id = any (v_accounts) and l.entry_date between p_from and p_to
       and e.status = 'posted' and not e.is_mirror
       and (p_party_id is null or l.party_id = p_party_id)
       and (v_d is null or (l.entry_date, e.order_key, e.posting_seq, l.line_no) > (v_d, v_k, v_s, v_n))
     order by l.entry_date, e.order_key, e.posting_seq, l.line_no
     limit v_limit
  )
  select 'line'::text, pg.entry_id, coalesce(pg.number, prov.n), pg.number is null, pg.entry_date, pg.document_id,
         d.seq, public.acc_doc_label(d.kind, d.voucher_type, d.point_of_sale, d.number), pg.description,
         pg.party_id, pt.name, pg.due_date, pg.memo,
         case when pg.side = 'debit' then pg.amount_cents else 0 end,
         case when pg.side = 'credit' then pg.amount_cents else 0 end,
         (v_opening + v_before
            + sum(case when pg.side = 'debit' then pg.amount_cents else -pg.amount_cents end)
                over (order by pg.entry_date, pg.order_key, pg.posting_seq, pg.line_no
                      rows between unbounded preceding and current row))::bigint,
         jsonb_build_object('d', pg.entry_date, 'k', pg.order_key, 's', pg.posting_seq, 'n', pg.line_no),
         v_total, pg.account_id, a.code, a.name
    from pg
    join public.acc_documents d on d.id = pg.document_id and d.tenant_id = p_tenant_id
    join public.acc_accounts a on a.id = pg.account_id
    left join public.acc_parties pt on pt.id = pg.party_id
    left join prov on prov.id = pg.entry_id
   order by pg.entry_date, pg.order_key, pg.posting_seq, pg.line_no;
end;
$$;

-- ─── 4. Sumas y saldos (F.3) ─────────────────────────────────────────────────
-- Una fila por cuenta (hojas y grupos, con subtotales por `path`); las inactivas solo si tienen importes.
-- Subtotal de un grupo = Σ Debe − Σ Haber de sus hojas, en la columna D o A según el signo: nunca sale del
-- tipo ni del saldo normal del grupo (un grupo puede juntar hojas de ingreso y de egreso).
-- Saldo inicial: patrimoniales, toda la historia anterior a p_from; resultados, desde el inicio del
-- ejercicio de p_to (arrancan en cero cada ejercicio, haya o no refundición), según el tipo de cada hoja.
-- Línea virtual «Resultados de ejercicios anteriores sin refundir» (is_virtual, account_id null, código
-- <grupo de current_year_result>.00, sumada a sus grupos): Σ de resultados anteriores a ese inicio; sale
-- siempre que no sea cero (si current_year_result no tiene madre, como fila de nivel 1). Así Σ D = Σ A en las
-- tres columnas siempre. p_exclude_fy_result = «antes de la refundición» del ejercicio de p_to (desvío: la
-- spec excluía todas las refundiciones; las de ejercicios anteriores siguen contando).
create function public.acc_report_trial_balance(p_tenant_id uuid, p_from date, p_to date,
                                                p_exclude_fy_result boolean default false)
returns table (account_id uuid, code text, name text, level smallint, account_type public.acc_account_type,
               normal_side public.acc_side, postable boolean, active boolean, is_virtual boolean,
               opening_debit_cents bigint, opening_credit_cents bigint,
               period_debit_cents bigint, period_credit_cents bigint,
               closing_debit_cents bigint, closing_credit_cents bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_fy uuid;
  v_fy_start date;
  v_res_start date;
  v_virtual bigint;
  v_cyr public.acc_accounts;
  v_parent public.acc_accounts;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001',
      detail = jsonb_build_object('param', case when p_from is null then 'p_from' else 'p_to' end)::text;
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  select f.id, f.start_date into v_fy, v_fy_start from public.acc_fiscal_years f
   where f.tenant_id = p_tenant_id and f.start_date <= p_to
   order by f.start_date desc
   limit 1;
  -- Si el rango empieza antes del ejercicio de p_to, los resultados del rango van en el período y la línea
  -- virtual toma solo lo anterior a p_from (nunca se cuenta dos veces).
  v_res_start := least(p_from, coalesce(v_fy_start, p_from));
  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end), 0)::bigint
    into v_virtual
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id
    join public.acc_accounts a on a.id = l.account_id
   where l.tenant_id = p_tenant_id and l.entry_date < v_res_start and a.type in ('income', 'expense')
     and e.status = 'posted' and not e.is_mirror;
  select c.* into v_cyr
    from public.acc_accounts c
   where c.tenant_id = p_tenant_id and c.system_key = 'current_year_result';
  if v_cyr.parent_id is not null then
    select p.* into v_parent from public.acc_accounts p where p.id = v_cyr.parent_id and p.tenant_id = p_tenant_id;
  end if;

  return query
  with leaf as (
    select l.account_id,
           coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end)
                      filter (where l.entry_date < p_from
                                and (a.type in ('asset', 'liability', 'equity') or l.entry_date >= v_res_start)), 0)::bigint
             as opening_net,
           coalesce(sum(l.amount_cents) filter (where l.side = 'debit' and l.entry_date >= p_from), 0)::bigint as p_debit,
           coalesce(sum(l.amount_cents) filter (where l.side = 'credit' and l.entry_date >= p_from), 0)::bigint as p_credit
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id
      join public.acc_accounts a on a.id = l.account_id
     where l.tenant_id = p_tenant_id and l.entry_date <= p_to
       and e.status = 'posted' and not e.is_mirror
       and not (coalesce(p_exclude_fy_result, false) and e.kind = 'fy_result' and e.fiscal_year_id = v_fy)
     group by l.account_id
  ), contrib as (
    select x.anc, leaf.opening_net, leaf.p_debit, leaf.p_credit
      from leaf
      join public.acc_accounts a on a.id = leaf.account_id
     cross join lateral unnest(a.path || a.id) as x(anc)
    union all
    select x.anc, v_virtual, 0::bigint, 0::bigint
      from unnest(case when v_virtual <> 0 and v_parent.id is not null
                       then v_parent.path || v_parent.id else '{}'::uuid[] end) as x(anc)
  ), rolled as (
    select c.anc, sum(c.opening_net)::bigint as opening_net, sum(c.p_debit)::bigint as p_debit,
           sum(c.p_credit)::bigint as p_credit
      from contrib c
     group by c.anc
  ), rows_out as (
    select a.id, a.code, a.name, a.level, a.type, a.normal_side, a.postable, a.active, false as is_virtual,
           coalesce(r.opening_net, 0) as o, coalesce(r.p_debit, 0) as pd, coalesce(r.p_credit, 0) as pc
      from public.acc_accounts a
      left join rolled r on r.anc = a.id
     where a.tenant_id = p_tenant_id and (a.active or r.anc is not null)
    union all
    select null::uuid, coalesce(v_parent.code, v_cyr.code, '3') || '.00',
           'Resultados de ejercicios anteriores sin refundir'::text,
           coalesce(v_parent.level + 1, 1)::smallint, 'equity'::public.acc_account_type, 'credit'::public.acc_side,
           false, true, true, v_virtual, 0::bigint, 0::bigint
     where v_virtual <> 0
  )
  select ro.id, ro.code, ro.name, ro.level, ro.type, ro.normal_side, ro.postable, ro.active, ro.is_virtual,
         greatest(ro.o, 0), greatest(-ro.o, 0), ro.pd, ro.pc,
         greatest(ro.o + ro.pd - ro.pc, 0), greatest(-(ro.o + ro.pd - ro.pc), 0)
    from rows_out ro
   order by ro.code collate "C";
end;
$$;

comment on function public.acc_doc_label(text, text, integer, bigint) is
  'Etiqueta de un comprobante: «Factura A 0003-00001290», o el nombre del tipo de documento («Pago»).';
comment on function public.acc_report_journal(uuid, date, date, jsonb, integer) is
  'Libro diario (F.1): asientos vigentes con su número (congelado o provisorio) y sus líneas, keyset. INVOKER.';
comment on function public.acc_report_ledger(uuid, uuid, uuid, date, date, jsonb, integer) is
  'Mayor de una cuenta o grupo (F.2), con saldo anterior y saldo acumulado, keyset. INVOKER.';
comment on function public.acc_report_trial_balance(uuid, date, date, boolean) is
  'Sumas y saldos (F.3) con subtotales por grupo y la línea virtual de resultados sin refundir. INVOKER.';

revoke all on function public.acc_doc_label(text, text, integer, bigint) from public, anon;
grant execute on function public.acc_doc_label(text, text, integer, bigint) to authenticated;
revoke all on function public.acc_report_journal(uuid, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_journal(uuid, date, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_ledger(uuid, uuid, uuid, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_ledger(uuid, uuid, uuid, date, date, jsonb, integer) to authenticated;
revoke all on function public.acc_report_trial_balance(uuid, date, date, boolean) from public, anon;
grant execute on function public.acc_report_trial_balance(uuid, date, date, boolean) to authenticated;
