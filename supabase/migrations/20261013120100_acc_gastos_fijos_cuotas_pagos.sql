-- Reunión con los socios del 12/10/2026 · «Gastos fijos como en la planilla»: qué cuota es, si está pago,
-- cuánto falta y qué está vencido.
--   · installments_total: de cuántas cuotas es (hasta hoy solo se guardaba el último vencimiento, ends_on:
--     se podía decir «quedan 3» pero no «cuota 2 de 6»).
--   · skipped_due: el último vencimiento que se salteó con «Saltear». Sin esto la lista decía «Salteado» de
--     todo gasto fijo recién creado con el primer vencimiento el mes que viene (nadie lo había salteado).
--   · loaded_due: el vencimiento que cubrió el último comprobante cargado. Lo anota un trigger cuando el
--     motor de comprobantes avanza el vencimiento (el motor no se toca). Sin esto había que adivinarlo por
--     la fecha del comprobante, y una factura con fecha de antes quedaba como si no se hubiera cargado.
--   · acc_report_recurring_status: por gasto fijo, el último comprobante cargado con lo pagado y lo que
--     falta, y lo que quedó sin pagar de comprobantes anteriores. Solo lectura.
-- Todo aditivo: tres columnas que aceptan null, un trigger nuevo y dos funciones que conservan su firma (create
-- or replace con el cuerpo vigente: acc_save_recurring_expense de 20261009120010 y acc_skip_recurring_due de
-- 20261007120720).

-- ─── 1. Columnas ─────────────────────────────────────────────────────────────
alter table public.acc_recurring_expenses
  add column if not exists installments_total smallint,
  add column if not exists skipped_due date,
  add column if not exists loaded_due date;
alter table public.acc_recurring_expenses drop constraint if exists arx_installments_total;
alter table public.acc_recurring_expenses
  add constraint arx_installments_total check (installments_total is null or installments_total between 1 and 120);
comment on column public.acc_recurring_expenses.installments_total is
  'En cuotas: de cuántas es (1 a 120; null = no se sabe o no termina). La cuota actual sale de ends_on: total − las que faltan + 1.';
comment on column public.acc_recurring_expenses.skipped_due is
  'El último vencimiento salteado con «Saltear» (acc_skip_recurring_due). Se borra si el próximo vencimiento vuelve a ese día o antes.';
comment on column public.acc_recurring_expenses.loaded_due is
  'El vencimiento que cubrió last_document_id (lo anota el trigger acc_recurring_expenses_loaded_due al cargarse el comprobante).';

-- El vencimiento que cubre el último comprobante. El motor (private.acc_write_document) pone last_document_id y
-- avanza next_due_date en el mismo update: el que estaba como próximo es el que se cargó. «Corregir» cambia el
-- comprobante sin avanzar el vencimiento: sigue cubriendo el mismo.
create or replace function private.acc_recurring_loaded_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_document_id is null then
    new.loaded_due := null;
  elsif new.next_due_date is distinct from old.next_due_date then
    new.loaded_due := old.next_due_date;
  end if;
  return new;
end;
$$;

drop trigger if exists acc_recurring_expenses_loaded_due on public.acc_recurring_expenses;
create trigger acc_recurring_expenses_loaded_due
  before update of last_document_id on public.acc_recurring_expenses
  for each row when (new.last_document_id is distinct from old.last_document_id)
  execute function private.acc_recurring_loaded_due();

-- Los que ya tenían un comprobante cargado: cubrió el vencimiento anterior al próximo (el día ajustado al
-- mes corto, como private.acc_next_due).
update public.acc_recurring_expenses x
   set loaded_due = (
         select make_date(extract(year from b.m)::int, extract(month from b.m)::int,
                          least(x.due_day, extract(day from (b.m + interval '1 month' - interval '1 day'))::int))
           from (select date_trunc('month', x.next_due_date::timestamp)
                        - make_interval(months => case x.frequency when 'monthly' then 1 when 'bimonthly' then 2
                                                                   when 'quarterly' then 3 else 12 end) as m) b)
 where x.last_document_id is not null and x.loaded_due is null;

-- ─── 2. Alta y edición de gastos fijos (misma firma; + installments_total y skipped_due) ─
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
                     'ends_on', 'breakdown', 'installments_total') then
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
  -- En cuotas: de cuántas es (opcional). Sin último vencimiento no hay total que valga.
  if p_expense ? 'installments_total' then
    v_int := private.acc_to_bigint(p_expense -> 'installments_total');
    if jsonb_typeof(p_expense -> 'installments_total') <> 'null' and (v_int is null or v_int not between 1 and 120) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'installments_total';
    end if;
    v_row.installments_total := v_int;
  end if;
  if v_row.ends_on is null then
    v_row.installments_total := null;
  end if;
  -- Si el próximo vencimiento vuelve al que se había salteado (o antes), ya no está salteado («Deshacer»).
  if v_row.skipped_due is not null and v_row.next_due_date <= v_row.skipped_due then
    v_row.skipped_due := null;
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
                                               treasury_account_id, active, notes, ends_on, breakdown,
                                               installments_total, created_by, updated_by)
    values (v_row.id, p_tenant_id, v_row.name, v_row.party_id, v_row.account_id, v_row.voucher_type, v_row.vat_rate_bp,
            v_row.amount_cents, v_row.frequency, v_row.due_day, v_row.next_due_date, v_row.remind_days_before,
            v_row.treasury_account_id, v_row.active, v_row.notes, v_row.ends_on, coalesce(v_row.breakdown, '[]'::jsonb),
            v_row.installments_total, v_uid, v_uid)
    returning * into v_row;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_expense) k);
  else
    update public.acc_recurring_expenses x
       set name = v_row.name, party_id = v_row.party_id, account_id = v_row.account_id,
           voucher_type = v_row.voucher_type, vat_rate_bp = v_row.vat_rate_bp, amount_cents = v_row.amount_cents,
           frequency = v_row.frequency, due_day = v_row.due_day, next_due_date = v_row.next_due_date,
           remind_days_before = v_row.remind_days_before, treasury_account_id = v_row.treasury_account_id,
           active = v_row.active, notes = v_row.notes, ends_on = v_row.ends_on, breakdown = v_row.breakdown,
           installments_total = v_row.installments_total, skipped_due = v_row.skipped_due,
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

