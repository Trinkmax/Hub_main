/**
 * El Resumen nuevo de Administración («la plata hoy»): las cuentas puras de
 * `lib/accounting/home.ts` y la lectura de «En qué se va la plata»
 * (`lib/accounting/queries/home.ts`), con un cliente de mentira.
 *
 * Los números de «En qué se va la plata» son los del bar de ejemplo en octubre
 * de 2026, verificados contra una consulta SQL directa el 13/10/2026.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { code: string; message: string } | null; count?: number }
type Call = {
  table: string
  columns: string
  head: boolean
  eq: Record<string, unknown>
  in: Record<string, readonly unknown[]>
  is: Record<string, unknown>
  gte: Record<string, unknown>
  lte: Record<string, unknown>
  order: string[]
  range: [number, number] | null
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: (_call: Call): Result => ({ data: [], error: null }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: Call = {
        table,
        columns: '',
        head: false,
        eq: {},
        in: {},
        is: {},
        gte: {},
        lte: {},
        order: [],
        range: null,
      }
      // Una promesa de verdad: se resuelve cuando la cadena ya está armada.
      const pending = Promise.resolve().then(() => {
        db.calls.push(call)
        return db.respond(call)
      })
      const chain = Object.assign(pending, {
        select: (columns: string, opts?: { head?: boolean }) => {
          call.columns = columns
          call.head = opts?.head === true
          return chain
        },
        eq: (column: string, value: unknown) => {
          call.eq[column] = value
          return chain
        },
        in: (column: string, values: readonly unknown[]) => {
          call.in[column] = values
          return chain
        },
        is: (column: string, value: unknown) => {
          call.is[column] = value
          return chain
        },
        gte: (column: string, value: unknown) => {
          call.gte[column] = value
          return chain
        },
        lte: (column: string, value: unknown) => {
          call.lte[column] = value
          return chain
        },
        order: (column: string) => {
          call.order.push(column)
          return chain
        },
        range: (from: number, to: number) => {
          call.range = [from, to]
          return chain
        },
      })
      return chain
    },
  }),
}))

import {
  type AdmSlot,
  aggregateSpending,
  allocateCents,
  balancePoints,
  balanceTrend,
  buildSetup,
  buildToday,
  fixedProgress,
  type HomeRecurringRow,
  heroSentence,
  heroSentenceParts,
  heroState,
  homeCashRange,
  homeSpendingRange,
  inOutSummary,
  integrationForBooks,
  invoicedSplit,
  ivaStrip,
  monthDays,
  monthPace,
  monthSentence,
  monthTitle,
  noticeAttention,
  payableAttention,
  payablesTranches,
  previousMonthBeforeBooks,
  type SpendingAccount,
  type SpendingDocument,
  type SpendingLine,
  setupNext,
  spendingView,
  type TodayInput,
  type TodayItem,
  treasurySegments,
  treasurySlots,
  treasuryTones,
  weekBuckets,
} from '@/lib/accounting/home'
import { type OnboardingData, onboardingState } from '@/lib/accounting/onboarding'
import {
  buildProjection,
  type Projection,
  type ProjectionSourceDay,
  type ProjectionSummary,
} from '@/lib/accounting/projection'
import {
  getMonthSpending,
  getSupplierCategoryCount,
  spendingAccounts,
} from '@/lib/accounting/queries/home'
import {
  type IntegrationAttentionItem,
  type IntegrationsStatus,
  integrationAttention,
} from '@/lib/accounting/queries/integrations'
import type {
  AccSummary,
  SummaryAttentionItem,
  SummaryTreasury,
} from '@/lib/accounting/queries/summary'
import {
  type RecurringPaymentFacts,
  recurringLine,
  recurringTotals,
} from '@/lib/accounting/recurring-status'
import { eachIsoDay, monthRange } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

const NB = ' '
/** Hoy: martes 13 de octubre de 2026. */
const TODAY = '2026-10-13'
const BASE = '/bar-demo/administracion'

/** Pesos → centavos. */
const p = (pesos: number) => pesos * 100
/** Como lo muestra la pantalla: «$ 1.234». */
const money = (pesos: number) => formatCentsShort(p(pesos))

// ─── Armado de casos ─────────────────────────────────────────────────────────

function treasury(
  id: string,
  kind: SummaryTreasury['kind'],
  balanceCents: number,
  over: Partial<SummaryTreasury> = {},
): SummaryTreasury {
  return {
    id,
    name: id,
    kind,
    accountCode: null,
    balanceCents,
    pendingWalletCents: 0,
    lastCheckedOn: null,
    lastMovementDate: balanceCents === 0 ? null : '2026-10-08',
    ...over,
  }
}

