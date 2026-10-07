-- Parte 3 de 3 de la migración #8 (acc_rpc_setup_master), partida en tres solo para que cada
-- apply_migration por MCP sea chica (las llamadas de más de ~100 KB se colgaban). Mismas sentencias
-- y en el mismo orden que el archivo único que se ensayó entero en transacción (115/116; la que faltó
-- era una expectativa del test, corregida); los revoke/grant de cada función viajan con ella.

-- ─── 8. Medios de cobro ──────────────────────────────────────────────────────
-- {id?, name, kind, channel, treasury_account_id?, party_id?, settlement_days?, active?, sort?}
create function public.acc_save_sales_method(p_tenant_id uuid, p_method jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_sales_methods;
  v_row public.acc_sales_methods;
  v_created boolean;
  v_key text;
  v_txt text;
  v_int bigint;
  v_bool boolean;
  v_party public.acc_parties;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_method is null or jsonb_typeof(p_method) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'method';
  end if;
  for v_key in select jsonb_object_keys(p_method) loop
    if v_key not in ('id', 'name', 'kind', 'channel', 'treasury_account_id', 'party_id', 'settlement_days', 'active',
                     'sort') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  v_created := not (p_method ? 'id');
  if v_created then
    if not (p_method ? 'name' and p_method ? 'kind' and p_method ? 'channel') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
    v_row.id := gen_random_uuid();
    v_row.tenant_id := p_tenant_id;
    v_row.settlement_days := 0;
    v_row.active := true;
    v_row.sort := (select coalesce(max(m.sort), 0) + 10 from public.acc_sales_methods m where m.tenant_id = p_tenant_id);
  else
    select * into v_old from public.acc_sales_methods m
     where m.id = private.acc_to_uuid(p_method ->> 'id') and m.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'sales_method_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    v_row := v_old;
  end if;

  if p_method ? 'name' then
    v_txt := btrim(coalesce(p_method ->> 'name', ''));
    if char_length(v_txt) not between 2 and 40 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
    if exists (select 1 from public.acc_sales_methods m
                where m.tenant_id = p_tenant_id and lower(m.name) = lower(v_txt) and m.id <> v_row.id) then
      raise exception 'sales_method_name_taken' using errcode = 'P0001', detail = v_txt;
    end if;
    v_row.name := v_txt;
  end if;
  if p_method ? 'kind' then
    v_txt := p_method ->> 'kind';
    if v_txt is null or v_txt not in ('treasury', 'settled_now', 'receivable', 'customer_account', 'advance') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
    end if;
    v_row.kind := v_txt;
  end if;
  if p_method ? 'channel' then
    v_txt := p_method ->> 'channel';
    if v_txt is null or v_txt not in ('salon', 'delivery', 'events') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'channel';
    end if;
    v_row.channel := v_txt;
  end if;
  foreach v_key in array array['treasury_account_id', 'party_id'] loop
    if p_method ? v_key then
      if jsonb_typeof(p_method -> v_key) <> 'null' and private.acc_to_uuid(p_method ->> v_key) is null then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
      end if;
      if v_key = 'treasury_account_id' then v_row.treasury_account_id := private.acc_to_uuid(p_method ->> v_key);
      else v_row.party_id := private.acc_to_uuid(p_method ->> v_key); end if;
    end if;
  end loop;
  if p_method ? 'settlement_days' then
    v_int := private.acc_to_bigint(p_method -> 'settlement_days');
    if v_int is null or v_int not between 0 and 120 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'settlement_days';
    end if;
    v_row.settlement_days := v_int;
  end if;
  if p_method ? 'sort' then
    v_int := private.acc_to_bigint(p_method -> 'sort');
    if v_int is null or v_int not between -32768 and 32767 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'sort';
    end if;
    v_row.sort := v_int;
  end if;
  if p_method ? 'active' then
    v_bool := private.acc_to_bool(p_method -> 'active');
    if v_bool is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'active';
    end if;
    v_row.active := v_bool;
  end if;

  -- Destinos según el tipo (CHECK asm_kind_targets) y que existan en el bar.
  if not ((v_row.kind = 'treasury' and v_row.treasury_account_id is not null and v_row.party_id is null)
       or (v_row.kind = 'settled_now' and v_row.treasury_account_id is not null and v_row.party_id is not null)
       or (v_row.kind = 'receivable' and v_row.treasury_account_id is null and v_row.party_id is not null)
       or (v_row.kind = 'customer_account' and v_row.treasury_account_id is null and v_row.party_id is null)
       or (v_row.kind = 'advance' and v_row.treasury_account_id is null and v_row.party_id is not null)) then
    raise exception 'invalid_method_targets' using errcode = 'P0001', detail = v_row.kind;
  end if;
  if v_row.treasury_account_id is not null and not exists (
       select 1 from public.acc_treasury_accounts t
        where t.id = v_row.treasury_account_id and t.tenant_id = p_tenant_id and t.active) then
    raise exception 'invalid_method_targets' using errcode = 'P0001', detail = 'treasury_account_id';
  end if;
  if v_row.party_id is not null then
    select * into v_party from public.acc_parties p where p.id = v_row.party_id and p.tenant_id = p_tenant_id;
    if not found
       or (v_row.kind = 'receivable' and v_party.kind not in ('card_processor', 'payment_wallet', 'delivery_platform'))
       or (v_row.kind = 'settled_now' and v_party.kind <> 'payment_wallet')
       or (v_row.kind = 'advance' and v_party.system_key is distinct from 'senas') then
      raise exception 'invalid_method_party' using errcode = 'P0001', detail = v_row.kind;
    end if;
  end if;

  if v_created then
    insert into public.acc_sales_methods (id, tenant_id, name, kind, channel, treasury_account_id, party_id,
                                          settlement_days, sort, active, created_by, updated_by)
    values (v_row.id, p_tenant_id, v_row.name, v_row.kind, v_row.channel, v_row.treasury_account_id, v_row.party_id,
            v_row.settlement_days, v_row.sort, v_row.active, v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_method) k);
  else
    update public.acc_sales_methods m
       set name = v_row.name, kind = v_row.kind, channel = v_row.channel, treasury_account_id = v_row.treasury_account_id,
           party_id = v_row.party_id, settlement_days = v_row.settlement_days, sort = v_row.sort,
           active = v_row.active, updated_by = v_uid
     where m.id = v_old.id and m.tenant_id = p_tenant_id
     returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;
  -- Prender un medio de seña activa también el partícipe «Señas de clientes».
  if v_row.kind = 'advance' and v_row.active then
    update public.acc_parties p set active = true, updated_by = v_uid
     where p.id = v_row.party_id and p.tenant_id = p_tenant_id and not p.active;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_sales_method.saved', 'acc_sales_method', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row);
