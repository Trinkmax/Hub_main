-- Tex, el asistente de Administración (pedido del 05/11/2026). Aditivo: tres tablas nuevas, nada de lo que existe cambia.
--   · acc_tex_threads: cada charla es de una persona en un bar.
--   · acc_tex_messages: los mensajes tal cual los devolvió la API de Claude. Solo se agregan: `content` es `json`
--     (no `jsonb`) para no cambiar el orden de las claves, porque la API rechaza una historia editada.
--   · acc_tex_actions: lo que Tex preparó para hacer y qué pasó. La escritura real la hace la acción de siempre, con
--     la sesión de la persona, recién cuando confirma: acá queda el rastro de qué se le mostró y qué se hizo.
-- Todo corre con la sesión de quien charla. La charla la ve solo esa persona; las acciones las ve quien pueda leer
-- Administración, para saber qué se cargó con Tex.

create table public.acc_tex_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  -- Los resultados de las herramientas de un turno mientras se espera una confirmación.
  pending jsonb,
  -- Con qué pantalla se habló por última vez, para no mandar dos veces el mismo texto.
  last_screen_hash text,
  input_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  last_context_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atxt_id_tenant_uq unique (id, tenant_id),
  constraint atxt_title_len check (title is null or char_length(title) <= 120)
);
create index atxt_user_recent_idx on public.acc_tex_threads (tenant_id, user_id, updated_at desc);
create index atxt_user_idx on public.acc_tex_threads (user_id);
comment on table public.acc_tex_threads is 'Las charlas con Tex: de una persona, en un bar.';

create table public.acc_tex_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null,
  role text not null,
  content json not null,
  created_at timestamptz not null default now(),
  constraint atxm_thread_seq_uq unique (thread_id, seq),
  constraint atxm_role check (role in ('user', 'assistant')),
  constraint atxm_seq check (seq >= 0),
  constraint atxm_thread_same_tenant foreign key (thread_id, tenant_id)
    references public.acc_tex_threads (id, tenant_id) on delete cascade
);
create index atxm_tenant_idx on public.acc_tex_messages (tenant_id);
create index atxm_user_idx on public.acc_tex_messages (user_id);
comment on table public.acc_tex_messages is 'Los mensajes de cada charla, tal cual. Solo se agregan: la API rechaza una historia editada.';

create table public.acc_tex_actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_use_id text not null,
  kind text not null,
  status text not null default 'pending',
  -- Lo que se va a hacer, con el hash de la vista previa que vio la persona.
  payload jsonb not null,
  -- Lo que se le mostró.
  ticket jsonb not null,
  result jsonb,
  document_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint atxa_thread_tool_uq unique (thread_id, tool_use_id),
  constraint atxa_status check (status in ('pending', 'done', 'failed', 'declined', 'superseded', 'undone')),
  constraint atxa_kind_len check (char_length(kind) between 1 and 40),
  constraint atxa_thread_same_tenant foreign key (thread_id, tenant_id)
    references public.acc_tex_threads (id, tenant_id) on delete cascade
);
create index atxa_tenant_recent_idx on public.acc_tex_actions (tenant_id, created_at desc);
create index atxa_user_idx on public.acc_tex_actions (user_id);
create index atxa_document_idx on public.acc_tex_actions (document_id) where document_id is not null;
comment on table public.acc_tex_actions is 'Lo que Tex preparó y qué pasó con eso. La escritura la hace la acción de siempre cuando la persona confirma.';

alter table public.acc_tex_threads enable row level security;
alter table public.acc_tex_messages enable row level security;
alter table public.acc_tex_actions enable row level security;

create policy atxt_own on public.acc_tex_threads for all to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()))
  with check (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()));

create policy atxm_own_select on public.acc_tex_messages for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()));
create policy atxm_own_insert on public.acc_tex_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()));

create policy atxa_readers_select on public.acc_tex_actions for select to authenticated
  using (tenant_id in (select public.acc_reader_tenant_ids()));
create policy atxa_own_insert on public.acc_tex_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()));
create policy atxa_own_update on public.acc_tex_actions for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()))
  with check (user_id = (select auth.uid()) and tenant_id in (select public.acc_reader_tenant_ids()));

grant select, insert, update on public.acc_tex_threads to authenticated;
grant select, insert on public.acc_tex_messages to authenticated;
grant select, insert, update on public.acc_tex_actions to authenticated;
