-- Parte 2 de 3 de la migración #8 (acc_rpc_setup_master), partida en tres solo para que cada
-- apply_migration por MCP sea chica (las llamadas de más de ~100 KB se colgaban). Mismas sentencias
-- y en el mismo orden que el archivo único que se ensayó entero en transacción (115/116; la que faltó
-- era una expectativa del test, corregida); los revoke/grant de cada función viajan con ella.

-- ─── 3. Puesta en marcha ─────────────────────────────────────────────────────
-- p_payload = {display_name?, settings: {legal_name, books_start_date, cuit?, …campos editables de
-- acc_settings}, treasuries: [{key, name, kind, bank_name?, cbu_cvu?, alias?, account_number?,
-- allow_negative?, create_bank_party?}] (1..20, al menos una cash), sales: {…payload de acc_seed_defaults}}.
create function public.acc_bootstrap(p_tenant_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_s jsonb;
  v_today date;
  v_settings public.acc_settings;
  v_display text;
  v_access public.acc_access;
  r record;
  v_tr public.acc_treasury_accounts;
  v_trs jsonb := '[]'::jsonb;
  v_seed_trs jsonb := '[]'::jsonb;
  v_seed jsonb;
  v_fy uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant_id is null or not exists (select 1 from public.memberships m
       where m.tenant_id = p_tenant_id and m.user_id = v_uid and m.role = 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t
                  where t.id = p_tenant_id and t.feature_flags -> 'accounting' = 'true'::jsonb) then
    raise exception 'accounting_not_enabled' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  -- can_set_up bajo el lock: sin configurar y (nadie designado o designado yo).
  if exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant_id) then
    raise exception 'already_set_up' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_access a where a.tenant_id = p_tenant_id and a.revoked_at is null)
     and not exists (select 1 from public.acc_access a
                      where a.tenant_id = p_tenant_id and a.revoked_at is null and a.user_id = v_uid) then
    raise exception 'not_allowed_to_set_up' using errcode = 'P0001';
  end if;

  -- Datos de la SAS.
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'payload';
  end if;
  v_s := coalesce(v_payload -> 'settings', '{}'::jsonb);
  if jsonb_typeof(v_s) <> 'object' or nullif(btrim(coalesce(v_s ->> 'legal_name', '')), '') is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'legal_name';
  end if;
  v_today := public.acc_today(p_tenant_id);
  v_settings.tenant_id := p_tenant_id;
  v_settings := private.acc_settings_apply(v_settings, v_s);
  if v_settings.books_start_date is null or v_settings.books_start_date > v_today
     or v_settings.books_start_date < v_today - 400 then
    raise exception 'invalid_start_date' using errcode = 'P0001', detail = 'books_start_date';
  end if;
  if v_settings.activity_start_date > v_settings.books_start_date then
    raise exception 'invalid_start_date' using errcode = 'P0001', detail = 'activity_start_date';
  end if;

  -- Cajas: 1..20, nombres y claves únicos, al menos una de efectivo.
  if jsonb_typeof(v_payload -> 'treasuries') is distinct from 'array'
     or jsonb_array_length(v_payload -> 'treasuries') = 0 then
    raise exception 'cash_required' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_payload -> 'treasuries') > 20 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasuries';
  end if;
  select lower(btrim(e.value ->> 'name')) into v_display
    from jsonb_array_elements(v_payload -> 'treasuries') e
   group by lower(btrim(e.value ->> 'name')) having count(*) > 1
   limit 1;
  if found then
    raise exception 'treasury_name_taken' using errcode = 'P0001', detail = v_display;
  end if;
  if exists (select 1 from jsonb_array_elements(v_payload -> 'treasuries') e
              where e.value ->> 'key' is not null and e.value ->> 'key' !~ '^[a-z0-9_]{1,30}$')
     or exists (select 1 from jsonb_array_elements(v_payload -> 'treasuries') e
                 where e.value ->> 'key' is not null group by e.value ->> 'key' having count(*) > 1) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasuries.key';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_payload -> 'treasuries') e where e.value ->> 'kind' = 'cash') then
    raise exception 'cash_required' using errcode = 'P0001';
  end if;

  -- Puntos de venta únicos y en rango.
  if jsonb_typeof(v_payload -> 'sales') = 'object'
     and jsonb_typeof(v_payload -> 'sales' -> 'sales_points') = 'array' then
    if exists (select 1 from jsonb_array_elements(v_payload -> 'sales' -> 'sales_points') e
                where private.acc_to_bigint(e.value -> 'number') is null
                   or private.acc_to_bigint(e.value -> 'number') not between 1 and 99998
                   or coalesce(nullif(e.value ->> 'default_channel', ''), 'salon') not in ('salon', 'delivery', 'events')
                   or char_length(coalesce(e.value ->> 'label', '')) > 60) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'sales_points';
    end if;
    if exists (select 1 from jsonb_array_elements(v_payload -> 'sales' -> 'sales_points') e
                group by private.acc_to_bigint(e.value -> 'number') having count(*) > 1) then
      raise exception 'sales_point_taken' using errcode = 'P0001';
    end if;
  end if;

  v_display := nullif(btrim(coalesce(v_payload ->> 'display_name', '')), '');
  if char_length(v_display) > 80 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;

  -- 1. acc_settings
  insert into public.acc_settings (tenant_id, legal_name, cuit, iva_condition, iibb_regime, iibb_number,
                                   iibb_jurisdiction_code, activity_start_date, fiscal_address, books_start_date,
                                   fiscal_year_end_month, iva_settlement_mode, iva_due_day, iibb_due_day,
                                   vat_tolerance_cents, bank_tax_credit_computable_bp, bank_tax_debit_computable_bp,
                                   uninvoiced_sales_mode, closed_period_void_iva_mode, due_soon_days,
                                   setup_completed_at, created_by, updated_by)
  values (p_tenant_id, v_settings.legal_name, v_settings.cuit,
          coalesce(v_settings.iva_condition, 'responsable_inscripto'), coalesce(v_settings.iibb_regime, 'local'),
          v_settings.iibb_number, coalesce(v_settings.iibb_jurisdiction_code, 904), v_settings.activity_start_date,
          v_settings.fiscal_address, v_settings.books_start_date, coalesce(v_settings.fiscal_year_end_month, 12),
          coalesce(v_settings.iva_settlement_mode, 'on_close'), coalesce(v_settings.iva_due_day, 20),
          coalesce(v_settings.iibb_due_day, 15), coalesce(v_settings.vat_tolerance_cents, 1),
          coalesce(v_settings.bank_tax_credit_computable_bp, 3300), coalesce(v_settings.bank_tax_debit_computable_bp, 3300),
          coalesce(v_settings.uninvoiced_sales_mode, 'separate_accounts'),
          coalesce(v_settings.closed_period_void_iva_mode, 'adjustment_only'), coalesce(v_settings.due_soon_days, 7),
          now(), v_uid, v_uid)
  returning * into v_settings;

  -- 2. acc_access de quien configura (administrador); si ya estaba designado, se confirma.
  select * into v_access from public.acc_access a
   where a.tenant_id = p_tenant_id and a.user_id = v_uid and a.revoked_at is null
     for update;
  if found then
    update public.acc_access a set is_admin = true, display_name = coalesce(v_display, a.display_name)
     where a.id = v_access.id
     returning * into v_access;
  else
    v_display := coalesce(v_display, private.acc_default_display_name(p_tenant_id, v_uid));
    insert into public.acc_access (tenant_id, user_id, display_name, is_admin, source, granted_by, granted_by_name)
    values (p_tenant_id, v_uid, v_display, true, 'setup', v_uid, v_display)
    returning * into v_access;
  end if;

  -- 3. Plan de cuentas, cajas con sus cuentas, partícipes, medios y puntos de venta.
  perform private.acc_seed_chart(p_tenant_id);
  for r in select e.value as item, e.ordinality as ord
             from jsonb_array_elements(v_payload -> 'treasuries') with ordinality as e(value, ordinality)
            order by e.ordinality loop
    v_tr := private.acc_treasury_create(p_tenant_id, v_uid, r.item, r.ord::int, false);
    v_trs := v_trs || jsonb_build_array(jsonb_build_object('key', r.item ->> 'key', 'id', v_tr.id,
               'account_id', v_tr.account_id, 'name', v_tr.name, 'kind', v_tr.kind));
    v_seed_trs := v_seed_trs || jsonb_build_array(jsonb_build_object('key', r.item ->> 'key', 'id', v_tr.id,
               'create_bank_party', coalesce(private.acc_to_bool(r.item -> 'create_bank_party'), false),
               'bank_name', r.item ->> 'bank_name'));
  end loop;
  v_seed := private.acc_seed_defaults(p_tenant_id, jsonb_build_object(
    'actor_id', v_uid, 'treasuries', v_seed_trs,
    'sales', case when jsonb_typeof(v_payload -> 'sales') = 'object' then v_payload -> 'sales' else '{}'::jsonb end));

  -- 4. Ejercicio de la fecha de inicio (con sus meses y períodos especiales) y hasta hoy.
  v_fy := private.acc_ensure_fiscal_year(p_tenant_id, v_settings.books_start_date);
  perform private.acc_ensure_fiscal_year(p_tenant_id, v_today);

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_setup.completed', 'acc_settings', p_tenant_id,
    jsonb_build_object('books_start_date', v_settings.books_start_date,
                       'fiscal_year_end_month', v_settings.fiscal_year_end_month,
                       'treasuries', jsonb_array_length(v_trs), 'parties', v_seed -> 'parties',
                       'methods', v_seed -> 'sales_methods'));

  return jsonb_build_object(
    'fiscal_year_id', v_fy,
    'periods', (select count(*) from public.acc_periods p where p.tenant_id = p_tenant_id),
    'accounts', (select count(*) from public.acc_accounts a where a.tenant_id = p_tenant_id),
    'parties', (v_seed ->> 'parties')::int,
    'treasuries', v_trs,
    'sales_methods', (v_seed ->> 'sales_methods')::int,
    'sales_points', (v_seed ->> 'sales_points')::int,
    'access_id', v_access.id);
