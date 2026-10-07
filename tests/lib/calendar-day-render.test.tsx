// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarTabs } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/calendar-tabs'
import { DaySegmentSection } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/day-segment-section'
import { MonthDaySegments } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/month-day-segments'
import { ZoneFilterControl } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/zone-filter-control'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import {
  computeDaySegments,
  type DaySegmentCaps,
  type MonthSegments,
  type ResolvedSegmentCap,
  type SegmentEventInput,
  type SegmentLoad,
  type ZoneCaps,
} from '@/lib/salon/segments'
import type { ReservationWithJoins } from '@/lib/salon/types'

/**
 * Render (SSR) de las piezas de la vista del día que tienen lógica de cableado:
 * - «Subir a N» dice «hoy» solo si el día abierto es hoy (antes lo decía en
 *   cualquier fecha y el cupo especial se guardaba en otra).
 * - La vista rápida es controlable: la vista del día decide cuál está abierta,
 *   así una reserva que pasa de servicio (otra lista) no se cierra sola. Sin
 *   `open`, sigue manejando su propio estado como en el resto de los usos.
 * - Un ?day en la URL deja el Calendario a la vista aunque se pida Formatos:
 *   la vista del día vive adentro del mes.
 *
 * No prueba interacción (el Dialog de Radix no renderiza su portal en el
 * server): prueba el estado que cada pieza pinta en el primer render.
 */

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/eventos/programados',
  useSearchParams: () => search,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}))
vi.mock('@/lib/salon/actions', () => ({
  cancelSalonReservation: vi.fn(),
  markArrived: vi.fn(),
  markClosed: vi.fn(),
  markNoShow: vi.fn(),
  markSeated: vi.fn(),
  revertStatus: vi.fn(),
  updateActualGuests: vi.fn(),
  updateSalonReservation: vi.fn(),
}))
vi.mock('@/lib/salon/segment-actions', () => ({ fetchDaySegments: vi.fn() }))
vi.mock('@/components/messaging/contact-button', () => ({
  ContactButton: () => createElement('button', { type: 'button' }, 'Contactar'),
}))
// El mes y el editor de formatos tienen su propia carga: acá solo importa cuál
// de las dos pestañas queda montada.
vi.mock(
  '@/app/(manager)/[tenantSlug]/eventos/programados/_components/scheduled-events-month',
  () => ({
    ScheduledEventsMonth: () => createElement('div', null, 'MES-DEL-CALENDARIO'),
  }),
)
vi.mock('@/app/(manager)/[tenantSlug]/eventos/templates/_components/templates-editor', () => ({
  TemplatesEditor: () => createElement('div', null, 'EDITOR-DE-FORMATOS'),
}))

