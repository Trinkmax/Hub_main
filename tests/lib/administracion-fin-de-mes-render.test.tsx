// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IvaBookScreen } from '@/app/(manager)/[tenantSlug]/administracion/libros/_components/iva-book'
import AsientoManualPage from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/page'
import { AllMonths } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_components/all-months-table'
import {
  coverLine,
  MonthCover,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_components/month-cover'
import { sendMessage } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_components/send-step'
import FinDeMesPage from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/page'
import DiarioPage from '@/app/(manager)/[tenantSlug]/administracion/libros/diario/page'
import LibrosPage from '@/app/(manager)/[tenantSlug]/administracion/libros/page'
import PosicionIvaPage from '@/app/(manager)/[tenantSlug]/administracion/libros/posicion-iva/page'
import type { FiscalYearRow, PeriodRow } from '@/lib/accounting/queries'
import { eachIsoDay } from '@/lib/dates'

/**
 * «Fin de mes» ya dibujado, con la base simulada: lo que la pantalla le promete
 * a cada uno. Las cuentas y las frases tienen sus tests en
 * `administracion-fin-de-mes`; acá se cuida lo que solo se ve armado:
 *
 * - la contadora no recibe NINGÚN botón de carga (ni cerrar, ni reabrir, ni las
 *   acciones de los avisos): solo descargas;
 * - con el mes cerrado, el paso que toca es mandarle los libros;
 * - sin la CUIT se dice que se bajan 10 de 15;
 * - «Sumar a la contadora» sale solo para quien administra los accesos.
 */

const ui = vi.hoisted(() => ({
  readOnly: false,
  role: 'owner' as 'owner' | 'editor',
  admin: true,
}))
const db = vi.hoisted(() => ({
  years: [] as unknown[],
  settings: null as unknown,
  checklist: null as unknown,
  calendar: null as unknown,
  position: null as unknown,
  changed: [] as string[],
  accountants: [] as Array<{ userId: string; name: string }>,
  /** El comprobante del IVA anotado (para «Pagar a ARCA»). */
  document: null as unknown,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/libros/cierres',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: ui.admin },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})
// Las acciones del cierre son del servidor: para dibujar los botones alcanza con que existan.
vi.mock('@/lib/accounting/actions/periods', () => ({
  closePeriod: vi.fn(),
  reopenPeriod: vi.fn(),
  closeFiscalYear: vi.fn(),
  reopenFiscalYear: vi.fn(),
  generateIvaSettlement: vi.fn(),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/libros/_lib/page-access', () => ({
  requireBooksAccess: async () => ({
    canWrite: !ui.readOnly,
    access: {
      tenant: { id: 'tenant-1', slug: 'hub' },
      role: ui.role,
      accounting: {
        enabled: true,
        setUp: true,
        read: true,
        write: !ui.readOnly,
        admin: ui.admin,
        canSetUp: false,
      },
    },
  }),
}))
// Sin contexto de asientos no se arma la vista previa del IVA ni el cierre del ejercicio.
vi.mock('@/lib/accounting/context', () => ({
  tryLoadPostingContext: async () => ({
    ok: false,
    state: { ok: false, code: 'error', message: 'sin contexto' },
  }),
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: async () => 'https://app.hub.test' }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadFirstOpenDate: async () => '2026-09-01',
}))
// El asiento manual trae sus acciones de servidor: acá alcanza con que existan.
vi.mock('@/lib/accounting/actions/documents', () => ({
  postManualEntry: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/parties', () => ({ createParty: vi.fn(), saveParty: vi.fn() }))
vi.mock('@/lib/accounting/queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listFiscalYears: async () => db.years,
  getAccountingSettings: async () => db.settings,
  getCloseChecklist: async () => {
    if (!db.checklist) throw new Error('sin checklist')
    return db.checklist
  },
  getDailyCloseCalendar: async () => {
    if (!db.calendar) throw new Error('sin almanaque')
    return db.calendar
  },
  getIvaPosition: async () => {
    if (!db.position) throw new Error('sin posición')
    return db.position
  },
  verifyClosedPeriods: async () => db.changed.map((periodId) => ({ periodId, ok: false })),
  listPeriodEvents: async () => [],
  getAccessOverview: async () => ({
    active: [],
    revoked: [],
    ownersWithoutAccess: [],
    accountants: db.accountants,
    adminCount: 1,
  }),
  // Los libros de lectura, vacíos: lo que importa acá es qué botones salen alrededor.
  getMonthPackage: async () => ({ files: [] }),
  getSalesSummary: async () => [],
  getDocument: async () => db.document,
  getJournal: async () => ({ rows: [], totalRows: 0, nextCursor: null }),
  getJournalSummary: async () => ({ entries: 0, debitCents: 0, creditCents: 0, balanced: true }),
  getIvaBook: async () => ({ rows: [], totalRows: 0, nextCursor: null }),
  getIvaBookTotals: async () => ({ amounts: {} }),
  getPeriodByMonth: async () => null,
}))

const TODAY = '2026-10-13'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T15:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  ui.readOnly = false
  ui.role = 'owner'
  ui.admin = true
  db.years = []
  db.settings = null
  db.checklist = null
  db.calendar = null
  db.position = null
  db.changed = []
  db.accountants = []
  db.document = null
})

function period(ym: string, over: Partial<PeriodRow> = {}): PeriodRow {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    id: `p-${ym}`,
    fiscalYearId: 'fy-2026',
    kind: 'month',
    month: `${ym}-01`,
    startsOn: `${ym}-01`,
    endsOn: `${ym}-${String(last).padStart(2, '0')}`,
    status: 'open',
    closedAt: null,
    closedByName: null,
    numberFrom: null,
    numberTo: null,
    entriesCount: null,
    debitTotalCents: null,
    ivaSettlementDocumentId: null,
    ...over,
  }
}

function fiscalYear(periods: PeriodRow[], startDate = '2026-09-01'): FiscalYearRow {
  return {
    id: 'fy-2026',
    startDate,
    endDate: '2026-12-31',
    status: 'open',
    openingNumberReserved: false,
    closedAt: null,
    closedByName: null,
    periods,
  }
}

const CLOSED_SEPTEMBER = period('2026-09', {
  status: 'closed',
  closedAt: '2026-10-05T15:00:00Z',
  closedByName: 'Franco',
  numberFrom: 1,
  numberTo: 76,
  entriesCount: 76,
  debitTotalCents: 9_624_632_605,
  ivaSettlementDocumentId: '00000000-0000-4000-8000-00000000d0c1',
})

function settings(over: Record<string, unknown> = {}) {
  return {
    cuit: '30-71234567-8',
    ivaCondition: 'responsable_inscripto',
    booksStartDate: '2026-09-01',
    openingStatus: 'posted',
    hasDocuments: true,
    ...over,
  }
}

function calendar(ym: string, opts: { from?: string; loaded: readonly string[] }) {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const first = `${ym}-01`
  const loaded = new Set(opts.loaded)
  let loadedDays = 0
  let missingDays = 0
  const days = eachIsoDay(first, `${ym}-${String(last).padStart(2, '0')}`).map((date) => {
    const status =
      date < (opts.from ?? first)
        ? 'before_start'
        : loaded.has(date)
          ? 'loaded'
          : date === TODAY
            ? 'pending'
            : date > TODAY
              ? 'future'
              : 'missing'
    if (status === 'loaded') loadedDays += 1
    if (status === 'missing') missingDays += 1
    return {
      date,
      status,
      closes: [],
      totalCents: status === 'loaded' ? 104_697_800 : null,
    }
  })
  return {
    month: first,
    days,
    soldCents: loadedDays * 104_697_800,
    loadedDays,
    missingDays,
    firstMissingDate: null,
    serviceDay: TODAY,
    booksStartDate: opts.from ?? first,
  }
}

function checklist(over: Record<string, unknown> = {}) {
  return {
    month: '2026-09-01',
    periodId: 'p-2026-09',
    fiscalYearId: 'fy-2026',
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    status: 'open',
    canClose: true,
    blockers: [],
    warnings: [],
    info: [],
    warningKeys: [],
    entriesCount: 76,
    debitTotalCents: 9_624_632_605,
    creditTotalCents: 9_624_632_605,
    numberFrom: 1,
    numberTo: 76,
    numberingProvisional: true,
    isLastMonthOfFiscalYear: false,
    iva: null,
    ivaPosition: null,
    closedAt: null,
    closedByName: null,
    raw: {},
    ...over,
  }
}

const NOT_RECONCILED = {
  key: 'treasuries_not_reconciled',
  severity: 'warning',
  label: 'Hay cajas o cuentas sin contar en el mes.',
  detail: {
    treasuries: [
      { treasury_id: '00000000-0000-4000-8000-0000000000aa', name: 'Caja' },
      { treasury_id: '00000000-0000-4000-8000-0000000000bb', name: 'Banco Nación' },
    ],
  },
  amountCents: null,
  count: 2,
}

async function page(searchParams: Record<string, string> = {}): Promise<string> {
  const node = await FinDeMesPage({
    params: Promise.resolve({ tenantSlug: 'hub' }),
    searchParams: Promise.resolve(searchParams),
  })
  return renderToStaticMarkup(node).replaceAll(' ', ' ')
}

/** El texto de cada `<button>` de la pantalla, sin marcas. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    (match[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/** El estado de un paso (`done` · `current` · `todo`). */
function stepState(html: string, id: string): string | null {
  const tag = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>`))?.[0] ?? ''
  return tag.match(/data-state="([a-z]+)"/)?.[1] ?? null
}

function demoSeptemberOpen() {
  db.years = [fiscalYear([period('2026-09'), period('2026-10'), period('2026-11')])]
  db.settings = settings()
  db.calendar = calendar('2026-09', { loaded: eachIsoDay('2026-09-01', '2026-09-30') })
  db.checklist = checklist({
    warnings: [NOT_RECONCILED],
    warningKeys: ['treasuries_not_reconciled'],
  })
}

function demoSeptemberClosed() {
  db.years = [fiscalYear([CLOSED_SEPTEMBER, period('2026-10'), period('2026-11')])]
  db.settings = settings()
  db.calendar = calendar('2026-09', { loaded: eachIsoDay('2026-09-01', '2026-09-30') })
  db.position = {
    applies: true,
    status: 'closed',
    toPayCents: 411_706_204,
    inFavorCents: 0,
    isZero: false,
    debitFiscal: { totalCents: 522_323_404, byRate: {} },
    creditFiscal: { totalCents: 110_617_200, byRate: {} },
    technicalBalancePrevCents: 0,
    freeBalancePrevCents: 0,
    perceptionsCents: 0,
    withholdingsCents: 0,
  }
}

describe('Fin de mes · quien cierra el mes', () => {
  it('mes que terminó con un aviso: el título afirma, el paso 1 es el que toca y la acción se abre encima', async () => {
    demoSeptemberOpen()
    const html = await page()
    expect(html).toContain('Fin de mes')
    expect(html).toContain('Septiembre se puede cerrar.')
    expect(html).toContain('Queda 1 aviso para mirar: no frena el cierre.')
    expect([
      stepState(html, 'paso-1'),
      stepState(html, 'paso-2'),
      stepState(html, 'paso-3'),
    ]).toEqual(['current', 'todo', 'todo'])
    // Los cuatro renglones, siempre en el mismo orden.
    const order = ['Cierres del día', 'Compras y gastos', 'La plata', 'Los papeles del bar'].map(
      (title) => html.indexOf(`>${title}<`),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('Los 30 días de septiembre tienen su cierre.')
    expect(html).toContain('Hay cajas sin contar en septiembre')
    const all = buttons(html)
    expect(all).toContain('Contar Caja')
    expect(all).toContain('Contar Banco Nación')
    expect(all).toContain('Cerrar septiembre')
    expect(html).toContain('Cargar los sueldos')
    // Mes abierto: los libros se mandan después, pero se pueden bajar igual.
    expect(html).toContain('Cuando el mes esté cerrado.')
    expect(html).toContain('Descargar igual lo que hay hasta hoy (puede cambiar)')
    // El papel del mes, sin sello todavía.
    expect(html).toContain('Acá va el sello cuando lo cierres')
    expect(html).toContain('30 de 30')
    expect(html).toContain('76 asientos')
    expect(html).toContain('van a quedar numerados del 1 al 76')
  })

  it('sin avisos: el paso que toca es cerrar', async () => {
    demoSeptemberOpen()
    db.checklist = checklist()
    const html = await page()
    expect(html).toContain('Septiembre está listo para cerrar.')
    expect([
      stepState(html, 'paso-1'),
      stepState(html, 'paso-2'),
      stepState(html, 'paso-3'),
    ]).toEqual(['done', 'current', 'todo'])
    expect(html).toContain('Ninguna caja con movimientos quedó sin contar ni en negativo.')
  })

  it('mes cerrado: el paso que toca es mandarle los libros, y el papel lleva el sello', async () => {
    demoSeptemberClosed()
    db.accountants = [{ userId: 'u-ana', name: 'Ana' }]
    const html = await page({ mes: '2026-09' })
    expect(html).toContain('Septiembre está cerrado.')
    expect(html).toContain('Lo cerró Franco el 05/10/2026.')
    expect([
      stepState(html, 'paso-1'),
      stepState(html, 'paso-2'),
      stepState(html, 'paso-3'),
    ]).toEqual(['done', 'done', 'current'])
    expect(html).toContain('Mes cerrado: no queda nada para revisar.')
    expect(html).toContain('Cerrado · 05/10/2026')
    expect(html).toContain('$ 4.117.062 a pagar')
    // «Que entre ella» va primero, con el mensaje listo para pegar.
    expect(html).toContain('Que entre ella')
    expect(html).toContain('ya tiene usuario de solo lectura')
    expect(buttons(html)).toContain('Copiar el mensaje para Ana')
    expect(html).toContain(
      'Ya cerramos septiembre de 2026. Los libros están acá (entrás con tu usuario): https://app.hub.test/hub/administracion/libros?mes=2026-09',
    )
    expect(html.indexOf('Que entre ella')).toBeLessThan(html.indexOf('O mandarle los archivos'))
    expect(buttons(html).some((b) => b.startsWith('Descargar el paquete de septiembre'))).toBe(true)
    expect(html).toContain('15 archivos')
    // El último mes cerrado se puede reabrir, desde su paso.
    expect(html).toContain('Más opciones de septiembre')
    expect(html).toContain('Los libros llevan todo, con factura y sin factura.')
  })

  it('sin la CUIT se dice que se bajan 10 de 15', async () => {
    demoSeptemberClosed()
    db.settings = settings({ cuit: null })
    const html = await page({ mes: '2026-09' })
    expect(html).toContain('10 de 15')
    expect(html).toContain('Se descargan 10 de 15: los 5 de IVA necesitan la CUIT del bar.')
    expect(html).toContain('Cargarla')
  })

  it('sin contadora: «Sumar a la contadora» sale solo para quien administra los accesos', async () => {
    demoSeptemberClosed()
    const admin = await page({ mes: '2026-09' })
    expect(admin).toContain('Tu contadora todavía no tiene usuario.')
    expect(admin).toContain('Sumar a la contadora')
    expect(admin).toContain('/hub/configuracion/equipo?rol=accountant')

    ui.admin = false
    const notAdmin = await page({ mes: '2026-09' })
    expect(notAdmin).not.toContain('Sumar a la contadora')
    expect(notAdmin).toContain('Pedile a quien administra los accesos que la sume.')
  })

  it('quien carga pero no es dueño no puede listar personas: copia el link', async () => {
    demoSeptemberClosed()
    ui.role = 'editor'
    db.accountants = [{ userId: 'u-ana', name: 'Ana' }]
    const html = await page({ mes: '2026-09' })
    expect(html).not.toContain('Copiar el mensaje para Ana')
    expect(buttons(html)).toContain('Copiar el link de septiembre')
  })

  it('el bar recién arrancado (como HUB): dice qué falta y enseña el primer paso', async () => {
    db.years = [
      fiscalYear(
        [period('2026-10', { startsOn: '2026-10-12' }), period('2026-11'), period('2026-12')],
        '2026-10-12',
      ),
    ]
    db.settings = settings({ cuit: null, openingStatus: 'pending', booksStartDate: '2026-10-12' })
    db.calendar = calendar('2026-10', { from: '2026-10-12', loaded: [] })
    db.checklist = checklist({
      month: '2026-10-01',
      periodId: 'p-2026-10',
      endsOn: '2026-10-31',
      canClose: false,
      blockers: [
        {
          key: 'month_not_finished',
          severity: 'blocker',
          label: 'x',
          detail: {},
          amountCents: null,
          count: null,
        },
        {
          key: 'opening_pending',
          severity: 'blocker',
          label: 'x',
          detail: {},
          amountCents: null,
          count: null,
        },
      ],
      warnings: [
        {
          key: 'sas_cuit_missing',
          severity: 'warning',
          label: 'x',
          detail: {},
          amountCents: null,
          count: null,
        },
      ],
      warningKeys: ['sas_cuit_missing'],
      entriesCount: 2,
    })
    const html = await page()
    expect(html).toContain('Octubre todavía no terminó.')
    expect(html).toContain(
      'Se puede cerrar desde el 01/11/2026, y antes falta 1 cosa: decir cuánta plata había al arrancar.',
    )
    // La base calla, el almanaque no: sin cierres NO es «Sin avisos».
    expect(html).toContain('Sin cierres')
    expect(html).toContain('Todavía no hay ningún cierre del día en octubre')
    expect(html).toContain('Cargar el del lunes 12/10')
    expect(html).toContain('/hub/administracion/ventas/cierre?fecha=2026-10-12')
    expect(html).toContain('Falta decir cuánta plata había al arrancar')
    expect(html).toContain('Cargar lo que había')
    expect(html).toContain('Falta la CUIT del bar')
    // No se puede cerrar todavía: no hay botón de cierre.
    expect(buttons(html)).not.toContain('Cerrar octubre')
    expect(html).toContain('Se puede desde el 01/11/2026.')
    // El papel: sin ventas inventadas.
    expect(html).toContain('sin cierres cargados')
    expect(html).toContain('0 de 1')
    expect(html).not.toMatch(/\$ 0\b/)
  })

  it('un mes que cambió después de cerrarse se avisa arriba y en su pestaña', async () => {
    demoSeptemberClosed()
    db.changed = ['p-2026-09']
    const html = await page({ mes: '2026-09' })
    expect(html).toContain('Septiembre 2026 cambió después de cerrarse: avisanos.')
    expect(html).toContain('con un aviso')
  })

  it('sin ejercicios: enseña cómo aparecen los meses', async () => {
    db.years = []
    db.settings = settings()
    const html = await page()
    expect(html).toContain('Todavía no hay meses en los libros')
    expect(html).toContain(
      'Aparecen solos cuando cargás el primer gasto o el primer cierre del día.',
    )
  })

  it('un mes que no empezó no tiene nada para revisar', async () => {
    demoSeptemberOpen()
    const html = await page({ mes: '2026-11' })
    expect(html).toContain('Noviembre 2026 todavía no empezó.')
    expect(html).not.toContain('Revisá los avisos')
  })
})

describe('Fin de mes · la contadora (solo lectura)', () => {
  it('mes abierto: ve los avisos y ningún botón', async () => {
    demoSeptemberOpen()
    ui.readOnly = true
    ui.role = 'editor'
    ui.admin = false
    const html = await page()
    expect(html).toContain('Septiembre sigue abierto: lo cierran los dueños.')
    expect(html).toContain('Tiene 1 aviso.')
    expect(html).toContain('Lo que falta revisar')
    expect(html).toContain('El cierre')
    expect(html).toContain('Abierto: lo cierran los dueños.')
    expect(html).toContain('Hay cajas sin contar en septiembre')
    expect(html).toContain('Sin contar: Caja, Banco Nación.')
    expect(html).toContain('Lo cargan los dueños.')
    // Ni un botón: ni cerrar, ni contar, ni pagar, ni sueldos.
    expect(buttons(html)).toEqual([])
    for (const text of [
      'Cerrar septiembre',
      'Contar Caja',
      'Cargar los sueldos',
      'Reabrir',
      'Anotar el IVA del mes al cerrar',
      'Sumar a la contadora',
    ]) {
      expect(html, text).not.toContain(text)
    }
    // Tampoco links de carga: ni al cierre del día ni al asiento manual.
    expect(html).not.toContain('/ventas/cierre')
    expect(html).not.toContain('/asiento-manual')
    expect(html).not.toContain('/configurar')
  })

  it('mes cerrado: solo descargas (descargar no es cargar)', async () => {
    demoSeptemberClosed()
    ui.readOnly = true
    ui.role = 'editor'
    ui.admin = false
    const html = await page({ mes: '2026-09' })
    expect(html).toContain('Septiembre está cerrado.')
    expect(html).toContain('Los libros')
    const all = buttons(html)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatch(/^Descargar el paquete de septiembre/)
    expect(html).toContain('Ver archivo por archivo')
    expect(html).not.toContain('Que entre ella')
    expect(html).not.toContain('Más opciones de septiembre')
    expect(html).not.toContain('Copiar')
  })

  it('el almanaque no lleva a cargar ningún día', async () => {
    demoSeptemberOpen()
    db.calendar = calendar('2026-09', { loaded: eachIsoDay('2026-09-01', '2026-09-20') })
    ui.readOnly = true
    const html = await page()
    expect(html).toContain('Faltan 10 cierres del día')
    expect(html).not.toContain('/ventas/cierre?fecha=')
  })
})

describe('Fin de mes · el cierre del ejercicio', () => {
  function allClosed() {
    db.years = [
      fiscalYear([
        CLOSED_SEPTEMBER,
        period('2026-10', { status: 'closed', closedAt: '2026-11-03T15:00:00Z' }),
      ]),
    ]
    db.settings = settings()
    db.calendar = calendar('2026-09', { loaded: eachIsoDay('2026-09-01', '2026-09-30') })
  }

  it('con todos los meses cerrados, quien carga ve «Cerrar el ejercicio» fuera de lo plegado', async () => {
    allClosed()
    const html = await page({ mes: '2026-09' })
    expect(html).toContain('Cerrar el ejercicio 2026')
    expect(html.indexOf('Cerrar el ejercicio 2026')).toBeLessThan(
      html.indexOf('Cierres de mes: todos los meses'),
    )
  })

  it('la contadora no lo ve, ni el ajuste de cierre', async () => {
    allClosed()
    ui.readOnly = true
    ui.admin = false
    const html = await page({ mes: '2026-09' })
    expect(html).not.toContain('Cerrar el ejercicio')
    expect(html).not.toContain('Cargar un ajuste de cierre')
    expect(html).not.toContain('/asiento-manual')
  })
})

/**
 * Las demás pantallas del área que dibujan algo que escribe: cada control va
 * detrás de `canWrite` (o de `ActionButton`, que no se dibuja en solo lectura).
 * Se prueba de a pares: con el dueño el control ESTÁ (si no, el «no está» de la
 * contadora no probaría nada) y con la contadora no.
 */
describe('Libros · la contadora no ve nada que cargue', () => {
  const PARAMS = { tenantSlug: 'hub' }

  async function render(
    Page: (props: {
      params: Promise<{ tenantSlug: string }>
      searchParams: Promise<Record<string, string | string[] | undefined>>
    }) => Promise<unknown>,
    searchParams: Record<string, string> = {},
  ): Promise<string> {
    const node = await Page({
      params: Promise.resolve(PARAMS),
      searchParams: Promise.resolve(searchParams),
    })
    return renderToStaticMarkup(node as Parameters<typeof renderToStaticMarkup>[0]).replaceAll(
      '\u00a0',
      ' ',
    )
  }

  function asReader() {
    ui.readOnly = true
    ui.role = 'editor'
    ui.admin = false
  }

  /** Una posición de IVA completa; cada test cambia lo suyo. */
  function ivaPosition(over: Record<string, unknown> = {}) {
    return {
      month: '2026-09-01',
      periodId: 'p-2026-09',
      status: 'open',
      closedAt: null,
      mode: 'on_close',
      applies: true,
      figures: {},
      debitFiscal: { byRate: { '2100': 522_323_404 }, totalCents: 522_323_404 },
      creditFiscal: { byRate: { '2100': 110_617_200 }, totalCents: 110_617_200 },
      technicalBalancePrevCents: 0,
      freeBalancePrevCents: 0,
      perceptionsCents: 0,
      withholdingsCents: 0,
      technicalBalanceCents: 411_706_204,
      toPayCents: 411_706_204,
      technicalBalanceNewCents: 0,
      freeBalanceNewCents: 0,
      inFavorCents: 0,
      isZero: false,
      pendingDocumentationCents: 0,
      reconciliation: {
        purchasesBookVatComputableCents: 110_617_200,
        journalVatCreditCents: 110_617_200,
        salesBookVatCents: 522_323_404,
        journalVatDebitCents: 522_323_404,
        differences: [],
        differencesCount: 0,
        unexplainedVatCreditCents: 0,
        unexplainedVatDebitCents: 0,
        matches: true,
        fullyExplained: true,
      },
      settlementDocumentId: null,
      settlementUpToDate: null,
      ...over,
    }
  }

  it('/libros: el dueño tiene el botón del mes y lo que se carga a mano', async () => {
    demoSeptemberOpen()
    const html = await render(LibrosPage)
    expect(html).toContain('Septiembre terminó y falta cerrarlo')
    expect(html).toContain('Revisar y cerrar septiembre')
    expect(html).toContain('/hub/administracion/libros/cierres?mes=2026-09')
    expect(html).toContain('Se carga a mano')
    expect(html).toContain('/hub/administracion/libros/asiento-manual?tipo=sueldos')
    expect(html).toContain('Descargar el paquete del mes')
    expect(html).not.toContain('Solo lectura')
  })

  it('/libros: la contadora ve el mes y descarga; ni botón del mes, ni sueldos, ni asiento manual', async () => {
    demoSeptemberOpen()
    db.settings = settings({ cuit: null })
    asReader()
    const html = await render(LibrosPage, { mes: '2026-09' })
    expect(html).toContain('Solo lectura')
    expect(html).toContain('Septiembre terminó y falta cerrarlo')
    expect(html).toContain('Sigue abierto: lo cierran los dueños.')
    expect(html).toContain('Ver qué le falta para cerrarse')
    // Descargar no es cargar.
    expect(buttons(html).some((b) => b.startsWith('Descargar el paquete del mes'))).toBe(true)
    for (const text of [
      'Revisar y cerrar',
      'Se carga a mano',
      'Sueldos del mes',
      '/asiento-manual',
      // Sin la CUIT: se le dice a quién pedírsela, no se la manda a Ajustes.
      'Cargarla',
      '/ajustes?tab=sas',
    ]) {
      expect(html, text).not.toContain(text)
    }
    expect(html).toContain('Pedísela a los dueños.')
  })

  it('/libros sin nada cargado: el vacío enseña, y el botón de cargar es solo del dueño', async () => {
    demoSeptemberOpen()
    db.settings = settings({ hasDocuments: false })
    const owner = await render(LibrosPage)
    expect(owner).toContain('Los libros se arman solos')
    expect(owner).toContain('Vos no escribís nada en los libros.')
    const ownerButtons = buttons(owner).length

    asReader()
    const reader = await render(LibrosPage, { mes: '2026-09' })
    expect(reader).toContain('Los libros se arman solos')
    expect(reader).toContain('Cuando los dueños carguen gastos, ventas y pagos')
    // Un botón menos que el dueño, por lo menos: el de «¿Qué querés cargar?».
    expect(buttons(reader).length).toBeLessThan(ownerButtons)
    expect(reader).not.toContain('Vos no escribís nada en los libros.')
  })

  it('El IVA del mes, cerrado y con deuda: «Pagar a ARCA» es solo de quien carga', async () => {
    demoSeptemberClosed()
    db.position = ivaPosition({
      status: 'closed',
      closedAt: '2026-10-05T15:00:00Z',
      settlementDocumentId: '00000000-0000-4000-8000-00000000d0c1',
      settlementUpToDate: true,
      pendingDocumentationCents: 12_295_700,
    })
    db.document = {
      status: 'posted',
      entry: {
        lines: [
          { id: '00000000-0000-4000-8000-0000000000f1', partyId: 'arca', openCents: 411_706_204 },
        ],
      },
    }
    const owner = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(owner).toContain('El IVA de septiembre')
    expect(owner).toContain('Quedó anotado al cerrar el mes.')
    expect(buttons(owner)).toContain('Pagar a ARCA')
    expect(owner).toContain('Ver cómo quedó anotado')
    expect(owner).toContain('Cargar la factura')
    expect(owner).toContain('/hub/administracion/compras/nueva')

    asReader()
    const reader = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(reader).toContain('Quedó anotado al cerrar el mes.')
    // Su palabra, y solo para mirar.
    expect(reader).toContain('Ver la liquidación')
    expect(reader).toContain('Te descontaron')
    for (const text of ['Pagar a ARCA', 'Cargar la factura', '/compras/nueva', 'accion=pagar']) {
      expect(reader, text).not.toContain(text)
    }
    // Lo único que se toca: exportar y ver como tabla o como gráfico.
    for (const label of buttons(reader)) {
      expect(label).not.toMatch(/pagar|cargar|anotar|registrar|anular|cerrar/i)
    }
  })

  it('El IVA del mes, abierto: «Ir al fin de mes» o anotarlo a mano, solo para quien carga', async () => {
    demoSeptemberOpen()
    db.position = ivaPosition()
    const onClose = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(onClose).toContain('Queda anotado solo cuando cerrás el mes.')
    expect(onClose).toContain('Ir al fin de mes')
    expect(onClose).toContain('/hub/administracion/libros/cierres?mes=2026-09')

    db.position = ivaPosition({ mode: 'manual' })
    const manual = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(manual).toContain('El IVA se anota a mano')
    expect(buttons(manual)).toContain('Registrar la liquidación del IVA')

    asReader()
    const readerManual = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(readerManual).toContain('El IVA se anota a mano')
    expect(readerManual).not.toContain('Registrar la liquidación')
    db.position = ivaPosition()
    const readerOnClose = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(readerOnClose).toContain('Queda anotado solo cuando cerrás el mes.')
    expect(readerOnClose).not.toContain('Ir al fin de mes')
    expect(readerOnClose).not.toContain('/libros/cierres')
  })

  it('El IVA del mes sin nada cargado: el vacío no le ofrece cargar a la contadora', async () => {
    demoSeptemberOpen()
    db.position = ivaPosition({
      debitFiscal: { byRate: {}, totalCents: 0 },
      creditFiscal: { byRate: {}, totalCents: 0 },
      technicalBalanceCents: 0,
      toPayCents: 0,
      isZero: true,
    })
    const owner = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(owner).toContain('Septiembre todavía no tiene IVA')
    expect(owner).toContain('Cargar el cierre del día')
    expect(owner).toContain('Cargar una compra que debo')
    // En cero no hay número: nunca «$ 0».
    expect(owner).not.toMatch(/\$ 0\b/)

    asReader()
    const reader = await render(PosicionIvaPage, { mes: '2026-09' })
    expect(reader).toContain('Septiembre todavía no tiene IVA')
    for (const text of ['Cargar el cierre del día', 'Cargar una compra', '/ventas/cierre']) {
      expect(reader, text).not.toContain(text)
    }
  })

  it('Libros IVA vacíos: «Cargar…» y «Cargarla» son solo del dueño', async () => {
    demoSeptemberOpen()
    db.settings = settings({ cuit: null })
    const screen = (book: 'purchases' | 'sales') =>
      IvaBookScreen({ tenantSlug: 'hub', book, sp: { mes: '2026-09' } }).then((node) =>
        renderToStaticMarkup(node).replaceAll('\u00a0', ' '),
      )

    const purchases = await screen('purchases')
    expect(purchases).toContain('No hay compras con factura en septiembre')
    expect(purchases).toContain('Lo que compraste sin factura queda registrado igual')
    expect(purchases).toContain('Cargar una compra que debo')
    expect(purchases).toContain('Falta la CUIT del bar para exportar los libros de IVA.')
    expect(purchases).toContain('Cargarla')
    const sales = await screen('sales')
    expect(sales).toContain('No hay ventas con factura en septiembre')
    expect(sales).toContain('Cargar el cierre del día')

    asReader()
    const readerPurchases = await screen('purchases')
    expect(readerPurchases).toContain('No hay compras con factura en septiembre')
    expect(readerPurchases).toContain('Ver el subdiario de compras')
    expect(readerPurchases).toContain('Pedísela a los dueños.')
    const readerSales = await screen('sales')
    for (const html of [readerPurchases, readerSales]) {
      for (const text of ['Cargar una compra', 'Cargar el cierre', 'Cargarla', '/compras/nueva']) {
        expect(html, text).not.toContain(text)
      }
      expect(html).not.toContain('/ventas/cierre')
      expect(html).not.toContain('/ajustes?tab=sas')
    }
  })

  it('Libro diario vacío: «Nuevo gasto» y «Cierre del día» son solo del dueño', async () => {
    demoSeptemberOpen()
    const owner = await render(DiarioPage, { mes: '2026-09' })
    expect(owner).toContain('No hay asientos en septiembre 2026')
    expect(buttons(owner)).toContain('Nuevo gasto')
    expect(owner).toContain('/hub/administracion/ventas/cierre')

    asReader()
    const reader = await render(DiarioPage, { mes: '2026-09' })
    expect(reader).toContain('No hay asientos en septiembre 2026')
    expect(reader).toContain('Cuando los dueños carguen gastos, ventas y pagos')
    expect(buttons(reader)).not.toContain('Nuevo gasto')
    expect(reader).not.toContain('/ventas/cierre')
  })

  it('Sueldos del mes y Asiento manual: la contadora ve a dónde ir a mirar, no el formulario', async () => {
    asReader()
    for (const tipo of ['sueldos', 'ajuste']) {
      const html = await render(AsientoManualPage, { tipo })
      expect(html).toContain(tipo === 'sueldos' ? 'Sueldos del mes' : 'Asiento manual')
      expect(html).toContain('Esta pantalla es para cargar asientos.')
      expect(html).toContain('Ir al libro diario')
      expect(buttons(html)).toEqual([])
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<input')
    }
  })
})

describe('Fin de mes · piezas sueltas', () => {
  it('el papel del mes: con y sin cierres, abierto y cerrado', () => {
    const open = renderToStaticMarkup(
      <MonthCover
        data={{
          month: '2026-10',
          closed: false,
          closedAt: null,
          soldCents: null,
          daysText: '0 de 1',
          ivaText: '$ 21.000 a favor',
          ivaApplies: true,
        }}
        mobileLine="Octubre 2026 · Abierto"
      />,
    )
    expect(open).toContain('Octubre 2026')
    expect(open).toContain('sin cierres cargados')
    expect(open).toContain('estimado')
    expect(open).toContain('Acá va el sello cuando lo cierres')
    expect(open).toContain(
      'Lo vendido no es lo que te quedó: faltan las compras, los gastos y los impuestos.',
    )

    const line = coverLine(
      {
        month: '2026-09',
        closed: true,
        closedAt: '2026-10-05T15:00:00Z',
        soldCents: 3_140_934_800,
        daysText: '30 de 30',
        ivaText: '$ 4.117.062 a pagar',
        ivaApplies: true,
      },
      { sold: '$ 31,4 M', iva: '$ 4,1 M a pagar' },
    )
    expect(line).toBe('Septiembre 2026 · Cerrado · Vendido $ 31,4 M · IVA $ 4,1 M a pagar')
  })

  it('el mensaje para la contadora', () => {
    expect(sendMessage('2026-09', 'https://x/hub/administracion/libros?mes=2026-09')).toBe(
      'Ya cerramos septiembre de 2026. Los libros están acá (entrás con tu usuario): https://x/hub/administracion/libros?mes=2026-09',
    )
  })

  it('la tabla de todos los meses: reabrir solo en el último cerrado y solo para quien carga', () => {
    const years = [fiscalYear([CLOSED_SEPTEMBER, period('2026-10'), period('2026-11')])]
    const props = {
      years,
      events: [],
      tenantSlug: 'hub',
      path: '/hub/administracion/libros/cierres',
      today: TODAY,
      lastClosedId: CLOSED_SEPTEMBER.id,
      changed: new Set<string>(),
      open: true,
    }
    const owner = renderToStaticMarkup(<AllMonths {...props} canWrite />)
    expect(owner).toContain('Cierres de mes: todos los meses')
    expect(owner).toContain('Ejercicio 01/09/2026 al 31/12/2026')
    expect(owner).toContain('Más opciones de septiembre')
    expect(owner).toContain('1–76')
    expect(owner).toContain('En curso')
    expect(owner).toContain('No empezó')

    const reader = renderToStaticMarkup(<AllMonths {...props} canWrite={false} />)
    expect(reader).toContain('Franco')
    expect(reader).not.toContain('Más opciones de septiembre')
    expect(buttons(reader)).toEqual([])
  })
})
