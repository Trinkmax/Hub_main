-- Parte 4 de 5 de la migración #9 (acc_rpc_posting_core): escritura y la única puerta para guardar
-- comprobantes. Mismas sentencias y orden que el diseño de la #9; los revoke/grant de cada función viajan con ella.
--   · private.acc_project_entry: inserta el asiento y copia los renglones 1:1 (C.3.6).
--   · private.acc_void_allocations: desaplica imputaciones (voided_on = greatest(p_on, applied_on)).
--   · private.acc_void_doc: anula un comprobante con su asiento y sus filas del libro IVA (la apertura vuelve a
--     «pendiente»).
--   · private.acc_replace_line: la partida equivalente del comprobante nuevo al «Corregir» (C.4.2).
--   · private.acc_provisional_number: número provisorio de un asiento de un período abierto (C.5.3).
--   · private.acc_write_document: paso 7 de C.3.3 para un comprobante ya validado.
--   · public.acc_post_bundle(p_tenant_id, p_client_ref, p_bundle) → jsonb (C.3).

-- ─── 1. Proyección del asiento (C.3.6) ──────────────────────────────────────
create function private.acc_project_entry(p_tenant uuid, p_document_id uuid, p_entry_kind text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_documents;
  v_period public.acc_periods;
  v_entry uuid := gen_random_uuid();
begin
  select * into d from public.acc_documents x where x.id = p_document_id and x.tenant_id = p_tenant;
  if not found then
    perform private.acc_raise('document_not_found', jsonb_build_object('document_id', p_document_id));
  end if;
  select * into v_period from public.acc_periods x where x.id = d.period_id and x.tenant_id = p_tenant;
  insert into public.acc_journal_entries (id, tenant_id, fiscal_year_id, period_id, document_id, entry_date, kind,
                                          description, total_cents, created_by, created_by_name)
  values (v_entry, p_tenant, v_period.fiscal_year_id, v_period.id, d.id, d.accounting_date, p_entry_kind, d.description,
          (select coalesce(sum(dl.amount_cents), 0) from public.acc_document_lines dl
            where dl.document_id = d.id and dl.side = 'debit'),
          p_actor, private.acc_actor_name(p_tenant, p_actor));
  -- document_id y entry_date de las líneas los copia el trigger desde la cabecera.
  insert into public.acc_journal_lines (tenant_id, entry_id, document_line_id, line_no, account_id, side, amount_cents,
                                        party_id, due_date, memo)
  select dl.tenant_id, v_entry, dl.id, dl.line_no, dl.account_id, dl.side, dl.amount_cents, dl.party_id,
         case when dl.party_id is null then null else coalesce(dl.due_date, d.due_date) end, dl.memo
    from public.acc_document_lines dl
   where dl.document_id = d.id and dl.tenant_id = p_tenant
   order by dl.line_no;
  return v_entry;
end;
$$;

-- ─── 2. Desaplicar imputaciones ──────────────────────────────────────────────
-- Una imputación vale en [applied_on, voided_on): nunca se desaplica antes de aplicarse (aal_void_coherent).
create function private.acc_void_allocations(p_tenant uuid, p_allocation_ids uuid[], p_on date, p_reason text,
                                             p_void_document uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.acc_allocations a
     set voided_on = greatest(p_on, a.applied_on), voided_at = now(), voided_by = p_actor,
         void_reason = left(p_reason, 300), void_document_id = p_void_document
   where a.tenant_id = p_tenant and a.id = any (coalesce(p_allocation_ids, '{}'::uuid[])) and a.voided_on is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ─── 3. Anular un comprobante (documento + asiento + filas del libro IVA) ──────
create function private.acc_void_doc(p_tenant uuid, p_actor uuid, p_actor_name text, p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  update public.acc_documents d
     set status = 'voided', voided_at = now(), voided_by = p_actor, voided_by_name = p_actor_name,
         void_reason = left(p_reason, 300)
   where d.id = p_document_id and d.tenant_id = p_tenant and d.status = 'posted'
   returning d.kind into v_kind;
  if v_kind is null then
    perform private.acc_raise('document_voided', jsonb_build_object('document_id', p_document_id));
  end if;
  update public.acc_journal_entries e
     set status = 'voided', voided_at = now(), voided_by = p_actor, voided_by_name = p_actor_name,
         void_reason = left(p_reason, 300)
   where e.document_id = p_document_id and e.tenant_id = p_tenant and e.status = 'posted';
  update public.acc_fiscal_vouchers f set voided = true
   where f.document_id = p_document_id and f.tenant_id = p_tenant and not f.voided;
  if v_kind = 'opening' then
    update public.acc_settings s set opening_status = 'pending' where s.tenant_id = p_tenant and s.opening_status = 'posted';
  end if;
end;
$$;

-- ─── 4. Partida equivalente al «Corregir» (C.4.2) ─────────────────────────────
-- Si la línea no es del comprobante viejo, queda igual. Si lo es: la del nuevo con la misma cuenta, partícipe y
-- lado (en el cierre del día, también el mismo medio); si no hay → party_change_with_allocations.
create function private.acc_replace_line(p_tenant uuid, p_line uuid, p_old_doc uuid, p_new_doc uuid, p_kind text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_new uuid;
begin
  if not exists (select 1 from public.acc_journal_lines l where l.id = p_line and l.document_id = p_old_doc) then
    return p_line;
  end if;
  select nl.id into v_new
    from public.acc_journal_lines ol
    join public.acc_document_lines odl on odl.id = ol.document_line_id
    join public.acc_journal_lines nl on nl.document_id = p_new_doc and nl.tenant_id = p_tenant
                                    and nl.account_id = ol.account_id and nl.party_id = ol.party_id and nl.side = ol.side
    join public.acc_document_lines ndl on ndl.id = nl.document_line_id
   where ol.id = p_line
     and (p_kind <> 'sales_close' or ndl.sales_method_id is not distinct from odl.sales_method_id)
   order by (public.acc_open_amount(nl.id) > 0) desc, nl.line_no
   limit 1;
  if v_new is null then
    perform private.acc_raise('party_change_with_allocations', jsonb_build_object('line_id', p_line));
  end if;
  return v_new;
end;
$$;

-- ─── 5. Número provisorio (C.5.3) ────────────────────────────────────────────
-- acc_entry_number_base + row_number() sobre todos los asientos vigentes sin número del ejercicio, en el orden
-- (entry_date, order_key, posting_seq). null si el asiento ya tiene número definitivo o está anulado.
create function private.acc_provisional_number(p_entry uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with e as (select x.fiscal_year_id from public.acc_journal_entries x where x.id = p_entry),
       b as (select public.acc_entry_number_base(e.fiscal_year_id) as base from e)
  select (b.base + n.rn)::integer
    from b,
         (select y.id, row_number() over (order by y.entry_date, y.order_key, y.posting_seq) as rn
            from public.acc_journal_entries y join e on y.fiscal_year_id = e.fiscal_year_id
           where y.status = 'posted' and y.number is null) n
   where n.id = p_entry
$$;

-- ─── 6. Escribir un comprobante validado (C.3.3 paso 7) ───────────────────────
-- p_c = salida de acc_check_document. Devuelve {ref, id, seq, entry_id, lines: [{line_no, journal_line_id}]}.
create function private.acc_write_document(p_tenant uuid, p_actor uuid, p_actor_name text, p_bundle_id uuid, p_c jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_kind text := p_c ->> 'kind';
  v_date date := (p_c ->> 'accounting_date')::date;
  v_replaces uuid := (p_c ->> 'replaces_document_id')::uuid;
  v_related uuid := (p_c ->> 'related_document_id')::uuid;
  v_seq bigint;
  v_entry uuid;
  v_reason text;
  v_old_total bigint;
  p public.acc_parties;
  r record;
  n record;
  v_deb uuid;
  v_cre uuid;
  v_left bigint;
  v_amt bigint;
begin
  v_seq := private.acc_next_doc_seq(p_tenant);
  -- «Corregir»: el viejo se anula ANTES de insertar el nuevo (lo exigen los únicos de compras, ventas, cierre del
  -- día y apertura); sus imputaciones se mueven después, cuando existen las partidas nuevas.
  if v_replaces is not null then
    select x.total_cents into v_old_total from public.acc_documents x where x.id = v_replaces and x.tenant_id = p_tenant;
    v_reason := 'Corregido por #' || v_seq;
    perform private.acc_void_doc(p_tenant, p_actor, p_actor_name, v_replaces, v_reason);
  end if;
  if p_c ->> 'party_id' is not null then
    select * into p from public.acc_parties x where x.id = (p_c ->> 'party_id')::uuid and x.tenant_id = p_tenant;
  end if;

  -- Comprobante, con la foto fiscal del partícipe (80 CUIT · 86 CUIL · 96 DNI · 99 sin identificar).
  insert into public.acc_documents (id, tenant_id, bundle_id, period_id, seq, kind, voucher_type, afip_voucher_code,
      party_id, party_name_snapshot, party_doc_type_snapshot, party_doc_number_snapshot, party_iva_condition_snapshot,
      issue_date, accounting_date, due_date, point_of_sale, number, shift, description, notes, total_cents,
      control_account_id, related_document_id, replaces_document_id, corrects_document_id, recurring_expense_id,
      settles_commissions, counted_cents, expected_book_cents, warnings_ack, override_reason, created_by, created_by_name)
  values (v_id, p_tenant, p_bundle_id, (p_c ->> 'period_id')::uuid, v_seq, v_kind, p_c ->> 'voucher_type',
      (p_c ->> 'afip_voucher_code')::smallint, p.id, p.name,
      case when p.id is null then null when p.tax_id_type = 'cuit' then 80 when p.tax_id_type = 'cuil' then 86
           when p.tax_id_type = 'dni' then 96 else 99 end,
      case when p.id is null then null when p.tax_id_type = 'none' then '0' else p.tax_id end,
      p.iva_condition,
      (p_c ->> 'issue_date')::date, v_date, (p_c ->> 'due_date')::date, (p_c ->> 'point_of_sale')::integer,
      (p_c ->> 'number')::bigint, p_c ->> 'shift', p_c ->> 'description', p_c ->> 'notes', (p_c ->> 'total_cents')::bigint,
      (p_c ->> 'control_account_id')::uuid, v_related, v_replaces, (p_c ->> 'corrects_document_id')::uuid,
      (p_c ->> 'recurring_expense_id')::uuid, coalesce((p_c ->> 'settles_commissions')::boolean, false),
      (p_c ->> 'counted_cents')::bigint, (p_c ->> 'expected_book_cents')::bigint,
      array(select jsonb_array_elements_text(coalesce(p_c -> 'warnings_ack', '[]'::jsonb))), p_c ->> 'override_reason',
      p_actor, p_actor_name);

  insert into public.acc_document_lines (tenant_id, document_id, line_no, role, account_id, side, amount_cents, party_id,
      due_date, treasury_account_id, sales_method_id, vat_rate_bp, base_cents, vat_computed_cents, tax_kind,
      jurisdiction_code, channel, certificate_number, reference, memo)
  select p_tenant, v_id, l.line_no, l.role, l.account_id, l.side, l.amount_cents, l.party_id, l.due_date,
         l.treasury_account_id, l.sales_method_id, l.vat_rate_bp, l.base_cents, l.vat_computed_cents, l.tax_kind,
         l.jurisdiction_code, l.channel, l.certificate_number, l.reference, l.memo
    from jsonb_populate_recordset(null::public.acc_document_lines, p_c -> 'lines') l
   order by l.line_no;

  insert into public.acc_fiscal_vouchers (tenant_id, document_id, book, period_month, voucher_date, voucher_type,
      afip_voucher_code, is_credit_note, point_of_sale, number_from, number_to, counterparty_party_id, counterparty_name,
      counterparty_doc_type, counterparty_doc_number, counterparty_iva_condition, channel, net_0_cents, net_25_cents,
      vat_25_cents, net_5_cents, vat_5_cents, net_105_cents, vat_105_cents, net_21_cents, vat_21_cents, net_27_cents,
      vat_27_cents, non_taxed_cents, undiscriminated_cents, exempt_cents, perc_iva_cents, perc_iibb_cents,
      perc_ganancias_cents, perc_municipal_cents, internal_taxes_cents, other_taxes_cents, total_cents, vat_computable_cents)
  select p_tenant, v_id, f.book, date_trunc('month', v_date::timestamp)::date, f.voucher_date, f.voucher_type,
         f.afip_voucher_code, f.is_credit_note, f.point_of_sale, f.number_from, f.number_to, f.counterparty_party_id,
         f.counterparty_name, f.counterparty_doc_type, f.counterparty_doc_number, f.counterparty_iva_condition, f.channel,
         f.net_0_cents, f.net_25_cents, f.vat_25_cents, f.net_5_cents, f.vat_5_cents, f.net_105_cents, f.vat_105_cents,
         f.net_21_cents, f.vat_21_cents, f.net_27_cents, f.vat_27_cents, f.non_taxed_cents, f.undiscriminated_cents,
         f.exempt_cents, f.perc_iva_cents, f.perc_iibb_cents, f.perc_ganancias_cents, f.perc_municipal_cents,
         f.internal_taxes_cents, f.other_taxes_cents, f.total_cents, f.vat_computable_cents
    from jsonb_populate_recordset(null::public.acc_fiscal_vouchers, coalesce(p_c -> 'fiscal_vouchers', '[]'::jsonb)) f;

  perform private.acc_reconcile_fiscal(p_tenant, v_id);
  v_entry := private.acc_project_entry(p_tenant, v_id, p_c ->> 'entry_kind', p_actor);

  if v_replaces is not null then
    -- Las imputaciones hechas POR el viejo se desaplican a la fecha del nuevo.
    perform private.acc_void_allocations(p_tenant,
      array(select a.id from public.acc_allocations a
             where a.tenant_id = p_tenant and a.document_id = v_replaces and a.voided_on is null),
      v_date, v_reason, v_id, p_actor);
    -- Las de terceros sobre sus partidas pasan a la partida equivalente del nuevo (kind 'replace').
    for r in select a.* from public.acc_allocations a
              where a.tenant_id = p_tenant and a.voided_on is null
                and exists (select 1 from public.acc_journal_lines l
                             where l.document_id = v_replaces and l.id in (a.debit_line_id, a.credit_line_id))
              order by a.applied_on, a.created_at, a.id loop
      v_deb := private.acc_replace_line(p_tenant, r.debit_line_id, v_replaces, v_id, v_kind);
      v_cre := private.acc_replace_line(p_tenant, r.credit_line_id, v_replaces, v_id, v_kind);
      perform private.acc_void_allocations(p_tenant, array[r.id], greatest(r.applied_on, v_date), v_reason, v_id, p_actor);
      if r.amount_cents > least(public.acc_open_amount(v_deb), public.acc_open_amount(v_cre)) then
        perform private.acc_raise('allocations_exceed_new_total',
          jsonb_build_object('document', p_c ->> 'ref', 'amount_cents', r.amount_cents));
      end if;
      insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents,
                                          kind, applied_on, document_id, created_by, created_by_name)
      values (p_tenant, r.account_id, r.party_id, v_deb, v_cre, r.amount_cents, 'replace', greatest(r.applied_on, v_date),
              r.document_id, p_actor, p_actor_name);
    end loop;
    perform private.acc_audit(p_tenant, p_actor, 'acc_document.replaced', 'acc_document', v_id,
      jsonb_build_object('old_id', v_replaces, 'new_id', v_id, 'old_total_cents', v_old_total,
                         'new_total_cents', (p_c ->> 'total_cents')::bigint));
  end if;

  -- Gasto fijo: último comprobante y próximo vencimiento (una corrección no lo vuelve a avanzar).
  if p_c ->> 'recurring_expense_id' is not null then
    update public.acc_recurring_expenses x
       set last_document_id = v_id,
           next_due_date = case when v_replaces is not null and x.last_document_id = v_replaces then x.next_due_date
                                else private.acc_next_due(x.next_due_date, x.frequency, x.due_day) end,
           updated_by = p_actor
     where x.id = (p_c ->> 'recurring_expense_id')::uuid and x.tenant_id = p_tenant;
  end if;
  if v_kind = 'opening' then
    update public.acc_settings x set opening_status = 'posted' where x.tenant_id = p_tenant;
  end if;
  -- Arqueo: la caja queda verificada a esa fecha.
  if p_c ->> 'counted_cents' is not null and p_c ->> 'treasury_id' is not null then
    update public.acc_treasury_accounts x
       set last_checked_on = greatest(coalesce(x.last_checked_on, v_date), v_date), last_checked_by = p_actor
     where x.id = (p_c ->> 'treasury_id')::uuid and x.tenant_id = p_tenant;
  end if;
  -- NC con comprobante relacionado: se imputa sola contra la partida de la factura (kind 'credit_note').
  if v_kind in ('purchase_credit_note', 'sales_credit_note') and v_related is not null then
    for n in select l.* from public.acc_journal_lines l join public.acc_document_lines dl on dl.id = l.document_line_id
              where l.entry_id = v_entry and dl.role = 'control' order by l.line_no loop
      v_left := public.acc_open_amount(n.id);
      for r in select il.id, il.entry_date from public.acc_journal_lines il
                 join public.acc_journal_entries e on e.id = il.entry_id
                where il.document_id = v_related and il.tenant_id = p_tenant and il.account_id = n.account_id
                  and il.party_id = n.party_id and il.side <> n.side and e.status = 'posted'
                order by il.line_no loop
        exit when v_left <= 0;
        v_amt := least(v_left, public.acc_open_amount(r.id));
        if v_amt > 0 then
          insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents,
                                              kind, applied_on, document_id, created_by, created_by_name)
          values (p_tenant, n.account_id, n.party_id,
                  case when n.side = 'debit' then n.id else r.id end,
                  case when n.side = 'debit' then r.id else n.id end,
                  v_amt, 'credit_note', greatest(v_date, r.entry_date), v_id, p_actor, p_actor_name);
          v_left := v_left - v_amt;
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('ref', p_c ->> 'ref', 'id', v_id, 'seq', v_seq, 'entry_id', v_entry,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'journal_line_id', l.id) order by l.line_no)
                         from public.acc_journal_lines l where l.entry_id = v_entry), '[]'::jsonb));
