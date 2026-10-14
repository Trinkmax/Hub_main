// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CoverageStrip,
  CoverageStripTable,
} from '@/components/administracion/importar/inbox/coverage-strip'
import type { CoverageCell } from '@/lib/imports/ui/inbox'

/**
 * La tira de cobertura de «Importar», ya dibujada: que el estado nunca dependa
 * solo del color (cada marca lleva su dato en palabras), que los días no sumen
 * 35 paradas de teclado por bandeja y que un mes subido lleve a su archivo.
 */

const html = (node: React.ReactNode) => renderToStaticMarkup(node)

const DAYS: CoverageCell[] = [
  {
    key: '2026-10-08',
    label: '08/10',
    title: 'Jue 08/10: falta, de más atrás',
    state: 'gap',
  },
  { key: '2026-10-09', label: '09/10', title: 'Vie 09/10: subido', state: 'loaded', tick: '09/10' },
  {
    key: '2026-10-10',
    label: '10/10',
    title: 'Sáb 10/10: subido, falta revisarlo',
    state: 'review',
  },
  { key: '2026-10-11', label: '11/10', title: 'Dom 11/10: falta subir', state: 'missing' },
  { key: '2026-10-12', label: '12/10', title: 'Lun 12/10: falta subir', state: 'missing' },
  { key: '2026-10-13', label: '13/10', title: 'Mar 13/10: hoy', state: 'today', tick: 'hoy' },
]

const MONTHS: CoverageCell[] = [
  { key: '2026-07', label: 'jul', title: 'Julio: de antes de arrancar', state: 'before' },
  { key: '2026-08', label: 'ago', title: 'Agosto: falta bajarlo', state: 'missing' },
  {
    key: '2026-09',
    label: 'sep',
    title: 'Septiembre: subido',
    state: 'loaded',
    href: '/bar/administracion/importar/lote-1',
  },
  { key: '2026-10', label: 'oct', title: 'Octubre: se baja desde el 11/11', state: 'today' },
]

describe('la tira por días', () => {
  const out = html(
    <CoverageStrip
      cells={DAYS}
      granularity="day"
      ariaLabel="Mercado Pago, los últimos 5 días. 2 días subidos. 2 días sin subir."
    />,
  )

  it('es UNA imagen con su conclusión, sin una parada de teclado por día', () => {
    expect(out).toContain('role="img"')
    expect(out).toContain(
      'aria-label="Mercado Pago, los últimos 5 días. 2 días subidos. 2 días sin subir."',
    )
    expect(out).not.toMatch(/tabindex/i)
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('<button')
  })

  it('cada marca lleva su dato en palabras para el globito', () => {
    for (const cell of DAYS) {
      const [title] = cell.title.split(': ')
      expect(out, cell.key).toContain(`data-tip-title="${title}"`)
    }
    expect(out).toContain('data-tip-value="Falta subir"')
    expect(out).toContain('data-tip-value="Subido, falta revisarlo"')
  })

  it('lo que falta va punteado en ámbar y lo que espera revisión, rayado', () => {
    expect(out).toContain('border-dashed border-warning')
    // El rayado es un fondo en línea (`HATCH_OVER_FILL` y `HATCH_MISSING`): las tres
    // marcas (una en revisión, dos que faltan) y sus dos muestras de la leyenda.
    expect(out.match(/repeating-linear-gradient/g)?.length).toBe(5)
  })

  it('un hueco de más atrás no se ve igual que lo que falta ahora: gris, sin rayado', () => {
    expect(out).toContain('border-dashed border-adm-neutral')
    // La marca del hueco viejo (la que lleva su globito) no lleva el rayado ámbar.
    expect(out).toMatch(
      /data-tip-title="Jue 08\/10" data-tip-value="Falta, de más atrás" class="[^"]*border-adm-neutral[^"]*"><\/span>/,
    )
  })

  it('la leyenda nombra solo las marcas que aparecen, cada una con su muestra', () => {
    expect(out).toContain('aria-label="Qué es cada marca"')
    for (const word of ['subido', 'falta revisarlo', 'falta', 'falta, de más atrás']) {
      expect(out, word).toMatch(new RegExp(`</span>${word}</li>`))
    }
    // «Hoy» lo dice el rótulo del anillo; lo anterior al arranque no aparece en esta tira.
    expect(out).not.toContain('antes de arrancar')
  })

  it('rotula solo algunos días, y el anillo dice «hoy»', () => {
    expect(out).toContain('>09/10<')
    expect(out).toContain('>hoy<')
    expect(out).not.toContain('>ayer<')
    expect(out).not.toContain('>11/10<')
    // Los rótulos no bajan de 11 px.
    expect(out).not.toContain('text-[10px]')
  })

  it('sin ticks no deja el renglón vacío', () => {
    const plain = html(
      <CoverageStrip cells={DAYS.map(({ tick: _tick, ...c }) => c)} granularity="day" />,
    )
    expect(plain).not.toContain('>hoy<')
    expect(plain).toContain('aria-label="Días subidos y días que faltan"')
  })
})

describe('la tira por meses', () => {
  const out = html(
    <CoverageStrip
      cells={MONTHS}
      granularity="month"
      ariaLabel="Los últimos 4 meses. 1 mes subido. Falta bajar agosto."
    />,
  )

  it('cada casillero dice su mes adentro y su estado para lectores', () => {
    for (const cell of MONTHS) {
      expect(out, cell.key).toContain(`>${cell.label}<`)
      expect(out, cell.key).toContain(cell.title)
    }
    expect(out).toContain('Los últimos 4 meses. 1 mes subido. Falta bajar agosto.')
  })

  it('la leyenda de los meses dice qué es el anillo', () => {
    for (const word of ['subido', 'falta bajarlo', 'este mes', 'antes de arrancar']) {
      expect(out, word).toMatch(new RegExp(`</span>${word}</li>`))
    }
  })

  it('un mes subido es un link a su archivo; los demás no se tocan', () => {
    expect(out).toContain('href="/bar/administracion/importar/lote-1"')
    expect(out.match(/<a /g)?.length).toBe(1)
    expect(out).toContain('aria-label="Septiembre: subido. Abre ese archivo"')
  })
})

describe('vacío y tabla', () => {
  it('sin marcas no dibuja ceros: nada, o lo que se le diga', () => {
    expect(html(<CoverageStrip cells={[]} granularity="day" />)).toBe('')
    expect(
      html(<CoverageStrip cells={[]} granularity="month" emptyHint="Todavía no hay nada." />),
    ).toContain('Todavía no hay nada.')
  })

  it('la tabla dice lo mismo que el dibujo, fila por fila', () => {
    const table = html(<CoverageStripTable cells={MONTHS} caption="ARCA, mes por mes" />)
    expect(table).toContain('<caption')
    expect(table).toContain('ARCA, mes por mes')
    expect(table.match(/<tr/g)?.length).toBe(MONTHS.length + 1)
    expect(table).toContain('Falta bajarlo')
    expect(html(<CoverageStripTable cells={[]} caption="x" />)).toBe('')
  })
})
