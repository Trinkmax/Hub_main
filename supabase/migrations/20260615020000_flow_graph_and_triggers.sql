-- ============================================================
-- Workflows — modelo de grafo (nodos/edges) + disparo de triggers faltantes
-- ============================================================
-- Editor visual: los flows nuevos se modelan como grafo (flow_nodes + flow_edges).
-- El runtime soporta ambos: si el flow tiene flow_nodes camina el grafo; si no,
-- usa los flow_steps lineales legacy (compatibilidad, sin migración de datos).
-- Además: cablea los triggers after_visit y tag_added (hoy definidos pero que
-- NUNCA disparan) con triggers DB que encolan start_flow.
-- LEY: RLS por membresía (via flow) + GRANTs. Idempotente. `db:types` después.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. flow_nodes
-- ──────────────────────────────────────────────
create table if not exists public.flow_nodes (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  kind text not null check (kind in ('trigger', 'send_template', 'wait', 'condition', 'add_tag')),
  position jsonb not null default '{"x":0,"y":0}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists flow_nodes_flow_idx on public.flow_nodes(flow_id);

-- ──────────────────────────────────────────────
-- 2. flow_edges
-- ──────────────────────────────────────────────
create table if not exists public.flow_edges (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  source_node_id uuid not null references public.flow_nodes(id) on delete cascade,
  target_node_id uuid not null references public.flow_nodes(id) on delete cascade,
  source_handle text check (source_handle is null or source_handle in ('true', 'false')),
  created_at timestamptz not null default now()
);
create index if not exists flow_edges_flow_idx on public.flow_edges(flow_id);
create index if not exists flow_edges_source_idx on public.flow_edges(source_node_id);

-- ──────────────────────────────────────────────
-- 3. flow_executions.current_node_id (modo grafo)
-- ──────────────────────────────────────────────
alter table public.flow_executions
  add column if not exists current_node_id uuid references public.flow_nodes(id) on delete set null;

-- ──────────────────────────────────────────────
-- 4. RLS (lectura miembros / escritura owner, via el flow padre)
-- ──────────────────────────────────────────────
alter table public.flow_nodes enable row level security;
alter table public.flow_edges enable row level security;

create policy "flow_nodes_member_read" on public.flow_nodes
  for select using (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid())
      )
    )
  );
create policy "flow_nodes_owner_write" on public.flow_nodes
  for all
  using (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid()) and role = 'owner'
      )
    )
  )
  with check (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid()) and role = 'owner'
      )
    )
  );

create policy "flow_edges_member_read" on public.flow_edges
  for select using (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid())
      )
    )
  );
create policy "flow_edges_owner_write" on public.flow_edges
  for all
  using (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid()) and role = 'owner'
      )
    )
  )
  with check (
    flow_id in (
      select id from public.flows where tenant_id in (
        select tenant_id from public.memberships where user_id = (select auth.uid()) and role = 'owner'
      )
    )
  );

grant select, insert, update, delete on public.flow_nodes to authenticated;
grant select, insert, update, delete on public.flow_edges to authenticated;

-- ──────────────────────────────────────────────
-- 5. Triggers DB: after_visit y tag_added → encolan start_flow
-- ──────────────────────────────────────────────
-- after_visit: al cerrar/insertar una visita, enrola al cliente en los flows
-- activos con trigger_type='after_visit' del tenant.
create or replace function public.fn_start_after_visit_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is null then
    return new;
  end if;
  insert into public.job_queue (tenant_id, kind, payload)
  select new.tenant_id, 'start_flow',
         jsonb_build_object('flow_id', f.id, 'customer_id', new.customer_id)
  from public.flows f
  where f.tenant_id = new.tenant_id
    and f.trigger_type = 'after_visit'
    and f.active = true;
  return new;
end;
$$;
drop trigger if exists trg_visits_start_flows on public.visits;
create trigger trg_visits_start_flows
  after insert on public.visits
  for each row execute function public.fn_start_after_visit_flows();

-- tag_added: al asignar una etiqueta de CLIENTE, enrola en flows activos
-- trigger_type='tag_added' (que no filtren por tag o cuyo tag_id coincida).
create or replace function public.fn_start_tag_added_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from public.customer_tags where id = new.tag_id;
  if v_tenant_id is null then
    return new;
  end if;
  insert into public.job_queue (tenant_id, kind, payload)
  select v_tenant_id, 'start_flow',
         jsonb_build_object('flow_id', f.id, 'customer_id', new.customer_id)
  from public.flows f
  where f.tenant_id = v_tenant_id
    and f.trigger_type = 'tag_added'
    and f.active = true
    and (
      (f.trigger_config->>'tag_id') is null
      or (f.trigger_config->>'tag_id') = new.tag_id::text
    );
  return new;
end;
$$;
drop trigger if exists trg_tag_assign_start_flows on public.customer_tag_assignments;
create trigger trg_tag_assign_start_flows
  after insert on public.customer_tag_assignments
  for each row execute function public.fn_start_tag_added_flows();
