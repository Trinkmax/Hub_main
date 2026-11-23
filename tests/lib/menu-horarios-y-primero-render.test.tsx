// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AvailabilityField } from '@/app/(manager)/[tenantSlug]/menu/_components/availability-field'
import { FirstPane } from '@/app/(manager)/[tenantSlug]/menu/cocina/_components/first-pane'
import type { KitchenWrites } from '@/app/(manager)/[tenantSlug]/menu/cocina/_components/use-kitchen-writes'
import { ProductPicker } from '@/components/pos/order/product-picker'
import { type Availability, toDrafts } from '@/lib/menu/availability'
import { cartaTree } from '@/lib/menu/kitchen/routing'
import { buildCartaIndex } from '@/lib/menu/kitchen/search'
import type { KitchenSnapshot } from '@/lib/menu/kitchen/types'
import { buildMenuIndex, offHoursItems } from '@/lib/pos/order/menu-index'
import type { PosMenu } from '@/lib/pos/types'
import {
  CATEGORIES,
  CLASICA,
  COMIDA,
  HAMBURGUESAS,
  ITEMS,
  PIZZA,
  snapshot,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * Lo que tiene que estar en el primer dibujo de las tres pantallas nuevas: la pestaña «Sale
 * primero», el campo «¿Cuándo se muestra?» y la carta del mozo con algo fuera de horario. Las reglas
 * están probadas aparte (`menu-kitchen-first`, `menu-availability`, `pos-order-menu`); acá, que la
 * pantalla las diga.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const TZ = 'America/Argentina/Cordoba'

/** Los `<button role="switch">` del HTML, en orden, con lo que importa de cada uno. */
function switches(html: string): { label: string; checked: boolean; disabled: boolean }[] {
  return [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(([tag]) => ({
    label: /aria-label="([^"]*)"/.exec(tag)?.[1] ?? '',
    checked: tag.includes('aria-checked="true"'),
    disabled: /\sdisabled(=""|\s|>)/.test(tag),
  }))
}

describe('la pestaña «Sale primero»', () => {
  const render = (view: KitchenSnapshot) => {
    const tree = cartaTree(view.categories, view.items)
    const writes: KitchenWrites = {
      view,
      saving: new Set(),
      busy: false,
      stumbled: false,
      flashed: new Set(),
      errors: {},
      commit: () => true,
      undo: () => {},
      undoLabel: null,
    }
    return renderToString(createElement(FirstPane, { writes, tree, index: buildCartaIndex(tree) }))
  }

  it('sin nada marcado lo dice, explica para qué sirve y muestra las categorías cerradas', () => {
    const html = render(snapshot())
    expect(html).toContain('Nada')
    expect(html).toContain('sale primero todavía')
    expect(html).toContain('encabeza la comanda en cocina: ideal para entradas')
    // Las de arriba de todo, cada una con su interruptor apagado; lo de adentro, cerrado.
    const all = switches(html)
    expect(all.map((each) => each.label)).toEqual([
      'Comida: sale primero',
      'Bebidas: sale primero',
      'Postres: sale primero',
      'Vacía: sale primero',
    ])
    expect(all.every((each) => !each.checked && !each.disabled)).toBe(true)
  })

  it('con marcas: el número, la rama abierta, lo heredado y lo que un producto dice aparte', () => {
    const html = render(
      snapshot({
        categories: CATEGORIES.map((each) =>
          each.id === HAMBURGUESAS ? { ...each, kitchenFirst: true } : each,
        ),
        items: ITEMS.map((each) => (each.id === CLASICA ? { ...each, kitchenFirst: false } : each)),
      }),
    )
    // Hamburguesas tiene dos productos y uno dice que no: sale primero uno solo.
    expect(html).toMatch(/data-testid="primero-numero"[^>]*>1</)
    expect(html).toContain('producto sale primero')
    // «Comida» no está marcada pero tiene algo adentro: llega abierta.
    expect(html).toContain('1 de 4 sale primero')
    expect(html).toContain('1 de sus 2 productos encabezan la comanda')
    const byLabel = new Map(switches(html).map((each) => [each.label, each]))
    expect(byLabel.get('Hamburguesas: sale primero')).toMatchObject({ checked: true })
    expect(byLabel.get('Comida: sale primero')).toMatchObject({ checked: false })
    expect(byLabel.get('Pizza: sale primero')).toMatchObject({ checked: false, disabled: false })
  })

  it('una categoría marcada entera llega cerrada y dice cuántos de sus productos van primero', () => {
    const html = render(
      snapshot({
        categories: CATEGORIES.map((each) =>
          each.id === COMIDA ? { ...each, kitchenFirst: true } : each,
        ),
        items: ITEMS.map((each) => (each.id === WRAP ? { ...each, kitchenFirst: false } : each)),
      }),
    )
    expect(html).toContain('3 de sus 4 productos encabezan la comanda')
    expect(switches(html).find((each) => each.label === 'Comida: sale primero')).toMatchObject({
      checked: true,
      disabled: false,
    })
    // Lo de adentro se abre tocándola: no hace falta mostrarlo para saber qué pasa.
    expect(html).not.toContain(`data-category="${PIZZA}"`)
  })
})

