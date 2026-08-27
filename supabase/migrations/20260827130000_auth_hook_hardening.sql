-- ============================================================
-- Hardening del hook de JWT (post-review del fast-path de auth)
-- ============================================================
-- Hallazgos de la revisión adversarial de 20260827120000_perf_auth_fastpath:
--   1. Si el hook lanza (p. ej. alguien revoca el select sobre tenants), GoTrue
--      rechaza la emisión del token y NADIE puede loguearse. Ahora cualquier
--      excepción degrada a "devolver el evento sin enriquecer": el proxy y las
--      pages caen al fallback de DB (más lento, nunca roto).
--   2. `claims.app_metadata` como JSON null (no ausente) rompía jsonb_set
--      ("cannot set path in scalar"). Se normaliza con jsonb_typeof.
--   3. Sin tope, una cuenta miembro de decenas de bares inflaría la cookie de
--      sesión hasta el límite de headers. Se limita a 20 memberships (por alta)
--      y se marca `tenants_truncated=true` para que el cliente ignore el claim
--      y resuelva por DB.
-- No cambia el contrato del claim: app_metadata.tenants = [{id, slug, role}].
-- ============================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  app_meta jsonb;
  active_tid uuid;
  user_uuid uuid;
  tenants_json jsonb;
  total_memberships int;
begin
  -- El cast va ADENTRO del bloque: en DECLARE quedaría fuera del EXCEPTION.
  user_uuid := (event ->> 'user_id')::uuid;
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  app_meta := case
    when jsonb_typeof(claims -> 'app_metadata') = 'object' then claims -> 'app_metadata'
    else '{}'::jsonb
  end;

  select tenant_id into active_tid
  from public.user_active_tenant
  where user_id = user_uuid;

  if active_tid is null then
    select tenant_id into active_tid
    from public.memberships where user_id = user_uuid
    order by created_at limit 1;
  end if;

  select count(*) into total_memberships
  from public.memberships where user_id = user_uuid;

  -- Memberships del usuario (máx. 20, por orden de alta). Chico a propósito:
  -- viaja en la cookie de sesión en cada request.
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', t.id, 'slug', t.slug, 'role', m.role)
      order by m.created_at
    ),
    '[]'::jsonb
  )
  into tenants_json
  from (
    select m.tenant_id, m.role, m.created_at
    from public.memberships m
    where m.user_id = user_uuid
    order by m.created_at
    limit 20
  ) m
  join public.tenants t on t.id = m.tenant_id;

  if active_tid is not null then
    app_meta := jsonb_set(app_meta, '{active_tenant_id}', to_jsonb(active_tid::text));
  end if;
  app_meta := jsonb_set(app_meta, '{tenants}', tenants_json);
  if total_memberships > 20 then
    app_meta := jsonb_set(app_meta, '{tenants_truncated}', 'true'::jsonb);
  else
    app_meta := app_meta - 'tenants_truncated';
  end if;

  claims := jsonb_set(claims, '{app_metadata}', app_meta);
  return jsonb_set(event, '{claims}', claims);
exception
  when others then
    -- Nunca bloquear un login por el enriquecimiento: sin claims el proxy y
    -- requireTenantAccess resuelven por DB.
    return event;
end; $$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: inyecta app_metadata.active_tenant_id y app_metadata.tenants=[{id,slug,role}] (máx. 20, tenants_truncated=true si hay más). Solo ruteo — la autorización real sigue en RLS. Ante cualquier error devuelve el evento sin tocar.';
