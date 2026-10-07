-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #5
-- Tablas del núcleo contable, helpers de cálculo y triggers (spec §A.2–§A.5, §C.1)
-- ============================================================
-- Qué crea, en orden:
--   1. Las 17 tablas restantes de §A.2 (acc_access ya existe: migración #3),
--      en el orden de creación de la spec, con sus CHECK, FK compuestas
--      `(x_id, tenant_id) → acc_y (id, tenant_id)` sin ON DELETE (NO ACTION:
--      borrar algo con plata falla con 23503; borrar el bar entero cascadea
--      porque NO ACTION se chequea al final de la sentencia) e índices.
--   2. Las FK diferidas por orden de creación (§A.3).
--   3. Índices que cubren cada FK (aviso unindexed_foreign_keys del asesor;
--      mismo criterio que perf_fk_indexes). Donde la spec ya tenía un índice
--      que empieza por la columna de la FK, se lo ensancha a (x_id, tenant_id)
--      o se reordenan sus columnas sin perder las búsquedas para las que estaba.
--   4. RLS ENCENDIDA Y SIN POLÍTICAS en las 17 (cerrado: nadie lee por
--      PostgREST hasta la #6, que crea los helpers de lectura y las políticas).
--      Solo SELECT para authenticated; nada para anon. Se aparta a propósito
--      del `grant select, insert, update, delete` de CLAUDE.md §5: estas tablas
--      se escriben SOLO por RPC SECURITY DEFINER (patrón commission_ledger).
--   5. Helpers de cálculo INVOKER (acc_open_amount, acc_account_balance,
--      acc_entry_number_base): no filtran nada, corren bajo la RLS de quien llama.
--   6. Todos los triggers de §A.5: updated_at, plan de cuentas, cajas, guardias
--      de período (FOR SHARE), relleno y chequeo de líneas, inmutabilidad (con
--      el escape de cascada del bar y el de `acc.reset`), cuadre diferido y
--      comprobante↔asiento diferido. Atan también a service_role.
--
-- Endurecimientos sobre la spec (documentados en db-api.md):
--   · apt_tax_id_shape, adl_net_shape y adoc_voucher_kind envueltos en
--     coalesce(…, false): un NULL ya no deja pasar un CUIT/CUIL vacío, un neto
--     sin base ni una NC/gasto/venta sin tipo de comprobante.
--   · acc_document_has_entry compara contra el estado ACTUAL del comprobante.
--   · La guardia de asientos exige además: ejercicio = el del período, el
--     comprobante en el mismo período y fecha, y tipo de asiento coherente con
--     el tipo de comprobante. La de comprobantes fiscales exige que el mes del
--     libro sea el de la fecha contable. La de líneas exige que el renglón
--     proyectado sea del mismo comprobante.
--   · acc_settings_updated_at no se dispara cuando solo cambia doc_seq (el
--     contador de comprobantes no debe volver «stale» el formulario de Ajustes).
--
-- Ninguna tabla acc_* va a la publicación de Realtime (es plata).
-- ============================================================

-- Toca acc_access (trigger nuevo): si estuviera tomada, fallar rápido.
set local lock_timeout = '5s';

-- ─── 1. Tablas ───────────────────────────────────────────────────────────────

-- acc_settings — datos de la SAS y parámetros (una fila por bar)
create table public.acc_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  legal_name text not null,
  cuit text,                                         -- opcional al configurar; obligatorio para libros IVA y exportes fiscales
  iva_condition text not null default 'responsable_inscripto',
  iibb_regime text not null default 'local',
  iibb_number text,
  iibb_jurisdiction_code smallint not null default 904,      -- COMARB: 904 = Córdoba
  activity_start_date date,
  fiscal_address text,
  books_start_date date not null,                    -- día del asiento de apertura; no cambia con comprobantes cargados
  fiscal_year_end_month smallint not null default 12,
  iva_settlement_mode text not null default 'on_close',
  iva_due_day smallint not null default 20,
  iibb_due_day smallint not null default 15,
  vat_tolerance_cents smallint not null default 1,   -- ajuste silencioso del IVA por alícuota (± centavos)
  bank_tax_credit_computable_bp int not null default 3300,   -- Ley 25.413 sobre créditos: % computable en Ganancias
  bank_tax_debit_computable_bp int not null default 3300,    -- Ley 25.413 sobre débitos (Dec. 409/2018)
  uninvoiced_sales_mode text not null default 'separate_accounts',
  closed_period_void_iva_mode text not null default 'adjustment_only',
  due_soon_days smallint not null default 7,
  opening_status text not null default 'pending',
  doc_seq bigint not null default 0,                 -- referencia interna correlativa (#124), no fiscal
  setup_completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ast_legal_name_len check (char_length(btrim(legal_name)) between 2 and 160),
  constraint ast_cuit_valid check (cuit is null or public.acc_cuit_is_valid(cuit)),
  constraint ast_iva_condition check (iva_condition in ('responsable_inscripto', 'monotributo', 'exento')),
  constraint ast_iibb_regime check (iibb_regime in ('local', 'convenio_multilateral', 'exento', 'no_inscripto')),
  constraint ast_iibb_number_len check (iibb_number is null or char_length(iibb_number) <= 30),
  constraint ast_jurisdiction check (iibb_jurisdiction_code between 901 and 924),
  constraint ast_address_len check (fiscal_address is null or char_length(fiscal_address) <= 200),
  constraint ast_books_after_activity check (activity_start_date is null or books_start_date >= activity_start_date),
  constraint ast_fy_end_month check (fiscal_year_end_month between 1 and 12),
  constraint ast_iva_mode check (iva_settlement_mode in ('on_close', 'manual')),
  constraint ast_due_days check (iva_due_day between 1 and 28 and iibb_due_day between 1 and 28),
  constraint ast_vat_tolerance check (vat_tolerance_cents between 0 and 100),
  constraint ast_bank_tax_bp check (bank_tax_credit_computable_bp between 0 and 10000
                                    and bank_tax_debit_computable_bp between 0 and 10000),
  constraint ast_uninvoiced_mode check (uninvoiced_sales_mode in ('separate_accounts', 'single_account')),
  constraint ast_void_iva_mode check (closed_period_void_iva_mode in ('adjustment_only', 'negative_row')),
  constraint ast_due_soon check (due_soon_days between 1 and 30),
  constraint ast_opening_status check (opening_status in ('pending', 'posted', 'skipped')),
  constraint ast_doc_seq check (doc_seq >= 0)
);
comment on table public.acc_settings is
  'Datos fiscales de la SAS y parámetros de Administración. Una fila por bar. Se escribe solo por RPC. No vive en tenants.settings porque ese jsonb tiene tres escritores sin lock.';

-- acc_fiscal_years — ejercicios
create table public.acc_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  opening_number_reserved boolean not null default true,   -- N° 1 = apertura (false si el primero arrancó en cero)
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  created_at timestamptz not null default now(),
  constraint afy_id_tenant_uq unique (id, tenant_id),
  constraint afy_status check (status in ('open', 'closed')),
  constraint afy_range check (end_date > start_date and end_date - start_date <= 731),
  constraint afy_closed_coherent check ((status = 'closed') = (closed_at is not null)),
  constraint afy_no_overlap exclude using gist (tenant_id with =, daterange(start_date, end_date, '[]') with &&)
);
comment on table public.acc_fiscal_years is
  'Ejercicios contables del bar (contiguos, sin superposición). Los crea private.acc_ensure_fiscal_year con sus períodos.';

-- acc_periods — meses y períodos especiales del ejercicio
create table public.acc_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fiscal_year_id uuid not null,
  kind text not null default 'month',              -- month | fy_adjustments (último día) | fy_opening (primer día, ejercicios 2+)
  month date not null,                              -- primer día del mes que contiene al período
  starts_on date not null,                          -- mes: = month (o books_start_date en el primero)
  ends_on date not null,
  status text not null default 'open',
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  number_from int,                                  -- numeración congelada al cerrar (null si no tuvo asientos)
  number_to int,
  entries_count int,                                -- foto al cerrar
  debit_total_cents bigint,
  snapshot_hash text,                               -- sha256 de asientos + líneas del período (C.5)
  iva_settlement_document_id uuid,                  -- liquidación de IVA del mes (A.3)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aper_id_tenant_uq unique (id, tenant_id),
  constraint aper_kind check (kind in ('month', 'fy_adjustments', 'fy_opening')),
  constraint aper_status check (status in ('open', 'closed')),
  constraint aper_first_day check (extract(day from month) = 1),
  constraint aper_one_per_kind_month unique (tenant_id, kind, month),
  constraint aper_fy_same_tenant foreign key (fiscal_year_id, tenant_id) references public.acc_fiscal_years (id, tenant_id),
  constraint aper_range check (starts_on <= ends_on and starts_on >= month
                               and ends_on <= (month + interval '1 month' - interval '1 day')::date),
  constraint aper_month_shape check (kind <> 'month' or ends_on = (month + interval '1 month' - interval '1 day')::date),
  constraint aper_special_shape check (kind = 'month' or starts_on = ends_on),
  constraint aper_closed_coherent check ((status = 'closed') = (closed_at is not null and snapshot_hash is not null
                                         and entries_count is not null and debit_total_cents is not null)),
  constraint aper_hash_shape check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint aper_numbers check ((number_from is null) = (number_to is null) and (number_from is null or number_from <= number_to))
);
create unique index aper_one_special_per_fy on public.acc_periods (fiscal_year_id, kind) where kind <> 'month';
create index aper_tenant_dates_idx on public.acc_periods (tenant_id, starts_on, kind);
comment on table public.acc_periods is
  'Períodos del ejercicio: meses y los especiales de ajustes de cierre y apertura. Abierto/cerrado; al cerrar se congelan numeración y foto (snapshot_hash).';
comment on column public.acc_periods.kind is
  'month: mes calendario. fy_adjustments: ajustes de cierre del ejercicio (fecha = último día; ajustes de la contadora, refundición y cierre espejo). fy_opening: apertura espejo del ejercicio (fecha = primer día, N° 1). Ver C.5.';

-- acc_period_events — historia de cierres y reaperturas (solo inserción)
create table public.acc_period_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_id uuid,
  fiscal_year_id uuid,
  action text not null,
  reason text,
  actor_id uuid not null,
  actor_name text not null,
  payload jsonb not null default '{}',     -- {number_from, number_to, entries_count, debit_total_cents, snapshot_hash, iva_settlement_document_id, warnings_ack}
  created_at timestamptz not null default now(),
  constraint apev_id_tenant_uq unique (id, tenant_id),
  constraint apev_action check (action in ('closed', 'reopened', 'fy_closed', 'fy_reopened')),
  constraint apev_reason_len check (reason is null or char_length(reason) <= 300),
  constraint apev_reopen_reason check (action not in ('reopened', 'fy_reopened') or char_length(btrim(reason)) >= 5),
  constraint apev_target check (period_id is not null or fiscal_year_id is not null),
  constraint apev_period_same_tenant foreign key (period_id, tenant_id) references public.acc_periods (id, tenant_id),
  constraint apev_fy_same_tenant foreign key (fiscal_year_id, tenant_id) references public.acc_fiscal_years (id, tenant_id)
);
create index apev_tenant_idx on public.acc_period_events (tenant_id, created_at desc);
comment on table public.acc_period_events is
  'Historia (solo inserción) de cierres y reaperturas de meses y ejercicios, con motivo y foto.';

