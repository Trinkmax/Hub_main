-- ============================================================
-- Páginas HTML del bar — /p/[slug]
-- ============================================================
-- POR QUÉ: el encargado de marketing arma landings a mano (HTML + CSS) para
-- cada evento, promo o carta especial, y hoy no tiene dónde publicarlas. Las
-- terminaba subiendo a un hosting gratis con dominio ajeno y publicidad, o
-- directamente no las hacía. Esta tabla guarda ese HTML tal cual y lo sirve en
-- hubbar.com.ar/p/<slug>, con el link listo para pegar en una historia.
--
-- TRES TABLAS:
--   · landing_pages        — la página: slug, HTML publicado, interruptores.
--   · landing_page_versions— una foto del HTML en cada publicación (últimas 20).
--                            Es la red de seguridad para el viernes a la noche.
--   · landing_page_views   — rollup por día, para el gráfico de visitas.
--
-- EL SLUG ES GLOBAL. `/p/promo-jueves` no lleva el bar adentro, así que el
-- unique no puede ser (tenant_id, slug) sino sobre `slug` a secas — mismo
-- criterio que `customer_capture_links.slug`. El editor avisa si está tomado.
--
-- CÓMO SE SIRVE: un Route Handler (app/p/[slug]/route.ts) devuelve el HTML
-- byte a byte con `createServiceClient()`. Por eso NO hay grant a `anon`: el
-- HTML es del bar y hasta que lo publica no lo ve nadie. Y por eso el handler
-- manda `Content-Security-Policy: sandbox` — sin `allow-same-origin` el
-- documento queda en un origen opaco y NO puede leer `document.cookie` (las
-- cookies de sesión de @supabase/ssr son httpOnly:false por diseño, o sea
-- legibles por JS del mismo origen). Sin ese header, una landing con un
-- <script> pegado de internet se llevaría la sesión de cualquiera que la abra.
--
-- LAS IMÁGENES no viven acá: van al bucket `landing-media` (abajo), una
-- carpeta por bar, y en el HTML entran como URL absoluta de Supabase.
-- ============================================================

-- ──────────────────────────────────────────────
-- La página
-- ──────────────────────────────────────────────

create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Lo que va después de /p/. Minúsculas, números y guiones; 2 a 40 caracteres.
  -- Global: dos bares no pueden tener el mismo.
  slug text not null unique
    constraint landing_pages_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  -- Nombre interno, el que se lee en la lista del panel. No sale publicado:
  -- el título que ve la gente es el <title> del HTML.
  title text not null check (length(btrim(title)) between 1 and 80),

  -- El documento entero, tal cual lo pegó marketing. 512 KB es un techo
  -- generoso para HTML+CSS+JS inline y a la vez frena que se use la DB como
  -- hosting de imágenes en base64 (para eso está el bucket).
  html text not null default ''
    constraint landing_pages_html_size_check check (length(html) <= 524288),

  -- Apagada, /p/<slug> devuelve 404. Nace apagada: primero se ve la previa.
  published boolean not null default false,
  -- Si Google la puede indexar. Por defecto NO: una landing a medio hacer no
  -- tiene por qué quedar en el buscador, y el dominio es el mismo que el del
  -- panel — su reputación es compartida.
  indexable boolean not null default false,

  -- Contadores. Los escribe bump_landing_view() con service_role; el trigger
  -- de updated_at los ignora a propósito (ver más abajo).
  views bigint not null default 0,
  last_viewed_at timestamptz,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Para las FK compuestas de las hijas: garantiza que una versión o una
  -- visita no puedan colgar de una página de OTRO bar (RLS filtra filas al
  -- leer, no valida valores al escribir).
  unique (id, tenant_id)
);

comment on table public.landing_pages is
  'Landings HTML que el bar publica en /p/[slug]. El slug es único en toda la plataforma.';
comment on column public.landing_pages.html is
  'Documento HTML crudo. Se sirve byte a byte con CSP sandbox — nunca se interpola ni se pasa por un template.';
comment on column public.landing_pages.indexable is
  'Si Google puede indexarla. Default false: el handler manda X-Robots-Tag noindex mientras esté apagado.';
comment on column public.landing_pages.views is
  'Visitas acumuladas. Lo incrementa bump_landing_view(); no toca updated_at.';

create index if not exists landing_pages_tenant_idx
  on public.landing_pages (tenant_id, updated_at desc);

-- El trigger de updated_at NO se dispara cuando lo único que cambió fue el
-- contador de visitas: si no, "última edición" en el panel mostraría la hora
-- del último visitante y el dueño pensaría que alguien le tocó la página.
drop trigger if exists landing_pages_updated_at on public.landing_pages;
create trigger landing_pages_updated_at
  before update on public.landing_pages
  for each row
  when (
    old.html is distinct from new.html
    or old.title is distinct from new.title
    or old.slug is distinct from new.slug
    or old.published is distinct from new.published
    or old.indexable is distinct from new.indexable
  )
  execute function public.set_updated_at();

alter table public.landing_pages enable row level security;

drop policy if exists "landing_pages_owner_all" on public.landing_pages;
create policy "landing_pages_owner_all" on public.landing_pages
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.landing_pages to authenticated;
revoke all on public.landing_pages from anon;

-- ──────────────────────────────────────────────
-- Historial: una foto por publicación
-- ──────────────────────────────────────────────

