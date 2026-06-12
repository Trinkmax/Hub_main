-- Rediseño loyalty-first — Fase 1: acento de marca por tenant.
--
-- Color de marca del bar (hex #RRGGBB), inyectado como CSS custom property en las
-- superficies públicas (carta, wallet, reseña) sin tocar el theme global light/dark.

alter table public.tenants
  add column if not exists brand_accent text
  check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$');

comment on column public.tenants.brand_accent is
  'Color de marca del bar (hex #RRGGBB). Inyectado como var CSS en superficies públicas. NULL = usar el primary por defecto.';
