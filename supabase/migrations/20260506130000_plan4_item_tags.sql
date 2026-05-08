-- Plan 4: item_tags + menu_item_tag_assignments
-- Sistema de tags sobre ítems de carta, análogo al existente customer_tags.
-- Habilita el trigger 'tag' de las punch cards.

create table public.item_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  color       text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index item_tags_tenant_idx on public.item_tags(tenant_id);

create table public.menu_item_tag_assignments (
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  tag_id        uuid not null references public.item_tags(id) on delete cascade,
  primary key (menu_item_id, tag_id)
);
create index menu_item_tag_assignments_tag_idx
  on public.menu_item_tag_assignments(tag_id);

-- ──────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────
alter table public.item_tags enable row level security;
create policy "it_select_member" on public.item_tags
  for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "it_owner_insert" on public.item_tags
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "it_owner_update" on public.item_tags
  for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "it_owner_delete" on public.item_tags
  for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

alter table public.menu_item_tag_assignments enable row level security;
create policy "mita_select_member" on public.menu_item_tag_assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id
        and mi.tenant_id in (select public.user_tenant_ids())
    )
  );
create policy "mita_owner_write" on public.menu_item_tag_assignments
  for all to authenticated
  using (
    exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id
        and public.user_role_in_tenant(mi.tenant_id) = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.menu_items mi
      where mi.id = menu_item_id
        and public.user_role_in_tenant(mi.tenant_id) = 'owner'
    )
  );

grant select, insert, update, delete on public.item_tags to authenticated;
grant select, insert, update, delete on public.menu_item_tag_assignments to authenticated;
