-- ============================================================
-- Sprint 1 «Administración» · fase 1 · migración #6
-- Acceso por persona: helpers, políticas de lectura, get_tenant_access y RPC de accesos
-- (spec §A.4, §B.2, §B.3, §B.4, §B.5.1, §B.7 fila audit_log, §G.5)
-- ============================================================
-- «Acceso» = fila vigente en acc_access Y membresía owner en ese bar Y flag
-- `accounting` prendido. La contadora (accountant) lee todo Administración con
-- el flag prendido y no escribe nada. Apagar el flag cierra lecturas y
-- escrituras en la base (las protecciones de gobierno no dependen del flag).
--
-- Qué crea:
--   1. acc_reader_tenant_ids() / acc_writer_tenant_ids(): set-returning,
--      SECURITY DEFINER (leen memberships sin pasar por su RLS); las políticas
--      los usan como `tenant_id in (select …)`, que Postgres evalúa UNA vez por
--      consulta (hashed subplan), no una llamada por fila.
--   2. acc_assert_reader/_writer/_admin para RPC y reportes (42501 =
--      autorización; TS lo mapea a «forbidden»).
--   3. La política SELECT `<prefijo>_select_readers` en las 18 tablas acc_*
--      (incluida acc_access, que quedó cerrada desde la #3). Sin políticas de
--      escritura y sin privilegios de escritura (la #3 y la #5).
--   4. acc_my_access(tenant) y get_tenant_access con la clave `accounting`
--      (mismo round-trip; get_tenant_access sigue INVOKER y su salida es la
--      misma de 20260827120000_perf_auth_fastpath + UNA clave).
--   5. audit_log: `audit_log_acc_select` (los lectores de Administración ven
--      las filas acc_*) + RESTRICTIVE `audit_log_acc_scope` (las filas acc_*
--      solo para lectores: un dueño sin acceso deja de verlas, los payloads
--      llevan montos). Las filas que no son acc_* no cambian para nadie.
--   6. RPC de accesos (§B.5.1): acc_grant_access, acc_revoke_access,
--      acc_claim_admin, acc_admin_names, acc_member_labels, y la designación
--      de plataforma acc_platform_designate_admin (§B.4). Todas auditan en la
--      transacción. (acc_member_is_protected ya existe: migración #3.)
-- ============================================================

-- Crea políticas en audit_log y reemplaza get_tenant_access (camino caliente):
-- si algo está tomado, fallar rápido y reintentar antes que encolar tráfico.
set local lock_timeout = '5s';

-- ─── 1. Helpers de lectura y escritura ──────────────────────────────────────
-- Bares donde quien llama LEE Administración: contadora o dueño con acceso vigente, con el flag prendido.
create function public.acc_reader_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = (select auth.uid())
     and t.feature_flags -> 'accounting' = 'true'::jsonb          -- comparación jsonb: un valor raro no rompe con un cast
     and (m.role = 'accountant'
          or (m.role = 'owner' and exists (
                select 1 from public.acc_access a
                 where a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null)))
$$;

-- Bares donde ESCRIBE: solo dueño con acceso vigente y flag prendido (la contadora nunca).
create function public.acc_writer_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    join public.acc_access a on a.tenant_id = m.tenant_id and a.user_id = m.user_id and a.revoked_at is null
   where m.user_id = (select auth.uid()) and m.role = 'owner'
     and t.feature_flags -> 'accounting' = 'true'::jsonb
$$;

comment on function public.acc_reader_tenant_ids() is
  'Bares donde quien llama lee Administración (contadora, o dueño con acceso vigente; flag accounting prendido). Base de las políticas SELECT acc_*.';
comment on function public.acc_writer_tenant_ids() is
  'Bares donde quien llama escribe en Administración (dueño con acceso vigente y flag prendido).';

-- ─── 2. Asserts ──────────────────────────────────────────────────────────────
create function public.acc_assert_reader(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null or p_tenant not in (select public.acc_reader_tenant_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create function public.acc_assert_writer(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null or p_tenant not in (select public.acc_writer_tenant_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant) then
    raise exception 'not_set_up' using errcode = 'P0001';
  end if;
end;
$$;

create function public.acc_assert_admin(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant is null or p_tenant not in (select public.acc_admin_tenant_ids()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants t
                  where t.id = p_tenant and t.feature_flags -> 'accounting' = 'true'::jsonb) then
    raise exception 'accounting_not_enabled' using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.acc_assert_reader(uuid) is
  'Corta con unauthenticated/forbidden (42501) si quien llama no lee Administración de ese bar.';
comment on function public.acc_assert_writer(uuid) is
  'Corta con unauthenticated/forbidden (42501) si quien llama no escribe en ese bar, y con not_set_up (P0001) si falta acc_settings.';
comment on function public.acc_assert_admin(uuid) is
  'Corta con unauthenticated/forbidden (42501) si quien llama no administra accesos de ese bar, y con accounting_not_enabled (P0001) si el flag está apagado.';

-- ─── 3. Política de lectura en las 18 tablas ────────────────────────────────
-- Una sola política permisiva, de SELECT: dueños con acceso vigente + contadora, flag prendido.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('acc_settings', 'ast'), ('acc_access', 'aax'), ('acc_fiscal_years', 'afy'), ('acc_periods', 'aper'),
      ('acc_period_events', 'apev'), ('acc_accounts', 'aac'), ('acc_parties', 'apt'),
      ('acc_treasury_accounts', 'atr'), ('acc_sales_points', 'asp'), ('acc_sales_methods', 'asm'),
      ('acc_recurring_expenses', 'arx'), ('acc_bundles', 'abd'), ('acc_documents', 'adoc'),
      ('acc_document_lines', 'adl'), ('acc_fiscal_vouchers', 'afv'), ('acc_journal_entries', 'aje'),
      ('acc_journal_lines', 'ajl'), ('acc_allocations', 'aal')) as x(tbl, prefix)
  loop
    execute format('drop policy if exists %I on public.%I', r.prefix || '_select_readers', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (tenant_id in (select public.acc_reader_tenant_ids()))',
      r.prefix || '_select_readers', r.tbl);
  end loop;
end $$;

-- ─── 4. acc_my_access y get_tenant_access (mismo round-trip) ────────────────
-- Lo que el shell necesita, en un objeto. Nunca null. Un no-miembro recibe todo en false
-- (también enabled y set_up: no se informa el estado de un bar ajeno).
-- plpgsql y no sql (a diferencia de la spec): corre en CADA carga de página dentro de get_tenant_access, y
-- una función sql definer se vuelve a planificar en cada consulta nueva (medido: 0,67 ms) mientras que
-- plpgsql cachea el plan por sesión (0,10 ms). Misma consulta, mismo resultado.
create function public.acc_my_access(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
  with me as (select m.role from public.memberships m
               where m.tenant_id = p_tenant and m.user_id = (select auth.uid())),
       t as (select (tt.feature_flags -> 'accounting') = 'true'::jsonb as enabled
               from public.tenants tt where tt.id = p_tenant),
       s as (select exists (select 1 from public.acc_settings x where x.tenant_id = p_tenant) as set_up),
       g as (select coalesce(bool_or(a.user_id = (select auth.uid())), false) as mine,
                    coalesce(bool_or(a.user_id = (select auth.uid()) and a.is_admin), false) as mine_admin,
                    count(*) > 0 as any_grant
               from public.acc_access a where a.tenant_id = p_tenant and a.revoked_at is null)
  select jsonb_build_object(
    'enabled',    coalesce(me.role is not null and t.enabled, false),
    'set_up',     coalesce(me.role is not null and s.set_up, false),
    'read',       coalesce(t.enabled and s.set_up and (me.role = 'accountant' or (me.role = 'owner' and g.mine)), false),
    'write',      coalesce(t.enabled and s.set_up and me.role = 'owner' and g.mine, false),
    'admin',      coalesce(me.role = 'owner' and g.mine_admin, false),
    -- Puede configurar: dueño, flag prendido, módulo sin configurar y (nadie designado o designado yo).
    'can_set_up', coalesce(t.enabled and not s.set_up and me.role = 'owner' and (not g.any_grant or g.mine), false))
  from s cross join g left join me on true left join t on true);
end;
$$;

comment on function public.acc_my_access(uuid) is
  'Acceso de quien llama a Administración del bar: {enabled, set_up, read, write, admin, can_set_up}. Nunca null; un no-miembro recibe todo en false.';

-- Definición vigente (20260827120000_perf_auth_fastpath.sql) + UNA clave. Sigue INVOKER: para la
-- contadora funciona porque la RESTRICTIVE de memberships le deja ver su fila y tenants no se restringe.
create or replace function public.get_tenant_access(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'tenant', to_jsonb(t),
    'role', m.role,
    'is_platform_admin', public.is_platform_admin(),
    'accounting', public.acc_my_access(t.id),
    'memberships', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', m2.role,
            'tenant', jsonb_build_object(
              'id', t2.id, 'name', t2.name, 'slug', t2.slug, 'logo_url', t2.logo_url
            )
          )
          order by m2.created_at
        ),
        '[]'::jsonb
      )
      from public.memberships m2
      join public.tenants t2 on t2.id = m2.tenant_id
      where m2.user_id = (select auth.uid())
    )
  )
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and t.slug = p_slug
  limit 1
$function$;

-- ─── 5. audit_log: la historia contable solo para quien lee Administración ──
drop policy if exists audit_log_acc_select on public.audit_log;
create policy audit_log_acc_select on public.audit_log
  for select to authenticated
  using (entity like 'acc\_%' escape '\' and tenant_id in (select public.acc_reader_tenant_ids()));

drop policy if exists audit_log_acc_scope on public.audit_log;
create policy audit_log_acc_scope on public.audit_log
  as restrictive for select to authenticated
  using (entity not like 'acc\_%' escape '\' or tenant_id in (select public.acc_reader_tenant_ids()));

-- ─── 6. RPC de accesos ───────────────────────────────────────────────────────
-- Dar acceso (o cambiar «Da accesos» y el nombre de quien ya lo tiene). Solo administradores.
create function public.acc_grant_access(p_tenant_id uuid, p_user_id uuid, p_is_admin boolean, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := coalesce(p_is_admin, false);
  v_name text;
  v_row public.acc_access;
  v_created boolean := false;
begin
  perform public.acc_assert_admin(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  if p_user_id is null or not exists (
       select 1 from public.memberships m
        where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.role = 'owner') then
    raise exception 'target_not_owner' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_name is null then
    v_name := private.acc_default_display_name(p_tenant_id, p_user_id);
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;

  select * into v_row from public.acc_access a
   where a.tenant_id = p_tenant_id and a.user_id = p_user_id and a.revoked_at is null
   for update;
  if found then
    -- Sacarle «Da accesos» al último administrador dejaría el bar sin nadie que dé accesos.
    if v_row.is_admin and not v_admin and not exists (
         select 1 from public.acc_access a
           join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
          where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin and a.id <> v_row.id) then
      raise exception 'last_admin' using errcode = 'P0001';
    end if;
    update public.acc_access set is_admin = v_admin, display_name = v_name
     where id = v_row.id
     returning * into v_row;
  else
    insert into public.acc_access (tenant_id, user_id, display_name, is_admin, source, granted_by, granted_by_name)
    values (p_tenant_id, p_user_id, v_name, v_admin, 'grant', v_uid, private.acc_actor_name(p_tenant_id, v_uid))
    returning * into v_row;
    v_created := true;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_access.granted', 'acc_access', v_row.id,
    jsonb_build_object('user_id', p_user_id, 'is_admin', v_row.is_admin, 'source', v_row.source));

  return jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'display_name', v_row.display_name, 'is_admin', v_row.is_admin,
    'source', v_row.source, 'granted_at', v_row.granted_at, 'created', v_created);
end;
$$;

-- Quitar acceso (marca revoked_*; nunca borra). No deja el bar sin administrador ni sin nadie con acceso:
-- revocarse a uno mismo vale si queda otro administrador.
create function public.acc_revoke_access(p_tenant_id uuid, p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_access;
begin
  perform public.acc_assert_admin(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  select * into v_row from public.acc_access a
   where a.tenant_id = p_tenant_id and a.user_id = p_user_id and a.revoked_at is null
   for update;
  if not found then
    raise exception 'access_not_found' using errcode = 'P0001';
  end if;
  -- Tiene que quedar otro administrador vigente (quien llama lo es; si se revoca a sí mismo, otro).
  if not exists (
       select 1 from public.acc_access a
         join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
        where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin and a.id <> v_row.id) then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;

  update public.acc_access
     set revoked_at = now(), revoked_by = v_uid,
         revoke_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
   where id = v_row.id;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_access.revoked', 'acc_access', v_row.id,
    jsonb_build_object('user_id', p_user_id, 'is_admin', v_row.is_admin, 'source', v_row.source));
end;
$$;

-- Recuperación: si no queda ningún administrador vigente, un dueño con acceso se hace administrador.
create function public.acc_claim_admin(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_access;
begin
  perform public.acc_assert_writer(p_tenant_id);
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  if exists (
       select 1 from public.acc_access a
         join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
        where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin) then
    raise exception 'admins_exist' using errcode = 'P0001';
  end if;

  update public.acc_access a set is_admin = true, source = 'claim'
   where a.tenant_id = p_tenant_id and a.user_id = v_uid and a.revoked_at is null
   returning * into v_row;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_access.admin_claimed', 'acc_access', v_row.id,
    jsonb_build_object('user_id', v_uid, 'is_admin', true, 'source', 'claim'));
end;
$$;

-- Solo nombres (nunca emails) de quienes administran los accesos. Para la pantalla «Administración es
-- privada»: la ve cualquier dueño del bar, tenga o no acceso.
create function public.acc_admin_names(p_tenant_id uuid)
returns table (display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_tenant_id is null or coalesce(public.user_role_in_tenant(p_tenant_id)::text, '') <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.display_name
      from public.acc_access a
      join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
     where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin
     order by a.display_name;
end;
$$;

-- Nombres visibles de quienes figuran como autores en acc_access y en la historia contable de audit_log.
create function public.acc_member_labels(p_tenant_id uuid)
returns table (user_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.acc_assert_reader(p_tenant_id);
  return query
    with ids as (
      select a.user_id as uid from public.acc_access a where a.tenant_id = p_tenant_id
      union
      select a.granted_by from public.acc_access a where a.tenant_id = p_tenant_id and a.granted_by is not null
      union
      select a.revoked_by from public.acc_access a where a.tenant_id = p_tenant_id and a.revoked_by is not null
      union
      select l.user_id from public.audit_log l
       where l.tenant_id = p_tenant_id and l.user_id is not null and l.entity like 'acc\_%' escape '\'
    )
    select ids.uid, private.acc_actor_name(p_tenant_id, ids.uid)
      from ids
     where ids.uid is not null;
end;
$$;

-- Plataforma: el superadmin designa quién configura (o recupera el acceso si no queda ningún
-- administrador). Exige que el elegido sea dueño, y que el módulo esté sin configurar o sin
-- administradores vigentes.
create function public.acc_platform_designate_admin(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.acc_access;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(private.acc_lock_key(p_tenant_id));

  if p_tenant_id is null or p_user_id is null or not exists (
       select 1 from public.memberships m
        where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.role = 'owner') then
    raise exception 'target_not_owner' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.acc_settings s where s.tenant_id = p_tenant_id)
     and exists (
       select 1 from public.acc_access a
         join public.memberships m on m.tenant_id = a.tenant_id and m.user_id = a.user_id and m.role = 'owner'
        where a.tenant_id = p_tenant_id and a.revoked_at is null and a.is_admin) then
    raise exception 'admins_exist' using errcode = 'P0001';
  end if;

  select * into v_row from public.acc_access a
   where a.tenant_id = p_tenant_id and a.user_id = p_user_id and a.revoked_at is null
   for update;
  if found then
    update public.acc_access set is_admin = true where id = v_row.id returning * into v_row;
  else
    insert into public.acc_access (tenant_id, user_id, display_name, is_admin, source, granted_by, granted_by_name)
    values (p_tenant_id, p_user_id, private.acc_default_display_name(p_tenant_id, p_user_id), true, 'platform',
            null, 'Soporte HUB')
    returning * into v_row;
  end if;

  perform private.acc_audit(p_tenant_id, v_uid, 'acc_access.designated_by_platform', 'acc_access', v_row.id,
    jsonb_build_object('user_id', p_user_id, 'is_admin', true, 'source', v_row.source));
end;
$$;

comment on function public.acc_grant_access(uuid, uuid, boolean, text) is
  'Da acceso a Administración a un dueño (o actualiza «Da accesos» y el nombre). Solo administradores. Audita acc_access.granted.';
comment on function public.acc_revoke_access(uuid, uuid, text) is
  'Quita el acceso (revoked_*; nunca borra). No deja el bar sin administrador. Audita acc_access.revoked.';
comment on function public.acc_claim_admin(uuid) is
  'Un dueño con acceso se hace administrador cuando no queda ninguno vigente. Audita acc_access.admin_claimed.';
comment on function public.acc_admin_names(uuid) is
  'Nombres (sin emails) de quienes administran los accesos. Para cualquier dueño del bar.';
comment on function public.acc_member_labels(uuid) is
  'Nombres visibles de los autores que figuran en acc_access y en la historia contable de audit_log. Para lectores.';
comment on function public.acc_platform_designate_admin(uuid, uuid) is
  'Superadmin de plataforma: designa al dueño que configura (o recupera el acceso sin administradores). Audita acc_access.designated_by_platform.';

-- ─── 7. Grants ───────────────────────────────────────────────────────────────
-- Helpers y asserts: solo devuelven datos de quien llama (auth.uid()); exponerlos no filtra nada.
revoke all on function public.acc_reader_tenant_ids() from public, anon;
grant execute on function public.acc_reader_tenant_ids() to authenticated;
revoke all on function public.acc_writer_tenant_ids() from public, anon;
grant execute on function public.acc_writer_tenant_ids() to authenticated;
revoke all on function public.acc_assert_reader(uuid) from public, anon;
grant execute on function public.acc_assert_reader(uuid) to authenticated;
revoke all on function public.acc_assert_writer(uuid) from public, anon;
grant execute on function public.acc_assert_writer(uuid) to authenticated;
revoke all on function public.acc_assert_admin(uuid) from public, anon;
grant execute on function public.acc_assert_admin(uuid) to authenticated;
revoke all on function public.acc_my_access(uuid) from public, anon;
grant execute on function public.acc_my_access(uuid) to authenticated;
revoke all on function public.get_tenant_access(text) from public, anon;
grant execute on function public.get_tenant_access(text) to authenticated;

revoke all on function public.acc_grant_access(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.acc_grant_access(uuid, uuid, boolean, text) to authenticated;
revoke all on function public.acc_revoke_access(uuid, uuid, text) from public, anon;
grant execute on function public.acc_revoke_access(uuid, uuid, text) to authenticated;
revoke all on function public.acc_claim_admin(uuid) from public, anon;
grant execute on function public.acc_claim_admin(uuid) to authenticated;
revoke all on function public.acc_admin_names(uuid) from public, anon;
grant execute on function public.acc_admin_names(uuid) to authenticated;
revoke all on function public.acc_member_labels(uuid) from public, anon;
grant execute on function public.acc_member_labels(uuid) to authenticated;
revoke all on function public.acc_platform_designate_admin(uuid, uuid) from public, anon;
grant execute on function public.acc_platform_designate_admin(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
