# Diseño: Mover ítems entre mesas

**Fecha:** 2026-06-08
**Estado:** Aprobado (pendiente de plan de implementación)
**Workspace:** `(salon)` — staff (mozo/dueño), mobile PWA

---

## 1. Problema

El staff carga consumo en una mesa al momento de cobrar/atender. Hay **errores de carga**: un producto queda cargado en la mesa equivocada. Hoy la única corrección posible es cancelar el ítem en una mesa y volver a cargarlo en otra (dos pasos, pierde trazabilidad y rompe la asignación al cliente). Necesitamos **mover ítems de una mesa a otra** de forma atómica y trazable.

No existe hoy ningún mecanismo de mover/transferir a nivel de ítem. Sí existen operaciones de sesión completas (`move_session`, `split_session`, `merge_sessions`).

---

## 2. Decisiones de alcance (cerradas con el product owner)

| Tema | Decisión |
|---|---|
| **Granularidad** | Mover ítems sueltos seleccionados **y** comanda entera (la comanda entera = seleccionar todos sus ítems activos). |
| **Mesa destino** | Cualquier mesa: ocupada (sesión abierta) **o** libre (se abre sesión nueva al mover). |
| **Cantidad** | Se permite mover **cantidad parcial** (ej. 2 de 3). |
| **Roles** | `owner` y `waiter` (mismo criterio que `move_session`). |
| **UI** | Hoja de selección (clon del patrón `MoveTableSheet`). Sin drag-and-drop en esta fase. |
| **Cocina** | Mover **nunca** crea un pedido nuevo de cocina. Los ítems movidos llegan al destino como `served` (fuera del KDS). |
| **Asignación al cliente** | El ítem **va siempre con su cliente** (registrado o guest anónimo), con **opción de reasignar** a un comensal del destino o dejarlo compartido. |

---

## 3. Modelo de datos relevante (verificado)

Cadena ítem → mesa (no hay `table_id` en el ítem):

```
ticket_items.ticket_id        -> tickets.id
tickets.session_id            -> table_sessions.id
table_sessions.physical_table_id -> physical_tables.id
```

Identificadores clave:

- **`ticket_items`** (`supabase/migrations/20260506110100_plan2_tickets_tables.sql`): `id`, `ticket_id` (FK → `tickets`, `on delete cascade`), `menu_item_id`, `quantity int check >0`, `unit_price_cents bigint`, `line_total_cents bigint`, `assigned_to_guest_id` (FK → `session_guests`, `on delete set null`), `notes`, `cancelled_at`, `cancellation_reason`. **Sin `tenant_id`** (aislamiento heredado por la cadena).
- **`tickets`**: `id`, `tenant_id`, `session_id`, `status` (`ticket_status`), `created_by_guest_id` XOR `created_by_user_id`, `total_cents`, `idempotency_key`, timestamps de ciclo de vida.
- **`table_sessions`**: `id`, `tenant_id`, `physical_table_id`, `status` (`session_status`), `total_cents`, `opened_at`, `paid_at`, `merged_into`. Constraint: una sola sesión `open` por mesa física.
- **`session_guests`** (`20260506100300_plan1_session_guests.sql`): `id`, `session_id` (FK → `table_sessions`, cascade), `browser_token text not null` (16–64 chars, **único por sesión**), `display_name` (nullable, 1–40), `customer_id` (FK → `customers`, `on delete set null`, **nullable**), `joined_at`, `last_activity_at`. **Sin policy de write para authenticated → solo vía RPC `SECURITY DEFINER`.**
- **`table_session_events`**: usado para eventos de sesión (`session_moved`, `session_split`, `session_paid`, …). Lo seguimos con un nuevo `type='items_moved'`.

Enums:
- `session_status` = `open | paid | merged | abandoned`
- `ticket_status` = `pending | accepted | preparing | ready | served | cancelled`

Recálculo de totales (triggers existentes, `20260506110100`):
- `recalc_ticket_total()` (AFTER insert/update/delete en `ticket_items`): suma `line_total_cents WHERE cancelled_at IS NULL` → `tickets.total_cents`, y cascada a `table_sessions.total_cents`. Usa `coalesce(new.ticket_id, old.ticket_id)`.
- `recalc_session_on_ticket_status()` (AFTER cambio de status de ticket): re-suma `tickets.total_cents WHERE status <> 'cancelled'`.

> **Trampa de totales:** un `UPDATE ticket_items SET ticket_id = …` crudo recalcula **solo una** comanda → dejaría el total del origen desactualizado. Por eso el enfoque es **aditivo** (insertar en destino + descontar en origen): se tocan filas en ambas comandas y los triggers disparan en los dos lados.

