-- ============================================================
-- ARCA e importadores · migración 1 de 12 (diseño §6.1–§6.2, WP3)
-- Conexión con ARCA: tablas, RLS, privilegios, índices, triggers y helpers de cifrado
-- ============================================================
-- Qué crea:
--   1. acc_arca_connections: una fila por bar y ambiente (produccion | homologacion) con el
--      certificado (público), el punto de venta, lo que se habilitó para emitir y la última
--      prueba. No guarda secretos.
--   2. acc_secrets: la clave privada de ARCA y los tokens de Mercado Pago, cifrados con
--      pgcrypto (pgp_sym_encrypt, AES-256). La clave de cifrado la manda el servidor en cada
--      llamada (hoy META_TOKEN_KEY, leída por un solo helper TS) y nunca se guarda.
--   3. acc_arca_tickets: el ticket de acceso (TA) del WSAA cifrado, con lease (una sola
--      instancia lo renueva: el login es HTTP y dura más que una transacción) y cooldown
--      según la política del WSAA.
--   4. acc_arca_vouchers: la saga de emisión con CAE (reservado → pidiendo → autorizado →
--      contabilizado). El índice único parcial aavo_in_flight_uq deja UNA emisión viva por
--      (bar, ambiente, punto de venta, tipo): exclusión entre instancias sin lock durante el
--      HTTP. Número, CAE, pedido y client_ref no cambian una vez fijados (trigger).
--   5. acc_arca_padron_cache (constancia de inscripción, por bar) y acc_guide_progress (pasos
--      que la persona marca a mano en las guías).
--   6. Helpers privados (sin EXECUTE para nadie): validar el ambiente y la clave de cifrado,
--      leer instantes ISO, cifrar y descifrar. Los usan las RPC de las migraciones 2 a 12.
--
-- Lectura: aacn, aavo, apad y agpr con la política única `<prefijo>_select_readers` (contadora y
-- dueños con acceso vigente, flag `accounting` prendido), como las 18 acc_* del Sprint 1. Sin
-- privilegios de escritura: se escribe solo por RPC SECURITY DEFINER.
--
-- acc_secrets y acc_arca_tickets: RLS encendida, SIN política y SIN ningún privilegio (tampoco
-- para service_role). Se apartan a propósito del GRANT de CLAUDE.md §5: ese GRANT es para que
-- una tabla SE VEA por la Data API y estas NO se tienen que ver. Solo las tocan las RPC SECURITY
-- DEFINER (dueñas: postgres); descifrar exige la clave de entorno, que solo tiene el servidor.
--
-- Ninguna va a Realtime. Las FK compuestas (x_id, tenant_id) siguen el patrón del Sprint 1, con
-- índices que las cubren (aviso unindexed_foreign_keys del asesor).
-- ============================================================

set local lock_timeout = '5s';

-- ─── 1. Tablas ───────────────────────────────────────────────────────────────

