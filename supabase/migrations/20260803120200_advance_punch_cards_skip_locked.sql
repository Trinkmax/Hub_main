-- ============================================================
-- El cobro de mesa saltea las tarjetas de otra categoría
-- ============================================================
-- Cierra un agujero que abría 20260803120000.
--
-- `_advance_punch_cards_for_visit` corre DENTRO de `mark_session_paid`: recorre
-- TODAS las punch cards activas del bar y sella las que matchean el consumo. Con
-- el portero nuevo (`trg_customer_punch_cards_tier_guard`), si el socio consumía
-- algo que dispara una tarjeta exclusiva de una categoría que él no tiene, el
-- trigger levantaba `punch_tier_locked` y **abortaba el cobro entero**. O sea:
-- una tarjeta mal configurada dejaba al bar sin poder cerrar la mesa.
--
-- El portero está bien donde está — es la última línea contra un sellado
-- ilegítimo. Lo que estaba mal era que este camino lo intentara: no sellar una
-- tarjeta que no corresponde no es un error, es el comportamiento correcto. Se
-- filtra en el `for`, así el trigger ni se entera.
--
-- Idéntico al original salvo esa condición en el select del loop.
-- ============================================================
create or replace function public._advance_punch_cards_for_visit(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_visit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb := '[]'::jsonb;
  v_template public.punch_card_templates;
  v_qty_matched int;
  v_card public.customer_punch_cards;
  v_new_stamps int;
  v_redemption_id uuid;
  v_reward public.rewards;
begin
  for v_template in
    select * from public.punch_card_templates
      where tenant_id = p_tenant_id
        and active = true
        -- Exclusiva de otra categoría → no es de este socio. Se saltea en
        -- silencio: el cobro no puede caerse por esto.
        and public.punch_template_allows_customer(id, p_customer_id)
  loop
    if v_template.trigger_type = 'item' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        where vi.visit_id = p_visit_id
          and vi.menu_item_id = v_template.trigger_ref_id;
    elsif v_template.trigger_type = 'category' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        join public.menu_items mi on mi.id = vi.menu_item_id
        where vi.visit_id = p_visit_id
          and mi.category_id = v_template.trigger_ref_id;
    elsif v_template.trigger_type = 'tag' then
      select coalesce(sum(vi.quantity), 0) into v_qty_matched
        from public.visit_items vi
        join public.menu_item_tag_assignments mita on mita.menu_item_id = vi.menu_item_id
        where vi.visit_id = p_visit_id
          and mita.tag_id = v_template.trigger_ref_id;
    else
      v_qty_matched := 0;
    end if;
    if v_qty_matched <= 0 then
      continue;
    end if;
    select * into v_card
      from public.customer_punch_cards
      where customer_id = p_customer_id
        and template_id = v_template.id
        and completed_at is null
        and expired_at is null
      for update;
    if v_card.id is null then
      v_new_stamps := least(v_qty_matched, v_template.threshold);
      insert into public.customer_punch_cards (
        tenant_id, customer_id, template_id, current_stamps, threshold_snapshot
      ) values (
        p_tenant_id, p_customer_id, v_template.id, v_new_stamps, v_template.threshold
      ) returning * into v_card;
    else
      v_new_stamps := least(v_card.current_stamps + v_qty_matched, v_card.threshold_snapshot);
      update public.customer_punch_cards
        set current_stamps = v_new_stamps,
            updated_at = now()
        where id = v_card.id
        returning * into v_card;
    end if;
    if v_card.current_stamps >= v_card.threshold_snapshot then
      select * into v_reward from public.rewards where id = v_template.reward_id;
      insert into public.reward_redemptions (
        tenant_id, customer_id, reward_id, points_spent, status
      ) values (
        p_tenant_id, p_customer_id, v_template.reward_id, 0, 'pending'
      ) returning id into v_redemption_id;
      update public.customer_punch_cards
        set completed_at = now(),
            reward_redemption_id = v_redemption_id,
            updated_at = now()
        where id = v_card.id;
      v_summary := v_summary || jsonb_build_object(
        'template_id', v_template.id,
        'template_name', v_template.name,
        'completed', true,
        'reward_redemption_id', v_redemption_id,
        'reward_name', v_reward.name
      );
    else
      v_summary := v_summary || jsonb_build_object(
        'template_id', v_template.id,
        'template_name', v_template.name,
        'completed', false,
        'current_stamps', v_card.current_stamps,
        'threshold', v_card.threshold_snapshot
      );
    end if;
  end loop;
  return v_summary;
end $$;

revoke all on function public._advance_punch_cards_for_visit(uuid, uuid, uuid) from public, anon, authenticated;
