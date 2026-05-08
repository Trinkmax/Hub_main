-- Phase 6: marketing
-- Tablas: audiences, broadcasts, broadcast_recipients,
--         flows, flow_steps, flow_executions, job_queue
-- RPCs: claim_jobs (SKIP LOCKED), evaluate_audience_query (EXECUTE format),
--       enqueue_job, complete_job, fail_job, requeue_stuck_jobs,
--       customers_for_inactive_flow, customers_for_birthday_flow,
--       start_flow_for_customer
-- Triggers: visits → start_flow tipo after_visit;
--           customer_tag_assignments → start_flow tipo tag_added.

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'broadcast_status') then
    create type public.broadcast_status as enum (
      'draft','scheduled','sending','sent','failed','cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'recipient_status') then
    create type public.recipient_status as enum (
      'pending','sent','delivered','read','replied','failed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'flow_trigger_type') then
    create type public.flow_trigger_type as enum (
      'customer_inactive','birthday','after_visit','event_starting','tag_added'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'flow_step_type') then
    create type public.flow_step_type as enum (
      'send_template','wait','condition','add_tag'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'flow_execution_status') then
    create type public.flow_execution_status as enum (
      'running','completed','failed','cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum (
      'pending','processing','done','failed'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. audiences
-- ──────────────────────────────────────────────────────────
create table public.audiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  filters jsonb not null default '{"kind":"group","op":"AND","nodes":[]}'::jsonb,
  customer_count_cached int not null default 0 check (customer_count_cached >= 0),
  last_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audiences_tenant_idx on public.audiences(tenant_id, name);
create trigger audiences_updated_at before update on public.audiences
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 3. broadcasts
-- ──────────────────────────────────────────────────────────
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  channel_id uuid not null references public.channels(id) on delete restrict,
  template_id uuid not null references public.message_templates(id) on delete restrict,
  audience_id uuid not null references public.audiences(id) on delete restrict,
  scheduled_at timestamptz,
  status public.broadcast_status not null default 'draft',
  stats jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index broadcasts_tenant_status_idx on public.broadcasts(tenant_id, status, scheduled_at);
create index broadcasts_scheduled_idx
  on public.broadcasts(scheduled_at) where status = 'scheduled';
create trigger broadcasts_updated_at before update on public.broadcasts
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 4. broadcast_recipients
-- ──────────────────────────────────────────────────────────
create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status public.recipient_status not null default 'pending',
  message_id uuid references public.messages(id) on delete set null,
  error text,
  queued_at timestamptz,
  sent_at timestamptz
);
create unique index broadcast_recipients_uidx
  on public.broadcast_recipients(broadcast_id, customer_id);
create index broadcast_recipients_status_idx
  on public.broadcast_recipients(broadcast_id, status);

-- ──────────────────────────────────────────────────────────
-- 5. flows
-- ──────────────────────────────────────────────────────────
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  trigger_type public.flow_trigger_type not null,
  trigger_config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flows_tenant_active_idx
  on public.flows(tenant_id, trigger_type) where active = true;
create trigger flows_updated_at before update on public.flows
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 6. flow_steps
-- ──────────────────────────────────────────────────────────
create table public.flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  position int not null check (position >= 0),
  type public.flow_step_type not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index flow_steps_position_uidx on public.flow_steps(flow_id, position);

-- ──────────────────────────────────────────────────────────
-- 7. flow_executions
-- ──────────────────────────────────────────────────────────
create table public.flow_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  current_step int not null default 0 check (current_step >= 0),
  status public.flow_execution_status not null default 'running',
  next_run_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  context jsonb not null default '{}'::jsonb
);
create index flow_executions_run_idx
  on public.flow_executions(next_run_at) where status = 'running';
create index flow_executions_customer_idx
  on public.flow_executions(flow_id, customer_id) where status = 'running';
create index flow_executions_tenant_idx on public.flow_executions(tenant_id);

-- ──────────────────────────────────────────────────────────
-- 8. job_queue
-- ──────────────────────────────────────────────────────────
create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts > 0),
  locked_at timestamptz,
  status public.job_status not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);
-- Índice clave para el claim: pending listos para correr.
create index job_queue_run_idx
  on public.job_queue(run_at) where status = 'pending';
create index job_queue_tenant_kind_idx on public.job_queue(tenant_id, kind);
create index job_queue_processing_idx
  on public.job_queue(locked_at) where status = 'processing';

-- ──────────────────────────────────────────────────────────
-- 9. FKs deferred desde Fase 5 (ahora que existen las tablas destino)
-- ──────────────────────────────────────────────────────────
alter table public.messages
  add constraint messages_broadcast_fk
  foreign key (broadcast_id) references public.broadcasts(id) on delete set null;
