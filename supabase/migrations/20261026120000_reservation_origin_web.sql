-- ============================================================
-- Origen «web»: la reserva entró sola, pagada por Mercado Pago
-- ============================================================
-- POR QUÉ: las entradas online (Cine y degustación, pedido de los socios del
-- 23/10/2026) crean la reserva cuando Mercado Pago confirma el pago, sin que
-- nadie la cargue. Hasta acá todo origen era una persona del bar contestando
-- un canal (WhatsApp, Instagram, presencial…); sin un valor propio, esas
-- reservas se confundían con las que Luz carga a mano y no se podían contar.
--
-- VA SOLA EN SU MIGRACIÓN: un valor nuevo de enum no se puede USAR en la misma
-- transacción que lo crea, y las funciones de 20261026120200 lo insertan.
-- ============================================================

alter type public.reservation_origin add value if not exists 'web';
