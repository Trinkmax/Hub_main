// @vitest-environment node
import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge, type BadgeTone, badgeVariants } from '@/components/ui/badge'
import { DueStatus, formatDueStatus, getDueStatus } from '@/components/ui/due-status'
import { StatusBadge, type StatusMap } from '@/components/ui/status-badge'
import { dueBucket, dueLabel } from '@/lib/accounting/aging'

/**
 * Kit HUB §3.4: etiquetas suaves, mapas de estado y el semáforo de
 * vencimientos, en el HTML del server (los tres son server-safe).
 *
 * Lo que se fija:
 * 1. Las etiquetas son suaves por tono (los rellenos sólidos de antes quedan
 *    para el sello dorado y la cuenta de sin leer).
 * 2. `StatusBadge` toma tono, punto y descripción del mapa, también con una
 *    cuenta o un texto propio («3 pendientes»).
 * 3. `DueStatus` dice siempre el estado en palabras (punto + texto, nunca solo
 *    color) y el punto no le llega al lector de pantalla.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el)

const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'wbr'])

/** El texto que le llega al lector: todo, menos lo que está adentro de un `aria-hidden="true"`. */
function readable(html: string): string {
  const out: string[] = []
  const hidden: boolean[] = []
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, tag, attrs, selfClosing, text] = m
    if (text !== undefined) {
      if (!hidden.includes(true)) out.push(text)
    } else if (tag !== undefined) {
      if (closing) hidden.pop()
      else if (!VOID.has(tag) && !selfClosing) hidden.push(/\saria-hidden="true"/.test(attrs ?? ''))
    }
  }
  return out
    .join('')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
}

/** Atributos del primer elemento que tenga `data-slot="<slot>"`. */
function slotAttrs(html: string, slot: string): Record<string, string> {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? ''
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k ?? '', v ?? '']),
  )
}

const classesOf = (html: string, slot: string) =>
  new Set((slotAttrs(html, slot).class ?? '').split(/\s+/).filter(Boolean))

/** Los anclajes de los tours (§3.0): tienen que llegar al DOM. */
const TOUR = { 'data-tour': 'x' } as const

// ─── Badge ───────────────────────────────────────────────────────────────────

type Want = { classes: string[] }

describe('Badge: suaves por tono, sin los rellenos de antes', () => {
  const expected: Record<BadgeTone, Want> = {
    neutral: { classes: ['bg-secondary', 'text-muted-foreground'] },
    brand: { classes: ['bg-brand-soft', 'text-brand-text'] },
    success: { classes: ['bg-success-soft', 'text-success-text'] },
    warning: { classes: ['bg-warning-soft', 'text-warning-text'] },
    danger: { classes: ['bg-destructive-soft', 'text-destructive-text'] },
    info: { classes: ['bg-info-soft', 'text-info-text'] },
    gold: { classes: ['bg-gold-soft', 'text-gold-text'] },
  }

  for (const [tone, want] of Object.entries(expected) as [BadgeTone, Want][]) {
    it(`${tone} → suave`, () => {
      const html = render(h(Badge, { tone }, 'Estado'))
      const attrs = slotAttrs(html, 'badge')
      expect(attrs['data-tone']).toBe(tone)
      expect(attrs['data-appearance']).toBe('soft')
      const cls = classesOf(html, 'badge')
      for (const c of want.classes) expect(cls).toContain(c)
      // Ningún relleno sólido: bg-primary, bg-destructive, bg-success…
      for (const solid of ['bg-primary', 'bg-destructive', 'bg-success', 'bg-warning', 'bg-info']) {
        expect(cls).not.toContain(solid)
      }
      expect(readable(html)).toBe('Estado')
    })
  }

  it('el contorno es neutro con pelo fuerte', () => {
    const cls = classesOf(render(h(Badge, { appearance: 'outline' }, 'x')), 'badge')
    expect(cls).toContain('border-border-strong')
    expect(cls).toContain('text-muted-foreground')
  })

  it('sin nada es neutra y suave, de 20 px, en type-caption', () => {
    const cls = classesOf(render(h(Badge, null, 'Borrador')), 'badge')
    expect(cls).toContain('bg-secondary')
    expect(cls).toContain('h-5')
    expect(cls).toContain('type-caption')
    expect(classesOf(render(h(Badge, { size: 'md' }, 'x')), 'badge')).toContain('h-6')
  })

  it('sólida: el sello dorado', () => {
    const html = render(h(Badge, { tone: 'gold', appearance: 'solid' }, 'Oro'))
    const cls = classesOf(html, 'badge')
    expect(cls).toContain('bg-gold')
    expect(cls).toContain('text-gold-foreground')
    expect(cls).not.toContain('bg-gold-soft')
  })

  it('el punto es decorativo: aria-hidden y el texto sigue ahí', () => {
    const html = render(h(Badge, { tone: 'success', dot: true }, 'Activa'))
    expect(slotAttrs(html, 'badge-dot')['aria-hidden']).toBe('true')
    expect(classesOf(html, 'badge-dot')).toContain('bg-success')
    expect(readable(html)).toBe('Activa')
  })

  it('el className va último (cn): un text-[10px] viejo pisa al type-caption', () => {
    const cls = classesOf(render(h(Badge, { className: 'text-[10px] gap-2' }, 'x')), 'badge')
    expect(cls).toContain('text-[10px]')
    expect(cls).not.toContain('type-caption')
    expect(cls).toContain('gap-2')
    expect(cls).not.toContain('gap-1')
  })

  it('pasa data-tour y el resto de las props a la raíz', () => {
    const attrs = slotAttrs(render(h(Badge, { ...TOUR, id: 'b1' }, 'x')), 'badge')
    expect(attrs['data-tour']).toBe('x')
    expect(attrs.id).toBe('b1')
  })

  it('con asChild se dibuja sobre el link, con el punto adentro', () => {
    const html = render(
      h(Badge, { asChild: true, dot: true, tone: 'brand' }, h('a', { href: '/hub/x' }, 'Ver')),
    )
    expect(html.startsWith('<a ')).toBe(true)
    expect(slotAttrs(html, 'badge').href).toBe('/hub/x')
    expect(html).toMatch(/<a [^>]*>(<span[^>]*data-slot="badge-dot"[^>]*><\/span>)Ver<\/a>/)
  })

  it('badgeVariants: las mismas clases para dibujarla sobre otro elemento', () => {
    expect(badgeVariants().split(' ')).toContain('bg-secondary')
    expect(badgeVariants({ appearance: 'outline' }).split(' ')).toContain('border-border-strong')
    expect(badgeVariants({ tone: 'danger' }).split(' ')).toContain('bg-destructive-soft')
    expect(badgeVariants({ size: 'md', className: 'z-10' }).split(' ')).toEqual(
      expect.arrayContaining(['h-6', 'z-10']),
    )
  })
})

