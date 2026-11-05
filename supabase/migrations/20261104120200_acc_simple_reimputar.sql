-- Reunión del 29/10/2026 (Silvia, min. 12): «entrar al asiento que originó ese movimiento en el mayor y cambiarle
-- el número de cuenta». Reimputar cambia la cuenta de un renglón de imputación con el mes abierto: no toca importe,
-- proveedor, partidas, IVA ni numeración. Queda quién, cuándo, de qué cuenta a qué cuenta y por qué.
--   · acc_line_reimputations: la historia (solo inserción).
--   · private.acc_tg_deny_change: deja pasar un UPDATE de renglón solo con la marca de esta RPC en la transacción.
--     Nadie más puede escribir esas tablas (sin privilegios para authenticated): la marca no abre nada afuera.
--   · acc_reimpute_line: la RPC. La pueden usar los dueños con acceso y la contadora.
--   · acc_report_imputation_flags: comprobantes cuya cuenta no es la habitual del proveedor o del gasto fijo.
-- Todo aditivo. Reversa: restaurar acc_tg_deny_change de la #3 y borrar lo demás.

create table public.acc_line_reimputations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  document_line_id uuid not null,
  from_account_id uuid not null,
  to_account_id uuid not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint alr_reason_len check (reason is null or char_length(reason) <= 300),
  constraint alr_doc_same_tenant foreign key (document_id, tenant_id)
    references public.acc_documents (id, tenant_id) on delete cascade,
  constraint alr_line_same_tenant foreign key (document_line_id, tenant_id)
    references public.acc_document_lines (id, tenant_id) on delete cascade,
  constraint alr_from_same_tenant foreign key (from_account_id, tenant_id)
    references public.acc_accounts (id, tenant_id),
  constraint alr_to_same_tenant foreign key (to_account_id, tenant_id)
    references public.acc_accounts (id, tenant_id)
);
create index alr_document_idx on public.acc_line_reimputations (tenant_id, document_id, created_at);
create index alr_line_idx on public.acc_line_reimputations (document_line_id, tenant_id);
create index alr_from_idx on public.acc_line_reimputations (from_account_id, tenant_id);
create index alr_to_idx on public.acc_line_reimputations (to_account_id, tenant_id);
create index alr_created_by_idx on public.acc_line_reimputations (created_by) where created_by is not null;
comment on table public.acc_line_reimputations is
  'Historia de reimputaciones: de qué cuenta a qué cuenta pasó un renglón, quién y por qué. Solo inserción, por RPC.';

alter table public.acc_line_reimputations enable row level security;
revoke all on public.acc_line_reimputations from anon, authenticated;
grant select on public.acc_line_reimputations to authenticated;
create policy alr_select_readers on public.acc_line_reimputations
  for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

create or replace function private.acc_tg_deny_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Borrado del bar: la fila de tenants ya no está; dejamos pasar la cascada.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  -- Reinicio antes del primer cierre: solo private.acc_reset_tenant pone esta marca (I.6).
  if tg_op = 'DELETE' and current_setting('acc.reset', true) = old.tenant_id::text then
    return old;
  end if;
  -- Reimputar: solo acc_reimpute_line pone esta marca, y solo para renglones del bar.
  if tg_op = 'UPDATE' and tg_table_name in ('acc_document_lines', 'acc_journal_lines')
     and current_setting('acc.reimpute', true) = old.tenant_id::text then
    return new;
  end if;
  raise exception 'acc_immutable' using errcode = 'P0001', detail = tg_table_name;
end;
$$;

