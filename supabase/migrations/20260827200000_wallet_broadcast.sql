-- ============================================================
-- Billetera del socio: aviso por Realtime Broadcast en vez de polling
-- ============================================================
-- Hasta acá /c/[token] y la carta consultaban /api/wallet/[token]/pulse cada
-- 3 s con el QR en pantalla (20 s el resto del tiempo): cada consulta es una
-- invocación de función en Vercel + una RPC + un evento de observabilidad, por
-- cada socio con la billetera abierta. Era el mayor consumidor de la cuenta.
--
-- La pantalla es anónima (la identidad es el qr_token), así que Realtime con
-- postgres_changes no servía (claims anon → RLS filtra todo). Pero Broadcast
-- desde la DB sí: `realtime.send(..., private => false)` publica en un topic
-- PÚBLICO al que cualquiera puede suscribirse... si conoce el nombre. El topic
-- es `wallet:<sha256(qr_token)>`: el token es un secreto de 16–128 chars, el
-- hash no es reversible, y el payload no lleva datos (sólo "cambió algo").
-- Quien adivine el topic sólo recibe pings sin contenido.
--
-- El cliente se suscribe al topic y refresca cuando llega el ping; el polling
-- queda como red de seguridad lenta (ver app/c/[token]/_components/wallet-live.tsx).
-- Sin tablas nuevas; realtime.send captura errores y nunca rompe la transacción.
-- ============================================================

create or replace function public.wallet_topic(p_qr_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'wallet:' || encode(sha256(convert_to(p_qr_token, 'UTF8')), 'hex')
$$;
revoke all on function public.wallet_topic(text) from public, anon, authenticated;

create or replace function public.wallet_notify(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_customer_id is null then return; end if;
  select qr_token into v_token
    from public.customers
   where id = p_customer_id and deleted_at is null;
  if v_token is null then return; end if;
  perform realtime.send(
    jsonb_build_object('at', (extract(epoch from clock_timestamp()) * 1000)::bigint),
    'changed',
    public.wallet_topic(v_token),
    false
  );
exception
  when others then
    -- Un aviso nunca puede tumbar la acreditación/el canje que lo originó.
    null;
end $$;
revoke all on function public.wallet_notify(uuid) from public, anon, authenticated;

create or replace function public.wallet_notify_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'customers' then
    -- Sólo lo que la billetera muestra (espeja wallet_pulse): puntos, puntos
    -- de categoría y nivel. Otros updates de customers no avisan.
    if tg_op = 'UPDATE' and (
         new.points_balance is distinct from old.points_balance
      or new.category_points is distinct from old.category_points
      or new.current_tier_id is distinct from old.current_tier_id
    ) then
      perform public.wallet_notify(new.id);
    end if;
  else
    -- reward_redemptions / customer_punch_cards: cualquier alta, cambio o baja.
    perform public.wallet_notify(coalesce(new.customer_id, old.customer_id));
  end if;
  return null;
end $$;

drop trigger if exists wallet_notify_on_customers on public.customers;
create trigger wallet_notify_on_customers
  after update on public.customers
  for each row execute function public.wallet_notify_trigger();

drop trigger if exists wallet_notify_on_redemptions on public.reward_redemptions;
create trigger wallet_notify_on_redemptions
  after insert or update or delete on public.reward_redemptions
  for each row execute function public.wallet_notify_trigger();

drop trigger if exists wallet_notify_on_punch_cards on public.customer_punch_cards;
create trigger wallet_notify_on_punch_cards
  after insert or update or delete on public.customer_punch_cards
  for each row execute function public.wallet_notify_trigger();

comment on function public.wallet_notify(uuid) is
  'Publica un ping sin datos en el topic público wallet:<sha256(qr_token)> (Realtime Broadcast). El cliente de la billetera refresca al recibirlo; reemplaza el polling de /api/wallet/[token]/pulse.';
