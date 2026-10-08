-- ============================================================
-- ARCA e importadores · migración 13 (addendum del cierre de la fase 1; diseño §4.0, §6.2–§6.3)
-- Reinicio con las tablas nuevas, propuestas `posting` protegidas y reimportar lo anulado
-- ============================================================
-- No toca las 12 anteriores: reemplaza funciones con la MISMA firma (create or replace conserva dueño y
-- privilegios; igual se repiten al final).
--   1. private.acc_reset_tenant (runbook I.6) borra primero lo del bar en las tablas nuevas: importación,
--      Mercado Pago, secretos, tickets, comprobantes y conexiones de ARCA (homologación incluida) y caché del
--      padrón. Quedan los pasos marcados en las guías (se hicieron en ARCA o afuera). Guarda nueva:
--      reset_arca_vouchers si hay facturas de producción que llegaron a ARCA (registros fiscales: se
--      corrigen con notas de crédito). acc_tg_arca_vouchers_bu suma el escape acc.reset salvo para esas.
--   2. acc_import_put_proposals no pisa el contenido (form, form_values, summary, preview_hash) de una
--      `posting` mientras el reclamo tiene menos de 3 minutos ni si su client_ref ya generó un bundle (se
--      cierra con acc_import_mark_posted). Con el mismo contenido sí: quien la reclamó la libera (error,
--      ready…) o la reintenta. Lo que no toca suma kept_posting.
--   3. Estado `voided`: el comprobante se anuló o se revirtió. Libera la clave (aipr_posted_key_uq es de
--      `posted`) y conserva client_ref y comprobante. Se rearma en el mismo lote con attempt mayor y su
--      client_ref nuevo (con el mismo attempt queda: kept_voided); un client_ref que generó un comprobante
--      anulado o revertido no vuelve a entrar (invalid_payload · attempt). Lo concilia un trigger diferido
--      sobre acc_documents: anular o revertir → voided; «Corregir» → sigue al nuevo; deshacer la anulación
--      con fecha de hoy → posted (import_reposted si ya se cargó de nuevo). mark_posted rechaza un
--      comprobante revertido y cancelar el lote deja las `voided`.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Propuestas: `voided` y el comprobante anterior ───
alter table public.acc_import_proposals
  add column previous_document_id uuid,
  drop constraint aipr_status,
  drop constraint aipr_posted,
  add constraint aipr_status check (status in ('needs_input', 'ready', 'posting', 'posted', 'stale', 'error', 'skipped',
                                               'voided')),
  add constraint aipr_posted check ((status in ('posted', 'voided')) = (document_id is not null)
                                    and (status in ('posted', 'voided')) = (posted_at is not null)),
  add constraint aipr_prev_doc_fk foreign key (previous_document_id, tenant_id)
    references public.acc_documents (id, tenant_id);
create index aipr_prev_doc_idx on public.acc_import_proposals (previous_document_id, tenant_id)
  where previous_document_id is not null;
comment on column public.acc_import_proposals.previous_document_id is
  'Comprobante (anulado o revertido) del intento anterior al rearmar con attempt mayor: si se deshace esa anulación, la propuesta vuelve a él.';

