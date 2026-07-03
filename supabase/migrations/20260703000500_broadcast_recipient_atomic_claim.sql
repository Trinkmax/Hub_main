-- Fix crítico (auditoría mensajería): envíos WhatsApp duplicados en difusiones.
--
-- El handler hacía `if status != 'pending' return` (read-check NO atómico) antes
-- de enviar; con el reaper de jobs (requeue_stuck_jobs, 300s) re-encolando un job
-- que ya había enviado pero no alcanzó a marcar 'sent', el mensaje se re-enviaba.
--
-- Se reemplaza por un claim atómico pending → sending. El lease `claimed_at` con
-- ventana de 5min permite re-tomar un recipient si el worker murió (self-heal),
-- sin dejarlo colgado. `maybeFinalizeBroadcast` espera a que no queden 'pending'
-- ni 'sending'. Idempotente.

alter table public.broadcast_recipients
  add column if not exists claimed_at timestamptz;

create or replace function public.claim_broadcast_recipient(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claimed boolean;
begin
  update public.broadcast_recipients
     set status = 'sending', claimed_at = now()
   where id = p_id
     and (status = 'pending'
          or (status = 'sending' and claimed_at < now() - interval '5 minutes'))
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$function$;

revoke execute on function public.claim_broadcast_recipient(uuid) from public, anon, authenticated;
grant execute on function public.claim_broadcast_recipient(uuid) to service_role;
