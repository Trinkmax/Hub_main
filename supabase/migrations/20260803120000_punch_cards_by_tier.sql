-- ============================================================
-- Punch cards segmentadas por categoría
-- ============================================================
-- PEDIDO DEL DUEÑO: "poder segmentar la punch card, por ejemplo armar una punch
--   card que sea únicamente para los categoría Gold".
--
-- Hoy `punch_card_templates` no tiene ninguna relación con `loyalty_tiers`: toda
-- tarjeta activa la ve y la puede sellar cualquier socio. No hay forma de armar
-- un beneficio exclusivo de un nivel, que es justo la palanca que hace que subir
-- de categoría valga la pena.
--
-- MODELO: set ARBITRARIO de niveles vía tabla N:N, igual que `partner_benefit_tiers`
-- (20260731194037). Arbitrario y no "de tal nivel para arriba" por la misma razón
-- que allá: el dueño puede querer saltear un nivel (una tarjeta para Select y
-- Black pero no para Gold) y con un umbral eso no se puede expresar.
-- Sin filas vinculadas = para todos. Así todas las tarjetas que ya existen siguen
-- funcionando igual sin migración de datos.
--
-- `show_when_locked`: decide qué ve el que NO llega al nivel. Es una decisión de
-- marketing y cambia por tarjeta, así que la elige el dueño en vez de quedar
-- cableada. `true` (default) = la ve bloqueada, con el nivel que necesita → es
-- aspiracional, empuja a subir. `false` = no la ve → exclusividad real.
--
-- DÓNDE SE APLICA: en `add_punch_stamp`, o sea en la DB. La billetera filtra para
-- no mostrarla, pero el que decide si se puede sellar es el server: el cajero
-- toca "+1" desde /acreditar y ahí no hay UI que valga.
--
-- QUÉ PASA SI EL SOCIO BAJA DE NIVEL con sellos en curso: la tarjeta NO se borra
-- ni se vacía. Deja de aceptar sellos y se muestra bloqueada con lo que ya juntó.
-- Quitarle sellos ganados sería castigarlo por algo que ya hizo.
-- ============================================================

-- ── 1) Vínculo tarjeta ↔ nivel ──────────────────────────────────────────
create table if not exists public.punch_card_template_tiers (
  template_id uuid not null references public.punch_card_templates(id) on delete cascade,
  tier_id uuid not null references public.loyalty_tiers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, tier_id)
);
create index if not exists punch_card_template_tiers_tier_idx
  on public.punch_card_template_tiers (tier_id);
create index if not exists punch_card_template_tiers_tenant_idx
  on public.punch_card_template_tiers (tenant_id);

comment on table public.punch_card_template_tiers is
  'Niveles que pueden sellar una punch card. Sin filas para un template = sin restricción (todos).';

alter table public.punch_card_template_tiers enable row level security;

drop policy if exists "pctt_select_member" on public.punch_card_template_tiers;
create policy "pctt_select_member" on public.punch_card_template_tiers for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
drop policy if exists "pctt_owner_write" on public.punch_card_template_tiers;
create policy "pctt_owner_write" on public.punch_card_template_tiers for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- Data API GRANT (CLAUDE.md §5): sin esto la tabla es invisible para supabase-js.
grant select, insert, update, delete on public.punch_card_template_tiers to authenticated;

-- Coherencia multi-tenant: la tarjeta y el nivel tienen que ser del mismo bar que
-- la fila de vínculo. La RLS mira el `tenant_id` de la FILA, no el de los FK, así
-- que sin este trigger un owner podría linkear su tarjeta a un nivel ajeno.
create or replace function public.punch_card_template_tiers_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl_tenant uuid;
  v_tier_tenant uuid;
begin
  select tenant_id into v_tpl_tenant from public.punch_card_templates where id = new.template_id;
  select tenant_id into v_tier_tenant from public.loyalty_tiers where id = new.tier_id;
  if v_tpl_tenant is null or v_tier_tenant is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_tpl_tenant <> new.tenant_id or v_tier_tenant <> new.tenant_id then
    raise exception 'tenant_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.punch_card_template_tiers_tenant_match() from public, anon, authenticated;

