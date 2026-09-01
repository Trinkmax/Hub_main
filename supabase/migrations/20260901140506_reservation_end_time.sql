-- ============================================================
-- salon_reservations: horario de finalización (opcional)
-- ============================================================
-- El dueño pidió poder anotar hasta qué hora se queda la mesa. Sirve para saber
-- cuándo se libera, no para nada más: no toca cupos, ni comisiones, ni el día de
-- la reserva. La hora de INICIO sigue siendo la que ordena, agrupa y manda.
--
-- Nullable a propósito, y ese va a ser el caso de la enorme mayoría de las
-- reservas: nadie sabe a qué hora se va a ir la gente. `null` es un estado
-- normal, no un dato faltante.
--
-- SIN check de "fin > inicio": el bar cierra tarde y una cena que arranca 21:30
-- y termina 00:30 es la noche típica, no un error de carga. Cuando el fin es
-- menor o igual al inicio se entiende como madrugada del día siguiente, y la UI
-- lo dice con todas las letras.

alter table public.salon_reservations
  add column if not exists reservation_end_time_local time;

comment on column public.salon_reservations.reservation_end_time_local is
  'Hora local de finalización, opcional. Si es <= reservation_time_local, cruza la medianoche (madrugada del día siguiente). Informativa: no participa de cupos ni comisiones.';

-- Los GRANT de la tabla ya cubren la columna nueva (son a nivel tabla, no
-- columna) y la RLS no cambia: se filtra por tenant_id, no por horario.

notify pgrst, 'reload schema';