end;
$$;

-- «Arrancar en cero»: sin asiento de apertura. La numeración del primer ejercicio arranca en el primer asiento.
create function public.acc_skip_opening(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_set public.acc_settings;
  v_per public.acc_periods;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id for update;
  if v_set.opening_status = 'skipped' then
    return;                                              -- ya estaba: idempotente
  end if;
  if v_set.opening_status = 'posted' then
    raise exception 'opening_exists' using errcode = 'P0001';
  end if;
  select * into v_per from public.acc_periods p
   where p.tenant_id = p_tenant_id and p.kind = 'month' and v_set.books_start_date between p.starts_on and p.ends_on;
  if not found or v_per.status <> 'open' then
    raise exception 'opening_locked' using errcode = 'P0001';
  end if;
  update public.acc_settings s set opening_status = 'skipped', updated_by = v_uid where s.tenant_id = p_tenant_id;
  update public.acc_fiscal_years f set opening_number_reserved = false
   where f.id = v_per.fiscal_year_id and f.tenant_id = p_tenant_id;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_settings.updated', 'acc_settings', p_tenant_id,
    jsonb_build_object('fields', jsonb_build_array('opening_status')));
end;
$$;

-- ─── 4. Datos de la SAS ──────────────────────────────────────────────────────
create function public.acc_save_settings(p_tenant_id uuid, p_settings jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_settings;
  v_new public.acc_settings;
  v_today date;
  v_has_docs boolean;
  v_locked_fy boolean;
  v_rebuild boolean;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_old from public.acc_settings s where s.tenant_id = p_tenant_id for update;
  if p_expected_updated_at is null
     or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  v_new := private.acc_settings_apply(v_old, p_settings);
  v_today := public.acc_today(p_tenant_id);

  v_has_docs := exists (select 1 from public.acc_documents d where d.tenant_id = p_tenant_id);
  v_locked_fy := exists (select 1 from public.acc_periods p where p.tenant_id = p_tenant_id and p.status = 'closed')
              or exists (select 1 from public.acc_period_events ev where ev.tenant_id = p_tenant_id);
  if v_has_docs and (v_new.iva_condition is distinct from v_old.iva_condition
                     or v_new.books_start_date is distinct from v_old.books_start_date) then
    raise exception 'settings_locked_by_documents' using errcode = 'P0001';
  end if;
  if (v_has_docs or v_locked_fy) and v_new.fiscal_year_end_month is distinct from v_old.fiscal_year_end_month then
    raise exception 'fiscal_year_locked' using errcode = 'P0001';
  end if;
  if v_locked_fy and v_new.books_start_date is distinct from v_old.books_start_date then
    raise exception 'fiscal_year_locked' using errcode = 'P0001';
  end if;
  if v_new.books_start_date is distinct from v_old.books_start_date
     and (v_new.books_start_date > v_today or v_new.books_start_date < v_today - 400) then
    raise exception 'invalid_start_date' using errcode = 'P0001', detail = 'books_start_date';
  end if;
  if v_new.activity_start_date > v_new.books_start_date then
    raise exception 'invalid_start_date' using errcode = 'P0001', detail = 'activity_start_date';
  end if;
  v_rebuild := v_new.books_start_date is distinct from v_old.books_start_date
            or v_new.fiscal_year_end_month is distinct from v_old.fiscal_year_end_month;

  update public.acc_settings s
     set legal_name = v_new.legal_name, cuit = v_new.cuit, iva_condition = v_new.iva_condition,
         iibb_regime = v_new.iibb_regime, iibb_number = v_new.iibb_number,
         iibb_jurisdiction_code = v_new.iibb_jurisdiction_code, activity_start_date = v_new.activity_start_date,
         fiscal_address = v_new.fiscal_address, books_start_date = v_new.books_start_date,
         fiscal_year_end_month = v_new.fiscal_year_end_month, iva_settlement_mode = v_new.iva_settlement_mode,
         iva_due_day = v_new.iva_due_day, iibb_due_day = v_new.iibb_due_day,
         vat_tolerance_cents = v_new.vat_tolerance_cents,
         bank_tax_credit_computable_bp = v_new.bank_tax_credit_computable_bp,
         bank_tax_debit_computable_bp = v_new.bank_tax_debit_computable_bp,
         uninvoiced_sales_mode = v_new.uninvoiced_sales_mode,
         closed_period_void_iva_mode = v_new.closed_period_void_iva_mode, due_soon_days = v_new.due_soon_days,
         updated_by = v_uid
   where s.tenant_id = p_tenant_id
   returning * into v_new;

  -- Cambió el inicio de los libros o el cierre del ejercicio (sin comprobantes ni cierres): se rearman
  -- ejercicios y períodos, que están vacíos.
  if v_rebuild then
    delete from public.acc_periods p where p.tenant_id = p_tenant_id;
    delete from public.acc_fiscal_years f where f.tenant_id = p_tenant_id;
    perform private.acc_ensure_fiscal_year(p_tenant_id, v_new.books_start_date);
    perform private.acc_ensure_fiscal_year(p_tenant_id, v_today);
    if v_new.opening_status = 'skipped' then
      update public.acc_fiscal_years f set opening_number_reserved = false
       where f.tenant_id = p_tenant_id and v_new.books_start_date between f.start_date and f.end_date;
    end if;
  end if;

  v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                 from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_settings.updated', 'acc_settings', p_tenant_id,
    jsonb_build_object('fields', v_fields));
  return to_jsonb(v_new);
