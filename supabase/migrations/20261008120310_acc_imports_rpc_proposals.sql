-- ============================================================
-- ARCA e importadores · migración 9 de 12 (diseño §4.0, §6.3)
-- RPC de importación: propuestas de comprobantes
-- ============================================================
-- Qué crea (SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_import_put_proposals: upsert de hasta 500 propuestas por (lote, clave). client_ref y
--     attempt solo al insertar (el client_ref es la idempotencia de acc_post_bundle). Las `posted` no
--     se tocan. Las `posting` sí se pueden pisar (a error, stale, ready…): el client_ref no cambia y
--     acc_post_bundle es idempotente, así que un intento cortado nunca queda trabado. Si la clave ya
--     se contabilizó en otro lote, o el mismo client_ref está activo en otro lote, entra `skipped`
--     con error {reason, batch_id}. Actualiza proposal_keys y el estado de las filas que cubre.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Propuestas ───────────────────────────────────────────────────────────
-- Cada propuesta (lista blanca): {key, form, form_values, summary, client_ref, attempt?, status?,
-- preview_hash?, needs?, warnings_ack?, item_ids?, error?}. status ∈ needs_input | ready | posting |
-- stale | error | skipped (ready y posting exigen preview_hash). Devuelve {inserted, updated,
-- kept_posted, skipped, counts}.
create function public.acc_import_put_proposals(p_tenant_id uuid, p_batch_id uuid, p_proposals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.acc_import_batches;
  v_p jsonb;
  v_key text;
  v_form text;
  v_status text;
  v_hash text;
  v_ref uuid;
  v_attempt bigint;
  v_needs jsonb;
  v_acks text[];
  v_items uuid[];
  v_error jsonb;
  v_old public.acc_import_proposals;
  v_other public.acc_import_proposals;
  v_ins integer := 0;
  v_upd integer := 0;
  v_kept integer := 0;
  v_skip integer := 0;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_batch from public.acc_import_batches b
   where b.id = p_batch_id and b.tenant_id = p_tenant_id
   for update;
  if not found or v_batch.status not in ('staging', 'review', 'posting') then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) = 0 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'proposals';
  end if;
  if jsonb_array_length(p_proposals) > 500 then
    raise exception 'import_too_many_items' using errcode = 'P0001';
  end if;

  for v_p in select e.value from jsonb_array_elements(p_proposals) e loop
    if jsonb_typeof(v_p) <> 'object' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'proposals';
    end if;
    if exists (select 1 from jsonb_object_keys(v_p) k
                where k not in ('key', 'form', 'form_values', 'summary', 'client_ref', 'attempt', 'status', 'preview_hash',
                                'needs', 'warnings_ack', 'item_ids', 'error')) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'proposals';
    end if;
    v_key := case when jsonb_typeof(v_p -> 'key') = 'string' then v_p ->> 'key' end;
    v_form := v_p ->> 'form';
    v_status := coalesce(v_p ->> 'status', 'needs_input');
    v_hash := v_p ->> 'preview_hash';
    v_ref := private.acc_to_uuid(v_p ->> 'client_ref');
    v_attempt := case when coalesce(jsonb_typeof(v_p -> 'attempt'), 'null') = 'null' then 1
                      else private.acc_to_bigint(v_p -> 'attempt') end;
    v_needs := coalesce(v_p -> 'needs', '[]'::jsonb);
    v_error := case when jsonb_typeof(v_p -> 'error') = 'object' then v_p -> 'error' end;
    if v_key is null or char_length(v_key) not between 3 and 200 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'key';
    end if;
    if v_form is null or v_form not in ('purchase', 'purchase_credit_note', 'collection', 'bank_expense', 'transfer',
                                        'cash_movement', 'payment') then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'form';
    end if;
    if v_status not in ('needs_input', 'ready', 'posting', 'stale', 'error', 'skipped')
       or (v_status in ('ready', 'posting') and v_hash is null) or v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'status';
    end if;
    if v_ref is null or v_attempt is null or v_attempt not between 1 and 100 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'client_ref';
    end if;
    if jsonb_typeof(v_p -> 'form_values') is distinct from 'object' or pg_column_size(v_p -> 'form_values') > 32768
       or jsonb_typeof(v_p -> 'summary') is distinct from 'object' or pg_column_size(v_p -> 'summary') > 4096 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'form_values';
    end if;
    if jsonb_typeof(v_needs) <> 'array' or pg_column_size(v_needs) > 8192
       or (v_error is null and coalesce(jsonb_typeof(v_p -> 'error'), 'null') <> 'null')
       or pg_column_size(v_error) > 4096 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'needs';
    end if;
    if coalesce(jsonb_typeof(v_p -> 'warnings_ack'), 'array') <> 'array'
       or exists (select 1 from jsonb_array_elements(coalesce(v_p -> 'warnings_ack', '[]'::jsonb)) x
                   where jsonb_typeof(x) <> 'string' or x #>> '{}' !~ '^[a-z][a-z0-9_]{1,40}$')
       or jsonb_array_length(coalesce(v_p -> 'warnings_ack', '[]'::jsonb)) > 30 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'warnings_ack';
    end if;
    v_acks := array(select x from jsonb_array_elements_text(coalesce(v_p -> 'warnings_ack', '[]'::jsonb)) x);
    if coalesce(jsonb_typeof(v_p -> 'item_ids'), 'array') <> 'array'
       or jsonb_array_length(coalesce(v_p -> 'item_ids', '[]'::jsonb)) > 5000 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'item_ids';
    end if;
    v_items := array(select private.acc_to_uuid(x) from jsonb_array_elements_text(coalesce(v_p -> 'item_ids', '[]'::jsonb)) x);
    if exists (select 1 from unnest(v_items) u where u is null) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'item_ids';
    end if;

    select * into v_old from public.acc_import_proposals p
     where p.batch_id = p_batch_id and p.tenant_id = p_tenant_id and p.key = v_key
     for update;
    if v_old.status = 'posted' then
      v_kept := v_kept + 1;
      continue;
    end if;
    -- Ya contabilizada desde otro lote, o la misma clave (o client_ref) activa en otro lote.
    select * into v_other from public.acc_import_proposals p
     where p.tenant_id = p_tenant_id and p.batch_id <> p_batch_id and p.status <> 'skipped'
       and (p.key = v_key or p.client_ref = coalesce(v_old.client_ref, v_ref))
     order by (p.status = 'posted') desc
     limit 1;
    if v_other.id is not null then
      v_status := 'skipped';
      v_error := jsonb_build_object('reason', case when v_other.status = 'posted' then 'posted_in_other_batch'
                                                   else 'active_in_other_batch' end,
                                    'batch_id', v_other.batch_id);
    end if;

    begin
      if v_old.id is null then
        insert into public.acc_import_proposals (tenant_id, batch_id, key, form, form_values, summary, preview_hash,
                                                 client_ref, attempt, status, needs, warnings_ack, error)
        values (p_tenant_id, p_batch_id, v_key, v_form, v_p -> 'form_values', v_p -> 'summary', v_hash, v_ref,
                v_attempt, v_status, v_needs, v_acks, v_error);
        v_ins := v_ins + 1;
      else
        update public.acc_import_proposals p
           set form = v_form, form_values = v_p -> 'form_values', summary = v_p -> 'summary', preview_hash = v_hash,
               status = v_status, needs = v_needs, warnings_ack = v_acks, error = v_error
         where p.id = v_old.id;
        v_upd := v_upd + 1;
      end if;
    exception when unique_violation then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'client_ref';
    end;
    if v_status = 'skipped' then
      v_skip := v_skip + 1;
    end if;

    -- Filas que cubre (las cargadas, ignoradas, repetidas o canceladas no cambian de estado).
    if cardinality(v_items) > 0 then
      update public.acc_import_items i
         set proposal_keys = case when v_key = any (i.proposal_keys) then i.proposal_keys else i.proposal_keys || v_key end,
             status = case when i.status not in ('new', 'review') then i.status
                           when v_status in ('needs_input', 'error', 'stale') then 'review'
                           when v_status in ('ready', 'posting') then 'new'
                           else i.status end
       where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and i.id = any (v_items);
    end if;
  end loop;

  if v_batch.status = 'staging' then
    update public.acc_import_batches b set status = 'review' where b.id = p_batch_id and b.tenant_id = p_tenant_id;
  end if;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'kept_posted', v_kept, 'skipped', v_skip,
                            'counts', private.acc_import_refresh_counts(p_tenant_id, p_batch_id));
end;
$$;

comment on function public.acc_import_put_proposals(uuid, uuid, jsonb) is
  'Upsert de hasta 500 propuestas de un lote (client_ref y attempt solo al insertar; las posted no se tocan; repetidas en otro lote → skipped).';

-- ─── 2. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_import_put_proposals(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_import_put_proposals(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
