// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollectionsView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/collections-view'
import { InvoicesView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/invoices-view'
import {
  MonthBody,
  type MonthData,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/month-view'
import { NetView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/net-view'
import { NightSheet } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/night-sheet'
import { ReceivablesList } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/receivables-list'
import { ReceivablesView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/receivables-view'
import { cashTitle } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/planilla'
import { OpenItems } from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/_components/open-items'
import { PartyData } from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/_components/party-data'
import ClientePage from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/page'
import { emptyDeductions } from '@/components/administracion/acciones/cobrar-cuenta'
import {
  MissingLine,
  PayerChoices,
  SettlementTicket,
} from '@/components/administracion/acciones/cobrar-piezas'
import {
  buildProjection,
  type ProjectionSourceDay,
  type TargetOfDay,
} from '@/lib/accounting/projection'
import type { DailyCloseCalendar } from '@/lib/accounting/queries/documents'
import type {
  OpenItemRow,
  PartyDetail,
  PartyList,
  PartyListRow,
} from '@/lib/accounting/queries/parties'
import { eachIsoDay } from '@/lib/dates'

/**
 * Ventas ya dibujada: lo que la pantalla le promete a cada uno. Las cuentas y
 * las oraciones tienen sus tests en `administracion-ventas-vista`, `-tipo-dia`,
 * `-copiar-mes`, `-noche` y `-cobrar`; acá se cuida lo que solo se ve armado: que
 * las columnas que pidieron los socios sigan ahí, que la contadora no reciba
 * NINGÚN botón de carga, que un mes vacío no muestre «$ 0» y que ningún texto diga
 * lo que no se dice.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
/** Lo que «devuelve la base» en las vistas que leen por su cuenta (cada test lo arma). */
const db = vi.hoisted(() => ({
  canWrite: true,
  parties: null as unknown,
  party: null as unknown,
  position: null as unknown,
  treasuries: [] as unknown[],
  methods: [] as unknown[],
  net: [] as unknown[],
  summary: [] as unknown[],
  documents: { rows: [], nextCursor: null, totalRows: 0, truncated: false } as unknown,
  points: [] as unknown[],
  arca: { state: 'on' } as unknown,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/ventas',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`)
  },
}))
// La marca de «ya lo toqué» usa `useLinkStatus`, que solo existe dentro de un `<Link>` vivo.
vi.mock('next/link', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useLinkStatus: () => ({ pending: false }),
}))
// Lo plegado y las hojas se dibujan con un portal, que en el servidor no existe: acá van en el lugar.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div data-sheet="">{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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
  useAccountingOptional: () => ({ readOnly: ui.readOnly }),
}))
// Las acciones son del servidor: para dibujar no hacen falta.
vi.mock('@/lib/accounting/actions/projection', () => ({
  saveSalesTargets: vi.fn(),
  saveDailyCash: vi.fn(),
}))
// El ticket de la noche pide su comprobante por su cuenta: acá no hay base.
vi.mock('@/lib/accounting/queries/documents', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getDocument: async () => null,
  listDocuments: async () => db.documents,
}))
// Las vistas que leen por su cuenta («Plata por cobrar», «Lo que llegó», «Facturas», la ficha).
vi.mock('@/lib/accounting/queries/parties', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listParties: async () => db.parties,
  listOpenItems: async () => [],
  getParty: async () => db.party,
  getPartyPosition: async () => db.position,
}))
vi.mock('@/lib/accounting/queries/treasury', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listTreasuryAccounts: async () => db.treasuries,
}))
vi.mock('@/lib/accounting/queries/settings', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listSalesMethods: async () => db.methods,
  listSalesPoints: async () => db.points,
}))
vi.mock('@/lib/accounting/queries/books', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getNetByMethod: async () => db.net,
  getSalesSummary: async () => db.summary,
}))
vi.mock('@/lib/arca/emit-queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getArcaEmissionSetup: async () => db.arca,
}))
vi.mock('@/components/administracion/cajas-ventas/page-access', () => ({
  requireAdminPage: async () => ({
    access: { tenant: { id: 'tenant' }, role: db.canWrite ? 'owner' : 'accountant' },
    canWrite: db.canWrite,
  }),
}))

afterEach(() => {
  ui.readOnly = false
  db.canWrite = true
  db.parties = null
  db.party = null
  db.position = null
  db.treasuries = []
  db.methods = []
  db.net = []
  db.summary = []
  db.points = []
  db.arca = { state: 'on' }
  db.documents = { rows: [], nextCursor: null, totalRows: 0, truncated: false }
})

const TODAY = '2026-10-13'
const BASE = '/hub/administracion'
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })

/** El HTML con espacios comunes (la plata lleva un espacio duro después del «$»). */
function html(node: ReactElement): string {
  return renderToStaticMarkup(node).replaceAll(String.fromCharCode(160), ' ')
}

/** Lo que se lee: sin etiquetas y con los espacios colapsados. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Los datos de un mes ─────────────────────────────────────────────────────

type MonthInput = {
  /** Hasta qué día (sin incluirlo) hay cierres cargados. */
  closedBefore?: string
  /** Objetivo por día (en centavos); `null`: el mes no tiene objetivos. */
  targetCents?: number | null
  booksStartDate?: string
  canWrite?: boolean
  /** Los objetivos del mes pasado, para «Copiar». */
  previousTargets?: TargetOfDay[]
}

function rowsOf(input: MonthInput): ProjectionSourceDay[] {
  const closedBefore = input.closedBefore ?? '2026-10-12'
  return eachIsoDay('2026-10-01', '2026-10-31').map((day) => {
    const closed = day < closedBefore && day >= (input.booksStartDate ?? '2026-10-01')
    return {
      day,
      targetCents: input.targetCents ?? null,
      note: null,
      closes: closed ? 1 : 0,
      salonCents: closed ? 90_000_000 : 0,
      deliveryCents: closed ? 10_000_000 : 0,
      eventsCents: 0,
      salonCommissionCents: closed ? 2_000_000 : 0,
      deliveryCommissionCents: closed ? 2_500_000 : 0,
      eventsCommissionCents: 0,
      cashCountedCents: null,
    }
  })
}

