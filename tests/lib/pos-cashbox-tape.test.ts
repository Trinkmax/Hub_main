import { describe, expect, it } from 'vitest'
import {
  buildTape,
  editLines,
  filterTape,
  openingLine,
  paymentExtras,
  paymentTitle,
  type TapeEntry,
  tapeSum,
  tenderedLine,
} from '@/lib/pos/cash/tape'
import type { PaymentEdit, Shift, ShiftSummary } from '@/lib/pos/cash/types'
import {
  at,
  NIGHT_SHIFT_ID,
  NOON_SHIFT_ID,
  pesos,
  sampleClosed,
  sampleFirst,
  sampleLive,
  sampleNightClosed,
  TIME_ZONE,
} from './pos-cashbox-samples'

/** `formatCentsShort` pega el signo al número con un espacio duro: así se escribe lo esperado. */
const nb = (text: string): string => text.replaceAll('$ ', '$ ')

function tapeOf(snapshot = sampleLive()) {
  return buildTape({
    shift: snapshot.shift,
    payments: snapshot.payments,
    movements: snapshot.live?.movements ?? [],
  })
}

const kinds = (entries: ReadonlyArray<TapeEntry>) => entries.map((entry) => entry.kind)

describe('la cinta del turno', () => {
  it('va de lo último a lo primero y termina donde se abrió el turno', () => {
    const { current } = tapeOf()
    const times = current.map((entry) => Date.parse(entry.at))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(current.at(-1)?.kind).toBe('opening')
    expect(current[0]).toMatchObject({ kind: 'payment', at: at('23:38') })
  })

  it('mezcla cobros y movimientos del cajón por hora', () => {
    const { current } = tapeOf()
    // 12 cobros (uno anulado) + 3 movimientos (uno anulado) + la apertura.
    expect(current).toHaveLength(16)
    expect(kinds(current).filter((kind) => kind === 'movement')).toHaveLength(3)
    const around = current.filter((entry) => entry.at >= at('21:25') && entry.at <= at('21:48'))
    expect(kinds(around)).toEqual(['payment', 'movement', 'payment'])
  })

  it('los cobros del mismo día que entraron a otro turno van aparte', () => {
    const { current, other } = tapeOf()
    expect(other).toHaveLength(4)
    expect(
      other.every((entry) => entry.kind === 'payment' && entry.payment.shift_id === NOON_SHIFT_ID),
    ).toBe(true)
    expect(
      current.every(
        (entry) => entry.kind !== 'payment' || entry.payment.shift_id === NIGHT_SHIFT_ID,
      ),
    ).toBe(true)
  })

  it('un turno cerrado lleva el cierre arriba de todo', () => {
    const { current } = tapeOf(sampleNightClosed())
    expect(current[0]?.kind).toBe('closing')
    expect(current.at(-1)?.kind).toBe('opening')
  })

  it('con la misma hora, el cierre queda arriba y la apertura abajo', () => {
    const closed = sampleClosed()
    const shift: Shift = {
      ...(closed.shift as Shift),
      opened_at: at('12:00'),
      closed_at: at('12:00'),
    }
    const [first] = closed.payments
    const payments = first ? [{ ...first, created_at: at('12:00'), shift_id: shift.id }] : []
    const { current } = buildTape({ shift, payments, movements: [] })
    expect(kinds(current)).toEqual(['closing', 'payment', 'opening'])
  })

  it('sin turno, no hay apertura ni «otro turno»', () => {
    const snapshot = sampleFirst()
    expect(tapeOf(snapshot)).toEqual({ current: [], other: [] })
    const loose = buildTape({ shift: null, payments: sampleLive().payments, movements: [] })
    expect(loose.other).toEqual([])
    expect(loose.current).toHaveLength(16)
  })
})

