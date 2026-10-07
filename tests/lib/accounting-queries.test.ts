import { describe, expect, it } from 'vitest'
import { SUBLEDGER_COLUMNS } from '@/lib/accounting/queries/columns'
import {
  exportFilename,
  IVA_PURCHASES_AMOUNT_COLUMNS,
  IVA_PURCHASES_HEADERS,
  IVA_SALES_AMOUNT_COLUMNS,
  IVA_SALES_HEADERS,
  ivaPurchasesCsvRow,
  ivaSalesCsvRow,
  ivaTotalsRow,
  JOURNAL_HEADERS,
  journalCsvRows,
  journalTotalsRow,
  LEDGER_HEADERS,
  ledgerCsvRow,
  ledgerTotalsRow,
  sideCells,
  statementHeaders,
  subledgerCsvCell,
} from '@/lib/accounting/queries/csv'
import {
  dailyCloseStatus,
  missingCloseWindow,
  recurringMonthStatus,
} from '@/lib/accounting/queries/documents'
import {
  documentTitle,
  exportHref,
  lineRoleLabel,
  vatRateLabel,
} from '@/lib/accounting/queries/labels'
import { parseCloseChecklist } from '@/lib/accounting/queries/periods'
import {
  decodeCursor,
  decodePageToken,
  encodeCursor,
  keysetPage,
} from '@/lib/accounting/queries/shared'
import { parseSummary } from '@/lib/accounting/queries/summary'
import { buildCsv } from '@/lib/csv/write'

describe('cursor de las páginas (?despues=)', () => {
  it('ida y vuelta con las filas vistas', () => {
    const token = encodeCursor({ d: '2026-10-05', k: 3, s: 120 }, 200)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodePageToken(token)).toEqual({ cursor: { d: '2026-10-05', k: 3, s: 120 }, seen: 200 })
    expect(decodeCursor(token)).toEqual({ d: '2026-10-05', k: 3, s: 120 })
  })

  it('un cursor roto o manipulado es la primera página', () => {
    expect(decodePageToken('no es base64!')).toBeNull()
    expect(decodePageToken(Buffer.from('{"c":{"a":{"x":1}}}').toString('base64url'))).toBeNull()
    expect(decodePageToken('')).toBeNull()
    expect(decodePageToken(undefined)).toBeNull()
    expect(encodeCursor(null)).toBeNull()
    expect(encodeCursor({ nested: { a: 1 } })).toBeNull()
  })
})

describe('keysetPage', () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    n,
    cursor: { s: n },
    total_rows: 5,
    ...extra,
  })
  const map = (r: Record<string, unknown>) => r.n

  it('página llena con más filas → hay siguiente, con las vistas acumuladas', () => {
    const page = keysetPage([row(1), row(2)], { limit: 2, seen: 0, map })
    expect(page.rows).toEqual([1, 2])
    expect(page.totalRows).toBe(5)
    expect(decodePageToken(page.nextCursor)).toEqual({ cursor: { s: 2 }, seen: 2 })
  })

  it('no ofrece «Cargar más» cuando ya se vio todo, aunque la página venga llena', () => {
    const page = keysetPage([row(4), row(5)], { limit: 2, seen: 3, map })
    expect(page.nextCursor).toBeNull()
  })

  it('una página parcial es la última', () => {
    const page = keysetPage([row(1)], { limit: 2, seen: 0, map })
    expect(page.nextCursor).toBeNull()
  })

  it('el «Saldo anterior» no cuenta para el total ni para el cursor', () => {
    const raw = [
      { row_kind: 'opening', cursor: null, total_rows: 3 },
      { row_kind: 'line', n: 1, cursor: { s: 1 }, total_rows: 3 },
      { row_kind: 'line', n: 2, cursor: { s: 2 }, total_rows: 3 },
    ]
    const page = keysetPage(raw, {
      limit: 2,
      seen: 0,
      map: (r) => r.row_kind,
      isCounted: (r) => r.row_kind !== 'opening',
    })
    expect(page.rows).toEqual(['opening', 'line', 'line'])
    expect(decodePageToken(page.nextCursor)).toEqual({ cursor: { s: 2 }, seen: 2 })
  })

  it('sin total de la base alcanza con la página llena', () => {
    const page = keysetPage([{ cursor: { s: 1 } }, { cursor: { s: 2 } }], {
      limit: 2,
      seen: 0,
      map: () => null,
    })
    expect(page.nextCursor).not.toBeNull()
    expect(page.totalRows).toBe(2)
  })
})

