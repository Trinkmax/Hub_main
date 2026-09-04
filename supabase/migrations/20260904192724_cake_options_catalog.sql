-- ============================================================
-- Catálogo de tortas de cumpleaños (por tenant) + elección en la reserva
-- ============================================================
-- El dueño del HUB contó el moco: el lunes 21 hay "Pizza libre" y adentro se
-- coló un cumple de 15 que además lleva torta. En la agenda se leía "Pizza
-- libre" y nadie veía la torta — que la hace el bar, no el cliente. Anotar
-- "torta: sí" no alcanza: la cocina necesita SABER CUÁL.
--
-- El bar ofrece un menú cerrado de tortas; cada opción es un bizcochuelo con
-- DOS rellenos. Eso no puede vivir hardcodeado: es una plataforma multi-bar y
-- además el HUB va a cambiar los rellenos por temporada. Entonces: catálogo
-- por tenant, editable desde Configuración, y la reserva apunta a una opción.
--
-- Decisiones:
--   · `fillings text[]` y no una tabla hija: el relleno no tiene vida propia
--     (no se busca, no se reporta, no se referencia) y "2 rellenos por torta"
--     se lee de un tirón. 1..4 por si algún bar arma una de tres capas.
--   · UNA opción por reserva (`cake_option_id`), no una por torta. `cake_count`
--     llega hasta 2 y en 194 reservas históricas solo 2 tienen dos tortas; para
--     ese caso raro con dos sabores distintos está el comentario de la reserva.
--     A cambio, la opción viaja GRATIS en el `select *` que ya hacen todas las
--     pantallas de reservas, con un solo join más.
--   · `on delete restrict`: borrar una opción que alguna reserva ya eligió
--     borraría la única pista de qué torta hay que hacer. La UI ofrece
--     desactivar (sale del selector, la historia queda intacta).

-- ──────────────────────────────────────────────────────────
-- cake_options — el menú de tortas del bar
-- ──────────────────────────────────────────────────────────
create table public.cake_options (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- Cómo la nombra el bar. Suele ser "Opción 1", pero un bar puede querer
  -- "La clásica" — por eso es texto libre y no un número.
  name          text not null check (length(trim(name)) between 1 and 80),
  -- La masa: "Bizcochuelo de vainilla".
  base          text not null check (length(trim(base)) between 1 and 120),
  -- Los rellenos, en orden. Cada torta del HUB trae dos.
  fillings      text[] not null default '{}',

  -- Orden en el selector. El operador elige de memoria ("la 2"), así que el
  -- orden tiene que ser estable y decidirlo el dueño, no el alfabeto.
  position      int not null default 0,
  -- Desactivada = no aparece al cargar una reserva nueva, pero las reservas
  -- viejas la siguen mostrando.
  active        boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint cake_options_fillings_len
    check (coalesce(array_length(fillings, 1), 0) between 1 and 4),
  constraint cake_options_name_unique unique (tenant_id, name)
);

create index cake_options_tenant_position_idx
  on public.cake_options(tenant_id, position, created_at);

create trigger cake_options_updated_at before update on public.cake_options
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────────────────
-- salon_reservations.cake_option_id — qué torta le toca a esta mesa
-- ──────────────────────────────────────────────────────────
alter table public.salon_reservations
  add column cake_option_id uuid references public.cake_options(id) on delete restrict;

-- Solo se consulta filtrando por opción cuando el dueño quiere saber "cuántas
-- opción 2 salieron este mes"; el índice parcial es barato porque el 95% de las
-- reservas no lleva torta.
create index salon_reservations_cake_option_idx
  on public.salon_reservations(cake_option_id)
  where cake_option_id is not null;

-- Elegir torta sin decir que traen torta deja a la cocina sin cantidad; decir
-- que traen torta sin elegir cuál es LEGÍTIMO (la cargás y después el cliente
-- decide el sabor), así que solo se prohíbe el primer caso.
alter table public.salon_reservations
  add constraint salon_reservations_cake_option_needs_cake
    check (cake_option_id is null or cake_count > 0);

-- ──────────────────────────────────────────────────────────
-- RLS — espeja scheduled_event_templates: todo el equipo lee, el dueño edita
-- ──────────────────────────────────────────────────────────
-- Lee todo miembro porque el selector de tortas vive en el alta de reserva, que
-- también carga el cajero y el anfitrión. Escribe solo el dueño: el menú de
-- tortas es una decisión de carta, no de servicio.
alter table public.cake_options enable row level security;

create policy "ckopt_select_member" on public.cake_options for select to authenticated
  using (tenant_id in (select public.user_tenant_ids()));

create policy "ckopt_owner_write" on public.cake_options for all to authenticated
  using (public.user_role_in_tenant(tenant_id) = 'owner')
  with check (public.user_role_in_tenant(tenant_id) = 'owner');

-- ──────────────────────────────────────────────────────────
-- GRANTs Data API (CLAUDE.md §5 — cambio 30/05/2026)
-- ──────────────────────────────────────────────────────────
grant select, insert, update, delete on public.cake_options to authenticated;

-- ──────────────────────────────────────────────────────────
-- Seed: las tres tortas que el HUB ya hace hoy
-- ──────────────────────────────────────────────────────────
-- Idempotente y sin hardcodear el uuid del tenant: se lo aplica a cualquier bar
-- que ya tenga reservas de salón configuradas y todavía no tenga catálogo.
insert into public.cake_options (tenant_id, name, base, fillings, position)
select t.id, v.name, v.base, v.fillings, v.position
from public.tenants t
cross join (values
  ('Opción 1', 'Bizcochuelo de vainilla',
   array['Dulce de leche', 'Crema chantilly y frutillas'], 1),
  ('Opción 2', 'Bizcochuelo de chocolate',
   array['Mousse de chocolate', 'Crema y frutillas'], 2),
  ('Opción 3', 'Bizcochuelo de vainilla',
   array['Dulce de leche', 'Crema y durazno'], 3)
) as v(name, base, fillings, position)
where exists (select 1 from public.reservation_managers rm where rm.tenant_id = t.id)
on conflict (tenant_id, name) do nothing;
