-- Sucursales en todo el sistema · tanda 6 (lo provisorio de la tanda 2): las reglas viejas de cupo.
--
-- Hasta que el código nuevo estuvo en producción, los guardados de cupo usaban las reglas «una fila por bar». El
-- código nuevo guarda contra las reglas por sucursal (`ssc_one_per_day_branch`, `sss_one_per_segment_branch`,
-- `ssco_one_per_day_branch`), así que las viejas sobran y además impedirían que una segunda sucursal tenga su
-- propio cupo. Se aplica DESPUÉS del deploy del código nuevo.

set local lock_timeout = '5s';

alter table public.salon_segment_capacities drop constraint ssc_one_per_day;
alter table public.salon_segment_settings drop constraint sss_one_per_segment;
alter table public.salon_segment_capacity_overrides drop constraint ssco_one_per_day;

notify pgrst, 'reload schema';
