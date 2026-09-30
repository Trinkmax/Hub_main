import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logAudit } from '@/lib/audit'
import type { EventMarketingRow } from '@/lib/salon/event-marketing'
import { saveEventMarketing } from '@/lib/salon/event-marketing-actions'
import {
  blockedSaveMessage,
  checkMarketingDraft,
  draftFromRow,
  EMPTY_MARKETING_DRAFT,
  MARKETING_FIELD_LABELS,
  MARKETING_MONEY_HINTS,
  type MarketingDraft,
  marketingFieldEnabled,
  sameDraft,
  withoutMoney,
} from '@/lib/salon/event-marketing-draft'
import {
  EVENT_MARKETING_DB_SELECT,
  type EventMarketingDbRow,
  MARKETING_FIELD_MESSAGES as M,
  marketingFieldErrors,
  saveEventMarketingSchema,
  toEventMarketingRow,
  toMarketingDbFields,
} from '@/lib/salon/event-marketing-schemas'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/salon/queries', () => ({
  getManagerForUser: vi.fn(async () => ({ display_name: 'Nacho B.' })),
}))
vi.mock('@/lib/tenant', () => ({
  requireTenantAccess: vi.fn(),
  requireRole: vi.fn(),
  RoleRequiredError: class RoleRequiredError extends Error {},
  TenantNotFoundError: class TenantNotFoundError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}))

const NBSP = ' '
const EVENT_ID = '11111111-2222-4333-8444-555555555555'
const CTX = { scheduledEventId: EVENT_ID, expectedUpdatedAt: null, revenueVisible: true }

function input(overrides: Record<string, unknown> = {}) {
  return {
    scheduledEventId: EVENT_ID,
    adSpendUsd: 105.82,
    messages: 132,
    reach: null,
    revenueArs: null,
    usdArsRate: 1550,
    revenuePerGuestArs: 18_000,
    costPerGuestArs: 7_000,
    drinkRevenuePerGuestArs: 6_000,
    drinkCostPerGuestArs: 2_500,
    notes: null,
    expectedUpdatedAt: null,
    ...overrides,
  }
}

function fieldErrors(overrides: Record<string, unknown>) {
  const parsed = saveEventMarketingSchema.safeParse(input(overrides))
  return parsed.success ? {} : marketingFieldErrors(parsed.error)
}

function draft(patch: Partial<MarketingDraft>): MarketingDraft {
  return { ...EMPTY_MARKETING_DRAFT, ...patch }
}

const BURGER: EventMarketingRow = {
  scheduledEventId: EVENT_ID,
  adSpendUsdCents: 10582,
  messages: 132,
  reach: null,
  revenueArsCents: null,
  usdArsRate: 1550,
  revenuePerGuestArsCents: 18_000_00,
  costPerGuestArsCents: 7_000_00,
  drinkRevenuePerGuestArsCents: 6_000_00,
  drinkCostPerGuestArsCents: 2_500_00,
  notes: null,
  updatedAt: '2026-09-16T12:00:00+00:00',
  updatedByName: 'Nacho B.',
}

