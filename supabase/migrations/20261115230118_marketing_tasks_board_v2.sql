-- ============================================================
-- Tareas de marketing, segunda versión: el tablero estilo Monday
-- (pedido de Nacho Badra, video del 15/11/2026)
-- ============================================================
-- POR QUÉ: el tablero de septiembre (tarjetas por fecha, tres secciones fijas)
-- «está muy desorganizado»: lo terminado no se va a ningún lado, hay un solo
-- involucrado, el archivo es un link y no hay dónde dejar lo entregado. Los
-- socios ya trabajan en Monday y pidieron lo mismo adentro del sistema:
--   · GRUPOS que arma cada bar (Eventos, Impresiones, Promos…), con su color.
--   · Varios RESPONSABLES y varios INVOLUCRADOS por tarea («lo delega, pero
--     sigue siendo responsable la otra persona»).
--   · VENCIMIENTO único (se va la doble fecha ideal/definida).
--   · ACTUALIZACIONES: el hilo de cada tarea, donde quien la hizo deja lo
--     entregado y la marca terminada.
--   · ARCHIVOS subidos desde la compu o el celular (bucket privado), o links.
--   · Lo terminado se va solo a «Terminadas» (eso es de la pantalla: estado
--     `done`; la tarea conserva su grupo y vuelve a él si se reabre).
--
-- QUIÉN: dueños, Contenido (`editor`) y anfitriona (`host`) ven y trabajan el
-- tablero (decisión de Nacho, 15/11/2026): son los que el selector de personas ya
-- ofrecía. Los grupos y las rutinas los arman solo los dueños. Borrar una tarea:
-- el dueño o quien la creó.
--
-- EXPANDIR AHORA, LIMPIAR DESPUÉS: esta migración llega antes que el código. El
-- tablero viejo tiene que seguir andando en el medio, así que se AGREGA todo y se
-- CONSERVAN las columnas viejas (`category`, `kind`, `specifications`,
-- `file_url`, `responsible_user_id`, `involved_user_id`, `ideal_date`,
-- `defined_date`). Un disparador le pone grupo a lo que llegue sin (el alta del
-- código viejo y de Tex viejo). Borrarlas es otra migración (BACKLOG.md).
--
-- AISLAMIENTO DE LA CONTADORA (CLAUDE.md §4): toda tabla nueva lleva su
-- RESTRICTIVE `<tabla>_no_accountant` y toda RPC definer enumera roles.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Quién trabaja el tablero ─────────────────────────────────────────────
create function public.marketing_member_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.role in ('owner', 'editor', 'host')
$$;

create function public.marketing_manager_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.role = 'owner'
$$;

comment on function public.marketing_member_tenant_ids() is
  'Bares donde quien llama trabaja el tablero de tareas de marketing: owner, editor (Contenido) y host (anfitriona).';
comment on function public.marketing_manager_tenant_ids() is
  'Bares donde quien llama arma el tablero (grupos y rutinas): solo owner.';

revoke all on function public.marketing_member_tenant_ids() from public, anon;
revoke all on function public.marketing_manager_tenant_ids() from public, anon;
grant execute on function public.marketing_member_tenant_ids() to authenticated;
grant execute on function public.marketing_manager_tenant_ids() to authenticated;

-- ─── 2. Grupos ───────────────────────────────────────────────────────────────
create table public.marketing_task_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- Clave de la paleta fija de lib/marketing/constants.ts (GROUP_COLORS).
  color text not null default 'forest',
  position double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mtg_id_tenant_uq unique (id, tenant_id),
  constraint mtg_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint mtg_color check (color in ('forest', 'sky', 'violet', 'rose', 'coral', 'amber', 'teal', 'slate'))
);

create index mtg_tenant_position_idx on public.marketing_task_groups (tenant_id, position);
create index mtg_created_by_idx on public.marketing_task_groups (created_by) where created_by is not null;

comment on table public.marketing_task_groups is
  'Grupos del tablero de tareas de marketing (como los de Monday). Los arma el dueño; borrar uno borra sus tareas.';

create trigger marketing_task_groups_updated_at
  before update on public.marketing_task_groups
  for each row execute function public.set_updated_at();

alter table public.marketing_task_groups enable row level security;

create policy mtg_member_select on public.marketing_task_groups
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy mtg_manager_insert on public.marketing_task_groups
  for insert to authenticated
  with check (tenant_id in (select public.marketing_manager_tenant_ids()));
