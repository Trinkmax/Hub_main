// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvoicesView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/invoices-view'
import {
  MonthBody,
  type MonthData,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/month-view'
import { NetView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/net-view'
import { NightSheet } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/night-sheet'
import { ReceivablesList } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/receivables-list'
import { ReceivablesView } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/receivables-view'
import { VentasViews } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_components/ventas-views'
import { cashTitle } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/almanac'
import { OpenItems } from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/_components/open-items'
import { PartyData } from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/_components/party-data'
import ClientePage from '@/app/(manager)/[tenantSlug]/administracion/ventas/clientes/[id]/page'
import { emptyDeductions } from '@/components/administracion/acciones/cobrar-cuenta'
import {
  MissingLine,
  PayerChoices,
  SettlementTicket,
} from '@/components/administracion/acciones/cobrar-piezas'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
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
 * las oraciones tienen sus tests en `administracion-ventas-vista`, `-noche` y
 * `-cobrar`; acá se cuida lo que solo se ve armado: que los textos que
 * pidieron los socios sigan ahí, que la contadora no reciba NINGÚN botón de
 * carga, que un mes vacío no muestre «$ 0» y que ningún texto diga lo que no
 * se dice.
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
  recentCloses?: number
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
  const list: PartyList = {
    rows: PARTIES,
    totals: {
      debtCents: 293_615_080,
      overdueCents: 187_995_440,
      dueSoonCents: 0,
      creditCents: 0,
      count: 2,
    },
    asOf: TODAY,
  }
  const canWrite = input.canWrite ?? true
  return {
    calendar: ok(calendarOf(rows, booksStartDate)),
    projection: ok(rows),
    events: canWrite ? ok({ '2026-10-17': ['Noche de tacos'] }) : null,
    counts: canWrite ? ok({}) : null,
    treasuries: canWrite
      ? ok([{ id: 'caja', name: 'Caja', kind: 'cash' as const, active: true }])
      : null,
    parties: ok(list),
    boxes: ok([]),
    catalog: null,
    recentCloses: ok(input.recentCloses ?? (rows.some((r) => r.closes > 0) ? 1 : 0)),
  }
}

async function renderMonth(
  input: MonthInput = {},
  over: { focus?: 'proyeccion' | 'caja' | null; requestedDay?: string | null } = {},
): Promise<string> {
  const canWrite = input.canWrite ?? true
  ui.readOnly = !canWrite
  return html(
    await MonthBody({
      data: monthData(input),
      tenantId: 'tenant',
      tenantSlug: 'hub',
      base: BASE,
      today: TODAY,
      range: { month: '2026-10', from: '2026-10-01', to: '2026-10-31' },
      monthParam: null,
      requestedDay: over.requestedDay ?? null,
      focus: over.focus ?? null,
      canWrite,
    }),
  )
}

// ─── «El mes» ────────────────────────────────────────────────────────────────

describe('«El mes» con cierres y objetivos', () => {
  it('conserva las palabras que pidieron los socios y los dos bloques con su nombre', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    const read = text(markup)
    expect(read).toContain('Vas vendiendo en octubre')
    expect(read).toContain('Objetivo a hoy')
    expect(read).toContain('Te falta vender')
    expect(read).toContain('Proyección')
    expect(read).toContain('Ventas contra caja')
    expect(read).toContain('Noche por noche')
    // La planilla de los socios y «Cargar una lista» siguen existiendo.
    expect(read).toContain('Ver la planilla día por día')
    expect(read).toContain('Cargar una lista')
  })

  it('la suma de los casilleros es el número de arriba: la venta neta de cada noche', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    // 11 noches de $ 955.000 netos (900 + 100 − 20 − 25 mil).
    expect(markup).toContain('$ 955.000')
    expect(markup).toContain('10.505.000')
  })

  it('el cierre que falta se carga en un toque: desde la hoja verde y desde su casillero', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000 })
    // El día va escrito dos veces y se ve una sola: corto en el celular, entero en la compu.
    expect(text(markup)).toContain('Cargar el cierre del lun 12/10 lunes 12/10')
    // El botón de la hoja verde y el casillero del 12 llevan al mismo lugar.
    expect(
      markup.split(`href="${BASE}/ventas/cierre?fecha=2026-10-12"`).length - 1,
    ).toBeGreaterThanOrEqual(2)
    expect(markup).toContain(
      'aria-label="Lunes 12 de octubre: falta el cierre. Abre la carga de ese día."',
    )
  })

  it('elegir una noche es un `?dia=`; por defecto se muestra la última cargada', async () => {
    const markup = await renderMonth()
    expect(markup).toContain(`href="${BASE}/ventas?dia=2026-10-05"`)
    expect(text(markup)).toContain('Domingo 11 de octubre')
    expect(text(markup)).toContain('Vendido esa noche')
    const other = await renderMonth({}, { requestedDay: '2026-10-05' })
    expect(text(other)).toContain('Lunes 5 de octubre')
  })

  it('los eventos del calendario marcan su día', async () => {
    const markup = await renderMonth()
    expect(markup).toContain('Noche de tacos')
    expect(text(markup)).toContain('hay un evento')
  })

  it('con ?tab=proyeccion y ?tab=caja el bloque pedido viene abierto', async () => {
    const closed = await renderMonth({ targetCents: 150_000_000 })
    expect(closed).not.toContain('<details open=""')
    const projection = await renderMonth({ targetCents: 150_000_000 }, { focus: 'proyeccion' })
    expect(projection.split('<details open=""').length - 1).toBe(1)
    const cash = await renderMonth({ targetCents: 150_000_000 }, { focus: 'caja' })
    expect(cash.split('<details open=""').length - 1).toBe(1)
  })
})