Cómo `mark_session_paid` (`20260529120100`) usa la asignación:
- Arma la cuenta y los puntos **por comensal** con `ti.assigned_to_guest_id`.
- **Solo crea visita + puntos para comensales con `customer_id` no nulo.** Ítems compartidos (`assigned_to_guest_id IS NULL`) o asignados a guests anónimos no generan puntos.
- Por eso es crítico que, al mover, el ítem **conserve su cliente registrado**: si quedara sin asignar, ese consumo no sumaría puntos ni entraría en la división de cuenta.

Precedentes a imitar:
- `add_staff_ticket(p_session_id, p_items jsonb, p_assigned_to_guest_id)` — crea comanda `accepted`, valida que el guest pertenece a la sesión, inserta ítems. Plantilla del “insertar en destino”.
- `cancel_ticket_item(p_ticket_item_id, p_reason)` — soft-cancel. Plantilla del “descontar en origen (total)”.
- `split_session(p_source_id, p_target_table_id, p_guest_ids[])` — relocaliza comandas a una sesión nueva en otra mesa y recalcula ambos totales; “lleva el cliente” re-puntando `session_guests.session_id`. Precedente estructural más cercano.
- `move_session` — open-only, rol `owner|waiter`, chequea mesa destino libre, emite `table_session_events`.

---

## 4. Backend — migración nueva + RPC `move_ticket_items`

Nueva migración `supabase/migrations/<timestamp>_move_ticket_items.sql` (generar con `npm run db:diff -- move_ticket_items` o `npx supabase migration new move_ticket_items`). Función `SECURITY DEFINER set search_path = ''`.

### Firma

```sql
move_ticket_items(
  p_source_session_id uuid,
  p_target_table_id   uuid,
  p_moves jsonb,          -- [{ "ticket_item_id": uuid, "quantity": int, "assign": text }]
  p_idempotency_key text default null
) returns jsonb           -- { target_session_id, target_ticket_id, moved_count }
```

`assign` por ítem (default `"auto"`):
- `"auto"` → el ítem conserva su cliente (ver §4.3).
- `"shared"` → `assigned_to_guest_id = NULL` en el destino.
- `<guest-uuid>` → asignar a ese comensal (debe pertenecer a la sesión destino).

### 4.1 Validaciones e invariantes

1. **Auth:** `perform public._check_staff_role(v_source.tenant_id, array['owner','waiter'])`.
2. `p_moves` no vacío.
3. Sesión origen existe y `status = 'open'` (`for update`). Si no → `session_not_open` / `session_not_found`.
4. Mesa destino existe y **mismo `tenant_id`** que el origen (chequeo explícito; el RPC bypassa RLS). Si no → `invalid_target_table`.
5. Mesa destino ≠ mesa de la sesión origen → `same_table_move` (no tiene sentido mover a la misma mesa).
6. Cada `ticket_item_id` pertenece a una comanda de la sesión origen y **no está `cancelled`** → `item_not_in_session` / `item_cancelled`.
7. `1 <= quantity <= ticket_items.quantity` de la línea → `invalid_quantity`.

### 4.2 Resolver sesión destino

```
si la mesa destino tiene sesión status='open' -> usar esa (v_target_session_id)
si no -> insert into table_sessions (tenant_id, physical_table_id) status open
         + table_session_events (type='session_opened', payload {"trigger":"items_move"})
```

(No choca con la constraint “una sesión open por mesa”: si existía se reusa; si no, esta es la primera.)

### 4.3 Resolver comensal destino por ítem

Se mantiene un **mapa caché `source_guest_id → target_guest_id`** dentro de la llamada (variable `v_guest_map jsonb`) para no duplicar comensales al mover varios ítems del mismo cliente en un solo movimiento.

Por cada move:
- `assign = 'shared'` → `v_target_guest := NULL`.
- `assign = <uuid>` → validar `exists(session_guests where id=uuid and session_id=v_target_session_id)`; si no → `invalid_assigned_guest`. `v_target_guest := uuid`.
- `assign = 'auto'`:
  - cargar `v_src_guest_id := ticket_items.assigned_to_guest_id` del ítem.
  - si `v_src_guest_id IS NULL` → `v_target_guest := NULL` (compartido sigue compartido).
  - si está en `v_guest_map` → reusar.
  - si no, cargar la fila `session_guests` origen (`customer_id`, `display_name`):
    - **registrado** (`customer_id` no nulo): buscar `session_guests` en destino con mismo `customer_id`; si existe reusar; si no, **insertar** `session_guests(session_id=destino, customer_id, display_name, browser_token := 'mv'||replace(gen_random_uuid()::text,'-',''))`.
    - **anónimo** (`customer_id` nulo): **insertar** `session_guests(session_id=destino, display_name, customer_id=NULL, browser_token := 'mv'||…)`.
  - guardar en `v_guest_map`.

