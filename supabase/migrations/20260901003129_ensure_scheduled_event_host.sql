-- ============================================================
-- ensure_scheduled_event_for_template: el anfitrión también
-- ============================================================
-- El helper crea la instancia ad-hoc de un formato cuando alguien carga una
-- reserva especial (cumple/recibida) pidiendo, por ejemplo, "Pizza Libre" un
-- martes que no está programado. Tenía hardcodeado ('owner','cashier') desde
-- antes de que existiera el rol `host` (20260716175050), así que Luz cargaba la
-- reserva, pedía el formato y le explotaba con `forbidden` — sin salida, porque
-- /reservas es justo la pantalla donde vive todo su trabajo.
--
-- El host ya puede insertar en `scheduled_events` (policy `sev_staff_write` con
-- owner/cashier/host desde 20260716120100): esto solo alinea el chequeo del
-- helper con esa policy. Idéntico al original salvo la lista de roles.

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

  -- Existe instance ese día?
  select id into v_existing_id from public.scheduled_events
   where tenant_id = v_template.tenant_id
     and template_id = p_template_id
     and event_date = p_event_date;

  if v_existing_id is not null then return v_existing_id; end if;

  -- Crear ad-hoc.
  v_capacity := coalesce(p_capacity, v_template.default_capacity, 30);
  insert into public.scheduled_events (
    tenant_id, template_id, event_date, starts_at_local,
    capacity, meal_type, full_bonus_active, notes
  ) values (
    v_template.tenant_id, p_template_id, p_event_date, p_starts_at_local,
    v_capacity, v_template.default_meal_type, false,
    'Ad-hoc creado por reserva especial'
  ) returning id into v_new_id;

  return v_new_id;
end; $$;

revoke all on function public.ensure_scheduled_event_for_template(uuid, date, time, int) from public;
grant execute on function public.ensure_scheduled_event_for_template(uuid, date, time, int) to authenticated;

notify pgrst, 'reload schema';
