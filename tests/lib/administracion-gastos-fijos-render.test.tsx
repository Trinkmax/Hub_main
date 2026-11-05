// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GastoFijoPage from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/page'
import { CellMoney } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/cell-money'
import { InstallmentDots } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/installment-dots'
import { SaveMark } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/save-mark'
import { SheetView } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/sheet'
import { TickBox } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/tick-box'
import { buildSheet } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import {
  type PayrollSums,
  sheetTotals,
} from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla-words'
import CompletarPlanillaPage from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/completar/page'
import GastosFijosPage from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/page'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import type { RecurringDocument, RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { daysBetween } from '@/lib/dates'

/**
 * La planilla de gastos fijos ya dibujada: lo que la pantalla le promete a cada
 * uno. Las cuentas y las frases tienen sus tests en `…-planilla` y `…-envio`;
 * acá se cuida lo que solo se ve armado: que un bar sin montos no vea «$ 0»,
 * que el que carga pueda tildar y escribir el monto, y que a la contadora no se
 * le dibuje NINGÚN control que escriba, en ninguna de las tres pantallas.
 */

const TODAY = '2026-10-13'
const SLUG = 'hub'
const MISC = '00000000-0000-4000-8000-00000000aaa1'
const ACC_ALQUILER = '00000000-0000-4000-8000-00000000aaa2'
const ACC_INTERNET = '00000000-0000-4000-8000-00000000aaa3'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ui = vi.hoisted(() => ({ readOnly: false }))
const data = vi.hoisted(() => ({
  rows: [] as unknown[],
  payments: new Map<string, unknown>(),
  accounts: [] as unknown[],
  parties: [] as unknown[],
  taxAuto: false,
  payroll: null as unknown,
  payrollFails: false,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/gastos-fijos',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: () => {
    throw new Error('redirect')
  },
}))
// El contexto lo monta el layout de la sección junto con las hojas (que acá no hacen falta).
vi.mock('@/components/administracion/accounting-provider', () => {
  const value = () => ({
    tenantSlug: 'hub',
    today: '2026-10-13',
    access: { read: true, write: !ui.readOnly, admin: !ui.readOnly },
    readOnly: ui.readOnly,
    openAction: () => {},
    closeAction: () => {},
  })
  return { useAccounting: value, useAccountingOptional: value }
})
// Las acciones son del servidor: para dibujar no hacen falta (y nada de acá guarda).
vi.mock('@/lib/accounting/actions/master', () => ({
  saveRecurringExpense: vi.fn(),
  skipRecurringDue: vi.fn(),
  deleteRecurringExpense: vi.fn(),
  createRecurringBulk: vi.fn(),
}))
// La puerta de cada página: acá la decide el test (dueño que carga o contadora).
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/page-access', () => ({
  requireComprasAccess: async () => ({
    access: { tenant: { id: 'tenant-1' } },
    canWrite: !ui.readOnly,
  }),
}))
vi.mock('@/lib/accounting/queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listRecurringExpenses: async (_tenant: string, opts?: { includeInactive?: boolean }) =>
    opts?.includeInactive
      ? data.rows
      : (data.rows as Array<{ active: boolean }>).filter((row) => row.active),
  listAccounts: async () => data.accounts,
  getRecurringExpense: async (_tenant: string, id: string) =>
    (data.rows as Array<{ id: string }>).find((row) => row.id === id) ?? null,
}))
vi.mock('@/lib/accounting/queries/recurring', () => ({
  listRecurringPayments: async () => data.payments,
}))
vi.mock('@/lib/accounting/queries/payroll', () => ({
  getPayrollReport: async (_tenant: string, month: string) => {
    if (data.payrollFails) throw new Error('sin lectura')
    return data.payroll ?? { month, employees: [], accrual: null }
  },
}))
vi.mock('@/lib/accounting/context', () => ({
  AccountingContextError: class extends Error {},
  loadPostingCatalog: async () => ({
    accounts: data.accounts,
    parties: data.parties,
    treasuries: [],
    settings: { taxSettings: { auto: data.taxAuto } },
  }),
}))
// Lo que trae la tira de pago al tildar: acá no se tilda.
vi.mock('@/app/(manager)/[tenantSlug]/administracion/compras/_lib/sheet-actions', () => ({
  loadSheetData: vi.fn(),
}))
vi.mock('@/lib/dates', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  todayInCordoba: () => '2026-10-13',
}))

afterEach(() => {
  ui.readOnly = false
  data.rows = []
  data.payments = new Map()
  data.accounts = []
  data.parties = []
  data.taxAuto = false
  data.payroll = null
  data.payrollFails = false
})

