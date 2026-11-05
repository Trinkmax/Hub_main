// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DiarioPage from '@/app/(manager)/[tenantSlug]/administracion/libros/diario/page'
import MayorPage from '@/app/(manager)/[tenantSlug]/administracion/libros/mayor/page'
import SumasYSaldosPage from '@/app/(manager)/[tenantSlug]/administracion/libros/sumas-y-saldos/page'
import {
  entryKindLabel,
  type FiscalYearRow,
  type ImputationFlag,
  type TrialBalanceRow,
} from '@/lib/accounting/queries'

/**
 * El camino de Silvia (min. 10 a 13), dibujado: Sumas y saldos «a ojo de auditor» → la cuenta rara →
 * su Mayor, con el período y los filtros → la fila del asiento. Las cuentas puras tienen sus tests en
 * `administracion-libros-anomalies` y `administracion-libros-mayor`; acá se cuida lo que solo se ve
 * armado: qué columnas salen, qué se marca, a dónde lleva cada toque.
 */

const ui = vi.hoisted(() => ({ readOnly: false }))
const db = vi.hoisted(() => ({
  trial: null as unknown,
  systemKeys: new Map<string, string>(),
  ledger: null as unknown,
  flags: [] as unknown[],
  journal: null as unknown,
  summary: null as unknown,
  catalog: null as unknown,
  firstOpenDate: '2026-09-01' as string | null,
  /** Lo último que se le pidió al Mayor. */
  ledgerArgs: null as unknown,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/libros/sumas-y-saldos',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
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
vi.mock('@/app/(manager)/[tenantSlug]/administracion/libros/_lib/page-access', () => ({
  requireBooksAccess: async () => ({
    canWrite: !ui.readOnly,
    access: { tenant: { id: 'tenant-1', slug: 'hub' }, role: 'owner' },
  }),
}))
vi.mock('@/app/(manager)/[tenantSlug]/administracion/libros/_lib/entry-panel-actions', () => ({
  loadEntryPanel: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/reimpute', () => ({ reimputeLine: vi.fn() }))
vi.mock('@/lib/accounting/actions/documents', () => ({
  voidDocument: vi.fn(),
  reverseDocument: vi.fn(),
  undoDocument: vi.fn(),
}))
vi.mock('@/lib/accounting/actions/parties', () => ({ createParty: vi.fn(), saveParty: vi.fn() }))
vi.mock('@/lib/accounting/context', () => ({ loadPostingCatalog: async () => db.catalog }))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadFirstOpenDate: async () => db.firstOpenDate,
}))
vi.mock('@/lib/accounting/queries', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getAccountingSettings: async () => ({
    booksStartDate: '2026-09-01',
    hasDocuments: true,
  }),
  listFiscalYears: async () => [FISCAL_YEAR],
  getTrialBalance: async () => {
    if (!db.trial) throw new Error('sin balance')
    return db.trial
  },
  getAccountSystemKeys: async () => db.systemKeys,
  getImputationFlags: async () => db.flags,
  getLedger: async (_tenant: string, args: unknown) => {
    db.ledgerArgs = args
    if (!db.ledger) throw new Error('sin mayor')
    return db.ledger
  },
  getJournal: async () => db.journal,
  getJournalSummary: async () => db.summary,
}))

const FISCAL_YEAR: FiscalYearRow = {
  id: 'fy',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  status: 'open',
  openingNumberReserved: false,
  closedAt: null,
  closedByName: null,
  periods: [],
}

const AGUA = '00000000-0000-4000-8000-0000000000a1'
const LUZ = '00000000-0000-4000-8000-0000000000a2'
const CAJA = '00000000-0000-4000-8000-0000000000a3'
const SUELDOS = '00000000-0000-4000-8000-0000000000a4'
const GRUPO = '00000000-0000-4000-8000-0000000000a5'
const ENTRY = '00000000-0000-4000-8000-0000000000e1'
const DOC = '00000000-0000-4000-8000-0000000000d1'

function row(
  accountId: string,
  code: string,
  name: string,
  over: Partial<TrialBalanceRow> = {},
): TrialBalanceRow {
  return {
    accountId,
    code,
    name,
    level: 5,
    accountType: 'expense',
    normalSide: 'debit',
    postable: true,
    active: true,
    isVirtual: false,
    openingDebitCents: 0,
    openingCreditCents: 0,
    periodDebitCents: 0,
    periodCreditCents: 0,
    closingDebitCents: 0,
    closingCreditCents: 0,
    ...over,
  }
}

const CAJA_ROW = row(CAJA, '1.1.01.01.001', 'Caja', {
  accountType: 'asset',
  periodDebitCents: 50_000_00,
  periodCreditCents: 10_000_00,
  closingDebitCents: 40_000_00,
})
const GROUP_ROW = row(GRUPO, '4.2.01.00.000', 'Gastos de administración', {
  level: 3,
  postable: false,
  periodDebitCents: 10_000_00,
  periodCreditCents: 1_234_00,
  closingDebitCents: 8_766_00,
})
const LUZ_ROW = row(LUZ, '4.2.01.03.023', 'Energía eléctrica', {
  periodDebitCents: 10_000_00,
  closingDebitCents: 10_000_00,
})
/** La cuenta de pérdida con saldo acreedor: «acá hay un error». */
const AGUA_ROW = row(AGUA, '4.2.01.03.024', 'Agua', {
  periodCreditCents: 1_234_00,
  closingCreditCents: 1_234_00,
})

function trial(rows: TrialBalanceRow[], over: Record<string, unknown> = {}) {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    rows,
    totals: {
      openingDebitCents: 0,
      openingCreditCents: 0,
      periodDebitCents: 60_000_00,
      periodCreditCents: 60_000_00,
      closingDebitCents: 50_000_00,
      closingCreditCents: 50_000_00,
    },
    balanced: true,
    differenceCents: 0,
    ...over,
  }
}

