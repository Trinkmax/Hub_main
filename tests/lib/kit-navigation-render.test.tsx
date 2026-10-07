// @vitest-environment node
import { History, Users, Workflow } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChipGroup, FilterChip } from '@/components/ui/filter-chip'
import { SectionNav } from '@/components/ui/section-nav'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SlidingTabs } from '@/components/ui/sliding-tabs'
import { Stepper } from '@/components/ui/stepper'
import { Steps } from '@/components/ui/steps'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TabsNav } from '@/components/ui/tabs-nav'

/**
 * Kit HUB, navegación dentro de una página (§3.3): lo que sale en el primer
 * HTML. Roles y ARIA (tablist/tab/tabpanel, radiogroup/radio, nav con
 * aria-current, aria-pressed, aria-current="step"), `data-tour` que llega al
 * DOM (los anclajes de los tours) y las compatibilidades: `SlidingTabs` y
 * `Stepper` siguen andando con sus props de siempre.
 */

// usePathname afuera de Next devuelve null: se fija uno por test.
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return { ...actual, usePathname: () => nav.pathname }
})

const html = (node: React.ReactElement) => renderToString(node)

/** React escapa `& < > " '` en los atributos: se vuelven a leer como en el DOM. */
function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Las etiquetas de apertura que matchean `selector`, con sus atributos. */
function tags(markup: string, selector: RegExp): Array<Record<string, string>> {
  const flags = selector.flags.includes('g') ? selector.flags : `${selector.flags}g`
  return [...markup.matchAll(new RegExp(selector.source, flags))].map((m) =>
    Object.fromEntries(
      [...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', decode(v ?? '')]),
    ),
  )
}

function only(markup: string, selector: RegExp): Record<string, string> {
  const found = tags(markup, selector)
  if (found.length !== 1) throw new Error(`esperaba 1 ${selector}, hay ${found.length}`)
  return found[0] as Record<string, string>
}

const textOf = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '')