end;
$$;

-- ─── 9. Puntos de venta ──────────────────────────────────────────────────────
-- {id?, number, label?, default_channel?, active?}
create function public.acc_save_sales_point(p_tenant_id uuid, p_point jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_sales_points;
  v_row public.acc_sales_points;
  v_created boolean;
  v_key text;
  v_txt text;
  v_int bigint;
  v_bool boolean;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_point is null or jsonb_typeof(p_point) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'point';
  end if;
  for v_key in select jsonb_object_keys(p_point) loop
    if v_key not in ('id', 'number', 'label', 'default_channel', 'active') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  v_created := not (p_point ? 'id');
  if v_created then
    if not (p_point ? 'number') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'number';
    end if;
    v_row.id := gen_random_uuid();
    v_row.tenant_id := p_tenant_id;
    v_row.default_channel := 'salon';
    v_row.active := true;
  else
    select * into v_old from public.acc_sales_points s
     where s.id = private.acc_to_uuid(p_point ->> 'id') and s.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'sales_point_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    v_row := v_old;
  end if;
  if p_point ? 'number' then
    v_int := private.acc_to_bigint(p_point -> 'number');
    if v_int is null or v_int not between 1 and 99998 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'number';
    end if;
    if exists (select 1 from public.acc_sales_points s
                where s.tenant_id = p_tenant_id and s.number = v_int and s.id <> v_row.id) then
      raise exception 'sales_point_taken' using errcode = 'P0001';
    end if;
    v_row.number := v_int;
  end if;
  if p_point ? 'label' or v_created then
    v_txt := nullif(btrim(coalesce(p_point ->> 'label', '')), '');
    if char_length(v_txt) > 60 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'label';
    end if;
    v_row.label := coalesce(v_txt, 'Punto de venta ' || v_row.number);
  end if;
  if p_point ? 'default_channel' then
    v_txt := p_point ->> 'default_channel';
    if v_txt is null or v_txt not in ('salon', 'delivery', 'events') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'default_channel';
    end if;
    v_row.default_channel := v_txt;
  end if;
  if p_point ? 'active' then
    v_bool := private.acc_to_bool(p_point -> 'active');
    if v_bool is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'active';
    end if;
    v_row.active := v_bool;
  end if;

  if v_created then
    insert into public.acc_sales_points (id, tenant_id, number, label, default_channel, active)
    values (v_row.id, p_tenant_id, v_row.number, v_row.label, v_row.default_channel, v_row.active)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_point) k);
  else
    update public.acc_sales_points s
       set number = v_row.number, label = v_row.label, default_channel = v_row.default_channel, active = v_row.active
     where s.id = v_old.id and s.tenant_id = p_tenant_id
     returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key <> 'updated_at');
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_sales_point.saved', 'acc_sales_point', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row);
end;
$$;