function ledgerLine(over: Record<string, unknown> = {}) {
  return {
    rowKind: 'line',
    entryId: ENTRY,
    entryNumber: 131,
    numberIsProvisional: false,
    entryDate: '2026-09-14',
    documentId: DOC,
    documentSeq: 88,
    documentLabel: 'Factura B 0012-00088123',
    description: 'EPEC',
    partyId: null,
    partyName: 'EPEC',
    dueDate: null,
    memo: null,
    debitCents: 3_124_00,
    creditCents: 0,
    runningBalanceCents: 3_124_00,
    accountId: AGUA,
    accountCode: '4.2.01.03.024',
    accountName: 'Agua',
    ...over,
  }
}

function ledger(rows: unknown[], over: Record<string, unknown> = {}) {
  return {
    rows,
    totalRows: rows.length,
    nextCursor: null,
    from: '2026-09-01',
    to: '2026-09-30',
    account: {
      id: AGUA,
      code: '4.2.01.03.024',
      name: 'Agua',
      normalSide: 'debit',
      postable: true,
      requiresParty: false,
    },
    periodTotals: null,
    ...over,
  }
}

const OPENING = ledgerLine({
  rowKind: 'opening',
  entryId: null,
  entryNumber: null,
  entryDate: null,
  documentId: null,
  documentLabel: null,
  debitCents: 0,
  creditCents: 0,
  runningBalanceCents: 500_00,
})

const FLAG: ImputationFlag = {
  documentId: DOC,
  documentLineId: 'l-1',
  accountingDate: '2026-09-14',
  partyName: 'EPEC',
  amountCents: 3_124_00,
  accountId: AGUA,
  accountCode: '4.2.01.03.024',
  accountName: 'Agua',
  usualAccountId: LUZ,
  usualAccountCode: '4.2.01.03.023',
  usualAccountName: 'Energía eléctrica',
}

function catalogAccount(id: string, code: string, name: string) {
  return {
    id,
    code,
    name,
    parentId: null,
    level: 5,
    postable: true,
    active: true,
    requiresParty: false,
    description: null,
  }
}

const CATALOG = {
  accounts: [
    catalogAccount(CAJA, '1.1.01.01.001', 'Caja'),
    catalogAccount(LUZ, '4.2.01.03.023', 'Energía eléctrica'),
    catalogAccount(AGUA, '4.2.01.03.024', 'Agua'),
  ],
  parties: [],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T15:00:00Z'))
  db.catalog = CATALOG
})

afterEach(() => {
  vi.useRealTimers()
  ui.readOnly = false
  db.trial = null
  db.systemKeys = new Map()
  db.ledger = null
  db.flags = []
  db.journal = null
  db.summary = null
  db.catalog = null
  db.firstOpenDate = '2026-09-01'
  db.ledgerArgs = null
})

