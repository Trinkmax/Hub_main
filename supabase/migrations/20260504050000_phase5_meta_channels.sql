-- Phase 5: conexión a Meta (WhatsApp Cloud + Instagram)
-- Tablas: channels, message_templates, conversations, messages
-- Cifrado de tokens vía pgp_sym_encrypt con clave inyectada por argumento
-- (la clave vive en process.env.META_TOKEN_KEY y se pasa por RPC).

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'channel_type') then
    create type public.channel_type as enum ('whatsapp', 'instagram');
  end if;
  if not exists (select 1 from pg_type where typname = 'channel_status') then
    create type public.channel_status as enum ('connected', 'disconnected', 'error');
  end if;
  if not exists (select 1 from pg_type where typname = 'template_status') then
    create type public.template_status as enum (
      'draft', 'pending', 'approved', 'rejected', 'disabled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'message_direction') then
    create type public.message_direction as enum ('inbound', 'outbound');
  end if;
  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type public.message_status as enum (
      'queued', 'sent', 'delivered', 'read', 'failed'
    );
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. channels
-- ──────────────────────────────────────────────────────────
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.channel_type not null,
  status public.channel_status not null default 'disconnected',
  external_account_id text not null,
  external_phone_number_id text,
  display_name text,
  encrypted_access_token text,
  token_expires_at timestamptz,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, type)
);
create index channels_tenant_idx on public.channels(tenant_id);
-- ruteo de webhook: phone_number_id (WA) o external_account_id (IG user id)
create index channels_phone_number_idx
  on public.channels(external_phone_number_id) where external_phone_number_id is not null;
create index channels_account_idx on public.channels(external_account_id);
create trigger channels_updated_at before update on public.channels
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 3. message_templates
-- ──────────────────────────────────────────────────────────
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  meta_template_id text,
  name text not null,
  language text not null,
  category text not null,
  components jsonb not null default '[]'::jsonb,
  status public.template_status not null default 'draft',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index message_templates_channel_name_lang_uidx
  on public.message_templates(channel_id, name, language);
create index message_templates_tenant_idx on public.message_templates(tenant_id);
create index message_templates_status_idx on public.message_templates(tenant_id, status);

-- ──────────────────────────────────────────────────────────
-- 4. conversations
-- ──────────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  external_user_id text not null,
  last_message_at timestamptz,
  unread_count int not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now()
);
create unique index conversations_channel_user_uidx
  on public.conversations(channel_id, external_user_id);
create index conversations_tenant_last_msg_idx
  on public.conversations(tenant_id, last_message_at desc nulls last);
create index conversations_customer_idx
  on public.conversations(customer_id) where customer_id is not null;

-- ──────────────────────────────────────────────────────────
-- 5. messages
-- ──────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  content text,
  media jsonb,
  meta_message_id text unique,
  status public.message_status,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  -- FKs a broadcasts/flow_executions se agregan en fases 6 y 7
  broadcast_id uuid,
  flow_execution_id uuid,
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);
create index messages_tenant_created_idx
  on public.messages(tenant_id, created_at desc);
create index messages_status_idx
  on public.messages(tenant_id, status) where status is not null;

-- ──────────────────────────────────────────────────────────
-- 6. RLS
-- ──────────────────────────────────────────────────────────
alter table public.channels enable row level security;
alter table public.message_templates enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- channels: solo owner puede mutar; cualquiera con membership puede leer estado
create policy "channels_tenant_read" on public.channels
  for select using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );
create policy "channels_owner_write" on public.channels
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- message_templates: lectura para staff con membership; escritura para owner
create policy "templates_tenant_read" on public.message_templates
  for select using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );
create policy "templates_owner_write" on public.message_templates
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- conversations + messages: cualquier miembro del tenant puede leer/escribir
create policy "conversations_tenant_isolation" on public.conversations
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

create policy "messages_tenant_isolation" on public.messages
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────
-- 7. Cifrado de tokens (pgp_sym_encrypt con clave por argumento)
-- ──────────────────────────────────────────────────────────
-- Las funciones reciben la clave como argumento (no leen GUC) para que el
-- caller (service role en Node) pueda inyectarla desde process.env.META_TOKEN_KEY.
-- SECURITY DEFINER no es necesario porque solo el service role llama a esto.

