-- ============================================================
-- Entradas online — películas a la venta, pedidos y la cuenta de Mercado Pago
-- ============================================================
-- POR QUÉ: Cine y degustación se agota y la gente igual manda señas por
-- WhatsApp para fechas que ya no tienen lugar; Luz las recibe, las carga a
-- mano y después hay que devolver plata. Los socios pidieron (23/10/2026) una
-- cartelera pública con todas las funciones, «Agotado» en las llenas, la
-- página de cada película y el pago ahí mismo con Mercado Pago: seña por
-- persona o el total. Cuando Mercado Pago confirma, la reserva se crea sola.
--
-- TRES TABLAS:
--   · event_experiences  — la página pública de un FORMATO del calendario
--                          (Shrek, Ratatouille…): textos, afiche, menú paso a
--                          paso, escenas y precios. 1:1 con el formato: las
--                          fechas a la venta son sus `scheduled_events`.
--   · ticketing_settings — la configuración del bar: la cuenta de Mercado Pago
--                          (token CIFRADO), a nombre de qué gestor quedan las
--                          reservas, cuánto se guarda el lugar y los textos de
--                          la cartelera.
--   · ticket_orders      — cada intento de compra. Nace «pending» guardando el
--                          lugar unos minutos (hold) y pasa a «approved» cuando
--                          Mercado Pago confirma: ahí se crea la reserva.
--
-- QUIÉN ESCRIBE: el panel (dueño) escribe experiencias y configuración con su
-- sesión y RLS. Los pedidos los escribe SOLO el server con service_role, a
-- través de las funciones de 20261026120200: la compra la hace alguien sin
-- cuenta y la confirma un webhook. Por eso ticket_orders no tiene ninguna
-- policy de escritura.
-- ============================================================

-- ──────────────────────────────────────────────
-- Respaldos para las FK compuestas (que un hijo no pueda colgar de una fila
-- de OTRO bar: la RLS filtra al leer, no valida valores al escribir). Son
-- lógicamente nulos: `id` ya es PK. Mismo patrón que
-- scheduled_events_id_tenant_unique y landing_pages_id_tenant_id_key.
-- ──────────────────────────────────────────────

alter table public.scheduled_event_templates
  add constraint scheduled_event_templates_id_tenant_unique unique (id, tenant_id);

alter table public.reservation_managers
  add constraint reservation_managers_id_tenant_unique unique (id, tenant_id);

-- ──────────────────────────────────────────────
-- La página de una película (o de cualquier formato del calendario)
-- ──────────────────────────────────────────────

create table if not exists public.event_experiences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,

  -- /entradas/<bar>/<slug>. «mi-entrada» queda reservado para la entrada del
  -- cliente (/entradas/<bar>/mi-entrada/<pedido>).
  slug text not null
    constraint event_experiences_slug_check
      check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$' and slug <> 'mi-entrada'),
  -- Apagada no aparece en la cartelera y su página da 404. Nace apagada.
  published boolean not null default false,

  -- «Cine y degustación»: agrupa la cartelera cuando hay más de una colección.
  series text check (char_length(series) <= 60),
  title text not null check (length(btrim(title)) between 1 and 80),
  tagline text check (char_length(tagline) <= 160),
  synopsis text check (char_length(synopsis) <= 1500),
  -- Texto libre del horario: «Ingreso 21:00 · Película 21:20».
  schedule_note text check (char_length(schedule_note) <= 120),

  -- URLs públicas del bucket `landing-media` (carpeta del bar).
  poster_url text check (char_length(poster_url) <= 600),
  hero_url text check (char_length(hero_url) <= 600),
  accent_hex text check (accent_hex ~ '^#[0-9a-fA-F]{6}$'),

  -- Los pasos del menú: [{ icon, title, description, label? }]. Vacío = «el
  -- menú todavía se está armando» (steps_note lo explica).
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 16),
  steps_note text check (char_length(steps_note) <= 400),
  -- Fotos: [{ url, caption?, kind: 'scene' | 'venue' }]. «scene» = de la
  -- película; «venue» = fotos reales de una función en el bar.
  gallery jsonb not null default '[]'::jsonb
    check (jsonb_typeof(gallery) = 'array' and jsonb_array_length(gallery) <= 24),

  -- Precios POR PERSONA, en centavos. `price_cents` es lo que se cobra si
  -- pagan todo online; `deposit_cents` la seña (el resto se paga en efectivo
  -- en el bar). Seña 0 = solo se ofrece el pago total.
  price_cents bigint not null check (price_cents between 100 and 100000000),
  deposit_cents bigint not null default 0,
  max_party_size integer not null default 10 check (max_party_size between 1 and 30),
  terms text check (char_length(terms) <= 800),
  sort_order integer not null default 0,

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, tenant_id),
  constraint event_experiences_tenant_slug_key unique (tenant_id, slug),
  constraint event_experiences_one_per_template unique (template_id),
  constraint event_experiences_template_same_tenant foreign key (template_id, tenant_id)
    references public.scheduled_event_templates (id, tenant_id) on delete cascade,
  constraint event_experiences_deposit_below_price
    check (deposit_cents >= 0 and deposit_cents < price_cents)
);

