// @vitest-environment node
import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GuidedTour, TourBackdrop, TourCard } from '@/components/tour/guided-tour'
import type { TourDefinition, TourStep } from '@/components/tour/types'

/**
 * La tarjeta del tour guiado con el kit HUB, en el HTML del server (§7.d: se
 * reestila la tarjeta, pero ids, `localStorage` y anclajes no cambian).
 *
 * Lo que se fija:
 * 1. El velo usa el token `--overlay` (el de los diálogos), nunca un rgba.
 * 2. La tarjeta tiene el vocabulario del diálogo del kit: cartulina que flota,
 *    pelo con token y sin opacidad, sombra modal, título de sección (no
 *    Fraunces), cuerpo de 14 px y kicker de 12 px.
 * 3. La X es el botón fantasma del kit: 44 px de área con el dedo, hover con
 *    `--hover` y foco con `outline`.
 * 4. Con «reducir movimiento» la tarjeta solo funde y el spotlight no se
 *    desliza.
 *
 * En el server los efectos no corren: `GuidedTour` abierto dibuja el primer
 * paso centrado (sin target medido) y con todos los pasos.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** Atributos del primer elemento que tenga `data-slot="<slot>"`. */
function slotAttrs(html: string, slot: string): Record<string, string> {
  const tag = html.match(new RegExp(`<[a-z0-9]+[^>]*\\sdata-slot="${slot}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`no hay data-slot="${slot}" en:\n${html}`)
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', v ?? '']),
  )
}

const classesOf = (html: string, slot: string) =>
  new Set((slotAttrs(html, slot).class ?? '').split(/\s+/).filter(Boolean))

/** El texto que se ve adentro del primer elemento con ese `data-slot` (sin lo `sr-only`). */
function slotText(html: string, slot: string): string {
  const start = html.search(new RegExp(`<([a-z0-9]+)[^>]*\\sdata-slot="${slot}"`))
  if (start === -1) throw new Error(`no hay data-slot="${slot}"`)
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1] ?? 'div'
  const end = html.indexOf(`</${tag}>`, start)
  return html
    .slice(start, end)
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** El texto de los botones, en orden. */
const buttonTexts = (html: string) =>
  [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) =>
    (inner ?? '').replace(/<[^>]+>/g, '').trim(),
  )

/** Clases de borde con modificador de opacidad (`border-border/60`). */
const translucentBorders = (classes: Set<string>) =>
  [...classes].filter((c) => /^(?:[\w-]+:)*(?:border|ring|outline)-[\w()-]+\/\d+$/.test(c))

const STEPS: TourStep[] = [
  {
    id: 'bienvenida',
    title: 'Acá se arma la carta',
    body: 'Todo lo que cargues en esta pantalla es lo que ven los clientes.',
  },
  {
    id: 'fotos',
    target: '[data-tour="menu-categorias"]',
    kicker: 'Lo más importante 📸',
    title: 'La foto es la que vende',
    body: h('ul', null, h('li', null, 'Arrastrá la imagen o tocá «Subir foto».')),
    demo: h('span', null, 'Soltá la foto acá'),
  },
  {
    id: 'listo',
    title: 'Ya podés cargar la carta',
    body: 'Esta guía queda siempre en «¿Cómo funciona?».',
  },
]

const TOUR: TourDefinition = { id: 'carta-media@1', title: 'Cargar la carta', steps: STEPS }

const card = (stepIndex: number, overrides: Partial<Parameters<typeof TourCard>[0]> = {}) => {
  const step = STEPS[stepIndex]
  if (!step) throw new Error(`no hay paso ${stepIndex}`)
  return render(
    h(TourCard, {
      step,
      rect: null,
      index: stepIndex,
      total: STEPS.length,
      isLast: stepIndex === STEPS.length - 1,
      onPrev: vi.fn(),
      onNext: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    }),
  )
}

describe('GuidedTour en el server', () => {
  it('cerrado, o sin pasos, no dibuja nada', () => {
    expect(render(h(GuidedTour, { tour: TOUR, open: false, onClose: vi.fn() }))).toBe('')
    expect(
      render(h(GuidedTour, { tour: { ...TOUR, steps: [] }, open: true, onClose: vi.fn() })),
    ).toBe('')
  })

  it('abierto: diálogo modal con el velo del kit y la tarjeta centrada', () => {
    const html = render(h(GuidedTour, { tour: TOUR, open: true, onClose: vi.fn() }))

    const root = slotAttrs(html, 'tour')
    expect(root.role).toBe('dialog')
    expect(root['aria-modal']).toBe('true')
    expect(root['aria-label']).toBe('Tutorial: Cargar la carta')

    // Sin target medido, el velo entero, con el token y no con un rgba.
    expect(slotAttrs(html, 'tour-scrim')['aria-hidden']).toBe('true')
    expect(classesOf(html, 'tour-scrim')).toContain('bg-overlay')
    expect(html).not.toMatch(/rgba?\(/)
    expect(html).not.toContain('data-slot="tour-spotlight"')

    // La tarjeta recibe el foco por código y queda centrada.
    const cardAttrs = slotAttrs(html, 'tour-card')
    expect(cardAttrs.role).toBe('document')
    expect(cardAttrs.tabindex).toBe('-1')
    const classes = classesOf(html, 'tour-card')
    for (const c of ['left-1/2', 'top-1/2', '-translate-x-1/2', '-translate-y-1/2']) {
      expect(classes, c).toContain(c)
    }
    expect(slotText(html, 'tour-kicker')).toBe('Paso 1 de 3')
    expect(slotText(html, 'tour-title')).toBe('Acá se arma la carta')
  })
})

describe('TourCard', () => {
  it('es una caja de diálogo del kit: cartulina que flota, pelo con token y sombra modal', () => {
    const classes = classesOf(card(0), 'tour-card')
    for (const c of [
      'rounded-2xl',
      'border',
      'border-border',
      'bg-popover',
      'text-popover-foreground',
      'shadow-modal',
    ]) {
      expect(classes, c).toContain(c)
    }
    expect(classes).not.toContain('shadow-xl')
    expect(classes).not.toContain('bg-card')
    expect(translucentBorders(classes)).toEqual([])
  })

  it('kicker de 12 px, título de sección sin Fraunces y cuerpo de 14 px', () => {
    const html = card(0)

    const kicker = classesOf(html, 'tour-kicker')
    expect(kicker).toContain('type-caption')
    expect(kicker).toContain('text-primary')
    expect(slotText(html, 'tour-kicker')).toBe('Paso 1 de 3')

    expect(html).toMatch(/<h2[^>]*\sdata-slot="tour-title"/)
    const title = classesOf(html, 'tour-title')
    expect(title).toContain('type-section')
    for (const old of ['font-serif', 'text-lg', 'leading-snug']) expect(title).not.toContain(old)

    const body = classesOf(html, 'tour-body')
    expect(body).toContain('type-body')
    expect(body).toContain('text-muted-foreground')
    for (const old of ['text-sm', 'leading-relaxed']) expect(body).not.toContain(old)
    expect(slotText(html, 'tour-body')).toBe(
      'Todo lo que cargues en esta pantalla es lo que ven los clientes.',
    )
  })

  it('la X es el botón fantasma del kit: 44 px de área con el dedo, hover y foco con outline', () => {
    const html = card(0)
    const attrs = slotAttrs(html, 'tour-close')
    expect(attrs.type).toBe('button')
    expect(attrs['aria-label']).toBe('Salir del tutorial')

    const classes = classesOf(html, 'tour-close')
    // `hit-area` agranda el área a --hit-min (44 px con el dedo); necesita `relative`.
    for (const c of [
      'relative',
      'hit-area',
      'size-(--control-sm)',
      'hover:bg-hover',
      'hover:text-foreground',
      'focus-visible:outline-2',
      'outline-offset-2',
      'outline-(--ring)',
    ]) {
      expect(classes, c).toContain(c)
    }
    expect(classes).not.toContain('hover:bg-secondary')
    expect(classes).not.toContain('outline-none')
  })

  it('primer paso: avanza o sale, pero no vuelve', () => {
    const html = card(0)
    expect(buttonTexts(html)).toEqual(['', 'Siguiente'])
    expect(html).not.toContain('data-slot="tour-prev"')
    expect(slotAttrs(html, 'tour-next').type).toBe('button')
  })

  it('kicker propio: se ve el kicker y el lector igual escucha el avance', () => {
    const html = card(1)
    expect(slotText(html, 'tour-kicker')).toBe('Lo más importante 📸')
    expect(html).toContain('<span class="sr-only"> · Paso 2 de 3</span>')
    expect(buttonTexts(html)).toEqual(['', 'Anterior', 'Siguiente'])
    expect(slotAttrs(html, 'tour-prev').type).toBe('button')
  })

  it('la demo es un dibujo quieto: oculta para el lector, pelo con token y relleno muted', () => {
    const html = card(1)
    const attrs = slotAttrs(html, 'tour-demo')
    expect(attrs['aria-hidden']).toBe('true')
    const classes = classesOf(html, 'tour-demo')
    expect(classes).toContain('border-border')
    expect(classes).toContain('bg-muted')
    expect(translucentBorders(classes)).toEqual([])
    expect([...classes].some((c) => c.includes('/'))).toBe(false)
    expect(slotText(html, 'tour-demo')).toBe('Soltá la foto acá')
    // Un paso sin demo no dibuja la caja.
    expect(card(0)).not.toContain('data-slot="tour-demo"')
  })

  it('último paso: el principal dice «¡Listo!»', () => {
    const html = card(2)
    expect(buttonTexts(html)).toEqual(['', 'Anterior', '¡Listo!'])
  })

  it('movimiento: entra como un diálogo y con «reducir movimiento» solo funde', () => {
    const classes = classesOf(card(0), 'tour-card')
    for (const c of [
      'animate-in',
      'fade-in-0',
      'zoom-in-97',
      'duration-(--duration-overlay)',
      'ease-(--ease-ui)',
      'motion-reduce:zoom-in-100',
    ]) {
      expect(classes, c).toContain(c)
    }
    expect(classes).not.toContain('zoom-in-95')
  })
})

describe('TourBackdrop', () => {
  const rect = { top: 10, left: 20, width: 120, height: 40 }

  it('el recorte tapa lo demás con el token del velo, no con un rgba', () => {
    const html = render(h(TourBackdrop, { rect }))
    const attrs = slotAttrs(html, 'tour-spotlight')
    expect(attrs['aria-hidden']).toBe('true')
    expect(attrs.style).toBe(
      'top:10px;left:20px;width:120px;height:40px;box-shadow:0 0 0 9999px var(--overlay)',
    )
    expect(html).not.toMatch(/rgba?\(/)
  })

  it('el borde del recorte es un outline con token (sobrevive al alto contraste)', () => {
    const classes = classesOf(render(h(TourBackdrop, { rect })), 'tour-spotlight')
    expect(classes).toContain('outline-2')
    expect(classes).toContain('outline-primary')
    expect(translucentBorders(classes)).toEqual([])
    // Un ring-* quedaría tapado por el box-shadow en línea.
    expect([...classes].some((c) => c.startsWith('ring-'))).toBe(false)
  })

  it('se desliza entre targets con los tokens del kit y no con «reducir movimiento»', () => {
    const classes = classesOf(render(h(TourBackdrop, { rect })), 'tour-spotlight')
    for (const c of [
      'transition-[top,left,width,height]',
      'duration-(--duration-overlay)',
      'ease-(--ease-move)',
      'motion-reduce:transition-none',
    ]) {
      expect(classes, c).toContain(c)
    }
    expect(classes).not.toContain('transition-all')
  })

  it('sin target: el velo entero con bg-overlay', () => {
    const html = render(h(TourBackdrop, { rect: null }))
    expect(classesOf(html, 'tour-scrim')).toContain('bg-overlay')
    expect(html).not.toContain('data-slot="tour-spotlight"')
  })
})