-- acc_accounts — plan de cuentas
create table public.acc_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  type public.acc_account_type not null,             -- lo hereda del padre (trigger); en raíces, explícito
  normal_side public.acc_side not null,              -- regularizadoras: contrario al de su tipo
  parent_id uuid,
  level smallint not null default 1,                 -- lo calcula el trigger
  path uuid[] not null default '{}',                 -- ancestros raíz→padre (trigger): subtotales sin ltree
  postable boolean not null default true,            -- imputable (hoja)
  active boolean not null default true,
  system_key text,                                   -- clave estable del motor (renombrar no rompe nada)
  requires_party boolean not null default false,     -- cuenta de control: toda línea lleva partícipe y es partida
  is_treasury boolean not null default false,        -- la usa una caja (1:1)
  purchase_selectable boolean not null default false,-- aparece en «¿En qué?» y en la imputación de compras
  manual_selectable boolean not null default true,   -- aparece en asientos manuales
  description text,                                  -- «Para qué se usa» (tooltip del selector)
  sort smallint not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aac_id_tenant_uq unique (id, tenant_id),
  constraint aac_code_uq unique (tenant_id, code),
  constraint aac_code_fmt check (code ~ '^[0-9]+(\.[0-9]+)*$' and char_length(code) <= 24),
  constraint aac_name_len check (char_length(btrim(name)) between 2 and 80),
  constraint aac_level check (level between 1 and 8),
  constraint aac_system_key_fmt check (system_key is null or system_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint aac_description_len check (description is null or char_length(description) <= 280),
  constraint aac_root_not_postable check (parent_id is not null or not postable),
  constraint aac_party_only_postable check (not requires_party or postable),
  constraint aac_treasury_postable check (not is_treasury or postable),
  constraint aac_party_xor_treasury check (not (requires_party and is_treasury)),
  constraint aac_parent_same_tenant foreign key (parent_id, tenant_id) references public.acc_accounts (id, tenant_id)
);
create unique index aac_system_key_uq on public.acc_accounts (tenant_id, system_key) where system_key is not null;
-- Spec: (tenant_id, parent_id). Reordenado para cubrir la FK aac_parent_same_tenant; sirve igual para
-- «hijas de X» (parent_id = X) y para las raíces del bar (parent_id is null and tenant_id = T).
create index aac_parent_idx on public.acc_accounts (parent_id, tenant_id);
comment on table public.acc_accounts is
  'Plan de cuentas del bar. Código editable (prefijo del padre), system_key estable para el motor; el trigger calcula nivel y camino y hereda el tipo.';

