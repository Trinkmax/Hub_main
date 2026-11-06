-- Compras: del conteo de stock en la cocina a la mercadería en la cámara (docs/features/compras.md).
--
-- La cocina cuenta por zona → la app calcula cuánto pedir → quien compra (en HUB, Tomás) revisa y lo manda
-- por WhatsApp → el proveedor confirma → la cocina recibe → las diferencias vuelven a quien compra.
--
--   A pedir = stock objetivo + lo que piden los eventos − lo contado − lo que ya viene en camino,
--   redondeado hacia arriba a la presentación de compra.
--
-- Los eventos salen del calendario (scheduled_events) y las personas, de las reservas: cada formato tiene
-- su receta para 60 personas, que se multiplica si la fecha tiene más. La recepción NO suma stock: el stock
-- sale siempre de los conteos.
--
-- Quién hace qué (lib/tenant/roles.ts → PURCHASING_*):
--   · dueño (owner): todo; es el único que edita insumos, recetas y proveedores y el que manda los pedidos.
--   · cocina y caja (kitchen, cashier): leen el catálogo, cuentan y reciben (estas dos por RPC).
--   · el resto (mozo, anfitriona, contenido, contadora): nada.
-- Aditiva: solo crea tablas y funciones nuevas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ajustes por bar
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- 0 = domingo … 6 = sábado. HUB cuenta lunes y miércoles.
  count_weekdays smallint[] not null default '{1,3}'
    check (count_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  -- Para cuántas personas están escritas las recetas (se multiplican si la fecha tiene más).
  recipe_base_guests smallint not null default 60 check (recipe_base_guests between 1 and 1000),
  -- Quién revisa los pedidos: la cocina lee «Enviar a Tomás». Sin nombre, «Enviar a compras».
  reviewer_name text check (reviewer_name is null or char_length(btrim(reviewer_name)) between 1 and 40),
  -- Cómo se presenta el WhatsApp: «Te escribo de HUB». Sin dato, el nombre del bar.
  sender_name text check (sender_name is null or char_length(btrim(sender_name)) between 1 and 60),
  -- «Poco» sin número cuenta como esta fracción del objetivo.
  low_fraction numeric(3, 2) not null default 0.5 check (low_fraction > 0 and low_fraction < 1),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.pur_settings is 'Compras: ajustes del bar (días de conteo, personas de las recetas, quién revisa).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Zonas del recorrido, en el orden en que la cocina las recorre
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  area text check (area is null or char_length(area) <= 40), -- «Planta alta»
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_zones_id_tenant_uq unique (id, tenant_id)
);
create unique index pur_zones_name_uq on public.pur_zones (tenant_id, lower(btrim(name)));
comment on table public.pur_zones is 'Compras: zonas del recorrido de conteo (freezer, cámara, almacén…), en orden.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Proveedores de compras (a quién se le manda el WhatsApp)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  contact_name text check (contact_name is null or char_length(btrim(contact_name)) between 1 and 60),
  -- Solo dígitos, con el país: 5493511234567 (lo que va en wa.me/…).
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  -- 0 = domingo … 6 = sábado. Vacío = no se sabe (no se calcula la fecha de entrega).
  delivery_weekdays smallint[] not null default '{}'
    check (delivery_weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  -- Con cuántos días hay que pedir: 1 = lo que se pide hoy llega desde mañana.
  lead_days smallint not null default 1 check (lead_days between 0 and 14),
  notes text check (notes is null or char_length(notes) <= 500),
  -- El mismo proveedor en Administración, para cuando llegue su factura.
  acc_party_id uuid,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_suppliers_id_tenant_uq unique (id, tenant_id),
  constraint pur_suppliers_party_fk foreign key (acc_party_id, tenant_id)
    references public.acc_parties (id, tenant_id) on delete set null (acc_party_id)
);
create unique index pur_suppliers_name_uq on public.pur_suppliers (tenant_id, lower(btrim(name)));
comment on table public.pur_suppliers is 'Compras: proveedores (contacto, WhatsApp, días de entrega). acc_party_id lo une con Administración.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Insumos
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text check (code is null or char_length(btrim(code)) between 1 and 20), -- el ID de la planilla: INS-006
  name text not null check (char_length(btrim(name)) between 1 and 80),
  brand text check (brand is null or char_length(brand) <= 60),
  zone_id uuid,
  -- La unidad en que se cuenta: kg, L, unidad, atado, porción…
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  -- frequent = en todos los conteos; secondary = una vez por mes; occasional = solo si un evento lo pide.
  frequency text not null default 'frequent' check (frequency in ('frequent', 'secondary', 'occasional')),
  target_qty numeric(12, 3) check (target_qty is null or target_qty >= 0), -- stock objetivo, en la unidad
  pack_label text check (pack_label is null or char_length(pack_label) <= 60), -- «Caja x 150 u», «Por kg»
  pack_size numeric(12, 3) check (pack_size is null or pack_size > 0), -- cuántas unidades trae (150)
  supplier_id uuid,
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_items_id_tenant_uq unique (id, tenant_id),
  constraint pur_items_zone_fk foreign key (zone_id, tenant_id)
    references public.pur_zones (id, tenant_id) on delete set null (zone_id),
  constraint pur_items_supplier_fk foreign key (supplier_id, tenant_id)
    references public.pur_suppliers (id, tenant_id) on delete set null (supplier_id)
);
create unique index pur_items_code_uq on public.pur_items (tenant_id, upper(btrim(code))) where code is not null;
create index pur_items_zone_idx on public.pur_items (tenant_id, zone_id);
create index pur_items_supplier_idx on public.pur_items (tenant_id, supplier_id);
comment on table public.pur_items is 'Compras: insumos (zona, unidad, objetivo, frecuencia, presentación de compra, proveedor).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Recetas por formato de evento (y variante): lo que lleva cada noche para N personas
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80), -- «Noche de Ramen»
  variant text not null default 'Única' check (char_length(btrim(variant)) between 1 and 40),
  base_guests smallint not null default 60 check (base_guests between 1 and 1000),
  -- Un aviso para quien compra («Promo de martes: revisar pan y carne»). Una receta sin insumos es solo eso.
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_recipes_id_tenant_uq unique (id, tenant_id),
  constraint pur_recipes_template_fk foreign key (template_id, tenant_id)
    references public.scheduled_event_templates (id, tenant_id) on delete set null (template_id)
);
create unique index pur_recipes_variant_uq on public.pur_recipes (tenant_id, template_id, lower(btrim(variant)))
  where template_id is not null;
