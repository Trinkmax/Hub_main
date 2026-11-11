-- Compras: lo que pidió Tomás el 11/11/2026 (docs/features/compras.md › «Plazos de los eventos» y
-- «Proveedores: una sola ficha»).
--   1. Ajustes: la mercadería tiene que llegar N días antes del evento (arrive_days_before, 2) y cada día de
--      conteo cubre los eventos hasta un día fijo (count_windows: el domingo hasta el jueves, el miércoles
--      hasta el lunes). Un día sin ventana fijada la calcula la app.
--   2. Un proveedor de Compras puede facturar con varias razones sociales de Administración (Vittis):
--      pur_supplier_parties reemplaza a pur_suppliers.acc_party_id, que queda vacía y sin uso.
--   3. Los datos para pedirle se cargan una sola vez. Los días de entrega y la anticipación quedan iguales en
--      Compras y en todas sus razones sociales de Administración, cambien donde cambien. El WhatsApp de Compras
--      y el teléfono de Administración se completan uno con otro y se siguen mientras sean el mismo número: si
--      Administración tiene otro número a propósito (el de quien factura), no se pisa.
-- Todo aditivo: dos columnas con default, una tabla, funciones y triggers nuevos. Al pasar las uniones que ya
-- estaban (acc_party_id) se completan los datos que falten de cada lado.

-- ─── 1. Ajustes ──────────────────────────────────────────────────────────────
alter table public.pur_settings
  add column arrive_days_before smallint not null default 2
    check (arrive_days_before between 0 and 7),
  add column count_windows jsonb not null default '{}'::jsonb
    check (jsonb_typeof(count_windows) = 'object');
comment on column public.pur_settings.arrive_days_before is
  'La mercadería tiene que llegar estos días antes del evento (HUB: 2). Con eso se calcula hasta cuándo pedirle a cada proveedor.';
comment on column public.pur_settings.count_windows is
  'Por día de conteo (0 = domingo), cuántos días después termina su ventana de eventos: {"0": 4, "3": 5} = el domingo hasta el jueves y el miércoles hasta el lunes. Lo valida la app.';

-- ─── 2. Las razones sociales de un proveedor ─────────────────────────────────
create table public.pur_supplier_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  acc_party_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pur_supplier_parties_supplier_fk foreign key (supplier_id, tenant_id)
    references public.pur_suppliers (id, tenant_id) on delete cascade,
  constraint pur_supplier_parties_party_fk foreign key (acc_party_id, tenant_id)
    references public.acc_parties (id, tenant_id) on delete cascade,
  -- Cada razón social va con un solo proveedor de Compras.
  constraint pur_supplier_parties_one_supplier unique (tenant_id, acc_party_id)
);
create index pur_supplier_parties_supplier_idx on public.pur_supplier_parties (supplier_id, tenant_id);
create index pur_supplier_parties_created_by_idx on public.pur_supplier_parties (created_by)
  where created_by is not null;
comment on table public.pur_supplier_parties is
  'Las razones sociales de Administración (acc_parties) con las que factura un proveedor de Compras. Una unión no se edita: se agrega o se borra.';

alter table public.pur_supplier_parties enable row level security;
create policy pur_supplier_parties_read on public.pur_supplier_parties for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
-- Unir es del dueño que además escribe en Administración: al unir se completan datos de la ficha de allá.
create policy pur_supplier_parties_owner_insert on public.pur_supplier_parties for insert to authenticated
  with check (
    public.user_role_in_tenant(tenant_id) = 'owner'
    and tenant_id in (select public.acc_writer_tenant_ids())
  );
create policy pur_supplier_parties_owner_delete on public.pur_supplier_parties for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');
grant select, insert, delete on public.pur_supplier_parties to authenticated;

-- ─── 3. Días y teléfonos de un lado al otro ──────────────────────────────────
-- Compras guarda los días 0 = domingo … 6 = sábado; Administración, 1 = lunes … 7 = domingo.
create function private.pur_days_to_acc(p_days smallint[])
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s.d order by s.d), '{}'::smallint[])
    from (select distinct (case when x = 0 then 7 else x end)::smallint as d
            from unnest(p_days) as x) s
