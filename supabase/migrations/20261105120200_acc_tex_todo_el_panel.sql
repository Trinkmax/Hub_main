-- Tex sale de Administración y pasa a todo el panel de gestión (pedido del 05/11/2026): lo usan los socios, Contenido y
-- la anfitriona, aunque no tengan acceso a Administración. Aditivo: suma políticas (las políticas se suman entre sí) y no
-- toca las que había. La charla sigue siendo de quien la tuvo. Los roles del salón (mozos, caja, cocina) quedan afuera.

create policy atxt_panel on public.acc_tex_threads for all to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ))
  with check (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));

create policy atxm_panel_select on public.acc_tex_messages for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));
create policy atxm_panel_insert on public.acc_tex_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));

create policy atxa_panel_select on public.acc_tex_actions for select to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));
create policy atxa_panel_insert on public.acc_tex_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));
create policy atxa_panel_update on public.acc_tex_actions for update to authenticated
  using (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ))
  with check (user_id = (select auth.uid()) and tenant_id in (
    select m.tenant_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner', 'editor', 'host', 'accountant')
  ));