create function public.acc_reimpute_line(p_tenant_id uuid, p_line_id uuid, p_account_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  l public.acc_document_lines;
  d public.acc_documents;
  v_status text;
  v_month date;
  v_old public.acc_accounts;
  v_new public.acc_accounts;
begin
  perform public.acc_assert_reader(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if v_reason is not null and char_length(v_reason) > 300 then
    perform private.acc_raise('reason_required', null);
  end if;

  select * into l from public.acc_document_lines x
   where x.id = p_line_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform private.acc_raise('document_not_found', null);
  end if;
  select * into d from public.acc_documents x where x.id = l.document_id and x.tenant_id = p_tenant_id;
  if d.status <> 'posted' then
    perform private.acc_raise('document_voided', null);
  end if;
  select p.status, p.month into v_status, v_month from public.acc_periods p where p.id = d.period_id for share;
  if v_status is distinct from 'open' then
    perform private.acc_raise('period_closed', jsonb_build_object('month', to_char(v_month, 'YYYY-MM')));
  end if;

  -- Solo renglones de imputación: nunca una caja, una partida de proveedor ni el IVA.
  if l.role not in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax', 'manual', 'counterpart')
     and not (l.role = 'other_tax' and d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note')) then
    perform private.acc_raise('line_not_reimputable', jsonb_build_object('role', l.role));
  end if;
  select * into v_old from public.acc_accounts a where a.id = l.account_id and a.tenant_id = p_tenant_id;
  if v_old.is_treasury or v_old.requires_party or l.party_id is not null then
    perform private.acc_raise('line_not_reimputable', jsonb_build_object('role', l.role));
  end if;

  select * into v_new from public.acc_accounts a where a.id = p_account_id and a.tenant_id = p_tenant_id;
  if not found then
    perform private.acc_raise('account_not_found', null);
  end if;
  if not v_new.postable or not v_new.active or v_new.is_treasury or v_new.requires_party then
    perform private.acc_raise('line_account_invalid', jsonb_build_object('code', v_new.code));
  end if;
  if v_new.id = v_old.id then
    perform private.acc_raise('account_unchanged', null);
  end if;

  perform set_config('acc.reimpute', p_tenant_id::text, true);
  update public.acc_document_lines x
     set account_id = v_new.id,
         memo = case when x.memo = v_old.name then v_new.name else x.memo end
   where x.id = l.id and x.tenant_id = p_tenant_id;
  update public.acc_journal_lines x
     set account_id = v_new.id,
         memo = case when x.memo = v_old.name then v_new.name else x.memo end
   where x.document_line_id = l.id and x.tenant_id = p_tenant_id;
  perform set_config('acc.reimpute', '', true);

  v_name := private.acc_actor_name(p_tenant_id, v_uid);
  insert into public.acc_line_reimputations (tenant_id, document_id, document_line_id, from_account_id, to_account_id,
                                             reason, created_by, created_by_name)
  values (p_tenant_id, d.id, l.id, v_old.id, v_new.id, v_reason, v_uid, v_name);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_document.reimputed', 'acc_documents', d.id,
    jsonb_build_object('line_id', l.id, 'from', v_old.code, 'to', v_new.code));

  return jsonb_build_object('document_id', d.id, 'line_id', l.id,
    'from', jsonb_build_object('id', v_old.id, 'code', v_old.code, 'name', v_old.name),
    'to', jsonb_build_object('id', v_new.id, 'code', v_new.code, 'name', v_new.name));
end;
$$;
comment on function public.acc_reimpute_line(uuid, uuid, uuid, text) is
  'Cambia la cuenta de un renglón de imputación de un comprobante vigente con el mes abierto, con historia y auditoría. La usan dueños con acceso y la contadora.';
revoke all on function public.acc_reimpute_line(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.acc_reimpute_line(uuid, uuid, uuid, text) to authenticated;

-- «La factura de EPEC cayó en Agua»: renglones cuya cuenta no es la habitual de su proveedor o de su gasto fijo.
create function public.acc_report_imputation_flags(p_tenant_id uuid, p_from date, p_to date)
returns table (
  document_id uuid, document_line_id uuid, accounting_date date, seq bigint, description text,
  party_name text, amount_cents bigint, account_id uuid, account_code text, account_name text,
  usual_account_id uuid, usual_account_code text, usual_account_name text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.acc_assert_reader(p_tenant_id);
  return query
  select d.id, l.id, d.accounting_date, d.seq, d.description, coalesce(d.party_name_snapshot, r.name),
         l.amount_cents, a.id, a.code, a.name, u.id, u.code, u.name
    from public.acc_document_lines l
    join public.acc_documents d on d.id = l.document_id and d.tenant_id = l.tenant_id
    join public.acc_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
    left join public.acc_parties p on p.id = d.party_id and p.tenant_id = d.tenant_id
    left join public.acc_recurring_expenses r on r.id = d.recurring_expense_id and r.tenant_id = d.tenant_id
    join public.acc_accounts u on u.id = coalesce(p.default_account_id, r.account_id) and u.tenant_id = d.tenant_id
   where l.tenant_id = p_tenant_id
     and d.status = 'posted'
     and d.accounting_date between p_from and p_to
     and l.role in ('net', 'gross', 'non_taxed', 'exempt', 'internal_tax')
     and u.id <> a.id
     and u.active
   order by d.accounting_date desc, d.seq desc
   limit 200;
end;
$$;
comment on function public.acc_report_imputation_flags(uuid, date, date) is
  'Renglones de imputación de un período cuya cuenta difiere de la habitual del proveedor o del gasto fijo: lo que la contadora quiere revisar.';
revoke all on function public.acc_report_imputation_flags(uuid, date, date) from public, anon;
grant execute on function public.acc_report_imputation_flags(uuid, date, date) to authenticated;
