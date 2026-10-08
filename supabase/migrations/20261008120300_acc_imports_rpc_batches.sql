-- ============================================================
-- ARCA e importadores · migración 8 de 12 (diseño §4.0, §6.3)
-- RPC de importación: crear lotes, cargar filas (con sus variantes del cron) y cancelar
-- ============================================================
-- Qué crea:
--   · acc_import_create_batch / acc_import_create_batch_service: el lote, con la idempotencia del
--     ARCHIVO (mismo origen y SHA-256 en un lote no cancelado → import_file_already con
--     {batch_id, date, name} para «Ya importaste este archivo el 03/10 (Nacho)»).
--   · acc_import_add_items / acc_import_add_items_service: hasta 1000 filas por llamada, solo en
--     `staging`. Idempotencia de la FILA: si ya hay una viva con la misma clave natural (en este u
--     otro lote), entra `duplicate` con `duplicate_of`. Reenviar la misma tanda no duplica nada
--     (la fila (lote, número) se saltea).
--   · acc_import_cancel_batch: lote `cancelled`; filas sin cargar → cancelled (libera la clave para
--     reimportar); propuestas sin cargar → skipped. Lo ya cargado y las «no es nuestro» quedan.
-- Las de usuario: SECURITY DEFINER + acc_assert_writer + advisory lock + auditoría. Las *_service
-- (el cron de Mercado Pago, D7: el cron prepara y nunca contabiliza): EXECUTE solo service_role,
-- rol del JWT service_role, created_by null y created_by_name «Sincronización automática».
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Helpers ──────────────────────────────────────────────────────────────
-- p_batch (lista blanca): {source, file_name?, file_sha256, file_size, detected_format?, period_from?,
-- period_to?, treasury_account_id?, meta?}. En origin = upload el hash y el tamaño son obligatorios;
-- el extracto bancario exige su caja.
create function private.acc_import_batch_new(p_tenant uuid, p_uid uuid, p_name text, p_origin text, p_batch jsonb)
returns public.acc_import_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad text;
  v_source text;
  v_sha text;
  v_size bigint;
  v_name text;
  v_format text;
  v_from date;
  v_to date;
  v_treasury uuid;
  v_meta jsonb;
  v_dup public.acc_import_batches;
  v_row public.acc_import_batches;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'batch';
  end if;
  select k into v_bad from jsonb_object_keys(p_batch) k
   where k not in ('source', 'file_name', 'file_sha256', 'file_size', 'detected_format', 'period_from', 'period_to',
                   'treasury_account_id', 'meta')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  v_source := p_batch ->> 'source';
  if v_source is null or v_source not in ('arca_recibidos', 'arca_emitidos', 'mp_release', 'bank_statement') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'source';
  end if;
  v_sha := p_batch ->> 'file_sha256';
  if (v_sha is null and p_origin = 'upload') or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'file_sha256';
  end if;
  v_size := private.acc_to_bigint(p_batch -> 'file_size');
  if (v_size is null and (p_origin = 'upload' or coalesce(jsonb_typeof(p_batch -> 'file_size'), 'null') <> 'null'))
     or v_size not between 1 and 20971520 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'file_size';
  end if;
  v_name := nullif(btrim(coalesce(p_batch ->> 'file_name', '')), '');
  if char_length(v_name) > 200 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'file_name';
  end if;
  v_format := p_batch ->> 'detected_format';
  if v_format !~ '^[a-z0-9_:-]{2,80}$' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'detected_format';
  end if;
  v_from := private.acc_to_date(p_batch ->> 'period_from');
  v_to := private.acc_to_date(p_batch ->> 'period_to');
  if (v_from is null and p_batch ->> 'period_from' is not null) or (v_to is null and p_batch ->> 'period_to' is not null)
     or v_to < v_from then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'period';
  end if;
  v_treasury := private.acc_to_uuid(p_batch ->> 'treasury_account_id');
  if (v_treasury is null and (p_batch ->> 'treasury_account_id' is not null or v_source = 'bank_statement'))
     or (v_treasury is not null and not exists (select 1 from public.acc_treasury_accounts t
                                                 where t.id = v_treasury and t.tenant_id = p_tenant and t.active)) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'treasury_account_id';
  end if;
  v_meta := coalesce(p_batch -> 'meta', '{}'::jsonb);
  if jsonb_typeof(v_meta) <> 'object' or pg_column_size(v_meta) > 8192 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'meta';
  end if;

  if v_sha is not null then
    select * into v_dup from public.acc_import_batches b
     where b.tenant_id = p_tenant and b.source = v_source and b.file_sha256 = v_sha and b.status <> 'cancelled'
     limit 1;
    if found then
      raise exception 'import_file_already' using errcode = 'P0001',
        detail = jsonb_build_object('batch_id', v_dup.id, 'name', v_dup.created_by_name,
                                    'date', (v_dup.created_at at time zone 'America/Argentina/Cordoba')::date)::text;
    end if;
  end if;
  begin
    insert into public.acc_import_batches (tenant_id, source, origin, file_name, file_sha256, file_size, detected_format,
                                           period_from, period_to, treasury_account_id, meta, created_by, created_by_name)
    values (p_tenant, v_source, p_origin, v_name, v_sha, v_size, v_format, v_from, v_to, v_treasury, v_meta, p_uid, p_name)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'import_file_already' using errcode = 'P0001';
  end;
  return v_row;