async function render(
  Page: (props: {
    params: Promise<{ tenantSlug: string }>
    searchParams: Promise<Record<string, string | string[] | undefined>>
  }) => Promise<unknown>,
  searchParams: Record<string, string> = {},
): Promise<string> {
  const node = await Page({
    params: Promise.resolve({ tenantSlug: 'hub' }),
    searchParams: Promise.resolve(searchParams),
  })
  return renderToStaticMarkup(node as Parameters<typeof renderToStaticMarkup>[0])
    .replaceAll(' ', ' ')
    .replaceAll('&amp;', '&')
}

function columns(html: string): string[] {
  return [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) =>
    (m[1] ?? '').replace(/<[^>]+>/g, '').trim(),
  )
}

/** La fila de la tabla que dice `text`. */
function rowOf(html: string, text: string): string {
  const found = [...html.matchAll(/<tr[\s>].*?<\/tr>/g)]
    .map((m) => m[0])
    .find((r) => r.includes(text))
  if (!found) throw new Error(`no hay una fila con «${text}»`)
  return found
}

const SEPT = { mes: '2026-09' }

describe('Sumas y saldos', () => {
  it('la tabla clásica, con los totales y el sello', async () => {
    db.trial = trial([CAJA_ROW, GROUP_ROW, LUZ_ROW])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(columns(html)).toEqual([
      'Código',
      'Cuenta',
      'Debe',
      'Haber',
      'Saldo deudor',
      'Saldo acreedor',
    ])
    expect(html).toContain('Debe = Haber')
    expect(html).not.toContain('No cuadra')
    expect(html).toContain('Totales')
    expect(html).toContain('60.000,00')
    // En los libros, sin «$»: es una planilla de contador.
    expect(rowOf(html, 'Caja')).not.toContain('$')
    expect(rowOf(html, 'Caja')).toContain('40.000,00')
    // El saldo acreedor de Caja queda vacío, no en cero: un cero no se lee a ojo.
    expect(rowOf(html, 'Caja')).not.toMatch(/>0,00</)
  })

  it('los grupos van en negrita; las cuentas no', async () => {
    db.trial = trial([GROUP_ROW, LUZ_ROW])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(rowOf(html, 'Gastos de administración')).toContain('font-semibold')
    expect(rowOf(html, 'Energía eléctrica')).not.toContain('font-semibold')
  })

  it('si no cuadra, se ve: sello rojo y un aviso que no se puede pasar por alto', async () => {
    db.trial = trial([CAJA_ROW], { balanced: false, differenceCents: 150_00 })
    const html = await render(SumasYSaldosPage, SEPT)
    expect(html).toContain('No cuadra')
    expect(html).not.toContain('Debe = Haber')
    expect(html).toMatch(/role="alert"[^>]*>El balance no cuadra por \$ 150,00: avisanos\./)
  })

  it('la pérdida con saldo acreedor va marcada, con la oración bajo el nombre', async () => {
    db.trial = trial([CAJA_ROW, LUZ_ROW, AGUA_ROW])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(html).toContain('Solo lo raro (1)')
    const odd = rowOf(html, 'Una pérdida no debería dar saldo acreedor.')
    expect(odd).toContain('Agua')
    expect(odd).toContain('bg-warning')
    expect(rowOf(html, 'Energía eléctrica')).not.toContain('bg-warning')
    expect(rowOf(html, 'Energía eléctrica')).not.toContain('no debería dar')
  })

  it('tocar la fila lleva al Mayor de esa cuenta, con el período y el camino de vuelta', async () => {
    db.trial = trial([AGUA_ROW])
    const html = await render(SumasYSaldosPage, SEPT)
    const href = rowOf(html, 'Agua').match(/href="([^"]+)"/)?.[1] ?? ''
    expect(href).toContain('/hub/administracion/libros/mayor?')
    const params = new URL(href, 'https://x').searchParams
    expect(params.get('mes')).toBe('2026-09')
    expect(params.get('cuenta')).toBe(AGUA)
    expect(params.get('volver')).toBe('sumas')
    expect(rowOf(html, 'Agua')).toContain('data-row-action')
  })

  it('con «Solo lo raro» prendido: solo las raras, sin totales, y al volver sigue prendido', async () => {
    db.trial = trial([CAJA_ROW, LUZ_ROW, AGUA_ROW])
    const html = await render(SumasYSaldosPage, { ...SEPT, raro: '1' })
    expect(html).toContain('Agua')
    expect(html).not.toContain('Energía eléctrica')
    expect(html).not.toContain('>Totales<')
    const href = rowOf(html, 'Agua').match(/href="([^"]+)"/)?.[1] ?? ''
    expect(new URL(href, 'https://x').searchParams.get('volver')).toBe('sumas:raro=1')
  })

  it('«Solo lo raro» sin nada raro: lo dice', async () => {
    db.trial = trial([CAJA_ROW])
    const html = await render(SumasYSaldosPage, { ...SEPT, raro: '1' })
    expect(html).toContain('Nada raro en')
    expect(html).toContain('ninguna cuenta tiene el saldo al revés.')
  })

  it('Sueldos a pagar deudor no es raro', async () => {
    const sueldos = row(SUELDOS, '2.1.02.01.001', 'Sueldos a pagar', {
      accountType: 'liability',
      normalSide: 'credit',
      closingDebitCents: 500_00,
    })
    db.trial = trial([sueldos])
    const marked = await render(SumasYSaldosPage, SEPT)
    expect(marked).toContain('Una deuda con saldo deudor')

    db.systemKeys = new Map([[SUELDOS, 'payroll_payable']])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(html).not.toContain('Una deuda con saldo deudor')
    expect(html).toContain('Solo lo raro (0)')
  })

  it('el saldo inicial no se pierde: va en una columna, con el aviso de que existe', async () => {
    const withOpening = { ...LUZ_ROW, openingDebitCents: 777_00 }
    db.trial = trial([withOpening])
    const hidden = await render(SumasYSaldosPage, SEPT)
    expect(columns(hidden)).not.toContain('Saldo inicial')
    expect(hidden).toContain('El saldo suma lo que cada cuenta traía de antes.')
    expect(hidden).toContain('inicial=1')

    const shown = await render(SumasYSaldosPage, { ...SEPT, inicial: '1' })
    expect(columns(shown)).toEqual([
      'Código',
      'Cuenta',
      'Saldo inicial',
      'Debe',
      'Haber',
      'Saldo deudor',
      'Saldo acreedor',
    ])
    expect(rowOf(shown, 'Energía eléctrica')).toContain('777,00')
    expect(shown).not.toContain('Ver el saldo inicial')
  })

  it('la línea virtual de resultados no lleva a ningún Mayor', async () => {
    const virtual = row('', '3.9.99', 'Resultados sin refundir', {
      isVirtual: true,
      postable: false,
      accountType: 'equity',
      normalSide: 'credit',
      closingCreditCents: 100_00,
    })
    db.trial = trial([virtual])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(rowOf(html, 'Resultados sin refundir')).not.toContain('href=')
    expect(html).toContain('Desaparece cuando se cierra el ejercicio anterior.')
  })

  it('la exportación queda a mano, como un botón chico', async () => {
    db.trial = trial([LUZ_ROW])
    const html = await render(SumasYSaldosPage, SEPT)
    expect(html).toContain('Excel')
  })

  it('si no se pudo leer, se dice, y no afirma que cuadra', async () => {
    db.trial = null
    const html = await render(SumasYSaldosPage, SEPT)
    expect(html).not.toContain('Debe = Haber')
    expect(html).not.toContain('Totales')
  })
})