-- acc_parties — proveedores, clientes, tarjetas, billeteras, plataformas, organismos
create table public.acc_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  name text not null,                                -- razón social
  trade_name text,                                   -- nombre de fantasía
  tax_id_type text not null default 'none',
  tax_id text,
  iva_condition text not null default 'sin_datos',
  email text,
  phone text,
  address text,
  payment_term_days smallint not null default 0,     -- proveedor: «le pagás a N días»; cliente: «te paga a N días»
  default_account_id uuid,                           -- imputación habitual
  default_voucher_type text,
  payable_account_id uuid not null,                  -- control cuando le debemos
  receivable_account_id uuid not null,               -- control cuando nos debe
  commission_vat_mode text not null default 'none',  -- tarjetas/billeteras/plataformas: per_settlement | monthly_invoice | none
  commission_bp int,                                 -- precargas (estimadas, siempre editables)
  iibb_withholding_bp int,
  vat_withholding_bp int,
  income_tax_withholding_bp int,
  sircupa_bp int,                                    -- billeteras: recaudación IIBB sobre acreditaciones
  notes text,
  active boolean not null default true,
  system_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apt_id_tenant_uq unique (id, tenant_id),
  constraint apt_kind check (kind in ('supplier', 'customer', 'card_processor', 'payment_wallet', 'delivery_platform',
                                      'bank', 'tax_agency', 'payroll', 'partner', 'other')),
  constraint apt_name_len check (char_length(btrim(name)) between 2 and 120),
  constraint apt_trade_len check (trade_name is null or char_length(trade_name) <= 120),
  constraint apt_tax_id_type check (tax_id_type in ('cuit', 'cuil', 'dni', 'none')),
  -- Endurecida con coalesce: sin él, un CUIT/CUIL o DNI NULL hacía NULL toda la expresión y el CHECK pasaba.
  constraint apt_tax_id_shape check (coalesce(
       (tax_id_type = 'none' and tax_id is null)
    or (tax_id_type in ('cuit', 'cuil') and public.acc_cuit_is_valid(tax_id))
    or (tax_id_type = 'dni' and tax_id ~ '^[0-9]{7,8}$'), false)),
  constraint apt_iva_condition check (iva_condition in ('responsable_inscripto', 'monotributo', 'exento',
                                                        'consumidor_final', 'no_alcanzado', 'sin_datos')),
  constraint apt_email check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint apt_phone_len check (phone is null or char_length(phone) <= 30),
  constraint apt_address_len check (address is null or char_length(address) <= 200),
  constraint apt_terms check (payment_term_days between 0 and 365),
  constraint apt_default_voucher check (default_voucher_type is null or default_voucher_type ~ '^[a-z_]{4,30}$'),
  constraint apt_commission_mode check (commission_vat_mode in ('per_settlement', 'monthly_invoice', 'none')),
  constraint apt_rates check (coalesce(commission_bp, 0) between 0 and 10000 and coalesce(iibb_withholding_bp, 0) between 0 and 10000
                              and coalesce(vat_withholding_bp, 0) between 0 and 10000 and coalesce(income_tax_withholding_bp, 0) between 0 and 10000
                              and coalesce(sircupa_bp, 0) between 0 and 10000),
  constraint apt_notes_len check (notes is null or char_length(notes) <= 500),
  constraint apt_system_key_fmt check (system_key is null or system_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint apt_default_account_same_tenant foreign key (default_account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint apt_payable_same_tenant foreign key (payable_account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint apt_receivable_same_tenant foreign key (receivable_account_id, tenant_id) references public.acc_accounts (id, tenant_id)
);
create unique index apt_tax_id_uq on public.acc_parties (tenant_id, tax_id) where tax_id is not null and active;
create unique index apt_system_key_uq on public.acc_parties (tenant_id, system_key) where system_key is not null;
create index apt_tenant_kind_idx on public.acc_parties (tenant_id, kind, active);
create index apt_name_trgm_idx on public.acc_parties using gin (name public.gin_trgm_ops);      -- pg_trgm vive en public
create index apt_trade_trgm_idx on public.acc_parties using gin (trade_name public.gin_trgm_ops);
comment on table public.acc_parties is
  'Partícipes del bar: proveedores, clientes, procesadores de tarjeta, billeteras, plataformas, bancos y organismos, con sus cuentas de control.';

-- acc_treasury_accounts — cajas, bancos, billeteras y tarjeta de la empresa
create table public.acc_treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,                          -- su cuenta contable (1:1; la crea la RPC)
  name text not null,
  kind text not null,                                -- cash | bank | wallet | credit_card | other
  bank_party_id uuid,                                -- banco o billetera como partícipe (IVA de comisiones, acreditaciones)
  bank_name text,
  cbu_cvu text,
  alias text,
  account_number text,
  allow_negative boolean not null default false,     -- false: avisa si el saldo quedaría negativo
  last_checked_on date,                              -- último «Ajustar saldo» (con o sin diferencia)
  last_checked_by uuid,
  sort smallint not null default 0,
  active boolean not null default true,
  system_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atr_id_tenant_uq unique (id, tenant_id),
  -- Spec: unique (tenant_id, account_id). Mismas columnas en otro orden (misma unicidad) para cubrir la FK.
  constraint atr_one_per_account unique (account_id, tenant_id),
  constraint atr_name_uq unique (tenant_id, name),
  constraint atr_kind check (kind in ('cash', 'bank', 'wallet', 'credit_card', 'other')),
  constraint atr_name_len check (char_length(btrim(name)) between 2 and 60),
  constraint atr_bank_name_len check (bank_name is null or char_length(bank_name) <= 80),
  constraint atr_cbu check (cbu_cvu is null or cbu_cvu ~ '^[0-9]{22}$'),
  constraint atr_alias check (alias is null or alias ~ '^[A-Za-z0-9.\-]{6,20}$'),
  constraint atr_account_number_len check (account_number is null or char_length(account_number) <= 40),
  constraint atr_system_key_fmt check (system_key is null or system_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint atr_account_same_tenant foreign key (account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint atr_bank_party_same_tenant foreign key (bank_party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
create unique index atr_system_key_uq on public.acc_treasury_accounts (tenant_id, system_key) where system_key is not null;
comment on table public.acc_treasury_accounts is
  'Cajas, bancos, billeteras y tarjeta de la empresa, cada una con su cuenta contable (activo; pasivo si es tarjeta).';

-- acc_sales_points — puntos de venta de la SAS
create table public.acc_sales_points (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number int not null,
  label text not null,
  default_channel text not null default 'salon',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asp_id_tenant_uq unique (id, tenant_id),
  constraint asp_number_uq unique (tenant_id, number),
  constraint asp_number_range check (number between 1 and 99998),
  constraint asp_label_len check (char_length(btrim(label)) between 1 and 60),
  constraint asp_channel check (default_channel in ('salon', 'delivery', 'events'))
);
comment on table public.acc_sales_points is
  'Puntos de venta fiscales de la SAS y su canal por defecto.';

-- acc_sales_methods — medios de cobro del cierre del día y su destino contable
create table public.acc_sales_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- treasury: entra entero a una caja (efectivo).
  -- settled_now: entra a una billetera con descuentos (QR y transferencias a Mercado Pago): queda a cobrar
  --   a la billetera hasta registrar la acreditación (C.3 E17); treasury_account_id es la caja destino.
  -- receivable: queda a cobrar al procesador o plataforma (débito, crédito, delivery).
  -- customer_account: cuenta corriente de un cliente que se elige en el cierre.
  -- advance: se paga con una seña cobrada antes (apagado: señas fuera del sprint, decisión 5).
  kind text not null,
  channel text not null,
  treasury_account_id uuid,
  party_id uuid,
  settlement_days smallint not null default 0,       -- vencimiento de la partida a cobrar
  sort smallint not null default 0,                  -- orden del cierre (el de Thinkeon)
  active boolean not null default true,
  system_key text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asm_id_tenant_uq unique (id, tenant_id),
  constraint asm_name_uq unique (tenant_id, name),
  constraint asm_kind check (kind in ('treasury', 'settled_now', 'receivable', 'customer_account', 'advance')),
  constraint asm_channel check (channel in ('salon', 'delivery', 'events')),
  constraint asm_name_len check (char_length(btrim(name)) between 2 and 40),
  constraint asm_settlement_days check (settlement_days between 0 and 120),
  constraint asm_system_key_fmt check (system_key is null or system_key ~ '^[a-z][a-z0-9_]{2,40}$'),
  constraint asm_kind_targets check (
       (kind = 'treasury'         and treasury_account_id is not null and party_id is null)
    or (kind = 'settled_now'      and treasury_account_id is not null and party_id is not null)
    or (kind = 'receivable'       and treasury_account_id is null     and party_id is not null)
    or (kind = 'customer_account' and treasury_account_id is null     and party_id is null)
    or (kind = 'advance'          and treasury_account_id is null     and party_id is not null)),
  constraint asm_treasury_same_tenant foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id),
  constraint asm_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
create unique index asm_system_key_uq on public.acc_sales_methods (tenant_id, system_key) where system_key is not null;
comment on table public.acc_sales_methods is
  'Medios de cobro del cierre del día (orden de Thinkeon) y adónde va cada uno: caja, billetera a acreditar, procesador o plataforma, cuenta corriente o seña.';

-- acc_recurring_expenses — gastos fijos con vencimiento (recordatorios, no devengan)
create table public.acc_recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,                                 -- «Alquiler», «Luz (EPEC)»
  party_id uuid,
  account_id uuid not null,
  voucher_type text,
  vat_rate_bp int,
  amount_cents bigint,                                -- null = monto variable (se completa al cargar)
  frequency text not null default 'monthly',          -- monthly | bimonthly | quarterly | yearly
  due_day smallint not null,                          -- 1..31 (se ajusta al último día si el mes es corto)
  next_due_date date not null,
  remind_days_before smallint not null default 5,
  treasury_account_id uuid,                           -- medio habitual de pago
  active boolean not null default true,
  last_document_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arx_id_tenant_uq unique (id, tenant_id),
  constraint arx_name_uq unique (tenant_id, name),
  constraint arx_name_len check (char_length(btrim(name)) between 2 and 80),
  constraint arx_amount check (amount_cents is null or amount_cents > 0),
  constraint arx_vat_rate check (vat_rate_bp is null or vat_rate_bp in (0, 250, 500, 1050, 2100, 2700)),
  constraint arx_frequency check (frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')),
  constraint arx_due_day check (due_day between 1 and 31),
  constraint arx_remind check (remind_days_before between 0 and 30),
  constraint arx_notes_len check (notes is null or char_length(notes) <= 280),
  constraint arx_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id),
  constraint arx_account_same_tenant foreign key (account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint arx_treasury_same_tenant foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id)
);
create index arx_due_idx on public.acc_recurring_expenses (tenant_id, next_due_date) where active;
comment on table public.acc_recurring_expenses is
  'Gastos fijos con vencimiento (recordatorios: no devengan nada hasta que se carga el comprobante).';

-- acc_bundles — idempotencia y agrupación de lo que se guarda junto
create table public.acc_bundles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_ref uuid not null,                           -- lo genera el formulario al abrirse
  operation text not null,                            -- post | reverse
  request_hash text not null,                         -- sha256 del payload: misma clave + otro contenido = idempotency_conflict
  preview_hash text,                                  -- el hash de la vista previa que vio el usuario
  result jsonb not null default '{}',                 -- lo que devolvió la RPC (para el reintento)
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint abd_id_tenant_uq unique (id, tenant_id),
  constraint abd_client_ref_uq unique (tenant_id, client_ref),
  constraint abd_operation check (operation in ('post', 'reverse')),
  constraint abd_request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint abd_preview_hash check (preview_hash is null or preview_hash ~ '^[0-9a-f]{64}$')
);
comment on table public.acc_bundles is
  'Lo que se guardó junto en una llamada (idempotencia por client_ref + hash del pedido; result para el reintento). Inmutable.';

-- acc_documents — comprobantes (cabecera)
create table public.acc_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bundle_id uuid not null,
  period_id uuid not null,                            -- lo resuelve la RPC (mes, o período especial para fy_*)
  seq bigint not null,                                -- referencia interna (#124)
  kind text not null,
  voucher_type text,
  afip_voucher_code smallint,
  party_id uuid,
  -- Foto fiscal del partícipe al contabilizar (el libro de un mes cerrado no cambia si después le corrigen el CUIT):
  party_name_snapshot text,
  party_doc_type_snapshot smallint,                   -- 80 CUIT · 86 CUIL · 96 DNI · 99 sin identificar
  party_doc_number_snapshot text,
  party_iva_condition_snapshot text,
  issue_date date not null,                           -- fecha del comprobante
  accounting_date date not null,                      -- fecha contable = fecha del asiento = mes del libro IVA
  due_date date,
  point_of_sale int,
  number bigint,
  shift text,                                         -- turno del cierre del día (opcional)
  description text not null,
  notes text,
  total_cents bigint not null,
  control_account_id uuid,                            -- cuenta de control que mueve (proveedores, IVA a pagar…)
  related_document_id uuid,                           -- NC/ND → factura; acreditación → cierre
  replaces_document_id uuid,                          -- «Corregir» (mes abierto): el anulado al que reemplaza
  reverses_document_id uuid,                          -- kind 'reversal': el comprobante de un mes cerrado que anula
  corrects_document_id uuid,                          -- asiento de ajuste que corrige un comprobante de un mes cerrado
  recurring_expense_id uuid,
  settles_commissions boolean not null default false, -- factura mensual de comisiones ya descontadas
  counted_cents bigint,                               -- arqueo: lo contado / saldo de la app (puede ser negativo en un banco)
  expected_book_cents bigint,                         -- arqueo: saldo de libro que vio el usuario (stale_balance)
  warnings_ack text[] not null default '{}',
  override_reason text,                               -- p. ej. facturado > vendido en el cierre del día
  status text not null default 'posted',
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text,
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adoc_id_tenant_uq unique (id, tenant_id),
  constraint adoc_seq_uq unique (tenant_id, seq),
  constraint adoc_seq_pos check (seq >= 1),
  constraint adoc_kind check (kind in (
    'opening', 'purchase', 'purchase_credit_note', 'purchase_debit_note', 'expense', 'payment',
    'sales_close', 'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection',
    'transfer', 'bank_expense', 'cash_movement', 'treasury_adjustment', 'manual', 'reversal',
    'iva_settlement', 'fy_result', 'fy_closing', 'fy_opening')),
  constraint adoc_voucher_type check (voucher_type is null or voucher_type in (
    'factura_a', 'nota_debito_a', 'nota_credito_a', 'recibo_a',
    'factura_b', 'nota_debito_b', 'nota_credito_b', 'recibo_b',
    'factura_c', 'nota_debito_c', 'nota_credito_c', 'recibo_c',
    'factura_m', 'nota_debito_m', 'nota_credito_m',
    'tique_factura_a', 'tique_factura_b', 'tique_factura_c', 'tique',
    'liquidacion', 'resumen_bancario', 'otro_comprobante', 'ddjj_impuesto', 'sin_comprobante')),
  -- Endurecida con coalesce: sin él, un voucher_type NULL hacía NULL la rama (NC, gasto, ventas) y el CHECK pasaba.
  constraint adoc_voucher_kind check (coalesce(case
    when kind in ('purchase', 'purchase_debit_note') then voucher_type is not null
         and voucher_type not like 'nota_credito%'
    when kind = 'purchase_credit_note' then voucher_type like 'nota_credito%'
    when kind = 'expense' then voucher_type in ('sin_comprobante', 'tique')
    when kind in ('sales_invoice', 'sales_debit_note') then voucher_type in
         ('factura_a', 'factura_b', 'nota_debito_a', 'nota_debito_b', 'tique_factura_a', 'tique_factura_b')
    when kind = 'sales_credit_note' then voucher_type in ('nota_credito_a', 'nota_credito_b')
    when kind = 'collection' then voucher_type is null or voucher_type in ('liquidacion', 'factura_a', 'factura_b', 'otro_comprobante')
    when kind = 'bank_expense' then voucher_type is null or voucher_type in ('resumen_bancario', 'factura_a', 'otro_comprobante')
    else voucher_type is null end, false)),
  constraint adoc_party_required check (party_id is not null or kind not in (
    'purchase', 'purchase_credit_note', 'purchase_debit_note', 'payment',
    'sales_invoice', 'sales_credit_note', 'sales_debit_note', 'collection')),
  constraint adoc_snapshot_coherent check ((party_id is null) = (party_name_snapshot is null)
    and (party_doc_type_snapshot is null or party_doc_type_snapshot in (80, 86, 96, 99))
    and (party_doc_number_snapshot is null or party_doc_number_snapshot ~ '^[0-9]{1,11}$')),
  -- Todo comprobante que va a un libro IVA lleva PV y número (los tiques sin comercio van como «expense», sin libro).
  constraint adoc_numbered_vouchers check (
       voucher_type is null
    or voucher_type in ('ddjj_impuesto', 'sin_comprobante')
    or kind = 'expense'
    or (point_of_sale is not null and number is not null)),
  constraint adoc_pos_range check (point_of_sale is null or point_of_sale between 0 and 99999),
  constraint adoc_number_range check (number is null or number between 1 and 99999999),
  constraint adoc_shift_len check (shift is null or char_length(btrim(shift)) between 1 and 20),
  constraint adoc_description_len check (char_length(btrim(description)) between 1 and 200),
  constraint adoc_notes_len check (notes is null or char_length(notes) <= 1000),
  constraint adoc_total_range check (total_cents between 0 and 1000000000000000),
  constraint adoc_dates check (accounting_date >= issue_date and (due_date is null or due_date >= issue_date)),
  constraint adoc_balance_check check ((counted_cents is null) = (expected_book_cents is null)
    and (counted_cents is null or kind in ('treasury_adjustment', 'collection'))),
  constraint adoc_reversal_link check ((kind = 'reversal') = (reverses_document_id is not null)),
  constraint adoc_override_len check (override_reason is null or char_length(btrim(override_reason)) between 5 and 300),
  constraint adoc_status check (status in ('posted', 'voided')),
  constraint adoc_void_coherent check (
       (status = 'posted' and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)),
  constraint adoc_void_reason_len check (void_reason is null or char_length(void_reason) <= 300),
  constraint adoc_bundle_same_tenant foreign key (bundle_id, tenant_id) references public.acc_bundles (id, tenant_id)
    deferrable initially deferred,                    -- la fila del bundle se escribe al final, con su resultado
  constraint adoc_period_same_tenant foreign key (period_id, tenant_id) references public.acc_periods (id, tenant_id),
  constraint adoc_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id),
  constraint adoc_control_same_tenant foreign key (control_account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint adoc_related_same_tenant foreign key (related_document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint adoc_replaces_same_tenant foreign key (replaces_document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint adoc_reverses_same_tenant foreign key (reverses_document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint adoc_corrects_same_tenant foreign key (corrects_document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint adoc_recurring_same_tenant foreign key (recurring_expense_id, tenant_id) references public.acc_recurring_expenses (id, tenant_id)
);
-- Compra duplicada (mismo proveedor, tipo, PV y número) entre vigentes; las anuladas no bloquean recargar.
create unique index adoc_purchase_dup_uq on public.acc_documents (tenant_id, party_id, voucher_type, point_of_sale, number)
  where status = 'posted' and number is not null and kind in ('purchase', 'purchase_credit_note', 'purchase_debit_note');
-- Venta suelta duplicada (los rangos de los cierres se chequean en la RPC contra acc_fiscal_vouchers).
create unique index adoc_sales_dup_uq on public.acc_documents (tenant_id, voucher_type, point_of_sale, number)
  where status = 'posted' and kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note');
create unique index adoc_close_day_uq on public.acc_documents (tenant_id, accounting_date, coalesce(shift, ''))
  where status = 'posted' and kind = 'sales_close';
create unique index adoc_one_opening_uq on public.acc_documents (tenant_id) where status = 'posted' and kind = 'opening';
create unique index adoc_one_reversal_uq on public.acc_documents (reverses_document_id) where kind = 'reversal' and status = 'posted';
create unique index adoc_one_replacement_uq on public.acc_documents (replaces_document_id) where replaces_document_id is not null and status = 'posted';
-- «Reemplazado por» y «Anulado por» se derivan de estos vínculos hacia adelante: el original nunca se modifica.
create index adoc_kind_date_idx on public.acc_documents (tenant_id, kind, accounting_date desc, seq desc);
-- Spec: (tenant_id, party_id, accounting_date desc). Reordenado para cubrir adoc_party_same_tenant
-- (sirve igual para «comprobantes del partícipe P del bar T por fecha»).
create index adoc_party_date_idx on public.acc_documents (party_id, tenant_id, accounting_date desc) where party_id is not null;
-- Spec: (bundle_id), (period_id), (related_document_id). Ensanchados con tenant_id para cubrir sus FK.
create index adoc_bundle_idx on public.acc_documents (bundle_id, tenant_id);
create index adoc_period_idx on public.acc_documents (period_id, tenant_id);
create index adoc_related_idx on public.acc_documents (related_document_id, tenant_id) where related_document_id is not null;
comment on table public.acc_documents is
  'Comprobantes (cabecera). Un comprobante = un asiento. Inmutables salvo la transición posted → voided (con el período abierto).';

-- acc_document_lines — componentes de imputación (renglones del comprobante = líneas del asiento)
create table public.acc_document_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  line_no smallint not null,
  role text not null,                                 -- C.3.4: la matriz de roles por tipo de comprobante
  account_id uuid not null,
  side public.acc_side not null,
  amount_cents bigint not null,
  party_id uuid,                                      -- obligatorio si la cuenta es de control; prohibido si no (salvo espejos)
  due_date date,                                      -- vencimiento de la partida (solo líneas con partícipe)
  treasury_account_id uuid,                           -- rol treasury
  sales_method_id uuid,                               -- cierre del día y deducciones atribuidas a un medio
  vat_rate_bp int,
  base_cents bigint,                                  -- net: = amount; vat: neto gravado de esa alícuota
  vat_computed_cents bigint,                          -- vat: lo que calculó el sistema (auditable si se ajustó)
  tax_kind text,
  jurisdiction_code smallint,                         -- IIBB: 901..924
  channel text,                                       -- ventas: salón / delivery / eventos
  certificate_number text,                            -- retenciones sufridas: n° de certificado
  reference text,                                     -- n° de operación, transferencia, lote, factura de origen (apertura)
  memo text,                                          -- leyenda del diario (texto derivado; no entra al hash)
  constraint adl_id_tenant_uq unique (id, tenant_id),
  constraint adl_line_no_uq unique (document_id, line_no),
  constraint adl_line_no check (line_no between 1 and 500),
  constraint adl_role check (role in (
    'net', 'vat', 'gross', 'non_taxed', 'exempt', 'internal_tax', 'perception', 'other_tax',
    'control', 'treasury', 'compensation', 'deduction', 'write_off', 'receivable', 'advance',
    'sales_invoiced', 'sales_uninvoiced', 'cash_diff', 'vat_pending_release', 'counterpart', 'adjustment_split',
    'manual', 'opening', 'settlement', 'reversal', 'fy_result', 'mirror')),
  constraint adl_amount check (amount_cents between 1 and 1000000000000000),
  constraint adl_vat_rate check (vat_rate_bp is null or vat_rate_bp in (0, 250, 500, 1050, 2100, 2700)),
  constraint adl_base check (base_cents is null or base_cents >= 0),
  constraint adl_vat_computed check (vat_computed_cents is null or vat_computed_cents >= 0),
  -- Endurecida con coalesce: sin él, un neto con base_cents NULL pasaba el CHECK.
  constraint adl_net_shape check (coalesce(role <> 'net' or (vat_rate_bp is not null and base_cents = amount_cents), false)),
  constraint adl_vat_shape check (role <> 'vat' or (vat_rate_bp is not null and base_cents is not null and vat_computed_cents is not null)),
  constraint adl_tax_kind check (tax_kind is null or tax_kind in (
    'iva', 'iibb', 'ganancias', 'municipal', 'internos', 'ley_25413_credito', 'ley_25413_debito', 'sircreb', 'sircupa',
    'comision', 'iva_comision', 'percepcion_iva_comision', 'ret_iva', 'ret_iibb', 'ret_ganancias',
    'interes', 'diferencia', 'rendimiento', 'otro')),
  constraint adl_tax_kind_roles check ((tax_kind is not null) = (role in ('perception', 'other_tax', 'deduction', 'adjustment_split', 'compensation'))
                                       or role = 'vat'),
  constraint adl_jurisdiction check (jurisdiction_code is null or jurisdiction_code between 901 and 924),
  constraint adl_channel check (channel is null or channel in ('salon', 'delivery', 'events')),
  constraint adl_channel_roles check ((channel is not null) = (role in ('sales_invoiced', 'sales_uninvoiced'))
                                      or role in ('receivable', 'treasury', 'vat')),
  constraint adl_cert_len check (certificate_number is null or char_length(certificate_number) <= 40),
  constraint adl_reference_len check (reference is null or char_length(reference) <= 60),
  constraint adl_memo_len check (memo is null or char_length(memo) <= 200),
  constraint adl_party_due check (due_date is null or party_id is not null),
  constraint adl_treasury_role check ((treasury_account_id is not null) = (role = 'treasury')),
  constraint adl_doc_same_tenant foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint adl_account_same_tenant foreign key (account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint adl_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id),
  constraint adl_treasury_same_tenant foreign key (treasury_account_id, tenant_id) references public.acc_treasury_accounts (id, tenant_id),
  constraint adl_method_same_tenant foreign key (sales_method_id, tenant_id) references public.acc_sales_methods (id, tenant_id)
);
-- Spec: (document_id). Ensanchado con tenant_id para cubrir adl_doc_same_tenant.
create index adl_document_idx on public.acc_document_lines (document_id, tenant_id);
create index adl_method_idx on public.acc_document_lines (tenant_id, sales_method_id) where sales_method_id is not null;
comment on table public.acc_document_lines is
  'Renglones del comprobante = componentes de imputación (cuenta, lado, importe, partícipe y metadato económico). El asiento es su proyección 1:1. Inmutables.';

-- acc_fiscal_vouchers — filas de los libros IVA (lo que pide la RG 4597, con foto de la contraparte)
create table public.acc_fiscal_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null,
  book text not null,                                -- purchases | sales
  period_month date not null,                        -- mes del libro = mes de accounting_date del documento
  voucher_date date not null,
  voucher_type text not null,                        -- mismo dominio que acc_documents, sin ddjj ni sin_comprobante
  afip_voucher_code smallint,                        -- null solo en liquidación y resumen bancario (código a confirmar)
  is_credit_note boolean not null,
  is_reversal boolean not null default false,        -- modo negative_row: anulación de un comprobante de un mes cerrado
  point_of_sale int not null,
  number_from bigint not null,
  number_to bigint,                                  -- obligatorio en ventas (rango del cierre); en compras null
  counterparty_party_id uuid,
  counterparty_name text not null,
  counterparty_doc_type smallint not null,           -- 80 CUIT · 86 CUIL · 96 DNI · 99 consumidor final
  counterparty_doc_number text not null default '0',
  counterparty_iva_condition text not null,
  channel text,
  net_0_cents bigint not null default 0,
  net_25_cents bigint not null default 0,  vat_25_cents bigint not null default 0,
  net_5_cents bigint not null default 0,   vat_5_cents bigint not null default 0,
  net_105_cents bigint not null default 0, vat_105_cents bigint not null default 0,
  net_21_cents bigint not null default 0,  vat_21_cents bigint not null default 0,
  net_27_cents bigint not null default 0,  vat_27_cents bigint not null default 0,
  non_taxed_cents bigint not null default 0,
  undiscriminated_cents bigint not null default 0,   -- compras B, C y tiques: gravado pero sin IVA discriminado
  exempt_cents bigint not null default 0,
  perc_iva_cents bigint not null default 0,
  perc_iibb_cents bigint not null default 0,
  perc_ganancias_cents bigint not null default 0,
  perc_municipal_cents bigint not null default 0,
  internal_taxes_cents bigint not null default 0,
  other_taxes_cents bigint not null default 0,
  total_cents bigint not null,
  vat_computable_cents bigint not null default 0,    -- crédito fiscal computable (compras)
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  constraint afv_id_tenant_uq unique (id, tenant_id),
  constraint afv_book check (book in ('purchases', 'sales')),
  constraint afv_period_first_day check (extract(day from period_month) = 1),
  constraint afv_voucher_type check (voucher_type not in ('ddjj_impuesto', 'sin_comprobante')),
  constraint afv_pos check (point_of_sale between 0 and 99999),
  constraint afv_numbers check (number_from between 1 and 99999999 and (number_to is null or number_to between number_from and 99999999)),
  constraint afv_sales_range check (book <> 'sales' or number_to is not null),
  constraint afv_purchases_cuit check (book <> 'purchases'
    or (counterparty_doc_type = 80 and counterparty_doc_number ~ '^[0-9]{11}$')),
  constraint afv_doc_type check (counterparty_doc_type in (80, 86, 96, 99)),
  constraint afv_doc_number check (counterparty_doc_number ~ '^[0-9]{1,11}$'),
  constraint afv_name_len check (char_length(btrim(counterparty_name)) between 1 and 160),
  constraint afv_channel check (channel is null or channel in ('salon', 'delivery', 'events')),
  constraint afv_sales_channel check (book <> 'sales' or channel is not null),
  constraint afv_nonneg check (least(net_0_cents, net_25_cents, vat_25_cents, net_5_cents, vat_5_cents,
    net_105_cents, vat_105_cents, net_21_cents, vat_21_cents, net_27_cents, vat_27_cents, non_taxed_cents,
    undiscriminated_cents, exempt_cents, perc_iva_cents, perc_iibb_cents, perc_ganancias_cents, perc_municipal_cents,
    internal_taxes_cents, other_taxes_cents, total_cents, vat_computable_cents) >= 0),
  constraint afv_total check (total_cents = net_0_cents + net_25_cents + vat_25_cents + net_5_cents + vat_5_cents
    + net_105_cents + vat_105_cents + net_21_cents + vat_21_cents + net_27_cents + vat_27_cents
    + non_taxed_cents + undiscriminated_cents + exempt_cents + perc_iva_cents + perc_iibb_cents + perc_ganancias_cents
    + perc_municipal_cents + internal_taxes_cents + other_taxes_cents),
  constraint afv_computable check (vat_computable_cents <= vat_25_cents + vat_5_cents + vat_105_cents + vat_21_cents + vat_27_cents),
  constraint afv_sales_no_undiscriminated check (book <> 'sales' or undiscriminated_cents = 0),
  constraint afv_doc_same_tenant foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint afv_party_same_tenant foreign key (counterparty_party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
create index afv_book_period_idx on public.acc_fiscal_vouchers (tenant_id, book, period_month, voucher_date) where not voided;
-- Spec: (document_id). Ensanchado con tenant_id para cubrir afv_doc_same_tenant.
create index afv_document_idx on public.acc_fiscal_vouchers (document_id, tenant_id);
create index afv_sales_range_idx on public.acc_fiscal_vouchers (tenant_id, voucher_type, point_of_sale, number_from)
  where book = 'sales' and not voided;
comment on table public.acc_fiscal_vouchers is
  'Filas de los libros IVA compras y ventas (campos de la RG 4597) con la foto de la contraparte. Montos positivos; is_credit_note/is_reversal dan el signo.';

-- acc_journal_entries — asientos
create table public.acc_journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fiscal_year_id uuid not null,
  period_id uuid not null,
  document_id uuid not null,
  posting_seq bigint generated always as identity,   -- orden de carga global: desempata el diario y el keyset
  entry_date date not null,
  kind text not null,
  is_mirror boolean generated always as (kind in ('fy_closing', 'fy_opening')) stored,
  order_key smallint generated always as ((case kind
      when 'opening' then 0 when 'fy_opening' then 0
      when 'iva_settlement' then 6 when 'fy_adjustment' then 7
      when 'fy_result' then 8 when 'fy_closing' then 9 else 5 end)::smallint) stored,
  number int,                                         -- null mientras el período está abierto (número provisorio derivado)
  description text not null,
  total_cents bigint not null,                        -- Σ Debe = Σ Haber (lo verifica el trigger diferido)
  status text not null default 'posted',
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text,
  void_reason text,
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint aje_id_tenant_uq unique (id, tenant_id),
  constraint aje_document_uq unique (document_id),                       -- 1 comprobante = 1 asiento
  constraint aje_posting_seq_uq unique (posting_seq),
  constraint aje_number_uq unique (fiscal_year_id, number),
  constraint aje_kind check (kind in ('opening', 'standard', 'manual', 'adjustment', 'payroll', 'reversal',
                                      'iva_settlement', 'fy_adjustment', 'fy_result', 'fy_closing', 'fy_opening')),
  constraint aje_number_pos check (number is null or number >= 1),
  constraint aje_description_len check (char_length(btrim(description)) between 1 and 200),
  constraint aje_total check (total_cents between 1 and 1000000000000000),
  constraint aje_status check (status in ('posted', 'voided')),
  constraint aje_void_coherent check (
       (status = 'posted' and voided_at is null and void_reason is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null and number is null)),
  constraint aje_fy_same_tenant foreign key (fiscal_year_id, tenant_id) references public.acc_fiscal_years (id, tenant_id),
  constraint aje_period_same_tenant foreign key (period_id, tenant_id) references public.acc_periods (id, tenant_id),
  constraint aje_document_same_tenant foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id)
);
create index aje_order_idx on public.acc_journal_entries (tenant_id, entry_date, order_key, posting_seq) where status = 'posted';
-- Spec: (period_id) where posted. Ensanchado con tenant_id para cubrir aje_period_same_tenant.
create index aje_period_idx on public.acc_journal_entries (period_id, tenant_id) where status = 'posted';
create index aje_fy_number_idx on public.acc_journal_entries (fiscal_year_id, number) where number is not null;
comment on table public.acc_journal_entries is
  'Asientos (uno por comprobante). number se congela al cerrar el período; mientras está abierto es provisorio y derivado.';

-- acc_journal_lines — líneas del diario (las que tienen partícipe son las partidas)
create table public.acc_journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_id uuid not null,
  document_id uuid not null,                          -- copia de la cabecera (trigger)
  document_line_id uuid not null,                     -- proyección 1:1 del renglón del comprobante
  line_no smallint not null,
  account_id uuid not null,
  side public.acc_side not null,
  amount_cents bigint not null,
  party_id uuid,
  due_date date,                                      -- partidas: null = sin vencimiento (a cuenta, anticipo)
  entry_date date not null,                           -- copia inmutable de la fecha del asiento (trigger)
  memo text,
  constraint ajl_id_tenant_uq unique (id, tenant_id),
  constraint ajl_line_no_uq unique (entry_id, line_no),
  constraint ajl_doc_line_uq unique (document_line_id),
  constraint ajl_line_no check (line_no between 1 and 500),
  constraint ajl_amount check (amount_cents between 1 and 1000000000000000),
  constraint ajl_party_due check (due_date is null or party_id is not null),
  constraint ajl_memo_len check (memo is null or char_length(memo) <= 200),
  constraint ajl_entry_same_tenant foreign key (entry_id, tenant_id) references public.acc_journal_entries (id, tenant_id),
  constraint ajl_document_same_tenant foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint ajl_doc_line_same_tenant foreign key (document_line_id, tenant_id) references public.acc_document_lines (id, tenant_id),
  constraint ajl_account_same_tenant foreign key (account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint ajl_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id)
);
create index ajl_account_date_idx on public.acc_journal_lines (tenant_id, account_id, entry_date);
-- Spec: (tenant_id, party_id, account_id, due_date). Reordenado para cubrir ajl_party_same_tenant (las
-- búsquedas por partícipe filtran party_id y tenant_id por igualdad; el vencimiento global usa ajl_party_due_idx).
create index ajl_party_idx on public.acc_journal_lines (party_id, tenant_id, account_id, due_date) where party_id is not null;
create index ajl_party_due_idx on public.acc_journal_lines (tenant_id, due_date) where party_id is not null;
-- Spec: (entry_id), (document_id). Ensanchados con tenant_id para cubrir sus FK.
create index ajl_entry_idx on public.acc_journal_lines (entry_id, tenant_id);
create index ajl_document_idx on public.acc_journal_lines (document_id, tenant_id);
comment on table public.acc_journal_lines is
  'Líneas del diario: lado + importe positivo. Las que tienen partícipe son las partidas abiertas/canceladas por imputaciones. Inmutables.';

-- acc_allocations — imputaciones (qué pago, NC o cobro cancela qué partida)
create table public.acc_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_id uuid not null,                           -- cuenta de control común a las dos partidas
  party_id uuid not null,
  debit_line_id uuid not null,                        -- partida Debe (pago, NC de proveedor, factura de venta…)
  credit_line_id uuid not null,                       -- partida Haber (factura de proveedor, cobro, NC de venta…)
  amount_cents bigint not null,
  kind text not null,                                 -- payment | credit_note | manual | reversal | replace
  applied_on date not null,                           -- desde cuándo cuenta (estados de cuenta «al …»)
  document_id uuid,                                   -- el comprobante que la generó (null = «Imputar» manual)
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  voided_on date,                                     -- desaplicada desde (no se borra: el pasado se reproduce igual)
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  void_document_id uuid,
  updated_at timestamptz not null default now(),
  constraint aal_id_tenant_uq unique (id, tenant_id),
  constraint aal_amount check (amount_cents between 1 and 1000000000000000),
  constraint aal_distinct check (debit_line_id <> credit_line_id),
  constraint aal_kind check (kind in ('payment', 'credit_note', 'manual', 'reversal', 'replace')),
  constraint aal_void_coherent check ((voided_on is null) = (voided_at is null)
                                      and (voided_on is null or voided_on >= applied_on)),
  constraint aal_void_reason_len check (void_reason is null or char_length(void_reason) <= 300),
  constraint aal_account_same_tenant foreign key (account_id, tenant_id) references public.acc_accounts (id, tenant_id),
  constraint aal_party_same_tenant foreign key (party_id, tenant_id) references public.acc_parties (id, tenant_id),
  constraint aal_debit_same_tenant foreign key (debit_line_id, tenant_id) references public.acc_journal_lines (id, tenant_id),
  constraint aal_credit_same_tenant foreign key (credit_line_id, tenant_id) references public.acc_journal_lines (id, tenant_id),
  constraint aal_doc_same_tenant foreign key (document_id, tenant_id) references public.acc_documents (id, tenant_id),
  constraint aal_void_doc_same_tenant foreign key (void_document_id, tenant_id) references public.acc_documents (id, tenant_id)
);
-- Spec: (debit_line_id), (credit_line_id), (document_id). Ensanchados con tenant_id para cubrir sus FK.
create index aal_debit_active_idx on public.acc_allocations (debit_line_id, tenant_id) where voided_on is null;
create index aal_credit_active_idx on public.acc_allocations (credit_line_id, tenant_id) where voided_on is null;
create index aal_party_idx on public.acc_allocations (tenant_id, party_id, applied_on);
create index aal_document_idx on public.acc_allocations (document_id, tenant_id) where document_id is not null;
comment on table public.acc_allocations is
  'Imputaciones entre una partida Debe y una Haber del mismo partícipe y cuenta, vigentes en [applied_on, voided_on). Nunca se borran.';

-- ─── 2. FK diferidas por orden de creación (§A.3) ──────────────────────────
alter table public.acc_periods add constraint aper_iva_doc_same_tenant
  foreign key (iva_settlement_document_id, tenant_id) references public.acc_documents (id, tenant_id);
alter table public.acc_recurring_expenses add constraint arx_last_doc_same_tenant
  foreign key (last_document_id, tenant_id) references public.acc_documents (id, tenant_id);

-- ─── 3. Índices que cubren las FK restantes ─────────────────────────────────
-- (Las columnas anulables, con índice parcial `where x is not null`: la búsqueda de la FK
-- es por igualdad, que implica no nulo.)
create index ast_created_by_idx on public.acc_settings (created_by) where created_by is not null;
create index ast_updated_by_idx on public.acc_settings (updated_by) where updated_by is not null;
create index aper_fy_idx on public.acc_periods (fiscal_year_id, tenant_id);
create index aper_iva_doc_idx on public.acc_periods (iva_settlement_document_id, tenant_id) where iva_settlement_document_id is not null;
create index apev_period_idx on public.acc_period_events (period_id, tenant_id) where period_id is not null;
create index apev_fy_idx on public.acc_period_events (fiscal_year_id, tenant_id) where fiscal_year_id is not null;
create index aac_created_by_idx on public.acc_accounts (created_by) where created_by is not null;
create index aac_updated_by_idx on public.acc_accounts (updated_by) where updated_by is not null;
create index apt_default_account_idx on public.acc_parties (default_account_id, tenant_id) where default_account_id is not null;
create index apt_payable_idx on public.acc_parties (payable_account_id, tenant_id);
create index apt_receivable_idx on public.acc_parties (receivable_account_id, tenant_id);
create index apt_created_by_idx on public.acc_parties (created_by) where created_by is not null;
create index apt_updated_by_idx on public.acc_parties (updated_by) where updated_by is not null;
create index atr_bank_party_idx on public.acc_treasury_accounts (bank_party_id, tenant_id) where bank_party_id is not null;
create index atr_created_by_idx on public.acc_treasury_accounts (created_by) where created_by is not null;
create index atr_updated_by_idx on public.acc_treasury_accounts (updated_by) where updated_by is not null;
create index asm_treasury_idx on public.acc_sales_methods (treasury_account_id, tenant_id) where treasury_account_id is not null;
create index asm_party_idx on public.acc_sales_methods (party_id, tenant_id) where party_id is not null;
create index asm_created_by_idx on public.acc_sales_methods (created_by) where created_by is not null;
create index asm_updated_by_idx on public.acc_sales_methods (updated_by) where updated_by is not null;
create index arx_party_idx on public.acc_recurring_expenses (party_id, tenant_id) where party_id is not null;
create index arx_account_idx on public.acc_recurring_expenses (account_id, tenant_id);
create index arx_treasury_idx on public.acc_recurring_expenses (treasury_account_id, tenant_id) where treasury_account_id is not null;
create index arx_last_doc_idx on public.acc_recurring_expenses (last_document_id, tenant_id) where last_document_id is not null;
create index arx_created_by_idx on public.acc_recurring_expenses (created_by) where created_by is not null;
create index arx_updated_by_idx on public.acc_recurring_expenses (updated_by) where updated_by is not null;
create index adoc_control_idx on public.acc_documents (control_account_id, tenant_id) where control_account_id is not null;
create index adoc_replaces_idx on public.acc_documents (replaces_document_id, tenant_id) where replaces_document_id is not null;
create index adoc_reverses_idx on public.acc_documents (reverses_document_id, tenant_id) where reverses_document_id is not null;
create index adoc_corrects_idx on public.acc_documents (corrects_document_id, tenant_id) where corrects_document_id is not null;
create index adoc_recurring_idx on public.acc_documents (recurring_expense_id, tenant_id) where recurring_expense_id is not null;
create index adl_account_idx on public.acc_document_lines (account_id, tenant_id);
create index adl_party_idx on public.acc_document_lines (party_id, tenant_id) where party_id is not null;
create index adl_treasury_idx on public.acc_document_lines (treasury_account_id, tenant_id) where treasury_account_id is not null;
create index adl_method_fk_idx on public.acc_document_lines (sales_method_id, tenant_id) where sales_method_id is not null;
create index afv_party_idx on public.acc_fiscal_vouchers (counterparty_party_id, tenant_id) where counterparty_party_id is not null;
create index aje_fy_idx on public.acc_journal_entries (fiscal_year_id, tenant_id);
create index aje_document_idx on public.acc_journal_entries (document_id, tenant_id);
create index ajl_doc_line_idx on public.acc_journal_lines (document_line_id, tenant_id);
create index ajl_account_fk_idx on public.acc_journal_lines (account_id, tenant_id);
create index aal_account_idx on public.acc_allocations (account_id, tenant_id);
create index aal_party_fk_idx on public.acc_allocations (party_id, tenant_id);
create index aal_void_doc_idx on public.acc_allocations (void_document_id, tenant_id) where void_document_id is not null;

-- ─── 4. RLS cerrada y privilegios (las políticas de lectura llegan en la #6) ─
do $$
declare
  t text;
begin
  foreach t in array array[
    'acc_settings', 'acc_fiscal_years', 'acc_periods', 'acc_period_events', 'acc_accounts', 'acc_parties',
    'acc_treasury_accounts', 'acc_sales_points', 'acc_sales_methods', 'acc_recurring_expenses', 'acc_bundles',
    'acc_documents', 'acc_document_lines', 'acc_fiscal_vouchers', 'acc_journal_entries', 'acc_journal_lines',
    'acc_allocations']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Sin INSERT/UPDATE/DELETE/TRUNCATE para authenticated aunque alguien agregue una política por error;
    -- nada para anon (el default privileges del proyecto le da SELECT e INSERT a cada tabla nueva).
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- La secuencia de la identidad posting_seq nace con rwU para anon y authenticated (default privileges).
revoke all on sequence public.acc_journal_entries_posting_seq_seq from anon, authenticated;

-- ─── 5. Helpers de cálculo (INVOKER: corren bajo la RLS de quien llama) ─────
-- Abierto de una partida, hoy (p_as_of null) o al día X. Una imputación vale en [applied_on, voided_on).
create function public.acc_open_amount(p_line_id uuid, p_as_of date default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select (l.amount_cents
       - coalesce((select sum(a.amount_cents) from public.acc_allocations a
                    where l.side = 'debit' and a.debit_line_id = l.id
                      and (p_as_of is null or a.applied_on <= p_as_of)
                      and (a.voided_on is null or (p_as_of is not null and a.voided_on > p_as_of))), 0)
       - coalesce((select sum(a.amount_cents) from public.acc_allocations a
                    where l.side = 'credit' and a.credit_line_id = l.id
                      and (p_as_of is null or a.applied_on <= p_as_of)
                      and (a.voided_on is null or (p_as_of is not null and a.voided_on > p_as_of))), 0))::bigint
    from public.acc_journal_lines l where l.id = p_line_id
$$;

-- Saldo con signo (Σ debe − Σ haber) de una cuenta hoja, asientos vigentes que no son espejo.
create function public.acc_account_balance(p_tenant uuid, p_account uuid, p_to date default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(case when l.side = 'debit' then l.amount_cents else -l.amount_cents end), 0)::bigint
    from public.acc_journal_lines l join public.acc_journal_entries e on e.id = l.entry_id
   where l.tenant_id = p_tenant and l.account_id = p_account and e.status = 'posted' and not e.is_mirror
     and (p_to is null or l.entry_date <= p_to)
$$;

-- Base de numeración del ejercicio (C.5.3): último número congelado; si no hay ninguno, 1 si el N° 1 está
-- reservado para una apertura que todavía no existe, si no 0.
create function public.acc_entry_number_base(p_fiscal_year uuid)
returns int
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select max(e.number) from public.acc_journal_entries e where e.fiscal_year_id = p_fiscal_year),
    (select case when fy.opening_number_reserved
                  and not exists (select 1 from public.acc_journal_entries e
                                   where e.fiscal_year_id = fy.id and e.status = 'posted' and e.kind in ('opening', 'fy_opening'))
                 then 1 else 0 end
       from public.acc_fiscal_years fy where fy.id = p_fiscal_year))
$$;

comment on function public.acc_open_amount(uuid, date) is
  'Importe abierto de una partida (línea con partícipe), hoy o al día p_as_of. INVOKER.';
comment on function public.acc_account_balance(uuid, uuid, date) is
  'Saldo con signo (debe − haber) de una cuenta hoja: asientos vigentes, sin espejos, hasta p_to. INVOKER.';
comment on function public.acc_entry_number_base(uuid) is
  'Base de la numeración provisoria/definitiva del ejercicio (C.5.3). INVOKER.';

revoke all on function public.acc_open_amount(uuid, date) from public, anon;
grant execute on function public.acc_open_amount(uuid, date) to authenticated;
revoke all on function public.acc_account_balance(uuid, uuid, date) from public, anon;
grant execute on function public.acc_account_balance(uuid, uuid, date) to authenticated;
revoke all on function public.acc_entry_number_base(uuid) from public, anon;
grant execute on function public.acc_entry_number_base(uuid) to authenticated;

-- ─── 6. Triggers (§A.5) ──────────────────────────────────────────────────────
-- Todas las funciones de trigger viven en private, son SECURITY DEFINER con search_path vacío y sin
-- EXECUTE para nadie (los triggers no chequean EXECUTE al dispararse). Los BEFORE de una misma tabla
-- se disparan en orden alfabético: se numeran (_10_ guardia, _20_ inmutabilidad) y el updated_at,
-- que no lleva número, corre último.

-- 6.1 Plan de cuentas
create function private.acc_tg_accounts_biu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.acc_accounts;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;                                                   -- cascada del bar entero
    end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then
      return old;                                                   -- reinicio antes del primer cierre (I.6)
    end if;
    raise exception 'account_delete_forbidden' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.tenant_id <> old.tenant_id then
      raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_accounts';
    end if;
    if new.system_key is distinct from old.system_key then
      raise exception 'system_account_locked' using errcode = 'P0001';
    end if;
  end if;

  -- Nivel, camino, tipo heredado y prefijo del código.
  if new.parent_id is null then
    new.level := 1;
    new.path := '{}';
  else
    select * into p from public.acc_accounts a where a.id = new.parent_id and a.tenant_id = new.tenant_id;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001', detail = 'parent';
    end if;
    if p.id = new.id or new.id = any (p.path) then                  -- ciclo (solo posible en UPDATE)
      raise exception 'account_move_with_children' using errcode = 'P0001';
    end if;
    if p.postable then
      raise exception 'parent_is_postable' using errcode = 'P0001';
    end if;
    if position('.' in new.code) > 0 then
      if left(new.code, char_length(p.code) + 1) <> (p.code || '.') then
        raise exception 'code_parent_mismatch' using errcode = 'P0001', detail = p.code;
      end if;
    elsif char_length(new.code) <= char_length(p.code) or left(new.code, char_length(p.code)) <> p.code then
      raise exception 'code_parent_mismatch' using errcode = 'P0001', detail = p.code;
    end if;
    new.type := p.type;
    new.level := p.level + 1;
    new.path := p.path || p.id;
  end if;

  if tg_op = 'UPDATE' then
    -- Un grupo con hijas no se mueve ni se reestructura (sus hijas guardan camino, código y tipo).
    if (new.parent_id is distinct from old.parent_id or new.code <> old.code or new.type <> old.type
        or (new.postable and not old.postable))
       and exists (select 1 from public.acc_accounts c where c.parent_id = old.id and c.tenant_id = old.tenant_id) then
      raise exception 'account_move_with_children' using errcode = 'P0001';
    end if;
    -- Con movimientos no cambian tipo, lado normal, imputable, control ni código.
    if (new.type <> old.type or new.normal_side <> old.normal_side or new.postable <> old.postable
        or new.requires_party <> old.requires_party or new.code <> old.code)
       and exists (select 1 from public.acc_journal_lines l where l.account_id = old.id and l.tenant_id = old.tenant_id) then
      raise exception 'account_has_movements' using errcode = 'P0001';
    end if;
    -- Desactivar: sin clave de sistema, con saldo cero y sin nada activo que la use.
    if old.active and not new.active then
      if old.system_key is not null then
        raise exception 'system_account_locked' using errcode = 'P0001';
      end if;
      if old.postable and public.acc_account_balance(old.tenant_id, old.id, null) <> 0 then
        raise exception 'account_has_balance' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.acc_accounts c
                  where c.parent_id = old.id and c.tenant_id = old.tenant_id and c.active)
         or exists (select 1 from public.acc_treasury_accounts tr
                     where tr.account_id = old.id and tr.tenant_id = old.tenant_id and tr.active)
         or exists (select 1 from public.acc_parties pa
                     where pa.tenant_id = old.tenant_id and pa.active
                       and old.id in (pa.default_account_id, pa.payable_account_id, pa.receivable_account_id))
         or exists (select 1 from public.acc_recurring_expenses rx
                     where rx.account_id = old.id and rx.tenant_id = old.tenant_id and rx.active) then
        raise exception 'account_in_use' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;
create trigger acc_accounts_biu
  before insert or update or delete on public.acc_accounts
  for each row execute function private.acc_tg_accounts_biu();

-- 6.2 Cajas
create function private.acc_tg_treasury_biu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.acc_accounts;
begin
  if tg_op = 'UPDATE' and new.account_id = old.account_id and new.kind = old.kind and new.tenant_id = old.tenant_id then
    return new;                                         -- no cambió nada de lo que se valida
  end if;
  select * into a from public.acc_accounts x where x.id = new.account_id and x.tenant_id = new.tenant_id;
  if not found or not a.postable or a.requires_party or not a.is_treasury
     or a.type <> (case when new.kind = 'credit_card' then 'liability' else 'asset' end)::public.acc_account_type then
    raise exception 'treasury_account_invalid' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.account_id <> old.account_id
     and exists (select 1 from public.acc_journal_lines l where l.account_id = old.account_id and l.tenant_id = old.tenant_id) then
    raise exception 'account_has_movements' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger acc_treasury_biu
  before insert or update on public.acc_treasury_accounts
  for each row execute function private.acc_tg_treasury_biu();

-- 6.3 Guardia de período de los asientos (decisión 7; ata también a service_role)
create function private.acc_tg_period_guard_entries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.acc_periods;
  v_start date;
  v_doc record;
begin
  -- FOR SHARE choca con el FOR UPDATE que toma acc_close_period: el cierre espera a las cargas en
  -- curso de ese período y las que llegan después ven el período cerrado.
  select * into v_period from public.acc_periods p
   where p.id = new.period_id and p.tenant_id = new.tenant_id for share;
  if not found then raise exception 'period_not_found' using errcode = 'P0001'; end if;
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_period.month, 'YYYY-MM');
  end if;
  if tg_op = 'INSERT' then
    if new.entry_date not between v_period.starts_on and v_period.ends_on
       or new.fiscal_year_id <> v_period.fiscal_year_id then
      raise exception 'entry_date_outside_period' using errcode = 'P0001';
    end if;
    -- Tipo de asiento ↔ tipo de período: los especiales solo reciben lo suyo.
    if (v_period.kind = 'fy_adjustments' and new.kind not in ('fy_adjustment', 'fy_result', 'fy_closing'))
       or (v_period.kind = 'fy_opening' and new.kind <> 'fy_opening')
       or (v_period.kind = 'month' and new.kind in ('fy_adjustment', 'fy_result', 'fy_closing', 'fy_opening')) then
      raise exception 'period_kind_mismatch' using errcode = 'P0001';
    end if;
    select s.books_start_date into v_start from public.acc_settings s where s.tenant_id = new.tenant_id;
    if new.entry_date < v_start and new.kind <> 'fy_opening' then
      raise exception 'date_before_start' using errcode = 'P0001', detail = v_start::text;
    end if;
    -- El asiento es la proyección de su comprobante: mismo período, misma fecha y tipo coherente.
    select d.period_id, d.accounting_date, d.kind into v_doc
      from public.acc_documents d where d.id = new.document_id and d.tenant_id = new.tenant_id;
    if not found or v_doc.period_id <> new.period_id or v_doc.accounting_date <> new.entry_date
       or new.kind <> (case
             when v_doc.kind = 'manual' and new.kind in ('manual', 'adjustment', 'payroll', 'fy_adjustment') then new.kind
             when v_doc.kind in ('opening', 'reversal', 'iva_settlement', 'fy_result', 'fy_closing', 'fy_opening') then v_doc.kind
             when v_doc.kind = 'manual' then 'manual'
             else 'standard' end) then
      raise exception 'document_entry_mismatch' using errcode = 'P0001', detail = new.document_id::text;
    end if;
  end if;
  return new;   -- en UPDATE, acc_journal_entries_20_immutable restringe qué columnas pueden cambiar