create table if not exists public.landing_page_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id uuid not null,

  html text not null
    constraint landing_page_versions_html_size_check check (length(html) <= 524288),
  -- Qué fue: 'Publicada', 'Restaurada del 3/9 14:20'… Texto humano para la lista.
  label text check (label is null or length(btrim(label)) <= 80),
  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),

  -- Compuesta: la versión y la página tienen que ser del MISMO bar.
  constraint landing_page_versions_page_fk
    foreign key (page_id, tenant_id)
    references public.landing_pages(id, tenant_id) on delete cascade
);

comment on table public.landing_page_versions is
  'Historial de HTML de cada landing (últimas 20 por página; la poda la hace la Server Action).';

create index if not exists landing_page_versions_page_idx
  on public.landing_page_versions (tenant_id, page_id, created_at desc);

alter table public.landing_page_versions enable row level security;

drop policy if exists "landing_page_versions_owner_all" on public.landing_page_versions;
create policy "landing_page_versions_owner_all" on public.landing_page_versions
  for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on public.landing_page_versions to authenticated;
revoke all on public.landing_page_versions from anon;

-- ──────────────────────────────────────────────
-- Visitas por día (para el gráfico del panel)
-- ──────────────────────────────────────────────

create table if not exists public.landing_page_views (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  page_id uuid not null,
  -- Día en la zona horaria DEL BAR, no en UTC: una visita de la 1 AM del
  -- sábado en Córdoba tiene que contar como sábado.
  day date not null,
  views integer not null default 0,

  primary key (page_id, day),
  constraint landing_page_views_page_fk
    foreign key (page_id, tenant_id)
    references public.landing_pages(id, tenant_id) on delete cascade
);

comment on table public.landing_page_views is
  'Rollup diario de visitas por landing, en la zona horaria del bar. Lo escribe bump_landing_view().';

create index if not exists landing_page_views_tenant_idx
  on public.landing_page_views (tenant_id, page_id, day desc);

alter table public.landing_page_views enable row level security;

drop policy if exists "landing_page_views_owner_read" on public.landing_page_views;
create policy "landing_page_views_owner_read" on public.landing_page_views
  for select to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- Sólo lectura para el panel: las visitas las escribe la función de abajo con
-- service_role. Nadie con sesión puede inflar el contador a mano.
grant select on public.landing_page_views to authenticated;
revoke all on public.landing_page_views from anon;

-- ──────────────────────────────────────────────
-- Contador de visitas (una sola sentencia, sin carrera)
-- ──────────────────────────────────────────────
-- El Route Handler no puede hacer select + update: dos requests simultáneos
-- se pisarían y encima serían dos viajes a la DB por visita. Esto suma en
-- forma atómica y de paso resuelve el día en la zona del bar.

create or replace function public.bump_landing_view(p_page uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_day date;
begin
  select lp.tenant_id, (now() at time zone coalesce(t.timezone, 'America/Argentina/Cordoba'))::date
    into v_tenant, v_day
  from public.landing_pages lp
  join public.tenants t on t.id = lp.tenant_id
  where lp.id = p_page;

  -- La página se borró entre el render y el contador: no es un error.
  if v_tenant is null then
    return;
  end if;

  update public.landing_pages
     set views = views + 1,
         last_viewed_at = now()
   where id = p_page;

  insert into public.landing_page_views as v (tenant_id, page_id, day, views)
  values (v_tenant, p_page, v_day, 1)
  on conflict (page_id, day) do update set views = v.views + 1;
end;
$$;

comment on function public.bump_landing_view(uuid) is
  'Suma una visita a la landing (total + rollup del día en la zona del bar). Sólo la llama el Route Handler con service_role.';

revoke execute on function public.bump_landing_view(uuid) from public, anon, authenticated;

-- ──────────────────────────────────────────────
-- Bucket de imágenes de las landings
-- ──────────────────────────────────────────────
-- Público (las abre cualquiera que entre a la landing) y con allowlist de MIME:
-- sin eso alguien sube un .html y tendría HTML activo en el dominio de Supabase.
-- Sin SVG a propósito — es contenido activo, no una imagen.
-- El GIF sí entra: media promo del bar es gif animado la mitad de las veces.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'landing-media',
  'landing-media',
  true,
  10485760, -- 10 MB
  array['image/webp', 'image/avif', 'image/jpeg', 'image/png', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Una carpeta por bar: `{tenant_id}/archivo.webp`. El guard del regex evita que
-- un name sin uuid adelante haga fallar el cast (sería un error de statement,
-- no un simple "denegado").
drop policy if exists "landing_media_public_read" on storage.objects;
create policy "landing_media_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'landing-media');

drop policy if exists "landing_media_owner_insert" on storage.objects;
create policy "landing_media_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'landing-media'
    and name ~ '^[0-9a-fA-F-]{36}/'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) = 'owner'
  );

drop policy if exists "landing_media_owner_update" on storage.objects;
create policy "landing_media_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'landing-media'
    and name ~ '^[0-9a-fA-F-]{36}/'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) = 'owner'
  );

drop policy if exists "landing_media_owner_delete" on storage.objects;
create policy "landing_media_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'landing-media'
    and name ~ '^[0-9a-fA-F-]{36}/'
    and public.user_role_in_tenant((string_to_array(name, '/'))[1]::uuid) = 'owner'
  );

notify pgrst, 'reload schema';