describe('textos de comprobantes', () => {
  it('con comprobante fiscal numerado, el número; si no, el tipo', () => {
    expect(
      documentTitle({ kind: 'purchase', voucherType: 'factura_a', pointOfSale: 3, number: 1290 }),
    ).toBe('Factura A 0003-00001290')
    expect(
      documentTitle({
        kind: 'expense',
        voucherType: 'sin_comprobante',
        pointOfSale: null,
        number: null,
      }),
    ).toBe('Gasto')
    expect(
      documentTitle({ kind: 'payment', voucherType: null, pointOfSale: null, number: null }),
    ).toBe('Pago')
  })

  it('alícuotas y roles en palabras', () => {
    expect(vatRateLabel(2100)).toBe('21 %')
    expect(vatRateLabel(1050)).toBe('10,5 %')
    expect(vatRateLabel(250)).toBe('2,5 %')
    expect(vatRateLabel(0)).toBe('0 %')
    expect(lineRoleLabel('net', { vatRateBp: 2100 })).toBe('Neto 21 %')
    expect(lineRoleLabel('perception', { taxKind: 'iibb' })).toBe('Percepción IIBB')
    expect(lineRoleLabel('perception', { taxKind: 'municipal' })).toBe('Percepción municipal')
    expect(lineRoleLabel('deduction', { taxKind: 'comision' })).toBe('Comisión')
  })

  it('el link de descarga lleva el bar, el libro y el período', () => {
    expect(exportHref('hub', 'iva-compras', { mes: '2026-10-15' })).toBe(
      '/api/administracion/export?slug=hub&libro=iva-compras&mes=2026-10',
    )
    expect(
      exportHref('hub', 'sumas-y-saldos', {
        desde: '2026-10-01',
        hasta: '2026-12-31',
        antesRefundicion: true,
      }),
    ).toBe(
      '/api/administracion/export?slug=hub&libro=sumas-y-saldos&desde=2026-10-01&hasta=2026-12-31&antes_refundicion=1',
    )
  })
})