/** El texto que se lee en pantalla: sin etiquetas, con el espacio duro de la plata como espacio. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length

function mk(
  over: Partial<RecurringExpenseRow> & { id: string; name: string },
): RecurringExpenseRow {
  const row = {
    partyId: null,
    partyName: null,
    accountId: ACC_ALQUILER,
    accountName: 'Alquiler',
    voucherType: null,
    vatRateBp: null,
    amountCents: null,
    frequency: 'monthly' as const,
    dueDay: 10,
    nextDueDate: '2026-11-10',
    remindDaysBefore: 5,
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
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...over,
  }
  return {
    ...row,
    monthStatus: over.monthStatus ?? recurringMonthStatus({ ...row, today: TODAY }),
    daysToDue: daysBetween(TODAY, row.nextDueDate),
  }
}

const doc = (over: Partial<RecurringDocument> & { id: string }): RecurringDocument => ({
  kind: 'purchase',
  accountingDate: '2026-10-08',
  dueDate: null,
  totalCents: 0,
  paidCents: 0,
  openCents: 0,
  ...over,
})

function account(id: string, code: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    code,
    name,
    type: 'expense',
    normalSide: 'debit',
    parentId: null,
    level: 3,
    path: [],
    postable: true,
    active: true,
    systemKey: null,
    requiresParty: false,
    isTreasury: false,
    purchaseSelectable: true,
    manualSelectable: true,
    description: null,
    sort: 0,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}
const ACCOUNTS = [
  account(ACC_ALQUILER, '4.2.01.03.001', 'Alquiler'),
  account(ACC_INTERNET, '4.2.01.03.002', 'Internet'),
  account(MISC, '4.2.01.03.099', 'Gastos varios', { systemKey: 'misc_expenses' }),
]

/** El bar de ejemplo: tres con monto, dos vencidos y uno por vencer. */
const DEMO = [
  mk({
    id: uuid(1),
    name: 'Alquiler del local',
    amountCents: 85_000_000,
    nextDueDate: '2026-10-10',
  }),
  mk({
    id: uuid(2),
    name: 'Dispenser Agua',
    amountCents: 3_000_000,
    nextDueDate: '2026-10-10',
    accountId: MISC,
    accountName: 'Gastos varios',
  }),
  mk({
    id: uuid(3),
    name: 'Internet y teléfono',
    amountCents: 3_500_000,
    dueDay: 15,
    nextDueDate: '2026-10-15',
    accountId: ACC_INTERNET,
    accountName: 'Internet',
  }),
]

/** HUB hoy: 31 sin monto, todos al 10/11, seis en «Gastos varios», dos con la cuota en el nombre. */
const HUB = Array.from({ length: 31 }, (_, index) => {
  const n = index + 1
  return mk({
    id: uuid(100 + n),
    name:
      n === 1 ? 'Licuadora 6/6 USA cord' : n === 2 ? 'Colombraro bateas 1/3' : `Gasto fijo ${n}`,
    accountId: n >= 26 ? MISC : ACC_ALQUILER,
    accountName: n >= 26 ? 'Gastos varios' : 'Alquiler',
  })
})

function planilla(
  rows: RecurringExpenseRow[],
  opts: {
    month?: string
    payments?: Map<string, RecurringPaymentFacts>
    openId?: string | null
    canWrite?: boolean
    payroll?: PayrollSums | null
  } = {},
): string {
  const canWrite = opts.canWrite ?? !ui.readOnly
  const sheet = buildSheet(rows, opts.payments ?? null, {
    month: opts.month ?? '2026-10',
    today: TODAY,
  })
  const payroll = opts.payroll === undefined ? NO_PAYROLL : opts.payroll
  return renderToStaticMarkup(
    <SheetView
      sheet={sheet}
      totals={sheetTotals(sheet, payroll)}
      payroll={payroll}
      autoTax={{}}
      tenantSlug={SLUG}
      canWrite={canWrite}
      openId={opts.openId ?? null}
      miscAccountId={MISC}
      pasteList={canWrite ? <button type="button">Pegar una lista</button> : null}
    />,
  )
}

const NO_PAYROLL: PayrollSums = {
  count: 0,
  salaryCents: 0,
  advancesCents: 0,
  paidCents: 0,
  owedCents: 0,
}

const page = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await GastosFijosPage({
      params: Promise.resolve({ tenantSlug: SLUG }),
      searchParams: Promise.resolve(search),
    }),
  )

/** Dos empleados: sueldos por $ 1.000.000, $ 300.000 adelantados o pagados. */
const PAYROLL_REPORT = {
  month: '2026-10',
  accrual: null,
  employees: [
    {
      id: uuid(501),
      name: 'Martina Ríos',
      payFrequency: 'monthly',
      active: true,
      notes: null,
      salaryCents: 60_000_000,
      advancesCents: 10_000_000,
      paidCents: 0,
      movements: [],
    },
    {
      id: uuid(502),
      name: 'Joaquín Paz',
      payFrequency: 'biweekly',
      active: true,
      notes: null,
      salaryCents: 40_000_000,
      advancesCents: 0,
      paidCents: 20_000_000,
      movements: [],
    },
  ],
}

/** Lo que solo puede ver quien carga: ninguno de estos textos puede llegarle a la contadora. */
const WRITE_LABELS = [
  'Completar la planilla',
  'Agregar gasto fijo',
  'Pegar una lista',
  'Me llegó la factura',
  'Sí se paga este mes',
  'Pausar',
  'Reanudar',
  'Eliminar',
  'Volver a dejarlo pendiente',
  '¿Era eso?',
  'Sí, dejar',
  'de ahora en más',
  'Ver la factura y pagarla',
] as const
const WRITE_LINKS = [
  '/gastos-fijos/completar',
  '/compras/gastos-fijos/',
  '/compras/nueva',
  '/libros/asiento-manual',
  'accion=',
] as const

/** Lo que esta pantalla ya no dibuja (lo que el rediseño sacó), ni palabras que no dice nunca. */
const FORBIDDEN = [
  /en negro/i,
  /en blanco/i,
  /ganancia/i,
  /ganaste/i,
  /Salteado/,
  /Saltear/,
  /Cargar factura/,
  /fuera de los libros/i,
  /Te falta de gasto fijo/,
  /Lo que sigue/,
  /Cómo es tu mes/,
  /¿Cómo se calcula\?/,
  /Para arrancar/,
]

