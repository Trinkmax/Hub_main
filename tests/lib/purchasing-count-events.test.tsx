// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CountRow } from '@/components/purchasing/kitchen/count-row'
import { lineReason } from '@/components/purchasing/kitchen/count-summary'
import { computeEventNeeds, type EventNeed } from '@/lib/purchasing/events'
import { mustHaveQty, suggestLine } from '@/lib/purchasing/suggest'
import type { CalendarEvent, PurItem, PurRecipe } from '@/lib/purchasing/types'

/*
 * Lo que pidió Tomás el 18/11/2026, con la captura del conteo de Flor: «cebolla blanca, objetivo 15 kilos;
 * para Ratatouille se usan 3 kilos, para Comida Coreana se usan 3 kilos más». Los números de abajo son los
 * de las recetas de HUB: 4,5 kg en Ratatouille y 4 kg en Comida coreana, para 60 personas.
 */

const cebolla = (over: Partial<PurItem> = {}): PurItem => ({
  id: 'i-cebolla',
  code: null,
  name: 'Cebolla Blanca',
  brand: null,
  zoneId: 'z-camara',
  unit: 'kg',
  frequency: 'frequent',
  targetQty: 15,
  packLabel: 'Por kg',
  packSize: 1,
  supplierId: 's-mondino',
  notes: null,
  active: true,
  ...over,
})

const recipe = (
  id: string,
  templateId: string,
  lines: Array<{ qty: number; unit?: string; itemId?: string }>,
): PurRecipe => ({
  id,
  templateId,
  name: id,
  variant: 'Única',
  baseGuests: 60,
  notes: null,
  active: true,
  lines: lines.map((l, i) => ({
    id: `${id}-${i}`,
    itemId: l.itemId ?? 'i-cebolla',
    name: 'Cebolla blanca',
    quantity: l.qty,
    unit: l.unit ?? 'kg',
    inHouse: false,
    note: null,
    sortOrder: i + 1,
  })),
})

const event = (over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id'>): CalendarEvent => ({
  date: '2026-11-18',
  startsAt: '21:00',
  name: 'Evento',
  templateId: null,
  capacity: 60,
  reservedGuests: 0,
  ...over,
})

const RATATOUILLE = event({
  id: 'e-rata',
  date: '2026-11-18',
  name: 'Ratatouille',
  templateId: 't-rata',
  reservedGuests: 52,
})
const COREANA = event({
  id: 'e-coreana',
  date: '2026-11-19',
  name: 'Comida Coreana',
  templateId: 't-coreana',
  reservedGuests: 17,
})
const RECIPES = [
  recipe('r-rata', 't-rata', [{ qty: 4.5 }]),
  recipe('r-coreana', 't-coreana', [{ qty: 4 }]),
]

function needsFor(input: { events: CalendarEvent[]; recipes?: PurRecipe[]; items?: PurItem[] }) {
  const items = input.items ?? [cebolla()]
  return computeEventNeeds({
    events: input.events,
    recipes: input.recipes ?? RECIPES,
    plans: [],
    items: new Map(items.map((i) => [i.id, i])),
    baseGuests: 60,
  }).needs
}

