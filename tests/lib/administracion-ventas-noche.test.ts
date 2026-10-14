import { describe, expect, it } from 'vitest'
import {
  cashTitle,
  cellAmount,
  commissionGaps,
  joinNames,
  nightSentence,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/almanac'
import { closeTicketProps } from '@/app/(manager)/[tenantSlug]/administracion/ventas/cierre/_lib/close-ticket-props'
import type { PostingCatalog } from '@/lib/accounting/context'

/**
 * La noche elegida: lo que se muestra al lado del almanaque. Acá se prueba lo
 * propio de Ventas (el puente entre lo cargado y el número del casillero, el
 * título de «Ventas contra caja», el aviso de comisiones sin cargar y una
 * noche con dos turnos). El ticket de un cierre guardado (`closeTicketProps`)
 * tiene sus tests en `administracion-cierre-ticket-guardado`.
 */

/** El espacio duro que `lib/money` pone entre el «$» y el número. */
const NB = String.fromCharCode(160)

describe('nightSentence: de lo que se cargó al número del almanaque', () => {
  it('dice cuánto se quedan las tarjetas y las apps, y con cuánto cuenta la noche', () => {
    expect(nightSentence({ loadedCents: 120_074_600, netCents: 113_802_900 })).toBe(
      `Sacando lo que se quedan las tarjetas y las apps (unos $${NB}62.717, estimado), cuenta $${NB}1.138.029 para el mes: es el número del almanaque.`,
    )
  })

  it('sin comisión estimada no hay nada que explicar', () => {
    expect(nightSentence({ loadedCents: 50_000_000, netCents: 50_000_000 })).toBeNull()
    expect(nightSentence({ loadedCents: 0, netCents: 0 })).toBeNull()
  })

  it('si la cuenta no cierra (neto mayor a lo cargado) no inventa una oración', () => {
    expect(nightSentence({ loadedCents: 100, netCents: 200 })).toBeNull()
    expect(nightSentence({ loadedCents: Number.NaN, netCents: 200 })).toBeNull()
  })

  it('una noche de nueve cifras', () => {
    const sentence = nightSentence({ loadedCents: 12_345_678_900, netCents: 12_000_000_000 })
    expect(sentence).toContain(`$${NB}3.456.789`)
    expect(sentence).toContain(`$${NB}120.000.000`)
  })
})

describe('una noche con dos turnos', () => {
  const turno = (shift: string, cents: number) => ({
    kind: 'sales_close' as const,
    accountingDate: '2026-10-10',
    shift,
    lines: [
      {
        id: `l-${shift}`,
        lineNo: 1,
        role: 'treasury',
        side: 'debit' as const,
        amountCents: cents,
        partyId: null,
        partyName: null,
        dueDate: null,
        treasuryAccountId: 'caja',
        treasuryName: 'Caja',
        salesMethodId: 'efectivo',
        salesMethodName: 'Efectivo',
        memo: null,
      },
    ],
    entry: null,
  })

  it('el ticket suma los dos turnos en un solo papel, y la noche cuenta la suma', () => {
    const closes = [
      { id: 'a', seq: 1, shift: 'mediodía', totalCents: 40_000_000 },
      { id: 'b', seq: 2, shift: 'noche', totalCents: 90_000_000 },
    ]
    const loadedCents = closes.reduce((sum, close) => sum + close.totalCents, 0)
    const ticket = closeTicketProps(
      // Lo que devuelve `getDocument` de cada turno.
      closes.map((close) => turno(close.shift, close.totalCents)) as never,
      { today: '2026-10-13', arrivals: true },
    )
    expect(ticket.soldCents).toBe(loadedCents)
    expect(ticket.shift).toBe('2 turnos')
    expect(ticket.lines).toHaveLength(1)
    expect(ticket.lines[0]?.cents).toBe(130_000_000)
    // Un cierre guardado es un papel quieto.
    expect(ticket.still).toBe(true)
    // El casillero muestra la venta neta de la noche entera.
    expect(cellAmount(loadedCents)).toBe(`$${NB}1.300.000`)
    expect(nightSentence({ loadedCents, netCents: 128_000_000 })).toContain(`$${NB}20.000`)
  })
})

describe('cashTitle: el título de «Ventas contra caja», que afirma', () => {
  it('sin ninguna noche anotada', () => {
    expect(cashTitle({ comparedDays: 0, diffCents: 0 })).toBe(
      'Todavía no anotaste lo que entró ninguna noche',
    )
  })

  it('falta, sobra o coincide', () => {
    expect(cashTitle({ comparedDays: 8, diffCents: -1_240_000 })).toBe(
      `En 8 noches anotadas, faltan $${NB}12.400`,
    )
    expect(cashTitle({ comparedDays: 8, diffCents: 300_000 })).toBe(
      `En 8 noches anotadas, sobran $${NB}3.000`,
    )
    expect(cashTitle({ comparedDays: 8, diffCents: 0 })).toBe('En 8 noches anotadas, coincide')
  })

  it('una sola noche va en singular, y una diferencia con centavos no se redondea', () => {
    expect(cashTitle({ comparedDays: 1, diffCents: -50 })).toBe(
      `En 1 noche anotada, faltan $${NB}0,50`,
    )
  })
})

describe('commissionGaps: los medios que se cuentan enteros', () => {
  type Catalog = Pick<PostingCatalog, 'methods' | 'parties'>
  const method = (name: string, partyId: string | null, over: object = {}) =>
    ({ id: name, name, kind: 'receivable', partyId, active: true, ...over }) as never
  const payer = (id: string, commissionBp: number | null) =>
    ({ id, rates: { commissionBp } }) as never

  it('nombra los que pagan después y no tienen la comisión cargada', () => {
    const catalog: Catalog = {
      methods: [
        method('Efectivo', null, { kind: 'treasury' }),
        method('QR', 'mp', { kind: 'settled_now' }),
        method('Crédito', 'posnet'),
        method('PedidosYa', 'pya'),
        method('Rappi', 'rappi'),
        method('Uber Eats', 'uber'),
        method('Mercado Pago Delivery', 'mpd'),
      ],
      parties: [
        payer('mp', null),
        payer('posnet', 320),
        payer('pya', 2500),
        payer('rappi', null),
        payer('uber', null),
        payer('mpd', null),
      ],
    }
    expect(commissionGaps(catalog)).toEqual({
      names: ['Rappi', 'Uber Eats', 'Mercado Pago Delivery'],
      sentence:
        '3 medios no tienen la comisión cargada (Rappi, Uber Eats y Mercado Pago Delivery): por ahora se cuentan enteros.',
    })
  })

  it('uno solo va en singular; ninguno, nada', () => {
    const one: Catalog = { methods: [method('Rappi', 'rappi')], parties: [payer('rappi', null)] }
    expect(commissionGaps(one)?.sentence).toBe(
      '1 medio no tiene la comisión cargada (Rappi): por ahora se cuenta entero.',
    )
    const none: Catalog = { methods: [method('Rappi', 'rappi')], parties: [payer('rappi', 0)] }
    expect(commissionGaps(none)).toBeNull()
    expect(commissionGaps({ methods: [], parties: [] })).toBeNull()
  })

  it('un medio desactivado no cuenta, y con muchos no arma una lista interminable', () => {
    const names = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis']
    const many: Catalog = {
      methods: [...names.map((n) => method(n, n)), method('Viejo', 'viejo', { active: false })],
      parties: [...names.map((n) => payer(n, null)), payer('viejo', null)],
    }
    const gaps = commissionGaps(many)
    expect(gaps?.names).toEqual(names)
    expect(gaps?.sentence).toBe(
      '6 medios no tienen la comisión cargada (Uno, Dos, Tres y 3 más): por ahora se cuentan enteros.',
    )
  })
})

describe('joinNames', () => {
  it('con «y» antes del último', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['a'])).toBe('a')
    expect(joinNames(['a', 'b'])).toBe('a y b')
    expect(joinNames(['a', 'b', 'c'])).toBe('a, b y c')
  })
})
