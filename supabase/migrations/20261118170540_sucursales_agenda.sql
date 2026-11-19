-- Sucursales en todo el sistema · tanda 2: la agenda por sucursal.
--
-- Cada reserva, cada fecha de evento, cada compra de entradas y cada cupo pasan a decir de qué sucursal son, y la
-- base lo exige. Lo existente queda en la sucursal principal de su bar (en HUB, la que hoy se llama «Principal»).
--
-- Cómo se rellena sin reescribir filas: la columna se agrega con un valor por defecto (la principal del bar con más
-- filas). Postgres lo guarda una sola vez en el catálogo, así que esas filas no se reescriben, no generan avisos en
-- vivo a los tableros abiertos y no cambia su «última modificación». Después se corrigen con UPDATE solo las filas de
-- los otros bares (pocas), se saca el valor por defecto y queda NOT NULL. `salon_reservations.branch_id` ya existía
-- (vacía = principal): se recrea igual, conservando las que ya tenían sucursal.
--
-- Lo provisorio: las tres tablas de cupo conservan su regla vieja de «una fila por bar» hasta que el código nuevo
-- esté en producción (hoy sus guardados la usan); se sacan en la tanda 6.

set local lock_timeout = '5s';

-- Candados de entrada: las funciones que se reemplazan, como se leyeron el 18/11/2026.
do $$
begin
  if (select md5(prosrc) from pg_proc
       where oid = 'public.ensure_scheduled_event_for_template(uuid,date,time without time zone,integer)'::regprocedure)
     <> '5baa43e4e4cd8f2b9d284e3e5f707b51' then
    raise exception 'ensure_scheduled_event_for_template cambió: revisar esta migración antes de aplicarla';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.ticket_door_today(uuid)'::regprocedure)
     <> 'f0639814d353ac442d32f6c246a17f6f' then
    raise exception 'ticket_door_today cambió: revisar esta migración antes de aplicarla';
  end if;
end
$$;

-- ─── 1. Fechas de evento ────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select e.tenant_id into v_tenant
    from public.scheduled_events e
   group by e.tenant_id
   order by count(*) desc, e.tenant_id
   limit 1;
  select b.id into v_branch from public.branches b where b.tenant_id = v_tenant and b.is_default;

  if v_branch is null then
    alter table public.scheduled_events add column branch_id uuid;
  else
    execute format('alter table public.scheduled_events add column branch_id uuid default %L', v_branch);
    update public.scheduled_events e
       set branch_id = b.id
      from public.branches b
     where b.tenant_id = e.tenant_id
       and b.is_default
       and e.tenant_id <> v_tenant;
    alter table public.scheduled_events alter column branch_id drop default;
  end if;
end
$$;

alter table public.scheduled_events alter column branch_id set not null;
alter table public.scheduled_events
  add constraint scheduled_events_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
-- Para atar cada reserva a la sucursal de su evento.
alter table public.scheduled_events
  add constraint scheduled_events_id_branch_unique unique (id, branch_id);
-- «Un formato por noche» pasa a ser por sucursal: la misma película puede ir la misma noche en las dos.
-- (El orden de columnas termina en template_id, event_date: lib/salon/humanize.ts reconoce el error por eso.)
alter table public.scheduled_events drop constraint scheduled_events_tenant_id_template_id_event_date_key;
alter table public.scheduled_events
  add constraint scheduled_events_tenant_branch_template_date_key
    unique (tenant_id, branch_id, template_id, event_date);
create index scheduled_events_branch_date_idx on public.scheduled_events (tenant_id, branch_id, event_date);

create trigger scheduled_events_default_branch
  before insert on public.scheduled_events
  for each row execute function private.pos_tg_default_branch();

comment on column public.scheduled_events.branch_id is
  'En qué sucursal es esta fecha. Los formatos (scheduled_event_templates) y las películas son de todo el bar.';

-- ─── 2. Reservas ────────────────────────────────────────────────────────────────────────────────────────