$$;

create function private.acc_days_to_pur(p_days smallint[])
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(s.d order by s.d), '{}'::smallint[])
    from (select distinct (case when x = 7 then 0 else x end)::smallint as d
            from unnest(p_days) as x) s
$$;

-- El WhatsApp de Compras (los dígitos con el país: 5493511234567) a partir de un teléfono escrito a mano. Es la
-- cuenta de normalizePhone (lib/phone.ts): 10 dígitos son un celular de Argentina (+54 9), el 0 y el 15 viejos se
-- sacan, con + se respeta el país. Lo que no entiende devuelve null y no se copia.
create function private.pur_whatsapp_from_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_phone, ''));
  v_plus boolean;
  v text;
  v_area int;
begin
  if v_raw = '' then
    return null;
  end if;
  v_plus := left(v_raw, 1) = '+';
  -- Solo dígitos y los separadores de siempre: lo demás no se adivina.
  if regexp_replace(v_raw, '^\+', '') !~ '^[0-9[:space:]().-]+$' then
    return null;
  end if;
  v := regexp_replace(v_raw, '[^0-9]', '', 'g');

  if v_plus and left(v, 2) <> '54' then
    return case when length(v) between 8 and 15 then v end;
  elsif left(v, 2) = '54' and (v_plus or length(v) between 12 and 13) then
    v := substr(v, 3);
  elsif left(v, 1) = '0' then
    v := substr(v, 2);
  elsif length(v) = 10 then
    return '54' || case when left(v, 1) = '9' then v else '9' || v end;
  elsif length(v) = 11 and left(v, 1) = '9' then
    return '54' || v;
  else
    return null;
  end if;

  -- Lo que queda es el número de Argentina sin el país: <área>15<número> → sin el 15.
  if length(v) = 12 then
    foreach v_area in array array[4, 3, 2] loop
      if substr(v, v_area + 1, 2) = '15' then
        v := left(v, v_area) || substr(v, v_area + 3);
        exit;
      end if;
    end loop;
  end if;
  if left(v, 1) = '9' then
    return case when length(v) = 11 then '54' || v end;
  end if;
  return case when length(v) = 10 then '549' || v end;
end;
$$;