function calendarOf(rows: ProjectionSourceDay[], booksStartDate: string): DailyCloseCalendar {
  const days = rows.map((row) => ({
    date: row.day,
    status:
      row.closes > 0
        ? ('loaded' as const)
        : row.day < booksStartDate
          ? ('before_start' as const)
          : row.day > TODAY
            ? ('future' as const)
            : row.day === TODAY
              ? ('pending' as const)
              : ('missing' as const),
    closes:
      row.closes > 0
        ? [{ id: `cierre-${row.day}`, seq: 1, shift: null, totalCents: 100_000_000 }]
        : [],
    totalCents: row.closes > 0 ? 100_000_000 : null,
  }))
  const missing = days.find((d) => d.status === 'missing')
  return {
    month: '2026-10-01',
    days,
    soldCents: days.reduce((sum, d) => sum + (d.totalCents ?? 0), 0),
    loadedDays: days.filter((d) => d.status === 'loaded').length,
    missingDays: days.filter((d) => d.status === 'missing').length,
    firstMissingDate: missing?.date ?? null,
    serviceDay: TODAY,
    booksStartDate,
  }
}

function party(over: Partial<PartyListRow>): PartyListRow {
  return {
    partyId: 'p',
    partyName: 'Alguien',
    partyKind: 'card_processor',
    taxId: null,
    tradeName: null,
    active: true,
    systemKey: null,
    debtCents: 0,
    creditCents: 0,
    netCents: 0,
    notDueCents: 0,
    dueSoonCents: 0,
    overdue1to30Cents: 0,
    overdue31to60Cents: 0,
    overdue60PlusCents: 0,
    noDueCents: 0,
    overdueCents: 0,
    oldestDueDate: null,
    nextDueDate: null,
    lastIncreaseDate: null,
    trafficLight: 'green',
    trafficText: '',
    ...over,
  }
}

const PARTIES: PartyListRow[] = [
  party({
    partyId: 'posnet',
    partyName: 'Tarjetas de crédito (Posnet)',
    debtCents: 253_615_080,
    overdueCents: 147_995_440,
    oldestDueDate: '2026-10-07',
    nextDueDate: '2026-10-13',
  }),
  party({
    partyId: 'mp',
    partyName: 'Mercado Pago',
    partyKind: 'payment_wallet',
    debtCents: 40_000_000,
    overdueCents: 40_000_000,
    oldestDueDate: '2026-10-12',
  }),
]

function monthData(input: MonthInput = {}): MonthData {
  const booksStartDate = input.booksStartDate ?? '2026-10-01'
  const rows = rowsOf(input)
  const canWrite = input.canWrite ?? true
  return {
    calendar: ok(calendarOf(rows, booksStartDate)),
    projection: ok(rows),
    events: canWrite ? ok({ '2026-10-17': ['Noche de tacos'] }) : null,
    counts: canWrite ? ok({}) : null,
    treasuries: canWrite
      ? ok([{ id: 'caja', name: 'Caja', kind: 'cash' as const, active: true }])
      : null,
    previousTargets: canWrite ? ok(input.previousTargets ?? []) : null,
    catalog: null,
  }
}

async function renderMonth(
  input: MonthInput = {},
  over: {
    focus?: 'proyeccion' | 'caja' | null
    requestedDay?: string | null
    detail?: boolean
    today?: string
  } = {},
): Promise<string> {
  const canWrite = input.canWrite ?? true
  ui.readOnly = !canWrite
  return html(
    await MonthBody({
      data: monthData(input),
      tenantId: 'tenant',
      tenantSlug: 'hub',
      base: BASE,
      today: over.today ?? TODAY,
      serviceDay: over.today ?? TODAY,
      range: { month: '2026-10', from: '2026-10-01', to: '2026-10-31' },
      monthParam: null,
      requestedDay: over.requestedDay ?? null,
      focus: over.focus ?? null,
      initialDetail: over.detail ?? over.focus != null,
      canWrite,
    }),
  )
}

/** Las columnas que pidieron los socios el 12/10 y las de ventas contra caja: «nada de eso se pierde». */
const DETAIL_COLUMNS = [
  'Venta bar',
  'Delivery',
  'Comisión delivery',
  'Comisiones posnet',
  'Venta real',
  'Venta neta',
  'Objetivo acumulado',
  'Venta acumulada',
  'Entró a caja',
  'Diferencia',
  'Evento y nota',
]

/** El HTML de un renglón de la tabla: el que tiene la celda de ese día. */
function rowOf(markup: string, day: string): string {
  const rows = markup.split('<tr').filter((row) => text(`<tr${row}`).startsWith(day))
  const [row] = rows
  if (!row) throw new Error(`sin renglón para ${day}`)
  return row
}

// ─── La planilla del mes ─────────────────────────────────────────────────────

