import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logAudit } from '@/lib/audit'
import { markEventWithoutAds, saveEventMarketing } from '@/lib/salon/event-marketing-actions'
import {
  deleteEventMarketingSchema,
  EVENT_MARKETING_LIMITS,
  type EventMarketingDbRow,
  MARKETING_FIELD_MESSAGES as M,
  markEventWithoutAdsSchema,
  marketingFieldErrors,
  sameStoredRevenue,
  saveEventMarketingSchema,
  toEventMarketingRow,
  toMarketingDbFields,
} from '@/lib/salon/event-marketing-schemas'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'

const EVENT_ID = '11111111-2222-4333-8444-555555555555'
const BASELINE = '2026-09-10T17:32:11.123456+00:00'
const NBSP = '\u00A0'

/** El ejemplo del dueño (Noche Astral 09/09): US$ 175,26 y 51 mensajes. */
function input(overrides: Record<string, unknown> = {}) {
  return {
    scheduledEventId: EVENT_ID,
    adSpendUsd: 175.26,
    messages: 51,
    reach: null,
    revenueArs: null,
    usdArsRate: null,
    revenuePerGuestArs: null,
    costPerGuestArs: null,
    notes: null,
    expectedUpdatedAt: null,
    ...overrides,
  }
}

function fieldErrors(overrides: Record<string, unknown>) {
  const parsed = saveEventMarketingSchema.safeParse(input(overrides))
  return parsed.success ? {} : marketingFieldErrors(parsed.error)
}

describe('saveEventMarketingSchema — lo que el form manda bien', () => {
  it('acepta el ejemplo del dueño tal cual', () => {
    const parsed = saveEventMarketingSchema.safeParse(input())
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(input())
  })

  it('acepta la ficha completa y recorta la nota', () => {
    const parsed = saveEventMarketingSchema.safeParse(
      input({
        reach: 8420,
        revenueArs: 2_480_000,
        usdArsRate: 1450,
        revenuePerGuestArs: 27_000,
        costPerGuestArs: 15_000,
        notes: '  campaña de reels del 1/9 al 9/9  ',
        expectedUpdatedAt: BASELINE,
      }),
    )
    expect(parsed.success).toBe(true)
    expect(parsed.data?.notes).toBe('campaña de reels del 1/9 al 9/9')
    expect(parsed.data?.expectedUpdatedAt).toBe(BASELINE)
    expect(parsed.data?.revenuePerGuestArs).toBe(27_000)
    expect(parsed.data?.costPerGuestArs).toBe(15_000)
  })

  it('un campo que no viaja es "no cargado", no un error', () => {
    const parsed = saveEventMarketingSchema.safeParse({
      scheduledEventId: EVENT_ID,
      adSpendUsd: 45,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      scheduledEventId: EVENT_ID,
      adSpendUsd: 45,
      messages: null,
      reach: null,
      revenueArs: null,
      usdArsRate: null,
      revenuePerGuestArs: null,
      costPerGuestArs: null,
      notes: null,
      expectedUpdatedAt: null,
    })
  })

  it('una nota en blanco es null, no un string vacío', () => {
    for (const notes of ['', '   ', '\n\t ']) {
      expect(saveEventMarketingSchema.parse(input({ notes })).notes).toBeNull()
    }
  })

  it('mensajes y alcance en 0 son un dato ("no escribió nadie"), no un vacío', () => {
    const parsed = saveEventMarketingSchema.parse(input({ messages: 0, reach: 0 }))
    expect(parsed.messages).toBe(0)
    expect(parsed.reach).toBe(0)
  })
})

describe('saveEventMarketingSchema — la fecha', () => {
  it('rechaza un id que no es uuid', () => {
    for (const scheduledEventId of ['', 'abc', '123', `${EVENT_ID}x`, null, 42]) {
      const parsed = saveEventMarketingSchema.safeParse(input({ scheduledEventId }))
      expect(parsed.success).toBe(false)
      // No es un campo del form: no aparece en los errores por campo.
      if (!parsed.success) expect(marketingFieldErrors(parsed.error)).toEqual({})
    }
  })

  it('la versión tiene que tener forma de timestamptz y no pasar de 40', () => {
    for (const expectedUpdatedAt of [
      BASELINE,
      '2026-09-10T17:32:11Z',
      '2026-09-10 17:32:11.5+00',
    ]) {
      expect(saveEventMarketingSchema.safeParse(input({ expectedUpdatedAt })).success).toBe(true)
    }
    for (const expectedUpdatedAt of ['', 'ayer', '2026-09-10', `${BASELINE}${'0'.repeat(10)}`]) {
      expect(saveEventMarketingSchema.safeParse(input({ expectedUpdatedAt })).success).toBe(false)
    }
  })
})

