-- ============================================================
-- Seeds HUB para reservas de salón
-- ============================================================
-- Patrón seguro: lookup por slug, skip si no existe (no rompe otros tenants).
-- Idempotente: cada insert con on conflict do nothing.

do $seed$
declare
  v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'hub' limit 1;
  if v_tenant is null then
    raise notice 'tenant hub no existe, skip seed reservas';
    return;
  end if;

  -- 1) Capacidades default por zona en settings (no toca otras keys).
  update public.tenants
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
       'salon_capacities', jsonb_build_object(
         'planta_alta', 60,
         'planta_baja', 80
       )
     )
   where id = v_tenant
     and (settings ? 'salon_capacities') = false;

  -- 2) Gestores HUB. Luz y Joaquin son commission_eligible.
  insert into public.reservation_managers (tenant_id, display_name, commission_eligible)
  values
    (v_tenant, 'Luz',          true),
    (v_tenant, 'Joaquin',      true),
    (v_tenant, 'Eze',          false),
    (v_tenant, 'Joaco',        false),
    (v_tenant, 'Nacho',        false),
    (v_tenant, 'Piojo',        false),
    (v_tenant, 'Porte',        false),
    (v_tenant, 'Tomi',         false),
    (v_tenant, 'Turno Mañana', false)
  on conflict (tenant_id, display_name) do nothing;

  -- 3) Tarifas comisión HUB.
  -- Desayunos / Almuerzos / Meriendas: $140 / $160 / $180 / $220 por persona
  --   → en cents: 14000 / 16000 / 18000 / 22000.
  with meals(mt) as (
    values ('breakfast'::public.meal_type), ('lunch'::public.meal_type), ('tea_time'::public.meal_type)
  )
  insert into public.commission_rate_tiers
    (tenant_id, meal_type, min_guests, max_guests, rate_per_guest_cents)
  select v_tenant, mt, 1, 7,    14000 from meals
  union all select v_tenant, mt, 8, 15, 16000 from meals
  union all select v_tenant, mt, 16, 30, 18000 from meals
  union all select v_tenant, mt, 31, null, 22000 from meals
  on conflict do nothing;

  -- Cenas: $90 / $120 / $130 / $140 por persona.
  insert into public.commission_rate_tiers
    (tenant_id, meal_type, min_guests, max_guests, rate_per_guest_cents)
  values
    (v_tenant, 'dinner', 1, 7,     9000),
    (v_tenant, 'dinner', 8, 15,   12000),
    (v_tenant, 'dinner', 16, 30,  13000),
    (v_tenant, 'dinner', 31, null, 14000)
  on conflict do nothing;

  -- 4) Bonus full event: $200 por persona = 20000 cents.
  insert into public.commission_bonus_rules
    (tenant_id, scope, bonus_per_guest_cents)
  values (v_tenant, 'scheduled_event_full', 20000)
  on conflict (tenant_id, scope) do nothing;

  -- 5) Templates de evento programado del HUB.
  insert into public.scheduled_event_templates
    (tenant_id, name, slug, consume_special_reservations, default_capacity, default_meal_type, color_hex)
  values
    (v_tenant, 'Sushi Libre',         'sushi-libre',        true,  40, 'dinner', '#0ea5e9'),
    (v_tenant, 'Pizza Libre',         'pizza-libre',        true,  50, 'dinner', '#f97316'),
    (v_tenant, 'Ramen',               'ramen',              true,  30, 'dinner', '#dc2626'),
    (v_tenant, 'Mariscos y Vino',     'mariscos-y-vino',    true,  35, 'dinner', '#14b8a6'),
    (v_tenant, 'Noche Astral',        'noche-astral',       false, 60, 'dinner', '#7c3aed'),
    (v_tenant, 'Noche de Magia',      'noche-de-magia',     false, 60, 'dinner', '#a855f7'),
    (v_tenant, 'Día del Taco',        'dia-del-taco',       true,  40, 'dinner', '#ef4444'),
    (v_tenant, 'Merienda con Arte',   'merienda-con-arte',  true,  25, 'tea_time', '#ec4899')
  on conflict (tenant_id, slug) do nothing;
end $seed$;
