-- Una sola ficha por celular: siempre con el 9.
--
-- Las reservas guardaban el teléfono como lo entregaba el campo del formulario
-- («+543511234567», sin el 9) y el club, las entradas y WhatsApp lo guardan con
-- el 9 («+5493511234567»). La misma persona quedaba con dos fichas: en HUB, 40
-- personas al 06/11/2026. La ficha sin el 9 solo tenía reservas y entradas; la
-- clave, los puntos y los canjes estaban en la otra. El lado de la app está en
-- lib/phone.ts (canonicalPhone, phoneVariants).
--
-- 1. Un trigger que le pone el 9 a cualquier celular argentino que se guarde,
--    venga de donde venga (app, funciones SQL, importaciones).
-- 2. Une los pares que hay hoy: todo pasa a la ficha con el 9 (salvo que la
--    clave esté solo en la otra), la vieja queda dada de baja y cada unión queda
--    en audit_log. Si las dos fichas tienen algo que una persona tiene una sola
--    vez (clave, regalo de bienvenida), no adivina: corta la migración entera.
-- 3. Le pone el 9 a todos los demás.

-- ─── 1. Siempre con el 9 ────────────────────────────────────────────────────
create or replace function public.customers_phone_with_nine()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- +54 + 10 dígitos sin el 9 (área 1 a 8) → +54 9 + los mismos 10 dígitos.
  if new.phone ~ '^\+54[1-8][0-9]{9}$' then
    new.phone := '+549' || substr(new.phone, 4);
  end if;
  return new;
end $$;

comment on function public.customers_phone_with_nine() is
  'Guarda los celulares argentinos siempre con el 9 (+549…), como lib/phone.ts. Sin esto la misma persona terminaba con dos fichas.';

create or replace trigger customers_phone_with_nine_trg
  before insert or update of phone on public.customers
  for each row execute function public.customers_phone_with_nine();

-- ─── 2. Unir los pares de hoy ───────────────────────────────────────────────
do $$
declare
  r record;
  v_keep public.customers;
  v_drop public.customers;
  v_moved jsonb;
  v_n int;
  v_pts int;
  v_life int;
  v_visits int;
  v_spent bigint;
  v_last timestamptz;
  v_pairs int := 0;
