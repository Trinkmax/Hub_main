-- La cuenta del bar para que paguen por transferencia cuando Mercado Pago rechaza el pago.
-- Son públicas para quien paga: las lee el server con service_role al armar la entrada.

alter table public.ticketing_settings
  add column if not exists transfer_alias text
    check (transfer_alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  add column if not exists transfer_holder text
    check (char_length(transfer_holder) <= 120);

comment on column public.ticketing_settings.transfer_alias is
  'Alias de la cuenta del bar. La entrada lo muestra si Mercado Pago rechaza el pago. Lo cambia solo el dueño y queda en audit_log.';
comment on column public.ticketing_settings.transfer_holder is
  'A nombre de quién está la cuenta, para que quien transfiere sepa que es la correcta.';

-- Los GRANT de esta tabla son por columna (ver 20261026120100_ticketing_tables.sql).
grant select (transfer_alias, transfer_holder) on public.ticketing_settings to authenticated;
grant insert (transfer_alias, transfer_holder) on public.ticketing_settings to authenticated;
grant update (transfer_alias, transfer_holder) on public.ticketing_settings to authenticated;