describe('un bar que recién arranca (HUB: 31 sin monto, todos al 10/11)', () => {
  it('abre el mes que viene, sin «$ 0», y dice cuántos no suman', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('En octubre no vence ninguno: te muestro noviembre.')
    expect(text).toContain('31 sin monto: no suman')
    // Nunca un cero por un dato que falta.
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
    expect(html).toMatch(/aria-current="page"[^>]*>Noviembre</)
    expect(text).toContain('Completar la planilla')
    expect(html).toContain(`href="/${SLUG}/administracion/gastos-fijos/completar"`)
  })

  it('31 filas, cada una con su celda para poner el monto, y sin tildar para pagar', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await page()
    expect(count(html, /data-tick="empty"/g)).toBe(31)
    expect(count(html, /data-cell="monto"/g)).toBe(31)
    expect(count(html, /placeholder="Poner monto"/g)).toBe(31)
    // El estado va una vez como columna y otra debajo del concepto (solo en el celular).
    expect(count(html, />Sin monto</g)).toBe(62)
    // Todavía no vencen este mes de verdad… pero mirando noviembre se puede pagar por adelantado.
    expect(count(html, /aria-label="Pagar Gasto fijo 3"/g)).toBe(1)
  })

  it('mirando octubre a propósito: no hay número, y los que vencen después están plegados', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const text = textOf(await page({ mes: '2026-10' }))
    expect(text).toContain('En octubre no vence ninguno.')
    expect(text).toContain('No vencen en octubre 31')
    expect(text).not.toContain('te muestro noviembre')
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
  })

  it('sin ningún gasto fijo: una oración y los botones, adentro de la misma planilla', async () => {
    data.accounts = ACCOUNTS
    const text = textOf(await page())
    expect(text).toContain('Todavía no cargaste gastos fijos.')
    expect(text).toContain('Pegar una lista')
    expect(text).toContain('Agregar gasto fijo')
    // Los sueldos siguen teniendo su fila.
    expect(text).toContain('Sueldos del personal')
    expect(text).toContain('Sin cargar')
  })
})

describe('el bar de ejemplo (tres con monto: dos vencidos y uno por vencer)', () => {
  it('el totalizador: total, pagado, por pagar y vencido', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    for (const label of ['Total del mes', 'Pagado', 'Por pagar', 'Vencido']) {
      expect(text, label).toContain(label)
    }
    expect(text).toMatch(/\$ ?915\.000/)
    expect(text).toMatch(/\$ ?880\.000/)
    // Sin hero, sin «Lo que sigue», sin dibujos.
    for (const word of FORBIDDEN) expect(text).not.toMatch(word)
    expect(html).toContain('<h1 class="sr-only">Gastos fijos</h1>')
  })

  it('una fila por gasto: se tilda, se escribe el monto y tiene su «⋯»', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    expect(count(html, /data-tick="empty"/g)).toBe(3)
    expect(count(html, /data-cell="monto"/g)).toBe(3)
    expect(html).toContain('aria-label="Monto de Alquiler del local"')
    // Tildar paga: el nombre accesible dice qué paga y cuánto.
    expect(html.replace(/ /g, ' ')).toContain('aria-label="Pagar Alquiler del local, $ 850.000"')
    expect(html).toContain('aria-label="Más opciones de Alquiler del local"')
    expect(text).toContain('Vencido')
    expect(text).toContain('Por vencer')
    expect(text).toContain('10/10')
    expect(text).toContain('15/10')
    expect(text).toContain('Agregar gasto fijo')
    expect(text).toContain('Pegar una lista')
    expect(text).toContain('Completar la planilla')
    // La doble raya del total.
    expect(html).toContain('adm-double-rule')
    expect(text).toMatch(/Total \$ ?915\.000/)
  })

  it('`?abrir=` marca ese renglón y entra en su mes', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    expect(await page()).not.toContain('bg-warning/10')
    expect(await page({ abrir: uuid(1) })).toContain('bg-warning/10')
  })
})

