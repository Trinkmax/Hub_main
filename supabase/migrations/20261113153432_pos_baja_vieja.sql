-- Punto de venta, parte 6: la baja vieja no saltea los controles (docs/features/pos.md › Auditoría).
--
-- `cancel_ticket_item` es la baja del servicio de mesa anterior: con un motivo, cualquier mozo o la cocina
-- da de baja un renglón. En un bar con el punto de venta prendido eso saltea todo lo que se armó para las
-- bajas (el OK de quien autoriza, no tocar lo ya cobrado, el registro de quién fue): dando de baja una mesa
-- renglón por renglón se la podía cerrar sin cobrar, porque una mesa sin consumo se puede liberar.
--
-- Ahora, en un bar con punto de venta, esta función no da de baja nada y avisa `pos_only`: la baja se hace
-- desde la cuenta de la mesa (`pos_cancel_item`, `pos_request_void`). Un bar sin punto de venta queda
-- exactamente igual.
--
-- Qué toca de lo que ya existe: redefine UNA función, con el mismo cuerpo más el control. No cambia tablas,
-- permisos ni datos.
--
-- El cuerpo no lleva renglones de comentario a propósito: así su md5 es el mismo se aplique este archivo
-- tal cual o sin comentarios.

set local lock_timeout = '5s';

create or replace function public.cancel_ticket_item(p_ticket_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.ticket_items;
  v_ticket public.tickets;
  v_clean_reason text;
begin
  v_clean_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_clean_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  select * into v_item from public.ticket_items where id = p_ticket_item_id for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;
  if v_item.cancelled_at is not null then
    return jsonb_build_object('item_id', p_ticket_item_id, 'idempotent', true);
  end if;
  select * into v_ticket from public.tickets where id = v_item.ticket_id;
  perform public._check_staff_role(v_ticket.tenant_id, array['waiter', 'owner', 'kitchen']);
  if exists (
    select 1 from public.tenants t
     where t.id = v_ticket.tenant_id and coalesce(t.feature_flags ->> 'pos', 'false') = 'true'
  ) then
    raise exception 'pos_only' using errcode = '55000';
  end if;
  update public.ticket_items
    set cancelled_at = now(),
        cancellation_reason = v_clean_reason
    where id = p_ticket_item_id;
  return jsonb_build_object('item_id', p_ticket_item_id, 'cancelled', true);
end;
$$;

notify pgrst, 'reload schema';