function summary(over: Partial<AccSummary> = {}): AccSummary {
  const treasuries = over.treasuries ?? []
  return {
    asOf: TODAY,
    treasuries,
    availableCents: treasuries
      .filter((t) => t.kind !== 'credit_card')
      .reduce((sum, t) => sum + t.balanceCents, 0),
    cardDebtCents: 0,
    pendingWalletCents: 0,
    payables: null,
    receivables: null,
    ivaMonth: null,
    monthToDate: { soldCents: 0, purchasesAndExpensesCents: 0 },
    attention: [],
    books: {
      lastClosedMonth: null,
      closedBy: null,
      closedAt: null,
      openMonth: null,
      openWarnings: null,
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

function attention(
  kind: SummaryAttentionItem['kind'],
  over: Partial<SummaryAttentionItem> = {},
): SummaryAttentionItem {
  return {
    kind,
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

function sourceDay(day: string, over: Partial<ProjectionSourceDay> = {}): ProjectionSourceDay {
  return {
    day,
    targetCents: null,
    note: null,
    closes: 0,
    salonCents: 0,
    deliveryCents: 0,
    eventsCents: 0,
    salonCommissionCents: 0,
    deliveryCommissionCents: 0,
    eventsCommissionCents: 0,
    cashCountedCents: null,
    ...over,
  }
}

/** Un mes entero con cierre en los primeros `closedThrough` días. */
function monthProjection(opts: {
  month?: string
  serviceDay?: string
  closedThrough: number
  soldPerDay?: number
  targetPerDay?: number | null
}): Projection {
  const { from, to } = monthRange(opts.month ?? '2026-10')
  const rows = eachIsoDay(from, to).map((day) => {
    const n = Number(day.slice(8, 10))
    const closed = n <= opts.closedThrough
    return sourceDay(day, {
      targetCents: opts.targetPerDay ? p(opts.targetPerDay) : null,
      closes: closed ? 1 : 0,
      salonCents: closed ? p(opts.soldPerDay ?? 1_000_000) : 0,
    })
  })
  return buildProjection(rows, { serviceDay: opts.serviceDay ?? TODAY })
}

function fixedRow(over: Partial<HomeRecurringRow> = {}): HomeRecurringRow {
  return {
    id: 'alquiler',
    name: 'Alquiler',
    active: true,
    ended: false,
    monthStatus: 'pending',
    nextDueDate: '2026-10-10',
    loadedDue: null,
    amountCents: p(850_000),
    remainingDues: null,
    installmentsTotal: null,
    daysToDue: -3,
    remindDaysBefore: 5,
    ...over,
  }
}

/** Los tres gastos fijos del bar de ejemplo: dos vencidos el 10/10 y uno que vence el 15/10. */
const DEMO_FIXED: HomeRecurringRow[] = [
  fixedRow(),
  fixedRow({ id: 'internet', name: 'Internet', amountCents: p(30_000) }),
  fixedRow({
    id: 'sistema',
    name: 'Sistema',
    amountCents: p(35_000),
    nextDueDate: '2026-10-15',
    daysToDue: 2,
  }),
]

function onboarding(over: Partial<OnboardingData> = {}) {
  const data: OnboardingData = {
    today: TODAY,
    sasMissing: [],
    bankWithCbu: true,
    walletWithCvu: true,
    salesMethods: 4,
    salesPoints: 1,
    openingDone: true,
    partnerGranted: true,
    accountantAdded: true,
    arca: null,
    arcaVouchersAttention: 0,
    mp: null,
    imports: {},
    mcPrevMonthCovered: false,
    recurringActive: 3,
    dailyCloseMissing: 0,
    mpInvoiceThisMonth: false,
    treasuriesUnchecked: 0,
    prevMonthClosed: false,
    booksStartDate: '2026-09-01',
    manual: [],
    ...over,
  }
  return { data, state: onboardingState(data) }
}

function today(over: Partial<TodayInput> = {}): TodayInput {
  return {
    summary: summary(),
    settings: { booksStartDate: '2026-09-01' },
    today: TODAY,
    canWrite: true,
    base: BASE,
    ...over,
  }
}

function byId(items: readonly TodayItem[], id: TodayItem['id']): TodayItem | undefined {
  return items.find((i) => i.id === id)
}

// ─── 1. La plata hoy ─────────────────────────────────────────────────────────

describe('la oración del héroe', () => {
  it('tres lugares, plata en camino y la tarjeta de la empresa', () => {
    const s = summary({
      treasuries: [
        treasury('Caja', 'cash', p(394_757)),
        treasury('Mercado Pago', 'wallet', p(1_390_000), { pendingWalletCents: p(420_000) }),
        treasury('Banco', 'bank', p(2_000_000)),
        treasury('Visa', 'credit_card', -p(150_000)),
      ],
      pendingWalletCents: p(420_000),
      cardDebtCents: p(150_000),
    })
    expect(heroSentenceParts(s)).toEqual([
      'Repartida en 3 lugares.',
      `Hay $${NB}420.000 en camino (QR y transferencias que todavía no entraron).`,
      `La tarjeta de la empresa debe $${NB}150.000.`,
    ])
    expect(heroSentence(s)).toBe(heroSentenceParts(s).join(' '))
  })

  it('solo dice lo que corresponde: una caja, ninguna, o todo en cero', () => {
    expect(heroSentence(summary({ treasuries: [treasury('Caja', 'cash', p(80_000))] }))).toBe(
      'Está toda en Caja.',
    )
    expect(heroSentence(summary())).toBe('Todavía no hay cajas cargadas.')
    expect(
      heroSentence(
        summary({ treasuries: [treasury('Caja', 'cash', 0), treasury('MP', 'wallet', 0)] }),
      ),
    ).toBe('No hay plata en ninguna caja.')
  })

  it('un descubierto se dice con palabras, nunca con un menos', () => {
    const s = summary({
      treasuries: [treasury('Caja', 'cash', p(50_000)), treasury('Banco', 'bank', -p(120_000))],
    })
    const text = heroSentence(s)
    expect(text).toBe(`Está toda en Caja. Banco está en descubierto por $${NB}120.000.`)
    expect(text).not.toMatch(/[−-]\$/)
  })

  it('dos tarjetas con deuda van en plural', () => {
    const s = summary({
      treasuries: [
        treasury('Caja', 'cash', p(10_000)),
        treasury('Visa', 'credit_card', -p(100_000)),
        treasury('Master', 'credit_card', -p(50_000)),
      ],
      cardDebtCents: p(150_000),
    })
    expect(heroSentenceParts(s).at(-1)).toBe(`Las tarjetas de la empresa deben $${NB}150.000.`)
  })
})

describe('qué muestra el héroe', () => {
  const untouched = [treasury('Caja', 'cash', 0), treasury('Mercado Pago', 'wallet', 0)]

  it('bar recién configurado: no es «$ 0», todavía no se sabe', () => {
    const state = heroState(
      summary({ treasuries: untouched }),
      { openingStatus: 'pending' },
      { base: BASE },
    )
    expect(state).toEqual({
      kind: 'unknown',
      reason: 'opening_pending',
      title: 'Todavía no sé cuánta plata hay',
      sentence:
        'Contame cuánto había en cada caja el día que arrancaste y empiezo a llevar la cuenta.',
      action: { kind: 'href', href: `${BASE}/configurar`, label: 'Cargar lo que había' },
    })
  })

  it('la contadora lo lee sin botón', () => {
    const state = heroState(
      summary({ treasuries: untouched }),
      { openingStatus: 'pending' },
      { canWrite: false },
    )
    expect(state.kind).toBe('unknown')
    if (state.kind !== 'unknown') return
    expect(state.action).toBeNull()
    expect(state.sentence).toMatch(/^Los dueños todavía no cargaron/)
  })

  it('con «Arrancar en cero» o con un movimiento, el cero ya es un dato', () => {
    expect(heroState(summary({ treasuries: untouched }), { openingStatus: 'skipped' }).kind).toBe(
      'normal',
    )
    const moved = [treasury('Caja', 'cash', 0, { lastMovementDate: '2026-10-12' })]
    expect(heroState(summary({ treasuries: moved }), { openingStatus: 'pending' })).toMatchObject({
      kind: 'normal',
      cents: 0,
      overdrawn: false,
    })
    // Si los ajustes no cargaron, no se inventa el estado: se muestra el número.
    expect(heroState(summary({ treasuries: untouched }), null).kind).toBe('normal')
  })

  it('sin ninguna caja cargada tampoco hay número', () => {
    const state = heroState(summary(), { openingStatus: 'posted' })
    expect(state).toMatchObject({
      kind: 'unknown',
      reason: 'no_treasuries',
      action: { kind: 'href', href: '/ajustes?tab=cajas' },
    })
  })

  it('todo en descubierto: lo avisa para que no salga un menos', () => {
    const s = summary({ treasuries: [treasury('Banco', 'bank', -p(30_000))] })
    expect(heroState(s, { openingStatus: 'posted' })).toMatchObject({
      kind: 'normal',
      cents: -p(30_000),
      overdrawn: true,
    })
  })
})

describe('la barra por caja', () => {
  it('solo las que tienen plata; el color sale del orden en la lista y no se corre', () => {
    const treasuries = [
      treasury('caja', 'cash', p(100_000)),
      treasury('visa', 'credit_card', -p(40_000)),
      treasury('mp', 'wallet', 0),
      treasury('banco', 'bank', p(300_000), { pendingWalletCents: p(5_000) }),
    ]
    // La tarjeta no ocupa color; la billetera en cero conserva el suyo (el 2).
    expect(treasurySlots(treasuries)).toEqual({ caja: 1, mp: 2, banco: 3 })

    const bar = treasurySegments(
      summary({ treasuries, cardDebtCents: p(40_000), pendingWalletCents: p(5_000) }),
    )
    expect(bar.segments.map((s) => [s.key, s.slot, s.cents, s.percent, s.path])).toEqual([
      ['caja', 1, p(100_000), 25, '/cajas/caja'],
      ['banco', 3, p(300_000), 75, '/cajas/banco'],
    ])
    // El color de la barra sale del TIPO de caja, no de cuánta plata tiene ni de su lugar.
    expect(bar.segments.map((s) => [s.key, s.tone])).toEqual([
      ['caja', { kind: 'cash', step: 1 }],
      ['banco', { kind: 'bank', step: 1 }],
    ])
    expect(bar.totalCents).toBe(p(400_000))
    expect(bar.pendingCents).toBe(p(5_000))
    expect(bar.cardDebtCents).toBe(p(40_000))
    expect(bar.cards).toEqual([
      {
        id: 'visa',
        name: 'visa',
        kind: 'credit_card',
        cents: p(40_000),
        slot: null,
        path: '/cajas/visa',
      },
    ])
    expect(bar.isEmpty).toBe(false)
  })

  it('la séptima caja no tiene color propio: va a «Otras cajas»', () => {
    const treasuries = Array.from({ length: 9 }, (_, i) => treasury(`c${i + 1}`, 'bank', p(100)))
    const slots = treasurySlots(treasuries)
    expect(Object.values(slots)).toEqual<Array<AdmSlot | null>>([
      1,
      2,
      3,
      4,
      5,
      6,
      null,
      null,
      null,
    ])

    const bar = treasurySegments(summary({ treasuries }))
    expect(bar.segments).toHaveLength(7)
    expect(bar.segments.at(-1)).toMatchObject({
      key: 'otras',
      treasuryId: null,
      name: 'Otras cajas',
      slot: null,
      cents: p(300),
      count: 3,
      path: null,
    })
    expect(bar.segments.reduce((sum, s) => sum + s.cents, 0)).toBe(bar.totalCents)
  })

  it('el tono es del tipo; dos del mismo tipo, el mismo tono en otro escalón', () => {
    const treasuries = [
      treasury('caja', 'cash', p(100)),
      treasury('nacion', 'bank', p(100)),
      treasury('visa', 'credit_card', -p(40)),
      treasury('mp', 'wallet', 0),
      treasury('galicia', 'bank', p(100)),
      treasury('otra', 'other', p(100)),
      treasury('macro', 'bank', p(100)),
      treasury('bbva', 'bank', p(100)),
    ]
    expect(treasuryTones(treasuries)).toEqual({
      caja: { kind: 'cash', step: 1 },
      nacion: { kind: 'bank', step: 1 },
      // La billetera en cero conserva su tono; la tarjeta no es plata y no entra.
      mp: { kind: 'wallet', step: 1 },
      galicia: { kind: 'bank', step: 2 },
      otra: null,
      macro: { kind: 'bank', step: 3 },
      // El cuarto banco ya no tiene escalón propio.
      bbva: null,
    })
    // El escalón no se corre porque otra del mismo tipo quede sin plata.
    const emptied = treasuries.map((t) => (t.id === 'nacion' ? { ...t, balanceCents: 0 } : t))
    const galicia = treasurySegments(summary({ treasuries: emptied })).segments.find(
      (s) => s.key === 'galicia',
    )
    expect(galicia?.tone).toEqual({ kind: 'bank', step: 2 })
  })

  it('una sola caja sin color conserva su nombre y su link', () => {
    const treasuries = Array.from({ length: 7 }, (_, i) => treasury(`c${i + 1}`, 'cash', p(100)))
    expect(treasurySegments(summary({ treasuries })).segments.at(-1)).toMatchObject({
      key: 'c7',
      name: 'c7',
      slot: null,
      path: '/cajas/c7',
      count: 1,
    })
  })

  it('un descubierto va aparte y no se dibuja; sin plata no hay barra', () => {
    const bar = treasurySegments(
      summary({ treasuries: [treasury('caja', 'cash', 0), treasury('banco', 'bank', -p(70_000))] }),
    )
    expect(bar.segments).toEqual([])
    expect(bar.isEmpty).toBe(true)
    expect(bar.totalCents).toBe(0)
    expect(bar.overdrawn).toEqual([
      { id: 'banco', name: 'banco', kind: 'bank', cents: p(70_000), slot: 2, path: '/cajas/banco' },
    ])
    expect(treasurySegments(summary()).isEmpty).toBe(true)
  })
})

describe('hace 30 días', () => {
  it('los rangos del Resumen', () => {
    expect(homeCashRange(TODAY)).toEqual({ from: '2026-09-14', to: TODAY })
    expect(homeSpendingRange(TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
  })

  it('más, menos o lo mismo, en palabras', () => {
    const range = homeCashRange(TODAY)
    expect(balanceTrend({ openingCents: p(1_200_000), closingCents: p(1_550_000) }, range)).toEqual(
      {
        kind: 'compared',
        beforeCents: p(1_200_000),
        nowCents: p(1_550_000),
        diffCents: p(350_000),
        direction: 'up',
        sentence: `Hace 30 días había $${NB}1.200.000`,
        diffText: `$${NB}350.000 más`,
      },
    )
    expect(balanceTrend({ openingCents: p(500), closingCents: p(420) }, range)).toMatchObject({
      direction: 'down',
      diffText: `$${NB}80 menos`,
    })
    expect(balanceTrend({ openingCents: 0, closingCents: 0 }, range)).toMatchObject({
      direction: 'flat',
      diffText: 'Lo mismo',
      sentence: `Hace 30 días había $${NB}0`,
    })
    expect(balanceTrend({ openingCents: -p(900), closingCents: p(100) }, range)).toMatchObject({
      sentence: `Hace 30 días había un descubierto de $${NB}900`,
      diffText: `$${NB}1.000 más`,
    })
  })

  it('si los libros arrancaron adentro del período, no compara contra un cero', () => {
    const trend = balanceTrend(
      { openingCents: 0, closingCents: p(900_000) },
      { ...homeCashRange(TODAY), booksStartDate: '2026-10-12' },
    )
    expect(trend).toEqual({
      kind: 'too_new',
      nowCents: p(900_000),
      sentence: 'Llevás la cuenta desde el 12/10/2026: todavía no hay un mes para comparar.',
    })
    // Arrancaron antes: se compara normalmente.
    expect(
      balanceTrend(
        { openingCents: p(1), closingCents: p(2) },
        { ...homeCashRange(TODAY), booksStartDate: '2026-09-01' },
      ).kind,
    ).toBe('compared')
  })

  it('el saldo día por día arrastra el anterior y no dibuja antes del arranque', () => {
    const account = {
      treasuryId: null,
      name: '',
      kind: null,
      active: true,
      openingCents: p(100),
      closingCents: p(150),
      days: [{ day: '2026-10-12', inCents: p(80), outCents: p(30), balanceCents: p(150) }],
    }
    expect(balancePoints(account, { from: '2026-10-10', to: TODAY })).toEqual([
      { date: '2026-10-10', cents: p(100) },
      { date: '2026-10-11', cents: p(100) },
      { date: '2026-10-12', cents: p(150) },
      { date: '2026-10-13', cents: p(150) },
    ])
    expect(
      balancePoints(account, { from: '2026-10-10', to: TODAY, booksStartDate: '2026-10-12' }).map(
        (pt) => pt.date,
      ),
    ).toEqual(['2026-10-12', '2026-10-13'])
    expect(
      balancePoints(account, { from: '2026-10-10', to: TODAY, booksStartDate: '2026-11-01' }),
    ).toEqual([])
  })
})

// ─── 4. Entró y salió ────────────────────────────────────────────────────────

describe('entró y salió por semana', () => {
  it('sin nada cargado no hay semanas', () => {
    expect(weekBuckets([])).toEqual([])
    expect(inOutSummary([])).toEqual({
      inCents: 0,
      outCents: 0,
      hasMovements: false,
      sentence: 'Todavía no entró ni salió plata de las cajas.',
      note: null,
    })
  })

  it('un solo día es una semana de un día', () => {
    expect(weekBuckets([{ day: TODAY, inCents: p(10), outCents: p(4) }])).toEqual([
      {
        key: '2026-10-12',
        from: TODAY,
        to: TODAY,
        label: '13/10',
        shortLabel: '13/10',
        inCents: p(10),
        outCents: p(4),
        partial: true,
        openingSkipped: false,
      },
    ])
  })

  it('los últimos 30 días: cinco semanas de lunes a domingo, también las que no se movieron', () => {
    const buckets = weekBuckets(
      [
        { day: '2026-09-14', inCents: p(100), outCents: 0 },
        { day: '2026-09-20', inCents: p(50), outCents: p(20) },
        { day: '2026-10-01', inCents: p(7), outCents: p(3) },
        { day: '2026-10-13', inCents: 0, outCents: p(9) },
        // Fuera del período: no cuenta.
        { day: '2026-09-13', inCents: p(999), outCents: p(999) },
      ],
      homeCashRange(TODAY),
    )
    expect(buckets.map((b) => [b.key, b.label, b.inCents, b.outCents, b.partial])).toEqual([
      ['2026-09-14', '14 al 20/09', p(150), p(20), false],
      ['2026-09-21', '21 al 27/09', 0, 0, false],
      ['2026-09-28', '28/09 al 04/10', p(7), p(3), false],
      ['2026-10-05', '05 al 11/10', 0, 0, false],
      ['2026-10-12', '12 al 13/10', 0, p(9), true],
    ])
    // Para el eje, la misma semana en corto: sin «al» y sin ceros adelante.
    expect(buckets.map((b) => b.shortLabel)).toEqual([
      '14–20/9',
      '21–27/9',
      '28/9–4/10',
      '5–11/10',
      '12–13/10',
    ])
    expect(inOutSummary(buckets)).toMatchObject({
      inCents: p(157),
      outCents: p(32),
      hasMovements: true,
      sentence: `Entró $${NB}157 y salió $${NB}32.`,
      note: null,
    })
  })

  it('el saldo inicial no es plata que entró: el día del arranque queda afuera y se avisa', () => {
    const buckets = weekBuckets(
      [
        { day: '2026-10-12', inCents: p(4_300_000), outCents: 0 },
        { day: '2026-10-13', inCents: p(200_000), outCents: p(50_000) },
      ],
      { ...homeCashRange(TODAY), booksStartDate: '2026-10-12' },
    )
    const last = buckets.at(-1)
    expect(last).toMatchObject({ inCents: p(200_000), outCents: p(50_000), openingSkipped: true })
    const total = inOutSummary(buckets)
    expect(total.inCents).toBe(p(200_000))
    expect(total.note).toMatch(/no es plata que entró/)
  })
})

// ─── 3. Lo que tenés que pagar ───────────────────────────────────────────────

describe('la deuda en tres tramos', () => {
  it('sin el dato no se inventa un cero', () => {
    expect(payablesTranches(null)).toBeNull()
  })

  it('vencido, esta semana y lo que queda para más adelante', () => {
    const t = payablesTranches({
      totalCents: p(1_000),
      overdueCents: p(600),
      dueWeekCents: p(150),
      partiesRed: 3,
    })
    expect(t?.tranches).toEqual([
      { key: 'overdue', label: 'Vencido', cents: p(600), percent: 60 },
      { key: 'week', label: 'Vence esta semana', cents: p(150), percent: 15 },
      { key: 'later', label: 'Más adelante', cents: p(250), percent: 25 },
    ])
    expect(t).toMatchObject({ totalCents: p(1_000), partiesRed: 3, isEmpty: false })
    // El título afirma sin importe (el número del bloque es el total); lo vencido va en la oración.
    expect(t?.title).toBe('Tenés pagos vencidos con 3 proveedores')
    expect(t?.sentence).toBe(`$${NB}600 ya venció.`)
  })

  it('los títulos afirman, sin repetir un importe al lado del total', () => {
    const of = (overdueCents: number, dueWeekCents: number, totalCents: number, partiesRed = 0) =>
      payablesTranches({ totalCents, overdueCents, dueWeekCents, partiesRed })
    expect(of(p(50), 0, p(100), 1)).toMatchObject({
      title: 'Tenés pagos vencidos con 1 proveedor',
      sentence: `$${NB}50 ya venció.`,
    })
    // Sin saber con cuántos proveedores, no se inventa la cantidad.
    expect(of(p(50), 0, p(100))?.title).toBe('Tenés pagos vencidos')
    expect(of(p(100), 0, p(100), 2)?.sentence).toBe('Ya venció todo.')
    expect(of(0, p(80), p(100))).toMatchObject({
      title: 'Tenés pagos que vencen esta semana',
      sentence: `$${NB}80 vence esta semana.`,
    })
    expect(of(0, 0, p(100))).toMatchObject({ title: 'Nada vence esta semana', sentence: null })
    expect(of(0, 0, 0)).toMatchObject({ title: 'No le debés nada a nadie', sentence: null })
    // Ningún título lleva plata: dos importes de siete cifras juntos no se leen.
    for (const t of [of(p(50), 0, p(100), 1), of(0, p(80), p(100)), of(0, 0, p(100))]) {
      expect(t?.title).not.toContain('$')
    }
  })

  it('en cero: tres tramos vacíos; si los tramos no cierran, no pasan del total', () => {
    const empty = payablesTranches({
      totalCents: 0,
      overdueCents: 0,
      dueWeekCents: 0,
      partiesRed: 0,
    })
    expect(empty?.isEmpty).toBe(true)
    expect(empty?.tranches.map((t) => [t.cents, t.percent])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    const odd = payablesTranches({
      totalCents: p(100),
      overdueCents: p(90),
      dueWeekCents: p(40),
      partiesRed: 1,
    })
    expect(odd?.tranches.map((t) => t.cents)).toEqual([p(90), p(10), 0])
  })

  it('sin saldos iniciales, un cero no es «no le debés nada»: todavía no se sabe', () => {
    const zero = { totalCents: 0, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 }
    const unknown = payablesTranches(zero, { openingPending: true })
    expect(unknown).toMatchObject({
      unknown: true,
      isEmpty: true,
      title: 'Todavía no sé cuánto debés',
      sentence: 'Lo que ya les debías a tus proveedores entra con los saldos iniciales.',
      note: null,
    })
    // Con los saldos iniciales cargados (o salteados), el cero es un dato.
    expect(payablesTranches(zero)).toMatchObject({
      unknown: false,
      title: 'No le debés nada a nadie',
      note: null,
    })
    // Con algo cargado se muestra, y se avisa que falta lo de antes de arrancar.
    const partial = payablesTranches(
      { totalCents: p(192_358), overdueCents: p(192_358), dueWeekCents: 0, partiesRed: 2 },
      { openingPending: true },
    )
    expect(partial).toMatchObject({
      unknown: false,
      title: 'Tenés pagos vencidos con 2 proveedores',
      sentence: 'Ya venció todo.',
      note: 'Es lo que cargaste hasta ahora: lo que debías de antes entra con los saldos iniciales.',
    })
    // Un solo libro: nada sugiere que lo de antes queda afuera.
    expect(`${unknown?.sentence} ${partial?.note}`).not.toMatch(/en negro|en blanco|afuera/i)
  })

  it('los avisos de pagar van a su panel; el resto, a «Avisos»', () => {
    const list = [
      attention('payable_overdue', { label: 'A' }),
      attention('payable_overdue', { label: 'B' }),
      attention('payable_due_week', { label: 'C' }),
      attention('missing_daily_close'),
      attention('treasury_unchecked', { label: 'Caja' }),
    ]
    expect(payableAttention(list, 2)).toEqual({ rows: [list[0], list[1]], more: 1 })
    expect(payableAttention(list).more).toBe(0)
    // La base manda los avisos topeados: con 9 proveedores con algo vencido y 2 renglones
    // a la vista, quedan 7 (y no el 1 que se alcanza a contar en la lista).
    expect(payableAttention(list, 2, 9).more).toBe(7)
    // Si la lista ya trae más de los que dice la cuenta de vencidos, gana la lista.
    expect(payableAttention(list, 1, 2).more).toBe(2)
    expect(payableAttention(list, 2, 2).more).toBe(1)
    expect(noticeAttention(list).map((a) => a.kind)).toEqual([
      'missing_daily_close',
      'treasury_unchecked',
    ])
  })
})

describe('gastos fijos del mes', () => {
  it('sin gastos fijos', () => {
    expect(fixedProgress([], null, TODAY)).toMatchObject({
      state: 'empty',
      totalCents: 0,
      paidPercent: null,
      sentence: 'Todavía no cargaste gastos fijos.',
    })
  })

  it('31 sin monto que vencen el mes que viene: no es «$ 0», pide los montos', () => {
    // El bar real el 13/10: ninguno vence en octubre y ninguno tiene monto.
    const rows = Array.from({ length: 31 }, (_, i) =>
      fixedRow({
        id: `g${i}`,
        amountCents: null,
        monthStatus: 'upcoming',
        nextDueDate: '2026-11-10',
        daysToDue: 28,
      }),
    )
    const progress = fixedProgress(rows, null, TODAY)
    expect(progress).toMatchObject({
      state: 'no_amounts',
      missingAmount: 31,
      noAmountDue: 0,
      countedRows: 0,
      remainingCents: 0,
      paidPercent: null,
      sentence: '31 gastos fijos sin monto: completalos para saber cuánto te falta.',
    })
    expect(fixedProgress(rows.slice(0, 1), null, TODAY).sentence).toBe(
      '1 gasto fijo sin monto: completalo para saber cuánto te falta.',
    )
  })

  it('el bar de ejemplo: tres por pagar, dos vencidos, los mismos totales que la pestaña', () => {
    const progress = fixedProgress(DEMO_FIXED, null, TODAY)
    const totals = recurringTotals(DEMO_FIXED.map((r) => recurringLine(r, null, TODAY)))
    expect(progress).toMatchObject({
      state: 'progress',
      paidCents: totals.paidCents,
      remainingCents: totals.remainingCents,
      overdueCents: totals.overdueCents,
      countedRows: 3,
      pendingRows: 3,
      overdueRows: 2,
      paidPercent: 0,
    })
    expect(progress.remainingCents).toBe(p(915_000))
    expect(progress.overdueCents).toBe(p(880_000))
    // El importe ya lo dice el rótulo («Te falta de gasto fijo»): la oración no lo repite.
    expect(progress.sentence).toBe('Pagaste 0 de 3 este mes.')
  })

  it('con lo pagado: uno pago, uno a medias; «hoy» sale de las filas si no se pasa', () => {
    const rows = [
      fixedRow({
        id: 'a',
        monthStatus: 'loaded',
        loadedDue: '2026-10-10',
        nextDueDate: '2026-11-10',
        daysToDue: 28,
      }),
      fixedRow({
        id: 'b',
        amountCents: p(100_000),
        monthStatus: 'loaded',
        loadedDue: '2026-10-20',
        nextDueDate: '2026-11-20',
        daysToDue: 38,
      }),
      fixedRow({ id: 'c', amountCents: p(50_000), nextDueDate: '2026-10-25', daysToDue: 12 }),
    ]
    const doc = (id: string, dueDate: string, totalCents: number, paidCents: number) => ({
      document: {
        id,
        kind: 'purchase',
        accountingDate: '2026-10-05',
        dueDate,
        totalCents,
        paidCents,
        openCents: totalCents - paidCents,
      },
      priorOpenCents: 0,
    })
    const payments = new Map<string, RecurringPaymentFacts>([
      ['a', doc('d1', '2026-10-10', p(850_000), p(850_000))],
      ['b', doc('d2', '2026-10-20', p(100_000), p(40_000))],
    ])
    const progress = fixedProgress(rows, payments)
    expect(progress).toMatchObject({
      state: 'progress',
      paidCents: p(890_000),
      remainingCents: p(110_000),
      totalCents: p(1_000_000),
      paidPercent: 89,
      pendingRows: 2,
      overdueRows: 0,
    })
    expect(progress.sentence).toBe(`Pagaste $${NB}890.000 de $${NB}1.000.000: faltan 2.`)
    // Lo mismo si lo pagado llega como objeto plano.
    expect(fixedProgress(rows, Object.fromEntries(payments)).paidCents).toBe(p(890_000))
  })

  it('todo pago, y un mes en el que no vence ninguno', () => {
    const paid = fixedRow({
      monthStatus: 'loaded',
      loadedDue: '2026-10-10',
      nextDueDate: '2026-11-10',
      daysToDue: 28,
    })
    const payments = {
      alquiler: {
        document: {
          id: 'd',
          kind: 'expense',
          accountingDate: '2026-10-09',
          dueDate: null,
          totalCents: p(850_000),
          paidCents: p(850_000),
          openCents: 0,
        },
        priorOpenCents: 0,
      },
    }
    expect(fixedProgress([paid], payments, TODAY).sentence).toBe(
      `Pagaste los $${NB}850.000 de gastos fijos de este mes.`,
    )
    const later = fixedRow({ monthStatus: 'upcoming', nextDueDate: '2026-11-10', daysToDue: 28 })
    expect(fixedProgress([later], null, TODAY)).toMatchObject({
      state: 'nothing_due',
      sentence: 'Este mes no vence ningún gasto fijo.',
    })
    expect(fixedProgress([fixedRow({ active: false })], null, TODAY)).toMatchObject({
      state: 'empty',
      sentence: 'No hay gastos fijos activos.',
    })
  })
})

// ─── 3. El mes contra el objetivo ────────────────────────────────────────────

describe('el mes contra el objetivo', () => {
  const figure = (over: Partial<ProjectionSummary>): ProjectionSummary => ({
    monthState: 'current',
    hasTargets: true,
    soldCents: p(7_592_582),
    monthTargetCents: p(14_000_000),
    throughDay: '2026-10-12',
    targetToDateCents: p(5_000_000),
    pace: null,
    remainingCents: p(14_000_000 - 7_592_582),
    surplusCents: 0,
    monthPercent: 54,
    ...over,
  })

  it('con objetivos, el título afirma cuánto va y qué parte es', () => {
    expect(monthTitle(figure({}), 'octubre')).toBe(
      `Vas en $${NB}7,6${NB}M: el 54 % del objetivo de octubre`,
    )
  })

  it('sin objetivos, la variante «Vas vendiendo»', () => {
    expect(
      monthTitle(
        figure({ hasTargets: false, monthTargetCents: 0, remainingCents: 0, monthPercent: null }),
        'octubre',
      ),
    ).toBe(`Vas vendiendo $${NB}7.592.582 en octubre`)
  })

  it('sin ventas, objetivo cumplido, mes terminado y mes que no empezó', () => {
    expect(monthTitle(figure({ soldCents: 0 }), 'octubre')).toBe(
      'Todavía no hay ventas cargadas en octubre',
    )
    expect(
      monthTitle(
        figure({ remainingCents: 0, surplusCents: p(250_000), monthPercent: 102 }),
        'octubre',
      ),
    ).toBe(`Ya pasaste el objetivo de octubre por $${NB}250.000`)
    expect(
      monthTitle(figure({ remainingCents: 0, surplusCents: 0, monthPercent: 100 }), 'octubre'),
    ).toBe('Llegaste justo al objetivo de octubre')
    expect(monthTitle(figure({ monthState: 'past' }), 'septiembre')).toBe(
      `Vendiste $${NB}7,6${NB}M: el 54 % del objetivo de septiembre`,
    )
    expect(monthTitle(figure({ monthState: 'past', hasTargets: false }), 'septiembre')).toBe(
      `Vendiste $${NB}7.592.582 en septiembre`,
    )
    expect(monthTitle(figure({ monthState: 'future', soldCents: 0 }), 'noviembre')).toBe(
      'Noviembre todavía no empezó',
    )
  })

  it('lo que falta y el ritmo por día que queda', () => {
    // 12 días cargados a $ 500.000 contra $ 400.000 por día de objetivo; hoy (13) sin cierre.
    const projection = monthProjection({
      closedThrough: 12,
      soldPerDay: 500_000,
      targetPerDay: 400_000,
    })
    expect(monthPace(projection)).toEqual({
      remainingCents: p(6_400_000),
      daysLeft: 19,
      perDayCents: Math.ceil(p(6_400_000) / 19),
      loadedDays: 12,
      averageCents: p(500_000),
    })
    expect(monthTitle(projection.summary, 'octubre')).toBe(
      `Vas en $${NB}6${NB}M: el 48 % del objetivo de octubre`,
    )
    expect(monthSentence(projection)).toBe(
      `Para llegar faltan $${NB}6.400.000: unos $${NB}337.000 por día en los 19 días que quedan.`,
    )
  })

  it('sin objetivos: el promedio de los días cargados; sin cierres, el paso siguiente', () => {
    const projection = monthProjection({ closedThrough: 6, soldPerDay: 1_265_430 })
    expect(monthPace(projection)).toMatchObject({
      remainingCents: 0,
      perDayCents: null,
      loadedDays: 6,
    })
    expect(monthSentence(projection)).toBe(`En 6 días con cierre: unos $${NB}1.265.000 por día.`)
    expect(monthSentence(monthProjection({ closedThrough: 0 }))).toBe(
      'Cargá el cierre de ayer para empezar a ver cómo viene el mes.',
    )
    expect(
      monthSentence(
        monthProjection({ closedThrough: 1, serviceDay: '2026-10-02', soldPerDay: 900 }),
      ),
    ).toBe(`En 1 día con cierre: unos $${NB}900 por día.`)
  })

  it('un solo día por delante, objetivo pasado, mes terminado y mes que no empezó', () => {
    const lastDay = monthProjection({
      closedThrough: 30,
      soldPerDay: 100_000,
      targetPerDay: 200_000,
      serviceDay: '2026-10-31',
    })
    expect(monthSentence(lastDay)).toBe(`Para llegar faltan $${NB}3.200.000 y queda 1 día.`)

    const over = monthProjection({
      closedThrough: 12,
      soldPerDay: 2_000_000,
      targetPerDay: 400_000,
    })
    expect(monthSentence(over)).toBe(`El objetivo del mes es $${NB}12.400.000.`)

    const past = monthProjection({
      month: '2026-09',
      closedThrough: 30,
      soldPerDay: 100_000,
      targetPerDay: 200_000,
    })
    expect(past.summary.monthState).toBe('past')
    expect(monthSentence(past)).toBe(`Faltaron $${NB}3.000.000 para llegar al objetivo.`)

    const future = monthProjection({ month: '2026-11', closedThrough: 0, targetPerDay: 100_000 })
    expect(monthSentence(future)).toBe(`El objetivo del mes es $${NB}3.000.000.`)
    expect(monthSentence(monthProjection({ month: '2026-11', closedThrough: 0 }))).toBe(
      'Todavía no tiene objetivos cargados.',
    )
  })

  it('ningún texto del mes habla de ganancia', () => {
    const cases = [
      monthProjection({ closedThrough: 12, soldPerDay: 500_000, targetPerDay: 400_000 }),
      monthProjection({ closedThrough: 6 }),
      monthProjection({ closedThrough: 0 }),
      monthProjection({ closedThrough: 12, soldPerDay: 2_000_000, targetPerDay: 400_000 }),
      monthProjection({ month: '2026-09', closedThrough: 30, targetPerDay: 50_000 }),
    ]
    for (const projection of cases) {
      const text = `${monthTitle(projection.summary, 'octubre')} ${monthSentence(projection)}`
      expect(text).not.toMatch(/gananc|ganaste/i)
    }
  })
})

describe('el mes día por día', () => {
  it('cargado, falta, hoy y lo que viene; un día sin cierre no es un cero', () => {
    const view = monthDays(monthProjection({ closedThrough: 6, soldPerDay: 100, targetPerDay: 80 }))
    expect(view.days).toHaveLength(31)
    expect(view.days.map((d) => d.state).slice(0, 14)).toEqual([
      ...Array.from({ length: 6 }, () => 'loaded'),
      ...Array.from({ length: 6 }, () => 'missing'),
      'today',
      'future',
    ])
    expect(view).toMatchObject({
      todayIndex: 12,
      loaded: 6,
      missing: 6,
      firstMissing: '2026-10-07',
      sentence: 'Faltan 6 cierres',
    })
    expect(view.days[0]).toEqual({
      date: '2026-10-01',
      dayNumber: 1,
      weekday: 'jue',
      state: 'loaded',
      isToday: false,
      cents: p(100),
      targetCents: p(80),
      soldAccumCents: p(100),
      targetAccumCents: p(80),
      path: null,
    })
    // El 7 falta: sin importe, y la línea de lo vendido ya se cortó en el 6.
    expect(view.days[6]).toMatchObject({
      state: 'missing',
      cents: null,
      soldAccumCents: null,
      targetAccumCents: p(560),
      path: '/ventas/cierre?fecha=2026-10-07',
    })
    expect(view.days[5]?.soldAccumCents).toBe(p(600))
    expect(view.days[12]).toMatchObject({
      state: 'today',
      isToday: true,
      path: '/ventas/cierre?fecha=2026-10-13',
    })
    expect(view.days[13]).toMatchObject({ state: 'future', cents: null, path: null })
  })

  it('un hueco en el medio no corta la línea: sigue hasta el último día cargado', () => {
    const rows = eachIsoDay('2026-10-01', '2026-10-31').map((day) =>
      sourceDay(
        day,
        ['2026-10-01', '2026-10-03'].includes(day) ? { closes: 1, salonCents: p(10) } : {},
      ),
    )
    const view = monthDays(buildProjection(rows, { serviceDay: '2026-10-05' }))
    expect(view.days.slice(0, 5).map((d) => [d.state, d.soldAccumCents])).toEqual([
      ['loaded', p(10)],
      ['missing', p(10)],
      ['loaded', p(20)],
      ['missing', null],
      ['today', null],
    ])
    // Sin objetivos no hay línea de objetivo.
    expect(view.days.every((d) => d.targetAccumCents === null && d.targetCents === null)).toBe(true)
    expect(view.sentence).toBe('Faltan 2 cierres')
  })

  it('antes del arranque de los libros no falta nada; hoy con cierre queda cargado', () => {
    const rows = eachIsoDay('2026-10-01', '2026-10-31').map((day) =>
      sourceDay(day, day === '2026-10-12' || day === TODAY ? { closes: 1, salonCents: p(5) } : {}),
    )
    const view = monthDays(buildProjection(rows, { serviceDay: TODAY }), {
      booksStartDate: '2026-10-12',
    })
    expect(view.days.slice(9, 13).map((d) => d.state)).toEqual([
      'before',
      'before',
      'loaded',
      'loaded',
    ])
    expect(view.days[12]).toMatchObject({ state: 'loaded', isToday: true, path: null })
    expect(view).toMatchObject({
      missing: 0,
      firstMissing: null,
      sentence: 'Están todos los cierres cargados',
    })
  })

  it('mes sin nada cargado, mes pasado y un solo cierre que falta', () => {
    expect(
      monthDays(monthProjection({ closedThrough: 0, serviceDay: '2026-10-01' })),
    ).toMatchObject({
      loaded: 0,
      missing: 0,
      todayIndex: 0,
      sentence: 'Todavía no hay cierres este mes',
    })
    expect(monthDays(monthProjection({ month: '2026-09', closedThrough: 30 })).todayIndex).toBe(-1)
    expect(monthDays(monthProjection({ closedThrough: 11 })).sentence).toBe('Falta 1 cierre')
  })
})

describe('la franja del IVA', () => {
  const month = { month: '2026-10-01', toPayCents: 0, inFavorCents: 0, provisional: true }

  it('a pagar, a favor o nada, siempre rotulado como estimado mientras el mes está abierto', () => {
    expect(ivaStrip({ ...month, toPayCents: p(86_000) }, { registered: true })).toEqual({
      kind: 'to_pay',
      amountCents: p(86_000),
      sentence: `IVA de octubre: a pagar $${NB}86.000`,
      note: 'Estimado: lo confirma la contadora.',
      provisional: true,
    })
    expect(ivaStrip({ ...month, inFavorCents: p(12_000) }, { registered: true })).toMatchObject({
      kind: 'in_favor',
      sentence: `IVA de octubre: a favor $${NB}12.000`,
    })
    expect(ivaStrip({ ...month, provisional: false }, { registered: true })).toMatchObject({
      kind: 'zero',
      amountCents: 0,
      sentence: 'IVA de octubre: no hay nada que pagar',
      note: 'Mes cerrado.',
    })
  })

  it('sin el dato no es cero; si la SAS no liquida IVA, lo dice', () => {
    expect(ivaStrip(null, { registered: true })).toEqual({
      kind: 'unavailable',
      sentence: 'El IVA del mes todavía no está disponible.',
    })
    expect(ivaStrip(null, { registered: false })).toEqual({
      kind: 'not_registered',
      sentence: 'La SAS no liquida IVA (no es responsable inscripta).',
    })
  })
})

// ─── 2. Hoy te toca ──────────────────────────────────────────────────────────

describe('hoy te toca', () => {
  /** El bar de ejemplo el 13/10: cierres hasta el 06/10, deuda vencida y gastos fijos por vencer. */
  const demo = (over: Partial<TodayInput> = {}) =>
    today({
      summary: summary({
        treasuries: [
          treasury('caja', 'cash', p(100)),
          treasury('mp', 'wallet', p(100)),
          treasury('banco', 'bank', p(100)),
        ],
        payables: {
          totalCents: p(6_960_000),
          overdueCents: p(6_040_000),
          dueWeekCents: 0,
          partiesRed: 9,
        },
        // La base corta en 8: los proveedores vencidos taparon el aviso de los cierres.
        attention: Array.from({ length: 8 }, (_, i) =>
          attention('payable_overdue', { label: `Proveedor ${i}`, partyId: `party-${i}` }),
        ),
      }),
      projection: monthProjection({ closedThrough: 6 }),
      recurring: DEMO_FIXED,
      ...over,
    })

  it('el bar de ejemplo: cierre, gasto, lo que vence y los gastos fijos, en ese orden', () => {
    const items = buildToday(demo())
    expect(items.map((i) => i.id)).toEqual(['daily_close', 'expense', 'payables', 'fixed'])

    expect(items[0]).toEqual({
      id: 'daily_close',
      title: 'Los cierres del día',
      status: 'Faltan 6: empezá por el 07/10.',
      tone: 'warn',
      done: false,
      action: {
        kind: 'href',
        href: `${BASE}/ventas/cierre?fecha=2026-10-07`,
        label: 'Cargar el del miércoles 07/10',
      },
      covers: ['missing_daily_close'],
    })
    expect(items[1]).toMatchObject({
      title: '¿Compraste o pagaste algo hoy?',
      done: false,
      action: { kind: 'sheet', sheet: 'gasto', params: {}, label: 'Cargar un gasto' },
    })
    expect(items[2]).toMatchObject({
      title: 'Pagos que vencen',
      status: `$${NB}6.040.000 vencido con 9 proveedores.`,
      tone: 'late',
      // Varios proveedores: la hoja se abre sin ninguno elegido.
      action: { kind: 'sheet', sheet: 'pagar', params: {}, label: 'Pagar' },
      covers: ['payable_overdue', 'payable_due_week'],
    })
    expect(items[3]).toMatchObject({
      title: 'Gastos fijos',
      status: `2 vencidos y 1 por vencer · aprox. $${NB}915.000`,
      tone: 'late',
      action: { kind: 'href', href: `${BASE}/gastos-fijos`, label: 'Ver gastos fijos' },
      covers: ['recurring_due'],
    })
  })

  it('nunca más de cinco: lo que no entra queda para «Avisos»', () => {
    const integration: IntegrationAttentionItem[] = [
      {
        kind: 'import_review',
        tone: 'warning',
        label: 'Mercado Pago para revisar y cargar.',
        href: '/importar/lote-1',
        actionLabel: 'Revisar',
        count: 1,
        date: null,
      },
      {
        kind: 'mc_prev_month',
        tone: 'info',
        label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
        href: '/importar/arca',
        actionLabel: 'Subir las compras de ARCA',
        count: null,
        date: null,
      },
    ]
    const items = buildToday(demo({ integration }))
    expect(items.map((i) => i.id)).toEqual([
      'daily_close',
      'expense',
      'payables',
      'fixed',
      'import_review',
    ])
    expect(items[4]).toMatchObject({
      status: 'Mercado Pago para revisar y cargar.',
      action: { kind: 'href', href: `${BASE}/importar/lote-1`, label: 'Revisar' },
    })
  })

  it('la contadora ve el estado, sin la invitación a cargar y sin ninguna acción', () => {
    const items = buildToday(demo({ canWrite: false }))
    expect(items.map((i) => i.id)).toEqual(['daily_close', 'payables', 'fixed'])
    expect(items.every((i) => i.action === null)).toBe(true)
  })

  it('ayer cargado: hecho, con lo que se vendió', () => {
    const items = buildToday(today({ projection: monthProjection({ closedThrough: 12 }) }))
    expect(items[0]).toMatchObject({
      id: 'daily_close',
      title: 'El cierre de ayer',
      status: `Cargado · $${NB}1.000.000`,
      tone: 'ok',
      done: true,
      action: null,
    })
  })

  it('falta solo el de ayer: lo nombra con el día', () => {
    const items = buildToday(today({ projection: monthProjection({ closedThrough: 11 }) }))
    expect(items[0]).toMatchObject({
      title: 'El cierre de ayer',
      status: 'Falta el del lunes 12/10.',
      tone: 'warn',
      action: {
        kind: 'href',
        href: `${BASE}/ventas/cierre?fecha=2026-10-12`,
        label: 'Cargar el cierre del lunes 12/10',
      },
    })
  })

  it('antes de las 5:00 «ayer» es el día de servicio anterior', () => {
    // Son las 2 de la mañana del 13: el día de servicio sigue siendo el 12 y ayer es el 11.
    const projection = monthProjection({ closedThrough: 11, serviceDay: '2026-10-12' })
    expect(buildToday(today({ projection }))[0]).toMatchObject({
      done: true,
      status: `Cargado · ${money(1_000_000)}`,
    })
    // Sin la proyección, el día de servicio se puede pasar a mano.
    const calendarless = buildToday(today({ serviceDay: '2026-10-12', summary: null }))[0]
    expect(calendarless?.action).toMatchObject({ href: `${BASE}/ventas/cierre?fecha=2026-10-11` })
  })

  it('bar recién configurado, sin ningún cierre: invita a empezar por el de ayer, no reclama el mes', () => {
    const input = today({
      summary: summary({
        firstSteps: {
          firstExpense: true,
          firstDailyClose: false,
          accountantAdded: false,
          partnerGranted: true,
        },
      }),
      settings: { booksStartDate: '2026-09-01' },
      projection: monthProjection({ closedThrough: 0 }),
    })
    expect(buildToday(input)[0]).toMatchObject({
      title: 'El cierre de ayer',
      status: 'Todavía no cargaste ninguno: empezá por el de ayer.',
      tone: 'warn',
      done: false,
      action: {
        href: `${BASE}/ventas/cierre?fecha=2026-10-12`,
        label: 'Cargar el cierre del lunes 12/10',
      },
    })
  })

  it('los libros arrancan hoy: todavía no hay cierre que cargar', () => {
    const input = today({
      summary: summary({
        firstSteps: {
          firstExpense: false,
          firstDailyClose: false,
          accountantAdded: false,
          partnerGranted: false,
        },
      }),
      settings: { booksStartDate: TODAY },
      projection: monthProjection({ closedThrough: 0 }),
    })
    const items = buildToday(input)
    expect(items[0]).toMatchObject({
      title: 'El cierre del día',
      status: 'Hoy es el primer día: el cierre de hoy se carga mañana.',
      tone: 'info',
      done: false,
      action: null,
    })
    expect(byId(items, 'expense')?.status).toBe(
      'Todavía no cargaste ningún gasto: empezá por el de hoy.',
    )
  })

  it('los días anteriores al arranque de los libros no faltan', () => {
    // Arrancó el 10/10 y cargó el 10, el 11 y el 12: del 1 al 9 no hay nada que reclamar.
    const rows = eachIsoDay('2026-10-01', '2026-10-31').map((day) =>
      sourceDay(
        day,
        ['2026-10-10', '2026-10-11', '2026-10-12'].includes(day)
          ? { closes: 1, salonCents: p(10) }
          : {},
      ),
    )
    const projection = buildProjection(rows, { serviceDay: TODAY })
    expect(
      buildToday(today({ projection, settings: { booksStartDate: '2026-10-10' } }))[0],
    ).toMatchObject({
      done: true,
      status: `Cargado · $${NB}10`,
    })
  })

  it('el 1 del mes: los que faltan salen del aviso de la base', () => {
    const november = monthProjection({
      month: '2026-11',
      closedThrough: 0,
      serviceDay: '2026-11-01',
    })
    const missing = buildToday(
      today({
        today: '2026-11-01',
        projection: november,
        summary: summary({
          attention: [attention('missing_daily_close', { date: '2026-10-30', count: 2 })],
        }),
      }),
    )[0]
    expect(missing).toMatchObject({
      status: 'Faltan 2: empezá por el 30/10.',
      action: {
        href: `${BASE}/ventas/cierre?fecha=2026-10-30`,
        label: 'Cargar el del viernes 30/10',
      },
    })
    // Sin aviso y con la lista de la base completa: está al día.
    expect(buildToday(today({ today: '2026-11-01', projection: november }))[0]).toMatchObject({
      status: 'Al día: no falta ninguno.',
      done: true,
    })
  })

  it('con el calendario de cierres manda el calendario (mira 30 días atrás)', () => {
    const closeCalendar = {
      serviceDay: TODAY,
      booksStartDate: '2026-09-01',
      firstMissingDate: '2026-09-29',
      days: [
        { date: '2026-10-11', status: 'loaded' as const, closes: [], totalCents: p(700) },
        { date: '2026-10-12', status: 'missing' as const, closes: [], totalCents: null },
        { date: '2026-10-13', status: 'pending' as const, closes: [], totalCents: null },
      ],
    }
    // El primero que falta es del mes pasado: se sabe que faltan, no cuántos.
    expect(buildToday(today({ closeCalendar }))[0]).toMatchObject({
      title: 'Los cierres del día',
      status: 'Faltan cierres: empezá por el 29/09.',
      action: {
        href: `${BASE}/ventas/cierre?fecha=2026-09-29`,
        label: 'Cargar el del martes 29/09',
      },
    })
    // Si la base dijo cuántos, se dice el número.
    const counted = summary({
      attention: [attention('missing_daily_close', { date: '2026-09-29', count: 4 })],
    })
    expect(buildToday(today({ closeCalendar, summary: counted }))[0]?.status).toBe(
      'Faltan 4: empezá por el 29/09.',
    )
    // Dentro del mes, el calendario alcanza para contarlos.
    const thisMonth = { ...closeCalendar, firstMissingDate: '2026-10-12' }
    expect(buildToday(today({ closeCalendar: thisMonth }))[0]).toMatchObject({
      title: 'El cierre de ayer',
      status: 'Falta el del lunes 12/10.',
    })
  })

  it('si no cargó nada de donde sale, ofrece cargarlo sin afirmar que falta', () => {
    const items = buildToday(today({ summary: null }))
    expect(items.map((i) => i.id)).toEqual(['daily_close', 'expense'])
    expect(items[0]).toMatchObject({
      status: 'Lo que se vendió y cómo te pagaron.',
      tone: 'muted',
      done: false,
      action: { href: `${BASE}/ventas/cierre?fecha=2026-10-12` },
    })
    // Sin `base`, los links salen relativos a la sección.
    expect(buildToday({ ...today({ summary: null }), base: undefined })[0]?.action).toMatchObject({
      href: '/ventas/cierre?fecha=2026-10-12',
    })
  })

  it('lo que vence: un solo proveedor abre la hoja con él; sin deuda queda hecho', () => {
    const one = buildToday(
      today({
        summary: summary({
          payables: {
            totalCents: p(900),
            overdueCents: p(300),
            dueWeekCents: p(200),
            partiesRed: 1,
          },
          attention: [
            attention('payable_overdue', { partyId: 'coca' }),
            attention('payable_due_week', { partyId: 'coca' }),
          ],
        }),
      }),
    )
    expect(byId(one, 'payables')).toMatchObject({
      status: `$${NB}300 vencido y $${NB}200 que vence esta semana.`,
      tone: 'late',
      action: { kind: 'sheet', sheet: 'pagar', params: { proveedor: 'coca' } },
    })

    const week = buildToday(
      today({
        summary: summary({
          payables: { totalCents: p(900), overdueCents: 0, dueWeekCents: p(200), partiesRed: 0 },
        }),
      }),
    )
    expect(byId(week, 'payables')).toMatchObject({
      status: `Esta semana vencen $${NB}200.`,
      tone: 'warn',
    })

    const calm = (totalCents: number) =>
      byId(
        buildToday(
          today({
            summary: summary({
              payables: { totalCents, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 },
            }),
          }),
        ),
        'payables',
      )
    expect(calm(p(500))).toMatchObject({
      done: true,
      tone: 'ok',
      status: 'Nada vencido ni por vencer esta semana.',
      action: null,
    })
    expect(calm(0)).toMatchObject({ done: true, status: 'No le debés nada a ningún proveedor.' })
    // Sin el dato de la deuda, la tarjeta no sale (no se inventa «nada que pagar»).
    expect(byId(buildToday(today()), 'payables')).toBeUndefined()
  })

  it('pagos que vencen, con los saldos iniciales sin cargar: el cero no se tilda como hecho', () => {
    const zero = summary({
      payables: { totalCents: 0, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 },
    })
    const pending = { booksStartDate: '2026-09-01', openingStatus: 'pending' as const }
    const card = byId(buildToday(today({ summary: zero, settings: pending })), 'payables')
    expect(card).toMatchObject({
      done: false,
      tone: 'muted',
      action: null,
      status: 'Todavía no cargaste lo que debés: entra con los saldos iniciales.',
      // Sigue cubriendo sus avisos: no se repiten en «Avisos».
      covers: ['payable_overdue', 'payable_due_week'],
    })
    // La contadora lo lee dicho para ella.
    expect(
      byId(buildToday(today({ summary: zero, settings: pending, canWrite: false })), 'payables')
        ?.status,
    ).toBe('Los dueños todavía no cargaron lo que se debía al empezar.')
    // Con los saldos iniciales cargados vuelve a ser un dato; y con deuda, manda la deuda.
    const posted = { booksStartDate: '2026-09-01', openingStatus: 'posted' as const }
    expect(byId(buildToday(today({ summary: zero, settings: posted })), 'payables')).toMatchObject({
      done: true,
      status: 'No le debés nada a ningún proveedor.',
    })
    const owing = summary({
      payables: { totalCents: p(500), overdueCents: p(500), dueWeekCents: 0, partiesRed: 1 },
    })
    expect(
      byId(buildToday(today({ summary: owing, settings: pending })), 'payables'),
    ).toMatchObject({ done: false, tone: 'late', action: { label: 'Pagar' } })
  })

  it('gastos fijos: solo los que están dentro de su aviso y todavía no se cargaron', () => {
    const one = byId(buildToday(today({ recurring: [DEMO_FIXED[2] as HomeRecurringRow] })), 'fixed')
    expect(one).toMatchObject({
      title: 'Gasto fijo: Sistema',
      status: `Vence el jueves 15/10 · aprox. $${NB}35.000`,
      tone: 'warn',
      // Uno solo: «Pagar» abre «Nuevo gasto» con ese gasto fijo puesto, sin salir del Resumen.
      action: {
        kind: 'sheet',
        sheet: 'gasto',
        params: { 'gasto-fijo': 'sistema' },
        label: 'Pagar',
      },
    })
    // Varios: cada uno tiene su «Pagar» en «Lo que tenés que pagar»; la tarjeta lleva a la planilla.
    expect(byId(buildToday(today({ recurring: DEMO_FIXED })), 'fixed')?.action).toEqual({
      kind: 'href',
      href: `${BASE}/gastos-fijos`,
      label: 'Ver gastos fijos',
    })
    // La contadora lee la tarjeta sin el botón.
    expect(
      byId(
        buildToday(today({ recurring: [DEMO_FIXED[2] as HomeRecurringRow], canWrite: false })),
        'fixed',
      )?.action,
    ).toBeNull()
    const overdue = byId(
      buildToday(today({ recurring: [fixedRow({ amountCents: null })] })),
      'fixed',
    )
    expect(overdue).toMatchObject({ status: 'Venció el 10/10 · sin monto', tone: 'late' })
    const dueToday = byId(
      buildToday(today({ recurring: [fixedRow({ nextDueDate: TODAY, daysToDue: 0 })] })),
      'fixed',
    )
    expect(dueToday?.status).toBe(`Vence hoy · aprox. $${NB}850.000`)

    const none = [
      // Vence en 20 días y avisa 5 antes: todavía no toca.
      fixedRow({ nextDueDate: '2026-11-02', daysToDue: 20, monthStatus: 'upcoming' }),
      // Ya cargado (es deuda con el proveedor: va en «Pagos que vencen»), salteado, pausado y terminado.
      fixedRow({ monthStatus: 'loaded' }),
      fixedRow({ monthStatus: 'skipped' }),
      fixedRow({ active: false }),
      fixedRow({ active: false, ended: true }),
    ]
    expect(byId(buildToday(today({ recurring: none })), 'fixed')).toBeUndefined()
    expect(byId(buildToday(today({ recurring: [] })), 'fixed')).toBeUndefined()
  })

  it('subir Mercado Pago y el banco toca los lunes, o cuando ya se venía subiendo', () => {
    const treasuries = [
      treasury('caja', 'cash', p(1)),
      treasury('mp', 'wallet', p(1)),
      treasury('banco', 'bank', p(1)),
    ]
    const withAccounts = summary({ treasuries })
    const monday = '2026-10-12'

    const onMonday = byId(
      buildToday(
        today({
          today: monday,
          summary: withAccounts,
          onboarding: onboarding({ today: monday }).state,
        }),
      ),
      'weekly_import',
    )
    expect(onMonday).toMatchObject({
      title: 'Subir Mercado Pago y el banco',
      tone: 'info',
      action: { kind: 'href', href: `${BASE}/importar`, label: 'Ir a Importar' },
    })
    // Un martes, sin haberlo usado nunca: no se pide.
    expect(
      byId(
        buildToday(today({ summary: withAccounts, onboarding: onboarding().state })),
        'weekly_import',
      ),
    ).toBeUndefined()
    // Un martes, con un reporte de hace más de una semana: sí.
    const stale = onboarding({
      imports: {
        mp_release: { lastBatchAt: '2026-09-28T12:00:00Z', postedBatches: 3, pendingReview: 0 },
      },
    })
    expect(
      byId(buildToday(today({ summary: withAccounts, onboarding: stale })), 'weekly_import'),
    ).toMatchObject({
      title: 'Subir el reporte de Mercado Pago',
      action: { href: `${BASE}/importar/mercado-pago`, label: 'Subir el archivo' },
    })
    // Sin banco cargado, un lunes solo se pide Mercado Pago.
    const noBank = summary({ treasuries: treasuries.slice(0, 2) })
    expect(
      byId(
        buildToday(
          today({ today: monday, summary: noBank, onboarding: onboarding({ today: monday }) }),
        ),
        'weekly_import',
      )?.title,
    ).toBe('Subir el reporte de Mercado Pago')
    // Subido esta semana: nada que hacer.
    const fresh = onboarding({
      today: monday,
      imports: {
        mp_release: { lastBatchAt: '2026-10-10T12:00:00Z', postedBatches: 1, pendingReview: 0 },
        bank_statement: { lastBatchAt: '2026-10-10T12:00:00Z', postedBatches: 1, pendingReview: 0 },
      },
    })
    expect(
      byId(
        buildToday(today({ today: monday, summary: withAccounts, onboarding: fresh })),
        'weekly_import',
      ),
    ).toBeUndefined()
  })

  it('las compras de ARCA y el cierre del mes, del 11 en adelante', () => {
    const state = onboarding().state
    const on13 = buildToday(today({ onboarding: state }))
    expect(byId(on13, 'arca_monthly')).toMatchObject({
      title: 'Bajar las compras de ARCA',
      status: 'Ya están casi todas las facturas de septiembre.',
      // El botón dice lo mismo que la pantalla que abre.
      action: { href: `${BASE}/importar/arca`, label: 'Subir las compras de ARCA' },
    })
    expect(byId(on13, 'month_close')).toMatchObject({
      title: 'Cerrar el mes pasado',
      status: 'Septiembre sigue abierto: revisalo con la contadora.',
      action: { href: `${BASE}/libros/cierres`, label: 'Revisar y cerrar' },
    })
    const on10 = buildToday(
      today({ today: '2026-10-10', onboarding: onboarding({ today: '2026-10-10' }).state }),
    )
    expect(byId(on10, 'arca_monthly')).toBeUndefined()
    expect(byId(on10, 'month_close')).toBeUndefined()

    // El aviso de la base manda: trae el mes y cuántos avisos tiene.
    const ready = buildToday(
      today({
        summary: summary({
          attention: [attention('month_ready', { label: 'Septiembre 2026', count: 2 })],
        }),
      }),
    )
    expect(byId(ready, 'month_close')).toMatchObject({
      title: 'Cerrar Septiembre 2026',
      status: 'Está listo para cerrar, con 2 avisos.',
      covers: ['month_ready'],
    })
    const noLabel = buildToday(
      today({
        summary: summary({
          attention: [attention('month_ready', { label: 'Hay un mes listo para cerrar.' })],
        }),
      }),
    )
    expect(byId(noLabel, 'month_close')).toMatchObject({
      title: 'Cerrar el mes',
      status: 'Está listo para cerrar.',
    })
  })

  it('con los libros arrancados este mes no pide bajar de ARCA las compras del mes pasado', () => {
    // El bar real el 13/10: libros desde el 12/10 y un lote de Mis Comprobantes ya subido,
    // así que la integración avisa «Bajá Mis Comprobantes de septiembre».
    const notice: IntegrationAttentionItem = {
      kind: 'mc_prev_month',
      tone: 'info',
      label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
      href: '/importar/arca',
      actionLabel: 'Subir las compras de ARCA',
      count: null,
      date: null,
    }
    const started = { booksStartDate: '2026-10-12' }
    // Ni por el aviso de la integración ni por la guía (del 11 en adelante).
    expect(
      byId(buildToday(today({ settings: started, integration: [notice] })), 'arca_monthly'),
    ).toBeUndefined()
    expect(
      byId(
        buildToday(today({ settings: started, onboarding: onboarding().state })),
        'arca_monthly',
      ),
    ).toBeUndefined()
    // Con los libros de antes, las dos puertas siguen ofreciéndolo.
    const older = { booksStartDate: '2026-09-15' }
    expect(
      byId(buildToday(today({ settings: older, integration: [notice] })), 'arca_monthly'),
    ).toMatchObject({ title: 'Bajar las compras de ARCA', covers: ['mc_prev_month'] })

    expect(previousMonthBeforeBooks('2026-10-13', '2026-10-12')).toBe(true)
    expect(previousMonthBeforeBooks('2026-10-13', '2026-10-01')).toBe(true)
    expect(previousMonthBeforeBooks('2026-10-13', '2026-09-30')).toBe(false)
    expect(previousMonthBeforeBooks('2026-11-11', '2026-10-12')).toBe(false)
    // Sin la fecha de arranque no se saca nada.
    expect(previousMonthBeforeBooks('2026-10-13', null)).toBe(false)

    // Y el mismo aviso tampoco entra a «Avisos» por la otra puerta; lo demás queda.
    const review: IntegrationAttentionItem = { ...notice, kind: 'import_review', tone: 'warning' }
    expect(
      integrationForBooks([review, notice], { today: '2026-10-13', booksStartDate: '2026-10-12' }),
    ).toEqual([review])
    expect(
      integrationForBooks([review, notice], { today: '2026-10-13', booksStartDate: '2026-09-01' }),
    ).toEqual([review, notice])
  })
})

// ─── «Bajá Mis Comprobantes» y la fecha de arranque ──────────────────────────

describe('la lectura de integraciones no pide un mes anterior a la fecha de arranque', () => {
  const NO_SOURCE = { lastBatchAt: null, pendingBatches: 0, pendingBatchId: null }
  const USED = { ...NO_SOURCE, used: true, prevMonthCovered: false }

  /** Un bar que ya subió algo de ARCA, el 13/10 (después del 11: ya se podría pedir). */
  function status(patch: Partial<IntegrationsStatus> = {}): IntegrationsStatus {
    return {
      available: true,
      today: '2026-10-13',
      arca: { produccion: null, homologacion: null, vouchersAttention: 0 },
      mercadoPago: { ...NO_SOURCE, status: 'csv_only', lastSyncAt: null, lastErrorKey: null },
      bank: { ...NO_SOURCE },
      arcaImports: USED,
      ...patch,
    }
  }
  const asked = (patch: Partial<IntegrationsStatus> = {}) =>
    integrationAttention(status(patch)).filter((item) => item.kind === 'mc_prev_month')

  it('un bar que arranca el 12/10 no ve «de septiembre»: esas compras no se pueden cargar', () => {
    expect(asked({ booksStartDate: '2026-10-12' })).toEqual([])
    // Arrancando el 1/10, septiembre entero también es de antes.
    expect(asked({ booksStartDate: '2026-10-01' })).toEqual([])
  })

  it('en noviembre sí pide octubre, del 11 en adelante y si ningún archivo lo cubre', () => {
    const november = { today: '2026-11-11', booksStartDate: '2026-10-12' }
    expect(asked(november)).toEqual([
      expect.objectContaining({
        kind: 'mc_prev_month',
        label: 'Bajá Mis Comprobantes de octubre y subilo: ya están casi todas las facturas.',
        href: '/importar/arca',
      }),
    ])
    expect(asked({ ...november, today: '2026-11-10' })).toEqual([])
    expect(asked({ ...november, arcaImports: { ...USED, prevMonthCovered: true } })).toEqual([])
  })

  it('un bar que arrancó hace meses lo ve igual que siempre', () => {
    const expected = [
      {
        kind: 'mc_prev_month',
        tone: 'info',
        label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
        href: '/importar/arca',
        // El botón dice lo mismo que la pantalla que abre.
        actionLabel: 'Subir las compras de ARCA',
        count: null,
        date: null,
      },
    ]
    expect(asked({ booksStartDate: '2026-06-01' })).toEqual(expected)
    // Arrancó el último día de septiembre: ese día ya es suyo.
    expect(asked({ booksStartDate: '2026-09-30' })).toEqual(expected)
    // Sin la fecha (no vino, o el bar todavía no la cargó) no se saca nada.
    expect(asked()).toEqual(expected)
    expect(asked({ booksStartDate: null })).toEqual(expected)
    // Y lo de siempre sigue valiendo: antes del 11 o con el mes ya cubierto, no se pide.
    expect(asked({ booksStartDate: '2026-06-01', today: '2026-10-10' })).toEqual([])
    expect(
      asked({ booksStartDate: '2026-06-01', arcaImports: { ...USED, prevMonthCovered: true } }),
    ).toEqual([])
  })

  it('no toca los demás avisos, y es la misma regla que usa el Resumen', () => {
    const pending = { ...USED, pendingBatches: 1, pendingBatchId: 'lote-1' }
    expect(
      integrationAttention(status({ booksStartDate: '2026-10-12', arcaImports: pending })).map(
        (item) => item.kind,
      ),
    ).toEqual(['import_review'])
    for (const [today, start] of [
      ['2026-10-13', '2026-10-12'],
      ['2026-10-13', '2026-10-01'],
      ['2026-10-13', '2026-09-30'],
      ['2026-11-11', '2026-10-12'],
      ['2027-01-12', '2027-01-02'],
      ['2027-01-12', '2026-12-31'],
    ] as const) {
      expect(asked({ today, booksStartDate: start }).length === 0, `${today} · ${start}`).toBe(
        previousMonthBeforeBooks(today, start),
      )
    }
  })
})

// ─── Puesta en marcha ────────────────────────────────────────────────────────

describe('puesta en marcha', () => {
  it('el bar recién configurado: una sola lista, con lo próximo que conviene', () => {
    const guide = onboarding({
      sasMissing: ['cuit', 'fiscal_address'],
      openingDone: false,
      accountantAdded: false,
      salesPoints: 0,
      bankWithCbu: false,
      recurringActive: 31,
    })
    const strip = buildSetup({
      summary: summary({
        firstSteps: {
          firstExpense: true,
          firstDailyClose: false,
          accountantAdded: false,
          partnerGranted: true,
        },
      }),
      settings: { openingStatus: 'pending', cuit: null },
      onboarding: onboarding({
        sasMissing: ['cuit', 'fiscal_address'],
        openingDone: false,
        accountantAdded: false,
        salesPoints: 0,
        bankWithCbu: false,
        recurringActive: 31,
      }),
      recurring: Array.from({ length: 31 }, (_, i) =>
        fixedRow({
          id: `g${i}`,
          amountCents: null,
          monthStatus: 'upcoming',
          nextDueDate: '2026-11-10',
          daysToDue: 28,
        }),
      ),
      suppliers: { total: 80, withoutCategory: 77 },
      canWrite: true,
      base: BASE,
    })

    expect(strip.steps.map((s) => s.id)).toEqual([
      'opening',
      'first_close',
      'first_expense',
      'sas_data',
      'suppliers_category',
      'recurring_amounts',
      'treasuries',
      'sales_methods',
      'platforms',
      'sales_points',
      'access',
      'chart_review',
      'arca',
      'arca_first_import',
      'recurring',
      'mp_connect',
      'suppliers_message',
    ])
    // Cada cosa una sola vez: saldos iniciales y CUIT no se repiten con los de la guía.
    expect(new Set(strip.steps.map((s) => s.id)).size).toBe(strip.steps.length)

    // «N de M» es el de la guía: sus ítems de una sola vez, la sección adonde lleva «Ver todo».
    // Los pasos que no son de la guía (primer cierre, primer gasto, categorías y montos) no se
    // cuentan: si no, el Resumen decía «9 de 16» y la guía «6 de 12».
    expect(guide.state.sections.day1).toEqual({ done: 2, total: 12 })
    expect({ done: strip.done, total: strip.total }).toEqual(guide.state.sections.day1)
    expect(strip.title).toBe('Puesta en marcha · 2 de 12')
    expect(strip.complete).toBe(false)
    expect(strip.guideHref).toBe(`${BASE}/guias/como-arrancar#arranque-day1`)

    expect(strip.next.map((s) => s.id)).toEqual(['opening', 'first_close', 'sas_data'])
    expect(strip.next[0]).toMatchObject({
      title: 'Cargá lo que había en cada caja al arrancar',
      done: false,
      // El mismo nombre que el botón del héroe: una cosa, un nombre.
      action: { kind: 'href', href: `${BASE}/configurar`, label: 'Cargar lo que había' },
    })
    expect(strip.next[2]?.detail).toBe('Falta la CUIT y el domicilio fiscal.')

    // Lo que la pantalla ya ofrece en otro lado no se repite en la franja: el héroe pide los
    // saldos iniciales y «Hoy te toca» tiene la tarjeta del cierre y la del gasto.
    const hero = heroState(
      summary({ treasuries: [treasury('caja', 'cash', 0, { lastMovementDate: null })] }),
      { openingStatus: 'pending' },
      { canWrite: true, base: BASE },
    )
    expect(hero).toMatchObject({ kind: 'unknown', action: { label: 'Cargar lo que había' } })
    const today: TodayItem[] = [
      {
        id: 'daily_close',
        title: 'El cierre de ayer',
        status: '',
        tone: 'warn',
        done: false,
        action: { kind: 'href', href: `${BASE}/ventas/cierre`, label: 'Cargar el cierre' },
        covers: [],
      },
    ]
    expect(setupNext(strip, { hero, today }).map((s) => s.id)).toEqual([
      'sas_data',
      'suppliers_category',
      'recurring_amounts',
    ])
    // Sin nada que lo cubra, es lo mismo que `next`.
    expect(setupNext(strip)).toEqual(strip.next)
    // Una tarjeta ya hecha o sin acción (la contadora) no cubre nada.
    expect(
      setupNext(strip, { today: [{ ...(today[0] as TodayItem), done: true, action: null }] }).map(
        (s) => s.id,
      ),
    ).toEqual(['opening', 'first_close', 'sas_data'])

    const step = (id: string) => strip.steps.find((s) => s.id === id)
    expect(step('first_expense')).toMatchObject({ done: true, detail: null })
    expect(step('suppliers_category')).toMatchObject({
      done: false,
      detail: '77 proveedores no tienen categoría: con eso, cada compra se ordena sola.',
      action: { href: `${BASE}/compras?tab=proveedores&filtro=sin-clasificar` },
    })
    expect(step('recurring_amounts')).toMatchObject({
      done: false,
      detail: '31 de 31 no tienen monto: sin eso no sabés cuánto te falta pagar.',
      // «Completar la planilla»: todos de corrido, no la planilla del mes.
      action: { href: `${BASE}/gastos-fijos/completar`, label: 'Completar los montos' },
    })
    expect(step('mp_connect')?.optional).toBe(true)
    // Lo que pasa afuera de la plataforma lleva a la guía.
    expect(step('suppliers_message')?.action).toMatchObject({ href: `${BASE}/guias/como-arrancar` })
  })

  it('todo hecho: la franja se va', () => {
    const strip = buildSetup({
      summary: summary(),
      settings: { openingStatus: 'posted', cuit: '30712345678' },
      onboarding: onboarding({
        arca: { status: 'connected', certNotAfter: null, emissionEnabled: true },
        imports: {
          arca_recibidos: {
            lastBatchAt: '2026-10-11T12:00:00Z',
            postedBatches: 1,
            pendingReview: 0,
          },
        },
        manual: ['platforms', 'chart_review', 'suppliers_message'],
      }),
      recurring: DEMO_FIXED,
      suppliers: { total: 11, withoutCategory: 0 },
      canWrite: true,
    })
    expect(strip.steps.filter((s) => !s.optional).every((s) => s.done)).toBe(true)
    expect(strip).toMatchObject({ complete: true, next: [], done: 12, total: 12 })
  })

  it('lo que no es de la guía no se cuenta, pero se sigue pidiendo y no deja ir la franja', () => {
    const strip = buildSetup({
      summary: summary(),
      settings: { openingStatus: 'posted', cuit: '30712345678' },
      onboarding: onboarding({
        arca: { status: 'connected', certNotAfter: null, emissionEnabled: true },
        imports: {
          arca_recibidos: {
            lastBatchAt: '2026-10-11T12:00:00Z',
            postedBatches: 1,
            pendingReview: 0,
          },
        },
        manual: ['platforms', 'chart_review', 'suppliers_message'],
      }),
      recurring: DEMO_FIXED,
      suppliers: { total: 11, withoutCategory: 4 },
      canWrite: true,
    })
    // La guía está completa: 12 de 12, igual que su sección.
    expect(strip.title).toBe('Puesta en marcha · 12 de 12')
    // Pero faltan las categorías de cuatro proveedores: la franja sigue y lo ofrece.
    expect(strip.complete).toBe(false)
    expect(strip.next.map((s) => s.id)).toEqual(['suppliers_category'])
  })

  it('sin la guía en la base: alcanza con el resumen y los ajustes', () => {
    const strip = buildSetup({
      summary: summary({
        firstSteps: {
          firstExpense: false,
          firstDailyClose: false,
          accountantAdded: false,
          partnerGranted: true,
        },
      }),
      settings: { openingStatus: 'skipped', cuit: null },
      onboarding: null,
      canWrite: true,
    })
    expect(strip.steps.map((s) => [s.id, s.done])).toEqual([
      ['opening', true],
      ['first_close', false],
      ['first_expense', false],
      ['sas_data', false],
      ['access', false],
    ])
    // Sin la guía no hay con qué empatar: cuenta todo lo que hay.
    expect(strip.title).toBe('Puesta en marcha · 1 de 5')
    expect(strip.steps.at(-1)?.detail).toBe('Falta sumar a la contadora.')
    expect(strip.steps[3]?.detail).toBe('Falta el CUIT: los libros de IVA lo necesitan.')
    expect(strip.steps[2]?.action).toEqual({
      kind: 'sheet',
      sheet: 'gasto',
      params: {},
      label: 'Cargar un gasto',
    })
  })

  it('sin proveedores ni gastos fijos cargados, esos pasos no existen', () => {
    const strip = buildSetup({
      summary: summary(),
      settings: { openingStatus: 'posted', cuit: '30712345678' },
      recurring: [],
      suppliers: { total: 0, withoutCategory: 0 },
      canWrite: true,
    })
    expect(strip.steps.map((s) => s.id)).toEqual([
      'opening',
      'first_close',
      'first_expense',
      'sas_data',
      'access',
    ])
  })

  it('la contadora: solo lo que le cambia la lectura, dicho para ella y sin acciones', () => {
    const strip = buildSetup({
      summary: summary(),
      settings: { openingStatus: 'pending', cuit: null },
      onboarding: onboarding({ openingDone: false, sasMissing: ['cuit'] }),
      canWrite: false,
    })
    expect(strip.steps).toEqual([
      {
        id: 'opening',
        title: 'Faltan los saldos iniciales',
        detail: 'Los dueños todavía no cargaron lo que había al empezar los libros.',
        done: false,
        optional: false,
        action: null,
      },
      {
        id: 'sas_data',
        title: 'Falta el CUIT de la SAS',
        detail: 'Pedíselo a los dueños: se carga en Ajustes › Datos de la SAS.',
        done: false,
        optional: false,
        action: null,
      },
    ])
    expect(strip.title).toBe('Puesta en marcha · 0 de 2')
  })

  it('si no cargó nada, no afirma nada', () => {
    const strip = buildSetup({ summary: null, settings: null, canWrite: true })
    expect(strip).toMatchObject({
      steps: [],
      next: [],
      done: 0,
      total: 0,
      complete: true,
      title: 'Puesta en marcha',
    })
  })
})

// ─── 4. En qué se va la plata ────────────────────────────────────────────────

describe('repartir centavos', () => {
  it('no pierde ni inventa un centavo', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateCents(10, [2, 1, 1])).toEqual([5, 3, 2])
    expect(allocateCents(-100, [1, 1, 1])).toEqual([-34, -33, -33])
    expect(allocateCents(0, [5, 5])).toEqual([0, 0])
    expect(allocateCents(7, [])).toEqual([])
    // Sin pesos, todo a la primera parte.
    expect(allocateCents(7, [0, 0])).toEqual([7, 0])
    // Importes grandes: exacto, sin coma flotante.
    const big = allocateCents(99_999_999_999_99, [71_074_380, 12_396_694, 1])
    expect(big.reduce((sum, x) => sum + x, 0)).toBe(99_999_999_999_99)
  })
})

/** El plan del bar de ejemplo: cada cuenta con el grupo donde cae. */
const account = (type: string, categoryKey: string, categoryLabel: string): SpendingAccount => ({
  type,
  categoryKey,
  categoryLabel,
})
const ACCOUNTS = new Map<string, SpendingAccount>([
  ['bebidas', account('expense', 'ayb', 'Alimentos y bebidas')],
  ['alimentos', account('expense', 'ayb', 'Alimentos y bebidas')],
  ['insumos', account('expense', 'iyd', 'Insumos y descartables')],
  ['limpieza', account('expense', 'local', 'Gastos del local')],
  ['gastos-banco', account('expense', 'gbf', 'Gastos bancarios y financieros')],
  ['imp-debitos', account('expense', 'gbf', 'Gastos bancarios y financieros')],
  ['iva', account('asset', 'ant', 'Anticipos de impuestos y créditos fiscales')],
  ['perc-iva', account('asset', 'ant', 'Anticipos de impuestos y créditos fiscales')],
  ['ley-25413', account('asset', 'ant', 'Anticipos de impuestos y créditos fiscales')],
  ['sircreb', account('asset', 'ant', 'Anticipos de impuestos y créditos fiscales')],
])

const doc = (
  id: string,
  kind: string,
  voucherType: string | null,
  totalCents: number,
): SpendingDocument => ({
  id,
  kind,
  voucherType,
  totalCents,
})
const line = (
  documentId: string,
  role: string,
  accountId: string,
  amountCents: number,
  over: Partial<SpendingLine> = {},
): SpendingLine => ({
  documentId,
  role,
  side: 'debit',
  amountCents,
  accountId,
  vatRateBp: null,
  ...over,
})

/** Octubre de 2026 del bar de ejemplo (del 01/10 al 13/10), tal cual está en la base. */
const OCTOBER_DOCS: SpendingDocument[] = [
  doc('b1', 'bank_expense', null, 104_760),
  doc('b2', 'bank_expense', null, 348_840),
  doc('b3', 'bank_expense', null, 3_402_000),
  doc('b4', 'bank_expense', null, 8_676_000),
  doc('e1', 'expense', 'sin_comprobante', 1_200_000),
  doc('e2', 'expense', 'sin_comprobante', 4_500_000),
  doc('p1', 'purchase', 'factura_a', 15_000_000),
  doc('p2', 'purchase', 'factura_a', 14_520_000),
  doc('p3', 'purchase', 'factura_a', 86_000_000),
  doc('n1', 'purchase_credit_note', 'nota_credito_a', 6_050_000),
]
const OCTOBER_LINES: SpendingLine[] = [
  line('b1', 'other_tax', 'ley-25413', 34_571),
  line('b1', 'other_tax', 'imp-debitos', 70_189),
  line('b2', 'other_tax', 'ley-25413', 78_210),
  line('b2', 'other_tax', 'imp-debitos', 158_790),
  line('b2', 'other_tax', 'ley-25413', 36_907),
  line('b2', 'other_tax', 'imp-debitos', 74_933),
  line('b3', 'other_tax', 'ley-25413', 748_440),
  line('b3', 'other_tax', 'imp-debitos', 1_519_560),
  line('b3', 'other_tax', 'sircreb', 1_134_000),
  line('b4', 'net', 'gastos-banco', 6_900_000, { vatRateBp: 2100 }),
  line('b4', 'vat', 'gastos-banco', 1_449_000, { vatRateBp: 2100 }),
  line('b4', 'perception', 'perc-iva', 207_000),
  line('b4', 'other_tax', 'ley-25413', 39_600),
  line('b4', 'other_tax', 'imp-debitos', 80_400),
  line('e1', 'gross', 'alimentos', 1_200_000),
  line('e2', 'gross', 'alimentos', 4_500_000),
  line('p1', 'net', 'insumos', 12_396_694, { vatRateBp: 2100 }),
  line('p1', 'vat', 'iva', 2_603_306, { vatRateBp: 2100 }),
  line('p2', 'net', 'insumos', 12_000_000, { vatRateBp: 2100 }),
  line('p2', 'vat', 'iva', 2_520_000, { vatRateBp: 2100 }),
  line('p3', 'net', 'bebidas', 71_074_380, { vatRateBp: 2100 }),
  line('p3', 'vat', 'iva', 14_925_620, { vatRateBp: 2100 }),
  line('n1', 'net', 'bebidas', 5_000_000, { side: 'credit', vatRateBp: 2100 }),
  line('n1', 'vat', 'iva', 1_050_000, { side: 'credit', vatRateBp: 2100 }),
]

describe('en qué se va la plata', () => {
  it('octubre del bar de ejemplo: los mismos números que la consulta SQL directa', () => {
    const totals = aggregateSpending(OCTOBER_DOCS, OCTOBER_LINES, ACCOUNTS)
    // Σ de los comprobantes con la nota de crédito restada: «Compras y gastos» del resumen.
    expect(totals.totalCents).toBe(127_701_600)
    expect(totals.documents).toBe(10)
    expect(totals.categories).toEqual([
      { key: 'ayb', label: 'Alimentos y bebidas', cents: 85_650_000, netCents: 71_774_380 },
      { key: 'iyd', label: 'Insumos y descartables', cents: 29_520_000, netCents: 24_396_694 },
      // Los que son solo impuestos del banco caen en la categoría de su cuenta de gasto.
      {
        key: 'gbf',
        label: 'Gastos bancarios y financieros',
        cents: 12_531_600,
        netCents: 8_723_472,
      },
    ])
    expect(totals.categories.reduce((sum, c) => sum + c.cents, 0)).toBe(totals.totalCents)
    expect(totals.vouchers).toEqual([
      { voucherType: 'factura_a', cents: 115_520_000, documents: 3 },
      { voucherType: null, cents: 12_531_600, documents: 4 },
      { voucherType: 'sin_comprobante', cents: 5_700_000, documents: 2 },
      { voucherType: 'nota_credito_a', cents: -6_050_000, documents: 1 },
    ])
  })

  it('sin comprobantes', () => {
    expect(aggregateSpending([], [], ACCOUNTS)).toEqual({
      categories: [],
      vouchers: [],
      totalCents: 0,
      documents: 0,
    })
  })

  it('una compra con dos categorías: el IVA va a lo que se compró con esa alícuota', () => {
    // Super: $ 1.000 de comida al 10,5 % y $ 2.000 de limpieza al 21 %, más una percepción de $ 30.
    const totals = aggregateSpending(
      [doc('s1', 'purchase', 'factura_a', 355_500)],
      [
        line('s1', 'net', 'alimentos', 100_000, { vatRateBp: 1050 }),
        line('s1', 'net', 'limpieza', 200_000, { vatRateBp: 2100 }),
        line('s1', 'vat', 'iva', 10_500, { vatRateBp: 1050 }),
        line('s1', 'vat', 'iva', 42_000, { vatRateBp: 2100 }),
        line('s1', 'perception', 'perc-iva', 3_000),
      ],
      ACCOUNTS,
    )
    expect(totals.categories).toEqual([
      {
        key: 'local',
        label: 'Gastos del local',
        cents: 200_000 + 42_000 + 2_000,
        netCents: 200_000,
      },
      {
        key: 'ayb',
        label: 'Alimentos y bebidas',
        cents: 100_000 + 10_500 + 1_000,
        netCents: 100_000,
      },
    ])
    expect(totals.totalCents).toBe(355_500)
  })

  it('casos raros: sin renglones, solo impuestos que se recuperan, cuenta que no se ve y un redondeo', () => {
    const totals = aggregateSpending(
      [
        doc('sin-renglones', 'expense', 'tique', 1_000),
        doc('solo-impuestos', 'bank_expense', null, 500),
        doc('cuenta-oculta', 'purchase', 'factura_c', 700),
        doc('redondeo', 'purchase', 'factura_a', 1_211),
      ],
      [
        line('solo-impuestos', 'other_tax', 'sircreb', 500),
        line('cuenta-oculta', 'gross', 'no-existe', 700),
        line('redondeo', 'net', 'insumos', 1_000, { vatRateBp: 2100 }),
        line('redondeo', 'vat', 'iva', 210, { vatRateBp: 2100 }),
      ],
      ACCOUNTS,
    )
    expect(Object.fromEntries(totals.categories.map((c) => [c.key, c.cents]))).toEqual({
      sin_clasificar: 1_000 + 700,
      impuestos: 500,
      // El total del comprobante manda: el peso que no explican los renglones va a su categoría.
      iyd: 1_211,
    })
    expect(totals.categories.find((c) => c.key === 'impuestos')?.label).toBe(
      'Impuestos y percepciones',
    )
    expect(totals.totalCents).toBe(3_411)
  })

  it('las seis que más pesan y «Otros»', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      key: `c${i}`,
      label: `Categoría ${i}`,
      cents: (i + 1) * 100,
      netCents: (i + 1) * 80,
    }))
    const view = spendingView(rows)
    expect(view.bars.map((b) => [b.key, b.cents, b.isOther, b.count])).toEqual([
      ['c8', 900, false, 1],
      ['c7', 800, false, 1],
      ['c6', 700, false, 1],
      ['c5', 600, false, 1],
      ['c4', 500, false, 1],
      ['c3', 400, false, 1],
      ['otros', 600, true, 3],
    ])
    expect(view.bars.at(-1)).toMatchObject({ label: 'Otros', netCents: 480 })
    expect(view.shownCents).toBe(4_500)
    expect(view.totalCents).toBe(4_500)
    expect(view.bars[0]?.percent).toBe(20)
    expect(view.title).toBe('Lo que más se lleva: Categoría 8 (20 %)')
  })

  it('el bar de ejemplo, una sola categoría, ninguna, y una que quedó a favor', () => {
    const demo = spendingView(aggregateSpending(OCTOBER_DOCS, OCTOBER_LINES, ACCOUNTS).categories)
    expect(demo.bars.map((b) => [b.label, b.percent])).toEqual([
      ['Alimentos y bebidas', 67.1],
      ['Insumos y descartables', 23.1],
      ['Gastos bancarios y financieros', 9.8],
    ])
    expect(demo.title).toBe('Lo que más se lleva: Alimentos y bebidas (67 %)')
    expect(demo.totalCents).toBe(127_701_600)

    expect(spendingView([{ key: 'a', label: 'Alquiler', cents: 100, netCents: 100 }]).title).toBe(
      'Todo fue a Alquiler',
    )
    expect(spendingView([])).toEqual({
      bars: [],
      shownCents: 0,
      totalCents: 0,
      creditCents: 0,
      isEmpty: true,
      title: null,
    })
    // Más notas de crédito que compras en una categoría: no es una barra.
    const credit = spendingView([
      { key: 'a', label: 'A', cents: 500, netCents: 400 },
      { key: 'b', label: 'B', cents: -200, netCents: -160 },
    ])
    expect(credit).toMatchObject({ shownCents: 500, totalCents: 300, creditCents: 200 })
    expect(credit.bars.map((b) => b.key)).toEqual(['a'])
  })
})

describe('con factura y sin factura', () => {
  it('el bar de ejemplo: la nota de crédito resta de lo facturado y el banco va aparte', () => {
    const split = invoicedSplit(aggregateSpending(OCTOBER_DOCS, OCTOBER_LINES, ACCOUNTS).vouchers)
    expect(split).toEqual({
      invoicedCents: 109_470_000,
      notInvoicedCents: 5_700_000,
      otherCents: 12_531_600,
      invoicedDocuments: 4,
      notInvoicedDocuments: 2,
      otherDocuments: 4,
      totalCents: 115_170_000,
      invoicedPercent: 95.1,
      notInvoicedPercent: 4.9,
      isEmpty: false,
      sentence: 'El 95 % fue con factura y el 5 % sin factura.',
      otherNote: `Aparte hay $${NB}125.316 de gastos del banco, que no llevan factura ni remito.`,
    })
    // Las tres partes son todo lo gastado: nada queda afuera.
    expect(split.invoicedCents + split.notInvoicedCents + split.otherCents).toBe(127_701_600)
  })

  it('un tique o un «otro comprobante» es con factura; solo «sin_comprobante» es sin', () => {
    const split = invoicedSplit([
      { voucherType: 'tique', cents: 100, documents: 1 },
      { voucherType: 'otro_comprobante', cents: 100, documents: 1 },
      { voucherType: 'sin_comprobante', cents: 200, documents: 3 },
    ])
    expect(split).toMatchObject({
      invoicedCents: 200,
      notInvoicedCents: 200,
      invoicedDocuments: 2,
      notInvoicedDocuments: 3,
      invoicedPercent: 50,
      notInvoicedPercent: 50,
      otherNote: null,
    })
  })

  it('vacío, todo con, todo sin, y un mes con más notas de crédito que compras', () => {
    expect(invoicedSplit([])).toMatchObject({
      isEmpty: true,
      totalCents: 0,
      invoicedPercent: 0,
      notInvoicedPercent: 0,
      sentence: 'Todavía no cargaste compras ni gastos este mes.',
    })
    expect(invoicedSplit([{ voucherType: 'factura_a', cents: 500, documents: 1 }]).sentence).toBe(
      'Todo lo que cargaste fue con factura.',
    )
    expect(
      invoicedSplit([{ voucherType: 'sin_comprobante', cents: 500, documents: 1 }]).sentence,
    ).toBe('Todo lo que cargaste fue sin factura (remito o nada).')
    const credit = invoicedSplit([
      { voucherType: 'factura_a', cents: 100, documents: 1 },
      { voucherType: 'nota_credito_a', cents: -300, documents: 1 },
    ])
    expect(credit).toMatchObject({ invoicedCents: 0, totalCents: 0, isEmpty: true })
  })

  it('ningún texto sugiere que algo queda afuera de los libros', () => {
    const texts = [
      invoicedSplit(aggregateSpending(OCTOBER_DOCS, OCTOBER_LINES, ACCOUNTS).vouchers),
      invoicedSplit([{ voucherType: 'sin_comprobante', cents: 500, documents: 1 }]),
    ].flatMap((s) => [s.sentence, s.otherNote ?? ''])
    for (const text of texts) expect(text).not.toMatch(/en negro|en blanco|afuera|fuera de/i)
  })
})

// ─── La lectura ──────────────────────────────────────────────────────────────

describe('la categoría de cada cuenta', () => {
  it('una cuenta del último nivel va a su grupo; una de más arriba es su propia categoría', () => {
    const accounts = new Map([
      [
        'hoja',
        { id: 'hoja', name: 'Compras: alimentos', type: 'expense', level: 5, parent_id: 'grupo' },
      ],
      [
        'alta',
        {
          id: 'alta',
          name: 'Costo de mercadería vendida',
          type: 'expense',
          level: 4,
          parent_id: 'rubro',
        },
      ],
      [
        'huerfana',
        { id: 'huerfana', name: 'Varios', type: 'expense', level: 5, parent_id: 'no-vino' },
      ],
    ])
    const parents = new Map([
      ['grupo', { id: 'grupo', name: 'Alimentos y bebidas' }],
      ['rubro', { id: 'rubro', name: 'Costo' }],
    ])
    expect(Object.fromEntries(spendingAccounts(accounts, parents))).toEqual({
      hoja: { type: 'expense', categoryKey: 'grupo', categoryLabel: 'Alimentos y bebidas' },
      alta: { type: 'expense', categoryKey: 'alta', categoryLabel: 'Costo de mercadería vendida' },
      huerfana: { type: 'expense', categoryKey: 'huerfana', categoryLabel: 'Varios' },
    })
  })
})

describe('getMonthSpending', () => {
  const TENANT = 'tenant-1'
  /** Ids con forma de UUID: la lectura descarta lo que no lo es. */
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const GROUP = uuid(900_001)
  const LEAF = uuid(900_002)

  let documents: Array<Record<string, unknown>> = []
  let lines: Array<Record<string, unknown>> = []

  function page(rows: readonly unknown[], call: Call): Result {
    const [from, to] = call.range ?? [0, rows.length - 1]
    return { data: rows.slice(from, to + 1), error: null }
  }

  beforeEach(() => {
    db.calls = []
    documents = []
    lines = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.respond = (call) => {
      if (call.table === 'acc_documents') return page(documents, call)
      if (call.table === 'acc_document_lines') {
        const ids = new Set(call.in.document_id ?? [])
        return page(
          lines.filter((l) => ids.has(l.document_id)),
          call,
        )
      }
      if (call.table === 'acc_accounts') {
        const ids = new Set(call.in.id ?? [])
        const all = [
          { id: LEAF, name: 'Compras: alimentos', type: 'expense', level: 5, parent_id: GROUP },
          { id: GROUP, name: 'Alimentos y bebidas', type: 'expense', level: 4, parent_id: null },
        ]
        return { data: all.filter((a) => ids.has(a.id)), error: null }
      }
      return { data: [], error: null }
    }
  })

  it('lee más de 1.000 filas de a páginas y no pierde ninguna', async () => {
    // 1.205 gastos de $ 10: dos páginas de comprobantes y trece tandas de renglones.
    documents = Array.from({ length: 1_205 }, (_, i) => ({
      id: uuid(i + 1),
      kind: 'expense',
      voucher_type: i % 5 === 0 ? 'sin_comprobante' : 'tique',
      total_cents: '1000',
    }))
    lines = documents.map((d) => ({
      document_id: d.id,
      role: 'gross',
      side: 'debit',
      amount_cents: 1000,
      account_id: LEAF,
      vat_rate_bp: null,
    }))

    const result = await getMonthSpending(TENANT, { from: '2026-10-01', to: TODAY })
    expect(result).toMatchObject({
      from: '2026-10-01',
      to: TODAY,
      truncated: false,
      documents: 1_205,
    })
    expect(result.totalCents).toBe(1_205_000)
    expect(result.categories).toEqual([
      { key: GROUP, label: 'Alimentos y bebidas', cents: 1_205_000, netCents: 1_205_000 },
    ])
    expect(result.vouchers).toEqual([
      { voucherType: 'tique', cents: 964_000, documents: 964 },
      { voucherType: 'sin_comprobante', cents: 241_000, documents: 241 },
    ])

    const docCalls = db.calls.filter((c) => c.table === 'acc_documents')
    expect(docCalls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    const lineCalls = db.calls.filter((c) => c.table === 'acc_document_lines')
    expect(lineCalls).toHaveLength(13)
    expect(lineCalls.every((c) => (c.in.document_id?.length ?? 0) <= 100)).toBe(true)
  })

  it('cada lectura filtra el bar, y los comprobantes con las reglas de «Compras y gastos»', async () => {
    documents = [{ id: uuid(1), kind: 'purchase', voucher_type: 'factura_a', total_cents: 500 }]
    lines = [
      {
        document_id: uuid(1),
        role: 'gross',
        side: 'debit',
        amount_cents: 500,
        account_id: LEAF,
        vat_rate_bp: null,
      },
    ]
    await getMonthSpending(TENANT, { from: '2026-10-01', to: TODAY })

    expect(db.calls.length).toBeGreaterThan(0)
    expect(db.calls.every((c) => c.eq.tenant_id === TENANT)).toBe(true)

    const docs = db.calls.find((c) => c.table === 'acc_documents')
    expect(docs?.eq).toEqual({ tenant_id: TENANT, status: 'posted', settles_commissions: false })
    expect(docs?.in.kind).toEqual([
      'purchase',
      'purchase_debit_note',
      'purchase_credit_note',
      'expense',
      'bank_expense',
    ])
    expect(docs?.gte).toEqual({ accounting_date: '2026-10-01' })
    expect(docs?.lte).toEqual({ accounting_date: TODAY })
    // Un orden único: sin él, una fila puede repetirse o perderse entre páginas.
    expect(docs?.order).toEqual(['id'])
    // Solo importes, tipos e ids: ni nombres ni descripciones.
    expect(docs?.columns).toBe('id, kind, voucher_type, total_cents')

    const lineCall = db.calls.find((c) => c.table === 'acc_document_lines')
    expect(lineCall?.columns).toBe('document_id, role, side, amount_cents, account_id, vat_rate_bp')
    expect(lineCall?.in.role).toEqual([
      'net',
      'gross',
      'non_taxed',
      'exempt',
      'internal_tax',
      'vat',
      'perception',
      'other_tax',
    ])
    expect(lineCall?.order).toEqual(['id'])
  })

  it('un mes sin comprobantes no pide nada más', async () => {
    const result = await getMonthSpending(TENANT, { from: '2026-10-01', to: TODAY })
    expect(result).toMatchObject({
      categories: [],
      vouchers: [],
      totalCents: 0,
      documents: 0,
      truncated: false,
    })
    expect(db.calls.map((c) => c.table)).toEqual(['acc_documents'])
  })

  it('un rango roto o un error de la base se informan (el bloque muestra «Reintentar»)', async () => {
    await expect(getMonthSpending(TENANT, { from: TODAY, to: '2026-10-01' })).rejects.toMatchObject(
      {
        name: 'AccQueryError',
      },
    )
    db.respond = () => ({ data: null, error: { code: '57014', message: 'canceling statement' } })
    await expect(getMonthSpending(TENANT, { from: '2026-10-01', to: TODAY })).rejects.toMatchObject(
      {
        name: 'AccQueryError',
      },
    )
  })

  it('proveedores sin categoría: solo cuenta, con la regla del filtro «Sin clasificar»', async () => {
    db.respond = (call) => ({
      data: null,
      error: null,
      count: 'default_account_id' in call.is ? 77 : 80,
    })
    await expect(getSupplierCategoryCount(TENANT)).resolves.toEqual({
      total: 80,
      withoutCategory: 77,
    })
    expect(db.calls).toHaveLength(2)
    for (const call of db.calls) {
      expect(call.table).toBe('acc_parties')
      expect(call.head).toBe(true)
      expect(call.columns).toBe('id')
      expect(call.eq).toEqual({ tenant_id: TENANT, active: true })
      expect(call.in.kind).toEqual(['supplier', 'other'])
      expect(call.is.system_key).toBeNull()
    }
  })
})
