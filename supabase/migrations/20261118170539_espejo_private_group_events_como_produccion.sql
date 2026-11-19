-- Solo para las bases que se arman desde estos archivos (el CI y una base local). En producción no hace nada.
--
-- El archivo de `private_group_events` (20261002120000) tiene dos comentarios adentro de
-- `ensure_scheduled_event_for_template` que no están en lo que se aplicó en producción el 02/10/2026. La tanda 2 de
-- sucursales (20261118170540) empieza con un candado que compara el texto de esa función con el de producción, así
-- que en una base nueva frenaba («ensure_scheduled_event_for_template cambió…») y el CI no levantaba la base.
--
-- Acá la función queda con el texto exacto de producción, y solo si todavía tiene el del archivo. En producción la
-- versión de cuatro parámetros ya no existe (la tanda 2 la reemplazó por una que recibe la sucursal), así que no hay
-- nada que tocar y esta migración no figura en su registro. No cambia lo que hace la función: son dos comentarios.

do $do$
begin
  if (select md5(prosrc) from pg_proc
       where oid = to_regprocedure(
         'public.ensure_scheduled_event_for_template(uuid,date,time without time zone,integer)'))
     = 'ce4d42646b10204368a3765d7514889b' then
    execute $sql$
create or replace function public.ensure_scheduled_event_for_template(
  p_template_id uuid,
  p_event_date date,
  p_starts_at_local time default '21:00'::time,
  p_capacity int default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_template public.scheduled_event_templates;
  v_role public.tenant_role;
  v_existing_id uuid;
  v_new_id uuid;
  v_capacity int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select * into v_template from public.scheduled_event_templates where id = p_template_id;
  if v_template.id is null then raise exception 'template_not_found' using errcode = 'P0001'; end if;

  v_role := public.user_role_in_tenant(v_template.tenant_id);
  if v_role is null or v_role not in ('owner','cashier','host') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select id into v_existing_id from public.scheduled_events
   where tenant_id = v_template.tenant_id
     and template_id = p_template_id
     and event_date = p_event_date;

  if v_existing_id is not null then return v_existing_id; end if;

  v_capacity := coalesce(p_capacity, v_template.default_capacity, 30);
  insert into public.scheduled_events (
    tenant_id, template_id, event_date, starts_at_local,
    capacity, meal_type, full_bonus_active, notes, private_group
  ) values (
    v_template.tenant_id, p_template_id, p_event_date, p_starts_at_local,
    v_capacity, v_template.default_meal_type, false,
    'Ad-hoc creado por reserva especial', true
  ) returning id into v_new_id;

  return v_new_id;
end; $$
$sql$;
  end if;
end
$do$;
