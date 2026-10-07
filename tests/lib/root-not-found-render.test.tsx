// @vitest-environment node
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import NotFound from '@/app/not-found'

/**
 * El 404 raíz (kit HUB, riesgo 1). Sale adentro del `<html>` del workspace que
 * pidió la URL, también bajo lo público (`legacy-theme`) y el salón
 * (`force-light`), que se tienen que ver como antes del kit: por eso dibuja el
 * botón de la copia congelada (`components/ui-legacy`), no el del kit nuevo.
 * Y su link recarga: `/` reparte a otro workspace, y en una navegación blanda
 * el `<html>` del layout raíz llegaría con el tema de acá.
 */

describe('404 raíz', () => {
  const html = renderToStaticMarkup(h(NotFound))

  it('mantiene el copy de siempre', () => {
    expect(html).toContain('<h1 class="text-4xl font-semibold">404</h1>')
    expect(html).toContain('No encontramos lo que buscabas.')
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Volver al inicio<\/a>/)
  })

  it('usa el botón congelado, no el del kit nuevo', () => {
    const link = /<a [^>]*>/.exec(html)?.[0] ?? ''
    expect(link).toContain('data-slot="button"')
    // Marcas del botón de antes del kit (ui-legacy).
    expect(link).toContain('h-9')
    expect(link).toContain('active:scale-[0.985]')
    // Marcas del kit nuevo que no tienen que aparecer.
    for (const kit of ['press', 'hit-area', '--control-', 'outline-(--ring)']) {
      expect(link, kit).not.toContain(kit)
    }
  })
})