create index pur_recipes_template_idx on public.pur_recipes (tenant_id, template_id);
comment on table public.pur_recipes is 'Compras: receta de un formato de evento (y su variante) para base_guests personas.';

create table public.pur_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipe_id uuid not null,
  item_id uuid,
  -- Como figura en la receta: sirve si el insumo ya no está en la lista y para lo que se hace en el local.
  name text not null check (char_length(btrim(name)) between 1 and 80),
  quantity numeric(12, 3) check (quantity is null or quantity > 0), -- para base_guests; null = sin cantidad
  unit text check (unit is null or char_length(btrim(unit)) between 1 and 20),
  -- «Producción»: se hace en el local (caldos, salsas). Se muestra como recordatorio, no entra al pedido.
  in_house boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_recipe_lines_recipe_fk foreign key (recipe_id, tenant_id)
    references public.pur_recipes (id, tenant_id) on delete cascade,
  constraint pur_recipe_lines_item_fk foreign key (item_id, tenant_id)
    references public.pur_items (id, tenant_id) on delete set null (item_id)
);
create index pur_recipe_lines_recipe_idx on public.pur_recipe_lines (recipe_id, sort_order);
create index pur_recipe_lines_item_idx on public.pur_recipe_lines (tenant_id, item_id);

-- Cómo se planifica cada fecha del calendario: qué variante va y para cuántas personas se compra.
create table public.pur_event_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scheduled_event_id uuid not null,
  recipe_id uuid, -- la variante elegida (Ramen: cerdo o langostino)
  guests integer check (guests is null or guests between 1 and 5000), -- null = las reservadas (mínimo la receta)
  skip boolean not null default false, -- esta fecha no suma insumos
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_event_plans_one_per_event unique (scheduled_event_id),
  constraint pur_event_plans_event_fk foreign key (scheduled_event_id, tenant_id)
    references public.scheduled_events (id, tenant_id) on delete cascade,
  constraint pur_event_plans_recipe_fk foreign key (recipe_id, tenant_id)
    references public.pur_recipes (id, tenant_id) on delete set null (recipe_id)
);
create index pur_event_plans_tenant_idx on public.pur_event_plans (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conteos (cada vez que la cocina cuenta)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pur_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'order' check (kind in ('order', 'top_up')), -- Pedido / Refuerzo
  count_date date not null,
  events_until date not null, -- «contar para los eventos hasta»
  counted_by_name text not null check (char_length(btrim(counted_by_name)) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'sent', 'discarded')),
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_counts_id_tenant_uq unique (id, tenant_id),
  constraint pur_counts_until_after check (events_until >= count_date and events_until <= count_date + 60),
  constraint pur_counts_sent_shape check ((status = 'sent') = (sent_at is not null))
);
create index pur_counts_tenant_idx on public.pur_counts (tenant_id, status, count_date desc);
-- Un solo conteo abierto por bar: si se corta, se sigue el mismo (también entre dos personas).
create unique index pur_counts_one_open on public.pur_counts (tenant_id) where status = 'open';

