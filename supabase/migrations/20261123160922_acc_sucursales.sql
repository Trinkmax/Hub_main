-- Administración por sucursal · tanda 1: estructura, relleno y escritura.
--
-- Pedido del 22/11/2026: un socio pagó un gasto fijo con el Cerro elegido y quedó pagado también en Alta Córdoba,
-- porque Administración era de todo el bar. Decisión del dueño: misma empresa y UN libro (diario, mayor e IVA no se
-- separan), pero cada sucursal con sus comprobantes, gastos fijos, cajas en efectivo, empleados, objetivos y
-- presupuestos de pago; «Todas» suma.
--
-- Qué queda sin sucursal («de todo el bar»): la liquidación de IVA, el cierre y la apertura de ejercicio, y los
-- asientos manuales (entre ellos el devengado de sueldos). Las cajas que no son efectivo (billeteras como Mercado
-- Pago, bancos, tarjetas) arrancan «de todo el bar»: se ven en todas las sucursales con un solo saldo.
--
-- Relleno: lo existente va a la sucursal principal de su bar. Los comprobantes no se pueden modificar: el relleno, y
-- desde ahora «Cambiar de sucursal», pasan por la marca de la transacción `acc.branch_move` (= el bar), que solo deja
-- tocar la sucursal. Ninguna tabla acc_* está en tiempo real.
--
-- Los informes que reciben la sucursal (`p_branch_id`, vacío = lo de siempre) van al final de este archivo.

set local lock_timeout = '5s';

-- ─── 1. Columnas ───────────────────────────────────────────────────────────────────────────────────────────

alter table public.acc_documents add column branch_id uuid;
alter table public.acc_recurring_expenses add column branch_id uuid;
alter table public.acc_treasury_accounts add column branch_id uuid;
alter table public.acc_employees add column branch_id uuid;
alter table public.acc_sales_targets add column branch_id uuid;
alter table public.acc_payment_budgets add column branch_id uuid;

comment on column public.acc_documents.branch_id is
  'Sucursal del comprobante. Vacía = de todo el bar (liquidación de IVA, ejercicio, asientos manuales). Solo cambia con «Cambiar de sucursal» (acc_set_document_branch).';
comment on column public.acc_recurring_expenses.branch_id is
  'Sucursal del gasto fijo. Sus pagos quedan en esta sucursal.';
comment on column public.acc_treasury_accounts.branch_id is
  'Sucursal de la caja. Vacía = de todo el bar (se ve en todas con un solo saldo).';
comment on column public.acc_employees.branch_id is 'Sucursal donde trabaja.';
comment on column public.acc_sales_targets.branch_id is 'Sucursal del objetivo (la clave por sucursal llega en la tanda 2).';
comment on column public.acc_payment_budgets.branch_id is 'Sucursal del presupuesto (la clave por sucursal llega en la tanda 2).';

-- ─── 2. Comprobantes: «Cambiar de sucursal» bajo marca, y la reversión sigue al original ──────────────────

create or replace function private.acc_tg_documents_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep text[] := array['status', 'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then return old; end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_documents';
  end if;
  -- Cambiar de sucursal (acc_set_document_branch, el relleno, mover un gasto fijo con sus pagos): solo la
  -- sucursal, bajo la marca de la transacción y del mismo bar. No toca montos, partidas ni el libro.
  if current_setting('acc.branch_move', true) = old.tenant_id::text
     and (to_jsonb(new) - 'branch_id' - 'updated_at') = (to_jsonb(old) - 'branch_id' - 'updated_at') then
    return new;
  end if;
  if (to_jsonb(new) - v_keep) <> (to_jsonb(old) - v_keep)
     or not (old.status = 'posted' and new.status = 'voided') then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_documents';
  end if;
  return new;
end;
$$;

-- La reversión (acc_reverse_document) se inserta con su propia lista de columnas: toma la sucursal del original.
create function private.acc_tg_documents_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null and new.reverses_document_id is not null then
    select d.branch_id into new.branch_id
      from public.acc_documents d
     where d.id = new.reverses_document_id and d.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

create trigger acc_documents_05_branch
  before insert on public.acc_documents
  for each row execute function private.acc_tg_documents_branch();

revoke all on function private.acc_tg_documents_branch() from public, anon, authenticated;

-- ─── 3. Relleno ────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  -- Comprobantes: los operativos a la principal de su bar; los de la empresa quedan vacíos.
  for r in select distinct d.tenant_id, b.id as branch_id
             from public.acc_documents d
             join public.branches b on b.tenant_id = d.tenant_id and b.is_default loop
    perform set_config('acc.branch_move', r.tenant_id::text, true);
    update public.acc_documents d
       set branch_id = r.branch_id
     where d.tenant_id = r.tenant_id
       and d.branch_id is null
       and d.kind not in ('iva_settlement', 'fy_result', 'fy_closing', 'fy_opening', 'manual');
  end loop;
  perform set_config('acc.branch_move', '', true);
end
$$;

update public.acc_recurring_expenses x set branch_id = b.id
  from public.branches b where b.tenant_id = x.tenant_id and b.is_default and x.branch_id is null;
update public.acc_employees x set branch_id = b.id
  from public.branches b where b.tenant_id = x.tenant_id and b.is_default and x.branch_id is null;
update public.acc_sales_targets x set branch_id = b.id
  from public.branches b where b.tenant_id = x.tenant_id and b.is_default and x.branch_id is null;
update public.acc_payment_budgets x set branch_id = b.id
  from public.branches b where b.tenant_id = x.tenant_id and b.is_default and x.branch_id is null;
-- Cajas: el efectivo es de un local; billeteras, bancos y tarjetas, de todo el bar.
update public.acc_treasury_accounts x set branch_id = b.id
  from public.branches b
 where b.tenant_id = x.tenant_id and b.is_default and x.branch_id is null and x.kind = 'cash';

-- ─── 4. Llaves, obligatoriedad e índices ───────────────────────────────────────────────────────────────────

alter table public.acc_recurring_expenses alter column branch_id set not null;
alter table public.acc_employees alter column branch_id set not null;
alter table public.acc_sales_targets alter column branch_id set not null;
alter table public.acc_payment_budgets alter column branch_id set not null;

alter table public.acc_documents
  add constraint adoc_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);
