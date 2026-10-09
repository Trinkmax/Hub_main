-- Parte 2 de 2 de los pedidos de los socios del 09/10/2026 (la parte 1 trae las columnas, el trigger de
-- cuotas, acc_party_open_cents y acc_party_save): alta y edición de gastos fijos con cuotas, detalle y
-- eliminados; borrar un proveedor; cargar listas de proveedores y de gastos fijos; eliminar un gasto fijo.
-- ─── 5. Alta y edición de gastos fijos (misma firma; + cuotas, detalle y eliminados) ─
create or replace function public.acc_save_recurring_expense(p_tenant_id uuid, p_expense jsonb, p_expected_updated_at timestamptz)
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
  v_elem jsonb;
  v_list jsonb;
  v_sum bigint;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_expense is null or jsonb_typeof(p_expense) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'expense';
  end if;
  for v_key in select jsonb_object_keys(p_expense) loop
    if v_key not in ('id', 'name', 'party_id', 'account_id', 'voucher_type', 'vat_rate_bp', 'amount_cents', 'frequency',
                     'due_day', 'next_due_date', 'remind_days_before', 'treasury_account_id', 'active', 'notes',
                     'ends_on', 'breakdown') then
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
    -- Uno eliminado (archivado con historia) ya no se edita.
    if not found or v_old.archived_at is not null then
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
                where x.tenant_id = p_tenant_id and lower(x.name) = lower(v_txt) and x.id <> v_row.id
                  and x.archived_at is null) then
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

  -- En cuotas: el último vencimiento. Pasado ese mes se apaga solo (trigger acc_recurring_expenses_auto_end).
  if p_expense ? 'ends_on' then
    if jsonb_typeof(p_expense -> 'ends_on') = 'null' then
      v_row.ends_on := null;
    else
      v_date := private.acc_to_date(p_expense ->> 'ends_on');
      if v_date is null then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'ends_on';
      end if;
      v_row.ends_on := v_date;
    end if;
  end if;
  -- El detalle (por ejemplo los sueldos, por empleado y concepto): el monto pasa a ser la suma.
  if p_expense ? 'breakdown' then
    if jsonb_typeof(p_expense -> 'breakdown') <> 'array' or jsonb_array_length(p_expense -> 'breakdown') > 200 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'breakdown';
    end if;
    v_list := '[]'::jsonb;
    for v_elem in select e from jsonb_array_elements(p_expense -> 'breakdown') e loop
      if jsonb_typeof(v_elem) <> 'object'
         or (select count(*) from jsonb_object_keys(v_elem) k where k not in ('label', 'kind', 'amount_cents')) > 0
         or jsonb_typeof(v_elem -> 'label') is distinct from 'string'
         or jsonb_typeof(coalesce(v_elem -> 'kind', 'null'::jsonb)) not in ('string', 'null') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'breakdown';
      end if;
      v_txt := btrim(v_elem ->> 'label');
      v_int := private.acc_to_bigint(v_elem -> 'amount_cents');
      if char_length(v_txt) not between 1 and 60 or v_int is null or v_int < 1 or v_int > 999999999999
         or (v_elem ->> 'kind' is not null and v_elem ->> 'kind' not in ('aporte', 'contribucion', 'blanco', 'negro')) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'breakdown';
      end if;
      v_list := v_list || jsonb_build_array(jsonb_build_object('label', v_txt, 'kind', v_elem ->> 'kind',
                                                               'amount_cents', v_int));
    end loop;
    v_row.breakdown := v_list;
  end if;
  if jsonb_array_length(coalesce(v_row.breakdown, '[]'::jsonb)) > 0 then
    select sum((e ->> 'amount_cents')::bigint) into v_sum from jsonb_array_elements(v_row.breakdown) e;
    if v_sum > 999999999999 then
      raise exception 'amount_too_large' using errcode = 'P0001';
    end if;
    v_row.amount_cents := v_sum;
  end if;

  if v_created then
    insert into public.acc_recurring_expenses (id, tenant_id, name, party_id, account_id, voucher_type, vat_rate_bp,
                                               amount_cents, frequency, due_day, next_due_date, remind_days_before,
                                               treasury_account_id, active, notes, ends_on, breakdown, created_by,
                                               updated_by)
    values (v_row.id, p_tenant_id, v_row.name, v_row.party_id, v_row.account_id, v_row.voucher_type, v_row.vat_rate_bp,
            v_row.amount_cents, v_row.frequency, v_row.due_day, v_row.next_due_date, v_row.remind_days_before,
            v_row.treasury_account_id, v_row.active, v_row.notes, v_row.ends_on, coalesce(v_row.breakdown, '[]'::jsonb),
            v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_expense) k);
  else
    update public.acc_recurring_expenses x
       set name = v_row.name, party_id = v_row.party_id, account_id = v_row.account_id,
           voucher_type = v_row.voucher_type, vat_rate_bp = v_row.vat_rate_bp, amount_cents = v_row.amount_cents,
           frequency = v_row.frequency, due_day = v_row.due_day, next_due_date = v_row.next_due_date,
           remind_days_before = v_row.remind_days_before, treasury_account_id = v_row.treasury_account_id,
           active = v_row.active, notes = v_row.notes, ends_on = v_row.ends_on, breakdown = v_row.breakdown,
           updated_by = v_uid
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