describe('la planilla del mes', () => {
  it('los tres números de arriba y las columnas, sin el almanaque ni el héroe', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    const read = text(markup)
    for (const label of ['Objetivo del mes', 'Vendido', 'Falta vender']) {
      expect(read).toContain(label)
    }
    for (const column of ['Día', 'Tipo', 'Objetivo', 'Cumpl.']) expect(read).toContain(column)
    expect(read).toContain('Objetivo a hoy')
    // Lo que había antes ya no está: ni la hoja verde, ni el almanaque, ni el ticket al costado.
    expect(markup).not.toContain('adm-hero')
    for (const gone of ['Noche por noche', 'Vas vendiendo', 'Armar el objetivo', 'almanaque']) {
      expect(read).not.toContain(gone)
    }
  })

  it('un renglón por día: el día corto, su tipo y el objetivo que se escribe', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    expect(markup.split('aria-label="Objetivo del ').length - 1).toBe(31)
    const row = rowOf(markup, 'lu 05')
    expect(row).toContain('aria-label="Objetivo del lunes 05/10"')
    expect(row).toContain('value="1.500.000"')
    expect(text(`<tr${row}`)).toContain('Normal')
  })

  it('el cumplimiento va en verde o en rojo, con su número', async () => {
    const low = rowOf(await renderMonth({ targetCents: 150_000_000 }), 'lu 05')
    // $ 955.000 netos contra $ 1.500.000.
    expect(text(`<tr${low}`)).toContain('$ 955.000')
    expect(text(`<tr${low}`)).toContain('64 %')
    expect(low).toContain('text-destructive')
    const high = rowOf(await renderMonth({ targetCents: 90_000_000 }), 'lu 05')
    expect(text(`<tr${high}`)).toContain('106 %')
    expect(high).toContain('text-success')
  })

  it('un día sin cierre no es un cero ni un 0 %', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    const row = text(`<tr${rowOf(markup, 'lu 12')}`)
    expect(row).not.toContain('$ 0')
    expect(row).not.toContain('0 %')
    expect(row).toContain('Cargar cierre')
  })

  it('«Ver cierre» abre la noche; «Cargar cierre» lleva a cargarlo', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    const loaded = rowOf(markup, 'lu 05')
    expect(loaded).toContain(`href="${BASE}/ventas?dia=2026-10-05"`)
    expect(text(`<tr${loaded}`)).toContain('Ver cierre')
    const missing = rowOf(markup, 'lu 12')
    expect(missing).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`)
    expect(text(`<tr${rowOf(markup, 'ma 13')}`)).toContain('Cargar cierre')
    // Lo que todavía no llegó no tiene nada que hacer.
    expect(text(`<tr${rowOf(markup, 'ma 20')}`)).not.toMatch(/Cargar cierre|Ver cierre/)
  })

  it('una sola acción llena: el cierre que toca es el primero que falta', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    expect(rowOf(markup, 'lu 12')).toContain('bg-primary')
    // El de hoy también falta, pero va en contorno.
    expect(rowOf(markup, 'ma 13')).not.toContain('bg-primary ')
  })

  it('hoy lleva la raya a la izquierda, y solo hoy', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    expect(markup.split('shadow-[inset_3px_0_0_var(--color-primary)]').length - 1).toBe(1)
    expect(rowOf(markup, 'ma 13')).toContain('shadow-[inset_3px_0_0_var(--color-primary)]')
    expect(text(`<tr${rowOf(markup, 'ma 13')}`)).toContain('(hoy)')
  })

  it('el total lleva la doble raya', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    expect(markup).toContain('adm-double-rule')
    // 31 días de $ 1.500.000 y 11 noches de $ 955.000.
    expect(markup).toContain('$ 46.500.000')
    expect(markup).toContain('$ 10.505.000')
  })

  it('el evento del calendario va chiquito debajo del día', async () => {
    const markup = await renderMonth()
    expect(rowOf(markup, 'sá 17')).toContain('Noche de tacos')
    expect(rowOf(markup, 'sá 17')).toContain('<small')
  })

  it('debajo, la regla del tipo y lo que se hace con la planilla', async () => {
    const read = text(await renderMonth({ targetCents: 150_000_000 }))
    expect(read).toContain('Fuerte: 20 % arriba del promedio. Flojo: 20 % abajo.')
    expect(read).toContain('Pegar una lista')
    expect(read).toContain('Ver detalle')
  })

  it('«Copiar» se ofrece si el mes pasado tiene de dónde', async () => {
    const previousTargets = [{ day: '2026-09-07', targetCents: 100_000_000 }]
    expect(text(await renderMonth({ targetCents: 150_000_000, previousTargets }))).toContain(
      'Copiar septiembre',
    )
    expect(text(await renderMonth({ targetCents: 150_000_000 }))).not.toContain('Copiar')
  })

  it('el «⋯» lleva a Facturas y a Cobros, y exporta el subdiario', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    expect(markup).toContain(`href="${BASE}/ventas?tab=facturas"`)
    expect(markup).toContain(`href="${BASE}/ventas?tab=cobros"`)
    expect(text(markup)).toContain('Exportar subdiario de ventas')
  })

  it('se puede ir al mes que viene a cargar el objetivo', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    // La flecha llega a lo que viene: no queda trabada en el mes de hoy.
    const next = markup.match(/<button[^>]*aria-label="Mes siguiente: Noviembre 2026"[^>]*>/)?.[0]
    expect(next).toBeDefined()
    expect(next).not.toMatch(/ disabled=""/)
  })

  it('un cierre que falta del mes pasado no tiene renglón acá: se dice arriba', async () => {
    const data = monthData({ targetCents: 150_000_000 })
    const calendar = calendarOf(rowsOf({ targetCents: 150_000_000 }), '2026-09-01')
    ui.readOnly = false
    const markup = html(
      await MonthBody({
        data: { ...data, calendar: ok({ ...calendar, firstMissingDate: '2026-09-29' }) },
        tenantId: 'tenant',
        tenantSlug: 'hub',
        base: BASE,
        today: TODAY,
        serviceDay: TODAY,
        range: { month: '2026-10', from: '2026-10-01', to: '2026-10-31' },
        monthParam: null,
        requestedDay: null,
        focus: null,
        initialDetail: false,
        canWrite: true,
      }),
    )
    expect(text(markup)).toContain('Falta el cierre del mar 29/09')
    expect(markup).toContain(`href="${BASE}/ventas/cierre?fecha=2026-09-29"`)
  })
})

describe('«Ver detalle»', () => {
  it('se esconde por defecto: nada de eso está en la tabla', async () => {
    const read = text(await renderMonth({ targetCents: 150_000_000 }))
    for (const column of DETAIL_COLUMNS) expect(read, column).not.toContain(column)
    expect(read).not.toContain('Ventas contra caja')
  })

  it('suma las columnas de los socios y las de ventas contra caja: nada se pierde', async () => {
    const read = text(await renderMonth({ targetCents: 150_000_000 }, { detail: true }))
    for (const column of DETAIL_COLUMNS) expect(read, column).toContain(column)
    expect(read).toContain('Ventas contra caja')
    expect(read).toContain('Todavía no anotaste lo que entró ninguna noche')
    expect(read).toContain('A 11 días con cierre les falta cargar lo que entró.')
    expect(read).toContain('Lo que descontaron de verdad está en «Lo que llegó».')
  })

  it('los números de cada columna son los de su planilla', async () => {
    const row = text(
      `<tr${rowOf(await renderMonth({ targetCents: 150_000_000 }, { detail: true }), 'lu 05')}`,
    )
    // Venta bar $ 900.000 · Delivery $ 100.000 · Comisión delivery $ 25.000 · Posnet $ 20.000 ·
    // Venta real $ 880.000 · Venta neta $ 955.000 · Acumulados de cinco días.
    for (const value of [
      '$ 900.000',
      '$ 100.000',
      '$ 25.000',
      '$ 20.000',
      '$ 880.000',
      '$ 955.000',
      '$ 7.500.000',
      '$ 4.775.000',
    ]) {
      expect(row, value).toContain(value)
    }
  })

  it('«Entró a caja» se carga con su diálogo de siempre, y la diferencia dice qué falta', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 }, { detail: true })
    const row = rowOf(markup, 'lu 05')
    expect(row).toContain('aria-label="Cargar lo que entró el lunes 05/10"')
    expect(text(`<tr${row}`)).toContain('Falta cargar')
    // Lo que todavía no llegó no se puede comparar.
    expect(rowOf(markup, 'ma 20')).not.toContain('lo que entró')
  })

  it('la nota del día se sigue escribiendo', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 }, { detail: true })
    expect(rowOf(markup, 'ma 20')).toContain('aria-label="Agregar una nota al martes 20/10"')
  })

  it('los links de siempre abren la planilla con el detalle', async () => {
    for (const focus of ['proyeccion', 'caja'] as const) {
      const read = text(await renderMonth({ targetCents: 150_000_000 }, { focus }))
      expect(read, focus).toContain('Entró a caja')
    }
  })
})

describe('la noche se abre al tocar «Ver cierre»', () => {
  it('sin `?dia=` no hay hoja abierta', async () => {
    expect(await renderMonth()).not.toContain('data-sheet')
  })

  it('con `?dia=` de una noche con cierre, la hoja trae esa noche', async () => {
    const read = text(await renderMonth({}, { requestedDay: '2026-10-05' }))
    expect(read).toContain('La noche del lunes 05/10')
    expect(read).toContain('Lunes 5 de octubre')
    expect(read).toContain('Vendido esa noche')
    expect(read).toContain('Ventas contra caja')
  })

  it('un día sin cierre no abre nada', async () => {
    expect(await renderMonth({}, { requestedDay: '2026-10-12' })).not.toContain('data-sheet')
    expect(await renderMonth({}, { requestedDay: 'cualquiera' })).not.toContain('data-sheet')
  })
})

describe('un mes sin objetivos', () => {
  const previousTargets = [
    { day: '2026-09-07', targetCents: 100_000_000 },
    { day: '2026-09-14', targetCents: 100_000_000 },
  ]

  it('la misma tabla con las celdas vacías y «Copiar» el mes pasado', async () => {
    const markup = await renderMonth({ closedBefore: '2026-10-01', previousTargets })
    const read = text(markup)
    expect(read).toContain('Octubre todavía no tiene objetivos.')
    expect(read).toContain('Copiar septiembre')
    expect(markup.split('aria-label="Objetivo del ').length - 1).toBe(31)
    expect(rowOf(markup, 'lu 05')).toContain('value=""')
    expect(read).toContain('Sin objetivo')
  })

  it('«Copiar» es la acción llena; los cierres quedan en contorno', async () => {
    const markup = await renderMonth({ closedBefore: '2026-10-01', previousTargets })
    expect(rowOf(markup, 'ma 13')).not.toContain('bg-primary ')
  })

  it('sin nada que copiar, ofrece pegar la lista', async () => {
    const read = text(await renderMonth({ closedBefore: '2026-10-01' }))
    expect(read).toContain('Escribilos día por día o pegá la columna de tu Excel.')
    expect(read).not.toContain('Copiar')
    expect(read).toContain('Pegar una lista')
  })

  it('no dice «$ 0» ni «objetivo $ 0»: un objetivo que falta no es un cero', async () => {
    for (const detail of [false, true]) {
      const markup = await renderMonth({ closedBefore: '2026-10-01' }, { detail })
      expect(markup).not.toMatch(/\$ 0(?![\d.,])/)
    }
  })
})

describe('el bar recién arrancado (así está HUB)', () => {
  const input = { closedBefore: '2026-10-01', booksStartDate: '2026-10-12' }

  it('no muestra «$ 0» por ningún lado', async () => {
    expect(await renderMonth(input)).not.toMatch(/\$ 0(?![\d.,])/)
  })

  it('la fecha de arranque manda en los cierres: el objetivo se carga en cualquier día', async () => {
    const markup = await renderMonth(input)
    expect(text(markup)).toContain('Los cierres arrancan el 12/10.')
    // Antes del arranque no se carga el cierre, pero el objetivo sí se escribe.
    const before = rowOf(markup, 'lu 05')
    expect(before).not.toContain('/ventas/cierre')
    expect(before).toContain('aria-label="Objetivo del lunes 05/10"')
    // Desde el arranque, el que falta y el de hoy.
    expect(rowOf(markup, 'lu 12')).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`)
    expect(rowOf(markup, 'ma 13')).toContain(`href="${BASE}/ventas/cierre?fecha=2026-10-13"`)
  })

  it('un mes que empezó entero no dice desde cuándo', async () => {
    expect(text(await renderMonth({ targetCents: 150_000_000 }))).not.toContain(
      'Los cierres arrancan',
    )
  })
})