// ─── StatusBadge ─────────────────────────────────────────────────────────────

type Demo = 'draft' | 'sent' | 'failed'

describe('StatusBadge: un mapa por dominio', () => {
  const MAP: StatusMap<Demo> = {
    draft: { label: 'Borrador', tone: 'neutral' },
    sent: { label: 'Enviada', tone: 'success' },
    failed: { label: 'Fallida', tone: 'danger', description: 'Meta rechazó el envío' },
  }

  it('toma etiqueta y tono del mapa, con punto por defecto', () => {
    const html = render(h(StatusBadge<Demo>, { status: 'sent', map: MAP }))
    const attrs = slotAttrs(html, 'badge')
    expect(attrs['data-tone']).toBe('success')
    expect(attrs['data-status']).toBe('sent')
    expect(slotAttrs(html, 'badge-dot')['aria-hidden']).toBe('true')
    expect(readable(html)).toBe('Enviada')
  })

  it('la descripción va de title y dot={false} saca el punto', () => {
    const html = render(h(StatusBadge<Demo>, { status: 'failed', map: MAP, dot: false }))
    expect(slotAttrs(html, 'badge').title).toBe('Meta rechazó el envío')
    expect(html).not.toContain('badge-dot')
  })

  it('un estado que el mapa no conoce se ve tal cual, en neutro', () => {
    const html = render(
      h(StatusBadge<string>, { status: 'archived', map: MAP as StatusMap<string> }),
    )
    expect(slotAttrs(html, 'badge')['data-tone']).toBe('neutral')
    expect(readable(html)).toBe('archived')
  })

  it('con count y texto propio dice «3 pendientes», en el tono del mapa', () => {
    const html = render(h(StatusBadge<Demo>, { status: 'failed', map: MAP, count: 3 }, 'fallidas'))
    const attrs = slotAttrs(html, 'badge')
    // El tono, el punto y la descripción siguen siendo los del estado.
    expect(attrs['data-tone']).toBe('danger')
    expect(attrs['data-status']).toBe('failed')
    expect(attrs.title).toBe('Meta rechazó el envío')
    expect(classesOf(html, 'badge-dot')).toContain('bg-destructive')
    expect(readable(html)).toBe('3 fallidas')
    // La cuenta va con el formato de la casa y en cifras tabulares.
    expect(classesOf(html, 'status-badge-count')).toContain('tabular-nums')
    const many = render(h(StatusBadge<Demo>, { status: 'sent', map: MAP, count: 1250 }, 'enviadas'))
    expect(readable(many)).toBe('1.250 enviadas')
  })

  it('con count y sin texto propio: la etiqueta del mapa y la cuenta', () => {
    const html = render(h(StatusBadge<Demo>, { status: 'draft', map: MAP, count: 2 }))
    expect(readable(html)).toBe('Borrador 2')
    expect(html).toMatch(/<span aria-hidden="true">·<\/span>/)
    expect(slotAttrs(html, 'badge')['data-tone']).toBe('neutral')
  })

  it('con texto propio y sin count: el texto en lugar de la etiqueta', () => {
    const html = render(h(StatusBadge<Demo>, { status: 'sent', map: MAP }, 'Enviada hoy'))
    expect(readable(html)).toBe('Enviada hoy')
    expect(slotAttrs(html, 'badge')['data-tone']).toBe('success')
    expect(html).not.toContain('status-badge-count')
  })
})

