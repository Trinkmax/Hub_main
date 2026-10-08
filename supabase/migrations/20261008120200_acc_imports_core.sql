-- ============================================================
-- ARCA e importadores · migración 7 de 12 (diseño §4.0, §4.2.4, §6.1–§6.2)
-- Importadores (Mis Comprobantes, Mercado Pago, banco) y conexión con Mercado Pago: tablas,
-- RLS, privilegios, índices, triggers y el helper de conteos
-- ============================================================
-- Qué crea:
--   1. acc_import_batches: un lote por archivo (o por día sincronizado por API). Idempotencia del
--      ARCHIVO: único por (bar, origen, SHA-256) entre lotes no cancelados.
--   2. acc_import_items: las filas normalizadas (sin datos personales: zod estricto en el
--      servidor). Idempotencia de la FILA: una sola viva por (bar, familia, clave natural); las
--      repetidas quedan `duplicate` con `duplicate_of`. Las «no es nuestro» (`ignored`) siguen vivas:
--      se recuerdan para siempre.
--   3. acc_import_proposals: un comprobante propuesto por fila o por día, con los valores del
--      formulario, el preview_hash y un client_ref determinístico (idempotencia del COMPROBANTE en
--      acc_post_bundle). Una clave no se contabiliza dos veces (aipr_posted_key_uq). El client_ref
--      es único entre propuestas no salteadas: la misma clave viva en dos lotes no se pisa.
--   4. acc_import_rules (reglas del bar: «recordar para este proveedor», reglas del banco) y
--      acc_import_layouts (mapeo de columnas de un extracto con formato nuevo).
--   5. acc_mp_connections: la configuración de Mercado Pago (caja, partícipe, medio del cierre por
--      canal, corte del día) y el estado de la sincronización. El token vive cifrado en
--      acc_secrets (acá solo los últimos 4 caracteres): se agrega la FK asec_mp_fk.
--   6. private.acc_import_refresh_counts: recalcula `counts` del lote (lo usan las RPC), y
--      private.acc_service_check: la guardia de las RPC *_service del cron (importación y Mercado Pago).
--
-- Lectura: las seis con la política `<prefijo>_select_readers` (la contadora ve historial, reglas y
-- el estado de Mercado Pago; nunca tokens). Sin privilegios de escritura: solo RPC SECURITY DEFINER.
-- Ninguna va a Realtime.
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Tablas ───────────────────────────────────────────────────────────────

-- acc_import_batches — lotes de importación
create table public.acc_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- arca_recibidos | arca_emitidos | mp_release | bank_statement
  origin text not null default 'upload',              -- upload | api
  file_name text,
  file_sha256 text,
  file_size int,
  detected_format text,                               -- mc_g3 | mc_g2 | mc_g1 | mc_xlsx | mp_release | bank:<firma>
  period_from date,
  period_to date,
  treasury_account_id uuid,                           -- banco o billetera del extracto
  status text not null default 'staging',             -- staging | review | posting | done | cancelled
  counts jsonb not null default '{}',                 -- lo recalcula private.acc_import_refresh_counts
  meta jsonb not null default '{}',                   -- saldos del archivo, corte de día, generación (sin datos personales)
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,                      -- «Sincronización automática» en origin = api
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  constraint aibt_id_tenant_uq unique (id, tenant_id),
  constraint aibt_source check (source in ('arca_recibidos', 'arca_emitidos', 'mp_release', 'bank_statement')),
  constraint aibt_origin check (origin in ('upload', 'api')),
  constraint aibt_status check (status in ('staging', 'review', 'posting', 'done', 'cancelled')),
  constraint aibt_file check ((file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$')
                              and (file_size is null or file_size between 1 and 20971520)
                              and (origin = 'api' or (file_sha256 is not null and file_size is not null))),
  constraint aibt_name_len check (file_name is null or char_length(file_name) between 1 and 200),
  constraint aibt_format check (detected_format is null or detected_format ~ '^[a-z0-9_:-]{2,80}$'),
  constraint aibt_period check (period_to is null or period_from is null or period_to >= period_from),
  constraint aibt_json check (jsonb_typeof(counts) = 'object' and pg_column_size(counts) <= 2048
                              and jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 8192),
  constraint aibt_done check ((status = 'done') = (completed_at is not null)),
  constraint aibt_cancel check ((status = 'cancelled') = (cancelled_at is not null)
                                and (cancel_reason is null or char_length(cancel_reason) <= 300)),
  constraint aibt_by_name check (char_length(created_by_name) between 1 and 80),
  constraint aibt_treasury_fk foreign key (treasury_account_id, tenant_id)
    references public.acc_treasury_accounts (id, tenant_id)
);
create unique index aibt_file_uq on public.acc_import_batches (tenant_id, source, file_sha256)
  where file_sha256 is not null and status <> 'cancelled';
