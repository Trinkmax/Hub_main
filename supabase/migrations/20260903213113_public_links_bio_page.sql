-- ============================================================
-- Link público del bar (link-in-bio para Instagram) — /l/[slug]
-- ============================================================
-- POR QUÉ: la bio de Instagram acepta UN link y el bar tiene cinco destinos
-- (carta, reservas por WhatsApp, delivery, acciones con sponsors…). Hoy eso
-- vive en un Biolink de terceros: con su marca abajo, sin el branding del bar,
-- y editable sólo por quien tenga esa contraseña suelta. Esta es la misma
-- página, servida por HUB, editable desde el panel y con la identidad del bar.
--
-- DOS TABLAS:
--   · public_link_pages — la cabecera: título, bajada, y el interruptor
--     general. Una fila por bar (el tenant_id ES la PK).
--   · public_links      — los botones, ordenables y apagables de a uno.
--
-- LECTURA PÚBLICA: la página /l la sirve un Server Component con
-- `createServiceClient()` filtrando por tenant_id, igual que /carta. Por eso
-- NO hay grant a `anon` acá: `public.tenants` tampoco es legible por anon y
-- abrirlo sólo para esto expondría feature_flags, teléfonos y config de puntos.
-- ============================================================

-- ──────────────────────────────────────────────
-- Cabecera de la página
-- ──────────────────────────────────────────────

create table if not exists public.public_link_pages (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Título grande. Si queda vacío, la página cae al nombre del bar.
  headline text check (headline is null or length(btrim(headline)) <= 80),
  -- La bajada de una o dos líneas ("Tragos, comida y cafetería en Alta Córdoba").
  bio text check (bio is null or length(btrim(bio)) <= 280),
  -- Interruptor general: apagada, /l devuelve 404 en vez de una página vacía.
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.public_link_pages is
  'Cabecera de la página pública de links (/l/[slug]). Una fila por bar; el tenant_id es la PK.';

drop trigger if exists public_link_pages_updated_at on public.public_link_pages;
create trigger public_link_pages_updated_at
  before update on public.public_link_pages
  for each row execute function public.set_updated_at();

alter table public.public_link_pages enable row level security;

drop policy if exists "public_link_pages_owner_all" on public.public_link_pages;
create policy "public_link_pages_owner_all" on public.public_link_pages
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.public_link_pages to authenticated;
revoke all on public.public_link_pages from anon;

-- ──────────────────────────────────────────────
-- Los botones
-- ──────────────────────────────────────────────

create table if not exists public.public_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  label text not null check (length(btrim(label)) between 1 and 80),
  -- Bajada chiquita bajo el título del botón. Opcional.
  description text check (description is null or length(btrim(description)) <= 120),
  -- Se valida en el borde con zod (http/https únicamente). Acá sólo el largo:
  -- los links de WhatsApp con texto pre-cargado se van arriba de 500 chars.
  url text not null check (length(btrim(url)) between 1 and 2000),
  -- Clave de ícono (lucide) elegida por el dueño. null = flecha por defecto.
  icon text check (icon is null or length(icon) <= 40),
  -- El botón "principal" (relleno sólido en vez de contorno). Para el destino
  -- que el bar quiere empujar esta semana.
  highlight boolean not null default false,

  position int not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.public_links is
  'Botones de la página pública de links (/l/[slug]), ordenables por position.';
comment on column public.public_links.highlight is
  'Botón destacado: se pinta sólido. Pensado para el destino que el bar empuja esta semana.';

create index if not exists public_links_tenant_idx
  on public.public_links (tenant_id, active, position);

drop trigger if exists public_links_updated_at on public.public_links;
create trigger public_links_updated_at
  before update on public.public_links
  for each row execute function public.set_updated_at();

alter table public.public_links enable row level security;

drop policy if exists "public_links_owner_all" on public.public_links;
create policy "public_links_owner_all" on public.public_links
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.public_links to authenticated;
revoke all on public.public_links from anon;

notify pgrst, 'reload schema';
