import { describe, expect, it } from 'vitest'
import {
  type PosCloseDay,
  type PosCloseMethod,
  posCloseChanges,
  posCloseFill,
  posCloseWords,
} from '@/lib/accounting/pos-close'
import { parsePosCloseDay } from '@/lib/accounting/queries/projection'

/**
 * El cierre del día precargado con lo que cobró el punto de venta. Acá se fija lo que no puede fallar
 * sin que nadie lo note: que cada peso vaya al medio que corresponde (por su clave, nunca por el
 * nombre), que nada se invente (un medio sin par se dice, no se reparte) y que las señas y las propinas
 * no entren como venta cobrada hoy.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)
/** Pesos → centavos. */
const p = (pesos: number) => pesos * 100

/** Los medios de fábrica de Administración, como los deja la puesta en marcha. */
const METHODS: PosCloseMethod[] = [
  { id: 'm-efectivo', name: 'Efectivo', systemKey: 'cash', channel: 'salon' },
  { id: 'm-transf', name: 'Transferencia', systemKey: 'transfer', channel: 'salon' },
  { id: 'm-qr', name: 'QR Mercado Pago', systemKey: 'qr_mp', channel: 'salon' },
  { id: 'm-debito', name: 'Débito', systemKey: 'debit', channel: 'salon' },
  { id: 'm-credito', name: 'Crédito', systemKey: 'credit', channel: 'salon' },
  { id: 'm-pedidosya', name: 'PedidosYa', systemKey: 'pedidosya', channel: 'delivery' },
  { id: 'm-cuenta', name: 'Cuenta corriente', systemKey: 'customer_account', channel: 'events' },
]

const day = (over: Partial<PosCloseDay> = {}): PosCloseDay => ({
  day: '2026-11-13',
  byMethod: {},
  depositCents: 0,
  tipCents: 0,
  tables: 0,
  ...over,
})

describe('posCloseFill: cada peso a su medio', () => {
  it('reparte lo cobrado por la clave de cada medio', () => {
    const fill = posCloseFill(
      day({
        byMethod: {
          cash: p(47_000),
          transfer: p(12_000),
          qr: p(14_800),
          debit: p(20_000),
          credit: p(12_320),
        },
        tables: 4,
      }),
      METHODS,
    )
    expect(fill?.fills).toEqual({
      'm-efectivo': p(47_000),
      'm-transf': p(12_000),
      'm-qr': p(14_800),
      'm-debito': p(20_000),
      'm-credito': p(12_320),
    })
    expect(fill).toMatchObject({
      unmatched: [],
      chargedCents: p(106_120),
      filledCents: p(106_120),
      tables: 4,
    })
  })

  it('el par se busca por la clave, no por el nombre: el bar puede haber renombrado el medio', () => {
    const renamed = METHODS.map((m) => (m.systemKey === 'qr_mp' ? { ...m, name: 'Código QR' } : m))
    const fill = posCloseFill(day({ byMethod: { qr: p(5_000) } }), renamed)
    expect(fill?.fills).toEqual({ 'm-qr': p(5_000) })
  })

  it('«Otro» no tiene par: se dice cuánto es y no se le inventa un destino', () => {
    const fill = posCloseFill(day({ byMethod: { cash: p(10_000), other: p(3_500) } }), METHODS)
    expect(fill?.fills).toEqual({ 'm-efectivo': p(10_000) })
    expect(fill?.unmatched).toEqual([{ method: 'other', cents: p(3_500) }])
    expect(fill).toMatchObject({ chargedCents: p(13_500), filledCents: p(10_000) })
  })

  it('un medio que el bar desactivó en Ajustes (no llega acá) tampoco se rellena', () => {
    const withoutDebit = METHODS.filter((m) => m.systemKey !== 'debit')
    const fill = posCloseFill(day({ byMethod: { debit: p(8_000), cash: p(1_000) } }), withoutDebit)
    expect(fill?.fills).toEqual({ 'm-efectivo': p(1_000) })
    expect(fill?.unmatched).toEqual([{ method: 'debit', cents: p(8_000) }])
  })

  it('solo mira los medios del salón: un medio de delivery con esa clave no cuenta', () => {
    const odd = [
      { id: 'm-raro', name: 'Efectivo delivery', systemKey: 'cash', channel: 'delivery' },
      ...METHODS,
    ]
    const fill = posCloseFill(day({ byMethod: { cash: p(2_000) } }), odd)
    expect(fill?.fills).toEqual({ 'm-efectivo': p(2_000) })
  })

  it('un día sin nada cobrado no precarga nada', () => {
    expect(posCloseFill(day(), METHODS)).toBeNull()
    expect(posCloseFill(day({ byMethod: { cash: 0 }, depositCents: p(5_000) }), METHODS)).toBeNull()
  })

  it('las señas y las propinas viajan aparte: no están adentro de ningún medio', () => {
    const fill = posCloseFill(
      day({ byMethod: { cash: p(30_000) }, depositCents: p(20_000), tipCents: p(3_000) }),
      METHODS,
    )
    expect(fill?.fills).toEqual({ 'm-efectivo': p(30_000) })
    expect(fill).toMatchObject({
      depositCents: p(20_000),
      tipCents: p(3_000),
      filledCents: p(30_000),
    })
  })
})

