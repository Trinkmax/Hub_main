-- ============================================================
-- Difusiones — propagación de entrega/lectura/respuesta a broadcast_recipients
-- ============================================================
-- El webhook ya actualiza messages.status vía update_message_status. Acá agregamos:
--  - sync_broadcast_recipient_status: refleja delivered/read en el recipient (por message_id).
--  - mark_broadcast_replied: ante un inbound, marca 'replied' el recipient reciente
--    (sent/delivered/read) del customer de esa conversación (ventana 7 días).
-- service_role only (mismo patrón que el resto de RPCs de mensajería).
-- ============================================================

create or replace function public.sync_broadcast_recipient_status(
  p_message_id uuid,
  p_status text,
  p_timestamp timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('delivered', 'read') then
    return;
  end if;
  update public.broadcast_recipients br
    set status = case
          when p_status = 'read' then 'read'::public.recipient_status
          when br.status = 'read' then br.status
          else 'delivered'::public.recipient_status
        end,
        delivered_at = case
          when p_status in ('delivered','read') and br.delivered_at is null then p_timestamp
          else br.delivered_at
        end,
        read_at = case
          when p_status = 'read' and br.read_at is null then p_timestamp
          else br.read_at
        end
    where br.message_id = p_message_id;
end;
$$;
revoke execute on function public.sync_broadcast_recipient_status(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_broadcast_recipient_status(uuid, text, timestamptz) to service_role;

create or replace function public.mark_broadcast_replied(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id from public.conversations where id = p_conversation_id;
  if v_customer_id is null then
    return;
  end if;
  update public.broadcast_recipients
    set status = 'replied'::public.recipient_status, replied_at = now()
    where id = (
      select br.id from public.broadcast_recipients br
      where br.customer_id = v_customer_id
        and br.status in ('sent','delivered','read')
        and br.sent_at > now() - interval '7 days'
      order by br.sent_at desc nulls last
      limit 1
    );
end;
$$;
revoke execute on function public.mark_broadcast_replied(uuid) from public, anon, authenticated;
grant execute on function public.mark_broadcast_replied(uuid) to service_role;
