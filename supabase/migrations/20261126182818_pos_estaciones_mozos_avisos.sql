-- ============================================================
-- Punto de venta · estaciones, quién atiende cada mesa y avisos al mozo (26/11/2026)
-- ============================================================
-- Pedido de Nacho: «lo que es comida a cocina, lo que es bebida a la barra, lo que es pizza a la pantalla
-- de pizzeros»; «en las mesas, los emojis arriba de la mesa si hay comida y bebida»; «que a cada mozo se
-- le filtren sus comandas y le llegue una notificación push cuando su pedido pasa al próximo paso»; «las
-- ya atendidas por otro mozo le tienen que aparecer bloqueadas»; y el encargado de cocina, que desde su
-- pantalla «debe ser capaz de mover todo».
--
-- Qué trae:
--   1. Estaciones: de qué son (comida o bebida) y con qué dibujo se las reconoce en el mapa.
--   2. Quién atiende cada mesa (`table_sessions.waiter_id`): el mozo que la abre, o quien le carga el
--      primer pedido. Se puede pasar a otro (`pos_assign_waiter`).
--   3. Las lecturas del salón, la mesa y la cocina SUMAN datos: quién atiende, y qué espera cada mesa de
--      cada estación (para los dibujos de comida y bebida sobre la mesa).
--   4. El pase (`pos_kitchen_move`): avanzar, volver atrás o cambiar de estación una comanda entera o un
--      renglón, en un solo viaje.
--   5. Avisos al mozo (`pos_notices`): cuando una estación empieza o termina lo suyo, se le avisa a quien
--      atiende esa mesa, en la app abierta (canal en vivo) y por notificación push
--      (`push_subscriptions`, y la llamada a la app que las manda).
--
-- Todo es aditivo: columnas nuevas (sin reescribir filas), tablas nuevas, funciones nuevas y tres
-- disparadores. Las tres lecturas que cambian (`pos_floor_snapshot`, `pos_kitchen_queue`,
-- `pos_session_detail`) se parchan sobre su definición vigente: se les SUMAN claves al JSON que
-- devuelven, así una app que todavía no las conoce sigue andando igual. No se toca ninguna función que
-- mueva plata. Las tablas nuevas no son «tablas puente» (su clave es un id propio) y no agregan una
-- segunda relación entre dos tablas de `public`.

set local lock_timeout = '5s';

