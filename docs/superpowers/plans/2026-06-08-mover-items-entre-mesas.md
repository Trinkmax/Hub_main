# Mover ítems entre mesas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el staff (dueño/mozo) mueva ítems de consumo de una mesa a otra —ítems sueltos o comanda entera, con cantidad parcial— para corregir errores de carga, manteniendo el ítem con su cliente.

**Architecture:** Enfoque **aditivo** vía una RPC `SECURITY DEFINER` (`move_ticket_items`): inserta los ítems en una comanda nueva `served` de la sesión destino (creándola si la mesa estaba libre) y descuenta del origen (reduce cantidad o soft-cancel). Los triggers de recálculo existentes ajustan los totales de ambas mesas. El comensal se "porta" al destino (match/crea por `customer_id` para registrados; placeholder por nombre para anónimos), con opción de reasignar. UI: hoja de selección clon de `MoveTableSheet` + modo selección de ítems en `TicketCard`.

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase Postgres (plpgsql RPC, RLS), TypeScript estricto, zod, React 19, Tailwind v4 + shadcn, sonner, Vitest (unit + RLS).

**Spec de referencia:** `docs/superpowers/specs/2026-06-08-mover-items-entre-mesas-design.md`

---

## File Structure

**Crear:**
- `supabase/migrations/<timestamp>_move_ticket_items.sql` — RPC `move_ticket_items` + GRANT.
- `tests/lib/move-ticket-items-schema.test.ts` — unit test del zod schema.
- `tests/rls/move-ticket-items.test.ts` — integración contra Supabase local.
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/move-items-sheet.tsx` — hoja de destino + asignación.

**Modificar:**
- `lib/tickets/schemas.ts` — `moveTicketItemsSchema` + tipo.
- `lib/tickets/actions.ts` — `moveTicketItemsAction`, `loadItemMoveTargetsAction`, `loadSessionGuestsAction`.
- `lib/floor-plan/queries.ts` — `getItemMoveTargets` + tipo `ItemMoveTarget`.
- `lib/sessions-waiter/queries.ts` — `listSessionGuests` + tipo `SessionGuestLite`.
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/ticket-card.tsx` — modo selección.
- `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/session-detail.tsx` — wiring (modo selección, barra sticky, hoja).
- `types/database.ts` — regenerar tras la migración.

**Convenciones a respetar (verificadas en el código existente):**
- Mutaciones solo vía RPC `SECURITY DEFINER` (`tickets`/`ticket_items`/`table_sessions`/`session_guests` son SELECT-only para `authenticated`).
- Server Action: `authorize(slug, roles)` → `safeParse` → `.rpc(...)` → mapear errores → `logAudit` → `revalidatePath`.
- Estado de retorno tipo `{ ok: true, ... } | { ok: false, message }`.

---

## Task 1: Zod schema `moveTicketItemsSchema`

**Files:**
- Modify: `lib/tickets/schemas.ts`
- Test: `tests/lib/move-ticket-items-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/move-ticket-items-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { moveTicketItemsSchema } from '@/lib/tickets/schemas'

const UUID_A = '11111111-1111-1111-1111-111111111111'
const UUID_B = '22222222-2222-2222-2222-222222222222'
const UUID_ITEM = '33333333-3333-3333-3333-333333333333'
const UUID_GUEST = '44444444-4444-4444-4444-444444444444'

describe('moveTicketItemsSchema', () => {
  it('parsea input válido y aplica assign="auto" por defecto', () => {
    const r = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 2 }],
    })
    expect(r.moves[0]?.assign).toBe('auto')
    expect(r.moves[0]?.quantity).toBe(2)
  })

  it('coacciona quantity desde string', () => {
    const r = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: '3' }],
    })
    expect(r.moves[0]?.quantity).toBe(3)
  })

  it('acepta assign="shared" y assign=<uuid de comensal>', () => {
    const shared = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: 'shared' }],
    })
    expect(shared.moves[0]?.assign).toBe('shared')
    const toGuest = moveTicketItemsSchema.parse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: UUID_GUEST }],
    })
    expect(toGuest.moves[0]?.assign).toBe(UUID_GUEST)
  })

  it('rechaza assign con string arbitrario (ni auto/shared ni uuid)', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1, assign: 'pepe' }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza quantity < 1', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 0 }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza moves vacío', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: UUID_A,
      targetTableId: UUID_B,
      moves: [],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza uuids inválidos', () => {
    const r = moveTicketItemsSchema.safeParse({
      sourceSessionId: 'no-uuid',
      targetTableId: UUID_B,
      moves: [{ ticketItemId: UUID_ITEM, quantity: 1 }],
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/move-ticket-items-schema.test.ts`
Expected: FAIL — `moveTicketItemsSchema` is not exported from `@/lib/tickets/schemas`.

- [ ] **Step 3: Implement the schema**

Append to `lib/tickets/schemas.ts`:

```ts
export const moveTicketItemsSchema = z.object({
  sourceSessionId: z.string().uuid(),
  targetTableId: z.string().uuid(),
  moves: z
    .array(
      z.object({
        ticketItemId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1),
        assign: z
          .union([z.literal('auto'), z.literal('shared'), z.string().uuid()])
          .default('auto'),
      }),
    )
    .min(1, 'Seleccioná al menos un ítem para mover'),
  idempotencyKey: z.string().min(1).max(64).optional(),
})

export type MoveTicketItemsInput = z.infer<typeof moveTicketItemsSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/move-ticket-items-schema.test.ts`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add lib/tickets/schemas.ts tests/lib/move-ticket-items-schema.test.ts
git commit -m "feat(tickets): zod schema para mover ítems entre mesas"
```

---

## Task 2: RPC `move_ticket_items` (migración + RLS tests)

**Files:**
- Create: `supabase/migrations/<timestamp>_move_ticket_items.sql`
- Test: `tests/rls/move-ticket-items.test.ts`
- Regenerate: `types/database.ts`

> **Prerrequisito de entorno:** Supabase local corriendo (`npx supabase start`) y las envs exportadas (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; ver `npx supabase status -o json`). Los tests de RLS hacen `describe.skip` si esas envs no están, así que el pre-commit no los corre; hay que correrlos a mano contra el Postgres local.

- [ ] **Step 1: Write the failing RLS test**

Create `tests/rls/move-ticket-items.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