end;
$$;
create trigger acc_journal_entries_10_period_guard
  before insert or update on public.acc_journal_entries
  for each row execute function private.acc_tg_period_guard_entries();

-- 6.4 Guardia de período de los comprobantes
create function private.acc_tg_period_guard_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.acc_periods;
  v_start date;
begin
  select * into v_period from public.acc_periods p
   where p.id = new.period_id and p.tenant_id = new.tenant_id for share;
  if not found then raise exception 'period_not_found' using errcode = 'P0001'; end if;
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_period.month, 'YYYY-MM');
  end if;
  if tg_op = 'INSERT' then
    if new.accounting_date not between v_period.starts_on and v_period.ends_on then
      raise exception 'entry_date_outside_period' using errcode = 'P0001';
    end if;
    -- manual puede ir al período de ajustes de cierre (asiento fy_adjustment de la contadora).
    if (v_period.kind = 'fy_adjustments' and new.kind not in ('manual', 'fy_result', 'fy_closing'))
       or (v_period.kind = 'fy_opening' and new.kind <> 'fy_opening')
       or (v_period.kind = 'month' and new.kind in ('fy_result', 'fy_closing', 'fy_opening')) then
      raise exception 'period_kind_mismatch' using errcode = 'P0001';
    end if;
    select s.books_start_date into v_start from public.acc_settings s where s.tenant_id = new.tenant_id;
    if new.accounting_date < v_start and new.kind <> 'fy_opening' then
      raise exception 'date_before_start' using errcode = 'P0001', detail = v_start::text;
    end if;
  end if;
  return new;   -- en UPDATE, acc_documents_20_immutable restringe qué columnas pueden cambiar
