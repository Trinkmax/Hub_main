-- ============================================================
-- Carta category image + capture_prompt
-- ============================================================
-- 1) menu_categories.image_url (foto alusiva de la categoría).
-- 2) get_session_state: agrega image_url por categoría y un objeto
--    capture_prompt (enabled/headline/subtext) leído de tenants.settings,
--    servido al comensal anon vía SECURITY DEFINER.

alter table public.menu_categories
  add column if not exists image_url text
  check (image_url is null or char_length(image_url) <= 2048);

-- menu_categories ya tiene RLS + GRANTs (authenticated). Columna nueva: sin cambios de permisos.

create or replace function public.get_session_state(
  p_qr_token text,
  p_browser_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_tenant_name text;
  v_tenant_logo_url text;
  v_tenant_settings jsonb;        -- NUEVO
  v_capture_prompt jsonb;         -- NUEVO
  v_guest_id uuid;
  v_customer_id uuid;
  v_guest_count int := 0;
  v_menu jsonb;
  v_my_tickets jsonb;
  v_welcome_reward jsonb;
  v_welcome_reward_redeemed jsonb;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is not null
     and (length(p_browser_token) < 16 or length(p_browser_token) > 64) then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- NUEVO: leemos settings junto con name/logo.
  select name, logo_url, settings
    into v_tenant_name, v_tenant_logo_url, v_tenant_settings
    from public.tenants where id = v_table.tenant_id;

  -- NUEVO: capture_prompt con defaults si la key no existe.
  v_capture_prompt := jsonb_build_object(
    'enabled', coalesce((v_tenant_settings->'capture_prompt'->>'enabled')::boolean, true),
    'headline', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'headline', ''),
      'Sumá puntos en cada visita'),
    'subtext', coalesce(
      nullif(v_tenant_settings->'capture_prompt'->>'subtext', ''),
      'Dejá tu nombre y teléfono y empezá a ganar beneficios.')
  );

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
  where wrc.tenant_id = v_table.tenant_id
    and wrc.enabled = true
    and r.id is not null
    and (r.stock is null or r.stock > 0);

  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open';

  if v_session.id is null then
    return jsonb_build_object(
      'is_activated', false,
      'tenant_id', v_table.tenant_id,
      'tenant_name', v_tenant_name,
      'tenant_logo_url', v_tenant_logo_url,
      'physical_table_id', v_table.id,
      'table_label', v_table.label,
      'welcome_reward', v_welcome_reward
    );
  end if;

  if p_browser_token is not null then
    select id, customer_id into v_guest_id, v_customer_id
      from public.session_guests
      where session_id = v_session.id and browser_token = p_browser_token;
    if v_guest_id is not null then
      update public.session_guests
        set last_activity_at = now()
        where id = v_guest_id;
    end if;
  end if;

  select count(*) into v_guest_count
    from public.session_guests where session_id = v_session.id;

  -- Carta agrupada por categoría. NUEVO: image_url por categoría.
  select coalesce(jsonb_agg(category order by category->>'position'), '[]'::jsonb) into v_menu
  from (
    select jsonb_build_object(
      'id', mc.id,
      'name', mc.name,
      'position', mc.position,
      'image_url', mc.image_url,            -- NUEVO
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
      on mi.category_id = mc.id and mi.tenant_id = v_table.tenant_id
    where mc.tenant_id = v_table.tenant_id and mc.active = true
    group by mc.id
  ) cats;

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
      where t.session_id = v_session.id
        and t.created_by_guest_id = v_guest_id
      group by t.id
    ) tk;
  else
    v_my_tickets := '[]'::jsonb;
  end if;

  if v_customer_id is not null then
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
    v_welcome_reward := null;
  end if;

  return jsonb_build_object(
    'is_activated', true,
    'session_id', v_session.id,
    'tenant_id', v_table.tenant_id,
    'tenant_name', v_tenant_name,
    'tenant_logo_url', v_tenant_logo_url,
    'physical_table_id', v_table.id,
    'table_label', v_table.label,
    'party_size', v_session.party_size,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'guest_count', v_guest_count,
    'was_new_session', false,
    'menu', v_menu,
    'my_tickets', v_my_tickets,
    'welcome_reward', v_welcome_reward,
    'welcome_reward_redeemed', v_welcome_reward_redeemed,
    'capture_prompt', v_capture_prompt   -- NUEVO
  );
end $$;