describe('Mayor', () => {
  beforeEach(() => {
    db.trial = trial([CAJA_ROW, LUZ_ROW, AGUA_ROW])
    db.ledger = ledger([OPENING, ledgerLine()])
  })

  it('Fecha · Asiento · Comprobante · Debe · Haber · Saldo, con saldo inicial y doble raya', async () => {
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    expect(columns(html)).toEqual(['Fecha', 'Asiento', 'Comprobante', 'Debe', 'Haber', 'Saldo'])
    expect(rowOf(html, 'Saldo inicial')).toContain('500,00')
    expect(html).toContain('Saldo de la cuenta')
    expect(html).toContain('Mayor de 4.2.01.03.024 Agua')
    const line = rowOf(html, 'Factura B')
    expect(line).toContain('14/09/2026')
    expect(line).toContain('3.124,00')
    expect(line).toContain('EPEC')
  })

  it('cada fila se abre con el teclado: el número de asiento es un botón', async () => {
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    const line = rowOf(html, 'Factura B')
    expect(line).toContain('<button')
    expect(line).toContain('aria-label="Ver el asiento 131"')
    expect(line).toContain('cursor-pointer')
  })

  it('la imputación rara va en rojo y dice qué hacer', async () => {
    db.flags = [FLAG]
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    const line = rowOf(html, 'EPEC siempre va a Energía eléctrica. Tocá para reimputar.')
    expect(line).toContain('text-destructive')
    expect(line).toContain('bg-warning')
  })

  it('con el mes cerrado no promete que se pueda reimputar', async () => {
    db.flags = [FLAG]
    db.firstOpenDate = '2026-10-01'
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    expect(html).toContain('EPEC siempre va a Energía eléctrica. Ese mes está cerrado.')
    expect(html).not.toContain('Tocá para reimputar')
  })

  it('las flechas pasan a la anterior y a la siguiente con movimiento, sin perder nada', async () => {
    db.ledger = ledger([OPENING], {
      account: {
        id: LUZ,
        code: '4.2.01.03.023',
        name: 'Energía eléctrica',
        normalSide: 'debit',
        postable: true,
        requiresParty: false,
      },
    })
    const html = await render(MayorPage, { ...SEPT, cuenta: LUZ, volver: 'sumas:raro=1' })
    const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0])
    const prev = links.find((a) => a.includes('Cuenta anterior: 1.1.01.01.001 Caja'))
    const next = links.find((a) => a.includes('Cuenta siguiente: 4.2.01.03.024 Agua'))
    for (const [link, id] of [
      [prev, CAJA],
      [next, AGUA],
    ] as const) {
      const href = link?.match(/href="([^"]+)"/)?.[1] ?? ''
      const params = new URL(href, 'https://x').searchParams
      expect(params.get('cuenta')).toBe(id)
      expect(params.get('mes')).toBe('2026-09')
      expect(params.get('volver')).toBe('sumas:raro=1')
    }
  })

  it('volver a Sumas y saldos deja los filtros como estaban', async () => {
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA, volver: 'sumas:raro=1' })
    const back = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(?:(?!<\/a>).)*Sumas y saldos/g)]
    const params = new URL(back[0]?.[1] ?? '', 'https://x').searchParams
    expect(params.get('raro')).toBe('1')
    expect(params.get('mes')).toBe('2026-09')
  })

  it('sin venir de Sumas y saldos, no hay vuelta', async () => {
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    expect(html).not.toContain('libros/sumas-y-saldos')
  })

  it('sin cuenta elegida abre en la primera con movimiento: nunca una hoja en blanco', async () => {
    await render(MayorPage, SEPT)
    expect(db.ledgerArgs).toMatchObject({ accountId: CAJA, from: '2026-09-01', to: '2026-09-30' })
  })

  it('un período sin ningún movimiento lo dice', async () => {
    db.trial = trial([])
    db.ledger = null
    const html = await render(MayorPage, SEPT)
    expect(html).toContain('Ninguna cuenta tuvo movimiento en')
    expect(db.ledgerArgs).toBeNull()
  })

  it('una cuenta que no es de este bar no se pide a la base', async () => {
    db.ledger = null
    const html = await render(MayorPage, { ...SEPT, cuenta: 'no-es-un-id' })
    expect(html).toContain('Esa cuenta no existe en este bar.')
    expect(db.ledgerArgs).toBeNull()
  })

  it('la cuenta sin movimientos en el período muestra su saldo inicial', async () => {
    db.ledger = ledger([OPENING])
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    expect(rowOf(html, 'Saldo inicial')).toContain('500,00')
    expect(html).toContain('Sin movimientos en')
  })

  it('la contadora ve lo mismo', async () => {
    ui.readOnly = true
    db.flags = [FLAG]
    const html = await render(MayorPage, { ...SEPT, cuenta: AGUA })
    expect(html).toContain('EPEC siempre va a Energía eléctrica. Tocá para reimputar.')
  })
})

