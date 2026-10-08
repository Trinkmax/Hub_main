-- ============================================================
-- ARCA e importadores · migración 6 de 12 (diseño §3.2.4, §3.2.5, §6.3)
-- RPC de la saga de emisión con CAE: reservar y avanzar de estado
-- ============================================================
-- Qué crea (SECURITY DEFINER, search_path vacío, EXECUTE solo authenticated):
--   · acc_arca_voucher_reserve: toma el «lease» de emisión de (bar, ambiente, PV, tipo) insertando
--     un voucher `reserved` (el índice único parcial aavo_in_flight_uq hace la exclusión entre
--     instancias: no hay lock de base durante las llamadas HTTP a ARCA). Devuelve el client_ref
--     con el que después se contabiliza (idempotencia de acc_post_bundle).
--   · acc_arca_voucher_update: las transiciones válidas de la saga, con lo que trae cada una:
--       reserved        → requesting (number, request, request_sha256, issue_date?) | abandoned (reason?)
--       requesting      → authorized (cae, cae_due, …) | rejected (errors, …) | needs_reconcile (reason?)
--       needs_reconcile → authorized | failed (reason?, errors?)
--       authorized      → posted (document_id: el comprobante contabilizado con el MISMO client_ref)
--     Homologación nunca contabiliza (CHECK aavo_homo_no_books y chequeo explícito).
-- Cada paso audita acc_arca.voucher_<estado> {environment, pv, tipo, number, total_cents, cae, document_id}.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Reservar ─────────────────────────────────────────────────────────────
-- p_payload (lista blanca): {form: objeto (≤ 32 KB), total_cents, issue_date?, related_voucher_id?}.
-- Exige la conexión `connected`; en producción además la emisión prendida y el PV de la conexión.
-- NC y ND (2, 3, 7, 8): contra un voucher autorizado de la plataforma, de la misma letra y ambiente.
-- Lo vivo de ese PV y tipo con más de 3 minutos sin moverse: `reserved` → abandoned (y se sigue);
-- `requesting` o `needs_reconcile` → devuelve {needs_reconcile: id} para verificarlo con ARCA antes.
-- Lo vivo más nuevo → arca_voucher_in_flight.
create function public.acc_arca_voucher_reserve(p_tenant_id uuid, p_environment text, p_point_of_sale int,
                                                p_cbte_tipo smallint, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_conn public.acc_arca_connections;
  v_live public.acc_arca_vouchers;
  v_rel public.acc_arca_vouchers;
  v_row public.acc_arca_vouchers;
  v_total bigint;
  v_issue date;
  v_rel_id uuid;
  v_bad text;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  perform private.acc_arca_check_env(p_environment);
  if p_cbte_tipo is null or p_cbte_tipo not in (1, 2, 3, 6, 7, 8) then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cbte_tipo';
  end if;
  if p_point_of_sale is null or p_point_of_sale not between 1 and 99998 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'point_of_sale';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'payload';
  end if;
  select k into v_bad from jsonb_object_keys(p_payload) k
   where k not in ('form', 'total_cents', 'issue_date', 'related_voucher_id')
   limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;
  if jsonb_typeof(p_payload -> 'form') is distinct from 'object' or pg_column_size(p_payload -> 'form') > 32768 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'form';
  end if;
  v_total := private.acc_to_bigint(p_payload -> 'total_cents');
  if v_total is null or v_total not between 0 and 1000000000000000 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'total_cents';
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'issue_date'), 'null') <> 'null' then
    v_issue := private.acc_to_date(p_payload ->> 'issue_date');
    if v_issue is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'issue_date';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_payload -> 'related_voucher_id'), 'null') <> 'null' then
    v_rel_id := private.acc_to_uuid(p_payload ->> 'related_voucher_id');
    if v_rel_id is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'related_voucher_id';
    end if;
  end if;

  select * into v_conn from public.acc_arca_connections c
   where c.tenant_id = p_tenant_id and c.environment = p_environment;
  if not found or v_conn.status <> 'connected' then
    raise exception 'arca_not_connected' using errcode = 'P0001';
  end if;
  if p_environment = 'produccion' then
    if not v_conn.emission_enabled then
      raise exception 'arca_emission_disabled' using errcode = 'P0001';
    end if;
    if v_conn.point_of_sale is distinct from p_point_of_sale then
      raise exception 'arca_point_of_sale_mismatch' using errcode = 'P0001';
    end if;
  end if;

  if p_cbte_tipo in (2, 3, 7, 8) then
    select * into v_rel from public.acc_arca_vouchers v where v.id = v_rel_id and v.tenant_id = p_tenant_id;
    if v_rel_id is null or v_rel.id is null or v_rel.environment <> p_environment
       or v_rel.status not in ('authorized', 'posted') or (v_rel.cbte_tipo <= 3) <> (p_cbte_tipo <= 3) then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'related_voucher_id';
    end if;
  elsif v_rel_id is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'related_voucher_id';
  end if;

  select * into v_live from public.acc_arca_vouchers v
   where v.tenant_id = p_tenant_id and v.environment = p_environment and v.point_of_sale = p_point_of_sale
     and v.cbte_tipo = p_cbte_tipo and v.status in ('reserved', 'requesting', 'needs_reconcile')
   for update;
  if found then
    if v_live.updated_at > now() - interval '3 minutes' then
      raise exception 'arca_voucher_in_flight' using errcode = 'P0001';
    end if;
    if v_live.status <> 'reserved' then
      return jsonb_build_object('needs_reconcile', v_live.id);
    end if;
    update public.acc_arca_vouchers v set status = 'abandoned', reason = 'stale_reservation'
     where v.id = v_live.id;
    perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.voucher_abandoned', 'acc_arca_voucher', v_live.id,
      jsonb_build_object('environment', p_environment, 'pv', p_point_of_sale, 'tipo', p_cbte_tipo,
                         'total_cents', v_live.total_cents));
  end if;

  begin
    insert into public.acc_arca_vouchers (tenant_id, connection_id, environment, point_of_sale, cbte_tipo, form,
                                          related_voucher_id, total_cents, issue_date, created_by, created_by_name)
    values (p_tenant_id, v_conn.id, p_environment, p_point_of_sale, p_cbte_tipo, p_payload -> 'form', v_rel_id,
            v_total, v_issue, v_uid, private.acc_actor_name(p_tenant_id, v_uid))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'arca_voucher_in_flight' using errcode = 'P0001';
  end;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.voucher_reserved', 'acc_arca_voucher', v_row.id,
    jsonb_build_object('environment', p_environment, 'pv', p_point_of_sale, 'tipo', p_cbte_tipo,
                       'total_cents', v_total));
  return jsonb_build_object('voucher_id', v_row.id, 'client_ref', v_row.client_ref);
