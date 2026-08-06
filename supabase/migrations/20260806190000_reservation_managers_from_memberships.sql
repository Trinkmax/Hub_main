-- ─────────────────────────────────────────────────────────────
-- Gestores de reserva = equipo con cuenta (automático)
--
-- Problema: `reservation_managers` era un ABM 100% manual, escondido en
-- Configuración → Comisiones → tab «Gestores». Nadie lo mantenía, así que
-- el select "Gestor principal" del form de reserva terminaba ofreciendo un
-- solo nombre aunque el bar tuviera diez cuentas activas cargando reservas.
--
-- Solución: cada membership tiene su gestor espejo, creado al entrar al
-- equipo y desactivado al salir. Los gestores SIN cuenta (una recepcionista
-- que no usa la app, un turno genérico) siguen existiendo: se cargan a mano
-- y conviven con los automáticos. Nunca borramos filas: `salon_reservations`
-- y `commission_ledger` referencian gestores con `on delete restrict`.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Provisión idempotente de un gestor para (tenant, user) ────────────
create or replace function public.provision_reservation_manager(
  p_tenant uuid,
  p_user   uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text;
  v_name  text;
  v_base  text;
  v_try   text;
  v_n     int := 1;
begin
  if p_tenant is null or p_user is null then
    return null;
  end if;

  -- a) Ya tiene gestor vinculado → lo reactivamos (volvió al equipo).
  select id into v_id
    from public.reservation_managers
   where tenant_id = p_tenant
     and user_id = p_user
   order by created_at asc
   limit 1;

  if v_id is not null then
    update public.reservation_managers
       set active = true
     where id = v_id
       and active = false;
    return v_id;
  end if;

  select u.email::text,
         nullif(
           trim(coalesce(
             u.raw_user_meta_data ->> 'full_name',
             u.raw_user_meta_data ->> 'name',
             ''
           )),
           ''
         )
    into v_email, v_name
    from auth.users u
   where u.id = p_user;

  -- Nombre visible: el que la persona cargó en su cuenta; si no hay, la
  -- parte local del mail. El dueño lo puede renombrar desde el ABM.
  v_base := left(
    coalesce(v_name, nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Gestor'),
    80
  );

  -- b) Ya existe un gestor con ese nombre y SIN cuenta → es la misma
  --    persona, cargada a mano antes de invitarla. Se vincula, no se duplica.
  select id into v_id
    from public.reservation_managers
   where tenant_id = p_tenant
     and user_id is null
     and lower(display_name) = lower(v_base)
   order by created_at asc
   limit 1;

  if v_id is not null then
    update public.reservation_managers
       set user_id = p_user,
           active  = true,
           -- `citext` vive en public (no en extensions) y con search_path
           -- vacío hay que calificarlo sí o sí.
           email   = coalesce(email, v_email::public.citext)
     where id = v_id;
    return v_id;
  end if;

  -- c) Alta nueva. `unique (tenant_id, display_name)`: si el nombre ya está
  --    tomado por OTRA persona, desambiguamos con sufijo numérico.
  v_try := v_base;
  while exists (
    select 1
      from public.reservation_managers
     where tenant_id = p_tenant
       and lower(display_name) = lower(v_try)
  ) loop
    v_n := v_n + 1;
    v_try := left(v_base, 76) || ' ' || v_n::text;
  end loop;

  insert into public.reservation_managers
    (tenant_id, user_id, display_name, email, commission_eligible, active)
  values
    (p_tenant, p_user, v_try, v_email::public.citext, false, true)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.provision_reservation_manager(uuid, uuid) is
  'Crea (o reactiva/vincula) el gestor de reservas espejo de un miembro del equipo. Idempotente. La llaman los triggers de memberships.';

revoke execute on function public.provision_reservation_manager(uuid, uuid)
  from public, anon, authenticated;

-- ── 2. Trigger: entra al equipo → aparece en el select de gestores ───────
create or replace function public.tg_memberships_provision_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.provision_reservation_manager(new.tenant_id, new.user_id);
  return null;
end;
$$;

revoke execute on function public.tg_memberships_provision_manager()
  from public, anon, authenticated;

drop trigger if exists memberships_provision_manager on public.memberships;
create trigger memberships_provision_manager
  after insert on public.memberships
  for each row execute function public.tg_memberships_provision_manager();

-- ── 3. Trigger: sale del equipo → deja de ofrecerse (no se borra) ────────
create or replace function public.tg_memberships_deactivate_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reservation_managers
     set active = false
   where tenant_id = old.tenant_id
     and user_id = old.user_id
     and active;
  return null;
end;
$$;

revoke execute on function public.tg_memberships_deactivate_manager()
  from public, anon, authenticated;

drop trigger if exists memberships_deactivate_manager on public.memberships;
create trigger memberships_deactivate_manager
  after delete on public.memberships
  for each row execute function public.tg_memberships_deactivate_manager();

-- ── 4. Backfill: todo el equipo actual, de todos los tenants ─────────────
do $$
declare
  r record;
begin
  for r in select tenant_id, user_id from public.memberships order by created_at asc loop
    perform public.provision_reservation_manager(r.tenant_id, r.user_id);
  end loop;
end;
$$;