drop trigger if exists trg_pctt_tenant_match on public.punch_card_template_tiers;
create trigger trg_pctt_tenant_match
  before insert or update on public.punch_card_template_tiers
  for each row execute function public.punch_card_template_tiers_tenant_match();

-- ── 2) Qué ve el que no llega ───────────────────────────────────────────
alter table public.punch_card_templates
  add column if not exists show_when_locked boolean not null default true;

comment on column public.punch_card_templates.show_when_locked is
  'true = el socio que no tiene el nivel la ve bloqueada (aspiracional). false = no la ve.';

-- ── 3) Nivel efectivo de un socio ───────────────────────────────────────
-- Espejo exacto de `resolveTier` (lib/points/tiers.ts) y de
-- `recompute_customer_loyalty`: el nivel de mayor umbral que sus puntos de
-- categoría alcanzan. Se calcula en vivo y no se lee `customers.current_tier_id`
-- para no depender de que el recompute ya haya corrido.
create or replace function public.customer_effective_tier(p_customer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.loyalty_tiers t
    join public.customers c on c.id = p_customer_id
   where t.tenant_id = c.tenant_id
     and t.active = true
     and t.min_category_points <= coalesce(c.category_points, 0)
   order by t.min_category_points desc, t.sort desc
   limit 1
$$;

revoke execute on function public.customer_effective_tier(uuid) from public, anon;
grant execute on function public.customer_effective_tier(uuid) to authenticated;

-- ── 4) Sellar respeta la categoría ──────────────────────────────────────
-- Reemplaza 20260731205453 agregando SOLO el chequeo de nivel. El resto queda
-- igual, incluido el criterio de rol por `auth.uid()` de aquella corrección.
create or replace function public.add_punch_stamp(
  p_customer_id uuid,
  p_template_id uuid,
  p_qty int default 1,
  p_source text default 'manual',
  p_visit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_tpl public.punch_card_templates;
  v_role public.tenant_role;
  v_uid uuid := (select auth.uid());
  v_card public.customer_punch_cards;
  v_max_per_day int;
  v_today_count int;
  v_qty int := greatest(1, coalesce(p_qty, 1));
  v_remaining int;
  v_completed boolean := false;
  v_redemption_id uuid;
  v_tier_id uuid;
begin
  select * into v_customer from public.customers
   where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  select * into v_tpl from public.punch_card_templates
   where id = p_template_id and tenant_id = v_customer.tenant_id and active = true;
  if v_tpl.id is null then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;

  if v_uid is not null then
    v_role := public.user_role_in_tenant(v_customer.tenant_id);
    if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
  end if;

  -- Tarjeta exclusiva de ciertos niveles. Sin filas vinculadas no hay restricción.
  if exists (
    select 1 from public.punch_card_template_tiers where template_id = v_tpl.id
  ) then
    v_tier_id := public.customer_effective_tier(p_customer_id);
    if v_tier_id is null or not exists (
      select 1 from public.punch_card_template_tiers
       where template_id = v_tpl.id and tier_id = v_tier_id
    ) then
      raise exception 'punch_tier_locked' using errcode = 'P0001';
    end if;
  end if;

  -- Tope diario opcional (config.max_per_day), para que no se sellen 6 cafés de
  -- una en la misma visita si el dueño no quiere.
  v_max_per_day := nullif(v_tpl.config ->> 'max_per_day', '')::int;
  if v_max_per_day is not null then
    select coalesce(sum(qty), 0) into v_today_count
      from public.punch_card_stamps
     where customer_id = p_customer_id
       and template_id = p_template_id
       and qty > 0
       and created_at >= date_trunc('day', now() at time zone 'America/Argentina/Cordoba')
                          at time zone 'America/Argentina/Cordoba';
    if v_today_count >= v_max_per_day then
      raise exception 'punch_daily_limit' using errcode = 'P0001';
    end if;
    v_qty := least(v_qty, v_max_per_day - v_today_count);
  end if;

  select * into v_card from public.customer_punch_cards
   where customer_id = p_customer_id
     and template_id = p_template_id
     and completed_at is null
     and expired_at is null
   for update;

  if v_card.id is null then
    insert into public.customer_punch_cards (
      tenant_id, customer_id, template_id, current_stamps, threshold_snapshot
    ) values (
      v_customer.tenant_id, p_customer_id, p_template_id, 0, v_tpl.threshold
    ) returning * into v_card;
  end if;

  v_qty := least(v_qty, v_card.threshold_snapshot - v_card.current_stamps);
  if v_qty <= 0 then
    raise exception 'punch_card_already_full' using errcode = 'P0001';
  end if;

  update public.customer_punch_cards
  set current_stamps = current_stamps + v_qty
  where id = v_card.id
  returning * into v_card;

  insert into public.punch_card_stamps (
    tenant_id, customer_id, card_id, template_id, qty, source, visit_id, created_by
  ) values (
    v_customer.tenant_id, p_customer_id, v_card.id, p_template_id, v_qty,
    coalesce(p_source, 'manual'), p_visit_id, v_uid
  );

  -- ¿Se completó? → premio pendiente de retirar (lo valida el mozo con el mismo
  -- QR de canje del ITEM 11) + arranca una tarjeta nueva en cero para que el
  -- cliente siga sumando sin tener que "empezar" nada.
  if v_card.current_stamps >= v_card.threshold_snapshot then
    insert into public.reward_redemptions (
      tenant_id, customer_id, reward_id, points_spent, redeemed_by, status, source, notes
    ) values (
      v_customer.tenant_id, p_customer_id, v_tpl.reward_id, 0, null, 'pending', 'grant',
      'Tarjeta completa: ' || v_tpl.name
    ) returning id into v_redemption_id;

    update public.customer_punch_cards
    set completed_at = now(), reward_redemption_id = v_redemption_id
    where id = v_card.id;

    insert into public.customer_punch_cards (
      tenant_id, customer_id, template_id, current_stamps, threshold_snapshot
    ) values (
      v_customer.tenant_id, p_customer_id, p_template_id, 0, v_tpl.threshold
    );

    v_completed := true;
    v_remaining := 0;
  else
    v_remaining := v_card.threshold_snapshot - v_card.current_stamps;
  end if;

  return jsonb_build_object(
    'card_id', v_card.id,
    'template_name', v_tpl.name,
    'current_stamps', v_card.current_stamps,
    'threshold', v_card.threshold_snapshot,
    'remaining', v_remaining,
    'completed', v_completed,
    'stamps_added', v_qty,
    'redemption_id', v_redemption_id
  );
end $$;

revoke execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) from public, anon;
grant execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) to authenticated;

