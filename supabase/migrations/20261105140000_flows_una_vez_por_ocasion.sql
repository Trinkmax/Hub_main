-- Las automatizaciones de tiempo le repetían el mensaje a la misma persona (visto el 05/11/2026, antes de que nadie las
-- prendiera en HUB). El cron las evalúa cada 15 minutos y lo único que dejaba afuera a alguien era tener una ejecución
-- `running`: quien terminaba y seguía cumpliendo volvía a entrar. Con un flow de un mensaje, un cumpleañero lo recibía
-- cada 15 minutos todo el día, y un inactivo, sin fin.
--
-- Ahora cada una entra una vez por ocasión:
--   · cumpleaños: una vez por cumpleaños (no volvió a entrar en los últimos 300 días);
--   · hace tiempo que no viene: una vez cada vez que deja de venir (no entró desde su última visita);
--   · se acerca un evento: una vez por evento (la ejecución guarda `scheduled_event_id` en su contexto).
-- Las que entran por algo que pasa (una visita, una etiqueta) siguen como estaban: cada vez, si no está adentro.
--
-- La regla vive en un solo lugar, `flow_already_enrolled`, y la usan tanto los candidatos del cron como
-- `start_flow_for_customer`, que además toma un lock por flow y cliente: dos trabajos repetidos en la cola no crean
-- dos ejecuciones. Aditiva: no toca datos.

create or replace function public.flow_already_enrolled(
  p_flow_id uuid,
  p_customer_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.flows f
    join public.flow_executions fe on fe.flow_id = f.id and fe.customer_id = p_customer_id
    left join public.customers c on c.id = p_customer_id
    where f.id = p_flow_id
      and (
        fe.status = 'running'
        or (f.trigger_type = 'birthday' and fe.started_at > now() - interval '300 days')
        or (
          f.trigger_type = 'customer_inactive'
          and (c.last_visit_at is null or fe.started_at >= c.last_visit_at)
        )
        or (
          f.trigger_type = 'event_starting'
          and (
            (
              (p_context ->> 'scheduled_event_id') is not null
              and fe.context ->> 'scheduled_event_id' = p_context ->> 'scheduled_event_id'
            )
            -- Un pedido sin evento (de antes de este cambio): una vez por plazo.
            or (
              (p_context ->> 'scheduled_event_id') is null
              and fe.started_at > now() - interval '2 hours'
            )
          )
        )
      )
  );
$$;
revoke execute on function public.flow_already_enrolled(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.flow_already_enrolled(uuid, uuid, jsonb) to service_role;

create or replace function public.customers_for_birthday_flow(p_flow_id uuid)
returns table(customer_id uuid)
language sql
security definer
set search_path to 'public'
as $function$
  with cfg as (
    select
      coalesce((f.trigger_config->>'offset_days')::int, 0) as offset_days,
      f.tenant_id
    from public.flows f
    where f.id = p_flow_id
  ),
  target_date as (
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
    and not public.flow_already_enrolled(p_flow_id, c.id);
$function$;

create or replace function public.customers_for_inactive_flow(p_flow_id uuid, p_days integer)
returns table(customer_id uuid)
language sql
security definer
set search_path to 'public'
as $function$
  select c.id
  from public.customers c
  join public.flows f on f.id = p_flow_id
  where c.tenant_id = f.tenant_id
    and c.deleted_at is null
    and c.opt_in_marketing = true
    and c.last_visit_at is not null
    and c.last_visit_at < now() - (p_days || ' days')::interval
    and not public.flow_already_enrolled(p_flow_id, c.id);
$function$;

create or replace function public.start_flow_for_customer(
  p_flow_id uuid,
  p_customer_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.flows
    where id = p_flow_id and active = true;
  if v_tenant is null then return null; end if;

  -- De a uno por flow y cliente: dos trabajos repetidos en la cola esperan su turno y el segundo ve al primero.
  perform pg_advisory_xact_lock(hashtextextended(p_flow_id::text || ':' || p_customer_id::text, 0));

  if public.flow_already_enrolled(p_flow_id, p_customer_id, coalesce(p_context, '{}'::jsonb)) then
    return null;
  end if;

  insert into public.flow_executions (tenant_id, flow_id, customer_id, context)
  values (v_tenant, p_flow_id, p_customer_id, coalesce(p_context, '{}'::jsonb))
  returning id into v_id;

  insert into public.flow_execution_events (
    tenant_id, flow_id, execution_id, customer_id,
    action_type, action_label, status
  )
  values (
    v_tenant, p_flow_id, v_id, p_customer_id,
    'enrolled', 'Entró al flujo', 'executed'
  );

  return v_id;
end;
$$;
revoke execute on function public.start_flow_for_customer(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_flow_for_customer(uuid, uuid, jsonb) to service_role;