-- Reemplaza un fragmento de una función, que tiene que aparecer exactamente una vez.
create function pg_temp.pos_est_patch(p_fn regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_hits integer := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
begin
  if v_hits <> 1 then
    raise exception 'pos_est_patch: el fragmento aparece % veces en % (tenía que ser una)', v_hits, p_fn;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estaciones: de qué son y con qué dibujo se las reconoce
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.kitchen_stations
  add column kind text not null default 'food',
  add column icon text,
  add constraint kitchen_stations_kind_check check (kind in ('food', 'drink')),
  add constraint kitchen_stations_icon_check check (icon is null or char_length(icon) between 1 and 16);

comment on column public.kitchen_stations.kind is
  'De qué es la estación: food (comida) o drink (bebida). Decide el dibujo sobre la mesa en el mapa, cómo se nombra en los avisos al mozo («bebidas listas») y si la comanda muestra los vasos de la mesa.';
comment on column public.kitchen_stations.icon is
  'El dibujo (un emoji) con el que se la reconoce en el mapa y en las pantallas. Vacío = el del tipo.';

-- Las que ya existen: una barra es de bebidas. Lo demás queda como comida (se cambia desde la carta).
update public.kitchen_stations
   set kind = 'drink'
 where kind = 'food'
   and name ~* '(barra|bebida|trago|cafeter)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quién atiende cada mesa
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.table_sessions
  add column waiter_id uuid references auth.users(id) on delete set null;
create index table_sessions_waiter_idx on public.table_sessions (waiter_id) where waiter_id is not null;

comment on column public.table_sessions.waiter_id is
  'Quién atiende la mesa: el mozo que la abrió o quien le cargó el primer pedido. A esa persona le llegan los avisos de cocina, y a los demás mozos la mesa se les muestra tomada. Vacío = todavía nadie.';

-- Las mesas que ya están abiertas: si la abrió un mozo, es de ese mozo.
update public.table_sessions s
   set waiter_id = s.opened_by
 where s.status = 'open'
   and s.waiter_id is null
   and s.opened_by is not null
   and exists (
     select 1 from public.memberships m
      where m.tenant_id = s.tenant_id and m.user_id = s.opened_by and m.role = 'waiter'
   );

-- Quien abre una mesa siendo mozo, la atiende. La anfitriona o la caja sientan gente: no la toman.
create function private.pos_tg_session_waiter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.waiter_id is null and new.opened_by is not null and exists (
    select 1 from public.memberships m
     where m.tenant_id = new.tenant_id and m.user_id = new.opened_by and m.role = 'waiter'
  ) then
    new.waiter_id := new.opened_by;
  end if;
  return new;
end;
$$;
revoke all on function private.pos_tg_session_waiter() from public, anon, authenticated;

create trigger table_sessions_waiter
  before insert on public.table_sessions
  for each row execute function private.pos_tg_session_waiter();

-- Una mesa que todavía no atiende nadie la toma quien le carga un pedido.
create function private.pos_tg_ticket_takes_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by_user_id is not null then
    update public.table_sessions s
       set waiter_id = new.created_by_user_id
     where s.id = new.session_id
       and s.waiter_id is null
       and s.status = 'open'
       and exists (
         select 1 from public.memberships m
          where m.tenant_id = s.tenant_id and m.user_id = new.created_by_user_id
            and m.role in ('waiter', 'cashier', 'owner')
       );
  end if;
  return null;
end;
$$;
revoke all on function private.pos_tg_ticket_takes_table() from public, anon, authenticated;

create trigger tickets_take_table
  after insert on public.tickets
  for each row execute function private.pos_tg_ticket_takes_table();

-- Cambiar quién atiende una mesa. El encargado (dueño, caja, anfitriona) la pasa a quien haga falta o la
-- deja sin nadie. Un mozo toma una que no tiene a nadie, o le pasa la SUYA a un compañero: la de otro no
-- la toca.
create function public.pos_assign_waiter(p_session_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.table_sessions%rowtype;
  v_role public.tenant_role;
  v_me uuid := (select auth.uid());
  v_target public.tenant_role;
  v_changed boolean;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_role := private.pos_require_role(v_session.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_session.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;

  if p_user_id is not null then
    select m.role into v_target
      from public.memberships m
     where m.tenant_id = v_session.tenant_id and m.user_id = p_user_id;
    if v_target is null or v_target not in ('owner', 'cashier', 'waiter') then
      raise exception 'waiter_not_found' using errcode = 'P0002';
    end if;
  end if;

  if v_role = 'waiter' then
    if v_session.waiter_id is not null and v_session.waiter_id <> v_me then
      raise exception 'not_your_table' using errcode = '42501';
    end if;
    if p_user_id is null or (v_session.waiter_id is null and p_user_id <> v_me) then
      raise exception 'not_your_table' using errcode = '42501';
    end if;
  end if;

  v_changed := v_session.waiter_id is distinct from p_user_id;
  if v_changed then
    update public.table_sessions set waiter_id = p_user_id where id = p_session_id;
    perform private.pos_poke(v_session.branch_id, 'floor', p_session_id);
  end if;
  return jsonb_build_object(
    'session_id', p_session_id,
    'waiter_id', p_user_id,
    'waiter', case when p_user_id is not null then private.pos_actor_name(v_session.tenant_id, p_user_id) end,
    'previous_id', v_session.waiter_id,
    'changed', v_changed
  );
end;
$$;

-- A quién se le puede pasar una mesa: quienes atienden en esa sucursal. Nombres y rol, nada más.
create function public.pos_floor_team(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches%rowtype;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_branch.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'name', x.name, 'role', x.role)
                              order by x.rank, x.name, x.user_id), '[]'::jsonb)
      from (
        select m.user_id, m.role,
               private.pos_actor_name(m.tenant_id, m.user_id) as name,
               case m.role when 'waiter' then 0 when 'cashier' then 1 else 2 end as rank
          from public.memberships m
         where m.tenant_id = v_branch.tenant_id
           and m.role in ('waiter', 'cashier', 'owner')
           and exists (
             select 1 from private.visible_branches(m.tenant_id, m.user_id) vb where vb.id = v_branch.id
           )
      ) x
  );
