// @vitest-environment node
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BalanceArea } from '@/components/administracion/charts/balance-area'
import { CloseStrip, type CloseStripDay } from '@/components/administracion/charts/close-strip'
import { DayBars, type DayBarsDay, DayBarsTable } from '@/components/administracion/charts/day-bars'
import { DueStrip } from '@/components/administracion/charts/due-strip'
import { InOutBars, InOutBarsTable } from '@/components/administracion/charts/in-out-bars'
import { Meter } from '@/components/administracion/charts/meter'
import {
  OTHERS_SWATCH,
  SERIES_SWATCHES,
  seriesSwatch,
} from '@/components/administracion/charts/palette'
import { RankBars } from '@/components/administracion/charts/rank-bars'
import {
  compactCents,
  compactCentsFine,
  labelIndexes,
  linePaths,
  niceDomain,
  niceMax,
  niceStep,
  pct,
  percentLabel,
  round2,
  sharePercents,
  slotEdge,
  slotX,
  stepAreaPath,
  stepLinePath,
  ticks,
  valueY,
} from '@/components/administracion/charts/scale'
import { SplitBar } from '@/components/administracion/charts/split-bar'
import { TargetRace } from '@/components/administracion/charts/target-race'
import { formatAxisCents } from '@/lib/accounting/cash-daily'
import { addDays } from '@/lib/dates'

/**
 * La familia de gráficos de Administración: las cuentas de `scale.ts` (eje,
 * porcentajes, geometría) y lo que cada dibujo manda en el primer HTML. Los
 * casos son los que rompen un gráfico de plata: montos de 8 cifras, todo en
 * cero, un solo dato, un mes de 31 días y un día sin cargar (que no es cero).
 */

const NBSP = ' '
/** 8 cifras en pesos: $ 12.345.678,90. */
const BIG = 1_234_567_890

function html(node: ReactElement): string {
  return renderToString(node)
}

/** Los `aria-label` del HTML, sin las entidades que escribe React. */
function labels(markup: string): string[] {
  return [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) =>
    (m[1] ?? '').replaceAll('&#x27;', "'").replaceAll('&amp;', '&'),
  )
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

