-- Fase 5 — Endurecimiento (advisor de Supabase): cerrar el EXECUTE de helpers internos.
-- En este proyecto ALTER DEFAULT PRIVILEGES otorga EXECUTE a anon/authenticated en toda
-- función nueva de public; estos helpers NO deben ser invocables vía Data API:
--   set_customer_tier    → lo llama el trigger / RPCs como SECURITY DEFINER.
--   grant_tier_benefits  → solo el cron (service_role bypassa grants).
--   guard_feature_flags_write → trigger; nunca se invoca directo.
--   is_platform_admin    → la app lo llama como authenticated; anon no lo necesita.

revoke execute on function public.set_customer_tier(uuid) from anon, authenticated;
revoke execute on function public.grant_tier_benefits() from anon, authenticated;
revoke execute on function public.guard_feature_flags_write() from anon, authenticated;
revoke execute on function public.is_platform_admin() from anon;
