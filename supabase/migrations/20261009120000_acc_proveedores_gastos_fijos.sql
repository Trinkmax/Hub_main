-- Proveedores y gastos fijos: lo que pidieron los socios de HUB el 09/10/2026.
--   · Ficha del proveedor: contactos, días de entrega y anticipación del pedido (acc_parties).
--   · Un proveedor se desactiva o se borra solo con la cuenta corriente en cero. Borrar es para el que no
--     tiene movimientos; el que tiene historia se desactiva.
--   · Cargar una lista de proveedores o de gastos fijos de una vez.
--   · Gastos fijos en cuotas (ends_on, el último vencimiento: pasado ese mes se apagan solos), con detalle
--     (breakdown: por ejemplo los sueldos, por empleado y concepto; el monto es la suma) y que se puedan
--     eliminar (archived_at: si ya se cargó alguno, queda guardado para la historia pero sale de la lista).
-- Todo aditivo: columnas con default, las dos funciones que cambian conservan su firma (create or replace)
-- y el resto son RPC nuevas. Parte 1 de 2: columnas, el trigger de cuotas, acc_party_open_cents y
-- acc_party_save; la parte 2 (20261009120010) trae las RPC.

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.acc_parties
  add column contacts jsonb not null default '[]'::jsonb,
  add column delivery_days smallint[] not null default '{}'::smallint[],
  add column order_lead_days smallint;
