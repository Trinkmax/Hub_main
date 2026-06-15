-- ============================================================
-- Inbox — ingest_inbound_message también puebla las columnas de ergonomía
-- ============================================================
-- Misma firma (no cambia tipos): además de last_message_at + unread_count,
-- setea last_inbound_at, last_message_preview y last_message_direction='inbound'.
-- ============================================================

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
  v_preview text := left(coalesce(nullif(trim(p_content), ''), '📎 Adjunto'), 120);
begin
  insert into public.conversations (
    tenant_id, channel_id, external_user_id, customer_id,
    last_message_at, unread_count, last_inbound_at, last_message_preview, last_message_direction
  ) values (
    p_tenant_id, p_channel_id, p_external_user_id, p_customer_id,
    p_sent_at, 1, p_sent_at, v_preview, 'inbound'
  )
  on conflict (channel_id, external_user_id) do update set
    last_message_at = greatest(conversations.last_message_at, excluded.last_message_at),
    unread_count = conversations.unread_count + 1,
    customer_id = coalesce(conversations.customer_id, excluded.customer_id),
    last_inbound_at = greatest(coalesce(conversations.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at),
    last_message_preview = excluded.last_message_preview,
    last_message_direction = 'inbound'
  returning id into v_conversation_id;

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
