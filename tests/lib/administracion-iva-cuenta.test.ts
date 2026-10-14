import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type IvaLike,
  ivaCoverBar,
  ivaHero,
  ivaNothingLoaded,
  ivaOneSidedSentence,
  ivaSimpleMath,
  ivaTrendRows,
  ivaTrendTitle,
} from '@/app/(manager)/[tenantSlug]/administracion/libros/_lib/iva-story'

/**
 * «El IVA del mes» contado para un socio (puro): la cuenta simple, el número
 * del héroe, la barra y «mes a mes». La regla de fondo: la barra y la cuenta
 * solo se dibujan si cierran al centavo con lo que muestra la posición; si no,
 * va la cascada de la contadora y nada más.
 */

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

describe('la cuenta simple del IVA', () => {
  it('cierra con «a pagar − a favor» y dice cada renglón', () => {
    expect(ivaSimpleMath(SEPTEMBER)).toEqual({
      debit: 522_323_404,
      credit: 110_617_200,
      carried: 0,
      withheld: 0,
      result: 411_706_204,
      wholePesos: true,
    })
  })

  it('suma lo que venía de antes y lo que ya te cobraron', () => {
    const p = position({
      debit: 1_000_000,
      credit: 300_000,
      technicalBalancePrevCents: 50_000,
      freeBalancePrevCents: 20_000,
      perceptionsCents: 30_000,
      withholdingsCents: 10_000,
      toPayCents: 590_000,
    })
    expect(ivaSimpleMath(p)).toMatchObject({ carried: 70_000, withheld: 40_000, result: 590_000 })
  })

  it('si no cierra con el resultado que se muestra, no hay cuenta', () => {
    expect(ivaSimpleMath(position({ debit: 1_000_000, credit: 300_000, toPayCents: 1 }))).toBeNull()
  })

  it('avisa cuando redondeando a pesos la suma a la vista no da el resultado', () => {
    // 100,50 − 0,49 = 100,01 → a la vista sería 101 − 0 = 101, pero el resultado se lee 100.
    const p = position({ debit: 10_050, credit: 49, toPayCents: 10_001 })
    expect(ivaSimpleMath(p)?.wholePesos).toBe(false)
  })

  it('es la misma guarda que usa el Resumen (si allá cambia, hay que mirar acá)', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(manager)/[tenantSlug]/administracion/_resumen/iva-block.tsx'),
      'utf8',
    )
    expect(source).toContain('const result = debit - credit - carried - withheld')
    expect(source).toContain(
      'if (result !== position.toPayCents - position.inFavorCents) return null',
    )
    expect(source).toContain('position.technicalBalancePrevCents + position.freeBalancePrevCents')
    expect(source).toContain('position.perceptionsCents + position.withholdingsCents')
  })
})

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

describe('la barra «lo que cobraste / lo que ya tenías cubierto / lo que falta»', () => {
  it('a pagar: los tramos suman lo que cobraste de IVA', () => {
    const p = position({
      debit: 1_000_000,
      credit: 300_000,
      technicalBalancePrevCents: 70_000,
      perceptionsCents: 40_000,
      toPayCents: 590_000,
    })
    const bar = ivaCoverBar(p)
    expect(bar?.kind).toBe('to_pay')
    expect(bar?.segments.map((s) => [s.key, s.cents])).toEqual([
      ['credit', 300_000],
      ['withheld', 40_000],
      ['carried', 70_000],
      ['to_pay', 590_000],
    ])
    expect(bar?.segments.reduce((sum, s) => sum + s.cents, 0)).toBe(1_000_000)
    expect(bar?.totalCents).toBe(1_000_000)
    expect(plain(bar?.title)).toBe('Cobraste $ 10.000 de IVA y ya tenías cubiertos $ 4.100')
    expect(plain(bar?.sentence)).toBe('La diferencia, $ 5.900, es lo que le pasás a ARCA.')
  })

  it('el ejemplo: los rótulos son los del Resumen y lo que es cero no va a la barra', () => {
    const bar = ivaCoverBar(SEPTEMBER)
    expect(bar?.segments.map((s) => s.label)).toEqual([
      'IVA de tus compras con Factura A',
      'A pagar',
    ])
    expect(bar?.totalLabel).toBe('IVA de lo que vendiste con factura')
  })

  it('a favor: la barra entera es lo que ya tenías pagado', () => {
    const p = position({ debit: 400_000, credit: 520_000, inFavorCents: 120_000 })
    const bar = ivaCoverBar(p)
    expect(bar?.kind).toBe('in_favor')
    expect(bar?.segments.map((s) => [s.label, s.cents])).toEqual([
      ['Cubre el IVA de lo que vendiste con factura', 400_000],
      ['Te queda a favor', 120_000],
    ])
    expect(bar?.segments.reduce((sum, s) => sum + s.cents, 0)).toBe(520_000)
    expect(bar?.title).toBe('Tenías más IVA pagado del que cobraste')
  })

  it('no se dibuja si la cuenta no cierra', () => {
    expect(ivaCoverBar(position({ debit: 1_000_000, credit: 300_000, toPayCents: 1 }))).toBeNull()
  })

  it('no se dibuja si algún tramo da negativo', () => {
    // Un crédito fiscal negativo (más notas de crédito que facturas en el mes).
    const p = position({ debit: 1_000_000, credit: -50_000, toPayCents: 1_050_000 })
    expect(ivaSimpleMath(p)).not.toBeNull()
    expect(ivaCoverBar(p)).toBeNull()
  })

  it('no se dibuja si un lado es cero (una barra de un solo tramo no es un gráfico)', () => {
    expect(ivaCoverBar(HUB_OCTOBER)).toBeNull()
    expect(ivaOneSidedSentence(HUB_OCTOBER, '2026-10')).toBe(
      'Octubre todavía no tiene ventas con factura: todo el IVA de tus compras con Factura A queda a favor.',
    )
    const onlySales = position({ debit: 800_000, toPayCents: 800_000 })
    expect(ivaCoverBar(onlySales)).toBeNull()
    expect(ivaOneSidedSentence(onlySales, '2026-10')).toMatch(/todo el IVA .* es a pagar\.$/)
  })

  it('en cero, o si el bar no liquida IVA, tampoco', () => {
    expect(ivaCoverBar(position({ isZero: true }))).toBeNull()
    expect(
      ivaCoverBar(position({ applies: false, debit: 100, credit: 50, toPayCents: 50 })),
    ).toBeNull()
    expect(ivaOneSidedSentence(position({ isZero: true }), '2026-10')).toBeNull()
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

  it('el título habla de los dos últimos meses y dice qué es estimado', () => {
    const rows = ivaTrendRows(months)
    expect(plain(ivaTrendTitle(rows))).toBe(
      'Septiembre: $ 4.117.062 a pagar. Octubre viene en $ 900 (estimado).',
    )
    expect(ivaTrendTitle([])).toBeNull()
  })
})
