-- ============================================================
-- Pulso de la billetera: refresco en vivo sin abrir Realtime
-- ============================================================
-- El socio canjea, el mozo valida, y la billetera se quedaba igual hasta que él
-- hacía refresh a mano. Lo mismo al acreditarle puntos en la caja.
--
-- POR QUÉ NO `postgres_changes`: la billetera es ANÓNIMA — la identidad es el
-- `qr_token`, no una sesión de Supabase. Los claims de una suscripción de
-- Realtime se fijan al hacer JOIN, y con claims `anon` la RLS filtra todos los
-- eventos: no llegaría ninguno. Para que llegaran habría que abrir policies de
-- lectura sobre `customers` y `reward_redemptions` para `anon`, que es regalar
-- muchísimo más de lo que se gana.
--
-- La alternativa barata: un hash de "todo lo que puede cambiar mientras la
-- pantalla está abierta". El cliente lo consulta cada pocos segundos (unos
-- bytes) y sólo cuando cambia dispara el `router.refresh()`, que es lo caro.
--
-- Devuelve SÓLO el hash: no expone saldo, ni ids, ni nombres. Si el token no
-- existe devuelve `rev: null` — sin distinguir "no existe" de "sin cambios".
-- ============================================================
create or replace function public.wallet_pulse(p_qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_pending text;
  v_stamps int;
begin
  select * into v_customer from public.customers
   where qr_token = p_qr_token and deleted_at is null;
  if v_customer.id is null then
    return jsonb_build_object('rev', null);
  end if;

  -- Los canjes pendientes con su token: cubre "apareció el QR", "el mozo lo
  -- entregó" (sale de pending), "lo cancelé" y "me regalaron un beneficio".
  select coalesce(
           string_agg(r.id::text || ':' || coalesce(r.redeem_token, '-'), ',' order by r.id),
           ''
         )
    into v_pending
    from public.reward_redemptions r
   where r.customer_id = v_customer.id
     and r.status = 'pending';

  -- Sellos en curso: cubre el "+1" del cajero.
  select coalesce(sum(c.current_stamps), 0)
    into v_stamps
    from public.customer_punch_cards c
   where c.customer_id = v_customer.id
     and c.completed_at is null
     and c.expired_at is null;

  return jsonb_build_object(
    'rev',
    md5(
      coalesce(v_customer.points_balance, 0)::text || '|' ||
      coalesce(v_customer.category_points, 0)::text || '|' ||
      coalesce(v_customer.current_tier_id::text, '-') || '|' ||
      coalesce(v_pending, '') || '|' ||
      coalesce(v_stamps, 0)::text
    )
  );
end $$;

revoke execute on function public.wallet_pulse(text) from public;
grant execute on function public.wallet_pulse(text) to anon, authenticated;

comment on function public.wallet_pulse(text) is
  'Hash opaco del estado visible de la billetera. Lo polea /c y /carta para refrescar sólo cuando algo cambió (puntos, canje entregado, sello nuevo).';