create index aibt_tenant_idx on public.acc_import_batches (tenant_id, created_at desc);
create index aibt_treasury_idx on public.acc_import_batches (treasury_account_id, tenant_id) where treasury_account_id is not null;
create index aibt_created_by_idx on public.acc_import_batches (created_by) where created_by is not null;
comment on table public.acc_import_batches is
  'Lotes de importación (un archivo o un día sincronizado). Único por (bar, origen, SHA-256) entre los no cancelados.';

-- acc_import_items — filas normalizadas de cada lote
create table public.acc_import_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null,
  row_no int not null,
  source_family text not null,                        -- arca_recibidos | arca_emitidos | mp | bank:<treasury_id>
  natural_key text not null,                          -- mc:R:<cuit>:<código>:<pv>:<número> · mp:<sha256> · bank:<caja>:<sha256>:<n>
  data jsonb not null,                                -- McItem | MpItem | BankItem (sin datos personales)
  status text not null default 'new',                 -- new | duplicate | ignored | review | posted | cancelled
  duplicate_of uuid,
  issues jsonb not null default '[]',
  proposal_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aiit_id_tenant_uq unique (id, tenant_id),
  constraint aiit_row_uq unique (batch_id, row_no),
  constraint aiit_batch_fk foreign key (batch_id, tenant_id)
    references public.acc_import_batches (id, tenant_id) on delete cascade,
  constraint aiit_dup_fk foreign key (duplicate_of, tenant_id) references public.acc_import_items (id, tenant_id),
  constraint aiit_status check (status in ('new', 'duplicate', 'ignored', 'review', 'posted', 'cancelled')),
  constraint aiit_row_no check (row_no between 0 and 9999999),
  constraint aiit_key_len check (char_length(natural_key) between 3 and 200),
  constraint aiit_family check (source_family ~ '^(arca_recibidos|arca_emitidos|mp|bank:[0-9a-f-]{36})$'),
  constraint aiit_data check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8192),
  constraint aiit_issues check (jsonb_typeof(issues) = 'array' and pg_column_size(issues) <= 4096),
  constraint aiit_keys check (cardinality(proposal_keys) <= 20),
  constraint aiit_dup_coherent check ((status = 'duplicate') = (duplicate_of is not null))
);
-- Una fila VIVA por clave natural (las «no es nuestro» quedan vivas: se recuerdan para siempre).
create unique index aiit_live_key_uq on public.acc_import_items (tenant_id, source_family, natural_key)
  where status not in ('duplicate', 'cancelled');
create index aiit_batch_idx on public.acc_import_items (batch_id, tenant_id, status);
create index aiit_dup_idx on public.acc_import_items (duplicate_of, tenant_id) where duplicate_of is not null;
comment on table public.acc_import_items is
  'Filas normalizadas de un lote (sin datos personales). Una sola viva por clave natural; las repetidas quedan duplicate.';

