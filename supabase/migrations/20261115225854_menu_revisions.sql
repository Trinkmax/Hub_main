-- ============================================================
-- La carta siempre al día (pedido de Nacho Badra, audios del 15/11/2026)
-- ============================================================
-- POR QUÉ: clientes que ya habían abierto la carta veían precios viejos. La
-- carta NO se guarda en el servidor ni en Vercel (sale con `no-store` y
-- `x-vercel-cache: MISS`): la copia vieja vive en el CELULAR. La pestaña queda
-- abierta días y Safari/Chrome la muestran de memoria sin volver a pedirla (lo
-- mismo con el «atrás» del navegador). HUB cambió 168 de sus 238 ítems en los
-- últimos 30 días: el desfase se nota.
--
-- QUÉ HACE: cada bar tiene un número de versión de su carta (`rev`) que sube
-- SOLO con cualquier cambio del menú, venga de donde venga (el editor, el Excel,
-- Tex, los precios del punto de venta). La carta abierta en el celular lo
-- compara al volver a primer plano (`carta_menu_rev`) y, si cambió, se refresca
-- sin perder dónde estaba (app/carta/[tenantSlug]/_components/carta-freshness.tsx).
-- El botón «Actualizar en los celulares» del editor (`menu_force_refresh`) lo
-- sube a mano: lo que pidió Nacho Badra («como el de WordPress»).
--
-- POR SENTENCIA, NO POR FILA: cambiar 200 precios de una sube el número una
-- sola vez. Postgres no deja tablas de transición en un disparador de varios
-- eventos, así que van tres por tabla (alta, cambio, baja) con la misma función.
--
-- NADA de la sesión del socio se toca (la cookie de la billetera sigue igual):
-- esto solo dice «la carta cambió».
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Tabla ────────────────────────────────────────────────────────────────
create table public.menu_revisions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  rev bigint not null default 1,
  changed_at timestamptz not null default now(),
  forced_at timestamptz,
  forced_by uuid references auth.users(id) on delete set null,
  constraint menu_revisions_rev_positive check (rev >= 1)
);

create index menu_revisions_forced_by_idx on public.menu_revisions (forced_by)
  where forced_by is not null;

comment on table public.menu_revisions is
  'Versión de la carta pública de cada bar. Sube sola con cualquier cambio del menú (disparadores por sentencia) o a mano con menu_force_refresh. La carta abierta en el celular la compara con carta_menu_rev para refrescarse.';
comment on column public.menu_revisions.forced_at is
  'Última vez que alguien tocó «Actualizar en los celulares» en el editor de la carta.';

-- ─── 2. RLS y privilegios ────────────────────────────────────────────────────
-- Se aparta a propósito del GRANT completo de CLAUDE.md §5 (como acc_access): se
-- escribe solo por los disparadores y la RPC definer de abajo.
alter table public.menu_revisions enable row level security;
revoke all on public.menu_revisions from anon, authenticated;
grant select on public.menu_revisions to authenticated;

create policy menu_revisions_editor_select on public.menu_revisions
  for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'editor'));

create policy menu_revisions_no_accountant on public.menu_revisions as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