-- acc_arca_connections — conexión con ARCA por bar y ambiente
create table public.acc_arca_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null,                          -- produccion | homologacion
  status text not null default 'draft',               -- draft | key_ready | cert_ready | connected | error | disconnected
  represented_cuit text not null,                     -- la SAS: Auth.Cuit (WSFE) y cuitRepresentada (padrón)
  cert_cuit text not null,                            -- serialNumber del certificado (prod = la SAS; homo = la persona de WSASS)
  alias text not null,                                -- CN del pedido (CSR) = alias en ARCA
  csr_pem text,                                       -- público (no es secreto)
  public_key_sha256 text,                             -- sha256 del SPKI (DER) de la clave guardada
  pending_csr_pem text,                               -- renovación en curso: la clave vigente sigue andando
  pending_public_key_sha256 text,
  certificate_pem text,                               -- público
  cert_serial text,
  cert_issuer text,
  cert_not_before timestamptz,
  cert_not_after timestamptz,
  point_of_sale int,
  allowed_classes text[] not null default '{B}',      -- B | A (común) | A51 (sujeta a retención) | ACBU (pago en CBU informada)
  default_concepto smallint not null default 1,       -- 1 productos · 2 servicios · 3 ambos
  emission_enabled boolean not null default false,
  services jsonb not null default '{}',               -- {"wsfe":"ok","ws_sr_constancia_inscripcion":"arca_not_authorized"}
  last_test_at timestamptz,
  last_test jsonb,
  last_error_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aacn_id_tenant_uq unique (id, tenant_id),
  constraint aacn_one_per_env unique (tenant_id, environment),
  constraint aacn_env check (environment in ('produccion', 'homologacion')),
  constraint aacn_status check (status in ('draft', 'key_ready', 'cert_ready', 'connected', 'error', 'disconnected')),
  constraint aacn_cuits check (public.acc_cuit_is_valid(represented_cuit) and public.acc_cuit_is_valid(cert_cuit)
                               and (environment <> 'produccion' or cert_cuit = represented_cuit)),
  constraint aacn_alias check (alias ~ '^[a-z0-9]{3,30}$'),
  constraint aacn_pem check (
        (csr_pem is null or (csr_pem like '-----BEGIN CERTIFICATE REQUEST-----%' and char_length(csr_pem) <= 4000))
    and (certificate_pem is null or (certificate_pem like '-----BEGIN CERTIFICATE-----%' and char_length(certificate_pem) <= 8000))),
  constraint aacn_key_hash check (
        (public_key_sha256 is null or public_key_sha256 ~ '^[0-9a-f]{64}$')
    and (pending_public_key_sha256 is null or pending_public_key_sha256 ~ '^[0-9a-f]{64}$')
    and (pending_csr_pem is null) = (pending_public_key_sha256 is null)
    and (pending_csr_pem is null or (pending_csr_pem like '-----BEGIN CERTIFICATE REQUEST-----%'
                                     and char_length(pending_csr_pem) <= 4000))),
  constraint aacn_cert_meta check ((cert_serial is null or cert_serial ~ '^[0-9a-f]{1,64}$')
                                   and (cert_issuer is null or char_length(cert_issuer) <= 300)),
  constraint aacn_pos check (point_of_sale is null or point_of_sale between 1 and 99998),
  constraint aacn_classes check (allowed_classes <@ array['A', 'B', 'A51', 'ACBU']::text[] and 'B' = any (allowed_classes)),
  constraint aacn_concepto check (default_concepto in (1, 2, 3)),
  constraint aacn_cert_coherent check (status not in ('cert_ready', 'connected') or
                                       (certificate_pem is not null and cert_not_after is not null and public_key_sha256 is not null)),
  constraint aacn_emission check (not emission_enabled or
                                  (environment = 'produccion' and status = 'connected' and point_of_sale is not null)),
  constraint aacn_services check (jsonb_typeof(services) = 'object' and pg_column_size(services) <= 2048),
  constraint aacn_test check ((last_test_at is null) = (last_test is null)
                              and (last_test is null or pg_column_size(last_test) <= 16384)),
  constraint aacn_error_key check (last_error_key is null or last_error_key ~ '^[a-z][a-z0-9_]{1,59}$')
);
create index aacn_created_by_idx on public.acc_arca_connections (created_by) where created_by is not null;
create index aacn_updated_by_idx on public.acc_arca_connections (updated_by) where updated_by is not null;
comment on table public.acc_arca_connections is
  'Conexión con ARCA por bar y ambiente: certificado (público), punto de venta, clases habilitadas y última prueba. Sin secretos. Se escribe solo por RPC.';

-- acc_secrets — clave privada de ARCA y tokens de Mercado Pago, cifrados. Sin ningún privilegio.
create table public.acc_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  arca_connection_id uuid,
  mp_connection_id uuid,                              -- la FK a acc_mp_connections llega en la migración 7 (la tabla nace ahí)
  name text not null,                                 -- private_key | pending_private_key (renovación) | access_token | refresh_token
  ciphertext text not null,                           -- base64 (una línea) de pgp_sym_encrypt(texto, clave, 'cipher-algo=aes256, compress-algo=0')
  key_version smallint not null default 1,            -- para rotar la clave de cifrado
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asec_owner check ((arca_connection_id is null) <> (mp_connection_id is null)),
  constraint asec_name check (name in ('private_key', 'pending_private_key', 'access_token', 'refresh_token')
                              and (name not in ('private_key', 'pending_private_key') or arca_connection_id is not null)
                              and (name not in ('access_token', 'refresh_token') or mp_connection_id is not null)),
  constraint asec_len check (char_length(ciphertext) between 16 and 20000 and ciphertext ~ '^[A-Za-z0-9+/=]+$'),
  constraint asec_key_version check (key_version between 1 and 100),
  constraint asec_arca_fk foreign key (arca_connection_id, tenant_id)
    references public.acc_arca_connections (id, tenant_id) on delete cascade
);
-- Un secreto por nombre y dueño. tenant_id en el medio no cambia la unicidad (la conexión es de un
-- solo bar) y deja el índice cubriendo la FK compuesta.
create unique index asec_arca_uq on public.acc_secrets (arca_connection_id, tenant_id, name) where arca_connection_id is not null;
create unique index asec_mp_uq on public.acc_secrets (mp_connection_id, tenant_id, name) where mp_connection_id is not null;
create index asec_tenant_idx on public.acc_secrets (tenant_id);
comment on table public.acc_secrets is
  'Secretos cifrados (clave privada de ARCA, tokens de Mercado Pago). RLS sin política y sin privilegios: solo RPC SECURITY DEFINER, y descifrar exige la clave del servidor.';

