/**
 * «Mercado Pago contra tus cierres» (`lib/imports/ui/mp-insights.ts`): un día
 * por columna con lo que cobró Mercado Pago y lo que dice el cierre, y la
 * cuenta de lo cobrado contra lo que quedó. Un día sin cierre no es cero, y las
 * partes siempre suman lo cobrado.
 */

import { describe, expect, it } from 'vitest'
import {
  type MpProposal,
  mpCut,
  mpDays,
  mpDaysSummary,
  mpDayTitle,
} from '@/lib/imports/ui/mp-insights'

/** Los importes llevan un espacio duro después del «$». */
const plain = (text: string | undefined) => (text ?? '').replaceAll('\u00a0', ' ')

function cobro(
  date: string,
  detail: Record<string, number>,
  notes: MpProposal['summary']['notes'] = [],
  status: MpProposal['status'] = 'posted',
): MpProposal {
  return { status, summary: { kind: 'mp_collection', date, detail, notes } }
}

// El reporte del bar de ejemplo (07/10 – 08/10): dos canales el 08/10, sin cierre cargado.
const QR = cobro(
  '2026-10-08',
  {
    gross_cents: 12_960_000,
    net_cents: 12_744_728,
    commission_cents: 103_894,
    commission_vat_cents: 21_818,
    sirtac_cents: 11_800,
    sircupa_cents: 0,
    ley25413_cents: 77_760,
    close_cents: 0,
    difference_cents: 12_960_000,
  },
  ['missing_close'],
)
const TRANSFER = cobro(
  '2026-10-08',
  {
    gross_cents: 4_500_000,
    net_cents: 4_459_500,
    commission_cents: 0,
    commission_vat_cents: 0,
    sirtac_cents: 0,
    sircupa_cents: 13_500,
    ley25413_cents: 27_000,
    close_cents: 0,
    difference_cents: 4_500_000,
  },
  ['missing_close'],
)
/** Un día cargado a mano: la hoja queda salteada, sin detalle. */
const SKIPPED: MpProposal = {
  status: 'skipped',
  summary: { kind: 'mp_collection', date: '2026-10-07' },
}

describe('un día por columna', () => {
  it('suma los canales del mismo día y no inventa un cierre que falta', () => {
    const days = mpDays([QR, TRANSFER, SKIPPED])
    expect(days).toEqual([
      {
        date: '2026-10-08',
        label: 'jue 08/10',
        collectedCents: 17_460_000,
        closeCents: null,
        diffCents: null,
      },
    ])
    expect(mpDayTitle(days[0] as (typeof days)[number])).toBe('Jue 08/10')
  })

  it('con cierre: la diferencia es lo cobrado menos lo anotado', () => {
    const days = mpDays([
      cobro('2026-10-10', { gross_cents: 500_000, close_cents: 480_000 }),
      cobro('2026-10-09', { gross_cents: 300_000, close_cents: 300_000 }),
    ])
    expect(days.map((d) => [d.date, d.closeCents, d.diffCents])).toEqual([
      ['2026-10-09', 300_000, 0],
      ['2026-10-10', 480_000, 20_000],
    ])
  })

  it('un cierre en cero que SÍ está cargado es un cero de verdad', () => {
    const [day] = mpDays([cobro('2026-10-09', { gross_cents: 300_000, close_cents: 0 })])
    expect(day).toMatchObject({ closeCents: 0, diffCents: 300_000 })
  })

  it('ignora lo que no es un cobro, lo que no trae plata y las fechas raras', () => {
    expect(
      mpDays([
        { status: 'posted', summary: { kind: 'mp_yield', date: '2026-10-08' } },
        cobro('2026-10-08', { gross_cents: 0 }),
        cobro('no-es-fecha', { gross_cents: 100 }),
      ]),
    ).toEqual([])
    expect(mpDays([])).toEqual([])
  })
})