-- ─── 10. Gastos fijos ────────────────────────────────────────────────────────
-- {id?, name, party_id?, account_id, voucher_type?, vat_rate_bp?, amount_cents?, frequency?, due_day,
--  next_due_date, remind_days_before?, treasury_account_id?, active?, notes?}
create function public.acc_save_recurring_expense(p_tenant_id uuid, p_expense jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_recurring_expenses;
  v_row public.acc_recurring_expenses;
  v_created boolean;
  v_key text;
  v_txt text;
  v_int bigint;
  v_bool boolean;
  v_date date;
  v_uuid uuid;
  v_acc public.acc_accounts;
  v_tr public.acc_treasury_accounts;
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_expense is null or jsonb_typeof(p_expense) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'expense';
  end if;
  for v_key in select jsonb_object_keys(p_expense) loop
    if v_key not in ('id', 'name', 'party_id', 'account_id', 'voucher_type', 'vat_rate_bp', 'amount_cents', 'frequency',
                     'due_day', 'next_due_date', 'remind_days_before', 'treasury_account_id', 'active', 'notes') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  v_created := not (p_expense ? 'id');
  if v_created then
    foreach v_key in array array['name', 'account_id', 'due_day', 'next_due_date'] loop
      if not (p_expense ? v_key) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
      end if;
    end loop;
    v_row.id := gen_random_uuid();
    v_row.tenant_id := p_tenant_id;
    v_row.frequency := 'monthly';
    v_row.remind_days_before := 5;
    v_row.active := true;
  else
    select * into v_old from public.acc_recurring_expenses x
     where x.id = private.acc_to_uuid(p_expense ->> 'id') and x.tenant_id = p_tenant_id
       for update;
    if not found then
      raise exception 'recurring_not_found' using errcode = 'P0001';
    end if;
    if p_expected_updated_at is null
       or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    v_row := v_old;
  end if;

  if p_expense ? 'name' then
    v_txt := btrim(coalesce(p_expense ->> 'name', ''));
    if char_length(v_txt) not between 2 and 80 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
    end if;
    if exists (select 1 from public.acc_recurring_expenses x
                where x.tenant_id = p_tenant_id and lower(x.name) = lower(v_txt) and x.id <> v_row.id) then
      raise exception 'recurring_name_taken' using errcode = 'P0001', detail = v_txt;
    end if;
    v_row.name := v_txt;
  end if;
  if p_expense ? 'party_id' then
    if jsonb_typeof(p_expense -> 'party_id') = 'null' then
      v_row.party_id := null;
    else
      v_uuid := private.acc_to_uuid(p_expense ->> 'party_id');
      if v_uuid is null or not exists (select 1 from public.acc_parties p where p.id = v_uuid and p.tenant_id = p_tenant_id) then
        raise exception 'party_not_found' using errcode = 'P0001';
      end if;
      v_row.party_id := v_uuid;
    end if;
  end if;
  if p_expense ? 'account_id' then
    select * into v_acc from public.acc_accounts a
     where a.id = private.acc_to_uuid(p_expense ->> 'account_id') and a.tenant_id = p_tenant_id;
    -- «Imputación» (§C.3.4): imputable, activa, sin partícipe, no de caja, egreso o activo, y elegible en
    -- compras o sin clave de sistema.
    if not found or not v_acc.postable or not v_acc.active or v_acc.requires_party or v_acc.is_treasury
       or v_acc.type not in ('expense', 'asset') or not (v_acc.purchase_selectable or v_acc.system_key is null) then
      raise exception 'invalid_imputation_account' using errcode = 'P0001';
    end if;
    v_row.account_id := v_acc.id;
  end if;
  if p_expense ? 'voucher_type' then
    v_txt := nullif(p_expense ->> 'voucher_type', '');
    if v_txt is not null and v_txt not in (
         'factura_a', 'nota_debito_a', 'recibo_a', 'factura_b', 'nota_debito_b', 'recibo_b', 'factura_c', 'nota_debito_c',
         'recibo_c', 'factura_m', 'nota_debito_m', 'tique_factura_a', 'tique_factura_b', 'tique_factura_c', 'tique',
         'liquidacion', 'resumen_bancario', 'otro_comprobante', 'ddjj_impuesto', 'sin_comprobante') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'voucher_type';
    end if;
    v_row.voucher_type := v_txt;
  end if;
  if p_expense ? 'vat_rate_bp' then
    v_int := private.acc_to_bigint(p_expense -> 'vat_rate_bp');
    if jsonb_typeof(p_expense -> 'vat_rate_bp') <> 'null'
       and (v_int is null or v_int not in (0, 250, 500, 1050, 2100, 2700)) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'vat_rate_bp';
    end if;
    v_row.vat_rate_bp := v_int;
  end if;
  if p_expense ? 'amount_cents' then
    v_int := private.acc_to_bigint(p_expense -> 'amount_cents');
    if jsonb_typeof(p_expense -> 'amount_cents') <> 'null' and (v_int is null or v_int < 1) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'amount_cents';
    end if;
    if v_int > 999999999999 then
      raise exception 'amount_too_large' using errcode = 'P0001';
    end if;
    v_row.amount_cents := v_int;
  end if;
  if p_expense ? 'frequency' then
    v_txt := p_expense ->> 'frequency';
    if v_txt is null or v_txt not in ('monthly', 'bimonthly', 'quarterly', 'yearly') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'frequency';
    end if;
    v_row.frequency := v_txt;
  end if;
  foreach v_key in array array['due_day', 'remind_days_before'] loop
    if p_expense ? v_key then
      v_int := private.acc_to_bigint(p_expense -> v_key);
      if v_int is null or (v_key = 'due_day' and v_int not between 1 and 31)
         or (v_key = 'remind_days_before' and v_int not between 0 and 30) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = v_key;
      end if;
      if v_key = 'due_day' then v_row.due_day := v_int; else v_row.remind_days_before := v_int; end if;
    end if;
  end loop;
  if p_expense ? 'next_due_date' then
    v_date := private.acc_to_date(p_expense ->> 'next_due_date');
    if v_date is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'next_due_date';
    end if;
    v_row.next_due_date := v_date;
  end if;
  if p_expense ? 'treasury_account_id' then
    if jsonb_typeof(p_expense -> 'treasury_account_id') = 'null' then
      v_row.treasury_account_id := null;
    else
      select * into v_tr from public.acc_treasury_accounts t
       where t.id = private.acc_to_uuid(p_expense ->> 'treasury_account_id') and t.tenant_id = p_tenant_id;
      if not found then
        raise exception 'treasury_not_found' using errcode = 'P0001';
      end if;
      if not v_tr.active then
        raise exception 'treasury_inactive' using errcode = 'P0001';
      end if;
      v_row.treasury_account_id := v_tr.id;
    end if;
  end if;
  if p_expense ? 'active' then
    v_bool := private.acc_to_bool(p_expense -> 'active');
    if v_bool is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'active';
    end if;
    v_row.active := v_bool;
  end if;
  if p_expense ? 'notes' then
    v_txt := nullif(btrim(coalesce(p_expense ->> 'notes', '')), '');
    if char_length(v_txt) > 280 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'notes';
    end if;
    v_row.notes := v_txt;
  end if;

  if v_created then
    insert into public.acc_recurring_expenses (id, tenant_id, name, party_id, account_id, voucher_type, vat_rate_bp,
                                               amount_cents, frequency, due_day, next_due_date, remind_days_before,
                                               treasury_account_id, active, notes, created_by, updated_by)
    values (v_row.id, p_tenant_id, v_row.name, v_row.party_id, v_row.account_id, v_row.voucher_type, v_row.vat_rate_bp,
            v_row.amount_cents, v_row.frequency, v_row.due_day, v_row.next_due_date, v_row.remind_days_before,
            v_row.treasury_account_id, v_row.active, v_row.notes, v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_expense) k);
  else
    update public.acc_recurring_expenses x
       set name = v_row.name, party_id = v_row.party_id, account_id = v_row.account_id,
           voucher_type = v_row.voucher_type, vat_rate_bp = v_row.vat_rate_bp, amount_cents = v_row.amount_cents,
           frequency = v_row.frequency, due_day = v_row.due_day, next_due_date = v_row.next_due_date,
           remind_days_before = v_row.remind_days_before, treasury_account_id = v_row.treasury_account_id,
           active = v_row.active, notes = v_row.notes, updated_by = v_uid
     where x.id = v_old.id and x.tenant_id = p_tenant_id
     returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_row)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.saved', 'acc_recurring', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_row);