alter table public.salon_reservations rename column branch_id to branch_id_old;

do $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select r.tenant_id into v_tenant
    from public.salon_reservations r
   group by r.tenant_id
   order by count(*) desc, r.tenant_id
   limit 1;
  select b.id into v_branch from public.branches b where b.tenant_id = v_tenant and b.is_default;

  if v_branch is null then
    alter table public.salon_reservations add column branch_id uuid;
  else
    execute format('alter table public.salon_reservations add column branch_id uuid default %L', v_branch);
  end if;

  -- Las de otros bares, y las que ya decían su sucursal: cada una a la suya. Las de HUB (todas vacías) no se tocan.
  update public.salon_reservations r
     set branch_id = coalesce(r.branch_id_old, b.id)
    from public.branches b
   where b.tenant_id = r.tenant_id
     and b.is_default
     and coalesce(r.branch_id_old, b.id) is distinct from r.branch_id;

  alter table public.salon_reservations alter column branch_id drop default;
end
$$;

-- La vieja se va con su clave y su índice parcial.
alter table public.salon_reservations drop column branch_id_old;
alter table public.salon_reservations alter column branch_id set not null;
alter table public.salon_reservations
  add constraint salon_reservations_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
-- Una reserva de un evento es de la sucursal del evento; si el evento se muda de sucursal, sus reservas lo siguen.
alter table public.salon_reservations
  add constraint salon_reservations_event_branch_fk foreign key (scheduled_event_id, branch_id)
    references public.scheduled_events (id, branch_id)
    on update cascade
    on delete set null (scheduled_event_id);
create index salon_reservations_branch_date_idx
  on public.salon_reservations (tenant_id, branch_id, reservation_date);

-- En una sucursal sin plantas (el Cerro) la reserva no lleva planta.
alter table public.salon_reservations alter column zone drop not null;

-- La sucursal de una reserva nueva: la de su evento; si no tiene evento, la que mande quien la carga; si no manda
-- ninguna, la principal. Si se le cambia el evento sin tocar la sucursal, sigue al evento nuevo.
create or replace function private.tg_reservation_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_branch uuid;
begin
  if new.scheduled_event_id is not null
     and (tg_op = 'INSERT' or new.scheduled_event_id is distinct from old.scheduled_event_id) then
    select e.branch_id into v_event_branch
      from public.scheduled_events e
     where e.id = new.scheduled_event_id;
    if v_event_branch is not null
       and (new.branch_id is null or tg_op = 'INSERT' or new.branch_id is not distinct from old.branch_id) then
      new.branch_id := v_event_branch;
    end if;
  end if;
  if new.branch_id is null then
    select b.id into new.branch_id
      from public.branches b
     where b.tenant_id = new.tenant_id
       and b.is_default;
  end if;
  return new;
end;
$$;

create trigger salon_reservations_branch
  before insert or update of scheduled_event_id on public.salon_reservations
  for each row execute function private.tg_reservation_branch();

comment on column public.salon_reservations.branch_id is
  'En qué sucursal es la reserva. Con evento, la del evento (lo garantiza salon_reservations_event_branch_fk).';
comment on column public.salon_reservations.zone is
  'Planta (Alta Córdoba: planta alta / baja, o el cupo flotante de un evento). Vacía en una sucursal sin plantas.';

-- ─── 3. Compras de entradas ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select o.tenant_id into v_tenant
    from public.ticket_orders o
   group by o.tenant_id
   order by count(*) desc, o.tenant_id
   limit 1;
  select b.id into v_branch from public.branches b where b.tenant_id = v_tenant and b.is_default;

  if v_branch is null then
    alter table public.ticket_orders add column branch_id uuid;
  else
    execute format('alter table public.ticket_orders add column branch_id uuid default %L', v_branch);
    update public.ticket_orders o
       set branch_id = b.id
      from public.branches b
     where b.tenant_id = o.tenant_id
       and b.is_default
       and o.tenant_id <> v_tenant;
    alter table public.ticket_orders alter column branch_id drop default;
  end if;
