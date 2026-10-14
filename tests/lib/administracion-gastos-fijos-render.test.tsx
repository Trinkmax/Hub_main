// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GastoFijoPage from '@/app/(manager)/[tenantSlug]/administracion/compras/gastos-fijos/[id]/page'
import { InstallmentDots } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/installment-dots'
import { SaveMark } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/save-mark'
import { SheetView } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/sheet'
import { SheetCharts } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/sheet-charts'
import { SheetEmpty } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/sheet-empty'
import { TickBox } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_components/tick-box'
import { buildSheet } from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/_lib/planilla'
import CompletarPlanillaPage from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/completar/page'
import GastosFijosPage from '@/app/(manager)/[tenantSlug]/administracion/gastos-fijos/page'
import { type RecurringExpenseRow, recurringMonthStatus } from '@/lib/accounting/queries/documents'
import type { RecurringDocument, RecurringPaymentFacts } from '@/lib/accounting/recurring-status'
import { daysBetween } from '@/lib/dates'

/**
 * La planilla de gastos fijos ya dibujada: lo que la pantalla le promete a cada
 * uno. Las cuentas y las frases tienen sus tests en `…-planilla` y `…-envio`;
 * acá se cuida lo que solo se ve armado: que un bar sin montos no vea «$ 0»,
 * que el que carga tenga el botón del momento, y que a la contadora no se le
 * dibuje NINGÚN control que escriba, en ninguna de las tres pantallas.
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
vi.mock('@/lib/accounting/context', () => ({
  AccountingContextError: class extends Error {},
  loadPostingCatalog: async () => ({ accounts: data.accounts, parties: [], treasuries: [] }),
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

const NO_QUERY = { ver: null, categoria: null, factura: null }

function planilla(
  rows: RecurringExpenseRow[],
  opts: {
    month?: string
    payments?: Map<string, RecurringPaymentFacts>
    openId?: string | null
    canWrite?: boolean
  } = {},
): string {
  const canWrite = opts.canWrite ?? !ui.readOnly
  const sheet = buildSheet(rows, opts.payments ?? null, {
    month: opts.month ?? '2026-10',
    today: TODAY,
    miscAccountId: MISC,
    canWrite,
  })
  return renderToStaticMarkup(
    <>
      <SheetView
        sheet={sheet}
        tenantSlug={SLUG}
        canWrite={canWrite}
        query={NO_QUERY}
        openId={opts.openId ?? null}
        miscAccountId={MISC}
        pasteList={canWrite ? <button type="button">Pegar una lista</button> : null}
      />
      <SheetCharts sheet={sheet} tenantSlug={SLUG} />
    </>,
  )
}

const page = async (search: Record<string, string> = {}) =>
  renderToStaticMarkup(
    await GastosFijosPage({
      params: Promise.resolve({ tenantSlug: SLUG }),
      searchParams: Promise.resolve(search),
    }),
  )

/** Lo que solo puede ver quien carga: ninguno de estos textos puede llegarle a la contadora. */
const WRITE_LABELS = [
  'Pagar',
  'Poner monto',
  'Ponerles monto',
  'Completar la planilla',
  'Completar en la ficha',
  'Ordenarlos',
  'Agregar un gasto fijo',
  'Pegar una lista',
  'Editar montos',
  'Me llegó la factura',
  'Sí se paga este mes',
  'Pausar',
  'Reanudar',
  'Eliminar',
  'Abrir la ficha',
  'Volver a dejarlo pendiente',
  '¿Era eso?',
  'Sí, dejar',
  'de ahora en más',
  'Ver la factura y pagarla',
  'Se guarda con Enter',
  'Usalo también',
] as const
const WRITE_LINKS = [
  '/gastos-fijos/completar',
  '/compras/gastos-fijos/',
  '/compras/nueva',
  '/libros/asiento-manual',
  'accion=',
] as const

/** Palabras que esta pantalla no dice nunca. */
const FORBIDDEN = [
  /en negro/i,
  /en blanco/i,
  /ganancia/i,
  /ganaste/i,
  /Salteado/,
  /Saltear/,
  /Cargar factura/,
  /fuera de los libros/i,
]