alter table public.acc_recurring_expenses
  add constraint arx_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);
alter table public.acc_treasury_accounts
  add constraint atr_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);
alter table public.acc_employees
  add constraint aem_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);
alter table public.acc_sales_targets
  add constraint astg_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);
alter table public.acc_payment_budgets
  add constraint apb_branch_fk foreign key (branch_id, tenant_id) references public.branches (id, tenant_id);

create index adoc_branch_idx on public.acc_documents (tenant_id, branch_id, accounting_date);
create index arx_branch_idx on public.acc_recurring_expenses (tenant_id, branch_id);
create index atr_branch_idx on public.acc_treasury_accounts (tenant_id, branch_id);
create index aem_branch_idx on public.acc_employees (tenant_id, branch_id);
create index astg_branch_idx on public.acc_sales_targets (tenant_id, branch_id, day);
create index apb_branch_idx on public.acc_payment_budgets (tenant_id, branch_id, week_start);

-- El mismo nombre puede estar en dos sucursales («Alquiler» de cada local).
drop index public.arx_name_live_uq;
create unique index arx_name_live_uq on public.acc_recurring_expenses (tenant_id, branch_id, lower(name))
  where archived_at is null;

-- Lo que el código de hoy inserta sin sucursal cae en la principal (mientras sale el código nuevo).
create trigger acc_recurring_expenses_default_branch
  before insert on public.acc_recurring_expenses for each row execute function private.pos_tg_default_branch();
create trigger acc_employees_default_branch
  before insert on public.acc_employees for each row execute function private.pos_tg_default_branch();
create trigger acc_sales_targets_default_branch
  before insert on public.acc_sales_targets for each row execute function private.pos_tg_default_branch();
create trigger acc_payment_budgets_default_branch
  before insert on public.acc_payment_budgets for each row execute function private.pos_tg_default_branch();

-- ─── 5. La sucursal de un comprobante nuevo ────────────────────────────────────────────────────────────────

