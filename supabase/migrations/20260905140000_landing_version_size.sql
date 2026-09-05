-- ============================================================
-- Peso de cada versión, calculado en la DB
-- ============================================================
-- POR QUÉ: el historial del editor muestra "12 KB" al lado de cada versión, y
-- para calcularlo estaba trayendo el HTML ENTERO de las 20 versiones — hasta
-- 10 MB de Postgres al server en cada carga del editor (la ruta es
-- `force-dynamic`, así que también en cada `router.refresh()` después de
-- guardar) sólo para hacer un `.length` y tirar el texto.
--
-- Con la columna generada, el listado pide cuatro campos chicos y el HTML se
-- baja únicamente cuando el dueño mira o restaura una versión puntual.
-- `length(text)` es inmutable, así que Postgres la acepta como STORED.
-- ============================================================

alter table public.landing_page_versions
  add column if not exists size_chars integer
  generated always as (length(html)) stored;

comment on column public.landing_page_versions.size_chars is
  'Largo del HTML en caracteres. Existe para que el historial no tenga que traer el documento entero.';

notify pgrst, 'reload schema';