end;
$$;

-- «Saltear»: avanza el vencimiento sin cargar el comprobante. p_due_date = el que vio el usuario.
create function public.acc_skip_recurring_due(p_tenant_id uuid, p_id uuid, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_recurring_expenses;
  v_prev date;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_row from public.acc_recurring_expenses x where x.id = p_id and x.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0001';
  end if;
  if p_due_date is null or p_due_date <> v_row.next_due_date then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  v_prev := v_row.next_due_date;
  update public.acc_recurring_expenses x
     set next_due_date = private.acc_next_due(v_row.next_due_date, v_row.frequency, v_row.due_day), updated_by = v_uid
   where x.id = v_row.id
   returning * into v_row;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.skipped', 'acc_recurring', v_row.id,
    jsonb_build_object('due_date', v_prev, 'next_due_date', v_row.next_due_date));
  return to_jsonb(v_row);
end;
$$;

-- ─── 11. «Ajustar saldo» sin diferencia (con diferencia va por treasury_adjustment) ───
create function public.acc_mark_treasury_checked(p_tenant_id uuid, p_treasury_id uuid, p_counted_cents bigint,
                                                 p_expected_book_cents bigint, p_as_of date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tr public.acc_treasury_accounts;
  v_set public.acc_settings;
  v_period public.acc_periods;
  v_book bigint;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_tr from public.acc_treasury_accounts t where t.id = p_treasury_id and t.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'treasury_not_found' using errcode = 'P0001';
  end if;
  if not v_tr.active then
    raise exception 'treasury_inactive' using errcode = 'P0001';
  end if;
  if p_as_of is null or p_counted_cents is null or p_expected_book_cents is null then
    raise exception 'invalid_payload' using errcode = 'P0001',
      detail = case when p_as_of is null then 'as_of' when p_counted_cents is null then 'counted_cents'
                    else 'expected_book_cents' end;
  end if;
  if p_as_of > public.acc_today(p_tenant_id) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  select * into v_set from public.acc_settings s where s.tenant_id = p_tenant_id;
  if p_as_of < v_set.books_start_date then
    raise exception 'date_before_start' using errcode = 'P0001', detail = v_set.books_start_date::text;
  end if;
  perform private.acc_ensure_fiscal_year(p_tenant_id, p_as_of);
  v_period := private.acc_period_for(p_tenant_id, p_as_of, 'month');
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_period.month, 'YYYY-MM');
  end if;
  v_book := private.acc_treasury_book_cents(p_tenant_id, v_tr.id, p_as_of);
  if v_book <> p_expected_book_cents then
    raise exception 'stale_balance' using errcode = 'P0001', detail = jsonb_build_object('book_cents', v_book)::text;
  end if;
  if p_counted_cents <> p_expected_book_cents then
    raise exception 'difference_requires_adjustment' using errcode = 'P0001',
      detail = jsonb_build_object('difference_cents', p_counted_cents - p_expected_book_cents)::text;
  end if;
  update public.acc_treasury_accounts t
     set last_checked_on = greatest(coalesce(t.last_checked_on, p_as_of), p_as_of), last_checked_by = v_uid
   where t.id = v_tr.id
   returning * into v_tr;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_treasury.checked', 'acc_treasury', v_tr.id,
    jsonb_build_object('treasury_id', v_tr.id, 'as_of', p_as_of));
  return to_jsonb(v_tr);
