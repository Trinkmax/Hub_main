import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import {
  isActiveTrialChip,
  parseTrialLevel,
  trialLevelChips,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/trial'
import { warningLine } from '@/app/(manager)/[tenantSlug]/administracion/libros/cierres/_lib/checklist'
import { rankAccount, rankAndFilter } from '@/components/administracion/search'
import {
  closePeriodMessage,
  closeWarningsFromDetails,
  ivaSettlementMessage,
  parseClosePeriodResult,
  parseIvaSettlementResult,
  parseReopenPeriodResult,
  reopenPeriodMessage,
} from '@/lib/accounting/actions/payloads'
import { ACC_ERRORS } from '@/lib/accounting/errors'
import {
  PART_UNAVAILABLE_MESSAGE,
  QUERY_FAILED_MESSAGE,
  queryError,
  REPORT_UNAVAILABLE_MESSAGE,
} from '@/lib/accounting/queries/shared'
import { generateIvaSettlementSchema } from '@/lib/accounting/schemas'
import { formatCents } from '@/lib/money'

/**
 * El cableado con la base (db-api.md): lo que devuelven los cierres (#10), el
 * detalle de `close_warnings`, cuándo un reporte «todavía no está disponible»,
 * los niveles de sumas y saldos y la búsqueda por código con el plan de 5
 * niveles (#16).
 */

describe('queryError: «todavía no está disponible» solo si la función no existe', () => {
  let log: MockInstance
  beforeEach(() => {
    log = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => log.mockRestore())

  it('PGRST202 y 42883: la migración todavía no está', () => {
    for (const code of ['PGRST202', '42883']) {
      const e = queryError('acc_report_summary', { code, message: 'no existe' })
      expect([e.message, e.key, e.code]).toEqual([
        REPORT_UNAVAILABLE_MESSAGE,
        'function_unavailable',
        'error',
      ])
    }
  })

  it('PGRST205 y 42P01: la tabla todavía no está (importadores sin su migración)', () => {
    for (const code of ['PGRST205', '42P01']) {
      const e = queryError('acc_import_batches', { code, message: 'no existe' })
      expect([e.message, e.key, e.code]).toEqual([
        PART_UNAVAILABLE_MESSAGE,
        'function_unavailable',
        'error',
      ])
    }
  })

  it('un parámetro de reporte inválido es un bug con el texto del catálogo', () => {
    const e = queryError('acc_report_open_items', {
      code: 'P0001',
      message: 'invalid_report_param',
      details: '{"param":"p_side"}',
    })
    expect(e.message).toBe(ACC_ERRORS.invalid_report_param.message)
    expect(e.key).toBe('invalid_report_param')
  })

  it('un subdiario cuya fase falta (p_kind) sí es «todavía no disponible»', () => {
    const e = queryError('acc_report_subledger', {
      code: 'P0001',
      message: 'invalid_report_param',
      details: '{"param":"p_kind"}',
    })
    expect([e.message, e.key]).toEqual([REPORT_UNAVAILABLE_MESSAGE, 'function_unavailable'])
  })

  it('los demás errores: el texto del catálogo, o el de lectura si era de guardar', () => {
    expect(
      queryError('acc_report_journal', { code: 'P0001', message: 'range_crosses_fiscal_year' })
        .message,
    ).toBe(ACC_ERRORS.range_crosses_fiscal_year.message)
    expect(queryError('acc_report_journal', { code: 'XX000', message: 'boom' }).message).toBe(
      QUERY_FAILED_MESSAGE,
    )
  })
})

describe('cierre de mes (#10): lo que manda y lo que devuelve la base', () => {
  it('close_warnings trae los avisos con sus números (detail {month, warnings})', () => {
    const items = closeWarningsFromDetails(
      JSON.stringify({
        month: '2026-10-01',
        warnings: [
          { key: 'missing_daily_closes', count: 2, dates: ['2026-10-03', '2026-10-04'] },
          {
            key: 'treasury_negative',
            count: 1,
            treasuries: [{ treasury_id: 't1', name: 'Caja', balance_cents: -500_000 }],
          },
          { key: 'sas_cuit_missing' },
        ],
      }),
    )
    expect(items.map((w) => w.message)).toEqual([
      'Faltan los cierres del día del 03/10 y 04/10.',
      `Caja quedó en descubierto por ${formatCents(500_000)} al último día del mes.`,
      'Falta el CUIT de la SAS (Ajustes › Datos de la SAS).',
    ])
  })

  it('resultado del cierre: el IVA solo si el mes quedó con su liquidación', () => {
    const closed = parseClosePeriodResult(
      {
        month: '2026-10-01',
        period_id: 'p1',
        number_from: 2,
        number_to: 241,
        entries_count: 240,
        debit_total_cents: '12345600',
        snapshot_hash: 'ab',
        iva_settlement_document_id: 'd1',
        iva_to_pay_cents: 89_140_000,
        iva_in_favor_cents: 0,
      },
      '2026-10-01',
    )
    expect(closed).toMatchObject({
      periodId: 'p1',
      numberFrom: 2,
      numberTo: 241,
      entriesCount: 240,
      debitTotalCents: 12_345_600,
      ivaSettlementDocumentId: 'd1',
    })
    expect(closePeriodMessage(closed)).toBe(
      `Octubre cerrado. IVA a pagar: ${formatCents(89_140_000)}.`,
    )
    expect(
      closePeriodMessage({ ...closed, ivaSettlementDocumentId: null, ivaToPayCents: 500 }),
    ).toBe('Octubre cerrado.')
  })

  it('reabrir: dice si se anuló la liquidación del IVA', () => {
    const reopened = parseReopenPeriodResult(
      {
        month: '2026-10-01',
        period_id: 'p1',
        numbers_cleared: 240,
        voided_iva_settlement_ids: ['d1'],
        voided_count: 1,
      },
      '2026-10-01',
    )
    expect(reopened.numbersCleared).toBe(240)
    expect(reopenPeriodMessage(reopened)).toBe(
      'Octubre reabierto. Se anuló su liquidación del IVA.',
    )
    expect(reopenPeriodMessage(parseReopenPeriodResult(null, '2026-09-01'))).toBe(
      'Septiembre reabierto.',
    )
  })

  it('registrar la liquidación: creada, reemplazada o en cero', () => {
    const created = parseIvaSettlementResult(
      {
        month: '2026-10-01',
        created: true,
        document_id: 'd2',
        document_seq: 125,
        entry_id: 'e2',
        total_cents: 131_940_000,
        to_pay_cents: 89_140_000,
        in_favor_cents: 0,
        replaced_count: 1,
      },
      '2026-10-01',
    )
    expect([created.documentId, created.documentSeq, created.replacedCount]).toEqual(['d2', 125, 1])
    expect(ivaSettlementMessage(created)).toBe(
      `Liquidación del IVA de octubre registrada de nuevo: a pagar ${formatCents(89_140_000)}.`,
    )
    const zero = parseIvaSettlementResult(
      { month: '2026-10-01', created: false, document_id: null, replaced_count: 1 },
      '2026-10-01',
    )
    expect(zero.documentId).toBeNull()
    expect(ivaSettlementMessage(zero)).toBe(
      'Se anuló la liquidación anterior: el IVA de octubre ahora da cero.',
    )
    expect(ivaSettlementMessage({ ...zero, replacedCount: 0 })).toBe(
      'El IVA de octubre dio cero: no hay nada para registrar.',
    )
    expect(parseIvaSettlementResult('d9', '2026-10-01').documentId).toBe('d9')
  })

  it('las cifras de un mes con solo notas de crédito pasan (también LD₁ < 0)', () => {
    // ST₀ 10.000, CF −5.000 y PERC −600 → saldo técnico −5.000: ST₁ 5.000, LD₁ = 0 − 600.
    const parsed = generateIvaSettlementSchema.safeParse({
      month: '2026-10',
      expected: {
        debitCents: 0,
        creditCents: -5_000,
        perceptionsCents: -600,
        withholdingsCents: 0,
        toPayCents: 0,
        technicalBalanceNewCents: 5_000,
        freeBalanceNewCents: -600,
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('checklist: con detalle, el texto general (los días no se leen dos veces)', () => {
    const line = warningLine(
      {
        key: 'missing_daily_closes',
        label: 'Faltan los cierres del día del 04/10 y 11/10.',
        detail: { dates: ['2026-10-04', '2026-10-11'] },
        amountCents: null,
        count: 2,
      },
      '/hub/administracion',
    )
    expect(line.text).toBe('Faltan cierres del día en el mes.')
    expect(line.detail).toBe('Faltan los del 04/10 y 11/10.')
  })
})

describe('sumas y saldos: niveles 1 a 5', () => {
  it('la URL acepta del 1 al 5', () => {
    expect(parseTrialLevel('4')).toBe(4)
    expect(parseTrialLevel('5')).toBe(5)
    expect(parseTrialLevel('6')).toBe('todo')
  })

  it('con el plan estándar el 5 es el plan entero; «Todo» solo si hay más niveles', () => {
    const chips = trialLevelChips(5)
    expect(chips.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5'])
    const five = chips[4]
    expect(five?.param).toBeNull()
    expect(five && isActiveTrialChip(five, 'todo')).toBe(true)
    expect(five && isActiveTrialChip(five, 3)).toBe(false)
    const deep = trialLevelChips(7)
    expect(deep.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', 'Todo'])
    expect(deep[4]?.param).toBe('5')
  })
})

describe('buscar una cuenta por código con el plan de 5 niveles', () => {
  const accounts = [
    { code: '1.1.01.00.000', name: 'Caja, bancos y valores a depositar' },
    { code: '1.1.01.01.000', name: 'Caja y bancos' },
    { code: '1.1.01.01.001', name: 'Caja' },
    { code: '1.1.01.01.002', name: 'Mercado Pago' },
    { code: '1.1.03.01.001', name: 'Deudores por ventas' },
  ]
  const codes = (q: string) => rankAndFilter(accounts, q, rankAccount).map((a) => a.code)

  it('el rubro primero (con o sin puntos) y después sus cuentas', () => {
    expect(codes('1.1.01.01')).toEqual(['1.1.01.01.000', '1.1.01.01.001', '1.1.01.01.002'])
    expect(codes('110101')).toEqual(['1.1.01.01.000', '1.1.01.01.001', '1.1.01.01.002'])
    expect(codes('1101')[0]).toBe('1.1.01.00.000')
  })

  it('el código completo encuentra la cuenta', () => {
    expect(codes('1.1.01.01.002')).toEqual(['1.1.01.01.002'])
    expect(codes('110101002')).toEqual(['1.1.01.01.002'])
  })
})