-- ── 5) El portero de verdad: en la tabla, no en cada función ────────────
-- `add_punch_stamp` no es el único camino que suma sellos: `register_lunch_visit`
-- sella por su cuenta y el cobro de mesa tiene su propio trigger. Chequear en
-- cada función es garantía de que el día que se agregue la cuarta puerta, esa
-- puerta quede abierta. El invariante vive donde vive el dato.
create or replace function public.punch_template_allows_customer(
  p_template_id uuid,
  p_customer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
           select 1 from public.punch_card_template_tiers where template_id = p_template_id
         )
      or exists (
           select 1 from public.punch_card_template_tiers
            where template_id = p_template_id
              and tier_id = public.customer_effective_tier(p_customer_id)
         )
$$;

revoke execute on function public.punch_template_allows_customer(uuid, uuid) from public, anon;
grant execute on function public.punch_template_allows_customer(uuid, uuid) to authenticated;

create or replace function public.customer_punch_cards_tier_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sólo interesa SUMAR sellos. Crear la tarjeta en cero, completarla o vencerla
  -- pasa siempre: al que ya juntó sellos y bajó de nivel no se le quita nada,
  -- simplemente deja de avanzar.
  if tg_op = 'INSERT' and coalesce(new.current_stamps, 0) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.current_stamps <= old.current_stamps then
    return new;
  end if;

  if not public.punch_template_allows_customer(new.template_id, new.customer_id) then
    raise exception 'punch_tier_locked' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.customer_punch_cards_tier_guard() from public, anon, authenticated;

drop trigger if exists trg_customer_punch_cards_tier_guard on public.customer_punch_cards;
create trigger trg_customer_punch_cards_tier_guard
  before insert or update of current_stamps on public.customer_punch_cards
  for each row execute function public.customer_punch_cards_tier_guard();