> `browser_token` sintético `'mv'||uuid` (34 chars, dentro de 16–64), único dentro de la sesión destino. Representa al cliente “portado”, sin teléfono real detrás. Para registrados la identidad real es `customer_id`.

### 4.4 Crear comanda destino e insertar ítems

```
-- idempotencia: si ya existe ticket con este idempotency_key, devolverlo y salir
if p_idempotency_key is not null and exists(select 1 from tickets where idempotency_key = p_idempotency_key)
   -> return idempotente

insert into tickets (tenant_id, session_id, status, created_by_user_id,
                     submitted_at, accepted_at, accepted_by_user_id, served_at, idempotency_key)
values (tenant, v_target_session_id, 'served', auth.uid(),
        now(), now(), auth.uid(), now(), p_idempotency_key)
returning id into v_target_ticket_id;
```

Por cada move, insertar en `ticket_items` del `v_target_ticket_id`:
`quantity = qty_movida`, `menu_item_id`, `unit_price_cents` (del ítem origen), `line_total_cents = qty_movida * unit_price_cents`, `assigned_to_guest_id = v_target_guest`, `notes` = nota original + “(movido de {label mesa origen})”.

### 4.5 Descontar del origen

- **Total** (qty_movida == cantidad de la línea): soft-cancel del ítem origen → `cancelled_at = now()`, `cancellation_reason = 'Movido a Mesa {label destino}'`.
- **Parcial**: `update ticket_items set quantity = quantity - qty_movida, line_total_cents = (quantity - qty_movida) * unit_price_cents where id = …`. La línea origen conserva su `assigned_to_guest_id`.

Los triggers recalculan `tickets.total_cents` y `table_sessions.total_cents` en ambos lados (se tocan filas en las dos comandas).

### 4.6 Eventos

```
insert into table_session_events (session_id, type, created_by_user_id, payload) values
 (p_source_session_id, 'items_moved', auth.uid(), {direction:'out', target_session_id, target_ticket_id, moves}),
 (v_target_session_id,  'items_moved', auth.uid(), {direction:'in',  source_session_id, target_ticket_id, moves});
```

### 4.7 GRANTs

```sql
revoke all on function public.move_ticket_items(uuid, uuid, jsonb, text) from public;
grant execute on function public.move_ticket_items(uuid, uuid, jsonb, text) to authenticated;
```

(No se crean tablas nuevas, así que no hacen falta GRANTs de tabla.)

### 4.8 Comportamientos definidos

- Comanda destino en `served` → fuera del KDS (el KDS filtra `accepted|preparing|ready`). `mark_session_paid` incluye `served` (status `<> 'cancelled'`), así que cuenta y puntos quedan correctos.
- Sesión origen que queda sin ítems → **permanece `open`** (el staff decide cerrarla/abandonarla).
- Un cliente registrado puede quedar con consumo en dos mesas tras un movimiento parcial (paga en ambas). Es correcto: refleja la realidad.

---

## 5. Capa lib

- **`lib/tickets/schemas.ts`** — `moveTicketItemsSchema`:
  ```ts
  z.object({
    sourceSessionId: z.string().uuid(),
    targetTableId: z.string().uuid(),
    moves: z.array(z.object({
      ticketItemId: z.string().uuid(),
      quantity: z.coerce.number().int().min(1),
      assign: z.union([z.literal('auto'), z.literal('shared'), z.string().uuid()]).default('auto'),
    })).min(1),
  })
  ```
- **`lib/tickets/actions.ts`** — `moveTicketItemsAction(input)`:
  1. `const { tenant, role } = await requireTenantAccess(slug); await requireRole(role, ['owner','waiter'])`.
  2. `moveTicketItemsSchema.safeParse(...)`.
  3. `await createClient()` → `.rpc('move_ticket_items', { p_source_session_id, p_target_table_id, p_moves, p_idempotency_key })`.
  4. Mapear errores RPC a mensajes accionables (`session_not_open`, `invalid_target_table`, `same_table_move`, `item_not_in_session`, `invalid_quantity`, `invalid_assigned_guest`, …).
  5. `logAudit({ tenantId: tenant.id, userId, action: 'ticket.items_moved', entity: 'table_session', entityId: sourceSessionId, payload: { target_session_id, target_ticket_id, moves } })`.
  6. `revalidatePath('/${slug}/salon/mesas')`, `/mesas/${sourceSessionId}`, `/mesas/${targetSessionId}`, `/salon/cocina`.
  7. Devuelve `ActionState` (`{ ok, message?, data? }`).