describe('tocar un medio deja solo esos', () => {
  it('«todo» no saca nada', () => {
    const { current } = tapeOf()
    expect(filterTape(current, 'all')).toHaveLength(current.length)
  })

  it('en efectivo quedan los cobros en efectivo, los movimientos y la apertura', () => {
    const cash = filterTape(tapeOf().current, 'cash')
    // 5 cobros en efectivo (uno anulado) + 3 movimientos + la apertura.
    expect(cash).toHaveLength(9)
    expect(kinds(cash).filter((kind) => kind === 'payment')).toHaveLength(5)
    expect(cash.at(-1)?.kind).toBe('opening')
  })

  it('el efectivo vigente más los movimientos da lo que tiene que haber en el cajón', () => {
    const snapshot = sampleLive()
    const live = snapshot.live as ShiftSummary
    let drawer = 0
    for (const entry of filterTape(tapeOf(snapshot).current, 'cash')) {
      if (entry.kind === 'opening') drawer += entry.shift.opening_float_cents
      if (entry.kind === 'payment' && entry.payment.status === 'ok') {
        drawer += entry.payment.amount_cents
      }
      if (entry.kind === 'movement' && !entry.movement.voided_at) {
        drawer += (entry.movement.kind === 'in' ? 1 : -1) * entry.movement.amount_cents
      }
    }
    expect(drawer).toBe(live.expected_cash_cents)
  })

  it('en los demás medios quedan solo los cobros de ese medio', () => {
    const qr = filterTape(tapeOf().current, 'qr')
    expect(qr).toHaveLength(3)
    expect(qr.every((entry) => entry.kind === 'payment' && entry.payment.method === 'qr')).toBe(
      true,
    )
    expect(filterTape(tapeOf().current, 'other')).toEqual([])
  })

  it('suma lo que se le cobró a la gente, sin los anulados', () => {
    const live = sampleLive().live as ShiftSummary
    const { current } = tapeOf()
    expect(tapeSum(current)).toEqual({ count: 11, cents: live.collected_cents })
    // QR: $ 67.200 + $ 6.700 de propina, $ 85.000 y $ 106.000 + $ 5.000 de propina.
    expect(tapeSum(filterTape(current, 'qr'))).toEqual({ count: 3, cents: pesos(269_900) })
    expect(tapeSum(filterTape(current, 'cash'))).toEqual({ count: 4, cents: pesos(138_000) })
  })
})

