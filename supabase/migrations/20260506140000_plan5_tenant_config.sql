-- Plan 5: columnas de configuración por tenant
-- (auto-aceptación de tickets, timeouts de guest/sesión)

alter table public.tenants add column if not exists
  guest_idle_hours_to_rescan int not null default 2
  check (guest_idle_hours_to_rescan > 0);

alter table public.tenants add column if not exists
  session_auto_abandon_hours int not null default 8
  check (session_auto_abandon_hours > 0);

alter table public.tenants add column if not exists
  ticket_auto_accept_enabled boolean not null default false;

alter table public.tenants add column if not exists
  ticket_auto_accept_max_cents bigint
  check (ticket_auto_accept_max_cents is null or ticket_auto_accept_max_cents > 0);

alter table public.tenants add column if not exists
  ticket_auto_accept_max_items int
  check (ticket_auto_accept_max_items is null or ticket_auto_accept_max_items > 0);