describe('niceStep / niceMax / ticks', () => {
  it('elige pasos de 1, 2 o 5 por una potencia de diez, en pesos', () => {
    expect(niceStep(1_230_000_00, 4)).toBe(500_000_00)
    expect(niceStep(380_000_00, 4)).toBe(100_000_00)
    expect(niceStep(700_000_00, 4)).toBe(200_000_00)
    expect(niceStep(90_00, 4)).toBe(50_00)
    expect(niceStep(BIG, 3)).toBe(5_000_000_00)
  })

  it('nunca baja de un peso y no se rompe sin datos', () => {
    expect(niceStep(0)).toBe(100)
    expect(niceStep(-500)).toBe(100)
    expect(niceStep(Number.NaN)).toBe(100)
    expect(niceStep(37)).toBe(100)
    expect(niceMax(0)).toBe(100)
    expect(niceMax(Number.POSITIVE_INFINITY)).toBe(100)
  })

  it('el tope es el primer múltiplo del paso que alcanza al máximo', () => {
    expect(niceMax(1_230_000_00, 4)).toBe(1_500_000_00)
    expect(niceMax(1_000_000_00, 4)).toBe(1_000_000_00)
    expect(niceMax(BIG, 3)).toBe(15_000_000_00)
  })

  it('las marcas van de 0 al tope, parejas, y nunca son más que las pedidas + 1', () => {
    expect(ticks(1_230_000_00, 4)).toEqual([0, 500_000_00, 1_000_000_00, 1_500_000_00])
    for (const max of [1, 99, 12_345, 999_999_99, BIG, 98_765_432_100]) {
      for (const maxTicks of [2, 3, 4, 5]) {
        const t = ticks(max, maxTicks)
        expect(t[0]).toBe(0)
        expect(t.length).toBeLessThanOrEqual(maxTicks + 1)
        expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
        expect(t.every((v) => Number.isInteger(v))).toBe(true)
      }
    }
  })

  it('las etiquetas del eje nunca pasan de tres cifras (hasta los cientos de millones)', () => {
    for (const max of [12_345_00, 250_000_00, 1_230_000_00, BIG, 45_678_901_200]) {
      for (const t of ticks(max, 4)) {
        const digits = compactCents(t).replace(/[^0-9]/g, '')
        expect(digits.length).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('niceDomain', () => {
  it('el cero siempre entra, también con todo positivo o todo negativo', () => {
    expect(niceDomain(200_000_00, 900_000_00, 3)).toMatchObject({ min: 0, max: 1_000_000_00 })
    const below = niceDomain(-900_000_00, -200_000_00, 3)
    expect(below.max).toBe(0)
    expect(below.min).toBeLessThanOrEqual(-900_000_00)
    expect(Object.is(below.max, -0)).toBe(false)
  })

  it('con descubierto baja lo justo y las marcas incluyen el cero', () => {
    const d = niceDomain(-150_000_00, 1_200_000_00, 3)
    expect(d.min).toBeLessThanOrEqual(-150_000_00)
    expect(d.max).toBeGreaterThanOrEqual(1_200_000_00)
    expect(d.ticks).toContain(0)
    expect(d.ticks[0]).toBe(d.min)
    expect(d.ticks[d.ticks.length - 1]).toBe(d.max)
  })

  it('sin rango (todo igual a cero) igual devuelve un eje que se puede dividir', () => {
    const d = niceDomain(0, 0)
    expect(d.max).toBeGreaterThan(d.min)
  })
})

describe('pct / sharePercents / percentLabel', () => {
  it('pct va de 0 a 100, redondeado, y sin total es 0 (nunca NaN)', () => {
    expect(pct(1, 3)).toBe(33.33)
    expect(pct(2, 3)).toBe(66.67)
    expect(pct(150, 100)).toBe(100)
    expect(pct(-5, 100)).toBe(0)
    expect(pct(5, 0)).toBe(0)
    expect(pct(5, -10)).toBe(0)
    expect(pct(Number.NaN, 10)).toBe(0)
    expect(pct(1, 3, 0)).toBe(33)
  })

  it('los porcentajes de una barra partida suman 100', () => {
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33])
    expect(sharePercents([BIG, 1])).toEqual([100, 0])
    expect(sharePercents([50, 30, 20])).toEqual([50, 30, 20])
    for (const values of [
      [7, 11, 13, 17],
      [1, 999],
      [BIG, BIG / 3, 12_345],
    ]) {
      expect(sharePercents(values).reduce((a, b) => a + b, 0)).toBe(100)
    }
  })

  it('lo negativo y lo inválido no reparten; sin total, todo cero', () => {
    expect(sharePercents([100, -50, Number.NaN])).toEqual([100, 0, 0])
    expect(sharePercents([0, 0])).toEqual([0, 0])
    expect(sharePercents([])).toEqual([])
  })

  it('algo que redondea a cero pero existe dice «menos de 1 %»', () => {
    expect(percentLabel(24)).toBe(`24${NBSP}%`)
    expect(percentLabel(0)).toBe(`0${NBSP}%`)
    expect(percentLabel(0, true)).toBe(`menos de 1${NBSP}%`)
    expect(percentLabel(Number.NaN)).toBe('—')
  })
})

describe('compactCentsFine', () => {
  it('un escalón más de detalle que el eje, sin ceros de más', () => {
    expect(compactCentsFine(1_953_339_20)).toBe(`$${NBSP}1,95${NBSP}M`)
    expect(compactCentsFine(2_000_000_00)).toBe(`$${NBSP}2${NBSP}M`)
    expect(compactCentsFine(1_200_000_00)).toBe(`$${NBSP}1,2${NBSP}M`)
    expect(compactCentsFine(349_560_00)).toBe(`$${NBSP}349,6${NBSP}mil`)
    expect(compactCentsFine(12_345_00)).toBe(`$${NBSP}12,35${NBSP}mil`)
    expect(compactCentsFine(850_00)).toBe(`$${NBSP}850`)
    expect(compactCentsFine(-2_500_000_00)).toBe(`−$${NBSP}2,5${NBSP}M`)
    expect(compactCentsFine(0)).toBe(`$${NBSP}0`)
    expect(compactCentsFine(Number.NaN)).toBe('')
  })
})

describe('compactCents', () => {
  it('abrevia como el eje del gráfico de cajas', () => {
    expect(compactCents(85_000)).toBe(`$${NBSP}850`)
    expect(compactCents(35_000_000)).toBe(`$${NBSP}350${NBSP}mil`)
    expect(compactCents(120_000_000)).toBe(`$${NBSP}1,2${NBSP}M`)
    expect(compactCents(BIG)).toBe(`$${NBSP}12,3${NBSP}M`)
    expect(compactCents(-200_000_000)).toBe(`−$${NBSP}2${NBSP}M`)
    expect(compactCents(0)).toBe(`$${NBSP}0`)
  })

  it('no contradice a formatAxisCents en ningún orden de magnitud', () => {
    for (let exp = 0; exp <= 12; exp++) {
      for (const m of [1, 1.5, 2.49, 9.995, -3.3]) {
        const cents = Math.round(m * 10 ** exp)
        expect(compactCents(cents)).toBe(formatAxisCents(cents))
      }
    }
  })
})

describe('labelIndexes', () => {
  it('si entran todas, van todas', () => {
    expect(labelIndexes(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(labelIndexes(1, 7)).toEqual([0])
    expect(labelIndexes(0, 7)).toEqual([])
  })

  it('en un mes de 31 días ralea y nunca pasa del máximo + las fijadas', () => {
    const plain = labelIndexes(31, 7)
    expect(plain).toEqual([0, 5, 10, 15, 20, 25, 30])
    const withToday = labelIndexes(31, 7, [12])
    expect(withToday).toContain(12)
    expect(withToday.length).toBeLessThanOrEqual(8)
  })

  it('saca la etiqueta común que queda pegada a una fijada', () => {
    const out = labelIndexes(31, 7, [11])
    expect(out).toContain(11)
    // 10 queda a 1 casillero de 11: se pisarían.
    expect(out).not.toContain(10)
    for (let i = 1; i < out.length; i++) {
      expect((out[i] ?? 0) - (out[i - 1] ?? 0)).toBeGreaterThanOrEqual(3)
    }
  })

  it('ignora fijadas fuera de rango (hoy no está en el mes que se mira)', () => {
    expect(labelIndexes(31, 7, [-1, 40, 2.5])).toEqual([0, 5, 10, 15, 20, 25, 30])
  })
})

describe('paleta', () => {
  it('seis series en orden fijo; la séptima va a «Otros» y nunca se cicla', () => {
    expect(SERIES_SWATCHES).toHaveLength(6)
    expect(new Set(SERIES_SWATCHES).size).toBe(6)
    expect(seriesSwatch(0)).toBe('bg-adm-s1')
    expect(seriesSwatch(5)).toBe('bg-adm-s6')
    expect(seriesSwatch(6)).toBe(OTHERS_SWATCH)
    expect(seriesSwatch(60)).toBe(OTHERS_SWATCH)
    expect(seriesSwatch(-1)).toBe(OTHERS_SWATCH)
    expect(seriesSwatch(1.5)).toBe(OTHERS_SWATCH)
  })
})

describe('geometría', () => {
  it('cada dato va al centro de su casillero', () => {
    expect(slotX(0, 1)).toBe(50)
    expect(slotX(0, 4)).toBe(12.5)
    expect(slotX(3, 4)).toBe(87.5)
    expect(slotX(30, 31)).toBe(98.39)
    expect(slotEdge(0, 31)).toBe(0)
    expect(slotEdge(31, 31)).toBe(100)
  })

  it('valueY: el tope arriba (0), el piso abajo (100), con tope', () => {
    expect(valueY(100, 0, 100)).toBe(0)
    expect(valueY(0, 0, 100)).toBe(100)
    expect(valueY(25, 0, 100)).toBe(75)
    expect(valueY(500, 0, 100)).toBe(0)
    expect(valueY(0, -100, 100)).toBe(50)
    expect(valueY(5, 10, 10)).toBe(100)
  })

  it('todo sale con 2 decimales como mucho', () => {
    for (const n of [3, 7, 31]) {
      for (let i = 0; i < n; i++) {
        const x = slotX(i, n)
        expect(round2(x)).toBe(x)
      }
    }
  })

  it('una línea no une los puntos a los dos lados de un día sin cargar', () => {
    const a = { x: 10, y: 90 }
    const b = { x: 30, y: 70 }
    const c = { x: 70, y: 40 }
    const d = { x: 90, y: 20 }
    expect(linePaths([a, b, null, c, d])).toEqual({
      paths: ['M10 90 L30 70', 'M70 40 L90 20'],
      lonely: [],
    })
    // Un día cargado entre dos huecos queda como punto suelto.
    expect(linePaths([a, null, b, null, c, d])).toEqual({
      paths: ['M70 40 L90 20'],
      lonely: [a, b],
    })
    expect(linePaths([null, null])).toEqual({ paths: [], lonely: [] })
  })

  it('la línea escalonada sostiene cada valor todo su casillero', () => {
    expect(stepLinePath([80, 40])).toBe('M0 80 H50 V40 H100')
    expect(stepLinePath([60])).toBe('M0 60 H100')
    expect(stepLinePath([])).toBeNull()
    expect(stepLinePath([80, 40, 20, 10], 0, 2)).toBe('M0 80 H25 V40 H50')
    expect(stepAreaPath([80, 40], 100)).toBe('M0 80 H50 V40 H100 V100 H0 Z')
    expect(stepAreaPath([], 100)).toBeNull()
  })
})

/* ── Lo que cada gráfico manda en el primer HTML ─────────────────────────── */

const START = '2026-10-01'

function monthDays(over: (i: number) => Partial<DayBarsDay> = () => ({})): DayBarsDay[] {
  return Array.from({ length: 31 }, (_, i) => {
    const date = addDays(START, i)
    return {
      date,
      label: `Día ${i + 1}`,
      cents: (i + 1) * 10_000_00,
      targetCents: 200_000_00,
      state: 'ok' as const,
      ...over(i),
    }
  })
}

describe('sin datos no se dibujan ceros', () => {
  const hint = 'Cuando cargues el primer cierre, acá aparece.'
  const cases: Array<[string, ReactElement]> = [
    [
      'SplitBar',
      createElement(SplitBar, {
        segments: [{ key: 'a', label: 'Caja', cents: 0, swatch: 'bg-adm-s1' }],
        emptyHint: hint,
      }),
    ],
    [
      'RankBars',
      createElement(RankBars, {
        rows: [{ key: 'a', label: 'Bebidas', cents: 0 }],
        emptyHint: hint,
      }),
    ],
    [
      'DayBars',
      createElement(DayBars, {
        days: monthDays(() => ({ cents: null, state: 'missing' })),
        emptyHint: hint,
      }),
    ],
    [
      'DayBars en cero',
      createElement(DayBars, { days: monthDays(() => ({ cents: 0 })), emptyHint: hint }),
    ],
    [
      'TargetRace',
      createElement(TargetRace, {
        points: [{ date: START, soldAccumCents: null, targetAccumCents: 100_000_00 }],
        todayIndex: 0,
        emptyHint: hint,
      }),
    ],
    [
      'BalanceArea',
      createElement(BalanceArea, { points: [{ date: START, cents: 0 }], emptyHint: hint }),
    ],
    [
      'InOutBars',
      createElement(InOutBars, {
        buckets: [{ key: 'a', label: 'Oct', inCents: 0, outCents: 0 }],
        emptyHint: hint,
      }),
    ],
    [
      'DueStrip',
      createElement(DueStrip, {
        days: [{ date: START, label: 'Jue 01/10', cents: 0, count: 0 }],
        emptyHint: hint,
      }),
    ],
    ['CloseStrip', createElement(CloseStrip, { days: [], emptyHint: hint })],
  ]

  it.each(cases)('%s muestra el aviso y ninguna marca', (_name, node) => {
    const out = html(node)
    expect(out).toContain(hint)
    expect(out).not.toContain('data-tip-title')
    expect(out).not.toContain(`$${NBSP}0`)
  })

  it('un `emptyHint` que es un elemento va tal cual, sin el título por defecto', () => {
    const out = html(
      createElement(RankBars, {
        rows: [],
        emptyHint: createElement('p', { id: 'propio' }, 'Lo arma la pantalla'),
      }),
    )
    expect(out).toContain('id="propio"')
    expect(out).not.toContain('Todavía no hay nada para comparar')
  })

  it('Meter sin total deja el riel punteado y no inventa un porcentaje', () => {
    const out = html(
      createElement(Meter, { valueCents: 500, totalCents: 0, emptyHint: 'Falta el objetivo' }),
    )
    expect(out).toContain('border-dashed')
    expect(out).toContain('Falta el objetivo')
    expect(out).not.toContain('%')
  })

  it('BalanceArea compacta sin datos no dibuja nada', () => {
    expect(html(createElement(BalanceArea, { points: [], compact: true }))).toBe('')
  })
})

describe('DayBars', () => {
  it('un mes de 31 días: una marca por día y el eje raleado', () => {
    const out = html(
      createElement(DayBars, { days: monthDays((i) => (i === 14 ? { state: 'today' } : {})) }),
    )
    expect(count(out, 'data-tip-title=')).toBe(31)
    // En el celular el eje muestra 7 números (hoy entre ellos); los otros 24
    // solo aparecen cuando la tarjeta es ancha.
    expect(count(out, 'hidden @min-[34rem]:flex')).toBe(24)
    expect(out).toContain('>31<')
  })

  it('un día sin cargar NO es cero: va hueco, rotulado y con su link', () => {
    const days = monthDays((i) =>
      i === 9
        ? {
            cents: null,
            state: 'missing',
            href: '/bar/administracion/ventas/cierre?fecha=2026-10-10',
          }
        : {},
    )
    const out = html(createElement(DayBars, { days }))
    expect(out).toContain('Falta cargar')
    expect(out).toContain('border-dashed')
    expect(out).toContain('href="/bar/administracion/ventas/cierre?fecha=2026-10-10"')
    const missing = labels(out).find((l) => l.startsWith('Sáb 10/10'))
    expect(missing).toContain('falta cargar')
    expect(missing).not.toContain('$')
    // El total de la leyenda no cuenta el día que falta como $ 0 ni lo suma.
    const total = (31 * 32) / 2 - 10
    expect(total).toBe(486)
    expect(labels(out)[0]).toContain(`$${NBSP}4.860.000`)
    expect(labels(out)[0]).toContain('Falta cargar 1 día')
  })

  it('montos de 8 cifras: el eje abrevia y el dato exacto queda en la marca', () => {
    const days: DayBarsDay[] = [
      { date: START, label: 'Jue 01/10', cents: BIG, state: 'ok' },
      { date: addDays(START, 1), label: 'Vie 02/10', cents: BIG / 2, state: 'ok' },
    ]
    const out = html(createElement(DayBars, { days }))
    expect(out).toContain(`$${NBSP}15${NBSP}M`)
    // El globito va en pesos, como el resto del tablero; el dato al centavo queda en lo
    // que lee un lector de pantalla.
    expect(out).toContain(`data-tip-value="$${NBSP}12.345.679"`)
    expect(out).not.toContain('data-tip-value="$ 12.345.678,90"')
    expect(labels(out).some((l) => l.includes(`$${NBSP}12.345.678,90`))).toBe(true)
  })

  it('la etiqueta del día más alto no repite una marca del eje', () => {
    // $ 1.953.339 abreviado es «$ 2 M», lo mismo que dice el eje al lado: va con más detalle.
    const near: DayBarsDay[] = [
      { date: START, label: 'Jue 01/10', cents: 1_953_339_20, state: 'ok' },
      { date: addDays(START, 1), label: 'Vie 02/10', cents: 800_000_00, state: 'ok' },
    ]
    const out = html(createElement(DayBars, { days: near }))
    expect(count(out, `>$${NBSP}2${NBSP}M<`)).toBe(2) // el eje y su fantasma, no la columna
    expect(out).toContain(`>$${NBSP}1,95${NBSP}M<`)
    // Justo en la marca no hay nada más fino que decir: la columna no lleva etiqueta.
    const exact: DayBarsDay[] = [
      { date: START, label: 'Jue 01/10', cents: 2_000_000_00, state: 'ok' },
      { date: addDays(START, 1), label: 'Vie 02/10', cents: 800_000_00, state: 'ok' },
    ]
    expect(count(html(createElement(DayBars, { days: exact })), `>$${NBSP}2${NBSP}M<`)).toBe(2)
  })

  it('un solo dato se dibuja (no es «sin datos») y lleva su etiqueta', () => {
    const out = html(
      createElement(DayBars, {
        days: [{ date: START, label: 'Jue 01/10', cents: 350_000_00, state: 'ok' }],
      }),
    )
    expect(count(out, 'data-tip-title=')).toBe(1)
    expect(out).toContain(`$${NBSP}350${NBSP}mil`)
  })

  it('el futuro sin objetivo no deja una parada de teclado', () => {
    const days: DayBarsDay[] = [
      { date: START, label: 'Jue 01/10', cents: 100_000_00, state: 'ok' },
      { date: addDays(START, 1), label: 'Vie 02/10', cents: null, state: 'future' },
    ]
    expect(count(html(createElement(DayBars, { days })), 'tabindex="0"')).toBe(1)
  })

  it('la tabla dice «Falta cargar» y no un importe en el día que falta', () => {
    const days = monthDays((i) => (i === 0 ? { cents: null, state: 'missing' } : {}))
    const out = html(createElement(DayBarsTable, { days }))
    expect(out).toContain('Falta cargar')
    expect(count(out, '<tr')).toBe(1 + 31 + 1)
    // Sin centavos, y el total dice de qué es.
    expect(out).toContain('Total de los días cargados')
    expect(out).not.toMatch(/,\d\d</)
  })
})

describe('SplitBar', () => {
  const segments = [
    { key: 'caja', label: 'Caja del salón', cents: BIG, swatch: 'bg-adm-s1' },
    {
      key: 'banco',
      label: 'Banco',
      cents: 12_345_00,
      swatch: 'bg-adm-s4',
      href: '/bar/administracion/cajas/banco',
    },
    { key: 'visa', label: 'Descubierto', cents: -50_000_00, swatch: 'bg-adm-s3' },
  ]

  it('la leyenda es la tabla: monto y porcentaje de cada parte', () => {
    const out = html(createElement(SplitBar, { segments, totalLabel: 'Disponible' }))
    expect(out).toContain('<table')
    expect(out).toContain(`$${NBSP}12.345.679`)
    expect(out).toContain(`menos de 1${NBSP}%`)
    expect(out).toContain('Disponible')
  })

  it('lo negativo no entra en la barra pero sí en la leyenda', () => {
    const out = html(createElement(SplitBar, { segments }))
    expect(count(out, 'data-tip-title=')).toBe(2)
    expect(out).toContain('Descubierto')
    expect(out).toContain(`−$${NBSP}50.000`)
  })

  it('el tramo con link es un link y el resto se enfoca igual', () => {
    const out = html(createElement(SplitBar, { segments }))
    expect(out).toContain('href="/bar/administracion/cajas/banco"')
    expect(count(out, 'tabindex="0"')).toBe(1)
  })

  it('dice la conclusión en el aria-label', () => {
    const summary = labels(html(createElement(SplitBar, { segments, totalLabel: 'Disponible' })))[0]
    expect(summary).toContain('Disponible')
    expect(summary).toContain('Caja del salón')
  })
})

describe('RankBars', () => {
  it('ordena de mayor a menor y marca el período anterior', () => {
    const out = html(
      createElement(RankBars, {
        rows: [
          { key: 'a', label: 'Verdulería', cents: 100_00 },
          { key: 'b', label: 'Bebidas', cents: BIG, previousCents: BIG / 2 },
          { key: 'c', label: 'Hielo', cents: 500_00 },
        ],
        previousLabel: 'el mes pasado',
      }),
    )
    expect(out.indexOf('Bebidas')).toBeLessThan(out.indexOf('Hielo'))
    expect(out.indexOf('Hielo')).toBeLessThan(out.indexOf('Verdulería'))
    expect(out).toContain('La raya fina marca el mes pasado.')
  })
})

describe('TargetRace', () => {
  const points = Array.from({ length: 31 }, (_, i) => ({
    date: addDays(START, i),
    soldAccumCents: i <= 12 ? (i + 1) * 300_000_00 : null,
    targetAccumCents: (i + 1) * 280_000_00,
  }))

  it('lo vendido corta en el último día cargado', () => {
    const out = html(createElement(TargetRace, { points, todayIndex: 12 }))
    const paths = [...out.matchAll(/ d="([^"]+)"/g)].map((m) => m[1] ?? '')
    expect(paths).toHaveLength(2)
    const [targetPath, soldPath] = paths
    expect(count(targetPath ?? '', 'L')).toBe(30)
    expect(count(soldPath ?? '', 'L')).toBe(12)
    expect(labels(out)[0]).toContain('arriba')
    expect(out).toContain('Hoy')
  })

  it('un hueco en el medio parte la línea en dos', () => {
    const holed = points.map((p, i) => (i === 5 ? { ...p, soldAccumCents: null } : p))
    const out = html(createElement(TargetRace, { points: holed, todayIndex: 12 }))
    expect([...out.matchAll(/stroke="var\(--adm-s1\)"/g)]).toHaveLength(2)
  })
})

describe('BalanceArea', () => {
  const points = Array.from({ length: 31 }, (_, i) => ({
    date: addDays(START, i),
    cents: i === 15 ? -200_000_00 : BIG - i * 10_000_000,
  }))

  it('con descubierto el eje baja de cero y marca el punto más bajo', () => {
    const out = html(createElement(BalanceArea, { points, todayIndex: 30 }))
    expect(out).toContain(`−$${NBSP}5${NBSP}M`)
    expect(out).toContain('Más bajo')
    expect(count(out, 'data-tip-title=')).toBe(31)
  })

  it('lo que sigue a hoy se rotula «estimado»', () => {
    const out = html(createElement(BalanceArea, { points, todayIndex: 10 }))
    expect(out).toContain('estimado')
    expect(labels(out)[0]).toContain('Lo que sigue a hoy es estimado')
  })

  it('compacta: solo el dibujo, sin marcas ni ejes', () => {
    const out = html(createElement(BalanceArea, { points, compact: true, tone: 'onHero' }))
    expect(out).not.toContain('data-tip-title')
    expect(out).not.toContain('<table')
    expect(out).toContain('var(--adm-gold)')
  })

  it('un solo punto es una línea a lo ancho, no un vacío', () => {
    const out = html(createElement(BalanceArea, { points: [{ date: START, cents: 500_000_00 }] }))
    expect(out).toContain('H100')
  })
})

describe('InOutBars', () => {
  it('una sola escala para los dos sentidos y la leyenda con flechas', () => {
    const out = html(
      createElement(InOutBars, {
        buckets: [
          { key: 's40', label: 'Sem 40', inCents: BIG, outCents: BIG / 4 },
          { key: 's41', label: 'Sem 41', inCents: 0, outCents: 300_000_00 },
        ],
      }),
    )
    expect(out).toContain('↑')
    expect(out).toContain('↓')
    expect(out).toContain('bg-adm-in')
    expect(out).toContain('bg-adm-out')
    // El eje no escribe montos negativos: «salió $ 5 M», no «−$ 5 M».
    expect(out).not.toMatch(/>−\$/)
  })

  const weeks = [
    {
      key: 's1',
      label: '14 al 20/09',
      shortLabel: '14–20/9',
      inCents: 7_319_568_78,
      outCents: 200_000_00,
    },
    {
      key: 's2',
      label: '28/09 al 04/10',
      shortLabel: '28/9–4/10',
      inCents: 9_210_777_17,
      outCents: 1_129_010_00,
    },
    {
      key: 's3',
      label: '12 al 13/10',
      shortLabel: 'esta semana',
      inCents: 0,
      outCents: 0,
      emptyText: 'Sin movimientos todavía',
    },
  ]

  it('abajo reserva solo lo que salió, y cada marca del eje dice su sentido', () => {
    const out = html(createElement(InOutBars, { buckets: weeks }))
    // Salió $ 1,1 M como mucho: el eje baja a $ 2 M, no un paso entero del de arriba ($ 5 M).
    expect(out).toContain(`>↓ $${NBSP}2${NBSP}M<`)
    expect(out).not.toContain(`↓ $${NBSP}5${NBSP}M`)
    expect(out).toContain(`>↑ $${NBSP}10${NBSP}M<`)
    expect(out).toContain(`>↑ $${NBSP}5${NBSP}M<`)
    // Una sola escala: $ 9,2 M de 12 M de alto total.
    expect(out).toContain('height:calc(76.76% - 1px)')
    // El eje usa la etiqueta corta; el globito y el aria-label, la larga.
    expect(out).toContain('>14–20/9<')
    expect(out).toContain('>esta semana<')
    expect(out).toContain('data-tip-title="28/09 al 04/10"')
    // El globito va sin centavos.
    expect(out).toContain(`data-tip-value="↑ Entró $${NBSP}9.210.777"`)
  })

  it('con lo mismo de los dos lados el eje sigue siendo simétrico', () => {
    const out = html(
      createElement(InOutBars, {
        buckets: [{ key: 'a', label: 'Sem 40', inCents: 9_000_000_00, outCents: 8_000_000_00 }],
      }),
    )
    expect(out).toContain(`>↑ $${NBSP}10${NBSP}M<`)
    expect(out).toContain(`>↓ $${NBSP}10${NBSP}M<`)
    expect(out).toContain(`>↓ $${NBSP}5${NBSP}M<`)
  })

  it('la tabla va sin centavos y una semana sin movimientos lo dice con palabras', () => {
    const out = html(createElement(InOutBarsTable, { buckets: weeks }))
    expect(out).toContain(`$${NBSP}9.210.777`)
    expect(out).toContain(`+$${NBSP}8.081.767`)
    expect(out).not.toMatch(/,\d\d</)
    expect(out).toContain('Sin movimientos todavía')
    // Ni en la versión angosta ni en la ancha la semana vacía figura como «$ 0».
    expect(out).not.toContain(`>$${NBSP}0<`)
    expect(out).toContain('Diferencia')
    expect(out).toContain(`+$${NBSP}15.201.336`)
  })
})

describe('DueStrip', () => {
  it('lo vencido va con su palabra y los días vacíos no se enfocan', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({
      date: addDays(START, i),
      label: `Día ${i + 1}`,
      cents: i === 0 ? 80_000_00 : i === 6 ? BIG : 0,
      count: i === 0 ? 1 : i === 6 ? 3 : 0,
      overdue: i === 0,
    }))
    const out = html(createElement(DueStrip, { days }))
    expect(count(out, 'data-tip-title=')).toBe(2)
    expect(out).toContain('Ya vencido')
    expect(out).toContain('3 vencimientos')
    expect(labels(out).some((l) => l.includes('vencido'))).toBe(true)
  })
})

describe('CloseStrip', () => {
  const days: CloseStripDay[] = Array.from({ length: 31 }, (_, i) => {
    const date = addDays(START, i)
    const state = i < 5 ? 'loaded' : i < 8 ? 'missing' : i === 8 ? 'today' : 'future'
    return {
      date,
      dayNumber: i + 1,
      weekday: 'x',
      state,
      cents: state === 'loaded' ? BIG : null,
      href: state === 'missing' ? `/bar/administracion/ventas/cierre?fecha=${date}` : undefined,
    }
  })

  it('cargado con tilde, falta con su palabra y su link, el futuro sin foco', () => {
    const out = html(createElement(CloseStrip, { days }))
    expect(count(out, 'data-tip-title=')).toBe(9)
    expect(count(out, '>falta<')).toBe(3)
    expect(count(out, 'href="/bar/administracion/ventas/cierre?fecha=')).toBe(3)
    expect(out).toContain('5 días cargados.')
    expect(out).toContain('Falta cargar 3 días')
  })

  it('se dibuja aunque no haya ningún día cargado', () => {
    const none = days.map((d) => ({ ...d, state: 'missing' as const, cents: null }))
    const out = html(createElement(CloseStrip, { days: none }))
    expect(count(out, 'data-tip-title=')).toBe(31)
    expect(out).toContain('Ningún día cargado todavía.')
  })

  it('el 1/10/2026 es jueves: arranca en la cuarta columna', () => {
    expect(html(createElement(CloseStrip, { days }))).toContain('col-start-4')
  })
})

describe('Meter', () => {
  it('dice cuánto va y dónde está la marca', () => {
    const out = html(
      createElement(Meter, {
        valueCents: 620_000_00,
        totalCents: 1_000_000_00,
        markerCents: 500_000_00,
        label: 'Vendido del objetivo',
        markerLabel: 'marca de hoy',
      }),
    )
    const summary = labels(out)[0] ?? ''
    expect(summary).toContain(`62${NBSP}%`)
    expect(summary).toContain('marca de hoy')
    expect(out).toContain('width:62%')
    expect(out).toContain('left:50%')
  })

  it('pasado del total: el riel se llena y lo dice', () => {
    const out = html(createElement(Meter, { valueCents: BIG, totalCents: 1_000_000_00 }))
    expect(out).toContain('width:100%')
    expect(labels(out)[0]).toContain('por encima')
  })
})
