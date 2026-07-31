-- ============================================================
-- Punch cards: revivir el subsistema completo
-- ============================================================
-- ITEM 10 — "punch cards era lo de por ejemplo si consume 6 cafés el 7 es
--   gratis. Hay que mejorar toda la parte del punch cards". Y en la billetera:
--   "ya consumiste 5 cafés, te falta 1 para tener un café gratis", con canje.
--
-- ESTADO ANTERIOR: el subsistema estaba muerto de punta a punta.
--   • `_advance_punch_cards_for_visit` existe y es correcto, pero NADIE lo
--     llama: la llamada se perdió cuando `mark_session_paid` se recreó para
--     sumar redención de puntos (20260529120100).
--   • Aunque se restaurara, no serviría: el cobro de mesa está detrás de la
--     feature `table_service`, apagada en HUB. El único flujo de acreditación
--     vivo (/acreditar → award_points_by_amount) crea la visita SIN items, así
--     que el matching por item/categoría/tag nunca encuentra nada.
--   • `register_lunch_visit` (la única vía manual) insertaba una
--     points_transactions con delta=0 → viola el CHECK `delta <> 0` → reventaba.
--   Resultado real: 0 sellos acreditados en toda la historia de la DB.
--
-- DECISIÓN DEL DUEÑO: el sello lo marca el cajero con un botón "+1" en
-- /acreditar, después de escanear el QR del cliente. No depende de mesas ni de
-- cargar el ticket. El camino automático por ítems queda restaurado para
-- cuando la feature de mesas se prenda.
-- ============================================================

-- El valor 'manual' del enum se agrega en la migración anterior
-- (20260731100350): Postgres no deja usarlo en la misma transacción que lo crea.

-- ── 1) Configuración rica del template ──────────────────────────────────
alter table public.punch_card_templates
  add column if not exists sort int not null default 0,
  add column if not exists stamp_icon text,
  add column if not exists reward_label text;

comment on column public.punch_card_templates.stamp_icon is
  'Ícono de Lucide para el sello (ej. Coffee, Beer, Sandwich). Default: Stamp.';
comment on column public.punch_card_templates.reward_label is
  'Texto del premio en la billetera ("el 7mo café va de regalo"). Si es null se usa el nombre de la recompensa.';

create index if not exists punch_card_templates_sort_idx
  on public.punch_card_templates (tenant_id, sort);

-- 'manual' no lleva trigger_ref_id, igual que 'visit_window'.
alter table public.punch_card_templates
  drop constraint if exists punch_card_templates_trigger_ref_check;
alter table public.punch_card_templates
  add constraint punch_card_templates_trigger_ref_check check (
    (trigger_type in ('item','category','tag') and trigger_ref_id is not null)
    or (trigger_type in ('visit_window','manual') and trigger_ref_id is null)
  );

-- ── 2) Bitácora de sellos ───────────────────────────────────────────────
-- Antes el progreso era un contador pelado: no se sabía quién puso cada sello,
-- cuándo, ni por qué. Sin eso no se puede auditar ni corregir un error de caja.
create table if not exists public.punch_card_stamps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  card_id uuid not null references public.customer_punch_cards(id) on delete cascade,
  template_id uuid not null references public.punch_card_templates(id) on delete cascade,
  qty int not null default 1 check (qty <> 0),
  source text not null default 'manual' check (source in ('manual', 'session', 'lunch', 'correction')),
  visit_id uuid references public.visits(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists punch_card_stamps_card_idx
  on public.punch_card_stamps (card_id, created_at desc);
create index if not exists punch_card_stamps_tenant_idx
  on public.punch_card_stamps (tenant_id, created_at desc);
create index if not exists punch_card_stamps_customer_day_idx
  on public.punch_card_stamps (customer_id, template_id, created_at desc);

alter table public.punch_card_stamps enable row level security;
drop policy if exists "pcs_select_member" on public.punch_card_stamps;
create policy "pcs_select_member" on public.punch_card_stamps for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- Sin write policies: sólo por RPC SECURITY DEFINER.
grant select on public.punch_card_stamps to authenticated;

-- ── 3) add_punch_stamp: el motor único de sellado ───────────────────────
-- NOTA: `add_punch_stamp` se corrige en la migración siguiente
-- (20260731205453_add_punch_stamp_fix_role_bypass): la versión de acá saltea el
-- chequeo de rol cuando p_source = 'session', y como ese parámetro lo elige quien
-- llama, cualquier usuario `authenticated` podía sellar tarjetas de otro tenant.

-- Lo usan los tres caminos (botón +1 del cajero, cobro de mesa, almuerzo), así
-- que la regla de "completar → premio" vive en UN solo lugar.
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
  v_card public.customer_punch_cards;
  v_max_per_day int;
  v_today_count int;
  v_qty int := greatest(1, coalesce(p_qty, 1));
  v_remaining int;
  v_completed boolean := false;
  v_redemption_id uuid;
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

  -- El sellado automático (cobro de mesa) corre dentro de otra SECURITY DEFINER
  -- sin usuario; el manual exige rol de mostrador.
  if p_source <> 'session' then
    v_role := public.user_role_in_tenant(v_customer.tenant_id);
    if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
  end if;

  -- Tope diario opcional (config.max_per_day), para que no se sellen 6 cafés
  -- de una en la misma visita si el dueño no quiere.
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

  -- Tarjeta activa o nueva.
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
    coalesce(p_source, 'manual'), p_visit_id, (select auth.uid())
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
    'redemption_id', v_redemption_id,
    'stamps_added', v_qty
  );
end $$;

