/**
 * «Completar con Mercado Pago» del cierre del día: del reporte (Liquidaciones o
 * Todas las transacciones) a lo cobrado con QR y por transferencia en un día,
 * con el corte del día del importador. Filas armadas a mano.
 */

import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/lib/imports/csv'
import { openTable } from '@/lib/imports/detect'
import {
  describeMpDay,
  type MpCloseMethod,
  type MpDayOk,
  type MpDayResult,
  mpCloseTargets,
  mpDayFailureText,
  mpDayFills,
  readMpDay,
} from '@/lib/imports/mercadopago/daily-close'
import { IMPORT_FIXTURES, importFixture } from '@/tests/fixtures/imports/fixtures'

const SAS = '30712345671'
const DAY = '2026-10-07'

const plain = (s: string) => s.replace(/ /g, ' ')

function ok(r: MpDayResult): MpDayOk {
  if (!r.ok) throw new Error(`esperaba ok y vino ${r.reason}`)
  return r
}

// ─── Liquidaciones ───────────────────────────────────────────────────────────

const RELEASE_HEADER = [
  'DATE',
  'SOURCE_ID',
  'RECORD_TYPE',
  'DESCRIPTION',
  'NET_CREDIT_AMOUNT',
  'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT',
  'MP_FEE_AMOUNT',
  'TAXES_AMOUNT',
  'TRANSACTION_APPROVAL_DATE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'OPERATION_TAGS',
  'SUB_UNIT',
  'POS_ID',
  'STORE_ID',
  'POI_ID',
  'PAYER_ID_TYPE',
  'PAYER_ID_NUMBER',
  'CURRENCY',
] as const

type ReleaseCol = (typeof RELEASE_HEADER)[number]

const at = (local: string) => `${local}.000-03:00`

function releaseRow(
  cells: Partial<Record<ReleaseCol, string>>,
  header: readonly ReleaseCol[] = RELEASE_HEADER,
): string[] {
  return header.map((h) => cells[h] ?? '')
}

const SIGNALS = {
  qr: {
    PAYMENT_METHOD: 'account_money',
    PAYMENT_METHOD_TYPE: 'account_money',
    OPERATION_TAGS: 'QR',
    SUB_UNIT: 'QR',
    POS_ID: '40001',
    STORE_ID: '50001',
  },
  transfer: {
    PAYMENT_METHOD: 'cvu',
    PAYMENT_METHOD_TYPE: 'bank_transfer',
    PAYER_ID_TYPE: 'DNI',
    PAYER_ID_NUMBER: '23456789',
  },
  own: {
    PAYMENT_METHOD: 'cvu',
    PAYMENT_METHOD_TYPE: 'bank_transfer',
    PAYER_ID_TYPE: 'CUIT',
    PAYER_ID_NUMBER: SAS,
  },
  point: {
    PAYMENT_METHOD: 'debvisa',
    PAYMENT_METHOD_TYPE: 'debit_card',
    OPERATION_TAGS: 'PO',
    POI_ID: 'PAX-0001',
  },
  unknown: { PAYMENT_METHOD: 'available_money', PAYMENT_METHOD_TYPE: 'available_money' },
} satisfies Record<string, Partial<Record<ReleaseCol, string>>>

/** Un cobro liberado: aprobado a `approved` (hora de Córdoba) y liberado a `released`. */
function payment(
  id: string,
  approved: string,
  gross: string,
  kind: keyof typeof SIGNALS,
  released = approved,
): Partial<Record<ReleaseCol, string>> {
  return {
    DATE: at(released),
    SOURCE_ID: id,
    RECORD_TYPE: 'release',
    DESCRIPTION: 'payment',
    NET_CREDIT_AMOUNT: gross,
    NET_DEBIT_AMOUNT: '0.00',
    GROSS_AMOUNT: gross,
    MP_FEE_AMOUNT: '0.00',
    TAXES_AMOUNT: '0.00',
    TRANSACTION_APPROVAL_DATE: at(approved),
    CURRENCY: 'ARS',
    ...SIGNALS[kind],
  }
}