end;
$$;

-- ─── 12. Contexto del motor y de los selectores (INVOKER, bajo la RLS de quien llama) ───
-- balance_cents de cada caja: saldo de libro en el lado normal de su cuenta (activo: debe − haber;
-- tarjeta de la empresa: haber − debe = deuda), sin espejos, todas las fechas.
create function public.acc_posting_context(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.acc_assert_reader(p_tenant_id);
  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'today', public.acc_today(p_tenant_id),
    'settings', (select to_jsonb(s) from public.acc_settings s where s.tenant_id = p_tenant_id),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'code', a.code, 'name', a.name, 'type', a.type, 'normal_side', a.normal_side,
               'parent_id', a.parent_id, 'level', a.level, 'postable', a.postable, 'active', a.active,
               'requires_party', a.requires_party, 'is_treasury', a.is_treasury,
               'purchase_selectable', a.purchase_selectable, 'manual_selectable', a.manual_selectable,
               'system_key', a.system_key, 'description', a.description, 'sort', a.sort)
             order by a.code collate "C")
        from public.acc_accounts a where a.tenant_id = p_tenant_id), '[]'::jsonb),
    'parties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'kind', p.kind, 'name', p.name, 'trade_name', p.trade_name, 'tax_id_type', p.tax_id_type,
               'tax_id', p.tax_id, 'iva_condition', p.iva_condition, 'payment_term_days', p.payment_term_days,
               'default_account_id', p.default_account_id, 'default_voucher_type', p.default_voucher_type,
               'payable_account_id', p.payable_account_id, 'receivable_account_id', p.receivable_account_id,
               'commission_vat_mode', p.commission_vat_mode, 'commission_bp', p.commission_bp,
               'iibb_withholding_bp', p.iibb_withholding_bp, 'vat_withholding_bp', p.vat_withholding_bp,
               'income_tax_withholding_bp', p.income_tax_withholding_bp, 'sircupa_bp', p.sircupa_bp,
               'active', p.active, 'system_key', p.system_key, 'updated_at', p.updated_at)
             order by p.name)
        from public.acc_parties p where p.tenant_id = p_tenant_id), '[]'::jsonb),
    'treasuries', coalesce((
      with bal as (
        select l.account_id, sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end) as dc
          from public.acc_journal_lines l
          join public.acc_journal_entries e on e.id = l.entry_id
         where l.tenant_id = p_tenant_id and e.status = 'posted' and not e.is_mirror
           and l.account_id in (select t2.account_id from public.acc_treasury_accounts t2 where t2.tenant_id = p_tenant_id)
         group by l.account_id)
      select jsonb_agg(to_jsonb(t) || jsonb_build_object(
               'account_code', a.code,
               'balance_cents', case when a.normal_side = 'debit' then coalesce(b.dc, 0) else -coalesce(b.dc, 0) end)
             order by t.sort, t.name)
        from public.acc_treasury_accounts t
        join public.acc_accounts a on a.id = t.account_id and a.tenant_id = t.tenant_id
        left join bal b on b.account_id = t.account_id
       where t.tenant_id = p_tenant_id), '[]'::jsonb),
    'methods', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.sort, m.name)
        from public.acc_sales_methods m where m.tenant_id = p_tenant_id), '[]'::jsonb),
    'sales_points', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.number)
        from public.acc_sales_points s where s.tenant_id = p_tenant_id), '[]'::jsonb));