describe('posCloseWords: lo que dice la pantalla', () => {
  it('afirma de dónde salen los números y cuántas mesas fueron', () => {
    const fill = posCloseFill(day({ byMethod: { cash: p(106_120) }, tables: 4 }), METHODS)
    if (!fill) throw new Error('tenía que haber algo')
    const words = posCloseWords(fill)
    expect(words.headline).toBe(
      `Precargado con lo que cobró el punto de venta: $${NB}106.120 en 4 mesas.`,
    )
    expect(words.notes).toEqual([])
    const one = posCloseFill(day({ byMethod: { cash: p(1_000) }, tables: 1 }), METHODS)
    expect(one ? posCloseWords(one).headline : '').toContain('en 1 mesa.')
  })

  it('dice lo que quedó afuera a propósito: un medio sin par, las señas y las propinas', () => {
    const fill = posCloseFill(
      day({
        byMethod: { cash: p(10_000), other: p(3_500) },
        depositCents: p(20_000),
        tipCents: p(1_200),
        tables: 2,
      }),
      METHODS,
    )
    if (!fill) throw new Error('tenía que haber algo')
    expect(posCloseWords(fill).notes).toEqual([
      `Lo cobrado por «Otro» ($${NB}3.500) no tiene un medio en este cierre: cargalo a mano donde corresponda.`,
      `Se descontaron $${NB}20.000 de señas que ya se habían cobrado: no están en estos importes.`,
      `Las propinas ($${NB}1.200) no son venta: no están incluidas.`,
    ])
  })

  it('si ningún medio tiene par, no dice «precargado»', () => {
    const fill = posCloseFill(day({ byMethod: { other: p(9_000) }, tables: 1 }), METHODS)
    if (!fill) throw new Error('tenía que haber algo')
    expect(posCloseWords(fill).headline).toBe(
      `El punto de venta cobró $${NB}9.000 en 1 mesa, pero ningún medio tiene su par en este cierre.`,
    )
  })
})

describe('posCloseChanges: antes de pisar lo que escribió alguien, se pregunta', () => {
  const fills = { 'm-efectivo': p(47_000), 'm-debito': p(20_000) }

  it('un medio vacío no es un cambio: no hay nada que perder', () => {
    expect(posCloseChanges(fills, {})).toEqual([])
    expect(posCloseChanges(fills, { 'm-efectivo': null })).toEqual([])
  })

  it('el mismo importe tampoco', () => {
    expect(posCloseChanges(fills, { 'm-efectivo': p(47_000), 'm-debito': p(20_000) })).toEqual([])
  })

  it('otro importe sí, con lo que había y lo que vendría', () => {
    expect(posCloseChanges(fills, { 'm-efectivo': p(50_000), 'm-qr': p(1_000) })).toEqual([
      { id: 'm-efectivo', from: p(50_000), to: p(47_000) },
    ])
    // Un cero escrito a mano es un importe: también se pregunta.
    expect(posCloseChanges(fills, { 'm-debito': 0 })).toEqual([
      { id: 'm-debito', from: 0, to: p(20_000) },
    ])
  })
})

describe('lo que llega de pos_sales_days para el cierre', () => {
  it('trae los medios, las señas, las propinas y las mesas', () => {
    expect(
      parsePosCloseDay({
        day: '2026-11-13',
        by_method: { cash: 4_700_000, credit: '1232000' },
        deposit_cents: 250_000,
        tip_cents: '120000',
        tables: 3,
      }),
    ).toEqual({
      day: '2026-11-13',
      byMethod: { cash: 4_700_000, credit: 1_232_000 },
      depositCents: 250_000,
      tipCents: 120_000,
      tables: 3,
    })
    expect(parsePosCloseDay({ tables: 3 })).toBeNull()
  })
})