-- acc_arca_tickets — ticket de acceso (TA) del WSAA, cifrado, con lease y cooldown. Sin ningún privilegio.
create table public.acc_arca_tickets (
  connection_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service text not null,                              -- wsfe | ws_sr_constancia_inscripcion
  token_enc text,
  sign_enc text,
  generation_time timestamptz,
  expiration_time timestamptz,
  lease_id uuid,                                      -- quién está pidiendo un TA nuevo (una sola instancia)
  lease_until timestamptz,
  cooldown_until timestamptz,                         -- no pedir otro TA antes de esto (política del WSAA)
  cooldown_manual boolean not null default false,     -- hasta que la persona cambie algo y vuelva a probar
  last_error_key text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (connection_id, service),
  constraint atkt_conn_fk foreign key (connection_id, tenant_id)
    references public.acc_arca_connections (id, tenant_id) on delete cascade,
  constraint atkt_service check (service in ('wsfe', 'ws_sr_constancia_inscripcion')),
  constraint atkt_ta_coherent check ((token_enc is null) = (sign_enc is null) and (token_enc is null) = (expiration_time is null)),
  constraint atkt_lease_coherent check ((lease_id is null) = (lease_until is null)),
  constraint atkt_enc_len check (coalesce(char_length(token_enc), 0) <= 20000 and coalesce(char_length(sign_enc), 0) <= 4000),
  constraint atkt_error_key check (last_error_key is null or last_error_key ~ '^[a-z][a-z0-9_]{1,59}$')
);
create index atkt_conn_idx on public.acc_arca_tickets (connection_id, tenant_id);
create index atkt_tenant_idx on public.acc_arca_tickets (tenant_id);
comment on table public.acc_arca_tickets is
  'Ticket de acceso del WSAA por conexión y servicio (cifrado), con lease y cooldown. RLS sin política y sin privilegios: solo RPC SECURITY DEFINER.';

-- acc_arca_vouchers — comprobantes emitidos por WSFE (la saga de emisión). Legible para lectores: no tiene secretos.
create table public.acc_arca_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  environment text not null,
  point_of_sale int not null,
  cbte_tipo smallint not null,                        -- 1 2 3 (A) · 6 7 8 (B)
  number bigint,                                      -- se fija al pedir el CAE
  status text not null default 'reserved',
  client_ref uuid not null default gen_random_uuid(), -- idempotencia del asiento (acc_post_bundle)
  form jsonb not null,                                -- valores del formulario (para «Cargarla ahora»)
  request jsonb,                                      -- FECAEDetRequest enviado, SIN Auth
  request_sha256 text,
  cae text,
  cae_due date,
  result text,                                        -- Resultado de WSFE: A | R | P
  fch_proceso timestamptz,
  observations jsonb not null default '[]',
  errors jsonb not null default '[]',
  events jsonb not null default '[]',
  document_id uuid,
  related_voucher_id uuid,                            -- NC/ND → la factura que corrigen
  total_cents bigint not null,
  issue_date date,
  reason text,                                        -- abandoned/failed/needs_reconcile: por qué
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aavo_id_tenant_uq unique (id, tenant_id),
  constraint aavo_conn_fk foreign key (connection_id, tenant_id) references public.acc_arca_connections (id, tenant_id),
  constraint aavo_doc_fk foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint aavo_related_fk foreign key (related_voucher_id, tenant_id) references public.acc_arca_vouchers (id, tenant_id),
  constraint aavo_env check (environment in ('produccion', 'homologacion')),
  constraint aavo_tipo check (cbte_tipo in (1, 2, 3, 6, 7, 8)),
  constraint aavo_status check (status in ('reserved', 'requesting', 'needs_reconcile', 'authorized', 'posted',
                                           'rejected', 'failed', 'abandoned')),
  constraint aavo_pos check (point_of_sale between 1 and 99998),
  constraint aavo_number check (number is null or number between 1 and 99999999),
  constraint aavo_cae check (cae is null or cae ~ '^[0-9]{14}$'),
  constraint aavo_cae_coherent check ((status in ('authorized', 'posted')) = (cae is not null) and (cae is null) = (cae_due is null)),
  constraint aavo_number_coherent check (status in ('reserved', 'abandoned')
                                         or (number is not null and request is not null and request_sha256 is not null)),
  constraint aavo_posted check ((status = 'posted') = (document_id is not null)),
  constraint aavo_homo_no_books check (environment = 'produccion' or document_id is null),
  constraint aavo_total check (total_cents between 0 and 1000000000000000),
  constraint aavo_result check (result is null or result in ('A', 'R', 'P')),
  constraint aavo_request check (request_sha256 is null or request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint aavo_sizes check (jsonb_typeof(form) = 'object' and pg_column_size(form) <= 32768
                               and (request is null or (jsonb_typeof(request) = 'object' and pg_column_size(request) <= 16384))),
  constraint aavo_msgs check (jsonb_typeof(observations) = 'array' and jsonb_typeof(errors) = 'array'
                              and jsonb_typeof(events) = 'array'
                              and pg_column_size(observations) + pg_column_size(errors) + pg_column_size(events) <= 16384),
  constraint aavo_reason_len check (reason is null or char_length(reason) <= 300),
  constraint aavo_name_len check (char_length(created_by_name) between 1 and 80)
);
-- Una emisión viva por (bar, ambiente, PV, tipo): exclusión entre instancias sin lock durante el HTTP.
create unique index aavo_in_flight_uq on public.acc_arca_vouchers (tenant_id, environment, point_of_sale, cbte_tipo)
  where status in ('reserved', 'requesting', 'needs_reconcile');