end;
$$;

-- ─── 13. Reinicio antes del primer cierre (§I.6; solo postgres, por el MCP) ──
-- select private.acc_reset_tenant('<tenant_id>', 'BORRAR <slug>');
-- Borra todo lo contable del bar salvo acc_access y la historia de audit_log. Rechaza si hay algún
-- período cerrado (reset_after_close): desde el primer cierre se corrige con comprobantes.
create function private.acc_reset_tenant(p_tenant_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_confirm is distinct from ('BORRAR ' || v_slug) then
    raise exception 'reset_confirm_mismatch' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if exists (select 1 from public.acc_periods p where p.tenant_id = p_tenant_id and p.status = 'closed') then
    raise exception 'reset_after_close' using errcode = 'P0001';
  end if;

  -- La marca habilita el DELETE en los triggers de inmutabilidad (solo para este bar y esta transacción).
  perform set_config('acc.reset', p_tenant_id::text, true);
  update public.acc_periods p set iva_settlement_document_id = null
   where p.tenant_id = p_tenant_id and p.iva_settlement_document_id is not null;
  update public.acc_recurring_expenses x set last_document_id = null
   where x.tenant_id = p_tenant_id and x.last_document_id is not null;
  delete from public.acc_allocations where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('allocations', v_n);
  delete from public.acc_journal_lines where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('journal_lines', v_n);
  delete from public.acc_journal_entries where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('journal_entries', v_n);
  delete from public.acc_fiscal_vouchers where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('fiscal_vouchers', v_n);
  delete from public.acc_document_lines where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('document_lines', v_n);
  delete from public.acc_documents where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);
  delete from public.acc_bundles where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('bundles', v_n);
  delete from public.acc_recurring_expenses where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recurring_expenses', v_n);
  delete from public.acc_sales_methods where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sales_methods', v_n);
  delete from public.acc_sales_points where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sales_points', v_n);
  delete from public.acc_treasury_accounts where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('treasury_accounts', v_n);
  delete from public.acc_parties where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('parties', v_n);
  delete from public.acc_accounts where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('accounts', v_n);
  delete from public.acc_period_events where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('period_events', v_n);
  delete from public.acc_periods where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('periods', v_n);
  delete from public.acc_fiscal_years where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('fiscal_years', v_n);
  delete from public.acc_settings where tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('settings', v_n);
  perform set_config('acc.reset', '', true);

  perform private.acc_audit(p_tenant_id, null, 'acc_settings.reset', 'acc_settings', p_tenant_id, v_counts);
  return v_counts;
