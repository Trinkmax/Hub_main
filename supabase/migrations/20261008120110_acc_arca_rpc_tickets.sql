-- ============================================================
-- ARCA e importadores · migración 4 de 12 (diseño §2.5, §6.3)
-- RPC del ticket de acceso (TA) del WSAA: leer o tomar el lease, e informar el login
-- ============================================================
-- Qué crea (SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_ticket_get / acc_arca_ticket_put: el TA vive en la base (en serverless cada
--     instancia arranca vacía) y se renueva bajo un LEASE persistido: el login es HTTP y dura más
--     que una transacción de PostgREST, así que no sirve un lock transaccional. ticket_get
--     devuelve {status: valid | cooldown | busy | lease}; con `lease`, quien llamó hace el login y
--     lo informa con ticket_put (el lease tiene que coincidir: si no, arca_lease_lost).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Ticket de acceso: leer o tomar el lease ──────────────────────────────
-- Reglas: se reusa el TA hasta expiration_time − 10 min; con cooldown (política del WSAA) no se
-- pide otro; si otra instancia tiene el lease, `busy` (reintentar en 1,5 s). El lease dura entre
-- 15 y 120 s. «Probar conexión» (p_clear_manual_cooldown) borra el cooldown MANUAL, no el de
-- tiempo. Si el TA vigente no se puede descifrar con la clave que llega (otro deploy con otra
-- clave, o la clave cambió), sale secret_unreadable y NO se toca nada: borrarlo no ayuda (con
-- esa clave tampoco se abre la clave privada para pedir otro) y el WSAA no da un TA nuevo
-- mientras ese siga vigente (coe.alreadyAuthenticated), así que dejaría sin ARCA hasta 12 h a
-- quien sí tiene la clave. Sin advisory lock: alcanza con el lock de la fila del ticket.
create function public.acc_arca_ticket_get(p_tenant_id uuid, p_environment text, p_service text, p_secret_key text,
                                           p_lease_seconds int default 60,
                                           p_clear_manual_cooldown boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.acc_arca_connections;
  v_t public.acc_arca_tickets;
  v_lease uuid := gen_random_uuid();
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform private.acc_arca_check_env(p_environment);
  perform private.acc_secret_key_check(p_secret_key);
  if p_service is null or p_service not in ('wsfe', 'ws_sr_constancia_inscripcion') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'service';
  end if;
  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment;
  if not found or v_conn.status not in ('cert_ready', 'connected', 'error') then
    raise exception 'arca_not_ready' using errcode = 'P0001';
  end if;

  insert into public.acc_arca_tickets (connection_id, tenant_id, service)
  values (v_conn.id, p_tenant_id, p_service)
  on conflict (connection_id, service) do nothing;
  select * into v_t from public.acc_arca_tickets t
   where t.connection_id = v_conn.id and t.service = p_service
   for update;

  if coalesce(p_clear_manual_cooldown, false) and v_t.cooldown_manual then
    update public.acc_arca_tickets t set cooldown_manual = false
     where t.connection_id = v_conn.id and t.service = p_service
     returning * into v_t;
  end if;

  -- Con otra clave, acc_decrypt corta con secret_unreadable y la transacción entera vuelve atrás.
  if v_t.expiration_time is not null and v_t.expiration_time > now() + interval '10 minutes' then
    return jsonb_build_object('status', 'valid',
                              'token', private.acc_decrypt(v_t.token_enc, p_secret_key),
                              'sign', private.acc_decrypt(v_t.sign_enc, p_secret_key),
                              'expires_at', v_t.expiration_time);
  end if;

  if v_t.cooldown_manual or (v_t.cooldown_until is not null and v_t.cooldown_until > now()) then
    return jsonb_build_object('status', 'cooldown', 'until', v_t.cooldown_until, 'manual', v_t.cooldown_manual,
                              'last_error_key', v_t.last_error_key);
  end if;
  if v_t.lease_until is not null and v_t.lease_until > now() then
    return jsonb_build_object('status', 'busy', 'retry_after_ms', 1500);
  end if;
  update public.acc_arca_tickets t
     set lease_id = v_lease,
         lease_until = now() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 60), 120)))
   where t.connection_id = v_conn.id and t.service = p_service;
  return jsonb_build_object('status', 'lease', 'lease_id', v_lease);
end;
$$;

