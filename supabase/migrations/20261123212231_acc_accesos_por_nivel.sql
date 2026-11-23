-- ============================================================
-- Administración · accesos por nivel: «completo» y «solo compras y pagos»
-- ============================================================
-- Pedido de los socios (22/11/2026): «dentro de administración, los empleados solo deberían poder
-- ver compra y pagos», «todos los socios deben poder dar accesos» y «prioriza el acceso a la
-- información de los empleados».
--
-- Qué trae:
--   1. Cada acceso tiene un nivel (`acc_access.scope`): `full` (todo, como hasta hoy) o `purchases`
--      (solo compras y pagos). Los accesos que ya existen quedan en `full`: nadie pierde nada.
--   2. CERRADO POR DEFECTO. «Leer Administración» y «cargar en Administración» pasan a exigir el
--      nivel completo (`acc_reader_tenant_ids`, `acc_writer_tenant_ids`). Con eso, quien tiene «solo
--      compras y pagos» queda afuera de las 45 tablas y de las ~110 funciones, y después se le abre
--      A MANO lo de compras:
--        · filas: proveedores, sus movimientos de cuenta corriente, los comprobantes de compra, gasto
--          y pago con sus renglones y adjuntos, el plan de cuentas y los nombres de las cajas;
--        · lecturas: las 7 funciones que usan los formularios de compra y la cuenta del proveedor
--          (todas corren con los permisos de quien llama: devuelven solo las filas de arriba; el saldo
--          de las cajas le da cero porque no ve sus movimientos);
--        · cargas: compras, gastos y pagos a proveedores (`acc_assert_poster`), imputar un pago,
--          cuotas, alta de proveedores, adjuntos y links de foto.
--      No ve ni toca: ventas, cierres, sueldos, gastos fijos, saldos y movimientos de las cajas,
--      resumen, libros, ajustes, importar, anular.
--   3. Quien da accesos elige el nivel (`acc_set_access`). Dar accesos pide el nivel completo.
--
-- Se parchan sobre su definición vigente (cada fragmento tiene que aparecer una sola vez):
-- `acc_reader_tenant_ids`, `acc_writer_tenant_ids`, `acc_my_access`, `acc_platform_designate_admin`,
-- `private.acc_assert_poster`, `acc_post_bundle` (un dato de un aviso) y las 14 funciones que se abren.
-- No agrega claves foráneas. No borra nada.

set local lock_timeout = '5s';

-- Parcha una función por su nombre (tiene que haber una sola con ese nombre): el fragmento viejo tiene
-- que aparecer exactamente una vez.
create function pg_temp.acc_lvl_patch(p_name text, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_n integer;
  v_oid oid;
  v_def text;
  v_hits integer;
begin
  select count(*), min(p.oid) into v_n, v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = split_part(p_name, '.', 1) and p.proname = split_part(p_name, '.', 2);
  if v_n <> 1 then
    raise exception 'acc_lvl_patch: % tiene % definiciones (tenía que ser una)', p_name, v_n;
  end if;
  v_def := pg_get_functiondef(v_oid);
  v_hits := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_hits <> 1 then
    raise exception 'acc_lvl_patch: el fragmento aparece % veces en % (tenía que ser una)', v_hits, p_name;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El nivel
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.acc_access
  add column scope text not null default 'full',
  add constraint aax_scope check (scope in ('full', 'purchases')),
  -- Dar accesos es cosa de socios: pide el nivel completo.
  add constraint aax_admin_full check (not is_admin or scope = 'full');
comment on column public.acc_access.scope is
  'El nivel del acceso: full (todo Administración) o purchases (solo compras y pagos).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quién es quién
-- ─────────────────────────────────────────────────────────────────────────────
-- Leer y cargar TODO: desde ahora, solo con el nivel completo.
select pg_temp.acc_lvl_patch(
  'public.acc_reader_tenant_ids',
  $old$where a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null)))$old$,
  $new$where a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null
                   and a.scope = 'full')))$new$
);
select pg_temp.acc_lvl_patch(
  'public.acc_writer_tenant_ids',
  $old$join public.acc_access a on a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null$old$,
  $new$join public.acc_access a on a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null
                             and a.scope = 'full'$new$
);

