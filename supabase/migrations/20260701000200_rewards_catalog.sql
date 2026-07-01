-- ============================================================
-- Catálogo de canje: categoría + visibilidad
-- ============================================================
-- `category`      → agrupa el catálogo (Desayuno/Almuerzo/Cena/Eventos…). Texto
--                   libre (multi-tenant); la UI ofrece las 4 canónicas + agrupa
--                   las desconocidas al final.
-- `visible_in_catalog` → separa las recompensas del CATÁLOGO de canje de las
--                   recompensas "de beneficio" (café del club, etc.) que sólo se
--                   usan como target de un tier_benefit / welcome y no se listan.
--
-- Regenerar types/database.ts tras esta migración.
-- ============================================================

alter table public.rewards
  add column if not exists category text
    check (category is null or length(category) <= 40),
  add column if not exists visible_in_catalog boolean not null default true;

create index if not exists rewards_catalog_idx
  on public.rewards(tenant_id, cost_points) where visible_in_catalog = true;