describe('Libro diario', () => {
  function entry(over: Record<string, unknown> = {}) {
    return {
      entryId: ENTRY,
      number: 131,
      numberIsProvisional: false,
      entryDate: '2026-09-14',
      kind: 'standard',
      description: 'EPEC · Factura B',
      documentId: DOC,
      documentSeq: 88,
      documentKind: 'purchase',
      documentLabel: 'Factura B 0012-00088123',
      createdByName: 'Franco',
      totalCents: 3_124_00,
      lines: [
        {
          lineNo: 1,
          accountCode: '4.2.01.03.024',
          accountName: 'Agua',
          partyId: null,
          partyName: null,
          partyTaxId: null,
          dueDate: null,
          memo: null,
          debitCents: 3_124_00,
          creditCents: 0,
        },
        {
          lineNo: 2,
          accountCode: '2.1.01.01.001',
          accountName: 'Proveedores',
          partyId: null,
          partyName: 'EPEC',
          partyTaxId: null,
          dueDate: null,
          memo: null,
          debitCents: 0,
          creditCents: 3_124_00,
        },
      ],
      ...over,
    }
  }
  const page = (rows: unknown[]) => ({
    rows,
    totalRows: rows.length,
    nextCursor: null,
    from: '2026-09-01',
    to: '2026-09-30',
  })

  beforeEach(() => {
    db.summary = {
      from: '2026-09-01',
      to: '2026-09-30',
      entries: 1,
      debitCents: 3_124_00,
      creditCents: 3_124_00,
      balanced: true,
      hasProvisional: false,
    }
  })

  it('Fecha · Asiento · Cuenta · Debe · Haber; el haber con sangría, el comprobante debajo', async () => {
    db.journal = page([entry()])
    const html = await render(DiarioPage, SEPT)
    expect(columns(html)).toEqual(['Fecha', 'Asiento', 'Cuenta', 'Debe', 'Haber'])
    const debit = rowOf(html, 'Agua')
    const credit = rowOf(html, 'Proveedores')
    expect(credit).toContain('pl-8')
    expect(debit).not.toContain('pl-8')
    expect(debit).toContain('14/09/2026')
    expect(debit).toContain('Factura B')
    // Fecha y número, una sola vez por asiento.
    expect(credit).not.toContain('14/09/2026')
    expect(credit).not.toContain('Factura B')
    expect(credit).toContain('EPEC')
  })

  it('tocar abre el panel: con el teclado, el número de asiento', async () => {
    db.journal = page([entry()])
    const html = await render(DiarioPage, SEPT)
    expect(rowOf(html, 'Agua')).toContain('aria-label="Ver el asiento 131"')
    expect(rowOf(html, 'Agua')).toContain('cursor-pointer')
    expect(rowOf(html, 'Proveedores')).toContain('cursor-pointer')
  })

  it('el número provisorio se dice', async () => {
    db.journal = page([entry({ numberIsProvisional: true })])
    const html = await render(DiarioPage, SEPT)
    expect(rowOf(html, 'Agua')).toContain('aria-label="Ver el asiento 131 (provisorio)"')
  })

  it('un asiento que no es común dice de qué tipo es', async () => {
    db.journal = page([entry({ kind: 'adjustment' })])
    const html = await render(DiarioPage, SEPT)
    expect(rowOf(html, 'Agua')).toContain(entryKindLabel('adjustment'))
  })

  it('los totales van con doble raya, al pie', async () => {
    db.journal = page([entry()])
    const html = await render(DiarioPage, SEPT)
    expect(html).toContain('Totales')
    expect(html).toContain('<tfoot')
  })

  it('sin asientos no hay pie', async () => {
    db.journal = page([])
    const html = await render(DiarioPage, SEPT)
    expect(html).toContain('No hay asientos en septiembre 2026')
    expect(html).not.toContain('<tfoot')
  })
})