describe('«El mes» sin objetivos', () => {
  it('enseña los tres caminos para poner el objetivo, con «Cargar una lista» primero', async () => {
    const read = text(await renderMonth())
    expect(read).toContain('Octubre todavía no tiene objetivo')
    expect(read).toContain('Poné el objetivo de octubre y mirá si llegás')
    expect(read).toContain('Cargar una lista')
    expect(read).toContain('Armar el objetivo')
    expect(read).toContain('Mes que viene')
  })
})

describe('el bar recién arrancado (así está HUB)', () => {
  const input = { closedBefore: '2026-10-01', booksStartDate: '2026-10-12' }

  it('no muestra «$ 0» por ningún lado', async () => {
    const markup = await renderMonth(input)
    expect(markup).not.toMatch(/\$ 0(?![\d.,])/)
  })

  it('dice qué falta con palabras y lleva al primer cierre', async () => {
    const markup = await renderMonth(input)
    const read = text(markup)
    expect(read).toContain('Todavía no hay ventas cargadas en octubre')
    expect(read).toContain('Cargar el cierre del lun 12/10 lunes 12/10')
    expect(read).toContain('Así se llenan las ventas, sin punto de venta')
    expect(read).toContain('El ticket de cada noche')
    expect(read).toContain('Ejemplo')
    expect(read).toContain('Llevás la cuenta desde el 12/10')
    // El almanaque se dibuja igual: el 12 falta y el 13 es hoy.
    expect(read).toContain('falta')
    expect(read).toContain('hoy')
  })

  it('los bloques vacíos se reemplazan por los tres pasos, salvo el que pide la URL', async () => {
    const plain = text(await renderMonth(input))
    expect(plain).not.toContain('Ver noche por noche')
    expect(plain).not.toContain('Poné el objetivo de octubre y mirá si llegás')
    const asked = text(await renderMonth(input, { focus: 'proyeccion' }))
    expect(asked).toContain('Poné el objetivo de octubre y mirá si llegás')
  })

  it('un bar con cierres el mes pasado no es «recién arrancado»', async () => {
    const read = text(await renderMonth({ closedBefore: '2026-10-01', recentCloses: 1 }))
    expect(read).not.toContain('Así se llenan las ventas')
    expect(read).toContain('Ventas contra caja')
  })
})

// ─── La contadora ────────────────────────────────────────────────────────────