- **`lib/floor-plan/queries.ts`** — `getItemMoveTargets(currentSessionId)`: como `getMoveTargets` pero **incluye mesas ocupadas** (agrega `session_id`, `alias`, `total_cents`, `party_size` cuando hay sesión open), excluye la mesa de la sesión actual, agrupa por sector (`area_name`, `area_pos`). Tipo `ItemMoveTarget`.
- **Comensales del destino**: reusar la query/endpoint existente que ya alimenta `SessionDetail`/cobro para poblar el selector de reasignación (carga lazy al elegir mesa destino). No se crea una query nueva si ya existe `getSessionGuests`/snapshot.

---

## 6. UI — hoja de selección

Ruta: `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/`.

- **`ticket-card.tsx`**: modo selección (prop `selectionMode` + `selected`/`onToggle` levantados a `SessionDetail`):
  - Checkbox por ítem activo (oculto para `cancelled_at != null`).
  - Si `quantity > 1`: stepper “mover N de M” (default M).
  - Check de cabecera “seleccionar comanda entera” (marca todos sus ítems activos a cantidad completa).
- **`session-detail.tsx`**:
  - Botón “Mover ítems” (entra/sale de `selectionMode`).
  - Barra sticky inferior “Mover N ítems →” (deshabilitada si N=0) que abre la hoja.
  - Mantiene el estado de selección `{ ticketItemId -> quantity }`.
- **`move-items-sheet.tsx`** (nuevo, clon de `components/floor-plan/move-table-sheet.tsx`):
  1. Carga destinos con `getItemMoveTargets` (loading spinner, error toast). Lista agrupada por sector; cada mesa marca **ocupada** (alias + total) vs **libre**.
  2. Al elegir mesa: control **“Asignar a”** con default *“Mantener el cliente de cada ítem (automático)”* y override opcional → comensales del destino (cargados lazy) o *“Para toda la mesa”*. Si la mesa destino está **libre**, solo se ofrecen *automático* / *toda la mesa* (aún no hay comensales).
  3. Confirmar → `moveTicketItemsAction` con un `idempotencyKey` generado en cliente. Spinner overlay + `sonner` toast de éxito/error. Cierra y sale de `selectionMode`.
  - **MVP**: el override de reasignación aplica a **todo el movimiento** (un solo `assign` para todos los moves). El RPC ya acepta `assign` por ítem, así que el override por ítem es una mejora futura sin tocar backend.
- **Realtime**: `SessionDetail` ya está suscripto a `session-${sessionId}` (`tickets`, `ticket_items`); la grilla a `salon-${tenantId}`; el plano a `live-${tenantId}`; cocina a `kitchen-${tenantId}`. Como el movimiento toca dos sesiones y emite `items_moved`, refrescan ambos detalles y la grilla/plano. La UI tolera que los ítems desaparezcan del origen y aparezcan en el destino.

---

## 7. Seguridad / multi-tenant

- Mutación **solo vía RPC `SECURITY DEFINER`** (las tablas son SELECT-only para `authenticated`).
- El RPC valida **ambas** sesiones/mesas del **mismo tenant** explícitamente (no se apoya solo en RLS, porque la operación abarca dos sesiones y la función bypassa RLS).
- Rol `owner|waiter` chequeado en el RPC (`_check_staff_role`) y en el server action (`requireRole`).
- Auditoría en `audit_log` (`ticket.items_moved`) + eventos `table_session_events` en ambas sesiones.
- Sin PII en logs.

---

## 8. Tests

**Unit (`tests/lib`, Vitest, environment node)** — lógica pura extraíble del schema/normalización:
- Validación de `moveTicketItemsSchema`: `assign` válido/ inválido, `quantity` mínima, `moves` no vacío, default `assign='auto'`.
- Si se extrae un helper para construir el payload de `p_moves` desde la selección de la UI, testearlo (mapear selección → moves).

