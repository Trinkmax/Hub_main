import { describe, expect, it } from 'vitest'
import {
  appliedByOthers,
  backLinkFor,
  creditNoteHref,
  documentActions,
} from '@/app/(manager)/[tenantSlug]/administracion/comprobantes/_lib/document-view'
import {
  ivaExpectedFrom,
  ivaSummary,
  rateRows,
  visibleIvaColumns,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva'
import { keysetPageInfo } from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/keyset'
import {
  bookHref,
  monthAvailability,
  monthAvailabilityMessage,
  resolveBookMonth,
  resolveBookRange,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/periods'
import {
  subledgerCellText,
  subledgerTab,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/subledgers'
import {
  isZeroTrialRow,
  parseTrialLevel,
  visibleTrialRows,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/trial'
import {
  type EntryLine,
  emptyLine,
  entryTotals,
  hasContent,
  validateEntry,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/asiento-manual/_lib/manual-entry'
import {
  blockerLine,
  infoLine,
  listText,
  warningLine,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/checklist'
import { SUBLEDGER_COLUMNS } from '@/lib/accounting/queries/columns'
import { FISCAL_AMOUNT_KEYS, type FiscalAmountKey } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'

const BASE = '/hub/administracion'

describe('keysetPageInfo', () => {
  it('ubica la primera, una del medio y la última página', () => {
    expect(keysetPageInfo({ seenBefore: 0, rows: 100, totalRows: 412, pageSize: 100 })).toEqual({
      page: 1,
      totalPages: 5,
      firstRow: 1,
      lastRow: 100,
      isFirst: true,
    })
    expect(keysetPageInfo({ seenBefore: 100, rows: 100, totalRows: 412, pageSize: 100 })).toEqual({
      page: 2,
      totalPages: 5,
      firstRow: 101,
      lastRow: 200,
      isFirst: false,
    })
    expect(
      keysetPageInfo({ seenBefore: 400, rows: 12, totalRows: 412, pageSize: 100 }),
    ).toMatchObject({
      page: 5,
      totalPages: 5,
      firstRow: 401,
      lastRow: 412,
    })
  })

  it('sin filas no inventa un rango, y un total corto no da menos páginas que las vistas', () => {
    expect(keysetPageInfo({ seenBefore: 0, rows: 0, totalRows: 0, pageSize: 100 })).toEqual({
      page: 1,
      totalPages: 1,
      firstRow: 0,
      lastRow: 0,
      isFirst: true,
    })
    expect(
      keysetPageInfo({ seenBefore: 200, rows: 50, totalRows: 0, pageSize: 100 }),
    ).toMatchObject({
      page: 3,
      totalPages: 3,
    })
  })
})

describe('períodos de los libros', () => {
  it('sin nada en la URL es el mes de hoy; un rango se lee y uno al revés se rechaza', () => {
    expect(resolveBookRange({}, '2026-10-07')).toEqual({
      ok: true,
      kind: 'month',
      month: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
      label: 'Octubre 2026',
    })
    expect(
      resolveBookRange({ desde: '2026-10-01', hasta: '2026-10-15' }, '2026-10-07'),
    ).toMatchObject({
      ok: true,
      kind: 'range',
      label: '01/10 – 15/10/2026',
    })
    expect(resolveBookRange({ desde: '2026-10-15', hasta: '2026-10-01' }, '2026-10-07')).toEqual({
      ok: false,
      message: 'El «hasta» no puede ser anterior al «desde».',
    })
    expect(resolveBookRange({ mes: '2026-13' }, '2026-10-07')).toEqual({
      ok: false,
      message: 'Ese mes no existe. Elegilo de nuevo.',
    })
  })

  it('el índice abre en el último mes cerrado si no se pide otro', () => {
    expect(resolveBookMonth({}, '2026-11-03', '2026-10')).toMatchObject({
      ok: true,
      month: '2026-10',
    })
    expect(resolveBookMonth({ mes: '2026-09' }, '2026-11-03', '2026-10')).toMatchObject({
      ok: true,
      month: '2026-09',
    })
  })

  it('un mes antes del arranque o que todavía no empezó no se le pide a la base', () => {
    expect(monthAvailability('2026-09', '2026-10-07', '2026-10-01')).toBe('before-start')
    expect(monthAvailability('2026-11', '2026-10-07', '2026-10-01')).toBe('future')
    expect(monthAvailability('2026-10', '2026-10-07', '2026-10-01')).toBe('ok')
    expect(monthAvailability('2026-09', '2026-10-07', null)).toBe('ok')
    expect(monthAvailabilityMessage('before-start', '2026-09', '2026-10-01')).toBe(
      'Septiembre 2026 no tiene libros: Administración arranca el 01/10/2026.',
    )
    expect(monthAvailabilityMessage('future', '2026-11', '2026-10-01')).toBe(
      'Noviembre 2026 todavía no empezó.',
    )
  })

  it('los links llevan solo los parámetros con valor', () => {
    expect(
      bookHref(`${BASE}/libros/mayor`, { cuenta: 'a1', participe: null, mes: '2026-10' }),
    ).toBe(`${BASE}/libros/mayor?cuenta=a1&mes=2026-10`)
    expect(bookHref(`${BASE}/libros`, {})).toBe(`${BASE}/libros`)
  })
})

describe('sumas y saldos', () => {
  const row = (level: number, opening: number, debit: number, credit: number) => ({
    level,
    openingDebitCents: Math.max(opening, 0),
    openingCreditCents: Math.max(-opening, 0),
    periodDebitCents: debit,
    periodCreditCents: credit,
    closingDebitCents: Math.max(opening + debit - credit, 0),
    closingCreditCents: Math.max(-(opening + debit - credit), 0),
  })

  it('esconde las cuentas en cero salvo que se pidan, y corta por nivel', () => {
    const rows = [row(1, 0, 100, 0), row(2, 0, 0, 0), row(3, 50, 0, 50), row(4, 0, 10, 0)]
    expect(visibleTrialRows(rows, { level: 'todo', includeZero: false })).toHaveLength(3)
    expect(visibleTrialRows(rows, { level: 'todo', includeZero: true })).toHaveLength(4)
    expect(visibleTrialRows(rows, { level: 2, includeZero: true })).toHaveLength(2)
    // Saldo inicial 50 que se cancela en el período: no es una fila «en cero».
    expect(isZeroTrialRow(row(3, 50, 0, 50))).toBe(false)
    expect(isZeroTrialRow(row(3, 0, 0, 0))).toBe(true)
  })

  it('el nivel de la URL', () => {
    expect(parseTrialLevel('1')).toBe(1)
    expect(parseTrialLevel('3')).toBe(3)
    expect(parseTrialLevel('9')).toBe('todo')
    expect(parseTrialLevel(null)).toBe('todo')
  })
})

describe('libros IVA', () => {
  const amounts = (partial: Partial<Record<FiscalAmountKey, number>>) => {
    const out = {} as Record<FiscalAmountKey, number>
    for (const key of FISCAL_AMOUNT_KEYS) out[key] = partial[key] ?? 0
    return out
  }

  it('muestra solo las columnas con algo en el mes o en la página, más el total', () => {
    const totals = amounts({
      net_21_cents: 100000,
      vat_21_cents: 21000,
      total_cents: 121000,
      vat_computable_cents: 21000,
    })
    const keys = (cols: ReturnType<typeof visibleIvaColumns>) => cols.map((c) => c.key)
    expect(keys(visibleIvaColumns('purchases', totals, []))).toEqual([
      'net_21_cents',
      'vat_21_cents',
      'total_cents',
    ])
    // Una nota de crédito que netea a cero en el mes igual muestra su columna en la página.
    const rows = [{ amounts: amounts({ exempt_cents: -5000 }) }]
    expect(keys(visibleIvaColumns('purchases', totals, rows))).toContain('exempt_cents')
    // El crédito computable solo si difiere del IVA (compras).
    const partial = amounts({ ...totals, vat_computable_cents: 7000 })
    expect(keys(visibleIvaColumns('purchases', partial, []))).toContain('vat_computable_cents')
    expect(keys(visibleIvaColumns('sales', partial, []))).not.toContain('vat_computable_cents')
  })

  it('suma la franja de arriba y arma lo que se manda como «lo que vio la persona»', () => {
    const s = ivaSummary(
      amounts({
        net_21_cents: 100000,
        net_105_cents: 20000,
        vat_21_cents: 21000,
        vat_105_cents: 2100,
        perc_iva_cents: 3000,
        perc_iibb_cents: 1500,
        exempt_cents: 400,
        total_cents: 148000,
        vat_computable_cents: 23100,
      }),
    )
    expect(s).toEqual({
      netCents: 120000,
      vatCents: 23100,
      perceptionsCents: 4500,
      otherCents: 400,
      totalCents: 148000,
      computableCents: 23100,
    })
    expect(
      ivaExpectedFrom({
        debitFiscal: { totalCents: 131040000 },
        creditFiscal: { totalCents: 41000000 },
        perceptionsCents: 600000,
        withholdingsCents: 300000,
        toPayCents: 89140000,
        technicalBalanceNewCents: 0,
        freeBalanceNewCents: 0,
      }),
    ).toEqual({
      debitCents: 131040000,
      creditCents: 41000000,
      perceptionsCents: 600000,
      withholdingsCents: 300000,
      toPayCents: 89140000,
      technicalBalanceNewCents: 0,
      freeBalanceNewCents: 0,
    })
    expect(rateRows({ '1050': 1040000, '2100': 130000000, '0': 0 })).toEqual([
      { bp: 2100, cents: 130000000 },
      { bp: 1050, cents: 1040000 },
    ])
  })
})

describe('subdiarios', () => {
  it('la pestaña de la URL, con Compras por defecto', () => {
    expect(subledgerTab('cajas').kind).toBe('treasury')
    expect(subledgerTab('ventas-por-medio').exportBook).toBe('subdiario-ventas-medios')
    expect(subledgerTab(null).value).toBe('compras')
    expect(subledgerTab('cualquiera').value).toBe('compras')
  })

  it('lee fechas, referencias, listas y sí/no', () => {
    const date = SUBLEDGER_COLUMNS.treasury[0]
    const ref = SUBLEDGER_COLUMNS.treasury.find((c) => c.header === 'Ref. interna')
    if (!date || !ref) throw new Error('faltan columnas')
    expect(subledgerCellText('2026-10-05', date)).toBe('05/10/2026')
    expect(subledgerCellText(125, ref)).toBe('#125')
    const methods = SUBLEDGER_COLUMNS.payments.find((c) => c.type === 'list')
    if (!methods) throw new Error('falta la columna de medios')
    expect(
      subledgerCellText(
        [
          { label: 'Caja', amountCents: 100000 },
          { label: 'Banco', amountCents: 50000 },
        ],
        methods,
      ),
    ).toBe(`Caja: ${formatCents(100000)} · Banco: ${formatCents(50000)}`)
    expect(subledgerCellText(true, methods)).toBe('Sí')
    expect(subledgerCellText(null, methods)).toBe('')
  })

  it('el CUIT se lee con guiones, como en el Libro IVA', () => {
    const cuit = SUBLEDGER_COLUMNS.purchases.find((c) => c.header === 'CUIT')
    if (!cuit) throw new Error('falta la columna del CUIT')
    expect(subledgerCellText('30701112225', cuit)).toBe('30-70111222-5')
    // Lo que no es un CUIT de 11 números queda como vino.
    expect(subledgerCellText('12345', cuit)).toBe('12345')
    expect(subledgerCellText(null, cuit)).toBe('')
  })
})

describe('asiento manual', () => {
  const line = (key: string, patch: Partial<EntryLine>): EntryLine => ({
    ...emptyLine(),
    key,
    ...patch,
  })
  const noParty = () => false

  it('cuadra con dos líneas y suma en BigInt', () => {
    const lines = [
      line('a', { accountId: 'gasto', debitCents: 123456 }),
      line('b', { accountId: 'caja', creditCents: 123456 }),
      line('c', {}),
    ]
    expect(
      validateEntry({ lines, date: '2026-10-07', description: 'Ajuste', requiresParty: noParty }),
    ).toEqual({
      ok: true,
    })
    expect(entryTotals(lines)).toEqual({ debit: 123456n, credit: 123456n })
    expect(hasContent(line('x', { memo: '  ' }))).toBe(false)
    expect(hasContent(line('x', { memo: 'algo' }))).toBe(true)
  })

  it('si no cuadra dice cuánto falta y de qué lado, y solo eso lleva el foco al pie', () => {
    const lines = [
      line('a', { accountId: 'gasto', debitCents: 1000 }),
      line('b', { accountId: 'caja', creditCents: 960 }),
    ]
    const check = validateEntry({
      lines,
      date: '2026-10-07',
      description: 'Ajuste',
      requiresParty: noParty,
    })
    expect(check).toEqual({
      ok: false,
      errors: { lines: `El asiento no cuadra: falta ${formatCents(40)} en el Haber.` },
      message: `El asiento no cuadra: falta ${formatCents(40)} en el Haber.`,
      onlyBalance: true,
    })
  })

  it('marca la línea sin cuenta, sin importe o sin proveedor en una cuenta que lo pide', () => {
    const lines = [
      line('a', { debitCents: 1000 }),
      line('b', { accountId: 'proveedores', creditCents: 1000 }),
      line('c', { accountId: 'caja', memo: 'nada' }),
    ]
    const check = validateEntry({
      lines,
      date: null,
      description: ' ',
      requiresParty: (id) => id === 'proveedores',
    })
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.errors).toMatchObject({
      date: 'Elegí una fecha.',
      description: 'Escribí el concepto del asiento.',
      'a.accountId': 'Elegí la cuenta.',
      'b.partyId': 'Elegí el proveedor o cliente.',
      'c.debitCents': 'Falta el importe de la línea.',
    })
    expect(check.message).toBe('Elegí una fecha.')
    expect(check.onlyBalance).toBe(false)
  })

  it('pide al menos dos líneas', () => {
    const check = validateEntry({
      lines: [line('a', { accountId: 'gasto', debitCents: 1000 })],
      date: '2026-10-07',
      description: 'Ajuste',
      requiresParty: noParty,
    })
    expect(check).toMatchObject({
      ok: false,
      errors: { lines: 'Un asiento necesita al menos dos líneas.' },
    })
  })
})

describe('checklist del cierre', () => {
  const item = (key: string, label: string, detail: Record<string, unknown> = {}) => ({
    key,
    label,
    detail,
    amountCents: null,
    count: null,
  })

  it('dice qué días faltan y lleva a cargar el primero', () => {
    const line = warningLine(
      item('missing_daily_closes', 'Faltan cierres del día en el mes.', {
        dates: ['2026-10-04', '2026-10-11'],
      }),
      BASE,
    )
    expect(line).toEqual({
      key: 'missing_daily_closes',
      text: 'Faltan cierres del día en el mes.',
      detail: 'Faltan los del 04/10 y 11/10.',
      href: `${BASE}/ventas/cierre?fecha=2026-10-04`,
      linkLabel: 'Cargar',
    })
    expect(listText(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e y 2 más')
  })

  it('las cajas en negativo dicen el descubierto sin signo menos', () => {
    const line = warningLine(
      item('treasury_negative', 'Hay cajas de efectivo en negativo al último día del mes.', {
        treasuries: [{ name: 'Caja', balance_cents: -5000 }],
      }),
      BASE,
    )
    expect(line.detail).toBe(`Caja (descubierto ${formatCents(5000)}).`)
  })

  it('nunca muestra una clave cruda', () => {
    expect(warningLine(item('algo_nuevo', 'algo_nuevo'), BASE).text).toBe(
      'Hay algo para revisar antes de cerrar.',
    )
    expect(infoLine(item('otra_cosa', 'otra_cosa'))).toBeNull()
    expect(
      infoLine({
        ...item('opening_equity_unassigned', 'opening_equity_unassigned'),
        amountCents: 123456,
      })?.text,
    ).toBe(`Hay ${formatCents(123456)} de patrimonio inicial sin asignar: lo revisa la contadora.`)
  })

  it('el mes sin terminar dice desde cuándo se puede cerrar', () => {
    expect(
      blockerLine(item('month_not_finished', 'Octubre todavía no terminó.'), BASE, {
        first: '2026-10-01',
        endsOn: '2026-10-31',
      }).text,
    ).toBe('Octubre 2026 todavía no terminó: se puede cerrar desde el 01/11/2026.')
    expect(
      blockerLine(item('opening_pending', 'opening_pending'), BASE, {
        first: '2026-10-01',
        endsOn: null,
      }).href,
    ).toBe(`${BASE}/configurar`)
  })
})

describe('acciones de un comprobante', () => {
  const doc = (patch: Partial<Parameters<typeof documentActions>[0]> = {}) => ({
    kind: 'purchase' as const,
    status: 'posted' as const,
    partyId: 'p1',
    openCents: 500000,
    period: { status: 'open' as const },
    reversedBy: null,
    ...patch,
  })

  it('mes abierto: anular (y pagar si debe algo)', () => {
    expect(documentActions(doc(), true)).toEqual({
      void: true,
      reverse: false,
      creditNote: null,
      adjustment: false,
      settle: 'pagar',
    })
    expect(documentActions(doc({ kind: 'iva_settlement' }), true).void).toBe(false)
  })

  it('mes cerrado: nota de crédito, anular con fecha de hoy o ajuste', () => {
    expect(documentActions(doc({ period: { status: 'closed' } }), true)).toEqual({
      void: false,
      reverse: true,
      creditNote: 'purchase',
      adjustment: true,
      settle: 'pagar',
    })
    expect(
      documentActions(doc({ kind: 'sales_invoice', period: { status: 'closed' } }), true)
        .creditNote,
    ).toBe('sales')
    // Ya anulado con fecha posterior: nada más para hacer.
    expect(
      documentActions(
        doc({ period: { status: 'closed' }, reversedBy: { status: 'posted' } }),
        true,
      ),
    ).toEqual({ void: false, reverse: false, creditNote: null, adjustment: false, settle: null })
    expect(
      documentActions(doc({ kind: 'fy_closing', period: { status: 'closed' } }), true),
    ).toMatchObject({
      reverse: false,
      adjustment: false,
    })
  })

  it('la contadora y los anulados no tienen acciones', () => {
    const none = { void: false, reverse: false, creditNote: null, adjustment: false, settle: null }
    expect(documentActions(doc(), false)).toEqual(none)
    expect(documentActions(doc({ status: 'voided' }), true)).toEqual(none)
  })

  it('a dónde vuelve y qué se avisa al anular', () => {
    expect(backLinkFor('payment', BASE, '2026-10-05')).toEqual({
      href: `${BASE}/compras?tab=pagos`,
      label: 'Volver a pagos',
    })
    expect(backLinkFor('manual', BASE, '2026-10-05').href).toBe(`${BASE}/libros/diario?mes=2026-10`)
    expect(creditNoteHref('purchase', BASE, { id: 'd1', partyId: 'p1' })).toBe(
      `${BASE}/compras/nueva?tipo=nc&relacionada=d1&proveedor=p1`,
    )
    expect(appliedByOthers('purchase')).toBe(true)
    expect(appliedByOthers('payment')).toBe(false)
  })
})
