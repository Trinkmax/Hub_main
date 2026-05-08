# Mesas, auto-pedido y puntos integrados — Design

- **Fecha**: 2026-05-06
- **Autor**: brainstorming colaborativo (usuario + Claude)
- **Status**: borrador para revisión
- **Reemplaza**: el RPC `close_table` actual y la entidad `visits` como punto de entrada operativo

---

## 1. Contexto

HUB es un bar en Córdoba con entre 50 y 80 comensales por noche y 3-4 mozos. La plataforma actual ya tiene:

- Captura QR pública (`customer_capture_links` + `submit_capture`) que registra al cliente en `customers` con teléfono, nombre, apellido y cumpleaños.
- Catálogo de carta (`menu_categories`, `menu_items`) administrado por el dueño.
- Motor de puntos genéricos (`points_rules`, `points_transactions`, `rewards`, `reward_redemptions`).
- Cierre de mesa simple (`close_table` RPC) que crea una `visit` con sus `visit_items`.

Lo que falta —y este spec entrega— es el sistema operativo de **mesas con auto-pedido vía QR, atribución por comensal individual y dos sistemas de fidelidad coexistiendo (puntos + punch cards)**.

### El problema concreto

Hoy el mozo carga el consumo manualmente y, si quiere atribuirlo a puntos, tiene que registrar a una persona por mesa con todos los datos. En un bar lleno con 12-25 comensales por mozo, esto:

1. Genera fricción al sentarse (mozo "vendiendo" el programa de puntos).
2. Pierde el dato de quién vino con quién (todo va a una sola persona "anfitriona").
3. Sobrecarga al mozo cuando quiere atribuir consumo justo entre comensales que comparten una mesa.

Además, el bar quiere que los comensales **piden directamente desde la carta digital** (auto-servicio) para reducir el cuello de botella del mozo y permitir comandas más rápidas con discriminación por persona.

### Decisión de scope

Originalmente este spec se planteó como tres sub-proyectos (sesiones, auto-pedido, mozo móvil avanzado), pero durante el brainstorming se hizo evidente que las tres piezas son interdependientes: sin auto-pedido, la primitiva de "guest distinguible" no aporta valor; sin sesiones, el auto-pedido no tiene contenedor. Se fusionaron en un único spec end-to-end.

---

## 2. Objetivos y no-objetivos

### Objetivos

1. **Reducir la fricción del comensal a 0**: ordenar funciona sin registrarse, sumar puntos es opcional.
2. **Reducir la fricción del mozo**: ya no recolecta datos al sentar al grupo, sólo confirma comandas y cobra.
3. **Atribución justa**: cada comensal que se registra acumula puntos sólo por lo que él pidió.
4. **Coexistencia de puntos y punch cards**: el bar puede ofrecer "5 cafés = 1 gratis" en paralelo al wallet de puntos genéricos.
5. **Operatividad real en bar argentino**: mesas que se juntan/separan, comensales que llegan tarde/se van antes, ítems compartidos, pedidos de palabra al mozo, fallos de stock.
6. **Seguridad multi-tenant intacta**: mantener el patrón RLS y aislamiento existente.

### No-objetivos (fuera de scope, ver §11)

- Cubierto, propina y descuentos por horario.
- KDS pulido por estación de cocina.
- Promociones automáticas en carta (2x1, happy hour).
- Pagos dentro de la app (Mercado Pago u otro).
- Partial checkout (un comensal paga su parte y se va antes).
- Reservas pre-asignadas a sesión.
- Multi-language y notificaciones push fuera del navegador.

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│  TENANT (bar)                                                    │
│                                                                  │
│  ┌────────────────────┐      ┌────────────────────────────────┐ │
│  │ physical_tables    │      │ menu_categories / menu_items   │ │
│  │ (estática)         │      │ + item_tags (nuevo)            │ │
│  │ qr_token rotativo  │      └────────────────────────────────┘ │
│  └─────────┬──────────┘                       ↑                 │
│            │ apunta                           │ referencia      │
│            ↓                                  │                 │
│  ┌────────────────────┐  contiene  ┌────────────────────────┐   │
│  │ table_sessions     │ ────→ N    │ tickets (comandas)     │   │
│  │ open|paid|merged|  │            │ pending → preparing →  │   │
│  │ abandoned          │            │ ready → served         │   │
│  └────┬───────────────┘            └─────────┬──────────────┘   │
│       │ 1:N                                  │ 1:N              │
│       ↓                                      ↓                  │
│  ┌────────────────────┐                ┌──────────────────┐     │
│  │ session_guests     │ ←─atribuye─┐   │ ticket_items     │     │
│  │ (celulares)        │            └───│ (pedidos)        │     │
│  └─────────┬──────────┘                └──────────────────┘     │
│            │ opcional                                           │
│            ↓                                                    │
│  ┌────────────────────┐    ┌─────────────────────────────┐      │
│  │ customers          │ ──→│ punch_card_templates +      │      │
│  │ + points_balance   │    │ customer_punch_cards (nuevo)│      │
│  └────────────────────┘    └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Entidades centrales