describe('saveEventMarketingSchema — Gastado', () => {
  it('0 no es "sin pauta": pide usar «No tuvo pauta»', () => {
    expect(fieldErrors({ adSpendUsd: 0 })).toEqual({ adSpendUsd: M.spendMissing })
  })

  it('tiene que redondear a 1 centavo como mínimo', () => {
    expect(fieldErrors({ adSpendUsd: 0.004 })).toEqual({ adSpendUsd: M.spendMissing })
    expect(fieldErrors({ adSpendUsd: 0.005 })).toEqual({})
    expect(fieldErrors({ adSpendUsd: 0.01 })).toEqual({})
  })

  it('negativo dice negativo (y no "poné cuánto se gastó")', () => {
    expect(fieldErrors({ adSpendUsd: -3 })).toEqual({ adSpendUsd: M.negative })
  })

  it('techo en US$ 100.000, el CHECK de la DB', () => {
    expect(fieldErrors({ adSpendUsd: EVENT_MARKETING_LIMITS.adSpendUsdMax })).toEqual({})
    expect(fieldErrors({ adSpendUsd: 100_000.01 })).toEqual({ adSpendUsd: M.spendTooHigh })
  })

  it('lo que no es un número finito no se entiende', () => {
    for (const adSpendUsd of [Number.NaN, Number.POSITIVE_INFINITY, '175,26', null, undefined]) {
      expect(fieldErrors({ adSpendUsd })).toEqual({ adSpendUsd: M.unreadable })
    }
  })
})

describe('saveEventMarketingSchema — Mensajes y Alcance', () => {
  it('van sin decimales', () => {
    expect(fieldErrors({ messages: 51.5 })).toEqual({ messages: M.withDecimals })
    expect(fieldErrors({ reach: 8420.2 })).toEqual({ reach: M.withDecimals })
  })

  it('negativo gana sobre "sin decimales" (mismo orden que el parser)', () => {
    expect(fieldErrors({ messages: -3.5 })).toEqual({ messages: M.negative })
  })

  it('topes: 1.000.000 mensajes y 100.000.000 de alcance', () => {
    expect(fieldErrors({ messages: 1_000_000, reach: 100_000_000 })).toEqual({})
    expect(fieldErrors({ messages: 1_000_001 })).toEqual({ messages: M.countOutOfRange })
    expect(fieldErrors({ reach: 100_000_001 })).toEqual({ reach: M.countOutOfRange })
  })

  it('un string no se convierte solo', () => {
    expect(fieldErrors({ messages: '51' })).toEqual({ messages: M.unreadable })
  })
})

describe('saveEventMarketingSchema — Facturación y dólar', () => {
  it('ya NO van de a pares: cada uno entra solo', () => {
    // El CHECK `sem_revenue_needs_rate` se borró (migración 20260919120000): el
    // dólar es lo que pasa la PAUTA a pesos, no el acompañante obligado de la
    // caja. Sin él la pantalla muestra el margen bruto y lo avisa; rebotar la
    // carga era perder el número que el dueño ya tenía a mano.
    expect(fieldErrors({ revenueArs: 2_480_000 })).toEqual({})
    expect(fieldErrors({ usdArsRate: 1450 })).toEqual({})
    expect(fieldErrors({ revenueArs: 2_480_000, usdArsRate: 1450 })).toEqual({})
  })

  it('el dólar fuera de rango muestra lo que quedó', () => {
    expect(fieldErrors({ revenueArs: 2_480_000, usdArsRate: 14.5 })).toEqual({
      usdArsRate: `Revisá el dólar: quedó en $${NBSP}14,50.`,
    })
    expect(fieldErrors({ revenueArs: 2_480_000, usdArsRate: 100_000.5 })).toEqual({
      usdArsRate: `Revisá el dólar: quedó en $${NBSP}100.000,50.`,
    })
  })

  it('bordes del dólar: $ 100 y $ 100.000 entran', () => {
    expect(fieldErrors({ revenueArs: 1000, usdArsRate: 100 })).toEqual({})
    expect(fieldErrors({ revenueArs: 1000, usdArsRate: 100_000 })).toEqual({})
    expect(fieldErrors({ revenueArs: 1000, usdArsRate: 99.99 })).toHaveProperty('usdArsRate')
  })

  it('dólar negativo dice negativo', () => {
    expect(fieldErrors({ revenueArs: 1000, usdArsRate: -1450 })).toEqual({
      usdArsRate: M.negative,
    })
  })

  it('facturación: de $ 1 a $ 1.000.000.000, con centavos', () => {
    expect(fieldErrors({ revenueArs: 1, usdArsRate: 1450 })).toEqual({})
    expect(fieldErrors({ revenueArs: 2_480_000.5, usdArsRate: 1450 })).toEqual({})
    expect(fieldErrors({ revenueArs: 1_000_000_000, usdArsRate: 1450 })).toEqual({})
    expect(fieldErrors({ revenueArs: 0, usdArsRate: 1450 })).toEqual({
      revenueArs: M.revenueOutOfRange,
    })
    expect(fieldErrors({ revenueArs: 1_000_000_001, usdArsRate: 1450 })).toEqual({
      revenueArs: M.revenueOutOfRange,
    })
    expect(fieldErrors({ revenueArs: -5, usdArsRate: 1450 })).toEqual({ revenueArs: M.negative })
  })
})

