-- Reunión del 29/10/2026 (Luciano, min. 37): «una pestaña con todo el personal, con su sueldo, con sus adelantos» y
-- «saber cuánto le debo a fin de mes». El sueldo es fijo; algunos cobran por quincena y se les dan adelantos.
--   · acc_employees: la lista del personal.
--   · acc_employee_salaries: el sueldo por mes. Vale el del mes, o el último cargado antes.
--   · acc_payroll_movements: adelantos y pagos. Cuenta solo si su comprobante está vigente: se une por el client_ref
--     del bundle, así la fila y el comprobante nunca se desincronizan.
--   · acc_payroll_accruals: «Devengar el mes» (asiento D Sueldos y jornales / H Sueldos a pagar).
--   · Asiento de cada adelanto o pago: `cash_movement` D Sueldos a pagar [Personal] / H la caja.
-- Todo aditivo.

create table public.acc_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  pay_frequency text not null default 'monthly',
  active boolean not null default true,
  notes text,
  sort smallint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aem_id_tenant_uq unique (id, tenant_id),
  constraint aem_name_len check (char_length(btrim(name)) between 2 and 80),
  constraint aem_frequency check (pay_frequency in ('monthly', 'biweekly')),
  constraint aem_notes_len check (notes is null or char_length(notes) <= 280)
);
create index aem_tenant_idx on public.acc_employees (tenant_id, active, sort, name);
create index aem_created_by_idx on public.acc_employees (created_by) where created_by is not null;
create index aem_updated_by_idx on public.acc_employees (updated_by) where updated_by is not null;
comment on table public.acc_employees is 'Personal del bar para la planilla de Sueldos. Se escribe solo por RPC.';

create table public.acc_employee_salaries (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null,
  month date not null,
  salary_cents bigint not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, employee_id, month),
  constraint aes_first_day check (extract(day from month) = 1),
  constraint aes_salary check (salary_cents between 0 and 1000000000000000),
  constraint aes_employee_same_tenant foreign key (employee_id, tenant_id)
    references public.acc_employees (id, tenant_id) on delete cascade
);
create index aes_employee_idx on public.acc_employee_salaries (employee_id, tenant_id, month desc);
create index aes_updated_by_idx on public.acc_employee_salaries (updated_by) where updated_by is not null;
comment on table public.acc_employee_salaries is 'Sueldo de cada empleado desde un mes. El de un mes es el de ese mes o el último anterior.';

create table public.acc_payroll_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null,
  month date not null,
  kind text not null,
  client_ref uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint apm_client_ref_uq unique (tenant_id, client_ref),
  constraint apm_first_day check (extract(day from month) = 1),
  constraint apm_kind check (kind in ('advance', 'payment')),
  constraint apm_employee_same_tenant foreign key (employee_id, tenant_id)
    references public.acc_employees (id, tenant_id)
);
create index apm_month_idx on public.acc_payroll_movements (tenant_id, month, employee_id);
create index apm_employee_idx on public.acc_payroll_movements (employee_id, tenant_id);
create index apm_created_by_idx on public.acc_payroll_movements (created_by) where created_by is not null;
comment on table public.acc_payroll_movements is
  'Adelantos y pagos de sueldos. El importe, la caja y la fecha son los de su comprobante (por client_ref): si no se guardó o se anuló, no cuenta.';

create table public.acc_payroll_accruals (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_ref uuid not null,
  month date not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, client_ref),
  constraint apa_first_day check (extract(day from month) = 1)
);
create index apa_month_idx on public.acc_payroll_accruals (tenant_id, month);
create index apa_created_by_idx on public.acc_payroll_accruals (created_by) where created_by is not null;
comment on table public.acc_payroll_accruals is
  'Devengamientos de sueldos por mes. Cuenta el que tiene su comprobante vigente (por client_ref).';

alter table public.acc_employees enable row level security;
alter table public.acc_employee_salaries enable row level security;
alter table public.acc_payroll_movements enable row level security;
alter table public.acc_payroll_accruals enable row level security;
revoke all on public.acc_employees from anon, authenticated;
revoke all on public.acc_employee_salaries from anon, authenticated;
revoke all on public.acc_payroll_movements from anon, authenticated;
revoke all on public.acc_payroll_accruals from anon, authenticated;
grant select on public.acc_employees to authenticated;
grant select on public.acc_employee_salaries to authenticated;
grant select on public.acc_payroll_movements to authenticated;
grant select on public.acc_payroll_accruals to authenticated;
create policy aem_select_readers on public.acc_employees for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));
create policy aes_select_readers on public.acc_employee_salaries for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));
create policy apm_select_readers on public.acc_payroll_movements for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));
create policy apa_select_readers on public.acc_payroll_accruals for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

