-- ============================================================
-- Reseñas: destino del feedback que NO va a Google
-- ============================================================
-- ITEM 4 — decisión del dueño: "si pones 5 estrellas te debe redirigir
--   automáticamente a Google apenas ponés las 5 estrellas. Si no, te manda al
--   número de WhatsApp para que se reciba el feedback".
--
-- La derivación a Google ya estaba implementada y testeada (lib/reviews/gating.ts);
-- nunca se usó porque `tenants.google_maps_review_url` está en NULL y la
-- pantalla donde se carga (Configuración → Reseñas) no figura en el menú
-- lateral, así que el dueño nunca la encontró. Eso se arregla en la UI.
--
-- Lo que faltaba en la DB es el otro brazo: a qué WhatsApp mandar al que
-- puntuó bajo. Se guarda en el tenant (E.164) y la página pública arma el
-- wa.me con el texto de la reseña ya redactado.
-- ============================================================
alter table public.tenants
  add column if not exists feedback_whatsapp_phone text;

alter table public.tenants
  drop constraint if exists tenants_feedback_whatsapp_phone_check;
alter table public.tenants
  add constraint tenants_feedback_whatsapp_phone_check
  check (
    feedback_whatsapp_phone is null
    or feedback_whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'
  );

comment on column public.tenants.feedback_whatsapp_phone is
  'ITEM 4: WhatsApp donde cae el feedback de las reseñas que no van a Google (E.164, ej. +5493512839101). Si es null, la reseña sólo queda guardada como feedback interno.';