describe('saveEventMarketingSchema — Ingreso y costo por persona', () => {
  it('el ejemplo del dueño entra tal cual: $ 27.000 y $ 15.000', () => {
    expect(fieldErrors({ revenuePerGuestArs: 27_000, costPerGuestArs: 15_000 })).toEqual({})
  })

  it('no necesitan ni facturación ni dólar para entrar', () => {
    // Son un estimado del dueño, no un número de la caja: se cargan solos.
    expect(fieldErrors({ revenuePerGuestArs: 27_000 })).toEqual({})
    expect(fieldErrors({ costPerGuestArs: 15_000 })).toEqual({})
  })

  it('van con centavos si el dueño los tipea', () => {
    expect(fieldErrors({ revenuePerGuestArs: 27_500.5, costPerGuestArs: 15_200.25 })).toEqual({})
  })

  it('0 es un número cargado a propósito, no un vacío', () => {
    const parsed = saveEventMarketingSchema.parse(
      input({ revenuePerGuestArs: 0, costPerGuestArs: 0 }),
    )
    expect(parsed.revenuePerGuestArs).toBe(0)
    expect(parsed.costPerGuestArs).toBe(0)
  })

  it('negativo dice negativo, en el campo que lo tiene', () => {
    expect(fieldErrors({ revenuePerGuestArs: -27_000 })).toEqual({
      revenuePerGuestArs: M.negative,
    })
    expect(fieldErrors({ costPerGuestArs: -1 })).toEqual({ costPerGuestArs: M.negative })
  })

  it('tope en $ 1.000.000, el CHECK de la DB, y el mensaje lo dice', () => {
    expect(fieldErrors({ revenuePerGuestArs: EVENT_MARKETING_LIMITS.perGuestArsMax })).toEqual({})
    expect(fieldErrors({ costPerGuestArs: EVENT_MARKETING_LIMITS.perGuestArsMax })).toEqual({})
    // Un cubierto de dos millones es el precio tipeado en centavos.
    expect(fieldErrors({ revenuePerGuestArs: 2_700_000 })).toEqual({
      revenuePerGuestArs: `Revisá el ingreso por persona: el tope es $${NBSP}1.000.000.`,
    })
    expect(fieldErrors({ costPerGuestArs: 1_500_000 })).toEqual({
      costPerGuestArs: `Revisá el costo por persona: el tope es $${NBSP}1.000.000.`,
    })
  })

  it('un string o un NaN no se entienden', () => {
    for (const value of ['27000', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fieldErrors({ revenuePerGuestArs: value })).toEqual({
        revenuePerGuestArs: M.unreadable,
      })
      expect(fieldErrors({ costPerGuestArs: value })).toEqual({ costPerGuestArs: M.unreadable })
    }
  })

  it('que no viajen en el payload es "no cargados"', () => {
    const parsed = saveEventMarketingSchema.parse({ scheduledEventId: EVENT_ID, adSpendUsd: 45 })
    expect(parsed.revenuePerGuestArs).toBeNull()
    expect(parsed.costPerGuestArs).toBeNull()
  })
})

describe('saveEventMarketingSchema — Nota', () => {
  it('hasta 280 caracteres, contados después de recortar', () => {
    expect(fieldErrors({ notes: 'a'.repeat(280) })).toEqual({})
    expect(fieldErrors({ notes: `  ${'a'.repeat(280)}  ` })).toEqual({})
    expect(fieldErrors({ notes: 'a'.repeat(281) })).toEqual({ notes: M.notesTooLong })
  })

  it('tiene que ser texto', () => {
    expect(fieldErrors({ notes: 42 })).toHaveProperty('notes')
  })
})