end;
$$;

-- ─── 5. Plan de cuentas ──────────────────────────────────────────────────────
-- Alta: {parent_id, code?, name, postable?, contra?, requires_party?, purchase_selectable?, manual_selectable?,
--        description?}. Edición: {id, name?, code?, active?, purchase_selectable?, manual_selectable?,
--        description?, parent_id?, requires_party?}. El trigger acc_accounts_biu hace cumplir el resto.
create function public.acc_save_account(p_tenant_id uuid, p_account jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_accounts;
  v_row public.acc_accounts;
  v_parent public.acc_accounts;
  v_created boolean;
  v_key text;
  v_bool boolean;
  v_txt text;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_account is null or jsonb_typeof(p_account) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'account';
  end if;
  for v_key in select jsonb_object_keys(p_account) loop
    if v_key not in ('id', 'parent_id', 'code', 'name', 'postable', 'contra', 'requires_party', 'purchase_selectable',
                     'manual_selectable', 'description', 'active') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  v_created := not (p_account ? 'id');

  if v_created then
    select * into v_parent from public.acc_accounts a
     where a.id = private.acc_to_uuid(p_account ->> 'parent_id') and a.tenant_id = p_tenant_id;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
    end if;
    v_row.id := gen_random_uuid();
    v_row.tenant_id := p_tenant_id;
    v_row.parent_id := v_parent.id;
    v_row.type := v_parent.type;
    v_row.active := true;
    v_row.postable := true;
    v_row.requires_party := false;
    v_row.purchase_selectable := false;
    v_row.manual_selectable := true;
    v_bool := false;                                       -- contra (regularizadora)
    foreach v_key in array array['postable', 'contra'] loop
      if p_account ? v_key then
        if private.acc_to_bool(p_account -> v_key) is null then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
        end if;
        if v_key = 'postable' then v_row.postable := private.acc_to_bool(p_account -> v_key);
        else v_bool := private.acc_to_bool(p_account -> v_key); end if;
      end if;
    end loop;
    -- Lado normal: el del tipo (activo y egreso al Debe); una regularizadora lo invierte.
    v_row.normal_side := (case when (v_parent.type in ('asset', 'expense')) <> v_bool then 'debit' else 'credit' end)::public.acc_side;
    if not (p_account ? 'name') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
  else
    select * into v_old from public.acc_accounts a
     where a.id = private.acc_to_uuid(p_account ->> 'id') and a.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    if p_account ? 'postable' or p_account ? 'contra' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'postable';
    end if;
    v_row := v_old;
    if p_account ? 'parent_id' then
      select * into v_parent from public.acc_accounts a
       where a.id = private.acc_to_uuid(p_account ->> 'parent_id') and a.tenant_id = p_tenant_id;
      if not found then
        raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
      end if;
      v_row.parent_id := v_parent.id;
    end if;
  end if;

  foreach v_key in array array['requires_party', 'purchase_selectable', 'manual_selectable', 'active'] loop
    if p_account ? v_key then
      v_bool := private.acc_to_bool(p_account -> v_key);
      if v_bool is null or (v_created and v_key = 'active') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
      end if;
      case v_key
        when 'requires_party' then v_row.requires_party := v_bool;
        when 'purchase_selectable' then v_row.purchase_selectable := v_bool;
        when 'manual_selectable' then v_row.manual_selectable := v_bool;
        else v_row.active := v_bool;
      end case;
    end if;
  end loop;
  if v_row.requires_party and (not v_row.postable or v_row.is_treasury) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'requires_party';
  end if;
  if p_account ? 'name' then
    v_txt := btrim(coalesce(p_account ->> 'name', ''));
    if char_length(v_txt) not between 2 and 80 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
    v_row.name := v_txt;
  end if;
  if p_account ? 'description' then
    v_txt := nullif(btrim(coalesce(p_account ->> 'description', '')), '');
    if char_length(v_txt) > 280 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'description';
    end if;
    v_row.description := v_txt;
  end if;
  -- Código: el propuesto es el siguiente libre de la madre.
  if p_account ? 'code' and nullif(btrim(coalesce(p_account ->> 'code', '')), '') is not null then
    v_txt := btrim(p_account ->> 'code');
    if v_txt !~ '^[0-9]+(\.[0-9]+)*$' or char_length(v_txt) > 24 then
      raise exception 'code_invalid' using errcode = 'P0001',
        detail = case when v_row.parent_id is not null then private.acc_next_child_code(p_tenant_id, v_row.parent_id) end;
    end if;
    if exists (select 1 from public.acc_accounts a
                where a.tenant_id = p_tenant_id and a.code = v_txt and a.id <> v_row.id) then
      raise exception 'code_taken' using errcode = 'P0001', detail = v_txt;
    end if;
    v_row.code := v_txt;
  elsif v_created then
    v_row.code := private.acc_next_child_code(p_tenant_id, v_row.parent_id);
  end if;

  if v_created then
    insert into public.acc_accounts (id, tenant_id, code, name, type, normal_side, parent_id, postable, active,
                                     requires_party, purchase_selectable, manual_selectable, description,
                                     created_by, updated_by)
    values (v_row.id, p_tenant_id, v_row.code, v_row.name, v_row.type, v_row.normal_side, v_row.parent_id,
            v_row.postable, true, v_row.requires_party, v_row.purchase_selectable, v_row.manual_selectable,
            v_row.description, v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_account) k);
  else
    update public.acc_accounts a
       set code = v_row.code, name = v_row.name, parent_id = v_row.parent_id, active = v_row.active,
           requires_party = v_row.requires_party, purchase_selectable = v_row.purchase_selectable,
           manual_selectable = v_row.manual_selectable, description = v_row.description, updated_by = v_uid
     where a.id = v_old.id and a.tenant_id = p_tenant_id
     returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_account.saved', 'acc_account', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row);
