-- Sucursales en todo el sistema · tanda 1: quién ve cada sucursal.
--
-- Hasta acá las sucursales eran cosa del punto de venta (mapa, comanda, tele, caja). Desde ahora todo el sistema
-- se mira por sucursal, y cada persona del equipo trabaja en las sucursales que un dueño le marca en Equipo.
--
-- Quién ve qué (lo decidió el dueño el 17/11/2026):
-- - Dueño: todas. No se le asignan.
-- - Contadora: Administración entera; ve los nombres de las sucursales para filtrar y nada más.
-- - El resto (caja, mozo, cocina, contenido, anfitriona): las que tenga marcadas. Sin ninguna marcada (o si todas
--   las marcadas están apagadas), solo la principal. Crear una sucursal nueva no le muestra nada nuevo a nadie hasta
--   que un dueño se la asigna.
--
-- Todo suma: no se rellena nada y lo que existe sigue igual (get_tenant_access trae una clave más, `branches`).

set local lock_timeout = '5s';

-- Candado de entrada: get_tenant_access se reemplaza a partir de la versión leída el 18/11/2026.
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.get_tenant_access(text)'::regprocedure)
     <> '7beaad4cc7012d31abb76eb1b1b559e1' then
    raise exception 'get_tenant_access cambió desde que se escribió esta migración: revisarla antes de aplicar';
  end if;
end
$$;

-- ─── 1. Lo que cada sucursal necesita fuera del punto de venta ─────────────────────────────────────────

alter table public.branches
  add column opened_on date,
  add column seat_capacity integer,
  add column google_maps_review_url text,
  add column feedback_whatsapp_phone text;

alter table public.branches
  add constraint branches_seat_capacity_check
    check (seat_capacity is null or seat_capacity between 1 and 5000),
  add constraint branches_maps_url_check
    check (google_maps_review_url is null or char_length(google_maps_review_url) between 8 and 500),
  add constraint branches_feedback_phone_check
    check (feedback_whatsapp_phone is null or char_length(feedback_whatsapp_phone) between 6 and 32);

comment on column public.branches.opened_on is
  'Desde cuándo abre. Antes de esta fecha no se esperan cierres del día. Vacío = desde siempre.';
comment on column public.branches.seat_capacity is
  'Cupo general de la sucursal. Alta Córdoba lo suma de sus plantas; una sucursal sin plantas usa este.';
comment on column public.branches.google_maps_review_url is
  'A dónde van las reseñas buenas de esta sucursal. Vacío = el link del bar.';
comment on column public.branches.feedback_whatsapp_phone is
  'A dónde llegan las reseñas flojas de esta sucursal. Vacío = el número del bar.';

-- ─── 2. En qué sucursales trabaja cada persona ──────────────────────────────────────────────────────────

create table public.membership_branches (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null,
  branch_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, branch_id),
  -- Cuelga de la membresía: si la persona sale del equipo, sus sucursales se van con ella.
  constraint membership_branches_member_fk foreign key (tenant_id, user_id)
    references public.memberships (tenant_id, user_id) on delete cascade,
  constraint membership_branches_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete cascade
);

comment on table public.membership_branches is
  'Sucursales de cada persona del equipo. Sin filas = solo la principal. Los dueños y la contadora no llevan filas: ven todas.';

create index membership_branches_user_idx on public.membership_branches (user_id);
create index membership_branches_branch_idx on public.membership_branches (branch_id);

alter table public.membership_branches enable row level security;

-- Cada uno lee las suyas; un dueño, las de todo su bar. Nadie escribe directo: se cambia con
-- set_membership_branches, que valida y deja auditoría.
create policy membership_branches_read on public.membership_branches
  for select to authenticated
  using (user_id = (select auth.uid()) or public.user_role_in_tenant(tenant_id) = 'owner');

revoke all on public.membership_branches from anon;
grant select on public.membership_branches to authenticated;
grant select, insert, update, delete on public.membership_branches to service_role;

-- ─── 3. Qué sucursales ve cada persona ─────────────────────────────────────────────────────────────────

