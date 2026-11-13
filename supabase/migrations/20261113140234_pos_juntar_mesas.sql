-- Punto de venta, parte 5: juntar dos mesas (docs/features/pos.md).
--
-- «Se juntan la 4 y la 5»: todo lo de una mesa pasa a la cuenta de la otra, y la primera queda libre.
-- Pasan las tandas (con lo que ya está en cocina), los cobros que se hubieran hecho, los descuentos y los
-- pedidos de aprobación. Las personas se suman. Si la mesa que queda no tenía socio, reserva o nombre,
-- toma los de la otra (así la seña y los puntos no se pierden).
--
-- Lo que no se puede juntar, y lo dice:
--   · una mesa de práctica con una de verdad;
--   · dos mesas con dos reservas distintas (son dos señas: se cobran por separado);
--   · mesas de otra sucursal, cerradas, o una consigo misma.
--
-- No tiene «deshacer»: la pantalla pregunta antes. Qué toca de lo que ya existe: nada de estructura; es una
-- función nueva que escribe en `table_sessions`, `tickets`, `pos_payments`, `pos_discounts`,
-- `pos_approvals`, `salon_reservations` y `table_session_events`.
--
-- El cuerpo no lleva renglones de comentario a propósito: así su md5 es el mismo se aplique este archivo
-- tal cual o sin comentarios.

set local lock_timeout = '5s';

create function public.pos_merge_tables(p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.table_sessions%rowtype;
  v_into public.table_sessions%rowtype;
  v_first uuid;
  v_second uuid;
  v_total bigint;
  v_into_label text;
begin
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'merge_invalid' using errcode = '22023';
  end if;
  if p_from < p_into then
    v_first := p_from;
    v_second := p_into;
  else
    v_first := p_into;
    v_second := p_from;
  end if;
  perform 1 from public.table_sessions s where s.id = v_first for update;
  perform 1 from public.table_sessions s where s.id = v_second for update;
  select * into v_from from public.table_sessions s where s.id = p_from;
  select * into v_into from public.table_sessions s where s.id = p_into;
  if v_from.id is null or v_into.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform private.pos_require_role(v_into.tenant_id, 'owner', 'cashier', 'waiter', 'host');
  if v_from.tenant_id <> v_into.tenant_id or v_from.branch_id <> v_into.branch_id then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_from.status = 'merged' and v_from.merged_into = p_into then
    return jsonb_build_object('into_session_id', p_into, 'merged', true, 'duplicate', true);
  end if;
  if v_from.status <> 'open' or v_into.status <> 'open' then
    raise exception 'session_not_open' using errcode = '55000';
  end if;
  if v_from.is_practice <> v_into.is_practice then
    raise exception 'merge_practice_mismatch' using errcode = '55000';
  end if;
  if v_from.reservation_id is not null and v_into.reservation_id is not null
     and v_from.reservation_id <> v_into.reservation_id then
    raise exception 'merge_two_reservations' using errcode = '55000';
  end if;

  update public.tickets set session_id = p_into where session_id = p_from;
  update public.pos_payments set session_id = p_into, idempotency_key = null where session_id = p_from;
  update public.pos_discounts set session_id = p_into where session_id = p_from;
  update public.pos_approvals set session_id = p_into where session_id = p_from;

  select coalesce(sum(t.total_cents), 0) into v_total
    from public.tickets t
   where t.session_id = p_into and t.status <> 'cancelled';
  update public.table_sessions
     set total_cents = v_total,
         party_size = case
           when party_size is null and v_from.party_size is null then null
           else coalesce(party_size, 0) + coalesce(v_from.party_size, 0)
         end,
         customer_id = coalesce(customer_id, v_from.customer_id),
         reservation_id = coalesce(reservation_id, v_from.reservation_id),
         alias = coalesce(alias, v_from.alias),
         bill_requested_at = coalesce(bill_requested_at, v_from.bill_requested_at)
   where id = p_into;
  update public.table_sessions
     set status = 'merged', merged_into = p_into, total_cents = 0
   where id = p_from;

  if v_into.reservation_id is null and v_from.reservation_id is not null and not v_into.is_practice then
    select left(pt.label, 24) into v_into_label
      from public.physical_tables pt where pt.id = v_into.physical_table_id;
    update public.salon_reservations
       set table_label = v_into_label
     where id = v_from.reservation_id and v_into_label is not null
       and table_label is distinct from v_into_label;
  end if;

  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values (p_into, 'session_merged', (select auth.uid()),
          jsonb_build_object('source', 'pos', 'absorbed_session_id', p_from,
                             'from_physical_table_id', v_from.physical_table_id,
                             'into_physical_table_id', v_into.physical_table_id));

  perform private.pos_poke(v_into.branch_id, 'floor', p_into);
  return jsonb_build_object('into_session_id', p_into, 'merged', true, 'duplicate', false,
                            'total_cents', v_total);
end;
$$;

revoke all on function public.pos_merge_tables(uuid, uuid) from public, anon;
grant execute on function public.pos_merge_tables(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
