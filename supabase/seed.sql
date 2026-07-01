-- Seed demo del tenant "Hub" (slug = hub).
-- Idempotente: limpia toda la data de negocio del tenant y reinserta un
-- escenario realista para exhibir el dashboard.
--
-- Apuntar al proyecto remoto:
--   psql "$DATABASE_URL" -f supabase/seed.sql
-- Local (CLI):
--   supabase db reset       (corre migraciones + este seed automáticamente)
--
-- Bootstrap: si el tenant + owner user no existen, los crea
-- (sólo en local; en remoto se asume que ya existen).

-- ─────────────────────────────────────────────────────────────────
-- BOOTSTRAP: tenant + owner user + membership (idempotente)
-- Pensado para `supabase db reset` local. Skip seguro si ya existen.
-- ─────────────────────────────────────────────────────────────────
do $bootstrap$
declare
  v_tenant_id constant uuid := '23cf2e05-ea4d-4004-adcf-6b2346b7d676';
  v_owner_id constant uuid := 'de880a89-b2d4-493f-a6b7-b54b2e187d9e';
  v_owner_email text := 'owner@hub.local';
  -- Password literal para el seed local: "hub2026" (cambialo en producción).
  v_owner_password text := 'hub2026';
  v_now timestamptz := now();
begin
  -- 1) Tenant 'hub'
  insert into public.tenants (id, slug, name)
  values (v_tenant_id, 'hub', 'HUB! Coffee & Bar')
  on conflict (id) do nothing;

  -- 2) Owner user en auth.users (solo en local — en remoto no se toca auth)
  --    Detectamos local por la presencia del schema GoTrue dev. Si los
  --    inserts fallan en producción por permisos, simplemente quedan no-op.
  begin
    insert into auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_user_meta_data, raw_app_meta_data,
      role, aud, created_at, updated_at
    )
    values (
      v_owner_id,
      '00000000-0000-0000-0000-000000000000',
      v_owner_email,
      crypt(v_owner_password, gen_salt('bf')),
      v_now,
      jsonb_build_object('full_name', 'Owner HUB'),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'authenticated', 'authenticated',
      v_now, v_now
    )
    on conflict (id) do nothing;

    -- Auth identity (necesaria para que el sign-in funcione).
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    )
    values (
      v_owner_id,
      v_owner_id,
      jsonb_build_object('sub', v_owner_id::text, 'email', v_owner_email,
        'email_verified', true, 'phone_verified', false),
      'email', v_now, v_now, v_now
    )
    on conflict (provider, provider_id) do nothing;
  exception when insufficient_privilege then
    -- Estamos en remote: el seed sólo manipula data de negocio.
    null;
  end;

  -- 3) Membership owner→tenant
  insert into public.memberships (user_id, tenant_id, role)
  values (v_owner_id, v_tenant_id, 'owner')
  on conflict (tenant_id, user_id) do nothing;

  -- 4) JWT custom claim active_tenant_id en app_metadata para que el
  --    middleware redirija al tenant correcto desde el primer login.
  begin
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('active_tenant_id', v_tenant_id::text)
    where id = v_owner_id;
  exception when insufficient_privilege then
    null;
  end;
end
$bootstrap$;

-- ─────────────────────────────────────────────────────────────────
-- SEED DEMO (data de negocio del tenant 'hub')
-- ─────────────────────────────────────────────────────────────────

do $seed$
declare
  v_tenant_id constant uuid := '23cf2e05-ea4d-4004-adcf-6b2346b7d676'; -- bar Hub
  v_owner_id constant uuid := 'de880a89-b2d4-493f-a6b7-b54b2e187d9e';   -- owner

  -- tags
  v_tag_vip uuid;
  v_tag_habitue uuid;
  v_tag_cumple uuid;
  v_tag_nuevo uuid;
  v_tag_inactivo uuid;

  -- capture link
  v_link_id uuid;

  -- categorías
  v_cat_cervezas uuid;
  v_cat_tragos uuid;
  v_cat_picadas uuid;
  v_cat_postres uuid;
  v_cat_bebidas uuid;

  -- items frecuentes (los uso para visits)
  v_item_quilmes uuid;
  v_item_aperol uuid;
  v_item_fernet uuid;
  v_item_gintonic uuid;
  v_item_picada2 uuid;
  v_item_empanadas uuid;
  v_item_papas uuid;
  v_item_tiramisu uuid;
  v_item_limonada uuid;
  v_item_cafe uuid;

  -- canal + plantillas
  v_channel_id uuid;
  v_tpl_bienvenida uuid;
  v_tpl_cumple uuid;
  v_tpl_recuperacion uuid;

  -- audiencias
  v_aud_vip uuid;
  v_aud_inactivos uuid;
  v_aud_cumple uuid;
  v_aud_activos uuid;

  -- broadcasts
  v_bc_promo uuid;
  v_bc_evento uuid;
  v_bc_inactivos uuid;

  -- flows
  v_flow_bienvenida uuid;
  v_flow_cumple uuid;

  -- helpers
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Argentina/Cordoba')::date;
  v_birth_month int := extract(month from v_today)::int;

  -- arrays para customers
  v_customer_ids uuid[] := array[]::uuid[];
  v_active_customer_ids uuid[] := array[]::uuid[];
  v_vip_customer_ids uuid[] := array[]::uuid[];

  v_event_id uuid;
  v_visit_id uuid;
  v_visit_total bigint;
  v_visit_pts int;

  i int;
  j int;
  v_cust uuid;
  v_visited_at timestamptz;
  v_qty int;
  v_unit bigint;