end;
$$;

-- ─── 6. Partícipes ───────────────────────────────────────────────────────────
create function public.acc_save_party(p_tenant_id uuid, p_party jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_res jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  v_res := private.acc_party_save(p_tenant_id, v_uid, p_party, p_expected_updated_at, true);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_party.saved', 'acc_party', (v_res -> 'row' ->> 'id')::uuid,
    jsonb_build_object('created', v_res -> 'created', 'fields', v_res -> 'fields'));
  return v_res -> 'row';
end;
$$;

-- ─── 7. Cajas, bancos, billeteras y tarjeta de la empresa ───────────────────
-- {id?, name, kind, bank_name?, cbu_cvu?, alias?, account_number?, allow_negative?, create_bank_party?,
--  sort?, active?}. El saldo inicial de una caja nueva entra con «Otro ingreso».
create function public.acc_save_treasury_account(p_tenant_id uuid, p_treasury jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_treasury_accounts;
  v_row public.acc_treasury_accounts;
  v_created boolean;
  v_key text;
  v_txt text;
  v_bool boolean;
  v_int bigint;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_treasury is null or jsonb_typeof(p_treasury) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury';
  end if;
  for v_key in select jsonb_object_keys(p_treasury) loop
    if v_key not in ('id', 'name', 'kind', 'bank_name', 'cbu_cvu', 'alias', 'account_number', 'allow_negative',
                     'create_bank_party', 'sort', 'active') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if p_treasury ? 'create_bank_party' and private.acc_to_bool(p_treasury -> 'create_bank_party') is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'create_bank_party';
  end if;
  v_created := not (p_treasury ? 'id');

  if v_created then
    if p_treasury ? 'active' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'active';
    end if;
    v_row := private.acc_treasury_create(p_tenant_id, v_uid, p_treasury,
               coalesce(private.acc_to_bigint(p_treasury -> 'sort')::int,
                        (select coalesce(max(t.sort), 0) + 1 from public.acc_treasury_accounts t
                          where t.tenant_id = p_tenant_id)),
               coalesce(private.acc_to_bool(p_treasury -> 'create_bank_party'), false));
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_treasury) k);
  else
    select * into v_old from public.acc_treasury_accounts t
     where t.id = private.acc_to_uuid(p_treasury ->> 'id') and t.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'treasury_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    v_row := v_old;
    if p_treasury ? 'name' then
      v_txt := btrim(coalesce(p_treasury ->> 'name', ''));
      if char_length(v_txt) not between 2 and 60 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
      end if;
      if exists (select 1 from public.acc_treasury_accounts t
                  where t.tenant_id = p_tenant_id and lower(t.name) = lower(v_txt) and t.id <> v_old.id) then
        raise exception 'treasury_name_taken' using errcode = 'P0001', detail = v_txt;
      end if;
      v_row.name := v_txt;
    end if;
    if p_treasury ? 'kind' then
      v_txt := p_treasury ->> 'kind';
      if v_txt is null or v_txt not in ('cash', 'bank', 'wallet', 'credit_card', 'other') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
      end if;
      -- La cuenta no cambia de lado: una caja no pasa a ser la tarjeta de la empresa ni al revés.
      if (v_txt = 'credit_card') <> (v_old.kind = 'credit_card') then
        raise exception 'treasury_account_invalid' using errcode = 'P0001';
      end if;
      v_row.kind := v_txt;
    end if;
    if p_treasury ? 'bank_name' then
      v_txt := nullif(btrim(coalesce(p_treasury ->> 'bank_name', '')), '');
      if char_length(v_txt) > 80 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'bank_name';
      end if;
      v_row.bank_name := v_txt;
    end if;
    if p_treasury ? 'cbu_cvu' then
      v_txt := nullif(regexp_replace(coalesce(p_treasury ->> 'cbu_cvu', ''), '\s', '', 'g'), '');
      if v_txt !~ '^[0-9]{22}$' then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cbu_cvu';
      end if;
      v_row.cbu_cvu := v_txt;
    end if;
    if p_treasury ? 'alias' then
      v_txt := nullif(btrim(coalesce(p_treasury ->> 'alias', '')), '');
      if v_txt !~ '^[A-Za-z0-9.\-]{6,20}$' then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'alias';
      end if;
      v_row.alias := v_txt;
    end if;
    if p_treasury ? 'account_number' then
      v_txt := nullif(btrim(coalesce(p_treasury ->> 'account_number', '')), '');
      if char_length(v_txt) > 40 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'account_number';
      end if;
      v_row.account_number := v_txt;
    end if;
    foreach v_key in array array['allow_negative', 'active'] loop
      if p_treasury ? v_key then
        v_bool := private.acc_to_bool(p_treasury -> v_key);
        if v_bool is null then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
        end if;
        if v_key = 'allow_negative' then v_row.allow_negative := v_bool; else v_row.active := v_bool; end if;
      end if;
    end loop;
    if p_treasury ? 'sort' then
      v_int := private.acc_to_bigint(p_treasury -> 'sort');
      if v_int is null or v_int not between -32768 and 32767 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'sort';
      end if;
      v_row.sort := v_int;
    end if;
    -- Desactivar: con saldo cero y sin medios de cobro ni gastos fijos activos que la usen.
    if v_old.active and not v_row.active then
      if private.acc_treasury_book_cents(p_tenant_id, v_old.id, null) <> 0 then
        raise exception 'treasury_has_balance' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.acc_sales_methods m
                  where m.tenant_id = p_tenant_id and m.treasury_account_id = v_old.id and m.active)
         or exists (select 1 from public.acc_recurring_expenses x
                     where x.tenant_id = p_tenant_id and x.treasury_account_id = v_old.id and x.active) then
        raise exception 'treasury_in_use' using errcode = 'P0001';
      end if;
    end if;

    update public.acc_treasury_accounts t
       set name = v_row.name, kind = v_row.kind, bank_name = v_row.bank_name, cbu_cvu = v_row.cbu_cvu,
           alias = v_row.alias, account_number = v_row.account_number, allow_negative = v_row.allow_negative,
           sort = v_row.sort, active = v_row.active, updated_by = v_uid
     where t.id = v_old.id and t.tenant_id = p_tenant_id
     returning * into v_row;
    -- La cuenta contable acompaña: mismo nombre y mismo estado.
    if v_row.name <> v_old.name or v_row.active <> v_old.active then
      update public.acc_accounts a set name = v_row.name, active = v_row.active, updated_by = v_uid
       where a.id = v_row.account_id and a.tenant_id = p_tenant_id;
    end if;
    if coalesce(private.acc_to_bool(p_treasury -> 'create_bank_party'), false) and v_row.bank_party_id is null then
      update public.acc_treasury_accounts t
         set bank_party_id = private.acc_bank_party_create(p_tenant_id, v_uid, coalesce(v_row.bank_name, v_row.name))
       where t.id = v_row.id
       returning * into v_row;
    end if;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_treasury.saved', 'acc_treasury', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row)
         || jsonb_build_object('account_code', (select a.code from public.acc_accounts a where a.id = v_row.account_id));
end;
$$;

-- Permisos de las funciones de esta parte
revoke all on function public.acc_bootstrap(uuid, jsonb) from public, anon;
grant execute on function public.acc_bootstrap(uuid, jsonb) to authenticated;
revoke all on function public.acc_skip_opening(uuid) from public, anon;
grant execute on function public.acc_skip_opening(uuid) to authenticated;
revoke all on function public.acc_save_settings(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_settings(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_save_account(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_account(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_save_party(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_party(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_save_treasury_account(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_treasury_account(uuid, jsonb, timestamptz) to authenticated;