describe('schema: la bebida por persona', () => {
  it('entra como el cubierto: en pesos, con centavos, y el 0 es la incluida', () => {
    expect(fieldErrors({})).toEqual({})
    expect(fieldErrors({ drinkRevenuePerGuestArs: 6_000.5 })).toEqual({})
    const incluida = saveEventMarketingSchema.parse(input({ drinkRevenuePerGuestArs: 0 }))
    expect(incluida.drinkRevenuePerGuestArs).toBe(0)
  })

  it('sin pares: una sin la otra se guarda (la pantalla dice qué falta)', () => {
    expect(fieldErrors({ drinkCostPerGuestArs: null })).toEqual({})
    expect(fieldErrors({ drinkRevenuePerGuestArs: null })).toEqual({})
  })

  it('negativo y tope, en su campo y con su nombre', () => {
    expect(fieldErrors({ drinkRevenuePerGuestArs: -1 })).toEqual({
      drinkRevenuePerGuestArs: M.negative,
    })
    expect(fieldErrors({ drinkRevenuePerGuestArs: 1_000_001 })).toEqual({
      drinkRevenuePerGuestArs: `Revisá el ingreso de bebida por persona: el tope es $${NBSP}1.000.000.`,
    })
    expect(fieldErrors({ drinkCostPerGuestArs: 2_500_000 })).toEqual({
      drinkCostPerGuestArs: `Revisá el costo de bebida por persona: el tope es $${NBSP}1.000.000.`,
    })
    expect(fieldErrors({ drinkCostPerGuestArs: 1_000_000 })).toEqual({})
  })

  it('va también en una noche sin pauta: es plata de la noche, no de Meta', () => {
    const parsed = saveEventMarketingSchema.parse(
      input({ adSpendUsd: 0, messages: null, usdArsRate: null }),
    )
    expect(toMarketingDbFields(parsed)).toMatchObject({
      ad_spend_usd_cents: 0,
      drink_revenue_per_guest_ars_cents: 600_000,
      drink_cost_per_guest_ars_cents: 250_000,
    })
  })

  it('que no viajen en el payload es «sin cargar», no un error ni un 0', () => {
    const parsed = saveEventMarketingSchema.parse({ scheduledEventId: EVENT_ID, adSpendUsd: 45 })
    expect(parsed.drinkRevenuePerGuestArs).toBeNull()
    expect(parsed.drinkCostPerGuestArs).toBeNull()
  })

  it('a centavos redondeando; el 0 llega como 0 y el vacío como null', () => {
    const f = toMarketingDbFields(
      saveEventMarketingSchema.parse(
        input({ drinkRevenuePerGuestArs: 6_000.35, drinkCostPerGuestArs: 0 }),
      ),
    )
    expect(f.drink_revenue_per_guest_ars_cents).toBe(600_035)
    expect(f.drink_cost_per_guest_ars_cents).toBe(0)
    const vacios = toMarketingDbFields(
      saveEventMarketingSchema.parse(
        input({ drinkRevenuePerGuestArs: null, drinkCostPerGuestArs: null }),
      ),
    )
    expect(vacios.drink_revenue_per_guest_ars_cents).toBeNull()
    expect(vacios.drink_cost_per_guest_ars_cents).toBeNull()
  })

  it('la lectura trae las dos columnas y un 0 no se confunde con «sin cargar»', () => {
    expect(EVENT_MARKETING_DB_SELECT).toContain('drink_revenue_per_guest_ars_cents')
    expect(EVENT_MARKETING_DB_SELECT).toContain('drink_cost_per_guest_ars_cents')
    const r = toEventMarketingRow(
      {
        scheduled_event_id: EVENT_ID,
        ad_spend_usd_cents: 10582,
        messages: 132,
        reach: null,
        revenue_ars_cents: null,
        usd_ars_rate: '1550.00',
        revenue_per_guest_ars_cents: '1800000',
        cost_per_guest_ars_cents: '700000',
        drink_revenue_per_guest_ars_cents: '0',
        drink_cost_per_guest_ars_cents: null,
        notes: null,
        updated_at: '2026-09-16T12:00:00+00:00',
        updated_by: null,
      },
      null,
    )
    expect(r.drinkRevenuePerGuestArsCents).toBe(0)
    expect(r.drinkCostPerGuestArsCents).toBeNull()
  })
})