describe('un gasto ya pago', () => {
  const paid = mk({
    id: uuid(40),
    name: 'Luz',
    amountCents: 18_000_000,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-1',
    lastDocumentDate: '2026-10-08',
  })
  const payments = new Map<string, RecurringPaymentFacts>([
    [
      paid.id,
      {
        document: doc({ id: 'doc-1', totalCents: 18_000_000, paidCents: 18_000_000 }),
        priorOpenCents: 0,
      },
    ],
  ])

  it('lleva el sello, un link al comprobante, y su monto ya no se escribe', () => {
    const html = planilla([paid], { payments })
    expect(textOf(html)).toContain('Pagado el 08/10')
    expect(html).toContain('aria-label="Pagado el 08/10. Ver el comprobante de Luz"')
    expect(html).toContain(`href="/${SLUG}/administracion/comprobantes/doc-1"`)
    expect(html).toContain('data-tick="done"')
    expect(html).not.toContain('data-cell="monto"')
    expect(html).not.toMatch(/aria-label="Pagar Luz/)
    // El sello cae solo cuando recién se pagó, no cada vez que se abre la pantalla.
    expect(html).not.toContain('adm-thud')
  })
})

describe('pagaste distinto de lo que calculabas', () => {
  const short = mk({
    id: uuid(7),
    name: 'Luz',
    amountCents: 18_000_000,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-1',
    lastDocumentDate: '2026-10-08',
  })
  const payments = new Map<string, RecurringPaymentFacts>([
    [
      short.id,
      {
        document: doc({ id: 'doc-1', totalCents: 17_000_000, paidCents: 17_000_000 }),
        priorOpenCents: 0,
      },
    ],
  ])

  it('la pregunta va a la vista, y tildar no paga de nuevo', () => {
    const html = planilla([short], { payments })
    const text = textOf(html)
    expect(text).toContain('Pagaste $ 170.000')
    expect(text).toContain('Calculabas $ 180.000. ¿Era eso?')
    expect(html).not.toMatch(/aria-label="Pagar Luz/)
    expect(html).toContain('data-tick="half"')
  })

  it('a la contadora se le dice qué pasó, sin la pregunta', () => {
    ui.readOnly = true
    const text = textOf(planilla([short], { payments }))
    expect(text).toContain('$ 10.000 menos que el monto')
    expect(text).not.toContain('¿Era eso?')
  })
})

describe('la fila de los sueldos', () => {
  it('suma al totalizador y lleva a la planilla de Sueldos', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    data.payroll = PAYROLL_REPORT
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Sueldos del personal')
    expect(text).toContain('Falta $ 700.000')
    expect(text).toContain('31/10')
    expect(html).toContain(`href="/${SLUG}/administracion/sueldos?mes=2026-10"`)
    expect(text).toContain('Con $ 1.000.000 de sueldos')
    // $ 915.000 de fijos + $ 1.000.000 de sueldos, y la doble raya dice lo mismo.
    expect(text).toMatch(/\$ ?1\.915\.000/)
    expect(text).toMatch(/Total \$ ?1\.915\.000/)
    // Lo adelantado y lo pagado de los sueldos, en «Pagado».
    expect(text).toMatch(/Pagado \$ ?300\.000/)
    // $ 915.000 de fijos + $ 700.000 que se les debe.
    expect(text).toMatch(/Por pagar \$ ?1\.615\.000/)
  })

  it('un gasto fijo viejo con nombre de sueldos sigue siendo otra fila', async () => {
    data.rows = [
      mk({
        id: uuid(50),
        name: 'Sueldos personal',
        amountCents: 124_000_000,
        nextDueDate: '2026-10-05',
        dueDay: 5,
      }),
    ]
    data.accounts = ACCOUNTS
    data.payroll = PAYROLL_REPORT
    const text = textOf(await page())
    expect(text).toContain('Sueldos personal')
    expect(text).toContain('Sueldos del personal')
  })

  it('si no se pudieron leer, la planilla igual se dibuja y lo dice', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    data.payrollFails = true
    const text = textOf(await page())
    expect(text).toContain('No se pudo leer')
    expect(text).toMatch(/\$ ?915\.000/)
    expect(text).not.toContain('de sueldos')
  })
})

describe('un impuesto que se devenga solo', () => {
  const iibb = mk({
    id: uuid(60),
    name: 'Ingresos Brutos',
    amountCents: 5_000_000,
    nextDueDate: '2026-10-20',
    dueDay: 20,
    accountId: uuid(61),
    accountName: 'Ingresos Brutos',
  })
  const scene = (auto: boolean) => {
    data.rows = [iibb]
    data.accounts = [
      ...ACCOUNTS,
      account(uuid(61), '4.2.05', 'IIBB', { systemKey: 'iibb_expense' }),
    ]
    data.parties = [{ id: uuid(62), systemKey: 'rentas', active: true }]
    data.taxAuto = auto
  }

  it('se tilda igual: abre el pago al partícipe, sin la tira de gasto', async () => {
    scene(true)
    const html = await page()
    // Es un botón que paga, pero no abre nada debajo: no lleva `aria-expanded`.
    expect(html).toMatch(/<button[^>]*aria-label="Pagar Ingresos Brutos[^"]*"/)
    expect(html).not.toMatch(/aria-expanded="false"[^>]*>\s*<span[^>]*data-tick/)
  })

  it('con los impuestos apagados se paga como cualquier gasto', async () => {
    scene(false)
    expect(await page()).toMatch(/aria-expanded="false"/)
  })
})

