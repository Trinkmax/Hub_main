-- ============================================================
-- Noches orgánicas: la cuenta de la noche sin pauta
-- ============================================================
-- POR QUÉ: con «No tuvo pauta» (gasto 0) la fila tenía que ir PELADA, así que
-- una noche que se llenó sola no podía cargar su ingreso y su costo por
-- persona. Pedido del dueño (22/09/2026), con Ratatuille del 14/09: "fue todo orgánico
-- y debería poder dejarme cargar eso solo aunque sea 0 en pauta".
--
-- La plata de la noche no depende de la pauta: sin gasto, la pauta en pesos es
-- $ 0 y el resultado es el margen. Lo que SIGUE sin tener sentido con gasto 0
-- son los números de Meta: mensajes y alcance salen del Administrador de
-- anuncios (sin anuncio no existen), y el dólar del día está para pasar la
-- pauta a pesos (sin pauta no hay nada que pasar). Esos tres siguen en null.
--
-- Pueden ir con gasto 0: ingreso y costo por persona, la facturación real de la
-- caja y la nota (que ya podía).
--
-- El CHECK cambia de nombre porque el viejo decía lo contrario de la regla
-- nueva: una fila sin pauta ya no es "pelada". Solo afloja: toda fila que
-- cumplía el viejo cumple este.
-- ============================================================

alter table public.scheduled_event_marketing
  drop constraint if exists sem_no_ads_is_bare;

alter table public.scheduled_event_marketing
  drop constraint if exists sem_no_ads_no_meta_numbers;

alter table public.scheduled_event_marketing
  add constraint sem_no_ads_no_meta_numbers check (
    ad_spend_usd_cents > 0
    or (messages is null and reach is null and usd_ars_rate is null)
  );

comment on table public.scheduled_event_marketing is
  'Pauta en Meta por edición de evento («Cómo nos fue»). Solo owner. ad_spend_usd_cents = 0 significa "no tuvo pauta" (puede traer igual la plata de la noche, pero no números de Meta ni dólar); sin fila = sin cargar.';

notify pgrst, 'reload schema';