-- Los bares donde tengo «solo compras y pagos» (dueño con acceso vigente de ese nivel).
create function public.acc_buyer_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    join public.acc_access a on a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null
                             and a.scope = 'purchases'
   where m.user_id = (select auth.uid()) and m.role = 'owner'
     and t.feature_flags -> 'accounting' = 'true'::jsonb
$$;

-- Entra a Compras y pagos: quien lee todo (dueño con acceso completo, contadora) o quien tiene «solo
-- compras y pagos».
create function public.acc_assert_buyer(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null
     or (p_tenant not in (select public.acc_reader_tenant_ids())
         and p_tenant not in (select public.acc_buyer_tenant_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Carga compras y pagos: dueño con acceso vigente, del nivel que sea (y el bar configurado).
create function public.acc_assert_buyer_writer(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null
     or (p_tenant not in (select public.acc_writer_tenant_ids())
         and p_tenant not in (select public.acc_buyer_tenant_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant) then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
end;
$$;

-- Lo que la app pregunta en cada carga: suma el nivel y las dos llaves de Compras y pagos. `read` y
-- `write` pasan a ser del nivel completo. (Primero `write`: el parche de `read` agrega un renglón que
-- se le parece.)
select pg_temp.acc_lvl_patch(
  'public.acc_my_access',
  $old$coalesce(t.enabled and s.set_up and me.role = 'owner' and g.mine, false),$old$,
  $new$coalesce(t.enabled and s.set_up and me.role = 'owner' and g.mine_full, false),$new$
);
select pg_temp.acc_lvl_patch(
  'public.acc_my_access',
  $old$(me.role = 'owner' and g.mine)), false),$old$,
  $new$(me.role = 'owner' and g.mine_full)), false),
    'buy_read',   coalesce(t.enabled and s.set_up and (me.role = 'accountant' or (me.role = 'owner' and g.mine)), false),
    'buy_write',  coalesce(t.enabled and s.set_up and me.role = 'owner' and g.mine, false),
    'scope',      case when me.role = 'owner' then g.my_scope end,$new$
);
select pg_temp.acc_lvl_patch(
  'public.acc_my_access',
  $old$g as (select coalesce(bool_or(a.user_id = (select auth.uid())), false) as mine,$old$,
  $new$g as (select coalesce(bool_or(a.user_id = (select auth.uid())), false) as mine,
                    coalesce(bool_or(a.user_id = (select auth.uid()) and a.scope = 'full'), false) as mine_full,
                    max(a.scope) filter (where a.user_id = (select auth.uid())) as my_scope,$new$
);

-- Soporte designa a un administrador: siempre con el nivel completo.
select pg_temp.acc_lvl_patch(
  'public.acc_platform_designate_admin',
  $old$update public.acc_access set is_admin = true where id = v_row.id returning * into v_row;$old$,
  $new$update public.acc_access set is_admin = true, scope = 'full' where id = v_row.id returning * into v_row;$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dar un acceso eligiendo el nivel
-- ─────────────────────────────────────────────────────────────────────────────
-- Función nueva (`acc_grant_access` queda igual para la app que todavía la usa: da el nivel completo
-- y no cambia el de quien ya tiene acceso).
create function public.acc_set_access(
  p_tenant_id uuid,
  p_user_id uuid,
  p_scope text,
  p_is_admin boolean default false,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_scope text := coalesce(p_scope, 'full');
  v_admin boolean := coalesce(p_is_admin, false);
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_row public.acc_access;
  v_before public.acc_access;
  v_created boolean := false;
begin
  perform public.acc_assert_admin(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  if v_scope not in ('full', 'purchases') then
    raise exception 'scope_invalid' using errcode = 'P0001';
  end if;
  if v_admin and v_scope <> 'full' then
    raise exception 'admin_needs_full' using errcode = 'P0001';
  end if;
  if p_user_id is null or not exists (
       select 1 from public.memberships m
        where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.role = 'owner') then
    raise exception 'target_not_owner' using errcode = 'P0001';
  end if;

  select * into v_before from public.acc_access a
   where a.tenant_id = p_tenant_id and a.user_id = p_user_id and a.revoked_at is null
   for update;
  if found then
    v_name := coalesce(v_name, v_before.display_name);
  else
    v_name := coalesce(v_name, private.acc_default_display_name(p_tenant_id, p_user_id));
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;

  if v_before.id is not null then
    -- Sacarle «Da accesos» al último que los da dejaría el bar sin nadie que dé accesos.
    if v_before.is_admin and not v_admin and not exists (
         select 1 from public.acc_access a
           join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
          where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin and a.id <> v_before.id) then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
    update public.acc_access set scope = v_scope, is_admin = v_admin, display_name = v_name
     where id = v_before.id
     returning * into v_row;
  else
    insert into public.acc_access (tenant_id, user_id, display_name, is_admin, scope, source, granted_by, granted_by_name)
    values (p_tenant_id, p_user_id, v_name, v_admin, v_scope, 'grant', v_uid, private.acc_actor_name(p_tenant_id, v_uid))
    returning * into v_row;
    v_created := true;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_access.granted', 'acc_access', v_row.id,
    jsonb_build_object('user_id', p_user_id, 'is_admin', v_row.is_admin, 'scope', v_row.scope,
                       'scope_before', v_before.scope, 'source', v_row.source));

  return jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'display_name', v_row.display_name, 'is_admin', v_row.is_admin,
    'scope', v_row.scope, 'source', v_row.source, 'granted_at', v_row.granted_at, 'created', v_created);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Las filas que ve «solo compras y pagos»
-- ─────────────────────────────────────────────────────────────────────────────
-- Una política más por tabla, solo para ese nivel (a quien lee todo no le cambia nada). Las
-- subconsultas corren con los permisos de quien mira: se encadenan sin dar vueltas
-- (proveedores → movimientos → asientos y comprobantes → renglones y adjuntos).

-- Los proveedores (los demás partícipes no: clientes, bancos, organismos, personal, socios).
create policy apt_select_buyers on public.acc_parties for select to authenticated
  using (kind = 'supplier' and tenant_id in (select public.acc_buyer_tenant_ids()));

-- La cuenta corriente de cada proveedor, completa (compras, pagos, saldo inicial, ajustes).
create policy ajl_select_buyers on public.acc_journal_lines for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and party_id in (select p.id from public.acc_parties p));

-- El encabezado de los asientos de esos movimientos (los informes miran si están vigentes).
create policy aje_select_buyers on public.acc_journal_entries for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and id in (select l.entry_id from public.acc_journal_lines l));

-- Los comprobantes: compras, notas y pagos de un proveedor; gastos sueltos sin proveedor (no los de
-- un gasto fijo); y cualquier otro que mueva la cuenta de un proveedor (un saldo inicial).
create policy adoc_select_buyers on public.acc_documents for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and ((kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')
               and (party_id in (select p.id from public.acc_parties p)
                    or (party_id is null and recurring_expense_id is null)))
              or id in (select l.document_id from public.acc_journal_lines l)));

-- Los renglones: todos los de una compra, un gasto o un pago que ve; de los demás, solo el del proveedor.
create policy adl_select_buyers on public.acc_document_lines for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and (party_id in (select p.id from public.acc_parties p)
              or document_id in (
                select d.id from public.acc_documents d
                 where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment'))));

-- Qué pago canceló qué factura.
create policy aal_select_buyers on public.acc_allocations for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and party_id in (select p.id from public.acc_parties p));

-- Los datos fiscales, los adjuntos y las cuotas de las compras, gastos y pagos que ve.
create policy afv_select_buyers on public.acc_fiscal_vouchers for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and document_id in (
           select d.id from public.acc_documents d
            where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')));
create policy adat_select_buyers on public.acc_document_attachments for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and document_id in (
           select d.id from public.acc_documents d
            where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')));
create policy aci_select_buyers on public.acc_card_installments for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids())
         and document_id in (
           select d.id from public.acc_documents d
            where d.kind in ('purchase', 'purchase_debit_note', 'purchase_credit_note', 'expense', 'payment')));

-- Lo que un formulario de compra necesita para armarse: el plan de cuentas (nombres), las cajas
-- (nombres: sus movimientos no los ve), los datos del bar y los meses cerrados. Sin importes.
create policy aac_select_buyers on public.acc_accounts for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids()));
create policy atr_select_buyers on public.acc_treasury_accounts for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids()));
create policy ast_select_buyers on public.acc_settings for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids()));
create policy aper_select_buyers on public.acc_periods for select to authenticated
  using (tenant_id in (select public.acc_buyer_tenant_ids()));