// Helpers locales ---------------------------------------------------------

type Svc = ReturnType<typeof getServiceClient>

async function seedMenuItem(svc: Svc, tenantId: string, priceCents: number) {
  const { data: cat } = await svc
    .from('menu_categories')
    .insert({ tenant_id: tenantId, name: 'Tragos' })
    .select('id')
    .single()
  if (!cat) throw new Error('seed cat failed')
  const { data: item } = await svc
    .from('menu_items')
    .insert({ tenant_id: tenantId, category_id: cat.id, name: 'Birra', price_cents: priceCents })
    .select('id')
    .single()
  if (!item) throw new Error('seed item failed')
  return item.id as string
}

async function openSessionOnTable(
  client: Awaited<ReturnType<typeof createUserClient>>['client'],
  qrToken: string,
): Promise<string> {
  // activate_table_session devuelve { session_id, ... } — usar ESE id, no un
  // select global "última sesión open" (que en tests acumulados devolvería otra mesa).
  const { data, error } = await client.rpc('activate_table_session', {
    p_qr_token: qrToken,
    p_party_size: 2,
    p_source: 'manual',
    p_alias: null,
  })
  if (error || !data) throw new Error(`activate failed: ${error?.message}`)
  return (data as { session_id: string }).session_id
}

describeIfRls('RPC — move_ticket_items', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let waiter: Awaited<ReturnType<typeof createUserClient>>
  let cashier: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrA: string
  let qrB: string
  let qrC: string
  let tableA: string
  let tableB: string
  let menuItemId: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('miOwn') })
    waiter = await createUserClient({ email: uniqueEmail('miWai') })
    cashier = await createUserClient({ email: uniqueEmail('miCas') })
    tenant = await createTenant({
      name: 'Move Items Bar',
      slug: uniqueSlug('mi-bar'),
      ownerId: owner.userId,
    })
    const svc = getServiceClient()
    await svc.from('memberships').insert([
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
      { tenant_id: tenant.id, user_id: cashier.userId, role: 'cashier' },
    ])
    const { data: a } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-A' })
      .select('id, qr_token')
      .single()
    const { data: b } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-B' })
      .select('id, qr_token')
      .single()
    const { data: c } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-C' })
      .select('id, qr_token')
      .single()
    if (!a || !b || !c) throw new Error('seed tables failed')
    tableA = a.id
    tableB = b.id
    qrA = a.qr_token
    qrB = b.qr_token
    qrC = c.qr_token
    menuItemId = await seedMenuItem(svc, tenant.id, 100000) // $1000
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(waiter.userId)
    await deleteUser(cashier.userId)
  })

  it('mueve cantidad parcial a una mesa libre: crea sesión destino, descuenta origen, cuadran totales', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    // 3 birras compartidas
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 3, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id, ticket_id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no item')

    const { data, error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: 'mv-partial-1',
    })
    expect(error).toBeNull()
    const res = data as { target_session_id: string; moved_count: number }
    expect(res.moved_count).toBe(1)

    // Origen: la línea quedó en 2.
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('quantity, line_total_cents')
      .eq('id', item.id)
      .single()
    expect(srcItem?.quantity).toBe(2)
    expect(srcItem?.line_total_cents).toBe(200000)

    // Destino: sesión open nueva en B con un ticket served + 1 ítem.
    const { data: destSess } = await svc
      .from('table_sessions')
      .select('id, total_cents, status')
      .eq('id', res.target_session_id)
      .single()
    expect(destSess?.status).toBe('open')
    expect(destSess?.total_cents).toBe(100000)

    const { data: srcSess } = await svc
      .from('table_sessions')
      .select('total_cents')
      .eq('id', sessA)
      .single()
    expect(srcSess?.total_cents).toBe(200000)

    const { data: destTicket } = await svc
      .from('tickets')
      .select('status')
      .eq('session_id', res.target_session_id)
      .single()
    expect(destTicket?.status).toBe('served')
  })

  it('move total soft-cancela el ítem origen', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id, quantity')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no item')

    await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: item.quantity, assign: 'auto' }],
      p_idempotency_key: `mv-full-${Date.now()}`,
    })
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('cancelled_at, cancellation_reason')
      .eq('id', item.id)
      .single()
    expect(srcItem?.cancelled_at).not.toBeNull()
    expect(srcItem?.cancellation_reason).toMatch(/Movido a/i)
  })

  it('auto-carry: un ítem de cliente registrado crea/asocia su comensal en destino', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    // Cliente registrado + comensal en sesión A.
    const { data: cust } = await svc
      .from('customers')
      .insert({ tenant_id: tenant.id, first_name: 'Ana', phone_e164: `+5493510000${Math.floor(Math.random() * 9000) + 1000}` })
      .select('id')
      .single()
    if (!cust) throw new Error('no customer')
    const { data: guest } = await svc
      .from('session_guests')
      .insert({
        session_id: sessA,
        browser_token: `guestAna${Date.now()}`,
        display_name: 'Ana',
        customer_id: cust.id,
      })
      .select('id')
      .single()
    if (!guest) throw new Error('no guest')
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: guest.id }],
      p_assigned_to_guest_id: guest.id,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .eq('assigned_to_guest_id', guest.id)
      .is('cancelled_at', null)
      .single()
    if (!item) throw new Error('no assigned item')

    const { data } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-reg-${Date.now()}`,
    })
    const res = data as { target_session_id: string }
    // El comensal del destino tiene el mismo customer_id.
    const { data: destGuests } = await svc
      .from('session_guests')
      .select('customer_id')
      .eq('session_id', res.target_session_id)
    expect((destGuests ?? []).some((g) => g.customer_id === cust.id)).toBe(true)
  })

  it('ítem compartido sigue compartido (assigned_to_guest_id null en destino)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('assigned_to_guest_id', null)
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no shared item')

    const { data } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-shared-${Date.now()}`,
    })
    const res = data as { target_ticket_id: string }
    const { data: destItems } = await svc
      .from('ticket_items')
      .select('assigned_to_guest_id')
      .eq('ticket_id', res.target_ticket_id)
    expect((destItems ?? []).every((i) => i.assigned_to_guest_id === null)).toBe(true)
  })

  it('cashier no puede mover ítems (rol no permitido)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const { error } = await cashier.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-cash-${Date.now()}`,
    })
    expect(error?.message).toMatch(/role_not_allowed|forbidden/)
  })

  it('rechaza mover a la misma mesa', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const { error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableA,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-same-${Date.now()}`,
    })
    expect(error?.message).toMatch(/same_table_move/)
  })

  it('es idempotente con la misma idempotency_key (no duplica el movimiento)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const key = `mv-idem-${Date.now()}`
    const args = {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: key,
    }
    const first = await waiter.client.rpc('move_ticket_items', args)
    const second = await waiter.client.rpc('move_ticket_items', args)
    expect((second.data as { idempotent: boolean }).idempotent).toBe(true)
    // El ítem origen quedó en 1 (solo se movió una vez), no en 0.
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('quantity')
      .eq('id', item?.id)
      .single()
    expect(srcItem?.quantity).toBe(1)
    expect((first.data as { target_ticket_id: string }).target_ticket_id).toBe(
      (second.data as { target_ticket_id: string }).target_ticket_id,
    )
  })

  it('rechaza si la sesión origen no está open', async () => {
    const svc = getServiceClient()
    const sessC = await openSessionOnTable(waiter.client, qrC)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessC,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    await svc.from('table_sessions').update({ status: 'abandoned', abandoned_reason: 'test' }).eq('id', sessC)
    const { error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessC,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-closed-${Date.now()}`,
    })
    expect(error?.message).toMatch(/session_not_open/)
  })
})
```

> Nota: el campo `phone_e164` y `customers.first_name` se usan según el schema actual de `customers`. Si la columna de teléfono tiene otro nombre, ajustá el insert del cliente (es solo seed de test). Verificá con `\d customers` o `types/database.ts`.

- [ ] **Step 2: Run the test to confirm it fails (function missing)**

```bash
export $(npx supabase status -o env | xargs)   # SUPABASE_URL/ANON/SERVICE_ROLE
npx vitest run tests/rls/move-ticket-items.test.ts
```
Expected: FAIL — `move_ticket_items` no existe (`PGRST202`/`function ... does not exist`).

- [ ] **Step 3: Create the migration**

```bash
npx supabase migration new move_ticket_items
```

Escribir en el archivo creado `supabase/migrations/<timestamp>_move_ticket_items.sql`:

```sql
-- Mover ítems entre mesas (corrección de errores de carga).
-- Enfoque aditivo: inserta en una comanda nueva del destino + descuenta en el
-- origen, de modo que los triggers de recálculo ajustan AMBAS sesiones.
-- El comensal se "porta" al destino (match/crea por customer_id para
-- registrados; placeholder por nombre para anónimos), con opción de reasignar.
create or replace function public.move_ticket_items(
  p_source_session_id uuid,
  p_target_table_id   uuid,
  p_moves jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.table_sessions;
  v_target_table public.physical_tables;
  v_source_label text;
  v_target_label text;
  v_target_session_id uuid;
  v_target_ticket_id uuid;
  v_existing_session uuid;
  v_move jsonb;
  v_item public.ticket_items;
  v_src_guest public.session_guests;
  v_qty int;
  v_assign text;
  v_target_guest uuid;
  v_mapped uuid;
  v_guest_map jsonb := '{}'::jsonb;
  v_moved_count int := 0;
  v_clean_key text;
begin
  -- 0. Idempotencia: si ya existe una comanda con esta key, devolverla sin re-mover.
  v_clean_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_clean_key is not null then
    select t.id, t.session_id into v_target_ticket_id, v_target_session_id
      from public.tickets t
      where t.idempotency_key = v_clean_key
      limit 1;
    if v_target_ticket_id is not null then
      return jsonb_build_object(
        'target_session_id', v_target_session_id,
        'target_ticket_id', v_target_ticket_id,
        'moved_count', 0,
        'idempotent', true
      );
    end if;
  end if;

  -- 1. Payload no vacío.
  if p_moves is null or jsonb_array_length(p_moves) = 0 then
    raise exception 'no_moves' using errcode = 'P0001';
  end if;

  -- 2. Sesión origen (lock) + estado open.
  select * into v_source from public.table_sessions
    where id = p_source_session_id for update;
  if v_source.id is null then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_source.status <> 'open' then
    raise exception 'session_not_open' using errcode = 'P0001';
  end if;

  -- 3. Rol permitido.
  perform public._check_staff_role(v_source.tenant_id, array['owner', 'waiter']);

  -- 4. Mesa destino válida, mismo tenant, distinta del origen.
  select * into v_target_table from public.physical_tables
    where id = p_target_table_id;
  if v_target_table.id is null or v_target_table.tenant_id <> v_source.tenant_id then
    raise exception 'invalid_target_table' using errcode = 'P0001';
  end if;
  if v_target_table.id = v_source.physical_table_id then
    raise exception 'same_table_move' using errcode = 'P0001';
  end if;
  v_target_label := v_target_table.label;
  select label into v_source_label from public.physical_tables
    where id = v_source.physical_table_id;

  -- 5. Resolver/crear sesión destino.
  select id into v_existing_session from public.table_sessions
    where physical_table_id = p_target_table_id and status = 'open'
    limit 1;
  if v_existing_session is not null then
    v_target_session_id := v_existing_session;
  else
    insert into public.table_sessions (tenant_id, physical_table_id)
      values (v_source.tenant_id, p_target_table_id)
      returning id into v_target_session_id;
    insert into public.table_session_events (session_id, type, created_by_user_id, payload)
      values (v_target_session_id, 'session_opened', auth.uid(), '{"trigger":"items_move"}'::jsonb);
  end if;

  -- 6. Comanda destino: served (fuera del KDS).
  insert into public.tickets (
    tenant_id, session_id, status, created_by_user_id,
    submitted_at, accepted_at, accepted_by_user_id, served_at, idempotency_key
  ) values (
    v_source.tenant_id, v_target_session_id, 'served', auth.uid(),
    now(), now(), auth.uid(), now(), v_clean_key
  ) returning id into v_target_ticket_id;

  -- 7. Procesar cada move.
  for v_move in select * from jsonb_array_elements(p_moves) loop
    v_qty := (v_move->>'quantity')::int;
    v_assign := coalesce(nullif(trim(v_move->>'assign'), ''), 'auto');

    -- 7a. Cargar ítem origen (lock) y validar que pertenece a la sesión origen.
    select ti.* into v_item
      from public.ticket_items ti
      join public.tickets t on t.id = ti.ticket_id
      where ti.id = (v_move->>'ticket_item_id')::uuid
        and t.session_id = p_source_session_id
      for update of ti;
    if v_item.id is null then
      raise exception 'item_not_in_session' using errcode = 'P0001';
    end if;
    if v_item.cancelled_at is not null then
      raise exception 'item_cancelled' using errcode = 'P0001';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > v_item.quantity then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    -- 7b. Resolver comensal destino.
    if v_assign = 'shared' then
      v_target_guest := null;
    elsif v_assign = 'auto' then
      if v_item.assigned_to_guest_id is null then
        v_target_guest := null;
      else
        v_mapped := nullif(v_guest_map->>(v_item.assigned_to_guest_id::text), '')::uuid;
        if v_mapped is not null then
          v_target_guest := v_mapped;
        else
          select * into v_src_guest from public.session_guests
            where id = v_item.assigned_to_guest_id;
          v_target_guest := null;
          if v_src_guest.customer_id is not null then
            select id into v_target_guest from public.session_guests
              where session_id = v_target_session_id
                and customer_id = v_src_guest.customer_id
              limit 1;
          end if;
          if v_target_guest is null then
            insert into public.session_guests (session_id, browser_token, display_name, customer_id)
              values (
                v_target_session_id,
                'mv' || replace(gen_random_uuid()::text, '-', ''),
                v_src_guest.display_name,
                v_src_guest.customer_id
              )
              returning id into v_target_guest;
          end if;
          v_guest_map := v_guest_map
            || jsonb_build_object(v_item.assigned_to_guest_id::text, v_target_guest);
        end if;
      end if;
    else
      -- assign es un uuid de comensal del destino.
      select id into v_target_guest from public.session_guests
        where id = v_assign::uuid and session_id = v_target_session_id;
      if v_target_guest is null then
        raise exception 'invalid_assigned_guest' using errcode = 'P0001';
      end if;
    end if;

    -- 7c. Insertar en la comanda destino.
    insert into public.ticket_items (
      ticket_id, menu_item_id, quantity, unit_price_cents,
      line_total_cents, assigned_to_guest_id, notes
    ) values (
      v_target_ticket_id, v_item.menu_item_id, v_qty, v_item.unit_price_cents,
      v_item.unit_price_cents * v_qty, v_target_guest,
      nullif(trim(coalesce(v_item.notes, '') || ' (movido de ' || coalesce(v_source_label, 'mesa') || ')'), '')
    );

    -- 7d. Descontar del origen.
    if v_qty = v_item.quantity then
      update public.ticket_items
        set cancelled_at = now(),
            cancellation_reason = 'Movido a ' || coalesce(v_target_label, 'otra mesa')
        where id = v_item.id;
    else
      update public.ticket_items
        set quantity = v_item.quantity - v_qty,
            line_total_cents = v_item.unit_price_cents * (v_item.quantity - v_qty)
        where id = v_item.id;
    end if;

    v_moved_count := v_moved_count + 1;
  end loop;

  -- 8. Eventos en ambas sesiones (dispara realtime en grilla/plano/detalle).
  insert into public.table_session_events (session_id, type, created_by_user_id, payload)
  values
    (p_source_session_id, 'items_moved', auth.uid(),
      jsonb_build_object('direction', 'out', 'target_session_id', v_target_session_id,
                         'target_ticket_id', v_target_ticket_id, 'moved_count', v_moved_count)),
    (v_target_session_id, 'items_moved', auth.uid(),
      jsonb_build_object('direction', 'in', 'source_session_id', p_source_session_id,
                         'target_ticket_id', v_target_ticket_id, 'moved_count', v_moved_count));

  return jsonb_build_object(
    'target_session_id', v_target_session_id,
    'target_ticket_id', v_target_ticket_id,
    'moved_count', v_moved_count,
    'idempotent', false
  );
end $$;

revoke all on function public.move_ticket_items(uuid, uuid, jsonb, text) from public;
grant execute on function public.move_ticket_items(uuid, uuid, jsonb, text) to authenticated;
```

> No se crean tablas → no hacen falta GRANTs de tabla nuevos.

- [ ] **Step 4: Apply locally and run the test until green**

```bash
npm run db:reset                                   # corre migraciones + seed
export $(npx supabase status -o env | xargs)
npx vitest run tests/rls/move-ticket-items.test.ts
```
Expected: PASS (todos los `it` verdes). Si algo falla, **editá el archivo de migración** (todavía no commiteado) y volvé a `npm run db:reset` — nunca crear una segunda migración para parchear esta.

- [ ] **Step 5: Regenerate `types/database.ts`**

Run: `npm run db:types`
Expected: el archivo incluye `move_ticket_items` dentro de `Database['public']['Functions']`.

> Si el entorno no tiene Docker para `db:types`, usar el flujo del project memory: aplicar la migración con el MCP `apply_migration` **a un proyecto de dev/branch (no prod)** y luego `generate_typescript_types`, re-anexando el bloque de alias que el generador borra. **No** aplicar una migración sin mergear al proyecto prod (`ogplsevtrclzxvyejlns`).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add supabase/migrations/ tests/rls/move-ticket-items.test.ts types/database.ts
git commit -m "feat(salon): RPC move_ticket_items + tests RLS"
```
Expected: typecheck sin errores; commit OK (los tests RLS se saltean en el pre-commit por falta de envs).

---

## Task 3: Queries de destinos y comensales

**Files:**
- Modify: `lib/floor-plan/queries.ts`
- Modify: `lib/sessions-waiter/queries.ts`

- [ ] **Step 1: Add `getItemMoveTargets` + `ItemMoveTarget` to `lib/floor-plan/queries.ts`**

Append al final de `lib/floor-plan/queries.ts`:

```ts
// ─── Destinos para "mover ítems" (incluye mesas ocupadas) ─────────────────────

export type ItemMoveTarget = {
  table_id: string
  label: string
  capacity: number | null
  area_name: string
  area_pos: number
  /** sesión abierta en la mesa, o null si está libre */
  session: {
    id: string
    alias: string | null
    total_cents: number
    party_size: number | null
  } | null
}

/**
 * Igual que getMoveTargets pero para mover ÍTEMS: incluye mesas ocupadas
 * (con su sesión abierta) además de las libres, y excluye la mesa de la
 * sesión origen. RLS SELECT abierta a miembros del tenant.
 */
export async function getItemMoveTargets(
  tenantId: string,
  sourceSessionId: string,
): Promise<ItemMoveTarget[]> {
  const supabase = await createClient()

  const { data: src } = await supabase
    .from('table_sessions')
    .select('physical_table_id')
    .eq('id', sourceSessionId)
    .maybeSingle()
  const sourceTableId = src?.physical_table_id ?? null

  const [{ data: els }, { data: tbls }, { data: open }] = await Promise.all([
    supabase
      .from('floor_plan_elements')
      .select('physical_table_id, floor_plan_areas(name, position)')
      .eq('tenant_id', tenantId)
      .eq('kind', 'table'),
    supabase
      .from('physical_tables')
      .select('id, label, capacity')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    supabase
      .from('table_sessions')
      .select('id, physical_table_id, alias, total_cents, party_size')
      .eq('tenant_id', tenantId)
      .eq('status', 'open'),
  ])

  const openByTable = new Map<
    string,
    { id: string; alias: string | null; total_cents: number; party_size: number | null }
  >()
  for (const s of (open ?? []) as {
    id: string
    physical_table_id: string | null
    alias: string | null
    total_cents: number
    party_size: number | null
  }[]) {
    if (s.physical_table_id) {
      openByTable.set(s.physical_table_id, {
        id: s.id,
        alias: s.alias,
        total_cents: s.total_cents ?? 0,
        party_size: s.party_size,
      })
    }
  }

  const placed = new Map<string, { area_name: string; area_pos: number }>()
  for (const e of (els ?? []) as unknown as {
    physical_table_id: string | null
    floor_plan_areas: { name: string; position: number } | null
  }[]) {
    if (e.physical_table_id) {
      placed.set(e.physical_table_id, {
        area_name: e.floor_plan_areas?.name ?? 'Sin ubicar',
        area_pos: e.floor_plan_areas?.position ?? 999,
      })
    }
  }

  const targets: ItemMoveTarget[] = []
  for (const t of (tbls ?? []) as { id: string; label: string; capacity: number | null }[]) {
    if (t.id === sourceTableId) continue
    const p = placed.get(t.id)
    targets.push({
      table_id: t.id,
      label: t.label,
      capacity: t.capacity,
      area_name: p?.area_name ?? 'Sin ubicar',
      area_pos: p?.area_pos ?? 999,
      session: openByTable.get(t.id) ?? null,
    })
  }

  targets.sort((a, b) => a.area_pos - b.area_pos || a.label.localeCompare(b.label, 'es'))
  return targets
}
```

- [ ] **Step 2: Add `listSessionGuests` + `SessionGuestLite` to `lib/sessions-waiter/queries.ts`**

Append al final de `lib/sessions-waiter/queries.ts` (asegurate de que `createClient` de `@/lib/supabase/server` ya esté importado en el archivo; si no, agregá el import):

```ts
export type SessionGuestLite = {
  id: string
  display_name: string | null
  customer_id: string | null
}

/**
 * Comensales de una sesión (para el selector de reasignación al mover ítems).
 * RLS SELECT en session_guests: abierta a miembros del tenant.
 */
export async function listSessionGuests(sessionId: string): Promise<SessionGuestLite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('session_guests')
    .select('id, display_name, customer_id')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })
  if (error) {
    console.error('[sessions-waiter.listSessionGuests]', error.message)
    return []
  }
  return (data ?? []).map((g) => ({
    id: g.id,
    display_name: g.display_name,
    customer_id: g.customer_id,
  }))
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add lib/floor-plan/queries.ts lib/sessions-waiter/queries.ts
git commit -m "feat(salon): queries de destinos (con mesas ocupadas) y comensales para mover ítems"
```
Expected: typecheck OK.

---

## Task 4: Server actions

**Files:**
- Modify: `lib/tickets/actions.ts`

- [ ] **Step 1: Import the new schema**

En `lib/tickets/actions.ts`, agregá `moveTicketItemsSchema` al bloque de import desde `./schemas`:

```ts
import {
  acceptTicketSchema,
  addStaffTicketSchema,
  cancelTicketItemSchema,
  moveTicketItemsSchema,
  rejectTicketSchema,
  updateTicketStatusSchema,
} from './schemas'
```

- [ ] **Step 2: Append the three actions**

Append al final de `lib/tickets/actions.ts`:

```ts
export type MoveTicketItemsState =
  | { ok: true; targetSessionId: string; targetTicketId: string; movedCount: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

export async function moveTicketItemsAction(
  slug: string,
  input: {
    sourceSessionId: string
    targetTableId: string
    moves: Array<{ ticketItemId: string; quantity: number; assign?: string }>
    idempotencyKey?: string
  },
): Promise<MoveTicketItemsState> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = moveTicketItemsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('move_ticket_items', {
    p_source_session_id: parsed.data.sourceSessionId,
    p_target_table_id: parsed.data.targetTableId,
    p_moves: parsed.data.moves.map((m) => ({
      ticket_item_id: m.ticketItemId,
      quantity: m.quantity,
      assign: m.assign ?? 'auto',
    })),
    p_idempotency_key: parsed.data.idempotencyKey ?? null,
  })
  if (error) {
    const msg = error.message
    if (msg.includes('session_not_open')) {
      return { ok: false, message: 'La mesa de origen ya no está abierta.' }
    }
    if (msg.includes('session_not_found')) {
      return { ok: false, message: 'Sesión de origen no encontrada.' }
    }
    if (msg.includes('invalid_target_table')) {
      return { ok: false, message: 'La mesa destino no es válida.' }
    }
    if (msg.includes('same_table_move')) {
      return { ok: false, message: 'Elegí una mesa distinta a la actual.' }
    }
    if (msg.includes('item_not_in_session')) {
      return { ok: false, message: 'Alguno de los ítems no pertenece a esta mesa.' }
    }
    if (msg.includes('item_cancelled')) {
      return { ok: false, message: 'No se pueden mover ítems cancelados.' }
    }
    if (msg.includes('invalid_quantity')) {
      return { ok: false, message: 'Cantidad a mover inválida.' }
    }
    if (msg.includes('invalid_assigned_guest')) {
      return { ok: false, message: 'El comensal destino no es válido.' }
    }
    if (msg.includes('no_moves')) {
      return { ok: false, message: 'Seleccioná al menos un ítem.' }
    }
    if (msg.includes('role_not_allowed') || msg.includes('forbidden')) {
      return { ok: false, message: 'No tenés permiso para mover ítems.' }
    }
    console.error('[tickets.moveItems]', msg)
    return { ok: false, message: 'No se pudieron mover los ítems.' }
  }

  const result = data as {
    target_session_id: string
    target_ticket_id: string
    moved_count: number
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'ticket.items_moved',
    entity: 'table_session',
    entityId: parsed.data.sourceSessionId,
    payload: {
      target_session_id: result.target_session_id,
      target_ticket_id: result.target_ticket_id,
      target_table_id: parsed.data.targetTableId,
      moves: parsed.data.moves,
    },
  })

  revalidatePath(`/${slug}/salon/mesas`)
  revalidatePath(`/${slug}/salon/mesas/${parsed.data.sourceSessionId}`)
  revalidatePath(`/${slug}/salon/mesas/${result.target_session_id}`)
  revalidatePath(`/${slug}/salon/cocina`)
  return {
    ok: true,
    targetSessionId: result.target_session_id,
    targetTicketId: result.target_ticket_id,
    movedCount: result.moved_count,
  }
}

export async function loadItemMoveTargetsAction(
  slug: string,
  sourceSessionId: string,
): Promise<
  | { ok: true; targets: import('@/lib/floor-plan/queries').ItemMoveTarget[] }
  | { ok: false; message: string }
> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const { getItemMoveTargets } = await import('@/lib/floor-plan/queries')
  const targets = await getItemMoveTargets(access.tenant.id, sourceSessionId)
  return { ok: true, targets }
}

export async function loadSessionGuestsAction(
  slug: string,
  sessionId: string,
): Promise<
  | { ok: true; guests: import('@/lib/sessions-waiter/queries').SessionGuestLite[] }
  | { ok: false; message: string }
> {
  const access = await authorize(slug, ['waiter', 'owner'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  const { listSessionGuests } = await import('@/lib/sessions-waiter/queries')
  const guests = await listSessionGuests(sessionId)
  return { ok: true, guests }
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add lib/tickets/actions.ts
git commit -m "feat(tickets): server actions para mover ítems entre mesas"
```
Expected: typecheck OK (requiere `move_ticket_items` ya en `types/database.ts`, de la Task 2).

---

## Task 5: Componente `MoveItemsSheet`

**Files:**
- Create: `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/move-items-sheet.tsx`

- [ ] **Step 1: Create the component**

Create `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/move-items-sheet.tsx`:

```tsx
'use client'

import { ArrowRightLeft, Loader2, Users } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { ItemMoveTarget } from '@/lib/floor-plan/queries'
import type { SessionGuestLite } from '@/lib/sessions-waiter/queries'
import {
  loadItemMoveTargetsAction,
  loadSessionGuestsAction,
  moveTicketItemsAction,
} from '@/lib/tickets/actions'
import { cn } from '@/lib/utils'

export type MoveItemsSheetProps = {
  slug: string
  sourceSessionId: string
  /** Ítems seleccionados a mover: id de ticket_item + cantidad. */
  moves: Array<{ ticketItemId: string; quantity: number }>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tras mover con éxito. */
  onMoved: () => void
}

type AssignChoice = 'auto' | 'shared' | string // string = uuid de comensal destino

export function MoveItemsSheet({
  slug,
  sourceSessionId,
  moves,
  open,
  onOpenChange,
  onMoved,
}: MoveItemsSheetProps) {
  const [targets, setTargets] = useState<ItemMoveTarget[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<ItemMoveTarget | null>(null)
  const [destGuests, setDestGuests] = useState<SessionGuestLite[]>([])
  const [assign, setAssign] = useState<AssignChoice>('auto')
  const [pending, startMove] = useTransition()

  // Cargar destinos al abrir.
  useEffect(() => {
    if (!open) {
      setTargets(null)
      setSelectedTarget(null)
      setDestGuests([])
      setAssign('auto')
      return
    }
    let active = true
    setLoading(true)
    void loadItemMoveTargetsAction(slug, sourceSessionId).then((res) => {
      if (!active) return
      setLoading(false)
      if (res.ok) setTargets(res.targets)
      else {
        toast.error(res.message)
        setTargets([])
      }
    })
    return () => {
      active = false
    }
  }, [open, slug, sourceSessionId])

  // Al elegir una mesa ocupada, cargar sus comensales para reasignación.
  const handleSelectTarget = (t: ItemMoveTarget) => {
    setSelectedTarget(t)
    setAssign('auto')
    setDestGuests([])
    if (t.session) {
      void loadSessionGuestsAction(slug, t.session.id).then((res) => {
        if (res.ok) setDestGuests(res.guests)
      })
    }
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    startMove(async () => {
      const r = await moveTicketItemsAction(slug, {
        sourceSessionId,
        targetTableId: selectedTarget.table_id,
        moves: moves.map((m) => ({ ...m, assign })),
        idempotencyKey: crypto.randomUUID(),
      })
      if (r.ok) {
        toast.success(
          `${r.movedCount} ${r.movedCount === 1 ? 'ítem movido' : 'ítems movidos'} a ${selectedTarget.label}.`,
        )
        onOpenChange(false)
        onMoved()
      } else {
        toast.error(r.message)
      }
    })
  }

  // Agrupar por área (ya viene ordenado por area_pos → label).
  const groups: { area: string; tables: ItemMoveTarget[] }[] = []
  for (const t of targets ?? []) {
    const last = groups[groups.length - 1]
    if (last && last.area === t.area_name) last.tables.push(t)
    else groups.push({ area: t.area_name, tables: [t] })
  }

  const itemCount = moves.reduce((acc, m) => acc + m.quantity, 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-serif">
            <ArrowRightLeft className="size-4" aria-hidden />
            Mover {itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}
          </SheetTitle>
          <SheetDescription>
            Elegí la mesa destino. El ítem mantiene su cliente salvo que reasignes abajo.
          </SheetDescription>
        </SheetHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Buscando mesas…
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No hay otras mesas disponibles.
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.area} className="space-y-2">
                <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                  {g.area}
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {g.tables.map((t) => (
                    <button
                      key={t.table_id}
                      type="button"
                      disabled={pending}
                      onClick={() => handleSelectTarget(t)}
                      className={cn(
                        'flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border border-border/70 bg-card p-2 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                        selectedTarget?.table_id === t.table_id && 'border-primary bg-primary/10',
                        t.session && 'border-amber-300/70',
                      )}
                    >
                      <span className="font-semibold font-serif text-sm tabular-nums">
                        {t.label}
                      </span>
                      {t.session ? (
                        <span className="text-[10px] text-amber-600">ocupada</span>
                      ) : t.capacity != null ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                          <Users className="size-2.5" aria-hidden />
                          {t.capacity}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">libre</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}

          {selectedTarget && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                Asignar a
              </h3>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="assign"
                    className="accent-primary"
                    checked={assign === 'auto'}
                    onChange={() => setAssign('auto')}
                  />
                  Mantener el cliente de cada ítem
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="assign"
                    className="accent-primary"
                    checked={assign === 'shared'}
                    onChange={() => setAssign('shared')}
                  />
                  Para toda la mesa (compartido)
                </label>
                {destGuests.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="assign"
                      className="accent-primary"
                      checked={assign === g.id}
                      onChange={() => setAssign(g.id)}
                    />
                    {g.display_name ?? `Comensal #${g.id.slice(0, 4)}`}
                    {g.customer_id ? ' ✓' : ''}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={pending || !selectedTarget}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Moviendo…
              </>
            ) : (
              'Confirmar'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add "app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/move-items-sheet.tsx"
git commit -m "feat(salon): hoja de selección de mesa destino + reasignación para mover ítems"
```
Expected: typecheck OK.

---

## Task 6: Modo selección en `TicketCard`

**Files:**
- Modify: `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/ticket-card.tsx`

- [ ] **Step 1: Add selection props to the component signature**

En `ticket-card.tsx`, reemplazá la firma del componente (líneas del bloque `export function TicketCard({ ... }: { ... })`) para sumar las props de selección. La nueva firma:

```tsx
export function TicketCard({
  tenantSlug,
  ticket,
  items,
  onChange,
  kitchenFlowEnabled = false,
  isSessionOpen = true,
  selectionMode = false,
  selectedQuantities = {},
  onToggleItem,
  onSetItemQuantity,
  onToggleTicket,
}: {
  tenantSlug: string
  ticket: TicketRow
  items: TicketItemRow[]
  onChange: () => void
  kitchenFlowEnabled?: boolean
  isSessionOpen?: boolean
  /** Modo selección de ítems para mover entre mesas. */
  selectionMode?: boolean
  /** Mapa ticketItemId → cantidad seleccionada (ausente = no seleccionado). */
  selectedQuantities?: Record<string, number>
  onToggleItem?: (item: TicketItemRow, checked: boolean) => void
  onSetItemQuantity?: (itemId: string, qty: number) => void
  onToggleTicket?: (items: TicketItemRow[], checked: boolean) => void
}) {
```

- [ ] **Step 2: Render checkboxes + stepper in selection mode**

Reemplazá el bloque `<ul className="mt-2 space-y-1 text-sm">…</ul>` (la lista de ítems) por:

```tsx
      {selectionMode && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={items.every((it) => it.cancelled_at || selectedQuantities[it.id] != null)}
            onChange={(e) => onToggleTicket?.(items, e.target.checked)}
          />
          Seleccionar comanda entera
        </label>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((it) => {
          const selectedQty = selectedQuantities[it.id]
          const isSelected = selectedQty != null
          return (
            <li
              key={it.id}
              className={cn(
                'flex items-center gap-2',
                it.cancelled_at ? 'text-xs text-muted-foreground line-through' : '',
              )}
            >
              {selectionMode && !it.cancelled_at && (
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={isSelected}
                  onChange={(e) => onToggleItem?.(it, e.target.checked)}
                  aria-label={`Seleccionar ${it.menu_item_name ?? 'ítem'}`}
                />
              )}
              <span className="flex-1">
                {it.quantity}× {it.menu_item_name ?? 'Ítem'}
                {it.notes && <span className="text-xs text-muted-foreground"> — {it.notes}</span>}
              </span>
              {selectionMode && isSelected && it.quantity > 1 && (
                <span className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded border"
                    onClick={() => onSetItemQuantity?.(it.id, Math.max(1, (selectedQty ?? 1) - 1))}
                    aria-label="Menos"
                  >
                    −
                  </button>
                  <span className="w-6 text-center tabular-nums">{selectedQty}</span>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded border"
                    onClick={() =>
                      onSetItemQuantity?.(it.id, Math.min(it.quantity, (selectedQty ?? 1) + 1))
                    }
                    aria-label="Más"
                  >
                    +
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
```

- [ ] **Step 3: Hide action buttons while selecting**

Cambiá la condición del bloque de botones de acción: de `{isSessionOpen && (` a `{isSessionOpen && !selectionMode && (`. Es la línea que envuelve el `<div className="mt-3 flex flex-wrap gap-1.5">`.

- [ ] **Step 4: Add the `cn` import**

Asegurate de tener el import de `cn` arriba en el archivo (se usa ahora en el `<li>`):

```tsx
import { cn } from '@/lib/utils'
```

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add "app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/ticket-card.tsx"
git commit -m "feat(salon): modo selección de ítems en TicketCard"
```
Expected: typecheck OK.

---

## Task 7: Wiring en `SessionDetail`

**Files:**
- Modify: `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/session-detail.tsx`

- [ ] **Step 1: Import the new sheet and icon**

Agregá el import del componente nuevo (junto a los otros imports locales, p. ej. después de `import { TicketCard } from './ticket-card'`):

```tsx
import { MoveItemsSheet } from './move-items-sheet'
```

Y sumá `PackageOpen` al import de `lucide-react` (al bloque existente de íconos):

```tsx
import {
  ArrowRightLeft,
  Coins,
  MoreVertical,
  PackageOpen,
  Plus,
  Receipt,
  Tag,
  Users,
  XCircle,
} from 'lucide-react'
```

- [ ] **Step 2: Add selection state**

Justo después de `const [showMove, setShowMove] = useState(false)`, agregá:

```tsx
  const [selectionMode, setSelectionMode] = useState(false)
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [showMoveItems, setShowMoveItems] = useState(false)

  const toggleItem = (item: TicketItemRow, checked: boolean) =>
    setSelection((prev) => {
      const next = { ...prev }
      if (checked) next[item.id] = item.quantity
      else delete next[item.id]
      return next
    })
  const setItemQuantity = (itemId: string, qty: number) =>
    setSelection((prev) => ({ ...prev, [itemId]: qty }))
  const toggleTicket = (ticketItems: TicketItemRow[], checked: boolean) =>
    setSelection((prev) => {
      const next = { ...prev }
      for (const it of ticketItems) {
        if (it.cancelled_at) continue
        if (checked) next[it.id] = it.quantity
        else delete next[it.id]
      }
      return next
    })
  const exitSelection = () => {
    setSelectionMode(false)
    setSelection({})
  }
  const selectedMoves = Object.entries(selection).map(([ticketItemId, quantity]) => ({
    ticketItemId,
    quantity,
  }))
```

- [ ] **Step 3: Add a "Mover ítems" entry to the dropdown menu**

Dentro de `<DropdownMenuContent align="end">`, agregá un item después del de "Mover de mesa":

```tsx
                <DropdownMenuItem
                  onClick={() => {
                    setSelection({})
                    setSelectionMode(true)
                  }}
                >
                  <PackageOpen className="mr-1.5 size-4" />
                  Mover ítems
                </DropdownMenuItem>
```

- [ ] **Step 4: Pass selection props to `TicketCard`**

Reemplazá el render del `TicketCard` dentro del `tickets.map(...)` por:

```tsx
            tickets.map((t) => (
              <TicketCard
                key={t.id}
                tenantSlug={tenantSlug}
                ticket={t}
                items={itemsByTicket.get(t.id) ?? []}
                onChange={refresh}
                kitchenFlowEnabled={kitchenFlowEnabled}
                isSessionOpen={sessionStatus === 'open'}
                selectionMode={selectionMode}
                selectedQuantities={selection}
                onToggleItem={toggleItem}
                onSetItemQuantity={setItemQuantity}
                onToggleTicket={toggleTicket}
              />
            ))
```

- [ ] **Step 5: Add the sticky action bar + the sheet**

Justo antes del `</div>` de cierre del componente (después del `<MoveTableSheet ... />`), agregá:

```tsx
      {selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-screen-sm items-center gap-2">
            <Button variant="outline" className="flex-1" onClick={exitSelection}>
              Cancelar
            </Button>
            <Button
              className="flex-1"
              disabled={selectedMoves.length === 0}
              onClick={() => setShowMoveItems(true)}
            >
              Mover {selectedMoves.length} {selectedMoves.length === 1 ? 'ítem' : 'ítems'} →
            </Button>
          </div>
        </div>
      )}

      <MoveItemsSheet
        slug={tenantSlug}
        sourceSessionId={session.id}
        moves={selectedMoves}
        open={showMoveItems}
        onOpenChange={setShowMoveItems}
        onMoved={() => {
          exitSelection()
          void refresh()
        }}
      />
```

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npm run typecheck
npm run lint
git add "app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/session-detail.tsx"
git commit -m "feat(salon): wiring de mover ítems en el detalle de mesa"
```
Expected: typecheck OK; lint sin errores nuevos.

---

## Task 8: Verificación final, README y smoke manual

**Files:**
- Create: `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/README.md` (o sección en el README existente de salón si lo hay)

- [ ] **Step 1: Run the full quality suite**

```bash
npm run typecheck
npm run lint
npm run test:ci
```
Expected: typecheck OK; lint sin errores nuevos (las 18 warnings pre-existentes del repo siguen, no sumar nuevas); todos los unit tests verdes.

- [ ] **Step 2: Run the RLS suite against local Supabase**

```bash
npx supabase start
npm run db:reset
export $(npx supabase status -o env | xargs)
npx vitest run tests/rls/move-ticket-items.test.ts
```
Expected: PASS.

- [ ] **Step 3: Write the feature README**

Create `app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/README.md`:

```markdown
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
```

- [ ] **Step 4: Manual smoke test (document results in the PR)**

Levantá la app (`npm run dev`), entrá como `waiter`, y ejecutá:

1. Activá Mesa A; agregá **3 birras** asignadas a un cliente registrado.
2. Detalle de Mesa A → ⋮ → **Mover ítems** → tildá la birra → stepper a **1 de 3** → **Mover 1 ítem →**.
3. Elegí **Mesa B** (ocupada) → "Mantener el cliente de cada ítem" → **Confirmar**.
4. Verificá:
   - Mesa A queda con 2 birras; total bajó correctamente.
   - Mesa B muestra una comanda nueva con 1 birra; el cliente aparece como comensal; total subió.
   - La comanda de Mesa B **no** aparece en la pantalla de cocina.
   - `audit_log` tiene `ticket.items_moved`.
5. Repetí moviendo una **comanda entera** a una **mesa libre** → se abre sesión nueva en esa mesa.

Pegá pasos + resultado + screenshots en el PR.

- [ ] **Step 5: Commit the README**

```bash
git add "app/(salon)/[tenantSlug]/salon/mesas/[sessionId]/_components/README.md"
git commit -m "docs(salon): README de mover ítems entre mesas"
```

---

## Definition of Done (de CLAUDE.md)

- [ ] UI accesible y mobile-friendly.
- [ ] Migración generada y aplicada localmente.
- [ ] RLS/roles testeados (SQL) — `tests/rls/move-ticket-items.test.ts` verde.
- [ ] `types/database.ts` regenerado.
- [ ] Zod en cada borde (`moveTicketItemsSchema`).
- [ ] Unit + RLS verdes.
- [ ] Smoke manual documentado en el PR.
- [ ] Sin errores TS; sin warnings de lint nuevos.
- [ ] README de la feature actualizado.
- [ ] PR con descripción completa.
- [ ] Conventional Commits.
```