end;
$$;

comment on function public.acc_bootstrap(uuid, jsonb) is
  'Puesta en marcha de Administración (dueño con can_set_up, bajo el lock): SAS, acceso de administrador, plan, cajas, partícipes, medios, puntos de venta, ejercicio y períodos. Audita acc_setup.completed.';
comment on function public.acc_skip_opening(uuid) is
  '«Arrancar en cero»: opening_status = skipped y el N° 1 del primer ejercicio deja de estar reservado.';
comment on function public.acc_save_settings(uuid, jsonb, timestamptz) is
  'Edita los datos de la SAS (concurrencia por updated_at). Rearma ejercicios y períodos vacíos si cambia el inicio o el cierre.';
comment on function public.acc_save_account(uuid, jsonb, timestamptz) is 'Alta o edición de una cuenta del plan.';
comment on function public.acc_save_party(uuid, jsonb, timestamptz) is 'Alta o edición de un partícipe.';
comment on function public.acc_save_treasury_account(uuid, jsonb, timestamptz) is
  'Alta o edición de una caja (con su cuenta contable y, si se pide, el banco como partícipe).';
comment on function public.acc_save_sales_method(uuid, jsonb, timestamptz) is 'Alta o edición de un medio de cobro.';
comment on function public.acc_save_sales_point(uuid, jsonb, timestamptz) is 'Alta o edición de un punto de venta.';
comment on function public.acc_save_recurring_expense(uuid, jsonb, timestamptz) is 'Alta o edición de un gasto fijo.';
comment on function public.acc_skip_recurring_due(uuid, uuid, date) is 'Saltea el vencimiento actual de un gasto fijo.';
comment on function public.acc_mark_treasury_checked(uuid, uuid, bigint, bigint, date) is
  '«Ajustar saldo» sin diferencia: registra la verificación (last_checked_on/by) con el chequeo stale_balance.';
comment on function public.acc_posting_context(uuid) is
  'Contexto del motor y de los selectores: settings, cuentas, partícipes, cajas con saldo, medios y puntos de venta. INVOKER.';
comment on function private.acc_reset_tenant(uuid, text) is
  'Runbook de reinicio antes del primer cierre (I.6). Solo postgres: select private.acc_reset_tenant(id, ''BORRAR <slug>'').';

-- ─── 14. Grants ──────────────────────────────────────────────────────────────
revoke all on function private.acc_reset_tenant(uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.acc_save_sales_method(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_sales_method(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_save_sales_point(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_sales_point(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_save_recurring_expense(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_save_recurring_expense(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_skip_recurring_due(uuid, uuid, date) from public, anon;
grant execute on function public.acc_skip_recurring_due(uuid, uuid, date) to authenticated;
revoke all on function public.acc_mark_treasury_checked(uuid, uuid, bigint, bigint, date) from public, anon;
grant execute on function public.acc_mark_treasury_checked(uuid, uuid, bigint, bigint, date) to authenticated;
revoke all on function public.acc_posting_context(uuid) from public, anon;
grant execute on function public.acc_posting_context(uuid) to authenticated;

notify pgrst, 'reload schema';
