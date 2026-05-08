-- Phase 3: consumo + fidelización
-- Tablas: menu_categories, menu_items, visits, visit_items,
--         points_rules, points_transactions, rewards, reward_redemptions
-- Triggers: visits → customers stats; points_transactions → points_balance
-- RPCs: close_table, redeem_reward, reorder_menu_categories, reorder_menu_items
--       calculate_visit_points (helper interno usado por close_table)
-- RLS: lock-down. Ledger inmutable: insert solo via RPC SECURITY DEFINER.

-- ──────────────────────────────────────────────────────────
-- 1. Enums
-- ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'visit_source') then
    create type public.visit_source as enum ('cashier', 'import');
  end if;
  if not exists (select 1 from pg_type where typname = 'points_rule_type') then
    create type public.points_rule_type as enum ('per_amount', 'per_item');
  end if;
  if not exists (select 1 from pg_type where typname = 'redemption_status') then
    create type public.redemption_status as enum ('pending', 'delivered', 'cancelled');
  end if;
end $$;

-- ──────────────────────────────────────────────────────────
-- 2. menu_categories
-- ──────────────────────────────────────────────────────────
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index menu_categories_tenant_pos_idx
  on public.menu_categories(tenant_id, position);

-- ──────────────────────────────────────────────────────────
-- 3. menu_items
-- ──────────────────────────────────────────────────────────
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.menu_categories(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  price_cents bigint not null check (price_cents >= 0),
  points_override int,
  position int not null default 0,
  active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_tenant_idx on public.menu_items(tenant_id);
create index menu_items_category_pos_idx on public.menu_items(category_id, position);
create trigger menu_items_updated_at before update on public.menu_items
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- 4. visits
-- ──────────────────────────────────────────────────────────
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  visited_at timestamptz not null default now(),
  total_amount_cents bigint not null default 0 check (total_amount_cents >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  source public.visit_source not null default 'cashier',
  created_at timestamptz not null default now()
);
create index visits_tenant_visited_idx
  on public.visits(tenant_id, visited_at desc);
create index visits_customer_idx
  on public.visits(customer_id, visited_at desc);

-- ──────────────────────────────────────────────────────────
-- 5. visit_items
-- ──────────────────────────────────────────────────────────
create table public.visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity int not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  created_at timestamptz not null default now()
);
create index visit_items_visit_idx on public.visit_items(visit_id);

-- ──────────────────────────────────────────────────────────
-- 6. points_rules
-- ──────────────────────────────────────────────────────────
create table public.points_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.points_rule_type not null,
  config jsonb not null,
  priority int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index points_rules_tenant_idx on public.points_rules(tenant_id, priority desc);

-- ──────────────────────────────────────────────────────────
-- 7. points_transactions (ledger inmutable)
-- ──────────────────────────────────────────────────────────
create table public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  redemption_id uuid,                        -- FK agregada después de crear rewards
  delta int not null check (delta <> 0),
  reason text not null,
  payload jsonb not null default '{}'::jsonb,  -- breakdown del motor
  created_at timestamptz not null default now()
);
create index points_tx_customer_idx
  on public.points_transactions(customer_id, created_at desc);
create index points_tx_tenant_idx
  on public.points_transactions(tenant_id, created_at desc);

-- ──────────────────────────────────────────────────────────
-- 8. rewards
-- ──────────────────────────────────────────────────────────
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  cost_points int not null check (cost_points > 0),
  stock int check (stock is null or stock >= 0),  -- null = ilimitado
  active boolean not null default true,
  image_url text,
  created_at timestamptz not null default now()
);
create index rewards_tenant_idx on public.rewards(tenant_id);

-- ──────────────────────────────────────────────────────────
-- 9. reward_redemptions
-- ──────────────────────────────────────────────────────────
create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  reward_id uuid not null references public.rewards(id) on delete restrict,
  points_spent int not null check (points_spent > 0),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  status public.redemption_status not null default 'delivered',
  notes text,
  created_at timestamptz not null default now()
);
create index reward_redemptions_customer_idx
  on public.reward_redemptions(customer_id, redeemed_at desc);