describe('Tabs: pestañas subrayadas con los mismos exports de Radix', () => {
  const tree = (
    <Tabs defaultValue="visitas">
      <TabsList data-tour="cliente-tabs" aria-label="Ficha">
        <TabsTrigger value="visitas" icon={Users}>
          Visitas
        </TabsTrigger>
        <TabsTrigger value="resenas" count={1234}>
          Reseñas
        </TabsTrigger>
        <TabsTrigger value="notas" disabled>
          Notas
        </TabsTrigger>
      </TabsList>
      <TabsContent value="visitas" data-tour="cliente-visitas">
        Lista de visitas
      </TabsContent>
      <TabsContent value="resenas" forceMount>
        Lista de reseñas
      </TabsContent>
      <TabsContent value="notas">Notas privadas</TabsContent>
    </Tabs>
  )
  const out = html(tree)

  it('tablist con data-tour y las props de la lista', () => {
    const list = only(out, /<div[^>]*role="tablist"[^>]*>/)
    expect(list['data-tour']).toBe('cliente-tabs')
    expect(list['data-slot']).toBe('tabs-list')
    expect(list['aria-label']).toBe('Ficha')
    expect(list['aria-orientation']).toBe('horizontal')
  })

  it('la activa es aria-selected y controla su panel; el panel se nombra con su pestaña', () => {
    const triggers = tags(out, /<button[^>]*role="tab"[^>]*>/)
    expect(triggers).toHaveLength(3)
    const [visitas, resenas, notas] = triggers
    expect(visitas?.['aria-selected']).toBe('true')
    expect(visitas?.['data-state']).toBe('active')
    expect(resenas?.['aria-selected']).toBe('false')
    expect(notas?.disabled).toBe('')
    const panel = only(out, /<div[^>]*data-tour="cliente-visitas"[^>]*>/)
    expect(panel.role).toBe('tabpanel')
    expect(panel['aria-labelledby']).toBe(visitas?.id)
    expect(visitas?.['aria-controls']).toBe(panel.id)
  })

  it('el subrayado es un borde del disparador (sobrevive al alto contraste)', () => {
    const cls = (tags(out, /<button[^>]*role="tab"[^>]*>/)[0]?.class ?? '').split(/\s+/)
    expect(cls).toContain('border-b-2')
    expect(cls).toContain('data-[state=active]:border-primary')
    expect(cls).toContain('forced-colors:data-[state=active]:border-[Highlight]')
    expect(cls).toContain('-outline-offset-2')
  })

  it('icon y count: el ícono es decorativo y el contador va en cifras de es-AR', () => {
    const icon = only(out, /<svg[^>]*lucide-users[^>]*>/)
    expect(icon['aria-hidden']).toBe('true')
    expect(icon['stroke-width']).toBe('1.75')
    expect(out).toContain('data-slot="tabs-count"')
    expect(out).toContain('>1.234</span>')
  })

  it('forceMount deja montado el inactivo y se oculta solo; el resto no se monta', () => {
    const panels = tags(out, /<div[^>]*role="tabpanel"[^>]*>/)
    const forced = panels.find((p) => p.id?.endsWith('-content-resenas'))
    expect(forced?.['data-state']).toBe('inactive')
    // Radix no le pone `hidden` a un forceMount: lo oculta la clase del kit.
    expect(forced?.hidden).toBeUndefined()
    expect(forced?.class?.split(/\s+/)).toContain('data-[state=inactive]:hidden')
    expect(textOf(out)).toContain('Lista de reseñas')
    expect(textOf(out)).not.toContain('Notas privadas')
  })

  it('con syncParam arranca en el default del server', () => {
    const synced = html(
      <Tabs syncParam="tab" defaultValue="puntos">
        <TabsList>
          <TabsTrigger value="visitas">Visitas</TabsTrigger>
          <TabsTrigger value="puntos">Puntos</TabsTrigger>
        </TabsList>
        <TabsContent value="puntos">Saldo</TabsContent>
      </Tabs>,
    )
    const selected = tags(synced, /<button[^>]*role="tab"[^>]*>/).filter(
      (t) => t['aria-selected'] === 'true',
    )
    expect(selected.map((t) => t.id?.endsWith('-trigger-puntos'))).toEqual([true])
    expect(textOf(synced)).toContain('Saldo')
  })

  it('controlado: manda value (como calendar-tabs y landing-editor)', () => {
    const controlled = html(
      <Tabs value="lista" onValueChange={() => {}}>
        <TabsList>
          <TabsTrigger value="plano">Plano</TabsTrigger>
          <TabsTrigger value="lista">Lista</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const [plano, lista] = tags(controlled, /<button[^>]*role="tab"[^>]*>/)
    expect(plano?.['aria-selected']).toBe('false')
    expect(lista?.['aria-selected']).toBe('true')
  })
})

describe('TabsNav: subpáginas por ruta (links, no tabs)', () => {
  beforeEach(() => {
    nav.pathname = '/hub/mensajeria/flows/1/registros'
  })

  it('<nav> con nombre; aria-current solo en el path más específico', () => {
    const out = html(
      <TabsNav
        aria-label="Secciones de la automatización"
        data-tour="flow-tabs"
        items={[
          { href: '/hub/mensajeria/flows/1', label: 'Creador', icon: Workflow },
          {
            href: '/hub/mensajeria/flows/1/registros',
            label: 'Registros',
            icon: History,
            count: 3,
          },
        ]}
      />,
    )
    const root = only(out, /<nav[^>]*>/)
    expect(root['aria-label']).toBe('Secciones de la automatización')
    expect(root['data-tour']).toBe('flow-tabs')
    expect(out).not.toContain('role="tab')
    const links = tags(out, /<a[^>]*>/)
    expect(links.map((l) => [l.href, l['aria-current'] ?? null])).toEqual([
      ['/hub/mensajeria/flows/1', null],
      ['/hub/mensajeria/flows/1/registros', 'page'],
    ])
    expect(links[1]?.['data-state']).toBe('active')
    // Los íconos llegan dibujados (el componente se resuelve del lado server-safe).
    expect(out.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(2)
  })
})

describe('SectionNav: columna desde lg, fila de pestañas en el celular', () => {
  beforeEach(() => {
    nav.pathname = '/hub/configuracion/comisiones'
  })

  const items = [
    { href: '/hub/configuracion/equipo', label: 'Miembros', group: 'Equipo', icon: Users },
    { href: '/hub/configuracion/comisiones', label: 'Comisiones', group: 'Equipo' },
    { href: '/hub/configuracion/salon', label: 'Capacidad', group: 'Salón' },
  ]

  it('un solo landmark con las dos vistas; el activo marcado en las dos', () => {
    const out = html(<SectionNav aria-label="Secciones de Configuración" items={items} />)
    expect(tags(out, /<nav[^>]*>/)).toHaveLength(1)
    expect(only(out, /<nav[^>]*>/)['aria-label']).toBe('Secciones de Configuración')
    expect(out).toContain('data-slot="section-nav-row"')
    expect(out).toContain('data-slot="section-nav-column"')
    const current = tags(out, /<a[^>]*aria-current="page"[^>]*>/)
    expect(current.map((l) => l.href)).toEqual([
      '/hub/configuracion/comisiones',
      '/hub/configuracion/comisiones',
    ])
  })

  it('los grupos nombran su lista (el título es el aria-labelledby)', () => {
    const out = html(<SectionNav aria-label="Secciones de Configuración" items={items} />)
    const headings = tags(out, /<p[^>]*id="[^"]*"[^>]*>/)
    const lists = tags(out, /<ul[^>]*>/)
    expect(headings).toHaveLength(2)
    expect(lists.map((l) => l['aria-labelledby'])).toEqual(headings.map((h) => h.id))
    expect(textOf(out)).toContain('Equipo')
    expect(textOf(out)).toContain('Salón')
  })
})

describe('SegmentedControl: filtro de una sola opción', () => {
  const items = [
    { value: 'all', label: 'Todos', count: 1234 },
    { value: 'with_points', label: 'Con puntos' },
    { value: 'contact_only', label: 'Solo contacto', disabled: true },
  ] as const

  it('modo radio: radiogroup con nombre y radios con aria-checked', () => {
    const out = html(
      <SegmentedControl
        aria-label="Segmento de clientes"
        data-tour="clientes-segmento"
        items={items}
        defaultValue="with_points"
      />,
    )
    const group = only(out, /<div[^>]*role="radiogroup"[^>]*>/)
    expect(group['aria-label']).toBe('Segmento de clientes')
    expect(group['data-tour']).toBe('clientes-segmento')
    const radios = tags(out, /<button[^>]*role="radio"[^>]*>/)
    expect(radios.map((r) => [r.value, r['aria-checked'], r['data-state']])).toEqual([
      ['all', 'false', 'unchecked'],
      ['with_points', 'true', 'checked'],
      ['contact_only', 'false', 'unchecked'],
    ])
    expect(radios.every((r) => r.type === 'button')).toBe(true)
    expect(radios[2]?.disabled).toBe('')
    expect(out).toContain('>1.234</span>')
  })

  it('la elegida es cartulina con contorno verde (no una píldora con sombra)', () => {
    const out = html(<SegmentedControl aria-label="Vista" items={items} value="all" />)
    const cls = (tags(out, /<button[^>]*role="radio"[^>]*>/)[0]?.class ?? '').split(/\s+/)
    expect(cls).toContain('data-[state=checked]:border-primary')
    expect(cls).toContain('data-[state=checked]:bg-card')
    expect(cls.some((c) => c.startsWith('shadow'))).toBe(false)
  })

  it('modo link: si todos traen href es un <nav> con aria-current en el elegido', () => {
    const out = html(
      <SegmentedControl
        aria-label="Filtrar reseñas por estrellas"
        value="5"
        items={[
          { value: 'all', label: 'Todas', href: '/hub/reviews' },
          { value: '5', label: '5', href: '/hub/reviews?rating=5' },
          { value: '1', label: '1', href: '/hub/reviews?rating=1', disabled: true },
        ]}
      />,
    )
    expect(out).not.toContain('radiogroup')
    expect(only(out, /<nav[^>]*>/)['aria-label']).toBe('Filtrar reseñas por estrellas')
    const links = tags(out, /<a[^>]*>/)
    expect(links.map((l) => [l.href, l['aria-current'] ?? null])).toEqual([
      ['/hub/reviews', null],
      ['/hub/reviews?rating=5', 'page'],
    ])
    // El deshabilitado no es un link: queda como texto fuera del orden de Tab.
    expect(only(out, /<span[^>]*data-disabled=""[^>]*>/)['data-slot']).toBe('segmented-option')
  })

  it('el tamaño explícito fija el alto del control; sin él, el de la fila o md', () => {
    expect(html(<SegmentedControl aria-label="x" size="sm" items={items} />)).toContain(
      'h-(--control-sm)',
    )
    expect(html(<SegmentedControl aria-label="x" items={items} />)).toContain('h-(--control-md)')
  })
})

describe('SlidingTabs: compatibilidad (envoltorio de SegmentedControl)', () => {
  it('mismas props de siempre; aria-label por defecto «Vista»', () => {
    const out = html(
      <SlidingTabs
        size="sm"
        className="max-w-full overflow-x-auto"
        value="evento"
        onChange={() => {}}
        tabs={[
          { value: 'dia', label: 'Por día' },
          { value: 'evento', label: 'Por evento' },
        ]}
      />,
    )
    const group = only(out, /<div[^>]*role="radiogroup"[^>]*>/)
    expect(group['aria-label']).toBe('Vista')
    expect(group.class?.split(/\s+/)).toContain('overflow-x-auto')
    const checked = tags(out, /<button[^>]*role="radio"[^>]*>/).filter(
      (r) => r['aria-checked'] === 'true',
    )
    expect(checked.map((r) => r.value)).toEqual(['evento'])
    expect(out).not.toContain('role="tablist"')
  })

  it('acepta otro nombre y pasa data-*', () => {
    const out = html(
      <SlidingTabs
        aria-label="Nivel"
        data-tour="club-tabs"
        value="a"
        onChange={() => {}}
        tabs={[{ value: 'a', label: 'A' }]}
      />,
    )
    const group = only(out, /<div[^>]*role="radiogroup"[^>]*>/)
    expect(group['aria-label']).toBe('Nivel')
    expect(group['data-tour']).toBe('club-tabs')
  })
})

describe('FilterChip y ChipGroup: filtros que se suman', () => {
  it('botón con aria-pressed; el activo suma el check (forma, no solo color)', () => {
    const off = html(<FilterChip>Mesas de 2</FilterChip>)
    const offTag = only(off, /<button[^>]*>/)
    expect(offTag['aria-pressed']).toBe('false')
    expect(offTag.type).toBe('button')
    expect(off).not.toContain('filter-chip-check')

    const on = html(
      <FilterChip defaultPressed icon={Users} count={12} data-tour="chip">
        Mesas de 4
      </FilterChip>,
    )
    const onTag = only(on, /<button[^>]*>/)
    expect(onTag['aria-pressed']).toBe('true')
    expect(onTag['data-state']).toBe('on')
    expect(onTag['data-tour']).toBe('chip')
    expect(on).toContain('data-slot="filter-chip-check"')
    // El check reemplaza al ícono mientras está activo.
    expect(on).not.toContain('lucide-users')
    expect(on).toContain('>12</span>')
  })

  it('controlado: pressed manda sobre defaultPressed', () => {
    const out = html(
      <FilterChip pressed={false} defaultPressed>
        Almuerzo
      </FilterChip>,
    )
    expect(only(out, /<button[^>]*>/)['aria-pressed']).toBe('false')
  })

  it('como <Link> lleva aria-current en vez de aria-pressed', () => {
    const out = html(
      <FilterChip asChild pressed>
        <Link href="/hub/reservas?rango=hoy">Hoy</Link>
      </FilterChip>,
    )
    const link = only(out, /<a[^>]*>/)
    expect(link['aria-current']).toBe('page')
    expect(link['aria-pressed']).toBeUndefined()
    expect(link.href).toBe('/hub/reservas?rango=hoy')
    expect(link['data-slot']).toBe('filter-chip')
    expect(out).not.toContain('<button')
    expect(textOf(out)).toBe('Hoy')
  })

  it('el grupo es un fieldset (rol group) con nombre', () => {
    const out = html(
      <ChipGroup aria-label="Tamaño de la mesa">
        <FilterChip>2</FilterChip>
      </ChipGroup>,
    )
    const group = only(out, /<fieldset[^>]*>/)
    expect(group['aria-label']).toBe('Tamaño de la mesa')
    expect(group['data-slot']).toBe('chip-group')
  })
})

describe('Steps y Stepper: pasos de un asistente', () => {
  const steps = [
    { label: 'Cliente', description: 'Buscá o creá' },
    { label: 'Consumo', description: 'Cargá los ítems' },
    { label: 'Confirmar' },
  ]

  it('<ol> con aria-current="step" en el actual; los hechos lo dicen al lector', () => {
    const out = html(<Steps steps={steps} current={1} data-tour="wizard-steps" />)
    expect(only(out, /<ol[^>]*>/)['data-tour']).toBe('wizard-steps')
    const items = tags(out, /<li[^>]*>/)
    expect(items.map((i) => [i['data-status'], i['aria-current'] ?? null])).toEqual([
      ['done', null],
      ['current', 'step'],
      ['upcoming', null],
    ])
    expect(textOf(out)).toContain('(listo)')
  })

  it('en el celular se ve solo el actual, con contexto', () => {
    const out = html(<Steps steps={steps} current={1} />)
    expect(textOf(out)).toContain('Paso 2 de 3 · Consumo')
    const [done, current, upcoming] = tags(out, /<li[^>]*>/)
    expect(done?.class?.split(/\s+/)).toContain('hidden')
    expect(current?.class?.split(/\s+/)).not.toContain('hidden')
    expect(upcoming?.class?.split(/\s+/)).toContain('hidden')
  })

  it('Stepper es Steps con otro nombre: mismo HTML', () => {
    expect(html(<Stepper steps={steps} current={2} />)).toBe(
      html(<Steps steps={steps} current={2} />),
    )
  })
})
