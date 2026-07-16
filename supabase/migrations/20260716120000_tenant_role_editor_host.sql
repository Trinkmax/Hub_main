-- Roles nuevos del workspace manager:
--   editor → carga la carta (fotos/videos/textos) sin tocar el resto del negocio
--   host   → gestiona reservas + eventos y ve sus propias comisiones
-- En migración propia: Postgres (55P04) no permite USAR un valor nuevo de enum
-- en la misma transacción que lo agrega (mismo patrón que plan2_a 'kitchen').
alter type public.tenant_role add value if not exists 'editor';
alter type public.tenant_role add value if not exists 'host';
