// @vitest-environment node
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { DaySegmentCaps, DaySegmentsSnapshot, ResolvedSegmentCap } from '@/lib/salon/segments'
import { resolveSegmentSettings } from '@/lib/salon/segments'

/**
 * Primer paint (SSR) del alta/edición de una reserva con la planta DENTRO de un
 * evento (pedido del dueño del 22/09/2026). Lo que se prueba es lo que antes
 * se rompía sin avisar: una reserva de Pizza libre en Planta Alta abría con la
 * tarjeta "Planta Alta" suelta activa y un efecto le borraba el evento.
 * La interacción (tocar tarjetas) queda para el smoke manual.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hub/reservas/nuevo',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}))
vi.mock('@/lib/salon/actions', () => ({
  createSalonReservation: vi.fn(),
  updateSalonReservation: vi.fn(),
  quickCreateScheduledTemplate: vi.fn(),
}))
vi.mock('@/lib/customers/search', () => ({ searchCustomers: vi.fn(async () => []) }))
vi.mock('@/lib/salon/client-actions', () => ({ fetchScheduledEventsForDate: vi.fn() }))
vi.mock('@/lib/salon/segment-actions', () => ({ fetchDaySegments: vi.fn() }))

const DAY = '2026-09-26'
const PIZZA_ID = '3f2a1c4e-8b7d-4e21-9a6f-0c5d2b1e7a90'
const MANAGER_ID = '11111111-1111-4111-8111-111111111111'

function weekly(capacity: number): ResolvedSegmentCap {
  return { capacity, warnAt: null, warnNote: null, source: 'weekly', overrideReason: null }
}
const CAPS: DaySegmentCaps = { lunch: weekly(70), tea_time: weekly(120), dinner: weekly(120) }

const PIZZA: ScheduledEventWithTemplate = {
  id: PIZZA_ID,
  tenant_id: 't',
  template_id: 'tpl',
  name_override: null,
  event_date: DAY,
  starts_at_local: '21:00:00',
  ends_at_local: null,
  capacity: 50,
  meal_type: 'dinner',
  full_bonus_active: false,
  attendance_points: 0,
  notes: null,
  created_at: '',
  updated_at: '',
  template: {
    id: 'tpl',
    name: 'Pizza libre',
    slug: 'pizza',
    color_hex: '#e11d48',
    consume_special_reservations: true,
    default_capacity: 50,
  },
}

const SNAPSHOT: DaySegmentsSnapshot = {
  date: DAY,
  caps: CAPS,
  settings: resolveSegmentSettings([]),
  reservations: [
    {
      id: 'r-pa',
      reservation_date: DAY,
      meal_type: 'dinner',
      reservation_time_local: '21:00:00',
      scheduled_event_id: null,
      zone: 'planta_alta',
      status: 'pending',
      estimated_guests: 10,
      actual_guests: null,
      kind: 'normal',
      cake_count: 0,
    },
  ],
  events: [PIZZA],
}

async function render(initialValues: Record<string, unknown>, mode: 'create' | 'edit') {
  const { ReservationForm } = await import(
    '@/app/(manager)/[tenantSlug]/reservas/_components/reservation-form'
  )
  return renderToString(
    createElement(ReservationForm, {
      mode,
      tenantSlug: 'hub',
      returnTo: 'reservas',
      initialDate: DAY,
      today: '2026-09-22',
      initialSnapshot: SNAPSHOT,
      managers: [
        {
          id: MANAGER_ID,
          display_name: 'Luz',
          commission_eligible: true,
        } as never,
      ],
      templates: [],
      initialEventsForDate: [PIZZA],
      cakeOptions: [],
      rateTiers: [],
      bonusPerGuestCents: 0,
      reservationId: mode === 'edit' ? '22222222-2222-4222-8222-222222222222' : undefined,
      initialValues: {
        guest_name: 'Adriana Carranza',
        reservation_date: DAY,
        reservation_time_local: '21:00',
        primary_manager_id: MANAGER_ID,
        estimated_guests: 6,
        ...initialValues,
      },
    }),
  )
}

/** El `<button>` de una tarjeta de "Dónde se sienta", por el texto que muestra. */
function tile(html: string, text: string): string {
  const at = html.indexOf(`>${text}<`)
  expect(at).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<button', at)
  return html.slice(start, html.indexOf('>', start) + 1)
}

/** El `<input type="radio">` de "¿Dónde se sientan?" para una zona. */
function floorRadio(html: string, zone: string): string {
  const radios = html.match(/<input[^>]*name="event_floor"[^>]*>/g) ?? []
  const radio = radios.find((r) => r.includes(`value="${zone}"`))
  expect(radio).toBeDefined()
  return radio ?? ''
}

describe('ReservationForm · planta dentro de un evento (SSR)', () => {
  it('edición de Pizza libre en Planta Alta: el evento activo y "Planta Alta" elegida abajo', async () => {
    const html = await render(
      { zone: 'planta_alta', scheduled_event_id: PIZZA_ID, meal_type: 'dinner' },
      'edit',
    )
    // La tarjeta suelta de Planta Alta NO: la reserva es del evento.
    expect(tile(html, 'Planta Alta')).toContain('aria-pressed="false"')
    expect(tile(html, 'Pizza libre')).toContain('aria-pressed="true"')
    // La tarjeta del evento repite la planta elegida.
    expect(html).toContain('Evento · Planta Alta')
    // La pregunta aparece y Planta Alta es la elegida.
    expect(html).toContain('¿Dónde se sientan?')
    expect(html).toContain('(opcional)')
    expect(floorRadio(html, 'planta_alta')).toContain('checked')
    expect(floorRadio(html, 'event_floating')).not.toContain('checked')
  })

  it('alta desde un evento, sin planta: "Sin definir" elegido', async () => {
    const html = await render(
      { zone: 'event_floating', scheduled_event_id: PIZZA_ID, meal_type: 'dinner' },
      'create',
    )
    expect(tile(html, 'Pizza libre')).toContain('aria-pressed="true"')
    expect(floorRadio(html, 'event_floating')).toContain('checked')
    expect(html).toContain('Sin definir')
    // Al lado de cada planta de la pregunta, la gente que ya hay en la cena.
    const question = html.indexOf('¿Dónde se sientan?')
    const chooser = html.slice(question, html.indexOf('</fieldset>', question))
    expect(chooser).toContain('10 en la cena')
    expect(chooser).toContain('0 en la cena')
  })

  it('reserva normal: la tarjeta de su planta y sin la pregunta del evento', async () => {
    const html = await render({ zone: 'planta_baja', meal_type: 'dinner' }, 'create')
    expect(tile(html, 'Planta Baja')).toContain('aria-pressed="true"')
    expect(tile(html, 'Pizza libre')).toContain('aria-pressed="false"')
    expect(html).not.toContain('¿Dónde se sientan?')
    expect(html).not.toContain('name="event_floor"')
  })
})
