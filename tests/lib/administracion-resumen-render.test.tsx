// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttentionRows } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/attention-rows'
import { HeroBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/hero-block'
import type { HomeData } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/home-data'
import { IvaBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/iva-block'
import { MonthBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/month-block'
import { NoticesBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/notices-block'
import { PayablesBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/payables-block'
import { attentionView } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/summary-copy'
import { TodayBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/today-block'
import { gastosFijosFillHref } from '@/app/(manager)/[tenantSlug]/administracion/compras/_lib/links'
import { buildSetup, buildToday } from '@/lib/accounting/home'
import { buildProjection } from '@/lib/accounting/projection'
import { parseIvaPosition } from '@/lib/accounting/queries/books'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import type { AccSummary, SummaryAttentionItem } from '@/lib/accounting/queries/summary'
import { eachIsoDay } from '@/lib/dates'

/**
 * El Resumen («la plata hoy») ya dibujado: lo que la pantalla le promete a
 * cada uno. Las cuentas y las frases tienen sus tests en `accounting-home`;
 * acá se cuida lo que solo se ve armado: que un dato que falta no salga como
 * «$ 0», que la contadora no reciba ningún botón de carga y que un mismo
 * aviso no aparezca en dos bloques.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
// La acción de «Este mes no se paga» es del servidor: para dibujar los renglones no hace falta.
vi.mock('@/lib/accounting/actions/master', () => ({ skipRecurringDue: vi.fn() }))
// La franja del IVA pide el detalle del mes por su cuenta: acá se lo da cada test.
const iva = vi.hoisted(() => ({ position: null as unknown }))
vi.mock('@/lib/accounting/queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getIvaPosition: async () => {
    if (!iva.position) throw new Error('sin posición de IVA')
    return iva.position
  },
}))

afterEach(() => {
  ui.readOnly = false
  iva.position = null
})

const TODAY = '2026-10-13'
const BASE = '/hub/administracion'
/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)

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

function homeData(
  input: {
    summary?: AccSummary | null
    settings?: AccountingSettings
    recurring?: RecurringExpenseRow[]
    integration?: IntegrationAttentionItem[]
    canWrite?: boolean
    /** Los cierres cargados llegan hasta el día anterior a este (por defecto, falta el de ayer). */
    closedBefore?: string
  } = {},
): HomeData {
  const canWrite = input.canWrite ?? true
  const summary = input.summary === undefined ? summaryOf() : input.summary
  const settings = input.settings ?? SETTINGS
  const recurring = input.recurring ?? [fixed({})]
  const integration = input.integration ?? []
  const closedBefore = input.closedBefore ?? '2026-10-12'
  // Una fila por día, como manda la base: cargados hasta el 11, falta el de ayer (12/10).
  const projection = buildProjection(
    eachIsoDay('2026-10-01', '2026-10-31').map((day) => ({
      day,
      targetCents: null,
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
    cash: ok({
      from: '2026-09-14',
      to: TODAY,
      total: {
        treasuryId: null,
        name: '',
        kind: null,
        active: true,
        openingCents: 180_000_000,
        closingCents: summary?.availableCents ?? 0,
        days: [],
      },
      accounts: [],
    }),
    recurring: ok(recurring),
    payments: ok(new Map()),
    spending: failed,
    onboarding: ok(null),
    integration: canWrite ? ok(integration) : null,
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

describe('Resumen · el héroe «la plata hoy»', () => {
  it('con plata: el número, una píldora por caja que lleva a sus movimientos y los 30 días', async () => {
    const html = renderToStaticMarkup(await HeroBlock({ data: homeData(), tone: 'bosque' }))
    expect(html).toContain('Plata disponible hoy')
    expect(html).toContain('2.144.757')
    expect(html).toContain(`href="${BASE}/cajas/caja"`)
    expect(html).toContain(`href="${BASE}/cajas/mp"`)
    expect(html).toContain(`Hace 30 días había $${NB}1.800.000`)
  })

  it('el color de cada caja sale de su tipo, y el porcentaje va como texto, sin pastilla', async () => {
    const html = renderToStaticMarkup(await HeroBlock({ data: homeData(), tone: 'bosque' }))
    // Efectivo y billetera: cada uno su tono, en la barra y en la leyenda.
    expect(html).toContain('bg-(--adm-k-cash-1)')
    expect(html).toContain('bg-(--adm-k-wallet-1)')
    // Ya no por su lugar en la lista (el banco en tercer lugar pintaba el héroe de ciruela).
    expect(html).not.toContain('bg-adm-s3')
    // El porcentaje al lado del importe, como texto: nada de dos números en cajitas.
    expect(html).toContain(`· 18${NB}%`)
    expect(html).toContain(`· 82${NB}%`)
    expect(html).not.toContain('font-mono')
    // En angosto, un renglón por caja con su plata a la vista (no una fila que se corta).
    expect(html.match(/min-h-10/g)?.length).toBe(2)
  })

  it('sin saldos iniciales y sin movimientos no muestra «$ 0»: dice que todavía no sabe', async () => {
    const data = homeData({
      summary: untouchedSummary(),
      settings: { ...SETTINGS, openingStatus: 'pending' },
    })
    const html = renderToStaticMarkup(await HeroBlock({ data, tone: 'bosque' }))
    expect(html).toContain('Todavía no sé cuánta plata hay')
    expect(html).toContain('Cargar lo que había')
    expect(html).toContain(`href="${BASE}/configurar"`)
    expect(html).not.toContain('Plata disponible hoy')
    expect(html).not.toContain(`$${NB}0`)
    // Las cajas del bar esperan su monto: enseñan qué va a aparecer.
    expect(html).toContain('Mercado Pago')
    expect(html).toContain('¿cuánto hay?')
  })

  it('la contadora ve el mismo estado sin el botón de carga', async () => {
    ui.readOnly = true
    const data = homeData({
      summary: untouchedSummary(),
      settings: { ...SETTINGS, openingStatus: 'pending' },
      canWrite: false,
    })
    const html = renderToStaticMarkup(await HeroBlock({ data, tone: 'bosque' }))
    expect(html).toContain('Todavía no sé cuánta plata hay')
    expect(html).not.toContain('Cargar lo que había')
    expect(html).not.toContain('/configurar')
  })

  it('si el resumen no cargó lo dice ahí, con «Reintentar», sin tirar la pantalla', async () => {
    const html = renderToStaticMarkup(
      await HeroBlock({ data: homeData({ summary: null }), tone: 'bosque' }),
    )
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
    const html = renderToStaticMarkup(await HeroBlock({ data, tone: 'bosque' }))
    expect(html).toContain('Tardó demasiado. Probá de nuevo en un rato.')
    expect(html).not.toContain('período')
  })
})

describe('Resumen · «Hoy te toca»', () => {
  const render = async (data: HomeData, collapsed = false) =>
    renderToStaticMarkup(
      await TodayBlock({ data, setupCookie: 'hub_acc_pasos_hub', setupCollapsed: collapsed }),
    )

  it('el dueño ve las tarjetas con una acción cada una', async () => {
    const html = await render(homeData())
    expect(html).toContain('Hoy te toca')
    expect(html).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`)
    expect(html).toContain('Cargar un gasto')
    expect(html).toContain('Pagar')
    // Con todo configurado no hay franja de puesta en marcha.
    expect(html).not.toContain('Puesta en marcha')
  })

  it('la contadora ve el estado de cada cosa y ningún botón de carga', async () => {
    ui.readOnly = true
    const html = await render(homeData({ canWrite: false }))
    expect(html).toContain('El día a día del bar')
    expect(html).toContain('Pagos que vencen')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('/ventas/cierre')
    expect(html).not.toContain('Cargar un gasto')
  })

  it('con la puesta en marcha incompleta, debajo va su franja con lo que sigue y «Ver todo»', async () => {
    const data = homeData({
      summary: untouchedSummary(),
      settings: { ...SETTINGS, openingStatus: 'pending', cuit: null },
      recurring: [fixed({ amountCents: null })],
    })
    const html = await render(data)
    expect(html).toMatch(/Puesta en marcha · \d+ de \d+/)
    // «Ver todo» baja a la sección de la puesta en marcha de la guía, con el mismo «N de M».
    expect(html).toContain(`href="${BASE}/guias/como-arrancar#arranque-day1"`)
    // Primero lo de hoy, después la puesta en marcha: la primera acción no queda tapada.
    expect(html.indexOf('Puesta en marcha')).toBeGreaterThan(html.indexOf('Cargar un gasto'))
    // Lo que sigue es lo que la pantalla todavía no ofrece: los saldos iniciales los pide el
    // héroe y el primer cierre es la tarjeta ①, así que acá no se repiten.
    expect(html).toContain('Sigue:')
    expect(html).toContain('Completá los datos de la SAS')
    expect(html).toContain('Poneles monto a los gastos fijos')
    expect(html).not.toContain('Cargá lo que había en cada caja al arrancar')
    expect(html).not.toContain('Cargá tu primer cierre del día')
    expect(html).not.toContain('Cargar saldos iniciales')
    // El avance es una barra continua (no una rayita por paso).
    expect(html).toMatch(/aria-label="\d+ de \d+ pasos hechos"/)
    // En un renglón sigue estando, con su avance, lo que sigue y cómo ver los próximos.
    const collapsed = await render(data, true)
    expect(collapsed).toMatch(/Puesta en marcha · \d+ de \d+/)
    expect(collapsed).toContain('Completá los datos de la SAS')
    expect(collapsed).toContain('Mostrar los próximos 2')
  })

  it('si el resumen no cargó, la franja no afirma un avance ni cuántas cosas esperan', async () => {
    const html = await render(
      homeData({ summary: null, settings: { ...SETTINGS, openingStatus: 'pending', cuit: null } }),
    )
    expect(html).toContain('Puesta en marcha')
    expect(html).not.toMatch(/Puesta en marcha · \d+ de \d+/)
    expect(html).not.toContain('pasos hechos')
    expect(html).not.toMatch(/Hay \d+ cosas? esperando/)
    expect(html).toContain('Puede faltar algo: no cargó el resumen.')
  })
})

describe('Resumen · «Lo que tenés que pagar»', () => {
  const render = async (data: HomeData) => renderToStaticMarkup(await PayablesBlock({ data }))

  it('la deuda en tres tramos, los que hay que pagar con su botón y los gastos fijos del mes', async () => {
    const html = await render(homeData())
    // Un bloque, un número: el título afirma sin importe y lo vencido va en la oración.
    expect(html).toContain('Tenés pagos vencidos con 2 proveedores')
    expect(html).not.toContain(`Tenés $${NB}`)
    expect(html).toContain(`$${NB}604.000 ya venció.`)
    expect(html).toContain(`$${NB}696.000`)
    expect(html).toContain('Le debés a proveedores')
    expect(html).toContain('Vence esta semana')
    expect(html).toContain('Más adelante')
    expect(html).toContain('0003-00001100')
    // Un vencido y nada más: no hay mezcla que distinguir, así que tampoco hay píldora.
    expect(html).not.toContain('data-tone="late"')
    expect(html).toContain('Te falta de gasto fijo')
    expect(html).toContain(`href="${BASE}/gastos-fijos"`)
  })

  it('los gastos fijos que tocan, con sus tres acciones al lado del número', async () => {
    const recurring = [
      fixed({ id: 'luz', name: 'Luz', nextDueDate: '2026-10-28', daysToDue: 15 }),
      fixed({
        id: 'internet',
        name: 'Internet',
        amountCents: 3_500_000,
        nextDueDate: '2026-10-15',
        daysToDue: 2,
      }),
      fixed({
        id: 'alquiler',
        name: 'Alquiler del local',
        amountCents: 85_000_000,
        nextDueDate: '2026-10-10',
        daysToDue: -3,
      }),
    ]
    const html = await render(homeData({ recurring }))
    const part = html.slice(html.indexOf('Gastos fijos del mes'))
    // Los que entraron en su aviso, del más atrasado al que vence más lejos; la luz (28/10)
    // todavía no toca.
    expect(part).toContain('Alquiler del local')
    expect(part.indexOf('Alquiler del local')).toBeLessThan(part.indexOf('Internet'))
    expect(part).not.toContain('>Luz<')
    // El que ya pasó su día dice «venció», y en rojo; el otro, «vence». Sin «todavía sin
    // pagar»: debajo de «Te falta de gasto fijo» todos lo están.
    expect(part).toContain('venció el 10/10')
    expect(part).toContain('vence el 15/10')
    expect(part).not.toContain('todavía sin pagar')
    expect(part).toContain('Vencido')
    expect(part).toContain('Por vencer')
    // Con varios, un «Pagar» por renglón (como los proveedores): abre el gasto con el gasto fijo.
    expect(part.split('>Pagar<').length - 1).toBe(2)
    expect(part).not.toContain('Lo pago después')

    // Uno solo: las tres acciones del aviso.
    const one = await render(homeData({ recurring: [recurring[2] as RecurringExpenseRow] }))
    const onePart = one.slice(one.indexOf('Gastos fijos del mes'))
    expect(onePart.split('>Pagar<').length - 1).toBe(1)
    expect(onePart).toContain(`href="${BASE}/compras/nueva?gasto-fijo=alquiler"`)
    expect(onePart).toContain('Este mes no se paga')

    // La contadora ve qué toca, sin ningún botón.
    ui.readOnly = true
    const reader = await render(homeData({ recurring, canWrite: false }))
    const readerPart = reader.slice(reader.indexOf('Gastos fijos del mes'))
    expect(readerPart).toContain('Alquiler del local')
    expect(readerPart).not.toContain('>Pagar<')
    expect(readerPart).not.toContain('Lo pago después')
    expect(readerPart).not.toContain('Este mes no se paga')
  })

  it('lo que no entra en los renglones suma con lo que dice el título', async () => {
    // 9 proveedores con algo vencido y la lista de avisos topeada: 3 renglones y «6 más».
    const overdue = Array.from({ length: 5 }, (_, i) =>
      attention({
        kind: 'payable_overdue',
        label: `Proveedor ${i + 1} · 2 comprobantes`,
        amountCents: 10_000_000,
        days: 40 - i,
        partyId: `p${i + 1}`,
      }),
    )
    const html = await render(
      homeData({
        summary: summaryOf({
          attention: overdue,
          payables: {
            totalCents: 69_600_000,
            overdueCents: 60_400_000,
            dueWeekCents: 0,
            partiesRed: 9,
          },
        }),
      }),
    )
    expect(html).toContain('Tenés pagos vencidos con 9 proveedores')
    expect(html.match(/>Pagar</g)?.length).toBe(3)
    expect(html).toContain('Y 6 más')
    // Todos vencidos: la píldora «Vencido» no se repite en cada renglón (el texto ya lo dice).
    expect(html).not.toContain('data-tone="late"')
    expect(html).toContain('venció hace 40 días')
  })

  it('gastos fijos sin monto: pide completarlos en vez de mostrar «$ 0»', async () => {
    const recurring = Array.from({ length: 31 }, (_, i) =>
      fixed({
        id: `fijo-${i}`,
        amountCents: null,
        nextDueDate: '2026-11-10',
        daysToDue: 28,
        monthStatus: 'upcoming',
      }),
    )
    const html = await render(homeData({ recurring }))
    expect(html).toContain('31 gastos fijos sin monto')
    expect(html).toContain('Completar los montos')
    // Va a «Completar la planilla» (todos de corrido), no a la planilla del mes.
    expect(gastosFijosFillHref('hub')).toBe(`${BASE}/gastos-fijos/completar`)
    expect(html).toMatch(
      new RegExp(`href="${BASE}/gastos-fijos/completar"[^>]*>(?:<[^>]+>)*Completar los montos`),
    )
    expect(html).not.toContain('Te falta de gasto fijo')
    expect(html).not.toContain(`$${NB}0<`)
    // La contadora ve que faltan los montos, sin el link para completarlos.
    ui.readOnly = true
    const reader = await render(homeData({ recurring, canWrite: false }))
    expect(reader).toContain('31 gastos fijos sin monto')
    expect(reader).not.toContain('Completar los montos')
    expect(reader).not.toContain('/gastos-fijos/completar')
  })

  it('la contadora ve los mismos renglones sin «Pagar»', async () => {
    ui.readOnly = true
    const html = await render(homeData({ canWrite: false }))
    expect(html).toContain('0003-00001100')
    expect(html).not.toContain('<button')
  })
})

/**
 * El bar recién arrancado (así está el bar real): libros desde ayer, saldos iniciales sin
 * cargar, ningún cierre. Cada bloque tiene que enseñar qué va a aparecer, sin un cero ni un
 * «nada pendiente» que nadie afirmó.
 */
describe('Resumen · el bar recién arrancado', () => {
  const NEW_SETTINGS = {
    ...SETTINGS,
    booksStartDate: '2026-10-12',
    openingStatus: 'pending',
    cuit: null,
  } as AccountingSettings
  const noDebt = (over: Partial<AccSummary> = {}) => ({
    ...untouchedSummary(),
    payables: { totalCents: 0, overdueCents: 0, dueWeekCents: 0, partiesRed: 0 },
    ...over,
  })

  it('«Lo que tenés que pagar» no afirma «no le debés nada · $ 0» sin saldos iniciales', async () => {
    const data = homeData({ summary: noDebt(), settings: NEW_SETTINGS, closedBefore: '2026-10-01' })
    const html = renderToStaticMarkup(await PayablesBlock({ data }))
    expect(html).toContain('Todavía no sé cuánto debés')
    expect(html).toContain('entra con los saldos iniciales')
    expect(html).toContain('aparece acá, con su vencimiento')
    expect(html).not.toContain('No le debés nada')
    expect(html).not.toContain('Le debés a proveedores')
    // Ningún importe en cero a la vista (el medidor de gastos fijos lleva el suyo en su nombre).
    expect(html).not.toContain(`$${NB}0<`)
    // Y la tarjeta de «Hoy te toca» tampoco lo da por hecho.
    const today = renderToStaticMarkup(
      await TodayBlock({ data, setupCookie: 'hub_acc_pasos_hub', setupCollapsed: true }),
    )
    expect(today).toContain('Todavía no cargaste lo que debés: entra con los saldos iniciales.')
    expect(today).not.toContain('No le debés nada')
    expect(today).not.toContain('Hecho: </span>Pagos que vencen')
  })

  it('con algo cargado muestra la deuda y avisa que falta lo de antes de arrancar', async () => {
    const data = homeData({ settings: NEW_SETTINGS, closedBefore: '2026-10-01' })
    const html = renderToStaticMarkup(await PayablesBlock({ data }))
    expect(html).toContain('Tenés pagos vencidos con 2 proveedores')
    expect(html).toContain('lo que debías de antes entra con los saldos iniciales')
    // Con los saldos iniciales cargados la aclaración no va.
    const settled = renderToStaticMarkup(await PayablesBlock({ data: homeData() }))
    expect(settled).not.toContain('saldos iniciales')
  })

  it('no ofrece bajar de ARCA las compras de un mes anterior a los libros, ni en «Avisos»', async () => {
    const MC: IntegrationAttentionItem = {
      kind: 'mc_prev_month',
      tone: 'info',
      label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
      href: '/importar/arca',
      actionLabel: 'Subir las compras de ARCA',
      count: null,
      date: null,
    }
    const data = homeData({
      summary: noDebt(),
      settings: NEW_SETTINGS,
      integration: [MC],
      closedBefore: '2026-10-01',
    })
    const today = renderToStaticMarkup(
      await TodayBlock({ data, setupCookie: 'hub_acc_pasos_hub', setupCollapsed: true }),
    )
    expect(today).not.toContain('ARCA')
    expect(today).not.toContain('septiembre')
    expect(await NoticesBlock({ data })).toBeNull()
    // Con los libros de antes, la tarjeta sigue estando.
    const older = homeData({ integration: [MC] })
    expect(
      renderToStaticMarkup(
        await TodayBlock({ data: older, setupCookie: 'hub_acc_pasos_hub', setupCollapsed: true }),
      ),
    ).toContain('Bajar las compras de ARCA')
  })

  it('el almanaque dice desde cuándo se lleva la cuenta (los días de antes van sin casillero)', async () => {
    const data = homeData({ summary: noDebt(), settings: NEW_SETTINGS, closedBefore: '2026-10-01' })
    const html = renderToStaticMarkup(await MonthBlock({ data }))
    expect(html).toContain('Todavía no hay ventas cargadas en octubre')
    expect(html).toContain('Falta 1 cierre')
    expect(html).toContain('Llevás la cuenta desde el 12/10: los días de antes no se cargan.')
    expect(html).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`)
    // Con los libros de un mes anterior no hay nada que aclarar.
    expect(renderToStaticMarkup(await MonthBlock({ data: homeData() }))).not.toContain(
      'Llevás la cuenta desde',
    )
  })

  it('la franja del IVA sin nada con factura no dice «no hay nada que pagar»', async () => {
    const position = (creditCents: number) =>
      parseIvaPosition(
        {
          month: '2026-10-01',
          status: 'open',
          mode: 'on_close',
          debit_fiscal: { by_rate: {}, total_cents: 0 },
          credit_fiscal: { by_rate: {}, total_cents: creditCents },
          to_pay_cents: 0,
          in_favor_cents: creditCents,
          perceptions_cents: 0,
          withholdings_cents: 0,
          technical_balance_prev_cents: 0,
          free_balance_prev_cents: 0,
        },
        '2026-10-01',
      )
    const ivaMonth = (inFavorCents: number) => ({
      month: '2026-10-01',
      toPayCents: 0,
      inFavorCents,
      provisional: true,
    })

    iva.position = position(0)
    const empty = renderToStaticMarkup(
      await IvaBlock({
        data: homeData({ summary: noDebt({ ivaMonth: ivaMonth(0) }), settings: NEW_SETTINGS }),
      }),
    )
    expect(empty).toContain('IVA de octubre: todavía no hay nada cargado con factura.')
    expect(empty).not.toContain('no hay nada que pagar')
    expect(empty).not.toContain('Estimado')
    expect(empty).not.toContain('¿Cómo se calcula?')
    expect(empty).not.toContain(`$${NB}0`)

    // Con una compra con Factura A ya hay un número, y se dice que es estimado.
    iva.position = position(1_255_800)
    const some = renderToStaticMarkup(
      await IvaBlock({
        data: homeData({
          summary: noDebt({ ivaMonth: ivaMonth(1_255_800) }),
          settings: NEW_SETTINGS,
        }),
      }),
    )
    expect(some).toContain(`IVA de octubre: a favor $${NB}12.558`)
    expect(some).toContain('Estimado')
  })
})

describe('Resumen · «Avisos»', () => {
  const MP_REVIEW: IntegrationAttentionItem = {
    kind: 'import_review',
    tone: 'warning',
    label: 'Hay 12 movimientos de Mercado Pago para revisar.',
    href: '/importar/lote-1',
    actionLabel: 'Revisar',
    count: 12,
    date: null,
  }
  const ARCA_CERT: IntegrationAttentionItem = {
    kind: 'arca_cert_expiring',
    tone: 'warning',
    label: 'El certificado de ARCA vence el 28/10.',
    href: '/ajustes/arca#renovar',
    actionLabel: 'Renovar',
    count: null,
    date: '2026-10-28',
  }

  it('no repite lo que ya dicen «pagar» y las tarjetas de «Hoy te toca»', async () => {
    const data = homeData({ integration: [MP_REVIEW, ARCA_CERT] })
    const html = renderToStaticMarkup(await NoticesBlock({ data }))
    expect(html).toContain('Hay 2 avisos')
    // Lo propio de «Avisos»: contar la caja y el certificado.
    expect(html).toContain('¿Coincide Caja?')
    expect(html).toContain('Contar la caja')
    expect(html).toContain('El certificado de ARCA vence el 28/10.')
    // La factura vencida está en «pagar»; el cierre y lo importado, en sus tarjetas.
    expect(html).not.toContain('Coca-Cola')
    expect(html).not.toContain('cierre')
    expect(html).not.toContain('Mercado Pago para revisar')
  })

  it('sin avisos el bloque no se dibuja', async () => {
    const data = homeData({ summary: summaryOf({ attention: [] }) })
    expect(await NoticesBlock({ data })).toBeNull()
  })

  it('un gasto fijo que vence: «Pagar» abre el gasto con ese gasto fijo ya puesto', () => {
    const FIXED_ID = '11111111-1111-4111-8111-111111111111'
    const view = attentionView(
      attention({
        kind: 'recurring_due',
        refId: FIXED_ID,
        label: 'Alquiler',
        amountCents: 85_000_000,
        date: '2026-10-15',
      }),
      TODAY,
      BASE,
      0,
    )
    expect(view.text).toBe('Alquiler · vence el 15/10 · todavía sin pagar')
    expect(view.tone).toBe('warning')
    // Uno que ya pasó su día: «venció», con el tono de lo vencido.
    const late = attentionView(
      attention({ kind: 'recurring_due', refId: FIXED_ID, label: 'Alquiler', date: '2026-10-10' }),
      TODAY,
      BASE,
      0,
    )
    expect(late).toMatchObject({
      text: 'Alquiler · venció el 10/10 · todavía sin pagar',
      tone: 'danger',
    })
    // Lo mismo que «Pagar» en su renglón de la planilla: `?accion=gasto&gasto-fijo=`.
    expect(view.actions).toEqual([
      { type: 'sheet', label: 'Pagar', action: 'gasto', params: { 'gasto-fijo': FIXED_ID } },
      {
        type: 'link',
        label: 'Lo pago después',
        href: `${BASE}/compras/nueva?gasto-fijo=${FIXED_ID}`,
      },
      { type: 'skip', label: 'Este mes no se paga', recurringId: FIXED_ID, dueDate: '2026-10-15' },
    ])

    const words = { danger: 'Vencido', warning: 'Por vencer', info: 'Aviso' }
    const owner = renderToStaticMarkup(<AttentionRows views={[view]} words={words} />)
    expect(owner).toContain('>Pagar<')
    expect(owner).toContain('Este mes no se paga')
    expect(owner).toContain(`href="${BASE}/compras/nueva?gasto-fijo=${FIXED_ID}"`)

    // La contadora lee el mismo renglón, sin ninguno de los tres controles.
    ui.readOnly = true
    const reader = renderToStaticMarkup(<AttentionRows views={[view]} words={words} />)
    expect(reader).toContain('Alquiler')
    expect(reader).not.toContain('<button')
    expect(reader).not.toContain('>Pagar<')
    expect(reader).not.toContain('Lo pago después')
    expect(reader).not.toContain('Este mes no se paga')
    expect(reader).not.toContain('/compras/nueva')
  })
})