-- La pedida (si la persona la tiene); sin pedido: la del gasto fijo, la del comprobante que corrige, vacía para un
-- asiento manual y la principal para todo lo demás. Lo de la empresa (IVA, ejercicio) siempre vacío.
create function private.acc_document_branch(p_tenant uuid, p_c jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := p_c ->> 'kind';
  v_req uuid := private.acc_to_uuid(p_c ->> 'branch_id');
  v_rec uuid := private.acc_to_uuid(p_c ->> 'recurring_expense_id');
  v_replaces uuid := private.acc_to_uuid(p_c ->> 'replaces_document_id');
  v_rec_branch uuid;
  v_out uuid;
begin
  if v_kind in ('iva_settlement', 'fy_result', 'fy_closing', 'fy_opening') then
    return null;
  end if;
  if v_rec is not null then
    select x.branch_id into v_rec_branch
      from public.acc_recurring_expenses x where x.id = v_rec and x.tenant_id = p_tenant;
  end if;
  if v_req is null then
    if v_rec_branch is not null then return v_rec_branch; end if;
    if v_replaces is not null then
      select d.branch_id into v_out from public.acc_documents d where d.id = v_replaces and d.tenant_id = p_tenant;
      return v_out;
    end if;
    if v_kind = 'manual' then return null; end if;
  end if;
  begin
    v_out := private.branch_for_write(p_tenant, v_req);
  exception when others then
    if sqlerrm in ('branch_not_found', 'branch_forbidden', 'branch_required') then
      perform private.acc_raise(sqlerrm, jsonb_build_object('document', p_c ->> 'ref'));
    end if;
    raise;
  end;
  if v_rec_branch is not null and v_rec_branch <> v_out then
    perform private.acc_raise('recurring_branch_mismatch', jsonb_build_object('document', p_c ->> 'ref'));
  end if;
  return v_out;
end;
$$;

revoke all on function private.acc_document_branch(uuid, jsonb) from public, anon, authenticated;

-- El comprobante normalizado conserva la sucursal pedida (antes se descartaba toda clave desconocida) y el
-- comprobante se escribe con su sucursal y la guarda de cajas.
-- Aplica reemplazos exactos sobre la definición de producción (cada parte tiene que aparecer UNA vez).
create function pg_temp.acc_suc_patch(p_sig text, p_pairs text[])
returns void
language plpgsql
as $f$
declare
  v text := pg_get_functiondef(to_regprocedure(p_sig));
  v_old text;
  v_n int;
begin
  if v is null then
    raise exception 'parche: no existe %', p_sig;
  end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    v_old := p_pairs[2 * i - 1];
    v_n := (length(v) - length(replace(v, v_old, ''))) / length(v_old);
    if v_n <> 1 then
      raise exception 'parche %: la parte % aparece % veces (se esperaba una)', p_sig, i, v_n;
    end if;
    v := replace(v, v_old, p_pairs[2 * i]);
  end loop;
  execute v;
end
$f$;
select pg_temp.acc_suc_patch('private.acc_normalize_document(uuid,jsonb,jsonb)', array[
  $o1$    'recurring_expense_id', private.acc_juuid(p_doc, 'recurring_expense_id', w),
$o1$,
  $n1$    'recurring_expense_id', private.acc_juuid(p_doc, 'recurring_expense_id', w),
    'branch_id', private.acc_juuid(p_doc, 'branch_id', w),
$n1$
]);
select pg_temp.acc_suc_patch('private.acc_write_document(uuid,uuid,text,uuid,jsonb)', array[
  $o1$  v_amt bigint;
begin
$o1$,
  $n1$  v_amt bigint;
  v_branch uuid;
  v_tname text;
begin
  -- La sucursal (private.acc_document_branch): la pedida, la del gasto fijo, la del corregido, la principal o
  -- vacía (lo de la empresa). Se decide antes de anular nada.
  v_branch := private.acc_document_branch(p_tenant, p_c);
$n1$,
  $o2$settles_commissions, counted_cents, expected_book_cents, warnings_ack, override_reason, created_by, created_by_name)
$o2$,
  $n2$settles_commissions, counted_cents, expected_book_cents, warnings_ack, override_reason, created_by, created_by_name,
      branch_id)
$n2$,
  $o3$      p_actor, p_actor_name);

  insert into public.acc_document_lines$o3$,
  $n3$      p_actor, p_actor_name, v_branch);

  insert into public.acc_document_lines$n3$,
  $o4$    from jsonb_populate_recordset(null::public.acc_document_lines, p_c -> 'lines') l
   order by l.line_no;
$o4$,
  $n4$    from jsonb_populate_recordset(null::public.acc_document_lines, p_c -> 'lines') l
   order by l.line_no;

  -- Una caja de otra sucursal no se mueve desde esta (salvo «Mover plata», que cruza sucursales a propósito).
  if v_branch is not null and v_kind <> 'transfer' then
    select t.name into v_tname
      from public.acc_document_lines l
      join public.acc_treasury_accounts t on t.id = l.treasury_account_id and t.tenant_id = l.tenant_id
     where l.document_id = v_id and l.tenant_id = p_tenant
       and t.branch_id is not null and t.branch_id <> v_branch
     limit 1;
    if v_tname is not null then
      perform private.acc_raise('treasury_other_branch',
        jsonb_build_object('document', p_c ->> 'ref', 'treasury', v_tname));
    end if;
  end if;
$n4$
]);

-- ─── 6. Cambiar de sucursal ────────────────────────────────────────────────────────────────────────────────