-- El teléfono que va a Administración desde el WhatsApp de Compras: los 10 dígitos de un celular de Argentina
-- (3511234567, como están cargados allá) o, de otro país, con el +.
create function private.pur_phone_from_whatsapp(p_whatsapp text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_whatsapp is null or p_whatsapp = '' then null
    when p_whatsapp ~ '^549[0-9]{10}$' then substr(p_whatsapp, 4)
    else '+' || p_whatsapp
  end
$$;

-- La anticipación que va a Administración: la de Compras, salvo que allá haya más de 14 días (Compras llega
-- hasta 14 y un 14 recortado no pisa, por ejemplo, un 30).
create function private.pur_lead_to_acc(p_compras smallint, p_acc smallint)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case when p_compras = 14 and p_acc > 14 then p_acc else p_compras end
$$;

-- ─── 4. Compras → Administración ─────────────────────────────────────────────
create function private.pur_supplier_sync_parties()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lo que llega desde Administración (otro trigger) no vuelve: ya está igual en los dos lados.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.acc_parties p
     set delivery_days = private.pur_days_to_acc(new.delivery_weekdays),
         order_lead_days = private.pur_lead_to_acc(new.lead_days, p.order_lead_days),
         phone = case
           when new.whatsapp is distinct from old.whatsapp
                and (p.phone is null
                     or (old.whatsapp is not null
                         and private.pur_whatsapp_from_phone(p.phone) = old.whatsapp))
             then private.pur_phone_from_whatsapp(new.whatsapp)
           else p.phone
         end,
         updated_by = coalesce((select auth.uid()), p.updated_by)
    from public.pur_supplier_parties l
   where l.supplier_id = new.id
     and l.tenant_id = new.tenant_id
     and p.id = l.acc_party_id
     and p.tenant_id = l.tenant_id
     and (p.delivery_days is distinct from private.pur_days_to_acc(new.delivery_weekdays)
          or p.order_lead_days is distinct from private.pur_lead_to_acc(new.lead_days, p.order_lead_days)
          or (new.whatsapp is distinct from old.whatsapp
              and (p.phone is null
                   or (old.whatsapp is not null
                       and private.pur_whatsapp_from_phone(p.phone) = old.whatsapp))
              and p.phone is distinct from private.pur_phone_from_whatsapp(new.whatsapp)));
  return null;
end;
$$;

create trigger pur_suppliers_sync_parties
  after update of delivery_weekdays, lead_days, whatsapp on public.pur_suppliers
  for each row execute function private.pur_supplier_sync_parties();

-- ─── 5. Administración → Compras (y las otras razones sociales del mismo proveedor) ─
create function private.acc_party_sync_supplier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  select l.supplier_id into v_supplier
    from public.pur_supplier_parties l
   where l.acc_party_id = new.id and l.tenant_id = new.tenant_id;
  if v_supplier is null then
    return null;
  end if;

  if new.delivery_days is distinct from old.delivery_days
     or new.order_lead_days is distinct from old.order_lead_days then
    update public.pur_suppliers s
       set delivery_weekdays = private.acc_days_to_pur(new.delivery_days),
           lead_days = coalesce(least(new.order_lead_days, 14), s.lead_days),
           updated_by = coalesce((select auth.uid()), s.updated_by)
     where s.id = v_supplier
       and s.tenant_id = new.tenant_id
       and (s.delivery_weekdays is distinct from private.acc_days_to_pur(new.delivery_days)
            or s.lead_days is distinct from coalesce(least(new.order_lead_days, 14), s.lead_days));
    -- Las otras razones sociales del mismo proveedor: los mismos días y la misma anticipación.
    update public.acc_parties p
       set delivery_days = new.delivery_days,
           order_lead_days = coalesce(new.order_lead_days, p.order_lead_days),
           updated_by = coalesce((select auth.uid()), p.updated_by)
      from public.pur_supplier_parties l
     where l.supplier_id = v_supplier
       and l.tenant_id = new.tenant_id
       and l.acc_party_id <> new.id
       and p.id = l.acc_party_id
       and p.tenant_id = l.tenant_id
       and (p.delivery_days is distinct from new.delivery_days
            or p.order_lead_days is distinct from coalesce(new.order_lead_days, p.order_lead_days));
  end if;

  -- El WhatsApp de Compras sigue al teléfono si estaba vacío o era el mismo número (el de las otras razones
  -- sociales, no: cada una tiene el suyo).
  if new.phone is distinct from old.phone then
    update public.pur_suppliers s
       set whatsapp = private.pur_whatsapp_from_phone(new.phone),
           updated_by = coalesce((select auth.uid()), s.updated_by)
     where s.id = v_supplier
       and s.tenant_id = new.tenant_id
       and (s.whatsapp is null or s.whatsapp = private.pur_whatsapp_from_phone(old.phone))
       and s.whatsapp is distinct from private.pur_whatsapp_from_phone(new.phone);
  end if;
  return null;
end;
$$;

create trigger acc_parties_sync_supplier
  after update of delivery_days, order_lead_days, phone on public.acc_parties
  for each row execute function private.acc_party_sync_supplier();

-- ─── 6. Al unir una razón social: se completa lo que falta de cada lado ──────
-- Los días (con la anticipación) los pone el lado que los tiene. Si los tienen los dos, manda Administración
-- cuando es la primera razón social (es donde se cargó la ficha) y Compras cuando ya había otras (así no cambia
-- lo que ya estaba unido). El teléfono solo se completa donde falta.
create function private.pur_supplier_party_linked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.pur_suppliers;
  v_p public.acc_parties;
  v_first boolean;
  v_wa text;
  v_user uuid := (select auth.uid());
begin
  select * into v_s from public.pur_suppliers s where s.id = new.supplier_id and s.tenant_id = new.tenant_id;
  select * into v_p from public.acc_parties p where p.id = new.acc_party_id and p.tenant_id = new.tenant_id;
  if v_s.id is null or v_p.id is null then
    return null;
  end if;
  v_first := not exists (
    select 1 from public.pur_supplier_parties l
     where l.supplier_id = new.supplier_id and l.tenant_id = new.tenant_id and l.id <> new.id);

  if cardinality(v_p.delivery_days) > 0 and (v_first or cardinality(v_s.delivery_weekdays) = 0) then
    update public.pur_suppliers s
       set delivery_weekdays = private.acc_days_to_pur(v_p.delivery_days),
           lead_days = coalesce(least(v_p.order_lead_days, 14), s.lead_days),
           updated_by = coalesce(v_user, s.updated_by)
     where s.id = v_s.id
       and s.tenant_id = v_s.tenant_id
       and (s.delivery_weekdays is distinct from private.acc_days_to_pur(v_p.delivery_days)
            or s.lead_days is distinct from coalesce(least(v_p.order_lead_days, 14), s.lead_days));
    update public.acc_parties p
       set delivery_days = v_p.delivery_days,
           order_lead_days = coalesce(v_p.order_lead_days, p.order_lead_days),
           updated_by = coalesce(v_user, p.updated_by)
      from public.pur_supplier_parties l
     where l.supplier_id = v_s.id
       and l.tenant_id = v_s.tenant_id
       and l.acc_party_id <> v_p.id
       and p.id = l.acc_party_id
       and p.tenant_id = l.tenant_id
       and (p.delivery_days is distinct from v_p.delivery_days
            or p.order_lead_days is distinct from coalesce(v_p.order_lead_days, p.order_lead_days));
  elsif cardinality(v_s.delivery_weekdays) > 0 then
    update public.acc_parties p
       set delivery_days = private.pur_days_to_acc(v_s.delivery_weekdays),
           order_lead_days = private.pur_lead_to_acc(v_s.lead_days, p.order_lead_days),
           updated_by = coalesce(v_user, p.updated_by)
     where p.id = v_p.id
       and p.tenant_id = v_p.tenant_id
       and (p.delivery_days is distinct from private.pur_days_to_acc(v_s.delivery_weekdays)
            or p.order_lead_days is distinct from private.pur_lead_to_acc(v_s.lead_days, p.order_lead_days));
  elsif v_p.order_lead_days is not null then
    -- Ninguno tiene días: al menos la anticipación de Administración.
    update public.pur_suppliers s
       set lead_days = least(v_p.order_lead_days, 14),
           updated_by = coalesce(v_user, s.updated_by)
     where s.id = v_s.id
       and s.tenant_id = v_s.tenant_id
       and s.lead_days is distinct from least(v_p.order_lead_days, 14);
  end if;

  v_wa := private.pur_whatsapp_from_phone(v_p.phone);
  if v_s.whatsapp is null and v_wa is not null then
    update public.pur_suppliers s
       set whatsapp = v_wa,
           updated_by = coalesce(v_user, s.updated_by)
     where s.id = v_s.id and s.tenant_id = v_s.tenant_id and s.whatsapp is null;
  elsif v_p.phone is null and v_s.whatsapp is not null then
    update public.acc_parties p
       set phone = private.pur_phone_from_whatsapp(v_s.whatsapp),
           updated_by = coalesce(v_user, p.updated_by)
     where p.id = v_p.id and p.tenant_id = v_p.tenant_id and p.phone is null;
  end if;
  return null;
end;
$$;

create trigger pur_supplier_parties_linked
  after insert on public.pur_supplier_parties
  for each row execute function private.pur_supplier_party_linked();

-- ─── 7. Las uniones que ya estaban ───────────────────────────────────────────
-- Pasan a la tabla nueva (el trigger completa los datos de cada una) y la columna vieja queda vacía.
insert into public.pur_supplier_parties (tenant_id, supplier_id, acc_party_id, created_by)
select s.tenant_id, s.id, s.acc_party_id, s.created_by
  from public.pur_suppliers s
 where s.acc_party_id is not null
on conflict (tenant_id, acc_party_id) do nothing;

update public.pur_suppliers
   set acc_party_id = null
 where acc_party_id is not null;
comment on column public.pur_suppliers.acc_party_id is
  'Sin uso desde el 11/11/2026: las razones sociales de Administración van en pur_supplier_parties.';
