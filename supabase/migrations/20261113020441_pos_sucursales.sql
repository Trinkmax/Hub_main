-- Sucursales: un bar, varios locales (docs/features/pos.md).
--
-- HUB abre un segundo local (el Cerro) y quiere «un sistema con dos sucursales, no dos sistemas»:
--   · se comparte la carta, el club, la ficha del cliente y el equipo (siguen colgando del bar);
--   · es propio de cada sucursal el mapa, las mesas y sus QR, las pantallas de cocina, las cajas, los
--     agotados del día y las reservas.
--
-- Cada bar nace con una sucursal principal, así que para quien tiene un solo local no cambia nada: todo lo
-- que ya existe queda en esa sucursal y lo que se cree sin decir cuál cae ahí.
--
-- Qué toca de lo que ya existe:
--   · `floor_plan_areas`, `physical_tables` y `table_sessions` ganan `branch_id` (obligatoria, con la
--     sucursal principal de relleno);
--   · `salon_reservations` gana `branch_id` OPCIONAL y sin rellenar (vacío = la sucursal principal): así no
--     se reescribe ni una reserva;
--   · el nombre de un sector pasa a ser único por sucursal y no por bar (las dos pueden tener «Terraza»).

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tabla
-- ─────────────────────────────────────────────────────────────────────────────
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60), -- «Alta Córdoba», «Cerro»
  -- Para donde no entra el nombre entero (pestañas, chips). Sin dato se usa el nombre.
  short_name text check (short_name is null or char_length(btrim(short_name)) between 1 and 14),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  -- El color con el que se reconoce la sucursal en toda la app.
  color text not null default '#2f5d50' check (color ~ '^#[0-9a-fA-F]{6}$'),
  address text check (address is null or char_length(address) <= 160),
  position integer not null default 0,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_id_tenant_uq unique (id, tenant_id)
);
create unique index branches_slug_uq on public.branches (tenant_id, slug);
create unique index branches_name_uq on public.branches (tenant_id, lower(btrim(name)));
create unique index branches_one_default_uq on public.branches (tenant_id) where is_default;
create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
comment on table public.branches is
  'Sucursales de un bar. Carta, club, clientes y equipo son del bar; mapa, mesas, cocina, cajas y agotados son de la sucursal.';

-- Una sucursal principal por cada bar que ya existe.
insert into public.branches (tenant_id, name, slug, is_default)
select t.id, 'Principal', 'principal', true
  from public.tenants t
 where not exists (select 1 from public.branches b where b.tenant_id = t.id);

-- Y por cada bar que se cree de acá en más.
create function private.pos_tg_tenant_default_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.branches (tenant_id, name, slug, is_default)
  values (new.id, 'Principal', 'principal', true)
  on conflict do nothing;
  return new;
end;
$$;
create trigger tenants_default_branch
  after insert on public.tenants
  for each row execute function private.pos_tg_tenant_default_branch();

