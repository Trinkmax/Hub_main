# Mover ítems entre mesas

Corrige errores de carga moviendo ítems de consumo de una mesa a otra.

## Flujo
1. En el detalle de una mesa abierta → menú (⋮) → **Mover ítems** (entra en modo selección).
2. Tildá ítems (o "comanda entera"); si una línea tiene varias unidades, elegí cuántas mover.
3. Barra inferior → **Mover N ítems →** abre la hoja de destino.
4. Elegí mesa destino (ocupada o libre). Opcional: reasignar a un comensal del destino o "toda la mesa".
5. Confirmar.

## Comportamiento
- **Aditivo**: inserta en una comanda `served` del destino + descuenta del origen. Los totales de ambas mesas se recalculan por trigger.
- Mover **nunca** crea un pedido nuevo de cocina (la comanda destino nace `served`, fuera del KDS).
- El ítem **va con su cliente**: registrado → su comensal se reúsa/crea en el destino por `customer_id` (los puntos lo siguen); anónimo → se crea su comensal por nombre; compartido → sigue compartido.
- Destino libre → se abre una sesión nueva. La sesión origen, si queda vacía, sigue abierta.
- Roles: `owner`, `waiter`. Idempotente por `idempotency_key`.

## Backend
RPC `move_ticket_items(p_source_session_id, p_target_table_id, p_moves, p_idempotency_key)` (`SECURITY DEFINER`).
Auditoría: `audit_log` action `ticket.items_moved`; eventos `table_session_events` type `items_moved` en ambas sesiones.

## Estado de verificación (entorno sin Docker)
- ✅ Unit test del schema (`tests/lib/move-ticket-items-schema.test.ts`), typecheck y lint.
- ⏳ Pendiente de entorno con Supabase: aplicar la migración `20260608200330_move_ticket_items`, regenerar `types/database.ts` (hoy tiene un stub manual del RPC), correr los tests RLS (`tests/rls/move-ticket-items.test.ts`, corren en el job `rls` de CI) y el smoke manual.