describe('el campo «¿Cuándo se muestra?»', () => {
  const render = (availability: Availability) => {
    const drafts = toDrafts(availability)
    return renderToString(
      createElement(AvailabilityField, {
        drafts: drafts.length === 0 ? null : drafts,
        onChange: () => {},
        timeZone: TZ,
      }),
    )
  }
  const pressed = (html: string, testId: string) =>
    new RegExp(`aria-pressed="true"[^>]*data-testid="${testId}"`).test(html) ||
    new RegExp(`data-testid="${testId}"[^>]*aria-pressed="true"`).test(html)

  it('sin horario: «Siempre» elegido y la oración lo dice', () => {
    const html = render(null)
    expect(html).toContain('¿Cuándo se muestra?')
    expect(pressed(html, 'horario-always')).toBe(true)
    expect(pressed(html, 'horario-weekday-lunch')).toBe(false)
    expect(html).toContain('Se muestra siempre.')
    // Sin franjas a la vista, y sin «ahora»: el reloj es del navegador.
    expect(html).not.toContain('data-testid="horario-franja"')
    expect(html).not.toContain('Ahora')
  })

  it('el menú del mediodía: su atajo, la franja con sus días y horas, y la oración', () => {
    const html = render({ windows: [{ days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' }] })
    expect(pressed(html, 'horario-weekday-lunch')).toBe(true)
    expect(pressed(html, 'horario-otro')).toBe(false)
    expect(html).toContain('Se muestra de lunes a viernes de 12 a 16 h.')
    expect(html).toMatch(
      /data-testid="horario-desde"[^>]*value="12:00"|value="12:00"[^>]*data-testid="horario-desde"/,
    )
    expect(html).toMatch(
      /data-testid="horario-hasta"[^>]*value="16:00"|value="16:00"[^>]*data-testid="horario-hasta"/,
    )
    // Cinco días prendidos y dos apagados, cada uno con su nombre.
    const days = [
      ...html.matchAll(
        /<button[^>]*aria-label="(lunes|martes|miércoles|jueves|viernes|sábados|domingos)"[^>]*>/g,
      ),
    ]
    expect(days).toHaveLength(7)
    expect(days.filter(([tag]) => tag.includes('aria-pressed="true"'))).toHaveLength(5)
  })

  it('un horario propio marca «Otro horario» y avisa si termina al día siguiente', () => {
    const html = render({ windows: [{ days: [4, 5, 6], from: '21:00', to: '02:00' }] })
    expect(pressed(html, 'horario-otro')).toBe(true)
    expect(html).toContain('Se muestra de jueves a sábados de 21 a 2 h.')
    expect(html).toContain('Termina al día siguiente')
  })
})

describe('la carta del mozo con algo fuera de horario', () => {
  const menu: PosMenu = {
    service_day: '2026-11-23',
    categories: [
      { id: 'comida', name: 'Comida', parent_id: null, position: 1, station_id: null },
      {
        id: 'mediodia',
        name: 'Menú del mediodía',
        parent_id: null,
        position: 2,
        station_id: null,
        availability: { windows: [{ days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' }] },
      },
    ],
    items: [
      {
        id: 'pizza',
        name: 'Muzzarella',
        category_id: 'comida',
        position: 1,
        price_cents: 1_200_000,
        description: null,
        station_id: null,
        sold_out: false,
      },
      {
        id: 'ejecutivo',
        name: 'Menú ejecutivo',
        category_id: 'mediodia',
        position: 1,
        price_cents: 900_000,
        description: null,
        station_id: null,
        sold_out: false,
      },
    ],
    stations: [],
    modifier_groups: [],
    popular_now: ['ejecutivo', 'pizza'],
  }
  const index = buildMenuIndex(menu)
  const render = (clock: string) =>
    renderToString(
      createElement(ProductPicker, {
        index,
        offHours: offHoursItems(index, Date.parse(`2026-11-23T${clock}:00-03:00`), TZ),
        quantities: new Map(),
        round: null,
        tableTitle: 'Mesa 4',
        offline: false,
        searchRef: { current: null },
        onAdd: () => {},
        onDec: () => {},
        onMenu: () => {},
        onRepeat: () => {},
        onClose: () => {},
        tray: null,
      }),
    )

  it('al mediodía se ofrece como cualquier otro', () => {
    const html = render('13:00')
    expect(html).toContain('data-testid="tile-ejecutivo"')
    expect(html).not.toContain('is-off')
  })

  it('a la noche no se ofrece en «lo que más sale» y su ficha se ve atenuada', () => {
    const html = render('21:00')
    expect(html).not.toContain('data-testid="tile-ejecutivo"')
    expect(html).toContain('data-testid="tile-pizza"')
    expect(html).toMatch(/class="cmd-chip is-off"[^>]*data-testid="cat-menu del mediodia"/)
    expect(html).toContain('(fuera de horario)')
    expect(html).toMatch(/class="cmd-chip"[^>]*data-testid="cat-comida"/)
  })
})