-- ─── 6. Borrar un proveedor o cliente ────────────────────────────────────────
-- Solo con la cuenta corriente en cero y sin movimientos: el que ya tiene comprobantes queda para la historia
-- (party_has_history) y se desactiva. Los de sistema no se borran.
create function public.acc_delete_party(p_tenant_id uuid, p_party_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_parties;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_row from public.acc_parties p
   where p.id = p_party_id and p.tenant_id = p_tenant_id
     for update;
  if not found then
    raise exception 'party_not_found' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is null
     or date_trunc('milliseconds', v_row.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if v_row.system_key is not null then
    raise exception 'system_party_locked' using errcode = 'P0001';
  end if;
  if private.acc_party_open_cents(p_tenant_id, v_row.id) > 0 then
    raise exception 'party_has_balance' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_documents d where d.tenant_id = p_tenant_id and d.party_id = v_row.id)
     or exists (select 1 from public.acc_journal_lines l where l.tenant_id = p_tenant_id and l.party_id = v_row.id) then
    raise exception 'party_has_history' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_sales_methods m where m.tenant_id = p_tenant_id and m.party_id = v_row.id)
     or exists (select 1 from public.acc_recurring_expenses x
                 where x.tenant_id = p_tenant_id and x.party_id = v_row.id and x.archived_at is null) then
    raise exception 'party_in_use' using errcode = 'P0001';
  end if;
  -- Un gasto fijo eliminado (archivado) que lo nombraba no lo retiene.
  update public.acc_recurring_expenses x set party_id = null
   where x.tenant_id = p_tenant_id and x.party_id = v_row.id and x.archived_at is not null;
  begin
    delete from public.acc_parties p where p.id = v_row.id and p.tenant_id = p_tenant_id;
  exception when foreign_key_violation then
    -- Lo nombra algo más (una importación, una caja): queda para la historia.
    raise exception 'party_has_history' using errcode = 'P0001';
  end;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_party.deleted', 'acc_party', v_row.id,
    jsonb_build_object('kind', v_row.kind));
  return jsonb_build_object('id', v_row.id, 'deleted', true);
end;
$$;

