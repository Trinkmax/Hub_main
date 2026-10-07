-- Parte 4 (grupo 12b, statements) de la migración #12 (acc_purchases_payments). Partida en varias solo
-- para que cada apply_migration por MCP quede por debajo de ~40 KB; cada parte trae sus propios revoke/grant.
-- Estado de cuenta de un partícipe (§F.7), con las mismas reglas que la parte 3 (grupo pagables/cobrables,
-- lado deuda, cuentas de control sin vat_credit_pending salvo que se pida, abierto «al día X» con las dos
-- partidas de asientos vigentes). plpgsql stable SECURITY INVOKER, acc_assert_reader primero (§F.0).
-- Usa acc_doc_label (parte 2). No necesita nada de la #10 ni de la #11.

-- ─── Estado de cuenta de un partícipe (keyset) ────────────────────────────
-- p_account_id null = todas sus cuentas de control salvo vat_credit_pending. Primera página (p_after null):
-- una fila 'opening' («Saldo anterior», toda la historia antes de p_from) y después las 'line' del rango en
-- orden (fecha, order_key, posting_seq, line_no), hasta p_limit (tope 500). increase/decrease según el
-- grupo (pagables: Haber aumenta; cobrables: Debe aumenta; el otro va en null). running_balance = saldo
-- anterior + Σ (aumenta − disminuye) de lo anterior al cursor + ventana de la página. open_cents = abierto
-- de la partida al p_to (nunca negativo). cursor {d, k, s, n}; total_rows = líneas del rango.
-- Invariante: el saldo de la última fila = el saldo del partícipe en esas cuentas al p_to.
create or replace function public.acc_report_party_statement(
  p_tenant_id uuid,
  p_party_id uuid,
  p_account_id uuid,
  p_from date,
  p_to date,
  p_after jsonb default null,
  p_limit integer default 500)
