-- ============================================================
-- ARCA e importadores · migración 12 de 12 (diseño §4.2.1, §4.2.4, §6.3)
-- RPC de Mercado Pago: configuración, token cifrado y las del cron de sincronización
-- ============================================================
-- Qué crea:
--   · acc_mp_save_connection: crea (con la billetera y el partícipe `mercado_pago` por defecto) o
--     edita la configuración: caja, partícipe, medio del cierre por canal (activos y del bar) y corte
--     del día.
--   · acc_mp_store_token: guarda el Access Token CIFRADO (acc_secrets) y deja `connected`; en la
--     tabla quedan solo los últimos 4 caracteres. acc_mp_get_token lo descifra («Traer ahora»).
--   · acc_mp_disconnect: borra los tokens; la configuración queda (los CSV siguen andando).
--   · acc_mp_sync_targets_service / acc_mp_sync_record_service: SOLO service_role (cron). Los bares
--     con Administración y Mercado Pago conectado, con su token descifrado; y registrar el resultado
--     de cada tick (D7: el cron prepara lotes, nunca contabiliza).
-- Los tokens se descifran solo con la clave del servidor (p_secret_key); nunca se auditan.
-- Se usarán en la fase 3 (Mercado Pago por API); nacen ahora para cerrar la base de una vez.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Helper: la conexión (bloqueada), o una nueva con los valores por defecto ─
-- Caja: la indicada, o la billetera activa del partícipe Mercado Pago (o la primera billetera).
-- Partícipe: el indicado, o el de sistema `mercado_pago`. Quien llama ya tiene el advisory lock.
create function private.acc_mp_conn_ensure(p_tenant uuid, p_uid uuid, p_treasury uuid default null,
                                           p_party uuid default null)
returns public.acc_mp_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.acc_mp_connections;
  v_party uuid := p_party;
  v_treasury uuid := p_treasury;
begin
  select * into v_row from public.acc_mp_connections m where m.tenant_id = p_tenant for update;
  if found then
    return v_row;
  end if;
  if v_party is null then
    select p.id into v_party from public.acc_parties p
     where p.tenant_id = p_tenant and p.system_key = 'mercado_pago' and p.active;
  end if;
  if v_treasury is null then
    select t.id into v_treasury from public.acc_treasury_accounts t
     where t.tenant_id = p_tenant and t.active and t.kind = 'wallet'
     order by (t.bank_party_id is not distinct from v_party) desc, t.sort, t.name
     limit 1;
  end if;
  if v_party is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'party_id';
  end if;
  if v_treasury is null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
  end if;
  insert into public.acc_mp_connections (tenant_id, treasury_account_id, party_id, created_by, updated_by)
  values (p_tenant, v_treasury, v_party, p_uid, p_uid)
  returning * into v_row;
  return v_row;
end;
$$;

