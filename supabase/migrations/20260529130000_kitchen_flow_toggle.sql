-- Mozo recortado del flujo de preparación — toggle por bar + RPC config-aware.
--
-- Cambios:
--   1. tenants.kitchen_flow_enabled (default false → comportamiento actual)
--   2. update_ticket_status pasa a leer el flag y aplicar la matriz por rol.
--
-- Con flag OFF: idéntico al comportamiento previo (mozo hace todo el flujo).
-- Con flag ON: la preparación (accepted→preparing→ready) es solo de cocina/owner;
-- el mozo solo confirma (accept_ticket), entrega (ready→served) y cobra.

alter table public.tenants
  add column if not exists kitchen_flow_enabled boolean not null default false;

comment on column public.tenants.kitchen_flow_enabled is
  'Si true, solo la cocina (+owner) mueve las comandas por preparación. El mozo confirma y entrega.';

-- ──────────────────────────────────────────────────────────
-- REEMPLAZO: update_ticket_status (config-aware)
-- ──────────────────────────────────────────────────────────
create or replace function public.update_ticket_status(
  p_ticket_id uuid,
  p_new_status public.ticket_status
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket public.tickets;
  v_role text;
  v_kitchen_flow boolean;
  v_allowed boolean := false;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket_not_found' using errcode = 'P0001';
  end if;
  v_role := public.user_role_in_tenant(v_ticket.tenant_id);
  if v_role is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select kitchen_flow_enabled into v_kitchen_flow
    from public.tenants where id = v_ticket.tenant_id;
  v_kitchen_flow := coalesce(v_kitchen_flow, false);

  -- Matriz de transición + rol.
  -- owner es override en todas las ramas.
  if v_ticket.status = 'accepted' and p_new_status = 'preparing' then
    if v_kitchen_flow then
      if v_role in ('kitchen', 'owner') then v_allowed := true; end if;
    else
      if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
    end if;
  elsif v_ticket.status = 'preparing' and p_new_status = 'ready' then
    if v_kitchen_flow then
      if v_role in ('kitchen', 'owner') then v_allowed := true; end if;
    else
      if v_role in ('waiter', 'kitchen', 'owner') then v_allowed := true; end if;
    end if;
  elsif v_ticket.status = 'ready' and p_new_status = 'served' then
    -- Entregar es siempre del mozo (+owner), en ambos modos.
    if v_role in ('waiter', 'owner') then v_allowed := true; end if;
  end if;

  if not v_allowed then
    raise exception 'invalid_transition_or_role' using errcode = '42501';
  end if;

  update public.tickets
    set status = p_new_status,
        prepared_at = case when p_new_status = 'preparing' and prepared_at is null then now() else prepared_at end,
        served_at = case when p_new_status = 'served' then now() else served_at end,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', p_new_status);
end $$;

revoke all on function public.update_ticket_status(uuid, public.ticket_status) from public;
grant execute on function public.update_ticket_status(uuid, public.ticket_status) to authenticated;