describe('marketingFieldErrors', () => {
  it('se queda con el primer issue de cada campo e ignora los que no son del form', () => {
    expect(
      marketingFieldErrors({
        issues: [
          { path: ['messages'], message: 'primero' },
          { path: ['messages'], message: 'segundo' },
          { path: ['scheduledEventId'], message: 'no es un campo' },
          { path: [], message: 'raíz' },
          { path: ['notes'], message: 'nota' },
        ],
      }),
    ).toEqual({ messages: 'primero', notes: 'nota' })
  })
})

describe('markEventWithoutAdsSchema / deleteEventMarketingSchema', () => {
  it('marcar sin pauta solo pide un uuid', () => {
    expect(markEventWithoutAdsSchema.safeParse({ scheduledEventId: EVENT_ID }).success).toBe(true)
    expect(markEventWithoutAdsSchema.safeParse({ scheduledEventId: 'nope' }).success).toBe(false)
  })

  it('borrar pide SIEMPRE la versión', () => {
    expect(
      deleteEventMarketingSchema.safeParse({
        scheduledEventId: EVENT_ID,
        expectedUpdatedAt: BASELINE,
      }).success,
    ).toBe(true)
    for (const expectedUpdatedAt of [null, undefined, '', 'ayer']) {
      expect(
        deleteEventMarketingSchema.safeParse({ scheduledEventId: EVENT_ID, expectedUpdatedAt })
          .success,
      ).toBe(false)
    }
  })
})

describe('toMarketingDbFields', () => {
  it('pasa a centavos redondeando, no truncando (175,26 * 100 en float es 17525,999…)', () => {
    const values = saveEventMarketingSchema.parse(
      input({
        reach: 8420,
        revenueArs: 2_480_000.5,
        usdArsRate: 1450.5,
        revenuePerGuestArs: 27_000.35,
        costPerGuestArs: 15_000,
        notes: 'reels',
      }),
    )
    expect(toMarketingDbFields(values)).toEqual({
      ad_spend_usd_cents: 17526,
      messages: 51,
      reach: 8420,
      revenue_ars_cents: 248_000_050,
      usd_ars_rate: 1450.5,
      revenue_per_guest_ars_cents: 2_700_035,
      cost_per_guest_ars_cents: 1_500_000,
      notes: 'reels',
    })
  })

  it('los vacíos siguen vacíos', () => {
    const values = saveEventMarketingSchema.parse(input({ messages: null }))
    expect(toMarketingDbFields(values)).toEqual({
      ad_spend_usd_cents: 17526,
      messages: null,
      reach: null,
      revenue_ars_cents: null,
      usd_ars_rate: null,
      revenue_per_guest_ars_cents: null,
      cost_per_guest_ars_cents: null,
      notes: null,
    })
  })

  it('un 0 por persona llega a la DB como 0, no como null', () => {
    const fields = toMarketingDbFields(
      saveEventMarketingSchema.parse(input({ revenuePerGuestArs: 0, costPerGuestArs: 0 })),
    )
    expect(fields.revenue_per_guest_ars_cents).toBe(0)
    expect(fields.cost_per_guest_ars_cents).toBe(0)
  })

  it('el techo en unidades cae justo en el CHECK en centavos', () => {
    const values = saveEventMarketingSchema.parse(
      input({
        adSpendUsd: 100_000,
        revenueArs: 1_000_000_000,
        usdArsRate: 100_000,
        revenuePerGuestArs: EVENT_MARKETING_LIMITS.perGuestArsMax,
        costPerGuestArs: EVENT_MARKETING_LIMITS.perGuestArsMax,
      }),
    )
    const fields = toMarketingDbFields(values)
    expect(fields.ad_spend_usd_cents).toBe(10_000_000)
    expect(fields.revenue_ars_cents).toBe(100_000_000_000)
    // `between 0 and 100000000` en las dos columnas nuevas.
    expect(fields.revenue_per_guest_ars_cents).toBe(100_000_000)
    expect(fields.cost_per_guest_ars_cents).toBe(100_000_000)
  })
})