/** SSR separa los textos contiguos con <!-- -->: se sacan para leer la frase. */
function text(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

function reservation(over: Partial<ReservationWithJoins>): ReservationWithJoins {
  return {
    id: 'r',
    tenant_id: 't',
    customer_id: null,
    guest_name: 'Nombre',
    guest_phone: null,
    guest_email: null,
    kind: 'normal',
    meal_type: 'lunch',
    reservation_date: '2026-09-25',
    reservation_time_local: '13:00:00',
    reservation_end_time_local: null,
    zone: 'planta_baja',
    scheduled_event_id: null,
    estimated_guests: 4,
    actual_guests: null,
    cake_count: 0,
    cake_option_id: null,
    champagne_count: 0,
    deposit_cents: 0,
    origin: 'whatsapp',
    primary_manager_id: 'm1',
    assistant_manager_id: null,
    comments: null,
    service_alerts: [],
    highlight_comment: false,
    table_label: null,
    status: 'pending',
    arrived_at: null,
    seated_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    arrived_by: null,
    seated_by: null,
    closed_by: null,
    created_by: null,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    primary_manager: { id: 'm1', display_name: 'Luz' },
    assistant_manager: null,
    scheduled_event: null,
    customer: null,
    cake_option: null,
    ...over,
  }
}

function weekly(capacity: number, warnAt: number | null = null): ResolvedSegmentCap {
  return { capacity, warnAt, warnNote: null, source: 'weekly', overrideReason: null }
}

/** Jueves del HUB: almuerzo de 70 con aviso en 50, merienda y cena de 120. */
const THU_CAPS: DaySegmentCaps = {
  lunch: weekly(70, 50),
  tea_time: weekly(120),
  dinner: weekly(120),
}

// Jue 25/09: 52 al mediodía, pasa el aviso de 50 → «Subir a 120».
const LUNCH_ROWS = [
  reservation({ id: 'aaaaaaaa-0000-4000-8000-000000000001', estimated_guests: 30 }),
  reservation({
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    guest_name: 'Cumple Sofi',
    estimated_guests: 22,
    reservation_time_local: '13:30:00',
  }),
]
const LUNCH_WARN: SegmentLoad = computeDaySegments({
  date: '2026-09-25',
  reservations: LUNCH_ROWS,
  events: [],
  caps: THU_CAPS,
}).segments.lunch

function renderSection(
  over: Partial<{
    canRaise: boolean
    isToday: boolean
    openReservationId: string | null
  }> = {},
): string {
  return text(
    renderToString(
      createElement(DaySegmentSection, {
        tenantSlug: 'hub',
        date: '2026-09-25',
        dayLabel: 'jue 25/09',
        isoDow: 4,
        segment: LUNCH_WARN,
        defaultTime: '13:00',
        reservations: LUNCH_ROWS,
        canBook: true,
        canRaise: over.canRaise ?? true,
        isToday: over.isToday ?? false,
        suggestedRaise: 120,
        raising: false,
        focusReservationId: null,
        openReservationId: over.openReservationId ?? null,
        onOpenReservation: () => {},
        onRaise: () => {},
      }),
    ),
  )
}

/** aria-expanded del trigger (la fila) de una reserva del día. */
function rowExpanded(html: string, id: string): string | undefined {
  return new RegExp(`id="dia-res-${id}"><button[^>]*aria-expanded="(true|false)"`).exec(html)?.[1]
}

describe('DaySegmentSection · «Subir a N»', () => {
  it('el dato de partida es real: el almuerzo de 52 está en el aviso de 50', () => {
    expect(LUNCH_WARN.cause).toBe('warn_threshold')
    expect(LUNCH_WARN.people).toBe(52)
  })

  it('en otro día nombra la fecha que se va a guardar, no «hoy»', () => {
    const html = renderSection({ isToday: false })
    expect(html).toContain('Subir a 120 el jue 25/09')
    expect(html).not.toContain('Subir a 120 hoy')
  })

  it('en el día de hoy dice «hoy»', () => {
    const html = renderSection({ isToday: true })
    expect(html).toContain('Subir a 120 hoy')
    expect(html).not.toContain('Subir a 120 el ')
  })

  it('sin permiso (o un día que ya pasó: canRaise=false) no hay botón', () => {
    expect(renderSection({ canRaise: false })).not.toContain('Subir a')
  })
})

describe('DaySegmentSection · vista rápida controlada desde el día', () => {
  const [first, second] = LUNCH_ROWS.map((r) => r.id)

  it('ninguna abierta por defecto', () => {
    const html = renderSection()
    expect(rowExpanded(html, first ?? '')).toBe('false')
    expect(rowExpanded(html, second ?? '')).toBe('false')
  })

  it('abre la que dice la vista del día, aunque recién se monte en esta lista', () => {
    const html = renderSection({ openReservationId: second ?? null })
    expect(rowExpanded(html, first ?? '')).toBe('false')
    expect(rowExpanded(html, second ?? '')).toBe('true')
  })
})

describe('ReservationQuickView · sin `open` sigue manejando su estado', () => {
  it('arranca cerrada como en el resto de los usos', () => {
    const html = renderToString(
      createElement(ReservationQuickView, {
        tenantSlug: 'hub',
        reservation: reservation({}),
      }),
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>Ver<')
  })

  it('con `open` la decide el que la usa', () => {
    const html = renderToString(
      createElement(ReservationQuickView, {
        tenantSlug: 'hub',
        reservation: reservation({}),
        open: true,
        onOpenChange: () => {},
      }),
    )
    expect(html).toContain('aria-expanded="true"')
  })
})

describe('CalendarTabs · un día pedido deja el Calendario a la vista', () => {
  // El mes está mockeado: no lee nada de acá.
  const MONTH = {} as MonthSegments

  function renderTabs(defaultTab: 'calendario' | 'eventos'): string {
    return renderToString(
      createElement(CalendarTabs, {
        tenantSlug: 'hub',
        ym: '2026-09',
        events: [],
        templates: [],
        activeTemplates: [],
        monthSegments: MONTH,
        today: '2026-09-21',
        defaultTab,
        role: 'owner',
        initialOverview: null,
      }),
    )
  }

  beforeEach(() => {
    search = new URLSearchParams()
  })

  it('?tab=eventos sin día abre Formatos', () => {
    const html = renderTabs('eventos')
    expect(html).toContain('EDITOR-DE-FORMATOS')
    expect(html).not.toContain('MES-DEL-CALENDARIO')
  })

  it('con ?day gana el Calendario (ahí vive la vista del día)', () => {
    search = new URLSearchParams('day=hoy')
    const html = renderTabs('eventos')
    expect(html).toContain('MES-DEL-CALENDARIO')
    expect(html).not.toContain('EDITOR-DE-FORMATOS')
  })
})

// ──────────────────────────────────────────────────────────
// Filtro de planta (decisión del dueño, 22/09/2026)
// ──────────────────────────────────────────────────────────

const HUB_ZONE_CAPS: ZoneCaps = { planta_alta: 60, planta_baja: 70 }

// Lun 21/09: Pizza libre a las 21, con 2 mesas del evento sentadas en PA, una
// del evento todavía sin planta y una normal en PB.
const PIZZA_21: SegmentEventInput = {
  id: 'bbbbbbbb-0000-4000-8000-000000000021',
  event_date: '2026-09-21',
  starts_at_local: '21:00:00',
  capacity: 140,
  name_override: null,
  template: { name: 'Pizza libre', color_hex: '#e11d48' },
}
const ID = (n: number) => `cccccccc-0000-4000-8000-00000000000${n}`
const DINNER_21_ROWS = [
  reservation({
    id: ID(1),
    guest_name: 'Cumple Sofi',
    reservation_date: '2026-09-21',
    reservation_time_local: '21:00:00',
    meal_type: 'dinner',
    zone: 'planta_alta',
    scheduled_event_id: PIZZA_21.id,
    estimated_guests: 15,
    kind: 'birthday',
    cake_count: 1,
  }),
  reservation({
    id: ID(2),
    guest_name: 'Mesa Gómez',
    reservation_date: '2026-09-21',
    reservation_time_local: '21:30:00',
    meal_type: 'dinner',
    zone: 'planta_alta',
    scheduled_event_id: PIZZA_21.id,
    estimated_guests: 14,
  }),
  reservation({
    id: ID(3),
    guest_name: 'Grupo Flotante',
    reservation_date: '2026-09-21',
    reservation_time_local: '21:00:00',
    meal_type: 'dinner',
    zone: 'event_floating',
    scheduled_event_id: PIZZA_21.id,
    estimated_guests: 50,
  }),
  reservation({
    id: ID(4),
    guest_name: 'Normal PB',
    reservation_date: '2026-09-21',
    reservation_time_local: '21:00:00',
    meal_type: 'dinner',
    zone: 'planta_baja',
    estimated_guests: 11,
  }),
]
const DAY_21 = computeDaySegments({
  date: '2026-09-21',
  reservations: DINNER_21_ROWS,
  events: [PIZZA_21],
  caps: THU_CAPS,
})

function renderDinner21(
  zone: 'planta_alta' | 'planta_baja' | 'event_floating' | null,
  openReservationId: string | null = null,
): string {
  return text(
    renderToString(
      createElement(DaySegmentSection, {
        tenantSlug: 'hub',
        date: '2026-09-21',
        dayLabel: 'lun 21/09',
        isoDow: 1,
        segment: DAY_21.segments.dinner,
        defaultTime: '21:00',
        reservations: DINNER_21_ROWS,
        canBook: true,
        canRaise: true,
        isToday: false,
        suggestedRaise: null,
        zone,
        zoneCaps: HUB_ZONE_CAPS,
        raising: false,
        focusReservationId: null,
        openReservationId,
        onOpenReservation: () => {},
        onRaise: () => {},
      }),
    ),
  )
}

describe('DaySegmentSection · filtro de planta', () => {
  it('sin filtro: todas las filas y el dónde con placeLabel (evento + planta)', () => {
    const html = renderDinner21(null)
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`id="dia-res-${ID(n)}"`)
    expect(html).toContain('Pizza libre · Planta Alta')
    expect(html).toContain('Planta Baja')
    expect(html).toContain('Cena · 90 de 120')
    expect(html).not.toContain('Toda la cena')
  })

  it('Planta alta: chip de la planta, solo sus filas y cuántos del evento van ahí', () => {
    const html = renderDinner21('planta_alta')
    expect(html).toContain('Cena · Planta Alta · 29 de 60')
    expect(html).toContain('Quedan 31 lugares en Planta Alta')
    expect(html).toContain(`id="dia-res-${ID(1)}"`)
    expect(html).toContain(`id="dia-res-${ID(2)}"`)
    expect(html).not.toContain(`id="dia-res-${ID(3)}"`)
    expect(html).not.toContain(`id="dia-res-${ID(4)}"`)
    expect(html).toContain('aria-label="Reservas de la cena · Planta Alta"')
    // La tarjeta del evento queda y dice cuántos de Pizza libre van en PA.
    expect(html).toContain('Reservar en Pizza libre')
    expect(html).toContain('29 personas en Planta Alta')
    // El servicio entero como contexto.
    expect(html).toContain('Toda la cena: 90/120')
  })

  it('Sin ubicar: las del evento sin planta, sin cupo', () => {
    const html = renderDinner21('event_floating')
    expect(html).toContain('Cena · Sin ubicar · 50')
    expect(html).toContain('50 personas sin planta')
    expect(html).toContain(`id="dia-res-${ID(3)}"`)
    expect(html).not.toContain(`id="dia-res-${ID(1)}"`)
  })

  it('Planta baja: el evento no tiene a nadie ahí', () => {
    const html = renderDinner21('planta_baja')
    expect(html).toContain('Cena · Planta Baja · 11 de 70')
    expect(html).toContain('Nadie en Planta Baja')
    expect(html).toContain(`id="dia-res-${ID(4)}"`)
  })

  it('«Subir a N» es del servicio entero: con planta no aparece', () => {
    const html = text(
      renderToString(
        createElement(DaySegmentSection, {
          tenantSlug: 'hub',
          date: '2026-09-25',
          dayLabel: 'jue 25/09',
          isoDow: 4,
          segment: LUNCH_WARN,
          defaultTime: '13:00',
          reservations: LUNCH_ROWS,
          canBook: true,
          canRaise: true,
          isToday: false,
          suggestedRaise: 120,
          zone: 'planta_baja',
          zoneCaps: HUB_ZONE_CAPS,
          raising: false,
          focusReservationId: null,
          openReservationId: null,
          onOpenReservation: () => {},
          onRaise: () => {},
        }),
      ),
    )
    expect(html).not.toContain('Subir a')
    expect(html).toContain('Almuerzo · Planta Baja · 52 de 70')
  })
})

describe('DaySegmentSection · la vista rápida abierta sobrevive al filtro', () => {
  it('una reserva que ya no es de la planta se queda mientras su popup está abierto', () => {
    // Con el día en «Planta baja», a Cumple Sofi le cambiaron la zona a Planta
    // Alta desde su vista rápida: la fila (y el popup montado en ella) no se
    // desmonta de golpe mientras está abierta.
    const html = renderDinner21('planta_baja', ID(1))
    expect(html).toContain(`id="dia-res-${ID(1)}"`)
    expect(rowExpanded(html, ID(1))).toBe('true')
    // Las demás de otra planta siguen afuera.
    expect(html).not.toContain(`id="dia-res-${ID(2)}"`)
    expect(html).toContain(`id="dia-res-${ID(4)}"`)
  })

  it('cerrado el popup, la fila se va', () => {
    expect(renderDinner21('planta_baja', null)).not.toContain(`id="dia-res-${ID(1)}"`)
  })
})

describe('DaySegmentSection · servicio cerrado con planta', () => {
  // Jue 25/09 con el almuerzo cerrado por un cupo especial 0 y sin reservas.
  const CLOSED_LUNCH = computeDaySegments({
    date: '2026-09-25',
    reservations: [],
    events: [],
    caps: {
      ...THU_CAPS,
      lunch: {
        capacity: 0,
        warnAt: null,
        warnNote: null,
        source: 'override',
        overrideReason: 'evento privado',
      },
    },
  }).segments.lunch

  function renderClosed(zone: 'planta_alta' | null): string {
    return text(
      renderToString(
        createElement(DaySegmentSection, {
          tenantSlug: 'hub',
          date: '2026-09-25',
          dayLabel: 'jue 25/09',
          isoDow: 4,
          segment: CLOSED_LUNCH,
          defaultTime: '13:00',
          reservations: [],
          canBook: true,
          canRaise: true,
          isToday: false,
          suggestedRaise: null,
          zone,
          zoneCaps: HUB_ZONE_CAPS,
          raising: false,
          focusReservationId: null,
          openReservationId: null,
          onOpenReservation: () => {},
          onRaise: () => {},
        }),
      ),
    )
  }

  it('con Planta alta dice «Cerrado» y el motivo, no «Quedan 60 lugares»', () => {
    const html = renderClosed('planta_alta')
    expect(html).toContain('Cerrado')
    expect(html).toContain('Cupo especial: evento privado')
    expect(html).not.toContain('Quedan 60 lugares')
    expect(html).not.toContain('Todo el almuerzo')
  })

  it('sin filtro, lo mismo que antes', () => {
    const html = renderClosed(null)
    expect(html).toContain('Cerrado')
    expect(html).toContain('Cupo especial: evento privado')
  })
})

describe('MonthDaySegments · filtro de planta', () => {
  function month(
    zone: 'planta_alta' | 'event_floating' | null,
    variant: 'cell' | 'agenda',
    caps: ZoneCaps = HUB_ZONE_CAPS,
  ): string {
    return text(
      renderToString(
        createElement(MonthDaySegments, {
          day: DAY_21,
          variant,
          dayLabel: 'lunes 21 de septiembre',
          zone,
          zoneCaps: caps,
          onOpenSegment: () => {},
        }),
      ),
    )
  }

  it('Todo: la vista por servicio de siempre', () => {
    const cell = month(null, 'cell')
    expect(cell).toContain('C 90/120')
    expect(cell).not.toContain('/60')
  })

  it('Planta alta en la celda: personas de PA contra 60 y sus festejos', () => {
    const cell = month('planta_alta', 'cell')
    expect(cell).toContain('C 29/60')
    expect(cell).toContain('Cena 29/60')
    expect(cell).toContain('1 cumple · 1 torta')
    expect(cell).toContain(
      'aria-label="Cena, lunes 21 de septiembre, Planta Alta: 29 de 60 personas. Quedan 31 lugares en Planta Alta. 1 cumple, 1 torta."',
    )
    expect(cell).not.toContain('120')
  })

  it('Sin ubicar en la agenda: el chip sin tope', () => {
    const agenda = month('event_floating', 'agenda')
    expect(agenda).toContain('Cena 50')
    expect(agenda).toContain('<button type="button"')
  })

  it('sin cupo por planta: filtra igual y muestra personas sin semáforo', () => {
    const cell = month('planta_alta', 'cell', { planta_alta: 0, planta_baja: 0 })
    expect(cell).toContain('C 29')
    expect(cell).not.toContain('C 29/')
    expect(cell).not.toContain('text-destructive')
  })

  it('una planta sin gente no dibuja nada', () => {
    const empty = computeDaySegments({
      date: '2026-09-21',
      reservations: [DINNER_21_ROWS[3] as ReservationWithJoins],
      events: [],
      caps: THU_CAPS,
    })
    const out = renderToString(
      createElement(MonthDaySegments, {
        day: empty,
        variant: 'cell',
        dayLabel: 'lunes 21 de septiembre',
        zone: 'planta_alta',
        zoneCaps: HUB_ZONE_CAPS,
        onOpenSegment: () => {},
      }),
    )
    expect(out).toBe('')
  })
})

describe('ZoneFilterControl', () => {
  function control(value: 'alta' | 'baja' | 'sin' | null): string {
    return text(renderToString(createElement(ZoneFilterControl, { value, onChange: () => {} })))
  }

  it('grupo con nombre y las 4 opciones del dueño, en orden', () => {
    const html = control(null)
    expect(html).toMatch(/^<fieldset/)
    expect(html).toContain('<legend class="sr-only">Ver por planta</legend>')
    const labels = [...html.matchAll(/type="radio"[^>]*\/>([^<]+)<\/label>/g)].map((m) => m[1])
    expect(labels).toEqual(['Todo', 'Planta alta', 'Planta baja', 'Sin ubicar'])
    expect(html.match(/type="radio"/g)).toHaveLength(4)
  })

  it('radios nativos: uno solo marcado, el del valor', () => {
    const html = control('baja')
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(html).toMatch(/checked="" value="baja"/)
    expect(control(null)).toMatch(/checked="" value="todo"/)
  })

  it('en el celu ocupa el ancho sin scroll; en desktop, su tamaño', () => {
    const html = control(null)
    expect(html).toContain('flex w-full')
    expect(html).toContain('sm:inline-flex sm:w-auto')
    expect(html).not.toContain('overflow-x')
    expect(html).toContain('whitespace-nowrap')
  })
})
