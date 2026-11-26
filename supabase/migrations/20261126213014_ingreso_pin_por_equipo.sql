-- ============================================================
-- Ingreso · PIN por equipo (26/11/2026)
-- ============================================================
-- Pedido de Nacho: «estaría bueno que tengan un PIN para entrar luego más fácil».
--
-- Cómo funciona: la primera vez en un equipo (un celular, la compu de la caja) se entra con mail y
-- contraseña y ahí se elige un PIN de 4 números. Desde entonces, en ESE equipo se entra tocando el
-- nombre y el PIN. Varias personas pueden tener su PIN en el mismo equipo.
--
-- Por qué es seguro con solo 4 números:
--   · El PIN no sirve solo. Cada equipo guarda un secreto largo y al azar (en una cookie que el
--     navegador no deja leer a las páginas); acá queda solo su huella (sha256). Sin el secreto de ese
--     equipo, adivinar un PIN no abre nada.
--   · A los 5 PIN equivocados seguidos se bloquea y hay que entrar con la contraseña.
--   · Si a la persona la sacan del bar, sus PIN se borran. Si le cambian la contraseña, también (eso
--     lo hace la app al cambiarla).
--   · Mientras tenga pendiente elegir su contraseña, el PIN no vale.
--
-- Qué trae: UNA tabla (`device_pins`) y sus funciones. Nada más se toca.
--
-- Permisos: la tabla no se lee ni se escribe directo desde ningún navegador (RLS prendida y sin
-- políticas, y sin GRANT a `authenticated` ni `anon`: a propósito). Poner, quitar y consultar el PIN
-- propio pasa por funciones que usan la sesión de quien pide; comprobar un PIN y listar las cuentas de
-- un equipo solo lo hace la app con la clave de servicio, desde la pantalla de ingreso.

set local lock_timeout = '5s';

create table public.device_pins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- El equipo. No es una cuenta ni una persona: es el navegador donde se eligió el PIN.
  device_id uuid not null,
  -- sha256 (hex) del secreto que guarda ese equipo.
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  -- bcrypt del PIN.
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_at timestamptz,
  last_used_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, user_id)
);
create index device_pins_user_idx on public.device_pins (user_id);
create index device_pins_tenant_user_idx on public.device_pins (tenant_id, user_id);

comment on table public.device_pins is
  'PIN de ingreso por equipo: una fila por persona y por navegador donde eligió su PIN. No guarda ni el PIN ni el secreto del equipo, solo sus huellas. Nadie la lee ni la escribe directo: todo pasa por las funciones device_pin_*.';

create trigger device_pins_updated_at
  before update on public.device_pins
  for each row execute function public.set_updated_at();

alter table public.device_pins enable row level security;
-- Sin políticas a propósito: con RLS prendida y ninguna política, nadie con sesión (ni sin ella) ve o
-- toca una fila. Y sin GRANT, la tabla ni siquiera existe para la API de esos roles.
revoke all on public.device_pins from public, anon, authenticated;
grant select, insert, update, delete on public.device_pins to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Un PIN que cualquiera prueba primero no se acepta: cuatro iguales o una escalera.
-- ─────────────────────────────────────────────────────────────────────────────
create function private.device_pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_pin ~ '^(\d)\1{3}$'
      or position(p_pin in '0123456789') > 0
      or position(p_pin in '9876543210') > 0;
$$;
revoke all on function private.device_pin_is_weak(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Elegir (o cambiar) el PIN propio en un equipo. Lo llama la persona, ya con sesión.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.device_pin_set(
  p_device_id uuid,
  p_secret_hash text,
  p_pin text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_tenant uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_device_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_device' using errcode = '22023';
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if private.device_pin_is_weak(p_pin) then
    raise exception 'weak_pin' using errcode = '22023';
  end if;
  -- Con la contraseña de arranque todavía puesta no se elige un PIN: primero la propia.
  if exists (
    select 1 from auth.users u
     where u.id = v_me and (u.raw_app_meta_data ->> 'must_change_password') = 'true'
  ) then
    raise exception 'must_change_password' using errcode = '42501';
  end if;

  -- El bar: el que tiene activo, o el primero donde está.
  select uat.tenant_id into v_tenant
    from public.user_active_tenant uat
    join public.memberships m on m.tenant_id = uat.tenant_id and m.user_id = uat.user_id
   where uat.user_id = v_me;
  if v_tenant is null then
    select m.tenant_id into v_tenant
      from public.memberships m where m.user_id = v_me
     order by m.created_at limit 1;
  end if;
  if v_tenant is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- El equipo ya tiene PIN de otras personas: el secreto que trae tiene que ser el de ese equipo.
  if exists (
    select 1 from public.device_pins d
     where d.device_id = p_device_id and d.secret_hash <> p_secret_hash
  ) then
    raise exception 'invalid_device' using errcode = '22023';
  end if;
  -- Topes para que nadie llene la tabla: un equipo compartido tiene una docena de personas a lo sumo.
  if (select count(*) from public.device_pins d where d.device_id = p_device_id and d.user_id <> v_me) >= 20
     or (select count(*) from public.device_pins d where d.user_id = v_me and d.device_id <> p_device_id) >= 12 then
    raise exception 'too_many_pins' using errcode = '54000';
  end if;

  insert into public.device_pins as d (tenant_id, user_id, device_id, secret_hash, pin_hash, user_agent)
  values (v_tenant, v_me, p_device_id, p_secret_hash,
          extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), left(p_user_agent, 300))
  on conflict (device_id, user_id) do update
     set tenant_id = excluded.tenant_id,
         secret_hash = excluded.secret_hash,
         pin_hash = excluded.pin_hash,
         user_agent = excluded.user_agent,
         failed_attempts = 0,
         locked_at = null
  returning d.id into v_id;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (v_tenant, v_me, 'auth.pin_set', 'device_pin', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- ¿Tengo PIN en este equipo? (para la hoja «Tu cuenta»).
create function public.device_pin_status(p_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'locked', d.locked_at is not null)
       from public.device_pins d
      where d.device_id = p_device_id and d.user_id = (select auth.uid())),
    jsonb_build_object('exists', false, 'locked', false)
  );
