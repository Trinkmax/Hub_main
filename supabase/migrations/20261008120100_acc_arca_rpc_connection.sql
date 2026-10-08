-- ============================================================
-- ARCA e importadores · migración 2 de 12 (diseño §2.1, §2.3, §2.5, §6.3)
-- RPC de la conexión con ARCA: datos de la conexión, y clave y pedido del certificado
-- ============================================================
-- Qué crea (todas SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_save_connection: crea la fila si no existe (CUIT de la SAS obligatoria) o edita
--     alias, punto de venta, clases habilitadas, concepto por defecto y el interruptor de emisión.
--   · acc_arca_store_keypair: guarda la clave privada CIFRADA y el pedido (CSR). Modos: new
--     (primera vez), replace (empezar de cero: pisa un certificado subido) y renew (deja la
--     clave nueva pendiente sin tocar la vigente).
-- El certificado y las credenciales para el WSAA están en la migración 3 (20261008120105).
--
-- Apertura estándar: acc_assert_writer → advisory lock del bar → validaciones → escritura →
-- auditoría en la misma transacción (payload sin secretos, sin CUIT y sin textos libres).
-- La clave de cifrado (p_secret_key) la manda el servidor en cada llamada: un dueño que llame
-- desde el navegador no la tiene, así que no puede descifrar nada.
-- Errores: P0001 con la clave en el mensaje (lib/accounting/errors.ts, bloque «ARCA»).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Helper: alta de la conexión ──────────────────────────────────────────
-- Fila nueva en borrador con la CUIT de la SAS (obligatoria) como representada y como CUIT del
-- certificado, y un alias propuesto. El pedido del certificado (acc_arca_store_keypair) fija
-- después el alias y la CUIT del certificado. Quien llama ya tiene el advisory lock del bar.
create function private.acc_arca_conn_new(p_tenant uuid, p_environment text, p_uid uuid)
returns public.acc_arca_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuit text;
  v_row public.acc_arca_connections;
begin
  select s.cuit into v_cuit from public.acc_settings s where s.tenant_id = p_tenant;
  if v_cuit is null then
    raise exception 'sas_cuit_missing' using errcode = 'P0001';
  end if;
  insert into public.acc_arca_connections (tenant_id, environment, represented_cuit, cert_cuit, alias,
                                           created_by, updated_by)
  values (p_tenant, p_environment, v_cuit, v_cuit,
          case when p_environment = 'produccion' then 'hubplataforma' else 'hubpruebas' end, p_uid, p_uid)
  returning * into v_row;
  return v_row;
end;
$$;

-- ─── 2. Datos de la conexión ─────────────────────────────────────────────────
-- p_patch (lista blanca): {alias?, point_of_sale?, allowed_classes?, default_concepto?, emission_enabled?}.
-- Fila nueva: p_expected_updated_at se ignora. Fila existente: concurrencia optimista al milisegundo.
-- Cambiar el punto de venta de una conexión conectada la vuelve a cert_ready (la prueba era de otro
-- punto) y apaga la emisión; con una emisión viva no se puede cambiar.
create function public.acc_arca_save_connection(p_tenant_id uuid, p_environment text, p_patch jsonb,
                                                p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.acc_arca_connections;
  v_new public.acc_arca_connections;
  v_created boolean;
  r record;
  v_int bigint;
  v_txt text;
  v_arr text[];
  v_fields jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'patch';
  end if;

  select * into v_old from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment
   for update;
  v_created := not found;
  if v_created then
    v_old := private.acc_arca_conn_new(p_tenant_id, p_environment, v_uid);
  elsif p_expected_updated_at is null
        or date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  v_new := v_old;

  for r in select e.key, e.value from jsonb_each(p_patch) e loop
    if r.key = 'alias' then
      v_txt := case when jsonb_typeof(r.value) = 'string' then r.value #>> '{}' end;
      if v_txt is null or v_txt !~ '^[a-z0-9]{3,30}$' then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'alias';
      end if;
      -- El alias va adentro del pedido (CN): con pedido o certificado, se cambia generando uno nuevo.
      if v_txt <> v_old.alias and (v_old.csr_pem is not null or v_old.certificate_pem is not null) then
        raise exception 'arca_alias_locked' using errcode = 'P0001';
      end if;
      v_new.alias := v_txt;
    elsif r.key = 'point_of_sale' then
      if jsonb_typeof(r.value) = 'null' then
        v_new.point_of_sale := null;
      else
        v_int := private.acc_to_bigint(r.value);
        if v_int is null or v_int not between 1 and 99998 then
          raise exception 'invalid_payload' using errcode = 'P0001', detail = 'point_of_sale';
        end if;
        v_new.point_of_sale := v_int;
      end if;
    elsif r.key = 'allowed_classes' then
      if jsonb_typeof(r.value) <> 'array'
         or exists (select 1 from jsonb_array_elements(r.value) x where jsonb_typeof(x) <> 'string') then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'allowed_classes';
      end if;
      v_arr := array(select distinct x from jsonb_array_elements_text(r.value) x order by x);
      if not (v_arr <@ array['A', 'B', 'A51', 'ACBU']::text[]) or not ('B' = any (v_arr)) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'allowed_classes';
      end if;
      v_new.allowed_classes := v_arr;
    elsif r.key = 'default_concepto' then
      v_int := private.acc_to_bigint(r.value);
      if v_int is null or v_int not in (1, 2, 3) then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'default_concepto';
      end if;
      v_new.default_concepto := v_int;
    elsif r.key = 'emission_enabled' then
      if jsonb_typeof(r.value) <> 'boolean' then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'emission_enabled';
      end if;
      v_new.emission_enabled := (r.value #>> '{}')::boolean;
    else
      raise exception 'invalid_payload' using errcode = 'P0001', detail = r.key;
    end if;
  end loop;

  if v_new.point_of_sale is distinct from v_old.point_of_sale then
    if exists (select 1 from public.acc_arca_vouchers v
                where v.connection_id = v_old.id and v.tenant_id = p_tenant_id
                  and v.status in ('reserved', 'requesting', 'needs_reconcile')) then
      raise exception 'arca_voucher_in_flight' using errcode = 'P0001';
    end if;
    if v_old.status = 'connected' then
      v_new.status := 'cert_ready';
      if not (p_patch ? 'emission_enabled') then
        v_new.emission_enabled := false;
      end if;
    end if;
  end if;
  if v_new.emission_enabled
     and not (v_new.environment = 'produccion' and v_new.status = 'connected' and v_new.point_of_sale is not null) then
    raise exception 'arca_emission_requires_connection' using errcode = 'P0001';
  end if;

  update public.acc_arca_connections c
     set alias = v_new.alias, point_of_sale = v_new.point_of_sale, allowed_classes = v_new.allowed_classes,
         default_concepto = v_new.default_concepto, emission_enabled = v_new.emission_enabled,
         status = v_new.status, updated_by = v_uid
   where c.id = v_old.id
   returning * into v_new;

  v_fields := (select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
                 from jsonb_each(to_jsonb(v_new)) n join jsonb_each(to_jsonb(v_old)) o on o.key = n.key
                where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by'));
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.connection_saved', 'acc_arca_connection', v_new.id,
    jsonb_build_object('environment', p_environment, 'created', v_created, 'fields', v_fields));
  return to_jsonb(v_new);
end;
$$;

-- ─── 3. Clave y pedido del certificado ───────────────────────────────────────
-- La clave la genera Node (RSA 2048) y llega en PEM PKCS#8; se guarda cifrada y nunca vuelve al
-- navegador. new: primera vez (si ya hay certificado → arca_key_replace_requires_confirm);
-- replace: empezar de cero (borra certificado, tickets y la renovación pendiente); renew: guarda
-- pending_private_key y pending_* sin tocar la clave vigente (exige certificado, mismo alias y
-- misma CUIT del certificado). En producción la CUIT del certificado es la de la SAS.
create function public.acc_arca_store_keypair(p_tenant_id uuid, p_environment text, p_alias text, p_cert_cuit text,
                                              p_private_key_pem text, p_csr_pem text, p_public_key_sha256 text,
                                              p_secret_key text, p_mode text default 'new')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_mode text := coalesce(p_mode, 'new');
  v_conn public.acc_arca_connections;
  v_cuit text;
  v_cipher text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  perform private.acc_secret_key_check(p_secret_key);
  if v_mode not in ('new', 'replace', 'renew') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'mode';
  end if;
  if p_alias is null or p_alias !~ '^[a-z0-9]{3,30}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'alias';
  end if;
  if p_cert_cuit is null or not public.acc_cuit_is_valid(p_cert_cuit) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cert_cuit';
  end if;
  if p_private_key_pem is null or char_length(p_private_key_pem) > 4000
     or p_private_key_pem not like '-----BEGIN PRIVATE KEY-----%'
     or position('-----END PRIVATE KEY-----' in p_private_key_pem) = 0 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'private_key_pem';
  end if;
  if p_csr_pem is null or char_length(p_csr_pem) > 4000 or p_csr_pem not like '-----BEGIN CERTIFICATE REQUEST-----%' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'csr_pem';
  end if;
  if p_public_key_sha256 is null or p_public_key_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'public_key_sha256';
  end if;

  select s.cuit into v_cuit from public.acc_settings s where s.tenant_id = p_tenant_id;
  if v_cuit is null then
    raise exception 'sas_cuit_missing' using errcode = 'P0001';
  end if;
  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment
   for update;
  if not found then
    if v_mode = 'renew' then
      raise exception 'arca_not_ready' using errcode = 'P0001';
    end if;
    v_conn := private.acc_arca_conn_new(p_tenant_id, p_environment, v_uid);
  end if;

  if v_mode = 'renew' then
    if v_conn.certificate_pem is null or v_conn.status not in ('cert_ready', 'connected', 'error') then
      raise exception 'arca_not_ready' using errcode = 'P0001';
    end if;
    if p_alias <> v_conn.alias then
      raise exception 'arca_alias_locked' using errcode = 'P0001';
    end if;
    if p_cert_cuit <> v_conn.cert_cuit then
      raise exception 'arca_cuit_mismatch' using errcode = 'P0001';
    end if;
    v_cipher := private.acc_encrypt(p_private_key_pem, p_secret_key);
    insert into public.acc_secrets (tenant_id, arca_connection_id, name, ciphertext)
    values (p_tenant_id, v_conn.id, 'pending_private_key', v_cipher)
    on conflict (arca_connection_id, tenant_id, name) where arca_connection_id is not null
    do update set ciphertext = excluded.ciphertext, key_version = excluded.key_version, expires_at = null;
    update public.acc_arca_connections c
       set pending_csr_pem = p_csr_pem, pending_public_key_sha256 = p_public_key_sha256, updated_by = v_uid
     where c.id = v_conn.id
     returning * into v_conn;
  else
    if p_environment = 'produccion' and p_cert_cuit <> v_cuit then
      raise exception 'arca_cuit_mismatch' using errcode = 'P0001';
    end if;
    if v_mode = 'new' and v_conn.certificate_pem is not null then
      raise exception 'arca_key_replace_requires_confirm' using errcode = 'P0001';
    end if;
    -- Sin clave vigente no se puede verificar con ARCA lo que quedó en vuelo.
    if exists (select 1 from public.acc_arca_vouchers v
                where v.connection_id = v_conn.id and v.tenant_id = p_tenant_id
                  and v.status in ('reserved', 'requesting', 'needs_reconcile')) then
      raise exception 'arca_voucher_in_flight' using errcode = 'P0001';
    end if;
    v_cipher := private.acc_encrypt(p_private_key_pem, p_secret_key);
    insert into public.acc_secrets (tenant_id, arca_connection_id, name, ciphertext)
    values (p_tenant_id, v_conn.id, 'private_key', v_cipher)
    on conflict (arca_connection_id, tenant_id, name) where arca_connection_id is not null
    do update set ciphertext = excluded.ciphertext, key_version = excluded.key_version, expires_at = null;
    delete from public.acc_secrets s
     where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id and s.name = 'pending_private_key';
    delete from public.acc_arca_tickets t where t.connection_id = v_conn.id and t.tenant_id = p_tenant_id;
    update public.acc_arca_connections c
       set status = 'key_ready', alias = p_alias, cert_cuit = p_cert_cuit, represented_cuit = v_cuit,
           csr_pem = p_csr_pem, public_key_sha256 = p_public_key_sha256,
           pending_csr_pem = null, pending_public_key_sha256 = null,
           certificate_pem = null, cert_serial = null, cert_issuer = null, cert_not_before = null, cert_not_after = null,
           emission_enabled = false, services = '{}', last_error_key = null, updated_by = v_uid
     where c.id = v_conn.id
     returning * into v_conn;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.keypair_generated', 'acc_arca_connection', v_conn.id,
    jsonb_build_object('environment', p_environment, 'alias', p_alias, 'public_key_sha256', p_public_key_sha256,
                       'mode', v_mode));
  return jsonb_build_object('connection_id', v_conn.id, 'environment', v_conn.environment, 'status', v_conn.status,
                            'alias', v_conn.alias, 'mode', v_mode, 'updated_at', v_conn.updated_at);
end;
$$;

comment on function public.acc_arca_save_connection(uuid, text, jsonb, timestamptz) is
  'Crea (con la CUIT de la SAS) o edita la conexión con ARCA de un ambiente: alias, punto de venta, clases, concepto y emisión. Audita acc_arca.connection_saved.';
comment on function public.acc_arca_store_keypair(uuid, text, text, text, text, text, text, text, text) is
  'Guarda la clave privada cifrada y el pedido del certificado (modos new | replace | renew). Audita acc_arca.keypair_generated sin secretos.';

-- ─── 4. Grants ───────────────────────────────────────────────────────────────
revoke all on function private.acc_arca_conn_new(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.acc_arca_save_connection(uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.acc_arca_save_connection(uuid, text, jsonb, timestamptz) to authenticated;
revoke all on function public.acc_arca_store_keypair(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.acc_arca_store_keypair(uuid, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
