-- ============================================================
-- Tareas de marketing: los 6 estados del tablero estilo Monday
-- (pedido de Nacho Badra, video del 15/11/2026)
-- ============================================================
-- Suma «Backlog» («lo dejo para después») y «Esperando feedback» a los cuatro
-- que ya estaban (Por hacer, En curso, Interrumpido, Terminado). Va sola porque
-- un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
-- Los textos y colores viven en lib/marketing/constants.ts.
-- ============================================================

alter type public.marketing_task_status add value if not exists 'backlog';
alter type public.marketing_task_status add value if not exists 'waiting_feedback';