describe('CSV de los libros', () => {
  const entry = {
    number: 12,
    numberIsProvisional: true,
    entryDate: '2026-10-03',
    kind: 'standard',
    description: '=Factura A 0003-00001290 · Coca-Cola',
    documentLabel: 'Factura A 0003-00001290',
    documentSeq: 125,
    createdByName: 'Franco',
    lines: [
      {
        accountCode: '5.1.01',
        accountName: 'Mercadería',
        partyId: null,
        partyName: null,
        partyTaxId: null,
        memo: null,
        debitCents: 86_000_000,
        creditCents: 0,
      },
      {
        accountCode: '2.1.01.01',
        accountName: 'Proveedores',
        partyId: 'p1',
        partyName: 'Coca-Cola',
        partyTaxId: null,
        memo: 'vence 24/10',
        debitCents: 0,
        creditCents: 86_000_000,
      },
    ],
  }

  it('diario: una fila por línea, plata con coma y sin miles, texto guardado contra fórmulas', () => {
    const rows = journalCsvRows(entry, (id) => (id === 'p1' ? '30718765435' : null))
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).toHaveLength(JOURNAL_HEADERS.length)
    const csv = buildCsv(JOURNAL_HEADERS, [...rows, journalTotalsRow(86_000_000, 86_000_000)])
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[1]).toBe(
      "12;Sí;03/10/2026;Común;'=Factura A 0003-00001290 · Coca-Cola;5.1.01;Mercadería;;;860000,00;0,00;;Factura A 0003-00001290;125;Franco",
    )
    expect(lines[2]).toContain(';Coca-Cola;30718765435;0,00;860000,00;vence 24/10;')
    expect(lines[3]).toBe('Totales;;;;;;;;;860000,00;860000,00')
  })

  it('mayor: saldo en valor absoluto con D/A, y «Saldo anterior» primero', () => {
    expect(sideCells(-1234)).toEqual([{ csv: '12,34' }, 'A'])
    expect(sideCells(500)).toEqual([{ csv: '5,00' }, 'D'])
    expect(sideCells(0)).toEqual([{ csv: '0,00' }, ''])
    const opening = ledgerCsvRow({
      rowKind: 'opening',
      entryNumber: null,
      numberIsProvisional: false,
      entryDate: '2026-10-01',
      documentLabel: null,
      documentSeq: null,
      description: null,
      partyName: null,
      dueDate: null,
      memo: null,
      debitCents: 0,
      creditCents: 0,
      runningBalanceCents: -45_000,
    })
    expect(opening).toHaveLength(LEDGER_HEADERS.length)
    expect(opening[3]).toBe('Saldo anterior')
    expect(opening.slice(10)).toEqual([{ csv: '450,00' }, 'A'])
    expect(ledgerTotalsRow(100, 50, 50)).toHaveLength(LEDGER_HEADERS.length)
  })

  it('libros IVA: cada fila y los totales tienen las columnas del encabezado', () => {
    const amounts: Record<string, number> = {
      net_21_cents: -100_00,
      vat_21_cents: -21_00,
      total_cents: -121_00,
    }
    const ivaRow = {
      voucherDate: '2026-10-03',
      voucherLabel: 'Nota de crédito A',
      afipVoucherCode: 3,
      pointOfSale: 3,
      numberFrom: 77,
      numberTo: null,
      counterpartyName: 'Coca-Cola',
      counterpartyDocType: 80,
      counterpartyDocNumber: '30718765435',
      counterpartyIvaCondition: 'responsable_inscripto',
      channel: 'salon',
      amounts,
      accountingDate: '2026-10-03',
      documentSeq: 130,
    }
    const purchase = ivaPurchasesCsvRow(ivaRow)
    expect(purchase).toHaveLength(IVA_PURCHASES_HEADERS.length)
    expect(purchase[8]).toEqual({ csv: '-100,00' })
    expect(ivaTotalsRow(8, IVA_PURCHASES_AMOUNT_COLUMNS, amounts, 2)).toHaveLength(
      IVA_PURCHASES_HEADERS.length,
    )
    expect(ivaSalesCsvRow(ivaRow)).toHaveLength(IVA_SALES_HEADERS.length)
    expect(ivaTotalsRow(11, IVA_SALES_AMOUNT_COLUMNS, amounts, 1)).toHaveLength(
      IVA_SALES_HEADERS.length,
    )
  })

  it('estado de cuenta: «Facturas/Pagos» o «Ventas/Cobros»', () => {
    expect(statementHeaders('payables')).toContain('Facturas')
    expect(statementHeaders('receivables')).toContain('Cobros')
  })

  it('subdiarios: listas de importes en una celda y plata sin flotantes', () => {
    const [, , , medios] = SUBLEDGER_COLUMNS.payments
    expect(medios?.type).toBe('list')
    if (!medios) return
    expect(
      subledgerCsvCell(medios, [
        { label: 'Caja', amountCents: 123_456 },
        { label: 'Banco', amountCents: 5 },
      ]),
    ).toBe('Caja: 1234,56, Banco: 0,05')
    const total = SUBLEDGER_COLUMNS.payments.find((c) => c.header === 'Total')
    if (!total) throw new Error('falta Total')
    expect(subledgerCsvCell(total, 1_000_001)).toEqual({ csv: '10000,01' })
  })

  it('nombre de archivo ASCII seguro', () => {
    expect(exportFilename('hub', 'iva-compras', '2026-10')).toBe(
      'administracion-hub-iva-compras-2026-10.csv',
    )
    expect(exportFilename('Café Ñandú', 'diario', '2026-10-01_2026-10-31')).toBe(
      'administracion-cafe-nandu-diario-2026-10-01-2026-10-31.csv',
    )
  })
})

