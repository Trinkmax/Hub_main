-- ============================================================
-- La bebida de la noche: ingreso y costo de bebida POR PERSONA
-- ============================================================
-- POR QUÉ: pedido del dueño (30/09/2026), textual: «también agregar ingreso
-- por bebida por persona. A veces este puede ser 0 porque tiene por ejemplo el
-- vino incluido, pero a veces es 35 mil pesos más bebida». Decisión (D3): dos
-- columnas por FECHA, igual que el ingreso y el costo por persona (decisión 1
-- del 19/09), en centavos de PESO:
--   · drink_revenue_per_guest_ars_cents — lo que deja cada persona en bebida
--     que se cobra APARTE del cubierto. 0 = bebida incluida (el vino).
--   · drink_cost_per_guest_ars_cents    — lo que cuesta la bebida de cada
--     persona, también la incluida.
-- NULL = sin cargar, que NO es 0. Con las dos en NULL la cuenta de la noche es
-- la de siempre: las 21 filas cargadas hasta hoy no cambian (regla 13).
--
-- La cuenta (lib/salon/event-marketing.ts):
--   ingreso = facturación real si está; si no, personas × (cubierto + bebida)
--   costo   = personas × (costo + costo de bebida)
-- La facturación real sale de la caja y ya trae la bebida: cuando está, manda
-- sobre cubierto + bebida (decisión 2 del 19/09). El costo de bebida se suma
-- igual, porque la caja no sabe de costos.
--
-- Mismo rango que las otras dos por persona: de $ 0 a $ 1.000.000. Con nombre
-- propio: el automático pasaría de 63 caracteres y Postgres lo recortaría.
--
-- Van también en noches SIN pauta (gasto 0): `sem_no_ads_no_meta_numbers`
-- solo exige en NULL los números de Meta y el dólar, y la bebida es plata de la
-- noche, no de Meta. Por eso ese CHECK no se toca.
--
-- Sin pares en la DB: una sin la otra se guarda y la pantalla dice qué falta
-- para cerrar la cuenta, igual que desde que se borró sem_revenue_needs_rate.
--
-- Sin GRANT nuevo: los privilegios de 20260915120000 son de TABLA y cubren las
-- columnas nuevas (authenticated con sem_owner_all; anon sin nada).
-- ============================================================

alter table public.scheduled_event_marketing
  add column if not exists drink_revenue_per_guest_ars_cents bigint,
  add column if not exists drink_cost_per_guest_ars_cents bigint;

alter table public.scheduled_event_marketing
  drop constraint if exists sem_drink_revenue_per_guest_range,
  drop constraint if exists sem_drink_cost_per_guest_range;

alter table public.scheduled_event_marketing
  add constraint sem_drink_revenue_per_guest_range
    check (drink_revenue_per_guest_ars_cents between 0 and 100000000),
  add constraint sem_drink_cost_per_guest_range
    check (drink_cost_per_guest_ars_cents between 0 and 100000000);

comment on column public.scheduled_event_marketing.drink_revenue_per_guest_ars_cents is
  'Ingreso de bebida por persona en centavos de peso: la que se cobra aparte del cubierto. 0 = bebida incluida (el vino); NULL = sin cargar. Con revenue_ars_cents cargado no se suma: la caja ya la trae.';
comment on column public.scheduled_event_marketing.drink_cost_per_guest_ars_cents is
  'Costo de bebida por persona en centavos de peso, también de la bebida incluida. NULL = sin cargar. Se suma siempre que la bebida esté en la cuenta, haya o no facturación real.';

-- Las dos de siempre ahora dicen de qué son, sin la bebida. Las filas cargadas
-- antes del 30/09 pueden traer la bebida dentro del costo: la ayuda del form
-- decía «comida y bebida».
comment on column public.scheduled_event_marketing.revenue_per_guest_ars_cents is
  'Ingreso por persona en centavos de peso: el cubierto, sin la bebida que se cobra aparte (esa va en drink_revenue_per_guest_ars_cents). revenue_ars_cents lo pisa si está cargado.';
comment on column public.scheduled_event_marketing.cost_per_guest_ars_cents is
  'Costo por persona en centavos de peso: la comida, sin sueldos ni gastos fijos. La bebida va en drink_cost_per_guest_ars_cents; las filas cargadas antes del 30/09/2026 pueden traerla acá (el form decía «comida y bebida»).';

notify pgrst, 'reload schema';