$$;

-- Quitar el PIN propio de un equipo.
create function public.device_pin_remove(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_row public.device_pins%rowtype;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  delete from public.device_pins d
   where d.device_id = p_device_id and d.user_id = v_me
  returning * into v_row;
  if not found then
    return false;
  end if;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (v_row.tenant_id, v_me, 'auth.pin_removed', 'device_pin', v_row.id, '{}'::jsonb);
  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La pantalla de ingreso (sin sesión): solo la app, con la clave de servicio.
-- ─────────────────────────────────────────────────────────────────────────────
-- Quiénes pueden entrar con PIN en este equipo. Sin el secreto del equipo no devuelve nada.
create function public.device_pin_accounts(p_device_id uuid, p_secret text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', x.name, 'locked', x.locked
         ) order by x.last_used_at desc nulls last, x.created_at), '[]'::jsonb)
    from (
      select d.id, d.last_used_at, d.created_at, d.locked_at is not null as locked,
             private.pos_actor_name(d.tenant_id, d.user_id) as name
        from public.device_pins d
        join public.memberships m on m.tenant_id = d.tenant_id and m.user_id = d.user_id
        join auth.users u on u.id = d.user_id
       where d.device_id = p_device_id
         and p_secret is not null
         and d.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
         and coalesce(u.raw_app_meta_data ->> 'must_change_password', '') <> 'true'
    ) x;
$$;

-- Comprobar un PIN. Devuelve a quién corresponde (para que la app le abra la sesión) o por qué no.
-- Cuenta los errores acá mismo, en la misma transacción: no hay forma de probar de más.
create function public.device_pin_verify(
  p_device_id uuid,
  p_secret text,
  p_pin_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max constant integer := 5;
  v_row public.device_pins%rowtype;
  v_email text;
  v_must boolean;
begin
  if p_device_id is null or p_secret is null or p_pin_id is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  select * into v_row from public.device_pins d
   where d.id = p_pin_id and d.device_id = p_device_id
   for update;
  -- Un equipo que no trae el secreto correcto no es ese equipo: no se le dice nada ni se cuenta.
  if not found or v_row.secret_hash <> encode(extensions.digest(p_secret, 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  -- Ya no es parte del bar: el PIN se va.
  if not exists (
    select 1 from public.memberships m
     where m.tenant_id = v_row.tenant_id and m.user_id = v_row.user_id
  ) then
    delete from public.device_pins d where d.id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  select u.email::text, coalesce(u.raw_app_meta_data ->> 'must_change_password', '') = 'true'
    into v_email, v_must
    from auth.users u where u.id = v_row.user_id;
  if v_email is null or v_must then
    return jsonb_build_object('ok', false, 'reason', 'password');
  end if;
  if v_row.locked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', v_max - v_row.failed_attempts);
  end if;

  if v_row.pin_hash = extensions.crypt(p_pin, v_row.pin_hash) then
    update public.device_pins d
       set failed_attempts = 0, last_used_at = now()
     where d.id = v_row.id;
    return jsonb_build_object('ok', true, 'user_id', v_row.user_id, 'email', v_email,
                              'tenant_id', v_row.tenant_id);
  end if;

  if v_row.failed_attempts + 1 >= v_max then
    update public.device_pins d
       set failed_attempts = v_row.failed_attempts + 1, locked_at = now()
     where d.id = v_row.id;
    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
    values (v_row.tenant_id, v_row.user_id, 'auth.pin_locked', 'device_pin', v_row.id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  update public.device_pins d
     set failed_attempts = v_row.failed_attempts + 1
   where d.id = v_row.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', v_max - v_row.failed_attempts - 1);
end;
$$;

-- A quien se va del bar se le borran los PIN de ese bar.
create function private.device_pins_tg_membership_gone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.device_pins d
   where d.tenant_id = old.tenant_id and d.user_id = old.user_id;
  return null;
end;
$$;
revoke all on function private.device_pins_tg_membership_gone() from public, anon, authenticated;

create trigger memberships_drop_device_pins
  after delete on public.memberships
  for each row execute function private.device_pins_tg_membership_gone();

revoke all on function public.device_pin_set(uuid, text, text, text) from public, anon;
revoke all on function public.device_pin_status(uuid) from public, anon;
revoke all on function public.device_pin_remove(uuid) from public, anon;
revoke all on function public.device_pin_accounts(uuid, text) from public, anon, authenticated;
revoke all on function public.device_pin_verify(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.device_pin_set(uuid, text, text, text) to authenticated;
grant execute on function public.device_pin_status(uuid) to authenticated;
grant execute on function public.device_pin_remove(uuid) to authenticated;
grant execute on function public.device_pin_accounts(uuid, text) to service_role;
grant execute on function public.device_pin_verify(uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
