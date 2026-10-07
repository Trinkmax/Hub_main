import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolvePressed } from '@/components/ui/filter-chip'
import { activeNavHref, groupNavItems } from '@/components/ui/route-nav'
import { isSegmentedLinkMode } from '@/components/ui/segmented-control'
import { stepCaption, stepStatus, visibleStepIndex } from '@/components/ui/steps'
import {
  nearestScrollLeft,
  overflowEdges,
  searchWithParam,
  tabForUrlChange,
} from '@/components/ui/tabs'

/**
 * Kit HUB, navegación dentro de una página (§3.3): la lógica pura detrás de
 * las pestañas, la navegación por rutas, el segmentado, los chips y los
 * pasos. Lo que maneja Radix (flechas, Inicio/Fin, roving tabindex) no se
 * reimplementa: se prueba el cableado en el render (kit-navigation-render).
 */

describe('searchWithParam: ?<param>= de las pestañas con syncParam', () => {
  it('agrega el parámetro y conserva los demás', () => {
    expect(searchWithParam('?q=ana&page=2', 'tab', 'puntos')).toBe('?q=ana&page=2&tab=puntos')
    expect(searchWithParam('', 'tab', 'datos')).toBe('?tab=datos')
  })

  it('reemplaza el valor que había, en su lugar', () => {
    expect(searchWithParam('?tab=visitas&q=ana', 'tab', 'notas')).toBe('?tab=notas&q=ana')
  })

  it('devuelve null si la URL ya dice eso: no se escribe el historial de gusto', () => {
    expect(searchWithParam('?tab=notas', 'tab', 'notas')).toBeNull()
  })

  it('codifica lo que no es seguro en una URL', () => {
    expect(searchWithParam('', 'vista', 'por evento')).toBe('?vista=por+evento')
  })
})

describe('tabForUrlChange: la URL cambió desde afuera (menú, atrás, adelante)', () => {
  it('un link del menú a ?tab=aliados elige Aliados', () => {
    expect(tabForUrlChange('aliados', 'programa', 'programa')).toBe('aliados')
  })

  it('la URL que escribimos nosotros ya coincide: no se toca nada', () => {
    expect(tabForUrlChange('puntos', 'programa', 'puntos')).toBeNull()
  })

  it('sin parámetro vuelve al default del server', () => {
    expect(tabForUrlChange(null, 'programa', 'aliados')).toBe('programa')
    expect(tabForUrlChange(null, undefined, 'aliados')).toBeNull()
  })
})

describe('overflowEdges: de qué lado queda contenido escondido', () => {
  it('sin scroll, nada', () => {
    expect(overflowEdges(0, 300, 300)).toBe('none')
  })

  it('al principio de una fila que no entra, a la derecha', () => {
    expect(overflowEdges(0, 300, 500)).toBe('end')
  })

  it('al medio, de los dos lados; al final, a la izquierda', () => {
    expect(overflowEdges(100, 300, 500)).toBe('both')
    expect(overflowEdges(200, 300, 500)).toBe('start')
  })

  it('tolera el redondeo de anchos con decimales (un píxel)', () => {
    expect(overflowEdges(0.5, 300, 300.6)).toBe('none')
    expect(overflowEdges(199.4, 300, 500)).toBe('start')
  })
})

describe('nearestScrollLeft: la activa a la vista sin mover la página', () => {
  const view = { scrollLeft: 0, clientWidth: 300, scrollWidth: 800 }

  it('si ya se ve entera (con el aire de la máscara), no se mueve', () => {
    expect(nearestScrollLeft(view, { left: 50, width: 80 }, 32)).toBe(0)
  })

  it('si está a la derecha, corre lo justo para que termine antes de la máscara', () => {
    // termina en 520 + 32 de aire: 552 − 300 visibles.
    expect(nearestScrollLeft(view, { left: 440, width: 80 }, 32)).toBe(252)
  })

  it('si está a la izquierda, la deja al principio con aire', () => {
    expect(nearestScrollLeft({ ...view, scrollLeft: 400 }, { left: 120, width: 80 }, 32)).toBe(88)
  })

  it('no se pasa de los bordes', () => {
    expect(nearestScrollLeft(view, { left: 760, width: 40 }, 32)).toBe(500)
    expect(nearestScrollLeft({ ...view, scrollLeft: 200 }, { left: 10, width: 40 }, 32)).toBe(0)
  })

  it('más ancha que lo visible: se ve el principio, que es donde se lee', () => {
    expect(nearestScrollLeft({ ...view, scrollLeft: 50 }, { left: 100, width: 400 }, 0)).toBe(100)
  })
})

