-- Seguridad (advisors: security_definer_view + function_search_path_mutable).
--
-- VISTAS v_customer_stats / v_churn_risk / v_tenant_daily_metrics / v_visit_heatmap:
-- son SECURITY DEFINER A PROPÓSITO: leen materialized views (mv_*) que NO pueden
-- llevar RLS, y filtran por tenant con un WHERE explícito (tenant_id IN memberships
-- de auth.uid()). Pasarlas a security_invoker obligaría a dar SELECT directo sobre las
-- mv_* (sin RLS) → fuga cross-tenant peor. La defensa real es que la vista sea el
-- ÚNICO camino de acceso. Acá cerramos los grants sobrantes: anon no debe tocarlas y
-- nadie debe tener escritura. Queda solo SELECT para authenticated.
revoke all on public.v_customer_stats from anon, authenticated;
revoke all on public.v_churn_risk from anon, authenticated;
revoke all on public.v_tenant_daily_metrics from anon, authenticated;
revoke all on public.v_visit_heatmap from anon, authenticated;

grant select on public.v_customer_stats to authenticated;
grant select on public.v_churn_risk to authenticated;
grant select on public.v_tenant_daily_metrics to authenticated;
grant select on public.v_visit_heatmap to authenticated;

comment on view public.v_customer_stats is 'SECURITY DEFINER a propósito: único acceso a mv_customer_stats (sin RLS), filtrado por tenant via memberships(auth.uid()). No exponer las mv_* directamente.';
comment on view public.v_churn_risk is 'SECURITY DEFINER a propósito: ver v_customer_stats.';
comment on view public.v_tenant_daily_metrics is 'SECURITY DEFINER a propósito: ver v_customer_stats.';
comment on view public.v_visit_heatmap is 'SECURITY DEFINER a propósito: ver v_customer_stats.';

-- FUNCIONES con search_path mutable: fijarlo evita hijacking via search_path.
-- Incluimos `extensions` porque encrypt/decrypt_meta_token usan pgcrypto (pgp_sym_*),
-- que vive en el schema extensions.
alter function public.active_tenant_id() set search_path = public, extensions, pg_temp;
alter function public.decrypt_meta_token(text, text) set search_path = public, extensions, pg_temp;
alter function public.encrypt_meta_token(text, text) set search_path = public, extensions, pg_temp;
alter function public.event_lock_key(uuid) set search_path = public, extensions, pg_temp;
alter function public.reservation_day_lock_key(uuid, date) set search_path = public, extensions, pg_temp;
alter function public.set_updated_at() set search_path = public, extensions, pg_temp;