-- ── 4) remove_punch_stamp: deshacer un error de caja ────────────────────
create or replace function public.remove_punch_stamp(p_card_id uuid, p_qty int default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.customer_punch_cards;
  v_role public.tenant_role;
  v_qty int := greatest(1, coalesce(p_qty, 1));
begin
  select * into v_card from public.customer_punch_cards
   where id = p_card_id and completed_at is null and expired_at is null
   for update;
  if v_card.id is null then
    raise exception 'punch_card_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_card.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  v_qty := least(v_qty, v_card.current_stamps);
  if v_qty <= 0 then
    raise exception 'punch_card_empty' using errcode = 'P0001';
  end if;

  update public.customer_punch_cards
  set current_stamps = current_stamps - v_qty
  where id = v_card.id
  returning * into v_card;

  insert into public.punch_card_stamps (
    tenant_id, customer_id, card_id, template_id, qty, source, created_by
  ) values (
    v_card.tenant_id, v_card.customer_id, v_card.id, v_card.template_id,
    -v_qty, 'correction', (select auth.uid())
  );

  return jsonb_build_object(
    'card_id', v_card.id,
    'current_stamps', v_card.current_stamps,
    'threshold', v_card.threshold_snapshot
  );
end $$;

-- ── 5) register_lunch_visit: arreglar el delta=0 que la reventaba ───────
-- NOTA: las claves de config de esta versión (`days`/`from`/`to`) están mal —
-- el editor escribe `days_of_week`/`hours_from`/`hours_to`, así que la ventana
-- horaria no aplicaba. Se corrige en 20260801000100_register_lunch_visit_config_keys.

-- El cupo diario ahora se cuenta contra punch_card_stamps (fuente de verdad),
-- no contra el ledger de puntos, y el sellado delega en add_punch_stamp.
create or replace function public.register_lunch_visit(
  p_customer_id uuid,
  p_template_id uuid
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
  v_cfg jsonb;
  v_now timestamptz := now();
  v_local timestamp := (now() at time zone 'America/Argentina/Cordoba');
  v_dow int;
  v_days jsonb;
  v_from time;
  v_to time;
begin
  select * into v_customer from public.customers
   where id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_customer.tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier', 'waiter') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select * into v_tpl from public.punch_card_templates
   where id = p_template_id and tenant_id = v_customer.tenant_id and active = true;
  if v_tpl.id is null then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;

  v_cfg := coalesce(v_tpl.config, '{}'::jsonb);

  -- Ventana horaria / días habilitados (sólo para visit_window).
  if v_tpl.trigger_type = 'visit_window' then
    v_days := v_cfg -> 'days';
    if v_days is not null and jsonb_typeof(v_days) = 'array' then
      v_dow := extract(isodow from v_local)::int;
      if not (v_days @> to_jsonb(v_dow)) then
        raise exception 'punch_day_not_allowed' using errcode = 'P0001';
      end if;
    end if;

    v_from := nullif(v_cfg ->> 'from', '')::time;
    v_to := nullif(v_cfg ->> 'to', '')::time;
    if v_from is not null and v_to is not null then
      if not (v_local::time between v_from and v_to) then
        raise exception 'punch_time_not_allowed' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return public.add_punch_stamp(p_customer_id, p_template_id, 1, 'lunch', null);
end $$;

-- ── 6) Restaurar el sellado automático en el cobro de mesa ──────────────
-- La llamada a _advance_punch_cards_for_visit se había perdido. En vez de
-- recrear `mark_session_paid` entera (y arrastrar su deuda), se engancha por
-- trigger sobre `visit_items`: cuando una visita registra ítems, se avanzan las
-- tarjetas que matcheen. Así funciona venga de donde venga la visita.
create or replace function public.advance_punch_cards_on_visit_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit public.visits;
  v_tpl record;
begin
  select * into v_visit from public.visits where id = new.visit_id;
  if v_visit.id is null or v_visit.customer_id is null then
    return new;
  end if;

  for v_tpl in
    select t.id, t.trigger_type, t.trigger_ref_id
      from public.punch_card_templates t
     where t.tenant_id = v_visit.tenant_id
       and t.active = true
       and t.trigger_type in ('item', 'category', 'tag')
  loop
    if (v_tpl.trigger_type = 'item' and new.menu_item_id = v_tpl.trigger_ref_id)
       or (v_tpl.trigger_type = 'category' and exists (
             select 1 from public.menu_items mi
              where mi.id = new.menu_item_id and mi.category_id = v_tpl.trigger_ref_id))
       or (v_tpl.trigger_type = 'tag' and exists (
             select 1 from public.menu_item_tag_assignments a
              where a.menu_item_id = new.menu_item_id and a.tag_id = v_tpl.trigger_ref_id))
    then
      begin
        perform public.add_punch_stamp(
          v_visit.customer_id, v_tpl.id, coalesce(new.quantity, 1), 'session', v_visit.id
        );
      exception when others then
        -- Un sello no puede tumbar el cobro de la mesa.
        null;
      end;
    end if;
  end loop;

  return new;
end $$;

revoke all on function public.advance_punch_cards_on_visit_items() from public, anon, authenticated;

drop trigger if exists trg_advance_punch_cards on public.visit_items;
create trigger trg_advance_punch_cards
  after insert on public.visit_items
  for each row execute function public.advance_punch_cards_on_visit_items();

-- ── 7) Permisos ─────────────────────────────────────────────────────────
revoke execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) from public, anon;
revoke execute on function public.remove_punch_stamp(uuid, int) from public, anon;
grant execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) to authenticated;
grant execute on function public.remove_punch_stamp(uuid, int) to authenticated;

comment on function public.add_punch_stamp(uuid, uuid, int, text, uuid) is
  'ITEM 10: motor único de sellado. Al completar la tarjeta emite el premio como reward_redemptions pending (se valida con el QR del ITEM 11) y arranca una tarjeta nueva en cero.';