end
$$;

alter table public.ticket_orders alter column branch_id set not null;
alter table public.ticket_orders
  add constraint ticket_orders_branch_fk foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict;
create index ticket_orders_branch_idx on public.ticket_orders (tenant_id, branch_id, event_date);

-- Una compra es de la sucursal de su función. La compra pública nunca manda la sucursal: la toma la base.
create or replace function private.tg_ticket_order_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scheduled_event_id is not null then
    select e.branch_id into new.branch_id
      from public.scheduled_events e
     where e.id = new.scheduled_event_id;
  end if;
  if new.branch_id is null then
    select b.id into new.branch_id
      from public.branches b
     where b.tenant_id = new.tenant_id
       and b.is_default;
  end if;
  return new;
end;
$$;

create trigger ticket_orders_branch
  before insert on public.ticket_orders
  for each row execute function private.tg_ticket_order_branch();

comment on column public.ticket_orders.branch_id is
  'La sucursal de la función, copiada al comprar: si después se borra la fecha, la venta sigue sabiendo dónde fue.';

-- ─── 4. Cupos ───────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_table text;
  v_tenant uuid;
  v_branch uuid;
begin
  foreach v_table in array array['salon_segment_capacities', 'salon_segment_settings', 'salon_segment_capacity_overrides']
  loop
    execute format(
      'select tenant_id from public.%I group by tenant_id order by count(*) desc, tenant_id limit 1', v_table
    ) into v_tenant;
    select b.id into v_branch from public.branches b where b.tenant_id = v_tenant and b.is_default;

    if v_branch is null then
      execute format('alter table public.%I add column branch_id uuid', v_table);
    else
      execute format('alter table public.%I add column branch_id uuid default %L', v_table, v_branch);
      execute format(
        'update public.%I x set branch_id = b.id from public.branches b
          where b.tenant_id = x.tenant_id and b.is_default and x.tenant_id <> %L',
        v_table, v_tenant
      );
      execute format('alter table public.%I alter column branch_id drop default', v_table);
    end if;

    execute format('alter table public.%I alter column branch_id set not null', v_table);
    execute format(
      'alter table public.%I add constraint %I foreign key (branch_id, tenant_id)
         references public.branches (id, tenant_id) on delete cascade',
      v_table, v_table || '_branch_fk'
    );
    execute format(
      'create trigger %I before insert on public.%I for each row execute function private.pos_tg_default_branch()',
      v_table || '_default_branch', v_table
    );
  end loop;
end
$$;

-- Las reglas nuevas, por sucursal. Las viejas (por bar) quedan hasta la tanda 6.
alter table public.salon_segment_capacities
  add constraint ssc_one_per_day_branch unique (tenant_id, branch_id, segment, iso_dow);
alter table public.salon_segment_settings
  add constraint sss_one_per_segment_branch unique (tenant_id, branch_id, segment);
alter table public.salon_segment_capacity_overrides
  add constraint ssco_one_per_day_branch unique (tenant_id, branch_id, override_date, segment);

-- El cupo general de la principal: las dos plantas de hoy (tenants.settings.salon_capacities).
update public.branches b
   set seat_capacity = (
         coalesce((t.settings -> 'salon_capacities' ->> 'planta_alta')::int, 0)
       + coalesce((t.settings -> 'salon_capacities' ->> 'planta_baja')::int, 0)
       )
  from public.tenants t
 where t.id = b.tenant_id
   and b.is_default
   and b.seat_capacity is null
   and coalesce((t.settings -> 'salon_capacities' ->> 'planta_alta')::int, 0)
     + coalesce((t.settings -> 'salon_capacities' ->> 'planta_baja')::int, 0) > 0;

-- ─── 5. Funciones que ahora reciben la sucursal ─────────────────────────────────────────────────────────

