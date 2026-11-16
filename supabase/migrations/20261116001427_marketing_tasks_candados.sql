-- ============================================================
-- Tareas de marketing: tres candados que faltaban (revisión del 15/11/2026)
-- ============================================================
-- Lo encontró la revisión independiente del tablero estilo Monday, ya con la
-- migración 20261115230118 en producción. Ninguno cruza de bar: son dentro del
-- mismo bar, con la sesión de alguien del equipo y la consola del navegador.
--
-- 1. LA TAREA NO CAMBIA DE AUTOR NI DE BAR, y «cuándo y quién la terminó» sale del
--    estado. La política de UPDATE no limita columnas: Contenido o la anfitriona
--    podían ponerse como autores de una tarea ajena (`created_by`) y después
--    borrarla (la política de borrado deja al autor), o falsificar quién la
--    terminó. Ahora un disparador fija `created_by`, `tenant_id` y `created_at`, y
--    calcula `completed_at`/`completed_by` del cambio de estado. Lo mismo para las
--    actualizaciones (no se pasan a otra tarea ni a otro autor).
-- 2. UN ARCHIVO DEL BUCKET LO BORRA quien lo subió, un dueño, o quien creó la tarea
--    (así borrar su tarea se lleva los archivos). Antes alcanzaba con trabajar el
--    tablero del bar.
-- 3. UNA TAREA SIN GRUPO solo crea el grupo si la carga un dueño (o el sistema): el
--    disparador corre como definer y le abría a cualquiera la creación de grupos.
--
-- El sistema (migraciones, service_role: sin `auth.uid()`) sigue escribiendo lo que
-- quiere; los candados son para las sesiones.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. La tarea ─────────────────────────────────────────────────────────────
create function private.marketing_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Nadie carga una tarea a nombre de otro.
    new.created_by := v_uid;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := v_uid;
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.tenant_id := old.tenant_id;
  if new.status is distinct from old.status then
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := v_uid;
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end;
$$;

revoke all on function private.marketing_tasks_guard() from public, anon, authenticated;

create trigger marketing_tasks_guard
  before insert or update on public.marketing_tasks
  for each row execute function private.marketing_tasks_guard();

-- Las actualizaciones: se edita el texto, nada más.
create function private.marketing_task_updates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  new.task_id := old.task_id;
  new.tenant_id := old.tenant_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function private.marketing_task_updates_guard() from public, anon, authenticated;

create trigger marketing_task_updates_guard
  before update on public.marketing_task_updates
  for each row execute function private.marketing_task_updates_guard();

-- ─── 2. Borrar archivos del bucket ───────────────────────────────────────────
drop policy if exists "marketing_files_member_delete" on storage.objects;
create policy "marketing_files_member_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'marketing-files'
    and (storage.foldername(name))[1] in (select m.id::text from public.marketing_member_tenant_ids() as m(id))
    and (
      owner_id = (select auth.uid())::text
      or (storage.foldername(name))[1] in (select m.id::text from public.marketing_manager_tenant_ids() as m(id))
      or exists (
        select 1
          from public.marketing_tasks t
         where t.id::text = (storage.foldername(name))[2]
           and t.tenant_id::text = (storage.foldername(name))[1]
           and t.created_by = (select auth.uid())
      )
    )
  );

-- ─── 3. Una tarea sin grupo ──────────────────────────────────────────────────
create or replace function private.marketing_tasks_default_group()
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
    -- Crear un grupo es cosa del dueño (o del sistema), también por esta puerta.
    if (select auth.uid()) is not null
       and new.tenant_id not in (select public.marketing_manager_tenant_ids()) then
      raise exception 'La tarea necesita un grupo y este bar no tiene ninguno: lo arma un socio.'
        using errcode = '23502';
    end if;
    insert into public.marketing_task_groups (tenant_id, name, color, position)
    values (new.tenant_id, coalesce(v_label, 'Tareas'), 'forest', 0)
    returning id into v_group;
  end if;

  new.group_id := v_group;
  return new;
end;
$$;

revoke all on function private.marketing_tasks_default_group() from public, anon, authenticated;