-- ─── 2. Ticket de acceso: informar el resultado del login ────────────────────
-- p_result: {ok: true, token, sign, generation_time, expiration_time} (instantes ISO con zona) o
-- {ok: false, key, cooldown: segundos (0–3600) | 'manual' | null}. Siempre libera el lease. Con
-- error no se toca el TA anterior (si todavía sirve, ticket_get lo sigue devolviendo).
create function public.acc_arca_ticket_put(p_tenant_id uuid, p_environment text, p_service text, p_lease_id uuid,
                                           p_result jsonb, p_secret_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.acc_arca_connections;
  v_t public.acc_arca_tickets;
  v_token text;
  v_sign text;
  v_gen timestamptz;
  v_exp timestamptz;
  v_key text;
  v_cool jsonb;
  v_secs bigint;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform private.acc_arca_check_env(p_environment);
  if p_service is null or p_service not in ('wsfe', 'ws_sr_constancia_inscripcion') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'service';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_result -> 'ok') is distinct from 'boolean' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'result';
  end if;
  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment;
  if not found then
    raise exception 'arca_not_ready' using errcode = 'P0001';
  end if;
  select * into v_t from public.acc_arca_tickets t
   where t.connection_id = v_conn.id and t.service = p_service
   for update;
  if not found or p_lease_id is null or v_t.lease_id is distinct from p_lease_id then
    raise exception 'arca_lease_lost' using errcode = 'P0001';
  end if;

  if (p_result ->> 'ok')::boolean then
    v_token := p_result ->> 'token';
    v_sign := p_result ->> 'sign';
    v_gen := private.acc_to_ts(p_result ->> 'generation_time');
    v_exp := private.acc_to_ts(p_result ->> 'expiration_time');
    if v_token is null or char_length(v_token) not between 1 and 12000
       or v_sign is null or char_length(v_sign) not between 1 and 2000 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'token';
    end if;
    if v_exp is null or v_exp <= now() or (v_gen is not null and v_gen >= v_exp) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'expiration_time';
    end if;
    update public.acc_arca_tickets t
       set token_enc = private.acc_encrypt(v_token, p_secret_key), sign_enc = private.acc_encrypt(v_sign, p_secret_key),
           generation_time = v_gen, expiration_time = v_exp, lease_id = null, lease_until = null,
           cooldown_until = null, cooldown_manual = false, last_error_key = null, last_error_at = null
     where t.connection_id = v_conn.id and t.service = p_service;
  else
    v_key := p_result ->> 'key';
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,59}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'key';
    end if;
    v_cool := p_result -> 'cooldown';
    if v_cool is null or jsonb_typeof(v_cool) = 'null' then
      v_secs := 0;
    elsif jsonb_typeof(v_cool) = 'string' and v_cool #>> '{}' = 'manual' then
      v_secs := null;                                              -- manual: hasta que la persona vuelva a probar
    else
      v_secs := private.acc_to_bigint(v_cool);
      if v_secs is null or v_secs not between 0 and 3600 then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cooldown';
      end if;
    end if;
    update public.acc_arca_tickets t
       set lease_id = null, lease_until = null, cooldown_manual = (v_secs is null),
           cooldown_until = case when v_secs > 0 then now() + make_interval(secs => v_secs) end,
           last_error_key = v_key, last_error_at = now()
     where t.connection_id = v_conn.id and t.service = p_service;
  end if;
end;
$$;

comment on function public.acc_arca_ticket_get(uuid, text, text, text, integer, boolean) is
  'Ticket de acceso del WSAA: {status: valid (token, sign) | cooldown | busy | lease (lease_id)}. Lease persistido para que lo renueve una sola instancia.';
comment on function public.acc_arca_ticket_put(uuid, text, text, uuid, jsonb, text) is
  'Resultado del login al WSAA bajo un lease: guarda el TA cifrado o el cooldown, y libera el lease. arca_lease_lost si el lease no coincide.';

-- ─── 3. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_arca_ticket_get(uuid, text, text, text, integer, boolean) from public, anon;
grant execute on function public.acc_arca_ticket_get(uuid, text, text, text, integer, boolean) to authenticated;
revoke all on function public.acc_arca_ticket_put(uuid, text, text, uuid, jsonb, text) from public, anon;
grant execute on function public.acc_arca_ticket_put(uuid, text, text, uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
