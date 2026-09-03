-- ============================================================
-- Tareas de marketing — el tablero compartido de los socios
-- ============================================================
-- POR QUÉ: hoy las tareas de marketing (quién graba el reel, quién imprime el
-- menú, qué historia va el jueves) viven en un grupo de WhatsApp y en la cabeza
-- de una sola persona. Nacho carga la tarea, la dice por audio, y a la semana
-- nadie sabe si se hizo. Esto es el mismo tablero que ya venían usando afuera
-- del sistema, pero adentro: con el equipo real del bar, sin cuenta aparte.
--
-- TRES TABLAS, TRES COSAS DISTINTAS:
--   · marketing_tasks           — la tarea puntual ("grabar el reel del sushi").
--   · marketing_routines        — lo que se repite TODAS las semanas
--                                 ("historia de happy hour", 1 vez por semana).
--   · marketing_routine_checks  — el tilde de esa rutina en una semana concreta.
--
-- Las rutinas no son tareas: no tienen fecha ni responsable, tienen CUPO
-- semanal ("reels: 3 por semana") y se reinician solas cada lunes. Modelarlas
-- como tareas obligaba a crear 11 filas nuevas cada lunes a mano.
--
-- QUIÉN VE ESTO: solo `owner` (los socios). El staff de salón no tiene nada
-- que hacer acá y las policies son fail-closed — ver `user_role_in_tenant`.
--
-- IDIOMA: las claves de los enums van en inglés como el resto del schema
-- (service_alert, flow_execution_events.action_type); los labels en español
-- viven en lib/marketing/constants.ts.
-- ============================================================

-- ──────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'marketing_task_category') then
    -- Las tres "secciones" del tablero. `Orgánico` NO está acá: no es una
    -- categoría de tarea, es la vista de rutinas semanales (otra tabla).
    create type public.marketing_task_category as enum (
      'eventos',
      'promociones',
      'impresiones'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'marketing_task_status') then
    create type public.marketing_task_status as enum (
      'todo',         -- Por hacer
      'in_progress',  -- En proceso
      'blocked',      -- Interrumpido
      'done'          -- Terminado
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'marketing_task_kind') then
    -- Qué clase de trabajo es. Sirve para filtrar "todo lo que hay que diseñar"
    -- sin leer 40 títulos.
    create type public.marketing_task_kind as enum (
      'design',       -- Diseñar
      'shoot',        -- Grabar contenido
      'edit',         -- Editar contenido
      'script',       -- Armar guion
      'ads',          -- Pautar
      'publish',      -- Subir contenido
      'print',        -- Imprimir
      'coordinate',   -- Coordinar
      'other'         -- Otro
    );
  end if;
end $$;

-- ──────────────────────────────────────────────
-- Tareas
-- ──────────────────────────────────────────────

create table if not exists public.marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  title text not null check (length(btrim(title)) between 1 and 160),
  category public.marketing_task_category not null default 'eventos',
  kind public.marketing_task_kind not null default 'design',
  status public.marketing_task_status not null default 'todo',

  -- Qué hay que hacer, concreto. Se muestra debajo del título en la tarjeta.
  specifications text,
  -- El contexto largo: textos, promos, referencias. Va detrás de "Con contexto".
  notes text,
  -- Link al arte / carpeta / video ya editado (Drive, Frame.io, lo que sea).
  file_url text,

  -- Dos personas a propósito: quien tiene que hacerla y quien está metido
  -- (el que pasa el material, el que aprueba). Es la diferencia entre
  -- "es tuya" y "estás en el loop", y el filtro "Mis tareas" usa las dos.
  responsible_user_id uuid references auth.users(id) on delete set null,
  involved_user_id uuid references auth.users(id) on delete set null,

  -- `ideal_date` es el deseo ("estaría bueno para el finde"), `defined_date` es
  -- el compromiso ("sale el jueves"). El tablero agrupa por la definida y cae
  -- a la ideal si todavía no hay compromiso.
  ideal_date date,
  defined_date date,

  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.marketing_tasks is
  'Tablero de tareas de marketing compartido por los socios (/[slug]/tareas). Solo owner.';
comment on column public.marketing_tasks.ideal_date is
  'Fecha deseada. El agrupador del tablero usa coalesce(defined_date, ideal_date).';
comment on column public.marketing_tasks.notes is
  'Contexto largo (promos, copys, referencias). En la tarjeta aparece como "Con contexto".';

-- El tablero SIEMPRE entra por (tenant, categoría) y ordena por fecha efectiva.
create index if not exists marketing_tasks_board_idx
  on public.marketing_tasks (tenant_id, category, (coalesce(defined_date, ideal_date)));
