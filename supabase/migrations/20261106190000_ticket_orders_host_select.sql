-- Ventas online para la anfitriona (pedido de Nacho, 06/11/2026).
--
-- Las compras de la cartelera dejan de ser solo del dueño: la anfitriona las ve en «Ventas online»
-- para confirmar las transferencias que le avisan los clientes, después de preguntarles a los socios
-- si la plata llegó. Solo LECTURA: confirmar pasa por el server (applyPayment →
-- ticketing_settle_order con service_role), igual que para el dueño, y devolver o anular siguen
-- siendo del dueño (lo chequean las actions). Espeja TICKET_SALES_ROLES de lib/tenant/roles.ts.
--
-- Es una policy más, permisiva: se suma (OR) a ticket_orders_owner_select sin tocarla. La
-- configuración (ticketing_settings, con la cuenta de Mercado Pago) y las películas siguen siendo
-- solo del dueño. El GRANT de select a authenticated ya existe (20261026120100).
--
-- Dentro de un DO para poder correrla dos veces sin borrar nada antes.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_orders'
      and policyname = 'ticket_orders_host_select'
  ) then
    create policy "ticket_orders_host_select" on public.ticket_orders
      for select to authenticated
      using (public.user_role_in_tenant(tenant_id) = 'host');
  end if;
end
$$;

comment on policy "ticket_orders_host_select" on public.ticket_orders is
  'La anfitriona lee las ventas online para confirmar transferencias (06/11/2026). Solo lectura.';
