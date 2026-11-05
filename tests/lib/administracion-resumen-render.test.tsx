// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeroBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/hero-block'
import type { HomeData } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/home-data'
import {
  heroAccounts,
  heroNumbers,
  paraHoyRows,
} from '@/app/(manager)/[tenantSlug]/administracion/_resumen/para-hoy'
import { ParaHoyBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/para-hoy-block'
import { ResumenSkeleton } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/skeletons'
import { headerDateLine } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/summary-copy'
import ResumenLoading from '@/app/(manager)/[tenantSlug]/administracion/loading'
import ResumenPage from '@/app/(manager)/[tenantSlug]/administracion/page'
import { requireAccountingAccess } from '@/lib/accounting/access'
import { buildSetup, buildToday, type SetupStrip, type TodayItem } from '@/lib/accounting/home'
import type { PayrollTotals } from '@/lib/accounting/payroll'
import { buildProjection } from '@/lib/accounting/projection'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type { AccSummary, SummaryAttentionItem } from '@/lib/accounting/queries/summary'
import type { WeekPlanTotals } from '@/lib/accounting/week-plan'
import { eachIsoDay } from '@/lib/dates'

/**
 * El Resumen ya dibujado: un panel verde y una planilla «Para hoy». Las cuentas tienen sus tests en
 * `accounting-home`; acá se cuida lo que la pantalla promete: un dato que falta no sale como «$ 0»,
 * hay un solo botón relleno, nunca más de cinco renglones, y la contadora no pasa por acá.
 */

const ui = vi.hoisted(() => ({
  readOnly: false,
  loaded: null as unknown,
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: ui.redirect,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => ({
  useAccounting: () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  }),
}))
vi.mock('@/lib/accounting/access', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  requireAccountingAccess: vi.fn(),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/_resumen/home-data', () => ({
  loadHome: (input: unknown) => {
    ui.loaded = input
    return {}
  },
}))

afterEach(() => {
  ui.readOnly = false
  ui.loaded = null
  ui.redirect.mockClear()
})

const TODAY = '2026-10-13'
const BASE = '/hub/administracion'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
const money = (text: string) => text.replaceAll('$ ', `$${NB}`)

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
const failed = Promise.resolve({
  ok: false as const,
  code: 'error' as const,
  message: 'Sin conexión: no pudimos cargar esto. Probá de nuevo.',
})

function attention(over: Partial<SummaryAttentionItem>): SummaryAttentionItem {
  return {
    kind: 'payable_overdue',
    refId: null,
    label: '',
    amountCents: null,
    date: null,
    days: null,
    partyId: null,
    count: null,
    ...over,
  }
}

function summaryOf(over: Partial<AccSummary> = {}): AccSummary {
  return {
    asOf: TODAY,
    treasuries: [
      {
        id: 'caja',
        name: 'Caja',
        kind: 'cash',
        accountCode: null,
        balanceCents: 39_475_700,
        pendingWalletCents: 0,
        lastCheckedOn: '2026-10-05',
        lastMovementDate: '2026-10-08',
      },
      {
        id: 'mp',
        name: 'Mercado Pago',
        kind: 'wallet',
        accountCode: null,
        balanceCents: 175_000_000,
        pendingWalletCents: 42_000_000,
        lastCheckedOn: null,
        lastMovementDate: '2026-10-08',
      },
    ],
    availableCents: 214_475_700,
    cardDebtCents: 0,
    pendingWalletCents: 42_000_000,
    payables: {
      totalCents: 69_600_000,
      overdueCents: 60_400_000,
      dueWeekCents: 4_000_000,
      partiesRed: 2,
    },
    receivables: null,
    ivaMonth: null,
    monthToDate: { soldCents: 0, purchasesAndExpensesCents: 0 },
    attention: [
      attention({
        kind: 'payable_overdue',
        label: 'Coca-Cola · Factura A 0003-00001100',
        amountCents: 12_500_000,
        days: 6,
        partyId: 'p1',
      }),
      attention({ kind: 'missing_daily_close', date: '2026-10-12', count: 1 }),
      attention({ kind: 'treasury_unchecked', refId: 'caja', label: 'Caja', date: '2026-10-05' }),
    ],
    books: {
      lastClosedMonth: null,
      closedBy: null,
      closedAt: null,
      openMonth: '2026-10-01',
      openWarnings: 0,
    },
    firstSteps: {
      firstExpense: true,
      firstDailyClose: true,
      accountantAdded: true,
      partnerGranted: true,
    },
    ...over,
  }
}

/** El bar recién configurado: sin saldos iniciales y con las cajas sin tocar. */
function untouchedSummary(): AccSummary {
  const base = summaryOf()
  return summaryOf({
    treasuries: base.treasuries.map((t) => ({
      ...t,
      balanceCents: 0,
      pendingWalletCents: 0,
      lastCheckedOn: null,
      lastMovementDate: null,
    })),
    availableCents: 0,
    pendingWalletCents: 0,
    payables: { totalCents: 0, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 },
    attention: [],
    firstSteps: { ...base.firstSteps, firstDailyClose: false },
  })
}