create policy mtg_manager_update on public.marketing_task_groups
  for update to authenticated
  using (tenant_id in (select public.marketing_manager_tenant_ids()))
  with check (tenant_id in (select public.marketing_manager_tenant_ids()));
create policy mtg_manager_delete on public.marketing_task_groups
  for delete to authenticated
  using (tenant_id in (select public.marketing_manager_tenant_ids()));
create policy marketing_task_groups_no_accountant on public.marketing_task_groups as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

grant select, insert, update, delete on public.marketing_task_groups to authenticated;
revoke all on public.marketing_task_groups from anon;

-- ─── 3. Tareas: grupo, vencimiento y orden ───────────────────────────────────
alter table public.marketing_tasks
  add column group_id uuid,
  add column due_date date,
  add column position double precision not null default 0;

alter table public.marketing_tasks
  add constraint mt_id_tenant_uq unique (id, tenant_id),
  add constraint mt_group_same_tenant foreign key (group_id, tenant_id)
    references public.marketing_task_groups (id, tenant_id) on delete cascade;

create index mt_group_position_idx on public.marketing_tasks (tenant_id, group_id, position);
create index mt_tenant_due_idx on public.marketing_tasks (tenant_id, due_date) where due_date is not null;

comment on column public.marketing_tasks.group_id is
  'Grupo del tablero. La tarea terminada lo conserva: la pantalla la muestra en «Terminadas» y vuelve acá si se reabre.';
comment on column public.marketing_tasks.due_date is
  'Vencimiento (reemplaza la doble fecha ideal/definida del tablero de septiembre).';
comment on column public.marketing_tasks.position is
  'Orden manual dentro del grupo (arrastrar). Menor = más arriba.';
comment on column public.marketing_tasks.notes is
  'Notas de la tarea (la columna «Notas» de Monday). Absorbió las especificaciones del tablero de septiembre.';

-- Lo que llega sin grupo (el alta del código viejo o de Tex viejo mientras dura
-- la ventana entre esta migración y el deploy): al grupo que se llama como su
-- categoría, si no al primero, y si el bar no tiene ninguno, uno nuevo.
create function private.marketing_tasks_default_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
  v_group uuid;
begin
  if new.group_id is not null then
    return new;
  end if;

  v_label := case new.category
               when 'eventos' then 'Eventos'
               when 'promociones' then 'Promociones'
               when 'impresiones' then 'Impresiones'
             end;

  select g.id into v_group
    from public.marketing_task_groups g
   where g.tenant_id = new.tenant_id
   order by (lower(g.name) = lower(coalesce(v_label, ''))) desc, g.position asc, g.created_at asc
   limit 1;

  if v_group is null then
    insert into public.marketing_task_groups (tenant_id, name, color, position)
    values (new.tenant_id, coalesce(v_label, 'Tareas'), 'forest', 0)
    returning id into v_group;
  end if;

  new.group_id := v_group;
  return new;
end;
$$;

revoke all on function private.marketing_tasks_default_group() from public, anon, authenticated;

create trigger marketing_tasks_default_group
  before insert on public.marketing_tasks
  for each row execute function private.marketing_tasks_default_group();

-- Políticas: se va «solo dueño». Los tres roles leen, crean y editan; borra el
-- dueño o quien la creó. La RESTRICTIVE `marketing_tasks_no_accountant` queda.
drop policy if exists "marketing_tasks_owner_all" on public.marketing_tasks;

create policy marketing_tasks_member_select on public.marketing_tasks
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy marketing_tasks_member_insert on public.marketing_tasks
  for insert to authenticated
  with check (tenant_id in (select public.marketing_member_tenant_ids()));
create policy marketing_tasks_member_update on public.marketing_tasks
  for update to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()))
  with check (tenant_id in (select public.marketing_member_tenant_ids()));
create policy marketing_tasks_delete on public.marketing_tasks
  for delete to authenticated
  using (
    tenant_id in (select public.marketing_manager_tenant_ids())
    or (created_by = (select auth.uid()) and tenant_id in (select public.marketing_member_tenant_ids()))
  );

-- ─── 4. Personas de cada tarea ───────────────────────────────────────────────
create table public.marketing_task_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- `responsible`: de quién es la tarea. `involved`: quien está metido (a quien se
  -- le delegó el diseño, quien pasa el material). Varias de cada una.
  role text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mtp_role check (role in ('responsible', 'involved')),
  constraint mtp_unique unique (task_id, user_id, role),
  constraint mtp_task_same_tenant foreign key (task_id, tenant_id)
    references public.marketing_tasks (id, tenant_id) on delete cascade
);

