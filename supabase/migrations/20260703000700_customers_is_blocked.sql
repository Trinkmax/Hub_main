-- Fix crítico (auditoría mensajería): "no contactar" (is_blocked) no existía.
-- Spec §4.2/§7 lo pide. Hard opt-out: si true, el cliente no recibe NINGÚN mensaje
-- saliente (difusiones, flows, contacto manual). El enforcement vive en los
-- boundaries de envío (broadcasts engine, flow runtime, contactCustomer), igual
-- que el re-chequeo de opt-in. Idempotente.
alter table public.customers
  add column if not exists is_blocked boolean not null default false;

comment on column public.customers.is_blocked is
  'No contactar (hard opt-out): si true, el cliente no recibe ningún mensaje saliente.';
