-- Parte 1 de 3 de la migración #8 (acc_rpc_setup_master), partida en tres solo para que cada
-- apply_migration por MCP sea chica (las llamadas de más de ~100 KB se colgaban). Mismas sentencias
-- y en el mismo orden que el archivo único que se ensayó entero en transacción (115/116; la que faltó
-- era una expectativa del test, corregida); los revoke/grant de cada función viajan con ella.
-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #8
-- RPC de configuración y datos maestros (spec §C.0, §C.2, §C.6 acc_posting_context, §I.6 reinicio)
-- ============================================================
-- Qué crea:
--   1. Helpers internos (private, sin EXECUTE para nadie): lectura segura del jsonb (acc_to_uuid,
--      acc_to_date, acc_to_bigint, acc_to_bool: null en vez de 22P02/22007), saldo de libro de una caja
--      (acc_treasury_book_cents), siguiente código libre del plan (acc_next_child_code), próximo
--      vencimiento de un gasto fijo (acc_next_due) y las reglas compartidas de datos de la SAS
--      (acc_settings_apply), partícipes (acc_party_save, también para new_parties de acc_post_bundle),
--      bancos como partícipe (acc_bank_party_create) y cajas (acc_treasury_create).
--   2. RPC de escritura (SECURITY DEFINER, EXECUTE solo authenticated): acc_bootstrap, acc_skip_opening,
--      acc_save_settings, acc_save_account, acc_save_party, acc_save_treasury_account,
--      acc_save_sales_method, acc_save_sales_point, acc_save_recurring_expense, acc_skip_recurring_due,
--      acc_mark_treasury_checked. Apertura estándar: acc_assert_writer (el bootstrap tiene su propia
--      regla: dueño + flag + can_set_up bajo el lock) → advisory lock del bar → validaciones → escritura
--      → auditoría en la misma transacción.
--   3. Lectura acc_posting_context (SECURITY INVOKER: corre bajo la RLS de quien llama; empieza con
--      acc_assert_reader).
--   4. private.acc_reset_tenant (runbook de reinicio antes del primer cierre, §I.6): solo postgres.
--
-- Errores: P0001 con la clave en el mensaje y `detail` = dónde; 42501 para unauthenticated/forbidden.
-- Claves que no estaban en §G.4 (las suma ACC_ERRORS): invalid_payload (forma del pedido, detail =
-- campo), treasury_not_found, treasury_inactive, sales_method_not_found, sales_method_name_taken,
-- sales_point_not_found, recurring_not_found, reset_confirm_mismatch.
-- Concurrencia optimista: p_expected_updated_at se compara al milisegundo (un Date de JS pierde los
-- microsegundos de Postgres).
-- ============================================================

-- ─── 1. Lectura segura del jsonb ─────────────────────────────────────────────
-- plpgsql (no sql): una función sql se inlinea y el planner podría evaluar el cast con una constante.
create function private.acc_to_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p::uuid;
end;
$$;