-- acc_import_proposals — comprobantes propuestos
create table public.acc_import_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null,
  key text not null,                                  -- 'mc:R:30…:1:3:110266' · 'mp:2026-10-05:collection:<medio>' · 'bank:<caja>:2026-10-05:expense'
  form text not null,                                 -- purchase | purchase_credit_note | collection | bank_expense | transfer | cash_movement | payment
  form_values jsonb not null,                         -- *Values del formulario, sin clientRef ni previewHash
  summary jsonb not null,                             -- {date, label, counterparty, total_cents, month} para la lista
  preview_hash text,
  client_ref uuid not null,                           -- uuidV8(sha256('acc-import:'+tenant+':'+key+':'+attempt))
  attempt smallint not null default 1,
  status text not null default 'needs_input',         -- needs_input | ready | posting | posted | stale | error | skipped
  needs jsonb not null default '[]',                  -- [{key:'supplier_account', party_id}, {key:'other_taxes_as'}, …]
  warnings_ack text[] not null default '{}',
  document_id uuid,
  posted_at timestamptz,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aipr_id_tenant_uq unique (id, tenant_id),
  constraint aipr_key_uq unique (batch_id, key),
  constraint aipr_batch_fk foreign key (batch_id, tenant_id)
    references public.acc_import_batches (id, tenant_id) on delete cascade,
  constraint aipr_doc_fk foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint aipr_form check (form in ('purchase', 'purchase_credit_note', 'collection', 'bank_expense', 'transfer',
                                       'cash_movement', 'payment')),
  constraint aipr_status check (status in ('needs_input', 'ready', 'posting', 'posted', 'stale', 'error', 'skipped')),
  constraint aipr_hash check (preview_hash is null or preview_hash ~ '^[0-9a-f]{64}$'),
  constraint aipr_ready check (status not in ('ready', 'posting') or preview_hash is not null),
  constraint aipr_posted check ((status = 'posted') = (document_id is not null) and (status = 'posted') = (posted_at is not null)),
  constraint aipr_key_len check (char_length(key) between 3 and 200),
  constraint aipr_attempt check (attempt between 1 and 100),
  constraint aipr_sizes check (jsonb_typeof(form_values) = 'object' and pg_column_size(form_values) <= 32768
                               and jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 4096
                               and jsonb_typeof(needs) = 'array' and pg_column_size(needs) <= 8192
                               and (error is null or (jsonb_typeof(error) = 'object' and pg_column_size(error) <= 4096))
                               and cardinality(warnings_ack) <= 30)
);
-- Una clave se contabiliza una sola vez, aunque venga en dos lotes.
create unique index aipr_posted_key_uq on public.acc_import_proposals (tenant_id, key) where status = 'posted';
-- El client_ref (determinístico por clave e intento) no lo pueden reclamar dos propuestas activas.
create unique index aipr_client_ref_uq on public.acc_import_proposals (tenant_id, client_ref) where status <> 'skipped';
create index aipr_batch_idx on public.acc_import_proposals (batch_id, tenant_id, status);
create index aipr_doc_idx on public.acc_import_proposals (document_id, tenant_id) where document_id is not null;
comment on table public.acc_import_proposals is
  'Comprobantes propuestos por un lote (valores del formulario + preview_hash + client_ref determinístico). Se contabilizan de a uno con acc_post_bundle.';