end;
$$;

-- p_items: [{row_no, source_family?, natural_key, data, issues?}] (1 a 1000). La familia sale del
-- lote (arca_recibidos | arca_emitidos | mp | bank:<caja>); si viene, tiene que coincidir.
create function private.acc_import_items_add(p_tenant uuid, p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.acc_import_batches;
  v_family text;
  v_it jsonb;
  v_row_no bigint;
  v_key text;
  v_live uuid;
  v_new integer := 0;
  v_dup integer := 0;
  v_skip integer := 0;
begin
  select * into v_batch from public.acc_import_batches b
   where b.id = p_batch_id and b.tenant_id = p_tenant
   for update;
  if not found or v_batch.status <> 'staging' then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'import_too_many_items' using errcode = 'P0001';
  end if;
  v_family := case v_batch.source when 'mp_release' then 'mp'
                                  when 'bank_statement' then 'bank:' || v_batch.treasury_account_id::text
                                  else v_batch.source end;

  for v_it in select e.value from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_it) <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
    end if;
    if exists (select 1 from jsonb_object_keys(v_it) k
                where k not in ('row_no', 'source_family', 'natural_key', 'data', 'issues')) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'items';
    end if;
    v_row_no := private.acc_to_bigint(v_it -> 'row_no');
    v_key := case when jsonb_typeof(v_it -> 'natural_key') = 'string' then v_it ->> 'natural_key' end;
    if v_row_no is null or v_row_no not between 0 and 9999999 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'row_no';
    end if;
    if coalesce(v_it ->> 'source_family', v_family) <> v_family then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'source_family';
    end if;
    if v_key is null or char_length(v_key) not between 3 and 200 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'natural_key';
    end if;
    if jsonb_typeof(v_it -> 'data') is distinct from 'object' or pg_column_size(v_it -> 'data') > 8192 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'data';
    end if;
    if coalesce(jsonb_typeof(v_it -> 'issues'), 'array') <> 'array' or pg_column_size(v_it -> 'issues') > 4096 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'issues';
    end if;

    if exists (select 1 from public.acc_import_items i where i.batch_id = p_batch_id and i.row_no = v_row_no) then
      v_skip := v_skip + 1;                                       -- reintento de la misma tanda
      continue;
    end if;
    select i.id into v_live from public.acc_import_items i
     where i.tenant_id = p_tenant and i.source_family = v_family and i.natural_key = v_key
       and i.status not in ('duplicate', 'cancelled');
    insert into public.acc_import_items (tenant_id, batch_id, row_no, source_family, natural_key, data, status,
                                         duplicate_of, issues)
    values (p_tenant, p_batch_id, v_row_no, v_family, v_key, v_it -> 'data',
            case when v_live is null then 'new' else 'duplicate' end, v_live,
            coalesce(v_it -> 'issues', '[]'::jsonb));
    if v_live is null then
      v_new := v_new + 1;
    else
      v_dup := v_dup + 1;
    end if;
  end loop;

  return jsonb_build_object('new', v_new, 'duplicate', v_dup, 'skipped', v_skip,
                            'counts', private.acc_import_refresh_counts(p_tenant, p_batch_id));
end;
$$;

-- ─── 2. Crear el lote ────────────────────────────────────────────────────────
create function public.acc_import_create_batch(p_tenant_id uuid, p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_import_batches;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  v_row := private.acc_import_batch_new(p_tenant_id, v_uid, private.acc_actor_name(p_tenant_id, v_uid), 'upload', p_batch);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.batch_created', 'acc_import_batch', v_row.id,
    jsonb_build_object('source', v_row.source, 'origin', v_row.origin, 'period_from', v_row.period_from,
                       'period_to', v_row.period_to, 'file_sha256', v_row.file_sha256));
  return to_jsonb(v_row);