// ─── La contadora ────────────────────────────────────────────────────────────

const WRITE_WORDS = [
  'Ya entró',
  'Me entró plata',
  'Contar Mercado Pago',
  'Pegar una lista',
  'Copiar',
  'Anotar lo que entró',
  'Cambiar lo que entró',
  'Cargar otro turno',
  'Cargar cierre',
  'Cargar el cierre',
  'Agregar nota',
]

describe('la contadora (solo lectura) no ve ningún botón de carga', () => {
  it('la planilla: ni un link a cargar un cierre, ni celdas que se escriben', async () => {
    for (const over of [{}, { focus: 'proyeccion' as const }, { focus: 'caja' as const }]) {
      const markup = await renderMonth({ targetCents: 150_000_000, canWrite: false }, over)
      expect(markup).not.toContain('/ventas/cierre')
      // Una celda que se escribe es un campo con su nombre.
      expect(markup).not.toContain('aria-label="Objetivo del')
      const read = text(markup)
      for (const word of WRITE_WORDS) expect(read).not.toContain(word)
      expect(markup).not.toContain('Cargar el objetivo del')
      expect(markup).not.toContain('. Cambiar')
    }
  })

  it('ve los mismos números y su detalle, sin el calendario del bar', async () => {
    const markup = await renderMonth(
      { targetCents: 150_000_000, canWrite: false },
      { detail: true },
    )
    const read = text(markup)
    expect(read).toContain('Objetivo del mes')
    expect(read).toContain('$ 1.500.000')
    expect(read).toContain('Sin cargar')
    expect(read).toContain('Todavía no se anotó lo que entró ninguna noche')
    expect(read).toContain('Ver cierre')
    expect(read).toContain('Exportar subdiario de ventas')
    // No lee el calendario del bar: sin eventos.
    expect(markup).not.toContain('Noche de tacos')
  })

  it('el mes sin objetivos se lo dice, sin ofrecerle nada', async () => {
    const markup = await renderMonth({ canWrite: false })
    expect(text(markup)).toContain('Octubre todavía no tiene objetivos.')
    expect(text(markup)).not.toContain('Escribilos')
    expect(markup).not.toContain('/ventas/cierre')
  })

  it('un día sin cierre le dice que no lo tiene', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000, canWrite: false })
    expect(text(`<tr${rowOf(markup, 'lu 12')}`)).toContain('Sin cierre')
  })

  it('«Por cobrar»: los mismos renglones, sin «Ya entró» ni «Contar»', () => {
    const wallets = new Map([['mp', { treasuryId: 'caja-mp', name: 'Mercado Pago' }]])
    const list = (canWrite: boolean) => {
      ui.readOnly = !canWrite
      return html(
        <ReceivablesList
          rows={PARTIES}
          wallets={wallets}
          base={BASE}
          today={TODAY}
          canWrite={canWrite}
        />,
      )
    }
    const owner = list(true)
    expect(text(owner)).toContain('Ya entró')
    expect(text(owner)).toContain('Contar Mercado Pago')
    // Lo de Mercado Pago no figura como atrasado.
    expect(text(owner)).toContain('Falta contarla')
    expect(owner.split('Atrasado').length - 1).toBe(1)
    expect(text(owner)).toContain('6 días tarde')
    // El nombre lleva a la ficha, y el total lleva la doble raya.
    expect(owner).toContain(`href="${BASE}/ventas/clientes/posnet"`)
    expect(owner).toContain('adm-double-rule')
    expect(text(owner)).toContain('$ 2.936.151')
    const reader = list(false)
    expect(text(reader)).toContain('Tarjetas de crédito (Posnet)')
    expect(text(reader)).not.toContain('Ya entró')
    expect(text(reader)).not.toContain('Contar Mercado Pago')
    expect(reader).not.toContain('<button')
  })

  it('la ficha: lo pendiente agrupado, sin botones de cobrar', () => {
    const item = (over: Partial<OpenItemRow>): OpenItemRow => ({
      lineId: 'l',
      documentId: 'd',
      documentSeq: 1,
      documentKind: 'sales_close',
      documentLabel: 'Cierre del día',
      accountId: 'a',
      accountCode: null,
      accountName: null,
      side: 'debt',
      salesMethodId: 'credito',
      entryDate: '2026-09-27',
      dueDate: '2026-10-07',
      memo: null,
      amountCents: 100,
      openCents: 147_995_440,
      daysOverdue: 6,
      bucket: 'overdue_1_30',
      ...over,
    })
    const items = [
      item({ lineId: 'a' }),
      item({ lineId: 'b', dueDate: '2026-10-08', openCents: 100_000 }),
      item({ lineId: 'c', dueDate: '2026-10-15', openCents: 200_000 }),
    ]
    const ficha = (canCollect: boolean) => {
      ui.readOnly = !canCollect
      return html(
        <OpenItems
          name="Tarjetas de crédito (Posnet)"
          partyId="posnet"
          debtItems={items}
          creditItems={[]}
          methodNames={new Map([['credito', 'Crédito']])}
          today={TODAY}
          base={BASE}
          isCustomer={false}
          canCollect={canCollect}
        />,
      )
    }
    const owner = text(ficha(true))
    expect(owner).toContain('Ya tendría que haber llegado')
    expect(owner).toContain('Llega esta semana')
    expect(owner).toContain('Crédito · venta del 27/09')
    expect(owner).toContain('Ya entró todo lo atrasado')
    const reader = ficha(false)
    expect(text(reader)).toContain('Ya tendría que haber llegado')
    expect(text(reader)).not.toContain('Ya entró')
    expect(reader).not.toContain('<button')
  })

  it('la noche abierta: ve el objetivo y lo que entró, sin poder cambiarlos', () => {
    ui.readOnly = true
    const projection = buildProjection(rowsOf({ targetCents: 150_000_000 }), { serviceDay: TODAY })
    const day = projection.days.find((d) => d.day === '2026-10-10')
    const markup = html(
      <NightSheet
        tenantId="tenant"
        base={BASE}
        today={TODAY}
        day="2026-10-10"
        monthName="octubre"
        projectionDay={day ?? null}
        closes={[{ id: 'cierre', seq: 1, shift: null, totalCents: 100_000_000 }]}
        events={[]}
        counts={{}}
        treasuries={[]}
        canWrite={false}
      />,
    )
    const read = text(markup)
    expect(read).toContain('Sábado 10 de octubre')
    expect(read).toContain('Vendido esa noche')
    expect(read).toContain('$ 1.500.000')
    // La pastilla dice una sola cosa (no «64 % · 36 % abajo»).
    expect(read).toContain('36 % abajo del objetivo')
    expect(read).not.toContain('64 % · 36 %')
    expect(read).toContain('Todavía no se anotó lo que entró ese día.')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('/ventas/cierre')
  })
})

