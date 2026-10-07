-- Parte 3 de 4 de la migración #10 (acc_periods): reabrir el último mes cerrado y «Registrar la liquidación
-- del IVA». Usa acc_compute_iva_position, acc_void_iva_settlements y acc_generate_iva_settlement (parte 1); los
-- revoke/grant de cada función viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #10 (acc_periods) · spec §C.5.2, §C.5.4
-- ============================================================
-- Qué crea esta parte (en public, definer, EXECUTE solo authenticated):
--   · acc_reopen_period(tenant, mes, motivo) → jsonb      C.5.2
--   · acc_generate_iva_settlement(tenant, mes, expected)  C.5.4. Desvío: si la liquidación vigente quedó vieja (se
--     cargó algo después) la reemplaza; si sigue al día → iva_settlement_exists.
-- ============================================================

-- ─── 7. Reabrir el último mes cerrado (C.5.2) ────────────────────────────────
-- period_not_found, period_not_closed, reopen_not_last (detail {month: el último cerrado}), fiscal_year_closed,
-- reason_required (≥ 5 letras), iva_settlement_paid. Pasa a abierto (sin foto), vuelve provisorios sus
-- números, anula su liquidación de IVA («Reapertura del mes»), registra el evento con el motivo y audita.
create function public.acc_reopen_period(p_tenant_id uuid, p_month date, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_month date;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_period public.acc_periods;
  v_last date;
  v_fy_status text;
  v_docs uuid[];
  v_cleared integer;
  v_voided integer;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_month is null then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  v_month := date_trunc('month', p_month::timestamp)::date;
  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  if v_period.status <> 'closed' then
    raise exception 'period_not_closed' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  select max(p.month) into v_last from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.status = 'closed';
  if v_last > v_month then
    raise exception 'reopen_not_last' using errcode = 'P0001', detail = jsonb_build_object('month', v_last)::text;
  end if;
  select f.status into v_fy_status from public.acc_fiscal_years f
   where f.id = v_period.fiscal_year_id and f.tenant_id = p_tenant_id;
  if v_fy_status = 'closed' then
    raise exception 'fiscal_year_closed' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v_reason := left(v_reason, 300);

  -- Su liquidación de IVA (la anula private.acc_void_iva_settlements: iva_settlement_paid si ya se pagó).
  select coalesce(array_agg(d.id order by d.seq), '{}') into v_docs
    from public.acc_documents d
   where d.tenant_id = p_tenant_id and d.period_id = v_period.id and d.kind = 'iva_settlement' and d.status = 'posted';

  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  update public.acc_periods p
     set status = 'open', closed_at = null, closed_by = null, closed_by_name = null,
         number_from = null, number_to = null, entries_count = null, debit_total_cents = null,
         snapshot_hash = null, iva_settlement_document_id = null
   where p.id = v_period.id;

  -- Los números vuelven a provisorios (antes de anular: un asiento anulado no puede tener número).
  perform set_config('acc.numbering', v_period.id::text, true);
  update public.acc_journal_entries e set number = null
   where e.tenant_id = p_tenant_id and e.period_id = v_period.id and e.number is not null;
  get diagnostics v_cleared = row_count;
  perform set_config('acc.numbering', '', true);

  v_voided := private.acc_void_iva_settlements(p_tenant_id, v_docs, v_uid, 'Reapertura del mes');

  insert into public.acc_period_events (tenant_id, period_id, fiscal_year_id, action, reason, actor_id, actor_name, payload)
  values (p_tenant_id, v_period.id, v_period.fiscal_year_id, 'reopened', v_reason, v_uid, v_name,
          jsonb_build_object('number_from', v_period.number_from, 'number_to', v_period.number_to,
                             'entries_count', v_period.entries_count, 'debit_total_cents', v_period.debit_total_cents,
                             'snapshot_hash', v_period.snapshot_hash,
                             'iva_settlement_document_id', v_period.iva_settlement_document_id,
                             'voided_iva_settlement_ids', to_jsonb(v_docs)));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_period.reopened', 'acc_period', v_period.id,
    jsonb_build_object('month', v_month, 'numbers_cleared', v_cleared, 'voided_iva_settlements', v_voided));

  return jsonb_build_object('month', v_month, 'period_id', v_period.id, 'numbers_cleared', v_cleared,
                            'voided_iva_settlement_ids', to_jsonb(v_docs), 'voided_count', v_voided);
end;
$$;

-- ─── 8. «Registrar la liquidación del IVA» (C.5.4) ───────────────────────────
-- Mes abierto (period_closed); si ya hay una liquidación vigente al día → iva_settlement_exists; si quedó
-- vieja (se cargó algo después), se anula y se genera la nueva. Compara con p_expected (preview_stale).
-- Todo en cero → created false, document_id null.
create function public.acc_generate_iva_settlement(p_tenant_id uuid, p_month date, p_expected jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_month date;
  v_period public.acc_periods;
  v_pos jsonb;
  v_old uuid[];
  v_replaced integer := 0;
  v_doc uuid;
  v_seq bigint;
  v_total bigint;
  v_entry uuid;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_month is null then
    raise exception 'period_not_found' using errcode = 'P0001';
  end if;
  v_month := date_trunc('month', p_month::timestamp)::date;
  select * into v_period from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_month
     for update;
  if not found then
    raise exception 'period_not_found' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
  end if;

  v_pos := public.acc_compute_iva_position(p_tenant_id, v_month);
  if v_pos -> 'settlement' ->> 'document_id' is not null then
    if coalesce((v_pos -> 'settlement' ->> 'up_to_date')::boolean, false) then
      raise exception 'iva_settlement_exists' using errcode = 'P0001', detail = jsonb_build_object('month', v_month)::text;
    end if;
    select coalesce(array_agg(d.id), '{}') into v_old from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.period_id = v_period.id and d.kind = 'iva_settlement' and d.status = 'posted';
    v_replaced := private.acc_void_iva_settlements(p_tenant_id, v_old, v_uid, 'Reemplazada por una liquidación nueva');
  end if;

  v_doc := private.acc_generate_iva_settlement(p_tenant_id, v_period.id, p_expected, v_uid);
  if v_doc is not null then
    select d.seq, d.total_cents, e.id into v_seq, v_total, v_entry
      from public.acc_documents d join public.acc_journal_entries e on e.document_id = d.id
     where d.id = v_doc;
  end if;
  return jsonb_build_object('month', v_month, 'created', v_doc is not null, 'document_id', v_doc,
                            'document_seq', v_seq, 'entry_id', v_entry, 'total_cents', v_total,
                            'to_pay_cents', (v_pos ->> 'to_pay_cents')::bigint,
                            'in_favor_cents', (v_pos ->> 'in_favor_cents')::bigint,
                            'replaced_count', v_replaced);
end;
$$;

comment on function public.acc_reopen_period(uuid, date, text) is
  'Reabre el último mes cerrado (C.5.2): numeración provisoria, anula su liquidación de IVA y registra el motivo.';
comment on function public.acc_generate_iva_settlement(uuid, date, jsonb) is
  'Registra la liquidación de IVA de un mes abierto (C.5.4), comparando con la posición que vio el usuario.';

revoke all on function public.acc_reopen_period(uuid, date, text) from public, anon;
grant execute on function public.acc_reopen_period(uuid, date, text) to authenticated;
revoke all on function public.acc_generate_iva_settlement(uuid, date, jsonb) from public, anon;
grant execute on function public.acc_generate_iva_settlement(uuid, date, jsonb) to authenticated;