comment on table public.event_experiences is
  'Página pública de un formato del calendario en /entradas/<bar>/<slug>: textos, afiche, menú, escenas y precios por persona. Las fechas a la venta son los scheduled_events del formato.';
comment on column public.event_experiences.price_cents is
  'Precio por persona si se paga todo online (centavos).';
comment on column public.event_experiences.deposit_cents is
  'Seña por persona (centavos). El resto se paga en efectivo en el bar. 0 = sin opción de seña.';

create index if not exists event_experiences_tenant_published_idx
  on public.event_experiences (tenant_id, published, sort_order);

drop trigger if exists event_experiences_updated_at on public.event_experiences;
create trigger event_experiences_updated_at
  before update on public.event_experiences
  for each row execute function public.set_updated_at();

alter table public.event_experiences enable row level security;

drop policy if exists "event_experiences_owner_all" on public.event_experiences;
create policy "event_experiences_owner_all" on public.event_experiences
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- La página pública la arma el server con service_role: nada para `anon`.
grant select, insert, update, delete on public.event_experiences to authenticated;
revoke all on public.event_experiences from anon;

-- ──────────────────────────────────────────────
-- La configuración de las entradas del bar
-- ──────────────────────────────────────────────

create table if not exists public.ticketing_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Mercado Pago: cada bar cobra en SU cuenta. El token y la clave de los
  -- webhooks van cifrados con pgp_sym_encrypt (encrypt_meta_token, clave en el
  -- entorno del server) y NUNCA se pueden leer desde el navegador: el GRANT de
  -- SELECT de abajo es por columna y los deja afuera.
  mp_access_token_enc text,
  mp_webhook_secret_enc text,
  mp_user_id bigint,
  mp_nickname text check (char_length(mp_nickname) <= 120),
  -- false = credenciales de prueba (sandbox).
  mp_live boolean,
  mp_connected_at timestamptz,
  mp_connected_by uuid references auth.users(id) on delete set null,

  -- A nombre de quién quedan las reservas que entran pagadas. Decisión de los
  -- dueños (26/10/2026): un gestor «Venta online» que no cobra comisión. NULL
  -- = se crea solo en la primera venta.
  online_manager_id uuid,
  -- Cuánto se le guarda el lugar a quien está pagando.
  hold_minutes integer not null default 15 check (hold_minutes between 5 and 60),

  -- La cartelera.
  headline text check (char_length(headline) <= 80),
  intro text check (char_length(intro) <= 500),
  venue_address text check (char_length(venue_address) <= 160),
  -- WhatsApp para consultas y para «avisame si se libera un lugar».
  contact_whatsapp text check (contact_whatsapp ~ '^\+[1-9][0-9]{7,14}$'),

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ticketing_settings_manager_same_tenant foreign key (online_manager_id, tenant_id)
    references public.reservation_managers (id, tenant_id),
  -- La cuenta está conectada entera o no está.
  constraint ticketing_settings_mp_complete
    check ((mp_access_token_enc is null) = (mp_connected_at is null))
);

comment on table public.ticketing_settings is
  'Configuración de las entradas online del bar: cuenta de Mercado Pago (cifrada), gestor de las reservas online, minutos de hold y textos de la cartelera.';
comment on column public.ticketing_settings.mp_access_token_enc is
  'Access token de Mercado Pago cifrado con pgp_sym_encrypt. Solo lo descifra el server (service_role).';

drop trigger if exists ticketing_settings_updated_at on public.ticketing_settings;
create trigger ticketing_settings_updated_at
  before update on public.ticketing_settings
  for each row execute function public.set_updated_at();

alter table public.ticketing_settings enable row level security;

drop policy if exists "ticketing_settings_owner_all" on public.ticketing_settings;
create policy "ticketing_settings_owner_all" on public.ticketing_settings
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- GRANTs POR COLUMNA:
--   · SELECT: el navegador del dueño ve todo MENOS el token y la clave
--     cifrados (ni siquiera el texto cifrado).
--   · INSERT/UPDATE: solo lo que se edita a mano. La conexión con Mercado Pago
--     (token, clave, cuenta, modo) la escribe el server con service_role
--     DESPUÉS de verificar el token contra Mercado Pago: así nadie puede dejar
--     una cuenta «conectada» que no existe ni pisar el token desde la API.
revoke all on public.ticketing_settings from anon, authenticated;
grant select (
  tenant_id, mp_user_id, mp_nickname, mp_live, mp_connected_at, mp_connected_by,
  online_manager_id, hold_minutes, headline, intro, venue_address, contact_whatsapp,
  updated_by, created_at, updated_at
) on public.ticketing_settings to authenticated;
grant insert (
  tenant_id, online_manager_id, hold_minutes, headline, intro, venue_address,
  contact_whatsapp, updated_by
) on public.ticketing_settings to authenticated;
grant update (
  online_manager_id, hold_minutes, headline, intro, venue_address, contact_whatsapp, updated_by
) on public.ticketing_settings to authenticated;

