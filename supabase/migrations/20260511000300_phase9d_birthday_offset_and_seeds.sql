-- Phase 9d: extender flow birthday con offset_days + seed flows para HUB
-- Pedido cliente:
--  a) Mandar a base de datos de cumpleaños 15 dias antes los beneficios
--  b) Mandar a base de datos de cumpleaños el mismo dia regalandole un cafe
--
-- Lectura del config: trigger_config->>'offset_days' (default 0).
-- offset_days = 0  → cumple hoy
-- offset_days = -15 → quien cumple en 15 días recibe HOY el aviso

create or replace function public.customers_for_birthday_flow(p_flow_id uuid)
returns table(customer_id uuid)
language sql
security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce((f.trigger_config->>'offset_days')::int, 0) as offset_days,
      f.tenant_id
    from public.flows f
    where f.id = p_flow_id
  ),
  target_date as (
    -- La fecha del cumple para la cual hoy queremos disparar la acción.
    -- offset_days=-15 significa: hoy quiero alcanzar a quien cumple en 15 días.
    select (current_date - (cfg.offset_days))::date as d, cfg.tenant_id from cfg
  )
  select c.id
  from public.customers c, target_date t
  where c.tenant_id = t.tenant_id
    and c.deleted_at is null
    and c.opt_in_marketing = true
    and c.birthdate is not null
    and extract(month from c.birthdate) = extract(month from t.d)
    and extract(day from c.birthdate) = extract(day from t.d)
    and not exists (
      select 1 from public.flow_executions fe
      where fe.flow_id = p_flow_id and fe.customer_id = c.id and fe.status = 'running'
    );
$$;
revoke execute on function public.customers_for_birthday_flow(uuid) from public, anon, authenticated;
grant execute on function public.customers_for_birthday_flow(uuid) to service_role;

-- Seed: dos flows inactivos en tenant HUB para que Nacho los active cuando
-- tenga su template de Meta aprobado.
do $$
declare
  v_tenant uuid;
  v_pre uuid;
  v_day uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub' limit 1;
  if v_tenant is null then
    raise notice 'tenant hub no existe, skip seed';
    return;
  end if;

  -- Cumple -15d (idempotente por nombre)
  select id into v_pre
    from public.flows
    where tenant_id = v_tenant
      and name = 'Cumpleaños -15 días'
    limit 1;
  if v_pre is null then
    insert into public.flows (tenant_id, name, trigger_type, trigger_config, active)
    values (
      v_tenant,
      'Cumpleaños -15 días',
      'birthday',
      jsonb_build_object('offset_days', -15),
      false
    ) returning id into v_pre;
  end if;

  -- Cumple día 0
  select id into v_day
    from public.flows
    where tenant_id = v_tenant
      and name = 'Cumpleaños día 0'
    limit 1;
  if v_day is null then
    insert into public.flows (tenant_id, name, trigger_type, trigger_config, active)
    values (
      v_tenant,
      'Cumpleaños día 0',
      'birthday',
      jsonb_build_object('offset_days', 0),
      false
    ) returning id into v_day;
  end if;
end $$;
