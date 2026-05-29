-- Redención de puntos como descuento en el cobro — schema.
--
-- Cambios:
--   1. tenants  → flag enabled + tasa puntos→centavos + cap %
--   2. table_sessions → total redimido + breakdown jsonb para auditoría
--
-- Default enabled=false: bares existentes no notan cambio hasta activar.
-- Cap default 50% es una sugerencia neutra; el owner lo ajusta cuando activa.

alter table public.tenants
  add column if not exists points_redemption_enabled boolean not null default false;

alter table public.tenants
  add column if not exists points_to_cents_rate int not null default 100
  check (points_to_cents_rate > 0);

alter table public.tenants
  add column if not exists points_redemption_max_pct numeric(5,2) not null default 50.00
  check (points_redemption_max_pct >= 0 and points_redemption_max_pct <= 100);

comment on column public.tenants.points_redemption_enabled is
  'Permite usar saldo de puntos como descuento al cobrar una sesión.';
comment on column public.tenants.points_to_cents_rate is
  'Centavos que vale 1 punto al redimir. 100 = 1pt → $1.';
comment on column public.tenants.points_redemption_max_pct is
  'Porcentaje máximo del share del cliente que puede cubrirse con puntos.';

alter table public.table_sessions
  add column if not exists points_redeemed_cents bigint not null default 0
  check (points_redeemed_cents >= 0);

alter table public.table_sessions
  add column if not exists points_redemptions jsonb not null default '[]'::jsonb;

comment on column public.table_sessions.points_redeemed_cents is
  'Suma de descuentos por redención de puntos aplicados al cobrar la sesión.';
comment on column public.table_sessions.points_redemptions is
  'Breakdown [{customer_id, points_used, redeem_cents}] para auditoría.';
