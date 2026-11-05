-- Reunión del 29/10/2026 (Tomi, min. 33): la planilla «Pagos Proveedores». Cada lunes se presupuesta cuánto pagarle
-- a cada proveedor esa semana, y se controla contra lo que se compró y se pagó de verdad.
--   · acc_payment_budgets: el presupuesto de una semana por proveedor (la semana arranca el lunes).
--   · acc_save_payment_budget: guarda una o varias celdas. Un cero deja la fila en cero.
--   · acc_report_week_plan: por proveedor, deuda, vencido, compró, pagó y presupuesto.
-- Todo aditivo: no toca ningún comprobante.

create table public.acc_payment_budgets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  week_start date not null,
  party_id uuid not null,
  amount_cents bigint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, week_start, party_id),
  constraint apb_monday check (extract(isodow from week_start) = 1),
  constraint apb_amount check (amount_cents between 0 and 1000000000000000),
  constraint apb_party_same_tenant foreign key (party_id, tenant_id)
    references public.acc_parties (id, tenant_id) on delete cascade
);
create index apb_party_idx on public.acc_payment_budgets (party_id, tenant_id);
create index apb_created_by_idx on public.acc_payment_budgets (created_by) where created_by is not null;
create index apb_updated_by_idx on public.acc_payment_budgets (updated_by) where updated_by is not null;
comment on table public.acc_payment_budgets is
  'Presupuesto de pagos por semana y proveedor («Plan de la semana»). Se escribe solo por RPC. No es contable: no mueve saldos.';

alter table public.acc_payment_budgets enable row level security;
revoke all on public.acc_payment_budgets from anon, authenticated;
grant select on public.acc_payment_budgets to authenticated;
create policy apb_select_readers on public.acc_payment_budgets
  for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

create function public.acc_save_payment_budget(p_tenant_id uuid, p_week_start date, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
  v_n integer := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    perform private.acc_raise('invalid_payload', '{"field":"week_start"}');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    perform private.acc_raise('invalid_payload', '{"field":"items"}');
  end if;
  for r in
    select (e.value ->> 'party_id')::uuid as party_id, (e.value ->> 'amount_cents')::bigint as amount_cents
      from jsonb_array_elements(p_items) e
  loop
    if r.party_id is null or r.amount_cents is null or r.amount_cents not between 0 and 1000000000000000 then
      perform private.acc_raise('invalid_payload', '{"field":"item"}');
    end if;
    if not exists (select 1 from public.acc_parties p where p.id = r.party_id and p.tenant_id = p_tenant_id) then
      perform private.acc_raise('party_not_found', null);
    end if;
    insert into public.acc_payment_budgets (tenant_id, week_start, party_id, amount_cents, created_by, updated_by)
    values (p_tenant_id, p_week_start, r.party_id, r.amount_cents, v_uid, v_uid)
    on conflict (tenant_id, week_start, party_id) do update
      set amount_cents = excluded.amount_cents, updated_by = excluded.updated_by, updated_at = now();
    v_n := v_n + 1;
  end loop;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_payment_budget.saved', 'acc_payment_budgets', null,
    jsonb_build_object('week_start', p_week_start, 'items', v_n));
  return jsonb_build_object('saved', v_n);
end;
$$;
comment on function public.acc_save_payment_budget(uuid, date, jsonb) is
  'Guarda celdas del Plan de la semana: [{party_id, amount_cents}]. Solo dueños con acceso.';
revoke all on function public.acc_save_payment_budget(uuid, date, jsonb) from public, anon;
grant execute on function public.acc_save_payment_budget(uuid, date, jsonb) to authenticated;

-- Compró: compras y ND menos NC, más lo pagado en el momento sin factura (un `expense` con proveedor).
-- Pagó: órdenes de pago, más esos mismos `expense`. Los anulados no cuentan. Trae los proveedores con deuda, con
-- presupuesto o con movimiento esa semana.
create function public.acc_report_week_plan(p_tenant_id uuid, p_week_start date)
returns table (
  party_id uuid, party_name text, party_kind text, default_voucher_type text,
  debt_cents bigint, overdue_cents bigint, purchased_cents bigint, paid_cents bigint, budget_cents bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_end date;
begin
  perform public.acc_assert_reader(p_tenant_id);
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'invalid_report_param' using errcode = 'P0001', detail = '{"param":"p_week_start"}';
  end if;
  v_end := p_week_start + 6;
  return query
  with mov as (
    select d.party_id,
           coalesce(sum(case
             when d.kind in ('purchase', 'purchase_debit_note', 'expense') then d.total_cents
             when d.kind = 'purchase_credit_note' then -d.total_cents end), 0)::bigint as purchased,
           coalesce(sum(d.total_cents) filter (where d.kind in ('payment', 'expense')), 0)::bigint as paid
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.status = 'posted' and d.party_id is not null
       and d.accounting_date between p_week_start and v_end
       and d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')
     group by d.party_id),
  bal as (
    select b.party_id, b.debt_cents, b.overdue_cents
      from public.acc_report_party_balances(p_tenant_id, null, 'payables') b),
  bud as (
    select b.party_id, b.amount_cents
      from public.acc_payment_budgets b
     where b.tenant_id = p_tenant_id and b.week_start = p_week_start)
  select p.id, coalesce(nullif(btrim(p.trade_name), ''), p.name), p.kind, p.default_voucher_type,
         coalesce(bal.debt_cents, 0)::bigint, coalesce(bal.overdue_cents, 0)::bigint,
         coalesce(mov.purchased, 0)::bigint, coalesce(mov.paid, 0)::bigint, coalesce(bud.amount_cents, 0)::bigint
    from public.acc_parties p
    left join bal on bal.party_id = p.id
    left join mov on mov.party_id = p.id
    left join bud on bud.party_id = p.id
   where p.tenant_id = p_tenant_id
     and p.kind in ('supplier', 'other')
     and (coalesce(bal.debt_cents, 0) > 0 or coalesce(mov.purchased, 0) <> 0 or coalesce(mov.paid, 0) <> 0
          or coalesce(bud.amount_cents, 0) > 0)
   order by coalesce(bud.amount_cents, 0) desc, coalesce(bal.debt_cents, 0) desc, 2;
end;
$$;
comment on function public.acc_report_week_plan(uuid, date) is
  'Una fila por proveedor con deuda, presupuesto o movimiento en la semana: lo que debe, lo vencido, lo que compró, lo que pagó y lo presupuestado.';
revoke all on function public.acc_report_week_plan(uuid, date) from public, anon;
grant execute on function public.acc_report_week_plan(uuid, date) to authenticated;