create unique index aavo_number_uq on public.acc_arca_vouchers (tenant_id, environment, point_of_sale, cbte_tipo, number)
  where status in ('requesting', 'needs_reconcile', 'authorized', 'posted');
-- Diseño: (document_id). Ensanchado con tenant_id para cubrir aavo_doc_fk (misma unicidad: el id del comprobante es de un solo bar).
create unique index aavo_document_uq on public.acc_arca_vouchers (document_id, tenant_id) where document_id is not null;
create index aavo_conn_idx on public.acc_arca_vouchers (connection_id, tenant_id);
create index aavo_related_idx on public.acc_arca_vouchers (related_voucher_id, tenant_id) where related_voucher_id is not null;
create index aavo_attention_idx on public.acc_arca_vouchers (tenant_id) where status in ('needs_reconcile', 'authorized');
comment on table public.acc_arca_vouchers is
  'Comprobantes emitidos con CAE por la plataforma (saga: reserved → requesting → authorized → posted). Número, CAE, pedido y client_ref inmutables una vez fijados.';

-- acc_arca_padron_cache — constancia de inscripción (padrón) por bar
create table public.acc_arca_padron_cache (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  environment text not null,
  cuit text not null,
  found boolean not null,
  data jsonb not null,             -- {name, person_kind, active, iva_condition, condicion_iva_receptor_id, monotributo_category, address, locality, province, activity}
  fetched_at timestamptz not null default now(),
  primary key (tenant_id, environment, cuit),
  constraint apad_env check (environment in ('produccion', 'homologacion')),
  constraint apad_cuit check (public.acc_cuit_is_valid(cuit)),
  constraint apad_data check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096)
);
comment on table public.acc_arca_padron_cache is
  'Caché de la constancia de inscripción (padrón de ARCA) por bar y ambiente. La consulta es de escritores; la lectura, de lectores.';

-- acc_guide_progress — pasos de las guías marcados a mano
create table public.acc_guide_progress (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guide text not null,                               -- arca | arranque
  step text not null,
  done_at timestamptz not null default now(),
  done_by uuid references auth.users(id) on delete set null,
  done_by_name text not null,
  primary key (tenant_id, guide, step),
  constraint agpr_guide check (guide in ('arca', 'arranque')),
  constraint agpr_step check (step ~ '^[a-z0-9_]{2,40}$'),
  constraint agpr_name_len check (char_length(done_by_name) between 1 and 80)
);
create index agpr_done_by_idx on public.acc_guide_progress (done_by) where done_by is not null;
comment on table public.acc_guide_progress is
  'Pasos de las guías «Conectar ARCA» y «Cómo arrancar» que la persona marcó como hechos.';

-- ─── 2. RLS y privilegios ────────────────────────────────────────────────────
-- Lectura: una sola política permisiva de SELECT (dueños con acceso vigente + contadora, flag prendido).
-- Sin INSERT/UPDATE/DELETE/TRUNCATE para authenticated aunque alguien agregue una política por error;
-- nada para anon (el default privileges del proyecto le da SELECT e INSERT a cada tabla nueva).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('acc_arca_connections', 'aacn'), ('acc_arca_vouchers', 'aavo'),
      ('acc_arca_padron_cache', 'apad'), ('acc_guide_progress', 'agpr')) as x(tbl, prefix)
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