const SETTINGS = {
  legalName: 'Bar de Ejemplo SAS',
  cuit: '30-71234567-8',
  ivaCondition: 'responsable_inscripto',
  booksStartDate: '2026-09-01',
  openingStatus: 'posted',
  hasDocuments: true,
} as AccountingSettings

const PENDING_SETTINGS = {
  ...SETTINGS,
  booksStartDate: '2026-10-12',
  openingStatus: 'pending',
  cuit: null,
} as AccountingSettings

function fixed(over: Partial<RecurringExpenseRow>): RecurringExpenseRow {
  return {
    id: 'alquiler',
    name: 'Alquiler',
    partyId: null,
    partyName: null,
    accountId: 'cuenta',
    accountName: null,
    voucherType: null,
    vatRateBp: null,
    amountCents: 60_000_000,
    frequency: 'monthly',
    dueDay: 10,
    nextDueDate: '2026-10-20',
    remindDaysBefore: 3,
    treasuryAccountId: null,
    treasuryName: null,
    active: true,
    lastDocumentId: null,
    lastDocumentDate: null,
    notes: null,
    endsOn: null,
    remainingDues: null,
    installmentsTotal: null,
    skippedDue: null,
    loadedDue: null,
    ended: false,
    breakdown: [],
    updatedAt: '',
    monthStatus: 'pending',
    daysToDue: 7,
    ...over,
  }
}

const PAYROLL = (owedCents: number): PayrollTotals => ({
  count: owedCents > 0 ? 2 : 0,
  salaryCents: owedCents,
  advancesCents: 0,
  paidCents: 0,
  balanceCents: owedCents,
  owedCents,
})

const PLAN = (over: Partial<WeekPlanTotals> = {}): WeekPlanTotals => ({
  debtCents: 0,
  overdueCents: 0,
  purchasedCents: 0,
  budgetCents: 0,
  paidCents: 0,
  remainingCents: 0,
  overCents: 0,
  percent: 0,
  ...over,
})

function projectionOf(opts: { closedBefore?: string; targetCents?: number | null } = {}) {
  const closedBefore = opts.closedBefore ?? '2026-10-12'
  // Una fila por día, como manda la base: cargados hasta el 11, falta el de ayer (12/10).
  return buildProjection(
    eachIsoDay('2026-10-01', '2026-10-31').map((day) => ({
      day,
      targetCents: opts.targetCents ?? null,
      note: null,
      closes: day < closedBefore ? 1 : 0,
      salonCents: day < closedBefore ? 90_000_000 : 0,
      deliveryCents: 0,
      eventsCents: 0,
      salonCommissionCents: 0,
      deliveryCommissionCents: 0,
      eventsCommissionCents: 0,
      cashCountedCents: null,
    })),
    { serviceDay: TODAY },
  )
}

function homeData(
  input: {
    summary?: AccSummary | null
    settings?: AccountingSettings
    recurring?: RecurringExpenseRow[] | null
    integration?: IntegrationAttentionItem[] | null
    payroll?: PayrollTotals | null
    weekPlan?: WeekPlanTotals | null
    canWrite?: boolean
    closedBefore?: string
    targetCents?: number | null
  } = {},
): HomeData {
  const canWrite = input.canWrite ?? true
  const summary = input.summary === undefined ? summaryOf() : input.summary
  const settings = input.settings ?? SETTINGS
  const recurring = input.recurring === undefined ? [fixed({})] : input.recurring
  const integration = input.integration === undefined ? [] : input.integration
  const payroll = input.payroll === undefined ? PAYROLL(15_000_000) : input.payroll
  const weekPlan =
    input.weekPlan === undefined
      ? PLAN({ debtCents: 69_600_000, budgetCents: 30_000_000, paidCents: 12_500_000 })
      : input.weekPlan
  const projection = projectionOf({
    closedBefore: input.closedBefore,
    targetCents: input.targetCents,
  })
  return {
    base: BASE,
    tenantId: 'tenant',
    tenantSlug: 'hub',
    today: TODAY,
    serviceDay: TODAY,
    canWrite,
    summary: summary ? ok(summary) : failed,
    settings: ok(settings),
    projection: ok(projection),
    recurring: recurring ? ok(recurring) : failed,
    payments: ok(new Map()),
    payroll: payroll ? ok(payroll) : failed,
    weekPlan: weekPlan ? ok(weekPlan) : failed,
    onboarding: ok(null),
    integration: canWrite ? (integration ? ok(integration) : failed) : null,
    agenda: Promise.resolve({
      today: buildToday({
        summary,
        settings,
        projection,
        recurring,
        integration: canWrite ? integration : null,
        today: TODAY,
        serviceDay: TODAY,
        canWrite,
        base: BASE,
      }),
      setup: buildSetup({ summary, settings, recurring, canWrite, base: BASE }),
    }),
  }
}

