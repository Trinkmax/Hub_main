-- ============================================================
-- Sprint 1 «Administración» · fase 0 · migración #1
-- Endurecimiento de RPC del salón y del CRM (spec §B.8, decisión 11)
-- ============================================================
-- POR QUÉ: antes de que exista el rol `accountant` (#2) y su aislamiento
-- (#3), se cierran los agujeros de RPC que encontró el relevamiento en vivo
-- del 06/10/2026. No toca nada contable:
--   · `recalc_reservation_commission` y `recalc_event_commissions` no
--     chequeaban ni sesión ni bar, y `anon` las ejecutaba: con un UUID
--     cualquiera se borraban y recreaban filas impagas de `commission_ledger`
--     (BACKLOG 61-64, 961-967).
--   · `transition_reservation_status` y `update_reservation_actual_guests`
--     escriben y solo pedían membresía: cocina y contenido podían cambiar
--     estados y personas (y con eso, comisiones) por API.
--   · `evaluate_day_capacity`, `get_salon_occupancy` y
--     `customer_effective_tier` aceptaban cualquier membresía: un rol futuro
--     (la contadora) entraba sin que nadie lo decida.
--   · `auto_abandon_stale_sessions`, `expire_punch_cards` (cron) e
--     `internal_activate_session_for_table` (interna) escriben en TODOS los
--     bares y las podía disparar `anon`.
--   · `rotate_customer_qr_token`: `if v_role <> 'owner'` deja pasar un rol
--     nulo (anon, o miembro de otro bar), y `gen_random_bytes` sin esquema con
--     `search_path = ''` la rompía para todos («Rotar QR» fallaba siempre).
--
-- PATRÓN DE LOS ENVOLTORIOS: el cuerpo vivo pasa INTACTO al esquema nuevo
-- `private` con `ALTER FUNCTION … SET SCHEMA` (no se copian a mano 130
-- líneas: cero riesgo de transcripción) y se renombra a `*_core`. En `public`
-- queda un envoltorio fino con la verificación que faltaba y la MISMA firma
-- (nombres de parámetros, defaults), tipo de retorno, volatilidad y códigos
-- de error que el original: TS (PostgREST, por nombre) y SQL (los llamadores
-- definer, por nombre) siguen llegando a `public.<x>` sin cambios.
-- Verificado en vivo el 06/10/2026: ninguna de estas funciones figura en
-- `pg_depend` desde políticas, vistas o triggers, y ningún job de `pg_cron`
-- las llama.
--
-- ALLOWLISTS: `RESERVATION_OPERATOR_ROLES` (owner, cashier, waiter, host) para
-- lo que escribe reservas y comisiones; los SEIS roles actuales para las
-- lecturas «cualquier miembro». Para todos los roles de hoy el resultado es
-- idéntico salvo cocina y contenido cambiando reservas (la UI nunca se lo
-- permitió); un rol nuevo queda afuera hasta que se lo sume a propósito.
--
-- REVERSA (si algo se rompe en producción), por función envuelta:
--   drop function public.<x>(<args>);
--   alter function private.<x>_core(<args>) rename to <x>;
--   alter function private.<x>(<args>) set schema public;
--   grant execute on function public.<x>(<args>) to anon, authenticated, service_role;
-- y para las revocadas: grant execute … to anon, authenticated.
-- ============================================================

-- ─── 0. Esquema `private` ────────────────────────────────────────────────────
-- Funciones internas (núcleos de los envoltorios, triggers, helpers). PostgREST
-- no lo expone y ni anon ni authenticated tienen USAGE: lo de acá adentro solo
-- se alcanza desde funciones definer de `public`.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
comment on schema private is
  'Funciones internas (núcleos de RPC envueltas, triggers, helpers). Sin USAGE para anon ni authenticated: solo se llaman desde funciones SECURITY DEFINER de public.';

-- ─── 1. recalc_reservation_commission ────────────────────────────────────────
-- Llamadores: `transition_reservation_status`, `update_reservation_actual_guests`
-- y `recalc_event_commissions` (definer, por nombre: llegan al envoltorio con
-- el auth.uid() del usuario que disparó todo), y TS `lib/salon/actions.ts`
-- (editar y cancelar reserva, roles owner/cashier/host).
alter function public.recalc_reservation_commission(uuid) set schema private;
alter function private.recalc_reservation_commission(uuid) rename to recalc_reservation_commission_core;
revoke all on function private.recalc_reservation_commission_core(uuid) from public, anon, authenticated;

create function public.recalc_reservation_commission(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
begin
  -- Mismo primer error que el núcleo, con el mismo código.
  select sr.tenant_id into v_tenant from public.salon_reservations sr where sr.id = p_reservation_id;
  if v_tenant is null then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;

  if (select auth.uid()) is null then
    -- auth.uid() sigue siendo el usuario aunque llame otra definer (transition_…,
    -- update_…). Sin usuario, solo service_role (hoy no hay llamadores así; queda
    -- abierto para un cron futuro).
    if coalesce((select auth.role()), '') <> 'service_role' then
      raise exception 'unauthenticated' using errcode = '42501';
    end if;
  else
    v_role := public.user_role_in_tenant(v_tenant);                  -- el bar DE LA RESERVA
    if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'host') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  perform private.recalc_reservation_commission_core(p_reservation_id);
end;
$$;

revoke all on function public.recalc_reservation_commission(uuid) from public, anon;
grant execute on function public.recalc_reservation_commission(uuid) to authenticated, service_role;
comment on function public.recalc_reservation_commission(uuid) is
  'Recalcula las comisiones impagas de una reserva. Envoltorio de private.recalc_reservation_commission_core: exige un rol de RESERVATION_OPERATOR_ROLES en el bar de la reserva (o service_role sin usuario).';

-- ─── 2. recalc_event_commissions ─────────────────────────────────────────────
-- Solo la llama `transition_reservation_status` (definer → corre como su
-- dueño). Nadie de afuera la necesita: sin EXECUTE para anon ni authenticated.
revoke all on function public.recalc_event_commissions(uuid) from public, anon, authenticated;

-- ─── 3. transition_reservation_status ────────────────────────────────────────
-- Errores idénticos al núcleo y en el mismo orden: 'unauthenticated' sin errcode
-- (P0001, como siempre lo tiró), 'reservation_not_found' y 'forbidden' con P0001.
alter function public.transition_reservation_status(uuid, public.salon_reservation_status, integer) set schema private;
alter function private.transition_reservation_status(uuid, public.salon_reservation_status, integer)
  rename to transition_reservation_status_core;
revoke all on function private.transition_reservation_status_core(uuid, public.salon_reservation_status, integer)
  from public, anon, authenticated;

create function public.transition_reservation_status(
  p_reservation_id uuid,
  p_to public.salon_reservation_status,
  p_actual_guests integer default null
)
returns public.salon_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  -- Sin lock acá: el núcleo toma la fila FOR UPDATE. El bar de una reserva no cambia.
  select sr.tenant_id into v_tenant from public.salon_reservations sr where sr.id = p_reservation_id;
  if v_tenant is null then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  return private.transition_reservation_status_core(p_reservation_id, p_to, p_actual_guests);
end;
$$;

revoke all on function public.transition_reservation_status(uuid, public.salon_reservation_status, integer) from public, anon;
grant execute on function public.transition_reservation_status(uuid, public.salon_reservation_status, integer)
  to authenticated, service_role;
comment on function public.transition_reservation_status(uuid, public.salon_reservation_status, integer) is
  'Cambia el estado de una reserva y recalcula comisiones. Envoltorio de private.transition_reservation_status_core con la allowlist RESERVATION_OPERATOR_ROLES (owner, cashier, waiter, host).';

-- ─── 4. update_reservation_actual_guests ─────────────────────────────────────
-- Mismo patrón y mismos errores que transition_reservation_status.
alter function public.update_reservation_actual_guests(uuid, integer) set schema private;
alter function private.update_reservation_actual_guests(uuid, integer) rename to update_reservation_actual_guests_core;
revoke all on function private.update_reservation_actual_guests_core(uuid, integer) from public, anon, authenticated;

create function public.update_reservation_actual_guests(p_reservation_id uuid, p_actual_guests integer)
returns public.salon_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated';
  end if;

  select sr.tenant_id into v_tenant from public.salon_reservations sr where sr.id = p_reservation_id;
  if v_tenant is null then
    raise exception 'reservation_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  return private.update_reservation_actual_guests_core(p_reservation_id, p_actual_guests);
end;
$$;

revoke all on function public.update_reservation_actual_guests(uuid, integer) from public, anon;
grant execute on function public.update_reservation_actual_guests(uuid, integer) to authenticated, service_role;
comment on function public.update_reservation_actual_guests(uuid, integer) is
  'Carga las personas que vinieron y recalcula comisiones. Envoltorio de private.update_reservation_actual_guests_core con la allowlist RESERVATION_OPERATOR_ROLES (owner, cashier, waiter, host).';

-- ─── 5. Lecturas «cualquier miembro» → los SEIS roles de hoy ─────────────────
-- No cambia nada para nadie de hoy; un rol futuro (la contadora incluida) queda
-- afuera hasta que se lo agregue a propósito.

-- 5a. evaluate_day_capacity: 'forbidden' con P0001, como el original.
alter function public.evaluate_day_capacity(uuid, date) set schema private;
alter function private.evaluate_day_capacity(uuid, date) rename to evaluate_day_capacity_core;
revoke all on function private.evaluate_day_capacity_core(uuid, date) from public, anon, authenticated;

create function public.evaluate_day_capacity(p_tenant_id uuid, p_date date)
returns table (bucket text, used integer, capacity integer, available integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
begin
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return query select * from private.evaluate_day_capacity_core(p_tenant_id, p_date);
end;
$$;

revoke all on function public.evaluate_day_capacity(uuid, date) from public, anon;
grant execute on function public.evaluate_day_capacity(uuid, date) to authenticated, service_role;
comment on function public.evaluate_day_capacity(uuid, date) is
  'Cupo usado y disponible del día por zona y evento. Envoltorio de private.evaluate_day_capacity_core con la allowlist de los seis roles de 2026-10.';

-- 5b. get_salon_occupancy: 'forbidden' con 42501, como el original.
alter function public.get_salon_occupancy(uuid) set schema private;
alter function private.get_salon_occupancy(uuid) rename to get_salon_occupancy_core;
revoke all on function private.get_salon_occupancy_core(uuid) from public, anon, authenticated;

create function public.get_salon_occupancy(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
begin
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.get_salon_occupancy_core(p_tenant_id);
end;
$$;

revoke all on function public.get_salon_occupancy(uuid) from public, anon;
grant execute on function public.get_salon_occupancy(uuid) to authenticated, service_role;
comment on function public.get_salon_occupancy(uuid) is
  'Ocupación del salón en vivo (sesiones abiertas). Envoltorio de private.get_salon_occupancy_core con la allowlist de los seis roles de 2026-10.';

-- 5c. customer_effective_tier: plpgsql STABLE (verificado en vivo). Conserva el
-- «sin auth.uid() no chequea»: la llaman sin usuario el trigger
-- customer_punch_cards_tier_guard (vía punch_template_allows_customer),
-- _advance_punch_cards_for_visit y el service role. Un socio inexistente sigue
-- devolviendo null sin error (lo resuelve el núcleo).
alter function public.customer_effective_tier(uuid) set schema private;
alter function private.customer_effective_tier(uuid) rename to customer_effective_tier_core;
revoke all on function private.customer_effective_tier_core(uuid) from public, anon, authenticated;

create function public.customer_effective_tier(p_customer_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if (select auth.uid()) is not null then
    select c.tenant_id into v_tenant from public.customers c where c.id = p_customer_id;
    if v_tenant is not null and coalesce(public.user_role_in_tenant(v_tenant)::text, '')
         not in ('owner', 'cashier', 'waiter', 'kitchen', 'editor', 'host') then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
  end if;
  return private.customer_effective_tier_core(p_customer_id);
end;
$$;

revoke all on function public.customer_effective_tier(uuid) from public, anon;
grant execute on function public.customer_effective_tier(uuid) to authenticated, service_role;
comment on function public.customer_effective_tier(uuid) is
  'Nivel vigente del socio según sus puntos de categoría. Espejo de resolveTier (lib/points/tiers.ts). Allowlist de roles si hay usuario logueado; sin usuario no chequea.';

-- ─── 6. mark_commission_paid: mismo agujero (anon con EXECUTE), sin cambio de lógica
revoke execute on function public.mark_commission_paid(uuid[], timestamptz) from anon;

-- ─── 7. Cron e internas que cualquiera podía disparar ───────────────────────
-- Escriben en todos los bares. Llamadores verificados: app/api/cron/
-- {auto-abandon-stale,expire-punch-cards}/route.ts con el cliente de servicio
-- (service_role conserva EXECUTE) y activate_table_session /
-- activate_table_session_by_id (definer: corren como el dueño de la función).
revoke all on function public.auto_abandon_stale_sessions() from public, anon, authenticated;
revoke all on function public.expire_punch_cards() from public, anon, authenticated;
revoke all on function public.internal_activate_session_for_table(uuid, integer, text, uuid, text)
  from public, anon, authenticated;

-- ─── 8. rotate_customer_qr_token ─────────────────────────────────────────────
-- Mismo cuerpo, con las dos correcciones: el rol nulo ya no pasa y
-- gen_random_bytes va calificado (solo existe en `extensions`).
create or replace function public.rotate_customer_qr_token(p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_role text;
  v_new_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select * into v_customer
    from public.customers
   where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_customer.tenant_id);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_new_token := encode(extensions.gen_random_bytes(16), 'hex');
  update public.customers
     set qr_token = v_new_token,
         qr_token_generated_at = now(),
         updated_at = now()
   where id = p_customer_id;

  return v_new_token;
end;
$$;

-- create or replace conserva los grants viejos (anon incluido): se sacan a mano.
revoke all on function public.rotate_customer_qr_token(uuid) from public, anon;
grant execute on function public.rotate_customer_qr_token(uuid) to authenticated;

notify pgrst, 'reload schema';
