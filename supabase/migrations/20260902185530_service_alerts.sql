-- ============================================================
-- Avisos de servicio: celíaco, alergia, movilidad reducida…
-- ============================================================
-- El dueño: "que se resalte para que los encargados puedan ver, por ejemplo si
-- hay una persona celíaca, y no se pase por alto". Hoy eso vive —cuando vive—
-- adentro del comentario libre, detrás de un ícono de 18px al lado del nombre.
--
-- Dos lugares a propósito, porque son dos cosas distintas:
--   · `customers.service_alerts` — lo que es de la PERSONA. Melina es celíaca
--     hoy y en diciembre. Se carga una vez y reaparece sola en cada reserva.
--   · `salon_reservations.service_alerts` — lo de ESA noche (la silla del bebé).
--     También es el único lugar posible cuando la reserva no tiene cliente
--     linkeado en el CRM, que es un caso frecuente.
-- Lo que ve el staff en una reserva es la UNIÓN de las dos listas.
--
-- `highlight_comment` es la válvula de escape para lo que no entra en ningún
-- chip ("viene en silla de ruedas eléctrica y necesita el paso libre"): marca
-- el comentario que ya existe para que se lea sin abrir el popover.
--
-- La severidad NO vive acá: celiac/allergy son riesgo médico y el resto es
-- informativo, pero eso es una decisión de presentación y vive en TS
-- (lib/salon/alerts.ts). La DB solo guarda el hecho.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_alert') then
    create type public.service_alert as enum (
      'celiac',
      'allergy',
      'vegetarian',
      'vegan',
      'reduced_mobility',
      'baby_seat'
    );
  end if;
end $$;

alter table public.customers
  add column if not exists service_alerts public.service_alert[] not null default '{}';

alter table public.salon_reservations
  add column if not exists service_alerts public.service_alert[] not null default '{}',
  add column if not exists highlight_comment boolean not null default false;

comment on column public.customers.service_alerts is
  'Avisos permanentes de la persona (celíaca, alérgica…). Dato de salud: no exponer en superficies públicas (panel del socio, carta, difusiones).';

comment on column public.salon_reservations.service_alerts is
  'Avisos de esta reserva. Lo que ve el staff es la unión con customers.service_alerts del cliente linkeado.';

comment on column public.salon_reservations.highlight_comment is
  'Marca el comentario libre como importante: se muestra abierto en la agenda y en el panel de mozos en vez de quedar detrás del ícono.';

-- Las filas se filtran por tenant_id: la RLS no cambia. Los GRANT son a nivel
-- tabla y ya están, así que las columnas nuevas quedan cubiertas.

notify pgrst, 'reload schema';
