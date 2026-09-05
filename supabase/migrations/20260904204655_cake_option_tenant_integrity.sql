-- ============================================================
-- La torta de una reserva tiene que ser del MISMO bar
-- ============================================================
-- La FK simple `salon_reservations.cake_option_id -> cake_options(id)` no dice
-- nada del tenant: satisfacerla con el id de una torta de OTRO bar es válido
-- para Postgres. Las RLS no lo tapan — filtran filas al leer, no valores al
-- escribir — así que el `select` con el join devolvería `cake_option: null`
-- (la fila del otro bar no se puede leer) y la reserva quedaría con una torta
-- fantasma: la cocina sin saber qué hacer y el otro bar sin poder borrar esa
-- opción nunca más, por el `on delete restrict`, sin entender por qué.
--
-- CLAUDE.md §4 y §12 son explícitos con las queries cross-tenant. Esto lo cierra
-- en la base y no en la Server Action, que es donde tiene que estar: una FK
-- compuesta hace imposible el estado inválido, sin sumar un round-trip de
-- validación a cada alta de reserva.

-- El destino de una FK compuesta necesita un índice único que la respalde.
alter table public.cake_options
  add constraint cake_options_id_tenant_unique unique (id, tenant_id);

alter table public.salon_reservations
  drop constraint salon_reservations_cake_option_id_fkey;

alter table public.salon_reservations
  add constraint salon_reservations_cake_option_id_fkey
    foreign key (cake_option_id, tenant_id)
    references public.cake_options(id, tenant_id)
    on delete restrict;

-- El default `'{}'` de `fillings` era inalcanzable: chocaba de frente con el
-- CHECK `cake_options_fillings_len` (1..4), así que todo insert que omitiera la
-- columna fallaba con un error de constraint en vez de decir "falta el dato".
-- La app siempre manda los rellenos (zod exige al menos uno); esto es para que
-- una carga manual o un script futuro reciban el error correcto.
alter table public.cake_options
  alter column fillings drop default;
