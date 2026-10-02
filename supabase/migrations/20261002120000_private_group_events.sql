-- ============================================================
-- Grupos privados: fechas del calendario que NO son eventos
-- para «Cómo nos fue» (02/10/2026)
-- ============================================================
-- POR QUÉ: comentario de los socios, textual: «usamos los templates para ver
-- en el calendario cuando hay una "merienda libre" o "pizza libre", y el
-- reporte lo toma como un evento que se pautó. […] deberían salir del reporte
-- porque estamos viendo EVENTOS.»
--
-- 1. `scheduled_events.private_group`: el tilde es POR FECHA. Pizza libre es
--    mixto (hay noches abiertas con pauta y grupos que piden el formato), así
--    que no se puede decidir por formato. Una fecha privada SIGUE ocupando
--    cupo (calendario, cupo por servicio, comisiones, puntos por asistencia)
--    y sus cumples siguen contando en «Cumpleaños»: solo sale del reporte de
--    EVENTOS («Por evento» y «Pauta»). En «Por día» su gente va aparte.
-- 2. `scheduled_event_templates.default_private_group` («Se usa para grupos
--    privados»): es SOLO el default con el que nace una fecha nueva del
--    formato. Lo aplican el formulario y `upsertScheduledEvent` (cuando el
--    pedido no trae el tilde), no un trigger: así un «false» explícito del
--    formulario se respeta. Cambiarlo no toca las fechas que ya existen.
-- 3. `ensure_scheduled_event_for_template`: la fecha que crea una reserva
--    especial pidiendo un formato nace privada. Si el formato ya estaba
--    programado ese día, devuelve esa fecha tal cual: la reserva se suma al
--    evento, como siempre, y el tilde no se toca.
-- 4. Invariante «un grupo privado no lleva pauta ni la plata de la noche».
--    Sin esto, la pauta de una fecha marcada privada desaparecería del
--    «Invertido» del mes sin que nadie se entere. Se cuida desde los DOS lados
--    con dos triggers (los dos SECURITY DEFINER: anfitrión y cajero marcan
--    fechas desde el calendario y no VEN la pauta por RLS):
--      4a. marcar privada una fecha con plata  → 'private_group_has_money'
--      4b. cargar plata en una fecha privada   → 'event_is_private_group'
--    Lo que cubre que las dos cosas pasen AL MISMO TIEMPO es un lock, no los
--    dos chequeos: cada trigger lee la otra tabla, y en read committed no ve
--    lo que la otra transacción todavía no confirmó. 4b toma `for share` sobre
--    la fila de la fecha, que choca con el lock de fila del UPDATE que dispara
--    4a: el que llega segundo espera al primero y mira lo ya confirmado.
--    «Plata» = gasto > 0 o cualquier número de la noche (facturación, ingreso,
--    costo, bebida). Una «No tuvo pauta» pelada (gasto 0, sin plata) sí
--    convive con el tilde: es el estado de 4 fechas que el paso de datos marca.
--
-- Sin datos: QUÉ fechas del HUB pasan a privadas es un paso aparte, con el OK
-- del dueño (nada de slugs ni ids en una migración).
--
-- RLS y GRANT: sin cambios, a propósito. No hay tablas nuevas: las dos
-- columnas quedan cubiertas por los privilegios de TABLA que ya existen
-- (authenticated: select/insert/update/delete en las dos tablas) y por las
-- mismas políticas: `sev_staff_write` (owner, cashier, host) para la fecha;
-- `set_owner_write` + `set_host_update` para el formato. La pauta sigue
-- `sem_owner_all`.
--
-- ORDEN DE DEPLOY: primero esta migración, después el código (las queries
-- piden `private_group` y `default_private_group`: sin las columnas, «Cómo nos
-- fue» y el calendario tiran error).
-- ============================================================

-- ─── 1. La fecha ─────────────────────────────────────────────────────────────

alter table public.scheduled_events
  add column if not exists private_group boolean not null default false;

comment on column public.scheduled_events.private_group is
  'Grupo privado (02/10/2026): la fecha ocupa cupo en el calendario pero no es un evento para «Cómo nos fue» (no sale en Por evento ni en Pauta; en Por día va aparte). Nace en true si la crea una reserva especial (ensure_scheduled_event_for_template) o si el formato tiene default_private_group. No admite pauta ni la plata de la noche (triggers *_private_group_*).';

-- ─── 2. El formato ───────────────────────────────────────────────────────────

alter table public.scheduled_event_templates
  add column if not exists default_private_group boolean not null default false;

comment on column public.scheduled_event_templates.default_private_group is
  '«Se usa para grupos privados» (02/10/2026): las fechas NUEVAS de este formato nacen con private_group = true (lo aplican el formulario y upsertScheduledEvent cuando el pedido no trae el tilde). No cambia las fechas que ya existen.';

-- ─── 3. La fecha que crea una reserva especial nace privada ──────────────────
-- Idéntica a 20260901003129 salvo `private_group` en el insert.

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

  -- ¿Ya está programado ese día? Se devuelve tal cual: si es un evento
  -- abierto, la reserva especial se suma al evento (y su tilde no se toca).
  select id into v_existing_id from public.scheduled_events
   where tenant_id = v_template.tenant_id
     and template_id = p_template_id
     and event_date = p_event_date;

  if v_existing_id is not null then return v_existing_id; end if;

  -- Ad-hoc: lo pidió un grupo (cumple, recibida), no es un evento abierto.
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
end; $$;