end;
$$;

revoke all on function public.pos_assign_waiter(uuid, uuid) from public, anon;
revoke all on function public.pos_floor_team(uuid) from public, anon;
grant execute on function public.pos_assign_waiter(uuid, uuid) to authenticated;
grant execute on function public.pos_floor_team(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Las lecturas suman datos
-- ─────────────────────────────────────────────────────────────────────────────
-- El salón: quién atiende cada mesa y qué espera de cada estación (unidades en cola, en preparación y
-- listas para retirar), las estaciones del bar y quién está mirando.
select pg_temp.pos_est_patch(
  'public.pos_floor_snapshot(uuid)'::regprocedure,
  $old$'total_cents', s.total_cents, 'is_practice', s.is_practice, 'kind', s.kind,$old$,
  $new$'total_cents', s.total_cents, 'is_practice', s.is_practice, 'kind', s.kind,
        'waiter_id', s.waiter_id,
        'waiter', case when s.waiter_id is not null then private.pos_actor_name(s.tenant_id, s.waiter_id) end,
        'prep', st.prep,$new$
);
select pg_temp.pos_est_patch(
  'public.pos_floor_snapshot(uuid)'::regprocedure,
  $old$) k on true$old$,
  $new$) k on true
      left join lateral (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'station_id', g.station_id, 'queued', g.queued, 'preparing', g.preparing, 'ready', g.ready
               ) order by g.station_id), '[]'::jsonb) as prep
          from (
            select ti.station_id,
                   coalesce(sum(ti.quantity) filter (where ti.prep_status = 'queued'), 0) as queued,
                   coalesce(sum(ti.quantity) filter (where ti.prep_status = 'preparing'), 0) as preparing,
                   coalesce(sum(ti.quantity) filter (where ti.prep_status = 'ready'), 0) as ready
              from public.tickets t
              join public.ticket_items ti on ti.ticket_id = t.id and ti.cancelled_at is null
             where t.session_id = s.id and t.status <> 'cancelled' and t.fired_at is not null
               and ti.prep_status <> 'served'
             group by ti.station_id
          ) g
      ) st on true$new$
);
select pg_temp.pos_est_patch(
  'public.pos_floor_snapshot(uuid)'::regprocedure,
  $old$'areas', ($old$,
  $new$'me', (select auth.uid()),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ks.id, 'name', ks.name, 'color', ks.color, 'kind', ks.kind, 'icon', ks.icon
      ) order by ks.position, ks.name), '[]'::jsonb)
      from public.kitchen_stations ks where ks.tenant_id = v_branch.tenant_id and ks.active
    ),
    'areas', ($new$
);

-- La cocina: quién atiende cada mesa (a quién llamar cuando sale) y el tipo y el dibujo de cada estación.
select pg_temp.pos_est_patch(
  'public.pos_kitchen_queue(uuid)'::regprocedure,
  $old$'alias', s.alias, 'party_size', s.party_size,$old$,
  $new$'alias', s.alias, 'party_size', s.party_size,
        'waiter_id', coalesce(s.waiter_id, t.created_by_user_id),
        'waiter', case when coalesce(s.waiter_id, t.created_by_user_id) is not null
                       then private.pos_actor_name(s.tenant_id, coalesce(s.waiter_id, t.created_by_user_id)) end,$new$
);
select pg_temp.pos_est_patch(
  'public.pos_kitchen_queue(uuid)'::regprocedure,
  $old$jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color)$old$,
  $new$jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'kind', s.kind, 'icon', s.icon)$new$
);