create function private.acc_to_date(p text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;                                          -- 2026-02-30 y parecidos
end;
$$;

-- Entero desde un número jsonb sin decimales (centavos, días, puntos básicos). null si no lo es.
create function private.acc_to_bigint(p jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then
    return null;
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or abs(v) > 9000000000000000000 then
    return null;
  end if;
  return v::bigint;
end;
$$;

create function private.acc_to_bool(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or jsonb_typeof(p) <> 'boolean' then
    return null;
  end if;
  return (p #>> '{}')::boolean;
end;
$$;

-- ─── 2. Helpers de dominio ───────────────────────────────────────────────────
-- Saldo de libro de una caja en el lado normal de su cuenta (activo: debe − haber; tarjeta de la
-- empresa: haber − debe, o sea la deuda). Asientos vigentes que no son espejo, hasta p_to (null = todo).
create function private.acc_treasury_book_cents(p_tenant uuid, p_treasury_id uuid, p_to date default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when l.side = a.normal_side then l.amount_cents else -l.amount_cents end), 0)::bigint
    from public.acc_treasury_accounts t
    join public.acc_accounts a on a.id = t.account_id and a.tenant_id = t.tenant_id
    join public.acc_journal_lines l on l.account_id = t.account_id and l.tenant_id = t.tenant_id
    join public.acc_journal_entries e on e.id = l.entry_id
   where t.id = p_treasury_id and t.tenant_id = p_tenant
     and e.status = 'posted' and not e.is_mirror
     and (p_to is null or l.entry_date <= p_to)
$$;

-- Siguiente código libre bajo una cuenta madre (1.1.01 → 1.1.01.04). Con puntos salvo que la madre
-- no los use y ya tenga hijas sin puntos (esquema 1101 → 110104). Mira todo el plan (el código es
-- único por bar), no solo las hijas directas.
create function private.acc_next_child_code(p_tenant uuid, p_parent_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent public.acc_accounts;
  v_sep text;
  v_pattern text;
  v_max bigint;
  v_width int;
  v_next text;
begin
  select * into v_parent from public.acc_accounts a where a.id = p_parent_id and a.tenant_id = p_tenant;
  if not found then
    raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
  end if;
  v_sep := case when position('.' in v_parent.code) > 0
                  or not exists (select 1 from public.acc_accounts c
                                  where c.tenant_id = p_tenant and c.parent_id = v_parent.id
                                    and position('.' in c.code) = 0)
                then '.' else '' end;
  v_pattern := '^' || replace(v_parent.code, '.', '\.') || replace(v_sep, '.', '\.') || '([0-9]{1,6})$';
  select max((regexp_match(c.code, v_pattern))[1]::bigint), max(char_length((regexp_match(c.code, v_pattern))[1]))
    into v_max, v_width
    from public.acc_accounts c
   where c.tenant_id = p_tenant and c.code ~ v_pattern;
  v_next := (coalesce(v_max, 0) + 1)::text;
  return v_parent.code || v_sep || lpad(v_next, greatest(coalesce(v_width, 2), 2, char_length(v_next)), '0');
end;
$$;

-- Próximo vencimiento de un gasto fijo: suma la frecuencia al mes y ajusta el día al último del mes si
-- es corto (due_day 31 en febrero → 28/29).
create function private.acc_next_due(p_date date, p_frequency text, p_due_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(extract(year from b.m)::int, extract(month from b.m)::int,
                   least(p_due_day, extract(day from (b.m + interval '1 month' - interval '1 day'))::int))
    from (select date_trunc('month', p_date::timestamp)
                 + make_interval(months => case p_frequency when 'monthly' then 1 when 'bimonthly' then 2
                                                            when 'quarterly' then 3 when 'yearly' then 12 end) as m) b
$$;

-- Aplica a una fila de acc_settings los campos editables presentes en p_s (asistente y Ajustes).
-- Valida forma y rangos con claves explícitas: invalid_payload (detail = campo) e invalid_cuit.
create function private.acc_settings_apply(p_row public.acc_settings, p_s jsonb)
returns public.acc_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_j jsonb := to_jsonb(p_row);
  r record;
  v_val jsonb;
  v_txt text;
  v_int bigint;
  v_date date;
begin
  if p_s is null or jsonb_typeof(p_s) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'settings';
  end if;
  for r in select e.key, e.value from jsonb_each(p_s) e loop
    if r.key in ('legal_name', 'iibb_number', 'fiscal_address') then
      v_txt := nullif(btrim(coalesce(r.value #>> '{}', '')), '');
      if jsonb_typeof(r.value) not in ('string', 'null')
         or (r.key = 'legal_name' and (v_txt is null or char_length(v_txt) not between 2 and 160))
         or (r.key = 'iibb_number' and char_length(v_txt) > 30)
         or (r.key = 'fiscal_address' and char_length(v_txt) > 200) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := coalesce(to_jsonb(v_txt), 'null'::jsonb);
    elsif r.key = 'cuit' then
      if jsonb_typeof(r.value) not in ('string', 'null') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_txt := nullif(regexp_replace(coalesce(r.value #>> '{}', ''), '[^0-9]', '', 'g'), '');
      if (v_txt is null and nullif(btrim(coalesce(r.value #>> '{}', '')), '') is not null)
         or (v_txt is not null and not public.acc_cuit_is_valid(v_txt)) then
        raise exception 'invalid_cuit' using errcode = 'P0001';
      end if;
      v_val := coalesce(to_jsonb(v_txt), 'null'::jsonb);
    elsif r.key in ('iva_condition', 'iibb_regime', 'iva_settlement_mode', 'uninvoiced_sales_mode',
                    'closed_period_void_iva_mode') then
      v_txt := case when jsonb_typeof(r.value) = 'string' then r.value #>> '{}' end;
      if v_txt is null or not (v_txt = any (case r.key
           when 'iva_condition' then array['responsable_inscripto', 'monotributo', 'exento']
           when 'iibb_regime' then array['local', 'convenio_multilateral', 'exento', 'no_inscripto']
           when 'iva_settlement_mode' then array['on_close', 'manual']
           when 'uninvoiced_sales_mode' then array['separate_accounts', 'single_account']
           else array['adjustment_only', 'negative_row'] end)) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := to_jsonb(v_txt);
    elsif r.key in ('iibb_jurisdiction_code', 'fiscal_year_end_month', 'iva_due_day', 'iibb_due_day',
                    'vat_tolerance_cents', 'bank_tax_credit_computable_bp', 'bank_tax_debit_computable_bp',
                    'due_soon_days') then
      v_int := private.acc_to_bigint(r.value);
      if v_int is null or v_int < (case r.key when 'iibb_jurisdiction_code' then 901 when 'vat_tolerance_cents' then 0
                                             when 'bank_tax_credit_computable_bp' then 0
                                             when 'bank_tax_debit_computable_bp' then 0 else 1 end)
         or v_int > (case r.key when 'iibb_jurisdiction_code' then 924 when 'fiscal_year_end_month' then 12
                                when 'vat_tolerance_cents' then 100 when 'due_soon_days' then 30
                                when 'bank_tax_credit_computable_bp' then 10000
                                when 'bank_tax_debit_computable_bp' then 10000 else 28 end) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := to_jsonb(v_int);
    elsif r.key in ('activity_start_date', 'books_start_date') then
      if jsonb_typeof(r.value) = 'null' and r.key = 'activity_start_date' then
        v_val := 'null'::jsonb;
      else
        v_date := case when jsonb_typeof(r.value) = 'string' then private.acc_to_date(r.value #>> '{}') end;
        if v_date is null then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        v_val := to_jsonb(v_date);
      end if;
    else
      raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
    end if;
    v_j := jsonb_set(v_j, array[r.key], v_val);
  end loop;
  return jsonb_populate_record(null::public.acc_settings, v_j);
end;
$$;

-- Banco (o billetera) como partícipe: IVA de comisiones y acreditaciones. Requiere el plan sembrado.
create function private.acc_bank_party_create(p_tenant uuid, p_actor uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_payable uuid;
  v_receivable uuid;
begin
  select a.id into v_payable from public.acc_accounts a where a.tenant_id = p_tenant and a.system_key = 'payable_suppliers';
  select a.id into v_receivable from public.acc_accounts a where a.tenant_id = p_tenant and a.system_key = 'receivable_customers';
  if v_payable is null or v_receivable is null then
    raise exception 'account_not_found' using errcode = 'P0001', detail = 'payable_suppliers';
  end if;
  insert into public.acc_parties (tenant_id, kind, name, payable_account_id, receivable_account_id,
                                  commission_vat_mode, active, created_by, updated_by)
  values (p_tenant, 'bank', left(btrim(p_name), 120), v_payable, v_receivable, 'per_settlement', true, p_actor, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Valida y guarda un partícipe (reglas de acc_save_party; también new_parties de acc_post_bundle).
-- p_party: campos de acc_parties; con "id" = edición (solo si p_allow_update), sin "id" = alta.
-- Devuelve {"row": <acc_parties>, "created": bool, "fields": [campos que cambiaron]}.
create function private.acc_party_save(p_tenant uuid, p_actor uuid, p_party jsonb, p_expected timestamptz,
                                       p_allow_update boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.acc_parties;
  v_new public.acc_parties;
  v_j jsonb;
  v_created boolean;
  r record;
  v_val jsonb;
  v_txt text;
  v_int bigint;
  v_bool boolean;
  v_uuid uuid;
  v_acc public.acc_accounts;
  v_dup public.acc_parties;
  v_key text;
  v_fields jsonb;
begin
  if p_party is null or jsonb_typeof(p_party) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'party';
  end if;
  v_created := not (p_party ? 'id');
  if not v_created then
    if not p_allow_update then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'id';
    end if;
    select * into v_old from public.acc_parties p
     where p.id = private.acc_to_uuid(p_party ->> 'id') and p.tenant_id = p_tenant
       for update;
    if not found then
      raise exception 'party_not_found' using errcode = 'P0001';
    end if;
    if p_expected is null or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected) then
      raise exception 'stale' using errcode = 'P0001';
    end if;
    v_j := to_jsonb(v_old);
  else
    v_j := jsonb_build_object('id', gen_random_uuid(), 'tenant_id', p_tenant, 'kind', null, 'name', null,
             'tax_id_type', 'none', 'iva_condition', 'sin_datos', 'payment_term_days', 0,
             'commission_vat_mode', 'none', 'active', true, 'created_by', p_actor, 'created_at', now(),
             'updated_at', now());
  end if;

  for r in select e.key, e.value from jsonb_each(p_party) e loop
    continue when r.key = 'id';
    if r.key in ('kind', 'tax_id_type', 'iva_condition', 'commission_vat_mode') then
      v_txt := case when jsonb_typeof(r.value) = 'string' then r.value #>> '{}' end;
      if v_txt is null or not (v_txt = any (case r.key
           when 'kind' then array['supplier', 'customer', 'card_processor', 'payment_wallet', 'delivery_platform',
                                  'bank', 'tax_agency', 'payroll', 'partner', 'other']
           when 'tax_id_type' then array['cuit', 'cuil', 'dni', 'none']
           when 'iva_condition' then array['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final',
                                           'no_alcanzado', 'sin_datos']
           else array['per_settlement', 'monthly_invoice', 'none'] end)) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := to_jsonb(v_txt);
    elsif r.key in ('name', 'trade_name', 'email', 'phone', 'address', 'notes', 'default_voucher_type') then
      if jsonb_typeof(r.value) not in ('string', 'null') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_txt := nullif(btrim(coalesce(r.value #>> '{}', '')), '');
      if char_length(v_txt) > (case r.key when 'name' then 120 when 'trade_name' then 120 when 'phone' then 30
                                          when 'address' then 200 when 'notes' then 500 when 'email' then 254
                                          else 30 end)
         or (r.key = 'email' and v_txt !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
         or (r.key = 'default_voucher_type' and v_txt !~ '^[a-z_]{4,30}$') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := coalesce(to_jsonb(v_txt), 'null'::jsonb);
    elsif r.key = 'tax_id' then
      if jsonb_typeof(r.value) not in ('string', 'null') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_txt := nullif(regexp_replace(coalesce(r.value #>> '{}', ''), '[^0-9]', '', 'g'), '');
      if v_txt is null and nullif(btrim(coalesce(r.value #>> '{}', '')), '') is not null then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := coalesce(to_jsonb(v_txt), 'null'::jsonb);
    elsif r.key = 'payment_term_days' then
      v_int := private.acc_to_bigint(r.value);
      if v_int is null or v_int not between 0 and 365 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := to_jsonb(v_int);
    elsif r.key in ('commission_bp', 'iibb_withholding_bp', 'vat_withholding_bp', 'income_tax_withholding_bp',
                    'sircupa_bp') then
      if jsonb_typeof(r.value) = 'null' then
        v_val := 'null'::jsonb;
      else
        v_int := private.acc_to_bigint(r.value);
        if v_int is null or v_int not between 0 and 10000 then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        v_val := to_jsonb(v_int);
      end if;
    elsif r.key in ('default_account_id', 'payable_account_id', 'receivable_account_id') then
      if jsonb_typeof(r.value) = 'null' then
        v_val := 'null'::jsonb;
      else
        v_uuid := private.acc_to_uuid(r.value #>> '{}');
        if v_uuid is null then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        v_val := to_jsonb(v_uuid);
      end if;
    elsif r.key = 'active' then
      v_bool := private.acc_to_bool(r.value);
      if v_bool is null then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := to_jsonb(v_bool);
    else
      raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
    end if;
    v_j := jsonb_set(v_j, array[r.key], v_val);
  end loop;

  -- Obligatorios.
  if v_j ->> 'kind' is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
  end if;
  if char_length(coalesce(v_j ->> 'name', '')) < 2 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
  end if;

  -- Documento: CUIT/CUIL con dígito verificador, DNI de 7 u 8 dígitos, «sin documento» sin número.
  if v_j ->> 'tax_id_type' in ('cuit', 'cuil') then
    if v_j ->> 'tax_id' is null or not public.acc_cuit_is_valid(v_j ->> 'tax_id') then
      raise exception 'invalid_cuit' using errcode = 'P0001';
    end if;
  elsif v_j ->> 'tax_id_type' = 'dni' then
    if coalesce(v_j ->> 'tax_id', '') !~ '^[0-9]{7,8}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'tax_id';
    end if;
  elsif v_j ->> 'tax_id' is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'tax_id';
  end if;

  -- Partícipes de sistema: no cambian tipo ni cuentas de control.
  if not v_created and v_old.system_key is not null
     and (v_j ->> 'kind' is distinct from v_old.kind
          or (v_j ->> 'payable_account_id')::uuid is distinct from v_old.payable_account_id
          or (v_j ->> 'receivable_account_id')::uuid is distinct from v_old.receivable_account_id) then
    raise exception 'system_party_locked' using errcode = 'P0001';
  end if;

  -- Cuentas de control por defecto según el tipo de partícipe.
  if v_j ->> 'payable_account_id' is null then
    v_key := case v_j ->> 'kind' when 'payroll' then 'payroll_payable' when 'tax_agency' then 'other_taxes_payable'
                                  when 'partner' then 'partners_current' else 'payable_suppliers' end;
    select a.id into v_uuid from public.acc_accounts a where a.tenant_id = p_tenant and a.system_key = v_key;
    if v_uuid is null then
      raise exception 'account_not_found' using errcode = 'P0001', detail = v_key;
    end if;
    v_j := jsonb_set(v_j, '{payable_account_id}', to_jsonb(v_uuid));
  end if;
  if v_j ->> 'receivable_account_id' is null then
    v_key := case v_j ->> 'kind' when 'card_processor' then 'receivable_credit_cards'
                                  when 'payment_wallet' then 'receivable_wallets'
                                  when 'delivery_platform' then 'receivable_platforms'
                                  when 'partner' then 'partners_current' else 'receivable_customers' end;
    select a.id into v_uuid from public.acc_accounts a where a.tenant_id = p_tenant and a.system_key = v_key;
    if v_uuid is null then
      raise exception 'account_not_found' using errcode = 'P0001', detail = v_key;
    end if;
    v_j := jsonb_set(v_j, '{receivable_account_id}', to_jsonb(v_uuid));
  end if;

  -- Las de control tienen que pedir partícipe (requires_party), ser imputables y estar activas.
  foreach v_key in array array['payable_account_id', 'receivable_account_id'] loop
    select * into v_acc from public.acc_accounts a
     where a.id = (v_j ->> v_key)::uuid and a.tenant_id = p_tenant;
    if not found or not v_acc.requires_party or not v_acc.postable or not v_acc.active then
      raise exception 'invalid_control_account' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  -- Imputación habitual: imputable, activa, sin partícipe y que no sea de caja.
  if v_j ->> 'default_account_id' is not null then
    select * into v_acc from public.acc_accounts a
     where a.id = (v_j ->> 'default_account_id')::uuid and a.tenant_id = p_tenant;
    if not found or not v_acc.postable or not v_acc.active or v_acc.requires_party or v_acc.is_treasury then
      raise exception 'invalid_imputation_account' using errcode = 'P0001', detail = 'default_account_id';
    end if;
  end if;

  -- CUIT repetido entre los activos.
  if v_j ->> 'tax_id' is not null and (v_j ->> 'active')::boolean then
    select * into v_dup from public.acc_parties p
     where p.tenant_id = p_tenant and p.tax_id = v_j ->> 'tax_id' and p.active and p.id <> (v_j ->> 'id')::uuid
     limit 1;
    if found then
      raise exception 'duplicate_tax_id' using errcode = 'P0001',
        detail = jsonb_build_object('party_id', v_dup.id, 'name', v_dup.name)::text;
    end if;
  end if;

  -- Desactivar con medios de cobro o gastos fijos activos que lo usan.
  if not v_created and v_old.active and not (v_j ->> 'active')::boolean
     and (exists (select 1 from public.acc_sales_methods m
                   where m.tenant_id = p_tenant and m.party_id = v_old.id and m.active)
          or exists (select 1 from public.acc_recurring_expenses x
                      where x.tenant_id = p_tenant and x.party_id = v_old.id and x.active)) then
    raise exception 'party_in_use' using errcode = 'P0001';
  end if;

  v_j := jsonb_set(v_j, '{updated_by}', coalesce(to_jsonb(p_actor), 'null'::jsonb));
  v_new := jsonb_populate_record(null::public.acc_parties, v_j);
  if v_created then
    insert into public.acc_parties select v_new.* returning * into v_new;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_party) k);
  else
    update public.acc_parties p
       set kind = v_new.kind, name = v_new.name, trade_name = v_new.trade_name, tax_id_type = v_new.tax_id_type,
           tax_id = v_new.tax_id, iva_condition = v_new.iva_condition, email = v_new.email, phone = v_new.phone,
           address = v_new.address, payment_term_days = v_new.payment_term_days,
           default_account_id = v_new.default_account_id, default_voucher_type = v_new.default_voucher_type,
           payable_account_id = v_new.payable_account_id, receivable_account_id = v_new.receivable_account_id,
           commission_vat_mode = v_new.commission_vat_mode, commission_bp = v_new.commission_bp,
           iibb_withholding_bp = v_new.iibb_withholding_bp, vat_withholding_bp = v_new.vat_withholding_bp,
           income_tax_withholding_bp = v_new.income_tax_withholding_bp, sircupa_bp = v_new.sircupa_bp,
           notes = v_new.notes, active = v_new.active, updated_by = p_actor
     where p.id = v_old.id and p.tenant_id = p_tenant
     returning * into v_new;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;
  return jsonb_build_object('row', to_jsonb(v_new), 'created', v_created, 'fields', v_fields);
end;
$$;

-- Crea una caja con su cuenta contable: activo bajo el grupo de «Caja y bancos» (1.1.01) o, si es la
-- tarjeta de la empresa, pasivo bajo «Deudas comerciales» (2.1.01). El grupo se toma de una caja que ya
-- existe del mismo lado (el plan es editable); si no hay, del plan estándar. Valida nombre y tipo.
-- p_create_bank_party: además crea el banco como partícipe (el asistente lo delega en acc_seed_defaults).
create function private.acc_treasury_create(p_tenant uuid, p_actor uuid, p_t jsonb, p_sort int,
                                            p_create_bank_party boolean)
returns public.acc_treasury_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_kind text;
  v_bank_name text;
  v_cbu text;
  v_alias text;
  v_number text;
  v_allow_negative boolean;
  v_parent public.acc_accounts;
  v_account_id uuid;
  v_row public.acc_treasury_accounts;
begin
  if p_t is null or jsonb_typeof(p_t) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury';
  end if;
  v_name := btrim(coalesce(p_t ->> 'name', ''));
  if char_length(v_name) not between 2 and 60 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'name';
  end if;
  if exists (select 1 from public.acc_treasury_accounts t where t.tenant_id = p_tenant and lower(t.name) = lower(v_name)) then
    raise exception 'treasury_name_taken' using errcode = 'P0001', detail = v_name;
  end if;
  v_kind := p_t ->> 'kind';
  if v_kind is null or v_kind not in ('cash', 'bank', 'wallet', 'credit_card', 'other') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
  end if;
  v_bank_name := nullif(btrim(coalesce(p_t ->> 'bank_name', '')), '');
  v_cbu := nullif(regexp_replace(coalesce(p_t ->> 'cbu_cvu', ''), '\s', '', 'g'), '');
  v_alias := nullif(btrim(coalesce(p_t ->> 'alias', '')), '');
  v_number := nullif(btrim(coalesce(p_t ->> 'account_number', '')), '');
  if char_length(v_bank_name) > 80 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'bank_name';
  end if;
  if v_cbu !~ '^[0-9]{22}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cbu_cvu';
  end if;
  if v_alias !~ '^[A-Za-z0-9.\-]{6,20}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'alias';
  end if;
  if char_length(v_number) > 40 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'account_number';
  end if;
  v_allow_negative := coalesce(private.acc_to_bool(p_t -> 'allow_negative'), false);

  -- Grupo de la cuenta.
  select pa.* into v_parent
    from public.acc_treasury_accounts t
    join public.acc_accounts a on a.id = t.account_id and a.tenant_id = t.tenant_id
    join public.acc_accounts pa on pa.id = a.parent_id and pa.tenant_id = a.tenant_id
   where t.tenant_id = p_tenant and (t.kind = 'credit_card') = (v_kind = 'credit_card')
   order by t.sort, t.created_at
   limit 1;
  if v_parent.id is null then
    if v_kind = 'credit_card' then
      select pa.* into v_parent
        from public.acc_accounts a
        join public.acc_accounts pa on pa.id = a.parent_id and pa.tenant_id = a.tenant_id
       where a.tenant_id = p_tenant and a.system_key = 'payable_suppliers';
    else
      select a.* into v_parent from public.acc_accounts a
       where a.tenant_id = p_tenant and a.code = '1.1.01' and not a.postable;
    end if;
  end if;
  if v_parent.id is null or v_parent.postable then
    raise exception 'treasury_account_invalid' using errcode = 'P0001';
  end if;

  insert into public.acc_accounts (tenant_id, code, name, type, normal_side, parent_id, postable, is_treasury,
                                   requires_party, purchase_selectable, manual_selectable, created_by, updated_by)
  values (p_tenant, private.acc_next_child_code(p_tenant, v_parent.id), v_name, v_parent.type,
          case when v_kind = 'credit_card' then 'credit' else 'debit' end::public.acc_side, v_parent.id, true, true,
          false, false, true, p_actor, p_actor)
  returning id into v_account_id;

  insert into public.acc_treasury_accounts (tenant_id, account_id, name, kind, bank_name, cbu_cvu, alias, account_number,
                                            allow_negative, sort, created_by, updated_by)
  values (p_tenant, v_account_id, v_name, v_kind, v_bank_name, v_cbu, v_alias, v_number, v_allow_negative,
          coalesce(p_sort, 0), p_actor, p_actor)
  returning * into v_row;

  if p_create_bank_party then
    update public.acc_treasury_accounts t
       set bank_party_id = private.acc_bank_party_create(p_tenant, p_actor, coalesce(v_bank_name, v_name))
     where t.id = v_row.id
     returning * into v_row;
  end if;
  return v_row;
end;
$$;

comment on function private.acc_treasury_book_cents(uuid, uuid, date) is
  'Saldo de libro de una caja en el lado normal de su cuenta (activo: debe − haber; tarjeta: haber − debe), sin espejos, hasta p_to.';
comment on function private.acc_next_child_code(uuid, uuid) is
  'Siguiente código libre bajo una cuenta madre (1.1.01 → 1.1.01.04).';
comment on function private.acc_party_save(uuid, uuid, jsonb, timestamptz, boolean) is
  'Reglas de acc_save_party (también para new_parties de acc_post_bundle). Devuelve {row, created, fields}.';
comment on function private.acc_treasury_create(uuid, uuid, jsonb, int, boolean) is
  'Crea una caja con su cuenta contable (activo bajo 1.1.01; tarjeta de la empresa: pasivo bajo 2.1.01).';

-- Permisos de las funciones de esta parte
revoke all on function private.acc_to_uuid(text) from public, anon, authenticated;
revoke all on function private.acc_to_date(text) from public, anon, authenticated;
revoke all on function private.acc_to_bigint(jsonb) from public, anon, authenticated;
revoke all on function private.acc_to_bool(jsonb) from public, anon, authenticated;
revoke all on function private.acc_treasury_book_cents(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.acc_next_child_code(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_next_due(date, text, int) from public, anon, authenticated;
revoke all on function private.acc_settings_apply(public.acc_settings, jsonb) from public, anon, authenticated;
revoke all on function private.acc_bank_party_create(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.acc_party_save(uuid, uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;
revoke all on function private.acc_treasury_create(uuid, uuid, jsonb, int, boolean) from public, anon, authenticated;