// ─── DueStatus ───────────────────────────────────────────────────────────────

const TODAY = '2026-10-06'

const due = (props: Partial<Parameters<typeof DueStatus>[0]>) =>
  render(h(DueStatus, { dueDate: null, today: TODAY, ...props }))

describe('DueStatus: punto + palabras', () => {
  const cases: Array<[string, Partial<Parameters<typeof DueStatus>[0]>, string, string]> = [
    ['pagada', { dueDate: '2026-09-01', settled: true }, 'settled', 'Pagada'],
    [
      'cobrada',
      { dueDate: '2026-09-01', settled: true, settledLabel: 'Cobrada' },
      'settled',
      'Cobrada',
    ],
    ['sin fecha', { dueDate: null }, 'no-due', 'Sin vencimiento'],
    ['fecha ilegible', { dueDate: '31/02/2026' }, 'no-due', 'Sin vencimiento'],
    ['al día', { dueDate: '2026-10-22' }, 'current', 'Al día'],
    ['vence en 5 días', { dueDate: '2026-10-11' }, 'soon', 'Vence en 5 días'],
    ['vence en 1 día (singular)', { dueDate: '2026-10-07' }, 'soon', 'Vence en 1 día'],
    ['el día 7 todavía es «pronto»', { dueDate: '2026-10-13' }, 'soon', 'Vence en 7 días'],
    ['el día 8 ya está al día', { dueDate: '2026-10-14' }, 'current', 'Al día'],
    ['vence hoy', { dueDate: TODAY }, 'today', 'Vence hoy'],
    ['vencida hace 3 días', { dueDate: '2026-10-03' }, 'overdue', 'Vencida hace 3 días'],
    ['vencida hace 1 día', { dueDate: '2026-10-05' }, 'overdue', 'Vencida hace 1 día'],
    ['soonDays propio', { dueDate: '2026-10-11', soonDays: 3 }, 'current', 'Al día'],
  ]

  for (const [name, props, bucket, text] of cases) {
    it(`${name} → «${text}»`, () => {
      const html = due(props)
      expect(slotAttrs(html, 'due-status')['data-bucket']).toBe(bucket)
      // El texto es la etiqueta accesible: le llega entero al lector.
      expect(readable(html)).toBe(text)
    })
  }

  it('el punto lleva aria-hidden y el color del tramo', () => {
    const tones: Array<[string, string]> = [
      ['2026-10-03', 'bg-destructive'],
      [TODAY, 'bg-warning'],
      ['2026-10-11', 'bg-warning'],
      ['2026-10-22', 'bg-success'],
    ]
    for (const [dueDate, dot] of tones) {
      const html = due({ dueDate })
      expect(slotAttrs(html, 'due-status-dot')['aria-hidden']).toBe('true')
      expect(classesOf(html, 'due-status-dot')).toContain(dot)
    }
    expect(classesOf(due({ settled: true }), 'due-status-dot')).toContain('bg-subtle-foreground')
  })

  it('sin vencimiento no pinta punto pero guarda su lugar (columnas alineadas)', () => {
    const cls = classesOf(due({ dueDate: null }), 'due-status-dot')
    expect(cls).toContain('size-1.5')
    expect([...cls].some((c) => c.startsWith('bg-'))).toBe(false)
  })

  it('vencida va en destructive-text; vence hoy, en 500; los días, tabulares', () => {
    expect(classesOf(due({ dueDate: '2026-10-01' }), 'due-status')).toContain(
      'text-destructive-text',
    )
    expect(classesOf(due({ dueDate: TODAY }), 'due-status')).toContain('font-medium')
    expect(classesOf(due({ dueDate: '2026-10-11' }), 'due-status')).toContain('tabular-nums')
  })

  it('showDate suma la fecha corta; «Al día» pasa a «Vence el …»', () => {
    expect(readable(due({ dueDate: '2026-10-03', showDate: true }))).toBe(
      'Vencida hace 3 días · 03/10',
    )
    expect(readable(due({ dueDate: '2026-10-11', showDate: true }))).toBe('Vence en 5 días · 11/10')
    expect(readable(due({ dueDate: '2026-10-22', showDate: true }))).toBe('Vence el 22/10')
    expect(readable(due({ dueDate: TODAY, showDate: true }))).toBe('Vence hoy')
    // Otro año: con el año.
    expect(readable(due({ dueDate: '2027-01-15', showDate: true }))).toBe('Vence el 15/01/2027')
  })

  it('sin showDate, la fecha completa queda en el title', () => {
    expect(slotAttrs(due({ dueDate: '2026-10-11' }), 'due-status').title).toBe(
      'Vence el 11/10/2026',
    )
    expect(slotAttrs(due({ dueDate: '2026-10-11', showDate: true }), 'due-status').title).toBe(
      undefined,
    )
    expect(slotAttrs(due({ dueDate: '2026-10-11', settled: true }), 'due-status').title).toBe(
      undefined,
    )
  })

  it('un timestamptz se cuenta por su día en Córdoba (no el de UTC)', () => {
    // 02:00 UTC del 7 = 23:00 del 6 en Córdoba: vence hoy, no mañana.
    expect(readable(due({ dueDate: '2026-10-07T02:00:00Z' }))).toBe('Vence hoy')
    expect(readable(due({ dueDate: '2026-10-07T02:00:00.123456+00:00' }))).toBe('Vence hoy')
  })

  it('variant="badge" es una etiqueta suave del tono, con punto', () => {
    const html = due({ dueDate: '2026-10-03', variant: 'badge' })
    const attrs = slotAttrs(html, 'due-status')
    expect(attrs['data-tone']).toBe('danger')
    expect(attrs['data-bucket']).toBe('overdue')
    expect(classesOf(html, 'due-status')).toContain('bg-destructive-soft')
    expect(slotAttrs(html, 'badge-dot')['aria-hidden']).toBe('true')
    expect(readable(html)).toBe('Vencida hace 3 días')
    // Sin vencimiento: neutra y sin punto.
    const none = due({ dueDate: null, variant: 'badge' })
    expect(slotAttrs(none, 'due-status')['data-tone']).toBe('neutral')
    expect(none).not.toContain('badge-dot')
  })

  it('pasa data-tour y className a la raíz', () => {
    const html = due({ dueDate: TODAY, ...TOUR, className: 'ml-2' })
    expect(slotAttrs(html, 'due-status')['data-tour']).toBe('x')
    expect(classesOf(html, 'due-status')).toContain('ml-2')
  })
})