describe('sameStoredRevenue', () => {
  const fields = (revenueArs: number, usdArsRate: number | null = 1450) =>
    toMarketingDbFields(saveEventMarketingSchema.parse(input({ revenueArs, usdArsRate })))

  it('lo guardado que vuelve por el input es igual, aunque PostgREST lo mande como string', () => {
    expect(sameStoredRevenue(fields(2_480_000), { revenue_ars_cents: '248000000' })).toBe(true)
    // Con centavos: el ida y vuelta en float no es un cambio.
    expect(sameStoredRevenue(fields(2_480_000.5), { revenue_ars_cents: 248_000_050 })).toBe(true)
  })

  it('otra facturación es un cambio', () => {
    expect(sameStoredRevenue(fields(2_480_001), { revenue_ars_cents: 248_000_000 })).toBe(false)
  })

  it('cambiar SOLO el dólar no toca la facturación', () => {
    // La pauta se gasta antes del evento: en una fecha futura el dólar se puede
    // corregir. Mirarlo acá hacía rebotar esa edición diciendo «La facturación
    // se carga cuando pasa la fecha», que además era mentira.
    expect(sameStoredRevenue(fields(2_480_000, 1451), { revenue_ars_cents: 248_000_000 })).toBe(
      true,
    )
  })

  it('sin facturación guardada, cualquier facturación es nueva', () => {
    expect(sameStoredRevenue(fields(2_480_000), { revenue_ars_cents: null })).toBe(false)
  })
})

describe('toEventMarketingRow', () => {
  const raw: EventMarketingDbRow = {
    scheduled_event_id: EVENT_ID,
    ad_spend_usd_cents: 17526,
    messages: 51,
    reach: null,
    revenue_ars_cents: '248000000',
    usd_ars_rate: '1450.50',
    revenue_per_guest_ars_cents: '2700000',
    cost_per_guest_ars_cents: 1_500_000,
    notes: 'reels',
    updated_at: BASELINE,
    updated_by: 'u1',
  }

  it('normaliza numeric/bigint que llegan como string y deja los centavos en centavos', () => {
    expect(toEventMarketingRow(raw, 'Nacho Badra')).toEqual({
      scheduledEventId: EVENT_ID,
      adSpendUsdCents: 17526,
      messages: 51,
      reach: null,
      revenueArsCents: 248_000_000,
      usdArsRate: 1450.5,
      revenuePerGuestArsCents: 2_700_000,
      costPerGuestArsCents: 1_500_000,
      notes: 'reels',
      updatedAt: BASELINE,
      updatedByName: 'Nacho B.',
    })
  })

  it('un 0 por persona sobrevive: no se confunde con "sin cargar"', () => {
    const row = toEventMarketingRow(
      { ...raw, revenue_per_guest_ars_cents: '0', cost_per_guest_ars_cents: 0 },
      null,
    )
    expect(row.revenuePerGuestArsCents).toBe(0)
    expect(row.costPerGuestArsCents).toBe(0)
  })

  it('sin gestor vinculado, sin firma', () => {
    expect(toEventMarketingRow(raw, null).updatedByName).toBeNull()
  })

  it('«No tuvo pauta» es gasto 0 con todo lo demás en null', () => {
    const row = toEventMarketingRow(
      {
        ...raw,
        ad_spend_usd_cents: '0',
        messages: null,
        revenue_ars_cents: null,
        usd_ars_rate: null,
        revenue_per_guest_ars_cents: null,
        cost_per_guest_ars_cents: null,
        notes: null,
      },
      'Luz',
    )
    expect(row.adSpendUsdCents).toBe(0)
    expect(row.messages).toBeNull()
    expect(row.usdArsRate).toBeNull()
    // El CHECK `sem_no_ads_is_bare` ahora también alcanza a la plata por persona.
    expect(row.revenuePerGuestArsCents).toBeNull()
    expect(row.costPerGuestArsCents).toBeNull()
    expect(row.updatedByName).toBe('Luz')
  })
})

// ─── markEventWithoutAds: la fecha tiene que ser del bar ─────────────────────

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

const TENANT_A = 'tenant-a'
const USER_ID = 'user-owner-a'
const NOT_FOUND_MESSAGE = 'No encontramos esa fecha. Puede que la hayan borrado del calendario.'

type PgResult = { data: unknown; error: { code: string; message: string } | null }
type Chain = {
  select: () => Chain
  eq: (column: string, value: unknown) => Chain
  insert: (values: unknown) => Chain
  update: (values: unknown) => Chain
  maybeSingle: () => Promise<PgResult>
  single: () => Promise<PgResult>
}

const NOTHING: PgResult = { data: null, error: null }

/**
 * Un cliente de Supabase de mentira que anota qué tabla, qué filtros, qué insert
 * y qué update se pidieron. `maybeSingle` contesta según la consulta: la fecha
 * (`scheduled_events`), la pauta guardada (lectura de `scheduled_event_marketing`)
 * o el resultado del update.
 */
