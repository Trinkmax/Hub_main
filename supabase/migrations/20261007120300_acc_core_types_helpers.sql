-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #4
-- Tipos y helpers base del módulo contable (spec §A.1, §C.1, §G.5)
-- ============================================================
-- Qué crea:
--   · Enums `acc_account_type` y `acc_side` (los únicos enums del módulo; el
--     resto de los catálogos son text + CHECK para crecer sin 55P04).
--   · `private.acc_lock_key(tenant)`: clave del advisory lock por bar. Toda
--     escritura contable de un bar se serializa (volumen bajo: decenas de
--     comprobantes por día; serializar es más simple y más seguro que razonar
--     carreras sobre saldos, numeración y partidas).
--   · `public.acc_today(tenant)`: «hoy» en la zona del bar (la base corre en UTC).
--   · `public.acc_cuit_is_valid(text)`: CUIT/CUIL con dígito verificador.
--   · `private.acc_audit(...)`: escribe `audit_log` DENTRO de la transacción
--     de cada RPC (payload con ids, tipos, fechas y montos; nunca CUIT, nombres
--     de personas ni textos libres).
--   · `private.acc_default_display_name(tenant, user)` y
--     `private.acc_actor_name(tenant, user)`: el nombre visible que se copia en
--     `created_by_name` y en los accesos (regla de provision_reservation_manager).
--
-- Grants: el default privileges del proyecto le da EXECUTE a public, anon y
-- authenticated a cada función nueva. Las de `private` quedan sin EXECUTE para
-- nadie (el esquema ya no tiene USAGE para anon/authenticated); las de cálculo
-- públicas, solo authenticated (son INVOKER: corren bajo la RLS de quien llama).
-- ============================================================

-- ─── 1. Enums ────────────────────────────────────────────────────────────────
create type public.acc_account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');
create type public.acc_side as enum ('debit', 'credit');

comment on type public.acc_account_type is
  'Tipo de cuenta contable: activo, pasivo, patrimonio neto, ingreso, egreso. El lado normal vive aparte (regularizadoras).';
comment on type public.acc_side is
  'Lado de una línea del diario: Debe (debit) o Haber (credit). Los importes siempre son positivos.';

-- ─── 2. Lock por bar ─────────────────────────────────────────────────────────
create function private.acc_lock_key(p_tenant uuid)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select ('x' || substr(md5('acc:' || p_tenant::text), 1, 16))::bit(64)::bigint
$$;

comment on function private.acc_lock_key(uuid) is
  'Clave de pg_advisory_xact_lock para serializar toda escritura contable de un bar.';

-- ─── 3. «Hoy» en la zona del bar ─────────────────────────────────────────────
-- INVOKER: el lector ve su fila de tenants; para un bar ajeno cae en Córdoba.
create function public.acc_today(p_tenant uuid)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select t.timezone from public.tenants t where t.id = p_tenant), 'America/Argentina/Cordoba'))::date
$$;

comment on function public.acc_today(uuid) is
  'Fecha de hoy en la zona horaria del bar (tenants.timezone; default America/Argentina/Cordoba).';

-- ─── 4. CUIT/CUIL ────────────────────────────────────────────────────────────
-- Prefijo válido + dígito verificador módulo 11 (pesos 5,4,3,2,7,6,5,4,3,2).
-- 11 − (suma % 11): 11 → 0; 10 → inválido (ARCA reasigna prefijo 23 y el
-- resultado da 9 o 4). El CASE evita el ::int si no son dígitos (la función no
-- se inlinea: tiene una subconsulta).
create function public.acc_cuit_is_valid(p text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when p !~ '^(20|23|24|25|26|27|30|33|34)[0-9]{9}$' then false
    else (select (case 11 - (t.s % 11) when 11 then 0 when 10 then -1 else 11 - (t.s % 11) end)
                 = substr(p, 11, 1)::int
            from (select sum(substr(p, i, 1)::int * (array[5,4,3,2,7,6,5,4,3,2])[i]) as s
                    from generate_series(1, 10) as g(i)) t)
  end
$$;

comment on function public.acc_cuit_is_valid(text) is
  'true si el texto es un CUIT/CUIL de 11 dígitos con prefijo y dígito verificador válidos.';

-- ─── 5. Auditoría dentro de la transacción ──────────────────────────────────
create function private.acc_audit(
  p_tenant uuid, p_user uuid, p_action text, p_entity text, p_entity_id uuid, p_payload jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (p_tenant, p_user, p_action, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb))
$$;

comment on function private.acc_audit(uuid, uuid, text, text, uuid, jsonb) is
  'Inserta en audit_log en la transacción en curso (lo llaman las RPC acc_*). Payload sin CUIT, nombres ni textos libres.';

-- ─── 6. Nombres visibles ─────────────────────────────────────────────────────
-- Regla de provision_reservation_manager: el gestor de reservas del bar, si no
-- full_name/name de la metadata, si no la parte local del email.
create function private.acc_default_display_name(p_tenant uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(
    (select nullif(btrim(rm.display_name), '')
       from public.reservation_managers rm
      where rm.tenant_id = p_tenant and rm.user_id = p_user
      order by rm.active desc, rm.created_at asc
      limit 1),
    (select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
       from auth.users u where u.id = p_user),
    (select nullif(split_part(coalesce(u.email::text, ''), '@', 1), '')
       from auth.users u where u.id = p_user),
    'Sin nombre'), 80)
$$;

comment on function private.acc_default_display_name(uuid, uuid) is
  'Nombre por defecto de una persona en un bar: gestor de reservas, metadata full_name/name o parte local del email (máx. 80).';

-- El display_name de acc_access (vigente primero), o el nombre por defecto.
-- Sin usuario (trigger o sistema): 'Sistema'. Se copia en created_by_name.
create function private.acc_actor_name(p_tenant uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is null then 'Sistema'
    else left(coalesce(
      (select nullif(btrim(a.display_name), '')
         from public.acc_access a
        where a.tenant_id = p_tenant and a.user_id = p_user
        order by (a.revoked_at is null) desc, a.granted_at desc
        limit 1),
      private.acc_default_display_name(p_tenant, p_user)), 80)
  end
$$;

comment on function private.acc_actor_name(uuid, uuid) is
  'Nombre visible de quien actúa en Administración (acc_access.display_name o el nombre por defecto). Se copia en created_by_name.';

-- ─── 7. Grants ───────────────────────────────────────────────────────────────
revoke all on function private.acc_lock_key(uuid) from public, anon, authenticated;
revoke all on function private.acc_audit(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.acc_default_display_name(uuid, uuid) from public, anon, authenticated;
revoke all on function private.acc_actor_name(uuid, uuid) from public, anon, authenticated;

revoke all on function public.acc_today(uuid) from public, anon;
grant execute on function public.acc_today(uuid) to authenticated;
revoke all on function public.acc_cuit_is_valid(text) from public, anon;
grant execute on function public.acc_cuit_is_valid(text) to authenticated;

notify pgrst, 'reload schema';