-- Secretos: RLS encendida, sin política y sin privilegios para nadie (tampoco service_role: las
-- RPC *_service son SECURITY DEFINER y no los necesitan; la cascada del bar corre como dueña).
do $$
declare
  t text;
begin
  foreach t in array array['acc_secrets', 'acc_arca_tickets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, service_role', t);
  end loop;
end $$;

-- ─── 3. Triggers ─────────────────────────────────────────────────────────────
-- Vouchers: número, CAE, vencimiento del CAE, pedido, documento y client_ref no cambian una vez
-- fijados; los estados finales (posted, rejected, failed, abandoned) no cambian más. DELETE
-- prohibido salvo la cascada del bar (mismo escape que acc_tg_accounts_biu). Ata también a
-- service_role.
create function private.acc_tg_arca_vouchers_bu()
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
create trigger acc_arca_vouchers_20_bu
  before update or delete on public.acc_arca_vouchers
  for each row execute function private.acc_tg_arca_vouchers_bu();

-- updated_at (corre último entre los BEFORE: su nombre no lleva número)
create trigger acc_arca_connections_updated_at before update on public.acc_arca_connections
  for each row execute function public.set_updated_at();
create trigger acc_secrets_updated_at before update on public.acc_secrets
  for each row execute function public.set_updated_at();
create trigger acc_arca_tickets_updated_at before update on public.acc_arca_tickets
  for each row execute function public.set_updated_at();
create trigger acc_arca_vouchers_updated_at before update on public.acc_arca_vouchers
  for each row execute function public.set_updated_at();

-- ─── 4. Helpers privados (los usan las RPC de las migraciones 2 a 12) ─────────
-- Ambiente válido o invalid_payload (detail = environment).
create function private.acc_arca_check_env(p_environment text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_environment is null or p_environment not in ('produccion', 'homologacion') then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'environment';
  end if;
end;
$$;

-- Instante ISO 8601 con zona explícita (el `toISOString()` de JS) o null: sin zona dependería del
-- TimeZone de la sesión. Mismo criterio que acc_to_date: null en vez de 22007.
create function private.acc_to_ts(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p is null
     or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    return null;
  end if;
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

-- La clave de cifrado viaja en cada llamada y nunca se guarda. Mínimo 16 caracteres: una variable
-- de entorno vacía o mal cargada no cifra nada.
create function private.acc_secret_key_check(p_key text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key is null or char_length(p_key) < 16 then
    raise exception 'invalid_payload' using errcode = 'P0001', detail = 'secret_key';
  end if;
end;
$$;

-- Mismo formato que encrypt_meta_token (AES-256, sin compresión), en base64 de una línea.
create function private.acc_encrypt(p_plain text, p_key text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform private.acc_secret_key_check(p_key);
  return translate(encode(extensions.pgp_sym_encrypt(p_plain, p_key, 'cipher-algo=aes256, compress-algo=0'), 'base64'),
                   E'\n', '');
end;
$$;

-- Clave equivocada o dato roto (39000 de pgcrypto) → secret_unreadable: cambió la clave del
-- servidor; se arregla desconectando y volviendo a conectar.
create function private.acc_decrypt(p_cipher text, p_key text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform private.acc_secret_key_check(p_key);
  return extensions.pgp_sym_decrypt(decode(p_cipher, 'base64'), p_key);
exception when external_routine_invocation_exception then
  raise exception 'secret_unreadable' using errcode = 'P0001';
end;
$$;

comment on function private.acc_encrypt(text, text) is
  'Cifra con pgp_sym_encrypt (AES-256, sin compresión) y devuelve base64 de una línea. La clave la manda el servidor.';
comment on function private.acc_decrypt(text, text) is
  'Descifra lo de private.acc_encrypt. Clave equivocada → secret_unreadable.';

-- ─── 5. Grants de las funciones ──────────────────────────────────────────────
revoke all on function private.acc_tg_arca_vouchers_bu() from public, anon, authenticated;
revoke all on function private.acc_arca_check_env(text) from public, anon, authenticated;
revoke all on function private.acc_to_ts(text) from public, anon, authenticated;
revoke all on function private.acc_secret_key_check(text) from public, anon, authenticated;
revoke all on function private.acc_encrypt(text, text) from public, anon, authenticated;
revoke all on function private.acc_decrypt(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