end;
$$;

-- ─── 7. acc_post_bundle (C.3): la única puerta para guardar comprobantes ─────────
-- La llama la server action con el bundle que ELLA reconstruyó (toRpcPayload). No confía en nada: valida todo.
create function public.acc_post_bundle(p_tenant_id uuid, p_client_ref uuid, p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_hash text;
  v_prev public.acc_bundles;
  v_bundle_id uuid := gen_random_uuid();
  v_docs jsonb;
  v_kinds text[];
  v_n integer;
  v_preview text;
  v_today date;
  v_bctx jsonb;
  v_party_refs jsonb := '{}'::jsonb;
  v_doc_refs jsonb := '{}'::jsonb;
  v_line_map jsonb := '{}'::jsonb;
  v_written jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_acks text[] := '{}'::text[];
  v_pending jsonb;
  v_alloc_ids jsonb := '[]'::jsonb;
  v_alloc_total bigint := 0;
  v_max_date date;
  v_c jsonb;
  v_res jsonb;
  v_result jsonb;
  w jsonb;
  r record;
  v_tr public.acc_treasury_accounts;
  dl public.acc_journal_lines;
  cl public.acc_journal_lines;
  v_deb uuid;
  v_cre uuid;
  v_amt bigint;
  v_akind text;
  v_aid uuid;
  v_adoc uuid;
  v_bal bigint;
begin
  -- 1. Escritor (dueño con acceso vigente, bar configurado) y lock del bar.
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  -- 2. Idempotencia (C.0): misma clave y mismo pedido → lo guardado con replayed; otro pedido → idempotency_conflict.
  if p_client_ref is null or p_bundle is null or jsonb_typeof(p_bundle) <> 'object' then
    perform private.acc_raise('invalid_bundle', '{"reason":"payload"}');
  end if;
  v_hash := encode(sha256(convert_to(p_bundle::text, 'UTF8')), 'hex');
  select * into v_prev from public.acc_bundles b where b.tenant_id = p_tenant_id and b.client_ref = p_client_ref;
  if found then
    if v_prev.operation = 'post' and v_prev.request_hash = v_hash then
      return v_prev.result || jsonb_build_object('replayed', true);
    end if;
    perform private.acc_raise('idempotency_conflict', jsonb_build_object('client_ref', p_client_ref));
  end if;

  -- 3. Forma: 1..10 comprobantes con ref únicos, tipos habilitados, composición de C.3.2, ≤ 200 imputaciones.
  v_preview := private.acc_jtext(p_bundle, 'preview_hash', '{}'::jsonb);
  if v_preview is null or v_preview !~ '^[0-9a-f]{64}$' then
    perform private.acc_raise('invalid_bundle', '{"reason":"preview_hash"}');
  end if;
  v_docs := p_bundle -> 'documents';
  if jsonb_typeof(v_docs) is distinct from 'array' or jsonb_array_length(v_docs) not between 1 and 10 then
    perform private.acc_raise('invalid_bundle', '{"reason":"document_count"}');
  end if;
  if exists (select 1 from jsonb_array_elements(v_docs) e
              where jsonb_typeof(e.value) <> 'object' or coalesce(e.value ->> 'ref', '') !~ '^[a-z0-9_]{1,20}$')
     or (select count(distinct e.value ->> 'ref') from jsonb_array_elements(v_docs) e) <> jsonb_array_length(v_docs) then
    perform private.acc_raise('invalid_bundle', '{"reason":"document_ref"}');
  end if;
  v_kinds := array(select coalesce(e.value ->> 'kind', '') from jsonb_array_elements(v_docs) with ordinality e(value, i)
                    order by e.i);
  v_n := cardinality(v_kinds);
  -- Anulaciones, liquidaciones y cierres los escriben sus RPC; un tipo sin ninguna fila en acc_line_rule (para
  -- ningún rol) no está habilitado todavía: cada fase lo habilita sumando sus filas.
  if exists (select 1 from unnest(v_kinds) k(kind)
              where k.kind in ('iva_settlement', 'reversal', 'fy_result', 'fy_closing', 'fy_opening')
                 or not exists (select 1
                                  from unnest(array['net', 'vat', 'gross', 'non_taxed', 'exempt', 'internal_tax',
                                         'perception', 'other_tax', 'control', 'treasury', 'compensation', 'deduction',
                                         'write_off', 'receivable', 'advance', 'sales_invoiced', 'sales_uninvoiced',
                                         'cash_diff', 'vat_pending_release', 'counterpart', 'adjustment_split', 'manual',
                                         'opening', 'settlement', 'reversal', 'fy_result', 'mirror']) ro(role)
                                 where exists (select 1 from private.acc_line_rule(k.kind, ro.role)))) then
    perform private.acc_raise('kind_not_allowed', jsonb_build_object('kinds', to_jsonb(v_kinds)));
  end if;
  if not ((v_n = 1 and v_kinds[1] in ('opening', 'purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense',
             'payment', 'sales_close', 'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection', 'transfer',
             'bank_expense', 'cash_movement', 'treasury_adjustment', 'manual'))
          or (v_n = 2 and v_kinds[1] = 'purchase' and v_kinds[2] = 'payment')
          or (v_n >= 2 and v_kinds[1] = 'sales_close' and v_kinds[2:v_n] <@ array['collection'])
          or (v_n = 2 and v_kinds[1] = 'sales_invoice' and v_kinds[2] = 'collection')
          or (v_n = 2 and v_kinds[1] = 'collection' and v_kinds[2] = 'treasury_adjustment')) then
    perform private.acc_raise('invalid_bundle', jsonb_build_object('reason', 'composition', 'kinds', to_jsonb(v_kinds)));
  end if;
  if coalesce(jsonb_typeof(p_bundle -> 'allocations'), 'null') not in ('array', 'null')
     or coalesce(jsonb_typeof(p_bundle -> 'new_parties'), 'null') not in ('array', 'null')
     or jsonb_array_length(coalesce(nullif(p_bundle -> 'allocations', 'null'::jsonb), '[]'::jsonb)) > 200 then
    perform private.acc_raise('invalid_bundle', '{"reason":"allocations_or_new_parties"}');
  end if;

  -- 4. Partícipes nuevos: las reglas de acc_save_party; cuentas de control = Proveedores y Deudores por ventas
  -- (lo mismo que asume el motor, resolveParty de validate.ts).
  v_today := public.acc_today(p_tenant_id);
  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  for r in select e.value as x from jsonb_array_elements(coalesce(nullif(p_bundle -> 'new_parties', 'null'::jsonb), '[]'::jsonb)) e loop
    if jsonb_typeof(r.x) <> 'object' or coalesce(r.x ->> 'ref', '') !~ '^[a-z0-9_]{1,20}$' or v_party_refs ? (r.x ->> 'ref') then
      perform private.acc_raise('invalid_bundle', '{"reason":"party_ref"}');
    end if;
    v_res := private.acc_party_save(p_tenant_id, v_uid, (r.x - 'ref') || jsonb_build_object(
               'payable_account_id', (select a.id from public.acc_accounts a
                                       where a.tenant_id = p_tenant_id and a.system_key = 'payable_suppliers'),
               'receivable_account_id', (select a.id from public.acc_accounts a
                                          where a.tenant_id = p_tenant_id and a.system_key = 'receivable_customers')),
             null, false);
    v_party_refs := v_party_refs || jsonb_build_object(r.x ->> 'ref', v_res -> 'row' ->> 'id');
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_party.saved', 'acc_party', (v_res -> 'row' ->> 'id')::uuid,
      jsonb_build_object('created', true, 'fields', v_res -> 'fields', 'bundle_id', v_bundle_id));
  end loop;

  -- 5–7. Cada comprobante, en orden: validar (pasos 3 y 5) y escribir (paso 7). Un error deshace todo; el arqueo
  -- de un segundo comprobante ve lo que escribió el primero (nota 6 del motor).
  for r in select e.value as x from jsonb_array_elements(v_docs) with ordinality e(value, i) order by e.i loop
    v_bctx := jsonb_build_object('today', v_today, 'party_refs', v_party_refs, 'doc_refs', v_doc_refs,
                                 'bundle_id', v_bundle_id);
    v_c := private.acc_check_document(p_tenant_id, private.acc_normalize_document(p_tenant_id, r.x, v_bctx), v_bctx);
    v_warn := v_warn || (v_c -> 'warnings');
    v_acks := v_acks || array(select jsonb_array_elements_text(v_c -> 'warnings_ack'));
    v_res := private.acc_write_document(p_tenant_id, v_uid, v_name, v_bundle_id, v_c);
    v_doc_refs := v_doc_refs || jsonb_build_object(v_c ->> 'ref', v_res ->> 'id');
    v_line_map := v_line_map || coalesce((select jsonb_object_agg((v_c ->> 'ref') || ':' || (l.value ->> 'line_no'),
                                                                  l.value ->> 'journal_line_id')
                                            from jsonb_array_elements(v_res -> 'lines') l), '{}'::jsonb);
    v_written := v_written || jsonb_build_array(v_res);
    v_max_date := greatest(v_max_date, (v_c ->> 'accounting_date')::date);
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.posted', 'acc_document', (v_res ->> 'id')::uuid,
      jsonb_build_object('kind', v_c ->> 'kind', 'voucher_type', v_c ->> 'voucher_type', 'seq', v_res -> 'seq',
                         'total_cents', v_c -> 'total_cents', 'accounting_date', v_c ->> 'accounting_date',
                         'party_id', v_c ->> 'party_id', 'bundle_id', v_bundle_id, 'preview_hash', v_preview));
  end loop;

  -- 8. Imputaciones del bundle: a partidas existentes ({line_id}) o a renglones del bundle ({doc, line_no}).
  -- applied_on = la fecha más nueva de las dos partidas y de los comprobantes del bundle (siempre un mes abierto).
  for r in select e.value as x, e.i
             from jsonb_array_elements(coalesce(nullif(p_bundle -> 'allocations', 'null'::jsonb), '[]'::jsonb))
                  with ordinality e(value, i) loop
    w := jsonb_build_object('allocation', r.i);
    if jsonb_typeof(r.x) <> 'object' or jsonb_typeof(r.x -> 'debit') is distinct from 'object'
       or jsonb_typeof(r.x -> 'credit') is distinct from 'object' then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"allocation"}');
    end if;
    v_amt := private.acc_jbig(r.x, 'amount_cents', w);
    v_akind := private.acc_jtext(r.x, 'kind', w);
    if v_amt is null or v_amt not between 1 and 1000000000000000 or v_akind is null
       or v_akind not in ('payment', 'credit_note', 'manual') then
      perform private.acc_raise('invalid_bundle', w || '{"reason":"allocation"}');
    end if;
    v_deb := case when (r.x -> 'debit') ? 'line_id' then private.acc_to_uuid(r.x -> 'debit' ->> 'line_id')
                  else private.acc_to_uuid(v_line_map ->> ((r.x -> 'debit' ->> 'doc') || ':' || (r.x -> 'debit' ->> 'line_no'))) end;
    v_cre := case when (r.x -> 'credit') ? 'line_id' then private.acc_to_uuid(r.x -> 'credit' ->> 'line_id')
                  else private.acc_to_uuid(v_line_map ->> ((r.x -> 'credit' ->> 'doc') || ':' || (r.x -> 'credit' ->> 'line_no'))) end;
    select * into dl from public.acc_journal_lines j where j.id = v_deb and j.tenant_id = p_tenant_id;
    if not found then
      perform private.acc_raise('item_not_found', w);
    end if;
    select * into cl from public.acc_journal_lines j where j.id = v_cre and j.tenant_id = p_tenant_id;
    if not found then
      perform private.acc_raise('item_not_found', w);
    end if;
    -- La generó el último comprobante del bundle que tiene una de las dos partidas (si no, el último del bundle).
    v_adoc := coalesce((select (d.value ->> 'id')::uuid from jsonb_array_elements(v_written) with ordinality d(value, i)
                         where (d.value ->> 'id')::uuid in (dl.document_id, cl.document_id) order by d.i desc limit 1),
                       (v_written -> -1 ->> 'id')::uuid);
    insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents, kind,
                                        applied_on, document_id, created_by, created_by_name)
    values (p_tenant_id, dl.account_id, coalesce(dl.party_id, cl.party_id), dl.id, cl.id, v_amt, v_akind,
            greatest(dl.entry_date, cl.entry_date, v_max_date), v_adoc, v_uid, v_name)
    returning id into v_aid;
    v_alloc_ids := v_alloc_ids || to_jsonb(v_aid);
    v_alloc_total := v_alloc_total + v_amt;
  end loop;
  if jsonb_array_length(v_alloc_ids) > 0 then
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_allocation.created', 'acc_allocation', v_bundle_id,
      jsonb_build_object('count', jsonb_array_length(v_alloc_ids), 'total_cents', v_alloc_total, 'bundle_id', v_bundle_id));
  end if;

  -- 5.11 Caja que quedaría negativa (allow_negative = false, el bundle le saca plata; la tarjeta no aplica).
  for r in select l.treasury_account_id as tid,
                  sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end) as delta
             from public.acc_document_lines l
            where l.tenant_id = p_tenant_id and l.role = 'treasury' and l.treasury_account_id is not null
              and l.document_id in (select (d.value ->> 'id')::uuid from jsonb_array_elements(v_written) d)
            group by l.treasury_account_id loop
    select * into v_tr from public.acc_treasury_accounts t where t.id = r.tid and t.tenant_id = p_tenant_id;
    if r.delta < 0 and not v_tr.allow_negative and v_tr.kind <> 'credit_card' then
      v_bal := private.acc_treasury_book_cents(p_tenant_id, r.tid, null);
      if v_bal < 0 then
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('key', 'treasury_negative', 'treasury_id', r.tid,
                    'treasury_name', v_tr.name, 'balance_after_cents', v_bal));
      end if;
    end if;
  end loop;

  -- 6. Avisos sin aceptar → todos juntos. Un aviso se acepta con su clave en warnings_ack de cualquier comprobante
  -- (el motor pone lo aceptado en todos).
  select coalesce(jsonb_agg(x.value), '[]'::jsonb) into v_pending
    from jsonb_array_elements(v_warn) x where not ((x.value ->> 'key') = any (v_acks));
  if jsonb_array_length(v_pending) > 0 then
    perform private.acc_raise('warning_requires_ack', jsonb_build_object('warnings', v_pending));
  end if;

  -- 10. Resultado (con el número provisorio de cada asiento) guardado en el bundle para el reintento.
  select jsonb_agg(d.value || jsonb_build_object('provisional_number',
                     private.acc_provisional_number((d.value ->> 'entry_id')::uuid)) order by d.i)
    into v_docs
    from jsonb_array_elements(v_written) with ordinality d(value, i);
  v_result := jsonb_build_object('bundle_id', v_bundle_id, 'replayed', false, 'documents', v_docs,
                                 'allocations', v_alloc_ids);
  insert into public.acc_bundles (id, tenant_id, client_ref, operation, request_hash, preview_hash, result, created_by,
                                  created_by_name)
  values (v_bundle_id, p_tenant_id, p_client_ref, 'post', v_hash, v_preview, v_result, v_uid, v_name);
  return v_result;