create table public.pur_count_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  count_id uuid not null,
  item_id uuid not null,
  -- enough = Alcanza · low = Poco (número opcional) · none = No hay · exact = el número exacto (eventos)
  state text not null check (state in ('enough', 'low', 'none', 'exact')),
  quantity numeric(12, 3) check (quantity is null or quantity >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_count_lines_one_per_item unique (count_id, item_id),
  constraint pur_count_lines_count_fk foreign key (count_id, tenant_id)
    references public.pur_counts (id, tenant_id) on delete cascade,
  constraint pur_count_lines_item_fk foreign key (item_id, tenant_id)
    references public.pur_items (id, tenant_id) on delete cascade,
  constraint pur_count_lines_exact_has_qty check (state <> 'exact' or quantity is not null),
  constraint pur_count_lines_none_is_zero check (state <> 'none' or coalesce(quantity, 0) = 0),
  constraint pur_count_lines_enough_bare check (state <> 'enough' or quantity is null)
);
create index pur_count_lines_item_idx on public.pur_count_lines (tenant_id, item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Pedidos: uno por proveedor y conteo, y sus productos
-- ─────────────────────────────────────────────────────────────────────────────
-- draft → sent → confirmed → completed, o → with_differences → completed. De draft, «Hoy no pido» = discarded.
-- La cocina recibe los sent (con el aviso de que no se confirmó) y los confirmed.
create table public.pur_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  count_id uuid,
  supplier_id uuid, -- null = productos sin proveedor asignado
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'confirmed', 'with_differences', 'completed', 'discarded')),
  expected_date date, -- entrega prevista (de los días del proveedor; se corrige al confirmar)
  supplier_note text check (supplier_note is null or char_length(supplier_note) <= 500), -- sale en el WhatsApp
  kitchen_note text check (kitchen_note is null or char_length(kitchen_note) <= 500), -- la lee la cocina
  message text check (message is null or char_length(message) <= 4000), -- el WhatsApp como se mandó
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_with_changes boolean not null default false,
  received_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  received_by_name text check (received_by_name is null or char_length(received_by_name) <= 60),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  discarded_at timestamptz,
  discarded_by uuid references auth.users(id) on delete set null,
  discard_reason text check (discard_reason is null or discard_reason in ('skipped', 'superseded')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_orders_id_tenant_uq unique (id, tenant_id),
  constraint pur_orders_count_fk foreign key (count_id, tenant_id)
    references public.pur_counts (id, tenant_id) on delete set null (count_id),
  constraint pur_orders_supplier_fk foreign key (supplier_id, tenant_id)
    references public.pur_suppliers (id, tenant_id) on delete set null (supplier_id),
  constraint pur_orders_sent_shape check (status = 'draft' or status = 'discarded' or sent_at is not null)
);
create index pur_orders_tenant_status_idx on public.pur_orders (tenant_id, status, expected_date);
create index pur_orders_count_idx on public.pur_orders (count_id);