-- El núcleo: las sucursales ACTIVAS que esta persona puede mirar en este bar. Lo usan las de abajo.
create or replace function private.visible_branches(p_tenant_id uuid, p_user_id uuid)
returns setof public.branches
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
    from public.branches b
    join public.memberships m
      on m.tenant_id = b.tenant_id
     and m.user_id = p_user_id
   where b.tenant_id = p_tenant_id
     and b.active
     and (
       m.role in ('owner', 'accountant')
       or exists (
         select 1
           from public.membership_branches mb
          where mb.tenant_id = b.tenant_id
            and mb.user_id = p_user_id
            and mb.branch_id = b.id
       )
       or (
         b.is_default
         and not exists (
           select 1
             from public.membership_branches mb
             join public.branches b2 on b2.id = mb.branch_id and b2.active
            where mb.tenant_id = b.tenant_id
              and mb.user_id = p_user_id
         )
       )
     )
$$;

-- Las de quien pregunta, listas para la pantalla: la principal primero, después el orden de Sucursales.
-- DEFINER a propósito: la contadora no lee `branches` (branches_no_accountant), pero necesita los nombres para
-- filtrar Administración.
create or replace function public.my_branches(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'short_name', v.short_name,
        'slug', v.slug,
        'color', v.color,
        'address', v.address,
        'position', v.position,
        'is_default', v.is_default,
        'opened_on', v.opened_on,
        'seat_capacity', v.seat_capacity
      )
      order by v.is_default desc, v.position, v.name
    ),
    '[]'::jsonb
  )
  from private.visible_branches(p_tenant_id, (select auth.uid())) v
$$;

-- Lo mismo, solo los ids: para las funciones y políticas que recortan por sucursal.
create or replace function public.user_branch_ids(p_tenant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(v.id), '{}'::uuid[])
    from private.visible_branches(p_tenant_id, (select auth.uid())) v
$$;

