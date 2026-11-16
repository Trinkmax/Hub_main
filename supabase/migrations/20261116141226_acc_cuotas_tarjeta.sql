-- Pedido de los socios del 16/11/2026: «en medio de pago, cuota como una opción individual». Al pagar una compra o
-- un gasto con una tarjeta de crédito, se puede decir en cuántas cuotas se pagó.
--   · acc_card_installments: en cuántas cuotas va el comprobante que sacó la plata de una tarjeta.
--   · acc_set_card_installments: lo anota para el comprobante de un paquete recién guardado que pagó con tarjeta.
-- Todo aditivo: no toca ningún comprobante ni mueve saldos. La deuda con la tarjeta sigue entrando entera el día
-- de la compra, como hasta hoy; las cuotas son el dato de cómo se va a pagar.

create table public.acc_card_installments (
  document_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  installments smallint not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aci_range check (installments between 2 and 48),
  constraint aci_document_same_tenant foreign key (document_id, tenant_id)
    references public.acc_documents (id, tenant_id) on delete cascade
);
create index aci_tenant_idx on public.acc_card_installments (tenant_id);
create index aci_created_by_idx on public.acc_card_installments (created_by) where created_by is not null;
comment on table public.acc_card_installments is
  'En cuántas cuotas se pagó con tarjeta de crédito un comprobante. Se escribe solo por RPC. No es contable: no mueve saldos.';

alter table public.acc_card_installments enable row level security;
revoke all on public.acc_card_installments from anon, authenticated;
grant select on public.acc_card_installments to authenticated;
create policy aci_select_readers on public.acc_card_installments
  for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));

create function public.acc_set_card_installments(p_tenant_id uuid, p_bundle_id uuid, p_installments integer)
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
  if p_bundle_id is null or p_installments is null or p_installments not between 1 and 48 then
    perform private.acc_raise('invalid_payload', '{"field":"installments"}');
  end if;
  for r in
    select d.id
      from public.acc_documents d
     where d.tenant_id = p_tenant_id and d.bundle_id = p_bundle_id and d.status = 'posted'
       and exists (
         select 1
           from public.acc_document_lines l
           join public.acc_treasury_accounts t on t.id = l.treasury_account_id and t.tenant_id = d.tenant_id
          where l.document_id = d.id and l.tenant_id = d.tenant_id and t.kind = 'credit_card'
       )
  loop
    if p_installments = 1 then
      delete from public.acc_card_installments c where c.document_id = r.id and c.tenant_id = p_tenant_id;
    else
      insert into public.acc_card_installments (document_id, tenant_id, installments, created_by)
      values (r.id, p_tenant_id, p_installments, v_uid)
      on conflict (document_id) do update
        set installments = excluded.installments, updated_at = now();
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_card_installments.set', 'acc_documents', null,
      jsonb_build_object('bundle_id', p_bundle_id, 'installments', p_installments, 'documents', v_n));
  end if;
  return jsonb_build_object('documents', v_n);
end;
$$;
comment on function public.acc_set_card_installments(uuid, uuid, integer) is
  'Anota en cuántas cuotas se pagó con tarjeta de crédito lo de un paquete recién guardado (1 = un solo pago). Solo quien escribe en Administración de ese bar. Si el paquete no pagó con tarjeta, no hace nada.';
revoke all on function public.acc_set_card_installments(uuid, uuid, integer) from public, anon;
grant execute on function public.acc_set_card_installments(uuid, uuid, integer) to authenticated;
