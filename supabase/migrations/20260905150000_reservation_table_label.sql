-- ============================================================
-- salon_reservations: mesa asignada en el servicio (opcional)
-- ============================================================
-- El dueño pidió poder anotar, desde la pantalla operativa, en qué mesa se
-- sentó cada reserva. Es un dato del SERVICIO (se carga cuando la gente llega y
-- la anfitriona decide dónde va), no de la reserva en sí, y sirve para dos
-- cosas: que el mozo sepa a dónde llevar a la mesa 4 cuando le preguntan por
-- "la reserva de García", y que el dueño vea el salón armado de un vistazo.
--
-- Texto libre corto a propósito ("12", "12+13", "Barra", "PA-3"): en el HUB se
-- juntan mesas para los grupos grandes y el plano de mesas físico vive detrás
-- de un feature-flag que hoy está apagado. Una FK a `physical_tables` obligaría
-- a mantener ese catálogo (que además tiene etiquetas repetidas) para poder
-- escribir "12+13". Cuando el plano se active, se puede sumar la FK al lado.
--
-- Informativa: no toca cupos, comisiones ni zona. `null` = sin asignar todavía,
-- y es el estado normal de toda reserva hasta que llega.

alter table public.salon_reservations
  add column if not exists table_label text;

alter table public.salon_reservations
  drop constraint if exists salon_reservations_table_label_len;
alter table public.salon_reservations
  add constraint salon_reservations_table_label_len
    check (table_label is null or length(trim(table_label)) between 1 and 24);

comment on column public.salon_reservations.table_label is
  'Mesa asignada en el servicio (texto libre corto: "12", "12+13", "Barra"). Informativa: no participa de cupos ni comisiones. null = sin asignar.';

-- Los GRANT de la tabla ya cubren la columna nueva (son a nivel tabla, no
-- columna) y la RLS no cambia: se filtra por tenant_id, no por mesa. El trigger
-- de updated_at ya existe. La columna viaja sola por Realtime (select *).

notify pgrst, 'reload schema';