describe('borrador: la bebida por persona', () => {
  it('lo guardado se escribe como después del blur, y abre la sección', () => {
    const d = draftFromRow(BURGER)
    expect(d.drinkRevenuePerGuestArs).toBe('6.000')
    expect(d.drinkCostPerGuestArs).toBe('2.500')
    // Solo con la bebida cargada la sección también abre: si no, el guardado
    // siguiente la borraba sin que nadie la viera.
    const soloBebida = draftFromRow({
      ...BURGER,
      revenuePerGuestArsCents: null,
      costPerGuestArsCents: null,
      usdArsRate: null,
      drinkRevenuePerGuestArsCents: 0,
      drinkCostPerGuestArsCents: null,
    })
    expect(soloBebida.moneyOpen).toBe(true)
    expect(soloBebida.drinkRevenuePerGuestArs).toBe('0')
  })

  it('viaja en pesos; el 0 es un número; cerrada la sección no viaja', () => {
    const abierta = checkMarketingDraft(
      draft({
        adSpendUsd: '105,82',
        moneyOpen: true,
        drinkRevenuePerGuestArs: '0',
        drinkCostPerGuestArs: '2.500',
      }),
      CTX,
    )
    expect(abierta.fieldErrors).toEqual({})
    expect(abierta.input).toMatchObject({ drinkRevenuePerGuestArs: 0, drinkCostPerGuestArs: 2_500 })
    const cerrada = checkMarketingDraft(
      draft({ adSpendUsd: '105,82', moneyOpen: false, drinkRevenuePerGuestArs: 'abc' }),
      CTX,
    )
    expect(cerrada.fieldErrors).toEqual({})
    expect(cerrada.input).toMatchObject({
      drinkRevenuePerGuestArs: null,
      drinkCostPerGuestArs: null,
    })
  })

  it('«incluida» en el ingreso de bebida pide el 0, en vez de «No entendí el número»', () => {
    for (const word of ['incluida', 'Incluido', 'va con el vino']) {
      const check = checkMarketingDraft(
        draft({ adSpendUsd: '105,82', moneyOpen: true, drinkRevenuePerGuestArs: word }),
        CTX,
      )
      expect(check.fieldErrors).toEqual({ drinkRevenuePerGuestArs: M.drinkIncludedIsZero })
      expect(check.input).toBeNull()
    }
    expect(M.drinkIncludedIsZero).toBe('Si la bebida está incluida, poné 0.')
    // Con dígitos es un número mal escrito, no una palabra.
    expect(
      checkMarketingDraft(
        draft({ adSpendUsd: '105,82', moneyOpen: true, drinkRevenuePerGuestArs: '6.0000' }),
        CTX,
      ).fieldErrors,
    ).toEqual({ drinkRevenuePerGuestArs: M.unreadable })
    // En el costo, «incluida» no es 0: la bebida incluida también cuesta.
    expect(
      checkMarketingDraft(
        draft({ adSpendUsd: '105,82', moneyOpen: true, drinkCostPerGuestArs: 'incluida' }),
        CTX,
      ).fieldErrors,
    ).toEqual({ drinkCostPerGuestArs: M.unreadable })
  })

  it('prendida en noches sin pauta y en fechas futuras (es un estimado)', () => {
    const organic = draft({ adSpendUsd: '0', moneyOpen: true })
    expect(marketingFieldEnabled('drinkRevenuePerGuestArs', organic, false)).toBe(true)
    expect(marketingFieldEnabled('drinkCostPerGuestArs', organic, false)).toBe(true)
  })

  it('tipear la bebida es un cambio', () => {
    const saved = draftFromRow({
      ...BURGER,
      drinkRevenuePerGuestArsCents: null,
      drinkCostPerGuestArsCents: null,
    })
    expect(sameDraft(saved, { ...saved, drinkRevenuePerGuestArs: '6.000' })).toBe(false)
  })

  it('las etiquetas y ayudas que se ven', () => {
    expect(MARKETING_FIELD_LABELS.drinkRevenuePerGuestArs).toBe('Ingreso de bebida por persona')
    expect(MARKETING_FIELD_LABELS.drinkCostPerGuestArs).toBe('Costo de bebida por persona')
    expect(MARKETING_MONEY_HINTS.drinkRevenuePerGuestArs).toBe(
      'La que se cobra aparte, en promedio. 0 si está incluida, ej. el vino.',
    )
    expect(MARKETING_MONEY_HINTS.costPerGuestArs).toBe(
      'Lo que cuesta servirla: la comida, sin la bebida ni sueldos.',
    )
    expect(
      blockedSaveMessage({
        drinkCostPerGuestArs: 'x',
        revenuePerGuestArs: 'y',
        drinkRevenuePerGuestArs: 'z',
      }),
    ).toBe(
      'Corregí «Ingreso por persona», «Ingreso de bebida por persona» y «Costo de bebida por persona» para guardar.',
    )
  })
})

// ─── La action, de punta a punta ─────────────────────────────────────────────

type PgResult = { data: unknown; error: { code: string; message: string } | null }
type Chain = {
  select: () => Chain
  eq: (column: string, value: unknown) => Chain
  insert: (values: unknown) => Chain
  update: (values: unknown) => Chain
  maybeSingle: () => Promise<PgResult>
  single: () => Promise<PgResult>
}

function fakeSupabase(results: { event: PgResult; insert?: PgResult; update?: PgResult }) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const client = {
    from(table: string): Chain {
      let updating = false
      const chain: Chain = {
        select: () => chain,
        eq: () => chain,
        insert: (values) => {
          inserts.push(values)
          return chain
        },
        update: (values) => {
          updating = true
          updates.push(values)
          return chain
        },
        maybeSingle: async () =>
          table === 'scheduled_events'
            ? results.event
            : ((updating ? results.update : undefined) ?? { data: null, error: null }),
        single: async () => results.insert ?? { data: null, error: null },
      }
      return chain
    },
  }
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  return { inserts, updates }
}