-- La mesa: quién la atiende.
select pg_temp.pos_est_patch(
  'public.pos_session_detail(uuid)'::regprocedure,
  $old$'is_practice', v_session.is_practice, 'kind', v_session.kind, 'paid_at', v_session.paid_at$old$,
  $new$'is_practice', v_session.is_practice, 'kind', v_session.kind, 'paid_at', v_session.paid_at,
      'waiter_id', v_session.waiter_id,
      'waiter', case when v_session.waiter_id is not null
                     then private.pos_actor_name(v_session.tenant_id, v_session.waiter_id) end$new$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El pase: avanzar, volver y cambiar de estación
-- ─────────────────────────────────────────────────────────────────────────────
-- Un solo viaje para lo que hace una pantalla de cocina:
--   · `p_ticket_ids`: las tandas de una comanda (la mesa entera). Con `p_from_station_ids` solo se mueve
--     lo de esas estaciones (lo que no tiene estación va con todas), igual que `pos_kitchen_advance`.
--   · `p_item_ids`: renglones sueltos. Si vienen, mandan ellos (las tandas son solo las suyas).
--   · `p_to`: el paso al que van (queued, preparing, ready).
--   · `p_station_id`: la estación a la que pasan. Lo que cambia de estación llega como nuevo, salvo que
--     además se diga un paso.
-- Lo servido y lo dado de baja no se toca nunca.
create function public.pos_kitchen_move(
  p_ticket_ids uuid[] default null,
  p_item_ids uuid[] default null,
  p_to text default null,
  p_from_station_ids uuid[] default null,
  p_station_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by_items boolean := coalesce(cardinality(p_item_ids), 0) > 0;
  v_tickets uuid[];
  v_tenant uuid;
  v_tenants integer;
  v_moved integer := 0;
  v_ticket uuid;
  v_poke record;
begin
  if not v_by_items and coalesce(cardinality(p_ticket_ids), 0) = 0 then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_ticket_ids), 0) > 200 or coalesce(cardinality(p_item_ids), 0) > 400 then
    raise exception 'too_many_tickets' using errcode = '22023';
  end if;
  if p_to is null and p_station_id is null then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_to is not null and p_to not in ('queued', 'preparing', 'ready') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if v_by_items then
    select array_agg(distinct t.id order by t.id), count(distinct t.tenant_id), min(t.tenant_id::text)::uuid
      into v_tickets, v_tenants, v_tenant
      from public.ticket_items ti
      join public.tickets t on t.id = ti.ticket_id
     where ti.id = any (p_item_ids);
  else
    select array_agg(distinct t.id order by t.id), count(distinct t.tenant_id), min(t.tenant_id::text)::uuid
      into v_tickets, v_tenants, v_tenant
      from public.tickets t
     where t.id = any (p_ticket_ids);
  end if;
  if v_tickets is null then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  if v_tenants <> 1 then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.pos_require_role(v_tenant, 'owner', 'kitchen', 'cashier', 'waiter');

  if p_station_id is not null and not exists (
    select 1 from public.kitchen_stations ks
     where ks.id = p_station_id and ks.tenant_id = v_tenant and ks.active
  ) then
    raise exception 'station_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.tickets t where t.id = any (v_tickets) order by t.id for update;

  update public.ticket_items ti
     set prep_status = n.status,
         started_at = case
           when n.status = ti.prep_status then ti.started_at
           when n.status = 'queued' then null
           else coalesce(ti.started_at, now())
         end,
         ready_at = case
           when n.status = ti.prep_status then ti.ready_at
           when n.status = 'ready' then coalesce(ti.ready_at, now())
           else null
         end,
         station_id = n.station
    from (
      select i.id,
             coalesce(p_station_id, i.station_id) as station,
             case
               when p_to is not null then p_to
               when p_station_id is not null and i.station_id is distinct from p_station_id then 'queued'
               else i.prep_status
             end as status
        from public.ticket_items i
        join public.tickets t on t.id = i.ticket_id
       where t.id = any (v_tickets)
         and t.status <> 'cancelled'
         and t.fired_at is not null
         and i.cancelled_at is null
         and i.prep_status <> 'served'
         and (not v_by_items or i.id = any (p_item_ids))
         and (
           p_from_station_ids is null or cardinality(p_from_station_ids) = 0
           or i.station_id is null or i.station_id = any (p_from_station_ids)
         )
    ) n
   where ti.id = n.id
     and (n.status <> ti.prep_status or n.station is distinct from ti.station_id);
  get diagnostics v_moved = row_count;

  foreach v_ticket in array v_tickets loop
    perform private.pos_sync_ticket(v_ticket);
  end loop;

  for v_poke in
    select distinct s.branch_id, s.id as session_id
      from public.tickets t
      join public.table_sessions s on s.id = t.session_id
     where t.id = any (v_tickets)
  loop
    perform private.pos_poke(v_poke.branch_id, 'kitchen', v_poke.session_id);
  end loop;

  return jsonb_build_object('moved', v_moved, 'tickets', cardinality(v_tickets));
