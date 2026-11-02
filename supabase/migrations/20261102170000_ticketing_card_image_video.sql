-- ============================================================
-- Entradas online — imagen de previsualización y video (02/11/2026)
-- ============================================================
-- Pedido de Nacho Badra: tres imágenes por película, cada una con su medida
-- exacta (la de la cartelera ya no es la misma que la vertical de la página),
-- y un video de YouTube (un Short) que muestre cómo es la experiencia.
--
-- 1. `card_image_url`: la imagen de previsualización, la que se ve en la
--    cartelera. Vacía = la vertical de cine (`poster_url`), como hasta hoy.
-- 2. `video_url`: el link del video de YouTube tal como lo pega el dueño
--    (youtube.com/shorts/…, watch?v=…, youtu.be/…). La app lo valida y saca el
--    id; acá solo se acota el largo.
--
-- Columnas nuevas y vacías: nada cambia hasta que se carguen. Los GRANT de la
-- tabla son por tabla, así que ya las cubren; RLS no cambia.

alter table public.event_experiences
  add column if not exists card_image_url text
    check (card_image_url is null or (char_length(card_image_url) <= 600 and card_image_url ~ '^https://')),
  add column if not exists video_url text
    check (video_url is null or char_length(video_url) <= 300);

comment on column public.event_experiences.card_image_url is
  'Imagen de previsualización (la de la cartelera), vertical 2:3. Null = poster_url.';
comment on column public.event_experiences.video_url is
  'Link de un video de YouTube (Short o video) que muestra la experiencia. Null = sin video.';
