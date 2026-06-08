-- ============================================================
-- Floor Plan v2 — enums (vocabulario SevenRooms)
-- ============================================================
-- Amplía el vocabulario del editor de plano:
--   - floor_element_kind:  + door, text, stage, booth
--   - floor_element_shape: + banquette
--
-- `ADD VALUE IF NOT EXISTS` es idempotente y reentrante. Esta migración SOLO
-- agrega valores; NO los USA (un RPC/insert que use 'booth'/'banquette' debe ir
-- en un archivo POSTERIOR — Postgres prohíbe usar un valor de enum recién creado
-- en la misma transacción que lo agrega).
--
-- LEY: sin tablas/RLS/GRANT nuevos (solo extiende tipos existentes).
-- Correr `npm run db:types` después de aplicar.
-- ============================================================

alter type public.floor_element_kind  add value if not exists 'door';
alter type public.floor_element_kind  add value if not exists 'text';
alter type public.floor_element_kind  add value if not exists 'stage';
alter type public.floor_element_kind  add value if not exists 'booth';

alter type public.floor_element_shape add value if not exists 'banquette';