end;
$$;

revoke all on function public.pos_kitchen_move(uuid[], uuid[], text, uuid[], uuid) from public, anon;
grant execute on function public.pos_kitchen_move(uuid[], uuid[], text, uuid[], uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Avisos al mozo
-- ─────────────────────────────────────────────────────────────────────────────
-- Un aviso = una estación empezó, terminó (o se arrepintió de haber terminado) lo de una mesa. Va a
-- quien atiende esa mesa. Es la bandeja de la que salen el aviso dentro de la app y la notificación push.
create table public.pos_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('preparing', 'ready', 'not_ready')),
  station_id uuid,
  station_name text,
  station_kind text,
  station_icon text,
  table_label text,
  alias text,
  items jsonb not null default '[]'::jsonb,
  units integer not null default 0,
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  push_result text
);
create index pos_notices_user_idx on public.pos_notices (user_id, created_at desc);
create index pos_notices_unpushed_idx on public.pos_notices (created_at) where pushed_at is null;
create index pos_notices_tenant_idx on public.pos_notices (tenant_id);
create index pos_notices_session_idx on public.pos_notices (session_id);
create index pos_notices_branch_idx on public.pos_notices (branch_id);

comment on table public.pos_notices is
  'Avisos de cocina al mozo: una estación empezó (preparing), terminó (ready) o volvió atrás (not_ready) lo de una mesa. Los escribe un disparador; cada persona lee solo los suyos.';

-- Los dispositivos donde alguien pidió recibir notificaciones push (un renglón por navegador).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth_key text not null check (char_length(auth_key) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  events text[] not null default array['ready', 'preparing']::text[]
    check (events <@ array['ready', 'preparing']::text[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_tenant_idx on public.push_subscriptions (tenant_id);

comment on table public.push_subscriptions is
  'Dónde mandar las notificaciones push de cada persona: un renglón por navegador (endpoint). Un teléfono que cambia de manos pasa a ser de quien lo activa.';

alter table public.pos_notices enable row level security;
alter table public.push_subscriptions enable row level security;

create policy pos_notices_own on public.pos_notices for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['pos_notices', 'push_subscriptions']
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))
         with check (tenant_id <> all (array(select public.acc_accountant_tenant_ids())))',
      t || '_no_accountant', t);
  end loop;
end $$;

-- Nadie escribe directo: los avisos los escribe el disparador y las suscripciones entran por su función.
revoke all on public.pos_notices, public.push_subscriptions from anon, authenticated;
grant select on public.pos_notices, public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.pos_notices, public.push_subscriptions to service_role;

