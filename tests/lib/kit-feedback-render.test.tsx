// @vitest-environment node
import { Inbox, Lock } from 'lucide-react'
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Progress } from '@/components/ui/progress'
import {
  CardGridSkeleton,
  ListSkeleton,
  Skeleton,
  SkeletonCardGrid,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'
import * as SkeletonList from '@/components/ui/skeleton-list'

/**
 * Kit HUB §3.4, la otra mitad del feedback: avisos en la página, progreso,
 * esqueletos, vacío y error, en el HTML del server. Fija la accesibilidad
 * (roles, nombres, foco) y la compatibilidad con los usos de antes
 * (`EmptyState` ×38, `ListSkeleton` y `CardGridSkeleton` ×5).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    h('a', { href, ...rest }, children),
}))

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** Atributos del primer elemento que tenga `data-slot="<slot>"`. */
function slotAttrs(html: string, slot: string): Record<string, string> {
  const tag = html.match(new RegExp(`<[a-z0-9]+[^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? ''
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', v ?? '']),
  )
}

const classesOf = (html: string, slot: string) =>
  new Set((slotAttrs(html, slot).class ?? '').split(/\s+/).filter(Boolean))

const count = (html: string, needle: string) => html.split(needle).length - 1

const TOUR = { 'data-tour': 'x' } as const

// ─── Callout ─────────────────────────────────────────────────────────────────

describe('Callout', () => {
  it('sin anuncio por defecto: lo que está desde que carga no se anuncia', () => {
    const html = render(h(Callout, { title: 'Solo lectura' }, 'Podés ver y exportar todo.'))
    expect(slotAttrs(html, 'callout').role).toBeUndefined()
    expect(slotAttrs(html, 'callout')['data-tone']).toBe('info')
  })

  it('assertive es role="alert"; polite, role="status"', () => {
    expect(slotAttrs(render(h(Callout, { announce: 'assertive' }, 'x')), 'callout').role).toBe(
      'alert',
    )
    expect(slotAttrs(render(h(Callout, { announce: 'polite' }, 'x')), 'callout').role).toBe(
      'status',
    )
  })

  it('cada tono trae su fondo suave y su ícono; el neutro, sin ícono', () => {
    const tones = [
      ['info', 'bg-info-soft'],
      ['success', 'bg-success-soft'],
      ['warning', 'bg-warning-soft'],
      ['danger', 'bg-destructive-soft'],
    ] as const
    for (const [tone, bg] of tones) {
      const html = render(h(Callout, { tone }, 'x'))
      expect(classesOf(html, 'callout')).toContain(bg)
      expect(slotAttrs(html, 'callout-icon')['aria-hidden']).toBe('true')
    }
    const neutral = render(h(Callout, { tone: 'neutral' }, 'x'))
    expect(classesOf(neutral, 'callout')).toContain('bg-secondary')
    expect(neutral).not.toContain('callout-icon')
    // El «período cerrado»: neutro con candado.
    expect(render(h(Callout, { tone: 'neutral', icon: Lock }, 'x'))).toContain('callout-icon')
    expect(render(h(Callout, { tone: 'danger', icon: false }, 'x'))).not.toContain('callout-icon')
  })

  it('el botón de cerrar existe solo con onDismiss y se llama «Cerrar»', () => {
    expect(render(h(Callout, null, 'x'))).not.toContain('callout-dismiss')
    const html = render(h(Callout, { onDismiss: () => {} }, 'x'))
    const attrs = slotAttrs(html, 'callout-dismiss')
    expect(attrs['aria-label']).toBe('Cerrar')
    expect(attrs.type).toBe('button')
  })

  it('título, cuerpo y acción en sus slots; pasa data-tour', () => {
    const html = render(
      h(
        Callout,
        { ...TOUR, title: 'Septiembre está cerrado', action: h('a', { href: '/x' }, 'Ajuste') },
        'Para corregir, cargá un asiento de ajuste.',
      ),
    )
    expect(slotAttrs(html, 'callout')['data-tour']).toBe('x')
    expect(html).toContain('data-slot="callout-title"')
    expect(html).toContain('data-slot="callout-description"')
    expect(html).toContain('data-slot="callout-action"')
  })
})

// ─── Progress ────────────────────────────────────────────────────────────────

describe('Progress', () => {
  it('determinado: aria-valuenow y el indicador corrido con transform', () => {
    const html = render(h(Progress, { value: 40, label: 'Tareas de la semana' }))
    const attrs = slotAttrs(html, 'progress')
    expect(attrs.role).toBe('progressbar')
    expect(attrs['aria-label']).toBe('Tareas de la semana')
    expect(attrs['aria-valuenow']).toBe('40')
    expect(attrs['aria-valuemin']).toBe('0')
    expect(attrs['aria-valuemax']).toBe('100')
    expect(slotAttrs(html, 'progress-indicator').style).toBe('transform:translateX(-60%)')
  })

  it('recorta fuera de 0–100 y lleva el valueText', () => {
    const html = render(h(Progress, { value: 140, valueText: '5 de 5 tareas' }))
    expect(slotAttrs(html, 'progress')['aria-valuenow']).toBe('100')
    expect(slotAttrs(html, 'progress')['aria-valuetext']).toBe('5 de 5 tareas')
    expect(slotAttrs(html, 'progress')['data-state']).toBe('complete')
  })

  it('indeterminado: sin aria-valuenow, «Cargando» y quieto con reducir movimiento', () => {
    const html = render(h(Progress, { value: null }))
    const attrs = slotAttrs(html, 'progress')
    expect(attrs['aria-valuenow']).toBeUndefined()
    expect(attrs['aria-valuetext']).toBe('Cargando')
    expect(attrs['data-state']).toBe('indeterminate')
    expect(classesOf(html, 'progress-indicator')).toContain('motion-reduce:animate-none')
  })

  it('tono y tamaño; el className de antes (h-2) gana', () => {
    const html = render(h(Progress, { value: 10, tone: 'danger', size: 'sm', className: 'h-2' }))
    expect(classesOf(html, 'progress-indicator')).toContain('bg-destructive')
    expect(classesOf(html, 'progress')).toContain('h-2')
    expect(classesOf(html, 'progress')).not.toContain('h-1')
  })
})

// ─── EmptyState ──────────────────────────────────────────────────────────────

describe('EmptyState: misma API que antes', () => {
  it('icon, title, description, action y className siguen andando', () => {
    const html = render(
      h(EmptyState, {
        icon: Inbox,
        title: 'Todavía no cargaste proveedores',
        description: 'Cargá el primero para llevar su cuenta corriente.',
        action: h('button', { type: 'button' }, 'Nuevo proveedor'),
        // El className de top-customers-card: le sacaba la caja de antes.
        className: 'm-3 border-0 bg-transparent py-8',
      }),
    )
    const cls = classesOf(html, 'empty-state')
    expect(cls).toContain('m-3')
    expect(cls).toContain('py-8')
    expect(cls).not.toContain('py-12')
    expect(html).toContain('Todavía no cargaste proveedores')
    expect(html).toContain('Nuevo proveedor')
    // El título en Fraunces; el disco del ícono, decorativo.
    expect(classesOf(html, 'empty-state-title')).toContain('font-display')
    expect(html).toMatch(/data-slot="empty-state-icon"[^>]*><svg[^>]*aria-hidden="true"/)
  })

  it('sin caja por defecto; dashed para «arrastrá acá»; tamaños', () => {
    const plain = classesOf(render(h(EmptyState, { title: 'x' })), 'empty-state')
    expect(plain).not.toContain('border-dashed')
    expect(plain).toContain('py-12')
    const dashed = classesOf(
      render(h(EmptyState, { title: 'x', variant: 'dashed' })),
      'empty-state',
    )
    expect(dashed).toContain('border-dashed')
    expect(classesOf(render(h(EmptyState, { title: 'x', size: 'sm' })), 'empty-state')).toContain(
      'py-8',
    )
    expect(classesOf(render(h(EmptyState, { title: 'x', size: 'lg' })), 'empty-state')).toContain(
      'py-16',
    )
  })

  it('la secundaria va antes y la principal última; pasa data-tour', () => {
    const html = render(
      h(EmptyState, {
        ...TOUR,
        title: 'Sin resultados',
        action: h('a', { href: '/n' }, 'Principal'),
        secondaryAction: h('a', { href: '/l' }, 'Limpiar filtros'),
      }),
    )
    expect(html.indexOf('Limpiar filtros')).toBeLessThan(html.indexOf('Principal'))
    expect(slotAttrs(html, 'empty-state')['data-tour']).toBe('x')
  })

  it('el título es un div; con headingLevel, un encabezado (el 404 del panel)', () => {
    expect(render(h(EmptyState, { title: 'x' }))).toMatch(/<div[^>]*data-slot="empty-state-title"/)
    const html = render(h(EmptyState, { title: 'No encontramos esta página', headingLevel: 1 }))
    expect(html).toMatch(
      /<h1[^>]*data-slot="empty-state-title"[^>]*>No encontramos esta página<\/h1>/,
    )
  })
})

// ─── Skeleton ────────────────────────────────────────────────────────────────

describe('Skeleton y presets', () => {
  it('bg-skeleton con pulso que se apaga con reducir movimiento', () => {
    const cls = classesOf(render(h(Skeleton, { className: 'h-4 w-24' })), 'skeleton')
    expect(cls).toContain('bg-skeleton')
    expect(cls).toContain('motion-reduce:animate-none')
    expect(cls).toContain('h-4')
  })

  it('skeleton-list sigue exportando ListSkeleton y CardGridSkeleton', () => {
    expect(SkeletonList.ListSkeleton).toBe(ListSkeleton)
    expect(SkeletonList.CardGridSkeleton).toBe(CardGridSkeleton)
    expect(CardGridSkeleton).toBe(SkeletonCardGrid)
    const list = render(h(SkeletonList.ListSkeleton, { rows: 8 }))
    expect(count(list, 'data-slot="skeleton"')).toBe(8 * 4)
    expect(slotAttrs(list, 'skeleton-list')['aria-hidden']).toBe('true')
    expect(count(render(h(SkeletonList.CardGridSkeleton, { count: 3 })), 'rounded-xl border')).toBe(
      3,
    )
  })

  it('SkeletonTable: filas del alto de la densidad y tarjetas en el celular', () => {
    const comfortable = render(h(SkeletonTable, { rows: 4, columns: 3 }))
    expect(count(comfortable, 'h-(--row-comfortable)')).toBe(4)
    expect(count(comfortable, '<li ')).toBe(4)
    const compact = render(h(SkeletonTable, { rows: 2, density: 'compact', mobile: 'scroll' }))
    expect(count(compact, 'h-(--row-compact)')).toBe(2)
    expect(compact).not.toContain('<li ')
    // Una sola columna no arma un `repeat(0, …)` inválido.
    expect(render(h(SkeletonTable, { rows: 1, columns: 1 }))).not.toContain('repeat(0')
  })

  it('SkeletonPageHeader copia el alto del título y suma acciones', () => {
    const html = render(h(SkeletonPageHeader, { actions: 2, context: true }))
    expect(html).toContain('h-[2.125rem]')
    expect(count(html, 'h-(--control-md)')).toBe(2)
  })

  it('SkeletonKPIGroup: con impares, el último completa la fila', () => {
    const html = render(h(SkeletonKPIGroup, { count: 3 }))
    expect(html).toContain('md:grid-cols-3')
    expect(html).toContain('col-span-2 md:col-span-1')
  })

  it('SkeletonStatus anuncia «Cargando…» una vez, para lectores de pantalla', () => {
    const html = render(h(SkeletonStatus))
    expect(slotAttrs(html, 'skeleton-status').role).toBe('status')
    expect(classesOf(html, 'skeleton-status')).toContain('sr-only')
    expect(html).toContain('Cargando…')
  })
})

// ─── ErrorState ──────────────────────────────────────────────────────────────

describe('ErrorState', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const boom = Object.assign(new Error('falló la consulta de Juan Pérez 351-555-0101'), {
    digest: '2638491053abcdef',
  })

  it('en página: encabezado enfocable, código corto y nunca el mensaje', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const html = render(h(ErrorState, { error: boom, onRetry: () => {}, homeHref: '/hub' }))
    const title = slotAttrs(html, 'error-state-title')
    expect(html).toMatch(/<h2[^>]*data-slot="error-state-title"/)
    expect(title.tabindex).toBe('-1')
    expect(slotAttrs(html, 'error-state').role).toBeUndefined()
    expect(html).toContain('No pudimos cargar esto')
    expect(html).toContain('avisanos con este código')
    expect(html).toContain('Código: <span class="font-mono">26384910…</span>')
    expect(html).not.toContain('Juan Pérez')
    expect(html).toContain('Reintentar')
    expect(html).toContain('Ir al Resumen')
  })

  it('en línea (size="sm"): role="alert" y sin encabezado', () => {
    const html = render(h(ErrorState, { size: 'sm', title: 'No cargaron los movimientos' }))
    expect(slotAttrs(html, 'error-state').role).toBe('alert')
    expect(html).not.toContain('<h2')
    // Sin digest no promete un código.
    expect(html).toContain('Probá de nuevo. Si sigue pasando, avisanos.')
    expect(html).not.toContain('Código:')
  })

  it('el mensaje del error se ve solo en desarrollo', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(render(h(ErrorState, { error: boom }))).toContain('error-state-dev-message')
    vi.stubEnv('NODE_ENV', 'test')
    expect(render(h(ErrorState, { error: boom }))).not.toContain('Juan Pérez')
  })

  it('sin reintento, la salida es la principal; pasa data-tour', () => {
    const html = render(h(ErrorState, { ...TOUR, homeHref: '/hub', homeLabel: 'Volver' }))
    expect(html).toContain('href="/hub"')
    expect(html).toContain('Volver')
    expect(html).not.toContain('Reintentar')
    expect(slotAttrs(html, 'error-state')['data-tour']).toBe('x')
  })

  it('el error.tsx de un segmento puede pedir h1 (reemplaza a la página)', () => {
    const html = render(
      h(ErrorState, { headingLevel: 1, title: 'Algo se rompió en esta pantalla' }),
    )
    expect(html).toMatch(/<h1[^>]*data-slot="error-state-title"/)
    expect(html).not.toContain('<h2')
  })
})