alter table public.messages
  add constraint messages_flow_execution_fk
  foreign key (flow_execution_id) references public.flow_executions(id) on delete set null;

-- ──────────────────────────────────────────────────────────
-- 10. RLS
-- ──────────────────────────────────────────────────────────
alter table public.audiences enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.flows enable row level security;
alter table public.flow_steps enable row level security;
alter table public.flow_executions enable row level security;
alter table public.job_queue enable row level security;

-- audiences/broadcasts/flows: lectura para miembros, escritura solo owner
create policy "audiences_member_read" on public.audiences
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = auth.uid())
  );
create policy "audiences_owner_write" on public.audiences
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  );

create policy "broadcasts_member_read" on public.broadcasts
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = auth.uid())
  );
create policy "broadcasts_owner_write" on public.broadcasts
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  );

-- broadcast_recipients: solo lectura por miembros (escritura via service role)
create policy "broadcast_recipients_member_read" on public.broadcast_recipients
  for select using (
    broadcast_id in (
      select id from public.broadcasts
      where tenant_id in (
        select tenant_id from public.memberships where user_id = auth.uid()
      )
    )
  );

create policy "flows_member_read" on public.flows
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = auth.uid())
  );
create policy "flows_owner_write" on public.flows
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
    )
  );

create policy "flow_steps_member_read" on public.flow_steps
  for select using (
    flow_id in (
      select id from public.flows
      where tenant_id in (
        select tenant_id from public.memberships where user_id = auth.uid()
      )
    )
  );
create policy "flow_steps_owner_write" on public.flow_steps
  for all
  using (
    flow_id in (
      select id from public.flows
      where tenant_id in (
        select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
      )
    )
  )
  with check (
    flow_id in (
      select id from public.flows
      where tenant_id in (
        select tenant_id from public.memberships where user_id = auth.uid() and role = 'owner'
      )
    )
  );

-- flow_executions: lectura miembros (escritura via service role)
create policy "flow_executions_member_read" on public.flow_executions
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = auth.uid())
  );

-- job_queue: nadie del cliente lo lee/escribe; solo service_role.
-- (RLS está habilitada y sin policies → todo bloqueado para authenticated/anon).

-- ──────────────────────────────────────────────────────────
-- 11. RPCs: job_queue lifecycle
-- ──────────────────────────────────────────────────────────
create or replace function public.enqueue_job(
  p_tenant_id uuid,
  p_kind text,
  p_payload jsonb,
  p_run_at timestamptz default now(),
  p_max_attempts int default 5
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.job_queue (tenant_id, kind, payload, run_at, max_attempts)
  values (p_tenant_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_run_at, p_max_attempts)
  returning id;
$$;
revoke execute on function public.enqueue_job(uuid, text, jsonb, timestamptz, int) from public, anon, authenticated;
grant execute on function public.enqueue_job(uuid, text, jsonb, timestamptz, int) to service_role;

-- Reclama hasta N jobs pending listos para correr y los marca processing.
-- SKIP LOCKED + FOR UPDATE: workers concurrentes nunca pisan el mismo job.
create or replace function public.claim_jobs(p_kind text default null, p_limit int default 25)
returns setof public.job_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id from public.job_queue
    where status = 'pending'
      and run_at <= now()
      and (p_kind is null or kind = p_kind)
    order by run_at
    for update skip locked
    limit greatest(p_limit, 1)
  )
  update public.job_queue j
  set status = 'processing', locked_at = now(), attempts = j.attempts + 1
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;
revoke execute on function public.claim_jobs(text, int) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, int) to service_role;

