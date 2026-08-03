-- ============================================================
-- Registros de ejecución de automatizaciones — log POR PASO
-- ============================================================
-- POR QUÉ: `flow_executions` es la INSCRIPCIÓN de un cliente a un flow (una
-- fila por cliente que se pisa a sí misma a medida que avanza el puntero).
-- Cuando el dueño pregunta "¿este flujo mandó algo?, ¿a quién?, ¿cuándo?, ¿por
-- qué a este no?" no hay nada que mirar: el paso ya ejecutado no deja rastro y
-- el motivo de un salto (sin opt-in, ventana de 24h) se pierde en los logs del
-- server. Esta tabla es el historial append-only que alimenta la pestaña
-- "Registros de ejecución" dentro de cada automatización.
--
-- PII (CLAUDE.md §9): `detail` guarda REFERENCIAS (template_id, nombre de la
-- plantilla, tag_id, rama tomada, minutos de espera). NUNCA el teléfono ni el
-- mensaje renderizado con datos del cliente.
--
-- ESCRITURAS: sólo el runtime con service_role. No hay policy de insert para
-- `authenticated` (mismo criterio que public.reviews): el log no se edita a
-- mano, se lee.
--
-- RETENCIÓN: sin purga automática por ahora — anotado en BACKLOG.md.
-- ============================================================

create table if not exists public.flow_execution_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  execution_id uuid not null references public.flow_executions(id) on delete cascade,
  -- El cliente puede borrarse (derecho al olvido) sin perder la traza operativa.
  customer_id uuid references public.customers(id) on delete set null,
  -- Modo grafo: qué nodo se ejecutó. Se pone en null si el nodo se borra del
  -- editor, pero action_label ya congeló lo que decía en ese momento.
  node_id uuid references public.flow_nodes(id) on delete set null,
  -- Modo lineal heredado (flow_steps): posición del paso en vez de node_id.
  step_position int,
  action_type text not null check (
    action_type in (
      'trigger', 'send_template', 'wait', 'condition', 'add_tag',
      'enrolled', 'completed', 'failed'
    )
  ),
  -- Lo que se lee en la columna "Acción" de la tabla. Se guarda desnormalizado
  -- a propósito: si mañana borran la plantilla o renombran el nodo, el registro
  -- histórico tiene que seguir contando lo que pasó ESE día.
  action_label text not null,
  status text not null check (status in ('executed', 'waiting', 'skipped', 'error')),
  detail jsonb not null default '{}'::jsonb,
  error text,
  occurred_at timestamptz not null default now()
);

comment on table public.flow_execution_events is
  'Historial append-only de pasos ejecutados por las automatizaciones. Escribe sólo el runtime (service_role); la UI lo lee en /mensajeria/flows/[id]/registros.';
comment on column public.flow_execution_events.detail is
  'Referencias, no contenido: template_id/nombre, tag_id/nombre, rama tomada, minutos de espera, next_run_at, motivo del skip. Sin PII.';

-- Índices pensados para los filtros exactos de la pantalla:
-- listado del flow ordenado por fecha, timeline de una inscripción, y
-- "todo lo que le pasó a este cliente".
create index if not exists flow_execution_events_flow_idx
  on public.flow_execution_events(tenant_id, flow_id, occurred_at desc);
create index if not exists flow_execution_events_execution_idx
  on public.flow_execution_events(execution_id, occurred_at);
create index if not exists flow_execution_events_customer_idx
  on public.flow_execution_events(tenant_id, customer_id, occurred_at desc);

alter table public.flow_execution_events enable row level security;

-- Miembros del tenant leen el historial de su bar.
create policy "flow_execution_events_tenant_read" on public.flow_execution_events
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

-- Data API GRANT (CLAUDE.md §5). Sólo select: los insert son del runtime.
grant select on public.flow_execution_events to authenticated;

-- El proyecto arrastra default privileges que le regalan INSERT/UPDATE/DELETE a
-- `authenticated` (y INSERT/SELECT a `anon`) en cada tabla nueva de `public`. Hoy
-- la RLS ya lo tapa (no existe policy de escritura), pero este log es append-only
-- del runtime: sacamos también el privilegio para que una policy `for all` puesta
-- de apuro mañana no habilite editar el historial.
revoke insert, update, delete on public.flow_execution_events from authenticated;
revoke all on public.flow_execution_events from anon;

-- ──────────────────────────────────────────────
-- Inscripción: registrarla donde REALMENTE ocurre
-- ──────────────────────────────────────────────
-- La execution la crea este RPC, al que llegan tanto los triggers de tiempo
-- (job_queue) como los triggers DB (after_visit, tag_added). Loguear acá y no
-- en el caller de TypeScript es la única forma de que no se escape ninguna
-- inscripción. `v_id is not null` = se creó de verdad (el RPC es idempotente:
-- si ya había una running, devuelve null y no queremos una fila duplicada).
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

  if v_id is not null then
    insert into public.flow_execution_events (
      tenant_id, flow_id, execution_id, customer_id,
      action_type, action_label, status
    )
    values (
      v_tenant, p_flow_id, v_id, p_customer_id,
      'enrolled', 'Entró al flujo', 'executed'
    );
  end if;

  return v_id;
end;
$$;
revoke execute on function public.start_flow_for_customer(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_flow_for_customer(uuid, uuid, jsonb) to service_role;
