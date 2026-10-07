-- Parte 5 de 5 de la migración #9 (acc_rpc_posting_core): correcciones (C.4), imputar/desimputar y el chequeo
-- de saldo de una caja (versión fase 1). Mismas sentencias y orden que el diseño de la #9; los revoke/grant de
-- cada función viajan con ella.
--   · acc_void_document(p_tenant_id, p_document_id, p_reason, p_options) → jsonb (C.4.1)
--   · acc_reverse_document(p_tenant_id, p_client_ref, p_document_id, p_reason, p_reversal_date, p_options) → jsonb (C.4.3)
--   · acc_allocate(p_tenant_id, p_pairs, p_date) → jsonb · acc_unallocate(p_tenant_id, p_allocation_id, p_reason) (C.4.4)
--   · acc_treasury_check(p_tenant_id, p_treasury_id, p_as_of) → jsonb (C.6; INVOKER, bajo la RLS de quien llama)

-- ─── 1. Anular en un mes abierto (C.4.1). Anular no borra nada. ─────────────────
-- p_options = {"with_bundle": bool, "unallocate": bool, "undo": bool}.
create function public.acc_void_document(p_tenant_id uuid, p_document_id uuid, p_reason text, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_opt jsonb := coalesce(p_options, '{}'::jsonb);
  v_with_bundle boolean;
  v_unallocate boolean;
  v_undo boolean;
  d public.acc_documents;
  r record;
  v_reason text;
  v_name text;
  v_today date;
  v_ids uuid[];
  v_third uuid[];
  v_n integer;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(v_opt) <> 'object' then
    perform private.acc_raise('invalid_payload', '{"field":"options"}');
  end if;
  v_with_bundle := coalesce(private.acc_to_bool(v_opt -> 'with_bundle'), false);
  v_unallocate := coalesce(private.acc_to_bool(v_opt -> 'unallocate'), false);
  v_undo := coalesce(private.acc_to_bool(v_opt -> 'undo'), false);
  select * into d from public.acc_documents x where x.id = p_document_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform private.acc_raise('document_not_found', null);
  end if;
  if d.status <> 'posted' then
    perform private.acc_raise('document_voided', null);
  end if;
  -- «Deshacer» del toast: mismo autor y menos de 10 minutos; si no, motivo de 5 a 300 caracteres.
  if v_undo then
    if d.created_by is distinct from v_uid or d.created_at < now() - interval '10 minutes' then
      perform private.acc_raise('undo_expired', null);
    end if;
    v_reason := 'Deshacer';
  else
    v_reason := btrim(coalesce(p_reason, ''));
    if char_length(v_reason) not between 5 and 300 then
      perform private.acc_raise('reason_required', null);
    end if;
  end if;
  -- Todo el bundle (la compra y el pago de «Nuevo gasto»; el cierre y sus acreditaciones) o solo este.
  v_ids := case when v_with_bundle
                then array(select x.id from public.acc_documents x
                            where x.tenant_id = p_tenant_id and x.bundle_id = d.bundle_id and x.status = 'posted'
                            order by x.seq)
                else array[d.id] end;
  perform 1 from public.acc_documents x where x.id = any (v_ids) order by x.id for update;
  for r in select x.kind, x.seq, p.status, p.month
             from public.acc_documents x join public.acc_periods p on p.id = x.period_id
            where x.id = any (v_ids) order by x.seq loop
    if r.kind in ('iva_settlement', 'fy_result', 'fy_closing', 'fy_opening') then
      perform private.acc_raise('kind_not_voidable', jsonb_build_object('seq', r.seq));
    end if;
    if r.status <> 'open' then
      perform private.acc_raise('cannot_void_closed_period', jsonb_build_object('month', to_char(r.month, 'YYYY-MM')));
    end if;
  end loop;
  -- Uno que ya tiene su anulación vigente (mes reabierto) no se anula otra vez: quedaría anulado dos veces.
  if exists (select 1 from public.acc_documents x
              where x.tenant_id = p_tenant_id and x.status = 'posted' and x.reverses_document_id = any (v_ids)) then
    perform private.acc_raise('already_reversed', null);
  end if;
  -- Imputaciones de OTROS comprobantes sobre sus partidas (una factura ya pagada): solo con unallocate.
  v_third := array(select a.id from public.acc_allocations a
                    where a.tenant_id = p_tenant_id and a.voided_on is null
                      and (a.document_id is null or not (a.document_id = any (v_ids)))
                      and exists (select 1 from public.acc_journal_lines l
                                   where l.document_id = any (v_ids) and l.id in (a.debit_line_id, a.credit_line_id)));
  if cardinality(v_third) > 0 and not v_unallocate then
    perform private.acc_raise('document_has_allocations', jsonb_build_object('count', cardinality(v_third),
      'allocations', (select string_agg(distinct coalesce('#' || x.seq || ' ' || left(x.description, 60), 'imputación manual'), ', ')
                        from public.acc_allocations a left join public.acc_documents x on x.id = a.document_id
                       where a.id = any (v_third))));
  end if;
  v_today := public.acc_today(p_tenant_id);
  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  perform private.acc_ensure_fiscal_year(p_tenant_id, v_today);   -- el mes de hoy (voided_on) tiene que existir
  -- Las hechas POR los anulados se desaplican hoy; las de terceros, también (el pago queda a cuenta).
  perform private.acc_void_allocations(p_tenant_id,
    array(select a.id from public.acc_allocations a
           where a.tenant_id = p_tenant_id and a.voided_on is null and a.document_id = any (v_ids)),
    v_today, v_reason, d.id, v_uid);
  v_n := private.acc_void_allocations(p_tenant_id, v_third, v_today, v_reason, d.id, v_uid);
  for r in select x.id, x.kind, x.seq, x.total_cents from public.acc_documents x where x.id = any (v_ids) order by x.seq loop
    perform private.acc_void_doc(p_tenant_id, v_uid, v_name, r.id, v_reason);
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.voided', 'acc_document', r.id,
      jsonb_build_object('kind', r.kind, 'seq', r.seq, 'total_cents', r.total_cents, 'with_bundle', v_with_bundle,
                         'undo', v_undo));
  end loop;
  return jsonb_build_object('voided_document_ids', to_jsonb(v_ids), 'unallocated_count', v_n);