/** El HTML con los importes legibles (sin el espacio duro) y sin los comentarios de React. */
const clean = (markup: string) => markup.replaceAll(NB, ' ').replaceAll('<!-- -->', '')
const hero = async (data: HomeData) => clean(renderToStaticMarkup(await HeroBlock({ data })))
const paraHoy = async (data: HomeData) => clean(renderToStaticMarkup(await ParaHoyBlock({ data })))

describe('el título', () => {
  it('es la fecha, con la mayúscula solo al principio', () => {
    expect(headerDateLine('2026-11-04')).toBe('Miércoles 4 de noviembre')
    expect(headerDateLine('2026-10-13')).toBe('Martes 13 de octubre')
    expect(headerDateLine('no es una fecha')).toBe('')
  })
})

describe('quién ve el Resumen', () => {
  const page = () => ResumenPage({ params: Promise.resolve({ tenantSlug: 'hub' }) })
  const access = (role: string) =>
    vi.mocked(requireAccountingAccess).mockResolvedValue({
      role,
      tenant: { id: 'tenant' },
      accounting: { write: role === 'owner' },
    } as never)

  it('la contadora entra directo a Sumas y saldos, sin pedir ninguna lectura', async () => {
    access('accountant')
    await expect(page()).rejects.toThrow('NEXT_REDIRECT')
    expect(ui.redirect).toHaveBeenCalledWith(`${BASE}/libros/sumas-y-saldos`)
    expect(ui.loaded).toBeNull()
  })

  it('un dueño se queda acá', async () => {
    access('owner')
    await page()
    expect(ui.redirect).not.toHaveBeenCalled()
    expect(ui.loaded).toMatchObject({ tenantId: 'tenant', tenantSlug: 'hub', canWrite: true })
  })

  it('un dueño que solo lee también: no se confunde con la contadora', async () => {
    vi.mocked(requireAccountingAccess).mockResolvedValue({
      role: 'owner',
      tenant: { id: 'tenant' },
      accounting: { write: false },
    } as never)
    await page()
    expect(ui.redirect).not.toHaveBeenCalled()
    expect(ui.loaded).toMatchObject({ canWrite: false })
  })
})

describe('el panel verde', () => {
  it('Plata hoy, las cuentas que llevan a sus movimientos y tres números que llevan a su pantalla', async () => {
    const html = await hero(homeData())
    expect(html).toContain('Plata hoy')
    expect(html).toContain('$ 2.144.757')
    expect(html).toContain(`href="${BASE}/cajas/caja"`)
    expect(html).toContain(`href="${BASE}/cajas/mp"`)
    expect(html).toContain('$ 394.757')
    expect(html).toContain('$ 1.750.000')
    // Lo que se debe, con lo vencido.
    expect(html).toContain('Le debés a proveedores')
    expect(html).toContain('$ 696.000')
    expect(html).toContain('$ 604.000 vencido')
    expect(html).toContain(`href="${BASE}/compras"`)
    // Fijos y sueldos juntos: $ 600.000 + $ 150.000.
    expect(html).toContain('Falta de fijos y sueldos')
    expect(html).toContain('$ 750.000')
    expect(html).toContain('$ 600.000 de fijos')
    expect(html).toContain(`href="${BASE}/gastos-fijos"`)
    // Lo vendido en el mes: once cierres de $ 900.000.
    expect(html).toContain('Vendiste en octubre')
    expect(html).toContain('$ 9.900.000')
    expect(html).toContain('Sin objetivo')
    expect(html).toContain(`href="${BASE}/ventas"`)
    expect(html).toContain('adm-hero')
  })

  it('con objetivo lo dice debajo de lo vendido', async () => {
    const html = await hero(homeData({ targetCents: 100_000_000 }))
    expect(html).toContain('Objetivo $ 31.000.000')
  })

  it('los números van en la letra de los datos, no en Fraunces', async () => {
    const html = await hero(homeData())
    expect(html).not.toContain('font-serif')
    expect(html).toContain('tabular-nums')
  })

  it('ya no están el dibujo de 30 días, la barra por caja ni la oración larga', async () => {
    const html = await hero(homeData())
    expect(html).not.toContain('Hace 30 días')
    expect(html).not.toContain('Repartida en')
    expect(html).not.toContain('Plata disponible hoy')
    expect(html).not.toContain('en camino')
  })

  it('sin saldos iniciales y sin movimientos no muestra «$ 0»: dice que todavía no sabe', async () => {
    const html = await hero(homeData({ summary: untouchedSummary(), settings: PENDING_SETTINGS }))
    expect(html).toContain('Todavía no sé cuánta plata hay')
    expect(html).toContain('Cargar lo que había')
    expect(html).toContain(`href="${BASE}/configurar"`)
    expect(html).not.toContain('$ 0<')
    // Las cuentas esperan su monto: enseñan qué va a aparecer.
    expect(html).toContain('Mercado Pago')
    expect(html).toContain('¿cuánto hay?')
    // Lo que se debe tampoco se afirma: entra con los saldos iniciales.
    expect(html).toContain('Entra con los saldos iniciales')
    expect(html).toContain('Sin dato')
  })

  it('quien solo lee ve el mismo estado sin el botón de carga', async () => {
    ui.readOnly = true
    const html = await hero(
      homeData({ summary: untouchedSummary(), settings: PENDING_SETTINGS, canWrite: false }),
    )
    expect(html).toContain('Todavía no sé cuánta plata hay')
    expect(html).not.toContain('Cargar lo que había')
    expect(html).not.toContain('/configurar')
  })

  it('un descubierto se dice con palabras, nunca con un menos', async () => {
    const base = summaryOf()
    const html = await hero(
      homeData({
        summary: summaryOf({
          availableCents: -1_200_000,
          pendingWalletCents: 0,
          treasuries: [
            {
              ...(base.treasuries[0] as AccSummary['treasuries'][number]),
              balanceCents: -1_200_000,
            },
          ],
        }),
      }),
    )
    expect(html).toContain('Hoy estás en descubierto por')
    expect(html).toContain('descubierto $ 12.000')
    expect(html).not.toContain('Plata hoy')
    expect(html).not.toMatch(/[−-]\s?\$/)
  })

  it('si el resumen no cargó lo dice ahí, con «Reintentar», sin tirar la pantalla', async () => {
    const html = await hero(homeData({ summary: null }))
    expect(html).toContain('No pudimos cargar el resumen.')
    expect(html).toContain('Sin conexión')
    expect(html).toContain('Reintentar')
  })

  it('si tardó demasiado no manda a elegir un período que el Resumen no tiene', async () => {
    const data = homeData({ summary: null })
    data.summary = Promise.resolve({
      ok: false as const,
      code: 'error' as const,
      message: 'Tardó demasiado. Probá de nuevo en un rato o con un período más corto.',
    })
    const html = await hero(data)
    expect(html).toContain('Tardó demasiado. Probá de nuevo en un rato.')
    expect(html).not.toContain('período')
  })
})

