-- Tex: desde que anda en todo el panel, una acción puede ser el alta de un cliente, con su nombre y su teléfono. Leer
-- Administración ya no alcanza para ver cualquiera: la contadora, por ejemplo, no tiene acceso a los clientes.
-- Cada persona sigue viendo las suyas (atxa_panel_select); quien lee Administración, además, las de un comprobante, que
-- es lo que ya puede ver en su pantalla.
drop policy atxa_readers_select on public.acc_tex_actions;
create policy atxa_readers_select on public.acc_tex_actions for select to authenticated
  using (document_id is not null and tenant_id in (select public.acc_reader_tenant_ids()));
