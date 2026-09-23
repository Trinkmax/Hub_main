-- ============================================================
-- set_reservation_table_label — la mesa también la carga el mozo
-- ============================================================
-- El dueño (23/09/2026) pidió que el MOZO pueda anotar en qué mesa se sentó una
-- reserva. Hasta hoy solo podía marcar "Llegó": la mesa la cargaba la anfitriona
-- desde el tablero del manager, así que en la práctica quedaba vacía justo
-- cuando más sirve (a mitad del servicio alguien pregunta "¿dónde está la mesa
-- de García?" y el que tiene el dato es el que la sentó).
--
-- No se resuelve abriendo la RLS: la policy `sr_staff_write` de
-- `salon_reservations` es `for all` y deja escribir solo a owner/cashier/host
-- a propósito (el mozo no crea ni edita reservas). Por eso TODO lo que el mozo
-- sí puede hacer va por RPC SECURITY DEFINER — `transition_reservation_status`,
-- `update_reservation_actual_guests` — y la mesa sigue el mismo camino: una
-- función chica que toca UNA columna y chequea el rol contra el tenant de la
-- reserva. Con UPDATE directo el mozo se comía un "0 filas" mudo: la RLS no
-- tira error, simplemente no ve la fila y la app le decía "no pudimos guardar"
-- sin motivo.
--
-- No recalcula comisiones ni cupos: la mesa es informativa
-- (ver 20260905150000_reservation_table_label).

-- Esta migración se aplicó primero sin `p_tenant_id` y se corrigió en el acto
-- (todavía sin commitear). El drop está porque agregar el parámetro CAMBIA la
-- firma: sin él quedarían dos versiones conviviendo, la de 2 argumentos y la de
-- 3, y PostgREST no sabría cuál llamar.
drop function if exists public.set_reservation_table_label(uuid, text);

-- `p_tenant_id` es el bar de la URL (`requireTenantAccess(slug)`). Va aparte del
-- tenant de la fila a propósito: la LEY multi-tenant (CLAUDE.md §4) pide que
-- toda escritura lleve el tenant explícito. Sin él, alguien con membresía en dos
-- bares podía, llamando con el slug del bar A y el id de una reserva del bar B,
-- escribir en B mientras la auditoría y el revalidate hablaban de A.
create function public.set_reservation_table_label(
  p_reservation_id uuid,
  p_table_label text,
  p_tenant_id uuid default null
) returns table (id uuid, table_label text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_res public.salon_reservations;
  v_role public.tenant_role;
  v_label text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_res
    from public.salon_reservations sr
   where sr.id = p_reservation_id
   for update;
  if v_res.id is null then raise exception 'reservation_not_found' using errcode = 'P0001'; end if;

  -- La reserva tiene que ser del bar por el que entró el usuario, no de
  -- cualquiera en el que sea miembro.
  if p_tenant_id is not null and v_res.tenant_id <> p_tenant_id then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Mismos cuatro roles que `RESERVATION_OPERATOR_ROLES` en lib/tenant/roles.ts:
  -- los que están en el salón durante el servicio. `kitchen` y `editor` quedan
  -- afuera (no sientan gente), igual que un usuario de otro bar: `forbidden`.
  v_role := public.user_role_in_tenant(v_res.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter', 'host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Mismo normalizado que el zod del borde (`tableLabelField`): trim, espacios
  -- colapsados y vacío = "la quitaron" (null). Se repite acá porque la RPC es un
  -- borde propio — cualquiera con sesión puede llamarla sin pasar por la Server
  -- Action — y porque el CHECK `salon_reservations_table_label_len` rechaza un
  -- string en blanco.
  v_label := nullif(btrim(regexp_replace(coalesce(p_table_label, ''), '\s+', ' ', 'g')), '');
  if v_label is not null and length(v_label) > 24 then
    raise exception 'table_label_too_long' using errcode = 'P0001';
  end if;

  update public.salon_reservations sr
     set table_label = v_label
   where sr.id = p_reservation_id
   returning sr.* into v_res;

  -- Solo lo que la pantalla necesita para pintar la fila: la reserva entera ya
  -- viaja por Realtime y acá sobraría (y arrastraría el teléfono del cliente).
  return query select v_res.id, v_res.table_label, v_res.updated_at;
end; $$;

-- En este proyecto ALTER DEFAULT PRIVILEGES le da EXECUTE a anon/authenticated
-- a toda función nueva de `public` (ver 20260613030000_lock_internal_functions),
-- así que el revoke a `anon` hay que escribirlo: el de `public` no alcanza.
revoke all on function public.set_reservation_table_label(uuid, text, uuid) from public;
revoke execute on function public.set_reservation_table_label(uuid, text, uuid) from anon;
grant execute on function public.set_reservation_table_label(uuid, text, uuid) to authenticated;

comment on function public.set_reservation_table_label(uuid, text, uuid) is
  'Asigna, cambia o quita la mesa de una reserva (owner, cashier, waiter, host). SECURITY DEFINER porque la RLS de salon_reservations solo deja escribir a owner/cashier/host y la mesa la carga el mozo al sentar.';

notify pgrst, 'reload schema';