describe('las cuentas al lado de la plata', () => {
  const treasury = (over: Partial<AccSummary['treasuries'][number]>) => ({
    id: 't',
    name: 'Caja',
    kind: 'cash' as const,
    accountCode: null,
    balanceCents: 0,
    pendingWalletCents: 0,
    lastCheckedOn: null,
    lastMovementDate: null,
    ...over,
  })

  it('un cero de una cuenta es un dato; la tarjeta sin deuda no se nombra', () => {
    const { accounts, more } = heroAccounts(
      {
        treasuries: [
          treasury({ id: 'a', name: 'Caja', balanceCents: 0 }),
          treasury({ id: 'b', name: 'Banco', kind: 'bank', balanceCents: -1_200_000 }),
          treasury({ id: 'c', name: 'Visa', kind: 'credit_card', balanceCents: -8_000_000 }),
          treasury({ id: 'd', name: 'Master', kind: 'credit_card', balanceCents: 0 }),
        ],
      },
      BASE,
    )
    expect(accounts.map((a) => [a.name, a.text, a.href])).toEqual([
      ['Caja', money('$ 0'), `${BASE}/cajas/a`],
      ['Banco', money('descubierto $ 12.000'), `${BASE}/cajas/b`],
      ['Visa', money('debe $ 80.000'), `${BASE}/cajas/c`],
    ])
    expect(more).toBe(0)
  })

  it('con muchas, las primeras seis y «y N más»', () => {
    const { accounts, more } = heroAccounts(
      {
        treasuries: Array.from({ length: 8 }, (_, i) =>
          treasury({ id: `t${i}`, name: `Cuenta ${i}` }),
        ),
      },
      BASE,
    )
    expect(accounts).toHaveLength(6)
    expect(more).toBe(2)
  })
})