end;
$$;
create trigger acc_documents_10_period_guard
  before insert or update on public.acc_documents
  for each row execute function private.acc_tg_period_guard_documents();

-- 6.5 Guardia de período de las imputaciones
create function private.acc_tg_period_guard_allocations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_period public.acc_periods;
begin
  if tg_op = 'INSERT' then
    v_date := new.applied_on;                           -- el mes de applied_on existe y está abierto
  elsif new.voided_on is not null and old.voided_on is null then
    v_date := new.voided_on;                            -- desaplicar: el mes de voided_on abierto
  else
    return new;                                         -- cualquier otro UPDATE lo rechaza acc_allocations_20_biu
  end if;
  select * into v_period from public.acc_periods p
   where p.tenant_id = new.tenant_id and p.kind = 'month' and v_date between p.starts_on and p.ends_on
   for share;
  if not found then raise exception 'period_not_found' using errcode = 'P0001', detail = v_date::text; end if;
  if v_period.status <> 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_period.month, 'YYYY-MM');
  end if;
  return new;
end;
$$;
create trigger acc_allocations_10_period_guard
  before insert or update on public.acc_allocations
  for each row execute function private.acc_tg_period_guard_allocations();

-- 6.6 Líneas del diario: relleno desde la cabecera y chequeos
create function private.acc_tg_journal_lines_bi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.acc_journal_entries;
  a public.acc_accounts;
  v_status text;
  v_month date;