end;
$$;

-- ─── 2. «Anular con fecha de hoy» un comprobante de un mes cerrado (C.4.3) ─────────
-- El mes cerrado no cambia: se escribe un comprobante `reversal` (espejo exacto) en un mes abierto y cada partida
-- espejo se imputa sola contra su original (kind 'reversal', protegida).
create function public.acc_reverse_document(p_tenant_id uuid, p_client_ref uuid, p_document_id uuid, p_reason text,
                                            p_reversal_date date, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_opt jsonb := coalesce(p_options, '{}'::jsonb);
  v_unallocate boolean;
  v_hash text;
  v_prev public.acc_bundles;
  v_bundle_id uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  o public.acc_documents;
  s public.acc_settings;
  p public.acc_parties;
  v_per public.acc_periods;
  r record;
  v_reason text;
  v_name text;
  v_today date;
  v_third uuid[];
  v_n integer;
  v_own integer;
  v_seq bigint;
  v_entry uuid;
  v_desc text;
  v_open bigint;
  v_aid uuid;
  v_allocs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_client_ref is null or jsonb_typeof(v_opt) <> 'object' then
    perform private.acc_raise('invalid_payload', '{"field":"client_ref"}');
  end if;
  -- Idempotencia (operation = 'reverse').
  v_hash := encode(sha256(convert_to(jsonb_build_object('document_id', p_document_id, 'reason', p_reason,
              'reversal_date', p_reversal_date, 'options', v_opt)::text, 'UTF8')), 'hex');
  select * into v_prev from public.acc_bundles b where b.tenant_id = p_tenant_id and b.client_ref = p_client_ref;
  if found then
    if v_prev.operation = 'reverse' and v_prev.request_hash = v_hash then
      return v_prev.result || jsonb_build_object('replayed', true);
    end if;
    perform private.acc_raise('idempotency_conflict', jsonb_build_object('client_ref', p_client_ref));
  end if;
  v_unallocate := coalesce(private.acc_to_bool(v_opt -> 'unallocate'), false);

  select * into o from public.acc_documents x where x.id = p_document_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform private.acc_raise('document_not_found', null);
  end if;
  if o.status <> 'posted' then
    perform private.acc_raise('document_voided', null);
  end if;
  if o.kind not in ('purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense', 'payment', 'sales_close',
                    'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection', 'transfer', 'bank_expense',
                    'cash_movement', 'treasury_adjustment', 'manual') then
    perform private.acc_raise('kind_not_reversible', null);
  end if;
  if (select x.status from public.acc_periods x where x.id = o.period_id) = 'open' then
    perform private.acc_raise('use_void_in_open_period', null);
  end if;
  if exists (select 1 from public.acc_documents x
              where x.tenant_id = p_tenant_id and x.reverses_document_id = o.id and x.status = 'posted') then
    perform private.acc_raise('already_reversed', null);
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 5 and 300 then
    perform private.acc_raise('reason_required', null);
  end if;
  select * into s from public.acc_settings x where x.tenant_id = p_tenant_id;
  v_today := public.acc_today(p_tenant_id);
  if p_reversal_date is null or p_reversal_date < o.accounting_date or p_reversal_date > v_today
     or p_reversal_date < s.books_start_date then
    perform private.acc_raise('reversal_date_invalid', null);
  end if;
  perform private.acc_ensure_fiscal_year(p_tenant_id, p_reversal_date);
  v_per := private.acc_period_for(p_tenant_id, p_reversal_date, 'month');
  if v_per.status <> 'open' then
    perform private.acc_raise('reversal_date_invalid', jsonb_build_object('month', to_char(v_per.month, 'YYYY-MM')));
  end if;
  -- Imputaciones vigentes de terceros sobre sus partidas: solo con unallocate (se desaplican a la fecha elegida).
  v_third := array(select a.id from public.acc_allocations a
                    where a.tenant_id = p_tenant_id and a.voided_on is null and a.document_id is distinct from o.id
                      and exists (select 1 from public.acc_journal_lines l
                                   where l.document_id = o.id and l.id in (a.debit_line_id, a.credit_line_id)));
  if cardinality(v_third) > 0 and not v_unallocate then
    perform private.acc_raise('document_has_allocations', jsonb_build_object('count', cardinality(v_third),
      'allocations', (select string_agg(distinct coalesce('#' || x.seq || ' ' || left(x.description, 60), 'imputación manual'), ', ')
                        from public.acc_allocations a left join public.acc_documents x on x.id = a.document_id
                       where a.id = any (v_third))));
  end if;

  -- Comprobante espejo: mismo partícipe con foto nueva, «Anulación de …», total igual, en el mes abierto.
  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  v_seq := private.acc_next_doc_seq(p_tenant_id);
  if o.party_id is not null then
    select * into p from public.acc_parties x where x.id = o.party_id and x.tenant_id = p_tenant_id;
  end if;
  v_desc := 'Anulación de ' || o.description;
  if char_length(v_desc) > 200 then
    v_desc := left(v_desc, 199) || '…';
  end if;
  insert into public.acc_documents (id, tenant_id, bundle_id, period_id, seq, kind, party_id, party_name_snapshot,
      party_doc_type_snapshot, party_doc_number_snapshot, party_iva_condition_snapshot, issue_date, accounting_date,
      description, notes, total_cents, reverses_document_id, created_by, created_by_name)
  values (v_id, p_tenant_id, v_bundle_id, v_per.id, v_seq, 'reversal', p.id, p.name,
      case when p.id is null then null when p.tax_id_type = 'cuit' then 80 when p.tax_id_type = 'cuil' then 86
           when p.tax_id_type = 'dni' then 96 else 99 end,
      case when p.id is null then null when p.tax_id_type = 'none' then '0' else p.tax_id end,
      p.iva_condition, p_reversal_date, p_reversal_date, v_desc, v_reason, o.total_cents, o.id, v_uid, v_name);
  -- Renglones espejo: mismos line_no, cuenta, partícipe, vencimiento y metadatos; lados invertidos; caja, tipo de
  -- impuesto y canal en null (los CHECK adl_* los prohíben en el rol reversal), igual que buildReversal.
  insert into public.acc_document_lines (tenant_id, document_id, line_no, role, account_id, side, amount_cents, party_id,
      due_date, sales_method_id, vat_rate_bp, base_cents, vat_computed_cents, jurisdiction_code, certificate_number,
      reference, memo)
  select p_tenant_id, v_id, l.line_no, 'reversal', l.account_id,
         case when l.side = 'debit' then 'credit'::public.acc_side else 'debit'::public.acc_side end,
         l.amount_cents, l.party_id, case when l.party_id is null then null else coalesce(l.due_date, o.due_date) end,
         l.sales_method_id, l.vat_rate_bp, l.base_cents, l.vat_computed_cents, l.jurisdiction_code, l.certificate_number,
         l.reference, l.memo
    from public.acc_document_lines l
   where l.document_id = o.id and l.tenant_id = p_tenant_id
   order by l.line_no;
  -- Libro IVA: adjustment_only (default) → sin fila; negative_row → copia con is_reversal en el mes de la anulación.
  if s.closed_period_void_iva_mode = 'negative_row' then
    insert into public.acc_fiscal_vouchers (tenant_id, document_id, book, period_month, voucher_date, voucher_type,
        afip_voucher_code, is_credit_note, is_reversal, point_of_sale, number_from, number_to, counterparty_party_id,
        counterparty_name, counterparty_doc_type, counterparty_doc_number, counterparty_iva_condition, channel,
        net_0_cents, net_25_cents, vat_25_cents, net_5_cents, vat_5_cents, net_105_cents, vat_105_cents, net_21_cents,
        vat_21_cents, net_27_cents, vat_27_cents, non_taxed_cents, undiscriminated_cents, exempt_cents, perc_iva_cents,
        perc_iibb_cents, perc_ganancias_cents, perc_municipal_cents, internal_taxes_cents, other_taxes_cents, total_cents,
        vat_computable_cents)
    select p_tenant_id, v_id, f.book, date_trunc('month', p_reversal_date::timestamp)::date, f.voucher_date, f.voucher_type,
           f.afip_voucher_code, f.is_credit_note, true, f.point_of_sale, f.number_from, f.number_to,
           f.counterparty_party_id, f.counterparty_name, f.counterparty_doc_type, f.counterparty_doc_number,
           f.counterparty_iva_condition, f.channel, f.net_0_cents, f.net_25_cents, f.vat_25_cents, f.net_5_cents,
           f.vat_5_cents, f.net_105_cents, f.vat_105_cents, f.net_21_cents, f.vat_21_cents, f.net_27_cents,
           f.vat_27_cents, f.non_taxed_cents, f.undiscriminated_cents, f.exempt_cents, f.perc_iva_cents,
           f.perc_iibb_cents, f.perc_ganancias_cents, f.perc_municipal_cents, f.internal_taxes_cents,
           f.other_taxes_cents, f.total_cents, f.vat_computable_cents
      from public.acc_fiscal_vouchers f
     where f.document_id = o.id and f.tenant_id = p_tenant_id and not f.voided;
  end if;
  v_entry := private.acc_project_entry(p_tenant_id, v_id, 'reversal', v_uid);
  -- Las hechas POR el original (un pago aplicado a facturas, una NC a su factura) se desaplican a la fecha de la
  -- anulación, como al anular (C.4.1): lo que cancelaba vuelve a quedar pendiente. Las de terceros, con unallocate.
  v_own := private.acc_void_allocations(p_tenant_id,
    array(select a.id from public.acc_allocations a
           where a.tenant_id = p_tenant_id and a.voided_on is null and a.document_id = o.id),
    p_reversal_date, v_reason, v_id, v_uid);
  v_n := private.acc_void_allocations(p_tenant_id, v_third, p_reversal_date, v_reason, v_id, v_uid);
  -- Cada partida espejo contra su original, por lo que quede abierto.
  for r in select ol.id as orig_id, ol.side as orig_side, ol.account_id, ol.party_id, ml.id as mirror_id
             from public.acc_journal_lines ol
             join public.acc_journal_lines ml on ml.entry_id = v_entry and ml.line_no = ol.line_no
            where ol.document_id = o.id and ol.tenant_id = p_tenant_id and ol.party_id is not null
            order by ol.line_no loop
    v_open := public.acc_open_amount(r.orig_id);
    if v_open > 0 then
      insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents,
                                          kind, applied_on, document_id, created_by, created_by_name)
      values (p_tenant_id, r.account_id, r.party_id,
              case when r.orig_side = 'debit' then r.orig_id else r.mirror_id end,
              case when r.orig_side = 'debit' then r.mirror_id else r.orig_id end,
              v_open, 'reversal', p_reversal_date, v_id, v_uid, v_name)
      returning id into v_aid;
      v_allocs := v_allocs || to_jsonb(v_aid);
    end if;
  end loop;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.reversed', 'acc_document', v_id,
    jsonb_build_object('original_id', o.id, 'kind', o.kind, 'seq', v_seq, 'total_cents', o.total_cents,
                       'reversal_date', p_reversal_date, 'unallocated_count', v_n, 'own_unallocated_count', v_own,
                       'iva_mode', s.closed_period_void_iva_mode, 'bundle_id', v_bundle_id));
  v_result := jsonb_build_object('bundle_id', v_bundle_id, 'replayed', false, 'reversal_document_id', v_id,
    'documents', jsonb_build_array(jsonb_build_object('ref', 'd1', 'id', v_id, 'seq', v_seq, 'entry_id', v_entry,
      'provisional_number', private.acc_provisional_number(v_entry),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'journal_line_id', l.id) order by l.line_no)
                           from public.acc_journal_lines l where l.entry_id = v_entry), '[]'::jsonb))),
    'allocations', v_allocs, 'unallocated_count', v_n, 'own_unallocated_count', v_own);
  insert into public.acc_bundles (id, tenant_id, client_ref, operation, request_hash, preview_hash, result, created_by,
                                  created_by_name)
  values (v_bundle_id, p_tenant_id, p_client_ref, 'reverse', v_hash, null, v_result, v_uid, v_name);
  return v_result;