-- acc_import_rules — reglas del bar
create table public.acc_import_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- arca_recibidos | mp_release | bank_statement
  priority smallint not null default 100,
  label text not null,                                -- el «motivo» que ve la persona
  match jsonb not null,                               -- {direction?, pattern?, counterparty_cuit?, amount_min?, amount_max?, treasury_account_id?, party_id?}
  action jsonb not null,                              -- {kind, account_id?, party_id?, treasury_account_id?, field?, other_taxes_as?, jurisdiction_code?}
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint airu_id_tenant_uq unique (id, tenant_id),
  constraint airu_source check (source in ('arca_recibidos', 'mp_release', 'bank_statement')),
  constraint airu_label_len check (char_length(btrim(label)) between 2 and 120),
  constraint airu_priority check (priority between 1 and 1000),
  constraint airu_json check (jsonb_typeof(match) = 'object' and pg_column_size(match) <= 4096
                              and jsonb_typeof(action) = 'object' and pg_column_size(action) <= 4096
                              and jsonb_typeof(action -> 'kind') is not distinct from 'string'),
  constraint airu_pattern check (match ->> 'pattern' is null or char_length(match ->> 'pattern') <= 200)
);
create index airu_tenant_idx on public.acc_import_rules (tenant_id, source, priority) where active;
create index airu_created_by_idx on public.acc_import_rules (created_by) where created_by is not null;
create index airu_updated_by_idx on public.acc_import_rules (updated_by) where updated_by is not null;
comment on table public.acc_import_rules is
  'Reglas de importación del bar (otros tributos por proveedor, clasificación de movimientos del banco).';

-- acc_import_layouts — mapeo de columnas de un formato de extracto nuevo
create table public.acc_import_layouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                               -- bank_statement (por ahora)
  signature text not null,                            -- sha256(encabezados normalizados + separador)
  mapping jsonb not null,                             -- {date: 0, description: 2, debit: 4, credit: 5, balance: 6, header_row: 3, decimal: ','}
  treasury_account_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ailo_uq unique (tenant_id, source, signature),
  constraint ailo_source check (source in ('bank_statement')),
  constraint ailo_sig check (signature ~ '^[0-9a-f]{64}$'),
  constraint ailo_mapping check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) <= 4096),
  constraint ailo_treasury_fk foreign key (treasury_account_id, tenant_id)
    references public.acc_treasury_accounts (id, tenant_id)
);
create index ailo_treasury_idx on public.acc_import_layouts (treasury_account_id, tenant_id) where treasury_account_id is not null;
create index ailo_created_by_idx on public.acc_import_layouts (created_by) where created_by is not null;
comment on table public.acc_import_layouts is
  'Mapeo de columnas de un formato de extracto bancario (por firma de encabezados): la próxima vez no se pregunta.';

-- acc_mp_connections — Mercado Pago (una por bar)
create table public.acc_mp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  treasury_account_id uuid not null,                  -- la caja «Mercado Pago»
  party_id uuid not null,                             -- el partícipe «Mercado Pago» (system_key mercado_pago)
  status text not null default 'csv_only',            -- csv_only | connected | reconnect | disconnected
  mp_user_id bigint,
  site_id text,
  token_last4 text,
  scopes text[],
  channel_methods jsonb not null default '{}',        -- {"qr":"<sales_method_id>","point":…,"transfer_in":…,"link":…}
  day_cutoff_hour smallint not null default 0,        -- 0 = día calendario · 5 = día de servicio (a confirmar con la contadora)
  report_config_applied_at timestamptz,
  pending_report jsonb,                               -- {id, begin, end, requested_at} mientras Mercado Pago lo genera
  synced_through date,
  last_sync_at timestamptz,
  last_sync_status text,
  last_error_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ampc_id_tenant_uq unique (id, tenant_id),
  constraint ampc_status check (status in ('csv_only', 'connected', 'reconnect', 'disconnected')),
  constraint ampc_cutoff check (day_cutoff_hour between 0 and 8),
  constraint ampc_site check (site_id is null or site_id = 'MLA'),
  constraint ampc_last4 check (token_last4 is null or token_last4 ~ '^[A-Za-z0-9-]{4}$'),
  constraint ampc_connected check (status <> 'connected' or token_last4 is not null),
  constraint ampc_user check (mp_user_id is null or mp_user_id > 0),
  constraint ampc_scopes check (scopes is null or cardinality(scopes) <= 30),
  constraint ampc_json check (jsonb_typeof(channel_methods) = 'object' and pg_column_size(channel_methods) <= 2048
                              and (pending_report is null
                                   or (jsonb_typeof(pending_report) = 'object' and pg_column_size(pending_report) <= 2048))),
  constraint ampc_sync_status check (last_sync_status is null or last_sync_status ~ '^[a-z][a-z0-9_]{1,29}$'),
  constraint ampc_error_key check (last_error_key is null or last_error_key ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint ampc_treasury_fk foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id),
  constraint ampc_party_fk foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
