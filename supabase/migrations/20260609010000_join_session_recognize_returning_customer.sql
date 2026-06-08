-- ============================================================
-- join_session_as_guest: reconocer al cliente que vuelve
-- ============================================================
-- Bug: el guest se crea por (session_id, browser_token). En una visita nueva
-- (sesión nueva) se creaba un guest con customer_id NULL, perdiendo el vínculo
-- al cliente que ya se había registrado antes con ese mismo browser_token →
-- "la sesión no se mantiene" (tenía que re-loguearse).
--
-- Fix: al crear un guest NUEVO, si ese browser_token ya estuvo vinculado a un
-- cliente del MISMO tenant en una sesión anterior, se re-vincula automáticamente
-- (copia customer_id + nombre). Scope por tenant: el browser_token es global pero
-- los clientes son por-tenant → nunca cruza datos entre bares.
--
-- `create or replace` preserva los GRANT existentes (anon + authenticated).
-- Idempotente. No cambia el schema (sin db:types).
-- ============================================================

create or replace function public.join_session_as_guest(
  p_qr_token text,
  p_browser_token text,
  p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_table public.physical_tables;
  v_session public.table_sessions;
  v_guest_id uuid;
  v_existing public.session_guests;
  v_clean_name text;
  v_was_new_guest boolean := false;
  v_prev_customer uuid;
  v_customer_id uuid;
begin
  if p_qr_token is null or length(trim(p_qr_token)) = 0 then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;
  if p_browser_token is null
     or length(p_browser_token) < 16
     or length(p_browser_token) > 64 then
    raise exception 'invalid_browser_token' using errcode = 'P0001';
  end if;
  v_clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if v_clean_name is not null and length(v_clean_name) > 40 then
    raise exception 'display_name_too_long' using errcode = 'P0001';
  end if;

  select * into v_table
    from public.physical_tables
    where qr_token = p_qr_token and active = true;
  if v_table.id is null then
    raise exception 'invalid_qr_token' using errcode = 'P0001';
  end if;

  -- Sin auto-create: la sesión debe existir.
  select * into v_session
    from public.table_sessions
    where physical_table_id = v_table.id and status = 'open'
    for update;
  if v_session.id is null then
    raise exception 'no_active_session' using errcode = 'P0001';
  end if;

  select * into v_existing
    from public.session_guests
    where session_id = v_session.id and browser_token = p_browser_token
    for update;

  if v_existing.id is not null then
    update public.session_guests
      set display_name = coalesce(v_clean_name, display_name),
          last_activity_at = now()
      where id = v_existing.id;
    v_guest_id := v_existing.id;
    v_customer_id := v_existing.customer_id;
  else
    -- Cliente que vuelve: ¿este browser_token ya estuvo vinculado a un cliente
    -- de ESTE tenant en otra sesión? Re-vincular sin pedir re-login.
    select sg.customer_id into v_prev_customer
      from public.session_guests sg
      join public.table_sessions ts on ts.id = sg.session_id
      join public.customers c on c.id = sg.customer_id
      where sg.browser_token = p_browser_token
        and sg.customer_id is not null
        and ts.tenant_id = v_session.tenant_id
        and c.deleted_at is null
      order by sg.last_activity_at desc
      limit 1;

    -- Si no nos pasaron nombre y reconocimos un cliente, usar el suyo.
    if v_clean_name is null and v_prev_customer is not null then
      select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
        into v_clean_name
        from public.customers
        where id = v_prev_customer;
    end if;

    insert into public.session_guests (session_id, browser_token, display_name, customer_id)
      values (v_session.id, p_browser_token, v_clean_name, v_prev_customer)
      returning id into v_guest_id;
    v_customer_id := v_prev_customer;

    insert into public.table_session_events (
      session_id, type, created_by_guest_id, payload
    ) values (
      v_session.id, 'guest_joined', v_guest_id,
      jsonb_build_object('display_name', v_clean_name, 'recognized', v_prev_customer is not null)
    );
    v_was_new_guest := true;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'guest_id', v_guest_id,
    'customer_id', v_customer_id,
    'was_new_guest', v_was_new_guest,
    'was_new_session', false
  );
end $$;