begin
  select * into e from public.acc_journal_entries x where x.id = new.entry_id and x.tenant_id = new.tenant_id;
  if not found then
    raise exception 'document_entry_mismatch' using errcode = 'P0001', detail = 'entry';
  end if;
  -- Copias inmutables de la cabecera: nunca del cliente.
  new.entry_date := e.entry_date;
  new.document_id := e.document_id;
  -- El renglón que se proyecta es de ese mismo comprobante.
  if not exists (select 1 from public.acc_document_lines dl
                  where dl.id = new.document_line_id and dl.tenant_id = new.tenant_id
                    and dl.document_id = e.document_id) then
    raise exception 'document_entry_mismatch' using errcode = 'P0001', detail = 'document_line';
  end if;
  -- Período del asiento abierto (FOR SHARE): bloquea insertar líneas sueltas en un asiento viejo.
  select p.status, p.month into v_status, v_month
    from public.acc_periods p where p.id = e.period_id and p.tenant_id = new.tenant_id for share;
  if v_status is distinct from 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_month, 'YYYY-MM');
  end if;
  select * into a from public.acc_accounts x where x.id = new.account_id and x.tenant_id = new.tenant_id;
  if not found then raise exception 'account_not_found' using errcode = 'P0001'; end if;
  if not a.postable then
    raise exception 'account_not_postable' using errcode = 'P0001', detail = a.code;
  end if;
  if not a.active and e.kind not in ('reversal', 'fy_closing', 'fy_opening') then
    raise exception 'account_inactive' using errcode = 'P0001', detail = a.code;
  end if;
  if e.kind in ('fy_closing', 'fy_opening') then
    -- Espejos: sin partícipe.
    if new.party_id is not null then
      raise exception 'party_not_allowed' using errcode = 'P0001', detail = a.code;
    end if;
  elsif a.requires_party and new.party_id is null then
    raise exception 'account_requires_party' using errcode = 'P0001', detail = a.code;
  elsif not a.requires_party and new.party_id is not null then
    raise exception 'party_not_allowed' using errcode = 'P0001', detail = a.code;
  end if;
  return new;
