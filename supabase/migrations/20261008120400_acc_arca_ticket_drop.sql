-- ============================================================
-- ARCA · migración 14: descartar el ticket de acceso (TA) que ARCA rechazó
-- ============================================================
-- Qué crea (SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_ticket_drop: borra el TA guardado de una conexión y un servicio. Lo llama el
--     servidor cuando WSFE o el padrón rechazan un TA todavía vigente (Err 600/601, «No apareció
--     CUIT en lista de relaciones», «Token malformado»). Sin esto, acc_arca_ticket_get lo seguiría
--     devolviendo hasta 10 minutos antes de que venza (hasta 12 h), aunque la persona ya haya
--     arreglado la autorización en ARCA.
-- No toca el lease (si otra instancia está pidiendo un TA, lo guarda igual) ni el cooldown: si el
-- WSAA todavía no da otro («ya posee un TA válido»), ese camino ya deja su espera. Devuelve true
-- si había un TA para borrar; sin conexión o sin TA, false (no es un error).
-- ============================================================

set local lock_timeout = '5s';

create function public.acc_arca_ticket_drop(p_tenant_id uuid, p_environment text, p_service text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn uuid;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  if p_service is null or p_service not in ('wsfe', 'ws_sr_constancia_inscripcion') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'service';
  end if;
  select c.id into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment;
  if v_conn is null then
    return false;
  end if;
  update public.acc_arca_tickets t
     set token_enc = null, sign_enc = null, generation_time = null, expiration_time = null
   where t.connection_id = v_conn and t.tenant_id = p_tenant_id and t.service = p_service
     and t.token_enc is not null;
  if not found then
    return false;
  end if;
  -- Sin el token, el sign ni la CUIT: solo qué se descartó.
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.ticket_dropped', 'acc_arca_connection', v_conn,
    jsonb_build_object('environment', p_environment, 'service', p_service));
  return true;
end;
$$;

comment on function public.acc_arca_ticket_drop(uuid, text, text) is
  'Borra el TA guardado de una conexión y un servicio porque ARCA lo rechazó estando vigente. No toca el lease ni el cooldown. true si había uno.';

revoke all on function public.acc_arca_ticket_drop(uuid, text, text) from public, anon;
grant execute on function public.acc_arca_ticket_drop(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
