import { describe, expect, it } from 'vitest'
import {
  type IvaLike,
  ivaHero,
  ivaNothingLoaded,
  ivaTrendRows,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva-story'

/** La solapa IVA en palabras (puro): qué dice la posición de cada mes y cómo viene mes a mes. */

const plain = (text: string | null | undefined) => (text ?? '').replaceAll(' ', ' ')

function position(over: Partial<IvaLike> & { debit?: number; credit?: number } = {}): IvaLike {
  const { debit = 0, credit = 0, ...rest } = over
  return {
    applies: true,
    status: 'open',
    toPayCents: 0,
    inFavorCents: 0,
    isZero: false,
    debitFiscal: { totalCents: debit },
    creditFiscal: { totalCents: credit },
    technicalBalancePrevCents: 0,
    freeBalancePrevCents: 0,
    perceptionsCents: 0,
    withholdingsCents: 0,
    ...rest,
  }
}

/** El bar de ejemplo en septiembre: $ 5.223.234,04 de débito, $ 1.106.172,00 de crédito. */
const SEPTEMBER = position({
  debit: 522_323_404,
  credit: 110_617_200,
  toPayCents: 411_706_204,
  status: 'closed',
})

/** HUB en octubre: una sola compra con Factura A y ninguna venta facturada. */
const HUB_OCTOBER = position({ debit: 0, credit: 2_100_000, inFavorCents: 2_100_000 })

describe('el número del héroe', () => {
  it('a pagar: el número, su rótulo y la oración', () => {
    const hero = ivaHero(SEPTEMBER, '2026-09')
    expect(hero).toMatchObject({
      kind: 'to_pay',
      cents: 411_706_204,
      label: 'IVA de septiembre · a pagar',
      brief: 'A pagarle a ARCA.',
    })
    expect(plain(hero.short)).toBe('$ 4.117.062 a pagar')
  })

  it('a favor (HUB hoy): sin ventas con factura no afirma que «cobraste» menos', () => {
    const hero = ivaHero(HUB_OCTOBER, '2026-10')
    expect(hero).toMatchObject({
      kind: 'in_favor',
      cents: 2_100_000,
      label: 'IVA de octubre · a favor',
      brief: 'A favor por ahora: faltan las ventas con factura.',
    })
    expect(hero.sentence).toContain('octubre todavía no tiene ventas con factura cargadas')
    expect(hero.sentence).not.toContain('cobraste')
  })

  it('a favor con ventas: la diferencia queda para el mes que viene', () => {
    const hero = ivaHero(
      position({ debit: 400_000, credit: 520_000, inFavorCents: 120_000 }),
      '2026-10',
    )
    expect(hero).toMatchObject({ kind: 'in_favor', brief: 'Te queda a favor.' })
    expect(hero.sentence).toContain('La diferencia queda para el mes que viene')
  })

  it('en cero NO devuelve número: nunca «$ 0»', () => {
    const empty = ivaHero(position({ isZero: true }), '2026-10')
    expect(empty.cents).toBeNull()
    expect(empty.kind).toBe('zero')
    expect(empty.kind === 'zero' ? empty.title : '').toBe('Octubre todavía no tiene IVA')
    expect(ivaNothingLoaded(position({ isZero: true }))).toBe(true)

    // Hubo ventas y compras, y se compensaron justo: no es «todavía no hay nada».
    const even = ivaHero(position({ debit: 500, credit: 500, isZero: false }), '2026-09')
    expect(even.cents).toBeNull()
    expect(even.kind === 'zero' ? even.title : '').toBe(
      'Septiembre no tiene IVA para pagar ni a favor',
    )
  })

  it('el bar que no liquida IVA', () => {
    const hero = ivaHero(position({ applies: false }), '2026-10')
    expect(hero).toMatchObject({ kind: 'not_registered', cents: null })
    expect(hero.kind === 'not_registered' ? hero.title : '').toBe('El bar no liquida IVA')
  })
})

describe('el IVA mes a mes', () => {
  const months = [
    {
      month: '2026-10',
      position: position({ debit: 300_000, credit: 210_000, toPayCents: 90_000 }),
    },
    { month: '2026-09', position: SEPTEMBER },
  ]

  it('un renglón por mes, en orden, con su estado en palabras', () => {
    const rows = ivaTrendRows(months)
    expect(rows.map((r) => [r.label, r.stateWord, plain(r.text)])).toEqual([
      ['Septiembre', 'cerrado', '$ 4.117.062 a pagar'],
      ['Octubre', 'estimado', '$ 900 a pagar'],
    ])
  })

  it('un mes a favor va sin importe a pagar y lo dice con palabras', () => {
    const [row] = ivaTrendRows([{ month: '2026-10', position: HUB_OCTOBER }])
    expect(row?.toPayCents).toBe(0)
    expect(plain(row?.text)).toBe('a favor $ 21.000')
  })

  it('los meses que no se pudieron leer o sin IVA no entran', () => {
    expect(
      ivaTrendRows([
        { month: '2026-08', position: null },
        { month: '2026-09', position: position({ applies: false }) },
      ]),
    ).toEqual([])
  })
})