-- Cuando una estación mueve lo de una mesa: un aviso por mesa y estación para quien la atiende.
-- Se avisa en vivo por el canal de la sucursal (la app abierta) y se llama a la app para que mande la
-- notificación push, solo si esa persona tiene algún dispositivo anotado. Nada de esto puede frenar a
-- la cocina: si algo falla, el cambio de estado queda igual.
create function private.pos_tg_items_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice record;
  v_ids uuid[] := '{}'::uuid[];
  v_users uuid[] := '{}'::uuid[];
  v_me uuid := (select auth.uid());
begin
  for v_notice in
    with moved as (
      select n.ticket_id, n.station_id, n.menu_item_id, n.quantity,
             case
               when n.prep_status = 'ready' and o.prep_status in ('queued', 'preparing') then 'ready'
               when n.prep_status = 'preparing' and o.prep_status = 'queued' then 'preparing'
               when o.prep_status = 'ready' and n.prep_status in ('queued', 'preparing') then 'not_ready'
             end as kind
        from new_items n
        join old_items o on o.id = n.id
       where n.prep_status is distinct from o.prep_status
         and n.cancelled_at is null
    ),
    lines as (
      select s.id as session_id, m.station_id, m.kind,
             coalesce(s.waiter_id, t.created_by_user_id) as user_id,
             m.menu_item_id, sum(m.quantity)::integer as quantity
        from moved m
        join public.tickets t on t.id = m.ticket_id
        join public.table_sessions s on s.id = t.session_id
       where m.kind is not null
         and s.status = 'open'
       group by s.id, m.station_id, m.kind, coalesce(s.waiter_id, t.created_by_user_id), m.menu_item_id
    ),
    grouped as (
      select l.session_id, l.station_id, l.kind, l.user_id,
             jsonb_agg(jsonb_build_object('n', mi.name, 'q', l.quantity) order by l.quantity desc, mi.name) as items,
             sum(l.quantity)::integer as units
        from lines l
        join public.menu_items mi on mi.id = l.menu_item_id
       where l.user_id is not null
         and l.user_id is distinct from v_me
       group by l.session_id, l.station_id, l.kind, l.user_id
    )
    insert into public.pos_notices (
      tenant_id, branch_id, session_id, user_id, kind, station_id, station_name, station_kind,
      station_icon, table_label, alias, items, units
    )
    select s.tenant_id, s.branch_id, s.id, g.user_id, g.kind, g.station_id, ks.name, ks.kind,
           ks.icon, p.label, s.alias, g.items, g.units
      from grouped g
      join public.table_sessions s on s.id = g.session_id
      join public.tenants tn on tn.id = s.tenant_id and tn.feature_flags ->> 'pos' = 'true'
      left join public.kitchen_stations ks on ks.id = g.station_id
      left join public.physical_tables p on p.id = s.physical_table_id
    returning id, branch_id, session_id, user_id, kind, station_id, station_name, station_kind,
              station_icon, table_label, alias, items, units, created_at
  loop
    v_ids := v_ids || v_notice.id;
    v_users := v_users || v_notice.user_id;
    perform realtime.send(
      jsonb_build_object(
        'id', v_notice.id, 'user_id', v_notice.user_id, 'session_id', v_notice.session_id,
        'kind', v_notice.kind, 'station_id', v_notice.station_id, 'station_name', v_notice.station_name,
        'station_kind', v_notice.station_kind, 'station_icon', v_notice.station_icon,
        'table_label', v_notice.table_label, 'alias', v_notice.alias,
        'items', v_notice.items, 'units', v_notice.units, 'created_at', v_notice.created_at
      ),
      'notice',
      'pos:' || v_notice.branch_id::text,
      true
    );
  end loop;

  if cardinality(v_ids) > 0 and exists (
    select 1 from public.push_subscriptions ps where ps.user_id = any (v_users)
  ) then
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url')
             || '/api/cron/pos-push',
      body := jsonb_build_object('ids', to_jsonb(v_ids)),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 10000
    );
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.pos_tg_items_progress() from public, anon, authenticated;

