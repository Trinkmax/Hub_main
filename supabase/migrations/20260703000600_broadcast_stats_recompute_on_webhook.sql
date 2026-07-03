-- Fix crítico (auditoría mensajería): métricas delivered/read/replied congeladas.
--
-- El webhook actualiza broadcast_recipients (status + delivered_at/read_at/
-- replied_at) vía sync_broadcast_recipient_status / mark_broadcast_replied, pero
-- nadie recomputaba broadcasts.stats (el JSON que muestra la UI) fuera del send
-- path → las métricas quedaban en ~0. Se agrega el recompute en ambos RPCs vía un
-- helper compartido. Idempotente (CREATE OR REPLACE).

create or replace function public.recompute_broadcast_stats(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_excluded int;
begin
  select coalesce((stats->>'excluded')::int, 0) into v_excluded
    from public.broadcasts where id = p_broadcast_id;
  update public.broadcasts set stats = jsonb_build_object(
    'total',     (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id),
    'sent',      (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id and status = 'sent'),
    'failed',    (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id and status = 'failed'),
    'delivered', (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id and status = 'delivered'),
    'read',      (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id and status = 'read'),
    'replied',   (select count(*) from public.broadcast_recipients where broadcast_id = p_broadcast_id and status = 'replied'),
    'excluded',  v_excluded
  ) where id = p_broadcast_id;
end;
$function$;
revoke execute on function public.recompute_broadcast_stats(uuid) from public, anon, authenticated;
grant execute on function public.recompute_broadcast_stats(uuid) to service_role;

create or replace function public.sync_broadcast_recipient_status(p_message_id uuid, p_status text, p_timestamp timestamptz)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_broadcast_id uuid;
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
    where br.message_id = p_message_id
    returning br.broadcast_id into v_broadcast_id;
  if v_broadcast_id is not null then
    perform public.recompute_broadcast_stats(v_broadcast_id);
  end if;
end;
$function$;

create or replace function public.mark_broadcast_replied(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer_id uuid;
  v_recipient_id uuid;
  v_broadcast_id uuid;
begin
  select customer_id into v_customer_id from public.conversations where id = p_conversation_id;
  if v_customer_id is null then
    return;
  end if;
  select br.id into v_recipient_id
    from public.broadcast_recipients br
    where br.customer_id = v_customer_id
      and br.status in ('sent','delivered','read')
      and br.sent_at > now() - interval '7 days'
    order by br.sent_at desc nulls last
    limit 1;
  if v_recipient_id is null then
    return;
  end if;
  update public.broadcast_recipients
    set status = 'replied'::public.recipient_status, replied_at = now()
    where id = v_recipient_id
    returning broadcast_id into v_broadcast_id;
  if v_broadcast_id is not null then
    perform public.recompute_broadcast_stats(v_broadcast_id);
  end if;
end;
$function$;