-- Alta y edición. Un empleado con movimientos no se borra: se desactiva.
create function public.acc_save_employee(p_tenant_id uuid, p_employee jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := nullif(p_employee ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p_employee ->> 'name', ''));
  v_freq text := coalesce(p_employee ->> 'pay_frequency', 'monthly');
  v_active boolean := coalesce((p_employee ->> 'active')::boolean, true);
  v_notes text := nullif(btrim(coalesce(p_employee ->> 'notes', '')), '');
begin
  perform public.acc_assert_writer(p_tenant_id);
  if char_length(v_name) not between 2 and 80 then
    perform private.acc_raise('invalid_payload', '{"field":"name"}');
  end if;
  if v_freq not in ('monthly', 'biweekly') then
    perform private.acc_raise('invalid_payload', '{"field":"pay_frequency"}');
  end if;
  if v_id is null then
    insert into public.acc_employees (tenant_id, name, pay_frequency, active, notes, created_by, updated_by)
    values (p_tenant_id, v_name, v_freq, v_active, v_notes, v_uid, v_uid)
    returning id into v_id;
  else
    update public.acc_employees e
       set name = v_name, pay_frequency = v_freq, active = v_active, notes = v_notes,
           updated_by = v_uid, updated_at = now()
     where e.id = v_id and e.tenant_id = p_tenant_id;
    if not found then
      perform private.acc_raise('invalid_payload', '{"field":"id"}');
    end if;
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_employee.saved', 'acc_employees', v_id,
    jsonb_build_object('active', v_active, 'pay_frequency', v_freq));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.acc_save_employee(uuid, jsonb) from public, anon;
grant execute on function public.acc_save_employee(uuid, jsonb) to authenticated;

create function public.acc_save_employee_salary(p_tenant_id uuid, p_employee_id uuid, p_month date, p_salary_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_month date := date_trunc('month', p_month)::date;
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_salary_cents is null or p_salary_cents not between 0 and 1000000000000000 then
    perform private.acc_raise('invalid_payload', '{"field":"salary_cents"}');
  end if;
  if not exists (select 1 from public.acc_employees e where e.id = p_employee_id and e.tenant_id = p_tenant_id) then
    perform private.acc_raise('invalid_payload', '{"field":"employee_id"}');
  end if;
  insert into public.acc_employee_salaries (tenant_id, employee_id, month, salary_cents, updated_by)
  values (p_tenant_id, p_employee_id, v_month, p_salary_cents, v_uid)
  on conflict (tenant_id, employee_id, month) do update
    set salary_cents = excluded.salary_cents, updated_by = excluded.updated_by, updated_at = now();
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_employee.salary_saved', 'acc_employees', p_employee_id,
    jsonb_build_object('month', v_month));
  return jsonb_build_object('month', v_month);
end;
$$;
revoke all on function public.acc_save_employee_salary(uuid, uuid, date, bigint) from public, anon;
grant execute on function public.acc_save_employee_salary(uuid, uuid, date, bigint) to authenticated;