create function public.acc_set_document_branch(p_tenant_id uuid, p_document_id uuid, p_branch_id uuid,
                                               p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_doc public.acc_documents;
  v_branch uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if p_document_id is null or p_branch_id is null then
    perform private.acc_raise('invalid_payload', '{"field":"branch_id"}');
  end if;
  if char_length(v_reason) > 300 then
    perform private.acc_raise('invalid_payload', '{"field":"reason"}');
  end if;
  select * into v_doc from public.acc_documents d
   where d.id = p_document_id and d.tenant_id = p_tenant_id for update;
  if not found then
    perform private.acc_raise('document_not_found', jsonb_build_object('document_id', p_document_id));
  end if;
  if v_doc.branch_id is null then
    perform private.acc_raise('document_branch_general', jsonb_build_object('document_id', p_document_id));
  end if;
  begin
    v_branch := private.branch_for_write(p_tenant_id, p_branch_id);
  exception when others then
    if sqlerrm in ('branch_not_found', 'branch_forbidden', 'branch_required') then
      perform private.acc_raise(sqlerrm, jsonb_build_object('document_id', p_document_id));
    end if;
    raise;
  end;
  if v_branch = v_doc.branch_id then
    return jsonb_build_object('ok', true, 'document_id', v_doc.id, 'branch_id', v_branch, 'moved', false);
  end if;
  perform set_config('acc.branch_move', p_tenant_id::text, true);
  update public.acc_documents d set branch_id = v_branch where d.id = v_doc.id and d.tenant_id = p_tenant_id;
  perform set_config('acc.branch_move', '', true);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.branch_changed', 'acc_document', v_doc.id,
    jsonb_build_object('from', v_doc.branch_id, 'to', v_branch, 'seq', v_doc.seq, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'document_id', v_doc.id, 'branch_id', v_branch, 'moved', true);
end;
$$;

revoke all on function public.acc_set_document_branch(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.acc_set_document_branch(uuid, uuid, uuid, text) to authenticated, service_role;
comment on function public.acc_set_document_branch(uuid, uuid, uuid, text) is
  'Cambia la sucursal de un comprobante (dueño con carga, mes abierto). No toca montos ni el libro. Los de todo el bar no se mueven.';

-- ─── 7. Guardados con sucursal ─────────────────────────────────────────────────────────────────────────────

select pg_temp.acc_suc_patch('public.acc_save_recurring_expense(uuid,jsonb,timestamptz)', array[
  $o1$  v_sum bigint;
begin
$o1$,
  $n1$  v_sum bigint;
  v_moved int := 0;
begin
$n1$,
  $o2$                     'ends_on', 'breakdown', 'installments_total') then
$o2$,
  $n2$                     'ends_on', 'breakdown', 'installments_total', 'branch_id') then
$n2$,
  $o3$  if p_expense ? 'name' then
    v_txt := btrim(coalesce(p_expense ->> 'name', ''));
$o3$,
  $n3$  -- La sucursal: la pedida (si la persona la tiene); uno nuevo sin pedido, la principal.
  if p_expense ? 'branch_id' then
    v_uuid := private.acc_to_uuid(p_expense ->> 'branch_id');
    if v_uuid is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'branch_id';
    end if;
    v_row.branch_id := private.branch_for_write(p_tenant_id, v_uuid);
  elsif v_created then
    v_row.branch_id := private.branch_for_write(p_tenant_id, null);
  end if;
  -- El nombre es único dentro de la sucursal (también al mudarlo de sucursal sin cambiarle el nombre).
  if v_created or p_expense ? 'branch_id' then
    v_txt := coalesce(btrim(p_expense ->> 'name'), v_row.name);
    if v_txt is not null and exists (select 1 from public.acc_recurring_expenses x
                where x.tenant_id = p_tenant_id and x.branch_id = v_row.branch_id
                  and lower(x.name) = lower(v_txt) and x.id <> v_row.id and x.archived_at is null) then
      raise exception 'recurring_name_taken' using errcode = 'P0001', detail = v_txt;
    end if;
  end if;
  if p_expense ? 'name' then
    v_txt := btrim(coalesce(p_expense ->> 'name', ''));
$n3$,
  $o4$                where x.tenant_id = p_tenant_id and lower(x.name) = lower(v_txt) and x.id <> v_row.id
                  and x.archived_at is null) then
$o4$,
  $n4$                where x.tenant_id = p_tenant_id and x.branch_id = v_row.branch_id
                  and lower(x.name) = lower(v_txt) and x.id <> v_row.id
                  and x.archived_at is null) then
$n4$,
  $o5$                                               installments_total, created_by, updated_by)
$o5$,
  $n5$                                               installments_total, created_by, updated_by, branch_id)
$n5$,
  $o6$            v_row.installments_total, v_uid, v_uid)
$o6$,
  $n6$            v_row.installments_total, v_uid, v_uid, v_row.branch_id)
$n6$,
  $o7$           installments_total = v_row.installments_total, skipped_due = v_row.skipped_due,
           updated_by = v_uid
$o7$,
  $n7$           installments_total = v_row.installments_total, skipped_due = v_row.skipped_due,
           branch_id = v_row.branch_id, updated_by = v_uid
$n7$,
  $o8$  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.saved', 'acc_recurring', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
$o8$,
  $n8$  -- Cambió de sucursal: sus pagos van con él (un mes cerrado lo frena con period_closed).
  if not v_created and v_row.branch_id is distinct from v_old.branch_id then
    perform set_config('acc.branch_move', p_tenant_id::text, true);
    update public.acc_documents d set branch_id = v_row.branch_id
     where d.tenant_id = p_tenant_id and d.recurring_expense_id = v_old.id
       and d.branch_id is distinct from v_row.branch_id;
    get diagnostics v_moved = row_count;
    perform set_config('acc.branch_move', '', true);
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_recurring.saved', 'acc_recurring', v_row.id,
    jsonb_build_object('created', v_created, 'fields', v_fields, 'documents_moved', v_moved));