describe('los tres números', () => {
  const numbers = (over: Partial<Parameters<typeof heroNumbers>[0]> = {}) =>
    heroNumbers({
      base: BASE,
      today: TODAY,
      summary: summaryOf(),
      openingPending: false,
      recurring: [fixed({})],
      payments: new Map(),
      payroll: PAYROLL(15_000_000),
      projection: projectionOf(),
      ...over,
    })
  const number = (key: string, over: Partial<Parameters<typeof heroNumbers>[0]> = {}) => {
    const found = numbers(over).find((n) => n.key === key)
    if (!found) throw new Error(`falta ${key}`)
    return found
  }

  it('son tres, en este orden', () => {
    expect(numbers().map((n) => n.label)).toEqual([
      'Le debés a proveedores',
      'Falta de fijos y sueldos',
      'Vendiste en octubre',
    ])
  })

  describe('Le debés a proveedores', () => {
    const payables = (over: Partial<NonNullable<AccSummary['payables']>>) => ({
      summary: summaryOf({
        payables: {
          totalCents: 0,
          overdueCents: 0,
          dueWeekCents: 0,
          partiesRed: 0,
          ...over,
        },
      }),
    })

    it('con lo vencido; si no hay, lo que vence esta semana', () => {
      expect(number('debt').hint).toBe(money('$ 604.000 vencido'))
      expect(number('debt', payables({ totalCents: 500, dueWeekCents: 200 })).hint).toBe(
        money('$ 2 vence esta semana'),
      )
      expect(number('debt', payables({ totalCents: 500 })).hint).toBe('Nada vencido')
    })

    it('sin deuda es un cero de verdad', () => {
      expect(number('debt', payables({}))).toMatchObject({ cents: 0, hint: 'Nada pendiente' })
    })

    it('sin saldos iniciales y sin deuda, un cero no es un dato', () => {
      expect(number('debt', { ...payables({}), openingPending: true })).toMatchObject({
        cents: null,
        hint: 'Entra con los saldos iniciales',
      })
    })

    it('si la base todavía no lo calcula, «—»', () => {
      expect(number('debt', { summary: summaryOf({ payables: null }) })).toMatchObject({
        cents: null,
        hint: null,
      })
      expect(number('debt', { summary: null }).cents).toBeNull()
    })
  })

  describe('Falta de fijos y sueldos', () => {
    it('suma lo que falta de cada uno', () => {
      expect(number('fixed')).toMatchObject({
        cents: 75_000_000,
        hint: money('$ 600.000 de fijos'),
      })
    })

    it('solo sueldos', () => {
      expect(number('fixed', { recurring: [] })).toMatchObject({
        cents: 15_000_000,
        hint: money('$ 150.000 de sueldos'),
      })
    })

    it('lo vencido de los fijos se dice antes', () => {
      expect(
        number('fixed', {
          recurring: [fixed({ nextDueDate: '2026-10-10', daysToDue: -3 })],
        }),
      ).toMatchObject({ cents: 75_000_000, hint: money('$ 600.000 de fijos vencido') })
    })

    it('si no se pudieron leer los sueldos, un número a medias no pasa por entero', () => {
      expect(number('fixed', { payroll: null })).toMatchObject({
        cents: 60_000_000,
        hint: 'Sin contar los sueldos',
      })
    })

    it('si no se pudieron leer los fijos, tampoco', () => {
      expect(number('fixed', { recurring: null })).toMatchObject({
        cents: 15_000_000,
        hint: 'Sin contar los fijos',
      })
    })

    it('si no se pudo leer ninguno, «—»', () => {
      expect(number('fixed', { recurring: null, payroll: null })).toMatchObject({
        cents: null,
        hint: null,
      })
    })

    it('gastos fijos sin monto: pide completarlos en vez de mostrar «$ 0»', () => {
      const recurring = Array.from({ length: 31 }, (_, i) =>
        fixed({ id: `fijo-${i}`, amountCents: null, monthStatus: 'upcoming', daysToDue: 28 }),
      )
      expect(number('fixed', { recurring, payroll: PAYROLL(0) })).toMatchObject({
        cents: null,
        hint: '31 sin monto',
      })
      // Con sueldos, el número es de los sueldos, y sigue avisando.
      expect(number('fixed', { recurring })).toMatchObject({
        cents: 15_000_000,
        hint: '31 sin monto',
      })
    })

    it('nada cargado todavía no es «$ 0»', () => {
      expect(number('fixed', { recurring: [], payroll: PAYROLL(0) })).toMatchObject({
        cents: null,
        hint: 'Todavía sin cargar',
      })
    })

    it('con los sueldos ya pagados y nada más, también es un cero de verdad', () => {
      const payroll = { ...PAYROLL(0), salaryCents: 100, paidCents: 100 }
      expect(number('fixed', { recurring: [], payroll })).toMatchObject({
        cents: 0,
        hint: 'Al día',
      })
    })

    it('todo pagado sí es un cero de verdad', () => {
      const recurring = [fixed({ monthStatus: 'upcoming', nextDueDate: '2026-11-20' })]
      expect(number('fixed', { recurring, payroll: PAYROLL(0) })).toMatchObject({
        cents: 0,
        hint: 'Al día',
      })
    })
  })

  describe('Vendiste', () => {
    it('lo vendido y el objetivo', () => {
      expect(
        number('sold', { projection: projectionOf({ targetCents: 100_000_000 }) }),
      ).toMatchObject({
        cents: 990_000_000,
        hint: money('Objetivo $ 31.000.000'),
      })
      expect(number('sold').hint).toBe('Sin objetivo')
    })

    it('un mes sin ningún cierre no vendió cero', () => {
      expect(
        number('sold', { projection: projectionOf({ closedBefore: '2026-10-01' }) }),
      ).toMatchObject({
        cents: null,
        hint: 'Todavía sin cierres',
      })
    })

    it('si no se pudo leer, «—»', () => {
      expect(number('sold', { projection: null })).toMatchObject({ cents: null, hint: null })
    })
  })
})

