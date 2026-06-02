# Reservas & Calendario UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cinco mejoras de UX sobre el módulo de reservas de salón: crear "formato" inline, popup de gestión rápida en "Ver", navegación día-a-día en el listado, popup del día + contador de tope en el calendario, y selector torta/champagne intuitivo.

**Architecture:** Se reutiliza al máximo la capa `lib/salon` existente (schemas zod, server actions, RPC `evaluate_day_capacity`, máquina de estados). Lógica pura nueva (dedupe de slug, agregación de capacidad mensual) vive en módulos testeables con Vitest. Los controles operativos del comensal se extraen a un componente de dominio compartido (`components/reservations/`) que consumen tanto la página de detalle como los nuevos popups. Una sola migración agrega una policy RLS de INSERT a staff sobre `scheduled_event_templates`.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), React 19, TypeScript estricto (`noUncheckedIndexedAccess`), Tailwind v4 + shadcn (`new-york`), Supabase (Postgres + RLS), react-hook-form + zod, motion/react, sonner, Vitest.

---

## File Structure

**Nuevos:**
- `lib/salon/slug-dedupe.ts` — `uniqueSlugFrom(name, existing)` puro.
- `lib/salon/month-capacity.ts` — `aggregateMonthCapacity()` + tipo `MonthCapacity`.
- `components/reservations/status-pill.tsx` — movido desde `app/.../reservas/_components/status-pill.tsx`.
- `components/reservations/reservation-status-controls.tsx` — controles operativos extraídos del sidebar.
- `components/reservations/reservation-quick-view.tsx` — popup de vista/gestión rápida.
- `app/(manager)/[tenantSlug]/reservas/_components/quick-template-dialog.tsx` — alta inline de formato.
- `app/(manager)/[tenantSlug]/reservas/_components/day-navigator.tsx` — stepper de día.
- `app/(manager)/[tenantSlug]/eventos/programados/_components/day-reservations-dialog.tsx` — popup del día del calendario.
- `supabase/migrations/20260602120000_salon_templates_staff_insert.sql` — policy RLS.
- `tests/lib/salon-slug-dedupe.test.ts`, `tests/lib/salon-quick-template.test.ts`, `tests/lib/salon-month-capacity.test.ts`, `tests/rls/salon-template-staff-insert.test.ts`.

**Modificados:**
- `lib/salon/schemas.ts` — `quickTemplateSchema`.
- `lib/salon/actions.ts` — `quickCreateScheduledTemplate`.
- `lib/salon/queries.ts` — `getMonthCapacity`.
- `lib/salon/client-actions.ts` — `fetchReservationsForDate`.
- `app/(manager)/[tenantSlug]/reservas/_components/reservation-detail-sidebar.tsx` — usa `ReservationStatusControls`.
- `app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx` — usa `ReservationQuickView` + import StatusPill nuevo.
- `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx` — `BringsItemControl` + alta inline de formato + `templates` en estado.
- `app/(manager)/[tenantSlug]/reservas/page.tsx` — vista por día.
- `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx` — acepta `?date=`.
- `app/(manager)/[tenantSlug]/eventos/programados/page.tsx` — pasa `monthCapacity`.
- `app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month.tsx` — badge + popup del día.
- `docs/reservas.md` — addendum.

**Borrados:**
- `app/(manager)/[tenantSlug]/reservas/_components/status-pill.tsx` (movido).

---

## Task 1: Helper puro `uniqueSlugFrom` (slug dedupe)

**Files:**
- Create: `lib/salon/slug-dedupe.ts`
- Test: `tests/lib/salon-slug-dedupe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/salon-slug-dedupe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uniqueSlugFrom } from '@/lib/salon/slug-dedupe'

describe('uniqueSlugFrom', () => {
  it('slugifica un nombre simple', () => {
    expect(uniqueSlugFrom('Pizza Libre', [])).toBe('pizza-libre')
  })

  it('normaliza acentos y mayúsculas', () => {
    expect(uniqueSlugFrom('Ramen Día Único', [])).toBe('ramen-dia-unico')
  })

  it('agrega sufijo numérico ante colisión', () => {
    expect(uniqueSlugFrom('Pizza Libre', ['pizza-libre'])).toBe('pizza-libre-2')
  })

  it('encuentra el primer sufijo libre', () => {
    expect(
      uniqueSlugFrom('Pizza Libre', ['pizza-libre', 'pizza-libre-2', 'pizza-libre-3']),
    ).toBe('pizza-libre-4')
  })

  it('usa fallback cuando el slug queda vacío', () => {
    const r = uniqueSlugFrom('🎂🎂', [])
    expect(r).toBe('formato')
  })

  it('respeta el máximo de 40 caracteres incluyendo el sufijo', () => {
    const long = 'a'.repeat(60)
    const r = uniqueSlugFrom(long, ['a'.repeat(40)])
    expect(r.length).toBeLessThanOrEqual(40)
    expect(r.endsWith('-2')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/salon-slug-dedupe.test.ts`
Expected: FAIL — `Cannot find module '@/lib/salon/slug-dedupe'`.

- [ ] **Step 3: Write the implementation**

Create `lib/salon/slug-dedupe.ts`:

```ts
import { slugify } from '@/lib/tenant/slugify'

/**
 * Deriva un slug válido y único para `scheduled_event_templates` a partir
 * de un nombre, evitando colisiones con `existing` (slugs ya usados por el
 * tenant). Respeta el límite de 40 chars del schema, sufijando `-2`, `-3`…
 */
export function uniqueSlugFrom(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  let base = slugify(name)
  if (base.length < 2) base = 'formato'

  if (!taken.has(base)) return base

  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`
    const candidate = base.slice(0, 40 - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  return base
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/salon-slug-dedupe.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/salon/slug-dedupe.ts tests/lib/salon-slug-dedupe.test.ts
git commit -m "feat(salon): helper puro uniqueSlugFrom para slugs de formato"
```

---

## Task 2: `quickTemplateSchema` (zod)

**Files:**
- Modify: `lib/salon/schemas.ts`
- Test: `tests/lib/salon-quick-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/salon-quick-template.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { quickTemplateSchema } from '@/lib/salon/schemas'

describe('quickTemplateSchema', () => {
  it('camino feliz con todos los campos', () => {
    const r = quickTemplateSchema.safeParse({
      name: 'Pizza Libre',
      default_capacity: 40,
      default_meal_type: 'dinner',
      color_hex: '#0ea5e9',
    })
    expect(r.success).toBe(true)
  })

  it('default_meal_type y color por defecto', () => {
    const r = quickTemplateSchema.safeParse({ name: 'Ramen' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.default_meal_type).toBe('dinner')
      expect(r.data.color_hex).toBe('#7c3aed')
      expect(r.data.default_capacity).toBeNull()
    }
  })

  it('capacity vacío → null', () => {
    const r = quickTemplateSchema.safeParse({ name: 'Ramen', default_capacity: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.default_capacity).toBeNull()
  })

  it('nombre vacío → error', () => {
    const r = quickTemplateSchema.safeParse({ name: '   ' })
    expect(r.success).toBe(false)
  })

  it('color inválido → error', () => {
    const r = quickTemplateSchema.safeParse({ name: 'X', color_hex: 'rojo' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/salon-quick-template.test.ts`
Expected: FAIL — `quickTemplateSchema` no existe (import undefined).

- [ ] **Step 3: Add the schema**

In `lib/salon/schemas.ts`, immediately AFTER the `scheduledTemplateSchema` block (after its closing `})` near line 203), insert:

```ts
// Alta rápida de formato (staff) desde el alta de reservas — campos mínimos.
// El slug se genera server-side; consume_special_reservations queda en false.
export const quickTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre').max(80),
  default_capacity: z
    .union([z.coerce.number().int().min(1).max(9999), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  default_meal_type: mealTypeEnum.default('dinner'),
  color_hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (#RRGGBB)')
    .default('#7c3aed'),
})
```

Then in the "Inferred input types" section (near line 288, after `export type ScheduledTemplateInput = ...`), add:

```ts
export type QuickTemplateInput = z.infer<typeof quickTemplateSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/salon-quick-template.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/salon/schemas.ts tests/lib/salon-quick-template.test.ts
git commit -m "feat(salon): quickTemplateSchema para alta inline de formato"
```

---

## Task 3: Server action `quickCreateScheduledTemplate`

**Files:**
- Modify: `lib/salon/actions.ts`

- [ ] **Step 1: Add imports**

In `lib/salon/actions.ts`, in the import block from `'./schemas'` (lines 15-31), add `quickTemplateSchema` to the list (keep alphabetical-ish; place after `moveScheduledEventSchema,`):

```ts
  moveScheduledEventSchema,
  quickTemplateSchema,
  rateTierSchema,
```

Then add a new import after the existing `import { humanizeSalonError } from './humanize'` line (line 14):

```ts
import { uniqueSlugFrom } from './slug-dedupe'
```

- [ ] **Step 2: Add the action**

In `lib/salon/actions.ts`, immediately AFTER the `upsertScheduledTemplate` function (after its closing `}` near line 606), insert:

```ts
/**
 * Alta rápida de formato desde el alta de reservas. A diferencia de
 * `upsertScheduledTemplate` (owner-only), esta la puede usar cualquier staff
 * (owner + cashier) — RLS lo permite vía la policy `set_staff_insert`. Solo
 * inserta (nunca edita), genera slug único y devuelve la fila completa para
 * que el form la agregue al combo y la seleccione.
 */
export async function quickCreateScheduledTemplate(
  slug: string,
  input: FormData | Record<string, unknown>,
): Promise<ActionState> {
  const access = await authorize(slug, STAFF)
  if (!access) return noAccess()

  const parsed = quickTemplateSchema.safeParse(asObject(input))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return badInput(first?.message ?? 'Datos inválidos', first?.path[0]?.toString())
  }

  const supabase = (await createClient()) as SBAny

  const { data: existingRows } = await supabase
    .from('scheduled_event_templates')
    .select('slug')
    .eq('tenant_id', access.tenant.id)
  const existing = ((existingRows ?? []) as Array<{ slug: string }>).map((r) => r.slug)
  const finalSlug = uniqueSlugFrom(parsed.data.name, existing)

  const { data, error } = await supabase
    .from('scheduled_event_templates')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      slug: finalSlug,
      consume_special_reservations: false,
      default_capacity: parsed.data.default_capacity,
      default_meal_type: parsed.data.default_meal_type,
      color_hex: parsed.data.color_hex,
      active: true,
    })
    .select('*')
    .single()

  if (error) return { ok: false, message: humanizeSalonError(error.message), code: error.message }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'scheduled_event_template.created',
    entity: 'scheduled_event_template',
    entityId: (data as { id: string }).id,
    payload: { name: parsed.data.name, source: 'quick_create' },
  })

  revalidatePath(`/${slug}/eventos/templates`)
  revalidatePath(`/${slug}/eventos/programados`)
  return { ok: true, message: 'Formato creado.', data: { template: data as Record<string, unknown> } }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/salon/actions.ts
git commit -m "feat(salon): quickCreateScheduledTemplate (staff) para alta inline de formato"
```

---

## Task 4: Migración RLS — INSERT de templates para staff + test RLS

**Files:**
- Create: `supabase/migrations/20260602120000_salon_templates_staff_insert.sql`
- Test: `tests/rls/salon-template-staff-insert.test.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260602120000_salon_templates_staff_insert.sql`:

```sql
-- Permite que staff (owner + cashier) cree formatos (scheduled_event_templates)
-- desde el alta de reservas. La edición/borrado siguen siendo solo-owner
-- (policy existente `set_owner_write`). Las policies RLS se combinan con OR,
-- así que esto solo AGREGA capacidad de INSERT a cashier; owner ya podía.
-- El GRANT a `authenticated` ya existe en la migración core.

drop policy if exists "set_staff_insert" on public.scheduled_event_templates;

create policy "set_staff_insert" on public.scheduled_event_templates
  for insert to authenticated
  with check (public.user_role_in_tenant(tenant_id) in ('owner', 'cashier'));
```

- [ ] **Step 2: Apply the migration locally**

Run: `npm run db:reset`
Expected: corre todas las migraciones + seed sin errores; la nueva migración aparece al final del log.

(Si Docker/Supabase local no está disponible en este entorno, saltar la aplicación; el job `rls` de CI la aplica con `supabase start` y corre los tests de `tests/rls`.)

- [ ] **Step 3: Write the RLS test**

Create `tests/rls/salon-template-staff-insert.test.ts`:

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

describeIfRls('RLS — scheduled_event_templates staff insert', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  function tpl(extra: Record<string, unknown> = {}) {
    return {
      tenant_id: tenantA.id,
      name: 'Cashier Libre',
      slug: uniqueSlug('cashier-libre'),
      consume_special_reservations: false,
      default_capacity: 30,
      default_meal_type: 'dinner',
      color_hex: '#7c3aed',
      active: true,
      ...extra,
    }
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('tpl-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('tpl-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('tpl-ownerB') })
    tenantA = await createTenant({ name: 'Bar TPL A', slug: uniqueSlug('tpl-a'), ownerId: ownerA.userId })
    tenantB = await createTenant({ name: 'Bar TPL B', slug: uniqueSlug('tpl-b'), ownerId: ownerB.userId })
    const service = getServiceClient()
    await service
      .from('memberships')
      .insert([{ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' }])
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('cashier de A inserta un formato → ok', async () => {
    const { data, error } = await cashierA.client
      .from('scheduled_event_templates')
      .insert(tpl())
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('cashier de A NO puede editar un formato existente (sigue owner-only)', async () => {
    const service = getServiceClient()
    const { data: created } = await service
      .from('scheduled_event_templates')
      .insert(tpl({ slug: uniqueSlug('owned') }))
      .select('id')
      .single()
    const id = (created as { id: string }).id

    await cashierA.client
      .from('scheduled_event_templates')
      .update({ name: 'Hackeado' })
      .eq('id', id)

    // RLS no permite el UPDATE a cashier: la fila no cambió.
    const { data: after } = await service
      .from('scheduled_event_templates')
      .select('name')
      .eq('id', id)
      .single()
    expect((after as { name: string }).name).not.toBe('Hackeado')
  })

  it('cashier de A NO puede insertar en el tenant B', async () => {
    const { error } = await cashierA.client
      .from('scheduled_event_templates')
      .insert(tpl({ tenant_id: tenantB.id, slug: uniqueSlug('cross') }))
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 4: Run the RLS test**

Run (con Supabase local levantado y envs exportadas — ver CLAUDE.md §16):
`npx vitest run tests/rls/salon-template-staff-insert.test.ts`
Expected: PASS (3 tests). Sin envs, los tests se auto-skipean (`describe.skip`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260602120000_salon_templates_staff_insert.sql tests/rls/salon-template-staff-insert.test.ts
git commit -m "feat(salon): RLS INSERT de formatos para staff + test"
```

---

## Task 5: Helper puro `aggregateMonthCapacity`

**Files:**
- Create: `lib/salon/month-capacity.ts`
- Test: `tests/lib/salon-month-capacity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/salon-month-capacity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aggregateMonthCapacity } from '@/lib/salon/month-capacity'

const defaults = { planta_alta: 30, planta_baja: 30 }

describe('aggregateMonthCapacity', () => {
  it('defaultTotal = suma de zonas', () => {
    const r = aggregateMonthCapacity({ reservations: [], overrides: [], defaults })
    expect(r.defaultTotal).toBe(60)
    expect(r.days).toEqual({})
  })

  it('suma comensales por día sobre zonas físicas', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        { reservation_date: '2026-06-05', zone: 'planta_alta', estimated_guests: 4, actual_guests: null, status: 'pending' },
        { reservation_date: '2026-06-05', zone: 'planta_baja', estimated_guests: 6, actual_guests: null, status: 'arrived' },
      ],
      overrides: [],
      defaults,
    })
    expect(r.days['2026-06-05']).toEqual({ used: 10, total: 60 })
  })

  it('usa actual_guests solo si status=closed', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        { reservation_date: '2026-06-06', zone: 'planta_alta', estimated_guests: 4, actual_guests: 7, status: 'closed' },
        { reservation_date: '2026-06-06', zone: 'planta_alta', estimated_guests: 5, actual_guests: 9, status: 'seated' },
      ],
      overrides: [],
      defaults,
    })
    // closed → 7, seated → estimated 5 = 12
    expect(r.days['2026-06-06']?.used).toBe(12)
  })

  it('excluye cancelled/no_show y zona event_floating', () => {
    const r = aggregateMonthCapacity({
      reservations: [
        { reservation_date: '2026-06-07', zone: 'planta_alta', estimated_guests: 4, actual_guests: null, status: 'cancelled' },
        { reservation_date: '2026-06-07', zone: 'planta_alta', estimated_guests: 3, actual_guests: null, status: 'no_show' },
        { reservation_date: '2026-06-07', zone: 'event_floating', estimated_guests: 8, actual_guests: null, status: 'pending' },
        { reservation_date: '2026-06-07', zone: 'planta_baja', estimated_guests: 2, actual_guests: null, status: 'pending' },
      ],
      overrides: [],
      defaults,
    })
    expect(r.days['2026-06-07']?.used).toBe(2)
  })

  it('aplica overrides por zona al total del día', () => {
    const r = aggregateMonthCapacity({
      reservations: [],
      overrides: [{ override_date: '2026-06-08', zone: 'planta_alta', capacity: 100 }],
      defaults,
    })
    // PA override 100 + PB default 30 = 130
    expect(r.days['2026-06-08']).toEqual({ used: 0, total: 130 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/salon-month-capacity.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write the implementation**

Create `lib/salon/month-capacity.ts`:

```ts
import type { SalonReservationStatus, SalonZone } from './types'

export type MonthCapacity = {
  /** Tope total del salón (PA + PB) sin overrides, para días sin entrada propia. */
  defaultTotal: number
  /** Por fecha YYYY-MM-DD con reservas u overrides: cubiertos usados y tope del día. */
  days: Record<string, { used: number; total: number }>
}

type AggregateInput = {
  reservations: Array<{
    reservation_date: string
    zone: SalonZone
    estimated_guests: number
    actual_guests: number | null
    status: SalonReservationStatus
  }>
  overrides: Array<{ override_date: string; zone: 'planta_alta' | 'planta_baja'; capacity: number }>
  defaults: { planta_alta: number; planta_baja: number }
}

/**
 * Agrega, para un mes, los cubiertos reservados por día y el tope del día.
 *
 * - `used` = suma de comensales de reservas activas en zonas físicas
 *   (PA + PB). Usa `actual_guests` si la reserva está `closed`, si no
 *   `estimated_guests`. Excluye `cancelled`/`no_show` y `event_floating`
 *   (esas consumen el cupo de su evento, no el del salón).
 * - `total` = cap(PA) + cap(PB) con override por fecha aplicado por zona.
 *
 * Puro y determinístico — testeable sin DB. La query `getMonthCapacity`
 * le pasa filas crudas de Supabase.
 */
export function aggregateMonthCapacity(input: AggregateInput): MonthCapacity {
  const defaultTotal = input.defaults.planta_alta + input.defaults.planta_baja
  const days: Record<string, { used: number; total: number }> = {}

  const ensure = (date: string) => {
    const cur = days[date]
    if (cur) return cur
    const fresh = { used: 0, total: defaultTotal }
    days[date] = fresh
    return fresh
  }

  // Overrides: armamos cap por zona por fecha, partiendo de los defaults.
  const zoneCaps: Record<string, { planta_alta: number; planta_baja: number }> = {}
  for (const o of input.overrides) {
    const entry = zoneCaps[o.override_date] ?? { ...input.defaults }
    entry[o.zone] = o.capacity
    zoneCaps[o.override_date] = entry
  }
  for (const [date, caps] of Object.entries(zoneCaps)) {
    ensure(date).total = caps.planta_alta + caps.planta_baja
  }

  for (const r of input.reservations) {
    if (r.status === 'cancelled' || r.status === 'no_show') continue
    if (r.zone !== 'planta_alta' && r.zone !== 'planta_baja') continue
    const guests =
      r.status === 'closed' && r.actual_guests != null ? r.actual_guests : r.estimated_guests
    ensure(r.reservation_date).used += guests
  }

  return { defaultTotal, days }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/salon-month-capacity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/salon/month-capacity.ts tests/lib/salon-month-capacity.test.ts
git commit -m "feat(salon): aggregateMonthCapacity para contador de tope mensual"
```

---

## Task 6: Query `getMonthCapacity` + client action `fetchReservationsForDate`

**Files:**
- Modify: `lib/salon/queries.ts`
- Modify: `lib/salon/client-actions.ts`

- [ ] **Step 1: Add `getMonthCapacity` to queries**

In `lib/salon/queries.ts`, add to the type import block from `'./types'` (lines 4-16) the `SalonZone` type if not present — it is NOT currently imported, so add it. Change:

```ts
  SalonReservationStatus,
  SalonZoneCapacityOverrideRow,
```
to:
```ts
  SalonReservationStatus,
  SalonZone,
  SalonZoneCapacityOverrideRow,
```

Add a new import right after the existing `import { computePeakWindow, type PeakWindow } from './peak'` line (line 3):

```ts
import { aggregateMonthCapacity, type MonthCapacity } from './month-capacity'
```

Then, immediately AFTER `getDayCapacitySnapshot` (after its closing `}` near line 247), insert:

```ts
/**
 * Capacidad agregada por día para un mes (YYYY-MM). Pensado para el badge
 * del calendario de salón. Resuelve con 3 lecturas (reservas del mes,
 * overrides, defaults) y delega el cómputo a `aggregateMonthCapacity`.
 */
export async function getMonthCapacity(opts: {
  tenantId: string
  ym: string // YYYY-MM
}): Promise<MonthCapacity> {
  const supabase = (await createClient()) as SBAny
  const [yStr, mStr] = opts.ym.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const from = `${opts.ym}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const to = `${opts.ym}-${String(lastDay).padStart(2, '0')}`

  const [resResult, overrides, defaults] = await Promise.all([
    supabase
      .from('salon_reservations')
      .select('reservation_date, zone, estimated_guests, actual_guests, status')
      .eq('tenant_id', opts.tenantId)
      .gte('reservation_date', from)
      .lte('reservation_date', to)
      .not('status', 'in', '(cancelled,no_show)'),
    listZoneOverrides({ tenantId: opts.tenantId, from, to }),
    getZoneCapacityDefaults({ tenantId: opts.tenantId }),
  ])
  if (resResult.error) throw resResult.error

  const reservations = ((resResult.data ?? []) as Array<{
    reservation_date: string
    zone: SalonZone
    estimated_guests: number
    actual_guests: number | null
    status: SalonReservationStatus
  }>)

  const physicalOverrides = overrides
    .filter((o) => o.zone === 'planta_alta' || o.zone === 'planta_baja')
    .map((o) => ({
      override_date: o.override_date,
      zone: o.zone as 'planta_alta' | 'planta_baja',
      capacity: o.capacity,
    }))

  return aggregateMonthCapacity({ reservations, overrides: physicalOverrides, defaults })
}
```

> Note: `getMonthCapacity` referencia `listZoneOverrides` y `getZoneCapacityDefaults`, ambas ya definidas más abajo en el mismo archivo (hoisting de funciones `async function` aplica).

- [ ] **Step 2: Add `fetchReservationsForDate` to client-actions**

In `lib/salon/client-actions.ts`, change the import from `'./queries'` (lines 16-20) to include `listTimelineForDate`:

```ts
import {
  getDayCapacitySnapshot,
  listScheduledEventsForDate,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from './queries'
```

Change the type import (line 21) to add `ReservationWithJoins`:

```ts
import type { DayCapacityBucket, ReservationWithJoins } from './types'
```

Then append at the end of the file:

```ts
export async function fetchReservationsForDate(
  slug: string,
  date: string,
): Promise<
  { ok: true; reservations: ReservationWithJoins[] } | { ok: false; message: string }
> {
  const access = await authorizeRead(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }
  try {
    const reservations = await listTimelineForDate({ tenantId: access.tenant.id, date })
    return { ok: true, reservations }
  } catch {
    return { ok: false, message: 'No pudimos leer las reservas del día.' }
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/salon/queries.ts lib/salon/client-actions.ts
git commit -m "feat(salon): getMonthCapacity + fetchReservationsForDate"
```

---

## Task 7: Mover StatusPill + extraer `ReservationStatusControls`

**Files:**
- Create: `components/reservations/status-pill.tsx`
- Create: `components/reservations/reservation-status-controls.tsx`
- Delete: `app/(manager)/[tenantSlug]/reservas/_components/status-pill.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservation-detail-sidebar.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx`

- [ ] **Step 1: Create the moved StatusPill**

Create `components/reservations/status-pill.tsx` with the EXACT content of the existing `app/(manager)/[tenantSlug]/reservas/_components/status-pill.tsx`:

```tsx
import type { SalonReservationStatus } from '@/lib/salon/types'
import { STATUS_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const STYLES: Record<SalonReservationStatus, string> = {
  pending:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60',
  arrived:
    'bg-blue-50 text-blue-900 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/60',
  seated:
    'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/60',
  closed:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800',
  no_show:
    'bg-rose-50 text-rose-900 ring-rose-200 line-through dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60',
  cancelled:
    'bg-zinc-100 text-zinc-500 ring-zinc-200 line-through dark:bg-zinc-900/60 dark:text-zinc-500 dark:ring-zinc-800',
}

export function StatusPill({
  status,
  className,
}: {
  status: SalonReservationStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  )
}
```

- [ ] **Step 2: Delete the old StatusPill**

```bash
git rm "app/(manager)/[tenantSlug]/reservas/_components/status-pill.tsx"
```

- [ ] **Step 3: Create `ReservationStatusControls`**

Create `components/reservations/reservation-status-controls.tsx`:

```tsx
'use client'

import {
  ChevronDown,
  ClipboardEdit,
  DoorClosed,
  DoorOpen,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cancelSalonReservation,
  markArrived,
  markClosed,
  markNoShow,
  markSeated,
  revertStatus,
  updateActualGuests,
} from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { StatusPill } from './status-pill'

/**
 * Controles operativos del comensal (Llegó / Sentar / Cerrar mesa + revertir
 * + No vino + cantidad real + cancelar). Extraído del sidebar de detalle para
 * reusarlo en el popup de gestión rápida y en el popup del día del calendario.
 *
 * `onChanged` se llama tras cada acción exitosa: el popup lo usa para refrescar
 * su data; el sidebar lo omite (las Server Actions ya hacen revalidatePath).
 */
export function ReservationStatusControls({
  tenantSlug,
  reservation,
  onChanged,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [actualGuests, setActualGuests] = useState<number>(
    reservation.actual_guests ?? reservation.estimated_guests,
  )

  function run(p: Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const r = await p
      if (r.ok) {
        toast.success(r.message ?? 'Listo.')
        onChanged?.()
      } else toast.error(r.message ?? 'Falló.')
    })
  }

  const allowedNext: SalonReservationStatus[] = (() => {
    switch (reservation.status) {
      case 'pending':
        return ['arrived', 'no_show', 'cancelled']
      case 'arrived':
        return ['seated', 'pending']
      case 'seated':
        return ['closed', 'arrived']
      case 'closed':
        return ['seated']
      case 'no_show':
      case 'cancelled':
        return []
    }
  })()

  return (
    <div className="space-y-4">
      {/* Estado actual + acciones */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <header className="mb-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Estado</span>
          <StatusPill status={reservation.status} />
        </header>

        <div className="grid grid-cols-1 gap-2">
          {(['arrived', 'seated', 'closed'] as const).map((to) => {
            const enabled = allowedNext.includes(to)
            const icon = to === 'arrived' ? DoorOpen : to === 'seated' ? Users : DoorClosed
            const Icon = icon
            const label = to === 'arrived' ? 'Llegó' : to === 'seated' ? 'Sentar' : 'Cerrar mesa'
            if (to === 'closed') {
              return (
                <ClosedDialog
                  key={to}
                  disabled={!enabled || pending}
                  defaultGuests={actualGuests}
                  estimated={reservation.estimated_guests}
                  onConfirm={(n) => {
                    setActualGuests(n)
                    run(markClosed(tenantSlug, reservation.id, n))
                  }}
                />
              )
            }
            return (
              <Button
                key={to}
                disabled={!enabled || pending}
                className={cn(
                  'h-11 justify-start gap-3',
                  to === 'arrived'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white',
                )}
                onClick={() => {
                  if (to === 'arrived') run(markArrived(tenantSlug, reservation.id))
                  if (to === 'seated') run(markSeated(tenantSlug, reservation.id))
                }}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            )
          })}

          {allowedNext.includes('pending') ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'pending' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Revertir a Pendiente
            </Button>
          ) : null}
          {allowedNext.includes('arrived') && reservation.status === 'seated' ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'arrived' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Revertir a Llegó
            </Button>
          ) : null}
          {allowedNext.includes('seated') && reservation.status === 'closed' ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'seated' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Reabrir mesa
            </Button>
          ) : null}

          {reservation.status !== 'no_show' &&
          reservation.status !== 'cancelled' &&
          allowedNext.includes('no_show') ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs text-muted-foreground"
              disabled={pending}
              onClick={() => run(markNoShow(tenantSlug, reservation.id))}
            >
              <XCircle className="size-4" />
              No vino
            </Button>
          ) : null}
        </div>
      </section>

      {/* Cantidad real inline editor */}
      {reservation.status !== 'cancelled' && reservation.status !== 'no_show' ? (
        <section className="rounded-xl border border-border/70 bg-card p-4">
          <header className="mb-3 flex items-center gap-2">
            <ClipboardEdit className="size-4 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Cantidad real
            </span>
          </header>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={99}
              value={actualGuests}
              onChange={(e) => setActualGuests(Math.max(1, Math.min(99, Number(e.target.value))))}
              className="h-10 w-20 text-center text-base tabular-nums"
            />
            <Button
              size="sm"
              disabled={pending || actualGuests === reservation.actual_guests}
              onClick={() =>
                run(
                  updateActualGuests(tenantSlug, {
                    id: reservation.id,
                    actual_guests: actualGuests,
                  } as Record<string, unknown>),
                )
              }
            >
              Guardar
            </Button>
          </div>
          {reservation.actual_guests === null ? (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Sin cantidad real cargada — la comisión se calcula sobre{' '}
              {reservation.estimated_guests} estimadas.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Real cargada: {reservation.actual_guests} (estimadas {reservation.estimated_guests}).
            </p>
          )}
        </section>
      ) : null}

      {/* Cancelar */}
      {reservation.status !== 'cancelled' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full gap-2 text-rose-700 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-300"
              disabled={pending}
            >
              <Trash2 className="size-4" />
              Cancelar reserva
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
              <AlertDialogDescription>
                Liberá el cupo del bucket. La comisión asociada se reversa automáticamente (excepto
                las entries ya pagadas).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <CancelReasonForm
              onSubmit={(reason) =>
                run(
                  cancelSalonReservation(tenantSlug, {
                    id: reservation.id,
                    reason,
                  } as Record<string, unknown>),
                )
              }
            />
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

function ClosedDialog({
  disabled,
  defaultGuests,
  estimated,
  onConfirm,
}: {
  disabled: boolean
  defaultGuests: number
  estimated: number
  onConfirm: (n: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [guests, setGuests] = useState(defaultGuests)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          className="h-11 justify-start gap-3 bg-slate-700 hover:bg-slate-800 text-white"
        >
          <DoorClosed className="size-4" />
          Cerrar mesa
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cerrar mesa</AlertDialogTitle>
          <AlertDialogDescription>
            Confirmá la cantidad real de personas que pasaron por la mesa. Se recalcula la comisión.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4 flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setGuests(Math.max(1, guests - 1))}
          >
            −
          </Button>
          <div className="text-center">
            <div className="font-mono text-3xl font-semibold tabular-nums">{guests}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              personas reales
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setGuests(Math.min(99, guests + 1))}
          >
            +
          </Button>
        </div>
        {guests !== estimated ? (
          <p className="text-center text-xs text-amber-700 dark:text-amber-300">
            Estimaste {estimated}, vas a cerrar con {guests}.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(guests)
              setOpen(false)
            }}
          >
            Cerrar mesa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CancelReasonForm({ onSubmit }: { onSubmit: (reason?: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <>
      <div className="space-y-2 py-4">
        <Input
          placeholder="Motivo (opcional)…"
          value={reason}
          maxLength={280}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Volver</AlertDialogCancel>
        <AlertDialogAction
          className="bg-rose-600 hover:bg-rose-700"
          onClick={() => onSubmit(reason.trim() || undefined)}
        >
          Cancelar reserva
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}
```

- [ ] **Step 4: Slim down the sidebar to use the shared controls**

Replace the ENTIRE content of `app/(manager)/[tenantSlug]/reservas/_components/reservation-detail-sidebar.tsx` with:

```tsx
'use client'

import { AlertTriangle, CheckCircle2, Circle, Clock4 } from 'lucide-react'
import { ReservationStatusControls } from '@/components/reservations/reservation-status-controls'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ReservationDetailSidebar({
  tenantSlug,
  reservation,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
}) {
  return (
    <aside className="space-y-4">
      <ReservationStatusControls tenantSlug={tenantSlug} reservation={reservation} />

      {/* Timeline operativo */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <header className="mb-3 flex items-center gap-2">
          <Clock4 className="size-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Timeline</span>
        </header>
        <ol className="space-y-2 text-sm">
          <Step label="Creada" at={reservation.created_at} done />
          <Step label="Llegó" at={reservation.arrived_at} done={!!reservation.arrived_at} />
          <Step label="Sentada" at={reservation.seated_at} done={!!reservation.seated_at} />
          <Step label="Cerrada" at={reservation.closed_at} done={!!reservation.closed_at} />
          {reservation.cancelled_at ? (
            <Step
              label="Cancelada"
              at={reservation.cancelled_at}
              done
              negative
              note={reservation.cancelled_reason ?? undefined}
            />
          ) : null}
        </ol>
      </section>
    </aside>
  )
}

function Step({
  label,
  at,
  done,
  negative,
  note,
}: {
  label: string
  at: string | null
  done: boolean
  negative?: boolean
  note?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5">
        {done ? (
          negative ? (
            <AlertTriangle className="size-4 text-rose-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )
        ) : (
          <Circle className="size-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatRelative(at)}
          </span>
        </div>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  )
}
```

- [ ] **Step 5: Update StatusPill import in the table**

In `app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx`, change line 16:

```tsx
import { StatusPill } from './status-pill'
```
to:
```tsx
import { StatusPill } from '@/components/reservations/status-pill'
```

- [ ] **Step 6: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (la página de detalle sigue compilando; el sidebar ahora delega los controles).

- [ ] **Step 7: Commit**

```bash
git add components/reservations/status-pill.tsx components/reservations/reservation-status-controls.tsx "app/(manager)/[tenantSlug]/reservas/_components/reservation-detail-sidebar.tsx" "app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx"
git commit -m "refactor(reservas): extraer ReservationStatusControls + StatusPill a components/reservations"
```

---

## Task 8: `ReservationQuickView` + wire en la tabla (Feature 2)

**Files:**
- Create: `components/reservations/reservation-quick-view.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx`

- [ ] **Step 1: Create the popup component**

Create `components/reservations/reservation-quick-view.tsx`:

```tsx
'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { ReservationStatusControls } from './reservation-status-controls'
import { StatusPill } from './status-pill'

function fmtTime(t: string): string {
  return t.slice(0, 5)
}
function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') return r.scheduled_event?.template?.name ?? 'Evento'
  return ZONE_LABELS[r.zone]
}

/**
 * Popup de vista + gestión rápida de una reserva. Reemplaza la navegación a la
 * página de detalle desde el listado. La edición a fondo sigue en /reservas/[id]
 * vía el botón "Editar reserva".
 *
 * `trigger` permite usar una fila completa como disparador (popup del día).
 * `onChanged` refresca el contenedor cuando aplica (popup del día).
 */
export function ReservationQuickView({
  tenantSlug,
  reservation,
  onChanged,
  trigger,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const r = reservation
  const guests = r.actual_guests ?? r.estimated_guests
  const guestsHint =
    r.actual_guests != null && r.actual_guests !== r.estimated_guests
      ? ` (est. ${r.estimated_guests})`
      : ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm">
            Ver
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 font-serif">
            <span className="truncate">{r.guest_name}</span>
            <StatusPill status={r.status} />
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Cuándo">
            {fmtDate(r.reservation_date)} · {fmtTime(r.reservation_time_local)}
          </Field>
          <Field label="Dónde">{zoneOrEvent(r)}</Field>
          <Field label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Field>
          <Field label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Field>
          <Field label="Personas">
            <span className="tabular-nums">{guests}</span>
            <span className="text-[11px] text-muted-foreground">{guestsHint}</span>
          </Field>
          <Field label="Origen">{ORIGIN_LABELS[r.origin]}</Field>
          <Field label="Gestor">
            {r.primary_manager?.display_name ?? '—'}
            {r.assistant_manager ? ` + ${r.assistant_manager.display_name}` : ''}
          </Field>
          {r.cake_count > 0 || r.champagne_count > 0 ? (
            <Field label="Cumpleaños">
              {r.cake_count > 0 ? `🎂 ${r.cake_count}` : ''}
              {r.cake_count > 0 && r.champagne_count > 0 ? ' · ' : ''}
              {r.champagne_count > 0 ? `🍾 ${r.champagne_count}` : ''}
            </Field>
          ) : null}
        </dl>

        {r.comments ? (
          <p className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
            {r.comments}
          </p>
        ) : null}

        <ReservationStatusControls tenantSlug={tenantSlug} reservation={r} onChanged={onChanged} />

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="outline">
            <Link href={`/${tenantSlug}/reservas/${r.id}`}>Editar reserva</Link>
          </Button>
          <DialogClose asChild>
            <Button variant="ghost">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the table's action cell**

In `app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx`:

Add this import after the StatusPill import (now `@/components/reservations/status-pill`):

```tsx
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
```

Replace the action cell (lines 174-178):

```tsx
                  <DataTableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/${tenantSlug}/reservas/${r.id}`}>Ver</Link>
                    </Button>
                  </DataTableCell>
```
with:
```tsx
                  <DataTableCell className="text-right">
                    <ReservationQuickView tenantSlug={tenantSlug} reservation={r} />
                  </DataTableCell>
```

> `Button` y `Link` siguen usándose en el footer de paginación, así que sus imports se mantienen.

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Smoke (manual)**

Run `npm run dev`, ir a `/{slug}/reservas`, tocar "Ver" en una fila → abre el popup con datos + controles. Hacer "Llegó" → toast, el pill cambia, la fila del listado se actualiza. "Editar reserva" navega a `/reservas/[id]`.

- [ ] **Step 5: Commit**

```bash
git add components/reservations/reservation-quick-view.tsx "app/(manager)/[tenantSlug]/reservas/_components/reservations-table.tsx"
git commit -m "feat(reservas): popup de gestión rápida en \"Ver\""
```

---

## Task 9: `BringsItemControl` (torta/champagne — Feature 5)

**Files:**
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx`

- [ ] **Step 1: Replace the cake/champagne usage**

In `reservation-form.tsx`, replace the two `CountControl` usages (lines 662-675) inside the "Cumpleaños" FieldGroup:

```tsx
                <CountControl
                  icon={Cake}
                  label="Tortas que traen"
                  max={2}
                  value={values.cake_count}
                  onChange={(v) => form.setValue('cake_count', v)}
                />
                <CountControl
                  icon={GlassWater}
                  label="Champagne que traen"
                  max={2}
                  value={values.champagne_count}
                  onChange={(v) => form.setValue('champagne_count', v)}
                />
```
with:
```tsx
                <BringsItemControl
                  icon={Cake}
                  label="¿Traen torta?"
                  value={values.cake_count}
                  onChange={(v) => form.setValue('cake_count', v)}
                />
                <BringsItemControl
                  icon={GlassWater}
                  label="¿Traen champagne?"
                  value={values.champagne_count}
                  onChange={(v) => form.setValue('champagne_count', v)}
                />
```

- [ ] **Step 2: Replace the `CountControl` definition with `BringsItemControl`**

In `reservation-form.tsx`, replace the entire `CountControl` function (lines 924-963) with:

```tsx
function BringsItemControl({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: lucide icon type
  icon: any
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const brings = value > 0
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            'h-10 rounded-lg border px-4 text-sm font-medium transition-all',
            !brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => onChange(value > 0 ? value : 1)}
          className={cn(
            'flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-all',
            brings
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card/40 text-muted-foreground hover:bg-secondary',
          )}
        >
          <Icon className="size-4" />
          Sí
        </button>
      </div>
      <AnimatePresence initial={false}>
        {brings ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-muted-foreground">Cantidad</span>
              <div className="flex h-10 items-center rounded-lg border border-border bg-card/60">
                <button
                  type="button"
                  aria-label="Quitar"
                  onClick={() => onChange(Math.max(1, value - 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="w-8 text-center font-mono text-base font-semibold tabular-nums">
                  {value}
                </span>
                <button
                  type="button"
                  aria-label="Agregar"
                  onClick={() => onChange(Math.min(2, value + 1))}
                  className="flex h-full w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary/60"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground">máx 2</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
```

> Los imports `Cake`, `GlassWater`, `Minus`, `Plus`, `AnimatePresence`, `motion`, `Label`, `cn` ya están presentes en el archivo.

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no debe quedar referencia a `CountControl`).

- [ ] **Step 4: Smoke (manual)**

En `/reservas/nuevo`, poner `Naturaleza = Cumpleaños`: aparece "¿Traen torta?" Sí/No; al tocar "Sí" aparece el stepper 1–2; al volver a "No" se oculta y `cake_count = 0`.

- [ ] **Step 5: Commit**

```bash
git add "app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx"
git commit -m "feat(reservas): selector torta/champagne con toggle Sí/No + cantidad"
```

---

## Task 10: Alta inline de formato (Feature 1) — `QuickTemplateDialog` + form

**Files:**
- Create: `app/(manager)/[tenantSlug]/reservas/_components/quick-template-dialog.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx`

- [ ] **Step 1: Create the dialog component**

Create `app/(manager)/[tenantSlug]/reservas/_components/quick-template-dialog.tsx`:

```tsx
'use client'

import { Loader2, Plus } from 'lucide-react'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { quickCreateScheduledTemplate } from '@/lib/salon/actions'
import { MEAL_TYPE_LABELS, type MealType, type ScheduledEventTemplateRow } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const MEALS: MealType[] = ['breakfast', 'lunch', 'tea_time', 'dinner', 'hub_event']
const PALETTE = ['#7c3aed', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#ec4899'] as const

export function QuickTemplateDialog({
  tenantSlug,
  defaultMealType,
  onCreated,
}: {
  tenantSlug: string
  defaultMealType: MealType
  onCreated: (template: ScheduledEventTemplateRow) => void
}) {
  const nameId = useId()
  const capId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [mealType, setMealType] = useState<MealType>(defaultMealType)
  const [color, setColor] = useState<string>(PALETTE[0])
  const [pending, startTransition] = useTransition()

  function reset() {
    setName('')
    setCapacity('')
    setMealType(defaultMealType)
    setColor(PALETTE[0])
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Poné un nombre')
      return
    }
    startTransition(async () => {
      const result = await quickCreateScheduledTemplate(tenantSlug, {
        name: name.trim(),
        default_capacity: capacity === '' ? '' : Number(capacity),
        default_meal_type: mealType,
        color_hex: color,
      })
      if (result.ok && result.data?.template) {
        toast.success('Formato creado.')
        onCreated(result.data.template as ScheduledEventTemplateRow)
        setOpen(false)
        reset()
      } else {
        toast.error(result.ok ? 'No se pudo crear el formato.' : result.message)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Crear formato nuevo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Nuevo formato</DialogTitle>
          <DialogDescription>
            Sushi Libre, Pizza Libre, Ramen… Queda guardado en el catálogo para reusarlo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Nombre</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Pizza Libre"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo de servicio</Label>
            <Select value={mealType} onValueChange={(v) => setMealType(v as MealType)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEALS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MEAL_TYPE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={capId}>Cupo sugerido (opcional)</Label>
            <Input
              id={capId}
              type="number"
              min={1}
              max={9999}
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Ej. 40"
              className="tabular-nums"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-7 rounded-full border-2 transition-transform',
                    color === c ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Crear y usar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Lift `templates` into state in the form**

In `reservation-form.tsx`:

(a) In the destructured props (lines 128-139), rename `templates,` to `templates: templatesProp,`:

```tsx
export function ReservationForm({
  mode,
  tenantSlug,
  initialDate,
  managers,
  templates: templatesProp,
  initialEventsForDate,
  rateTiers,
  bonusPerGuestCents,
  reservationId,
  initialValues,
}: Props) {
```

(b) Add the import near the other local component imports (after line 41 import of schemas, before the type block, add):

```tsx
import { QuickTemplateDialog } from './quick-template-dialog'
```

(c) Right after `const router = useRouter()` (line 140), add:

```tsx
  const [templates, setTemplates] = useState<ScheduledEventTemplateRow[]>(templatesProp)
```

- [ ] **Step 3: Add the create button under the formato Select**

In `reservation-form.tsx`, in the "¿Piden formato calendizado?" FieldGroup, insert the dialog right AFTER the closing `</Select>` (line 612) and BEFORE the `{values.requested_template_id ? (` helper block:

```tsx
              <div className="flex justify-end">
                <QuickTemplateDialog
                  tenantSlug={tenantSlug}
                  defaultMealType={values.meal_type}
                  onCreated={(tpl) => {
                    setTemplates((prev) =>
                      [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                    form.setValue('requested_template_id', tpl.id, { shouldValidate: true })
                  }}
                />
              </div>
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Smoke (manual)**

En `/reservas/nuevo`, `Naturaleza = Cumpleaños` → en "¿Piden formato calendizado?" tocar "Crear formato nuevo", cargar nombre + cupo, "Crear y usar": el formato aparece seleccionado en el combo. Verificar en `/eventos/templates` que quedó en el catálogo. Probar también como cajero (RLS permite el insert).

- [ ] **Step 6: Commit**

```bash
git add "app/(manager)/[tenantSlug]/reservas/_components/quick-template-dialog.tsx" "app/(manager)/[tenantSlug]/reservas/_components/reservation-form.tsx"
git commit -m "feat(reservas): crear formato inline desde el alta de reserva"
```

---

## Task 11: Navegación por día en el listado (Feature 3)

**Files:**
- Create: `app/(manager)/[tenantSlug]/reservas/_components/day-navigator.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/page.tsx`

- [ ] **Step 1: Create the DayNavigator**

Create `app/(manager)/[tenantSlug]/reservas/_components/day-navigator.tsx`:

```tsx
'use client'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(dt)
}

export function DayNavigator({
  tenantSlug,
  day,
  today,
  capacity,
}: {
  tenantSlug: string
  day: string
  today: string
  capacity: { used: number; total: number } | null
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function goTo(nextDay: string) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.set('day', nextDay)
    next.delete('from')
    next.delete('to')
    next.delete('page')
    startTransition(() => router.push(`/${tenantSlug}/reservas?${next.toString()}`))
  }

  const isToday = day === today
  const isOver = capacity ? capacity.used > capacity.total : false
  const isFull = capacity ? !isOver && capacity.used >= capacity.total * 0.9 : false

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 p-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día anterior"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2 px-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="min-w-[150px] text-center text-sm font-medium capitalize tabular-nums">
            {formatDayLong(day)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día siguiente"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <Input
        type="date"
        value={day}
        aria-label="Elegir fecha"
        onChange={(e) => {
          if (e.target.value) goTo(e.target.value)
        }}
        className="h-9 w-[150px]"
      />

      {!isToday ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => goTo(today)}>
          Hoy
        </Button>
      ) : null}

      {capacity ? (
        <span
          className={cn(
            'ml-auto rounded-lg border px-3 py-1.5 font-mono text-sm font-semibold tabular-nums',
            isOver
              ? 'border-rose-300/60 text-rose-600 dark:text-rose-400'
              : isFull
                ? 'border-amber-300/60 text-amber-600 dark:text-amber-400'
                : 'border-border/60 text-foreground',
          )}
          title="Cubiertos reservados / tope del salón (Planta Alta + Planta Baja)"
        >
          Cubiertos {capacity.used}
          <span className="font-normal text-muted-foreground">/{capacity.total}</span>
        </span>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the list page to support day mode**

Replace the ENTIRE content of `app/(manager)/[tenantSlug]/reservas/page.tsx` with:

```tsx
import { CalendarCheck, CalendarPlus, MonitorSmartphone } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  getDayCapacitySnapshot,
  listManagers,
  listSalonReservations,
} from '@/lib/salon/queries'
import { salonStatusEnum, salonZoneEnum } from '@/lib/salon/schemas'
import { requireTenantAccess, TenantNotFoundError } from '@/lib/tenant'
import { DayNavigator } from './_components/day-navigator'
import { ReservationsFilters } from './_components/reservations-filters'
import { ReservationsTable } from './_components/reservations-table'

export const metadata = { title: 'Reservas' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

function todayInCordoba(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default async function ReservasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams

  let access: Awaited<ReturnType<typeof requireTenantAccess>>
  try {
    access = await requireTenantAccess(tenantSlug)
  } catch (error) {
    if (error instanceof TenantNotFoundError) notFound()
    throw error
  }

  const q = typeof sp.q === 'string' ? sp.q : undefined
  const status =
    typeof sp.status === 'string' && salonStatusEnum.safeParse(sp.status).success
      ? salonStatusEnum.parse(sp.status)
      : undefined
  const zone =
    typeof sp.zone === 'string' && salonZoneEnum.safeParse(sp.zone).success
      ? salonZoneEnum.parse(sp.zone)
      : undefined
  const managerId = typeof sp.manager === 'string' ? sp.manager : undefined

  // Modo rango (filtro avanzado) vs modo día (default). El rango tiene prioridad.
  const fromParam = typeof sp.from === 'string' ? sp.from : undefined
  const toParam = typeof sp.to === 'string' ? sp.to : undefined
  const rangeMode = Boolean(fromParam || toParam)
  const today = todayInCordoba()
  const day = rangeMode ? undefined : typeof sp.day === 'string' ? sp.day : today
  const dateFrom = rangeMode ? fromParam : day
  const dateTo = rangeMode ? toParam : day

  const page = Math.max(1, Number(sp.page ?? 1) || 1)

  const [{ rows, total }, managers] = await Promise.all([
    listSalonReservations({
      tenantId: access.tenant.id,
      q,
      status,
      zone,
      managerId,
      dateFrom,
      dateTo,
      page,
      pageSize: PAGE_SIZE,
    }),
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
  ])

  // Contador de cubiertos del día (solo en modo día).
  let dayCapacity: { used: number; total: number } | null = null
  if (day) {
    const buckets = await getDayCapacitySnapshot({ tenantId: access.tenant.id, date: day })
    const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
    const pb = buckets.find((b) => b.bucket === 'zone:planta_baja')
    dayCapacity = {
      used: (pa?.used ?? 0) + (pb?.used ?? 0),
      total: (pa?.capacity ?? 0) + (pb?.capacity ?? 0),
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(q || status || zone || managerId)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Operaciones"
        title="Reservas"
        description={`${total.toLocaleString('es-AR')} ${total === 1 ? 'reserva' : 'reservas'} · página ${page} de ${totalPages}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="gap-2">
              <Link href={`/${tenantSlug}/salon/reservas-operativo`} target="_blank" rel="noopener">
                <MonitorSmartphone className="size-4" />
                Panel operativo
              </Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo`}>
                <CalendarPlus className="size-4" />
                Nueva reserva
              </Link>
            </Button>
          </div>
        }
      />

      {rangeMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Mostrando rango {fromParam ?? '…'} → {toParam ?? '…'}
          </span>
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link href={`/${tenantSlug}/reservas`}>Volver a vista por día</Link>
          </Button>
        </div>
      ) : day ? (
        <DayNavigator tenantSlug={tenantSlug} day={day} today={today} capacity={dayCapacity} />
      ) : null}

      <ReservationsFilters
        tenantSlug={tenantSlug}
        managers={managers.map((m) => ({ id: m.id, display_name: m.display_name }))}
        defaults={{ q, status, zone, managerId, dateFrom: fromParam, dateTo: toParam }}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={hasFilters || rangeMode ? 'Sin resultados' : 'No hay reservas este día'}
          description={
            hasFilters || rangeMode
              ? 'Probá cambiar los filtros o limpiar todo para ver toda la lista.'
              : 'No hay reservas cargadas para esta fecha. Movete de día con las flechas o cargá una nueva.'
          }
          action={
            <Button asChild className="gap-2">
              <Link href={`/${tenantSlug}/reservas/nuevo${day ? `?date=${day}` : ''}`}>
                <CalendarPlus className="size-4" />
                Crear reserva
              </Link>
            </Button>
          }
        />
      ) : (
        <ReservationsTable
          tenantSlug={tenantSlug}
          rows={rows}
          page={page}
          totalPages={totalPages}
          totalCount={total}
          searchParams={sp}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Smoke (manual)**

`/{slug}/reservas` arranca en hoy con el stepper y "Cubiertos X/Y". Flechas mueven ±1 día (preservando filtros de estado/zona). "Hoy" vuelve. Usar el filtro de rango en "Más" → muestra banner de rango + link "volver a vista por día".

- [ ] **Step 5: Commit**

```bash
git add "app/(manager)/[tenantSlug]/reservas/_components/day-navigator.tsx" "app/(manager)/[tenantSlug]/reservas/page.tsx"
git commit -m "feat(reservas): navegación día a día en el listado con contador de cubiertos"
```

---

## Task 12: Calendario de salón — badge de tope + popup del día (Feature 4)

**Files:**
- Create: `app/(manager)/[tenantSlug]/eventos/programados/_components/day-reservations-dialog.tsx`
- Modify: `app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month.tsx`
- Modify: `app/(manager)/[tenantSlug]/eventos/programados/page.tsx`
- Modify: `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx`

- [ ] **Step 1: `nuevo` reservation page accepts `?date=`**

In `app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx`:

(a) Change the component signature (lines 35-39) to receive `searchParams`:

```tsx
export default async function NuevaReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  const sp = await searchParams
```

(b) Replace the `const today = todayCordoba()` block and the data fetch (lines 52-59) with:

```tsx
  const today = todayCordoba()
  const dateParam =
    typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined
  const initialDate = dateParam ?? today

  const [managers, templates, eventsToday, tiers, bonus] = await Promise.all([
    listManagers({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    listScheduledEventsForDate({ tenantId: access.tenant.id, date: initialDate }),
    listRateTiers({ tenantId: access.tenant.id }),
    getBonusRule({ tenantId: access.tenant.id }),
  ])
```

(c) Change the `<ReservationForm ... initialDate={today} ... />` prop (line 80) to `initialDate={initialDate}`.

- [ ] **Step 2: Create the day popup**

Create `app/(manager)/[tenantSlug]/eventos/programados/_components/day-reservations-dialog.tsx`:

```tsx
'use client'

import { CalendarPlus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import { StatusPill } from '@/components/reservations/status-pill'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchDayCapacity, fetchReservationsForDate } from '@/lib/salon/client-actions'
import {
  MEAL_TYPE_LABELS,
  type DayCapacityBucket,
  type ReservationWithJoins,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt)
}

function zoneOrEvent(r: ReservationWithJoins): string {
  if (r.zone === 'event_floating') return r.scheduled_event?.template?.name ?? 'Evento'
  return ZONE_LABELS[r.zone]
}

export function DayReservationsDialog({
  tenantSlug,
  date,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  date: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [reservations, setReservations] = useState<ReservationWithJoins[]>([])
  const [buckets, setBuckets] = useState<DayCapacityBucket[]>([])

  const load = useCallback(async () => {
    if (!date) return
    setLoading(true)
    const [resR, capR] = await Promise.all([
      fetchReservationsForDate(tenantSlug, date),
      fetchDayCapacity(tenantSlug, date),
    ])
    setReservations(resR.ok ? resR.reservations : [])
    setBuckets(capR.ok ? capR.buckets : [])
    setLoading(false)
  }, [tenantSlug, date])

  useEffect(() => {
    if (open && date) void load()
  }, [open, date, load])

  const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
  const pb = buckets.find((b) => b.bucket === 'zone:planta_baja')
  const usedZones = (pa?.used ?? 0) + (pb?.used ?? 0)
  const totalZones = (pa?.capacity ?? 0) + (pb?.capacity ?? 0)
  const isOver = usedZones > totalZones
  const isFull = !isOver && totalZones > 0 && usedZones >= totalZones * 0.9

  // Mapa id→{nombre,cap} de eventos del día derivado de las reservas con evento.
  const eventBuckets = buckets.filter((b) => b.bucket.startsWith('event:'))
  const eventNames = new Map<string, string>()
  for (const r of reservations) {
    if (r.scheduled_event) {
      eventNames.set(r.scheduled_event.id, r.scheduled_event.template?.name ?? 'Evento')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif capitalize">
            {date ? formatDateLong(date) : 'Día'}
          </DialogTitle>
          <DialogDescription>Reservas del día y ocupación del salón.</DialogDescription>
        </DialogHeader>

        {/* Resumen de capacidad */}
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Cubiertos del salón
            </span>
            <span
              className={cn(
                'font-mono text-lg font-semibold tabular-nums',
                isOver
                  ? 'text-rose-600 dark:text-rose-400'
                  : isFull
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-foreground',
              )}
            >
              {usedZones}
              <span className="text-sm font-normal text-muted-foreground">/{totalZones}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {ZONE_LABELS.planta_alta}: {pa?.used ?? 0}/{pa?.capacity ?? 0}
            </span>
            <span>
              {ZONE_LABELS.planta_baja}: {pb?.used ?? 0}/{pb?.capacity ?? 0}
            </span>
            {eventBuckets.map((b) => {
              const id = b.bucket.slice('event:'.length)
              return (
                <span key={b.bucket}>
                  {eventNames.get(id) ?? 'Evento'}: {b.used}/{b.capacity}
                </span>
              )
            })}
          </div>
        </div>

        {/* Listado */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : reservations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay reservas para este día.
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <ul className="space-y-1.5 pr-3">
              {reservations.map((r) => (
                <li key={r.id}>
                  <ReservationQuickView
                    tenantSlug={tenantSlug}
                    reservation={r}
                    onChanged={load}
                    trigger={
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {r.reservation_time_local.slice(0, 5)}
                        </span>
                        <span className="flex-1 truncate font-medium">{r.guest_name}</span>
                        <span className="text-[11px] text-muted-foreground">{zoneOrEvent(r)}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {r.actual_guests ?? r.estimated_guests}p · {MEAL_TYPE_LABELS[r.meal_type]}
                        </span>
                        <StatusPill status={r.status} />
                      </button>
                    }
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button asChild className="gap-2">
            <Link href={`/${tenantSlug}/reservas/nuevo${date ? `?date=${date}` : ''}`}>
              <CalendarPlus className="size-4" />
              Nueva reserva
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Add badge + day popup to the calendar**

In `app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month.tsx`:

(a) Add imports — after the existing `import type { ScheduledEventTemplateRow } from '@/lib/salon/types'` (line 23) add:

```tsx
import type { MonthCapacity } from '@/lib/salon/month-capacity'
import { DayReservationsDialog } from './day-reservations-dialog'
```

(b) Add `monthCapacity` to the component props. Change the props destructuring/type (lines 57-67):

```tsx
export function ScheduledEventsMonth({
  tenantSlug,
  ym,
  events: initialEvents,
  templates,
  monthCapacity,
}: {
  tenantSlug: string
  ym: string
  events: ScheduledEventWithTemplate[]
  templates: ScheduledEventTemplateRow[]
  monthCapacity: MonthCapacity
}) {
```

(c) Add day-dialog state — after `const [moving, startMoving] = useTransition()` (line 71) add:

```tsx
  const [dayDialogDate, setDayDialogDate] = useState<string | null>(null)
```

(d) Pass capacity + open handler to each cell. Replace the `grid.map(...)` render block (lines 210-219):

```tsx
          {grid.map((cell, idx) => (
            <DayCell
              key={cell.date ?? `pad-${idx}`}
              date={cell.date}
              events={cell.events}
              tenantSlug={tenantSlug}
              isDraggingTemplate={activeDrag?.kind === 'template'}
              isDraggingEvent={activeDrag?.kind === 'event'}
            />
          ))}
```
with:
```tsx
          {grid.map((cell, idx) => (
            <DayCell
              key={cell.date ?? `pad-${idx}`}
              date={cell.date}
              events={cell.events}
              tenantSlug={tenantSlug}
              isDraggingTemplate={activeDrag?.kind === 'template'}
              isDraggingEvent={activeDrag?.kind === 'event'}
              capacity={
                cell.date
                  ? (monthCapacity.days[cell.date] ?? {
                      used: 0,
                      total: monthCapacity.defaultTotal,
                    })
                  : null
              }
              onOpenDay={setDayDialogDate}
            />
          ))}
```

(e) Render the dialog. Right BEFORE the closing `</DndContext>` (line 241), add:

```tsx
      <DayReservationsDialog
        tenantSlug={tenantSlug}
        date={dayDialogDate}
        open={dayDialogDate !== null}
        onOpenChange={(o) => {
          if (!o) setDayDialogDate(null)
        }}
      />
```

(f) Update `DayCell` — change its signature (lines 355-367) and header. Replace:

```tsx
function DayCell({
  date,
  events,
  tenantSlug,
  isDraggingTemplate,
  isDraggingEvent,
}: {
  date: string | null
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  isDraggingTemplate: boolean
  isDraggingEvent: boolean
}) {
```
with:
```tsx
function DayCell({
  date,
  events,
  tenantSlug,
  isDraggingTemplate,
  isDraggingEvent,
  capacity,
  onOpenDay,
}: {
  date: string | null
  events: ScheduledEventWithTemplate[]
  tenantSlug: string
  isDraggingTemplate: boolean
  isDraggingEvent: boolean
  capacity: { used: number; total: number } | null
  onOpenDay: (date: string) => void
}) {
```

Then replace the cell header block (lines 393-404):

```tsx
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
            {Number(date.slice(-2))}
          </span>
          <Link
            href={`/${tenantSlug}/eventos/programados/nuevo?date=${date}`}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
            aria-label={`Programar evento ${date}`}
          >
            <Plus className="size-3" />
          </Link>
        </div>
```
with:
```tsx
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => onOpenDay(date)}
            className="-mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-secondary"
            aria-label={`Ver reservas del ${date}`}
          >
            <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
              {Number(date.slice(-2))}
            </span>
            {capacity ? <CapacityBadge used={capacity.used} total={capacity.total} /> : null}
          </button>
          <Link
            href={`/${tenantSlug}/eventos/programados/nuevo?date=${date}`}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
            aria-label={`Programar evento ${date}`}
          >
            <Plus className="size-3" />
          </Link>
        </div>
```

(g) Add the `CapacityBadge` subcomponent. Right BEFORE the `function DayCell(` definition (line 355), insert:

```tsx
function CapacityBadge({ used, total }: { used: number; total: number }) {
  const isOver = used > total
  const isFull = !isOver && total > 0 && used >= total * 0.9
  return (
    <span
      className={cn(
        'rounded px-1 py-px font-mono text-[10px] font-semibold tabular-nums',
        isOver
          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
          : isFull
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      )}
      title="Cubiertos / tope del salón"
    >
      {used}/{total}
    </span>
  )
}
```

- [ ] **Step 4: Pass `monthCapacity` from the page**

In `app/(manager)/[tenantSlug]/eventos/programados/page.tsx`:

(a) Change the import (line 7) to add `getMonthCapacity`:

```tsx
import {
  getMonthCapacity,
  listScheduledEventsForDateRange,
  listScheduledTemplates,
} from '@/lib/salon/queries'
```

(b) Replace the `Promise.all` (lines 57-60):

```tsx
  const [events, templates] = await Promise.all([
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from, to }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
  ])
```
with:
```tsx
  const [events, templates, monthCapacity] = await Promise.all([
    listScheduledEventsForDateRange({ tenantId: access.tenant.id, from, to }),
    listScheduledTemplates({ tenantId: access.tenant.id, onlyActive: true }),
    getMonthCapacity({ tenantId: access.tenant.id, ym: ymCurrent }),
  ])
```

(c) Pass the prop to `<ScheduledEventsMonth>` (lines 109-114):

```tsx
        <ScheduledEventsMonth
          tenantSlug={tenantSlug}
          ym={ymCurrent}
          events={events}
          templates={templates}
          monthCapacity={monthCapacity}
        />
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Smoke (manual)**

`/{slug}/eventos/programados`: cada día muestra `used/total` con color. Clic en el número de un día → popup con resumen (cubiertos + PA/PB + eventos) y listado de reservas normales/especiales. Clic en una reserva → gestión rápida; tras "Llegó", el popup se refresca. "Nueva reserva" abre `/reservas/nuevo?date=<día>` con la fecha precargada. El drag & drop de templates/eventos sigue funcionando.

- [ ] **Step 7: Commit**

```bash
git add "app/(manager)/[tenantSlug]/eventos/programados/_components/day-reservations-dialog.tsx" "app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month.tsx" "app/(manager)/[tenantSlug]/eventos/programados/page.tsx" "app/(manager)/[tenantSlug]/reservas/nuevo/page.tsx"
git commit -m "feat(eventos): badge de tope + popup del día con reservas en el calendario de salón"
```

---

## Task 13: Docs + verificación final

**Files:**
- Modify: `docs/reservas.md`

- [ ] **Step 1: Add an addendum to the docs**

Append at the END of `docs/reservas.md`:

```markdown

---

## Addendum 2026-06 — Mejoras UX

- **Alta inline de formato**: en el alta de reserva (cumpleaños/especial) hay un
  botón "Crear formato nuevo" que inserta un `scheduled_event_templates` con
  campos mínimos. Lo puede usar staff (owner + cashier) — policy RLS
  `set_staff_insert`. La edición/borrado de formatos sigue siendo owner-only.
- **Popup de gestión rápida**: "Ver" en el listado abre `ReservationQuickView`
  (datos + controles Llegó/Sentar/Cerrar/cancelar). La edición a fondo sigue en
  `/reservas/[id]`. Los controles viven en `components/reservations/`.
- **Vista por día**: `/reservas` usa el param `?day=YYYY-MM-DD` (default hoy) con
  stepper de flechas + "Hoy" + contador de cubiertos. El rango (`from`/`to`)
  queda como filtro avanzado.
- **Calendario**: `/eventos/programados` muestra un badge `used/total` por día y
  un popup (`DayReservationsDialog`) con el listado completo de reservas del día
  y el desglose de capacidad. Capacidad mensual: `getMonthCapacity` +
  `aggregateMonthCapacity`.
- **Torta/champagne**: selector con toggle Sí/No + stepper de cantidad
  (`BringsItemControl`).
```

- [ ] **Step 2: Full verification (lo que corre el pre-commit y CI)**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: typecheck sin errores; lint sin errores nuevos (las 16 warnings preexistentes en archivos no tocados pueden seguir); todos los unit tests verdes, incluidos los 3 nuevos (`salon-slug-dedupe`, `salon-quick-template`, `salon-month-capacity`).

- [ ] **Step 3: RLS verification (si hay Supabase local / en CI)**

Run: `npx vitest run tests/rls/salon-template-staff-insert.test.ts` (con envs).
Expected: PASS (o skip si no hay envs).

- [ ] **Step 4: Commit**

```bash
git add docs/reservas.md
git commit -m "docs(reservas): addendum mejoras UX reservas & calendario"
```

---

## Notas de diseño (recap de decisiones)

- **No se hace lazy-fetch en el popup "Ver"**: `listSalonReservations` ya trae el
  row completo (`RESERVATION_JOIN_SELECT` = `*` + joins), así que `ReservationQuickView`
  usa `reservation` directo. Las Server Actions hacen `revalidatePath('/[slug]/reservas')`,
  que re-renderiza la tabla (RSC) y refresca el row mientras el dialog sigue abierto.
- **El badge del calendario cuenta cubiertos de zonas físicas (PA+PB)**. Las reservas
  `event_floating` no suman al badge (consumen el cupo del evento); aparecen igual en
  el listado del popup y los eventos muestran su propio `used/total` en el resumen.
- **`getMonthCapacity` agrega con 3 lecturas** (reservas del mes + overrides + defaults)
  y delega a `aggregateMonthCapacity` (puro, testeado). Evita 28–31 llamadas a
  `evaluate_day_capacity`.
```