-- ─── 2. Conteos del lote (suma `voided`) ───
create or replace function private.acc_import_refresh_counts(p_tenant uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  select jsonb_build_object(
           'items', count(*), 'new', count(*) filter (where i.status = 'new'),
           'duplicate', count(*) filter (where i.status = 'duplicate'),
           'ignored', count(*) filter (where i.status = 'ignored'),
           'review', count(*) filter (where i.status = 'review'),
           'posted_items', count(*) filter (where i.status = 'posted'),
           'cancelled', count(*) filter (where i.status = 'cancelled'))
    into v_counts
    from public.acc_import_items i where i.batch_id = p_batch and i.tenant_id = p_tenant;
  select v_counts || jsonb_build_object(
           'proposals', count(*), 'needs_input', count(*) filter (where p.status = 'needs_input'),
           'ready', count(*) filter (where p.status = 'ready'),
           'posting', count(*) filter (where p.status = 'posting'),
           'posted', count(*) filter (where p.status = 'posted'),
           'stale', count(*) filter (where p.status = 'stale'),
           'error', count(*) filter (where p.status = 'error'),
           'skipped', count(*) filter (where p.status = 'skipped'),
           'voided', count(*) filter (where p.status = 'voided'))
    into v_counts
    from public.acc_import_proposals p where p.batch_id = p_batch and p.tenant_id = p_tenant;
  update public.acc_import_batches b set counts = v_counts where b.id = p_batch and b.tenant_id = p_tenant;
  return v_counts;
end;
$$;

-- ─── 3. Propuestas ───
-- Misma lista blanca que antes. Devuelve {inserted, updated, rearmed, kept_posted, kept_posting, kept_voided,
-- skipped, counts}.
create or replace function public.acc_import_put_proposals(p_tenant_id uuid, p_batch_id uuid, p_proposals jsonb)
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
  v_row_ref uuid;
  v_attempt bigint;
  v_needs jsonb;
  v_acks text[];
  v_items uuid[];
  v_error jsonb;
  v_rearm boolean;
  v_old public.acc_import_proposals;
  v_other public.acc_import_proposals;
  v_ins integer := 0;
  v_upd integer := 0;
  v_rearmed integer := 0;
  v_kept integer := 0;
  v_kept_posting integer := 0;
  v_kept_voided integer := 0;
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
    -- Anulada: se rearma solo con un intento nuevo (attempt mayor y su client_ref).
    v_rearm := coalesce(v_old.status = 'voided', false);
    if v_rearm and v_attempt <= v_old.attempt then
      v_kept_voided := v_kept_voided + 1;
      continue;
    end if;
    -- En curso: otro contenido no la pisa mientras el reclamo tiene menos de 3 minutos ni si su client_ref ya
    -- generó un bundle (se cierra con acc_import_mark_posted). El mismo contenido sí (liberarla o reintentar).
    if v_old.status = 'posting'
       and (v_old.form, v_old.form_values, v_old.summary, v_old.preview_hash)
           is distinct from (v_form, v_p -> 'form_values', v_p -> 'summary', v_hash)
       and (v_old.updated_at > now() - interval '3 minutes'
            or exists (select 1 from public.acc_bundles b
                        where b.tenant_id = p_tenant_id and b.client_ref = v_old.client_ref)) then
      v_kept_posting := v_kept_posting + 1;
      continue;
    end if;
    -- Un client_ref nuevo que ya generó un comprobante anulado o revertido: acc_post_bundle devolvería ese.
    v_row_ref := case when v_old.id is null or v_rearm then v_ref else v_old.client_ref end;
    if (v_old.id is null or v_rearm)
       and exists (select 1 from public.acc_bundles b
                     join public.acc_documents d on d.bundle_id = b.id and d.tenant_id = b.tenant_id
                    where b.tenant_id = p_tenant_id and b.client_ref = v_ref
                      and (d.status <> 'posted'
                           or exists (select 1 from public.acc_documents r
                                       where r.tenant_id = d.tenant_id and r.reverses_document_id = d.id
                                         and r.status = 'posted'))) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'attempt';
    end if;
    -- Ya contabilizada desde otro lote, o la misma clave (o client_ref) activa en otro (las anuladas no cuentan).
    select * into v_other from public.acc_import_proposals p
     where p.tenant_id = p_tenant_id and p.batch_id <> p_batch_id and p.status not in ('skipped', 'voided')
       and (p.key = v_key or p.client_ref = v_row_ref)
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
               status = v_status, needs = v_needs, warnings_ack = v_acks, error = v_error, client_ref = v_row_ref,
               attempt = case when v_rearm then v_attempt else p.attempt end,
               previous_document_id = case when v_rearm then p.document_id else p.previous_document_id end,
               document_id = case when v_rearm then null else p.document_id end,
               posted_at = case when v_rearm then null else p.posted_at end
         where p.id = v_old.id;
        if v_rearm then
          v_rearmed := v_rearmed + 1;
        else
          v_upd := v_upd + 1;
        end if;
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
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'rearmed', v_rearmed, 'kept_posted', v_kept,
                            'kept_posting', v_kept_posting, 'kept_voided', v_kept_voided, 'skipped', v_skip,
                            'counts', private.acc_import_refresh_counts(p_tenant_id, p_batch_id));
