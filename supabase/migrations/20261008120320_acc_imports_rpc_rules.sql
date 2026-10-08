-- ============================================================
-- ARCA e importadores · migración 11 de 12 (diseño §4.1, §4.3.2–§4.3.3, §5.2.3, §6.3)
-- RPC de reglas y formatos de importación, y el estado de «Cómo arrancar»
-- ============================================================
-- Qué crea:
--   · acc_import_save_rule / acc_import_delete_rule: reglas del bar («Recordar para este
--     proveedor», reglas del banco). match y action en lista blanca; el patrón se compila al
--     guardar ('' ~ patrón); los ids tienen que ser del bar.
--   · acc_import_save_layout: mapeo de columnas de un extracto (upsert por firma).
--   · acc_report_onboarding (INVOKER, stable): los datos de la guía «Cómo arrancar» en una
--     consulta (mismo estilo que first_steps de acc_report_summary, sin tocarla).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Reglas ───────────────────────────────────────────────────────────────
-- p_rule (lista blanca): {id?, source, priority?, label, match, action, active?}. Alta sin id (source,
-- label, match y action obligatorios); edición con id y concurrencia optimista al milisegundo (una
-- regla borrada mientras tanto también es `stale`). source no cambia.
--   match:  {direction?: credit|debit, pattern?: regex ≤ 200, counterparty_cuit?, amount_min?, amount_max?,
--            treasury_account_id?, party_id?}
--   action: {kind, account_id?, party_id?, treasury_account_id?, field?, component?,
--            other_taxes_as?: perc_iibb|perc_iva|internal|account, jurisdiction_code?: 901–924}
create function public.acc_import_save_rule(p_tenant_id uuid, p_rule jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_old public.acc_import_rules;
  v_new public.acc_import_rules;
  v_created boolean;
  v_bad text;
  v_obj jsonb;
  v_ok boolean;
  v_uuid uuid;
  v_int bigint;
  r record;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(p_rule) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rule';
  end if;
  select k into v_bad from jsonb_object_keys(p_rule) k
   where k not in ('id', 'source', 'priority', 'label', 'match', 'action', 'active')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_id := private.acc_to_uuid(p_rule ->> 'id');
  if v_id is null and coalesce(jsonb_typeof(p_rule -> 'id'), 'null') <> 'null' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'id';
  end if;

  if v_id is not null then
    select * into v_old from public.acc_import_rules x where x.id = v_id and x.tenant_id = p_tenant_id for update;
    if not found or p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    if p_rule ? 'source' and p_rule ->> 'source' is distinct from v_old.source then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'source';
    end if;
    v_new := v_old;
    v_created := false;
  else
    if not (p_rule ? 'label' and p_rule ? 'match' and p_rule ? 'action')
       or coalesce(p_rule ->> 'source', '') not in ('arca_recibidos', 'mp_release', 'bank_statement') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'source';
    end if;
    v_new.source := p_rule ->> 'source';
    v_new.priority := 100;
    v_new.active := true;
    v_created := true;
  end if;

  if p_rule ? 'priority' then
    v_int := private.acc_to_bigint(p_rule -> 'priority');
    if v_int is null or v_int not between 1 and 1000 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'priority';
    end if;
    v_new.priority := v_int;
  end if;
  if p_rule ? 'label' then
    v_new.label := btrim(coalesce(p_rule ->> 'label', ''));
    if jsonb_typeof(p_rule -> 'label') <> 'string' or char_length(v_new.label) not between 2 and 120 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'label';
    end if;
  end if;
  if p_rule ? 'active' then
    if jsonb_typeof(p_rule -> 'active') <> 'boolean' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'active';
    end if;
    v_new.active := (p_rule ->> 'active')::boolean;
  end if;

  if p_rule ? 'match' then
    v_obj := p_rule -> 'match';
    if jsonb_typeof(v_obj) <> 'object' or pg_column_size(v_obj) > 4096 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'match';
    end if;
    for r in select e.key, e.value from jsonb_each(v_obj) e loop
      v_uuid := private.acc_to_uuid(r.value #>> '{}');
      v_ok := case
        when r.key = 'direction' then jsonb_typeof(r.value) = 'string' and r.value #>> '{}' in ('credit', 'debit')
        when r.key = 'pattern' then jsonb_typeof(r.value) = 'string' and char_length(r.value #>> '{}') between 1 and 200
        when r.key = 'counterparty_cuit' then jsonb_typeof(r.value) = 'string'
                                              and coalesce(public.acc_cuit_is_valid(r.value #>> '{}'), false)
        when r.key in ('amount_min', 'amount_max') then coalesce(private.acc_to_bigint(r.value) >= 0, false)
        when r.key = 'treasury_account_id' then exists (select 1 from public.acc_treasury_accounts t
                                                         where t.id = v_uuid and t.tenant_id = p_tenant_id)
        when r.key = 'party_id' then exists (select 1 from public.acc_parties p
                                              where p.id = v_uuid and p.tenant_id = p_tenant_id)
        else false end;
      if not v_ok then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'match.' || r.key;
      end if;
    end loop;
    if private.acc_to_bigint(v_obj -> 'amount_min') > private.acc_to_bigint(v_obj -> 'amount_max') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'match.amount_min';
    end if;
    if v_obj ? 'pattern' then
      begin
        perform '' ~ (v_obj ->> 'pattern');
      exception when others then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'match.pattern';
      end;
    end if;
    v_new.match := v_obj;
  end if;

  if p_rule ? 'action' then
    v_obj := p_rule -> 'action';
    if jsonb_typeof(v_obj) <> 'object' or pg_column_size(v_obj) > 4096
       or jsonb_typeof(v_obj -> 'kind') is distinct from 'string' or v_obj ->> 'kind' !~ '^[a-z][a-z0-9_]{1,39}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'action';
    end if;
    for r in select e.key, e.value from jsonb_each(v_obj) e loop
      v_uuid := private.acc_to_uuid(r.value #>> '{}');
      v_ok := case
        when r.key = 'kind' then true
        when r.key in ('field', 'component') then jsonb_typeof(r.value) = 'string'
                                                  and r.value #>> '{}' ~ '^[a-z][a-z0-9_]{1,39}$'
        when r.key = 'other_taxes_as' then jsonb_typeof(r.value) = 'string'
                                           and r.value #>> '{}' in ('perc_iibb', 'perc_iva', 'internal', 'account')
        when r.key = 'jurisdiction_code' then coalesce(private.acc_to_bigint(r.value) between 901 and 924, false)
        when r.key = 'account_id' then exists (select 1 from public.acc_accounts a
                                                where a.id = v_uuid and a.tenant_id = p_tenant_id)
        when r.key = 'party_id' then exists (select 1 from public.acc_parties p
                                              where p.id = v_uuid and p.tenant_id = p_tenant_id)
        when r.key = 'treasury_account_id' then exists (select 1 from public.acc_treasury_accounts t
                                                         where t.id = v_uuid and t.tenant_id = p_tenant_id)
        else false end;
      if not v_ok then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'action.' || r.key;
      end if;
    end loop;
    v_new.action := v_obj;
  end if;

  if v_created then
    insert into public.acc_import_rules (tenant_id, source, priority, label, match, action, active, created_by, updated_by)
    values (p_tenant_id, v_new.source, v_new.priority, v_new.label, v_new.match, v_new.action, v_new.active, v_uid, v_uid)
    returning * into v_new;
  else
    update public.acc_import_rules x
       set priority = v_new.priority, label = v_new.label, match = v_new.match, action = v_new.action,
           active = v_new.active, updated_by = v_uid
     where x.id = v_old.id
     returning * into v_new;
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.rule_saved', 'acc_import_rule', v_new.id,
    jsonb_build_object('source', v_new.source, 'created', v_created, 'kind', v_new.action ->> 'kind',
                       'active', v_new.active));
  return to_jsonb(v_new);
end;
$$;

-- Borrar una regla (no lo que ya se cargó con ella). Borrar algo que ya no está no hace nada.
create function public.acc_import_delete_rule(p_tenant_id uuid, p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_source text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  delete from public.acc_import_rules x
   where x.id = p_rule_id and x.tenant_id = p_tenant_id
  returning x.source into v_source;
  if v_source is not null then
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.rule_deleted', 'acc_import_rule', p_rule_id,
      jsonb_build_object('source', v_source));
  end if;
end;
$$;

-- ─── 2. Formatos de extracto ─────────────────────────────────────────────────
-- p_layout (lista blanca): {source?: bank_statement, signature: sha256 hex, mapping: objeto (≤ 4 KB),
-- treasury_account_id?}. Upsert por (bar, origen, firma).
create function public.acc_import_save_layout(p_tenant_id uuid, p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bad text;
  v_source text;
  v_treasury uuid;
  v_row public.acc_import_layouts;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(p_layout) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'layout';
  end if;
  select k into v_bad from jsonb_object_keys(p_layout) k
   where k not in ('source', 'signature', 'mapping', 'treasury_account_id')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_source := coalesce(p_layout ->> 'source', 'bank_statement');
  if v_source <> 'bank_statement' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'source';
  end if;
  if coalesce(p_layout ->> 'signature', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'signature';
  end if;
  if jsonb_typeof(p_layout -> 'mapping') is distinct from 'object' or pg_column_size(p_layout -> 'mapping') > 4096 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'mapping';
  end if;
  v_treasury := private.acc_to_uuid(p_layout ->> 'treasury_account_id');
  if (v_treasury is null and p_layout ->> 'treasury_account_id' is not null)
     or (v_treasury is not null and not exists (select 1 from public.acc_treasury_accounts t
                                                 where t.id = v_treasury and t.tenant_id = p_tenant_id)) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
  end if;
  insert into public.acc_import_layouts (tenant_id, source, signature, mapping, treasury_account_id, created_by)
  values (p_tenant_id, v_source, p_layout ->> 'signature', p_layout -> 'mapping', v_treasury, v_uid)
  on conflict (tenant_id, source, signature) do update
    set mapping = excluded.mapping, treasury_account_id = excluded.treasury_account_id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ─── 3. «Cómo arrancar» ──────────────────────────────────────────────────────
-- Los booleanos, conteos y fechas de la tabla de §5.2.2 en una consulta. Los ítems manuales salen de
-- acc_guide_progress (guide = 'arranque'). INVOKER: corre bajo la RLS de quien llama.
create function public.acc_report_onboarding(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_set public.acc_settings;
  v_today date;
  v_month date;
  v_prev date;
begin
  perform public.acc_assert_reader(p_tenant_id);
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  if not found then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
  v_today := public.acc_today(p_tenant_id);
  v_month := date_trunc('month', v_today::timestamp)::date;
  v_prev := (v_month - interval '1 month')::date;
  return jsonb_build_object(
    'today', v_today,
    'sas_missing', to_jsonb(array_remove(array[
      case when v_set.cuit is null then 'cuit' end,
      case when v_set.iibb_number is null then 'iibb_number' end,
      case when v_set.activity_start_date is null then 'activity_start_date' end,
      case when v_set.fiscal_address is null then 'fiscal_address' end], null)),
    'bank_with_cbu', exists (select 1 from public.acc_treasury_accounts t
                              where t.tenant_id = p_tenant_id and t.active and t.kind = 'bank' and t.cbu_cvu is not null),
    'wallet_with_cvu', exists (select 1 from public.acc_treasury_accounts t
                                where t.tenant_id = p_tenant_id and t.active and t.kind = 'wallet' and t.cbu_cvu is not null),
    'sales_methods', (select count(*) from public.acc_sales_methods m where m.tenant_id = p_tenant_id and m.active),
    'sales_points', (select count(*) from public.acc_sales_points sp where sp.tenant_id = p_tenant_id and sp.active),
    'opening_done', v_set.opening_status in ('posted', 'skipped'),
    'partner_granted', (select count(*) from public.acc_access x
                         where x.tenant_id = p_tenant_id and x.revoked_at is null) > 1,
    'accountant_added', exists (select 1 from public.memberships m
                                 where m.tenant_id = p_tenant_id and m.role = 'accountant'),
    'arca', (select jsonb_build_object('status', c.status, 'cert_not_after', c.cert_not_after,
                                       'emission_enabled', c.emission_enabled)
               from public.acc_arca_connections c where c.tenant_id = p_tenant_id and c.environment = 'produccion'),
    'arca_vouchers_attention', (select count(*) from public.acc_arca_vouchers v
                                 where v.tenant_id = p_tenant_id and v.status in ('needs_reconcile', 'authorized')),
    'mp', (select jsonb_build_object('status', m.status, 'last_sync_at', m.last_sync_at, 'last_error_key', m.last_error_key)
             from public.acc_mp_connections m where m.tenant_id = p_tenant_id),
    'imports', (select coalesce(jsonb_object_agg(x.source, jsonb_build_object(
                                 'last_batch_at', x.last_at, 'posted_batches', x.posted, 'pending_review', x.pending)), '{}'::jsonb)
                  from (select b.source, max(b.created_at) as last_at,
                               count(*) filter (where b.status in ('posting', 'done')) as posted,
                               count(*) filter (where b.status in ('staging', 'review', 'posting')) as pending
                          from public.acc_import_batches b
                         where b.tenant_id = p_tenant_id and b.status <> 'cancelled'
                         group by b.source) x),
    'mc_prev_month_covered', exists (select 1 from public.acc_import_batches b
                                      where b.tenant_id = p_tenant_id and b.source = 'arca_recibidos'
                                        and b.status <> 'cancelled' and b.period_from <= v_prev
                                        and b.period_to >= v_month - 1),
    'recurring_active', (select count(*) from public.acc_recurring_expenses rx
                          where rx.tenant_id = p_tenant_id and rx.active),
    'daily_close_missing', (select count(*) from generate_series(v_today - 7, v_today - 1, interval '1 day') g(d)
                             where g.d::date >= v_set.books_start_date
                               and not exists (select 1 from public.acc_documents d
                                                where d.tenant_id = p_tenant_id and d.status = 'posted'
                                                  and d.kind = 'sales_close' and d.accounting_date = g.d::date)),
    'mp_invoice_this_month', exists (select 1 from public.acc_documents d
                                      where d.tenant_id = p_tenant_id and d.status = 'posted' and d.settles_commissions
                                        and d.accounting_date >= v_month and d.accounting_date < v_month + interval '1 month'),
    'treasuries_unchecked', (select count(*) from public.acc_treasury_accounts t
                              where t.tenant_id = p_tenant_id and t.active and t.kind <> 'credit_card'
                                and (t.last_checked_on is null or t.last_checked_on < v_month)),
    'prev_month_closed', exists (select 1 from public.acc_periods p
                                  where p.tenant_id = p_tenant_id and p.kind = 'month' and p.month = v_prev
                                    and p.status = 'closed'),
    'manual', (select coalesce(jsonb_agg(g.step order by g.step), '[]'::jsonb) from public.acc_guide_progress g
                where g.tenant_id = p_tenant_id and g.guide = 'arranque'));
end;
$$;

comment on function public.acc_import_save_rule(uuid, jsonb, timestamptz) is
  'Alta o edición de una regla de importación (match y action en lista blanca, patrón compilado, ids del bar). Audita acc_import.rule_saved.';
comment on function public.acc_import_delete_rule(uuid, uuid) is
  'Borra una regla de importación. Audita acc_import.rule_deleted.';
comment on function public.acc_import_save_layout(uuid, jsonb) is
  'Guarda el mapeo de columnas de un formato de extracto (upsert por firma).';
comment on function public.acc_report_onboarding(uuid) is
  'Estado de la guía «Cómo arrancar» (datos de la SAS, cajas, accesos, ARCA, importaciones, cierres, ítems manuales). INVOKER.';

-- ─── 4. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_import_save_rule(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_import_save_rule(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_import_delete_rule(uuid, uuid) from public, anon;
grant execute on function public.acc_import_delete_rule(uuid, uuid) to authenticated;
revoke all on function public.acc_import_save_layout(uuid, jsonb) from public, anon;
grant execute on function public.acc_import_save_layout(uuid, jsonb) to authenticated;
revoke all on function public.acc_report_onboarding(uuid) from public, anon;
grant execute on function public.acc_report_onboarding(uuid) to authenticated;

notify pgrst, 'reload schema';