end;
$$;

create function public.acc_import_create_batch_service(p_tenant_id uuid, p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.acc_import_batches;
begin
  perform private.acc_service_check(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  v_row := private.acc_import_batch_new(p_tenant_id, null, 'Sincronización automática', 'api', p_batch);
  perform private.acc_audit(p_tenant_id, null, 'acc_import.batch_created', 'acc_import_batch', v_row.id,
    jsonb_build_object('source', v_row.source, 'origin', v_row.origin, 'period_from', v_row.period_from,
                       'period_to', v_row.period_to, 'file_sha256', v_row.file_sha256));
  return to_jsonb(v_row);
end;
$$;

-- ─── 3. Cargar filas ─────────────────────────────────────────────────────────
-- Devuelve {new, duplicate, skipped, counts}. Sin auditoría por fila (volumen): se audita el lote.
create function public.acc_import_add_items(p_tenant_id uuid, p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  return private.acc_import_items_add(p_tenant_id, p_batch_id, p_items);
end;
$$;

-- Solo en lotes de la sincronización (origin = api).
create function public.acc_import_add_items_service(p_tenant_id uuid, p_batch_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.acc_service_check(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if not exists (select 1 from public.acc_import_batches b
                  where b.id = p_batch_id and b.tenant_id = p_tenant_id and b.origin = 'api') then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  return private.acc_import_items_add(p_tenant_id, p_batch_id, p_items);
end;
$$;

-- ─── 4. Cancelar el lote ─────────────────────────────────────────────────────
-- Un lote terminado (todo cargado) no se cancela: cada comprobante se anula como hoy. Cancelar dos
-- veces no hace nada. El motivo no va a la auditoría (texto libre).
create function public.acc_import_cancel_batch(p_tenant_id uuid, p_batch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_batch public.acc_import_batches;
  v_counts jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_batch from public.acc_import_batches b
   where b.id = p_batch_id and b.tenant_id = p_tenant_id
   for update;
  if not found or v_batch.status = 'done' then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  if v_batch.status = 'cancelled' then
    return;
  end if;
  update public.acc_import_batches b
     set status = 'cancelled', cancelled_at = now(),
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where b.id = p_batch_id and b.tenant_id = p_tenant_id;
  update public.acc_import_items i set status = 'cancelled'
   where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and i.status in ('new', 'review');
  update public.acc_import_proposals p set status = 'skipped'
   where p.batch_id = p_batch_id and p.tenant_id = p_tenant_id and p.status <> 'posted';
  v_counts := private.acc_import_refresh_counts(p_tenant_id, p_batch_id);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.batch_cancelled', 'acc_import_batch', p_batch_id,
    jsonb_build_object('source', v_batch.source, 'counts', v_counts));
end;
$$;

comment on function public.acc_import_create_batch(uuid, jsonb) is
  'Crea un lote de importación (idempotente por archivo: import_file_already). Audita acc_import.batch_created.';
comment on function public.acc_import_create_batch_service(uuid, jsonb) is
  'Solo service_role (cron): crea un lote de la sincronización automática (origin api).';
comment on function public.acc_import_add_items(uuid, uuid, jsonb) is
  'Carga hasta 1000 filas normalizadas en un lote en staging; las claves naturales ya vivas entran como duplicate.';
comment on function public.acc_import_add_items_service(uuid, uuid, jsonb) is
  'Solo service_role (cron): carga filas en un lote de la sincronización automática.';
comment on function public.acc_import_cancel_batch(uuid, uuid, text) is
  'Cancela un lote: filas sin cargar → cancelled, propuestas sin cargar → skipped; lo cargado queda. Audita acc_import.batch_cancelled.';

-- ─── 5. Grants ───────────────────────────────────────────────────────────────
revoke all on function private.acc_import_batch_new(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.acc_import_items_add(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.acc_import_create_batch(uuid, jsonb) from public, anon;
grant execute on function public.acc_import_create_batch(uuid, jsonb) to authenticated;
revoke all on function public.acc_import_add_items(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_import_add_items(uuid, uuid, jsonb) to authenticated;
revoke all on function public.acc_import_cancel_batch(uuid, uuid, text) from public, anon;
grant execute on function public.acc_import_cancel_batch(uuid, uuid, text) to authenticated;
revoke all on function public.acc_import_create_batch_service(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acc_import_create_batch_service(uuid, jsonb) to service_role;
revoke all on function public.acc_import_add_items_service(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acc_import_add_items_service(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