end;
$$;

-- ─── 4. Marcar lo contabilizado (también rechaza un comprobante revertido) ───
create or replace function public.acc_import_mark_posted(p_tenant_id uuid, p_batch_id uuid, p_key text, p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_batch public.acc_import_batches;
  v_p public.acc_import_proposals;
  v_doc public.acc_documents;
  v_ref uuid;
  v_counts jsonb;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_batch from public.acc_import_batches b
   where b.id = p_batch_id and b.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  select * into v_p from public.acc_import_proposals p
   where p.batch_id = p_batch_id and p.tenant_id = p_tenant_id and p.key = p_key
   for update;
  if not found then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'key';
  end if;
  if v_p.status = 'posted' then
    if v_p.document_id = p_document_id then
      return jsonb_build_object('status', v_batch.status, 'counts', v_batch.counts, 'replayed', true);
    end if;
    raise exception 'import_proposal_posted' using errcode = 'P0001';
  end if;

  select d.* into v_doc from public.acc_documents d where d.id = p_document_id and d.tenant_id = p_tenant_id;
  select b.client_ref into v_ref from public.acc_bundles b where b.id = v_doc.bundle_id and b.tenant_id = p_tenant_id;
  if v_doc.id is null or v_doc.status <> 'posted' or v_ref is distinct from v_p.client_ref
     or exists (select 1 from public.acc_documents r
                 where r.tenant_id = p_tenant_id and r.reverses_document_id = p_document_id and r.status = 'posted') then
    raise exception 'import_document_mismatch' using errcode = 'P0001';
  end if;
  begin
    update public.acc_import_proposals p
       set status = 'posted', document_id = p_document_id, posted_at = now(), error = null
     where p.id = v_p.id;
  exception when unique_violation then
    raise exception 'import_proposal_posted' using errcode = 'P0001';   -- la clave ya se cargó en otro lote
  end;
  update public.acc_import_items i set status = 'posted'
   where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and p_key = any (i.proposal_keys)
     and i.status in ('new', 'review');
  v_counts := private.acc_import_refresh_counts(p_tenant_id, p_batch_id);

  if v_batch.status in ('staging', 'review', 'posting') then
    if not exists (select 1 from public.acc_import_proposals p
                    where p.batch_id = p_batch_id and p.tenant_id = p_tenant_id and p.status not in ('posted', 'skipped')) then
      update public.acc_import_batches b set status = 'done', completed_at = now()
       where b.id = p_batch_id and b.tenant_id = p_tenant_id;
      v_batch.status := 'done';
      perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.batch_done', 'acc_import_batch', p_batch_id,
        jsonb_build_object('source', v_batch.source, 'counts', v_counts));
    elsif v_batch.status <> 'posting' then
      update public.acc_import_batches b set status = 'posting' where b.id = p_batch_id and b.tenant_id = p_tenant_id;
      v_batch.status := 'posting';
    end if;
  end if;
  return jsonb_build_object('status', v_batch.status, 'counts', v_counts, 'replayed', false);
end;
$$;

-- ─── 5. Cancelar el lote (las `voided` quedan) ───
create or replace function public.acc_import_cancel_batch(p_tenant_id uuid, p_batch_id uuid, p_reason text)
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
   where p.batch_id = p_batch_id and p.tenant_id = p_tenant_id and p.status not in ('posted', 'voided');
  v_counts := private.acc_import_refresh_counts(p_tenant_id, p_batch_id);
  perform private.acc_audit(p_tenant_id, v_uid, 'acc_import.batch_cancelled', 'acc_import_batch', p_batch_id,
    jsonb_build_object('source', v_batch.source, 'counts', v_counts));
end;
$$;

