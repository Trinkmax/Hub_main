-- ============================================================
-- Workflows — cerrar la superficie API de las funciones de trigger
-- ============================================================
-- fn_start_after_visit_flows / fn_start_tag_added_flows son SECURITY DEFINER
-- usadas SOLO por triggers (corren como owner, no via EXECUTE del rol que
-- inserta). No deben ser invocables como RPC por anon/authenticated.
-- (security advisor: anon/authenticated_security_definer_function_executable)
-- ============================================================

revoke execute on function public.fn_start_after_visit_flows() from public, anon, authenticated;
revoke execute on function public.fn_start_tag_added_flows() from public, anon, authenticated;