-- "Mis tareas": lo mío como responsable y lo mío como involucrado.
create index if not exists marketing_tasks_responsible_idx
  on public.marketing_tasks (tenant_id, responsible_user_id);
create index if not exists marketing_tasks_involved_idx
  on public.marketing_tasks (tenant_id, involved_user_id);

drop trigger if exists marketing_tasks_updated_at on public.marketing_tasks;
create trigger marketing_tasks_updated_at
  before update on public.marketing_tasks
  for each row execute function public.set_updated_at();

alter table public.marketing_tasks enable row level security;

drop policy if exists "marketing_tasks_owner_all" on public.marketing_tasks;
create policy "marketing_tasks_owner_all" on public.marketing_tasks
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- Data API GRANT (CLAUDE.md §5) + revoke de los default privileges que el
-- proyecto le regala a `anon` en cada tabla nueva de public.
grant select, insert, update, delete on public.marketing_tasks to authenticated;
revoke all on public.marketing_tasks from anon;

-- ──────────────────────────────────────────────
-- Rutinas semanales (la sección "Orgánico")
-- ──────────────────────────────────────────────

create table if not exists public.marketing_routines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  title text not null check (length(btrim(title)) between 1 and 160),
  description text,
  -- Cuántas veces por semana hay que hacerla. 3 = tres casilleros a tildar.
  slots int not null default 1 check (slots between 1 and 14),
  position int not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Habilita la FK compuesta de los checks: garantiza a nivel motor que un
  -- tilde nunca cruza de bar, sin depender de un trigger.
  unique (id, tenant_id)
);

comment on table public.marketing_routines is
  'Checklist recurrente de contenido orgánico. Se reinicia solo cada semana (los tildes viven en marketing_routine_checks).';

create index if not exists marketing_routines_tenant_idx
  on public.marketing_routines (tenant_id, active, position);

drop trigger if exists marketing_routines_updated_at on public.marketing_routines;
create trigger marketing_routines_updated_at
  before update on public.marketing_routines
  for each row execute function public.set_updated_at();

alter table public.marketing_routines enable row level security;

drop policy if exists "marketing_routines_owner_all" on public.marketing_routines;
create policy "marketing_routines_owner_all" on public.marketing_routines
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.marketing_routines to authenticated;
revoke all on public.marketing_routines from anon;

-- ──────────────────────────────────────────────
-- Tildes de la semana
-- ──────────────────────────────────────────────
-- Presencia = hecho. Destildar es borrar la fila: no hay estado "false" que
-- mantener ni filas basura por cada rutina × semana que nadie tocó.

create table if not exists public.marketing_routine_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  routine_id uuid not null,
  -- Lunes de la semana, en la zona horaria del bar. Lo calcula el server.
  week_start date not null,
  -- 0-based: la rutina de 3 por semana usa los slots 0, 1 y 2.
  slot int not null check (slot >= 0 and slot < 14),

  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz not null default now(),

  unique (routine_id, week_start, slot),
  foreign key (routine_id, tenant_id)
    references public.marketing_routines (id, tenant_id) on delete cascade
);

comment on table public.marketing_routine_checks is
  'Un tilde = una fila. Destildar borra la fila; no existe el estado "sin hacer".';

create index if not exists marketing_routine_checks_week_idx
  on public.marketing_routine_checks (tenant_id, week_start);

alter table public.marketing_routine_checks enable row level security;

drop policy if exists "marketing_routine_checks_owner_all" on public.marketing_routine_checks;
create policy "marketing_routine_checks_owner_all" on public.marketing_routine_checks
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.marketing_routine_checks to authenticated;
revoke all on public.marketing_routine_checks from anon;

-- ──────────────────────────────────────────────
-- Directorio de gente asignable
-- ──────────────────────────────────────────────
-- El combo "Responsable / Involucrado" necesita NOMBRES, y los nombres no
-- están en un solo lado: `auth.users` es inaccesible desde PostgREST y su
-- `full_name` casi siempre viene vacío, mientras que `reservation_managers`
-- (que se auto-provisiona desde memberships) sí tiene el nombre real con el
-- que se conocen entre ellos. Esta función los cruza y cae a la parte local
-- del email como último recurso.
--
-- Se excluye al staff de salón: una tarea de marketing no se le asigna a un
-- mozo. `security definer` porque toca auth.users; el chequeo de membresía
-- es explícito y fail-closed.

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
      and m.role = 'owner'
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

notify pgrst, 'reload schema';