**RLS / integración (`tests/rls`, Supabase local)** — modelar sobre `tests/rls/tickets.test.ts`:
- Rol no autorizado (`cashier`, `kitchen`) → bloqueado.
- Origen no-`open` → `session_not_open`.
- Cross-tenant (mesa destino de otro tenant) → bloqueado.
- Mover **parcial** parte la línea: origen queda con `quantity` reducida, destino con la qty movida; `total_cents` de **ambas** sesiones cuadra.
- Mover **total** soft-cancela el ítem origen.
- Mesa destino **libre** → crea sesión `open` y la comanda `served`.
- **Auto-carry**: ítem de cliente **registrado** → matchea/crea comensal en destino por `customer_id` (verificar que `mark_session_paid` le asigna el consumo); ítem de **anónimo** → crea comensal por nombre; ítem **compartido** → queda compartido.
- **Override** `assign=<guest del destino>` → asigna a ese comensal; `assign` con guest de otra sesión → `invalid_assigned_guest`.
- Caché de comensal: mover dos ítems del mismo cliente en una llamada crea **un solo** comensal en destino.
- Idempotencia: misma `idempotency_key` no duplica el movimiento.
- Auditoría escrita.

**Smoke manual (documentar en el PR):** cargar 3 cervezas en Mesa A asignadas a un cliente registrado → entrar a Mesa A → “Mover ítems” → seleccionar 1 de 3 → elegir Mesa B (ocupada) → confirmar con “automático” → verificar: Mesa A queda con 2, Mesa B con 1, el cliente aparece como comensal en B, totales correctos en ambas, comanda en B no aparece en cocina, evento/auditoría registrados.

---

## 9. Archivos a tocar / crear

**Crear:**
- `supabase/migrations/<ts>_move_ticket_items.sql` (RPC + GRANT).
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/move-items-sheet.tsx`.
- `tests/rls/move-ticket-items.test.ts`.
- (posible) `tests/lib/move-ticket-items.test.ts` si se extrae helper de payload.

**Modificar:**
- `lib/tickets/schemas.ts` (+ `moveTicketItemsSchema`).
- `lib/tickets/actions.ts` (+ `moveTicketItemsAction`).
- `lib/floor-plan/queries.ts` (+ `getItemMoveTargets`, tipo `ItemMoveTarget`).
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/session-detail.tsx` (modo selección + barra + apertura de hoja).
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/ticket-card.tsx` (checkboxes + stepper).
- `types/database.ts` (regenerar tras la migración — vía MCP `generate_typescript_types`, re-anexar alias).

---

## 10. Fuera de alcance (YAGNI en esta fase)

- Drag-and-drop de ítems sobre el plano (dnd-kit en salón es greenfield).
- Override de reasignación **por ítem** en la UI (el RPC ya lo soporta; la UI lo hace a nivel de movimiento).
- Re-puntear `tickets.session_id` para “relocalizar” una comanda pendiente manteniéndola viva en cocina (descartado: choca con “no re-disparar cocina”; el enfoque aditivo cubre el caso de corrección).
- Mover ítems desde/hacia sesiones no-`open` (paid/merged/abandoned).
- Deshacer un movimiento (no hay “undo”; la corrección de un movimiento equivocado es otro movimiento).

---

## 11. Riesgos / invariantes a preservar

- **Totales:** nunca `UPDATE ticket_items.ticket_id` crudo (deja origen stale). Enfoque aditivo toca ambos lados.
- **Tenant:** verificar ambas sesiones/mesas del mismo tenant dentro del RPC.
- **Plata en centavos (`bigint`):** `line_total_cents = quantity * unit_price_cents` en ambas filas; nunca `quantity <= 0` (respetar `check > 0`).
- **Integridad de comensal:** `assigned_to_guest_id` del ítem movido apunta a un comensal de **su nueva** sesión (o `NULL`). El auto-carry y el override garantizan esto.
- **No duplicar comensales** al mover varios ítems del mismo cliente (caché en el RPC; match por `customer_id` para registrados).
- **Atomicidad:** todo el movimiento en una transacción (un RPC).
- **Idempotencia:** `tickets.idempotency_key` evita doble movimiento en retry/doble-tap.
- **Ítems cancelados** no se mueven.

---

## 12. Definition of Done (de CLAUDE.md)

1. UI accesible y mobile-friendly.
2. Migración generada y aplicada localmente.
3. RLS/roles testeados (SQL).
4. `types/database.ts` regenerado.
5. Zod en cada borde.
6. Tests unit + RLS verdes.
7. Smoke manual documentado en el PR.
8. Sin errores TS / lint.
9. README de la feature actualizado.
10. PR con descripción completa.
11. Conventional Commits.