const WRITE_WORDS = [
  'Ya entró',
  'Me entró plata',
  'Contar Mercado Pago',
  'Cargar una lista',
  'Armar el objetivo',
  'Armar de nuevo',
  'Mes que viene',
  'Anotar lo que entró',
  'Cambiar lo que entró',
  'Cargar otro turno',
  'Cargar el cierre',
  'Cargar el primero',
  'Poner el objetivo',
  'Ir al cierre',
  'Agregar nota',
]

describe('la contadora (solo lectura) no ve ningún botón de carga', () => {
  it('«El mes»: ni un link a cargar un cierre, ni celdas que se editan', async () => {
    for (const focus of [null, 'proyeccion', 'caja'] as const) {
      const markup = await renderMonth({ targetCents: 150_000_000, canWrite: false }, { focus })
      expect(markup).not.toContain('/ventas/cierre')
      const read = text(markup)
      for (const word of WRITE_WORDS) expect(read).not.toContain(word)
      // Un botón de lápiz es una celda que se edita.
      expect(markup).not.toContain('Cargar el objetivo del')
      expect(markup).not.toContain('. Cambiar')
    }
  })

  it('ve lo mismo, con sus tablas y sus exportes abiertos', async () => {
    const markup = await renderMonth({ targetCents: 150_000_000, canWrite: false })
    const read = text(markup)
    expect(read).toContain('Vas vendiendo en octubre')
    expect(read).toContain('Para la contadora')
    expect(read).toContain('Exportar subdiario de ventas')
    // «Para la contadora», la planilla y la tabla de ventas contra caja.
    expect(markup.split('<details open=""').length - 1).toBe(3)
    // No lee el calendario del bar: sin eventos.
    expect(markup).not.toContain('Noche de tacos')
  })

  it('el bar sin cierres: los tres pasos sin botones, y a quién le toca', async () => {
    const markup = await renderMonth({
      closedBefore: '2026-10-01',
      booksStartDate: '2026-10-12',
      canWrite: false,
    })
    expect(markup).not.toContain('/ventas/cierre')
    const read = text(markup)
    for (const word of WRITE_WORDS) expect(read).not.toContain(word)
    expect(read).toContain('Cuando los dueños carguen los cierres del día')
  })

  it('«Plata por cobrar»: los mismos renglones, sin «Ya entró» ni «Contar»', () => {
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
    expect(text(owner)).toContain('Ya está en tu Mercado Pago: contala para anotarlo')
    expect(text(owner)).toContain('días tarde')
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

  it('la noche elegida: ve el objetivo y lo que entró, sin poder cambiarlos', () => {
    ui.readOnly = true
    const projection = buildProjection(rowsOf({ targetCents: 150_000_000 }), { serviceDay: TODAY })
    const day = projection.days.find((d) => d.day === '2026-10-10')
    const markup = html(
      <NightSheet
        tenantId="tenant"
        base={BASE}
        today={TODAY}
        day="2026-10-10"
        state="loaded"
        monthName="octubre"
        monthState="current"
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
    expect(read).toContain('64 % · 36 % abajo')
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

  it('«Plata por cobrar» con deuda: «Me entró plata» solo para quien carga', async () => {
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
    expect(owner).toContain('Plata por cobrar')
    expect(owner).toContain('Me entró plata')
    expect(owner).toContain('Ya entró')
    expect(owner).toContain('Contar Mercado Pago')
    expect(owner).toContain('Cambiar los plazos')
    const reader = await view(false)
    expect(text(reader)).toContain('Plata por cobrar')
    expect(text(reader)).toContain('Tarjetas de crédito (Posnet)')
    expectNoWriteControls(reader)
    expect(text(reader)).not.toContain('Cambiar los plazos')
  })

  it('«Plata por cobrar» en el bar recién arrancado: sin «$ 0» y sin botones para quien mira', async () => {
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

  it('«Lo que llegó» sin cobros: «Me entró plata» solo para quien carga', async () => {
    const view = async (canWrite: boolean) => {
      as(canWrite)
      return html(await NetView({ ...shared(canWrite), focus: null }))
    }
    const owner = text(await view(true))
    expect(owner).toContain('Todavía no hay ventas ni cobros en octubre')
    expect(owner).toContain('Me entró plata')
    const reader = await view(false)
    expect(text(reader)).toContain('No hay cobros en octubre')
    expect(text(reader)).toContain('Exportar subdiario de cobranzas')
    expectNoWriteControls(reader)
    expect(reader).not.toContain('<button type="button"')
  })

  it('«Lo que llegó» cuando todavía no llegó nada: sin «$ 0» como número grande', async () => {
    as(true)
    db.net = [
      {
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
      },
    ]
    const read = text(html(await NetView({ ...shared(true), focus: null })))
    expect(read).toContain('Todavía no te liquidaron nada en octubre')
    expect(read).toContain('Sigue en camino')
    expect(read).not.toContain('Te llegó en octubre')
    expect(read).not.toContain('Te descontaron $ 0')
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
    // «Para la contadora» viene abierto.
    expect(reader).toContain('<details open=""')
    expectNoWriteControls(reader)
    expect(text(reader)).not.toContain('Hacer una factura con ARCA')
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

  it('«El mes» sin objetivos y con cierres: ni «Cargar una lista» ni «Armar el objetivo»', async () => {
    for (const focus of [null, 'proyeccion'] as const) {
      const markup = await renderMonth({ canWrite: false }, { focus })
      expectNoWriteControls(markup)
      expect(text(markup)).toContain('Este mes no tiene objetivos cargados.')
    }
  })

  it('la noche de hoy: «Cargar el cierre de hoy» solo para quien carga', () => {
    const night = (canWrite: boolean) => {
      ui.readOnly = !canWrite
      return html(
        <NightSheet
          tenantId="tenant"
          base={BASE}
          today={TODAY}
          day={TODAY}
          state="today"
          monthName="octubre"
          monthState="current"
          projectionDay={null}
          closes={[]}
          events={[]}
          counts={{}}
          treasuries={[]}
          canWrite={canWrite}
        />,
      )
    }
    expect(night(true)).toContain(`href="${BASE}/ventas/cierre?fecha=${TODAY}"`)
    const reader = night(false)
    expect(text(reader)).toContain('En curso')
    expectNoWriteControls(reader)
    expect(reader).not.toContain('<button')
  })

  it('a quien solo mira no se le dice «anotaste»', () => {
    const none = { comparedDays: 0, diffCents: 0 }
    expect(cashTitle(none)).toBe('Todavía no anotaste lo que entró ninguna noche')
    expect(cashTitle(none, { reader: true })).toBe('Todavía no se anotó lo que entró ninguna noche')
  })
})

describe('la planilla de un mes sin objetivo', () => {
  it('no dice «objetivo $ 0»: un objetivo que falta no es un cero', async () => {
    const read = text(await renderMonth({}, { focus: 'proyeccion' }))
    expect(read).toContain('Ver la planilla día por día')
    expect(read).not.toMatch(/objetivo \$ 0(?![\d.,])/i)
  })
})

// ─── Las vistas ──────────────────────────────────────────────────────────────

describe('la fila de vistas', () => {
  it('cuatro vistas, la elegida marcada, con los links de siempre', () => {
    const markup = html(<VentasViews base={BASE} view="cobrar" month="2026-09" />)
    expect(markup).toContain('aria-label="Vistas de Ventas"')
    for (const label of ['El mes', 'Plata por cobrar', 'Lo que llegó', 'Facturas']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain(`href="${BASE}/ventas?mes=2026-09"`)
    expect(markup).toContain(`href="${BASE}/ventas?tab=clientes"`)
    expect(markup).toContain(`href="${BASE}/ventas?tab=neto-por-medio&amp;mes=2026-09"`)
    expect(markup).toContain(`href="${BASE}/ventas?tab=facturas&amp;mes=2026-09"`)
    expect(markup.split('aria-current="page"').length - 1).toBe(1)
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
    expect(line(320_000, 100)).toBe(
      'Faltan explicar $ 3.200,00 Es comisión Son otros cargos No sé qué es',
    )
    expect(line(-320_000, 100)).toContain('Entraron $ 3.200,00 más de lo que da la cuenta')
    expect(line(-320_000, 100)).toContain('Dejarlo a cuenta ($ 3.200,00)')
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