create table public.pur_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  item_id uuid,
  -- Lo que se pidió queda como se pidió aunque después cambie el insumo.
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  pack_label text check (pack_label is null or char_length(pack_label) <= 60),
  pack_size numeric(12, 3) check (pack_size is null or pack_size > 0), -- null = se pide en la unidad
  -- La cuenta del sistema, para que quien revisa vea de dónde sale el número (en la unidad del insumo).
  counted_qty numeric(12, 3),
  count_state text check (count_state is null or count_state in ('enough', 'low', 'none', 'exact')),
  target_qty numeric(12, 3),
  event_qty numeric(12, 3) not null default 0,
  event_names text[] not null default '{}',
  in_transit_qty numeric(12, 3) not null default 0,
  -- En presentaciones: 3 = tres «Caja x 150 u». ordered_packs null = a definir (sin objetivo).
  suggested_packs numeric(12, 3) check (suggested_packs is null or suggested_packs >= 0),
  ordered_packs numeric(12, 3) check (ordered_packs is null or ordered_packs >= 0), -- 0 = no se pide
  confirmed_packs numeric(12, 3) check (confirmed_packs is null or confirmed_packs >= 0), -- «viene»; null = lo pedido
  received_state text check (received_state is null or received_state in ('ok', 'partial', 'missing')),
  received_packs numeric(12, 3) check (received_packs is null or received_packs >= 0),
  added_by_hand boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pur_order_lines_order_fk foreign key (order_id, tenant_id)
    references public.pur_orders (id, tenant_id) on delete cascade,
  constraint pur_order_lines_item_fk foreign key (item_id, tenant_id)
    references public.pur_items (id, tenant_id) on delete set null (item_id)
);
create index pur_order_lines_order_idx on public.pur_order_lines (order_id, sort_order);
create index pur_order_lines_item_idx on public.pur_order_lines (tenant_id, item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at
-- ─────────────────────────────────────────────────────────────────────────────
create trigger pur_settings_updated_at before update on public.pur_settings
  for each row execute function public.set_updated_at();
create trigger pur_zones_updated_at before update on public.pur_zones
  for each row execute function public.set_updated_at();
create trigger pur_suppliers_updated_at before update on public.pur_suppliers
  for each row execute function public.set_updated_at();
create trigger pur_items_updated_at before update on public.pur_items
  for each row execute function public.set_updated_at();
create trigger pur_recipes_updated_at before update on public.pur_recipes
  for each row execute function public.set_updated_at();
create trigger pur_recipe_lines_updated_at before update on public.pur_recipe_lines
  for each row execute function public.set_updated_at();
create trigger pur_event_plans_updated_at before update on public.pur_event_plans
  for each row execute function public.set_updated_at();
create trigger pur_counts_updated_at before update on public.pur_counts
  for each row execute function public.set_updated_at();
create trigger pur_count_lines_updated_at before update on public.pur_count_lines
  for each row execute function public.set_updated_at();
create trigger pur_orders_updated_at before update on public.pur_orders
  for each row execute function public.set_updated_at();
create trigger pur_order_lines_updated_at before update on public.pur_order_lines
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo (ajustes, zonas, proveedores, insumos, recetas, planes): lo leen dueño, cocina y caja; lo edita el dueño.
alter table public.pur_settings enable row level security;
alter table public.pur_zones enable row level security;
alter table public.pur_suppliers enable row level security;
alter table public.pur_items enable row level security;
alter table public.pur_recipes enable row level security;
alter table public.pur_recipe_lines enable row level security;
alter table public.pur_event_plans enable row level security;
alter table public.pur_counts enable row level security;
alter table public.pur_count_lines enable row level security;
alter table public.pur_orders enable row level security;
alter table public.pur_order_lines enable row level security;

create policy pur_settings_read on public.pur_settings for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_settings_owner_write on public.pur_settings for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_zones_read on public.pur_zones for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_zones_owner_write on public.pur_zones for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_suppliers_read on public.pur_suppliers for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_suppliers_owner_write on public.pur_suppliers for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_items_read on public.pur_items for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_items_owner_write on public.pur_items for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_recipes_read on public.pur_recipes for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_recipes_owner_write on public.pur_recipes for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_recipe_lines_read on public.pur_recipe_lines for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_recipe_lines_owner_write on public.pur_recipe_lines for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_event_plans_read on public.pur_event_plans for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_event_plans_owner_write on public.pur_event_plans for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- Conteos: cuentan dueño, cocina y caja. Un conteo enviado ya no se toca (lo cierra pur_submit_count).
create policy pur_counts_read on public.pur_counts for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_counts_insert on public.pur_counts for insert to authenticated
  with check (status = 'open' and public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_counts_update_open on public.pur_counts for update to authenticated
  using (status = 'open' and public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'))
  with check (status in ('open', 'discarded') and public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));

create policy pur_count_lines_read on public.pur_count_lines for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_count_lines_write_open on public.pur_count_lines for all to authenticated
  using (
    public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier')
    and exists (select 1 from public.pur_counts c where c.id = count_id and c.status = 'open')
  )
  with check (
    public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier')
    and exists (select 1 from public.pur_counts c where c.id = count_id and c.status = 'open')
  );

-- Pedidos: los ven dueño, cocina y caja; los mueve el dueño. La cocina recibe por pur_receive_order.
create policy pur_orders_read on public.pur_orders for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_orders_owner_write on public.pur_orders for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

create policy pur_order_lines_read on public.pur_order_lines for select to authenticated
  using (public.user_role_in_tenant(tenant_id) in ('owner', 'kitchen', 'cashier'));
create policy pur_order_lines_owner_write on public.pur_order_lines for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

grant select, insert, update, delete on
  public.pur_settings, public.pur_zones, public.pur_suppliers, public.pur_items, public.pur_recipes,
  public.pur_recipe_lines, public.pur_event_plans, public.pur_counts, public.pur_count_lines,
  public.pur_orders, public.pur_order_lines
  to authenticated, service_role;
revoke all on
  public.pur_settings, public.pur_zones, public.pur_suppliers, public.pur_items, public.pur_recipes,
  public.pur_recipe_lines, public.pur_event_plans, public.pur_counts, public.pur_count_lines,
  public.pur_orders, public.pur_order_lines
  from anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: las fechas del calendario entre dos días, con cuántas personas reservaron.
-- La cocina no lee las reservas (tienen datos de clientes): solo recibe el total por fecha.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pur_events_between(p_tenant_id uuid, p_from date, p_to date)
returns table (
  scheduled_event_id uuid,
  event_date date,
  starts_at_local time,
  name text,
  template_id uuid,
  capacity integer,
  reserved_guests integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.user_role_in_tenant(p_tenant_id) is null
     or public.user_role_in_tenant(p_tenant_id)::text not in ('owner', 'kitchen', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_to < p_from or p_to > p_from + 62 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return query
  select
    se.id,
    se.event_date,
    se.starts_at_local,
    coalesce(nullif(btrim(se.name_override), ''), st.name, 'Evento')::text,
    se.template_id,
    se.capacity,
    coalesce((
      select sum(coalesce(r.actual_guests, r.estimated_guests, 0))::integer
      from public.salon_reservations r
      where r.scheduled_event_id = se.id
        and r.tenant_id = p_tenant_id
        and r.status::text not in ('cancelled', 'no_show')
    ), 0)
  from public.scheduled_events se
  left join public.scheduled_event_templates st on st.id = se.template_id
  where se.tenant_id = p_tenant_id
    and se.event_date between p_from and p_to
  order by se.event_date, se.starts_at_local nulls last;
end;
$$;
revoke all on function public.pur_events_between(uuid, date, date) from public, anon;
grant execute on function public.pur_events_between(uuid, date, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: cerrar un conteo y armar un pedido (borrador) por proveedor, todo junto.
-- La cuenta la hace el servidor (lib/purchasing/suggest.ts) y llega armada en p_orders:
--   [{ supplier_id, expected_date, lines: [{ item_id, name, unit, pack_label, pack_size, counted_qty,
--      count_state, target_qty, event_qty, event_names, in_transit_qty, suggested_packs, ordered_packs }] }]
--
-- Manda el conteo más nuevo, producto por producto: lo que este conteo contó (o pide por un evento) reemplaza
-- lo que había en los borradores que todavía no se mandaron; lo demás queda. Así un Refuerzo de cinco productos
-- no borra el pedido del lunes. Si ya hay un borrador del proveedor, se suma ahí; un borrador que queda vacío
-- se descarta.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pur_submit_count(p_count_id uuid, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.pur_counts%rowtype;
  v_order jsonb;
  v_supplier uuid;
  v_order_id uuid;
  v_base integer;
  v_created integer := 0;
  v_merged integer := 0;
  v_lines integer := 0;
  v_replaced integer := 0;
  v_emptied integer := 0;
  v_n integer;
begin
  select * into v_count from public.pur_counts where id = p_count_id for update;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if public.user_role_in_tenant(v_count.tenant_id) is null
     or public.user_role_in_tenant(v_count.tenant_id)::text not in ('owner', 'kitchen', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_count.status <> 'open' then
    raise exception 'count_not_open' using errcode = '55000';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) > 200 then
    raise exception 'invalid_orders' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_orders) o
    where jsonb_typeof(o -> 'lines') <> 'array'
       or jsonb_array_length(o -> 'lines') = 0
       or jsonb_array_length(o -> 'lines') > 500
  ) then
    raise exception 'invalid_order_lines' using errcode = '22023';
  end if;

  -- Lo que este conteo vuelve a decidir sale de los borradores de antes.
  delete from public.pur_order_lines ol
   using public.pur_orders o
   where o.id = ol.order_id
     and o.tenant_id = v_count.tenant_id
     and o.status = 'draft'
     and ol.item_id in (
       select cl.item_id from public.pur_count_lines cl where cl.count_id = v_count.id
       union
       select nullif(l ->> 'item_id', '')::uuid
         from jsonb_array_elements(p_orders) o2, jsonb_array_elements(o2 -> 'lines') l
        where nullif(l ->> 'item_id', '') is not null
     );
  get diagnostics v_replaced = row_count;

  for v_order in select * from jsonb_array_elements(p_orders)
  loop
    v_supplier := nullif(v_order ->> 'supplier_id', '')::uuid;
    v_order_id := null;

    select o.id into v_order_id
      from public.pur_orders o
     where o.tenant_id = v_count.tenant_id
       and o.status = 'draft'
       and o.supplier_id is not distinct from v_supplier
     order by o.created_at desc
     limit 1
     for update;

    if v_order_id is null then
      insert into public.pur_orders (tenant_id, count_id, supplier_id, status, expected_date, created_by)
      values (
        v_count.tenant_id, v_count.id, v_supplier, 'draft',
        nullif(v_order ->> 'expected_date', '')::date, (select auth.uid())
      )
      returning id into v_order_id;
      v_created := v_created + 1;
    else
      update public.pur_orders
         set count_id = v_count.id,
             expected_date = coalesce(nullif(v_order ->> 'expected_date', '')::date, expected_date)
       where id = v_order_id;
      v_merged := v_merged + 1;
    end if;

    select coalesce(max(sort_order), 0) into v_base from public.pur_order_lines where order_id = v_order_id;

    insert into public.pur_order_lines (
      tenant_id, order_id, item_id, name, unit, pack_label, pack_size, counted_qty, count_state, target_qty,
      event_qty, event_names, in_transit_qty, suggested_packs, ordered_packs, sort_order
    )
    select
      v_count.tenant_id, v_order_id, l.item_id, left(btrim(l.name), 80), left(btrim(l.unit), 20),
      left(l.pack_label, 60), l.pack_size, l.counted_qty, l.count_state, l.target_qty,
      coalesce(l.event_qty, 0), coalesce(l.event_names, '{}'), coalesce(l.in_transit_qty, 0),
      l.suggested_packs, l.ordered_packs, v_base + (row_number() over ())::integer
    from jsonb_to_recordset(v_order -> 'lines') as l(
      item_id uuid, name text, unit text, pack_label text, pack_size numeric, counted_qty numeric,
      count_state text, target_qty numeric, event_qty numeric, event_names text[], in_transit_qty numeric,
      suggested_packs numeric, ordered_packs numeric
    );
    get diagnostics v_n = row_count;
    v_lines := v_lines + v_n;
  end loop;

  -- Un borrador que se quedó sin productos (todo alcanzaba) ya no se manda.
  update public.pur_orders o
     set status = 'discarded', discard_reason = 'superseded', discarded_at = now(), discarded_by = (select auth.uid())
   where o.tenant_id = v_count.tenant_id
     and o.status = 'draft'
     and not exists (select 1 from public.pur_order_lines ol where ol.order_id = o.id);
  get diagnostics v_emptied = row_count;

  update public.pur_counts
     set status = 'sent', sent_at = now(), sent_by = (select auth.uid())
   where id = v_count.id;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (
    v_count.tenant_id, (select auth.uid()), 'purchasing.count_sent', 'pur_count', v_count.id,
    jsonb_build_object(
      'created', v_created, 'merged', v_merged, 'lines', v_lines, 'replaced', v_replaced,
      'emptied', v_emptied, 'kind', v_count.kind
    )
  );

  return jsonb_build_object(
    'created', v_created, 'merged', v_merged, 'lines', v_lines, 'replaced', v_replaced, 'emptied', v_emptied
  );
end;
$$;
revoke all on function public.pur_submit_count(uuid, jsonb) from public, anon;
grant execute on function public.pur_submit_count(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: la cocina recibe un pedido. p_lines = [{ id, state: ok | partial | missing, packs }].
-- Todo bien → completed. Algo distinto → with_differences, y le aparece a quien compra para reclamar.
-- No suma stock: el stock sale de los conteos.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pur_receive_order(p_order_id uuid, p_received_by_name text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pur_orders%rowtype;
  v_expected integer;
  v_given integer;
  v_diffs jsonb;
  v_status text;
begin
  select * into v_order from public.pur_orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if public.user_role_in_tenant(v_order.tenant_id) is null
     or public.user_role_in_tenant(v_order.tenant_id)::text not in ('owner', 'kitchen', 'cashier') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status not in ('sent', 'confirmed') then
    raise exception 'order_not_receivable' using errcode = '55000';
  end if;
  if p_received_by_name is null or char_length(btrim(p_received_by_name)) not between 1 and 60 then
    raise exception 'invalid_receiver' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines' using errcode = '22023';
  end if;

  -- Tienen que venir todas las líneas que esperan algo (las que el proveedor dijo que no tiene, no).
  select count(*) into v_expected
    from public.pur_order_lines ol
   where ol.order_id = v_order.id and coalesce(ol.confirmed_packs, ol.ordered_packs, 0) > 0;
  select count(distinct x.id) into v_given
    from jsonb_to_recordset(p_lines) as x(id uuid, state text, packs numeric)
    join public.pur_order_lines ol on ol.id = x.id and ol.order_id = v_order.id
   where coalesce(ol.confirmed_packs, ol.ordered_packs, 0) > 0
     and x.state in ('ok', 'partial', 'missing')
     and (x.state <> 'partial' or (x.packs is not null and x.packs >= 0));
  if v_given <> v_expected then
    raise exception 'lines_incomplete' using errcode = '22023';
  end if;

  update public.pur_order_lines ol
     set received_state = case
           when x.state = 'partial' and x.packs = coalesce(ol.confirmed_packs, ol.ordered_packs) then 'ok'
           when x.state = 'partial' and x.packs = 0 then 'missing'
           else x.state
         end,
         received_packs = case x.state
           when 'ok' then coalesce(ol.confirmed_packs, ol.ordered_packs)
           when 'missing' then 0
           else x.packs
         end
    from jsonb_to_recordset(p_lines) as x(id uuid, state text, packs numeric)
   where ol.id = x.id and ol.order_id = v_order.id
     and coalesce(ol.confirmed_packs, ol.ordered_packs, 0) > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', ol.name, 'unit', ol.unit, 'pack_label', ol.pack_label, 'pack_size', ol.pack_size,
           'expected_packs', coalesce(ol.confirmed_packs, ol.ordered_packs), 'received_packs', ol.received_packs
         ) order by ol.sort_order), '[]'::jsonb)
    into v_diffs
    from public.pur_order_lines ol
   where ol.order_id = v_order.id and ol.received_state in ('partial', 'missing');

  v_status := case when jsonb_array_length(v_diffs) > 0 then 'with_differences' else 'completed' end;

  update public.pur_orders
     set status = v_status,
         received_at = now(),
         received_by = (select auth.uid()),
         received_by_name = btrim(p_received_by_name),
         closed_at = case when v_status = 'completed' then now() else null end
   where id = v_order.id;

  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
  values (
    v_order.tenant_id, (select auth.uid()), 'purchasing.order_received', 'pur_order', v_order.id,
    jsonb_build_object('status', v_status, 'differences', jsonb_array_length(v_diffs))
  );

  return jsonb_build_object('status', v_status, 'differences', v_diffs);
end;
$$;
revoke all on function public.pur_receive_order(uuid, text, jsonb) from public, anon;
grant execute on function public.pur_receive_order(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