-- ──────────────────────────────────────────────
-- Los pedidos
-- ──────────────────────────────────────────────

create table if not exists public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  experience_id uuid,
  scheduled_event_id uuid,

  -- Foto del momento de la compra: la entrada del cliente tiene que decir lo
  -- mismo aunque después se edite la película o se mueva la fecha.
  title text not null check (length(btrim(title)) between 1 and 80),
  event_date date not null,
  event_time time not null,
  meal_type public.meal_type not null,

  party_size integer not null check (party_size between 1 and 30),
  payment_option text not null check (payment_option in ('deposit', 'full')),
  -- Lo que se cobra ahora por persona (la seña o el total).
  unit_price_cents bigint not null check (unit_price_cents > 0),
  -- El precio total por persona: con la seña, el resto en efectivo es
  -- (full_price_cents - unit_price_cents) × party_size.
  full_price_cents bigint not null check (full_price_cents >= unit_price_cents),
  total_cents bigint not null,

  guest_name text not null check (length(btrim(guest_name)) between 2 and 120),
  guest_phone text not null check (guest_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Opt-in de marketing explícito (casilla sin tildar por defecto) + IP para
  -- dejarlo registrado en la ficha del cliente (CLAUDE.md §8).
  marketing_opt_in boolean not null default false,
  client_ip text check (char_length(client_ip) <= 64),

  -- pending  → esperando el pago (guarda el lugar hasta hold_expires_at)
  -- rejected → Mercado Pago lo rechazó; mientras dure el hold puede reintentar
  -- approved → pagó: la reserva ya existe (reservation_id)
  -- refunded → Mercado Pago devolvió el pago (o contracargo)
  -- «Vencido» no es un estado: es pending/rejected con el hold en el pasado.
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'approved', 'refunded')),
  hold_expires_at timestamptz not null,

  mp_preference_id text,
  mp_payment_id text,
  mp_status text,
  mp_status_detail text,
  mp_payment_type text,
  paid_cents bigint check (paid_cents >= 0),
  paid_at timestamptz,

  reservation_id uuid references public.salon_reservations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  -- Algo para que mire una persona: overbooked (pagó cuando ya no quedaba
  -- lugar), event_missing (borraron la fecha), amount_mismatch (pagó menos de
  -- lo esperado), duplicate_payment (dos pagos aprobados para un pedido).
  attention text
    check (attention in ('overbooked', 'event_missing', 'amount_mismatch', 'duplicate_payment')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ticket_orders_total_matches check (total_cents = unit_price_cents * party_size),
  constraint ticket_orders_tenant_payment_key unique (tenant_id, mp_payment_id),
  -- Si borran la película o la fecha, el pedido queda (es plata) con su foto.
  constraint ticket_orders_experience_same_tenant foreign key (experience_id, tenant_id)
    references public.event_experiences (id, tenant_id) on delete set null (experience_id),
  constraint ticket_orders_event_same_tenant foreign key (scheduled_event_id, tenant_id)
    references public.scheduled_events (id, tenant_id) on delete set null (scheduled_event_id)
);

comment on table public.ticket_orders is
  'Compras de entradas online. pending guarda el lugar hasta hold_expires_at; approved = pagó y la reserva existe. Solo las escribe el server (service_role).';

-- El conteo de lugares guardados (holds) por función entra por acá.
create index if not exists ticket_orders_event_hold_idx
  on public.ticket_orders (scheduled_event_id, status, hold_expires_at);
create index if not exists ticket_orders_tenant_created_idx
  on public.ticket_orders (tenant_id, created_at desc);
create index if not exists ticket_orders_reservation_idx
  on public.ticket_orders (reservation_id);
create index if not exists ticket_orders_customer_idx
  on public.ticket_orders (customer_id);
create index if not exists ticket_orders_experience_idx
  on public.ticket_orders (experience_id);

drop trigger if exists ticket_orders_updated_at on public.ticket_orders;
create trigger ticket_orders_updated_at
  before update on public.ticket_orders
  for each row execute function public.set_updated_at();

alter table public.ticket_orders enable row level security;

-- Es plata: solo el dueño lo lee desde el panel. Sin policies de escritura.
drop policy if exists "ticket_orders_owner_select" on public.ticket_orders;
create policy "ticket_orders_owner_select" on public.ticket_orders
  for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

revoke all on public.ticket_orders from anon, authenticated;
grant select on public.ticket_orders to authenticated;

-- ──────────────────────────────────────────────
-- service_role, EXPLÍCITO
-- ──────────────────────────────────────────────
-- Las páginas públicas, la compra y el webhook leen y escriben con
-- service_role. Hoy lo cubren los default privileges del proyecto, pero
-- Supabase los retira para los proyectos existentes desde el 30/10/2026
-- (también para service_role: docs «Securing your API»). Sin estos GRANT,
-- una tabla creada después de esa fecha daría 42501 en todo el flujo público.
grant select, insert, update, delete on public.event_experiences to service_role;
grant select, insert, update, delete on public.ticketing_settings to service_role;
grant select, insert, update, delete on public.ticket_orders to service_role;

notify pgrst, 'reload schema';