describe('lo que dice cada renglón', () => {
  it('nombra la mesa y de quién es', () => {
    expect(paymentTitle({ table_label: '8', alias: null, payer_label: null })).toEqual({
      title: 'Mesa 8',
      detail: null,
    })
    expect(paymentTitle({ table_label: '11', alias: 'Los Peralta', payer_label: null })).toEqual({
      title: 'Mesa 11',
      detail: 'Los Peralta',
    })
    expect(
      paymentTitle({ table_label: '5', alias: ' Sofi ', payer_label: 'Parte 2 de 4' }),
    ).toEqual({ title: 'Mesa 5', detail: 'Sofi · Parte 2 de 4' })
  })

  it('lo que no es una mesa del salón se llama por su nombre', () => {
    expect(paymentTitle({ table_label: null, alias: 'Delivery Juan', payer_label: null })).toEqual({
      title: 'Delivery Juan',
      detail: null,
    })
    expect(paymentTitle({ table_label: null, alias: null, payer_label: 'Parte 1 de 2' })).toEqual({
      title: 'Sin mesa',
      detail: 'Parte 1 de 2',
    })
    expect(paymentTitle({ table_label: null, alias: '  ', payer_label: null }).title).toBe(
      'Sin mesa',
    )
  })

  it('escribe la corrección como queda para siempre', () => {
    const edit: PaymentEdit = {
      field: 'method',
      old_value: 'transfer',
      new_value: 'cash',
      note: null,
      by_name: 'Juan',
      at: at('23:41'),
      after_close: false,
    }
    expect(editLines([edit], TIME_ZONE)).toEqual([
      'Corregido por Juan 23:41: Transferencia → Efectivo',
    ])
  })

  it('el medio y el recargo que se fue con él van en un solo renglón', () => {
    const mesa7 = sampleLive().payments.find((payment) => payment.table_label === '7')
    expect(editLines(mesa7?.edits ?? [], TIME_ZONE)).toEqual([
      nb('Corregido por Caro 23:12: Crédito → Efectivo · recargo $ 2.350 → $ 0'),
    ])
  })

  it('dos correcciones en momentos distintos son dos renglones, con su nota', () => {
    const edits: PaymentEdit[] = [
      {
        field: 'method',
        old_value: 'qr',
        new_value: 'debit',
        note: 'Pasó la tarjeta, no el QR',
        by_name: 'Caro',
        at: at('22:00'),
        after_close: false,
      },
      {
        field: 'invoice',
        old_value: 'true',
        new_value: 'false',
        note: null,
        by_name: 'Nacho',
        at: at('03:15'),
        after_close: true,
      },
    ]
    expect(editLines(edits, TIME_ZONE)).toEqual([
      'Corregido por Caro 22:00: QR → Débito · «Pasó la tarjeta, no el QR»',
      'Corregido por Nacho 03:15: con factura → sin factura (con el turno cerrado)',
    ])
  })

  it('anota la propina y el recargo que van adentro del monto', () => {
    const settings = sampleLive().settings.invoice_by_method
    expect(
      paymentExtras(
        { method: 'qr', tip_cents: pesos(5_000), surcharge_cents: 0, invoice: true },
        settings,
      ),
    ).toEqual([nb('Incluye $ 5.000 de propina')])
    expect(
      paymentExtras(
        { method: 'credit', tip_cents: 0, surcharge_cents: pesos(15_600), invoice: true },
        settings,
      ),
    ).toEqual([nb('Incluye $ 15.600 de recargo')])
  })

  it('la factura se anota solo cuando se sale de lo que el bar tiene puesto', () => {
    const settings = sampleLive().settings.invoice_by_method
    const cash = { method: 'cash' as const, tip_cents: 0, surcharge_cents: 0 }
    expect(paymentExtras({ ...cash, invoice: false }, settings)).toEqual([])
    expect(paymentExtras({ ...cash, invoice: true }, settings)).toEqual(['Con factura'])
    expect(paymentExtras({ ...cash, method: 'transfer', invoice: false }, settings)).toEqual([
      'Sin factura',
    ])
    // Sin ajustes cargados vale lo de fábrica: el efectivo no se factura.
    expect(paymentExtras({ ...cash, invoice: true }, null)).toEqual(['Con factura'])
  })

  it('dice con cuánto pagó solo si fue efectivo y no pagó justo', () => {
    expect(
      tenderedLine({
        method: 'cash',
        tendered_cents: pesos(40_000),
        change_cents: pesos(1_500),
      }),
    ).toBe(nb('Pagó con $ 40.000 · vuelto $ 1.500'))
    expect(tenderedLine({ method: 'cash', tendered_cents: null, change_cents: 0 })).toBeNull()
    expect(tenderedLine({ method: 'qr', tendered_cents: null, change_cents: 0 })).toBeNull()
  })

  it('cuenta cómo arrancó el turno', () => {
    expect(
      openingLine({
        opening_float_cents: pesos(15_000),
        opening_expected_cents: pesos(15_000),
        opened_by_name: 'Caro',
      }),
    ).toEqual({ text: 'Caro confirmó el cambio que dejó el turno anterior', differs: false })
    expect(
      openingLine({
        opening_float_cents: pesos(12_000),
        opening_expected_cents: pesos(15_000),
        opened_by_name: 'Caro',
      }),
    ).toEqual({
      text: nb('Caro contó $ 12.000: el turno anterior había dejado $ 15.000'),
      differs: true,
    })
    expect(
      openingLine({
        opening_float_cents: pesos(20_000),
        opening_expected_cents: null,
        opened_by_name: 'Nacho',
      }),
    ).toEqual({ text: 'Nacho abrió esta caja por primera vez', differs: false })
  })
})