create or replace function public.encrypt_meta_token(plaintext text, key text)
returns text
language sql
volatile
as $$
  select encode(
    pgp_sym_encrypt(plaintext, key, 'cipher-algo=aes256, compress-algo=0'),
    'base64'
  );
$$;

create or replace function public.decrypt_meta_token(ciphertext text, key text)
returns text
language sql
volatile
as $$
  select pgp_sym_decrypt(decode(ciphertext, 'base64'), key);
$$;

-- Acceso solo para service_role (los clientes browser/authenticated nunca cifran).
revoke execute on function public.encrypt_meta_token(text, text) from public, anon, authenticated;
revoke execute on function public.decrypt_meta_token(text, text) from public, anon, authenticated;
grant execute on function public.encrypt_meta_token(text, text) to service_role;
grant execute on function public.decrypt_meta_token(text, text) to service_role;

-- ──────────────────────────────────────────────────────────
-- 8. RPC de ingesta de webhook (idempotente)
-- ──────────────────────────────────────────────────────────
-- Crea/actualiza conversation + inserta message si meta_message_id no existe.
-- Devuelve el id del mensaje (o null si era duplicado).
create or replace function public.ingest_inbound_message(
  p_tenant_id uuid,
  p_channel_id uuid,
  p_external_user_id text,
  p_meta_message_id text,
  p_content text,
  p_media jsonb,
  p_sent_at timestamptz,
  p_customer_id uuid
)
returns table (message_id uuid, conversation_id uuid, was_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_was_new boolean := true;
begin
  -- upsert conversation por (channel_id, external_user_id)
  insert into public.conversations (
    tenant_id, channel_id, external_user_id, customer_id,
    last_message_at, unread_count
  ) values (
    p_tenant_id, p_channel_id, p_external_user_id, p_customer_id,
    p_sent_at, 1
  )
  on conflict (channel_id, external_user_id) do update set
    last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
    unread_count = conversations.unread_count + 1,
    customer_id = coalesce(conversations.customer_id, excluded.customer_id)
  returning id into v_conversation_id;

  -- inserta mensaje, dedupe por meta_message_id
  insert into public.messages (
    tenant_id, conversation_id, direction, content, media,
    meta_message_id, status, sent_at
  ) values (
    p_tenant_id, v_conversation_id, 'inbound', p_content, p_media,
    p_meta_message_id, 'delivered', p_sent_at
  )
  on conflict (meta_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    -- ya existía; rollback del unread_count++
    update public.conversations
      set unread_count = greatest(conversations.unread_count - 1, 0)
      where id = v_conversation_id;
    select id into v_message_id from public.messages
      where meta_message_id = p_meta_message_id;
    v_was_new := false;
  end if;

  return query select v_message_id, v_conversation_id, v_was_new;
end;
$$;

revoke execute on function public.ingest_inbound_message(uuid, uuid, text, text, text, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(uuid, uuid, text, text, text, jsonb, timestamptz, uuid)
  to service_role;

-- Status update de mensaje outbound (delivered / read / failed)
create or replace function public.update_message_status(
  p_meta_message_id text,
  p_status public.message_status,
  p_error text,
  p_timestamp timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.messages set
    status = case
      when p_status = 'failed' then 'failed'::public.message_status
      -- monotonic: no degradar de read a delivered, etc.
      when status is null then p_status
      when status = 'queued' then p_status
      when status = 'sent' and p_status in ('delivered', 'read') then p_status
      when status = 'delivered' and p_status = 'read' then p_status
      else status
    end,
    error = case when p_status = 'failed' then p_error else error end,
    delivered_at = case
      when p_status = 'delivered' and delivered_at is null then p_timestamp
      else delivered_at
    end,
    read_at = case
      when p_status = 'read' and read_at is null then p_timestamp
      else read_at
    end
  where meta_message_id = p_meta_message_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.update_message_status(text, public.message_status, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_message_status(text, public.message_status, text, timestamptz)
  to service_role;

-- ──────────────────────────────────────────────────────────
-- 9. Realtime publication
-- ──────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- ──────────────────────────────────────────────────────────
-- 10. Data API GRANTs (CLAUDE.md sec. 5)
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.channels to authenticated;
grant select, insert, update, delete on public.message_templates to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