create index mtp_tenant_user_idx on public.marketing_task_people (tenant_id, user_id);
create index mtp_task_tenant_idx on public.marketing_task_people (task_id, tenant_id);
create index mtp_user_idx on public.marketing_task_people (user_id);
create index mtp_created_by_idx on public.marketing_task_people (created_by) where created_by is not null;

comment on table public.marketing_task_people is
  'Responsables e involucrados de cada tarea de marketing. Solo gente del equipo que trabaja el tablero (owner, editor, host).';

alter table public.marketing_task_people enable row level security;

create policy mtp_member_select on public.marketing_task_people
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
-- La persona tiene que trabajar el tablero en ESE bar: no se le asigna una
-- tarea a un mozo ni a alguien de otro bar.
create policy mtp_member_insert on public.marketing_task_people
  for insert to authenticated
  with check (
    tenant_id in (select public.marketing_member_tenant_ids())
    and exists (
      select 1 from public.memberships m
       where m.tenant_id = marketing_task_people.tenant_id
         and m.user_id = marketing_task_people.user_id
         and m.role in ('owner', 'editor', 'host')
    )
  );
create policy mtp_member_delete on public.marketing_task_people
  for delete to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy marketing_task_people_no_accountant on public.marketing_task_people as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

-- Sin UPDATE: cambiar a alguien es sacar y poner.
grant select, insert, delete on public.marketing_task_people to authenticated;
revoke all on public.marketing_task_people from anon;

-- ─── 5. Actualizaciones (el hilo de cada tarea) ──────────────────────────────
create table public.marketing_task_updates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  author_id uuid references auth.users(id) on delete set null,
  -- Puede ir vacío si la actualización es solo archivos (lo controla la action).
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mtu_id_tenant_uq unique (id, tenant_id),
  constraint mtu_body_len check (char_length(body) <= 10000),
  constraint mtu_task_same_tenant foreign key (task_id, tenant_id)
    references public.marketing_tasks (id, tenant_id) on delete cascade
);

create index mtu_task_idx on public.marketing_task_updates (tenant_id, task_id, created_at desc);
create index mtu_task_tenant_idx on public.marketing_task_updates (task_id, tenant_id);
create index mtu_author_idx on public.marketing_task_updates (author_id) where author_id is not null;

comment on table public.marketing_task_updates is
  'Actualizaciones de una tarea de marketing (como las de Monday): el detalle de quien la carga y lo entregado por quien la hace.';

create trigger marketing_task_updates_updated_at
  before update on public.marketing_task_updates
  for each row execute function public.set_updated_at();

alter table public.marketing_task_updates enable row level security;

create policy mtu_member_select on public.marketing_task_updates
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy mtu_author_insert on public.marketing_task_updates
  for insert to authenticated
  with check (
    tenant_id in (select public.marketing_member_tenant_ids())
    and author_id = (select auth.uid())
  );
create policy mtu_author_update on public.marketing_task_updates
  for update to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()) and author_id = (select auth.uid()))
  with check (tenant_id in (select public.marketing_member_tenant_ids()) and author_id = (select auth.uid()));
create policy mtu_author_or_manager_delete on public.marketing_task_updates
  for delete to authenticated
  using (
    tenant_id in (select public.marketing_manager_tenant_ids())
    or (tenant_id in (select public.marketing_member_tenant_ids()) and author_id = (select auth.uid()))
  );
create policy marketing_task_updates_no_accountant on public.marketing_task_updates as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

grant select, insert, update, delete on public.marketing_task_updates to authenticated;
revoke all on public.marketing_task_updates from anon;

-- ─── 6. Archivos y links ─────────────────────────────────────────────────────
create table public.marketing_task_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  -- Si llegó adentro de una actualización (lo entregado). Si la actualización se
  -- borra, el archivo queda en la tarea (la action borra los suyos antes).
  update_id uuid,
  kind text not null,
  storage_path text,                        -- <tenant_id>/<task_id>/<uuid>.<ext> en marketing-files
  url text,                                 -- link (Drive, Frame.io, lo que sea)
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mtf_kind check (kind in ('file', 'link')),
  constraint mtf_shape check (
    (kind = 'file' and storage_path is not null and url is null and mime_type is not null and size_bytes is not null)
    or (kind = 'link' and url is not null and storage_path is null)),
  constraint mtf_path_shape check (storage_path is null or (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
    and left(storage_path, 74) = tenant_id::text || '/' || task_id::text || '/')),
  constraint mtf_path_uq unique (storage_path),
  constraint mtf_url check (url is null or (url ~* '^https?://\S+$' and char_length(url) <= 2000)),
  constraint mtf_name_len check (char_length(btrim(file_name)) between 1 and 160),
  constraint mtf_size check (size_bytes is null or size_bytes between 1 and 52428800),
  constraint mtf_task_same_tenant foreign key (task_id, tenant_id)
    references public.marketing_tasks (id, tenant_id) on delete cascade,
  constraint mtf_update_same_tenant foreign key (update_id, tenant_id)
    references public.marketing_task_updates (id, tenant_id) on delete set null (update_id)
);