describe('activeNavHref: qué link de TabsNav y SectionNav está prendido', () => {
  const flow = [{ href: '/hub/mensajeria/flows/1' }, { href: '/hub/mensajeria/flows/1/registros' }]

  it('gana el path más largo que matchea: no se prenden dos', () => {
    expect(activeNavHref('/hub/mensajeria/flows/1/registros', flow)).toBe(
      '/hub/mensajeria/flows/1/registros',
    )
    expect(activeNavHref('/hub/mensajeria/flows/1', flow)).toBe('/hub/mensajeria/flows/1')
  })

  it('las subrutas cuentan, salvo con exact', () => {
    expect(
      activeNavHref('/hub/configuracion/equipo/nuevo', [{ href: '/hub/configuracion/equipo' }]),
    ).toBe('/hub/configuracion/equipo')
    expect(
      activeNavHref('/hub/configuracion/equipo', [{ href: '/hub/configuracion', exact: true }]),
    ).toBeNull()
  })

  it('compara solo el path (la query del href no cuenta)', () => {
    expect(activeNavHref('/hub/reviews', [{ href: '/hub/reviews?rating=5' }])).toBe(
      '/hub/reviews?rating=5',
    )
  })

  it('un prefijo que no es un segmento entero no matchea', () => {
    expect(activeNavHref('/hub/clientes-viejos', [{ href: '/hub/clientes' }])).toBeNull()
  })

  it('con dos del mismo path gana el primero', () => {
    expect(activeNavHref('/hub/x', [{ href: '/hub/x?a=1' }, { href: '/hub/x?a=2' }])).toBe(
      '/hub/x?a=1',
    )
  })
})

describe('groupNavItems: los grupos de la columna de SectionNav', () => {
  it('agrupa en el orden en que aparece cada grupo, aunque vengan salteados', () => {
    const groups = groupNavItems([
      { id: 'miembros', group: 'Equipo' },
      { id: 'capacidad', group: 'Salón' },
      { id: 'comisiones', group: 'Equipo' },
      { id: 'suelto', group: undefined },
    ])
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Equipo', ['miembros', 'comisiones']],
      ['Salón', ['capacidad']],
      [undefined, ['suelto']],
    ])
  })
})

describe('isSegmentedLinkMode: radio o links', () => {
  it('es modo link solo si todos los ítems traen href', () => {
    expect(isSegmentedLinkMode([{ href: '/a' }, { href: '/b' }])).toBe(true)
    expect(isSegmentedLinkMode([{ href: '/a' }, {}])).toBe(false)
    expect(isSegmentedLinkMode([])).toBe(false)
  })
})

describe('resolvePressed: el chip controlado manda', () => {
  it('usa pressed si vino; si no, el estado propio', () => {
    expect(resolvePressed(true, false)).toBe(true)
    expect(resolvePressed(false, true)).toBe(false)
    expect(resolvePressed(undefined, true)).toBe(true)
  })
})

describe('Steps: estado de cada paso y el contexto del celular', () => {
  const steps = [{ label: 'Cliente' }, { label: 'Consumo' }, { label: 'Confirmar' }]

  it('antes del actual, hechos; después, por venir', () => {
    expect([0, 1, 2].map((i) => stepStatus(i, 1))).toEqual(['done', 'current', 'upcoming'])
  })

  it('«Paso 2 de 3 · Consumo»', () => {
    expect(stepCaption(steps, 1)).toBe('Paso 2 de 3 · Consumo')
  })

  it('acota el paso que se ve en el celular a la lista', () => {
    expect(visibleStepIndex(5, 3)).toBe(2)
    expect(visibleStepIndex(-1, 3)).toBe(0)
    expect(visibleStepIndex(0, 0)).toBe(-1)
    expect(stepCaption([], 0)).toBe('')
  })
})

describe('reglas del kit en los archivos de navegación (§2.13 y §3.0)', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url))
  const FILES = [
    'components/ui/tabs.tsx',
    'components/ui/route-nav.tsx',
    'components/ui/tabs-nav.tsx',
    'components/ui/section-nav.tsx',
    'components/ui/segmented-control.tsx',
    'components/ui/filter-chip.tsx',
    'components/ui/steps.tsx',
    'components/ui/stepper.tsx',
    'components/ui/sliding-tabs.tsx',
  ]

  it.each(FILES)('%s: sin -[--x], sin dark:, foco con outline, sin texto de 9–11 px', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    expect(source).not.toMatch(/-\[--/)
    expect(source).not.toMatch(/\bdark:/)
    expect(source).not.toMatch(/focus(-visible)?:ring/)
    expect(source).not.toMatch(/text-\[(9|10|11)px\]/)
    expect(source).not.toMatch(/transition-all/)
  })

  it('las piezas server-safe no se marcan como cliente (las usan los layouts)', () => {
    for (const file of [
      'components/ui/tabs-nav.tsx',
      'components/ui/section-nav.tsx',
      'components/ui/steps.tsx',
      'components/ui/stepper.tsx',
    ]) {
      expect(readFileSync(join(ROOT, file), 'utf8').startsWith("'use client'"), file).toBe(false)
    }
  })
})