create index reward_redemptions_tenant_idx
  on public.reward_redemptions(tenant_id, redeemed_at desc);

-- 9.b ahora podemos cerrar la FK de points_transactions.redemption_id
alter table public.points_transactions
  add constraint points_tx_redemption_fk
  foreign key (redemption_id) references public.reward_redemptions(id) on delete set null;

-- ──────────────────────────────────────────────────────────
-- 10. Triggers de mantenimiento
-- ──────────────────────────────────────────────────────────

-- 10.1 points_transactions → customers.points_balance
create or replace function public.points_tx_apply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.customers
      set points_balance = points_balance + new.delta
      where id = new.customer_id;
    return new;
  elsif tg_op = 'DELETE' then
    -- defensivo: ledger inmutable, pero si alguna vez se borra, mantenemos el balance
    update public.customers
      set points_balance = points_balance - old.delta
      where id = old.customer_id;
    return old;
  elsif tg_op = 'UPDATE' then
    -- defensivo: si alguien edita delta a la fuerza
    update public.customers
      set points_balance = points_balance - old.delta + new.delta
      where id = new.customer_id;
    return new;
  end if;
  return null;
end; $$;

create trigger points_tx_apply_trg
  after insert or update or delete on public.points_transactions
  for each row execute function public.points_tx_apply();

-- 10.2 visits → customers stats
create or replace function public.visits_apply_stats()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.customers set
      total_visits = total_visits + 1,
      total_spent_cents = total_spent_cents + new.total_amount_cents,
      last_visit_at = greatest(coalesce(last_visit_at, '-infinity'::timestamptz), new.visited_at)
    where id = new.customer_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.customers set
      total_visits = greatest(0, total_visits - 1),
      total_spent_cents = greatest(0, total_spent_cents - old.total_amount_cents)
    where id = old.customer_id;
    -- no recomputamos last_visit_at en DELETE para no escanear todas las visits;
    -- aceptable porque borrar visitas no es flujo normal.
    return old;
  elsif tg_op = 'UPDATE' then
    if new.total_amount_cents <> old.total_amount_cents then
      update public.customers set
        total_spent_cents = total_spent_cents - old.total_amount_cents + new.total_amount_cents
      where id = new.customer_id;
    end if;
    if new.visited_at <> old.visited_at then
      update public.customers set
        last_visit_at = greatest(coalesce(last_visit_at, '-infinity'::timestamptz), new.visited_at)
      where id = new.customer_id;
    end if;
    return new;
  end if;
  return null;
end; $$;

create trigger visits_apply_stats_trg
  after insert or update or delete on public.visits
  for each row execute function public.visits_apply_stats();