returns table (
  row_kind text, entry_id uuid, document_id uuid, document_seq bigint, entry_date date, document_label text,
  due_date date, increase_cents bigint, decrease_cents bigint, running_balance_cents bigint, line_id uuid,
  open_cents bigint, cursor jsonb, total_rows integer, document_kind text, account_id uuid, memo text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_kind text;
  v_debt public.acc_side;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_d date;
  v_k smallint;
  v_s bigint;
  v_n smallint;
  v_opening bigint;
  v_before bigint;
  v_total integer;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_from is null or p_to is null then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_from"}';
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  select pt.kind into v_kind from public.acc_parties pt where pt.id = p_party_id and pt.tenant_id = p_tenant_id;
  if v_kind is null then
    raise exception 'party_not_found' using errcode = 'P0001';
  end if;
  if p_account_id is not null
     and not exists (select 1 from public.acc_accounts a where a.id = p_account_id and a.tenant_id = p_tenant_id) then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  v_debt := case when v_kind in ('customer', 'card_processor', 'payment_wallet', 'delivery_platform')
                 then 'debit' else 'credit' end::public.acc_side;
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

  select coalesce(sum(case when l.side = v_debt then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date < p_from), 0)::bigint,
         coalesce(sum(case when l.side = v_debt then l.amount_cents else -l.amount_cents end)
                    filter (where l.entry_date >= p_from and v_d is not null
                              and (l.entry_date, e.order_key, e.posting_seq, l.line_no) <= (v_d, v_k, v_s, v_n)), 0)::bigint,
         (count(*) filter (where l.entry_date >= p_from))::integer
    into v_opening, v_before, v_total
    from public.acc_journal_lines l
    join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
    join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id and l.party_id = p_party_id and l.entry_date <= p_to
     and e.status = 'posted' and not e.is_mirror
     and (case when p_account_id is null then a.system_key is distinct from 'vat_credit_pending'
               else l.account_id = p_account_id end);

  if p_after is null then
    return query
    select 'opening'::text, null::uuid, null::uuid, null::bigint, p_from, 'Saldo anterior'::text, null::date,
           null::bigint, null::bigint, v_opening, null::uuid, null::bigint, null::jsonb, v_total,
           null::text, null::uuid, null::text;
  end if;

  return query
  with pg as (
    select l.id, l.entry_id, l.document_id, l.document_line_id, l.account_id, l.side, l.amount_cents,
           l.due_date, l.entry_date, l.line_no, l.memo, e.order_key, e.posting_seq
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
      join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id and l.party_id = p_party_id
       and l.entry_date >= p_from and l.entry_date <= p_to
       and e.status = 'posted' and not e.is_mirror
       and (case when p_account_id is null then a.system_key is distinct from 'vat_credit_pending'
                 else l.account_id = p_account_id end)
       and (v_d is null or (l.entry_date, e.order_key, e.posting_seq, l.line_no) > (v_d, v_k, v_s, v_n))
     order by l.entry_date, e.order_key, e.posting_seq, l.line_no
     limit v_limit),
  ar as (
    select a.debit_line_id, a.credit_line_id, a.amount_cents
      from public.acc_allocations a
      join public.acc_journal_lines dl on dl.id = a.debit_line_id
      join public.acc_journal_entries de on de.id = dl.entry_id and de.status = 'posted'
      join public.acc_journal_lines cl on cl.id = a.credit_line_id
      join public.acc_journal_entries ce on ce.id = cl.entry_id and ce.status = 'posted'
     where a.tenant_id = p_tenant_id and a.party_id = p_party_id
       and a.applied_on <= p_to and (a.voided_on is null or a.voided_on > p_to)),
  al as (
    select x.line_id, sum(x.amount_cents)::bigint as applied
      from (select ar.debit_line_id as line_id, ar.amount_cents from ar
            union all
            select ar.credit_line_id, ar.amount_cents from ar) x
     group by x.line_id),
  rw as (
    select pg.id, pg.entry_id, pg.document_id, pg.account_id, pg.side, pg.amount_cents, pg.due_date,
           pg.entry_date, pg.line_no, pg.memo, pg.order_key, pg.posting_seq,
           d.seq, d.kind, d.voucher_type, d.point_of_sale, d.number, dl.reference,
           case when pg.side = v_debt then pg.amount_cents else -pg.amount_cents end as delta,
           pg.amount_cents - coalesce(al.applied, 0) as open_now
      from pg
      join public.acc_documents d on d.id = pg.document_id and d.tenant_id = p_tenant_id
      join public.acc_document_lines dl on dl.id = pg.document_line_id and dl.tenant_id = p_tenant_id
      left join al on al.line_id = pg.id)
  select 'line'::text,
         rw.entry_id,
         rw.document_id,
         rw.seq,
         rw.entry_date,
         case when rw.kind = 'opening' then 'Saldo inicial' || coalesce(' · ' || nullif(btrim(rw.reference), ''), '')
              else public.acc_doc_label(rw.kind, rw.voucher_type, rw.point_of_sale, rw.number) end,
         rw.due_date,
         case when rw.side = v_debt then rw.amount_cents end,
         case when rw.side <> v_debt then rw.amount_cents end,
         (v_opening + v_before + sum(rw.delta) over (order by rw.entry_date, rw.order_key, rw.posting_seq, rw.line_no
                                                      rows between unbounded preceding and current row))::bigint,
         rw.id,
         greatest(rw.open_now, 0)::bigint,
         jsonb_build_object('d', rw.entry_date, 'k', rw.order_key, 's', rw.posting_seq, 'n', rw.line_no),
         v_total,
         rw.kind,
         rw.account_id,
         rw.memo
    from rw
   order by rw.entry_date, rw.order_key, rw.posting_seq, rw.line_no;
end;
$$;

comment on function public.acc_report_party_statement(uuid, uuid, uuid, date, date, jsonb, integer) is
  'Estado de cuenta de un partícipe con saldo acumulado, paginado por keyset (F.7). INVOKER.';

-- ─── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.acc_report_party_statement(uuid, uuid, uuid, date, date, jsonb, integer) from public, anon;
grant execute on function public.acc_report_party_statement(uuid, uuid, uuid, date, date, jsonb, integer) to authenticated;
