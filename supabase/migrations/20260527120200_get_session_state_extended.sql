-- ============================================================
-- Migración: get_session_state extendido
-- ============================================================
-- Recrea el RPC anon get_session_state agregando datos para el rediseño
-- de /m/[qrToken]:
--   - Por item del menú: featured, points_override, tags[]
--   - A nivel root: tenant_logo_url
--   - A nivel root: welcome_reward (cuando no hay customer registrado y
--     hay una config enabled con un reward activo y con stock)
--   - A nivel root: welcome_reward_redeemed (cuando ya hay customer y
--     existe un welcome_reward_grants para ese customer)
--
-- Compatibilidad: los campos nuevos son aditivos. Consumers existentes
-- pueden ignorarlos. Mantiene tipos/firma idénticos al RPC actual de
-- 20260506110200_plan2_ticket_rpcs_anon.sql.

create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_tenant_id uuid;
  v_physical_table_id uuid;
  v_was_new boolean;
  v_table_label text;
  v_tenant_name text;
  v_tenant_logo_url text;
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int;
  v_menu jsonb;
  v_my_tickets jsonb;
  v_welcome_reward jsonb;
  v_welcome_reward_redeemed jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  -- 1. Resolver / abrir sesión
  select s.session_id, s.tenant_id, s.physical_table_id, s.was_new
    into v_session_id, v_tenant_id, v_physical_table_id, v_was_new
    from public.get_or_open_session(p_qr_token) s;

  -- 2. Info pública de mesa y tenant (incluye logo_url nuevo)
  select label into v_table_label
    from public.physical_tables where id = v_physical_table_id;
  select name, logo_url into v_tenant_name, v_tenant_logo_url
    from public.tenants where id = v_tenant_id;

  -- 3. Si el caller tiene browser_token, buscar su guest
  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session_id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  -- 4. Conteo de guests
  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session_id;

  -- 5. Carta agrupada por categoría
  --    Por item agrega: featured, points_override, tags[]
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', mi.id,
        'name', mi.name,
        'description', mi.description,
        'price_cents', mi.price_cents,
        'image_url', mi.image_url,
        'position', mi.position,
        'featured', mi.featured,
        'points_override', mi.points_override,
        'tags', coalesce(
          (
            select jsonb_agg(jsonb_build_object(
              'id', it.id,
              'name', it.name,
              'color', it.color
            ) order by it.name)
            from public.menu_item_tag_assignments mita
            join public.item_tags it on it.id = mita.tag_id
            where mita.menu_item_id = mi.id
          ),
          '[]'::jsonb
        )
      ) order by mi.position) filter (where mi.id is not null and mi.active), '[]'::jsonb)
    ) as category
    from public.menu_categories mc
    left join public.menu_items mi
      on mi.category_id = mc.id and mi.tenant_id = v_tenant_id
    where mc.tenant_id = v_tenant_id and mc.active = true
    group by mc.id
  ) cats;

  -- 6. Tickets propios del guest (si existe)
  if v_guest_id is not null then
    select coalesce(jsonb_agg(ticket order by ticket->>'submitted_at' desc), '[]'::jsonb)
    into v_my_tickets
    from (
      select jsonb_build_object(
        'id', t.id,
        'status', t.status,
        'submitted_at', t.submitted_at,
        'total_cents', t.total_cents,
        'cancellation_reason', t.cancellation_reason,
        'items', coalesce(jsonb_agg(jsonb_build_object(
          'id', ti.id,
          'menu_item_name', mi.name,
          'quantity', ti.quantity,
          'unit_price_cents', ti.unit_price_cents,
          'line_total_cents', ti.line_total_cents,
          'notes', ti.notes,
          'cancelled_at', ti.cancelled_at
        )), '[]'::jsonb)
      ) as ticket
      from public.tickets t
      left join public.ticket_items ti on ti.ticket_id = t.id
      left join public.menu_items mi on mi.id = ti.menu_item_id
      where t.session_id = v_session_id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  -- 7. Welcome reward — solo si no hay customer registrado
  --    Requiere config enabled + reward activo + stock disponible.
  if v_customer_id is null then
    select jsonb_build_object(
      'enabled', wrc.enabled,
      'reward_id', r.id,
      'name', r.name,
      'description', r.description,
      'image_url', r.image_url,
      'headline', wrc.headline,
      'subtext', wrc.subtext
    )
    into v_welcome_reward
    from public.welcome_reward_configs wrc
    left join public.rewards r
      on r.id = wrc.reward_id
      and r.tenant_id = wrc.tenant_id
      and r.active = true
    where wrc.tenant_id = v_tenant_id
      and wrc.enabled = true
      and r.id is not null
      and (r.stock is null or r.stock > 0);
    -- Si no hay config válida, v_welcome_reward queda null.
  else
    -- 8. Welcome reward redeemed — si ya hay customer y tiene un grant
    select jsonb_build_object(
      'reward_id', r.id,
      'name', r.name,
      'image_url', r.image_url,
      'redemption_id', wrg.redemption_id,
      'granted_at', wrg.granted_at,
      'status', rr.status
    )
    into v_welcome_reward_redeemed
    from public.welcome_reward_grants wrg
    join public.rewards r on r.id = wrg.reward_id
    join public.reward_redemptions rr on rr.id = wrg.redemption_id
    where wrg.customer_id = v_customer_id;
    -- Si el customer no tiene grant, v_welcome_reward_redeemed queda null.
  end if;

  return jsonb_build_object(
    'session_id', v_session_id,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'tenant_logo_url', v_tenant_logo_url,
    'physical_table_id', v_physical_table_id,
    'table_label', v_table_label,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', v_was_new,
    'menu', v_menu,
    'my_tickets', v_my_tickets,
    'welcome_reward', v_welcome_reward,
    'welcome_reward_redeemed', v_welcome_reward_redeemed
  );
end $$;

revoke all on function public.get_session_state(text, text) from public;
grant execute on function public.get_session_state(text, text) to anon, authenticated;
