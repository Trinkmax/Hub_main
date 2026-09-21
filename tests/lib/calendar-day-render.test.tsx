// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarTabs } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/calendar-tabs'
import { DaySegmentSection } from '@/app/(manager)/[tenantSlug]/eventos/programados/_components/day-segment-section'
import { ReservationQuickView } from '@/components/reservations/reservation-quick-view'
import {
  computeDaySegments,
  type DaySegmentCaps,
  type MonthSegments,
  type ResolvedSegmentCap,
  type SegmentLoad,
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