$n8$
]);
select pg_temp.acc_suc_patch('public.acc_create_recurring_bulk(uuid,jsonb)', array[
  $o1$  v_skipped jsonb := '[]'::jsonb;
begin
$o1$,
  $n1$  v_skipped jsonb := '[]'::jsonb;
  v_branch uuid;
begin
$n1$,
  $o2$    v_name := btrim(coalesce(v_item ->> 'name', ''));
    if lower(v_name) = any (v_seen)
       or exists (select 1 from public.acc_recurring_expenses x
                   where x.tenant_id = p_tenant_id and lower(x.name) = lower(v_name) and x.archived_at is null) then
$o2$,
  $n2$    v_name := btrim(coalesce(v_item ->> 'name', ''));
    -- Cada ítem va a su sucursal (la pedida o la principal); el nombre se compara dentro de ella.
    v_branch := private.branch_for_write(p_tenant_id, private.acc_to_uuid(v_item ->> 'branch_id'));
    if (v_branch::text || ':' || lower(v_name)) = any (v_seen)
       or exists (select 1 from public.acc_recurring_expenses x
                   where x.tenant_id = p_tenant_id and x.branch_id = v_branch
                     and lower(x.name) = lower(v_name) and x.archived_at is null) then
$n2$,
  $o3$    v_seen := v_seen || lower(v_name);
    perform public.acc_save_recurring_expense(p_tenant_id, v_item, null);
$o3$,
  $n3$    v_seen := v_seen || (v_branch::text || ':' || lower(v_name));
    perform public.acc_save_recurring_expense(p_tenant_id, v_item || jsonb_build_object('branch_id', v_branch), null);
$n3$
]);
select pg_temp.acc_suc_patch('public.acc_save_treasury_account(uuid,jsonb,timestamptz)', array[
  $o1$  v_fields jsonb;
begin
$o1$,
  $n1$  v_fields jsonb;
  v_branch uuid;
begin
$n1$,
  $o2$                     'create_bank_party', 'sort', 'active') then
$o2$,
  $n2$                     'create_bank_party', 'sort', 'active', 'branch_id') then
$n2$,
  $o3$  v_created := not (p_treasury ? 'id');
$o3$,
  $n3$  v_created := not (p_treasury ? 'id');
  -- La sucursal: `null` explícito = de todo el bar. Sin la clave, una caja nueva en efectivo va a la principal
  -- (el efectivo es de un local) y las demás quedan de todo el bar; una existente no cambia.
  if p_treasury ? 'branch_id' and jsonb_typeof(p_treasury -> 'branch_id') <> 'null' then
    v_branch := private.acc_to_uuid(p_treasury ->> 'branch_id');
    if v_branch is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'branch_id';
    end if;
    v_branch := private.branch_for_write(p_tenant_id, v_branch);
  elsif v_created and not (p_treasury ? 'branch_id') and coalesce(p_treasury ->> 'kind', '') = 'cash' then
    v_branch := private.branch_for_write(p_tenant_id, null);
  end if;
$n3$,
  $o4$    v_row := private.acc_treasury_create(p_tenant_id, v_uid, p_treasury,
$o4$,
  $n4$    v_row := private.acc_treasury_create(p_tenant_id, v_uid, p_treasury - 'branch_id',
$n4$,
  $o5$    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_treasury) k);
  else
$o5$,
  $n5$    if v_branch is not null then
      update public.acc_treasury_accounts t set branch_id = v_branch
       where t.id = v_row.id and t.tenant_id = p_tenant_id
       returning * into v_row;
    end if;
    v_fields := (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p_treasury) k);
  else
$n5$,
  $o6$           sort = v_row.sort, active = v_row.active, updated_by = v_uid
$o6$,
  $n6$           sort = v_row.sort, active = v_row.active, updated_by = v_uid,
           branch_id = case when p_treasury ? 'branch_id' then v_branch else t.branch_id end
$n6$
]);
select pg_temp.acc_suc_patch('public.acc_save_employee(uuid,jsonb)', array[
  $o1$  v_notes text := nullif(btrim(coalesce(p_employee ->> 'notes', '')), '');
begin
$o1$,
  $n1$  v_notes text := nullif(btrim(coalesce(p_employee ->> 'notes', '')), '');
  v_branch uuid;
begin
$n1$,
  $o2$  if v_id is null then
    insert into public.acc_employees (tenant_id, name, pay_frequency, active, notes, created_by, updated_by)
    values (p_tenant_id, v_name, v_freq, v_active, v_notes, v_uid, v_uid)
$o2$,
  $n2$  -- La sucursal donde trabaja: la pedida (si la persona la tiene); uno nuevo sin pedido, la principal.
  if p_employee ? 'branch_id' or v_id is null then
    v_branch := private.branch_for_write(p_tenant_id, private.acc_to_uuid(p_employee ->> 'branch_id'));
  end if;
  if v_id is null then
    insert into public.acc_employees (tenant_id, name, pay_frequency, active, notes, created_by, updated_by,
                                      branch_id)
    values (p_tenant_id, v_name, v_freq, v_active, v_notes, v_uid, v_uid, v_branch)
$n2$,
  $o3$       set name = v_name, pay_frequency = v_freq, active = v_active, notes = v_notes,
           updated_by = v_uid, updated_at = now()
$o3$,
  $n3$       set name = v_name, pay_frequency = v_freq, active = v_active, notes = v_notes,
           branch_id = coalesce(v_branch, e.branch_id),
           updated_by = v_uid, updated_at = now()
$n3$
]);

-- ─── 8. Informes con sucursal (`p_branch_id`, vacío = lo de siempre) ────────────────────────────────────