describe('getDueStatus y formatDueStatus (puros)', () => {
  it('cuenta los días con enteros, sin correr el día', () => {
    expect(getDueStatus({ dueDate: '2026-10-03', today: TODAY })).toMatchObject({
      bucket: 'overdue',
      days: 3,
      dueDay: '2026-10-03',
      tone: 'danger',
    })
    expect(getDueStatus({ dueDate: '2026-03-01', today: '2026-02-27' })).toMatchObject({
      bucket: 'soon',
      days: 2,
    })
    expect(getDueStatus({ dueDate: TODAY, today: TODAY, settled: true })).toMatchObject({
      bucket: 'settled',
      days: null,
      tone: 'neutral',
    })
    expect(getDueStatus({ dueDate: undefined, today: TODAY })).toMatchObject({
      bucket: 'no-due',
      tone: null,
    })
  })

  it('un today mal formado no rompe: cuenta desde hoy', () => {
    const info = getDueStatus({ dueDate: '2026-10-03', today: 'ayer' })
    expect(info.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('formatDueStatus arma el mismo texto que el componente', () => {
    const info = getDueStatus({ dueDate: '2026-10-11', today: TODAY })
    expect(formatDueStatus(info)).toBe('Vence en 5 días')
    expect(formatDueStatus(info, { showDate: true })).toBe('Vence en 5 días · 11/10')
  })

  it('dice lo mismo que la antigüedad contable (dueLabel), tramo por tramo', () => {
    // La pantalla y los textos del módulo contable no se pueden contradecir.
    const dates = [
      null,
      '2026-09-01',
      '2026-10-05',
      TODAY,
      '2026-10-07',
      '2026-10-13',
      '2026-11-30',
    ]
    for (const dueDate of dates) {
      for (const settled of [false, true]) {
        const info = getDueStatus({ dueDate, today: TODAY, settled })
        expect(info.bucket).toBe(dueBucket(dueDate, TODAY, 7, settled))
        expect(formatDueStatus(info)).toBe(dueLabel(dueDate, TODAY, { settled }))
      }
    }
    const cobrada = getDueStatus({ dueDate: TODAY, today: TODAY, settled: true })
    expect(formatDueStatus(cobrada, { settledLabel: 'Cobrada' })).toBe(
      dueLabel(TODAY, TODAY, { settled: true, group: 'receivables' }),
    )
  })
})