-- Antes de guardar el comprobante: deja anotado a quién corresponde. Sin comprobante vigente, la fila no cuenta.
create function public.acc_payroll_prepare_movement(p_tenant_id uuid, p_client_ref uuid, p_employee_id uuid,
                                                    p_month date, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_kind not in ('advance', 'payment') or p_client_ref is null then
    perform private.acc_raise('invalid_payload', '{"field":"kind"}');
  end if;
  if not exists (select 1 from public.acc_employees e where e.id = p_employee_id and e.tenant_id = p_tenant_id) then
    perform private.acc_raise('invalid_payload', '{"field":"employee_id"}');
  end if;
  insert into public.acc_payroll_movements (tenant_id, employee_id, month, kind, client_ref, created_by)
  values (p_tenant_id, p_employee_id, date_trunc('month', p_month)::date, p_kind, p_client_ref, (select auth.uid()))
  on conflict (tenant_id, client_ref) do nothing;
end;
$$;
revoke all on function public.acc_payroll_prepare_movement(uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.acc_payroll_prepare_movement(uuid, uuid, uuid, date, text) to authenticated;

create function public.acc_payroll_prepare_accrual(p_tenant_id uuid, p_client_ref uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_client_ref is null or p_month is null then
    perform private.acc_raise('invalid_payload', '{"field":"month"}');
  end if;
  insert into public.acc_payroll_accruals (tenant_id, client_ref, month, created_by)
  values (p_tenant_id, p_client_ref, date_trunc('month', p_month)::date, (select auth.uid()))
  on conflict (tenant_id, client_ref) do nothing;
end;
$$;
revoke all on function public.acc_payroll_prepare_accrual(uuid, uuid, date) from public, anon;
grant execute on function public.acc_payroll_prepare_accrual(uuid, uuid, date) to authenticated;

-- La planilla de un mes: una fila por empleado activo, o con movimientos ese mes.
create function public.acc_report_payroll(p_tenant_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_rows jsonb;
  v_accrual jsonb;
begin
  perform public.acc_assert_reader(p_tenant_id);
  with mov as (
    select m.employee_id, m.kind, d.id as document_id, d.accounting_date, d.total_cents, d.seq,
           (select t.name from public.acc_document_lines l
              join public.acc_treasury_accounts t on t.id = l.treasury_account_id and t.tenant_id = l.tenant_id
             where l.document_id = d.id and l.tenant_id = d.tenant_id and l.treasury_account_id is not null
             limit 1) as treasury_name
      from public.acc_payroll_movements m
      join public.acc_bundles b on b.client_ref = m.client_ref and b.tenant_id = m.tenant_id
      join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id and d.status = 'posted'
     where m.tenant_id = p_tenant_id and m.month = v_month),
  sal as (
    select e.id as employee_id,
           coalesce((select s.salary_cents from public.acc_employee_salaries s
                      where s.tenant_id = e.tenant_id and s.employee_id = e.id and s.month <= v_month
                      order by s.month desc limit 1), 0)::bigint as salary_cents
      from public.acc_employees e
     where e.tenant_id = p_tenant_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'name', e.name, 'pay_frequency', e.pay_frequency, 'active', e.active, 'notes', e.notes,
           'salary_cents', sal.salary_cents,
           'advances_cents', coalesce((select sum(mov.total_cents) from mov
                                        where mov.employee_id = e.id and mov.kind = 'advance'), 0),
           'paid_cents', coalesce((select sum(mov.total_cents) from mov
                                    where mov.employee_id = e.id and mov.kind = 'payment'), 0),
           'movements', coalesce((select jsonb_agg(jsonb_build_object(
                                     'document_id', mov.document_id, 'kind', mov.kind, 'date', mov.accounting_date,
                                     'amount_cents', mov.total_cents, 'treasury', mov.treasury_name)
                                   order by mov.accounting_date, mov.seq)
                                   from mov where mov.employee_id = e.id), '[]'::jsonb))
         order by e.sort, e.name), '[]'::jsonb)
    into v_rows
    from public.acc_employees e
    join sal on sal.employee_id = e.id
   where e.tenant_id = p_tenant_id
     and (e.active or exists (select 1 from mov where mov.employee_id = e.id));

  select jsonb_build_object('document_id', d.id, 'date', d.accounting_date, 'amount_cents', d.total_cents)
    into v_accrual
    from public.acc_payroll_accruals a
    join public.acc_bundles b on b.client_ref = a.client_ref and b.tenant_id = a.tenant_id
    join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id and d.status = 'posted'
   where a.tenant_id = p_tenant_id and a.month = v_month
   order by d.seq desc
   limit 1;

  return jsonb_build_object('month', v_month, 'employees', v_rows, 'accrual', v_accrual);
end;
$$;
comment on function public.acc_report_payroll(uuid, date) is
  'La planilla de Sueldos de un mes: empleados con sueldo, adelantos, pagos y movimientos (solo con comprobante vigente) y el devengamiento del mes.';
revoke all on function public.acc_report_payroll(uuid, date) from public, anon;
grant execute on function public.acc_report_payroll(uuid, date) to authenticated;