end;
$$;

comment on function private.acc_project_entry(uuid, uuid, text, uuid) is
  'Inserta el asiento de un comprobante y copia sus renglones 1:1 (C.3.6). Devuelve el id del asiento.';
comment on function private.acc_void_allocations(uuid, uuid[], date, text, uuid, uuid) is
  'Desaplica imputaciones vigentes: voided_on = greatest(p_on, applied_on), voided_at/by, void_reason, void_document_id. Devuelve cuántas.';
comment on function private.acc_write_document(uuid, uuid, text, uuid, jsonb) is
  'Paso 7 de C.3.3 para un comprobante validado: comprobante, renglones, libro IVA, conciliación, asiento, «Corregir», gasto fijo, apertura, arqueo y NC relacionada.';
comment on function public.acc_post_bundle(uuid, uuid, jsonb) is
  'La única puerta para guardar comprobantes (C.3): valida todo, escribe comprobantes + asientos + imputaciones en una transacción e idempotente por client_ref.';

-- Permisos: las internas para nadie; acc_post_bundle solo authenticated (nada para anon).
revoke all on function private.acc_project_entry(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.acc_void_allocations(uuid, uuid[], date, text, uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_void_doc(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function private.acc_replace_line(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.acc_provisional_number(uuid) from public, anon, authenticated;
revoke all on function private.acc_write_document(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.acc_post_bundle(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_post_bundle(uuid, uuid, jsonb) to authenticated;
