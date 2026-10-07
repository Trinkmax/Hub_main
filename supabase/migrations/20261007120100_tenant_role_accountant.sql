-- ============================================================
-- Sprint 1 «Administración» · fase 0 · migración #2
-- Rol nuevo `accountant` («Contabilidad», spec §B.6.1)
-- ============================================================
-- La contadora lee y exporta Administración, no escribe nada y no ve nada
-- más. Este valor del enum va SOLO en su migración: Postgres (55P04) no deja
-- USAR un valor nuevo de enum en la misma transacción que lo agrega (mismo
-- patrón que 20260716120000_tenant_role_editor_host). Las guardias y el
-- aislamiento que lo usan llegan en la #3 (20261007120200_accountant_isolation),
-- que se aplica inmediatamente después.
--
-- Nada más cambia: `custom_access_token_hook`, `user_role_in_tenant`,
-- `accept_invitation` y `get_invitation_preview` serializan el rol sin
-- enumerarlo, y las 113 políticas y 44 funciones que enumeran roles son
-- allowlists: la contadora no entra en ninguna.
-- ============================================================

alter type public.tenant_role add value if not exists 'accountant';

notify pgrst, 'reload schema';