-- acc_report_recurring_status: 1 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_recurring_status(uuid)', array[
  $o1$(p_tenant_id uuid)
 RETURNS$o1$,
  $n1$(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$     where x.tenant_id = p_tenant_id and x.archived_at is null
  ), dd as (
$o2$,
  $n2$     where x.tenant_id = p_tenant_id and x.archived_at is null
       and (p_branch_id is null or x.branch_id = p_branch_id)
  ), dd as (
$n2$
]);
drop function public.acc_report_recurring_status(uuid);
revoke all on function public.acc_report_recurring_status(uuid,uuid) from public, anon;
grant execute on function public.acc_report_recurring_status(uuid,uuid) to authenticated, service_role;
comment on function public.acc_report_recurring_status(uuid,uuid) is
  'Gastos fijos: por cada uno, su último comprobante vigente con lo pagado y lo que falta (regla de acc_open_amount sobre el renglón control) y lo que falta de los anteriores. Definer de solo lectura: acc_assert_reader y filtro por bar. Con p_branch_id, solo los gastos fijos de esa sucursal, con todos sus pagos sean de la sucursal que sean; vacío = todo el bar.';

-- acc_report_party_balances: 1 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_party_balances(uuid,date,text)', array[
  $o1$p_group text)
 RETURNS$o1$,
  $n1$p_group text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$       and a.system_key is distinct from 'vat_credit_pending'),
$o2$,
  $n2$       and a.system_key is distinct from 'vat_credit_pending'
       and (p_branch_id is null
            or l.document_id in (select bd.id from public.acc_documents bd
                                 where bd.tenant_id = p_tenant_id and bd.branch_id = p_branch_id))),
$n2$
]);
drop function public.acc_report_party_balances(uuid,date,text);
revoke all on function public.acc_report_party_balances(uuid,date,text,uuid) from public, anon;
grant execute on function public.acc_report_party_balances(uuid,date,text,uuid) to authenticated, service_role;
comment on function public.acc_report_party_balances(uuid,date,text,uuid) is
  'Saldos de proveedores o cobrables al día X con antigüedad y semáforo (F.7). INVOKER. Con p_branch_id, solo las partidas de comprobantes de esa sucursal (las imputaciones las descuentan aunque vengan de otra); vacío = todo el bar.';

-- acc_report_open_items: 1 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_open_items(uuid,uuid,date,text,uuid)', array[
  $o1$p_account_id uuid DEFAULT NULL::uuid)
 RETURNS$o1$,
  $n1$p_account_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$   where li.amount_cents - coalesce(al.applied, 0) > 0
   order by li.due_date nulls last, li.entry_date, li.order_key, li.posting_seq, li.line_no;
$o2$,
  $n2$   where li.amount_cents - coalesce(al.applied, 0) > 0
     and (p_branch_id is null or d.branch_id = p_branch_id)
   order by li.due_date nulls last, li.entry_date, li.order_key, li.posting_seq, li.line_no;
$n2$
]);
drop function public.acc_report_open_items(uuid,uuid,date,text,uuid);
revoke all on function public.acc_report_open_items(uuid,uuid,date,text,uuid,uuid) from public, anon;
grant execute on function public.acc_report_open_items(uuid,uuid,date,text,uuid,uuid) to authenticated, service_role;
comment on function public.acc_report_open_items(uuid,uuid,date,text,uuid,uuid) is
  'Partidas abiertas de un partícipe (F.7): estado actual (p_as_of null) o al día X; deuda, a favor o las dos. INVOKER. Con p_branch_id, solo las partidas de comprobantes de esa sucursal (las imputaciones las descuentan aunque vengan de otra); vacío = todo el bar.';

-- acc_report_party_statement: 2 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_party_statement(uuid,uuid,uuid,date,date,jsonb,integer)', array[
  $o1$p_limit integer DEFAULT 500)
 RETURNS$o1$,
  $n1$p_limit integer DEFAULT 500, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$               else l.account_id = p_account_id end);
$o2$,
  $n2$               else l.account_id = p_account_id end)
     and (p_branch_id is null
          or l.document_id in (select bd.id from public.acc_documents bd
                               where bd.tenant_id = p_tenant_id and bd.branch_id = p_branch_id));
$n2$,
  $o3$       and (v_d is null or (l.entry_date, e.order_key, e.posting_seq, l.line_no) > (v_d, v_k, v_s, v_n))
     order by l.entry_date, e.order_key, e.posting_seq, l.line_no
$o3$,
  $n3$       and (v_d is null or (l.entry_date, e.order_key, e.posting_seq, l.line_no) > (v_d, v_k, v_s, v_n))
       and (p_branch_id is null
            or l.document_id in (select bd.id from public.acc_documents bd
                                 where bd.tenant_id = p_tenant_id and bd.branch_id = p_branch_id))
     order by l.entry_date, e.order_key, e.posting_seq, l.line_no
$n3$
]);
drop function public.acc_report_party_statement(uuid,uuid,uuid,date,date,jsonb,integer);
revoke all on function public.acc_report_party_statement(uuid,uuid,uuid,date,date,jsonb,integer,uuid) from public, anon;
grant execute on function public.acc_report_party_statement(uuid,uuid,uuid,date,date,jsonb,integer,uuid) to authenticated, service_role;
comment on function public.acc_report_party_statement(uuid,uuid,uuid,date,date,jsonb,integer,uuid) is
  'Estado de cuenta de un partícipe con saldo acumulado, paginado por keyset (F.7). INVOKER. Con p_branch_id, solo las líneas de comprobantes de esa sucursal, también en el saldo anterior, el acumulado y el total de filas; vacío = todo el bar.';

