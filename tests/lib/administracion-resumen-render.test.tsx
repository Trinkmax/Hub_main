// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeroBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/hero-block'
import type { HomeData } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/home-data'
import { NoticesBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/notices-block'
import { PayablesBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/payables-block'
import { TodayBlock } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/today-block'
import { buildSetup, buildToday } from '@/lib/accounting/home'
import { buildProjection } from '@/lib/accounting/projection'
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

afterEach(() => {
  ui.readOnly = false
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
  } = {},
): HomeData {
  const canWrite = input.canWrite ?? true
  const summary = input.summary === undefined ? summaryOf() : input.summary
  const settings = input.settings ?? SETTINGS
  const recurring = input.recurring ?? [fixed({})]
  const integration = input.integration ?? []
  // Una fila por día, como manda la base: cargados hasta el 11, falta el de ayer (12/10).
  const projection = buildProjection(
    eachIsoDay('2026-10-01', '2026-10-31').map((day) => ({
      day,
      targetCents: null,
      note: null,
      closes: day < '2026-10-12' ? 1 : 0,
      salonCents: day < '2026-10-12' ? 90_000_000 : 0,
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

  it('sin saldos iniciales y sin movimientos no muestra «$ 0»: dice que todavía no sabe', async () => {
    const data = homeData({
      summary: untouchedSummary(),
      settings: { ...SETTINGS, openingStatus: 'pending' },
    })
    const html = renderToStaticMarkup(await HeroBlock({ data, tone: 'bosque' }))
    expect(html).toContain('Todavía no sé cuánta plata hay')
    expect(html).toContain('Cargar lo que hay')
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
    expect(html).not.toContain('Cargar lo que hay')
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

  it('con la puesta en marcha incompleta, arriba va su franja con lo próximo y «Ver todo»', async () => {
    const data = homeData({
      summary: untouchedSummary(),
      settings: { ...SETTINGS, openingStatus: 'pending', cuit: null },
    })
    const html = await render(data)
    expect(html).toMatch(/Puesta en marcha · \d+ de \d+/)
    expect(html).toContain('Cargá lo que hay hoy en cada caja')
    expect(html).toContain(`href="${BASE}/guias/como-arrancar"`)
    // Plegada sigue estando, con su avance y cómo volver a abrirla.
    const collapsed = await render(data, true)
    expect(collapsed).toMatch(/Puesta en marcha · \d+ de \d+/)
    expect(collapsed).toContain('Mostrar')
  })
})

describe('Resumen · «Lo que tenés que pagar»', () => {
  const render = async (data: HomeData) => renderToStaticMarkup(await PayablesBlock({ data }))

  it('la deuda en tres tramos, los que hay que pagar con su botón y los gastos fijos del mes', async () => {
    const html = await render(homeData())
    expect(html).toContain(`Tenés $${NB}604.000 vencido`)
    expect(html).toContain('Le debés a proveedores')
    expect(html).toContain('Vence esta semana')
    expect(html).toContain('Más adelante')
    expect(html).toContain('0003-00001100')
    expect(html).toContain('Te falta de gasto fijo')
    expect(html).toContain(`href="${BASE}/gastos-fijos"`)
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
    expect(html).not.toContain('Te falta de gasto fijo')
    expect(html).not.toContain(`$${NB}0<`)
  })

  it('la contadora ve los mismos renglones sin «Pagar»', async () => {
    ui.readOnly = true
    const html = await render(homeData({ canWrite: false }))
    expect(html).toContain('0003-00001100')
    expect(html).not.toContain('<button')
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
})