end;
$$;

-- ─── 3. Imputar y desimputar (C.4.4) ──────────────────────────────────────────
-- p_pairs = [{"debit_line_id", "credit_line_id", "amount_cents"}] (1..100). No mueve el diario. El trigger de
-- imputaciones valida partícipe, cuenta, lados, asientos vigentes, fecha (≥ las dos partidas) y lo abierto.
create function public.acc_allocate(p_tenant_id uuid, p_pairs jsonb, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_per public.acc_periods;
  r record;
  w jsonb;
  dl public.acc_journal_lines;
  cl public.acc_journal_lines;
  v_amt bigint;
  v_aid uuid;
  v_ids jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_array_length(p_pairs) not between 1 and 100 then
    perform private.acc_raise('invalid_payload', '{"field":"pairs"}');
  end if;
  if p_date is null then
    perform private.acc_raise('invalid_payload', '{"field":"date"}');
  end if;
  if p_date > public.acc_today(p_tenant_id) then
    perform private.acc_raise('date_in_future', null);
  end if;
  perform private.acc_ensure_fiscal_year(p_tenant_id, p_date);
  v_per := private.acc_period_for(p_tenant_id, p_date, 'month');
  if v_per.status <> 'open' then
    perform private.acc_raise('period_closed', jsonb_build_object('month', to_char(v_per.month, 'YYYY-MM')));
  end if;
  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  for r in select e.value as x, e.i from jsonb_array_elements(p_pairs) with ordinality e(value, i) loop
    w := jsonb_build_object('pair', r.i);
    v_amt := private.acc_to_bigint(r.x -> 'amount_cents');
    if jsonb_typeof(r.x) <> 'object' or v_amt is null or v_amt not between 1 and 1000000000000000 then
      perform private.acc_raise('invalid_payload', w || '{"field":"amount_cents"}');
    end if;
    select * into dl from public.acc_journal_lines j
     where j.id = private.acc_to_uuid(r.x ->> 'debit_line_id') and j.tenant_id = p_tenant_id;
    if not found then
      perform private.acc_raise('item_not_found', w);
    end if;
    select * into cl from public.acc_journal_lines j
     where j.id = private.acc_to_uuid(r.x ->> 'credit_line_id') and j.tenant_id = p_tenant_id;
    if not found then
      perform private.acc_raise('item_not_found', w);
    end if;
    insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents, kind,
                                        applied_on, document_id, created_by, created_by_name)
    values (p_tenant_id, dl.account_id, coalesce(dl.party_id, cl.party_id), dl.id, cl.id, v_amt,
            case when exists (select 1 from public.acc_documents x
                               where x.id in (dl.document_id, cl.document_id)
                                 and x.kind in ('purchase_credit_note', 'sales_credit_note'))
                 then 'credit_note' else 'manual' end,
            p_date, null, v_uid, v_name)
    returning id into v_aid;
    v_ids := v_ids || to_jsonb(v_aid);
    v_total := v_total + v_amt;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_allocation.created', 'acc_allocation', (v_ids ->> 0)::uuid,
    jsonb_build_object('count', jsonb_array_length(v_ids), 'total_cents', v_total, 'manual', true));
  return jsonb_build_object('allocation_ids', v_ids, 'count', jsonb_array_length(v_ids), 'total_cents', v_total);