-- acc_report_treasury_balances: 2 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_treasury_balances(uuid,date)', array[
  $o1$p_as_of date)
 RETURNS$o1$,
  $n1$p_as_of date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$sort smallint)
 LANGUAGE$o2$,
  $n2$sort smallint, branch_id uuid)
 LANGUAGE$n2$,
  $o3$         t.last_checked_on, t.account_id, t.active, t.sort
$o3$,
  $n3$         t.last_checked_on, t.account_id, t.active, t.sort, t.branch_id
$n3$,
  $o4$   where t.tenant_id = p_tenant_id and (t.active or coalesce(b.bal, 0) <> 0)
   order by t.sort, t.name;
$o4$,
  $n4$   where t.tenant_id = p_tenant_id and (t.active or coalesce(b.bal, 0) <> 0)
     and (p_branch_id is null or t.branch_id = p_branch_id or t.branch_id is null)
   order by t.sort, t.name;
$n4$
]);
drop function public.acc_report_treasury_balances(uuid,date);
revoke all on function public.acc_report_treasury_balances(uuid,date,uuid) from public, anon;
grant execute on function public.acc_report_treasury_balances(uuid,date,uuid) to authenticated, service_role;
comment on function public.acc_report_treasury_balances(uuid,date,uuid) is
  'Cajas y bancos (F.9): saldo (Debe − Haber), por acreditar, último movimiento y último ajuste. INVOKER. Con p_branch_id, las cajas de esa sucursal y las de todo el bar (estas con su saldo entero); cada fila trae branch_id (null = de todo el bar).';

-- acc_report_cash_daily: 2 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_cash_daily(uuid,date,date)', array[
  $o1$p_to date)
 RETURNS$o1$,
  $n1$p_to date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$     where t.tenant_id = p_tenant_id and e.status = 'posted' and not e.is_mirror
  ), op as (
$o2$,
  $n2$     where t.tenant_id = p_tenant_id and e.status = 'posted' and not e.is_mirror
       and (p_branch_id is null or t.branch_id = p_branch_id or t.branch_id is null)
  ), op as (
$n2$,
  $o3$       and (t.active or coalesce(op.cents, 0) <> 0 or da.tid is not null)
  )
$o3$,
  $n3$       and (t.active or coalesce(op.cents, 0) <> 0 or da.tid is not null)
       and (p_branch_id is null or t.branch_id = p_branch_id or t.branch_id is null)
  )
$n3$
]);
drop function public.acc_report_cash_daily(uuid,date,date);
revoke all on function public.acc_report_cash_daily(uuid,date,date,uuid) from public, anon;
grant execute on function public.acc_report_cash_daily(uuid,date,date,uuid) to authenticated, service_role;
comment on function public.acc_report_cash_daily(uuid,date,date,uuid) is
  'Cajas y bancos, día por día: por caja (y treasury_id null = todas las de activo, sin mover plata entre cajas) el saldo anterior, el del cierre y los días con movimiento [{day, in_cents, out_cents, balance_cents}]. Hasta 366 días. Definer de solo lectura: acc_assert_reader y filtro por bar. Con p_branch_id, solo las cajas de esa sucursal y las de todo el bar (estas con todos sus movimientos), también en la fila de todas; vacío = todas las cajas.';

-- acc_report_cash_flow: 1 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_cash_flow(uuid,date,date)', array[
  $o1$p_to date)
 RETURNS$o1$,
  $n1$p_to date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$       and e.status = 'posted' and not e.is_mirror and t.kind <> 'credit_card'
  ), net as (
$o2$,
  $n2$       and e.status = 'posted' and not e.is_mirror and t.kind <> 'credit_card'
       and (p_branch_id is null or t.branch_id = p_branch_id
            or (t.branch_id is null
                and l.document_id in (select bd.id from public.acc_documents bd
                                      where bd.tenant_id = p_tenant_id and bd.branch_id = p_branch_id)))
  ), net as (
$n2$
]);
drop function public.acc_report_cash_flow(uuid,date,date);
revoke all on function public.acc_report_cash_flow(uuid,date,date,uuid) from public, anon;
grant execute on function public.acc_report_cash_flow(uuid,date,date,uuid) to authenticated, service_role;
comment on function public.acc_report_cash_flow(uuid,date,date,uuid) is
  'Flujo de caja realizado (F.9) por mes y categoría, sin apertura ni movimientos entre cajas. INVOKER. Con p_branch_id, los movimientos de las cajas de esa sucursal y, en las de todo el bar, solo los de comprobantes de esa sucursal; vacío = todo el bar.';

-- acc_report_cash_projection: 3 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_cash_projection(uuid,date,integer)', array[
  $o1$p_weeks integer DEFAULT 4)
 RETURNS$o1$,
  $n1$p_weeks integer DEFAULT 4, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$     and t.kind <> 'credit_card';
$o2$,
  $n2$     and t.kind <> 'credit_card'
     and (p_branch_id is null or t.branch_id = p_branch_id or t.branch_id is null);
$n2$,
  $o3$                          then 'debit' else 'credit' end)::public.acc_side),
$o3$,
  $n3$                          then 'debit' else 'credit' end)::public.acc_side
       and (p_branch_id is null
            or l.document_id in (select bd.id from public.acc_documents bd
                                 where bd.tenant_id = p_tenant_id and bd.branch_id = p_branch_id))),