begin
  for r in
    select c.tenant_id,
      array_agg(c.id order by (c.phone ~ '^\+549') desc, c.created_at) as ids,
      array_agg(exists (select 1 from public.customer_credentials x where x.customer_id = c.id)
                order by (c.phone ~ '^\+549') desc, c.created_at) as claves
    from public.customers c
    where c.deleted_at is null and c.phone ~ '^\+54(9)?[1-8][0-9]{9}$'
    group by c.tenant_id, right(c.phone, 10)
    having count(*) = 2 and count(*) filter (where c.phone ~ '^\+549') = 1
  loop
    -- Queda la que tiene el 9 (la del club y las entradas), salvo que la clave
    -- esté solo en la otra.
    if not r.claves[1] and r.claves[2] then
      select * into v_keep from public.customers where id = r.ids[2] for update;
      select * into v_drop from public.customers where id = r.ids[1] for update;
    else
      select * into v_keep from public.customers where id = r.ids[1] for update;
      select * into v_drop from public.customers where id = r.ids[2] for update;
    end if;

    if exists (select 1 from public.customer_credentials where customer_id = v_drop.id)
       and exists (select 1 from public.customer_credentials where customer_id = v_keep.id) then
      raise exception 'las dos fichas de % tienen clave', v_keep.id;
    end if;
    if exists (select 1 from public.welcome_reward_grants where customer_id = v_drop.id)
       and exists (select 1 from public.welcome_reward_grants where customer_id = v_keep.id) then
      raise exception 'las dos fichas de % tienen regalo de bienvenida', v_keep.id;
    end if;

    -- Puntos y visitas: los triggers ajustan cambios de monto, no de dueño, así
    -- que lo que se mueve se suma y se resta a mano.
    select coalesce(sum(delta), 0), coalesce(sum(greatest(delta, 0)), 0)
      into v_pts, v_life
      from public.points_transactions where customer_id = v_drop.id;
    select count(*), coalesce(sum(total_amount_cents), 0), max(visited_at)
      into v_visits, v_spent, v_last
      from public.visits where customer_id = v_drop.id;

    v_moved := '{}'::jsonb;
    update public.points_transactions set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('points_transactions', v_n);
    update public.visits set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('visits', v_n);
    update public.salon_reservations set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('salon_reservations', v_n);
    update public.ticket_orders set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('ticket_orders', v_n);
    update public.reward_redemptions set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('reward_redemptions', v_n);
    update public.conversations set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('conversations', v_n);
    update public.customer_credentials set customer_id = v_keep.id where customer_id = v_drop.id;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('customer_credentials', v_n);
    update public.customer_password_resets set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.welcome_reward_grants set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.customer_capture_submissions set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.customer_punch_cards set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.punch_card_stamps set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.tier_benefit_grants set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.flow_executions set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.flow_execution_events set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.reviews set customer_id = v_keep.id where customer_id = v_drop.id;
    update public.session_guests set customer_id = v_keep.id where customer_id = v_drop.id;
    -- Con clave única: pasan las que no chocan; una etiqueta o una difusión
    -- repetida queda colgada de la ficha dada de baja, que no se ve en ningún lado.
    update public.customer_tag_assignments a set customer_id = v_keep.id
      where a.customer_id = v_drop.id
        and not exists (select 1 from public.customer_tag_assignments b
                        where b.customer_id = v_keep.id and b.tag_id = a.tag_id);
    update public.broadcast_recipients a set customer_id = v_keep.id
      where a.customer_id = v_drop.id
        and not exists (select 1 from public.broadcast_recipients b
                        where b.customer_id = v_keep.id and b.broadcast_id = a.broadcast_id);

    -- La ficha que queda: lo que le falte lo toma de la otra; «cliente desde» y
    -- «cómo llegó» son los de la primera vez que vino.
    update public.customers k set
      first_name = coalesce(nullif(k.first_name, ''), v_drop.first_name),
      last_name = case when coalesce(k.last_name, '') in ('', '—')
                       then coalesce(nullif(v_drop.last_name, ''), k.last_name) else k.last_name end,
      email = coalesce(k.email, v_drop.email),
      email_opt_in_at = coalesce(k.email_opt_in_at, v_drop.email_opt_in_at),
      birthdate = coalesce(k.birthdate, v_drop.birthdate),
      opt_in_marketing = k.opt_in_marketing or v_drop.opt_in_marketing,
      opt_in_at = case when k.opt_in_marketing then k.opt_in_at
                       when v_drop.opt_in_marketing then v_drop.opt_in_at else k.opt_in_at end,
      opt_in_ip = case when k.opt_in_marketing then k.opt_in_ip
                       when v_drop.opt_in_marketing then v_drop.opt_in_ip else k.opt_in_ip end,
      notes = nullif(concat_ws(E'\n', nullif(k.notes, ''), nullif(v_drop.notes, '')), ''),
      is_blocked = k.is_blocked or v_drop.is_blocked,
      service_alerts = array(select distinct a from unnest(k.service_alerts || v_drop.service_alerts) a),
      acquisition_channel = case when v_drop.created_at < k.created_at
                                 then v_drop.acquisition_channel else k.acquisition_channel end,
      created_at = least(k.created_at, v_drop.created_at),
      points_balance = k.points_balance + v_pts,
      lifetime_points_earned = k.lifetime_points_earned + v_life,
      total_visits = k.total_visits + v_visits,
      total_spent_cents = k.total_spent_cents + v_spent,
      last_visit_at = greatest(k.last_visit_at, v_last)
    where k.id = v_keep.id;

    update public.customers set
      deleted_at = now(),
      points_balance = points_balance - v_pts,
      lifetime_points_earned = greatest(0, lifetime_points_earned - v_life),
      total_visits = greatest(0, total_visits - v_visits),
      total_spent_cents = greatest(0, total_spent_cents - v_spent)
    where id = v_drop.id;

    perform public.recompute_customer_loyalty(v_keep.id);

    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, payload)
    values (v_keep.tenant_id, null, 'customer.merged', 'customer', v_keep.id,
      jsonb_build_object('source', 'soporte', 'merged_from', v_drop.id, 'moved', v_moved,
        'points', v_pts, 'visits', v_visits,
        'reason', 'Misma persona con el celular con y sin el 9 (migración del 06/11/2026).'));
    v_pairs := v_pairs + 1;
  end loop;

  -- ─── 3. El resto, con el 9 ─────────────────────────────────────────────────
  update public.customers set phone = '+549' || substr(phone, 4)
    where deleted_at is null and phone ~ '^\+54[1-8][0-9]{9}$';

  if exists (select 1 from public.customers
             where deleted_at is null and phone ~ '^\+54[1-8][0-9]{9}$') then
    raise exception 'quedaron celulares sin el 9';
  end if;
  raise notice 'fichas unidas: %', v_pairs;
end $$;