-- ─── 3. Subir el número ──────────────────────────────────────────────────────
-- Solo bares que siguen existiendo: al borrar un bar, la cascada borra su carta y
-- dispara esto con el bar ya borrado; insertar su fila rompería el borrado.
create function private.menu_bump_rev(p_tenants uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.menu_revisions as r (tenant_id, rev, changed_at)
  select distinct t.id, 1::bigint, now()
    from unnest(p_tenants) as t(id)
   where t.id is not null
     and exists (select 1 from public.tenants tt where tt.id = t.id)
  on conflict (tenant_id) do update
    set rev = r.rev + 1,
        changed_at = now();
$$;

-- Tablas con `tenant_id` propio (ítems, categorías, etiquetas).
create function private.menu_rev_tg_tenant_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.menu_bump_rev(array(select n.tenant_id from new_rows n));
  elsif tg_op = 'UPDATE' then
    perform private.menu_bump_rev(array(
      select n.tenant_id from new_rows n
      union
      select o.tenant_id from old_rows o));
  else
    perform private.menu_bump_rev(array(select o.tenant_id from old_rows o));
  end if;
  return null;
end;
$$;

-- Etiquetas de cada ítem: la tabla no tiene `tenant_id`; sale del ítem o de la
-- etiqueta (si el ítem ya se borró en la misma cascada, lo cubre su propio disparador).
create function private.menu_rev_tg_tag_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenants uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(x.tenant_id) into v_tenants from (
      select mi.tenant_id from new_rows n join public.menu_items mi on mi.id = n.menu_item_id
      union
      select it.tenant_id from new_rows n join public.item_tags it on it.id = n.tag_id) x;
  elsif tg_op = 'UPDATE' then
    select array_agg(x.tenant_id) into v_tenants from (
      select mi.tenant_id from new_rows n join public.menu_items mi on mi.id = n.menu_item_id
      union
      select mi.tenant_id from old_rows o join public.menu_items mi on mi.id = o.menu_item_id
      union
      select it.tenant_id from old_rows o join public.item_tags it on it.id = o.tag_id) x;
  else
    select array_agg(x.tenant_id) into v_tenants from (
      select mi.tenant_id from old_rows o join public.menu_items mi on mi.id = o.menu_item_id
      union
      select it.tenant_id from old_rows o join public.item_tags it on it.id = o.tag_id) x;
  end if;
  perform private.menu_bump_rev(coalesce(v_tenants, '{}'::uuid[]));
  return null;
end;
$$;

revoke all on function private.menu_bump_rev(uuid[]) from public, anon, authenticated;
revoke all on function private.menu_rev_tg_tenant_rows() from public, anon, authenticated;
revoke all on function private.menu_rev_tg_tag_assignments() from public, anon, authenticated;

-- ─── 4. Disparadores (tres por tabla) ────────────────────────────────────────
create trigger menu_items_rev_ins after insert on public.menu_items
  referencing new table as new_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_items_rev_upd after update on public.menu_items
  referencing new table as new_rows old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_items_rev_del after delete on public.menu_items
  referencing old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();

create trigger menu_categories_rev_ins after insert on public.menu_categories
  referencing new table as new_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_categories_rev_upd after update on public.menu_categories
  referencing new table as new_rows old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger menu_categories_rev_del after delete on public.menu_categories
  referencing old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();

create trigger item_tags_rev_ins after insert on public.item_tags
  referencing new table as new_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger item_tags_rev_upd after update on public.item_tags
  referencing new table as new_rows old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();
create trigger item_tags_rev_del after delete on public.item_tags
  referencing old table as old_rows
  for each statement execute function private.menu_rev_tg_tenant_rows();

create trigger menu_item_tag_assignments_rev_ins after insert on public.menu_item_tag_assignments
  referencing new table as new_rows
  for each statement execute function private.menu_rev_tg_tag_assignments();
create trigger menu_item_tag_assignments_rev_upd after update on public.menu_item_tag_assignments
  referencing new table as new_rows old table as old_rows
  for each statement execute function private.menu_rev_tg_tag_assignments();
create trigger menu_item_tag_assignments_rev_del after delete on public.menu_item_tag_assignments
  referencing old table as old_rows
  for each statement execute function private.menu_rev_tg_tag_assignments();

-- ─── 5. Lo que pregunta la carta abierta (anónima) ───────────────────────────
-- Devuelve solo el número (0 si el bar todavía no tiene fila). No expone nada del
-- bar: es un contador.
create function public.carta_menu_rev(p_tenant uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.rev from public.menu_revisions r where r.tenant_id = p_tenant), 0::bigint);
$$;

revoke all on function public.carta_menu_rev(uuid) from public;
grant execute on function public.carta_menu_rev(uuid) to anon, authenticated;

-- ─── 6. El botón del editor ──────────────────────────────────────────────────
-- Quien edita la carta (MENU_EDIT_ROLES: dueño y Contenido) puede pedir que
-- todos los celulares con la carta abierta la recarguen.
create function public.menu_force_refresh(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.menu_revisions;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.user_id = v_uid
       and m.tenant_id = p_tenant
       and m.role in ('owner', 'editor')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.menu_revisions as r (tenant_id, rev, changed_at, forced_at, forced_by)
  values (p_tenant, 1, now(), now(), v_uid)
  on conflict (tenant_id) do update
    set rev = r.rev + 1,
        changed_at = now(),
        forced_at = now(),
        forced_by = v_uid
  returning * into v_row;

  return jsonb_build_object('rev', v_row.rev, 'changed_at', v_row.changed_at);
end;
$$;

revoke all on function public.menu_force_refresh(uuid) from public, anon;
grant execute on function public.menu_force_refresh(uuid) to authenticated;

-- ─── 7. Una fila por bar ─────────────────────────────────────────────────────
insert into public.menu_revisions (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

notify pgrst, 'reload schema';