create index mtf_task_idx on public.marketing_task_files (tenant_id, task_id, created_at);
create index mtf_task_tenant_idx on public.marketing_task_files (task_id, tenant_id);
create index mtf_update_idx on public.marketing_task_files (update_id, tenant_id) where update_id is not null;
create index mtf_created_by_idx on public.marketing_task_files (created_by) where created_by is not null;

comment on table public.marketing_task_files is
  'Archivos (bucket privado marketing-files) y links de una tarea de marketing. Opcionalmente atados a una actualización.';

alter table public.marketing_task_files enable row level security;

create policy mtf_member_select on public.marketing_task_files
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy mtf_member_insert on public.marketing_task_files
  for insert to authenticated
  with check (
    tenant_id in (select public.marketing_member_tenant_ids())
    and created_by = (select auth.uid())
  );
create policy mtf_author_or_manager_delete on public.marketing_task_files
  for delete to authenticated
  using (
    tenant_id in (select public.marketing_manager_tenant_ids())
    or (tenant_id in (select public.marketing_member_tenant_ids()) and created_by = (select auth.uid()))
  );
create policy marketing_task_files_no_accountant on public.marketing_task_files as restrictive for all to authenticated
  using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
  with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())));

-- Sin UPDATE: un archivo no se pisa ni se mueve.
grant select, insert, delete on public.marketing_task_files to authenticated;
revoke all on public.marketing_task_files from anon;

-- ─── 7. Bucket privado ───────────────────────────────────────────────────────
-- 50 MB por archivo: fotos, PDF, videos cortos, zip y Office. Lo más pesado (un
-- reel en crudo) va como link de Drive. La carpeta es el bar; la segunda, la tarea.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-files',
  'marketing-files',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketing_files_member_select" on storage.objects;
create policy "marketing_files_member_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'marketing-files'
    and (storage.foldername(name))[1] in (select m.id::text from public.marketing_member_tenant_ids() as m(id))
  );

drop policy if exists "marketing_files_member_insert" on storage.objects;
create policy "marketing_files_member_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'marketing-files'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
    and (storage.foldername(name))[1] in (select m.id::text from public.marketing_member_tenant_ids() as m(id))
  );

drop policy if exists "marketing_files_member_delete" on storage.objects;
create policy "marketing_files_member_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'marketing-files'
    and (storage.foldername(name))[1] in (select m.id::text from public.marketing_member_tenant_ids() as m(id))
  );

-- ─── 8. Reordenar (arrastrar) ────────────────────────────────────────────────
-- Recibe el grupo destino y el orden completo de sus tareas. Corre con los
-- permisos de quien llama (RLS manda); la FK compuesta impide mover a un grupo
-- de otro bar.
create function public.marketing_reorder_tasks(p_group uuid, p_ids uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$
  with g as (
    select mg.id, mg.tenant_id
      from public.marketing_task_groups mg
     where mg.id = p_group
  ), moved as (
    update public.marketing_tasks t
       set group_id = g.id,
           position = o.ord
      from g, unnest(p_ids) with ordinality as o(id, ord)
     where t.id = o.id
       and t.tenant_id = g.tenant_id
    returning 1
  )
  select count(*)::integer from moved;
$$;

revoke all on function public.marketing_reorder_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.marketing_reorder_tasks(uuid, uuid[]) to authenticated;

-- ─── 9. Equipo asignable: ahora lo pide cualquiera que trabaje el tablero ────
create or replace function public.get_marketing_team(p_tenant uuid)
returns table (member_id uuid, member_name text, member_role public.tenant_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.role in ('owner', 'editor', 'host')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    m.user_id,
    coalesce(
      nullif(btrim(rm.display_name), ''),
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email::text, '@', 1)
    )::text,
    m.role
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join lateral (
    select r.display_name
    from public.reservation_managers r
    where r.tenant_id = m.tenant_id and r.user_id = m.user_id
    order by r.active desc, r.created_at asc
    limit 1
  ) rm on true
  where m.tenant_id = p_tenant
    and m.role in ('owner', 'host', 'editor')
  order by 2 asc;
end;
$$;

revoke execute on function public.get_marketing_team(uuid) from public, anon;
grant execute on function public.get_marketing_team(uuid) to authenticated;

-- ─── 10. Rutinas de la semana (Orgánico): tildan los tres, arma el dueño ─────
drop policy if exists "marketing_routines_owner_all" on public.marketing_routines;
create policy marketing_routines_member_select on public.marketing_routines
  for select to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()));