describe('la hoja del mes que viene, con cosas que quedaron de antes', () => {
  it('si es lo único que hay: sin total, con la vuelta a la hoja de hoy', async () => {
    // El bar de ejemplo mirando noviembre: los tres siguen sin pagar desde octubre.
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page({ mes: '2026-11' })
    const text = textOf(html)
    expect(text).toContain('Quedó de antes')
    expect(text).toContain('Ver octubre')
    expect(html).toContain(`href="/${SLUG}/administracion/gastos-fijos?mes=2026-10"`)
    expect(text).toContain('Total de noviembre —')
    // La deuda de octubre no entra al total de noviembre, pero se ve en «Vencido».
    expect(text).toMatch(/Vencido \$ ?880\.000/)
    // Los renglones siguen ahí, y se pueden pagar.
    expect(count(html, /aria-label="Pagar /g)).toBe(3)
  })

  it('si hay de los dos: el total es lo de noviembre y cada tramo tiene su rótulo', async () => {
    const luz = mk({ id: uuid(30), name: 'Luz', amountCents: 12_000_000 })
    data.rows = [...DEMO, luz]
    data.accounts = ACCOUNTS
    const text = textOf(await page({ mes: '2026-11' }))
    expect(text).toContain('Quedó de antes')
    expect(text).toContain('Vence en noviembre')
    expect(text).toMatch(/Total de noviembre \$ ?120\.000/)
  })
})

describe('lo que el renglón sigue diciendo', () => {
  it('las cuotas, chiquito debajo del concepto', () => {
    const heladera = mk({
      id: uuid(12),
      name: 'Heladera',
      amountCents: 12_000_000,
      nextDueDate: '2026-10-20',
      dueDay: 20,
      endsOn: '2027-02-20',
      remainingDues: 5,
      installmentsTotal: 6,
    })
    const html = planilla([heladera])
    expect(html).toMatch(/<small[^>]*>cuota 2 de 6<\/small>/)
  })

  it('con detalle (los sueldos) el monto es la suma: no se escribe, y los nombres no se muestran', () => {
    const sueldos = mk({
      id: uuid(11),
      name: 'Sueldos personal',
      amountCents: 124_000_000,
      nextDueDate: '2026-10-05',
      dueDay: 5,
      breakdown: [
        { label: 'Ana', kind: 'blanco', amountCents: 100_000_000 },
        { label: 'Ana', kind: 'aporte', amountCents: 24_000_000 },
      ],
    })
    const html = planilla([sueldos])
    const text = textOf(html)
    expect(text).toContain('$ 1.240.000')
    expect(html).toContain('title="La suma del detalle"')
    expect(html).not.toContain('data-cell="monto"')
    expect(text).not.toContain('Ana')
  })

  it('los que no vencen este mes y los pausados quedan plegados debajo', () => {
    const luz = mk({ id: uuid(13), name: 'Luz', amountCents: 9_000_000 })
    const paused = mk({ id: uuid(9), name: 'Gimnasio', amountCents: 2_000_000, active: false })
    const html = planilla([...DEMO, luz, paused])
    const text = textOf(html)
    expect(text).toContain('No vencen en octubre 1')
    expect(text).toContain('En pausa o terminados 1')
    expect(count(html, /<details/g)).toBe(2)
    // Se abren solos si `?abrir=` apunta a uno de ellos.
    expect(planilla([...DEMO, luz, paused], { openId: luz.id })).toMatch(/<details[^>]* open/)
  })

  it('lo que quedó sin pagar de meses anteriores se avisa al pie', () => {
    const luz = mk({ ...DEMO[0], id: uuid(14), name: 'Luz' } as RecurringExpenseRow)
    const payments = new Map<string, RecurringPaymentFacts>([
      [luz.id, { document: null, priorOpenCents: 4_000_000 }],
    ])
    const text = textOf(planilla([luz], { payments }))
    expect(text).toContain('Aparte, de meses anteriores te quedan $ 40.000 sin pagar.')
    expect(text).toContain('Ver en Compras y pagos')
  })
})

describe('la contadora (solo lectura) no recibe ningún control que escriba', () => {
  const voided = mk({
    id: uuid(8),
    name: 'Alarma',
    amountCents: 4_500_000,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-anulado',
    lastDocumentDate: null,
  })
  const paused = mk({ id: uuid(9), name: 'Gimnasio', amountCents: 2_000_000, active: false })
  const blank = mk({ id: uuid(10), name: 'Seguro', nextDueDate: '2026-10-20', dueDay: 20 })
  const detailed = mk({
    id: uuid(11),
    name: 'Sueldos personal',
    amountCents: 124_000_000,
    nextDueDate: '2026-10-05',
    dueDay: 5,
    accountId: MISC,
    accountName: 'Gastos varios',
    breakdown: [{ label: 'Ana', kind: null, amountCents: 124_000_000 }],
  })
  const rows = [...DEMO, voided, paused, blank, detailed]

  function assertNoWrites(html: string) {
    const text = textOf(html)
    for (const label of WRITE_LABELS) expect(text, label).not.toContain(label)
    for (const link of WRITE_LINKS) expect(html, link).not.toContain(link)
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<textarea')
    // Tildar es un botón que no tiene texto: se lo busca por su nombre.
    expect(html).not.toMatch(/aria-label="Pagar/)
    expect(html).not.toMatch(/aria-label="Más opciones/)
    // No le queda ningún botón: la fila es lectura y los plegados son nativos.
    expect(html).not.toContain('<button')
  }

  it('la planilla entera', () => {
    ui.readOnly = true
    const html = planilla(rows)
    assertNoWrites(html)
    // Lo que sí ve: el total, los renglones con su estado y la guía.
    const text = textOf(html)
    expect(text).toContain('Total')
    expect(text).toContain('Vencido')
    expect(text).toContain('¿Cómo se paga un gasto fijo?')
  })

  // Los renglones que traen un gesto propio: el que no se paga este mes, el que se pagó de
  // más, el que tiene la factura cargada (con y sin proveedor) y el que va en cuotas.
  const skipped = mk({
    id: uuid(20),
    name: 'Dominio',
    amountCents: 1_000_000,
    nextDueDate: '2026-11-10',
    skippedDue: '2026-10-10',
  })
  const overpaid = mk({
    id: uuid(21),
    name: 'Luz',
    amountCents: 18_000_000,
    nextDueDate: '2026-11-10',
    loadedDue: '2026-10-10',
    lastDocumentId: 'doc-luz',
    lastDocumentDate: '2026-10-08',
  })
  const owedWithParty = mk({
    id: uuid(22),
    name: 'Internet de fibra',
    amountCents: 3_500_000,
    dueDay: 15,
    nextDueDate: '2026-11-15',
    loadedDue: '2026-10-15',
    lastDocumentId: 'doc-fibra',
    lastDocumentDate: '2026-10-05',
    partyId: uuid(900),
    partyName: 'Fibertel',
  })
  const owedNoParty = mk({
    id: uuid(23),
    name: 'Matafuegos',
    amountCents: 2_000_000,
    dueDay: 20,
    nextDueDate: '2026-11-20',
    loadedDue: '2026-10-20',
    lastDocumentId: 'doc-matafuegos',
    lastDocumentDate: '2026-10-06',
  })
  const inInstallments = mk({
    id: uuid(24),
    name: 'Heladera',
    amountCents: 12_000_000,
    dueDay: 20,
    nextDueDate: '2026-10-20',
    endsOn: '2027-02-20',
    remainingDues: 5,
    installmentsTotal: 6,
  })
  const gestureRows = [skipped, overpaid, owedWithParty, owedNoParty, inInstallments]
  const gesturePayments = new Map<string, RecurringPaymentFacts>([
    [
      overpaid.id,
      {
        document: doc({ id: 'doc-luz', totalCents: 19_500_000, paidCents: 19_500_000 }),
        priorOpenCents: 0,
      },
    ],
    [
      owedWithParty.id,
      {
        document: doc({
          id: 'doc-fibra',
          accountingDate: '2026-10-05',
          dueDate: '2026-10-25',
          totalCents: 3_500_000,
          openCents: 3_500_000,
        }),
        priorOpenCents: 0,
      },
    ],
    [
      owedNoParty.id,
      {
        document: doc({
          id: 'doc-matafuegos',
          accountingDate: '2026-10-06',
          dueDate: '2026-10-28',
          totalCents: 2_000_000,
          openCents: 2_000_000,
        }),
        priorOpenCents: 0,
      },
    ],
  ])

  it('los gestos de cada renglón (no se paga, pagaste de más, factura cargada, cuotas)', () => {
    // Quien carga los tiene: si no, este test no probaría nada.
    const writer = planilla(gestureRows, { payments: gesturePayments, canWrite: true })
    expect(writer).toContain('aria-label="Pagar Internet de fibra')
    expect(writer).toContain('aria-label="Pagar Matafuegos')

    ui.readOnly = true
    const html = planilla(gestureRows, { payments: gesturePayments })
    assertNoWrites(html)
    // Lo que pasó se le sigue diciendo, con palabras.
    const text = textOf(html)
    expect(text).toContain('Este mes no se paga')
    expect(text).toContain('Lo debés')
    expect(text).toContain('cuota 2 de 6')
    // El comprobante se puede mirar: es un link de lectura.
    expect(html).toContain('aria-label="Pagado el 08/10. Ver el comprobante de Luz"')
  })

  it('si la sección está en solo lectura, no se dibuja nada que escriba aunque la página se equivoque', () => {
    // La segunda guarda: la planilla lee el permiso de la sección además del que le pasa la página.
    ui.readOnly = true
    const all = [...rows, ...gestureRows]
    assertNoWrites(
      planilla(all, { payments: gesturePayments, canWrite: true }).replace(
        '<button type="button">Pegar una lista</button>',
        '',
      ),
    )
  })

  it('tampoco en el mes que viene ni en un bar que recién arranca', () => {
    ui.readOnly = true
    assertNoWrites(planilla(rows, { month: '2026-11' }))
    const hub = planilla(HUB, { month: '2026-11' })
    assertNoWrites(hub)
    expect(textOf(hub)).not.toMatch(/\$\s?0(?![\d.,])/)
  })

  it('la página completa: ni botones de carga ni links a las pantallas de carga', async () => {
    ui.readOnly = true
    data.rows = rows
    data.accounts = ACCOUNTS
    const html = await page()
    expect(textOf(html)).toContain('Solo lectura')
    // Ve el aviso del pago anulado, sin el botón para devolverlo.
    expect(textOf(html)).not.toContain('Volver a dejarlo pendiente')
    assertNoWrites(html)
  })

  it('el aviso del pago anulado: el que carga tiene el botón', async () => {
    data.rows = [voided, ...DEMO]
    data.accounts = ACCOUNTS
    const text = textOf(await page())
    expect(text).toContain(
      'Anulaste el pago de «Alarma» de octubre y el vencimiento quedó en noviembre.',
    )
    expect(text).toContain('Volver a dejarlo pendiente')
  })

  it('sin gastos fijos: se le dice que no hay nada, sin botones', async () => {
    ui.readOnly = true
    const html = await page()
    expect(textOf(html)).toContain('Todavía no hay gastos fijos cargados.')
    assertNoWrites(html)
  })

  it('«Completar la planilla» y la ficha: un aviso con la vuelta a la planilla', async () => {
    ui.readOnly = true
    data.rows = rows
    data.accounts = ACCOUNTS
    const args = { params: Promise.resolve({ tenantSlug: SLUG }) }
    const fill = renderToStaticMarkup(
      await CompletarPlanillaPage({ ...args, searchParams: Promise.resolve({}) }),
    )
    const ficha = renderToStaticMarkup(
      await GastoFijoPage({ params: Promise.resolve({ tenantSlug: SLUG, id: uuid(1) }) }),
    )
    const nueva = renderToStaticMarkup(
      await GastoFijoPage({ params: Promise.resolve({ tenantSlug: SLUG, id: 'nuevo' }) }),
    )
    for (const html of [fill, ficha, nueva]) {
      expect(textOf(html)).toContain('Esta pantalla es para cargar')
      expect(html).toContain(`href="/${SLUG}/administracion/gastos-fijos"`)
      expect(html).not.toContain('<input')
      expect(html).not.toContain('<form')
      expect(textOf(html)).not.toContain('Guardar')
    }
  })
})

describe('las palabras de la pantalla', () => {
  it('nunca dice «en negro», «en blanco», «ganancia», «Salteado» ni «Cargar factura»', async () => {
    const skipped = mk({
      id: uuid(14),
      name: 'Dominio',
      amountCents: 1_000_000,
      nextDueDate: '2026-11-10',
      skippedDue: '2026-10-10',
    })
    const outputs = [
      planilla(HUB, { month: '2026-11' }),
      planilla(DEMO, { openId: uuid(1) }),
      planilla([...DEMO, skipped], { openId: skipped.id }),
      planilla([...DEMO, { ...skipped, voucherType: 'sin_comprobante' }]),
    ]
    data.rows = HUB
    data.accounts = ACCOUNTS
    outputs.push(
      renderToStaticMarkup(
        await CompletarPlanillaPage({
          params: Promise.resolve({ tenantSlug: SLUG }),
          searchParams: Promise.resolve({}),
        }),
      ),
      renderToStaticMarkup(
        await GastoFijoPage({ params: Promise.resolve({ tenantSlug: SLUG, id: 'nuevo' }) }),
      ),
    )
    for (const html of outputs) {
      const text = textOf(html)
      for (const word of FORBIDDEN) expect(text).not.toMatch(word)
    }
    // «Este mes no se paga» reemplaza a «Salteado».
    expect(textOf(outputs[2] ?? '')).toContain('Este mes no se paga')
  })
})

describe('«Completar la planilla» (quien carga)', () => {
  const render = async (search: Record<string, string> = {}) =>
    renderToStaticMarkup(
      await CompletarPlanillaPage({
        params: Promise.resolve({ tenantSlug: SLUG }),
        searchParams: Promise.resolve(search),
      }),
    )

  it('HUB: los 31 a la vista, dos campos por renglón, sin «$ 0»', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await render()
    const text = textOf(html)
    expect(html).toMatch(/<h1 class="font-serif[^"]*"[^>]*>Completá tu planilla<\/h1>/)
    expect(text).toContain('Cada renglón se guarda solo.')
    expect(text).toContain('Suman los que ya tienen monto')
    expect(text).toContain('Con monto 0 de 31')
    expect(text).toContain('Pegar los montos desde mi planilla')
    expect(text).toContain('Hoy todos dicen el día 10: cambialo en los que no.')
    expect(text).toContain('Faltan 31 sin monto.')
    expect(text).toContain('Listo: volver a la planilla')
    expect(count(html, /<input/g)).toBe(62)
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
    // Las dos ayudas que aplican: la cuota escrita en el nombre y «Gastos varios».
    expect(text).toContain('¿Es la cuota 6 de 6?')
    expect(text).toContain('¿Es la cuota 1 de 3?')
    expect(count(html, />Gastos varios · cambiar</g)).toBe(6)
    // Una sola vez, debajo del primero sin monto.
    expect(count(html, /poné lo que pagaste la última vez/g)).toBe(1)
  })

  it('con todos los montos puestos pasa a «Editá tu planilla» y suma lo cargado', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const text = textOf(await render())
    expect(text).toContain('Editá tu planilla')
    expect(text).toMatch(/\$ ?915\.000/)
    expect(text).toContain('Con monto 3 de 3')
    expect(text).toContain('Todos tienen monto.')
    expect(text).not.toContain('Sin monto')
  })

  it('`?ver=varios` deja solo los de «Gastos varios»', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await render({ ver: 'varios' })
    expect(count(html, /<input/g)).toBe(12)
  })

  it('sin ninguno: una oración y un botón', async () => {
    data.accounts = ACCOUNTS
    const html = await render()
    expect(textOf(html)).toContain('Todavía no hay gastos fijos para completar.')
    expect(html).toContain(`href="/${SLUG}/administracion/compras/gastos-fijos/nuevo"`)
  })
})

describe('la ficha (quien carga)', () => {
  const render = async (id: string) =>
    renderToStaticMarkup(await GastoFijoPage({ params: Promise.resolve({ tenantSlug: SLUG, id }) }))

  it('alta: un solo bloque con todos los campos, sin tarjetas numeradas ni vista previa', async () => {
    data.accounts = ACCOUNTS
    const html = await render('nuevo')
    const text = textOf(html)
    expect(html).toMatch(/<h1 class="font-serif[^"]*"[^>]*>Nuevo gasto fijo<\/h1>/)
    for (const label of [
      'Nombre',
      '¿En qué se gasta?',
      '¿Cuánto pagás?',
      '¿Cada cuánto?',
      'Todos los meses',
      '¿Qué día vence?',
      'El próximo es el martes 10/11.',
      '¿Es en cuotas?',
      'No, es de siempre',
      '¿Qué papel te dan?',
      'Factura A',
      'Factura B o C',
      'Tique',
      'Remito o nada',
      'No sé o cambia',
      'Al pagar te lo pregunto. Arranca en «Remito o nada».',
      '¿A quién le pagás?',
      '¿Con qué lo pagás casi siempre?',
      'Lo elijo cada vez',
      'Más opciones',
      'Guardar gasto fijo',
    ]) {
      expect(text, label).toContain(label)
    }
    // Lo que ya no se dice.
    for (const gone of ['¿Qué es?', '¿Cuánto y cuándo?', '¿Cómo lo pagás?', 'Así queda en tu']) {
      expect(text, gone).not.toContain(gone)
    }
    expect(text).not.toContain('No es una deuda')
    expect(text).not.toContain('Alícuota')
    expect(text).not.toContain('Comprobante de siempre')
    // Ningún desplegable: todo son píldoras, tarjetas y campos.
    expect(html).not.toContain('role="combobox" data-slot="select-trigger"')
    expect(html).not.toContain('<select')
    expect(html).toContain('md:grid-cols-2')
  })

  it('edición de una compra en cuotas: abre contestada al derecho y con «En pausa»', async () => {
    data.accounts = ACCOUNTS
    data.rows = [
      mk({
        id: uuid(12),
        name: 'Heladera',
        amountCents: 12_000_000,
        nextDueDate: '2026-11-10',
        endsOn: '2027-03-10',
        remainingDues: 5,
        installmentsTotal: 6,
        voucherType: 'factura_a',
        vatRateBp: 2100,
      }),
    ]
    const text = textOf(await render(uuid(12)))
    expect(text).toContain('¿De cuántas cuotas es?')
    expect(text).toContain('¿Por cuál vas?')
    expect(text).toContain(
      'La próxima es la cuota 2 de 6. La última vence el 10/03/2027. Después sale sola de la planilla.',
    )
    expect(text).toContain('IVA de siempre')
    expect(text).toContain('Una factura pide proveedor.')
    expect(text).toContain('En pausa')
    expect(text).toContain('Guardar cambios')
  })

  it('uno que ya terminó: no anuncia un «próximo» al lado de «Ya terminó»', async () => {
    data.accounts = ACCOUNTS
    data.rows = [
      mk({
        id: uuid(15),
        name: 'Licuadora',
        amountCents: 8_000_000,
        nextDueDate: '2026-10-10',
        endsOn: '2026-09-10',
        remainingDues: 0,
        installmentsTotal: 6,
        active: false,
        ended: true,
      }),
    ]
    const text = textOf(await render(uuid(15)))
    expect(text).toContain('Ya terminó: la última cuota venció el 10/09/2026.')
    expect(text).toContain('Terminó: ya pasó la última cuota.')
    expect(text).not.toContain('El próximo es')
  })

  it('uno vencido sin pagar: su vencimiento se dice en pasado, no como «el próximo»', async () => {
    data.accounts = ACCOUNTS
    data.rows = [
      mk({
        id: uuid(16),
        name: 'Alquiler del local',
        amountCents: 85_000_000,
        nextDueDate: '2026-10-10',
      }),
    ]
    const text = textOf(await render(uuid(16)))
    expect(text).toContain('Venció el sábado 10/10: todavía no lo pagaste.')
    expect(text).not.toContain('El próximo es el sábado 10/10')
  })
})

describe('las piezas propias de la planilla', () => {
  it('el casillero: vacío, tildado, a medias y con raya, siempre con su nombre', () => {
    for (const state of ['empty', 'done', 'half', 'skip'] as const) {
      const html = renderToStaticMarkup(<TickBox state={state} label={`Estado ${state}`} />)
      expect(html).toContain(`data-tick="${state}"`)
      expect(html).toContain(`aria-label="Estado ${state}"`)
      expect(html).toContain('role="img"')
    }
    const done = renderToStaticMarkup(<TickBox state="done" label="Pagado" />)
    expect(done).toContain('adm-tick')
    expect(done).not.toContain('adm-tick-draw')
    // El tilde se dibuja solo cuando se completa en esta visita.
    expect(renderToStaticMarkup(<TickBox state="done" animate label="Pagado" />)).toContain(
      'adm-tick-draw',
    )
  })

  it('la celda de plata: pesos, a la derecha y con su nombre; vacío no es cero', () => {
    const cell = (cents: number | null) =>
      renderToStaticMarkup(
        <CellMoney
          column="monto"
          label="Monto de EPEC"
          value={cents}
          onCommit={() => {}}
          placeholder="Poner monto"
        />,
      )
    const html = cell(31_240_000)
    expect(html).toContain('value="312.400"')
    expect(html).toContain('aria-label="Monto de EPEC"')
    expect(html).toContain('data-cell="monto"')
    expect(html).toContain('text-right')
    const empty = cell(null)
    expect(empty).toContain('value=""')
    expect(empty).toContain('placeholder="Poner monto"')
  })

  it('los puntitos: uno por cuota; con demasiadas, una barrita', () => {
    const dots = renderToStaticMarkup(<InstallmentDots current={2} total={6} remaining={5} />)
    expect(count(dots, /data-dot="paid"/g)).toBe(1)
    expect(count(dots, /data-dot="current"/g)).toBe(1)
    expect(count(dots, /data-dot="left"/g)).toBe(4)
    expect(dots).toContain('aria-hidden')
    // Sin saber de cuántas: solo las que faltan, la primera es la que toca.
    const unknown = renderToStaticMarkup(
      <InstallmentDots current={null} total={null} remaining={3} />,
    )
    expect(count(unknown, /data-dot=/g)).toBe(3)
    expect(count(unknown, /data-dot="current"/g)).toBe(1)
    const many = renderToStaticMarkup(<InstallmentDots current={14} total={36} remaining={23} />)
    expect(count(many, /data-dot=/g)).toBe(0)
    expect(many).toContain('width:36%')
    expect(
      renderToStaticMarkup(<InstallmentDots current={null} total={null} remaining={0} />),
    ).toBe('')
  })

  it('la marca de guardado avisa sin interrumpir y ofrece reintentar', () => {
    expect(renderToStaticMarkup(<SaveMark state="idle" />)).not.toContain('Guard')
    expect(renderToStaticMarkup(<SaveMark state="saving" />)).toContain('Guardando…')
    const saved = renderToStaticMarkup(<SaveMark state="saved" />)
    expect(saved).toContain('Guardado')
    expect(saved).toContain('aria-live="polite"')
    const failed = renderToStaticMarkup(
      <SaveMark
        state="error"
        message="Alguien lo cambió recién."
        onRetry={() => {}}
        retryLabel="Recargar"
      />,
    )
    expect(failed).toContain('Alguien lo cambió recién.')
    expect(failed).toContain('Recargar')
    expect(renderToStaticMarkup(<SaveMark state="error" />)).toContain('No se guardó')
  })
})