-- Mismos permisos que 20260901003129 (create or replace no los toca; se
-- repiten para que la migración se lea sola), más el revoke a `anon`: el
-- default privileges del proyecto le da EXECUTE y `revoke … from public` no se
-- lo saca (gotcha de 20260701000400_lock_loyalty_functions). Nunca le sirvió:
-- sin sesión la función corta con 'unauthenticated'.
revoke all on function public.ensure_scheduled_event_for_template(uuid, date, time, int) from public;
revoke execute on function public.ensure_scheduled_event_for_template(uuid, date, time, int) from anon;
grant execute on function public.ensure_scheduled_event_for_template(uuid, date, time, int) to authenticated;

-- ─── 4. Invariante: grupo privado ⇒ sin pauta ni plata de la noche ──────────
-- La condición va escrita en los dos triggers y no en una función que reciba
-- la fila: una función de `public` que recibe `scheduled_event_marketing`
-- PostgREST la publica como columna calculada de la tabla.

-- 4a. Marcar privada una fecha que tiene plata. Solo en la TRANSICIÓN a
-- privada (re-guardar una fecha que ya era privada no vuelve a mirar).
-- SECURITY DEFINER: con el permiso de un anfitrión el EXISTS daría falso (no
-- ve la pauta) y dejaría pasar justo el caso a frenar.
-- El EXISTS sin lock alcanza porque Postgres toma el lock de la fila ANTES de
-- correr un trigger BEFORE UPDATE: si 4b ya tiene su `for share` sobre esta
-- fecha (un dueño cargando plata sin confirmar), este UPDATE lo espera, y el
-- EXISTS (foto nueva en cada sentencia, read committed) ve la plata confirmada.
create or replace function public.scheduled_events_private_group_no_money()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1
      from public.scheduled_event_marketing m
     where m.scheduled_event_id = new.id
       and m.tenant_id = new.tenant_id
       and (
         m.ad_spend_usd_cents > 0
         or m.revenue_ars_cents is not null
         or m.revenue_per_guest_ars_cents is not null
         or m.cost_per_guest_ars_cents is not null
         or m.drink_revenue_per_guest_ars_cents is not null
         or m.drink_cost_per_guest_ars_cents is not null
       )
  ) then
    raise exception 'private_group_has_money' using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public.scheduled_events_private_group_no_money() from public, anon, authenticated;

drop trigger if exists scheduled_events_private_group_no_money on public.scheduled_events;
create trigger scheduled_events_private_group_no_money
  before update of private_group on public.scheduled_events
  for each row
  when (new.private_group and not old.private_group)
  execute function public.scheduled_events_private_group_no_money();

-- 4b. Cargar plata en una fecha privada (el otro orden: un dueño con el
-- formulario abierto mientras alguien marca la fecha desde el calendario).
-- También SECURITY DEFINER, para no depender de qué fechas ve quien escribe.
--
-- Por qué `for share` y AFTER (la primera versión, un EXISTS en un trigger
-- BEFORE, tenía los dos problemas de abajo; se reprodujeron con dos sesiones
-- en un PG 17, y con esta versión los dos órdenes esperan y rebotan bien):
--   · El lock. Un anfitrión marca la fecha sin confirmar todavía y el dueño
--     carga US$ 150 en ese mismo instante: un EXISTS no ve el tilde sin
--     confirmar, nadie espera a nadie y quedaba una privada con pauta (la
--     pauta salía del «Invertido» del mes sin aviso). La FK no alcanza: toma
--     `for key share`, que no choca con ese UPDATE. `for share` sí: espera a
--     que el anfitrión confirme y después lee la fila ya marcada.
--   · `private_group` va en el `into`, NO en el WHERE: con el predicado ahí,
--     una fecha que en la foto de la sentencia todavía no es privada se
--     descarta antes de pedir el lock, y no se espera a nadie.
--   · AFTER: corre después de la RLS. Siendo BEFORE contestaba antes que ella,
--     y el dueño de OTRO bar que conociera los dos uuid podía saber si una
--     fecha ajena era privada ('event_is_private_group' contra el error de
--     RLS). Ahora recibe siempre el de RLS.
create or replace function public.scheduled_event_marketing_private_group_no_money()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_private boolean;
begin
  if (
    new.ad_spend_usd_cents > 0
    or new.revenue_ars_cents is not null
    or new.revenue_per_guest_ars_cents is not null
    or new.cost_per_guest_ars_cents is not null
    or new.drink_revenue_per_guest_ars_cents is not null
    or new.drink_cost_per_guest_ars_cents is not null
  ) then
    select e.private_group into v_private
      from public.scheduled_events e
     where e.id = new.scheduled_event_id
       and e.tenant_id = new.tenant_id
       for share;
    if v_private then
      raise exception 'event_is_private_group' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;

revoke all on function public.scheduled_event_marketing_private_group_no_money() from public, anon, authenticated;

drop trigger if exists scheduled_event_marketing_private_group_no_money on public.scheduled_event_marketing;
create trigger scheduled_event_marketing_private_group_no_money
  after insert or update on public.scheduled_event_marketing
  for each row
  execute function public.scheduled_event_marketing_private_group_no_money();

-- ─── 5. De paso: el comentario del dólar (BACKLOG del 30/09) ────────────────
-- Decía «Obligatorio si hay facturación», falso desde el 19/09 (se borró
-- `sem_revenue_needs_rate`). Esta es la próxima migración que toca la tabla.
comment on column public.scheduled_event_marketing.usd_ars_rate is
  'Pesos por dólar con el que se pagó la pauta. Hace falta para pasar la pauta a pesos (el resultado de la noche), pero no para guardar, tampoco con facturación (desde el 19/09/2026). Null con gasto 0 (sem_no_ads_no_meta_numbers).';

notify pgrst, 'reload schema';
