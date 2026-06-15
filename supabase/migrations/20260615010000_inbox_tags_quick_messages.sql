-- ============================================================
-- Inbox — etiquetas de conversación + mensajes rápidos + ergonomía de conversación
-- ============================================================
-- Etiquetas de conversación (distintas de customer_tags: muchas conversaciones
-- de WA no tienen customer_id). Mensajes rápidos (canned replies). Y columnas
-- de ergonomía en conversations (ventana 24h, leído, preview).
-- LEY: RLS por membresía con (select auth.uid()) (patrón initplan de main) + GRANTs.
-- Idempotente. Correr `db:types` (MCP) después.
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. conversation_tags (vocabulario por tenant)
-- ──────────────────────────────────────────────
create table if not exists public.conversation_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  color text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists conversation_tags_tenant_name_uidx
  on public.conversation_tags(tenant_id, lower(name));

-- ──────────────────────────────────────────────
-- 2. conversation_tag_assignments (N:M)
-- ──────────────────────────────────────────────
create table if not exists public.conversation_tag_assignments (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.conversation_tags(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (conversation_id, tag_id)
);
create index if not exists cta_tag_idx on public.conversation_tag_assignments(tag_id);

-- ──────────────────────────────────────────────
-- 3. quick_messages (mensajes rápidos / canned replies)
-- ──────────────────────────────────────────────
create table if not exists public.quick_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 80),
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,40}$'),
  body text not null check (length(body) between 1 and 1024),
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists quick_messages_tenant_shortcut_uidx
  on public.quick_messages(tenant_id, shortcut);
drop trigger if exists quick_messages_updated_at on public.quick_messages;
create trigger quick_messages_updated_at before update on public.quick_messages
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- 4. conversations — columnas de ergonomía del inbox
-- ──────────────────────────────────────────────
alter table public.conversations
  add column if not exists last_inbound_at timestamptz;
alter table public.conversations
  add column if not exists last_read_at timestamptz;
alter table public.conversations
  add column if not exists last_message_preview text;
alter table public.conversations
  add column if not exists last_message_direction public.message_direction;

-- ──────────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────────
alter table public.conversation_tags enable row level security;
alter table public.conversation_tag_assignments enable row level security;
alter table public.quick_messages enable row level security;

-- conversation_tags: lectura miembros; escritura owner/cashier
create policy "conversation_tags_member_read" on public.conversation_tags
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = (select auth.uid()))
  );
create policy "conversation_tags_staff_write" on public.conversation_tags
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'cashier')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'cashier')
    )
  );

-- conversation_tag_assignments: cualquier miembro del tenant de la conversación
create policy "cta_member_all" on public.conversation_tag_assignments
  for all
  using (
    conversation_id in (
      select id from public.conversations
      where tenant_id in (select tenant_id from public.memberships where user_id = (select auth.uid()))
    )
  )
  with check (
    conversation_id in (
      select id from public.conversations
      where tenant_id in (select tenant_id from public.memberships where user_id = (select auth.uid()))
    )
  );

-- quick_messages: lectura miembros; escritura owner/cashier
create policy "quick_messages_member_read" on public.quick_messages
  for select using (
    tenant_id in (select tenant_id from public.memberships where user_id = (select auth.uid()))
  );
create policy "quick_messages_staff_write" on public.quick_messages
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'cashier')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = (select auth.uid()) and role in ('owner', 'cashier')
    )
  );

-- ──────────────────────────────────────────────
-- 6. Data API GRANTs
-- ──────────────────────────────────────────────
grant select, insert, update, delete on public.conversation_tags to authenticated;
grant select, insert, update, delete on public.conversation_tag_assignments to authenticated;
grant select, insert, update, delete on public.quick_messages to authenticated;