end;
$$;

-- Desaplica hoy (mes abierto). Las de tipo reversal no se tocan.
create function public.acc_unallocate(p_tenant_id uuid, p_allocation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.acc_allocations;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into a from public.acc_allocations x where x.id = p_allocation_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform private.acc_raise('allocation_not_found', null);
  end if;
  if a.voided_on is not null then
    perform private.acc_raise('allocation_voided', null);
  end if;
  if a.kind = 'reversal' then
    perform private.acc_raise('allocation_protected', null);
  end if;
  if char_length(v_reason) not between 5 and 300 then
    perform private.acc_raise('reason_required', null);
  end if;
  perform private.acc_ensure_fiscal_year(p_tenant_id, public.acc_today(p_tenant_id));
  perform private.acc_void_allocations(p_tenant_id, array[a.id], public.acc_today(p_tenant_id), v_reason, null, v_uid);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_allocation.voided', 'acc_allocation', a.id,
    jsonb_build_object('kind', a.kind, 'amount_cents', a.amount_cents, 'applied_on', a.applied_on));
end;
$$;

-- ─── 4. «Ajustar saldo»: saldo de libro de una caja (versión fase 1) ──────────────
-- INVOKER: corre bajo la RLS de quien llama. book_cents = lado normal de la cuenta (lo que usan acc_posting_context
-- y acc_mark_treasury_checked; en la tarjeta de la empresa, la deuda); book_dc_cents = Debe − Haber (lo que lleva
-- expected_book_cents de un treasury_adjustment). Las partidas a acreditar y las estimaciones llegan en la fase 3.
create function public.acc_treasury_check(p_tenant_id uuid, p_treasury_id uuid, p_as_of date)
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
   where d.tenant_id = p_tenant_id and d.kind = 'treasury_adjustment' and d.status = 'posted'
     and exists (select 1 from public.acc_document_lines dl
                  where dl.document_id = d.id and dl.tenant_id = p_tenant_id and dl.treasury_account_id = v_tr.id);
  return jsonb_build_object(
    'treasury_id', v_tr.id, 'as_of', v_as_of,
    'book_cents', case when v_side = 'credit' then -v_dc else v_dc end,
    'book_dc_cents', v_dc,
    'last_adjustment_date', v_last, 'last_checked_on', v_tr.last_checked_on,
    'open_wallet_items', '[]'::jsonb,
    'estimates', jsonb_build_object('commission_cents', 0, 'commission_vat_cents', 0, 'sircupa_cents', 0));