describe('gastos fijos: «Este mes»', () => {
  const base = { frequency: 'monthly' as const, dueDay: 10, today: '2026-10-07' }

  it('vence este mes (o ya venció) → pendiente', () => {
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-10-10', lastDocumentDate: null }),
    ).toBe('pending')
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-09-10', lastDocumentDate: null }),
    ).toBe('pending')
  })

  it('el de este mes ya pasó al próximo: cargado o salteado', () => {
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-11-10', lastDocumentDate: '2026-09-28' }),
    ).toBe('loaded')
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-11-10', lastDocumentDate: '2026-09-05' }),
    ).toBe('skipped')
    expect(
      recurringMonthStatus({ ...base, nextDueDate: '2026-11-10', lastDocumentDate: null }),
    ).toBe('skipped')
  })

  it('un trimestral que este mes no vence → próximo', () => {
    expect(
      recurringMonthStatus({
        ...base,
        frequency: 'quarterly',
        nextDueDate: '2026-12-10',
        lastDocumentDate: '2026-09-08',
      }),
    ).toBe('upcoming')
  })
})

describe('cierres del día: calendario', () => {
  const base = { booksStartDate: '2026-10-01', serviceDay: '2026-10-07' }

  it('cargado, falta, el de hoy todavía no falta, futuro y antes del inicio', () => {
    expect(dailyCloseStatus({ ...base, date: '2026-10-03', hasClose: true })).toBe('loaded')
    expect(dailyCloseStatus({ ...base, date: '2026-10-06', hasClose: false })).toBe('missing')
    expect(dailyCloseStatus({ ...base, date: '2026-10-07', hasClose: false })).toBe('pending')
    expect(dailyCloseStatus({ ...base, date: '2026-10-08', hasClose: false })).toBe('future')
    expect(dailyCloseStatus({ ...base, date: '2026-09-30', hasClose: false })).toBe('before_start')
    // Un cierre cargado se ve aunque sea de antes del inicio o del día de hoy.
    expect(dailyCloseStatus({ ...base, date: '2026-10-07', hasClose: true })).toBe('loaded')
  })

  it('«Cargar cierre» mira desde el inicio (o 30 días atrás) hasta ayer', () => {
    expect(missingCloseWindow('2026-10-01', '2026-10-07')).toEqual({
      from: '2026-10-01',
      to: '2026-10-06',
    })
    expect(missingCloseWindow('2026-01-01', '2026-10-07')).toEqual({
      from: '2026-09-07',
      to: '2026-10-06',
    })
    // El primer día de Administración todavía no tiene nada que falte.
    expect(missingCloseWindow('2026-10-07', '2026-10-07')).toBeNull()
    expect(missingCloseWindow(null, '2026-10-07')).toBeNull()
  })
})