function fakeSupabase(results: {
  event: PgResult
  insert?: PgResult
  stored?: PgResult
  update?: PgResult
}) {
  const tables: string[] = []
  const filters: Array<[string, string, unknown]> = []
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const client = {
    from(table: string): Chain {
      tables.push(table)
      let updating = false
      const chain: Chain = {
        select: () => chain,
        eq: (column, value) => {
          filters.push([table, column, value])
          return chain
        },
        insert: (values) => {
          inserts.push(values)
          return chain
        },
        update: (values) => {
          updating = true
          updates.push(values)
          return chain
        },
        maybeSingle: async () => {
          if (table === 'scheduled_events') return results.event
          return (updating ? results.update : results.stored) ?? NOTHING
        },
        single: async () => results.insert ?? NOTHING,
      }
      return chain
    },
  }
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  )
  return { tables, filters, inserts, updates }
}

const NO_ADS_DB_ROW: EventMarketingDbRow = {
  scheduled_event_id: EVENT_ID,
  ad_spend_usd_cents: 0,
  messages: null,
  reach: null,
  revenue_ars_cents: null,
  usd_ars_rate: null,
  revenue_per_guest_ars_cents: null,
  cost_per_guest_ars_cents: null,
  notes: null,
  updated_at: BASELINE,
  updated_by: USER_ID,
}