create or replace function public.complete_job(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.job_queue
  set status = 'done', locked_at = null, error = null
  where id = p_id;
$$;
revoke execute on function public.complete_job(uuid) from public, anon, authenticated;
grant execute on function public.complete_job(uuid) to service_role;

-- Marca un job como failed (terminal) o re-encola con backoff exponencial.
create or replace function public.fail_job(
  p_id uuid,
  p_error text,
  p_recoverable boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.job_queue;
  backoff_seconds int;
begin
  select * into j from public.job_queue where id = p_id;
  if not found then return; end if;

  if not p_recoverable or j.attempts >= j.max_attempts then
    update public.job_queue
      set status = 'failed', locked_at = null, error = p_error
      where id = p_id;
    return;
  end if;

  -- Backoff exponencial con jitter: 30s * 2^attempts, cap 30 min, ±20% jitter.
  backoff_seconds := least(30 * (2 ^ j.attempts), 1800)::int;
  backoff_seconds := backoff_seconds + ((random() - 0.5) * 0.4 * backoff_seconds)::int;

  update public.job_queue
    set status = 'pending',
        locked_at = null,
        run_at = now() + (backoff_seconds || ' seconds')::interval,
        error = p_error
    where id = p_id;
end;
$$;
revoke execute on function public.fail_job(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_job(uuid, text, boolean) to service_role;

-- Reaper: jobs colgados en processing > 5 min vuelven a pending.
create or replace function public.requeue_stuck_jobs(p_threshold_seconds int default 300)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c int;
begin
  with reaped as (
    update public.job_queue
      set status = 'pending', locked_at = null
      where status = 'processing'
        and locked_at < now() - (p_threshold_seconds || ' seconds')::interval
      returning id
  )
  select count(*) into c from reaped;
  return c;
end;
$$;
revoke execute on function public.requeue_stuck_jobs(int) from public, anon, authenticated;
grant execute on function public.requeue_stuck_jobs(int) to service_role;

-- ──────────────────────────────────────────────────────────
-- 12. RPCs: audiences
-- ──────────────────────────────────────────────────────────
-- Ejecuta una query de audience que ya fue parseada y compilada en Node.
-- p_where viene con placeholders posicionales ($1, $2, …) que se resuelven
-- con los valores de p_params (array jsonb). El callee garantiza que solo
-- usa columnas/operadores allowlisted.
--
-- Tipos de p_params: cada elemento es { "type": "uuid"|"text"|"int"|"bigint"|"bool"|"date", "value": ... }
-- así no dependemos de la inferencia de tipos de jsonb.
create or replace function public.evaluate_audience_query(
  p_tenant_id uuid,
  p_where text,
  p_params jsonb default '[]'::jsonb,
  p_limit int default null
)
returns table(customer_id uuid, count_total bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_args text[] := array[]::text[];
  v_arg_types text[] := array[]::text[];
  v_param jsonb;
  i int := 0;
begin
  -- Construimos sql parametrizado. p_where DEBE usar referencias ${i} que
  -- mapean a posiciones $1, $2, … en el EXECUTE.
  v_sql := 'with matched as (' ||
           '  select c.id from public.customers c' ||
           '   where c.tenant_id = $1 and c.deleted_at is null and (' ||
           coalesce(nullif(trim(p_where), ''), 'true') || ')' ||
           ')' ||
           ' select id as customer_id, count(*) over () as count_total from matched';
  if p_limit is not null then
    v_sql := v_sql || ' limit ' || p_limit::text;
  end if;

  -- Los parámetros se inyectan como text[] tipados; psql los castea con USING.
  -- El primer parámetro siempre es p_tenant_id; el resto vienen del builder.
  for v_param in select * from jsonb_array_elements(p_params) loop
    i := i + 1;
    v_args := array_append(v_args, v_param ->> 'value');
    v_arg_types := array_append(v_arg_types, v_param ->> 'type');
  end loop;

  -- Ejecutamos con USING dinámico — pero EXECUTE USING no admite array de N
  -- args genérico. Resolvemos con casts inline en el SQL.
  -- Reemplazamos $2, $3, … por (p_params[i] cast a tipo) para que sea seguro.
  declare
    j int;
    final_sql text := v_sql;
    cast_fragment text;
    val text;
    typ text;
  begin
    for j in 1 .. coalesce(array_length(v_args, 1), 0) loop
      val := v_args[j];
      typ := v_arg_types[j];
      if val is null then
        cast_fragment := 'null::' || quote_ident(typ);
      else
        cast_fragment := quote_literal(val) || '::' || quote_ident(typ);
      end if;
      -- placeholders en el where: $2, $3, … (el $1 es tenant_id, no se reemplaza)
      final_sql := regexp_replace(
        final_sql,
        '\$' || (j + 1)::text || '(\D|$)',
        cast_fragment || '\1',
        'g'
      );
    end loop;
    return query execute final_sql using p_tenant_id;
  end;
end;
$$;
revoke execute on function public.evaluate_audience_query(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.evaluate_audience_query(uuid, text, jsonb, int) to service_role;

-- ──────────────────────────────────────────────────────────
-- 13. Flow trigger queries (para el cron)
-- ──────────────────────────────────────────────────────────
-- Devuelve customers candidatos a un flow customer_inactive con N días.
-- Excluye los que ya tienen una execution running para ese flow.
create or replace function public.customers_for_inactive_flow(
  p_flow_id uuid,
  p_days int
)
returns table(customer_id uuid)
language sql
security definer
set search_path = public
as $$
  select c.id
  from public.customers c
  join public.flows f on f.id = p_flow_id
  where c.tenant_id = f.tenant_id
    and c.deleted_at is null
    and c.opt_in_marketing = true
    and c.last_visit_at is not null
    and c.last_visit_at < now() - (p_days || ' days')::interval
    and not exists (
      select 1 from public.flow_executions fe
      where fe.flow_id = p_flow_id and fe.customer_id = c.id and fe.status = 'running'
    );
$$;
revoke execute on function public.customers_for_inactive_flow(uuid, int) from public, anon, authenticated;
grant execute on function public.customers_for_inactive_flow(uuid, int) to service_role;

create or replace function public.customers_for_birthday_flow(p_flow_id uuid)
returns table(customer_id uuid)
language sql
security definer
set search_path = public
as $$
  select c.id
  from public.customers c
  join public.flows f on f.id = p_flow_id
  where c.tenant_id = f.tenant_id
    and c.deleted_at is null
    and c.opt_in_marketing = true
    and c.birthdate is not null
    and extract(month from c.birthdate) = extract(month from current_date)
    and extract(day from c.birthdate) = extract(day from current_date)
    and not exists (
      select 1 from public.flow_executions fe
      where fe.flow_id = p_flow_id and fe.customer_id = c.id and fe.status = 'running'
    );
$$;
revoke execute on function public.customers_for_birthday_flow(uuid) from public, anon, authenticated;
grant execute on function public.customers_for_birthday_flow(uuid) to service_role;

-- Crea una execution si no existe ya en running para (flow, customer).
create or replace function public.start_flow_for_customer(
  p_flow_id uuid,
  p_customer_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.flows
    where id = p_flow_id and active = true;
  if v_tenant is null then return null; end if;

  -- Idempotente: una execution running por flow+customer.
  insert into public.flow_executions (tenant_id, flow_id, customer_id, context)
  select v_tenant, p_flow_id, p_customer_id, coalesce(p_context, '{}'::jsonb)
  where not exists (
    select 1 from public.flow_executions
    where flow_id = p_flow_id and customer_id = p_customer_id and status = 'running'
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.start_flow_for_customer(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_flow_for_customer(uuid, uuid, jsonb) to service_role;

-- ──────────────────────────────────────────────────────────
-- 14. Triggers DB-driven (after_visit, tag_added)
-- ──────────────────────────────────────────────────────────
create or replace function public.trg_visits_start_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  for f in select id from public.flows
    where tenant_id = new.tenant_id
      and trigger_type = 'after_visit'
      and active = true
  loop
    perform public.enqueue_job(
      new.tenant_id,
      'start_flow',
      jsonb_build_object('flow_id', f.id, 'customer_id', new.customer_id),
      now()
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_visits_start_flows on public.visits;
create trigger trg_visits_start_flows
  after insert on public.visits
  for each row execute function public.trg_visits_start_flows();

create or replace function public.trg_tags_start_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.customers where id = new.customer_id;
  if v_tenant is null then return new; end if;

  for f in select id, trigger_config from public.flows
    where tenant_id = v_tenant
      and trigger_type = 'tag_added'
      and active = true
  loop
    -- trigger_config: { tag_id?: uuid }. Si está, filtramos por ese tag.
    if (f.trigger_config ->> 'tag_id') is null
       or (f.trigger_config ->> 'tag_id')::uuid = new.tag_id then
      perform public.enqueue_job(
        v_tenant,
        'start_flow',
        jsonb_build_object('flow_id', f.id, 'customer_id', new.customer_id, 'tag_id', new.tag_id),
        now()
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_tags_start_flows on public.customer_tag_assignments;
create trigger trg_tags_start_flows
  after insert on public.customer_tag_assignments
  for each row execute function public.trg_tags_start_flows();

-- ──────────────────────────────────────────────────────────
-- 15. Realtime publication para broadcasts (stats en vivo en UI)
-- ──────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.broadcasts;
alter publication supabase_realtime add table public.broadcast_recipients;

-- ──────────────────────────────────────────────────────────
-- 16. Data API GRANTs
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.audiences to authenticated;
grant select, insert, update, delete on public.broadcasts to authenticated;
grant select on public.broadcast_recipients to authenticated;
grant select, insert, update, delete on public.flows to authenticated;
grant select, insert, update, delete on public.flow_steps to authenticated;
grant select on public.flow_executions to authenticated;
-- job_queue: NO grant a authenticated (solo service_role).