describe('Resumen y checklist', () => {
  it('el Resumen de una fase anterior (sin bloques) queda en cero, no rompe', () => {
    const summary = parseSummary(
      {
        treasuries: [
          {
            id: 't1',
            name: 'Caja',
            kind: 'cash',
            balance_cents: '34950000',
            last_checked_on: '2026-10-01',
          },
          { id: 't2', name: 'Visa', kind: 'credit_card', balance_cents: -50000 },
        ],
        attention: [{ kind: 'algo_nuevo', label: 'Algo', amount_cents: null }],
      },
      '2026-10-07',
    )
    expect(summary.treasuries[0]?.balanceCents).toBe(34_950_000)
    expect(summary.availableCents).toBe(34_950_000)
    expect(summary.cardDebtCents).toBe(50_000)
    expect(summary.payables).toBeNull()
    expect(summary.ivaMonth).toBeNull()
    expect(summary.attention[0]?.kind).toBe('other')
  })

  it('un aviso del Resumen sin texto de la base igual tiene texto', () => {
    const summary = parseSummary(
      {
        attention: [
          { kind: 'sas_cuit_missing', ref_id: null, label: null },
          { kind: 'opening_unassigned', label: null, amount_cents: 71_000_000 },
        ],
      },
      '2026-10-07',
    )
    expect(summary.attention.map((a) => a.label)).toEqual([
      'Falta el CUIT de la SAS: los libros de IVA lo necesitan.',
      'Hay patrimonio inicial sin asignar: lo revisa la contadora.',
    ])
    expect(summary.attention[1]?.amountCents).toBe(71_000_000)
  })

  it('checklist con la forma de la base (#10): bloqueos, avisos con sus números, IVA y numeración', () => {
    const list = parseCloseChecklist(
      {
        month: '2026-10-01',
        period_id: 'p-oct',
        fiscal_year_id: 'fy-2026',
        status: 'open',
        starts_on: '2026-10-01',
        ends_on: '2026-10-31',
        can_close: false,
        blockers: [
          { key: 'month_not_finished', month: '2026-10-01' },
          { key: 'close_out_of_order', month: '2026-10-01', previous_month: '2026-09-01' },
        ],
        warnings: [
          { key: 'missing_daily_closes', count: 2, dates: ['2026-10-03', '2026-10-04'] },
          {
            key: 'treasury_negative',
            count: 1,
            treasuries: [{ treasury_id: 't1', name: 'Caja', balance_cents: -500_000 }],
          },
          { key: 'sas_cuit_missing' },
          { key: 'algo_nuevo', count: 1 },
        ],
        info: [
          { key: 'opening_unassigned', amount_cents: 71_000_000 },
          { key: 'last_month_of_fiscal_year', end_date: '2026-12-31' },
          {
            key: 'iva_settlement_outdated',
            document_id: 'd1',
            label: 'La liquidación de IVA registrada quedó vieja.',
          },
          { key: 'otra_cosa' },
        ],
        entries_count: 240,
        debit_total_cents: 12_345_600,
        credit_total_cents: 12_345_600,
        number_from: 2,
        number_to: 241,
        numbers_provisional: true,
        is_last_month_of_fiscal_year: true,
        iva_position: {
          month: '2026-10-01',
          figures: { df: 131_040_000, cf: 41_000_000, perc: 600_000, ret: 300_000, st0: 0, ld0: 0 },
          debit_fiscal: {
            by_rate: { '2100': 130_000_000, '1050': 1_040_000 },
            total_cents: 131_040_000,
          },
          credit_fiscal: { by_rate: { '2100': 41_000_000 }, total_cents: 41_000_000 },
          to_pay_cents: 89_140_000,
          in_favor_cents: 0,
          is_zero: false,
          settlement: { document_id: null, up_to_date: null },
          reconciliation: { differences: [], differences_count: 0 },
          status: 'open',
          mode: 'on_close',
          applies: true,
          will_generate: true,
          replaces_document_id: null,
        },
        closed_at: null,
        closed_by_name: null,
      },
      '2026-10-01',
    )
    expect(list.canClose).toBe(false)
    expect(list.blockers.map((b) => b.label)).toEqual([
      'Octubre todavía no terminó.',
      'Primero cerrá septiembre.',
    ])
    expect(list.warnings.map((w) => w.label)).toEqual([
      'Faltan los cierres del día del 03/10 y 04/10.',
      'Caja quedó en −$\u00a05.000,00 al último día del mes.',
      'Falta el CUIT de la SAS (Ajustes › Datos de la SAS).',
      'Hay algo para revisar antes de cerrar.',
    ])
    expect(list.warningKeys).toEqual([
      'missing_daily_closes',
      'treasury_negative',
      'sas_cuit_missing',
    ])
    expect(list.info.map((i) => i.key)).toEqual([
      'opening_unassigned',
      'last_month_of_fiscal_year',
      'iva_settlement_outdated',
    ])
    expect(list.info[0]?.label).toBe(
      'Hay $\u00a0710.000,00 de patrimonio inicial sin asignar: lo revisa la contadora.',
    )
    expect(list.info[2]?.label).toBe('La liquidación de IVA registrada quedó vieja.')
    expect(list.isLastMonthOfFiscalYear).toBe(true)
    expect([list.entriesCount, list.debitTotalCents, list.creditTotalCents]).toEqual([
      240, 12_345_600, 12_345_600,
    ])
    expect([list.numberFrom, list.numberTo, list.numberingProvisional]).toEqual([2, 241, true])
    expect(list.iva?.figures).toEqual({
      df: 131_040_000,
      cf: 41_000_000,
      perc: 600_000,
      ret: 300_000,
      st0: 0,
      ld0: 0,
    })
    expect(list.iva?.toPayCents).toBe(89_140_000)
    expect(list.iva?.willGenerate).toBe(true)
    expect(list.iva?.debitFiscal.byRate).toEqual({ '2100': 130_000_000, '1050': 1_040_000 })
  })

  it('checklist anidado de un borrador anterior (blocks, entries, numbering, iva)', () => {
    const list = parseCloseChecklist(
      {
        status: 'closed',
        can_close: false,
        blocks: [{ key: 'period_already_closed', month: '2026-09-01' }],
        warnings: [],
        info: [{ key: 'opening_equity_unassigned', amount_cents: -1_000 }],
        entries: { count: 3, debit_total_cents: 900 },
        numbering: { from: 2, to: 4, provisional: false },
        iva: { to_pay_cents: 0, figures: {}, will_generate: false },
        closed_at: '2026-10-05T14:00:00+00:00',
        closed_by_name: 'Franco',
      },
      '2026-09-01',
    )
    expect(list.blockers[0]?.label).toBe('Septiembre ya está cerrado.')
    expect(list.info[0]?.label).toBe(
      'Hay $\u00a010,00 de patrimonio inicial sin asignar: lo revisa la contadora.',
    )
    expect([list.entriesCount, list.debitTotalCents, list.creditTotalCents]).toEqual([3, 900, 900])
    expect([list.numberFrom, list.numberTo, list.numberingProvisional]).toEqual([2, 4, false])
    expect(list.iva?.status).toBe('closed')
    expect(list.closedByName).toBe('Franco')
  })

  it('checklist: bloqueos, avisos e info con su texto (claves planas de una versión anterior)', () => {
    const list = parseCloseChecklist(
      {
        status: 'open',
        blockers: [{ key: 'close_out_of_order', detail: { previous_month: '2026-09-01' } }],
        warnings: ['missing_daily_closes', { key: 'treasury_negative', label: 'Caja en −$ 500' }],
        info: [{ key: 'opening_unassigned', amount_cents: 71_000_000 }],
        entries_count: 240,
      },
      '2026-10-01',
    )
    expect(list.canClose).toBe(false)
    expect(list.blockers[0]?.label).toMatch(/Primero cerrá/)
    expect(list.warnings.map((w) => w.key)).toEqual(['missing_daily_closes', 'treasury_negative'])
    expect(list.warnings[1]?.label).toBe('Caja en −$ 500')
    expect(list.warningKeys).toEqual(['missing_daily_closes', 'treasury_negative'])
    expect(list.info[0]?.label).toMatch(/patrimonio inicial sin asignar/)
    expect(list.entriesCount).toBe(240)
  })
})
