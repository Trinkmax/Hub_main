-- ============================================================
-- Difusiones — estado 'partial' (difusión terminada con algunos fallidos)
-- ============================================================
-- ADD VALUE va en su PROPIO archivo: Postgres no permite usar un valor de enum
-- recién creado en la misma transacción que lo agrega. El código que setea
-- 'partial' vive en lib/broadcasts/engine.ts (runtime posterior).
-- LEY: sin tablas/RLS/GRANT nuevos. Idempotente. Correr `db:types` después.
-- ============================================================

alter type public.broadcast_status add value if not exists 'partial';