/** Una devolución: sale a `when`; `approved` es la fecha de la venta original (si el reporte la trae). */
function refund(
  id: string,
  when: string,
  amount: string,
  approved = '',
): Partial<Record<ReleaseCol, string>> {
  return {
    DATE: at(when),
    SOURCE_ID: id,
    RECORD_TYPE: 'release',
    DESCRIPTION: 'refund',
    NET_CREDIT_AMOUNT: '0.00',
    NET_DEBIT_AMOUNT: amount,
    GROSS_AMOUNT: `-${amount}`,
    TRANSACTION_APPROVAL_DATE: approved === '' ? '' : at(approved),
    CURRENCY: 'ARS',
  }
}

const initial = (when: string) =>
  releaseRow({
    DATE: at(when),
    RECORD_TYPE: 'initial_available_balance',
    NET_CREDIT_AMOUNT: '0.00',
    NET_DEBIT_AMOUNT: '0.00',
    GROSS_AMOUNT: '0.00',
    CURRENCY: 'ARS',
  })

const total = (when: string) =>
  releaseRow({
    DATE: at(when),
    RECORD_TYPE: 'total',
    NET_CREDIT_AMOUNT: '0.00',
    NET_DEBIT_AMOUNT: '0.00',
    GROSS_AMOUNT: '0.00',
    CURRENCY: 'ARS',
  })

function release(
  movements: readonly Partial<Record<ReleaseCol, string>>[],
  opts: { from?: string; to?: string } = {},
): string[][] {
  return [
    [...RELEASE_HEADER],
    initial(opts.from ?? '2026-10-06T00:00:00'),
    ...movements.map((m) => releaseRow(m)),
    total(opts.to ?? '2026-10-08T23:59:59'),
  ]
}

const DAY_ROWS = release([
  payment('1001', '2026-10-07T13:00:00', '10000.00', 'qr'),
  payment('1002', '2026-10-07T22:30:00', '2500.50', 'qr'),
  payment('1003', '2026-10-07T20:00:00', '5000.00', 'transfer'),
  payment('1004', '2026-10-07T21:00:00', '200000.00', 'own'),
  payment('1005', '2026-10-07T15:00:00', '3000.00', 'point'),
  payment('1006', '2026-10-06T23:30:00', '9999.00', 'qr'),
  payment('1007', '2026-10-08T01:15:00', '1234.00', 'qr'),
  payment('1008', '2026-10-07T03:00:00', '777.00', 'qr'),
])