describe('un bar que recién arranca (HUB: 31 sin monto, todos al 10/11)', () => {
  it('abre el mes que viene, sin «$ 0», con los pasos para arrancar', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('En octubre no vence ninguno: te muestro noviembre.')
    expect(text).toContain('Todavía no empezó')
    expect(text).toContain('Te falta de gasto fijo · noviembre')
    expect(text).toContain('Todavía no sé cuánto te falta')
    expect(text).toContain(
      'Tenés 31 gastos fijos y ninguno tiene monto. Vencen el 10 de noviembre.',
    )
    expect(text).toContain('Para arrancar')
    expect(text).toContain('0 de 31 con monto. Hoy todos dicen el día 10.')
    expect(text).toContain('6 están en «Gastos varios».')
    expect(text).toContain('Completar la planilla')
    expect(html).toContain(`href="/${SLUG}/administracion/gastos-fijos/completar"`)
    // Nunca un cero por un dato que falta.
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
    expect(html).toContain('aria-label="Noviembre, el mes que viene: 31 por pagar"')
    expect(html).toContain('aria-label="Octubre, este mes: nada por pagar"')
  })

  it('31 renglones bajo un mismo día, con «Poner monto» y sin botón de pagar (todavía no vencen)', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await page()
    expect(count(html, /data-tick="empty"/g)).toBe(31)
    // Uno por renglón en cada forma de la hoja (ancha: en la columna del monto; angosta: donde
    // iría «Pagar»): se ve uno solo por vez.
    expect(count(html, />Poner monto</g)).toBe(62)
    // La celda del monto ya dice que falta: al lado queda solo el vencimiento, sin repetirlo.
    expect(count(html, /data-tone="muted" class="adm-status/g)).toBe(0)
    expect(count(html, />Vence el 10\/11</g)).toBe(31)
    expect(count(html, /id="dia-2026-11-10"/g)).toBe(1)
    expect(count(html, />Pagar</g)).toBe(0)
    const text = textOf(html)
    expect(text).toContain('31 gastos · ninguno tiene monto todavía')
    // Ni filtros (ninguno filtraría nada) ni dibujos (ninguno tiene monto).
    expect(html).not.toContain('Filtros de la planilla')
    expect(text).not.toContain('Cómo es tu mes de gastos fijos')
    // Los seis de «Gastos varios» ofrecen cambiarlo.
    expect(count(html, />cambiar</g)).toBe(6)
  })

  it('mirando octubre a propósito: no hay número, se dice qué viene y cómo arrancar', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const text = textOf(await page({ mes: '2026-10' }))
    expect(text).toContain('En octubre no vence ninguno')
    expect(text).toContain('Lo próximo es el 10 de noviembre: 31 gastos, todavía sin monto.')
    expect(text).toContain('Ver noviembre')
    expect(text).toContain('No vencen en octubre')
    expect(text).not.toContain('te muestro noviembre')
    expect(text).not.toMatch(/\$\s?0(?![\d.,])/)
  })

  it('sin ningún gasto fijo: enseña qué va a aparecer y da el botón del paso siguiente', async () => {
    data.accounts = ACCOUNTS
    const text = textOf(await page())
    expect(text).toContain('Armá tu planilla de gastos fijos')
    expect(text).toContain('Pegar una lista')
    expect(text).toContain('Cargar uno')
    expect(text).toContain('Ejemplo')
  })
})