const DB_ROW: EventMarketingDbRow = {
  scheduled_event_id: EVENT_ID,
  ad_spend_usd_cents: 10582,
  messages: 132,
  reach: null,
  revenue_ars_cents: null,
  usd_ars_rate: '1550.00',
  revenue_per_guest_ars_cents: '1800000',
  cost_per_guest_ars_cents: '700000',
  drink_revenue_per_guest_ars_cents: '600000',
  drink_cost_per_guest_ars_cents: '250000',
  notes: 'reels',
  updated_at: '2026-09-16T12:00:00+00:00',
  updated_by: 'user-owner-a',
}

describe('borrador: cerrar la plata', () => {
  it('«Quitar la plata» vacía los seis números y cierra la sección; lo demás queda', () => {
    const d: MarketingDraft = {
      ...EMPTY_MARKETING_DRAFT,
      adSpendUsd: '105,82',
      messages: '132',
      revenuePerGuestArs: '14.500',
      costPerGuestArs: '6.500',
      drinkRevenuePerGuestArs: '0',
      drinkCostPerGuestArs: '2.500',
      revenueArs: '900.000',
      usdArsRate: '1.550',
      notes: 'con vino',
      moneyOpen: true,
    }
    expect(withoutMoney(d)).toEqual({
      ...d,
      revenuePerGuestArs: '',
      costPerGuestArs: '',
      drinkRevenuePerGuestArs: '',
      drinkCostPerGuestArs: '',
      revenueArs: '',
      usdArsRate: '',
      moneyOpen: false,
    })
  })
})

describe('saveEventMarketing — la bebida', () => {
  beforeEach(() => {
    vi.mocked(logAudit).mockClear()
    vi.mocked(requireTenantAccess).mockResolvedValue({
      tenant: { id: 'tenant-a' },
      role: 'owner',
      user: { id: 'user-owner-a' },
    } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
  })

  it('el alta la manda en centavos, la devuelve y la deja en el audit (sin la nota)', async () => {
    const db = fakeSupabase({
      event: { data: { id: EVENT_ID, event_date: '2020-09-15' }, error: null },
      insert: { data: DB_ROW, error: null },
    })
    const state = await saveEventMarketing('bar-a', input({ notes: 'reels' }))
    expect(state.ok).toBe(true)
    expect(db.inserts).toEqual([
      expect.objectContaining({
        drink_revenue_per_guest_ars_cents: 600_000,
        drink_cost_per_guest_ars_cents: 250_000,
      }),
    ])
    expect(state.ok && state.row).toMatchObject({
      drinkRevenuePerGuestArsCents: 600_000,
      drinkCostPerGuestArsCents: 250_000,
    })
    const payload = vi.mocked(logAudit).mock.calls[0]?.[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      drink_revenue_per_guest_ars_cents: 600_000,
      drink_cost_per_guest_ars_cents: 250_000,
    })
    expect(JSON.stringify(payload)).not.toContain('reels')
  })

  it('una fecha que todavía no pasó la puede cargar: es un estimado, como el cubierto', async () => {
    const db = fakeSupabase({
      event: { data: { id: EVENT_ID, event_date: '2999-10-06' }, error: null },
      insert: { data: DB_ROW, error: null },
    })
    expect((await saveEventMarketing('bar-a', input())).ok).toBe(true)
    expect(db.inserts).toHaveLength(1)
  })

  it('vaciarla la manda en null', async () => {
    const db = fakeSupabase({
      event: { data: { id: EVENT_ID, event_date: '2020-09-15' }, error: null },
      update: {
        data: {
          ...DB_ROW,
          drink_revenue_per_guest_ars_cents: null,
          drink_cost_per_guest_ars_cents: null,
        },
        error: null,
      },
    })
    const state = await saveEventMarketing(
      'bar-a',
      input({
        drinkRevenuePerGuestArs: null,
        drinkCostPerGuestArs: null,
        expectedUpdatedAt: '2026-09-16T12:00:00+00:00',
      }),
    )
    expect(state.ok).toBe(true)
    expect(db.updates).toEqual([
      expect.objectContaining({
        drink_revenue_per_guest_ars_cents: null,
        drink_cost_per_guest_ars_cents: null,
      }),
    ])
  })
})