describe('los esqueletos de carga', () => {
  const ADM = '@/app/(manager)/[tenantSlug]/administracion'
  const SCREENS = [
    'libros',
    'libros/sumas-y-saldos',
    'libros/mayor',
    'libros/diario',
    'libros/posicion-iva',
    'libros/iva-compras',
    'libros/iva-ventas',
    'libros/subdiarios',
    'libros/historia',
    'libros/cierres',
    'libros/asiento-manual',
    'plan-de-cuentas',
    'asientos/[id]',
    'comprobantes/[id]',
  ]

  it.each(SCREENS)('%s', async (screen) => {
    const { default: Loading } = (await import(`${ADM}/${screen}/loading`)) as {
      default: () => Parameters<typeof renderToStaticMarkup>[0]
    }
    const html = renderToStaticMarkup(Loading())
    expect(html).toContain('data-slot="skeleton"')
  })

  it('el de un libro adelanta las filas de la tabla, no un cartelito', async () => {
    const { default: Loading } = (await import(`${ADM}/libros/sumas-y-saldos/loading`)) as {
      default: () => Parameters<typeof renderToStaticMarkup>[0]
    }
    const html = renderToStaticMarkup(Loading())
    expect(html.match(/data-slot="skeleton"/g)?.length ?? 0).toBeGreaterThan(20)
  })
})