end;
$$;
create trigger acc_journal_lines_10_fill
  before insert on public.acc_journal_lines
  for each row execute function private.acc_tg_journal_lines_bi();

-- 6.7 Renglones y comprobantes fiscales: el documento es del mismo bar y su período está abierto
create function private.acc_tg_document_child_bi()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_accounting_date date;
  v_status text;
  v_month date;
begin
  select d.period_id, d.accounting_date into v_period_id, v_accounting_date
    from public.acc_documents d where d.id = new.document_id and d.tenant_id = new.tenant_id;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0001';
  end if;
  select p.status, p.month into v_status, v_month
    from public.acc_periods p where p.id = v_period_id for share;
  if v_status is distinct from 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_month, 'YYYY-MM');
  end if;
  -- Comprobante fiscal: el mes del libro es el mes de la fecha contable del documento.
  if tg_table_name = 'acc_fiscal_vouchers' then
    if to_jsonb(new) ->> 'period_month' <> to_char(v_accounting_date, 'YYYY-MM') || '-01' then
      raise exception 'fiscal_mismatch' using errcode = 'P0001', detail = 'period_month';
    end if;
  end if;
  return new;
end;
$$;
create trigger acc_document_lines_10_check
  before insert on public.acc_document_lines
  for each row execute function private.acc_tg_document_child_bi();
create trigger acc_fiscal_vouchers_10_check
  before insert on public.acc_fiscal_vouchers
  for each row execute function private.acc_tg_document_child_bi();

-- 6.8 Inmutabilidad total (salvo cascada del bar y el reinicio de I.6)
create function private.acc_tg_deny_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Borrado del bar: la fila de tenants ya no está; dejamos pasar la cascada.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  -- Reinicio antes del primer cierre: solo private.acc_reset_tenant pone esta marca (I.6).
  if tg_op = 'DELETE' and current_setting('acc.reset', true) = old.tenant_id::text then
    return old;
  end if;
  raise exception 'acc_immutable' using errcode = 'P0001', detail = tg_table_name;
end;
$$;
create trigger acc_document_lines_20_immutable
  before update or delete on public.acc_document_lines
  for each row execute function private.acc_tg_deny_change();
create trigger acc_journal_lines_20_immutable
  before update or delete on public.acc_journal_lines
  for each row execute function private.acc_tg_deny_change();
create trigger acc_bundles_20_immutable
  before update or delete on public.acc_bundles
  for each row execute function private.acc_tg_deny_change();
create trigger acc_period_events_20_immutable
  before update or delete on public.acc_period_events
  for each row execute function private.acc_tg_deny_change();

-- 6.9 Comprobantes fiscales: solo voided false → true, una vez, con el período abierto
create function private.acc_tg_fiscal_vouchers_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_month date;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then return old; end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_fiscal_vouchers';
  end if;
  if (to_jsonb(new) - 'voided') <> (to_jsonb(old) - 'voided') or old.voided or not new.voided then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_fiscal_vouchers';
  end if;
  select p.status, p.month into v_status, v_month
    from public.acc_documents d join public.acc_periods p on p.id = d.period_id
   where d.id = old.document_id and d.tenant_id = old.tenant_id
     for share of p;
  if v_status is distinct from 'open' then
    raise exception 'period_closed' using errcode = 'P0001', detail = to_char(v_month, 'YYYY-MM');
  end if;
  return new;