end;
$$;

comment on function public.acc_void_document(uuid, uuid, text, jsonb) is
  'Anula un comprobante de un mes abierto (C.4.1): documento, asiento y filas del libro IVA pasan a voided; sus imputaciones se desaplican hoy. Opciones with_bundle, unallocate, undo.';
comment on function public.acc_reverse_document(uuid, uuid, uuid, text, date, jsonb) is
  '«Anular con fecha de hoy» un comprobante de un mes cerrado (C.4.3): comprobante reversal espejo en un mes abierto, imputado solo contra el original. Idempotente por client_ref.';
comment on function public.acc_allocate(uuid, jsonb, date) is
  'Imputa partidas abiertas del mismo partícipe y cuenta (C.4.4): NC contra factura, anticipo contra factura. No mueve el diario.';
comment on function public.acc_unallocate(uuid, uuid, text) is
  'Desaplica una imputación hoy (C.4.4). Las de tipo reversal están protegidas.';
comment on function public.acc_treasury_check(uuid, uuid, date) is
  'Saldo de libro de una caja para «Ajustar saldo» (versión fase 1): book_cents (lado normal), book_dc_cents (Debe − Haber), último ajuste y última verificación.';

revoke all on function public.acc_void_document(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.acc_void_document(uuid, uuid, text, jsonb) to authenticated;
revoke all on function public.acc_reverse_document(uuid, uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function public.acc_reverse_document(uuid, uuid, uuid, text, date, jsonb) to authenticated;
revoke all on function public.acc_allocate(uuid, jsonb, date) from public, anon;
grant execute on function public.acc_allocate(uuid, jsonb, date) to authenticated;
revoke all on function public.acc_unallocate(uuid, uuid, text) from public, anon;
grant execute on function public.acc_unallocate(uuid, uuid, text) to authenticated;
revoke all on function public.acc_treasury_check(uuid, uuid, date) from public, anon;
grant execute on function public.acc_treasury_check(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