end;
$$;

-- ─── 2. Avanzar de estado ────────────────────────────────────────────────────
-- p_patch (lista blanca según el destino; ver el encabezado). Fechas: cae_due e issue_date
-- 'YYYY-MM-DD'; fch_proceso instante ISO con zona. observations, errors y events: arreglos de WSFE.
-- Para `posted`, el comprobante tiene que ser del bar, estar vigente, ser de ventas (NC para 3 y 8),
-- con el mismo tipo, PV y número, y su bundle con el client_ref del voucher.
create function public.acc_arca_voucher_update(p_tenant_id uuid, p_voucher_id uuid, p_to text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_old public.acc_arca_vouchers;
  v_new public.acc_arca_vouchers;
  v_allowed text[];
  v_bad text;
  v_doc public.acc_documents;
  v_ref uuid;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'patch';
  end if;
  select * into v_old from public.acc_arca_vouchers v
   where v.id = p_voucher_id and v.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'arca_voucher_transition' using errcode = 'P0001',
      detail = jsonb_build_object('reason', 'not_found')::text;
  end if;
  if not ((v_old.status = 'reserved' and p_to in ('requesting', 'abandoned'))
       or (v_old.status = 'requesting' and p_to in ('authorized', 'rejected', 'needs_reconcile'))
       or (v_old.status = 'needs_reconcile' and p_to in ('authorized', 'failed'))
       or (v_old.status = 'authorized' and p_to = 'posted')) then
    raise exception 'arca_voucher_transition' using errcode = 'P0001',
      detail = jsonb_build_object('from', v_old.status, 'to', p_to)::text;
  end if;
  v_allowed := case p_to
    when 'requesting' then array['number', 'request', 'request_sha256', 'issue_date']
    when 'authorized' then array['cae', 'cae_due', 'fch_proceso', 'observations', 'events']
    when 'rejected' then array['errors', 'observations', 'events', 'fch_proceso', 'reason']
    when 'needs_reconcile' then array['reason']
    when 'failed' then array['reason', 'errors']
    when 'abandoned' then array['reason']
    else array['document_id'] end;
  select k into v_bad from jsonb_object_keys(v_patch) k where not (k = any (v_allowed)) limit 1;
  if v_bad is not null then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = v_bad;
  end if;

  v_new := v_old;
  v_new.status := p_to;
  if v_patch ? 'reason' then
    v_new.reason := nullif(left(btrim(coalesce(v_patch ->> 'reason', '')), 300), '');
  end if;
  if v_patch ? 'fch_proceso' then
    v_new.fch_proceso := private.acc_to_ts(v_patch ->> 'fch_proceso');
    if v_new.fch_proceso is null and jsonb_typeof(v_patch -> 'fch_proceso') <> 'null' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'fch_proceso';
    end if;
  end if;
  if v_patch ? 'observations' then
    if jsonb_typeof(v_patch -> 'observations') <> 'array' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'observations';
    end if;
    v_new.observations := v_patch -> 'observations';
  end if;
  if v_patch ? 'errors' then
    if jsonb_typeof(v_patch -> 'errors') <> 'array' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'errors';
    end if;
    v_new.errors := v_patch -> 'errors';
  end if;
  if v_patch ? 'events' then
    if jsonb_typeof(v_patch -> 'events') <> 'array' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'events';
    end if;
    v_new.events := v_patch -> 'events';
  end if;

  if p_to = 'requesting' then
    v_new.number := private.acc_to_bigint(v_patch -> 'number');
    v_new.request := v_patch -> 'request';
    v_new.request_sha256 := v_patch ->> 'request_sha256';
    if v_new.number is null or v_new.number not between 1 and 99999999 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'number';
    end if;
    if jsonb_typeof(v_new.request) is distinct from 'object' or pg_column_size(v_new.request) > 16384 then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'request';
    end if;
    if coalesce(v_new.request_sha256, '') !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'request_sha256';
    end if;
    if v_patch ? 'issue_date' then
      v_new.issue_date := private.acc_to_date(v_patch ->> 'issue_date');
      if v_new.issue_date is null then
        raise exception 'invalid_payload' using errcode = 'P0001', detail = 'issue_date';
      end if;
    end if;
  elsif p_to = 'authorized' then
    v_new.cae := v_patch ->> 'cae';
    v_new.cae_due := private.acc_to_date(v_patch ->> 'cae_due');
    v_new.result := 'A';
    if coalesce(v_new.cae, '') !~ '^[0-9]{14}$' then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cae';
    end if;
    if v_new.cae_due is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'cae_due';
    end if;
  elsif p_to = 'rejected' then
    v_new.result := 'R';
  elsif p_to = 'posted' then
    v_new.document_id := private.acc_to_uuid(v_patch ->> 'document_id');
    if v_new.document_id is null then
      raise exception 'invalid_payload' using errcode = 'P0001', detail = 'document_id';
    end if;
    select d.* into v_doc from public.acc_documents d where d.id = v_new.document_id and d.tenant_id = p_tenant_id;
    select b.client_ref into v_ref from public.acc_bundles b where b.id = v_doc.bundle_id and b.tenant_id = p_tenant_id;
    if v_doc.id is null or v_old.environment <> 'produccion' or v_doc.status <> 'posted'
       or v_doc.kind not in ('sales_invoice', 'sales_debit_note', 'sales_credit_note')
       or (v_doc.kind = 'sales_credit_note') <> (v_old.cbte_tipo in (3, 8))
       or v_doc.voucher_type is distinct from (case v_old.cbte_tipo when 1 then 'factura_a' when 2 then 'nota_debito_a'
                                                 when 3 then 'nota_credito_a' when 6 then 'factura_b'
                                                 when 7 then 'nota_debito_b' else 'nota_credito_b' end)
       or v_doc.point_of_sale is distinct from v_old.point_of_sale or v_doc.number is distinct from v_old.number
       or v_ref is distinct from v_old.client_ref then
      raise exception 'arca_voucher_document_mismatch' using errcode = 'P0001';
    end if;
  end if;

  begin
    update public.acc_arca_vouchers v
       set status = v_new.status, number = v_new.number, request = v_new.request,
           request_sha256 = v_new.request_sha256, issue_date = v_new.issue_date, cae = v_new.cae,
           cae_due = v_new.cae_due, result = v_new.result, fch_proceso = v_new.fch_proceso,
           observations = v_new.observations, errors = v_new.errors, events = v_new.events,
           document_id = v_new.document_id, reason = v_new.reason
     where v.id = v_old.id
     returning * into v_new;
  exception when unique_violation then
    -- aavo_document_uq: el comprobante ya está vinculado a otro voucher. aavo_number_uq: otro voucher
    -- vivo o autorizado ya tiene ese número (ARCA no lo daría dos veces: es un bug, no se reintenta).
    if p_to = 'posted' then
      raise exception 'arca_voucher_document_mismatch' using errcode = 'P0001';
    end if;
    raise exception 'arca_voucher_transition' using errcode = 'P0001',
      detail = jsonb_build_object('reason', 'number_taken')::text;
  end;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_arca.voucher_' || p_to, 'acc_arca_voucher', v_new.id,
    jsonb_build_object('environment', v_new.environment, 'pv', v_new.point_of_sale, 'tipo', v_new.cbte_tipo,
                       'number', v_new.number, 'total_cents', v_new.total_cents, 'cae', v_new.cae,
                       'document_id', v_new.document_id));
  return to_jsonb(v_new);
end;
$$;

comment on function public.acc_arca_voucher_reserve(uuid, text, integer, smallint, jsonb) is
  'Reserva la emisión de un comprobante con CAE ({voucher_id, client_ref} o {needs_reconcile}); una sola viva por bar, ambiente, PV y tipo. Audita acc_arca.voucher_reserved.';
comment on function public.acc_arca_voucher_update(uuid, uuid, text, jsonb) is
  'Avanza la saga de emisión por las transiciones válidas (posted exige el comprobante del mismo client_ref). Audita acc_arca.voucher_<estado>.';

-- ─── 3. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.acc_arca_voucher_reserve(uuid, text, integer, smallint, jsonb) from public, anon;
grant execute on function public.acc_arca_voucher_reserve(uuid, text, integer, smallint, jsonb) to authenticated;
revoke all on function public.acc_arca_voucher_update(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.acc_arca_voucher_update(uuid, uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