create trigger ticket_items_progress
  after update on public.ticket_items
  referencing old table as old_items new table as new_items
  for each statement execute function private.pos_tg_items_progress();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Notificaciones push: las suscripciones y las claves
-- ─────────────────────────────────────────────────────────────────────────────
-- Anotar este navegador para quien está entrando. Si el teléfono era de otra persona (pasa de mano en
-- mano), pasa a ser de quien lo activa ahora: los avisos del anterior dejan de llegarle a este equipo.
create function public.push_subscribe(
  p_tenant_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_events text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_events text[] := coalesce(p_events, array['ready', 'preparing']::text[]);
  v_id uuid;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if public.user_role_in_tenant(p_tenant_id) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000
     or p_p256dh is null or p_auth is null
     or not (v_events <@ array['ready', 'preparing']::text[]) then
    raise exception 'invalid_subscription' using errcode = '22023';
  end if;

  insert into public.push_subscriptions as ps (tenant_id, user_id, endpoint, p256dh, auth_key, user_agent, events)
  values (p_tenant_id, v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), v_events)
  on conflict (endpoint) do update
     set tenant_id = excluded.tenant_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth_key = excluded.auth_key,
         user_agent = excluded.user_agent,
         events = case when p_events is null and ps.user_id = excluded.user_id then ps.events else excluded.events end,
         updated_at = now(),
         failures = 0
  returning ps.id into v_id;
  return v_id;
end;
$$;

-- Dejar de recibir en este navegador (al cerrar sesión, o al apagar los avisos).
create function public.push_unsubscribe(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer;
begin
  if v_me is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions ps
   where ps.endpoint = p_endpoint and ps.user_id = v_me;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- La clave pública con la que el navegador se anota (no es un secreto). Vacío = todavía no se generó.
-- (Solo en este archivo espejo: la función es `language sql` y Postgres la revisa al crearla, así que
-- en una base recién hecha —la de CI— hay que asegurarse de que Vault exista, y si no, crearla sin esa
-- revisión. En producción Vault ya estaba y estas líneas no cambian nada.)
do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    create extension if not exists supabase_vault;
  end if;
exception when others then
  raise notice 'supabase_vault: %', sqlerrm;
end $$;
set check_function_bodies = off;
create function public.push_public_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'vapid_public_key' limit 1;
$$;
reset check_function_bodies;

-- El par de claves para firmar los envíos. Solo lo lee la app con la clave de servicio.
create function public.push_vapid_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'public', (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'vapid_public_key' limit 1),
    'private', (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'vapid_private_key' limit 1)
  );
end;
$$;

-- Guardar el par de claves la primera vez (lo genera la app; la base no sabe hacer claves de curva
-- elíptica). Si ya había uno, queda el que estaba. Devuelve la clave pública vigente.
create function public.push_vapid_init(p_public text, p_private text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_public is null or p_private is null
     or char_length(p_public) not between 80 and 100 or char_length(p_private) not between 40 and 50 then
    raise exception 'invalid_keys' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('push_vapid_init'));
  if not exists (select 1 from vault.secrets s where s.name = 'vapid_private_key') then
    perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push: clave privada VAPID');
    perform vault.create_secret(p_public, 'vapid_public_key', 'Web Push: clave pública VAPID');
  end if;
  return (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'vapid_public_key' limit 1);
end;
$$;

revoke all on function public.push_subscribe(uuid, text, text, text, text, text[]) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.push_public_key() from public, anon;
revoke all on function public.push_vapid_keys() from public, anon, authenticated;
revoke all on function public.push_vapid_init(text, text) from public, anon, authenticated;
grant execute on function public.push_subscribe(uuid, text, text, text, text, text[]) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.push_public_key() to authenticated, service_role;
grant execute on function public.push_vapid_keys() to service_role;
grant execute on function public.push_vapid_init(text, text) to service_role;

notify pgrst, 'reload schema';