-- Para escribir: la sucursal pedida si es de este bar, está activa y la persona la tiene; sin sucursal, la
-- principal si la tiene, o su única sucursal. Sin sesión (tareas programadas, webhooks) vale cualquiera del bar.
create or replace function private.branch_for_write(p_tenant_id uuid, p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_ids uuid[];
begin
  if p_branch_id is not null then
    select b.id into v_id
      from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = p_tenant_id
       and b.active;
    if v_id is null then
      raise exception 'branch_not_found' using errcode = 'P0001';
    end if;
    if v_uid is not null
       and not exists (select 1 from private.visible_branches(p_tenant_id, v_uid) v where v.id = v_id) then
      raise exception 'branch_forbidden' using errcode = '42501';
    end if;
    return v_id;
  end if;

  if v_uid is null then
    select b.id into v_id from public.branches b where b.tenant_id = p_tenant_id and b.is_default;
    return v_id;
  end if;

  select coalesce(array_agg(v.id order by v.is_default desc), '{}'::uuid[]) into v_ids
    from private.visible_branches(p_tenant_id, v_uid) v;
  if exists (select 1 from private.visible_branches(p_tenant_id, v_uid) v where v.is_default) then
    return v_ids[1];
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    return v_ids[1];
  end if;
  raise exception 'branch_required' using errcode = 'P0001';
end;
$$;

-- Para leer: sin sucursal, las que la persona ve (un dueño o la contadora: todas, también las apagadas, por la
-- historia); con sucursal, esa, si la ve. Sin sesión: todo el bar o la pedida.
create or replace function private.branch_scope(p_tenant_id uuid, p_branch_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_ids uuid[];
begin
  if v_uid is null then
    if p_branch_id is not null then
      return array[p_branch_id];
    end if;
    select coalesce(array_agg(b.id), '{}'::uuid[]) into v_ids from public.branches b where b.tenant_id = p_tenant_id;
    return v_ids;
  end if;

  select m.role into v_role
    from public.memberships m
   where m.tenant_id = p_tenant_id
     and m.user_id = v_uid;
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_role in ('owner', 'accountant') then
    select coalesce(array_agg(b.id), '{}'::uuid[]) into v_ids from public.branches b where b.tenant_id = p_tenant_id;
  else
    select coalesce(array_agg(v.id), '{}'::uuid[]) into v_ids from private.visible_branches(p_tenant_id, v_uid) v;
  end if;

  if p_branch_id is null then
    return v_ids;
  end if;
  if p_branch_id = any (v_ids) then
    return array[p_branch_id];
  end if;
  raise exception 'branch_forbidden' using errcode = '42501';
end;
$$;

-- ─── 4. Asignar sucursales (solo un dueño) ─────────────────────────────────────────────────────────────

-- Reemplaza de una vez las sucursales de una persona. Vacío = solo la principal. A un dueño o a la contadora no se
-- les asigna: ven todas.
create or replace function public.set_membership_branches(
  p_tenant_id uuid,
  p_user_id uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member public.memberships%rowtype;
  v_ids uuid[];
  v_valid integer;
begin
  if v_uid is null or public.user_role_in_tenant(p_tenant_id) is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_member
    from public.memberships m
   where m.tenant_id = p_tenant_id
     and m.user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  if v_member.role in ('owner', 'accountant') then
    raise exception 'role_sees_all' using errcode = 'P0001';
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_branch_ids, '{}'::uuid[])) x where x is not null);

  select count(*) into v_valid
    from public.branches b
   where b.tenant_id = p_tenant_id
     and b.active
     and b.id = any (v_ids);
  if v_valid <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'branch_not_found' using errcode = 'P0001';
  end if;

  delete from public.membership_branches mb
   where mb.tenant_id = p_tenant_id
     and mb.user_id = p_user_id
     and not (mb.branch_id = any (v_ids));

  insert into public.membership_branches (tenant_id, user_id, branch_id, created_by)
  select p_tenant_id, p_user_id, x, v_uid
    from unnest(v_ids) x
  on conflict do nothing;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (
    p_tenant_id,
    v_uid,
    'membership.branches_set',
    'membership',
    v_member.id,
    jsonb_build_object('user_id', p_user_id, 'role', v_member.role, 'branch_ids', to_jsonb(v_ids))
  );

  return jsonb_build_object('ok', true, 'branch_ids', to_jsonb(v_ids));
end;
$$;

-- ─── 5. get_tenant_access trae las sucursales de quien pregunta (misma ida de siempre) ──────────────────

create or replace function public.get_tenant_access(p_slug text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tenant', to_jsonb(t),
    'role', m.role,
    'is_platform_admin', public.is_platform_admin(),
    'accounting', public.acc_my_access(t.id),
    'branches', public.my_branches(t.id),
    'memberships', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', m2.role,
            'tenant', jsonb_build_object(
              'id', t2.id, 'name', t2.name, 'slug', t2.slug, 'logo_url', t2.logo_url
            )
          )
          order by m2.created_at
        ),
        '[]'::jsonb
      )
      from public.memberships m2
      join public.tenants t2 on t2.id = m2.tenant_id
      where m2.user_id = (select auth.uid())
    )
  )
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and t.slug = p_slug
  limit 1
$$;

-- ─── 6. Permisos ───────────────────────────────────────────────────────────────────────────────────────

revoke all on function private.visible_branches(uuid, uuid) from public, anon, authenticated;
revoke all on function private.branch_for_write(uuid, uuid) from public, anon, authenticated;
revoke all on function private.branch_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_branches(uuid) from public, anon;
revoke all on function public.user_branch_ids(uuid) from public, anon;
revoke all on function public.set_membership_branches(uuid, uuid, uuid[]) from public, anon;

grant execute on function public.my_branches(uuid) to authenticated, service_role;
grant execute on function public.user_branch_ids(uuid) to authenticated, service_role;
grant execute on function public.set_membership_branches(uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function private.visible_branches(uuid, uuid) to service_role;
grant execute on function private.branch_for_write(uuid, uuid) to service_role;
grant execute on function private.branch_scope(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
