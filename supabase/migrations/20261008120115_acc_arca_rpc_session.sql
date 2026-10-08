-- ============================================================
-- ARCA e importadores · migración 5 de 12 (diseño §2.6, §3.1, §5.1, §6.3)
-- RPC de la sesión con ARCA: prueba de conexión, desconexión, caché del padrón, avance de las
-- guías y el partícipe «Consumidor final»
-- ============================================================
-- Qué crea (todas SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_record_test: guarda el resultado de «Probar conexión» y decide connected | error.
--   · acc_arca_disconnect: borra clave, certificado y tickets; la fila queda como historia.
--   · acc_arca_padron_cache_put: guarda hasta 250 constancias (sin auditar: es una caché y el
--     payload llevaría CUIT).
--   · acc_guide_mark: marca o desmarca un paso manual de una guía.
--   · acc_ensure_final_consumer: crea (una vez) el partícipe de sistema `consumidor_final`.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. «Probar conexión» ────────────────────────────────────────────────────
-- p_result: {checks: [{key, ok, detail?, error?}]} (1 a 12, claves únicas; el resto lo arma la
-- base). Conectada si dieron OK `service`, `wsfe_ticket`, `relations`, `point_of_sale` y `padron`
-- (chequeos 1 a 4 y 6 del diseño); si no, `error` con el `error` del primer chequeo que falló, y
-- la emisión se apaga.
create function public.acc_arca_record_test(p_tenant_id uuid, p_environment text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_arca_connections;
  v_checks jsonb;
  v_c jsonb;
  v_keys text[] := '{}';
  v_failed text[] := '{}';
  v_error text;
  v_status text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  v_checks := case when jsonb_typeof(p_result) = 'object' then p_result -> 'checks' end;
  if jsonb_typeof(v_checks) is distinct from 'array' or jsonb_array_length(v_checks) not between 1 and 12
     or pg_column_size(v_checks) > 12000 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'checks';
  end if;
  for v_c in select e.value from jsonb_array_elements(v_checks) e loop
    if jsonb_typeof(v_c) <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'checks';
    end if;
    if coalesce(v_c ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,39}$' or (v_c ->> 'key') = any (v_keys)
       or jsonb_typeof(v_c -> 'ok') is distinct from 'boolean'
       or coalesce(jsonb_typeof(v_c -> 'detail'), 'null') not in ('object', 'null')
       or coalesce(jsonb_typeof(v_c -> 'error'), 'null') not in ('string', 'null')
       or coalesce(v_c ->> 'error', 'x_ok') !~ '^[a-z][a-z0-9_]{1,59}$'
       or exists (select 1 from jsonb_object_keys(v_c) k where k not in ('key', 'ok', 'detail', 'error')) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'checks';
    end if;
    v_keys := v_keys || (v_c ->> 'key');
    if not (v_c ->> 'ok')::boolean then
      v_failed := v_failed || (v_c ->> 'key');
      v_error := coalesce(v_error, v_c ->> 'error');
    end if;
  end loop;

  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment
   for update;
  if not found or v_conn.status not in ('cert_ready', 'connected', 'error') then
    raise exception 'arca_not_ready' using errcode = 'P0001';
  end if;

  v_status := case when array['service', 'wsfe_ticket', 'relations', 'point_of_sale', 'padron'] <@ (
                          select coalesce(array_agg(e.value ->> 'key'), '{}')
                            from jsonb_array_elements(v_checks) e where (e.value ->> 'ok')::boolean)
                   then 'connected' else 'error' end;
  update public.acc_arca_connections c
     set status = v_status, last_test_at = now(),
         last_test = jsonb_build_object('at', now(), 'environment', p_environment, 'status', v_status, 'checks', v_checks),
         services = jsonb_strip_nulls(jsonb_build_object(
           'wsfe', (select case when (e.value ->> 'ok')::boolean then 'ok' else coalesce(e.value ->> 'error', 'failed') end
                      from jsonb_array_elements(v_checks) e where e.value ->> 'key' = 'wsfe_ticket'),
           'ws_sr_constancia_inscripcion',
                   (select case when (e.value ->> 'ok')::boolean then 'ok' else coalesce(e.value ->> 'error', 'failed') end
                      from jsonb_array_elements(v_checks) e where e.value ->> 'key' = 'padron'))),
         last_error_key = case when v_status = 'connected' then null else v_error end,
         emission_enabled = (v_status = 'connected' and c.emission_enabled),
         updated_by = v_uid
   where c.id = v_conn.id
   returning * into v_conn;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.tested', 'acc_arca_connection', v_conn.id,
    jsonb_build_object('environment', p_environment, 'status', v_status, 'failed', to_jsonb(v_failed)));
  return to_jsonb(v_conn);
end;
$$;

-- ─── 2. Desconectar ──────────────────────────────────────────────────────────
-- Exige escribir DESCONECTAR y que no haya emisiones vivas (sin clave no se pueden verificar con
-- ARCA). Borra la clave, el certificado y los tickets; la fila queda `disconnected` como historia.
-- Desconectar algo ya desconectado no hace nada.
create function public.acc_arca_disconnect(p_tenant_id uuid, p_environment text, p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_arca_connections;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  if p_confirm is distinct from 'DESCONECTAR' then
    raise exception 'confirmation_required' using errcode = 'P0001';
  end if;
  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment
   for update;
  if not found then
    raise exception 'arca_not_ready' using errcode = 'P0001';
  end if;
  if v_conn.status = 'disconnected' then
    return;
  end if;
  if exists (select 1 from public.acc_arca_vouchers v
              where v.connection_id = v_conn.id and v.tenant_id = p_tenant_id
                and v.status in ('reserved', 'requesting', 'needs_reconcile')) then
    raise exception 'arca_voucher_in_flight' using errcode = 'P0001';
  end if;

  delete from public.acc_secrets s where s.arca_connection_id = v_conn.id and s.tenant_id = p_tenant_id;
  delete from public.acc_arca_tickets t where t.connection_id = v_conn.id and t.tenant_id = p_tenant_id;
  update public.acc_arca_connections c
     set status = 'disconnected', csr_pem = null, public_key_sha256 = null, pending_csr_pem = null,
         pending_public_key_sha256 = null, certificate_pem = null, cert_serial = null, cert_issuer = null,
         cert_not_before = null, cert_not_after = null, emission_enabled = false, services = '{}',
         last_error_key = null, updated_by = v_uid
   where c.id = v_conn.id;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.disconnected', 'acc_arca_connection', v_conn.id,
    jsonb_build_object('environment', p_environment, 'serial', v_conn.cert_serial));
end;
$$;

-- ─── 3. Caché del padrón ─────────────────────────────────────────────────────
-- p_rows: [{cuit, found, data}] (hasta 250; data es un objeto de hasta 4 KB). Upsert por
-- (bar, ambiente, CUIT). Devuelve cuántas filas guardó.
create function public.acc_arca_padron_cache_put(p_tenant_id uuid, p_environment text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_n integer;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform private.acc_arca_check_env(p_environment);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 250 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rows';
  end if;
  for v_row in select e.value from jsonb_array_elements(p_rows) e loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rows';
    end if;
    if exists (select 1 from jsonb_object_keys(v_row) k where k not in ('cuit', 'found', 'data'))
       or jsonb_typeof(v_row -> 'cuit') is distinct from 'string'
       or not coalesce(public.acc_cuit_is_valid(v_row ->> 'cuit'), false)
       or jsonb_typeof(v_row -> 'found') is distinct from 'boolean'
       or jsonb_typeof(v_row -> 'data') is distinct from 'object' or pg_column_size(v_row -> 'data') > 4096 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rows';
    end if;
  end loop;
  insert into public.acc_arca_padron_cache (tenant_id, environment, cuit, found, data, fetched_at)
  select distinct on (e.value ->> 'cuit') p_tenant_id, p_environment, e.value ->> 'cuit',
         (e.value ->> 'found')::boolean, e.value -> 'data', now()
    from jsonb_array_elements(p_rows) e
  on conflict (tenant_id, environment, cuit) do update
    set found = excluded.found, data = excluded.data, fetched_at = excluded.fetched_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ─── 4. Guías: pasos manuales ────────────────────────────────────────────────
create function public.acc_guide_mark(p_tenant_id uuid, p_guide text, p_step text, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform public.acc_assert_writer(p_tenant_id);
  if p_guide is null or p_guide not in ('arca', 'arranque') or p_step is null or p_step !~ '^[a-z0-9_]{2,40}$'
     or p_done is null then
    raise exception 'guide_step_invalid' using errcode = 'P0001';
  end if;
  if p_done then
    insert into public.acc_guide_progress (tenant_id, guide, step, done_by, done_by_name)
    values (p_tenant_id, p_guide, p_step, v_uid, private.acc_actor_name(p_tenant_id, v_uid))
    on conflict (tenant_id, guide, step) do nothing;
  else
    delete from public.acc_guide_progress g
     where g.tenant_id = p_tenant_id and g.guide = p_guide and g.step = p_step;
  end if;
end;
$$;

-- ─── 5. «Consumidor final (sin identificar)» ─────────────────────────────────
-- Partícipe de sistema para la Factura B anónima: cliente, sin documento, consumidor final, con las
-- cuentas de control estándar. Idempotente por system_key; audita solo cuando lo crea.
create function public.acc_ensure_final_consumer(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_payable uuid;
  v_receivable uuid;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select p.id into v_id from public.acc_parties p
   where p.tenant_id = p_tenant_id and p.system_key = 'consumidor_final';
  if v_id is not null then
    return v_id;
  end if;
  select a.id into v_payable from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.system_key = 'payable_suppliers';
  select a.id into v_receivable from public.acc_accounts a
   where a.tenant_id = p_tenant_id and a.system_key = 'receivable_customers';
  if v_payable is null or v_receivable is null then
    raise exception 'account_not_found' using errcode = 'P0001',
      detail = case when v_payable is null then 'payable_suppliers' else 'receivable_customers' end;
  end if;
  insert into public.acc_parties (tenant_id, kind, name, tax_id_type, iva_condition, payable_account_id,
                                  receivable_account_id, active, system_key, created_by, updated_by)
  values (p_tenant_id, 'customer', 'Consumidor final', 'none', 'consumidor_final', v_payable, v_receivable, true,
          'consumidor_final', v_uid, v_uid)
  on conflict (tenant_id, system_key) where system_key is not null do nothing
  returning id into v_id;
  if v_id is null then                                     -- lo creó otro camino entre el select y el insert
    select p.id into v_id from public.acc_parties p
     where p.tenant_id = p_tenant_id and p.system_key = 'consumidor_final';
    return v_id;
  end if;
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_party.saved', 'acc_party', v_id,
    jsonb_build_object('created', true, 'system_key', 'consumidor_final'));
  return v_id;
end;
$$;

comment on function public.acc_arca_record_test(uuid, text, jsonb) is
  'Guarda «Probar conexión» y decide connected | error (si no queda conectada, apaga la emisión). Audita acc_arca.tested.';
comment on function public.acc_arca_disconnect(uuid, text, text) is
  'Desconecta ARCA de un ambiente: borra clave, certificado y tickets (exige DESCONECTAR y que no haya emisiones vivas). Audita acc_arca.disconnected.';
comment on function public.acc_arca_padron_cache_put(uuid, text, jsonb) is
  'Guarda hasta 250 constancias del padrón en la caché del bar. Sin auditoría (caché, y el payload llevaría CUIT).';
comment on function public.acc_guide_mark(uuid, text, text, boolean) is
  'Marca o desmarca un paso manual de las guías (arca | arranque).';
comment on function public.acc_ensure_final_consumer(uuid) is
  'Crea una sola vez el partícipe de sistema «Consumidor final» (Factura B anónima) y devuelve su id. Audita acc_party.saved al crearlo.';

-- ─── 6. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_arca_record_test(uuid, text, jsonb) from public, anon;
grant execute on function public.acc_arca_record_test(uuid, text, jsonb) to authenticated;
revoke all on function public.acc_arca_disconnect(uuid, text, text) from public, anon;
grant execute on function public.acc_arca_disconnect(uuid, text, text) to authenticated;
revoke all on function public.acc_arca_padron_cache_put(uuid, text, jsonb) from public, anon;
grant execute on function public.acc_arca_padron_cache_put(uuid, text, jsonb) to authenticated;
revoke all on function public.acc_guide_mark(uuid, text, text, boolean) from public, anon;
grant execute on function public.acc_guide_mark(uuid, text, text, boolean) to authenticated;
revoke all on function public.acc_ensure_final_consumer(uuid) from public, anon;
grant execute on function public.acc_ensure_final_consumer(uuid) to authenticated;

notify pgrst, 'reload schema';