// ─── La contadora, vista por vista ───────────────────────────────────────────

/** Los destinos que cargan o cambian algo: ninguno le llega a quien solo mira. */
const WRITE_HREFS = [
  '/ventas/cierre',
  '/ventas/nueva-factura',
  '/ajustes?tab=cajas',
  '/ajustes?tab=medios',
  '/ajustes?tab=puntos-de-venta',
  '/ajustes?tab=participes',
]

function expectNoWriteControls(markup: string) {
  const read = text(markup)
  for (const word of WRITE_WORDS) expect(read, word).not.toContain(word)
  for (const href of WRITE_HREFS) expect(markup, href).not.toContain(href)
}

function as(canWrite: boolean) {
  ui.readOnly = !canWrite
  db.canWrite = canWrite
}

describe('la contadora no escribe: las vistas que leen por su cuenta', () => {
  const MP_BOX = {
    id: 'caja-mp',
    name: 'Mercado Pago',
    kind: 'wallet',
    bankPartyId: 'mp',
    active: true,
  }
  const METHODS = [
    {
      name: 'Efectivo',
      kind: 'treasury',
      settlementDays: 0,
      partyName: null,
      treasuryName: 'Caja',
      active: true,
    },
    {
      name: 'Crédito',
      kind: 'receivable',
      settlementDays: 10,
      partyName: 'Posnet',
      treasuryName: null,
      active: true,
    },
  ]
  const shared = (canWrite: boolean) => ({
    tenantId: 'tenant',
    tenantSlug: 'hub',
    base: BASE,
    today: TODAY,
    sp: {},
    canWrite,
  })

  it('«Por cobrar» con deuda: «Me entró plata» solo para quien carga', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      db.parties = {
        rows: PARTIES,
        totals: {
          debtCents: 293_615_080,
          overdueCents: 187_995_440,
          dueSoonCents: 0,
          creditCents: 0,
          count: 2,
        },
        asOf: TODAY,
      } satisfies PartyList
      db.treasuries = [MP_BOX]
      db.methods = METHODS
      return html(await ReceivablesView(shared(canWrite)))
    }
    const owner = text(await view(true))
    expect(owner).toContain('Te tienen que depositar')
    expect(owner).toContain('Atrasado')
    expect(owner).toContain('Me entró plata')
    expect(owner).toContain('Ya entró')
    expect(owner).toContain('Contar Mercado Pago')
    expect(owner).toContain('Cambiar los plazos')
    for (const column of ['Quién', 'Llega', 'A cobrar']) expect(owner).toContain(column)
    // Lo que no se usa todos los días queda plegado.
    expect(owner).toContain('Cuándo llega, día por día')
    expect(owner).toContain('¿Cuándo te paga cada medio?')
    const reader = await view(false)
    expect(text(reader)).toContain('Te tienen que depositar')
    expect(text(reader)).toContain('Tarjetas de crédito (Posnet)')
    expectNoWriteControls(reader)
    expect(text(reader)).not.toContain('Cambiar los plazos')
  })

  it('«Por cobrar» no tiene héroe: los números de arriba y la tabla', async () => {
    as(true)
    db.parties = {
      rows: PARTIES,
      totals: {
        debtCents: 293_615_080,
        overdueCents: 187_995_440,
        dueSoonCents: 0,
        creditCents: 0,
        count: 2,
      },
      asOf: TODAY,
    } satisfies PartyList
    db.treasuries = [MP_BOX]
    const markup = html(await ReceivablesView(shared(true)))
    expect(markup).not.toContain('adm-hero')
    expect(markup).toContain('aria-label="Totales"')
    expect(markup).toContain('$ 2.936.151')
    // Lo de Mercado Pago va en su número, no sumado a lo atrasado.
    expect(text(markup)).toContain('En Mercado Pago, falta contarla')
    expect(markup).toContain('$ 1.479.954')
  })

  it('«Por cobrar» en el bar recién arrancado: sin «$ 0» y sin botones para quien mira', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      db.parties = {
        rows: [],
        totals: { debtCents: 0, overdueCents: 0, dueSoonCents: 0, creditCents: 0, count: 0 },
        asOf: TODAY,
      } satisfies PartyList
      db.treasuries = []
      db.methods = METHODS
      return html(await ReceivablesView(shared(canWrite)))
    }
    const owner = await view(true)
    expect(text(owner)).toContain('Todavía no hay plata por cobrar')
    expect(text(owner)).toContain('Así te pagan hoy')
    expect(owner).toContain(`href="${BASE}/ventas/cierre"`)
    expect(text(owner)).toContain('Agregar el banco')
    expect(owner).not.toMatch(/\$ 0(?![\d.,])/)
    const reader = await view(false)
    expect(text(reader)).toContain('Todavía no hay plata por cobrar')
    expectNoWriteControls(reader)
    expect(text(reader)).not.toContain('Agregar el banco')
    expect(text(reader)).not.toContain('Cambiar los plazos')
  })

  it('«Lo que llegó» sin nada: una oración, y «Me entró plata» solo para quien carga', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      return html(await NetView(shared(canWrite)))
    }
    const owner = text(await view(true))
    expect(owner).toContain('Todavía no hay ventas ni cobros en octubre')
    expect(owner).toContain('Me entró plata')
    const reader = await view(false)
    expect(text(reader)).toContain('Todavía no hay ventas ni cobros en octubre')
    expectNoWriteControls(reader)
  })

  const NET_ROW = {
    methodId: 'credito',
    methodName: 'Crédito',
    channel: 'salon',
    soldCents: 75_251_600,
    commissionCents: 0,
    commissionVatCents: 0,
    withholdingsCents: 0,
    otherChargesCents: 0,
    unexplainedCents: 0,
    creditedCents: 0,
    pendingCents: 75_251_600,
    discountBp: null,
  }

  it('«Lo que llegó» cuando todavía no llegó nada: sin «$ 0» como número grande', async () => {
    as(true)
    db.net = [NET_ROW]
    const markup = html(await NetView(shared(true)))
    const read = text(markup)
    expect(read).toContain('Sigue en camino')
    expect(read).toContain('$ 752.516')
    expect(markup).not.toMatch(/\$ 0(?![\d.,])/)
  })

  it('«Lo que llegó»: los números de arriba y un renglón por medio, sin héroes', async () => {
    as(true)
    db.net = [
      { ...NET_ROW, commissionCents: 2_000_000, creditedCents: 50_000_000, discountBp: 385 },
    ]
    const markup = html(await NetView(shared(true)))
    const read = text(markup)
    for (const label of ['Te llegó', 'Te descontaron', 'Sigue en camino']) {
      expect(read).toContain(label)
    }
    for (const column of ['Medio', 'Vendido', 'Comisión', 'En camino', 'Descuento']) {
      expect(read).toContain(column)
    }
    expect(read).not.toContain('Retenciones')
    expect(read).toContain('3,85 %')
    expect(markup).toContain('adm-double-rule')
    expect(markup).not.toContain('adm-hero')
    // A los cobros se llega desde el pie, con el mismo período.
    expect(markup).toContain(`${BASE}/ventas?tab=cobros&amp;mes=2026-10`)
    expect(read).toContain('Exportar')
  })

  it('«Cobros» sin nada: lo dice según quién mira', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      return html(await CollectionsView(shared(canWrite)))
    }
    const owner = text(await view(true))
    expect(owner).toContain('No hay cobros en')
    expect(owner).toContain('Me entró plata')
    const reader = await view(false)
    expect(text(reader)).toContain('los dueños lo anotan')
    expect(text(reader)).toContain('Exportar subdiario de cobranzas')
    expectNoWriteControls(reader)
  })

  it('«Cobros»: quién, a dónde entró, cuánto entró y cuánto descontaron, con su total', async () => {
    as(true)
    db.documents = {
      rows: [
        {
          id: 'doc-1',
          kind: 'collection',
          title: 'Cobro',
          partyName: 'Tarjetas de crédito (Posnet)',
          accountingDate: '2026-10-08',
          totalCents: 191_546_500,
          status: 'posted',
          means: [{ label: 'Banco Nación', amountCents: 178_800_000 }],
        },
        {
          id: 'doc-2',
          kind: 'collection',
          title: 'Cobro',
          partyName: 'Rappi',
          accountingDate: '2026-10-09',
          totalCents: 10_000_000,
          status: 'voided',
          means: [{ label: 'Banco Nación', amountCents: 10_000_000 }],
        },
      ],
      nextCursor: null,
      totalRows: 2,
      truncated: false,
    }
    const markup = html(await CollectionsView(shared(true)))
    const read = text(markup)
    for (const value of ['Banco Nación', '$ 1.788.000', '$ 127.465', 'Anulado', 'Jue 08/10']) {
      expect(read, value).toContain(value)
    }
    expect(markup).toContain(`href="${BASE}/comprobantes/doc-1"`)
    expect(markup).toContain('adm-double-rule')
  })

  it('«Cobros» con más de una página no suma lo que se ve: no sería el total', async () => {
    as(true)
    db.documents = {
      rows: [
        {
          id: 'doc-1',
          kind: 'collection',
          title: 'Cobro',
          partyName: 'Rappi',
          accountingDate: '2026-10-08',
          totalCents: 100_000,
          status: 'posted',
          means: [{ label: 'Banco', amountCents: 100_000 }],
        },
      ],
      nextCursor: 'siguiente',
      totalRows: 1,
      truncated: false,
    }
    const markup = html(await CollectionsView(shared(true)))
    expect(markup).not.toContain('adm-double-rule')
    expect(markup).not.toContain('aria-label="Totales"')
    expect(text(markup)).toContain('Ver los siguientes')
  })

  it('«Facturas»: los accesos de carga (cierre, puntos de venta, factura con ARCA) solo para quien carga', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      db.points = []
      db.arca = { state: 'on' }
      return html(await InvoicesView(shared(canWrite)))
    }
    const owner = await view(true)
    expect(owner).toContain(`href="${BASE}/ventas/cierre"`)
    expect(owner).toContain(`href="${BASE}/ajustes?tab=puntos-de-venta"`)
    expect(owner).toContain(`href="${BASE}/ventas/nueva-factura"`)
    const reader = await view(false)
    expect(text(reader)).toContain('¿Cómo se factura acá?')
    expect(text(reader)).toContain('Exportar ventas sin factura')
    expect(text(reader)).toContain('Exportar subdiario de ventas')
    expectNoWriteControls(reader)
    expect(text(reader)).not.toContain('Hacer una factura con ARCA')
  })

  it('«Facturas»: lo vendido, con factura y sin factura, por canal y con su doble raya', async () => {
    as(true)
    db.points = [{ number: 3 }]
    db.summary = [
      {
        month: '2026-10-01',
        channel: 'salon',
        soldCents: 710_128_800,
        invoicedNetCents: 429_780_000,
        vatCents: 90_253_800,
        uninvoicedCents: 190_095_000,
      },
    ]
    const markup = html(await InvoicesView(shared(true)))
    const read = text(markup)
    for (const label of ['Total vendido', 'Con factura', 'Sin factura', 'Por canal']) {
      expect(read, label).toContain(label)
    }
    expect(read).toContain('$ 7.101.288,00')
    expect(markup).toContain('adm-double-rule')
    // Las dos partes quedan en los libros: ninguna se oculta.
    expect(read).toContain('Las dos partes quedan registradas en los libros.')
    expect(markup).not.toContain('adm-hero')
  })

  it('«Facturas» sin ventas no dice «$ 0»', async () => {
    as(true)
    const markup = html(await InvoicesView(shared(true)))
    expect(text(markup)).toContain('Todavía no hay ventas en')
    expect(markup).not.toMatch(/\$ 0(?![\d.,])/)
  })

  const PARTY: PartyDetail = {
    id: 'posnet',
    kind: 'card_processor',
    name: 'Tarjetas de crédito (Posnet)',
    tradeName: null,
    taxIdType: 'cuit',
    taxId: null,
    ivaCondition: 'responsable_inscripto',
    email: null,
    phone: null,
    address: null,
    paymentTermDays: 10,
    defaultAccountId: null,
    defaultAccountName: null,
    defaultVoucherType: null,
    payableAccountId: 'p',
    payableAccountName: null,
    receivableAccountId: 'r',
    receivableAccountName: 'Tarjetas a cobrar',
    commissionVatMode: 'per_settlement',
    commissionBp: 180,
    iibbWithholdingBp: null,
    vatWithholdingBp: null,
    incomeTaxWithholdingBp: null,
    sircupaBp: null,
    notes: null,
    active: true,
    systemKey: null,
    contacts: [],
    deliveryDays: [],
    orderLeadDays: null,
    updatedAt: '2026-10-01T00:00:00Z',
    group: 'receivables',
  }

  it('la ficha: «Ya entró» (o «Contar Mercado Pago») al lado de lo que te debe, solo para quien carga', async () => {
    const ficha = async (canWrite: boolean, party: PartyDetail = PARTY) => {
      as(canWrite)
      db.party = party
      db.position = {
        partyId: party.id,
        group: 'receivables',
        asOf: TODAY,
        debtCents: 253_615_080,
        creditCents: 0,
        netCents: 253_615_080,
        aging: {
          overdueCents: 147_995_440,
          oldestDueDate: '2026-10-07',
          nextDueDate: '2026-10-15',
        },
        traffic: { light: 'red', text: '', reason: 'overdue', days: 6 },
        debtItems: [],
        creditItems: [],
      }
      db.treasuries = [MP_BOX]
      return html(
        await ClientePage({
          params: Promise.resolve({ tenantSlug: 'hub', id: party.id }),
          searchParams: Promise.resolve({}),
        }),
      )
    }
    const owner = text(await ficha(true))
    expect(owner).toContain('Te debe')
    expect(owner).toContain('Ya entró')
    const reader = await ficha(false)
    expect(text(reader)).toContain('Te debe')
    expect(text(reader)).toContain('$ 2.536.151')
    expectNoWriteControls(reader)

    const wallet: PartyDetail = { ...PARTY, id: 'mp', kind: 'payment_wallet', name: 'Mercado Pago' }
    expect(text(await ficha(true, wallet))).toContain('Contar Mercado Pago')
    expectNoWriteControls(await ficha(false, wallet))
  })

  it('la ficha › Datos: el link a Ajustes solo para quien carga', () => {
    const data = (canWrite: boolean) =>
      html(<PartyData party={PARTY} isCustomer={false} base={BASE} canWrite={canWrite} />)
    expect(data(true)).toContain(`href="${BASE}/ajustes?tab=participes"`)
    expect(text(data(true))).toContain('Ajustes › Medios de cobro')
    const reader = data(false)
    expect(text(reader)).toContain('Cuánto te descuenta')
    expect(reader).not.toContain('/ajustes')
  })

  it('a quien solo mira no se le dice «anotaste»', () => {
    const none = { comparedDays: 0, diffCents: 0 }
    expect(cashTitle(none)).toBe('Todavía no anotaste lo que entró ninguna noche')
    expect(cashTitle(none, { reader: true })).toBe('Todavía no se anotó lo que entró ninguna noche')
  })
})