create index ampc_treasury_idx on public.acc_mp_connections (treasury_account_id, tenant_id);
create index ampc_party_idx on public.acc_mp_connections (party_id, tenant_id);
create index ampc_created_by_idx on public.acc_mp_connections (created_by) where created_by is not null;
create index ampc_updated_by_idx on public.acc_mp_connections (updated_by) where updated_by is not null;
comment on table public.acc_mp_connections is
  'Mercado Pago del bar: caja, partícipe, medio del cierre por canal, corte del día y estado de la sincronización. El token vive cifrado en acc_secrets.';

-- El token de Mercado Pago vive en acc_secrets (migración 1): ahora que existe la tabla, su FK.
-- La cubre asec_mp_uq (mp_connection_id, tenant_id, name).
alter table public.acc_secrets add constraint asec_mp_fk foreign key (mp_connection_id, tenant_id)
  references public.acc_mp_connections (id, tenant_id) on delete cascade;

-- ─── 2. RLS y privilegios (mismo patrón que la migración 1) ─────────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('acc_import_batches', 'aibt'), ('acc_import_items', 'aiit'), ('acc_import_proposals', 'aipr'),
      ('acc_import_rules', 'airu'), ('acc_import_layouts', 'ailo'), ('acc_mp_connections', 'ampc')) as x(tbl, prefix)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon, authenticated', r.tbl);
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id in (select public.acc_reader_tenant_ids()))',
      r.prefix || '_select_readers', r.tbl);
  end loop;
end $$;

-- ─── 3. updated_at ───────────────────────────────────────────────────────────
create trigger acc_import_batches_updated_at before update on public.acc_import_batches
  for each row execute function public.set_updated_at();
create trigger acc_import_items_updated_at before update on public.acc_import_items
  for each row execute function public.set_updated_at();
create trigger acc_import_proposals_updated_at before update on public.acc_import_proposals
  for each row execute function public.set_updated_at();
create trigger acc_import_rules_updated_at before update on public.acc_import_rules
  for each row execute function public.set_updated_at();
create trigger acc_import_layouts_updated_at before update on public.acc_import_layouts
  for each row execute function public.set_updated_at();
create trigger acc_mp_connections_updated_at before update on public.acc_mp_connections
  for each row execute function public.set_updated_at();

-- ─── 4. Conteos del lote ─────────────────────────────────────────────────────
-- {items, new, duplicate, ignored, review, posted_items, cancelled, proposals, needs_input, ready, posting,
--  posted, stale, error, skipped}. Lo llaman las RPC de importación después de cada cambio.
create function private.acc_import_refresh_counts(p_tenant uuid, p_batch uuid)
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
           'skipped', count(*) filter (where p.status = 'skipped'))
    into v_counts
    from public.acc_import_proposals p where p.batch_id = p_batch and p.tenant_id = p_tenant;
  update public.acc_import_batches b set counts = v_counts where b.id = p_batch and b.tenant_id = p_tenant;
  return v_counts;
end;
$$;

-- ─── 5. Guardia de las RPC *_service (cron) ──────────────────────────────────
-- Además del EXECUTE solo para service_role: el rol del JWT tiene que ser service_role, y el bar
-- tiene que tener Administración prendida y configurada (lo mismo que exige acc_assert_writer).
create function private.acc_service_check(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenants t
                                      where t.id = p_tenant and t.feature_flags -> 'accounting' = 'true'::jsonb) then
    raise exception 'accounting_not_enabled' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant) then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.acc_import_refresh_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_service_check(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