-- ─── 6. Conciliar propuestas con el estado final de su comprobante ───
-- Vigente (posted, sin anulación con fecha de hoy vigente): vuelven a `posted` las `voided` que lo tienen y las
-- rearmadas desde él sin cargar; si ya se cargó de nuevo (posted, posting u otra propuesta viva con la clave),
-- import_reposted. Reemplazado («Corregir»): sigue al nuevo. Anulado o revertido: `voided`, también el intento
-- cortado (sin document_id) de su client_ref. Filas: `review` (`cancelled` si el lote está cancelado).
create function private.acc_import_sync_document(p_tenant uuid, p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.acc_documents;
  p public.acc_import_proposals;
  b public.acc_import_batches;
  v_ref uuid;
  v_repl uuid;
  v_live boolean;
  v_to text;
  v_doc uuid;
  v_counts jsonb;
begin
  select * into d from public.acc_documents x where x.id = p_document_id and x.tenant_id = p_tenant;
  if not found then
    return;                                                     -- borrado del bar o reinicio en la misma transacción
  end if;
  select x.client_ref into v_ref from public.acc_bundles x where x.id = d.bundle_id and x.tenant_id = p_tenant;
  v_live := d.status = 'posted'
            and not exists (select 1 from public.acc_documents r
                             where r.tenant_id = p_tenant and r.reverses_document_id = d.id and r.status = 'posted');
  if not v_live then
    select x.id into v_repl from public.acc_documents x
     where x.tenant_id = p_tenant and x.replaces_document_id = d.id and x.status = 'posted';
  end if;

  for p in
    select * from public.acc_import_proposals q
     where q.tenant_id = p_tenant
       and case when v_live
                then (q.document_id = d.id and q.status = 'voided')
                     or (q.previous_document_id = d.id and q.document_id is distinct from d.id)
                else q.document_id = d.id
                     or (q.document_id is null and q.client_ref = v_ref and q.status not in ('skipped', 'posted', 'voided'))
           end
     order by q.created_at, q.id
     for update
  loop
    if v_live then
      if p.status in ('posted', 'posting') then
        raise exception 'import_reposted' using errcode = 'P0001';
      end if;
      v_to := 'posted';
      v_doc := d.id;
    elsif v_repl is not null then
      v_to := 'posted';
      v_doc := v_repl;
    else
      v_to := 'voided';
      v_doc := d.id;
    end if;
    if v_to = 'posted' and exists (select 1 from public.acc_import_proposals q
                                    where q.tenant_id = p_tenant and q.key = p.key and q.id <> p.id
                                      and q.status not in ('skipped', 'voided')) then
      if v_live then
        raise exception 'import_reposted' using errcode = 'P0001';
      end if;
      v_to := 'voided';                                         -- corrección de una clave viva en otra propuesta
      v_doc := d.id;
    end if;
    if p.status = v_to and p.document_id = v_doc then
      continue;                                                 -- ya estaba
    end if;

    update public.acc_import_proposals q
       set status = v_to, document_id = v_doc, error = null,
           posted_at = case when q.document_id = v_doc then q.posted_at
                            when v_doc = d.id then d.created_at
                            else coalesce(q.posted_at, now()) end,
           previous_document_id = case when v_live and q.document_id is distinct from d.id then q.document_id
                                       else q.previous_document_id end
     where q.id = p.id;

    select * into b from public.acc_import_batches x where x.id = p.batch_id and x.tenant_id = p_tenant for update;
    if v_to = 'voided' then
      update public.acc_import_items i
         set status = case when b.status = 'cancelled' then 'cancelled' else 'review' end
       where i.batch_id = p.batch_id and i.tenant_id = p_tenant and p.key = any (i.proposal_keys) and i.status = 'posted'
         and not exists (select 1 from public.acc_import_proposals q
                          where q.batch_id = i.batch_id and q.tenant_id = i.tenant_id and q.status = 'posted'
                            and q.key = any (i.proposal_keys));
      if b.status = 'done' then
        update public.acc_import_batches x set status = 'review', completed_at = null
         where x.id = p.batch_id and x.tenant_id = p_tenant;
      end if;
    else
      update public.acc_import_items i set status = 'posted'
       where i.batch_id = p.batch_id and i.tenant_id = p_tenant and p.key = any (i.proposal_keys)
         and (i.status in ('new', 'review')
              or (i.status = 'cancelled'
                  and not exists (select 1 from public.acc_import_items j
                                   where j.tenant_id = i.tenant_id and j.source_family = i.source_family
                                     and j.natural_key = i.natural_key and j.status not in ('duplicate', 'cancelled'))));
    end if;
    v_counts := private.acc_import_refresh_counts(p_tenant, p.batch_id);
    perform private.acc_audit(p_tenant, v_uid,
      'acc_import.proposal_' || case when v_to = 'voided' then 'voided' when v_live then 'restored' else 'replaced' end,
      'acc_import_proposal', p.id,
      jsonb_strip_nulls(jsonb_build_object('batch_id', p.batch_id, 'form', p.form, 'attempt', p.attempt,
        'document_id', v_doc, 'from_document_id', case when p.document_id is distinct from v_doc then p.document_id end)));
    if v_to = 'posted' and b.status in ('staging', 'review', 'posting')
       and not exists (select 1 from public.acc_import_proposals q
                        where q.batch_id = p.batch_id and q.tenant_id = p_tenant and q.status not in ('posted', 'skipped')) then
      update public.acc_import_batches x set status = 'done', completed_at = now()
       where x.id = p.batch_id and x.tenant_id = p_tenant;
      perform private.acc_audit(p_tenant, v_uid, 'acc_import.batch_done', 'acc_import_batch', p.batch_id,
        jsonb_build_object('source', b.source, 'counts', v_counts));
    end if;
  end loop;
end;
$$;

-- Diferido como acc_document_has_entry: «Corregir» anula el viejo antes de insertar el nuevo en la misma
-- transacción. UPDATE posted → voided: anular (también una anulación con fecha de hoy, que devuelve el
-- original a vigente). INSERT con reverses/replaces: revertir y «Corregir».
create function private.acc_ctg_import_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    perform private.acc_import_sync_document(new.tenant_id, new.id);
  end if;
  if new.reverses_document_id is not null then
    perform private.acc_import_sync_document(new.tenant_id, new.reverses_document_id);
  end if;
  if new.replaces_document_id is not null then
    perform private.acc_import_sync_document(new.tenant_id, new.replaces_document_id);
  end if;
  return null;
end;
$$;
create constraint trigger acc_documents_import_sync_ins
  after insert on public.acc_documents
  deferrable initially deferred
  for each row when (new.reverses_document_id is not null or new.replaces_document_id is not null)
  execute function private.acc_ctg_import_documents();
create constraint trigger acc_documents_import_sync_upd
  after update of status on public.acc_documents
  deferrable initially deferred
  for each row when (old.status = 'posted' and new.status = 'voided')
  execute function private.acc_ctg_import_documents();

-- ─── 7. Reinicio antes del primer cierre (§I.6; solo postgres, por el MCP) ───
create or replace function private.acc_tg_arca_vouchers_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;                                                   -- cascada del bar entero
    end if;
    if current_setting('acc.reset', true) = old.tenant_id::text
       and not (old.environment = 'produccion'
                and old.status in ('requesting', 'needs_reconcile', 'authorized', 'posted')) then
      return old;                                                   -- reinicio, salvo lo que llegó a ARCA en producción
    end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_arca_vouchers';
  end if;
  if old.status in ('posted', 'rejected', 'failed', 'abandoned')
     or new.id <> old.id or new.tenant_id <> old.tenant_id or new.connection_id <> old.connection_id
     or new.environment <> old.environment or new.point_of_sale <> old.point_of_sale or new.cbte_tipo <> old.cbte_tipo
     or new.client_ref <> old.client_ref or new.form <> old.form or new.total_cents <> old.total_cents
     or new.related_voucher_id is distinct from old.related_voucher_id
     or new.created_by <> old.created_by or new.created_by_name <> old.created_by_name
     or new.created_at <> old.created_at
     or (old.number is not null and new.number is distinct from old.number)
     or (old.cae is not null and new.cae is distinct from old.cae)
     or (old.cae_due is not null and new.cae_due is distinct from old.cae_due)
     or (old.request is not null and new.request is distinct from old.request)
     or (old.request_sha256 is not null and new.request_sha256 is distinct from old.request_sha256)
     or (old.document_id is not null and new.document_id is distinct from old.document_id) then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_arca_vouchers';
  end if;
  return new;
end;
$$;

-- select private.acc_reset_tenant('<tenant_id>', 'BORRAR <slug>');
-- Borra todo lo contable del bar salvo acc_access, acc_guide_progress y la historia de audit_log. Rechaza si hay
-- un mes cerrado (reset_after_close) o facturas de producción que llegaron a ARCA (reset_arca_vouchers).
create or replace function private.acc_reset_tenant(p_tenant_id uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  v_t text;
begin
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_confirm is distinct from ('BORRAR ' || v_slug) then
    raise exception 'reset_confirm_mismatch' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if exists (select 1 from public.acc_periods p where p.tenant_id = p_tenant_id and p.status = 'closed') then
    raise exception 'reset_after_close' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_arca_vouchers v
              where v.tenant_id = p_tenant_id and v.environment = 'produccion'
                and v.status in ('requesting', 'needs_reconcile', 'authorized', 'posted')) then
    raise exception 'reset_arca_vouchers' using errcode = 'P0001';
  end if;

  -- La marca habilita el DELETE en los triggers de inmutabilidad (solo para este bar y esta transacción).
  perform set_config('acc.reset', p_tenant_id::text, true);
  update public.acc_periods p set iva_settlement_document_id = null
   where p.tenant_id = p_tenant_id and p.iva_settlement_document_id is not null;
  update public.acc_recurring_expenses x set last_document_id = null
   where x.tenant_id = p_tenant_id and x.last_document_id is not null;
  -- En orden de FK: primero ARCA, importadores y Mercado Pago (apuntan a comprobantes, cajas y partícipes).
  foreach v_t in array array[
      'acc_import_proposals', 'acc_import_items', 'acc_import_batches', 'acc_import_layouts', 'acc_import_rules',
      'acc_secrets', 'acc_mp_connections', 'acc_arca_tickets', 'acc_arca_vouchers', 'acc_arca_connections',
      'acc_arca_padron_cache', 'acc_allocations', 'acc_journal_lines', 'acc_journal_entries', 'acc_fiscal_vouchers',
      'acc_document_lines', 'acc_documents', 'acc_bundles', 'acc_recurring_expenses', 'acc_sales_methods',
      'acc_sales_points', 'acc_treasury_accounts', 'acc_parties', 'acc_accounts', 'acc_period_events', 'acc_periods',
      'acc_fiscal_years', 'acc_settings'] loop
    execute format('delete from public.%I where tenant_id = $1', v_t) using p_tenant_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(substr(v_t, 5), v_n);
  end loop;
  perform set_config('acc.reset', '', true);

  perform private.acc_audit(p_tenant_id, null, 'acc_settings.reset', 'acc_settings', p_tenant_id, v_counts);
  return v_counts;
end;
$$;

-- ─── 8. Comentarios y privilegios ───
comment on function public.acc_import_put_proposals(uuid, uuid, jsonb) is
  'Upsert de hasta 500 propuestas (client_ref fijo; posted no se toca; posting no cambia de contenido con un reclamo de menos de 3 min o con bundle; voided se rearma con attempt mayor; repetidas en otro lote → skipped).';
comment on function private.acc_import_sync_document(uuid, uuid) is
  'Concilia las propuestas de importación con el estado final de un comprobante (anulado, revertido, corregido o de nuevo vigente).';

revoke all on function private.acc_import_refresh_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_import_sync_document(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_ctg_import_documents() from public, anon, authenticated;
revoke all on function private.acc_tg_arca_vouchers_bu() from public, anon, authenticated;
revoke all on function private.acc_reset_tenant(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.acc_import_put_proposals(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_import_put_proposals(uuid, uuid, jsonb) to authenticated;
revoke all on function public.acc_import_mark_posted(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.acc_import_mark_posted(uuid, uuid, text, uuid) to authenticated;
revoke all on function public.acc_import_cancel_batch(uuid, uuid, text) from public, anon;
grant execute on function public.acc_import_cancel_batch(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