// ─── La hoja de cobrar ───────────────────────────────────────────────────────

describe('las piezas de «Registrar un cobro»', () => {
  it('quién te pagó: un radio por pagador, con lo que debe', () => {
    const markup = html(
      <PayerChoices
        name="payer"
        labelledBy="who"
        value="posnet"
        onPick={() => {}}
        cards={[
          {
            id: 'posnet',
            name: 'Tarjetas de crédito (Posnet)',
            kind: 'card_processor',
            debtCents: 253_615_100,
            consequence: 'Te debe $ 2.536.151 · atrasado desde el 07/10',
          },
          {
            id: 'pya',
            name: 'PedidosYa',
            kind: 'delivery_platform',
            debtCents: 64_458_400,
            consequence: 'Te debe $ 644.584',
          },
        ]}
      />,
    )
    expect(markup).toContain('role="radiogroup"')
    expect(markup.split('type="radio"').length - 1).toBe(2)
    expect(markup).toContain('atrasado desde el 07/10')
  })

  it('lo que falta explicar ofrece tres salidas; lo que sobra, dejarlo a cuenta', () => {
    const line = (missing: number | null, received: number | null) =>
      text(
        html(
          <MissingLine
            missing={missing}
            received={received}
            estimated
            error={null}
            onCommission={() => {}}
            onOther={() => {}}
            onDifference={() => {}}
            onOnAccount={() => {}}
          />,
        ),
      )
    expect(line(null, null)).toBe('Escribí cuánto te entró y te mostramos cuánto te descontaron.')
    expect(line(0, 100)).toBe('Coincide con la liquidación.')
    // Sin centavos: es un aviso, no un ticket (los centavos quedan en los campos y en el papel).
    expect(line(320_050, 100)).toBe(
      'Faltan explicar $ 3.201. ¿Qué es? Es comisión Son otros cargos No sé qué es',
    )
    expect(line(-320_000, 100)).toContain('Entraron $ 3.200 más de lo que da la cuenta')
    expect(line(-320_000, 100)).toContain('Dejarlo a cuenta ($ 3.200)')
  })

  it('el ticket de la liquidación: las ventas, cada descuento con su menos y lo que entró', () => {
    const read = text(
      html(
        <SettlementTicket
          payer="Tarjetas de crédito (Posnet)"
          appliedCents={191_546_500}
          creditUsedCents={0}
          grossCents={191_546_500}
          grossEdited={false}
          isCustomer={false}
          rows={{
            ...emptyDeductions(),
            comision: { amount: 10_534_300, cert: '' },
            iva_comision: { amount: 2_212_200, cert: '' },
          }}
          missing={0}
          received={178_800_000}
          treasuryName="Banco Nación"
          summary={{ discountCents: 12_746_500, percentText: '6,7 %', keptOfHundred: '$ 93,35' }}
        />,
      ),
    )
    expect(read).toContain('Liquidación')
    expect(read).toContain('Ventas que te pagan $ 1.915.465,00')
    expect(read).toContain('Comisión − $ 105.343,00')
    expect(read).toContain('Entró a Banco Nación $ 1.788.000,00')
    expect(read).toContain('Te quedan $ 93,35 de cada $ 100.')
  })
})