describe('Liquidaciones: lo cobrado en el día', () => {
  it('suma QR y transferencias del día (calendario) y deja afuera la plata propia y el Point', () => {
    const r = ok(readMpDay(DAY_ROWS, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.report).toBe('release')
    expect(r.qr).toEqual({
      count: 3,
      grossCents: 1_327_750,
      refundCount: 0,
      refundCents: 0,
      netCents: 1_327_750,
    })
    expect(r.transfer.count).toBe(1)
    expect(r.transfer.netCents).toBe(500_000)
    expect(r.ownTransfers).toEqual({ count: 1, cents: 20_000_000 })
    expect(r.uncheckedTransfers).toBe(0)
    expect(r.unclassified).toEqual({ count: 0, cents: 0 })
    expect(r.period).toEqual({ from: '2026-10-06', to: '2026-10-08' })
    expect(r.startsLate).toBeNull()
    expect(r.endsEarly).toBeNull()
  })

  it('con el día de servicio (corte 5), la madrugada va al día anterior', () => {
    const r = ok(readMpDay(DAY_ROWS, { date: DAY, cutoffHour: 5, sasCuit: SAS }))
    // 1001 + 1002 + 1007 (01:15 del 08/10); 1008 (03:00 del 07/10) es del 06/10.
    expect(r.qr.count).toBe(3)
    expect(r.qr.netCents).toBe(1_373_450)
    expect(r.cutoffHour).toBe(5)
  })

  it('cuenta el día de la venta (aprobación), no el de la liberación', () => {
    const rows = release([
      payment('1101', '2026-10-06T23:00:00', '4000.00', 'qr', '2026-10-07T10:00:00'),
      payment('1102', '2026-10-07T11:00:00', '6000.00', 'qr', '2026-10-08T09:00:00'),
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.qr.count).toBe(1)
    expect(r.qr.netCents).toBe(600_000)
    expect(r.deferredRelease).toBe(false)
  })

  it('avisa si hay cobros con QR que se liberan días después', () => {
    const rows = release([
      payment('1201', '2026-10-01T10:00:00', '4000.00', 'qr', '2026-10-07T10:00:00'),
      payment('1202', '2026-10-07T12:00:00', '1000.00', 'transfer'),
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.deferredRelease).toBe(true)
    expect(r.qr.count).toBe(0)
    expect(describeMpDay(r, mpDayFills(r, { qr: 'q', transfer_in: 't' })).notes.join(' ')).toMatch(
      /Todas las transacciones/,
    )
  })

  it('resta la devolución del mismo día de un cobro del mismo día, y no la de otro día', () => {
    const rows = release([
      payment('2001', '2026-10-07T12:00:00', '8000.00', 'qr'),
      refund('2001', '2026-10-07T12:30:00', '8000.00', '2026-10-07T12:00:00'),
      payment('2002', '2026-10-07T13:00:00', '5000.00', 'qr'),
      // Devuelto dos días después aunque la fila traiga la fecha de la venta: no es de este cierre.
      refund('2002', '2026-10-09T10:00:00', '5000.00', '2026-10-07T13:00:00'),
      payment('2003', '2026-10-06T10:00:00', '1500.00', 'qr'),
      refund('2003', '2026-10-07T14:00:00', '1500.00'),
      // Un cobro con Point devuelto en el día no toca QR ni transferencias.
      payment('2004', '2026-10-07T15:00:00', '4000.00', 'point'),
      refund('2004', '2026-10-07T16:00:00', '4000.00'),
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.qr).toEqual({
      count: 2,
      grossCents: 1_300_000,
      refundCount: 1,
      refundCents: 800_000,
      netCents: 500_000,
    })
    expect(r.otherRefunds).toEqual({ count: 1, cents: 150_000 })
  })

  it('las propinas por QR no son ventas, y una fila repetida no se suma dos veces', () => {
    const rows = release([
      payment('3001', '2026-10-07T12:00:00', '1000.00', 'qr'),
      payment('3001', '2026-10-07T12:00:00', '1000.00', 'qr'),
      {
        ...payment('3002', '2026-10-07T12:05:00', '500.00', 'qr'),
        DESCRIPTION: 'tip',
      },
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.qr.count).toBe(1)
    expect(r.qr.netCents).toBe(100_000)
    expect(r.tips).toEqual({ count: 1, cents: 50_000 })
  })

  it('no suma lo que no sabe clasificar ni los pagos que hizo el bar', () => {
    const rows = release([
      payment('4001', '2026-10-07T12:00:00', '2000.00', 'unknown'),
      {
        ...payment('4002', '2026-10-07T12:30:00', '0.00', 'qr'),
        NET_CREDIT_AMOUNT: '0.00',
        NET_DEBIT_AMOUNT: '700.00',
        GROSS_AMOUNT: '-700.00',
      },
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.qr.count).toBe(0)
    expect(r.unclassified).toEqual({ count: 1, cents: 200_000 })
  })

  it('sin la columna de quién pagó (o sin la CUIT de la SAS) avisa que no pudo separar la plata propia', () => {
    const header = RELEASE_HEADER.filter((h) => h !== 'PAYER_ID_TYPE' && h !== 'PAYER_ID_NUMBER')
    const rows = [
      [...header],
      releaseRow(payment('5001', '2026-10-07T12:00:00', '1000.00', 'transfer'), header),
      releaseRow(payment('5002', '2026-10-07T13:00:00', '2000.00', 'own'), header),
    ]
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.transfer.count).toBe(2)
    expect(r.uncheckedTransfers).toBe(2)
    expect(r.ownTransfers.count).toBe(0)

    const noSas = ok(readMpDay(DAY_ROWS, { date: DAY, cutoffHour: 0, sasCuit: null }))
    // Sin la CUIT de la SAS no se puede saber cuál es propia: se suman y se avisa.
    expect(noSas.transfer.count).toBe(2)
    expect(noSas.uncheckedTransfers).toBe(2)
  })

  it('avisa si el reporte empieza tarde o termina antes de que termine el día de servicio', () => {
    const rows = release([payment('6001', '2026-10-07T13:00:00', '1000.00', 'qr')], {
      from: '2026-10-07T12:00:00',
      to: '2026-10-07T23:59:59',
    })
    const service = ok(readMpDay(rows, { date: DAY, cutoffHour: 5, sasCuit: SAS }))
    expect(service.startsLate).toBe('2026-10-07T15:00:00.000Z')
    expect(service.endsEarly).toBe('2026-10-08T02:59:59.000Z')
    const notes = plain(describeMpDay(service, mpDayFills(service, TARGETS)).notes.join(' '))
    expect(notes).toContain('El reporte empieza el 07/10/2026 12:00: lo cobrado antes no está.')
    expect(notes).toContain(
      'El reporte llega hasta el 07/10/2026 23:59 y el día del cierre sigue hasta las 5 a. m.: lo cobrado después no está.',
    )
    // Día calendario: 23:59:59 alcanza.
    const calendar = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(calendar.endsEarly).toBeNull()
  })

  it('con el reporte de ejemplo de la guía', async () => {
    const opened = await openTable({
      bytes: importFixture(IMPORT_FIXTURES.mpRelease),
      fileName: IMPORT_FIXTURES.mpRelease,
    })
    if (!opened.ok) throw new Error(opened.issue.code)
    const rows = opened.table.rows
    const first = ok(readMpDay(rows, { date: '2026-10-01', cutoffHour: 0, sasCuit: SAS }))
    expect(first.qr).toMatchObject({ count: 2, netCents: 9_280_000 })
    expect(first.transfer).toMatchObject({ count: 1, netCents: 5_000_000 })
    expect(first.ownTransfers).toEqual({ count: 1, cents: 20_000_000 })
    // El QR de las 2:30 del 02/10 es del 01/10 con el día de servicio.
    const service = ok(readMpDay(rows, { date: '2026-10-01', cutoffHour: 5, sasCuit: SAS }))
    expect(service.qr).toMatchObject({ count: 3, netCents: 10_180_000 })
    // El 03/10: una propina por QR y la devolución de un cobro del 01/10.
    const third = ok(readMpDay(rows, { date: '2026-10-03', cutoffHour: 0, sasCuit: SAS }))
    expect(third.qr.count).toBe(0)
    expect(third.tips).toEqual({ count: 1, cents: 150_000 })
    expect(third.otherRefunds).toEqual({ count: 1, cents: 200_000 })
    // Nunca sale quién pagó.
    expect(JSON.stringify(first)).not.toContain('23456789')
  })
})

// ─── Todas las transacciones ─────────────────────────────────────────────────

const SETTLEMENT_CSV = [
  'SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;TRANSACTION_DATE;SETTLEMENT_DATE;SETTLEMENT_NET_AMOUNT;PAYMENT_METHOD;PAYMENT_METHOD_TYPE;OPERATION_TAGS;SUB_UNIT;POS_ID;STORE_ID;POI_ID;PAYER_ID_TYPE;PAYER_ID_NUMBER;TRANSACTION_CURRENCY',
  '3001;SETTLEMENT;12000.00;2026-10-07T12:00:00.000-03:00;2026-10-07T12:00:01.000-03:00;11800.00;account_money;account_money;QR;QR;40001;50001;;;;ARS',
  '3002;SETTLEMENT;3000.00;2026-10-07T13:00:00.000-03:00;2026-10-07T13:00:01.000-03:00;2950.00;debvisa;debit_card;QR;QR;40001;50001;;;;ARS',
  '3003;SETTLEMENT;7000.00;2026-10-07T18:00:00.000-03:00;2026-10-07T18:00:01.000-03:00;6958.00;cvu;bank_transfer;;;;;;DNI;23456789;ARS',
  `3004;SETTLEMENT;150000.00;2026-10-07T19:00:00.000-03:00;2026-10-07T19:00:01.000-03:00;150000.00;cvu;bank_transfer;;;;;;CUIT;${SAS};ARS`,
  '3005;SETTLEMENT;2000.00;2026-10-07T20:00:00.000-03:00;2026-10-07T20:00:01.000-03:00;1988.00;available_money;available_money;;;;;;;;ARS',
  '3001;REFUND;-12000.00;2026-10-07T12:30:00.000-03:00;2026-10-07T12:30:01.000-03:00;-11800.00;account_money;account_money;QR;QR;40001;50001;;;;ARS',
  '3006;REFUND;-500.00;2026-10-07T21:00:00.000-03:00;2026-10-07T21:00:01.000-03:00;-500.00;account_money;account_money;QR;QR;40001;50001;;;;ARS',
  '9001;PAYOUTS;-50000.00;2026-10-07T22:00:00.000-03:00;2026-10-07T22:00:01.000-03:00;-50000.00;;;;;;;;;;ARS',
  '3007;SETTLEMENT;4000.00;2026-10-06T23:00:00.000-03:00;2026-10-06T23:00:01.000-03:00;3950.00;account_money;account_money;QR;QR;40001;50001;;;;ARS',
  '3008;SETTLEMENT;-800.00;2026-10-07T10:00:00.000-03:00;2026-10-07T10:00:01.000-03:00;-800.00;account_money;account_money;;;;;;;;ARS',
].join('\n')

describe('Todas las transacciones: lo cobrado en el día', () => {
  it('cobros (SETTLEMENT) por canal, devoluciones del día y plata propia', () => {
    const rows = parseCsv(SETTLEMENT_CSV, ';')
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.report).toBe('settlement')
    expect(r.qr).toEqual({
      count: 2,
      grossCents: 1_500_000,
      refundCount: 1,
      refundCents: 1_200_000,
      netCents: 300_000,
    })
    expect(r.transfer).toMatchObject({ count: 1, netCents: 700_000 })
    expect(r.ownTransfers).toEqual({ count: 1, cents: 15_000_000 })
    expect(r.unclassified).toEqual({ count: 1, cents: 200_000 })
    expect(r.otherRefunds).toEqual({ count: 1, cents: 50_000 })
    expect(r.uncheckedTransfers).toBe(0)
    expect(r.period).toEqual({ from: '2026-10-06', to: DAY })
    expect(r.endsEarly).toBeNull()
    expect(JSON.stringify(r)).not.toContain('23456789')
  })

  it('con decimales con coma', () => {
    const csv = [
      'SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_AMOUNT;TRANSACTION_DATE;SETTLEMENT_NET_AMOUNT;PAYMENT_METHOD_TYPE;OPERATION_TAGS;POS_ID',
      '1;SETTLEMENT;1234,50;2026-10-07T12:00:00.000-03:00;1200,00;account_money;QR;40001',
      '2;SETTLEMENT;100,25;2026-10-07T12:10:00.000-03:00;99,00;account_money;QR;40001',
    ].join('\n')
    const r = ok(readMpDay(parseCsv(csv, ';'), { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(r.qr.netCents).toBe(133_475)
  })
})

// ─── Archivos que no sirven ──────────────────────────────────────────────────

describe('cuando el archivo no sirve', () => {
  it('no es de Mercado Pago', () => {
    const r = readMpDay(
      [
        ['Fecha', 'Concepto', 'Importe'],
        ['07/10/2026', 'Transferencia', '100,00'],
      ],
      { date: DAY, cutoffHour: 0, sasCuit: SAS },
    )
    expect(r).toMatchObject({ ok: false, reason: 'not_mp' })
    if (!r.ok) expect(mpDayFailureText(r)).toMatch(/no es un reporte de Mercado Pago/)
  })

  it('no trae movimientos', () => {
    const r = readMpDay(release([]), { date: DAY, cutoffHour: 0, sasCuit: SAS })
    expect(r).toMatchObject({ ok: false, reason: 'empty', report: 'release' })
  })

  it('es de otras fechas: dice cuáles', () => {
    const rows = release([
      payment('7001', '2026-10-01T12:00:00', '1000.00', 'qr'),
      payment('7002', '2026-10-03T12:00:00', '1000.00', 'qr'),
    ])
    const r = readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS })
    expect(r).toMatchObject({
      ok: false,
      reason: 'other_dates',
      period: { from: '2026-10-01', to: '2026-10-03' },
    })
    if (!r.ok) {
      expect(mpDayFailureText(r)).toBe(
        'El archivo es del 01/10 – 03/10/2026: no trae el 07/10. Bajá uno que incluya ese día.',
      )
    }
  })

  it('«Todas las transacciones» sin importe ni fecha', () => {
    const r = readMpDay(
      [
        ['SOURCE_ID', 'TRANSACTION_TYPE', 'SETTLEMENT_NET_AMOUNT'],
        ['1', 'SETTLEMENT', '100.00'],
      ],
      { date: DAY, cutoffHour: 0, sasCuit: SAS },
    )
    expect(r).toMatchObject({ ok: false, reason: 'unreadable', report: 'settlement' })
    if (!r.ok) expect(mpDayFailureText(r)).toMatch(/Liquidaciones/)
  })
})

// ─── Qué medio es cada cobro ─────────────────────────────────────────────────

const METHODS: MpCloseMethod[] = [
  { id: 'm-cash', kind: 'treasury', systemKey: 'cash', partyId: null, treasuryAccountId: 't-caja' },
  {
    id: 'm-tr',
    kind: 'settled_now',
    systemKey: 'transfer',
    partyId: 'p-mp',
    treasuryAccountId: 't-mp',
  },
  {
    id: 'm-qr',
    kind: 'settled_now',
    systemKey: 'qr_mp',
    partyId: 'p-mp',
    treasuryAccountId: 't-mp',
  },
  { id: 'm-mp', kind: 'settled_now', systemKey: null, partyId: 'p-mp', treasuryAccountId: 't-mp' },
  {
    id: 'm-cc',
    kind: 'customer_account',
    systemKey: 'customer_account',
    partyId: null,
    treasuryAccountId: null,
  },
]

const TARGETS = { qr: 'm-qr', transfer_in: 'm-tr' } as const

describe('qué medio del cierre es QR y cuál transferencia', () => {
  const base = { mpPartyId: 'p-mp', mpTreasuryIds: ['t-mp'] }

  it('sin configurar: los medios de fábrica (por sus datos, no por el nombre)', () => {
    expect(mpCloseTargets({ ...base, methods: METHODS, configured: {} })).toEqual(TARGETS)
  })

  it('lo elegido en Importar › Mercado Pago manda', () => {
    expect(
      mpCloseTargets({
        ...base,
        methods: METHODS,
        configured: { qr: 'm-mp', transfer_in: 'm-mp' },
      }),
    ).toEqual({ qr: 'm-mp', transfer_in: 'm-mp' })
  })

  it('lo elegido que ya no está (o es cuenta corriente) no se usa', () => {
    expect(
      mpCloseTargets({
        ...base,
        methods: METHODS,
        configured: { qr: 'gone', transfer_in: 'm-cc' },
      }),
    ).toEqual(TARGETS)
  })

  it('la transferencia de fábrica que va al banco no es la de Mercado Pago', () => {
    const toBank = METHODS.map((m) =>
      m.id === 'm-tr' ? { ...m, kind: 'treasury', partyId: null, treasuryAccountId: 't-banco' } : m,
    )
    expect(mpCloseTargets({ ...base, methods: toBank, configured: {} }).transfer_in).toBeNull()
    const toWallet = METHODS.map((m) =>
      m.id === 'm-tr' ? { ...m, kind: 'treasury', partyId: null, treasuryAccountId: 't-mp' } : m,
    )
    expect(mpCloseTargets({ ...base, methods: toWallet, configured: {} }).transfer_in).toBe('m-tr')
  })

  it('sin esos medios, nada', () => {
    expect(mpCloseTargets({ ...base, methods: METHODS.slice(0, 1), configured: {} })).toEqual({
      qr: null,
      transfer_in: null,
    })
  })
})

// ─── Qué se completa y qué se dice ───────────────────────────────────────────

describe('lo que se completa y el resumen', () => {
  const day = ok(
    readMpDay(parseCsv(SETTLEMENT_CSV, ';'), { date: DAY, cutoffHour: 0, sasCuit: SAS }),
  )

  it('un importe por medio; dos cobros al mismo medio se suman', () => {
    expect(mpDayFills(day, TARGETS)).toEqual({
      fills: { 'm-qr': 300_000, 'm-tr': 700_000 },
      missing: [],
    })
    expect(mpDayFills(day, { qr: 'm-mp', transfer_in: 'm-mp' }).fills).toEqual({
      'm-mp': 1_000_000,
    })
  })

  it('si el cierre no tiene el medio, lo dice', () => {
    const fill = mpDayFills(day, { qr: null, transfer_in: 'm-tr' })
    expect(fill).toEqual({ fills: { 'm-tr': 700_000 }, missing: ['qr'] })
    expect(plain(describeMpDay(day, fill).notes[0] ?? '')).toBe(
      'Tu cierre no tiene un medio para los cobros con QR de Mercado Pago: no los completamos.',
    )
  })

  it('todo devuelto: el medio queda vacío', () => {
    const rows = release([
      payment('8001', '2026-10-07T12:00:00', '1000.00', 'qr'),
      refund('8001', '2026-10-07T12:10:00', '1000.00'),
    ])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(mpDayFills(r, TARGETS).fills).toEqual({ 'm-qr': null })
  })

  it('el resumen chico, con lo que conviene mirar', () => {
    const summary = describeMpDay(day, mpDayFills(day, TARGETS))
    expect(plain(summary.headline)).toBe(
      'Del archivo: 2 cobros con QR por $ 3.000 y 1 transferencia por $ 7.000 del 07/10. Revisalos antes de guardar.',
    )
    expect(summary.fillsSomething).toBe(true)
    expect(summary.notes.map(plain)).toEqual([
      'Ya restamos 1 devolución de cobros del mismo día ($ 12.000).',
      'Hubo una devolución de un cobro de otro día ($ 500): no la restamos.',
      'No sumamos 1 transferencia desde la CUIT de la SAS ($ 150.000): es plata tuya, no una venta.',
      '1 cobro del día ($ 2.000) no sabemos si es QR, Point o transferencia: no lo sumamos.',
    ])
  })

  it('sin QR ni transferencias ese día no cambia nada', () => {
    const rows = release([payment('9001', '2026-10-07T12:00:00', '1000.00', 'point')])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    const summary = describeMpDay(r, mpDayFills(r, TARGETS))
    expect(summary.fillsSomething).toBe(false)
    expect(plain(summary.headline)).toBe(
      'El archivo no trae cobros con QR ni transferencias del 07/10: no cambiamos nada.',
    )
  })

  it('con un solo canal', () => {
    const rows = release([payment('9101', '2026-10-07T12:00:00', '2500.75', 'transfer')])
    const r = ok(readMpDay(rows, { date: DAY, cutoffHour: 0, sasCuit: SAS }))
    expect(plain(describeMpDay(r, mpDayFills(r, TARGETS)).headline)).toBe(
      'Del archivo: ningún cobro con QR y 1 transferencia por $ 2.500,75 del 07/10. Revisalos antes de guardar.',
    )
  })
})
