-- Phase 9c: seed regla canónica de puntos para HUB ($1 = 1 punto)
-- Desactiva (no borra) reglas previas para mantener historia del ledger.
-- Idempotente: si ya existe la regla canónica, no la duplica.

do $$
declare
  v_tenant_id uuid;
  v_existing_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'hub' limit 1;
  if v_tenant_id is null then
    raise notice 'tenant hub no existe, skip seed';
    return;
  end if;

  -- Buscar regla canónica ya existente
  select id into v_existing_id
    from public.points_rules
    where tenant_id = v_tenant_id
      and type = 'per_amount'
      and (config->>'every_cents')::bigint = 100
      and (config->>'points')::int = 1
    limit 1;

  if v_existing_id is null then
    insert into public.points_rules (tenant_id, type, config, priority, active)
    values (
      v_tenant_id,
      'per_amount',
      jsonb_build_object('every_cents', 100, 'points', 1),
      100,
      true
    );
  else
    update public.points_rules
      set active = true, priority = 100
      where id = v_existing_id;
  end if;

  -- Desactivar otras per_amount activas (no borra para conservar trazabilidad)
  update public.points_rules
    set active = false
    where tenant_id = v_tenant_id
      and type = 'per_amount'
      and active = true
      and not (
        (config->>'every_cents')::bigint = 100
        and (config->>'points')::int = 1
      );
end $$;