-- La sucursal principal de un bar.
create function public.default_branch_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
    from public.branches b
   where b.tenant_id = p_tenant_id
     and b.is_default
     and public.user_role_in_tenant(p_tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host');
$$;
grant execute on function public.default_branch_id(uuid) to authenticated, service_role;
comment on function public.default_branch_id(uuid) is
  'La sucursal principal del bar, para quien trabaja ahí (owner, cashier, waiter, kitchen, editor, host).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que es de cada sucursal
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.floor_plan_areas add column branch_id uuid;
alter table public.physical_tables add column branch_id uuid;
alter table public.table_sessions add column branch_id uuid;
-- Vacío = la sucursal principal. No se rellena: no se reescribe ninguna reserva.
alter table public.salon_reservations add column branch_id uuid;

update public.floor_plan_areas a
   set branch_id = b.id
  from public.branches b
 where b.tenant_id = a.tenant_id and b.is_default and a.branch_id is null;

update public.physical_tables p
   set branch_id = b.id
  from public.branches b
 where b.tenant_id = p.tenant_id and b.is_default and p.branch_id is null;

update public.table_sessions s
   set branch_id = b.id
  from public.branches b
 where b.tenant_id = s.tenant_id and b.is_default and s.branch_id is null;

alter table public.floor_plan_areas
  alter column branch_id set not null,
  add constraint floor_plan_areas_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
alter table public.physical_tables
  alter column branch_id set not null,
  add constraint physical_tables_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
alter table public.table_sessions
  alter column branch_id set not null,
  add constraint table_sessions_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
alter table public.salon_reservations
  add constraint salon_reservations_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete set null (branch_id);

create index floor_plan_areas_branch_idx on public.floor_plan_areas (branch_id, position);
create index physical_tables_branch_idx on public.physical_tables (branch_id) where active;
create index table_sessions_branch_open_idx on public.table_sessions (branch_id, opened_at desc)
  where status = 'open';
create index salon_reservations_branch_idx on public.salon_reservations (branch_id, reservation_date)
  where branch_id is not null;

comment on column public.salon_reservations.branch_id is
  'Sucursal de la reserva. Vacío = la sucursal principal del bar.';

-- El nombre de un sector es único por sucursal: las dos pueden tener «Terraza».
drop index public.floor_plan_areas_tenant_name_uidx;
create unique index floor_plan_areas_branch_name_uidx
  on public.floor_plan_areas (branch_id, lower(btrim(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que se crea sin decir sucursal cae en la principal
-- ─────────────────────────────────────────────────────────────────────────────
create function private.pos_tg_default_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null then
    select b.id into new.branch_id
      from public.branches b
     where b.tenant_id = new.tenant_id and b.is_default;
  end if;
  return new;
end;
$$;
create trigger floor_plan_areas_default_branch
  before insert on public.floor_plan_areas
  for each row execute function private.pos_tg_default_branch();
create trigger physical_tables_default_branch
  before insert on public.physical_tables
  for each row execute function private.pos_tg_default_branch();

-- Una mesa abierta es de la sucursal de su mesa.
create function private.pos_tg_session_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is null and new.physical_table_id is not null then
    select p.branch_id into new.branch_id
      from public.physical_tables p
     where p.id = new.physical_table_id;
  end if;
  if new.branch_id is null then
    select b.id into new.branch_id
      from public.branches b
     where b.tenant_id = new.tenant_id and b.is_default;
  end if;
  return new;
end;
$$;
create trigger table_sessions_branch
  before insert on public.table_sessions
  for each row execute function private.pos_tg_session_branch();

-- Una mesa puesta en el plano es de la sucursal de ese sector.
create function private.pos_tg_element_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.physical_table_id is not null then
    update public.physical_tables p
       set branch_id = a.branch_id
      from public.floor_plan_areas a
     where a.id = new.area_id
       and p.id = new.physical_table_id
       and p.branch_id is distinct from a.branch_id;
  end if;
  return new;
end;
$$;
create trigger floor_plan_elements_branch
  after insert or update of area_id, physical_table_id on public.floor_plan_elements
  for each row execute function private.pos_tg_element_branch();

-- Y si un sector cambia de sucursal, sus mesas van con él.
create function private.pos_tg_area_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is distinct from old.branch_id then
    update public.physical_tables p
       set branch_id = new.branch_id
      from public.floor_plan_elements e
     where e.area_id = new.id
       and e.physical_table_id = p.id
       and p.branch_id is distinct from new.branch_id;
  end if;
  return new;
end;
$$;
create trigger floor_plan_areas_branch_moved
  after update of branch_id on public.floor_plan_areas
  for each row execute function private.pos_tg_area_branch();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: la ve quien trabaja en el bar, la edita el dueño
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.branches enable row level security;

create policy branches_read on public.branches for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host'));
create policy branches_owner_insert on public.branches for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy branches_owner_update on public.branches for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
-- La principal no se borra: es donde cae todo lo que no dice sucursal.
create policy branches_owner_delete on public.branches for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner' and not is_default);
create policy branches_no_accountant on public.branches as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

grant select, insert, update, delete on public.branches to authenticated, service_role;
revoke all on public.branches from anon;
revoke all on function public.default_branch_id(uuid) from public, anon;

revoke all on function private.pos_tg_tenant_default_branch() from public, anon, authenticated;
revoke all on function private.pos_tg_default_branch() from public, anon, authenticated;
revoke all on function private.pos_tg_session_branch() from public, anon, authenticated;
revoke all on function private.pos_tg_element_branch() from public, anon, authenticated;
revoke all on function private.pos_tg_area_branch() from public, anon, authenticated;

notify pgrst, 'reload schema';