-- ─── 7. Cargar una lista de proveedores (o clientes) de una vez ──────────────
-- p_names: hasta 300 nombres. Los que ya existen con ese tipo (sin mayúsculas ni espacios de más) o se
-- repiten en la lista se saltean y vuelven en skipped. Cada alta pasa por las reglas de acc_save_party.
create function public.acc_create_parties_bulk(p_tenant_id uuid, p_kind text, p_names jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_key text;
  v_seen text[] := '{}';
  v_created int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_kind is null or p_kind not in ('supplier', 'customer') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'kind';
  end if;
  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) not between 1 and 300
     or exists (select 1 from jsonb_array_elements(p_names) e where jsonb_typeof(e) <> 'string') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'names';
  end if;
  for v_name in select regexp_replace(btrim(e), '\s+', ' ', 'g') from jsonb_array_elements_text(p_names) e loop
    continue when v_name = '';
    if char_length(v_name) not between 2 and 120 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'names';
    end if;
    v_key := lower(v_name);
    if v_key = any (v_seen)
       or exists (select 1 from public.acc_parties p
                   where p.tenant_id = p_tenant_id and p.kind = p_kind
                     and lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) = v_key) then
      v_skipped := v_skipped || to_jsonb(v_name);
      continue;
    end if;
    v_seen := v_seen || v_key;
    perform private.acc_party_save(p_tenant_id, v_uid, jsonb_build_object('kind', p_kind, 'name', v_name), null, false);
    v_created := v_created + 1;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_party.bulk_created', 'acc_party', null,
    jsonb_build_object('kind', p_kind, 'created', v_created, 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ─── 8. Cargar una lista de gastos fijos de una vez ──────────────────────────
-- p_items: hasta 100 {name, account_id, due_day, next_due_date, …} con las claves de
-- acc_save_recurring_expense. Los que ya existen (o se repiten) se saltean y vuelven en skipped.
create function public.acc_create_recurring_bulk(p_tenant_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_name text;
  v_seen text[] := '{}';
  v_created int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
  end if;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' or v_item ? 'id' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
    end if;
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    if lower(v_name) = any (v_seen)
       or exists (select 1 from public.acc_recurring_expenses x
                   where x.tenant_id = p_tenant_id and lower(x.name) = lower(v_name) and x.archived_at is null) then
      v_skipped := v_skipped || to_jsonb(v_name);
      continue;
    end if;
    v_seen := v_seen || lower(v_name);
    perform public.acc_save_recurring_expense(p_tenant_id, v_item, null);
    v_created := v_created + 1;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.bulk_created', 'acc_recurring', null,
    jsonb_build_object('created', v_created, 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ─── 9. Eliminar un gasto fijo ───────────────────────────────────────────────
-- Sin comprobantes cargados se borra; con comprobantes queda archivado (sale de la lista, la historia queda).
create function public.acc_delete_recurring_expense(p_tenant_id uuid, p_id uuid, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_recurring_expenses;
  v_result text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_row from public.acc_recurring_expenses x
   where x.id = p_id and x.tenant_id = p_tenant_id
     for update;
  if not found or v_row.archived_at is not null then
    raise exception 'recurring_not_found' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is null
     or date_trunc('milliseconds', v_row.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_documents d
              where d.tenant_id = p_tenant_id and d.recurring_expense_id = v_row.id) then
    update public.acc_recurring_expenses x
       set archived_at = now(), active = false, updated_by = v_uid
     where x.id = v_row.id and x.tenant_id = p_tenant_id;
    v_result := 'archived';
  else
    delete from public.acc_recurring_expenses x where x.id = v_row.id and x.tenant_id = p_tenant_id;
    v_result := 'deleted';
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.deleted', 'acc_recurring', v_row.id,
    jsonb_build_object('result', v_result));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'result', v_result);
end;
$$;

-- ─── 10. Comentarios y permisos ──────────────────────────────────────────────
comment on function public.acc_delete_party(uuid, uuid, timestamptz) is
  'Borra un proveedor o cliente sin saldo y sin movimientos (party_has_balance / party_has_history / party_in_use).';
comment on function public.acc_create_parties_bulk(uuid, text, jsonb) is
  'Alta de una lista de proveedores o clientes por nombre. Devuelve {created, skipped[]}.';
comment on function public.acc_create_recurring_bulk(uuid, jsonb) is
  'Alta de una lista de gastos fijos con las reglas de acc_save_recurring_expense. Devuelve {created, skipped[]}.';
comment on function public.acc_delete_recurring_expense(uuid, uuid, timestamptz) is
  'Elimina un gasto fijo: lo borra si no tiene comprobantes; si tiene, lo archiva. Devuelve {id, name, result}.';

revoke all on function public.acc_delete_party(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.acc_delete_party(uuid, uuid, timestamptz) to authenticated;
revoke all on function public.acc_create_parties_bulk(uuid, text, jsonb) from public, anon;
grant execute on function public.acc_create_parties_bulk(uuid, text, jsonb) to authenticated;
revoke all on function public.acc_create_recurring_bulk(uuid, jsonb) from public, anon;
grant execute on function public.acc_create_recurring_bulk(uuid, jsonb) to authenticated;
revoke all on function public.acc_delete_recurring_expense(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.acc_delete_recurring_expense(uuid, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
