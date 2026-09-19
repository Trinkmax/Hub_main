-- ============================================================
-- Ingreso y costo POR PERSONA de la fecha: de la pauta a la ganancia
-- ============================================================
-- POR QUÉ: con la pauta sola el dueño sabe cuánto costó traer gente, pero no
-- si la noche dejó plata. Sus palabras (18/09/2026): "una noche de ramen que
-- ponele sale 27 mil pesos por persona y capaz el costo por persona es de 15
-- mil pesos, ahí podés calcular la ganancia teniendo en cuenta esto y
-- restándole la pauta".
--
-- Por eso dos columnas nuevas, en centavos de PESO y por persona:
--   · revenue_per_guest_ars_cents — lo que deja cada persona (el cubierto).
--   · cost_per_guest_ars_cents    — lo que cuesta servirla (comida/bebida).
-- El sistema multiplica por la gente de esa fecha y le resta la pauta pasada a
-- pesos: margen bruto de la noche. NO es la ganancia del bar (no descuenta
-- sueldos, alquiler ni impuestos) y la pantalla lo dice con esas palabras.
--
-- `revenue_ars_cents` (facturación real de la caja) SE QUEDA, opcional: cuando
-- está, manda sobre el estimado por persona. Decisión del dueño (18/09).
--
-- Los CHECK viejos se rehacen porque las columnas nuevas también tienen que
-- caer bajo la regla de "sin pauta, sin nada": una fecha marcada «No tuvo
-- pauta» (spend 0) no puede traer números de plata colgados.
-- ============================================================

alter table public.scheduled_event_marketing
  add column if not exists revenue_per_guest_ars_cents bigint
    check (revenue_per_guest_ars_cents between 0 and 100000000),
  add column if not exists cost_per_guest_ars_cents bigint
    check (cost_per_guest_ars_cents between 0 and 100000000);

comment on column public.scheduled_event_marketing.revenue_per_guest_ars_cents is
  'Ingreso por persona en centavos de peso (el cubierto). El total lo calcula el sistema con la gente de la fecha; revenue_ars_cents lo pisa si está cargado.';
comment on column public.scheduled_event_marketing.cost_per_guest_ars_cents is
  'Costo por persona en centavos de peso (lo que cuesta servirla). Sin sueldos ni gastos fijos.';

-- "Sin pauta" sigue siendo una fila pelada, ahora incluyendo lo nuevo.
alter table public.scheduled_event_marketing
  drop constraint if exists sem_no_ads_is_bare;
alter table public.scheduled_event_marketing
  add constraint sem_no_ads_is_bare check (
    ad_spend_usd_cents > 0
    or (
      messages is null
      and reach is null
      and revenue_ars_cents is null
      and usd_ars_rate is null
      and revenue_per_guest_ars_cents is null
      and cost_per_guest_ars_cents is null
    )
  );

-- El dólar deja de exigirse de a pares con la facturación: ahora hace falta
-- para pasar la PAUTA a pesos, no para guardar un número en pesos. Si falta,
-- la pantalla muestra el margen bruto y avisa que no puede descontar la pauta
-- — mejor eso que rebotar la carga y quedarse sin el dato.
alter table public.scheduled_event_marketing
  drop constraint if exists sem_revenue_needs_rate;

notify pgrst, 'reload schema';