create policy marketing_routines_manager_insert on public.marketing_routines
  for insert to authenticated
  with check (tenant_id in (select public.marketing_manager_tenant_ids()));
create policy marketing_routines_manager_update on public.marketing_routines
  for update to authenticated
  using (tenant_id in (select public.marketing_manager_tenant_ids()))
  with check (tenant_id in (select public.marketing_manager_tenant_ids()));
create policy marketing_routines_manager_delete on public.marketing_routines
  for delete to authenticated
  using (tenant_id in (select public.marketing_manager_tenant_ids()));

drop policy if exists "marketing_routine_checks_owner_all" on public.marketing_routine_checks;
create policy marketing_routine_checks_member_all on public.marketing_routine_checks
  for all to authenticated
  using (tenant_id in (select public.marketing_member_tenant_ids()))
  with check (tenant_id in (select public.marketing_member_tenant_ids()));

-- ─── 11. Datos: grupos, vencimiento, notas, orden, personas y links ──────────
-- Grupos iniciales en los bares que ya tienen tareas, con sus tareas adentro.
insert into public.marketing_task_groups (tenant_id, name, color, position)
select t.tenant_id, g.name, g.color, g.position
  from (select distinct mt.tenant_id from public.marketing_tasks mt) t
 cross join (values ('Eventos', 'forest', 1::double precision),
                    ('Promociones', 'coral', 2::double precision),
                    ('Impresiones', 'sky', 3::double precision)) as g(name, color, position);

update public.marketing_tasks mt
   set group_id = g.id
  from public.marketing_task_groups g
 where g.tenant_id = mt.tenant_id
   and mt.group_id is null
   and g.name = case mt.category
                  when 'eventos' then 'Eventos'
                  when 'promociones' then 'Promociones'
                  else 'Impresiones'
                end;

alter table public.marketing_tasks alter column group_id set not null;

update public.marketing_tasks
   set due_date = coalesce(defined_date, ideal_date)
 where due_date is null
   and coalesce(defined_date, ideal_date) is not null;

update public.marketing_tasks
   set notes = case
                 when notes is null or btrim(notes) = '' then specifications
                 else specifications || E'\n\n' || notes
               end
 where specifications is not null
   and btrim(specifications) <> '';

update public.marketing_tasks mt
   set position = x.rn
  from (
    select t.id, row_number() over (partition by t.group_id order by t.created_at asc) as rn
      from public.marketing_tasks t
  ) x
 where x.id = mt.id;

insert into public.marketing_task_people (tenant_id, task_id, user_id, role, created_by)
select mt.tenant_id, mt.id, mt.responsible_user_id, 'responsible', mt.created_by
  from public.marketing_tasks mt
 where mt.responsible_user_id is not null
on conflict (task_id, user_id, role) do nothing;

insert into public.marketing_task_people (tenant_id, task_id, user_id, role, created_by)
select mt.tenant_id, mt.id, mt.involved_user_id, 'involved', mt.created_by
  from public.marketing_tasks mt
 where mt.involved_user_id is not null
on conflict (task_id, user_id, role) do nothing;

insert into public.marketing_task_files (tenant_id, task_id, kind, url, file_name, created_by, created_at)
select mt.tenant_id,
       mt.id,
       'link',
       mt.file_url,
       left(coalesce(nullif(substring(mt.file_url from '^https?://(?:www\.)?([^/?#]+)'), ''), 'Link'), 160),
       mt.created_by,
       mt.updated_at
  from public.marketing_tasks mt
 where mt.file_url is not null
   and mt.file_url ~* '^https?://\S+$'
   and char_length(mt.file_url) <= 2000;

-- ─── 12. En vivo: el tablero se actualiza cuando otro cambia algo ────────────
alter publication supabase_realtime add table
  public.marketing_task_groups,
  public.marketing_tasks,
  public.marketing_task_people,
  public.marketing_task_updates,
  public.marketing_task_files;

notify pgrst, 'reload schema';
