// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MissingZerosCheck } from '@/components/loyalty/missing-zeros-check'

/**
 * «¿Son $129 o $129.000?» en el primer paint: el monto tal cual, el corregido y
 * qué pasa si se deja así. Donde no se cargan visitas sin puntos (el operativo)
 * solo se ofrece corregir.
 */
const noop = () => {}

describe('MissingZerosCheck', () => {
  it('pregunta con los dos montos y ofrece las dos salidas', () => {
    const html = renderToString(
      <MissingZerosCheck
        typedCents={12_900}
        suggestedCents={12_900_000}
        typedPoints={0}
        onFix={noop}
        onKeep={noop}
      />,
    )
    expect(html).toContain('¿Son <span class="tabular-nums">$129</span>')
    expect(html).toContain('$129.000')
    expect(html).toContain('Así como está no suma puntos.')
    expect(html).toContain('Son $129.000')
    expect(html).toContain('Son $129<')
  })

  it('sin «dejarlo así», solo ofrece corregir', () => {
    const html = renderToString(
      <MissingZerosCheck
        typedCents={8_400}
        suggestedCents={8_400_000}
        typedPoints={0}
        onFix={noop}
      />,
    )
    expect(html).toContain('Son $84.000')
    expect(html).not.toContain('Son $84<')
  })

  it('si con la tasa del bar igual suma, lo dice en vez de asustar', () => {
    const html = renderToString(
      <MissingZerosCheck
        typedCents={50_000}
        suggestedCents={50_000_000}
        typedPoints={5}
        onFix={noop}
      />,
    )
    expect(html).toContain('Así como está suma 5 puntos.')
  })
})