-- ──────────────────────────────────────────────────────────
-- 11. Función pura del motor de puntos en SQL
--     Espejo del engine TS — fuente de verdad atómica.
-- ──────────────────────────────────────────────────────────
create or replace function public.calculate_visit_points(p_visit_id uuid)
returns table(delta int, breakdown jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_visit public.visits;
  v_total bigint;
  v_breakdown jsonb := '[]'::jsonb;
  v_delta int := 0;
  r record;
  cfg jsonb;
  pts int;
  every_cents bigint;
  rule_points int;
  matched_qty int;
  desc_text text;
begin
  select * into v_visit from public.visits where id = p_visit_id;
  if v_visit.id is null then
    raise exception 'visit_not_found' using errcode = 'P0001';
  end if;
  v_total := v_visit.total_amount_cents;

  -- 1. Aplicar reglas activas en orden de prioridad desc
  for r in
    select * from public.points_rules
      where tenant_id = v_visit.tenant_id and active = true
      order by priority desc, id asc
  loop
    cfg := r.config;
    if r.type = 'per_amount' then
      every_cents := nullif((cfg ->> 'every_cents')::bigint, 0);
      rule_points := coalesce((cfg ->> 'points')::int, 0);
      if every_cents is not null and every_cents > 0 and rule_points <> 0 and v_total > 0 then
        pts := (v_total / every_cents)::int * rule_points;
        if pts <> 0 then
          desc_text := format(
            'Cada $%s gastados → %s pts (×%s)',
            (every_cents / 100)::text,
            rule_points::text,
            (v_total / every_cents)::text
          );
          v_breakdown := v_breakdown || jsonb_build_object(
            'rule_id', r.id,
            'source', 'per_amount',
            'description', desc_text,
            'points', pts
          );
          v_delta := v_delta + pts;
        end if;
      end if;

    elsif r.type = 'per_item' then
      rule_points := coalesce((cfg ->> 'points')::int, 0);
      if cfg ? 'item_id' then
        select coalesce(sum(quantity), 0) into matched_qty
          from public.visit_items
          where visit_id = p_visit_id and menu_item_id::text = cfg ->> 'item_id';
        if matched_qty > 0 and rule_points <> 0 then
          pts := matched_qty * rule_points;
          desc_text := format('Ítem específico × %s → %s pts', matched_qty::text, pts::text);
          v_breakdown := v_breakdown || jsonb_build_object(
            'rule_id', r.id,
            'source', 'per_item_id',
            'description', desc_text,
            'points', pts
          );
          v_delta := v_delta + pts;
        end if;
      elsif cfg ? 'category_id' then
        select coalesce(sum(vi.quantity), 0) into matched_qty
          from public.visit_items vi
          join public.menu_items mi on mi.id = vi.menu_item_id
          where vi.visit_id = p_visit_id and mi.category_id::text = cfg ->> 'category_id';
        if matched_qty > 0 and rule_points <> 0 then
          pts := matched_qty * rule_points;
          desc_text := format('Categoría × %s → %s pts', matched_qty::text, pts::text);
          v_breakdown := v_breakdown || jsonb_build_object(
            'rule_id', r.id,
            'source', 'per_item_category',
            'description', desc_text,
            'points', pts
          );
          v_delta := v_delta + pts;
        end if;
      end if;
    end if;
  end loop;

  -- 2. Item overrides aditivos
  select coalesce(sum(vi.quantity * mi.points_override), 0) into pts
    from public.visit_items vi
    join public.menu_items mi on mi.id = vi.menu_item_id
    where vi.visit_id = p_visit_id and mi.points_override is not null
      and mi.points_override <> 0;
  if pts <> 0 then
    v_breakdown := v_breakdown || jsonb_build_object(
      'rule_id', null,
      'source', 'item_override',
      'description', format('Bonus por ítems con puntos extra: %s pts', pts::text),
      'points', pts
    );
    v_delta := v_delta + pts;
  end if;

  -- 3. Nunca delta negativo de la suma de reglas (descuentos sólo via redenciones)
  if v_delta < 0 then
    v_delta := 0;
  end if;

  return query select v_delta, v_breakdown;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 12. RPC close_table (cashier+owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.close_table(
  p_customer_id uuid,
  p_items jsonb,            -- [{"item_id": uuid, "quantity": int}, ...]
  p_notes text default null
) returns table(visit_id uuid, points_awarded int, breakdown jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_tenant_id uuid;
  v_visit_id uuid;
  v_total bigint := 0;
  it record;
  v_unit_price bigint;
  v_calc record;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  -- 1. Resolver tenant del customer y validar role del caller
  select tenant_id into v_tenant_id
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_tenant_id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items_required' using errcode = 'P0001';
  end if;

  -- 2. Crear visit con total 0 (lo recalculamos)
  insert into public.visits (tenant_id, customer_id, total_amount_cents, notes, created_by, source)
  values (v_tenant_id, p_customer_id, 0, p_notes, v_uid, 'cashier')
  returning id into v_visit_id;

  -- 3. Insertar visit_items con snapshot de unit_price desde menu_items.
  --    Validamos que cada item pertenece al tenant.
  for it in select * from jsonb_to_recordset(p_items)
              as x(item_id uuid, quantity int)
  loop
    if it.quantity is null or it.quantity <= 0 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    select price_cents into v_unit_price
      from public.menu_items
      where id = it.item_id and tenant_id = v_tenant_id and active = true;
    if v_unit_price is null then
      raise exception 'invalid_or_inactive_item' using errcode = 'P0001';
    end if;

    insert into public.visit_items (
      visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents
    ) values (
      v_visit_id, it.item_id, it.quantity, v_unit_price, v_unit_price * it.quantity
    );
    v_total := v_total + v_unit_price * it.quantity;
  end loop;

  -- 4. Update visit total → dispara visits_apply_stats trigger
  update public.visits set total_amount_cents = v_total where id = v_visit_id;

  -- 5. Calcular puntos y registrar transacción si delta > 0
  select * into v_calc from public.calculate_visit_points(v_visit_id);
  if v_calc.delta > 0 then
    insert into public.points_transactions (
      tenant_id, customer_id, visit_id, delta, reason, payload
    ) values (
      v_tenant_id, p_customer_id, v_visit_id, v_calc.delta, 'rule_engine', v_calc.breakdown
    );
  end if;

  return query select v_visit_id, v_calc.delta, v_calc.breakdown;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 13. RPC redeem_reward (cashier+owner)
-- ──────────────────────────────────────────────────────────
create or replace function public.redeem_reward(
  p_customer_id uuid,
  p_reward_id uuid
) returns table(redemption_id uuid, balance_after int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.tenant_role;
  v_tenant_id uuid;
  v_reward public.rewards;
  v_balance int;
  v_redemption_id uuid;
  v_new_stock int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;

  select tenant_id into v_tenant_id
    from public.customers
    where id = p_customer_id and deleted_at is null;
  if v_tenant_id is null then
    raise exception 'customer_not_found' using errcode = 'P0001';
  end if;

  v_role := public.user_role_in_tenant(v_tenant_id);
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Lock fila de reward para evitar race en stock
  select * into v_reward from public.rewards
    where id = p_reward_id and tenant_id = v_tenant_id
    for update;
  if v_reward.id is null then
    raise exception 'reward_not_found' using errcode = 'P0001';
  end if;
  if not v_reward.active then
    raise exception 'reward_inactive' using errcode = 'P0001';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'out_of_stock' using errcode = 'P0001';
  end if;

  -- Lock customer balance read
  select points_balance into v_balance from public.customers
    where id = p_customer_id for update;
  if v_balance < v_reward.cost_points then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;

  insert into public.reward_redemptions (
    tenant_id, customer_id, reward_id, points_spent, redeemed_by
  ) values (
    v_tenant_id, p_customer_id, p_reward_id, v_reward.cost_points, v_uid
  ) returning id into v_redemption_id;

  insert into public.points_transactions (
    tenant_id, customer_id, redemption_id, delta, reason, payload
  ) values (
    v_tenant_id, p_customer_id, v_redemption_id, -v_reward.cost_points,
    'reward_redeem', jsonb_build_object('reward_id', p_reward_id, 'reward_name', v_reward.name)
  );

  if v_reward.stock is not null then
    update public.rewards set stock = stock - 1 where id = p_reward_id
      returning stock into v_new_stock;
  end if;

  return query select v_redemption_id, v_balance - v_reward.cost_points;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 14. RPCs de reordenamiento (transaccionales)
-- ──────────────────────────────────────────────────────────
create or replace function public.reorder_menu_categories(
  p_tenant_id uuid, p_ordered_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role public.tenant_role := public.user_role_in_tenant(p_tenant_id);
  i int;
begin
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_categories
      set position = i
      where id = p_ordered_ids[i] and tenant_id = p_tenant_id;
  end loop;
end; $$;

create or replace function public.reorder_menu_items(
  p_category_id uuid, p_ordered_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_role public.tenant_role;
  i int;
begin
  select tenant_id into v_tenant from public.menu_categories where id = p_category_id;
  if v_tenant is null then raise exception 'category_not_found' using errcode = 'P0001'; end if;
  v_role := public.user_role_in_tenant(v_tenant);
  if v_role is null or v_role <> 'owner' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update public.menu_items
      set position = i
      where id = p_ordered_ids[i] and category_id = p_category_id;
  end loop;
end; $$;

-- ──────────────────────────────────────────────────────────
-- 15. RLS
-- ──────────────────────────────────────────────────────────

-- 15.1 menu_categories
alter table public.menu_categories enable row level security;
create policy "mc_select_member" on public.menu_categories for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "mc_owner_insert" on public.menu_categories for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "mc_owner_update" on public.menu_categories for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "mc_owner_delete" on public.menu_categories for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 15.2 menu_items
alter table public.menu_items enable row level security;
create policy "mi_select_member" on public.menu_items for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "mi_owner_insert" on public.menu_items for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "mi_owner_update" on public.menu_items for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "mi_owner_delete" on public.menu_items for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 15.3 visits
alter table public.visits enable row level security;
create policy "v_select_member" on public.visits for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- INSERT solo via close_table() RPC (SECURITY DEFINER)
create policy "v_owner_update" on public.visits for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "v_owner_delete" on public.visits for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 15.4 visit_items
alter table public.visit_items enable row level security;
create policy "vi_select_member" on public.visit_items for select to authenticated
  using (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.tenant_id in (select public.user_tenant_ids())
    )
  );
-- INSERT solo via close_table() RPC

-- 15.5 points_rules
alter table public.points_rules enable row level security;
create policy "pr_select_member" on public.points_rules for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "pr_owner_insert" on public.points_rules for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "pr_owner_update" on public.points_rules for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "pr_owner_delete" on public.points_rules for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 15.6 points_transactions (ledger inmutable: insert solo via RPC)
alter table public.points_transactions enable row level security;
create policy "pt_select_member" on public.points_transactions for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
-- sin policy de insert/update/delete: ledger inmutable para authenticated.

-- 15.7 rewards
alter table public.rewards enable row level security;
create policy "rw_select_member" on public.rewards for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "rw_owner_insert" on public.rewards for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "rw_owner_update" on public.rewards for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "rw_owner_delete" on public.rewards for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- 15.8 reward_redemptions (insert solo via RPC; owner puede update/delete)
alter table public.reward_redemptions enable row level security;
create policy "rr_select_member" on public.reward_redemptions for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));
create policy "rr_owner_update" on public.reward_redemptions for update to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');
create policy "rr_owner_delete" on public.reward_redemptions for delete to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- 16. GRANTs
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.menu_categories to authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;
grant select on public.visits to authenticated;
grant update, delete on public.visits to authenticated;
grant select on public.visit_items to authenticated;
grant select, insert, update, delete on public.points_rules to authenticated;
grant select on public.points_transactions to authenticated;
grant select, insert, update, delete on public.rewards to authenticated;
grant select, update, delete on public.reward_redemptions to authenticated;

revoke all on function public.close_table(uuid, jsonb, text) from public;
revoke all on function public.redeem_reward(uuid, uuid) from public;
revoke all on function public.calculate_visit_points(uuid) from public;
revoke all on function public.reorder_menu_categories(uuid, uuid[]) from public;
revoke all on function public.reorder_menu_items(uuid, uuid[]) from public;

grant execute on function public.close_table(uuid, jsonb, text),
  public.redeem_reward(uuid, uuid),
  public.reorder_menu_categories(uuid, uuid[]),
  public.reorder_menu_items(uuid, uuid[]) to authenticated;
-- calculate_visit_points es helper interno; no se expone a authenticated directamente.