describe('«Para hoy»', () => {
  const CLOSE: TodayItem = {
    id: 'daily_close',
    title: 'El cierre de ayer',
    status: 'Falta el del lunes 12/10.',
    tone: 'warn',
    done: false,
    action: {
      kind: 'href',
      href: `${BASE}/ventas/cierre?fecha=2026-10-12`,
      label: 'Cargar el cierre del lunes 12/10',
    },
    covers: [],
  }
  const SETUP = (done: number, total: number): SetupStrip => ({
    title: `Puesta en marcha · ${done} de ${total}`,
    done,
    total,
    complete: done >= total,
    steps: [],
    next: [],
    guideHref: `${BASE}/guias/como-arrancar#arranque-day1`,
  })
  const rows = (over: Partial<Parameters<typeof paraHoyRows>[0]> = {}) =>
    paraHoyRows({
      items: [CLOSE],
      setup: SETUP(5, 5),
      setupCountKnown: true,
      summary: summaryOf({ attention: [] }),
      recurring: [],
      weekPlan: null,
      integration: [],
      booksStartDate: '2026-09-01',
      today: TODAY,
      base: BASE,
      ...over,
    })
  const only = (key: string, over: Partial<Parameters<typeof paraHoyRows>[0]> = {}) =>
    rows(over).find((row) => row.key === key) ?? null

  describe('el cierre', () => {
    it('«Falta el cierre de ayer», con su día y «Cargar»', () => {
      expect(only('close')).toMatchObject({
        title: 'Falta el cierre de ayer',
        detail: 'lunes 12/10',
        action: { kind: 'href', href: `${BASE}/ventas/cierre?fecha=2026-10-12`, label: 'Cargar' },
      })
    })

    it('varios: cuántos y por cuál empezar', () => {
      const items: TodayItem[] = [
        {
          ...CLOSE,
          title: 'Los cierres del día',
          status: 'Faltan 3: empezá por el 01/10.',
          action: {
            kind: 'href',
            href: `${BASE}/ventas/cierre?fecha=2026-10-01`,
            label: 'Cargar el del jueves 01/10',
          },
        },
      ]
      expect(only('close', { items })).toMatchObject({
        title: 'Faltan cierres del día',
        detail: 'Faltan 3: empezá por el 01/10',
      })
    })

    it('uno que no es el de ayer', () => {
      const items: TodayItem[] = [
        {
          ...CLOSE,
          title: 'El cierre del día',
          status: 'Falta el del viernes 09/10.',
          action: {
            kind: 'href',
            href: `${BASE}/ventas/cierre?fecha=2026-10-09`,
            label: 'Cargar el cierre del viernes 09/10',
          },
        },
      ]
      expect(only('close', { items })).toMatchObject({
        title: 'Falta un cierre del día',
        detail: 'viernes 09/10',
      })
    })

    it('hecho, o sin nada que cargar todavía, no va', () => {
      expect(only('close', { items: [{ ...CLOSE, done: true, action: null }] })).toBeNull()
      expect(only('close', { items: [{ ...CLOSE, action: null }] })).toBeNull()
      expect(only('close', { items: [] })).toBeNull()
    })

    it('si no se pudo saber, lo ofrece sin afirmar que falta', () => {
      const items: TodayItem[] = [
        { ...CLOSE, tone: 'muted', status: 'Lo que se vendió y cómo te pagaron.' },
      ]
      expect(only('close', { items })).toMatchObject({
        title: 'El cierre de ayer',
        detail: 'Lo que se vendió y cómo te pagaron.',
      })
    })
  })

  describe('el Plan de la semana', () => {
    it('llevás X de Y, y lleva a su planilla', () => {
      expect(
        only('plan', { weekPlan: PLAN({ budgetCents: 30_000_000, paidCents: 12_500_000 }) }),
      ).toMatchObject({
        title: 'Plan de la semana',
        detail: money('llevás $ 125.000 de $ 300.000'),
        action: { kind: 'href', href: `${BASE}/compras/semana`, label: 'Abrir' },
      })
    })

    it('sin presupuesto y con deuda, todavía sin armar', () => {
      expect(only('plan', { weekPlan: PLAN({ debtCents: 100 }) })?.detail).toBe('todavía sin armar')
    })

    it('sin nada que pagar no hay renglón; tampoco si no se pudo leer', () => {
      expect(only('plan', { weekPlan: PLAN() })).toBeNull()
      expect(only('plan', { weekPlan: null })).toBeNull()
    })
  })

  describe('lo vencido más urgente', () => {
    const overdue = (over: Partial<SummaryAttentionItem>) =>
      attention({ kind: 'payable_overdue', label: 'Coca-Cola', amountCents: 12_500_000, ...over })
    const summary = (items: SummaryAttentionItem[], partiesRed = items.length) =>
      summaryOf({
        attention: items,
        payables: {
          totalCents: 100,
          overdueCents: 100,
          dueWeekCents: 0,
          partiesRed,
        },
      })

    it('el comprobante con más días, con su «Pagar» a ese proveedor', () => {
      const row = only('overdue', {
        summary: summary([
          overdue({ label: 'Hielo', days: 2, partyId: 'p2' }),
          overdue({ days: 6, partyId: 'p1' }),
        ]),
      })
      expect(row).toMatchObject({
        title: 'Coca-Cola',
        detail: money('$ 125.000 · vencido hace 6 días · y 1 más'),
        late: true,
        action: { kind: 'sheet', sheet: 'pagar', params: { proveedor: 'p1' }, label: 'Pagar' },
      })
    })

    it('un gasto fijo más atrasado le gana, y «Pagar» abre el gasto con ese gasto fijo', () => {
      const row = only('overdue', {
        summary: summary([overdue({ days: 2, partyId: 'p1' })]),
        recurring: [fixed({ id: 'sistema', name: 'Sistema de caja', daysToDue: -5 })],
      })
      expect(row).toMatchObject({
        title: 'Sistema de caja',
        detail: money('$ 600.000 · vencido hace 5 días · y 1 más'),
        action: {
          kind: 'sheet',
          sheet: 'gasto',
          params: { 'gasto-fijo': 'sistema' },
          label: 'Pagar',
        },
      })
    })

    it('un gasto fijo sin monto lo dice', () => {
      const row = only('overdue', {
        summary: summary([]),
        recurring: [fixed({ id: 'luz', name: 'Luz', amountCents: null, daysToDue: -1 })],
      })
      expect(row?.detail).toBe('sin monto · vencido hace 1 día')
    })

    it('la lista de avisos viene topeada: los que quedan salen del total', () => {
      const row = only('overdue', { summary: summary([overdue({ days: 6, partyId: 'p1' })], 9) })
      expect(row?.detail).toBe(money('$ 125.000 · vencido hace 6 días · y 8 más'))
    })

    it('sin proveedor en el aviso, lleva a la lista', () => {
      const row = only('overdue', { summary: summary([overdue({ days: 6 })]) })
      expect(row?.action).toEqual({ kind: 'href', href: `${BASE}/compras`, label: 'Ver' })
    })

    it('lo que vence y todavía no venció no va acá', () => {
      expect(
        only('overdue', {
          summary: summary([attention({ kind: 'payable_due_week', label: 'Hielo', days: 2 })]),
          recurring: [fixed({ daysToDue: 2 })],
        }),
      ).toBeNull()
    })
  })

  describe('ARCA y los archivos', () => {
    const VOUCHERS: IntegrationAttentionItem = {
      kind: 'arca_vouchers',
      tone: 'danger',
      label: 'Hay 3 facturas de ARCA para verificar o cargar en los libros.',
      href: '/ventas/nueva-factura',
      actionLabel: 'Ver',
      count: 3,
      date: null,
    }
    const MC: IntegrationAttentionItem = {
      kind: 'mc_prev_month',
      tone: 'info',
      label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
      href: '/importar/arca',
      actionLabel: 'Subir las compras de ARCA',
      count: null,
      date: null,
    }

    it('un solo renglón, el más urgente, con su botón a la pantalla que lo resuelve', () => {
      expect(only('integration', { integration: [VOUCHERS, MC] })).toMatchObject({
        title: 'Hay 3 facturas de ARCA para verificar o cargar en los libros',
        detail: 'y 1 más',
        action: { kind: 'href', href: `${BASE}/ventas/nueva-factura`, label: 'Ver' },
      })
    })

    it('no pide bajar de ARCA un mes de antes de los libros', () => {
      expect(only('integration', { integration: [MC], booksStartDate: '2026-10-12' })).toBeNull()
      expect(only('integration', { integration: [MC] })).not.toBeNull()
    })

    it('si no se pudo revisar, no se calla: se reintenta', () => {
      expect(only('integration', { integration: null })).toMatchObject({
        title: 'No pudimos revisar ARCA ni los archivos',
        action: null,
        retry: true,
      })
    })

    it('sin nada, no hay renglón', () => {
      expect(only('integration', { integration: [] })).toBeNull()
    })
  })

  describe('la puesta en marcha', () => {
    it('te faltan N pasos, y lleva a la guía', () => {
      expect(only('setup', { setup: SETUP(8, 11) })).toMatchObject({
        title: 'Puesta en marcha',
        detail: 'te faltan 3 pasos',
        action: {
          kind: 'href',
          href: `${BASE}/guias/como-arrancar#arranque-day1`,
          label: 'Seguir',
        },
      })
      expect(only('setup', { setup: SETUP(10, 11) })?.detail).toBe('te falta 1 paso')
    })

    it('completa, ya no está', () => {
      expect(only('setup', { setup: SETUP(11, 11) })).toBeNull()
    })

    it('si no se sabe el avance no afirma un número, pero sigue estando', () => {
      expect(only('setup', { setup: SETUP(1, 2), setupCountKnown: false })).toMatchObject({
        title: 'Puesta en marcha',
        detail: null,
      })
      expect(only('setup', { setup: SETUP(2, 2), setupCountKnown: false })).toBeNull()
    })
  })

  it('nunca más de cinco renglones, en el orden del día', () => {
    const all = rows({
      setup: SETUP(8, 11),
      summary: summaryOf(),
      recurring: [fixed({ daysToDue: -2 })],
      weekPlan: PLAN({ budgetCents: 100 }),
      integration: [
        {
          kind: 'import_review',
          tone: 'warning',
          label: 'Compras de ARCA para revisar y cargar.',
          href: '/importar',
          actionLabel: 'Revisar',
          count: 1,
          date: null,
        },
      ],
    })
    expect(all.map((row) => row.key)).toEqual(['close', 'plan', 'overdue', 'integration', 'setup'])
  })

  describe('ya dibujado', () => {
    it('una planilla con sus botones: uno solo relleno, el primero', async () => {
      const html = await paraHoy(
        homeData({
          summary: summaryOf({ attention: summaryOf().attention.slice(0, 1) }),
          integration: [
            {
              kind: 'arca_vouchers',
              tone: 'danger',
              label: 'Hay 3 facturas de ARCA para verificar o cargar en los libros.',
              href: '/ventas/nueva-factura',
              actionLabel: 'Ver',
              count: 3,
              date: null,
            },
          ],
        }),
      )
      expect(html).toContain('>Para hoy<')
      expect(html).toContain('Falta el cierre de ayer')
      expect(html).toContain('lunes 12/10')
      expect(html).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`)
      expect(html).toContain('Plan de la semana')
      expect(html).toContain('llevás $ 125.000 de $ 300.000')
      expect(html).toContain('Coca-Cola · Factura A 0003-00001100')
      expect(html).toContain('vencido hace')
      expect(html).toContain('facturas de ARCA')
      // Máximo una acción primaria por pantalla.
      expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1)
    })

    it('lo que ya no está: el calendario, las tarjetas numeradas, el IVA ni «Hoy te toca»', async () => {
      const html = await paraHoy(homeData())
      expect(html).not.toContain('Hoy te toca')
      expect(html).not.toContain('Cargar un gasto')
      expect(html).not.toContain('IVA de')
      expect(html).not.toContain('Avisos')
    })

    it('con el paso que destraba en el panel de arriba, acá ninguno va relleno', async () => {
      const html = await paraHoy(
        homeData({ summary: untouchedSummary(), settings: PENDING_SETTINGS }),
      )
      expect(html).toContain('Cargar')
      expect(html).not.toContain('bg-primary text-primary-foreground')
    })

    it('la puesta en marcha está mientras falte algo', async () => {
      const html = await paraHoy(
        homeData({ summary: untouchedSummary(), settings: PENDING_SETTINGS }),
      )
      expect(html).toContain('Puesta en marcha')
      expect(html).toMatch(/te faltan? \d+ paso/)
      expect(html).toContain(`href="${BASE}/guias/como-arrancar#arranque-day1"`)
    })

    it('con todo al día, una oración adentro de la misma planilla', async () => {
      const html = await paraHoy(
        homeData({
          summary: summaryOf({ attention: [] }),
          recurring: [],
          weekPlan: PLAN(),
          closedBefore: TODAY,
        }),
      )
      expect(html).toContain('>Para hoy<')
      expect(html).toContain('Está todo al día.')
      expect(html).not.toContain('<table')
    })

    it('si la revisión de ARCA falló, ofrece reintentar', async () => {
      const html = await paraHoy(homeData({ integration: null }))
      expect(html).toContain('No pudimos revisar ARCA ni los archivos')
      expect(html).toContain('Reintentar')
    })

    it('quien solo lee ve lo mismo, sin ningún botón', async () => {
      ui.readOnly = true
      const html = await paraHoy(homeData({ canWrite: false }))
      expect(html).toContain('Plan de la semana')
      expect(html).not.toContain('<button')
      expect(html).not.toContain('/ventas/cierre')
    })
  })
})

describe('mientras carga', () => {
  it('la fecha, el panel verde y la planilla, con su forma', () => {
    const skeleton = renderToStaticMarkup(<ResumenSkeleton />)
    expect(skeleton).toContain('adm-hero')
    expect(skeleton).toContain('Cargando el resumen')
    const loading = renderToStaticMarkup(<ResumenLoading />)
    expect(loading).toContain('adm-hero')
    expect(loading).toContain('adm-rise')
  })
})