describe('markEventWithoutAds — la fecha tiene que ser del bar', () => {
  beforeEach(() => {
    vi.mocked(logAudit).mockClear()
    vi.mocked(requireTenantAccess).mockResolvedValue({
      tenant: { id: TENANT_A },
      role: 'owner',
      user: { id: USER_ID },
    } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
  })

  it('una fecha de otro bar da not_found sin llegar al insert, tenga pauta o no', async () => {
    // Si el otro bar ya cargó esa fecha, el insert tiraría 23505 («ya tiene
    // pauta»): la respuesta no puede depender de eso, así que ni se intenta.
    const db = fakeSupabase({
      event: { data: null, error: null },
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    const state = await markEventWithoutAds('bar-a', EVENT_ID)
    expect(state).toEqual({ ok: false, code: 'not_found', message: NOT_FOUND_MESSAGE })
    expect(db.tables).toEqual(['scheduled_events'])
    expect(db.filters).toEqual([
      ['scheduled_events', 'tenant_id', TENANT_A],
      ['scheduled_events', 'id', EVENT_ID],
    ])
    expect(db.inserts).toEqual([])
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('el mismo not_found que saveEventMarketing para una fecha ajena', async () => {
    fakeSupabase({ event: { data: null, error: null }, insert: { data: null, error: null } })
    const save = await saveEventMarketing('bar-a', input())
    fakeSupabase({ event: { data: null, error: null }, insert: { data: null, error: null } })
    const noAds = await markEventWithoutAds('bar-a', EVENT_ID)
    expect(noAds).toEqual(save)
  })

  it('fecha propia: inserta gasto 0 con el bar del dueño', async () => {
    const db = fakeSupabase({
      event: { data: { id: EVENT_ID }, error: null },
      insert: { data: NO_ADS_DB_ROW, error: null },
    })
    const state = await markEventWithoutAds('bar-a', EVENT_ID)
    expect(state.ok).toBe(true)
    expect(state.ok && state.row).toMatchObject({ adSpendUsdCents: 0, updatedByName: 'Nacho B.' })
    expect(db.tables).toEqual(['scheduled_events', 'scheduled_event_marketing'])
    expect(db.inserts).toEqual([
      {
        tenant_id: TENANT_A,
        scheduled_event_id: EVENT_ID,
        ad_spend_usd_cents: 0,
        created_by: USER_ID,
        updated_by: USER_ID,
      },
    ])
    expect(logAudit).toHaveBeenCalledTimes(1)
  })

  it('fecha propia que ya tiene fila: stale', async () => {
    fakeSupabase({
      event: { data: { id: EVENT_ID }, error: null },
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })
    expect(await markEventWithoutAds('bar-a', EVENT_ID)).toEqual({
      ok: false,
      code: 'stale',
      message: 'Esta fecha ya tiene pauta cargada. Recargá para verla.',
    })
  })

  it('si falla la lectura de la fecha: error, sin insert', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeSupabase({
      event: { data: null, error: { code: '57014', message: 'timeout' } },
      insert: { data: null, error: null },
    })
    const state = await markEventWithoutAds('bar-a', EVENT_ID)
    expect(state).toMatchObject({ ok: false, code: 'error' })
    expect(db.inserts).toEqual([])
    log.mockRestore()
  })
})

// ─── saveEventMarketing: facturación en una fecha futura ─────────────────────

describe('saveEventMarketing — facturación en una fecha que todavía no pasó', () => {
  /** Lejos en el futuro: no depende del día en que corra el test. */
  const FUTURE_EVENT = { id: EVENT_ID, event_date: '2999-09-09' }
  const PAST_EVENT = { id: EVENT_ID, event_date: '2020-09-09' }
  const IN_FUTURE = {
    ok: false,
    code: 'invalid',
    message: M.revenueInFuture,
    fieldErrors: { revenueArs: M.revenueInFuture },
  }
  const WITH_REVENUE = { revenueArs: 2_480_000, usdArsRate: 1450, expectedUpdatedAt: BASELINE }
  const SAVED_ROW: EventMarketingDbRow = {
    scheduled_event_id: EVENT_ID,
    ad_spend_usd_cents: 17526,
    messages: 51,
    reach: null,
    revenue_ars_cents: '248000000',
    usd_ars_rate: '1450.00',
    revenue_per_guest_ars_cents: null,
    cost_per_guest_ars_cents: null,
    notes: 'nota corregida',
    updated_at: '2026-09-15T12:00:00+00:00',
    updated_by: USER_ID,
  }

  beforeEach(() => {
    vi.mocked(logAudit).mockClear()
    vi.mocked(requireTenantAccess).mockResolvedValue({
      tenant: { id: TENANT_A },
      role: 'owner',
      user: { id: USER_ID },
    } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
  })

  it('una edición movida a futuro guarda la facturación que YA tenía, sin tocarla', async () => {
    // El form la muestra y la manda tal cual para corregir, por ejemplo, la nota.
    const db = fakeSupabase({
      event: { data: FUTURE_EVENT, error: null },
      stored: { data: { revenue_ars_cents: '248000000' }, error: null },
      update: { data: SAVED_ROW, error: null },
    })
    const state = await saveEventMarketing(
      'bar-a',
      input({ ...WITH_REVENUE, notes: 'nota corregida' }),
    )
    expect(state.ok).toBe(true)
    // La lectura es contra la versión que el dueño tenía delante, en su bar.
    expect(db.filters).toEqual(
      expect.arrayContaining([
        ['scheduled_event_marketing', 'tenant_id', TENANT_A],
        ['scheduled_event_marketing', 'updated_at', BASELINE],
      ]),
    )
    expect(db.updates).toEqual([
      expect.objectContaining({ revenue_ars_cents: 248_000_000, usd_ars_rate: 1450 }),
    ])
  })

  it('cambiar la facturación de una fecha futura sigue rebotando, sin update', async () => {
    const db = fakeSupabase({
      event: { data: FUTURE_EVENT, error: null },
      stored: { data: { revenue_ars_cents: 200_000_000 }, error: null },
      update: { data: SAVED_ROW, error: null },
    })
    expect(await saveEventMarketing('bar-a', input(WITH_REVENUE))).toEqual(IN_FUTURE)
    expect(db.updates).toEqual([])
  })

  it('cargarla por primera vez (alta) en una fecha futura rebota sin leer nada más', async () => {
    const db = fakeSupabase({ event: { data: FUTURE_EVENT, error: null } })
    expect(
      await saveEventMarketing('bar-a', input({ ...WITH_REVENUE, expectedUpdatedAt: null })),
    ).toEqual(IN_FUTURE)
    expect(db.tables).toEqual(['scheduled_events'])
    expect(db.inserts).toEqual([])
  })

  it('si la versión que tenía el dueño ya no está: stale, sin update', async () => {
    const db = fakeSupabase({
      event: { data: FUTURE_EVENT, error: null },
      stored: { data: null, error: null },
    })
    expect(await saveEventMarketing('bar-a', input(WITH_REVENUE))).toMatchObject({
      ok: false,
      code: 'stale',
    })
    expect(db.updates).toEqual([])
  })

  it('si falla la lectura de lo guardado: error, sin update', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeSupabase({
      event: { data: FUTURE_EVENT, error: null },
      stored: { data: null, error: { code: '57014', message: 'timeout' } },
    })
    expect(await saveEventMarketing('bar-a', input(WITH_REVENUE))).toMatchObject({
      ok: false,
      code: 'error',
    })
    expect(db.updates).toEqual([])
    log.mockRestore()
  })

  it('en una fecha que ya pasó ni se lee lo guardado: va directo al update', async () => {
    const db = fakeSupabase({
      event: { data: PAST_EVENT, error: null },
      update: { data: SAVED_ROW, error: null },
    })
    const state = await saveEventMarketing(
      'bar-a',
      input({ ...WITH_REVENUE, revenueArs: 3_000_000 }),
    )
    expect(state.ok).toBe(true)
    expect(db.tables).toEqual(['scheduled_events', 'scheduled_event_marketing'])
    expect(db.updates).toHaveLength(1)
  })
})

// ─── saveEventMarketing: la plata por persona, de punta a punta ──────────────

describe('saveEventMarketing — ingreso y costo por persona', () => {
  const PAST_EVENT = { id: EVENT_ID, event_date: '2020-09-09' }
  const FUTURE_EVENT = { id: EVENT_ID, event_date: '2999-09-09' }
  /** La noche de ramen del ejemplo: $ 27.000 el cubierto, $ 15.000 de costo. */
  const RAMEN = { revenuePerGuestArs: 27_000, costPerGuestArs: 15_000 }
  const RAMEN_ROW: EventMarketingDbRow = {
    scheduled_event_id: EVENT_ID,
    ad_spend_usd_cents: 17526,
    messages: 51,
    reach: null,
    revenue_ars_cents: null,
    usd_ars_rate: null,
    revenue_per_guest_ars_cents: '2700000',
    cost_per_guest_ars_cents: '1500000',
    notes: null,
    updated_at: '2026-09-19T12:00:00+00:00',
    updated_by: USER_ID,
  }

  beforeEach(() => {
    vi.mocked(logAudit).mockClear()
    vi.mocked(requireTenantAccess).mockResolvedValue({
      tenant: { id: TENANT_A },
      role: 'owner',
      user: { id: USER_ID },
    } as unknown as Awaited<ReturnType<typeof requireTenantAccess>>)
  })

  it('el alta las manda en centavos, las devuelve y las deja en el audit', async () => {
    const db = fakeSupabase({
      event: { data: PAST_EVENT, error: null },
      insert: { data: RAMEN_ROW, error: null },
    })
    const state = await saveEventMarketing('bar-a', input(RAMEN))
    expect(state.ok).toBe(true)
    expect(db.inserts).toEqual([
      expect.objectContaining({
        revenue_per_guest_ars_cents: 2_700_000,
        cost_per_guest_ars_cents: 1_500_000,
      }),
    ])
    expect(state.ok && state.row).toMatchObject({
      revenuePerGuestArsCents: 2_700_000,
      costPerGuestArsCents: 1_500_000,
    })
    // La historia guarda con qué números se hizo la cuenta de esa noche.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          revenue_per_guest_ars_cents: 2_700_000,
          cost_per_guest_ars_cents: 1_500_000,
        }),
      }),
    )
  })

  it('una fecha que todavía no pasó las puede cargar: son un estimado, no la caja', async () => {
    const db = fakeSupabase({
      event: { data: FUTURE_EVENT, error: null },
      insert: { data: RAMEN_ROW, error: null },
    })
    const state = await saveEventMarketing('bar-a', input(RAMEN))
    expect(state.ok).toBe(true)
    // Sin facturación no se lee nada más: derecho al insert.
    expect(db.tables).toEqual(['scheduled_events', 'scheduled_event_marketing'])
    expect(db.inserts).toHaveLength(1)
  })

  it('vaciar los campos las manda en null, no las deja pegadas', async () => {
    const db = fakeSupabase({
      event: { data: PAST_EVENT, error: null },
      update: {
        data: { ...RAMEN_ROW, revenue_per_guest_ars_cents: null, cost_per_guest_ars_cents: null },
        error: null,
      },
    })
    const state = await saveEventMarketing('bar-a', input({ expectedUpdatedAt: BASELINE }))
    expect(state.ok).toBe(true)
    expect(db.updates).toEqual([
      expect.objectContaining({
        revenue_per_guest_ars_cents: null,
        cost_per_guest_ars_cents: null,
      }),
    ])
  })

  it('un número imposible no llega a la DB: rebota con el campo y el tope', async () => {
    const db = fakeSupabase({
      event: { data: PAST_EVENT, error: null },
      insert: { data: RAMEN_ROW, error: null },
    })
    const state = await saveEventMarketing('bar-a', input({ revenuePerGuestArs: 27_000_000 }))
    expect(state).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { revenuePerGuestArs: M.revenuePerGuestOutOfRange },
    })
    expect(db.tables).toEqual([])
  })
})