describe('el bar de ejemplo (tres con monto: dos vencidos y uno por vencer)', () => {
  it('el número que manda, su oración y el botón del momento', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    expect(text).toContain('Te falta de gasto fijo · octubre')
    expect(text).toMatch(/\$ ?915\.000/)
    expect(text).toContain('Son 3 gastos de octubre. 2 ya vencieron: suman $ 880.000.')
    expect(text).toContain('Lo que sigue')
    expect(text).toContain('Pagar $ 850.000')
    expect(text).toContain('Después: Dispenser Agua y 1 más.')
    expect(text).toContain('Hoy es martes 13/10')
    expect(html).toContain('aria-label="Octubre, este mes: 3 por pagar"')
  })

  it('tres casilleros vacíos, cada renglón con su «Pagar», y la fila de suma', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page()
    const text = textOf(html)
    expect(count(html, /data-tick="empty"/g)).toBe(3)
    expect(count(html, />Pagar</g)).toBe(3)
    // El nombre accesible del botón dice qué paga y cuánto.
    expect(html.replace(/\u00a0/g, ' ')).toContain(
      'aria-label="Pagar Alquiler del local, $ 850.000"',
    )
    expect(text).toContain('Venció hace 3 días')
    expect(text).toContain('Vence el jueves 15/10')
    expect(text).toContain('Total de octubre')
    expect(text).toContain('Ya pagaste')
    expect(text).toContain('Agregar un gasto fijo')
    expect(text).toContain('Editar montos y días de corrido')
    expect(html).toContain('id="dia-2026-10-10"')
    expect(html).toContain('id="dia-2026-10-15"')
    // Los filtros que sí filtran algo.
    expect(html).toContain('Filtros de la planilla')
    expect(html).toContain('ver=vencido')
    expect(html).toContain('ver=por-vencer')
    expect(html).not.toContain('ver=sin-monto')
  })

  it('los dibujos aparecen solo cuando dicen algo', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const text = textOf(await page())
    expect(text).toContain('Cómo es tu mes de gastos fijos')
    expect(text).toContain('Tenés $ 880.000 vencidos del 10')
    expect(text).toContain('Lo que más se lleva de lo fijo: Alquiler (93 %)')
    // Ninguno tiene papel de siempre: ese dibujo no existe.
    expect(text).not.toContain('de lo fijo van con factura')
    expect(text).not.toContain('Es el papel de siempre')
  })

  it('con papel de siempre, se dibuja y aclara que no es el de cada pago', () => {
    const [alquiler, dispenser, internet] = DEMO as [
      RecurringExpenseRow,
      RecurringExpenseRow,
      RecurringExpenseRow,
    ]
    const text = textOf(
      planilla([
        { ...alquiler, voucherType: 'sin_comprobante' },
        dispenser,
        { ...internet, voucherType: 'factura_a', partyName: 'Fibertel' },
      ]),
    )
    expect(text).toContain('$ 35.000 de lo fijo van con factura')
    expect(text).toContain('Con factura o sin factura, todo queda registrado en los libros.')
    expect(text).toContain('Es el papel de siempre; el de cada pago está en su comprobante.')
    expect(text).toContain('Alquiler · sin factura')
    expect(text).toContain('Internet · Factura A · Fibertel')
  })

  it('`?abrir=` abre ese renglón, con lo que se puede hacer y los dos campos para cambiar', async () => {
    data.rows = DEMO
    data.accounts = ACCOUNTS
    const html = await page({ abrir: uuid(1) })
    const text = textOf(html)
    for (const label of [
      'Me llegó la factura y la pago después',
      'Usalo también si ya lo cargaste por otro lado.',
      'Abrir la ficha',
      'Pausar',
      'Eliminar',
      'Vence el día',
      'Se guarda con Enter o al salir del campo.',
      'Falta decir a quién le pagás, con qué y qué papel te dan.',
    ]) {
      expect(text, label).toContain(label)
    }
    expect(count(html, /<input/g)).toBe(2)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain(`/compras/nueva?gasto-fijo=${uuid(1)}`)
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

  it('la pregunta va a la vista, sin abrir el renglón, y no hay «Pagar»', () => {
    const html = planilla([short], { payments })
    const text = textOf(html)
    expect(text).toContain('Calculabas $ 180.000 y pagaste $ 170.000 . ¿Era eso?')
    expect(text).toContain('Sí, dejar $ 170.000')
    expect(text).toContain('Ver el comprobante')
    expect(text).toContain('$ 10.000 menos que el monto')
    expect(count(html, />Pagar</g)).toBe(0)
    expect(html).toContain('data-tick="half"')
  })

  it('a la contadora se le dice qué pasó, sin la pregunta', () => {
    ui.readOnly = true
    const text = textOf(planilla([short], { payments }))
    expect(text).toContain('$ 10.000 menos que el monto')
    expect(text).not.toContain('¿Era eso?')
    expect(text).not.toContain('Sí, dejar')
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
    // El casillero vacío es un atajo de «Pagar» que no tiene texto: se lo busca por su nombre.
    expect(html).not.toMatch(/aria-label="Pagar/)
    expect(html).not.toMatch(/aria-label="Ver la factura/)
    // Los únicos botones que le quedan son los que muestran u ocultan algo de la misma pantalla
    // (un renglón que se abre, «Ver como tabla» de un dibujo): todos dicen qué controlan.
    for (const button of html.match(/<button\b[^>]*>/g) ?? []) {
      expect(button, button).toContain('aria-controls=')
    }
  }

  it('la planilla entera, con cada renglón abierto', () => {
    ui.readOnly = true
    for (const row of rows) {
      const html = planilla(rows, { openId: row.id })
      assertNoWrites(html)
      // Lo que sí ve: el número, los renglones con sus datos y la guía.
      const text = textOf(html)
      expect(text).toContain('Te falta de gasto fijo · octubre')
      expect(text).toContain('¿Cómo se paga un gasto fijo?')
      expect(text).toContain('En qué se gasta')
    }
  })

  it('ve el aviso del pago anulado, sin el botón para devolverlo', () => {
    ui.readOnly = true
    const html = planilla(rows)
    const text = textOf(html)
    expect(text).toContain(
      'Anulaste el pago de «Alarma» de octubre y el vencimiento quedó en noviembre.',
    )
    assertNoWrites(html)
    // El mismo aviso, para quien carga, sí trae el botón.
    ui.readOnly = false
    expect(textOf(planilla(rows))).toContain('Volver a dejarlo pendiente')
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
    const open = (id: string) =>
      planilla(gestureRows, { payments: gesturePayments, openId: id, canWrite: true })
    expect(textOf(open(skipped.id))).toContain('Sí se paga este mes')
    expect(textOf(open(overpaid.id))).toContain('de ahora en más')
    expect(open(owedWithParty.id)).toContain('aria-label="Pagar Internet de fibra')
    expect(open(owedNoParty.id)).toContain('aria-label="Ver la factura de Matafuegos y pagarla"')
    expect(textOf(open(inInstallments.id))).toContain('Pausar')

    ui.readOnly = true
    for (const row of gestureRows) {
      const html = planilla(gestureRows, { payments: gesturePayments, openId: row.id })
      assertNoWrites(html)
      // Lo que pasó se le sigue diciendo, con palabras.
      const text = textOf(html)
      expect(text).toContain('Este mes no se paga')
      expect(text).toContain('Lo debés')
      expect(text).toContain('cuota 2 de 6')
      // El comprobante se puede mirar (es un link de lectura), en los que tienen uno.
      if (gesturePayments.has(row.id)) expect(text).toContain('Ver el comprobante')
    }
  })

  it('si la sección está en solo lectura, las islas no dibujan nada que escriba aunque la página se equivoque', () => {
    // La segunda guarda: el renglón, «Lo que sigue» y el aviso del pago anulado leen el permiso
    // de la sección además del que les pasa la página.
    ui.readOnly = true
    const all = [...rows, ...gestureRows]
    for (const row of all) {
      const html = planilla(all, { payments: gesturePayments, openId: row.id, canWrite: true })
      const text = textOf(html)
      expect(html).not.toMatch(/aria-label="Pagar/)
      expect(html).not.toMatch(/aria-label="Ver la factura/)
      expect(html).not.toContain('<input')
      expect(html).not.toContain('accion=')
      expect(html).not.toContain('/compras/nueva')
      for (const label of [
        'Pagar $',
        'Poner monto',
        'Me llegó la factura',
        'Sí se paga este mes',
        'Pausar',
        'Reanudar',
        'Eliminar',
        'Abrir la ficha',
        'Volver a dejarlo pendiente',
        '¿Era eso?',
        'de ahora en más',
        'Se guarda con Enter',
      ]) {
        expect(text, label).not.toContain(label)
      }
      expect(count(html, />Pagar</g)).toBe(0)
    }
  })

  it('tampoco en el mes que viene ni en un bar que recién arranca', () => {
    ui.readOnly = true
    assertNoWrites(planilla(rows, { month: '2026-11' }))
    const hub = planilla(HUB, { month: '2026-11' })
    assertNoWrites(hub)
    expect(textOf(hub)).toContain('31 gastos fijos sin monto: todavía no se sabe cuánto falta.')
    expect(textOf(hub)).not.toMatch(/\$\s?0(?![\d.,])/)
  })

  it('la página completa: ni botones de carga ni links a las pantallas de carga', async () => {
    ui.readOnly = true
    data.rows = rows
    data.accounts = ACCOUNTS
    const html = await page()
    assertNoWrites(html)
    expect(textOf(html)).toContain('Solo lectura')
  })

  it('sin gastos fijos: se le dice que no hay nada, sin botones', async () => {
    ui.readOnly = true
    const html = renderToStaticMarkup(
      <SheetEmpty canWrite={false} pasteList={null} addOne={null} />,
    )
    expect(textOf(html)).toContain('Todavía no hay gastos fijos cargados.')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<a ')
    assertNoWrites(await page())
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

describe('el renglón abierto de quien carga', () => {
  it('con detalle (los sueldos): el monto es la suma y se dice dónde van los números del mes', () => {
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
    const html = planilla([sueldos], { openId: sueldos.id })
    const text = textOf(html)
    expect(text).toContain('$ 1.240.000 (la suma del detalle)')
    expect(text).toContain('Cambiar en la ficha')
    expect(text).toContain('Detalle 2 renglones')
    expect(text).toContain(
      'Los números del mes que te pasa la contadora van en Libros › Sueldos del mes .',
    )
    expect(html).toContain('/libros/asiento-manual?tipo=sueldos')
    // Los nombres de las personas no se muestran en la planilla.
    expect(text).not.toContain('Ana')
    // El monto no se edita acá: queda solo el día.
    expect(count(html, /<input/g)).toBe(1)
  })

  it('en cuotas: los puntitos con sus palabras y cuánto queda', () => {
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
    const html = planilla([heladera], { openId: heladera.id })
    const text = textOf(html)
    expect(text).toContain('cuota 2 de 6')
    expect(text).toContain('Cuota 2 de 6 · termina el 20/02/2027 · te quedan $ 600.000 en 5 cuotas')
    expect(count(html, /data-dot="paid"/g)).toBeGreaterThanOrEqual(1)
    expect(count(html, /data-dot="current"/g)).toBeGreaterThanOrEqual(1)
  })

  it('uno que todavía no vence se paga por adelantado, y dice qué vencimiento cubre', () => {
    const luz = mk({ id: uuid(13), name: 'Luz', amountCents: 9_000_000 })
    const text = textOf(planilla([...DEMO, luz], { openId: luz.id }))
    expect(text).toContain('No vencen en octubre')
    expect(text).toContain('Pagar por adelantado')
    expect(text).toContain('Paga el vencimiento del 10/11.')
  })

  it('en pausa: se reanuda desde su renglón', () => {
    const paused = mk({ id: uuid(9), name: 'Gimnasio', amountCents: 2_000_000, active: false })
    const text = textOf(planilla([...DEMO, paused], { openId: paused.id }))
    expect(text).toContain('En pausa o terminados')
    expect(text).toContain('Reanudar')
    expect(text).not.toContain('Pausar')
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
    // «Este mes no se paga» reemplaza a «Salteado», y se puede volver atrás.
    const text = textOf(outputs[2] ?? '')
    expect(text).toContain('Este mes no se paga')
    expect(text).toContain('Sí se paga este mes')
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
    expect(text).toContain('Completá tu planilla')
    expect(text).toContain('Cada renglón se guarda solo.')
    expect(text).toContain('Suman los que ya tienen monto')
    expect(text).toContain('0 de 31 con monto')
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
    expect(text).toContain('3 de 3 con monto')
    expect(text).toContain('Todos tienen monto.')
    expect(text).not.toContain('Sin monto')
  })

  it('`?ver=varios` deja solo los de «Gastos varios»', async () => {
    data.rows = HUB
    data.accounts = ACCOUNTS
    const html = await render({ ver: 'varios' })
    expect(count(html, /<input/g)).toBe(12)
  })
})

describe('la ficha (quien carga)', () => {
  const render = async (id: string) =>
    renderToStaticMarkup(await GastoFijoPage({ params: Promise.resolve({ tenantSlug: SLUG, id }) }))

  it('alta: tres secciones a la vista, los cuatro papeles y el renglón que se arma al lado', async () => {
    data.accounts = ACCOUNTS
    const html = await render('nuevo')
    const text = textOf(html)
    for (const label of [
      'Nuevo gasto fijo',
      'Lo cargás una vez y aparece todos los meses en tu planilla, con su vencimiento.',
      '¿Qué es?',
      '¿En qué se gasta?',
      '¿Cuánto y cuándo?',
      '¿Cuánto pagás?',
      '¿Cada cuánto?',
      'Todos los meses',
      '¿Qué día vence?',
      'El próximo es el martes 10/11.',
      '¿Es en cuotas?',
      'No, es de siempre',
      '¿Cómo lo pagás?',
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
      'Así queda en tu planilla',
      'Tu gasto fijo',
      'Guardar gasto fijo',
    ]) {
      expect(text, label).toContain(label)
    }
    // Lo que ya no se dice.
    expect(text).not.toContain('No es una deuda')
    expect(text).not.toContain('Alícuota')
    expect(text).not.toContain('Comprobante de siempre')
    // Ningún desplegable: todo son píldoras, tarjetas y campos.
    expect(html).not.toContain('role="combobox" data-slot="select-trigger"')
    expect(html).not.toContain('<select')
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
    expect(text).toContain('cuota 2 de 6')
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