describe('el título afirma', () => {
  it('todos sin cierre', () => {
    const one = mpDaysSummary(mpDays([QR]))
    expect(one.title).toBe('Falta el cierre del jue 08/10')
    expect(one.missing).toHaveLength(1)
    const many = mpDaysSummary(
      mpDays([
        QR,
        cobro('2026-10-09', { gross_cents: 1 }, ['missing_close']),
        cobro('2026-10-10', { gross_cents: 1 }, ['missing_close']),
      ]),
    )
    expect(many.title).toBe('Falta el cierre de los 3 días de este reporte')
  })

  it('una diferencia de más de $ 1.000 se nombra; hasta $ 1.000, coincide', () => {
    const off = mpDaysSummary(
      mpDays([
        cobro('2026-10-09', { gross_cents: 5_000_000, close_cents: 4_800_000 }),
        cobro('2026-10-10', { gross_cents: 300_000, close_cents: 300_000 }),
      ]),
    )
    expect(off).toMatchObject({ off: 1, matched: 1 })
    expect(plain(off.title)).toBe('En 1 día la diferencia pasa de $ 1.000')
    const ok = mpDaysSummary(
      mpDays([
        cobro('2026-10-09', { gross_cents: 5_000_000, close_cents: 4_900_000 }),
        cobro('2026-10-10', { gross_cents: 300_000, close_cents: 300_000 }),
      ]),
    )
    expect(ok).toMatchObject({ off: 0, matched: 2 })
    expect(ok.title).toBe('Mercado Pago coincide con tus cierres en los 2 días')
  })

  it('con algunos sin cierre: «en 1 de 2 días»', () => {
    const mixed = mpDaysSummary(
      mpDays([QR, cobro('2026-10-09', { gross_cents: 300_000, close_cents: 300_000 })]),
    )
    expect(mixed.title).toBe('Mercado Pago coincide con tus cierres en 1 de 2 días')
  })

  it('sin cobros', () => {
    expect(mpDaysSummary([])).toMatchObject({ title: 'Este reporte no trae cobros', matched: 0 })
  })
})

describe('de lo cobrado, cuánto quedó', () => {
  it('las partes suman lo cobrado y lo que no se puede nombrar va a «Otros descuentos»', () => {
    const cut = mpCut([QR, TRANSFER, SKIPPED])
    if (!cut) throw new Error('sin cuenta')
    expect(cut.grossCents).toBe(17_460_000)
    expect(cut.netCents).toBe(17_204_228)
    expect(cut.parts.reduce((acc, p) => acc + p.cents, 0)).toBe(cut.grossCents)
    expect(cut.parts.map((p) => p.key)).toEqual([
      'net',
      'commission',
      'commission_vat',
      'retained',
      'bank_tax',
    ])
    expect(cut.parts.find((p) => p.key === 'retained')?.cents).toBe(25_300)
    expect(cut.perHundredCents).toBe(9854)
    expect(plain(cut.title)).toBe(
      'De cada $ 100 que cobraste por Mercado Pago, te quedaron $ 98,54',
    )
    expect(plain(cut.sentence)).toMatch(/^Cobraste \$ 174\.600 y te depositaron \$ 172\.042\./)
  })

  it('un descuento sin nombre aparece como «Otros descuentos»', () => {
    const cut = mpCut([cobro('2026-10-09', { gross_cents: 1_000_000, net_cents: 900_000 })])
    expect(cut?.parts).toEqual([
      { key: 'net', label: 'Te depositaron', cents: 900_000 },
      { key: 'other', label: 'Otros descuentos', cents: 100_000 },
    ])
  })

  it('importes de nueve cifras, y los negativos se toman en valor absoluto', () => {
    const cut = mpCut([
      cobro('2026-10-09', {
        gross_cents: 99_999_999_999,
        net_cents: 90_000_000_000,
        commission_cents: -9_999_999_999,
      }),
    ])
    expect(cut?.parts.map((p) => p.cents)).toEqual([90_000_000_000, 9_999_999_999])
    expect(plain(cut?.title)).toMatch(/te quedaron \$ 90,00$/)
  })

  it('sin cobros no hay cuenta (el panel no se dibuja)', () => {
    expect(mpCut([])).toBeNull()
    expect(mpCut([SKIPPED])).toBeNull()
  })

  it('no dice «ganancia» ni «en negro»', () => {
    const cut = mpCut([QR])
    expect(`${cut?.title} ${cut?.sentence}`).not.toMatch(/ganancia|ganaste|en negro|en blanco/i)
  })
})
