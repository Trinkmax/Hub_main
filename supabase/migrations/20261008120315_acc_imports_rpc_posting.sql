-- ============================================================
-- ARCA e importadores · migración 10 de 12 (diseño §4.0, §4.1, §6.3)
-- RPC de importación: filas ignoradas, marcar lo contabilizado y coincidencias con lo cargado a mano
-- ============================================================
-- Qué crea:
--   · acc_import_set_items: «No es nuestro» (ignore) y deshacerlo (unignore).
--   · acc_import_mark_posted: después de acc_post_bundle. Exige que el comprobante esté vigente y
--     que SU bundle tenga el client_ref de la propuesta. Idempotente. Si no queda nada pendiente, el
--     lote pasa a `done` (audita acc_import.batch_done).
--   · acc_import_match_purchases (INVOKER, stable): la lógica de acc_possible_duplicate de a muchas
--     filas (mismo PV y número; si no, mismo total a ±3 días).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. «No es nuestro» ──────────────────────────────────────────────────────
-- p_changes: [{kind: ignore | unignore, item_ids: [...], reason?}] (1 a 50 cambios, hasta 1000 ids
-- cada uno). Ignorar una fila ya cargada → import_proposal_posted. El motivo queda en issues
-- ({key: 'ignored', reason}); deshacerlo lo saca. Devuelve {changed, counts}.
create function public.acc_import_set_items(p_tenant_id uuid, p_batch_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.acc_import_batches;
  v_c jsonb;
  v_kind text;
  v_reason text;
  v_ids uuid[];
  v_n integer := 0;
  v_k integer;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  select * into v_batch from public.acc_import_batches b
   where b.id = p_batch_id and b.tenant_id = p_tenant_id
   for update;
  if not found or v_batch.status in ('done', 'cancelled') then
    raise exception 'import_batch_closed' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 50 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'changes';
  end if;
  for v_c in select e.value from jsonb_array_elements(p_changes) e loop
    if jsonb_typeof(v_c) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_c) k where k not in ('kind', 'item_ids', 'reason')) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'changes';
    end if;
    v_kind := v_c ->> 'kind';
    v_reason := nullif(left(btrim(coalesce(v_c ->> 'reason', '')), 200), '');
    if v_kind is null or v_kind not in ('ignore', 'unignore')
       or jsonb_typeof(v_c -> 'item_ids') is distinct from 'array'
       or jsonb_array_length(v_c -> 'item_ids') not between 1 and 1000 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'changes';
    end if;
    v_ids := array(select private.acc_to_uuid(x) from jsonb_array_elements_text(v_c -> 'item_ids') x);
    if exists (select 1 from unnest(v_ids) u where u is null) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'item_ids';
    end if;
    if v_kind = 'ignore' then
      if exists (select 1 from public.acc_import_items i
                  where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and i.id = any (v_ids)
                    and i.status = 'posted') then
        raise exception 'import_proposal_posted' using errcode = 'P0001';
      end if;
      update public.acc_import_items i
         set status = 'ignored',
             issues = (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from jsonb_array_elements(i.issues) x
                        where x.value ->> 'key' is distinct from 'ignored')
                      || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('key', 'ignored', 'reason', v_reason)))
       where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and i.id = any (v_ids)
         and i.status in ('new', 'review');
    else
      update public.acc_import_items i
         set status = 'new',
             issues = (select coalesce(jsonb_agg(x.value), '[]'::jsonb) from jsonb_array_elements(i.issues) x
                        where x.value ->> 'key' is distinct from 'ignored')
       where i.batch_id = p_batch_id and i.tenant_id = p_tenant_id and i.id = any (v_ids)
         and i.status = 'ignored';
    end if;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return jsonb_build_object('changed', v_n, 'counts', private.acc_import_refresh_counts(p_tenant_id, p_batch_id));
end;
$$;

-- ─── 2. Marcar lo contabilizado ──────────────────────────────────────────────
-- Después de acc_post_bundle con el client_ref de la propuesta. Vale también en un lote cancelado
-- mientras se contabilizaba (lo cargado queda). Devuelve {status, counts, replayed}.
create function public.acc_import_mark_posted(p_tenant_id uuid, p_batch_id uuid, p_key text, p_document_id uuid)
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
  if v_doc.id is null or v_doc.status <> 'posted' or v_ref is distinct from v_p.client_ref then
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