-- ─── 2. Configuración ────────────────────────────────────────────────────────
-- p_patch (lista blanca): {treasury_account_id?: billetera activa, party_id?: billetera de pagos activa,
-- channel_methods?: {qr|point|transfer_in|link: <medio de cobro activo> | null}, day_cutoff_hour?: 0–8}.
-- Conexión existente: concurrencia optimista al milisegundo.
create function public.acc_mp_save_connection(p_tenant_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_mp_connections;
  v_new public.acc_mp_connections;
  v_created boolean;
  v_bad text;
  v_treasury uuid;
  v_party uuid;
  v_int bigint;
  v_fields jsonb;
  r record;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'patch';
  end if;
  select k into v_bad from jsonb_object_keys(p_patch) k
   where k not in ('treasury_account_id', 'party_id', 'channel_methods', 'day_cutoff_hour')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_treasury := private.acc_to_uuid(p_patch ->> 'treasury_account_id');
  if p_patch ? 'treasury_account_id' and not exists (
       select 1 from public.acc_treasury_accounts t
        where t.id = v_treasury and t.tenant_id = p_tenant_id and t.active and t.kind = 'wallet') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
  end if;
  v_party := private.acc_to_uuid(p_patch ->> 'party_id');
  if p_patch ? 'party_id' and not exists (
       select 1 from public.acc_parties p
        where p.id = v_party and p.tenant_id = p_tenant_id and p.active and p.kind = 'payment_wallet') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'party_id';
  end if;
  if p_patch ? 'channel_methods' then
    if jsonb_typeof(p_patch -> 'channel_methods') <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'channel_methods';
    end if;
    for r in select e.key, e.value from jsonb_each(p_patch -> 'channel_methods') e loop
      if r.key not in ('qr', 'point', 'transfer_in', 'link')
         or (jsonb_typeof(r.value) <> 'null' and not exists (
               select 1 from public.acc_sales_methods m
                where m.id = private.acc_to_uuid(r.value #>> '{}') and m.tenant_id = p_tenant_id and m.active)) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'channel_methods.' || r.key;
      end if;
    end loop;
  end if;
  if p_patch ? 'day_cutoff_hour' then
    v_int := private.acc_to_bigint(p_patch -> 'day_cutoff_hour');
    if v_int is null or v_int not between 0 and 8 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'day_cutoff_hour';
    end if;
  end if;

  select * into v_old from public.acc_mp_connections m where m.tenant_id = p_tenant_id for update;
  v_created := not found;
  if v_created then
    v_old := private.acc_mp_conn_ensure(p_tenant_id, v_uid, v_treasury, v_party);
  elsif p_expected_updated_at is null
        or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;

  update public.acc_mp_connections m
     set treasury_account_id = coalesce(v_treasury, v_old.treasury_account_id),
         party_id = coalesce(v_party, v_old.party_id),
         channel_methods = case when p_patch ? 'channel_methods'
                                then jsonb_strip_nulls(v_old.channel_methods || (p_patch -> 'channel_methods'))
                                else v_old.channel_methods end,
         day_cutoff_hour = coalesce(v_int, v_old.day_cutoff_hour),
         updated_by = v_uid
   where m.id = v_old.id
   returning * into v_new;

  v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                 from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_mp.connection_saved', 'acc_mp_connection', v_new.id,
    jsonb_build_object('created', v_created, 'fields', v_fields));
  return to_jsonb(v_new);
end;
$$;

-- ─── 3. Token ────────────────────────────────────────────────────────────────
-- p_token: el Access Token de producción (APP_USR-…; la forma exacta está a confirmar con un token
-- real). p_meta (de GET /users/me, lista blanca): {mp_user_id, site_id: 'MLA', scopes?}.
create function public.acc_mp_store_token(p_tenant_id uuid, p_token text, p_meta jsonb, p_secret_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_mp_connections;
  v_bad text;
  v_user bigint;
  v_scopes text[];
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_secret_key_check(p_secret_key);
  if p_token is null or p_token !~ '^APP_USR-[0-9A-Za-z-]{20,250}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'token';
  end if;
  if jsonb_typeof(p_meta) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'meta';
  end if;
  select k into v_bad from jsonb_object_keys(p_meta) k where k not in ('mp_user_id', 'site_id', 'scopes') limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_user := private.acc_to_bigint(p_meta -> 'mp_user_id');
  if v_user is null or v_user <= 0 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'mp_user_id';
  end if;
  if p_meta ->> 'site_id' is distinct from 'MLA' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'site_id';
  end if;
  if coalesce(jsonb_typeof(p_meta -> 'scopes'), 'null') <> 'null' then
    if jsonb_typeof(p_meta -> 'scopes') <> 'array' or jsonb_array_length(p_meta -> 'scopes') > 30
       or exists (select 1 from jsonb_array_elements(p_meta -> 'scopes') x
                   where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 60) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'scopes';
    end if;
    v_scopes := array(select jsonb_array_elements_text(p_meta -> 'scopes'));
  end if;

  v_conn := private.acc_mp_conn_ensure(p_tenant_id, v_uid);
  insert into public.acc_secrets (tenant_id, mp_connection_id, name, ciphertext)
  values (p_tenant_id, v_conn.id, 'access_token', private.acc_encrypt(p_token, p_secret_key))
  on conflict (mp_connection_id, tenant_id, name) where mp_connection_id is not null
  do update set ciphertext = excluded.ciphertext, key_version = excluded.key_version, expires_at = null;
  update public.acc_mp_connections m
     set status = 'connected', token_last4 = right(p_token, 4), mp_user_id = v_user, site_id = 'MLA',
         scopes = v_scopes, last_error_key = null, updated_by = v_uid
   where m.id = v_conn.id
   returning * into v_conn;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_mp.connected', 'acc_mp_connection', v_conn.id,
    jsonb_build_object('mp_user_id', v_user));
  return to_jsonb(v_conn);
end;
$$;

-- El token descifrado, para «Traer ahora» (escritor). Sin token vigente → mp_not_connected.
create function public.acc_mp_get_token(p_tenant_id uuid, p_secret_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.acc_mp_connections;
  v_cipher text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform private.acc_secret_key_check(p_secret_key);
  select * into v_conn from public.acc_mp_connections m where m.tenant_id = p_tenant_id;
  if v_conn.id is not null and v_conn.status = 'connected' then
    select s.ciphertext into v_cipher from public.acc_secrets s
     where s.mp_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'access_token';
  end if;
  if v_cipher is null then
    raise exception 'mp_not_connected' using errcode = 'P0001';
  end if;
  return private.acc_decrypt(v_cipher, p_secret_key);
end;
$$;

-- Borra los tokens y deja `disconnected` (los CSV siguen andando). Sin conexión, o ya desconectada,
-- no hace nada.
create function public.acc_mp_disconnect(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_mp_connections;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_conn from public.acc_mp_connections m where m.tenant_id = p_tenant_id for update;
  if not found or v_conn.status = 'disconnected' then
    return;
  end if;
  delete from public.acc_secrets s where s.mp_connection_id = v_conn.id and s.tenant_id = p_tenant_id;
  update public.acc_mp_connections m
     set status = 'disconnected', token_last4 = null, scopes = null, pending_report = null, last_error_key = null,
         updated_by = v_uid
   where m.id = v_conn.id;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_mp.disconnected', 'acc_mp_connection', v_conn.id,
    jsonb_build_object('previous_status', v_conn.status));
end;
$$;

-- ─── 4. Cron (solo service_role) ─────────────────────────────────────────────
-- Bares con Administración prendida y configurada, y Mercado Pago `connected`. Un token que no se
-- puede descifrar viene con access_token null y error 'secret_unreadable' (el cron lo pasa a
-- `reconnect` con acc_mp_sync_record_service).
create function public.acc_mp_sync_targets_service(p_secret_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_token text;
  v_error text;
  v_out jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.acc_secret_key_check(p_secret_key);
  for r in
    select m.*, s.ciphertext
      from public.acc_mp_connections m
      join public.tenants t on t.id = m.tenant_id and t.feature_flags -> 'accounting' = 'true'::jsonb
      join public.acc_settings st on st.tenant_id = m.tenant_id
      left join public.acc_secrets s on s.mp_connection_id = m.id and s.tenant_id = m.tenant_id and s.name = 'access_token'
     where m.status = 'connected'
     order by m.tenant_id
  loop
    v_token := null;
    v_error := null;
    if r.ciphertext is null then
      v_error := 'mp_not_connected';
    else
      begin
        v_token := private.acc_decrypt(r.ciphertext, p_secret_key);
      exception when others then
        v_error := 'secret_unreadable';
      end;
    end if;
    v_out := v_out || jsonb_build_object(
      'tenant_id', r.tenant_id, 'connection_id', r.id, 'treasury_account_id', r.treasury_account_id,
      'party_id', r.party_id, 'day_cutoff_hour', r.day_cutoff_hour, 'synced_through', r.synced_through,
      'pending_report', r.pending_report, 'last_sync_at', r.last_sync_at, 'access_token', v_token, 'error', v_error);
  end loop;
  return v_out;
end;
$$;

-- p_patch (lista blanca): {status?: 'reconnect', pending_report?: objeto | null, synced_through?: fecha,
-- last_sync_at?: instante ISO, last_sync_status?, last_error_key?: clave | null, report_config_applied_at?}.
-- El cron solo puede bajar a `reconnect` (un 401): volver a `connected` es pegar el token de nuevo.
create function public.acc_mp_sync_record_service(p_tenant_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.acc_mp_connections;
  v_new public.acc_mp_connections;
  v_bad text;
begin
  perform private.acc_service_check(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'patch';
  end if;
  select k into v_bad from jsonb_object_keys(p_patch) k
   where k not in ('status', 'pending_report', 'synced_through', 'last_sync_at', 'last_sync_status', 'last_error_key',
                   'report_config_applied_at')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  select * into v_conn from public.acc_mp_connections m where m.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mp_not_connected' using errcode = 'P0001';
  end if;
  v_new := v_conn;
  if p_patch ? 'status' then
    if p_patch ->> 'status' is distinct from 'reconnect' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'status';
    end if;
    v_new.status := 'reconnect';
  end if;
  if p_patch ? 'pending_report' then
    if coalesce(jsonb_typeof(p_patch -> 'pending_report'), 'null') not in ('object', 'null') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'pending_report';
    end if;
    v_new.pending_report := case when jsonb_typeof(p_patch -> 'pending_report') = 'object'
                                 then p_patch -> 'pending_report' end;
  end if;
  if p_patch ? 'synced_through' then
    v_new.synced_through := private.acc_to_date(p_patch ->> 'synced_through');
    if v_new.synced_through is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'synced_through';
    end if;
  end if;
  if p_patch ? 'last_sync_at' then
    v_new.last_sync_at := private.acc_to_ts(p_patch ->> 'last_sync_at');
    if v_new.last_sync_at is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'last_sync_at';
    end if;
  end if;
  if p_patch ? 'report_config_applied_at' then
    v_new.report_config_applied_at := private.acc_to_ts(p_patch ->> 'report_config_applied_at');
    if v_new.report_config_applied_at is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'report_config_applied_at';
    end if;
  end if;
  if p_patch ? 'last_sync_status' then
    v_new.last_sync_status := p_patch ->> 'last_sync_status';
    if v_new.last_sync_status !~ '^[a-z][a-z0-9_]{1,29}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'last_sync_status';
    end if;
  end if;
  if p_patch ? 'last_error_key' then
    v_new.last_error_key := p_patch ->> 'last_error_key';
    if v_new.last_error_key !~ '^[a-z][a-z0-9_]{1,59}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'last_error_key';
    end if;
  end if;

  update public.acc_mp_connections m
     set status = v_new.status, pending_report = v_new.pending_report, synced_through = v_new.synced_through,
         last_sync_at = v_new.last_sync_at, last_sync_status = v_new.last_sync_status,
         last_error_key = v_new.last_error_key, report_config_applied_at = v_new.report_config_applied_at
   where m.id = v_conn.id;
  if v_new.status is distinct from v_conn.status then
    perform private.acc_audit(p_tenant_id, null, 'acc_mp.status_changed', 'acc_mp_connection', v_conn.id,
      jsonb_build_object('from', v_conn.status, 'to', v_new.status));
  end if;
end;
$$;

comment on function public.acc_mp_save_connection(uuid, jsonb, timestamptz) is
  'Crea o edita la configuración de Mercado Pago (caja, partícipe, medios por canal, corte del día). Audita acc_mp.connection_saved.';
comment on function public.acc_mp_store_token(uuid, text, jsonb, text) is
  'Guarda el Access Token cifrado y deja Mercado Pago connected (solo los últimos 4 caracteres a la vista). Audita acc_mp.connected.';
comment on function public.acc_mp_get_token(uuid, text) is
  'Token de Mercado Pago descifrado para «Traer ahora» (escritores, con la clave del servidor).';
comment on function public.acc_mp_disconnect(uuid) is
  'Borra los tokens de Mercado Pago y deja la conexión disconnected. Audita acc_mp.disconnected.';
comment on function public.acc_mp_sync_targets_service(text) is
  'Solo service_role (cron): bares con Mercado Pago conectado, con el token descifrado.';
comment on function public.acc_mp_sync_record_service(uuid, jsonb) is
  'Solo service_role (cron): registra el resultado de un tick de sincronización (o pasa a reconnect).';

-- ─── 5. Grants ───────────────────────────────────────────────────────────────
revoke all on function private.acc_mp_conn_ensure(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.acc_mp_save_connection(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_mp_save_connection(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_mp_store_token(uuid, text, jsonb, text) from public, anon;
grant execute on function public.acc_mp_store_token(uuid, text, jsonb, text) to authenticated;
revoke all on function public.acc_mp_get_token(uuid, text) from public, anon;
grant execute on function public.acc_mp_get_token(uuid, text) to authenticated;
revoke all on function public.acc_mp_disconnect(uuid) from public, anon;
grant execute on function public.acc_mp_disconnect(uuid) to authenticated;
revoke all on function public.acc_mp_sync_targets_service(text) from public, anon, authenticated;
grant execute on function public.acc_mp_sync_targets_service(text) to service_role;
revoke all on function public.acc_mp_sync_record_service(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acc_mp_sync_record_service(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