- **`physical_tables`** — el inventario de muebles. "Mesa 5", "Barra 1". Una fila por mesa, vida indefinida. Tiene un `qr_token` que rota cuando termina cada sesión, así un escaneo viejo no se mete en la próxima.

- **`table_sessions`** — la primitiva central. Una fila por grupo que se sienta. Vive desde el primer escaneo hasta `paid_at`. Acumula tickets, guests y total. Estados: `open | paid | merged | abandoned`.

- **`session_guests`** — un celular escaneando. Identificado por `browser_token` (nanoid en localStorage). Anónimo distinguible por default; al registrarse para puntos, su `customer_id` se completa.

- **`tickets`** — comandas atómicas. Cada vez que un guest toca "Realizar orden" o el mozo agrega de palabra, nace un ticket. Ciclo: `pending → accepted → preparing → ready → served` (o `cancelled`).

- **`ticket_items`** — los productos pedidos en una comanda. Snapshot de precio. Cada ítem se asigna a un guest específico o se marca como compartido.

- **`punch_card_templates` + `customer_punch_cards`** — sistema de tarjetas perforadas paralelo a los puntos. Trigger configurable: ítem específico, categoría o tag.

- **`item_tags` + `menu_item_tag_assignments`** — sistema de tags sobre ítems de carta (#cafe, #vegano), análogo al existente `customer_tags`. Habilita el trigger "tag" de las punch cards.

- **`table_session_events`** — mini-ledger de eventos de auditoría/realtime de la sesión (apertura, pedido de cuenta, pago, merge, split, abandono, alta de guest, registro de cliente).

### Decoupling clave

`physical_tables` (estable, ~20 filas por bar) está separada de `table_sessions` (efímera, ~50 filas por noche). Esto permite:

- Misma mesa con varios grupos por noche.
- Mover un grupo a otra mesa sin perder su historia (`session.physical_table_id` cambia).
- Mergear/splitear sesiones sin tocar el inventario físico.
- Reportes "¿cuánto rinde la mesa 5?" en una sola query.

---

## 4. Modelo de datos

### 4.1 `physical_tables`

```sql
create table public.physical_tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 40),
  capacity    int check (capacity is null or capacity > 0),
  qr_token    text not null default public.generate_qr_token(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index physical_tables_tenant_token_uidx
  on public.physical_tables(tenant_id, qr_token);
create index physical_tables_tenant_active_idx
  on public.physical_tables(tenant_id, active);
```

`generate_qr_token()` produce un nanoid de 16 chars. Trigger `on update` para `updated_at`.

### 4.2 `table_sessions`

```sql
create type public.session_status as enum ('open', 'paid', 'merged', 'abandoned');

create table public.table_sessions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  physical_table_id   uuid references public.physical_tables(id) on delete set null,
  status              session_status not null default 'open',
  opened_at           timestamptz not null default now(),
  paid_at             timestamptz,
  merged_into         uuid references public.table_sessions(id),
  opened_by           uuid references auth.users(id) on delete set null,
  total_cents         bigint not null default 0 check (total_cents >= 0),
  abandoned_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Una sesión open por mesa a la vez:
create unique index table_sessions_one_open_per_table_uidx
  on public.table_sessions(physical_table_id)
  where status = 'open';

create index table_sessions_tenant_status_idx
  on public.table_sessions(tenant_id, status, opened_at desc);
```

`total_cents` se mantiene denormalizado por trigger sobre `ticket_items` (suma de líneas no-canceladas).

### 4.3 `session_guests`

```sql
create table public.session_guests (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.table_sessions(id) on delete cascade,
  browser_token       text not null,
  display_name        text,
  customer_id         uuid references public.customers(id) on delete set null,
  joined_at           timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create unique index session_guests_token_uidx
  on public.session_guests(session_id, browser_token);
create index session_guests_customer_idx
  on public.session_guests(customer_id) where customer_id is not null;
```

`last_activity_at` se actualiza con cada acción del guest (RPC pública). Habilita la lógica de "guest inactivo".

### 4.4 `tickets`

```sql
create type public.ticket_status as enum (
  'pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'
);

create table public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  status                ticket_status not null default 'pending',
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  submitted_at          timestamptz not null default now(),
  accepted_at           timestamptz,
  accepted_by_user_id   uuid references auth.users(id) on delete set null,
  prepared_at           timestamptz,
  served_at             timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  total_cents           bigint not null default 0,
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (
    (created_by_guest_id is not null and created_by_user_id is null) or
    (created_by_guest_id is null and created_by_user_id is not null)
  )
);

create unique index tickets_idempotency_uidx
  on public.tickets(session_id, idempotency_key)
  where idempotency_key is not null;
create index tickets_session_idx
  on public.tickets(session_id, submitted_at desc);
create index tickets_tenant_pending_idx
  on public.tickets(tenant_id, status, submitted_at)
  where status in ('pending', 'accepted', 'preparing', 'ready');
```

### 4.5 `ticket_items`

```sql
create table public.ticket_items (
  id                      uuid primary key default gen_random_uuid(),
  ticket_id               uuid not null references public.tickets(id) on delete cascade,
  menu_item_id            uuid not null references public.menu_items(id) on delete restrict,
  quantity                int not null check (quantity > 0),
  unit_price_cents        bigint not null check (unit_price_cents >= 0),
  line_total_cents        bigint not null check (line_total_cents >= 0),
  assigned_to_guest_id    uuid references public.session_guests(id) on delete set null,
  notes                   text,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz not null default now()
);

create index ticket_items_ticket_idx on public.ticket_items(ticket_id);
create index ticket_items_assigned_idx
  on public.ticket_items(assigned_to_guest_id)
  where assigned_to_guest_id is not null;
```

`assigned_to_guest_id IS NULL` → ítem compartido (cocina mesa, no atribuye puntos a nadie).

### 4.6 `item_tags` y `menu_item_tag_assignments`

```sql
create table public.item_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  color       text not null default '#94a3b8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.menu_item_tag_assignments (
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  tag_id        uuid not null references public.item_tags(id) on delete cascade,
  primary key (menu_item_id, tag_id)
);
```

### 4.7 `punch_card_templates` y `customer_punch_cards`

```sql
create type public.punch_trigger_type as enum ('item', 'category', 'tag');

create table public.punch_card_templates (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 80),
  description          text,
  image_url            text,
  trigger_type         public.punch_trigger_type not null,
  trigger_ref_id       uuid not null,  -- → menu_items|menu_categories|item_tags según type
  threshold            int not null check (threshold > 0),
  reward_id            uuid not null references public.rewards(id) on delete restrict,
  expires_after_days   int check (expires_after_days is null or expires_after_days > 0),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index punch_card_templates_tenant_idx
  on public.punch_card_templates(tenant_id, active);

create table public.customer_punch_cards (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  customer_id              uuid not null references public.customers(id) on delete cascade,
  template_id              uuid not null references public.punch_card_templates(id) on delete restrict,
  current_stamps           int not null default 0 check (current_stamps >= 0),
  threshold_snapshot       int not null check (threshold_snapshot > 0),  -- snapshot del threshold del template al crear
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  expired_at               timestamptz,
  reward_redemption_id     uuid references public.reward_redemptions(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  check (current_stamps <= threshold_snapshot)
);

create unique index customer_punch_cards_active_uidx
  on public.customer_punch_cards(customer_id, template_id)
  where completed_at is null and expired_at is null;
create index customer_punch_cards_customer_idx
  on public.customer_punch_cards(customer_id);
```

### 4.8 `table_session_events`

```sql
create type public.session_event_type as enum (
  'session_opened', 'guest_joined', 'guest_registered',
  'bill_requested', 'session_paid', 'session_merged',
  'session_split', 'session_abandoned', 'session_moved'
);

create table public.table_session_events (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.table_sessions(id) on delete cascade,
  type                  public.session_event_type not null,
  created_by_guest_id   uuid references public.session_guests(id) on delete set null,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index table_session_events_session_idx
  on public.table_session_events(session_id, created_at desc);
```

### 4.9 Configuración de tenant

La configuración nueva vive en `tenants` (no se crea tabla aparte, mantenemos consistencia con el patrón actual del proyecto):

```sql
alter table public.tenants add column
  guest_idle_hours_to_rescan int not null default 2
  check (guest_idle_hours_to_rescan > 0);

alter table public.tenants add column
  session_auto_abandon_hours int not null default 8
  check (session_auto_abandon_hours > 0);

alter table public.tenants add column
  ticket_auto_accept_enabled boolean not null default false;

alter table public.tenants add column
  ticket_auto_accept_max_cents bigint
  check (ticket_auto_accept_max_cents is null or ticket_auto_accept_max_cents > 0);

alter table public.tenants add column
  ticket_auto_accept_max_items int
  check (ticket_auto_accept_max_items is null or ticket_auto_accept_max_items > 0);
```

### 4.10 Deprecaciones

- **`visits`** y **`visit_items`** dejan de recibir escrituras. Se reemplazan por la vista `public.v_visits` que reconstruye una visita por cada `(session_id, customer_id)` cobrado, con sus ítems. Las tablas físicas se mantienen para datos históricos pero quedan marcadas como deprecadas.

- **`close_table` RPC** queda deprecada. Su lógica se redistribuye en `mark_session_paid` + el motor de puntos extendido.

---

## 5. RLS y acceso público

Todas las tablas de negocio aplican el patrón `tenant_isolation` estándar del proyecto, escalonado según rol:

- **`physical_tables`, `punch_card_templates`, `item_tags`** — escritura solo `owner`.
- **`table_sessions`, `tickets`, `ticket_items`, `session_guests`, `table_session_events`** — lectura para todos los roles del tenant; escritura solo a través de RPCs `SECURITY DEFINER`.
- **`customer_punch_cards`** — lectura por todos los roles del tenant; escritura solo vía RPC.

### Lectura del progreso de loyalty desde la carta del comensal

El comensal registrado debe poder ver, en la pantalla de cierre o en una sección "Mi cuenta" de la carta, su `points_balance` y el progreso de sus `customer_punch_cards`. Esto se expone vía la RPC pública `get_loyalty_state(qr_token, browser_token)`, que valida que el `customer_id` del guest corresponde y devuelve solo los datos de ese cliente. Nunca se expone la tabla a `anon` directo.

### Acceso público (anon vía qr_token)

El comensal nunca toca tablas directamente. Todo pasa por RPCs `SECURITY DEFINER` que validan el `qr_token` y operan en nombre del comensal:

```
get_session_state(qr_token, browser_token)
join_session_as_guest(qr_token, browser_token, display_name?)
submit_ticket(qr_token, browser_token, items[], idempotency_key)
cancel_pending_ticket(ticket_id, browser_token)
register_customer_for_session(qr_token, browser_token, phone, first_name, last_name, birthdate, opt_in_marketing)
request_bill(qr_token, browser_token)
```

Cada una:
- Verifica `qr_token` válido y mesa activa.
- Verifica que el `browser_token` corresponde a un guest de la sesión activa (excepto `join_session_as_guest`).
- Toma lock pesimista sobre la sesión (`SELECT ... FOR UPDATE`).
- Aplica rate limiting (10 req/min por browser_token).
- Actualiza `last_activity_at` del guest.
- Registra evento en `table_session_events` cuando corresponde.

### GRANTs requeridos

Por la nueva regla de Supabase (30/05/2026), todas las tablas nuevas en `public` requieren GRANT explícito para el Data API:

```sql
grant select, insert, update, delete on public.physical_tables to authenticated;
grant select, insert, update, delete on public.table_sessions to authenticated;
-- ...etc para cada tabla nueva, según la matriz de permisos.
```

Las tablas accesibles vía RPC desde anon **no** necesitan GRANT a `anon` — las RPCs `SECURITY DEFINER` operan con permisos del owner de la función.

---

## 6. Flujos de usuario

### 6.1 Comensal (cliente final)

1. **Escanea QR físico** de la mesa → URL `/m/<qr_token>`.
2. **Llega a la carta**. Banner persistente: *"Sumá puntos en cada pedido →"* (opcional, no bloqueante).
3. **(Opcional) Se registra para puntos**. Modal con celular + nombre + apellido + cumpleaños. Si el celular ya existe en `customers`, se asocia (no duplica).
4. **Arma su carrito privado** desde la carta. Puede asignar ítems a sí mismo (default) o marcarlos como "shared". Notas por ítem.
5. **Toca "Realizar orden"** → comanda creada. Si el tenant tiene `ticket_auto_accept_enabled` y la comanda está dentro de los caps configurados (monto y cantidad de ítems), entra directo a `accepted`. Si no, queda en `pending` y la pantalla muestra "Esperando confirmación del mozo".
6. **Mozo confirma** (cuando aplica) → comanda pasa a `accepted`, cocina la recibe.
7. **Tracking en vivo** en pestaña "Mis órdenes": `accepted → preparing → ready → served`. Solo ve sus propias comandas.
8. **Más rondas**: vuelve a la carta y repite los pasos 4-7.
9. **Toca "Pedir la cuenta"** (opcional) → notifica al mozo, sin bloquear nuevos pedidos.
10. **Mozo cobra** (cash/tarjeta/lo que sea) y marca `paid_at` desde su panel.
11. **Pantalla de cierre** (solo guests registrados): puntos sumados, balance actualizado, progreso de punch cards, CTA opt-in marketing.

### 6.2 Mozo

**Dashboard de sesiones** (`/[tenantSlug]/sesiones`): grilla mobile-first con todas las sesiones `open` del tenant. Cada card: mesa, # guests, tiempo abierta, total acumulado, alertas (`pending`, `bill_requested`).

**Vista detalle de sesión**:
- Header: total, tiempo abierta, botones (Cobrar, Cerrar como abandoned, Split, Merge, Move).
- Lista de guests con badges (registrado / anónimo / inactivo > 30m).
- Lista cronológica de comandas con estado e ítems. Botones contextuales por estado.
- Botón "Agregar comanda de mozo" → abre carta interna, asigna a guest específico o shared.

**Operaciones especiales**:
- **Cobrar** (`mark_session_paid`): muestra desglose por guest, total general, confirmación. Atómico.
- **Split**: selecciona ítems y guests → arma sub-sesión nueva → asigna mesa nueva. Guests se reconectan vía Realtime.
- **Merge**: selecciona otra sesión `open` → la actual absorbe sus ítems y guests.
- **Move**: cambia `physical_table_id` a otra mesa libre.
- **Cerrar como abandoned**: sin generar puntos, deja registro auditable.

**Notificaciones**:
- Audio + push en navegador cuando entra `pending` o `bill_requested` (configurable por usuario).
- Badge numérico siempre visible.

### 6.3 Cocina (KDS lite)

Vista dedicada `/[tenantSlug]/cocina`, apuntada a una tablet en cocina. Solo visible para users con rol `kitchen` o `owner`.

Cola de comandas activas, ordenadas por antigüedad. Por comanda: mesa, número, hora de aceptación, ítems con qty y notas, tiempo transcurrido. Acciones:
- **Empezar** → `accepted → preparing` (timer arranca).
- **Listo** → `preparing → ready` (notifica al mozo).
- **Sin stock** sobre un ítem específico → cancela ese ítem, notifica guest origen y mozo.

Filtros por sección (caliente/barra/postres) son post-MVP. Para MVP, una sola vista global.

### 6.4 Owner / configuración

Tres pantallas nuevas en `/[tenantSlug]/configuracion`:

- **Mesas** (`/configuracion/mesas`): CRUD de `physical_tables`. Botón "Imprimir QR" genera PDF con QR + label. Botón "Regenerar QR" rota el token (útil si se filtró).
- **Punch Cards** (`/configuracion/punch-cards`): CRUD de templates. Form con trigger (item/categoría/tag), threshold, reward asociada, vencimiento opcional.
- **Auto-aceptación** (`/configuracion/auto-aceptacion`): toggle ON/OFF + caps de monto y cantidad de ítems.

Más una pantalla nueva en CRM:
- **Tags de ítems** (`/configuracion/tags`): CRUD de `item_tags` y asignación a `menu_items`.

---

## 7. RPCs y Server Actions

### 7.1 RPCs públicas (anon, SECURITY DEFINER, vía qr_token)

| RPC | Propósito |
|---|---|
| `get_session_state(qr_token, browser_token)` | Snapshot completo: sesión + carta + guests + tickets propios |
| `join_session_as_guest(qr_token, browser_token, display_name?)` | Crea guest si nuevo, reconecta si existe |
| `submit_ticket(qr_token, browser_token, items[], idempotency_key)` | Comanda en `pending` |
| `cancel_pending_ticket(ticket_id, browser_token)` | Solo si `pending` y dentro de 60s |
| `register_customer_for_session(qr_token, browser_token, phone, first_name, last_name, birthdate, opt_in_marketing)` | Crea/asocia customer; reutiliza lógica de `submit_capture` |
| `request_bill(qr_token, browser_token)` | Escribe evento `bill_requested` |
| `get_loyalty_state(qr_token, browser_token)` | Devuelve points_balance + punch cards activas del customer asociado al guest |

### 7.2 RPCs autenticadas (waiter / cashier / owner / kitchen, SECURITY DEFINER)

Los roles de DB son: `owner | cashier | waiter | kitchen` (donde `kitchen` es nuevo en este spec).

| RPC | Roles permitidos | Propósito |
|---|---|---|
| `accept_ticket(ticket_id)` | waiter, owner | `pending → accepted` |
| `reject_ticket(ticket_id, reason)` | waiter, owner | `pending → cancelled` con motivo |
| `update_ticket_status(ticket_id, new_status)` | waiter, kitchen, owner | Avanza estados; kitchen solo puede ir a `preparing` o `ready`; `served` lo hace waiter/owner |
| `cancel_ticket_item(ticket_item_id, reason)` | kitchen, waiter, owner | Cancela ítem específico (sin stock) |
| `add_staff_ticket(session_id, items[], assigned_to_guest_id?)` | waiter, owner | Comanda de palabra creada por staff |
| `mark_session_paid(session_id)` | waiter, cashier, owner | Atómico: dispara puntos + punch cards + rota qr_token |
| `mark_session_abandoned(session_id, reason)` | waiter, owner | Sin generar puntos |
| `merge_sessions(survivor_id, absorbed_ids[])` | waiter, owner | Atómico: ítems y guests migran |
| `split_session(source_id, splits jsonb)` | waiter, owner | Atómico: produce N sesiones consistentes |
| `move_session(session_id, new_physical_table_id)` | waiter, owner | Cambia mesa física asignada |
| `regenerate_qr_token(physical_table_id)` | owner | Rota manualmente el token de una mesa |

### 7.3 RPCs de cron (servicio, vía CRON_SECRET)

| RPC | Frecuencia | Propósito |
|---|---|---|
| `auto_abandon_stale_sessions()` | Cada hora | Marca como `abandoned` sesiones con > 8h sin actividad de ningún guest |
| `expire_punch_cards()` | Diario | Marca `expired_at` en cards que vencieron |

### 7.4 Server Actions (Next.js)

Capa fina sobre las RPCs:
- Validación con zod en cada borde de input.
- Auth: `requireTenantAccess` + `requireRole`.
- `revalidatePath` post-mutación.
- Normaliza errores SQL → mensajes accionables en UI.

Nada de lógica de negocio en Server Actions; toda la lógica vive en RPCs SQL para garantizar atomicidad y RLS.

### 7.5 Lógica atómica de `mark_session_paid`

Esta RPC es el corazón del cierre. Pasos en una sola transacción con lock pesimista sobre la sesión:

1. Verifica que la sesión está en `open`. Si está en otro estado, error explícito (`paid` → idempotente no-op; `merged|abandoned` → error).
2. Calcula puntos por cada `session_guests.customer_id` no nulo, usando `points_rules` activas, sumando sólo sus `ticket_items` no cancelados (incluye los `assigned_to_guest_id = guest`, excluye los `shared` con `assigned_to_guest_id IS NULL`).
3. Inserta entradas en `points_transactions` (ledger inmutable) por cada cliente.
4. Para cada `(customer_id, ticket_item)` que matchee algún `punch_card_templates` activo (matching por `trigger_type` + `trigger_ref_id` contra el `menu_item_id` o su categoría/tag, multiplicado por `quantity` del ítem):
   - **Si el cliente no tiene card activa para ese template** (no existe fila con `completed_at IS NULL AND expired_at IS NULL`), se crea una nueva con `current_stamps = qty_matched` (o `threshold_snapshot` si excede), `threshold_snapshot = template.threshold`.
   - **Si tiene card activa**, se incrementa `current_stamps += qty_matched`, sin exceder `threshold_snapshot`.
   - **Si la card alcanza `threshold_snapshot`**, se marca `completed_at = now()` y se crea una entrada en `reward_redemptions` con `status = 'pending'` (lista para que el cliente canjee la próxima visita) referenciada en `reward_redemption_id`.
5. Actualiza `customers.points_balance` (suma del delta de points_transactions), `total_visits += 1` por cada customer_id presente, `total_spent_cents += suma de sus ticket_items`, `last_visit_at = now()`.
6. Marca `table_sessions.paid_at = now()`, `status = 'paid'`, recalcula `total_cents` definitivo.
7. Si la sesión tiene `physical_table_id` no nulo, rota `physical_tables.qr_token` para invalidar escaneos viejos. Si es huérfana, omite este paso.
8. Inserta evento `session_paid` en `table_session_events` con `payload` que incluye breakdown por customer.

Si algo falla → rollback total. Re-llamada sobre sesión `paid` retorna éxito sin efecto (idempotente).

---

## 8. Realtime

### Canales Supabase Realtime

- **`session:<session_id>`**: comensales suscriptos al estado de sus tickets, cancelaciones, paid event.
- **`tenant:<tenant_id>:tickets`**: panel del mozo recibe cambios de estado de cualquier ticket.
- **`tenant:<tenant_id>:sessions`**: cambios de sesión (open, paid, abandoned, merged).
- **`tenant:<tenant_id>:kitchen`**: cocina filtra por `status in (accepted, preparing, ready)`.

### Estrategia

- `postgres_changes` sobre las tablas relevantes (default).
- Triggers SQL emiten cambios automáticamente.
- Cliente: `supabase-js` v2 con suscripciones por canal.
- Optimistic UI en mozo y comensal (acciones se reflejan local antes de confirmación de red).
- Reconexión automática: al perder conexión, al reconectar se llama `get_session_state` para resincronizar.

### Límites

- ~100 conexiones concurrentes por tenant en escenario HUB. Supabase soporta cómodamente.
- No se usa polling.

---

## 9. Edge cases

| Caso | Manejo |
|---|---|
| Dos guests submit al mismo tiempo | Lock pesimista en sesión → tickets se serializan |
| Mozo confirma un ticket dos veces | RPC idempotente: si ya `accepted`, no-op |
| Cocina marca ready, mozo nunca marca served | Vista del mozo destaca tickets `ready > 5 min` (alerta visual) |
| Cliente cierra navegador y vuelve a abrir | `browser_token` en localStorage lo reconecta |
| Cliente borra cookies / cambia celular | Pierde su slot; al re-unirse es guest nuevo. Lo registrado en `customers` por phone se recupera al re-registrarse |
| Mozo pierde conexión | Server Actions fallan con error claro; al reconectar ve todo |
| Cocina cancela ítem por sin stock | Notifica al guest origen y mozo; `line_total` se descuenta del total de la comanda |
| Sesión > 8h sin actividad de ningún guest | Cron `auto_abandon_stale_sessions` la pasa a `abandoned`, sin puntos |
| Tenant elimina un menu_item con tickets activos | Soft-delete en `menu_items`; los `ticket_items` mantienen el snapshot de precio |
| Owner cambia precio de ítem con tickets pendientes | Sólo aplica a comandas nuevas; el snapshot en `ticket_items.unit_price_cents` no cambia |
| qr_token comprometido | Owner: "Regenerar QR" → rota token; URLs viejas invalidadas |
| Network split: comensal pide, no llega | Reintento con `idempotency_key` (UUID generado en cliente). Doble llegada → segundo se descarta |
| Guest inactivo > 2h intenta enviar ticket | Bloqueo + mensaje "Re-escaneá el QR para confirmar que seguís en la mesa" |
| Punch card vence antes de completarse | Cron `expire_punch_cards` marca `expired_at`; el cliente puede empezar nueva |
| Comensal escanea pero la mesa no tiene sesión open | Se crea sesión nueva automáticamente |
| Comensal escanea pero la mesa fue mergeada | Redirige al `qr_token` de la sesión sobreviviente |

---

## 10. Testing

Siguiendo la política del `CLAUDE.md` (unit + RLS, sin E2E, smoke manual).

### Unit (Vitest)

- Motor de puntos extendido (cálculo per-guest sobre comandas).
- Lógica de punch cards (avance de stamps, completed, expired, restart).
- Validación de ticket items (precio, qty, asignaciones).
- Resolución de qr_token a sesión.
- Idempotency keys.
- Lógica de `last_activity_at` y rescan.

### Tests SQL de RLS

- Anon con qr_token válido puede leer su sesión y crear guests/tickets.
- Anon con qr_token expirado/inexistente → bloqueado.
- User de tenant A no ve sesiones de tenant B.
- Cashier no puede ejecutar `merge_sessions` (solo mozo+ o owner).
- Kitchen role solo puede mover tickets a `preparing/ready`, no a `accepted` ni `served`.

### Tests SQL de RPCs

- `mark_session_paid` es atómico: si falla a mitad, rollback completo.
- `merge_sessions` no pierde tickets ni guests; los punteros quedan consistentes.
- `split_session` produce N sesiones con totales consistentes.
- `auto_abandon_stale_sessions` solo afecta sesiones con > 8h y respeta el límite por tenant.

### Smoke manuales documentados en cada PR

- Cliente escanea, registra, pide, ve estado, paga, ve puntos.
- Mozo confirma, agrega comanda de palabra, cobra.
- Cocina avanza estados, marca sin stock.
- Owner crea mesa, imprime QR, crea punch card, configura auto-aceptación.
- Split de mesa de 6 en 2+4.
- Re-scan después de timeout.
- Cron de abandoned sobre sesión simulada.

---

## 11. Fuera de scope

Confirmación explícita de qué **no** entra en este spec:

- **Cubierto, propina, descuentos por horario.**
- **KDS pulido por estación** (cocina caliente / barra / postres).
- **Promociones automáticas** en carta (2x1, happy hour).
- **Pago dentro de la app** (Mercado Pago u otro).
- **Partial checkout** (un comensal paga su parte y se va antes).
- **Reservas pre-asignadas a sesión** — la mesa se sigue abriendo con el primer escaneo.
- **Multi-language** (todo en `es-AR`).
- **Notificaciones push fuera del navegador** (sin PWA / Web Push para MVP).
- **Geofencing GPS** sobre la posición del comensal.

Estos quedan como specs futuros si el feature core valida.

---

## 12. Resumen de cambios en el stack

### Tablas nuevas

`physical_tables`, `table_sessions`, `session_guests`, `tickets`, `ticket_items`, `item_tags`, `menu_item_tag_assignments`, `punch_card_templates`, `customer_punch_cards`, `table_session_events`.

### Tablas modificadas

- `tenants`: + columnas de configuración (`guest_idle_hours_to_rescan`, `ticket_auto_accept_*`).
- `customers`: triggers para sumar `points_balance` y avanzar punch cards al marcar paid.

### Tablas deprecadas

`visits`, `visit_items` (reemplazadas por la vista `v_visits` reconstruida desde sesiones cobradas).

### RPCs nuevas

~17 listadas en §7. Las RPCs públicas (anon vía qr_token) son `SECURITY DEFINER` con rate limiting.

### Roles nuevos

`kitchen` se suma a los existentes (`owner | cashier | waiter`). Permisos: lectura de tickets de su tenant, escritura de status `preparing/ready` y cancelación de ítems por sin stock. Sin acceso a otras tablas operativas.

### Páginas nuevas

- `/m/[qr_token]` (carta pública del comensal — anónima).
- `/[tenantSlug]/sesiones` (dashboard mozo).
- `/[tenantSlug]/cocina` (KDS lite).
- `/[tenantSlug]/configuracion/mesas`.
- `/[tenantSlug]/configuracion/punch-cards`.
- `/[tenantSlug]/configuracion/auto-aceptacion`.
- `/[tenantSlug]/configuracion/tags`.

### Variables de entorno nuevas

Ninguna. Se reutilizan las existentes (`SUPABASE_*`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`).

---

## 13. Decisiones cerradas durante el brainstorming

Para referencia rápida al implementar:

- **Sesión = primitiva central**, desacoplada del QR físico.
- **QR físico fijo** en la mesa, sistema soporta split/merge/move desde panel del mozo.
- **Registro opcional** para puntos; ordering nunca se bloquea por no registrarse.
- **Guests distinguibles** por `browser_token` (localStorage del celular).
- **Ítems compartidos**: puntos al guest que originó el pedido (sin reparto).
- **Puntos se procesan al marcar paid**, no al pedir.
- **Mozo confirma cada ticket** por default; auto-aceptación es toggle del owner con caps.
- **Punch cards y puntos coexisten** como sistemas paralelos.
- **Trigger de punch card configurable**: item, categoría o tag.
- **Carrito privado por guest**, pero la cuenta es única por sesión.
- **Visibilidad de tickets**: cada guest ve solo los suyos.
- **Pago**: el mozo cobra; el comensal puede tocar "Pedir la cuenta" para alertarlo.
- **Sesiones huérfanas** > 8h sin actividad → estado `abandoned`.
- **Defensa contra órdenes a distancia**: indicador de inactividad para el mozo + hard timeout configurable + re-scan de QR.

---