/** El texto que ve la cocina, sin las marcas que React deja entre textos ni las etiquetas. */
function visibleText(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function renderRow(item: PurItem, need: EventNeed | undefined): string {
  return renderToString(
    createElement(CountRow, { item, line: undefined, need, lowFraction: 0.5, onMark: () => {} }),
  )
}

describe('cuánto lleva cada evento (pedido de Tomás, 18/11/2026)', () => {
  it('la cebolla blanca: 4,5 kg para Ratatouille y 4 kg para Comida Coreana, en el orden del calendario', () => {
    const need = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
    expect(need?.qty).toBe(8.5)
    expect(need?.events).toEqual(['Ratatouille · mié 18/11', 'Comida Coreana · jue 19/11'])
    expect(need?.parts).toEqual([
      {
        eventId: 'e-rata',
        label: 'Ratatouille · mié 18/11',
        name: 'Ratatouille',
        date: '2026-11-18',
        qty: 4.5,
      },
      {
        eventId: 'e-coreana',
        label: 'Comida Coreana · jue 19/11',
        name: 'Comida Coreana',
        date: '2026-11-19',
        qty: 4,
      },
    ])
  })

  it('con más reservas que la receta, cada fecha lleva lo suyo multiplicado y la suma sigue cerrando', () => {
    const llena = { ...COREANA, reservedGuests: 90 }
    const need = needsFor({ events: [RATATOUILLE, llena] }).get('i-cebolla')
    expect(need?.parts.map((p) => p.qty)).toEqual([4.5, 6])
    expect(need?.qty).toBe(10.5)
  })

  it('si la receta nombra la cebolla dos veces, la fecha va una sola vez con las dos cantidades', () => {
    const doble = [recipe('r-coreana', 't-coreana', [{ qty: 4 }, { qty: 500, unit: 'g' }])]
    const need = needsFor({ events: [COREANA], recipes: doble }).get('i-cebolla')
    expect(need?.parts).toHaveLength(1)
    expect(need?.parts[0]?.qty).toBe(4.5)
    expect(need?.qty).toBe(4.5)
  })

  it('la suma de cada fecha es lo que entra en la cuenta del pedido', () => {
    const need = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
    const line = suggestLine({
      item: cebolla(),
      line: { state: 'exact', quantity: 10 },
      need,
      inTransitQty: 0,
      lowFraction: 0.5,
    })
    // 15 de la carta + 4,5 + 4 de los eventos − 10 que hay = 13,5 → 13,5 kg (se pide por kilo, de a 0,1).
    expect(line?.needQty).toBe(13.5)
    expect(line?.eventParts.map((p) => p.qty)).toEqual([4.5, 4])
  })
})

describe('lo que tiene que haber', () => {
  const two = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
  const one = needsFor({ events: [COREANA] }).get('i-cebolla')

  it('el objetivo de la carta más lo de cada evento', () => {
    expect(mustHaveQty(15, two)).toBe(23.5)
    expect(mustHaveQty(15, one)).toBe(19)
  })

  it('sin objetivo, solo cuando hay más de una fecha (con una, ya lo dice la etiqueta)', () => {
    expect(mustHaveQty(null, two)).toBe(8.5)
    expect(mustHaveQty(null, one)).toBeNull()
    expect(mustHaveQty(0, one)).toBeNull()
  })

  it('lo que no piden los eventos no tiene', () => {
    expect(mustHaveQty(15, undefined)).toBeNull()
  })
})

describe('cómo lo ve la cocina', () => {
  it('cada etiqueta con su cantidad y, arriba a la derecha, lo que tiene que haber', () => {
    const need = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
    const text = visibleText(renderRow(cebolla(), need))
    expect(text).toContain('Cebolla Blanca kg · objetivo 15 23,5 kg tiene que haber')
    expect(text).toContain('Para Ratatouille · mié 18/11 +4,5 kg')
    expect(text).toContain('Para Comida Coreana · jue 19/11 +4 kg')
  })

  it('el lector de pantalla oye el total y cuánto lleva cada evento', () => {
    const need = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
    const html = renderRow(cebolla(), need)
    expect(html).toContain('<span class="sr-only">Tiene que haber </span>')
    expect(html).toContain('<span class="sr-only">lleva </span>')
    expect(html).toContain('aria-label="Lo que piden los eventos"')
  })

  it('un insumo de un solo evento y sin objetivo muestra la etiqueta, sin repetir el total', () => {
    const masa = cebolla({
      id: 'i-masa',
      name: 'Masa wonton',
      unit: 'unidad',
      targetQty: null,
      frequency: 'occasional',
    })
    const need = needsFor({
      events: [COREANA],
      recipes: [recipe('r-coreana', 't-coreana', [{ qty: 120, unit: 'unidad', itemId: 'i-masa' }])],
      items: [masa],
    }).get('i-masa')
    const text = visibleText(renderRow(masa, need))
    expect(text).toContain('Para Comida Coreana · jue 19/11 +120 u')
    expect(text).not.toContain('tiene que haber')
  })

  it('lo que no pide ningún evento queda como siempre: Alcanza, Poco, No hay', () => {
    const text = visibleText(
      renderRow(cebolla({ name: 'Cebolla morada', targetQty: 3 }), undefined),
    )
    expect(text).toBe('Cebolla morada kg · objetivo 3 Alcanza ≈ Poco No hay')
  })
})

describe('el resumen antes de enviar', () => {
  it('dice cuánto suma cada evento', () => {
    const need = needsFor({ events: [RATATOUILLE, COREANA] }).get('i-cebolla')
    const line = suggestLine({
      item: cebolla(),
      line: { state: 'exact', quantity: 10 },
      need,
      inTransitQty: 0,
      lowFraction: 0.5,
    })
    if (!line) throw new Error('tenía que pedirse')
    expect(lineReason(line)).toBe(
      'Hay 10 kg · objetivo 15 · +4,5 para Ratatouille (mié 18/11) · +4 para Comida Coreana (jue 19/11)',
    )
  })

  it('un renglón armado antes (sin el detalle por fecha) sigue diciendo el total', () => {
    const line = suggestLine({
      item: cebolla(),
      line: { state: 'none', quantity: null },
      need: {
        qty: 8.5,
        events: ['Ratatouille · mié 18/11', 'Comida Coreana · jue 19/11'],
        parts: [],
      },
      inTransitQty: 0,
      lowFraction: 0.5,
    })
    if (!line) throw new Error('tenía que pedirse')
    expect(lineReason(line)).toBe(
      'No hay · objetivo 15 · +8,5 para Ratatouille · mié 18/11, Comida Coreana · jue 19/11',
    )
  })
})