end;
$$;
create trigger acc_fiscal_vouchers_20_bu
  before update or delete on public.acc_fiscal_vouchers
  for each row execute function private.acc_tg_fiscal_vouchers_bu();

-- 6.10 Comprobantes: una sola transición, posted → voided (el período abierto lo verificó la guardia _10_)
create function private.acc_tg_documents_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep text[] := array['status', 'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then return old; end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_documents';
  end if;
  if (to_jsonb(new) - v_keep) <> (to_jsonb(old) - v_keep)
     or not (old.status = 'posted' and new.status = 'voided') then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_documents';
  end if;
  return new;
end;
$$;
create trigger acc_documents_20_immutable
  before update or delete on public.acc_documents
  for each row execute function private.acc_tg_documents_bu();

-- 6.11 Asientos: posted → voided y la numeración solo dentro del cierre/reapertura
create function private.acc_tg_entries_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- is_mirror y order_key son columnas generadas: en un BEFORE UPDATE NEW todavía no las tiene.
  v_keep text[] := array['status', 'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'number',
                         'is_mirror', 'order_key'];
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then return old; end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_journal_entries';
  end if;
  if (to_jsonb(new) - v_keep) <> (to_jsonb(old) - v_keep) then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_journal_entries';
  end if;
  -- number: solo cuando acc_close_period / acc_reopen_period / acc_close_fiscal_year /
  -- acc_reopen_fiscal_year marcaron ESTE período (y la guardia _10_ ya verificó que está abierto).
  if new.number is distinct from old.number
     and coalesce(current_setting('acc.numbering', true), '') <> old.period_id::text then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_journal_entries.number';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'posted' and new.status = 'voided') then
      raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_journal_entries.status';
    end if;
  elsif new.voided_at is distinct from old.voided_at or new.voided_by is distinct from old.voided_by
        or new.voided_by_name is distinct from old.voided_by_name or new.void_reason is distinct from old.void_reason then
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_journal_entries';
  end if;
  return new;
end;
$$;
create trigger acc_journal_entries_20_immutable
  before update or delete on public.acc_journal_entries
  for each row execute function private.acc_tg_entries_bu();

-- 6.12 Imputaciones (el corazón de los estados de cuenta)
create function private.acc_tg_allocations_biu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.acc_journal_lines;
  c public.acc_journal_lines;
  v_open_d bigint;
  v_open_c bigint;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    if current_setting('acc.reset', true) = old.tenant_id::text then return old; end if;
    raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_allocations';
  end if;
  if tg_op = 'UPDATE' then
    -- Solo se setea UNA vez la desaplicación (voided_on/at/by/reason/void_document_id).
    if (to_jsonb(new) - array['voided_on', 'voided_at', 'voided_by', 'void_reason', 'void_document_id', 'updated_at'])
       <> (to_jsonb(old) - array['voided_on', 'voided_at', 'voided_by', 'void_reason', 'void_document_id', 'updated_at'])
       or old.voided_on is not null or new.voided_on is null then
      raise exception 'acc_immutable' using errcode = 'P0001', detail = 'acc_allocations';
    end if;
    return new;
  end if;
  -- INSERT. Orden de id para que dos imputaciones concurrentes no se traben en deadlock.
  perform 1 from public.acc_journal_lines l where l.id in (new.debit_line_id, new.credit_line_id)
   order by l.id for no key update;
  select * into d from public.acc_journal_lines where id = new.debit_line_id and tenant_id = new.tenant_id;
  select * into c from public.acc_journal_lines where id = new.credit_line_id and tenant_id = new.tenant_id;
  if d.id is null or c.id is null then raise exception 'item_not_found' using errcode = 'P0001'; end if;
  if d.side <> 'debit' or c.side <> 'credit' then
    raise exception 'allocation_side_mismatch' using errcode = 'P0001';
  end if;
  if d.party_id is null or d.party_id <> c.party_id or d.account_id <> c.account_id
     or d.party_id <> new.party_id or d.account_id <> new.account_id then
    raise exception 'allocation_party_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_journal_entries e where e.id in (d.entry_id, c.entry_id)
               and (e.status <> 'posted' or e.is_mirror)) then
    raise exception 'item_voided' using errcode = 'P0001';
  end if;
  if new.applied_on < greatest(d.entry_date, c.entry_date) then
    raise exception 'allocation_date_invalid' using errcode = 'P0001';
  end if;
  v_open_d := public.acc_open_amount(d.id, null);
  v_open_c := public.acc_open_amount(c.id, null);
  if new.amount_cents > v_open_d or new.amount_cents > v_open_c then
    raise exception 'allocation_exceeds_open' using errcode = 'P0001',
      detail = format('{"debit_open":%s,"credit_open":%s}', v_open_d, v_open_c);
  end if;
  return new;
end;
$$;
create trigger acc_allocations_20_biu
  before insert or update or delete on public.acc_allocations
  for each row execute function private.acc_tg_allocations_biu();

-- 6.13 Cuadre diferido (la última red: corre al COMMIT)
create function private.acc_ctg_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_total bigint;
  v_d bigint;
  v_c bigint;
  v_n int;
begin
  -- IF (no CASE): en la instancia de acc_journal_entries NEW no tiene entry_id.
  if tg_table_name = 'acc_journal_entries' then
    v_entry := new.id;
  else
    v_entry := new.entry_id;
  end if;
  select e.total_cents into v_total from public.acc_journal_entries e where e.id = v_entry;
  if not found then return null; end if;                    -- borrado del bar en la misma transacción
  select count(*), coalesce(sum(l.amount_cents) filter (where l.side = 'debit'), 0),
         coalesce(sum(l.amount_cents) filter (where l.side = 'credit'), 0)
    into v_n, v_d, v_c
    from public.acc_journal_lines l where l.entry_id = v_entry;
  if v_n < 2 then raise exception 'entry_too_few_lines' using errcode = 'P0001', detail = v_entry::text; end if;
  if v_d <> v_c or v_d <> v_total then
    raise exception 'entry_not_balanced' using errcode = 'P0001',
      detail = format('{"entry":"%s","debit":%s,"credit":%s,"total":%s}', v_entry, v_d, v_c, v_total);
  end if;
  return null;
end;
$$;
create constraint trigger acc_entry_balanced_lines
  after insert on public.acc_journal_lines
  deferrable initially deferred
  for each row execute function private.acc_ctg_entry_balanced();
create constraint trigger acc_entry_balanced_entries
  after insert on public.acc_journal_entries
  deferrable initially deferred
  for each row execute function private.acc_ctg_entry_balanced();

-- 6.14 Comprobante con su asiento (diferido, al COMMIT)
create function private.acc_ctg_document_has_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_status text;
  v_n int;
  v_status text;
  v_missing int;
begin
  -- Estado ACTUAL del comprobante (no el del evento: puede haberse anulado en la misma transacción).
  select d.status into v_doc_status from public.acc_documents d where d.id = new.id;
  if not found then return null; end if;                    -- borrado del bar o reinicio en la misma transacción
  select count(*), max(e.status) into v_n, v_status
    from public.acc_journal_entries e where e.document_id = new.id and e.tenant_id = new.tenant_id;
  if v_n <> 1 then
    raise exception 'document_without_entry' using errcode = 'P0001', detail = new.id::text;
  end if;
  if v_status <> v_doc_status then
    raise exception 'document_entry_mismatch' using errcode = 'P0001', detail = new.id::text;
  end if;
  select count(*) into v_missing
    from public.acc_document_lines dl
   where dl.document_id = new.id
     and not exists (select 1 from public.acc_journal_lines jl
                      where jl.document_line_id = dl.id
                        and jl.account_id = dl.account_id and jl.side = dl.side and jl.amount_cents = dl.amount_cents
                        and jl.party_id is not distinct from dl.party_id);
  if v_missing > 0 then
    raise exception 'document_entry_mismatch' using errcode = 'P0001', detail = new.id::text;
  end if;
  return null;
end;
$$;
create constraint trigger acc_document_has_entry
  after insert or update of status on public.acc_documents
  deferrable initially deferred
  for each row execute function private.acc_ctg_document_has_entry();

-- 6.15 updated_at (corre último entre los BEFORE: su nombre no lleva número)
create trigger acc_access_updated_at before update on public.acc_access
  for each row execute function public.set_updated_at();
-- acc_settings: no se dispara si solo cambió doc_seq (lo incrementa cada comprobante; si no, cualquier
-- carga volvería «stale» el formulario de Ajustes, que usa updated_at como concurrencia optimista).
create trigger acc_settings_updated_at before update on public.acc_settings
  for each row
  when ((to_jsonb(old) - 'doc_seq' - 'updated_at') is distinct from (to_jsonb(new) - 'doc_seq' - 'updated_at'))
  execute function public.set_updated_at();
create trigger acc_periods_updated_at before update on public.acc_periods
  for each row execute function public.set_updated_at();
create trigger acc_accounts_updated_at before update on public.acc_accounts
  for each row execute function public.set_updated_at();
create trigger acc_parties_updated_at before update on public.acc_parties
  for each row execute function public.set_updated_at();
create trigger acc_treasury_accounts_updated_at before update on public.acc_treasury_accounts
  for each row execute function public.set_updated_at();
create trigger acc_sales_points_updated_at before update on public.acc_sales_points
  for each row execute function public.set_updated_at();
create trigger acc_sales_methods_updated_at before update on public.acc_sales_methods
  for each row execute function public.set_updated_at();
create trigger acc_recurring_expenses_updated_at before update on public.acc_recurring_expenses
  for each row execute function public.set_updated_at();
create trigger acc_documents_updated_at before update on public.acc_documents
  for each row execute function public.set_updated_at();
create trigger acc_allocations_updated_at before update on public.acc_allocations
  for each row execute function public.set_updated_at();

-- ─── 7. Grants de las funciones de trigger ──────────────────────────────────
revoke all on function private.acc_tg_accounts_biu() from public, anon, authenticated;
revoke all on function private.acc_tg_treasury_biu() from public, anon, authenticated;
revoke all on function private.acc_tg_period_guard_entries() from public, anon, authenticated;
revoke all on function private.acc_tg_period_guard_documents() from public, anon, authenticated;
revoke all on function private.acc_tg_period_guard_allocations() from public, anon, authenticated;
revoke all on function private.acc_tg_journal_lines_bi() from public, anon, authenticated;
revoke all on function private.acc_tg_document_child_bi() from public, anon, authenticated;
revoke all on function private.acc_tg_deny_change() from public, anon, authenticated;
revoke all on function private.acc_tg_fiscal_vouchers_bu() from public, anon, authenticated;
revoke all on function private.acc_tg_documents_bu() from public, anon, authenticated;
revoke all on function private.acc_tg_entries_bu() from public, anon, authenticated;
revoke all on function private.acc_tg_allocations_biu() from public, anon, authenticated;
revoke all on function private.acc_ctg_entry_balanced() from public, anon, authenticated;
revoke all on function private.acc_ctg_document_has_entry() from public, anon, authenticated;

notify pgrst, 'reload schema';
