-- ============================================================
-- ARCA e importadores · migración 3 de 12 (diseño §2.3, §2.4.2, §2.5, §6.3)
-- RPC de la conexión con ARCA: certificado y credenciales para el login al WSAA
-- ============================================================
-- Qué crea (SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_save_certificate: guarda el certificado (público) después de que Node lo validó;
--     acá se vuelve a exigir que la clave sea la guardada (o la pendiente), la CUIT y la vigencia.
--   · acc_arca_get_credentials: clave privada descifrada + certificado, para el login al WSAA.
-- Misma apertura, auditoría y errores que la migración 2 (20261008120100).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Certificado ──────────────────────────────────────────────────────────
-- p_meta (lo calcula Node con X509Certificate; lista blanca): {serial_hex, subject_cuit, subject_cn,
-- issuer, not_before, not_after, public_key_sha256}. La clave pública tiene que ser la guardada o la
-- pendiente (renovación: la pendiente pasa a vigente y se borra la vieja). Vuelve a cert_ready (hay
-- que probar de nuevo), apaga la emisión y borra los tickets. p_expected_updated_at es opcional:
-- si viene, concurrencia optimista al milisegundo.
create function public.acc_arca_save_certificate(p_tenant_id uuid, p_environment text, p_certificate_pem text,
                                                 p_meta jsonb, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_arca_connections;
  v_key text;
  v_subject text;
  v_serial text;
  v_from timestamptz;
  v_to timestamptz;
  v_renewal boolean;
  v_bad text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  if p_certificate_pem is null or char_length(p_certificate_pem) > 8000
     or p_certificate_pem not like '-----BEGIN CERTIFICATE-----%' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'certificate_pem';
  end if;
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'meta';
  end if;
  select k into v_bad from jsonb_object_keys(p_meta) k
   where k not in ('serial_hex', 'subject_cuit', 'subject_cn', 'issuer', 'not_before', 'not_after', 'public_key_sha256')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_key := p_meta ->> 'public_key_sha256';
  v_subject := p_meta ->> 'subject_cuit';
  v_serial := lower(p_meta ->> 'serial_hex');
  v_from := private.acc_to_ts(p_meta ->> 'not_before');
  v_to := private.acc_to_ts(p_meta ->> 'not_after');
  if v_key is null or v_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'public_key_sha256';
  end if;
  if v_serial is null or v_serial !~ '^[0-9a-f]{1,64}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'serial_hex';
  end if;
  if v_from is null or v_to is null or v_to <= v_from then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'validity';
  end if;
  if char_length(coalesce(p_meta ->> 'issuer', '')) > 300 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'issuer';
  end if;

  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment
   for update;
  if not found or v_conn.status = 'disconnected'
     or (v_conn.public_key_sha256 is null and v_conn.pending_public_key_sha256 is null) then
    raise exception 'arca_key_missing' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is not null
     and date_trunc('milliseconds', v_conn.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  if v_key = v_conn.public_key_sha256 then
    v_renewal := false;
  elsif v_key = v_conn.pending_public_key_sha256 then
    v_renewal := true;
  else
    raise exception 'arca_certificate_key_mismatch' using errcode = 'P0001';
  end if;
  if v_subject is distinct from v_conn.cert_cuit then
    raise exception 'arca_certificate_cuit_mismatch' using errcode = 'P0001';
  end if;
  if v_to <= now() then
    raise exception 'arca_certificate_expired' using errcode = 'P0001',
      detail = jsonb_build_object('reason', 'expired', 'date', (v_to at time zone 'America/Argentina/Cordoba')::date)::text;
  end if;
  if v_from > now() + interval '1 hour' then
    raise exception 'arca_certificate_expired' using errcode = 'P0001',
      detail = jsonb_build_object('reason', 'not_yet_valid',
                                  'date', (v_from at time zone 'America/Argentina/Cordoba')::date)::text;
  end if;

  if v_renewal then
    delete from public.acc_secrets s
     where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'private_key';
    update public.acc_secrets s set name = 'private_key'
     where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'pending_private_key';
  end if;
  if not exists (select 1 from public.acc_secrets s
                  where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'private_key') then
    raise exception 'arca_key_missing' using errcode = 'P0001';
  end if;

  update public.acc_arca_connections c
     set certificate_pem = p_certificate_pem, cert_serial = v_serial,
         cert_issuer = nullif(btrim(coalesce(p_meta ->> 'issuer', '')), ''),
         cert_not_before = v_from, cert_not_after = v_to, public_key_sha256 = v_key,
         csr_pem = case when v_renewal then v_conn.pending_csr_pem else v_conn.csr_pem end,
         pending_csr_pem = case when v_renewal then null else v_conn.pending_csr_pem end,
         pending_public_key_sha256 = case when v_renewal then null else v_conn.pending_public_key_sha256 end,
         status = 'cert_ready', emission_enabled = false, services = '{}', last_error_key = null, updated_by = v_uid
   where c.id = v_conn.id
   returning * into v_conn;
  delete from public.acc_arca_tickets t where t.connection_id = v_conn.id and t.tenant_id = p_tenant_id;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.certificate_saved', 'acc_arca_connection', v_conn.id,
    jsonb_build_object('environment', p_environment, 'serial', v_serial, 'not_after', v_to, 'renewal', v_renewal));
  return to_jsonb(v_conn);
end;
$$;

-- ─── 2. Credenciales para el login al WSAA ───────────────────────────────────
-- {connection (sin secretos), private_key_pem, certificate_pem}. Solo con certificado (cert_ready,
-- connected o error). No audita cada lectura: pasa una vez cada 12 h por servicio.
create function public.acc_arca_get_credentials(p_tenant_id uuid, p_environment text, p_secret_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.acc_arca_connections;
  v_cipher text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform private.acc_arca_check_env(p_environment);
  perform private.acc_secret_key_check(p_secret_key);
  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment;
  if not found or v_conn.status not in ('cert_ready', 'connected', 'error') or v_conn.certificate_pem is null then
    raise exception 'arca_not_ready' using errcode = 'P0001';
  end if;
  select s.ciphertext into v_cipher from public.acc_secrets s
   where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'private_key';
  if v_cipher is null then
    raise exception 'arca_key_missing' using errcode = 'P0001';
  end if;
  return jsonb_build_object('connection', to_jsonb(v_conn),
                            'private_key_pem', private.acc_decrypt(v_cipher, p_secret_key),
                            'certificate_pem', v_conn.certificate_pem);
end;
$$;

comment on function public.acc_arca_save_certificate(uuid, text, text, jsonb, timestamptz) is
  'Guarda el certificado de ARCA si coincide con la clave (vigente o pendiente), la CUIT y la vigencia. Vuelve a cert_ready. Audita acc_arca.certificate_saved.';
comment on function public.acc_arca_get_credentials(uuid, text, text) is
  'Clave privada descifrada y certificado para el login al WSAA (solo escritores y con la clave del servidor).';

-- ─── 3. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_arca_save_certificate(uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_arca_save_certificate(uuid, text, text, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_arca_get_credentials(uuid, text, text) from public, anon;
grant execute on function public.acc_arca_get_credentials(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