begin
  -- ───────────────────────────────────────────────────────────
  -- 0. LIMPIEZA del tenant (idempotencia)
  -- ───────────────────────────────────────────────────────────
  delete from public.job_queue where tenant_id = v_tenant_id;
  delete from public.flow_executions where tenant_id = v_tenant_id;
  delete from public.flow_steps where flow_id in (
    select id from public.flows where tenant_id = v_tenant_id
  );
  delete from public.flows where tenant_id = v_tenant_id;
  delete from public.broadcast_recipients where broadcast_id in (
    select id from public.broadcasts where tenant_id = v_tenant_id
  );
  delete from public.broadcasts where tenant_id = v_tenant_id;
  delete from public.audiences where tenant_id = v_tenant_id;
  delete from public.messages where tenant_id = v_tenant_id;
  delete from public.conversations where tenant_id = v_tenant_id;
  delete from public.message_templates where tenant_id = v_tenant_id;
  delete from public.channels where tenant_id = v_tenant_id;
  -- Loyalty / club: hijos primero (FK-safe): grants → benefits → partners,
  -- luego redemptions → rewards → tiers.
  delete from public.tier_benefit_grants where tenant_id = v_tenant_id;
  delete from public.tier_benefits where tenant_id = v_tenant_id;
  delete from public.partners where tenant_id = v_tenant_id;
  delete from public.reward_redemptions where tenant_id = v_tenant_id;
  delete from public.rewards where tenant_id = v_tenant_id;
  delete from public.loyalty_tiers where tenant_id = v_tenant_id;
  delete from public.points_transactions where tenant_id = v_tenant_id;
  delete from public.points_rules where tenant_id = v_tenant_id;
  delete from public.visit_items where visit_id in (
    select id from public.visits where tenant_id = v_tenant_id
  );
  delete from public.visits where tenant_id = v_tenant_id;
  delete from public.menu_items where tenant_id = v_tenant_id;
  delete from public.menu_categories where tenant_id = v_tenant_id;
  delete from public.customer_tag_assignments where customer_id in (
    select id from public.customers where tenant_id = v_tenant_id
  );
  delete from public.customer_capture_submissions where tenant_id = v_tenant_id;
  delete from public.customer_capture_links where tenant_id = v_tenant_id;
  delete from public.customer_tags where tenant_id = v_tenant_id;
  delete from public.customers where tenant_id = v_tenant_id;
  delete from public.audit_log where tenant_id = v_tenant_id;

  -- ───────────────────────────────────────────────────────────
  -- 1. CUSTOMER TAGS
  -- ───────────────────────────────────────────────────────────
  insert into public.customer_tags (tenant_id, name, color) values
    (v_tenant_id, 'VIP', '#f59e0b'),
    (v_tenant_id, 'Habitué', '#10b981'),
    (v_tenant_id, 'Cumpleañero', '#ec4899'),
    (v_tenant_id, 'Nuevo', '#3b82f6'),
    (v_tenant_id, 'Inactivo', '#94a3b8');

  select id into v_tag_vip from public.customer_tags where tenant_id = v_tenant_id and name = 'VIP';
  select id into v_tag_habitue from public.customer_tags where tenant_id = v_tenant_id and name = 'Habitué';
  select id into v_tag_cumple from public.customer_tags where tenant_id = v_tenant_id and name = 'Cumpleañero';
  select id into v_tag_nuevo from public.customer_tags where tenant_id = v_tenant_id and name = 'Nuevo';
  select id into v_tag_inactivo from public.customer_tags where tenant_id = v_tenant_id and name = 'Inactivo';

  -- ───────────────────────────────────────────────────────────
  -- 2. CAPTURE LINK
  -- ───────────────────────────────────────────────────────────
  insert into public.customer_capture_links (tenant_id, slug, label, active)
    values (v_tenant_id, 'mesa-hub', 'Mesa principal', true)
    returning id into v_link_id;

  -- ───────────────────────────────────────────────────────────
  -- 3. MENU
  -- ───────────────────────────────────────────────────────────
  insert into public.menu_categories (tenant_id, name, position) values
    (v_tenant_id, 'Cervezas', 1),
    (v_tenant_id, 'Tragos', 2),
    (v_tenant_id, 'Picadas y comida', 3),
    (v_tenant_id, 'Postres', 4),
    (v_tenant_id, 'Bebidas sin alcohol', 5);

  select id into v_cat_cervezas from public.menu_categories where tenant_id = v_tenant_id and name = 'Cervezas';
  select id into v_cat_tragos    from public.menu_categories where tenant_id = v_tenant_id and name = 'Tragos';
  select id into v_cat_picadas   from public.menu_categories where tenant_id = v_tenant_id and name = 'Picadas y comida';
  select id into v_cat_postres   from public.menu_categories where tenant_id = v_tenant_id and name = 'Postres';
  select id into v_cat_bebidas   from public.menu_categories where tenant_id = v_tenant_id and name = 'Bebidas sin alcohol';

  insert into public.menu_items (tenant_id, category_id, name, description, price_cents, position) values
    (v_tenant_id, v_cat_cervezas, 'Quilmes Pinta',           'Pinta tirada — 500cc',                    250000, 1),
    (v_tenant_id, v_cat_cervezas, 'Patagonia Amber Lager',   'Botella 730cc',                           320000, 2),
    (v_tenant_id, v_cat_cervezas, 'Stella IPA',              'IPA tirada — 500cc',                      380000, 3),
    (v_tenant_id, v_cat_cervezas, 'Heineken',                'Botella 330cc',                           300000, 4),
    (v_tenant_id, v_cat_cervezas, 'Andes Origen Roja',       'Roja artesanal — pinta',                  350000, 5),

    (v_tenant_id, v_cat_tragos,   'Aperol Spritz',           'Aperol, prosecco, soda, naranja',         450000, 1),
    (v_tenant_id, v_cat_tragos,   'Fernet con Coca',         'Branca + Coca, mucho hielo',              380000, 2),
    (v_tenant_id, v_cat_tragos,   'Caipirinha',              'Cachaça, lima, azúcar',                   470000, 3),
    (v_tenant_id, v_cat_tragos,   'Gin Tonic',               'Bombay Sapphire, tónica, pepino',         480000, 4),
    (v_tenant_id, v_cat_tragos,   'Old Fashioned',           'Bourbon, angostura, azúcar morena',       600000, 5),
    (v_tenant_id, v_cat_tragos,   'Margarita',               'Tequila, lima, triple sec, sal',          500000, 6),

    (v_tenant_id, v_cat_picadas,  'Tabla picada para 2',     'Quesos, fiambres, frutos secos',         1200000, 1),
    (v_tenant_id, v_cat_picadas,  'Tabla picada para 4',     'Versión XL para grupos',                 2200000, 2),
    (v_tenant_id, v_cat_picadas,  'Empanadas (3 unidades)',  'Carne suave, pollo o jamón y queso',      360000, 3),
    (v_tenant_id, v_cat_picadas,  'Bondiola al verdeo',      'Sandwich con cebolla de verdeo',          850000, 4),
    (v_tenant_id, v_cat_picadas,  'Bruschetta de tomate',    'Pan rústico, tomate, albahaca',           580000, 5),
    (v_tenant_id, v_cat_picadas,  'Papas Bravas',            'Con salsa picante y alioli',              520000, 6),
    (v_tenant_id, v_cat_picadas,  'Fugazzeta porción',       'Mozzarella y cebolla',                    480000, 7),

    (v_tenant_id, v_cat_postres,  'Tiramisú',                'Casero con cacao puro',                   380000, 1),
    (v_tenant_id, v_cat_postres,  'Cheesecake frutos rojos', 'Base de galleta, frutos del bosque',      420000, 2),
    (v_tenant_id, v_cat_postres,  'Helado artesanal',        '3 bochas a elección',                     320000, 3),

    (v_tenant_id, v_cat_bebidas,  'Limonada con jengibre',   'Recién exprimida con menta',              280000, 1),
    (v_tenant_id, v_cat_bebidas,  'Coca Cola',               'Vaso 500cc',                              200000, 2),
    (v_tenant_id, v_cat_bebidas,  'Agua mineral',            'Sin gas o con gas',                       150000, 3),
    (v_tenant_id, v_cat_bebidas,  'Café espresso',           'Doble carga',                             180000, 4),
    (v_tenant_id, v_cat_bebidas,  'Submarino',               'Chocolate caliente con barra',            350000, 5);

  select id into v_item_quilmes   from public.menu_items where tenant_id = v_tenant_id and name = 'Quilmes Pinta';
  select id into v_item_aperol    from public.menu_items where tenant_id = v_tenant_id and name = 'Aperol Spritz';
  select id into v_item_fernet    from public.menu_items where tenant_id = v_tenant_id and name = 'Fernet con Coca';
  select id into v_item_gintonic  from public.menu_items where tenant_id = v_tenant_id and name = 'Gin Tonic';
  select id into v_item_picada2   from public.menu_items where tenant_id = v_tenant_id and name = 'Tabla picada para 2';
  select id into v_item_empanadas from public.menu_items where tenant_id = v_tenant_id and name = 'Empanadas (3 unidades)';
  select id into v_item_papas     from public.menu_items where tenant_id = v_tenant_id and name = 'Papas Bravas';
  select id into v_item_tiramisu  from public.menu_items where tenant_id = v_tenant_id and name = 'Tiramisú';
  select id into v_item_limonada  from public.menu_items where tenant_id = v_tenant_id and name = 'Limonada con jengibre';
  select id into v_item_cafe      from public.menu_items where tenant_id = v_tenant_id and name = 'Café espresso';

  -- ───────────────────────────────────────────────────────────
  -- 4. POINTS RULE: 1 punto cada $1000 (= 100000 cents)
  -- ───────────────────────────────────────────────────────────
  insert into public.points_rules (tenant_id, type, config, priority, active) values
    (v_tenant_id, 'per_amount', jsonb_build_object('every_cents', 100000, 'points', 1), 100, true);

  -- ───────────────────────────────────────────────────────────
  -- 4b. LOYALTY TIERS (nivel por PUNTOS DE CATEGORÍA — suma móvil 4 meses).
  --     Se insertan ANTES de las visitas para que el trigger points_tx_apply
  --     resuelva current_tier_id correctamente al generar points_transactions.
  --     perks: null (los beneficios ricos viven en tier_benefits, sección 8).
  -- ───────────────────────────────────────────────────────────
  insert into public.loyalty_tiers
    (tenant_id, name, color, badge_icon, min_category_points, sort, perks, active) values
    (v_tenant_id, 'Classic',   '#6B7280', 'Coffee',       0, 1, null, true),
    (v_tenant_id, 'Select',    '#0EA5E9', 'Star',       200, 2, null, true),
    (v_tenant_id, 'Gold',      '#D4AF37', 'Crown',      500, 3, null, true),
    (v_tenant_id, 'Black',     '#1F2937', 'Gem',       1000, 4, null, true),
    (v_tenant_id, 'Signature', '#7C3AED', 'Sparkles',  2000, 5, null, true);

  -- ───────────────────────────────────────────────────────────
  -- 5. CUSTOMERS (40 — nombres rioplatenses, phones unicos)
  --    Orden:  1- 5  VIP (visitas frecuentes, gasto alto)
  --            6-15  Habitués
  --           16-20  Cumpleañeros del mes
  --           21-30  Activos sueltos
  --           31-35  Inactivos
  --           36-40  Nuevos sin visita
  -- ───────────────────────────────────────────────────────────
  with raw(idx, phone, first_name, last_name, birth, opt_in, source, created_offset_days) as (
    values
      ( 1, '+5493512001001', 'Lucía',     'Fernández',     '1990-03-12'::date, true,  'qr',     90),
      ( 2, '+5493512001002', 'Tomás',     'Pérez',         '1985-07-22'::date, true,  'qr',     85),
      ( 3, '+5493512001003', 'Camila',    'Gómez',         '1992-11-04'::date, true,  'manual', 80),
      ( 4, '+5493512001004', 'Mateo',     'Rodríguez',     '1988-01-15'::date, true,  'qr',     78),
      ( 5, '+5493512001005', 'Florencia', 'Suárez',        '1995-09-30'::date, true,  'qr',     75),

      ( 6, '+5493512002006', 'Bruno',     'Castro',        '1991-05-18'::date, true,  'qr',     72),
      ( 7, '+5493512002007', 'Valentina', 'Romero',        '1989-02-25'::date, true,  'manual', 70),
      ( 8, '+5493512002008', 'Joaquín',   'Martínez',      '1993-08-14'::date, false, 'qr',     68),
      ( 9, '+5493512002009', 'Martina',   'Álvarez',       '1996-04-08'::date, true,  'qr',     65),
      (10, '+5493512002010', 'Iván',      'Torres',        '1987-12-01'::date, true,  'qr',     60),
      (11, '+5493512002011', 'Renata',    'Ramírez',       '1994-06-19'::date, true,  'qr',     58),
      (12, '+5493512002012', 'Lautaro',   'Díaz',          '1990-10-03'::date, true,  'manual', 55),
      (13, '+5493512002013', 'Julieta',   'Benítez',       '1992-02-11'::date, true,  'qr',     50),
      (14, '+5493512002014', 'Franco',    'Ortega',        '1986-11-27'::date, true,  'qr',     48),
      (15, '+5493512002015', 'Agustina',  'Molina',        '1991-08-05'::date, true,  'qr',     45),

      -- 16-20 cumpleañeros del mes (mes = mes actual)
      (16, '+5493512003016', 'Sofía',     'Sosa',          null,                true,  'qr',     40),
      (17, '+5493512003017', 'Nicolás',   'Aguirre',       null,                true,  'manual', 38),
      (18, '+5493512003018', 'Bianca',    'Medina',        null,                true,  'qr',     35),
      (19, '+5493512003019', 'Federico',  'Pereyra',       null,                false, 'qr',     33),
      (20, '+5493512003020', 'Pilar',     'Vargas',        null,                true,  'qr',     30),

      -- 21-30 activos sueltos
      (21, '+5493512004021', 'Diego',     'Acosta',        '1988-04-22'::date, true,  'qr',     28),
      (22, '+5493512004022', 'Carolina',  'Silva',         '1993-09-15'::date, true,  'qr',     26),
      (23, '+5493512004023', 'Manuel',    'Ríos',          '1990-01-09'::date, false, 'qr',     24),
      (24, '+5493512004024', 'Antonella', 'Cabrera',       '1995-12-17'::date, true,  'qr',     22),
      (25, '+5493512004025', 'Felipe',    'Vega',          '1989-06-30'::date, true,  'manual', 20),
      (26, '+5493512004026', 'Micaela',   'Núñez',         '1992-07-12'::date, true,  'qr',     18),
      (27, '+5493512004027', 'Tobías',    'Herrera',       '1991-11-21'::date, true,  'qr',     16),
      (28, '+5493512004028', 'Catalina',  'Paredes',       '1987-02-28'::date, false, 'qr',     14),
      (29, '+5493512004029', 'Maximiliano','Méndez',       '1986-08-19'::date, true,  'qr',     12),
      (30, '+5493512004030', 'Delfina',   'Quiroga',       '1993-03-07'::date, true,  'qr',     10),

      -- 31-35 inactivos (visitaron hace mucho)
      (31, '+5493512005031', 'Esteban',   'Romero',        '1984-05-25'::date, true,  'qr',     85),
      (32, '+5493512005032', 'Aldana',    'Cabral',        '1990-09-09'::date, true,  'qr',     82),
      (33, '+5493512005033', 'Ramiro',    'Luna',          '1989-12-13'::date, false, 'manual', 80),
      (34, '+5493512005034', 'Belén',     'Salinas',       '1995-04-18'::date, true,  'qr',     78),
      (35, '+5493512005035', 'Matías',    'Cordero',       '1986-01-30'::date, true,  'qr',     75),

      -- 36-40 nuevos sin visita
      (36, '+5493512006036', 'Juana',     'Bravo',         '1997-10-12'::date, true,  'qr',      9),
      (37, '+5493512006037', 'Santino',   'Reyes',         '1996-07-04'::date, true,  'qr',      7),
      (38, '+5493512006038', 'Olivia',    'Cano',          '1998-02-14'::date, true,  'qr',      5),
      (39, '+5493512006039', 'Thiago',    'Ferro',         '1999-08-21'::date, true,  'qr',      3),
      (40, '+5493512006040', 'Emilia',    'Navarro',       '1996-11-06'::date, false, 'manual',  1)
  ),
  inserted as (
    insert into public.customers (
      tenant_id, phone, first_name, last_name, birthdate,
      opt_in_marketing, opt_in_at, opt_in_ip,
      source, created_at, updated_at
    )
    select
      v_tenant_id,
      raw.phone,
      raw.first_name,
      raw.last_name,
      case
        when raw.idx between 16 and 20 then
          -- cumpleañeros del mes: birthdate con día variable en el mes actual
          make_date(1990 + raw.idx - 16,
                    v_birth_month,
                    least(28, ((raw.idx - 16) * 5 + 3)))
        else raw.birth
      end,
      raw.opt_in,
      case when raw.opt_in then v_now - (raw.created_offset_days || ' days')::interval else null end,
      case when raw.opt_in then '127.0.0.1' else null end,
      raw.source::public.customer_source,
      v_now - (raw.created_offset_days || ' days')::interval,
      v_now - (raw.created_offset_days || ' days')::interval
    from raw
    order by raw.idx
    returning id, phone
  )
  -- recolectamos todos los ids ordenados por phone (que es ordenable y único)
  select array_agg(id order by phone) into v_customer_ids from inserted;

  -- ───────────────────────────────────────────────────────────
  -- 6. CUSTOMER TAG ASSIGNMENTS
  -- ───────────────────────────────────────────────────────────
  -- VIP: clientes 1-5
  for i in 1..5 loop
    insert into public.customer_tag_assignments (customer_id, tag_id)
      values (v_customer_ids[i], v_tag_vip);
  end loop;
  v_vip_customer_ids := v_customer_ids[1:5];

  -- Habitués: 6-15
  for i in 6..15 loop
    insert into public.customer_tag_assignments (customer_id, tag_id)
      values (v_customer_ids[i], v_tag_habitue);
  end loop;

  -- Cumpleañeros del mes: 16-20
  for i in 16..20 loop
    insert into public.customer_tag_assignments (customer_id, tag_id)
      values (v_customer_ids[i], v_tag_cumple);
  end loop;

  -- Inactivos: 31-35
  for i in 31..35 loop
    insert into public.customer_tag_assignments (customer_id, tag_id)
      values (v_customer_ids[i], v_tag_inactivo);
  end loop;

  -- Nuevos: 36-40
  for i in 36..40 loop
    insert into public.customer_tag_assignments (customer_id, tag_id)
      values (v_customer_ids[i], v_tag_nuevo);
  end loop;

  -- los activos para reservaciones / etc: 1-30
  v_active_customer_ids := v_customer_ids[1:30];

  -- ───────────────────────────────────────────────────────────
  -- 7. VISITS + VISIT_ITEMS + POINTS_TRANSACTIONS
  --    Generamos visitas por cliente con perfil:
  --      VIP (1-5): 10 visitas distribuidas en 60d
  --      Habitué (6-15): 5 visitas en 50d
  --      Activos (21-30): 2 visitas en 30d
  --      Inactivos (31-35): 1 visita ~ hace 60d
  -- ───────────────────────────────────────────────────────────
  for i in 1..5 loop
    v_cust := v_customer_ids[i];
    for j in 1..10 loop
      v_visited_at := v_now
        - ((60 - j * 6 + ((i * 7 + j * 3) % 5)) || ' days')::interval
        - ((((i * 11) + j * 17) % 240) || ' minutes')::interval
        - '20 hours'::interval;
      insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, created_by, source)
        values (v_tenant_id, v_cust, v_visited_at, 0, v_owner_id, 'cashier')
        returning id into v_visit_id;

      -- 4-5 ítems por visita VIP
      v_visit_total := 0;
      v_qty := 2; v_unit := 250000;  -- Quilmes
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_quilmes, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;

      v_qty := 1; v_unit := 1200000; -- picada para 2
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_picada2, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;

      v_qty := 2; v_unit := 450000; -- aperol
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_aperol, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;

      if (j % 2) = 0 then
        v_qty := 1; v_unit := 380000; -- tiramisu
        insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
          values (v_visit_id, v_item_tiramisu, v_qty, v_unit, v_qty * v_unit);
        v_visit_total := v_visit_total + v_qty * v_unit;
      end if;

      update public.visits set total_amount_cents = v_visit_total where id = v_visit_id;

      v_visit_pts := (v_visit_total / 5000)::int; -- regla per_amount
      if v_visit_pts > 0 then
        insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
          values (
            v_tenant_id, v_cust, v_visit_id, v_visit_pts, 'rule_engine',
            jsonb_build_array(jsonb_build_object(
              'rule_id', null,
              'source', 'per_amount',
              'description', format('Cada $50 gastados → 1 pts (×%s)', v_visit_pts),
              'points', v_visit_pts
            ))
          );
      end if;
    end loop;
  end loop;

  -- Habitués (6-15): 5 visitas
  for i in 6..15 loop
    v_cust := v_customer_ids[i];
    for j in 1..5 loop
      v_visited_at := v_now
        - ((50 - j * 9 + ((i * 5 + j * 7) % 4)) || ' days')::interval
        - ((((i * 13) + j * 19) % 300) || ' minutes')::interval
        - '21 hours'::interval;
      insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, created_by, source)
        values (v_tenant_id, v_cust, v_visited_at, 0, v_owner_id, 'cashier')
        returning id into v_visit_id;
      v_visit_total := 0;

      v_qty := 1 + (i % 2); v_unit := 380000; -- Fernet
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_fernet, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;

      v_qty := 1; v_unit := 360000; -- empanadas
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_empanadas, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;

      if (j % 3) <> 0 then
        v_qty := 1; v_unit := 520000; -- papas bravas
        insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
          values (v_visit_id, v_item_papas, v_qty, v_unit, v_qty * v_unit);
        v_visit_total := v_visit_total + v_qty * v_unit;
      end if;

      update public.visits set total_amount_cents = v_visit_total where id = v_visit_id;
      v_visit_pts := (v_visit_total / 5000)::int;
      if v_visit_pts > 0 then
        insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
          values (
            v_tenant_id, v_cust, v_visit_id, v_visit_pts, 'rule_engine',
            jsonb_build_array(jsonb_build_object(
              'rule_id', null, 'source', 'per_amount',
              'description', format('Cada $50 gastados → 1 pts (×%s)', v_visit_pts),
              'points', v_visit_pts
            ))
          );
      end if;
    end loop;
  end loop;

  -- Cumpleañeros (16-20): 3 visitas
  for i in 16..20 loop
    v_cust := v_customer_ids[i];
    for j in 1..3 loop
      v_visited_at := v_now - ((35 - j * 10) || ' days')::interval
        - (((i * 17 + j * 11) % 360) || ' minutes')::interval - '22 hours'::interval;
      insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, created_by, source)
        values (v_tenant_id, v_cust, v_visited_at, 0, v_owner_id, 'cashier')
        returning id into v_visit_id;
      v_visit_total := 0;
      v_qty := 1; v_unit := 480000; -- gin tonic
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_gintonic, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;
      v_qty := 1; v_unit := 280000; -- limonada
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_limonada, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;
      update public.visits set total_amount_cents = v_visit_total where id = v_visit_id;
      v_visit_pts := (v_visit_total / 5000)::int;
      if v_visit_pts > 0 then
        insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
          values (
            v_tenant_id, v_cust, v_visit_id, v_visit_pts, 'rule_engine',
            jsonb_build_array(jsonb_build_object(
              'source', 'per_amount',
              'description', format('Cada $50 gastados → 1 pts (×%s)', v_visit_pts),
              'points', v_visit_pts
            ))
          );
      end if;
    end loop;
  end loop;

  -- Activos (21-30): 2 visitas en 30d
  for i in 21..30 loop
    v_cust := v_customer_ids[i];
    for j in 1..2 loop
      v_visited_at := v_now - ((25 - j * 8) || ' days')::interval
        - (((i * 13 + j * 23) % 420) || ' minutes')::interval - '20 hours'::interval;
      insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, created_by, source)
        values (v_tenant_id, v_cust, v_visited_at, 0, v_owner_id, 'cashier')
        returning id into v_visit_id;
      v_visit_total := 0;
      v_qty := 1; v_unit := 250000;
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_quilmes, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;
      v_qty := 1; v_unit := 180000;
      insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
        values (v_visit_id, v_item_cafe, v_qty, v_unit, v_qty * v_unit);
      v_visit_total := v_visit_total + v_qty * v_unit;
      update public.visits set total_amount_cents = v_visit_total where id = v_visit_id;
      v_visit_pts := (v_visit_total / 5000)::int;
      if v_visit_pts > 0 then
        insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
          values (
            v_tenant_id, v_cust, v_visit_id, v_visit_pts, 'rule_engine',
            jsonb_build_array(jsonb_build_object(
              'source', 'per_amount',
              'description', format('Cada $50 gastados → 1 pts (×%s)', v_visit_pts),
              'points', v_visit_pts
            ))
          );
      end if;
    end loop;
  end loop;

  -- Inactivos (31-35): 1 visita hace ~70d
  for i in 31..35 loop
    v_cust := v_customer_ids[i];
    v_visited_at := v_now - ((70 + (i % 5) * 2) || ' days')::interval - '21 hours'::interval;
    insert into public.visits (tenant_id, customer_id, visited_at, total_amount_cents, created_by, source)
      values (v_tenant_id, v_cust, v_visited_at, 0, v_owner_id, 'cashier')
      returning id into v_visit_id;
    v_visit_total := 0;
    v_qty := 1; v_unit := 380000;
    insert into public.visit_items (visit_id, menu_item_id, quantity, unit_price_cents, line_total_cents)
      values (v_visit_id, v_item_fernet, v_qty, v_unit, v_qty * v_unit);
    v_visit_total := v_visit_total + v_qty * v_unit;
    update public.visits set total_amount_cents = v_visit_total where id = v_visit_id;
    v_visit_pts := (v_visit_total / 5000)::int;
    if v_visit_pts > 0 then
      insert into public.points_transactions (tenant_id, customer_id, visit_id, delta, reason, payload)
        values (
          v_tenant_id, v_cust, v_visit_id, v_visit_pts, 'rule_engine',
          jsonb_build_array(jsonb_build_object(
            'source', 'per_amount',
            'description', format('Cada $50 gastados → 1 pts (×%s)', v_visit_pts),
            'points', v_visit_pts
          ))
        );
    end if;
  end loop;

  -- ───────────────────────────────────────────────────────────
  -- 8. REWARDS (catálogo de canje) + PARTNERS + TIER_BENEFITS + REDEMPTIONS
  -- ───────────────────────────────────────────────────────────
  -- 8.a Catálogo de canje (visible_in_catalog = true) + recompensas "de
  --     beneficio" (visible_in_catalog = false, cost_points = 1) que sirven de
  --     target a los tier_benefits.recurring_reward. stock null = ilimitado.
  insert into public.rewards
    (tenant_id, name, description, cost_points, stock, active, category, visible_in_catalog) values
    -- Desayuno
    (v_tenant_id, 'Clásico en Córdoba',             'Medialunas, café y jugo natural',           50, null, true, 'desayuno', true),
    (v_tenant_id, 'Proteico con café',              'Huevos, tostadas integrales y café',       200, null, true, 'desayuno', true),
    (v_tenant_id, 'Tostado de jamón y queso',       'Tostado con café a elección',              150, null, true, 'desayuno', true),
    (v_tenant_id, 'Starhub',                        'Nuestro desayuno insignia',                 80, null, true, 'desayuno', true),
    (v_tenant_id, 'Croissant a elección con café',  'Croissant dulce o salado + café',          150, null, true, 'desayuno', true),
    -- Almuerzo
    (v_tenant_id, 'Menú ejecutivo (L-V)',           'Plato del día de lunes a viernes',         200, null, true, 'almuerzo', true),
    (v_tenant_id, 'Menú ejecutivo de fin de semana','Plato del día de sábados y domingos',      270, null, true, 'almuerzo', true),
    -- Cena
    (v_tenant_id, 'Burger doble a elección',        'Doble medallón con guarnición',            220, null, true, 'cena',     true),
    (v_tenant_id, 'Burger triple a elección',       'Triple medallón con guarnición',           250, null, true, 'cena',     true),
    (v_tenant_id, 'Lomito a elección',              'Lomito completo con papas',                250, null, true, 'cena',     true),
    (v_tenant_id, 'Línea Coca 1L',                  'Gaseosa línea Coca-Cola de 1 litro',       100, null, true, 'cena',     true),
    (v_tenant_id, 'Stella 1L',                      'Cerveza Stella Artois de 1 litro',         150, null, true, 'cena',     true),
    (v_tenant_id, 'Botella de Fernet con 2 cocas',  'Fernet Branca + 2 Coca-Cola',              600, null, true, 'cena',     true),
    (v_tenant_id, 'Botella Sernova y 4 speed',      'Vodka Sernova + 4 Speed',                  500, null, true, 'cena',     true),
    (v_tenant_id, 'Trago a elección',               'Cualquier trago de la carta',              150, null, true, 'cena',     true),
    (v_tenant_id, 'Tabla a elección',               'Picada para compartir',                    700, null, true, 'cena',     true),
    (v_tenant_id, 'Pizza a elección',               'Pizza entera de la carta',                 350, null, true, 'cena',     true),
    -- Evento
    (v_tenant_id, 'Noche Astral - 1 entrada',       'Entrada a la fiesta Noche Astral',         450, null, true, 'evento',   true),
    (v_tenant_id, 'Noche de Ramen - 1 entrada',     'Entrada a la Noche de Ramen',              350, null, true, 'evento',   true),
    (v_tenant_id, 'Sushi libre - 1 entrada',        'Entrada al Sushi libre',                   400, null, true, 'evento',   true),
    -- Recompensas "de beneficio" (target de tier_benefits, ocultas del catálogo)
    (v_tenant_id, 'Café del club',                  'Café del beneficio de nivel',                1, null, true, null,       false),
    (v_tenant_id, 'Burger del club',                'Burger del beneficio de nivel',              1, null, true, null,       false),
    (v_tenant_id, 'Desayuno para dos',              'Desayuno para dos del beneficio de nivel',   1, null, true, null,       false),
    (v_tenant_id, 'Entrada a evento del mes',       'Entrada de evento del beneficio de nivel',   1, null, true, null,       false);

  -- 8.b PARTNERS (marcas aliadas, borrador: active=false, discount_label a definir).
  insert into public.partners (tenant_id, name, category, active, sort) values
    (v_tenant_id, 'Guapa estética',     'Estética',    false,  1),
    (v_tenant_id, 'Flor luna estética', 'Estética',    false,  2),
    (v_tenant_id, 'Detorres estilista', 'Peluquería',  false,  3),
    (v_tenant_id, 'Lavadero amigo Maxi','Automotor',   false,  4),
    (v_tenant_id, 'Copentto',           'Gastronomía', false,  5),
    (v_tenant_id, 'Vinería',            'Vinos',       false,  6),
    (v_tenant_id, 'Dreambox',           'Comercio',    false,  7),
    (v_tenant_id, 'Clean',              'Servicios',   false,  8),
    (v_tenant_id, 'Manantiales',        'Servicios',   false,  9),
    (v_tenant_id, 'Silver joyas',       'Joyería',     false, 10),
    (v_tenant_id, 'Peluquería canina',  'Mascotas',    false, 11),
    (v_tenant_id, 'Sumaj Viajes',       'Turismo',     false, 12),
    (v_tenant_id, 'Vinería Tijuana',    'Vinos',       false, 13),
    (v_tenant_id, 'Cremolatti',         'Heladería',   false, 14),
    (v_tenant_id, 'Leroma',             'Gastronomía', false, 15),
    (v_tenant_id, 'Boliche y eventos',  'Eventos',     false, 16),
    (v_tenant_id, 'Gustazo sin gluten', 'Gastronomía', false, 17),
    (v_tenant_id, 'La Selecta',         'Gastronomía', false, 18);

  -- 8.c TIER_BENEFITS por nivel. tier_id / reward_id se resuelven por nombre
  --     dentro del tenant HUB (subqueries). Recurrentes → cadence 'monthly';
  --     discounts/perk → cadence 'none'. Classic sólo lleva un descuento.
  insert into public.tier_benefits
    (tenant_id, tier_id, kind, label, reward_id, cadence, quantity, discount_pct, discount_scope, sort, active)
  values
    -- Classic
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Classic'),
      'discount', '10% off en desayunos', null, 'none', 1, 10, 'Lunes a viernes', 0, true),

    -- Select
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Select'),
      'recurring_reward', '1 café gratis por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Café del club'),
      'monthly', 1, null, null, 0, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Select'),
      'discount', '10% off desayunos y almuerzos', null, 'none', 1, 10, 'Todos los días', 1, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Select'),
      'discount', '10% off delivery propio', null, 'none', 1, 10, 'Lunes a jueves', 2, true),

    -- Gold
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Gold'),
      'recurring_reward', '1 café gratis por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Café del club'),
      'monthly', 1, null, null, 0, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Gold'),
      'recurring_reward', '1 burger gratis por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Burger del club'),
      'monthly', 1, null, null, 1, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Gold'),
      'discount', '10% off desayunos y almuerzos', null, 'none', 1, 10, null, 2, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Gold'),
      'discount', '10% off delivery propio', null, 'none', 1, 10, 'Todos los días', 3, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Gold'),
      'discount', '10% off en eventos', null, 'none', 1, 10, null, 4, true),

    -- Black
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'recurring_reward', '1 desayuno para dos por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Desayuno para dos'),
      'monthly', 1, null, null, 0, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'recurring_reward', '1 burger gratis por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Burger del club'),
      'monthly', 1, null, null, 1, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'recurring_reward', '1 entrada a evento por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Entrada a evento del mes'),
      'monthly', 1, null, null, 2, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'discount', '10% off desayunos y almuerzos', null, 'none', 1, 10, null, 3, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'discount', '15% off delivery propio', null, 'none', 1, 15, null, 4, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Black'),
      'discount', '15% off en eventos', null, 'none', 1, 15, null, 5, true),

    -- Signature
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'recurring_reward', '1 desayuno para dos por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Desayuno para dos'),
      'monthly', 1, null, null, 0, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'recurring_reward', '2 entradas a eventos por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Entrada a evento del mes'),
      'monthly', 2, null, null, 1, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'recurring_reward', '1 burger gratis por mes',
      (select id from public.rewards where tenant_id = v_tenant_id and name = 'Burger del club'),
      'monthly', 1, null, null, 2, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'perk', 'Remera de HUB personalizada', null, 'none', 1, null, null, 3, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'discount', '10% off desayunos y almuerzos', null, 'none', 1, 10, null, 4, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'discount', '15% off delivery propio', null, 'none', 1, 15, null, 5, true),
    (v_tenant_id, (select id from public.loyalty_tiers where tenant_id = v_tenant_id and name = 'Signature'),
      'discount', '20% off en eventos', null, 'none', 1, 20, null, 6, true);

  -- 8.d 3 redenciones por VIPs distintos (descuenta del balance via trigger).
  --     Apuntan a recompensas del catálogo nuevo (visible_in_catalog = true).
  declare
    v_reward_a uuid;
    v_reward_b uuid;
    v_reward_id uuid;
  begin
    select id into v_reward_a from public.rewards where tenant_id = v_tenant_id and name = 'Clásico en Córdoba';
    select id into v_reward_b from public.rewards where tenant_id = v_tenant_id and name = 'Trago a elección';

    for i in 1..3 loop
      v_cust := v_customer_ids[i];
      v_reward_id := case when (i % 2) = 0 then v_reward_b else v_reward_a end;
      insert into public.reward_redemptions (
        tenant_id, customer_id, reward_id, points_spent, redeemed_by, redeemed_at, status
      )
      select
        v_tenant_id, v_cust, v_reward_id,
        (case when v_reward_id = v_reward_b then 150 else 50 end),
        v_owner_id,
        v_now - ((10 - i) || ' days')::interval,
        'delivered';

      insert into public.points_transactions (
        tenant_id, customer_id, redemption_id, delta, reason, payload
      )
      select
        v_tenant_id, v_cust, rr.id,
        - (case when v_reward_id = v_reward_b then 150 else 50 end),
        'reward_redeem',
        jsonb_build_object('reward_id', v_reward_id)
      from public.reward_redemptions rr
      where rr.tenant_id = v_tenant_id
        and rr.customer_id = v_cust
        and rr.reward_id = v_reward_id
      order by rr.redeemed_at desc
      limit 1;
    end loop;
  end;

  -- ───────────────────────────────────────────────────────────
  -- 9. (Eventos retirados) — los eventos viven ahora en el Calendario
  --    (scheduled_events), sembrados más arriba. La tabla `events` /
  --    `event_attendees` se eliminó del modelo.
  -- ───────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────
  -- 10. CHANNEL (WhatsApp connected mock) + TEMPLATES
  -- ───────────────────────────────────────────────────────────
  insert into public.channels (
    tenant_id, type, status, external_account_id, external_phone_number_id,
    display_name, encrypted_access_token, connected_at
  ) values (
    v_tenant_id, 'whatsapp', 'connected',
    'demo_waba_account_001', 'demo_phone_number_001',
    'HUB Bar', 'demo_token_placeholder', v_now - '20 days'::interval
  ) returning id into v_channel_id;

  insert into public.message_templates (tenant_id, channel_id, meta_template_id, name, language, category, components, status, last_synced_at) values
    (v_tenant_id, v_channel_id, 'tpl_001', 'bienvenida_hub', 'es_AR', 'MARKETING',
      jsonb_build_array(jsonb_build_object(
        'type', 'BODY',
        'text', 'Hola {{1}}! Gracias por sumarte a HUB. Tenés un trago de cortesía esperándote en tu próxima visita.'
      )),
      'approved', v_now - '15 days'::interval),
    (v_tenant_id, v_channel_id, 'tpl_002', 'cumple_hub', 'es_AR', 'MARKETING',
      jsonb_build_array(jsonb_build_object(
        'type', 'BODY',
        'text', 'Feliz cumple {{1}}! Todo el mes te esperamos con un beneficio especial en HUB 🎉'
      )),
      'approved', v_now - '15 days'::interval),
    (v_tenant_id, v_channel_id, 'tpl_003', 'volve_hub', 'es_AR', 'MARKETING',
      jsonb_build_array(jsonb_build_object(
        'type', 'BODY',
        'text', 'Hola {{1}}, hace rato no te vemos. Pasate esta semana y te invitamos algo rico.'
      )),
      'approved', v_now - '12 days'::interval);

  select id into v_tpl_bienvenida   from public.message_templates where tenant_id = v_tenant_id and name = 'bienvenida_hub';
  select id into v_tpl_cumple       from public.message_templates where tenant_id = v_tenant_id and name = 'cumple_hub';
  select id into v_tpl_recuperacion from public.message_templates where tenant_id = v_tenant_id and name = 'volve_hub';

  -- Conversaciones + mensajes inbound/outbound de demo (8 conversaciones)
  declare
    v_conv_id uuid;
  begin
    for i in 1..8 loop
      v_cust := v_customer_ids[i];
      insert into public.conversations (
        tenant_id, channel_id, customer_id, external_user_id,
        last_message_at, unread_count
      ) values (
        v_tenant_id, v_channel_id, v_cust,
        'wa:' || replace((select phone from public.customers where id = v_cust), '+', ''),
        v_now - ((i * 4) || ' hours')::interval,
        case when i <= 3 then 1 else 0 end
      ) returning id into v_conv_id;

      -- mensaje inbound del cliente
      insert into public.messages (tenant_id, conversation_id, direction, content, status, sent_at)
        values (
          v_tenant_id, v_conv_id, 'inbound',
          case (i % 4)
            when 0 then 'Hola, ¿abrieron el local hoy?'
            when 1 then 'Quería saber si tienen mesa para 4 esta noche'
            when 2 then 'Excelente atención la última vez 👏'
            else 'Vienen a tocar este finde?'
          end,
          'delivered', v_now - ((i * 4) || ' hours')::interval - '5 minutes'::interval
        );

      -- respuesta outbound del bar
      if i >= 4 then
        insert into public.messages (tenant_id, conversation_id, direction, content, status, sent_at, delivered_at, read_at)
          values (
            v_tenant_id, v_conv_id, 'outbound',
            'Sí! Te esperamos a partir de las 19. Cualquier duda, escribinos por acá.',
            'read',
            v_now - ((i * 4) || ' hours')::interval - '2 minutes'::interval,
            v_now - ((i * 4) || ' hours')::interval - '1 minutes'::interval,
            v_now - ((i * 4) || ' hours')::interval
          );
      end if;
    end loop;
  end;

  -- ───────────────────────────────────────────────────────────
  -- 11. AUDIENCES
  -- ───────────────────────────────────────────────────────────
  insert into public.audiences (tenant_id, name, filters, customer_count_cached, last_calculated_at) values
    (v_tenant_id, 'Clientes VIP',
      jsonb_build_object(
        'kind', 'group', 'op', 'AND',
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'cond', 'field', 'tag', 'op', 'in', 'value', jsonb_build_array(v_tag_vip::text))
        )),
      5, v_now - '2 hours'::interval),
    (v_tenant_id, 'Inactivos 60+ días',
      jsonb_build_object(
        'kind', 'group', 'op', 'AND',
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'cond', 'field', 'days_since_last_visit', 'op', 'gte', 'value', 60),
          jsonb_build_object('kind', 'cond', 'field', 'opt_in_marketing', 'op', 'eq', 'value', true)
        )),
      5, v_now - '2 hours'::interval),
    (v_tenant_id, 'Cumpleañeros del mes',
      jsonb_build_object(
        'kind', 'group', 'op', 'AND',
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'cond', 'field', 'birth_month', 'op', 'eq', 'value', v_birth_month)
        )),
      5, v_now - '1 hours'::interval),
    (v_tenant_id, 'Activos últimos 30 días',
      jsonb_build_object(
        'kind', 'group', 'op', 'AND',
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'cond', 'field', 'days_since_last_visit', 'op', 'lte', 'value', 30)
        )),
      25, v_now - '3 hours'::interval);

  select id into v_aud_vip       from public.audiences where tenant_id = v_tenant_id and name = 'Clientes VIP';
  select id into v_aud_inactivos from public.audiences where tenant_id = v_tenant_id and name = 'Inactivos 60+ días';
  select id into v_aud_cumple    from public.audiences where tenant_id = v_tenant_id and name = 'Cumpleañeros del mes';
  select id into v_aud_activos   from public.audiences where tenant_id = v_tenant_id and name = 'Activos últimos 30 días';

  -- ───────────────────────────────────────────────────────────
  -- 12. BROADCASTS (1 sent, 1 scheduled, 1 draft)
  -- ───────────────────────────────────────────────────────────
  insert into public.broadcasts (
    tenant_id, name, channel_id, template_id, audience_id,
    scheduled_at, status, stats, started_at, completed_at, created_by
  ) values
    (v_tenant_id, 'Promo cumpleañeros — mayo',
      v_channel_id, v_tpl_cumple, v_aud_cumple,
      v_now - '5 days'::interval, 'sent',
      jsonb_build_object('total', 5, 'sent', 5, 'delivered', 5, 'read', 4, 'failed', 0),
      v_now - '5 days'::interval, v_now - '5 days'::interval + '6 minutes'::interval,
      v_owner_id),

    (v_tenant_id, 'Promo Karaoke Night',
      v_channel_id, v_tpl_bienvenida, v_aud_activos,
      v_now + '1 days'::interval + '15 hours'::interval, 'scheduled',
      '{}'::jsonb, null, null, v_owner_id),

    (v_tenant_id, 'Reactivación inactivos',
      v_channel_id, v_tpl_recuperacion, v_aud_inactivos,
      null, 'draft', '{}'::jsonb, null, null, v_owner_id);

  select id into v_bc_promo     from public.broadcasts where tenant_id = v_tenant_id and name = 'Promo cumpleañeros — mayo';
  select id into v_bc_evento    from public.broadcasts where tenant_id = v_tenant_id and name = 'Promo Karaoke Night';
  select id into v_bc_inactivos from public.broadcasts where tenant_id = v_tenant_id and name = 'Reactivación inactivos';

  -- recipients del broadcast 'sent' (5 cumpleañeros)
  for i in 16..20 loop
    insert into public.broadcast_recipients (
      broadcast_id, customer_id, status, queued_at, sent_at
    ) values (
      v_bc_promo, v_customer_ids[i],
      case when i = 19 then 'sent'::public.recipient_status else 'read'::public.recipient_status end,
      v_now - '5 days'::interval - '1 minutes'::interval,
      v_now - '5 days'::interval
    );
  end loop;

  -- recipients del broadcast 'scheduled' (25 activos: 1-30 sin nuevos)
  for i in 1..25 loop
    insert into public.broadcast_recipients (broadcast_id, customer_id, status)
      values (v_bc_evento, v_customer_ids[i], 'pending');
  end loop;

  -- ───────────────────────────────────────────────────────────
  -- 13. FLOWS (insertados al final con active=true para que su trigger
  --     no afecte a inserts previos)
  -- ───────────────────────────────────────────────────────────
  insert into public.flows (tenant_id, name, trigger_type, trigger_config, active)
    values (v_tenant_id, 'Bienvenida primer visita', 'after_visit',
            jsonb_build_object('only_first_visit', true), true)
    returning id into v_flow_bienvenida;

  insert into public.flow_steps (flow_id, position, type, config) values
    (v_flow_bienvenida, 0, 'wait',
      jsonb_build_object('hours', 2)),
    (v_flow_bienvenida, 1, 'send_template',
      jsonb_build_object('template_id', v_tpl_bienvenida::text, 'channel_id', v_channel_id::text)),
    (v_flow_bienvenida, 2, 'add_tag',
      jsonb_build_object('tag_id', v_tag_habitue::text));

  insert into public.flows (tenant_id, name, trigger_type, trigger_config, active)
    values (v_tenant_id, 'Saludo de cumpleaños', 'birthday',
            jsonb_build_object('hour_local', 10), true)
    returning id into v_flow_cumple;

  insert into public.flow_steps (flow_id, position, type, config) values
    (v_flow_cumple, 0, 'send_template',
      jsonb_build_object('template_id', v_tpl_cumple::text, 'channel_id', v_channel_id::text));

  -- limpiamos jobs encolados por triggers durante el seed (ruido para el cron)
  delete from public.job_queue where tenant_id = v_tenant_id and kind = 'start_flow';

  -- ───────────────────────────────────────────────────────────
  -- 14. REFRESH MATERIALIZED VIEWS
  -- ───────────────────────────────────────────────────────────
  perform public.refresh_stats();
end
$seed$;