$n3$,
  $o4$     where r.tenant_id = p_tenant_id and r.active and r.amount_cents is not null
       and (r.next_due_date + make_interval(months => n.k * case r.frequency when 'monthly' then 1
$o4$,
  $n4$     where r.tenant_id = p_tenant_id and r.active and r.amount_cents is not null
       and (p_branch_id is null or r.branch_id = p_branch_id)
       and (r.next_due_date + make_interval(months => n.k * case r.frequency when 'monthly' then 1
$n4$
]);
drop function public.acc_report_cash_projection(uuid,date,integer);
revoke all on function public.acc_report_cash_projection(uuid,date,integer,uuid) from public, anon;
grant execute on function public.acc_report_cash_projection(uuid,date,integer,uuid) to authenticated, service_role;
comment on function public.acc_report_cash_projection(uuid,date,integer,uuid) is
  'Proyección de caja (F.9): por semana, lo que entra de cobrables, lo que sale a pagables y gastos fijos, y el saldo proyectado. INVOKER. Con p_branch_id, el saldo de partida sale de las cajas de esa sucursal y las de todo el bar, y lo que entra y sale, de las partidas de sus comprobantes y de sus gastos fijos; vacío = todo el bar.';

-- acc_report_week_plan: 3 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_week_plan(uuid,date)', array[
  $o1$p_week_start date)
 RETURNS$o1$,
  $n1$p_week_start date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$       and d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')
     group by d.party_id),
$o2$,
  $n2$       and d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')
       and (p_branch_id is null or d.branch_id = p_branch_id)
     group by d.party_id),
$n2$,
  $o3$      from public.acc_report_party_balances(p_tenant_id, null, 'payables') b),
$o3$,
  $n3$      from public.acc_report_party_balances(p_tenant_id => p_tenant_id, p_as_of => null, p_group => 'payables',
                                            p_branch_id => p_branch_id) b),
$n3$,
  $o4$     where b.tenant_id = p_tenant_id and b.week_start = p_week_start)
$o4$,
  $n4$     where b.tenant_id = p_tenant_id and b.week_start = p_week_start
       and (p_branch_id is null or b.branch_id = p_branch_id))
$n4$
]);
drop function public.acc_report_week_plan(uuid,date);
revoke all on function public.acc_report_week_plan(uuid,date,uuid) from public, anon;
grant execute on function public.acc_report_week_plan(uuid,date,uuid) to authenticated, service_role;
comment on function public.acc_report_week_plan(uuid,date,uuid) is
  'Una fila por proveedor con deuda, presupuesto o movimiento en la semana: lo que debe, lo vencido, lo que compró, lo que pagó y lo presupuestado. Con p_branch_id, solo los comprobantes, la deuda y el presupuesto de esa sucursal; vacío = todo el bar.';

-- acc_report_payroll: 2 cambio(s) en el cuerpo
select pg_temp.acc_suc_patch('public.acc_report_payroll(uuid,date)', array[
  $o1$p_month date)
 RETURNS$o1$,
  $n1$p_month date, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS$n1$,
  $o2$           'id', e.id, 'name', e.name, 'pay_frequency', e.pay_frequency, 'active', e.active, 'notes', e.notes,
           'salary_cents', sal.salary_cents,
$o2$,
  $n2$           'id', e.id, 'name', e.name, 'pay_frequency', e.pay_frequency, 'active', e.active, 'notes', e.notes,
           'branch_id', e.branch_id,
           'salary_cents', sal.salary_cents,
$n2$,
  $o3$     and (e.active or exists (select 1 from mov where mov.employee_id = e.id));
$o3$,
  $n3$     and (e.active or exists (select 1 from mov where mov.employee_id = e.id))
     and (p_branch_id is null or e.branch_id = p_branch_id);
$n3$
]);
drop function public.acc_report_payroll(uuid,date);
revoke all on function public.acc_report_payroll(uuid,date,uuid) from public, anon;
grant execute on function public.acc_report_payroll(uuid,date,uuid) to authenticated, service_role;
comment on function public.acc_report_payroll(uuid,date,uuid) is
  'La planilla de Sueldos de un mes: empleados con sueldo, adelantos, pagos y movimientos (solo con comprobante vigente) y el devengamiento del mes. Con p_branch_id, solo los empleados de esa sucursal, con todos sus movimientos (cada empleado trae branch_id y el devengamiento sigue siendo de todo el bar); vacío = todos.';

-- acc_posting_context: 1 cambio(s), misma firma
select pg_temp.acc_suc_patch('public.acc_posting_context(uuid)', array[
  $o1$               'account_code', a.code,
               'balance_cents', case when a.normal_side = 'debit' then coalesce(b.dc, 0) else -coalesce(b.dc, 0) end)
$o1$,
  $n1$               'account_code', a.code,
               'branch_id', t.branch_id,
               'balance_cents', case when a.normal_side = 'debit' then coalesce(b.dc, 0) else -coalesce(b.dc, 0) end)
$n1$
]);

drop function pg_temp.acc_suc_patch(text, text[]);

-- La API toma las firmas nuevas de una.
notify pgrst, 'reload schema';