// ─── Lo que no se dice ───────────────────────────────────────────────────────

/** Los archivos de pantalla de Ventas (sin el cierre del día, que es de otra tanda). */
function ventasSources(): string[] {
  const root = join(process.cwd(), 'app/(manager)/[tenantSlug]/administracion/ventas')
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name !== 'cierre') walk(path)
      } else if (/\.tsx?$/.test(name)) out.push(path)
    }
  }
  walk(root)
  for (const name of ['cobrar-sheet.tsx', 'cobrar-piezas.tsx', 'cobrar-cuenta.ts']) {
    out.push(join(process.cwd(), 'components/administracion/acciones', name))
  }
  return out
}

/** El código sin sus comentarios: lo que puede llegar a la pantalla. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('un solo libro: lo que ningún texto de Ventas dice', () => {
  const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
    ['«en negro»', /en negro/i],
    ['«en blanco»', /en blanco/i],
    ['«ganaste»', /ganaste/i],
    ['«te queda de»', /te queda de/i],
    ['«fuera de los libros»', /fuera de los libros|afuera de los libros/i],
    // «Retención de Ganancias» es el nombre del impuesto y se queda; «ganancia» suelta, no.
    ['«ganancia»', /\bganancia\b/i],
    // La plata «entra», «llega», «te la depositan»: nunca «se acredita».
    ['«acredit…»', /acredit/i],
  ]

  it('en el código de las pantallas', () => {
    const files = ventasSources()
    expect(files.length).toBeGreaterThan(30)
    for (const file of files) {
      const code = withoutComments(readFileSync(file, 'utf8'))
      for (const [name, pattern] of FORBIDDEN) {
        expect(pattern.test(code), `${name} en ${file.split('/administracion/')[1]}`).toBe(false)
      }
    }
  })

  it('en la pantalla ya dibujada', async () => {
    const pages = [
      await renderMonth({ targetCents: 150_000_000 }),
      await renderMonth({ targetCents: 150_000_000 }, { detail: true }),
      await renderMonth({ closedBefore: '2026-10-01', booksStartDate: '2026-10-12' }),
      await renderMonth({ targetCents: 150_000_000, canWrite: false }),
    ]
    for (const page of pages) {
      const read = text(page)
      for (const [name, pattern] of FORBIDDEN) expect(pattern.test(read), name).toBe(false)
    }
  })

  it('nada de plata formateada a mano: la pantalla usa `lib/money`', () => {
    for (const file of ventasSources()) {
      const code = withoutComments(readFileSync(file, 'utf8'))
      expect(/toLocaleString|Intl\.NumberFormat/.test(code), file).toBe(false)
    }
  })
})
