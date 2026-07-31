-- ============================================================
-- FIX de seguridad: add_punch_stamp permitía sellar cross-tenant
-- ============================================================
-- Corrige 20260731194221_punch_cards_revival.
--
-- La versión original salteaba el chequeo de rol cuando `p_source = 'session'`,
-- para que el trigger del cobro de mesa pudiera sellar sin usuario logueado.
-- Pero `p_source` lo elige QUIEN LLAMA, y la función tiene grant a
-- `authenticated`: cualquier usuario logueado de cualquier bar podía invocar
-- `add_punch_stamp(<customer ajeno>, <template ajeno>, 1, 'session')` y sellar
-- tarjetas de clientes de OTRO tenant. Escalada de privilegios cross-tenant, o
-- sea violación directa de la LEY multi-tenant (CLAUDE.md §4).
--
-- Corrección: el criterio deja de ser el parámetro y pasa a ser si hay usuario.
-- Con `auth.uid()` no nulo — todo el tráfico que entra como `authenticated` — el
-- rol se exige siempre. Sin usuario sólo puede ser un contexto de confianza
-- (el trigger interno o service_role), porque `anon` no tiene grant sobre esta
-- función. `p_source` queda como metadato de la bitácora, sin poder de decisión.
-- ============================================================
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
    'redemption_id', v_redemption_id,
    'stamps_added', v_qty
  );
end $$;

revoke execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) from public, anon;
grant execute on function public.add_punch_stamp(uuid, uuid, int, text, uuid) to authenticated;