-- La fecha ad hoc de una reserva especial: se busca y se crea en la sucursal de la reserva.
drop function public.ensure_scheduled_event_for_template(uuid, date, time without time zone, integer);

create function public.ensure_scheduled_event_for_template(
  p_template_id uuid,
  p_event_date date,
  p_starts_at_local time without time zone default '21:00:00'::time without time zone,
  p_capacity integer default null::integer,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_template public.scheduled_event_templates;
  v_role public.tenant_role;
  v_branch uuid;
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

  v_branch := private.branch_for_write(v_template.tenant_id, p_branch_id);

  select id into v_existing_id from public.scheduled_events
   where tenant_id = v_template.tenant_id
     and branch_id = v_branch
     and template_id = p_template_id
     and event_date = p_event_date;

  if v_existing_id is not null then return v_existing_id; end if;

  v_capacity := coalesce(p_capacity, v_template.default_capacity, 30);
  insert into public.scheduled_events (
    tenant_id, branch_id, template_id, event_date, starts_at_local,
    capacity, meal_type, full_bonus_active, notes, private_group
  ) values (
    v_template.tenant_id, v_branch, p_template_id, p_event_date, p_starts_at_local,
    v_capacity, v_template.default_meal_type, false,
    'Ad-hoc creado por reserva especial', true
  ) returning id into v_new_id;

  return v_new_id;
end; $$;

-- La puerta: las funciones de hoy de la sucursal de este equipo (sin sucursal: las que esta persona ve).
drop function public.ticket_door_today(uuid);

create function public.ticket_door_today(p_tenant_id uuid, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date;
  v_rows jsonb;
  v_branches uuid[];
begin
  perform private.ticket_door_authorize(p_tenant_id);
  v_day := private.ticket_door_service_day(p_tenant_id);
  v_branches := private.branch_scope(p_tenant_id, p_branch_id);

  select coalesce(jsonb_agg(row_to_json(f) order by f.time), '[]'::jsonb)
    into v_rows
    from (
      select
        ev.id as event_id,
        e.title,
        to_char(ev.starts_at_local, 'HH24:MI') as time,
        ev.branch_id,
        coalesce((
          select sum(coalesce(r.actual_guests, r.estimated_guests))
            from public.salon_reservations r
           where r.tenant_id = p_tenant_id
             and r.scheduled_event_id = ev.id
             and r.status in ('arrived', 'seated', 'closed')
        ), 0)::int as inside,
        coalesce((
          select sum(greatest(coalesce(r.actual_guests, 0), r.estimated_guests))
            from public.salon_reservations r
           where r.tenant_id = p_tenant_id
             and r.scheduled_event_id = ev.id
             and r.status not in ('cancelled', 'no_show')
        ), 0)::int as expected
      from public.scheduled_events ev
      join public.event_experiences e
        on e.template_id = ev.template_id
       and e.tenant_id = ev.tenant_id
     where ev.tenant_id = p_tenant_id
       and ev.event_date = v_day
       and ev.branch_id = any (v_branches)
    ) f;

  return v_rows;
end;
$$;

-- ─── 6. Permisos ───────────────────────────────────────────────────────────────────────────────────────

revoke all on function private.tg_reservation_branch() from public, anon, authenticated;
revoke all on function private.tg_ticket_order_branch() from public, anon, authenticated;

revoke all on function public.ensure_scheduled_event_for_template(uuid, date, time without time zone, integer, uuid)
  from public, anon;
grant execute on function public.ensure_scheduled_event_for_template(uuid, date, time without time zone, integer, uuid)
  to authenticated, service_role;

revoke all on function public.ticket_door_today(uuid, uuid) from public, anon;
grant execute on function public.ticket_door_today(uuid, uuid) to authenticated, service_role;

-- La tabla de asignaciones de la tanda 1 solo se escribe por set_membership_branches.
revoke insert, update, delete on public.membership_branches from authenticated;

notify pgrst, 'reload schema';
