-- Fase 4 — Reseñas: 1–4★ feedback privado, 5★ → Google Maps (gating toggleable).
--
-- NOTA DE POLÍTICA: el "review gating" (mandar solo 5★ a Google) viola las políticas
-- de Google y puede penalizar la ficha. Por eso review_gating_enabled es un toggle:
-- el dueño puede apagarlo y mandar TODAS las reseñas a Maps.

-- ──────────────────────────────────────────────────────────
-- 1. Config en tenants
-- ──────────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists google_maps_review_url text,
  add column if not exists review_gating_enabled boolean not null default true,
  add column if not exists review_reward_points int not null default 0
    check (review_reward_points >= 0);

comment on column public.tenants.review_gating_enabled is
  'Si true y rating=5 → redirige a Google Maps; 1–4 quedan como feedback privado. Google desaconseja el gating; permitir apagarlo.';

-- ──────────────────────────────────────────────────────────
-- 2. reviews
-- ──────────────────────────────────────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  visit_id uuid references public.visits(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comment text,
  source text not null default 'wallet' check (source in ('wallet', 'whatsapp', 'qr', 'manual')),
  redirected_to_maps boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_tenant_created_idx on public.reviews(tenant_id, created_at desc);
create index reviews_customer_idx on public.reviews(customer_id);

alter table public.reviews enable row level security;

-- Miembros del tenant leen las reseñas de su bar.
create policy "reviews_tenant_read" on public.reviews for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- owner/cashier pueden borrar (moderación). Inserts: SOLO service-role (flujo público
-- desde la server action) — sin policy de insert para authenticated.
create policy "reviews_staff_delete" on public.reviews for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));

-- Data API GRANTs. Sin anon: el insert público va por la server action con service-role.
grant select, delete on public.reviews to authenticated;
