-- ============================================================
-- FIX: register_lunch_visit leía claves de config que la app nunca escribe
-- ============================================================
-- Corrige 20260731194221_punch_cards_revival.
--
-- Al reescribir la función se copiaron las claves del código viejo (`days`,
-- `from`, `to`), pero el editor de punch cards escribe `days_of_week`,
-- `hours_from` y `hours_to` (validado por `punchConfigSchema` en
-- lib/punch-cards/schemas.ts). Las tres lecturas daban NULL, así que las dos
-- guardas quedaban en no-op: una tarjeta configurada "sólo al mediodía, de lunes
-- a viernes" se sellaba a cualquier hora y cualquier día, en silencio.
-- ============================================================
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

  if v_tpl.trigger_type = 'visit_window' then
    v_days := v_cfg -> 'days_of_week';
    if v_days is not null and jsonb_typeof(v_days) = 'array' then
      v_dow := extract(isodow from v_local)::int;
      if not (v_days @> to_jsonb(v_dow)) then
        raise exception 'punch_day_not_allowed' using errcode = 'P0001';
      end if;
    end if;

    v_from := nullif(v_cfg ->> 'hours_from', '')::time;
    v_to := nullif(v_cfg ->> 'hours_to', '')::time;
    if v_from is not null and v_to is not null then
      if not (v_local::time between v_from and v_to) then
        raise exception 'punch_time_not_allowed' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return public.add_punch_stamp(p_customer_id, p_template_id, 1, 'lunch', null);
end $$;