-- Las fotos de los comprobantes: sube a la carpeta del bar; ve las que subió y las de los
-- comprobantes que ve; borra solo las que subió.
alter policy acc_comprobantes_writer_insert on storage.objects
  with check (
    bucket_id = 'acc-comprobantes'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|avif|heic|heif|pdf)$'
    and ((storage.foldername(name))[1] in (select w.id::text from public.acc_writer_tenant_ids() w(id))
         or (storage.foldername(name))[1] in (select b.id::text from public.acc_buyer_tenant_ids() b(id))));
alter policy acc_comprobantes_reader_select on storage.objects
  using (
    bucket_id = 'acc-comprobantes'
    and ((storage.foldername(name))[1] in (select r.id::text from public.acc_reader_tenant_ids() r(id))
         or ((storage.foldername(name))[1] in (select b.id::text from public.acc_buyer_tenant_ids() b(id))
             and (owner_id = (select auth.uid())::text
                  or name in (select a.storage_path from public.acc_document_attachments a)))));
alter policy acc_comprobantes_writer_delete on storage.objects
  using (
    bucket_id = 'acc-comprobantes'
    and ((storage.foldername(name))[1] in (select w.id::text from public.acc_writer_tenant_ids() w(id))
         or ((storage.foldername(name))[1] in (select b.id::text from public.acc_buyer_tenant_ids() b(id))
             and owner_id = (select auth.uid())::text)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Las lecturas que se abren
-- ─────────────────────────────────────────────────────────────────────────────
-- Las siete corren con los permisos de quien llama: a «solo compras y pagos» le devuelven lo que las
-- políticas de arriba le dejan ver, y nada más.
select pg_temp.acc_lvl_patch(f.fn, 'perform public.acc_assert_reader(p_tenant_id);', 'perform public.acc_assert_buyer(p_tenant_id);')
  from (values
    ('public.acc_posting_context'),
    ('public.acc_form_defaults'),
    ('public.acc_quick_expense_suggestions'),
    ('public.acc_possible_duplicate'),
    ('public.acc_report_party_balances'),
    ('public.acc_report_party_statement'),
    ('public.acc_report_open_items')
  ) as f(fn);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Las cargas que se abren
-- ─────────────────────────────────────────────────────────────────────────────
-- 6.1 Guardar comprobantes: compras, notas, gastos sueltos y pagos, siempre de un proveedor (o sin
--     partícipe), sin atarlos a un gasto fijo ni reemplazar o corregir otro comprobante.
select pg_temp.acc_lvl_patch(
  'private.acc_assert_poster',
  $old$    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';$old$,
  $new$    return;
  end if;
  if p_tenant in (select public.acc_buyer_tenant_ids())
     and exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant)
     and jsonb_typeof(p_bundle -> 'documents') = 'array'
     and jsonb_array_length(p_bundle -> 'documents') between 1 and 10
     and not exists (
       select 1 from jsonb_array_elements(p_bundle -> 'documents') e
        where jsonb_typeof(e.value) is distinct from 'object'
           or coalesce(e.value ->> 'kind', '') not in ('purchase', 'purchase_debit_note', 'purchase_credit_note',
                                                      'expense', 'payment')
           or coalesce(e.value ->> 'entry_kind', 'standard') <> 'standard'
           or e.value ->> 'recurring_expense_id' is not null
           or e.value ->> 'replaces_document_id' is not null
           or e.value ->> 'corrects_document_id' is not null
           or e.value -> 'settles_commissions' = 'true'::jsonb
           or (e.value -> 'party' ->> 'id' is not null and not exists (
                 select 1 from public.acc_parties bp
                  where bp.id = private.acc_to_uuid(e.value -> 'party' ->> 'id')
                    and bp.tenant_id = p_tenant and bp.kind = 'supplier')))
     and not exists (
       select 1 from jsonb_array_elements(coalesce(nullif(p_bundle -> 'new_parties', 'null'::jsonb), '[]'::jsonb)) np
        where np.value ->> 'kind' is distinct from 'supplier') then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501';$new$
);

-- El aviso «la caja queda en negativo» le llega sin el importe (no ve los saldos).
select pg_temp.acc_lvl_patch(
  'public.acc_post_bundle',
  $old$'balance_after_cents', v_bal$old$,
  $new$'balance_after_cents', case when p_tenant_id in (select public.acc_buyer_tenant_ids()) then null else v_bal end$new$
);

-- 6.2 Imputar un pago a una factura: solo entre movimientos de un proveedor.
select pg_temp.acc_lvl_patch(
  'public.acc_allocate',
  'perform public.acc_assert_writer(p_tenant_id);',
  'perform public.acc_assert_buyer_writer(p_tenant_id);'
);
select pg_temp.acc_lvl_patch(
  'public.acc_allocate',
  $old$    insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents, kind,$old$,
  $new$    if p_tenant_id in (select public.acc_buyer_tenant_ids())
       and not exists (select 1 from public.acc_parties bp
                        where bp.id = coalesce(dl.party_id, cl.party_id) and bp.tenant_id = p_tenant_id
                          and bp.kind = 'supplier'
                          and dl.party_id is not distinct from cl.party_id) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    insert into public.acc_allocations (tenant_id, account_id, party_id, debit_line_id, credit_line_id, amount_cents, kind,$new$
);

-- 6.3 Alta y edición de proveedores (ningún otro partícipe, ni los que vienen con el sistema).
select pg_temp.acc_lvl_patch(
  'public.acc_save_party',
  $old$  perform public.acc_assert_writer(p_tenant_id);$old$,
  $new$  perform public.acc_assert_buyer_writer(p_tenant_id);
  if p_tenant_id in (select public.acc_buyer_tenant_ids()) and (
       jsonb_typeof(p_party) is distinct from 'object'
       or (not (p_party ? 'id') and p_party ->> 'kind' is distinct from 'supplier')
       or (p_party ? 'kind' and p_party ->> 'kind' is distinct from 'supplier')
       or (p_party ? 'id' and not exists (
             select 1 from public.acc_parties bp
              where bp.id = private.acc_to_uuid(p_party ->> 'id') and bp.tenant_id = p_tenant_id
                and bp.kind = 'supplier' and bp.system_key is null))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;$new$
);

-- 6.4 Adjuntar la foto a un comprobante de compra, gasto o pago.
select pg_temp.acc_lvl_patch(
  'public.acc_attach_document_file',
  'perform public.acc_assert_writer(p_tenant_id);',
  'perform public.acc_assert_buyer_writer(p_tenant_id);'
);
select pg_temp.acc_lvl_patch(
  'public.acc_attach_document_file',
  $old$where d.id = p_document_id and d.tenant_id = p_tenant_id) then$old$,
  $new$where d.id = p_document_id and d.tenant_id = p_tenant_id
                                             and (p_tenant_id not in (select public.acc_buyer_tenant_ids())
                                                  or d.kind in ('purchase', 'purchase_debit_note',
                                                                'purchase_credit_note', 'expense', 'payment'))) then$new$
);

-- 6.5 Las cuotas de un pago con tarjeta y los links para mandar la foto desde el celular.
select pg_temp.acc_lvl_patch(f.fn, 'perform public.acc_assert_writer(p_tenant_id);', 'perform public.acc_assert_buyer_writer(p_tenant_id);')
  from (values
    ('public.acc_set_card_installments'),
    ('public.acc_upload_link_create'),
    ('public.acc_upload_link_close'),
    ('public.acc_upload_link_files_list')
  ) as f(fn);

revoke all on function public.acc_buyer_tenant_ids() from public, anon;
revoke all on function public.acc_assert_buyer(uuid) from public, anon;
revoke all on function public.acc_assert_buyer_writer(uuid) from public, anon;
revoke all on function public.acc_set_access(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.acc_buyer_tenant_ids() to authenticated;
grant execute on function public.acc_assert_buyer(uuid) to authenticated;
grant execute on function public.acc_assert_buyer_writer(uuid) to authenticated;
grant execute on function public.acc_set_access(uuid, uuid, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
