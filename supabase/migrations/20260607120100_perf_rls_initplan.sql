-- Performance: las RLS re-evaluaban auth.uid() por fila (advisor: auth_rls_initplan).
-- Envolver en (select auth.uid()) hace que Postgres lo evalúe UNA vez por query (initplan)
-- en vez de por cada fila. Misma semántica de aislamiento; solo cambia el plan.
-- Recreamos las 16 policies afectadas (tablas de marketing/mensajería).

-- audiences
drop policy if exists "audiences_member_read" on public.audiences;
create policy "audiences_member_read" on public.audiences
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

drop policy if exists "audiences_owner_write" on public.audiences;
create policy "audiences_owner_write" on public.audiences
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role));

-- broadcast_recipients
drop policy if exists "broadcast_recipients_member_read" on public.broadcast_recipients;
create policy "broadcast_recipients_member_read" on public.broadcast_recipients
  for select using (broadcast_id in (
    select broadcasts.id from broadcasts
    where broadcasts.tenant_id in (
      select memberships.tenant_id from memberships
      where memberships.user_id = (select auth.uid()))));

-- broadcasts
drop policy if exists "broadcasts_member_read" on public.broadcasts;
create policy "broadcasts_member_read" on public.broadcasts
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

drop policy if exists "broadcasts_owner_write" on public.broadcasts;
create policy "broadcasts_owner_write" on public.broadcasts
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role));

-- channels
drop policy if exists "channels_tenant_read" on public.channels;
create policy "channels_tenant_read" on public.channels
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

drop policy if exists "channels_owner_write" on public.channels;
create policy "channels_owner_write" on public.channels
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role));

-- conversations
drop policy if exists "conversations_tenant_isolation" on public.conversations;
create policy "conversations_tenant_isolation" on public.conversations
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

-- flow_executions
drop policy if exists "flow_executions_member_read" on public.flow_executions;
create policy "flow_executions_member_read" on public.flow_executions
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

-- flow_steps
drop policy if exists "flow_steps_member_read" on public.flow_steps;
create policy "flow_steps_member_read" on public.flow_steps
  for select using (flow_id in (
    select flows.id from flows
    where flows.tenant_id in (
      select memberships.tenant_id from memberships
      where memberships.user_id = (select auth.uid()))));

drop policy if exists "flow_steps_owner_write" on public.flow_steps;
create policy "flow_steps_owner_write" on public.flow_steps
  for all using (flow_id in (
    select flows.id from flows
    where flows.tenant_id in (
      select memberships.tenant_id from memberships
      where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role)))
  with check (flow_id in (
    select flows.id from flows
    where flows.tenant_id in (
      select memberships.tenant_id from memberships
      where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role)));

-- flows
drop policy if exists "flows_member_read" on public.flows;
create policy "flows_member_read" on public.flows
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

drop policy if exists "flows_owner_write" on public.flows;
create policy "flows_owner_write" on public.flows
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role));

-- message_templates
drop policy if exists "templates_tenant_read" on public.message_templates;
create policy "templates_tenant_read" on public.message_templates
  for select using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));

drop policy if exists "templates_owner_write" on public.message_templates;
create policy "templates_owner_write" on public.message_templates
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid()) and memberships.role = 'owner'::tenant_role));

-- messages
drop policy if exists "messages_tenant_isolation" on public.messages;
create policy "messages_tenant_isolation" on public.messages
  for all using (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())))
  with check (tenant_id in (
    select memberships.tenant_id from memberships
    where memberships.user_id = (select auth.uid())));