alter table public.acc_parties
  add constraint apt_contacts check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 10),
  add constraint apt_delivery_days check (delivery_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  add constraint apt_order_lead check (order_lead_days is null or order_lead_days between 0 and 30);
comment on column public.acc_parties.contacts is
  'Contactos [{name, role, phone, email}] (hasta 10). role es libre: «Ventas», «Facturación», «Reparto».';
comment on column public.acc_parties.delivery_days is 'Días en que entrega: 1 = lunes … 7 = domingo.';
comment on column public.acc_parties.order_lead_days is 'Con cuántos días de anticipación hay que pedirle (0 = el mismo día).';

alter table public.acc_recurring_expenses
  add column ends_on date,
  add column breakdown jsonb not null default '[]'::jsonb,
  add column archived_at timestamptz;
alter table public.acc_recurring_expenses
  add constraint arx_breakdown check (jsonb_typeof(breakdown) = 'array' and jsonb_array_length(breakdown) <= 200);
-- El nombre se repite solo con uno eliminado (archivado): «reemplazar» un gasto fijo por otro igual.
alter table public.acc_recurring_expenses drop constraint arx_name_uq;
create unique index arx_name_live_uq on public.acc_recurring_expenses (tenant_id, lower(name))
  where archived_at is null;
comment on column public.acc_recurring_expenses.ends_on is
  'En cuotas: el último vencimiento. Cuando next_due_date pasa ese mes, el gasto fijo se apaga solo.';
comment on column public.acc_recurring_expenses.breakdown is
  'Detalle [{label, kind, amount_cents}]; kind: aporte | contribucion | blanco | negro | null. Si hay detalle, amount_cents es la suma.';
comment on column public.acc_recurring_expenses.archived_at is
  'Eliminado con historia (ya tenía comprobantes): no se lista ni se edita, queda para los comprobantes.';

-- ─── 2. Un gasto fijo eliminado o con la última cuota pasada no queda activo ─
create function private.acc_recurring_auto_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null
     or (new.ends_on is not null and date_trunc('month', new.next_due_date) > date_trunc('month', new.ends_on)) then
    new.active := false;
  end if;
  return new;
end;
$$;

create trigger acc_recurring_expenses_auto_end before insert or update on public.acc_recurring_expenses
  for each row execute function private.acc_recurring_auto_end();

-- ─── 3. Lo abierto de un partícipe (deuda + a favor sin aplicar) ─────────────
-- Las mismas reglas que acc_report_party_balances: asientos registrados, sin espejos, sin el IVA crédito a
-- documentar, menos lo aplicado con imputaciones vigentes. 0 = cuenta corriente en cero.
create function private.acc_party_open_cents(p_tenant uuid, p_party uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with li as (
    select l.id, l.amount_cents
      from public.acc_journal_lines l
      join public.acc_journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
      join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant and l.party_id = p_party
       and e.status = 'posted' and not e.is_mirror
       and a.system_key is distinct from 'vat_credit_pending'),
  ar as (
    select al.debit_line_id, al.credit_line_id, al.amount_cents
      from public.acc_allocations al
      join public.acc_journal_lines dl on dl.id = al.debit_line_id
      join public.acc_journal_entries de on de.id = dl.entry_id and de.status = 'posted'
      join public.acc_journal_lines cl on cl.id = al.credit_line_id
      join public.acc_journal_entries ce on ce.id = cl.entry_id and ce.status = 'posted'
     where al.tenant_id = p_tenant and al.party_id = p_party and al.voided_on is null),
  ap as (
    select x.line_id, sum(x.amount_cents)::bigint as applied
      from (select ar.debit_line_id as line_id, ar.amount_cents from ar
            union all
            select ar.credit_line_id, ar.amount_cents from ar) x
     group by x.line_id)
  select coalesce(sum(greatest(li.amount_cents - coalesce(ap.applied, 0), 0)), 0)::bigint
    from li left join ap on ap.line_id = li.id
$$;

-- ─── 4. Alta y edición de partícipes (misma firma; + contactos, entrega, anticipación y saldo en cero) ─
create or replace function private.acc_party_save(p_tenant uuid, p_actor uuid, p_party jsonb, p_expected timestamptz,
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
  v_elem jsonb;
  v_contact jsonb;
  v_list jsonb;
  v_ck text;
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
             'updated_at', now(), 'contacts', '[]'::jsonb, 'delivery_days', '[]'::jsonb);
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
    elsif r.key = 'contacts' then
      -- Hasta 10 contactos {name, role, phone, email}; los vacíos se descartan.
      if jsonb_typeof(r.value) <> 'array' or jsonb_array_length(r.value) > 10 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_list := '[]'::jsonb;
      for v_elem in select e from jsonb_array_elements(r.value) e loop
        if jsonb_typeof(v_elem) <> 'object' then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        v_contact := '{}'::jsonb;
        foreach v_ck in array array['name', 'role', 'phone', 'email'] loop
          if v_elem ? v_ck and jsonb_typeof(v_elem -> v_ck) not in ('string', 'null') then
            raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
          end if;
          v_txt := nullif(btrim(coalesce(v_elem ->> v_ck, '')), '');
          if char_length(v_txt) > (case v_ck when 'name' then 60 when 'role' then 40 when 'phone' then 30 else 254 end)
             or (v_ck = 'email' and v_txt !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
            raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
          end if;
          v_contact := v_contact || jsonb_build_object(v_ck, v_txt);
        end loop;
        if (select count(*) from jsonb_object_keys(v_elem) k where k not in ('name', 'role', 'phone', 'email')) > 0 then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        continue when v_contact ->> 'name' is null and v_contact ->> 'phone' is null and v_contact ->> 'email' is null;
        v_list := v_list || jsonb_build_array(v_contact);
      end loop;
      v_val := v_list;
    elsif r.key = 'delivery_days' then
      -- Días de la semana en que entrega, 1 = lunes … 7 = domingo; se guardan ordenados y sin repetir.
      if jsonb_typeof(r.value) <> 'array' or jsonb_array_length(r.value) > 7
         or exists (select 1 from jsonb_array_elements(r.value) e
                     where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-7]$') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
      end if;
      v_val := (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct (e #>> '{}')::int as d from jsonb_array_elements(r.value) e) x);
    elsif r.key = 'order_lead_days' then
      -- Con cuántos días de anticipación hay que pedirle (0 = el mismo día); null = no se sabe.
      if jsonb_typeof(r.value) = 'null' then
        v_val := 'null'::jsonb;
      else
        v_int := private.acc_to_bigint(r.value);
        if v_int is null or v_int not between 0 and 30 then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
        end if;
        v_val := to_jsonb(v_int);
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
  -- Pedido de los socios (09/10/2026): se desactiva solo con la cuenta corriente en cero.
  if not v_created and v_old.active and not (v_j ->> 'active')::boolean
     and private.acc_party_open_cents(p_tenant, v_old.id) > 0 then
    raise exception 'party_has_balance' using errcode = 'P0001';
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
           notes = v_new.notes, active = v_new.active, contacts = v_new.contacts,
           delivery_days = v_new.delivery_days, order_lead_days = v_new.order_lead_days, updated_by = p_actor
     where p.id = v_old.id and p.tenant_id = p_tenant
     returning * into v_new;
    v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                   from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                  where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  end if;
  return jsonb_build_object('row', to_jsonb(v_new), 'created', v_created, 'fields', v_fields);
end;
$$;

comment on function private.acc_party_open_cents(uuid, uuid) is
  'Σ abierto de un partícipe (deuda + a favor sin aplicar), con las reglas de acc_report_party_balances. 0 = cuenta corriente en cero.';
revoke all on function private.acc_recurring_auto_end() from public, anon, authenticated;
revoke all on function private.acc_party_open_cents(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
