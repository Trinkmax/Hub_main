-- ============================================================
-- Endurecimiento: cerrar EXECUTE de los helpers internos de puntos
-- ============================================================
-- `create function` otorga EXECUTE a PUBLIC por default; además este proyecto
-- tiene ALTER DEFAULT PRIVILEGES que otorga a anon/authenticated. Para cerrar de
-- verdad un helper interno hay que revocar de PUBLIC *y* de anon/authenticated.
--
--   recompute_customer_loyalty  → lo llama el trigger points_tx_apply (SECURITY DEFINER).
--   refresh_all_category_points → sólo el cron diario.
--   points_tx_apply             → función de trigger; nunca se invoca directo.
--   redeem_reward               → sólo authenticated (owner/cashier); anon nunca.
-- ============================================================

revoke execute on function public.recompute_customer_loyalty(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_all_category_points() from public, anon, authenticated;
revoke execute on function public.points_tx_apply() from public, anon, authenticated;
revoke execute on function public.redeem_reward(uuid, uuid) from public, anon;