-- ─── 3. Coincidencias con lo cargado a mano ──────────────────────────────────
-- p_rows: [{key, party_id, voucher_type, point_of_sale, number, total_cents, issue_date, credit?}]
-- (hasta 1000). Para cada fila con proveedor, la mejor coincidencia entre comprobantes vigentes:
-- `number` (mismo tipo, PV y número) o `amount` (mismo total a ±3 días, sin la factura mensual de
-- comisiones). Devuelve [{key, match, document_id, label}] solo de las filas con coincidencia.
-- INVOKER: corre bajo la RLS de quien llama (además del filtro por bar).
create function public.acc_import_match_purchases(p_tenant_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform public.acc_assert_reader(p_tenant_id);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'rows';
  end if;
  return (
    with r as (
      select x.ord, x.v ->> 'key' as key,
             case when x.v ->> 'party_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (x.v ->> 'party_id')::uuid end as party_id,
             x.v ->> 'voucher_type' as voucher_type,
             case when x.v ->> 'point_of_sale' ~ '^[0-9]{1,5}$' then (x.v ->> 'point_of_sale')::int end as pos,
             case when x.v ->> 'number' ~ '^[0-9]{1,8}$' then (x.v ->> 'number')::bigint end as num,
             case when x.v ->> 'total_cents' ~ '^[0-9]{1,16}$' then (x.v ->> 'total_cents')::bigint end as total,
             case when x.v ->> 'issue_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.v ->> 'issue_date')::date end as day,
             case when jsonb_typeof(x.v -> 'credit') = 'boolean' then (x.v ->> 'credit')::boolean
                  else coalesce(x.v ->> 'voucher_type', '') like 'nota\_credito%' end as credit
        from jsonb_array_elements(p_rows) with ordinality as x(v, ord)
       where jsonb_typeof(x.v) = 'object')
    select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'match', m.match, 'document_id', m.id,
                                                 'label', m.label) order by r.ord), '[]'::jsonb)
      from r
      cross join lateral (
        select s.id, s.match, public.acc_doc_label(s.kind, s.voucher_type, s.point_of_sale, s.number) as label
          from (select d.id, 'number'::text as match, 1 as rk, 0 as dist, d.kind, d.voucher_type, d.point_of_sale,
                       d.number, d.accounting_date, d.seq
                  from public.acc_documents d
                 where d.tenant_id = p_tenant_id and d.party_id = r.party_id and d.status = 'posted'
                   and d.kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note')
                   and d.voucher_type = r.voucher_type and d.point_of_sale = r.pos and d.number = r.num
                union all
                select d.id, 'amount', 2, abs(d.issue_date - r.day), d.kind, d.voucher_type, d.point_of_sale,
                       d.number, d.accounting_date, d.seq
                  from public.acc_documents d
                 where d.tenant_id = p_tenant_id and d.party_id = r.party_id and d.status = 'posted'
                   and d.total_cents = r.total and not d.settles_commissions
                   and d.issue_date between r.day - 3 and r.day + 3
                   and (case when r.credit then d.kind = 'purchase_credit_note'
                             else d.kind in ('purchase', 'purchase_debit_note', 'expense') end)) s
         order by s.rk, s.dist, s.accounting_date desc, s.seq desc
         limit 1) m
     where r.party_id is not null);
end;
$$;

comment on function public.acc_import_set_items(uuid, uuid, jsonb) is
  'Marca filas como «no es nuestro» (ignored) o lo deshace.';
comment on function public.acc_import_mark_posted(uuid, uuid, text, uuid) is
  'Marca una propuesta como contabilizada (el bundle del comprobante tiene que tener su client_ref). Cierra el lote si no queda nada; audita acc_import.batch_done.';
comment on function public.acc_import_match_purchases(uuid, jsonb) is
  'Coincidencias fuertes (PV y número) y débiles (total a ±3 días) de muchas filas contra compras vigentes. INVOKER.';

-- ─── 4. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_import_set_items(uuid, uuid, jsonb) from public, anon;
grant execute on function public.acc_import_set_items(uuid, uuid, jsonb) to authenticated;
revoke all on function public.acc_import_mark_posted(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.acc_import_mark_posted(uuid, uuid, text, uuid) to authenticated;
revoke all on function public.acc_import_match_purchases(uuid, jsonb) from public, anon;
grant execute on function public.acc_import_match_purchases(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