-- ─── 3. «Saltear» (misma firma; + deja anotado cuál se salteó) ───────────────
-- Avanza el vencimiento sin cargar el comprobante. p_due_date = el que vio el usuario.
create or replace function public.acc_skip_recurring_due(p_tenant_id uuid, p_id uuid, p_due_date date)
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
     set next_due_date = private.acc_next_due(v_row.next_due_date, v_row.frequency, v_row.due_day),
         skipped_due = v_prev, updated_by = v_uid
   where x.id = v_row.id
   returning * into v_row;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.skipped', 'acc_recurring', v_row.id,
    jsonb_build_object('due_date', v_prev, 'next_due_date', v_row.next_due_date));
  return to_jsonb(v_row);
end;
$$;

-- ─── 4. Qué se pagó del último comprobante de cada gasto fijo ────────────────
-- Una fila por gasto fijo sin eliminar (activo, pausado o terminado). La pantalla decide si ese comprobante
-- es el del vencimiento de este mes (compras/_lib/recurring-status.ts); acá van solo los hechos:
--   document_*, accounting_date, due_date, total_cents · el último comprobante cargado (last_document_id),
--                      si sigue vigente; null si no hay o se anuló.
--   paid_cents       · lo pagado de ese comprobante. Un gasto de contado (expense) está pago al cargarlo. Una
--                      factura o nota de débito en cuenta corriente: su partida menos lo que le falta.
--   open_cents       · lo que le falta (0 en un gasto de contado).
--   prior_open_cents · lo que falta de los comprobantes anteriores de ese gasto fijo.
-- «Lo que falta» es la regla de siempre: la partida del comprobante (el renglón 'control', como en el
-- subdiario de compras, acc_report_subledger_purchases) y su abierto con acc_open_amount (las imputaciones
-- sin desaplicar). Por eso una nota de crédito aplicada cuenta como pago, igual que en Comprobantes.
-- Definer de solo lectura: acc_assert_reader primero y filtro explícito por p_tenant_id en cada tabla.
create or replace function public.acc_report_recurring_status(p_tenant_id uuid)
returns table (recurring_expense_id uuid, document_id uuid, document_kind text, accounting_date date,
               due_date date, total_cents bigint, paid_cents bigint, open_cents bigint, prior_open_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  return query
  with rx as (
    select x.id, x.last_document_id
      from public.acc_recurring_expenses x
     where x.tenant_id = p_tenant_id and x.archived_at is null
  ), dd as (
    -- Los comprobantes vigentes de cada gasto fijo, con su partida y lo que le falta.
    select d.id, d.recurring_expense_id as rx_id, d.kind, d.accounting_date, d.due_date, d.total_cents,
           c.amt, c.open
      from public.acc_documents d
      join rx on rx.id = d.recurring_expense_id
      left join lateral (
        select sum(jl.amount_cents)::bigint as amt,
               sum(greatest(public.acc_open_amount(jl.id), 0))::bigint as open
          from public.acc_journal_lines jl
          join public.acc_document_lines dl
            on dl.id = jl.document_line_id and dl.tenant_id = p_tenant_id and dl.role = 'control'
         where jl.document_id = d.id and jl.tenant_id = p_tenant_id) c
        on d.kind in ('purchase', 'purchase_debit_note')
     where d.tenant_id = p_tenant_id and d.status = 'posted'
  )
  select rx.id,
         ld.id,
         ld.kind::text,
         ld.accounting_date,
         ld.due_date,
         ld.total_cents::bigint,
         (case when ld.id is null then null
               when ld.amt is null then ld.total_cents
               else ld.amt - coalesce(ld.open, 0) end)::bigint,
         (case when ld.id is null then null else coalesce(ld.open, 0) end)::bigint,
         coalesce((select sum(o.open) from dd o where o.rx_id = rx.id and o.id is distinct from ld.id), 0)::bigint
    from rx
    left join dd ld on ld.id = rx.last_document_id and ld.rx_id = rx.id
   order by rx.id;
end;
$$;

comment on function public.acc_report_recurring_status(uuid) is
  'Gastos fijos: por cada uno, su último comprobante vigente con lo pagado y lo que falta (regla de acc_open_amount sobre el renglón control) y lo que falta de los anteriores. Definer de solo lectura: acc_assert_reader y filtro por bar.';

-- ─── 5. Permisos ─────────────────────────────────────────────────────────────
-- Las dos que se reemplazan conservan sus permisos (create or replace no los toca).
revoke all on function private.acc_recurring_loaded_due() from public, anon, authenticated;
revoke all on function public.acc_report_recurring_status(uuid) from public, anon;
grant execute on function public.acc_report_recurring_status(uuid) to authenticated;

notify pgrst, 'reload schema';
